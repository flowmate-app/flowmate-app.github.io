/* Gate geometry and the population engine.
 *
 * A gate:
 *   { id, name, parent (gate id | null for "All events"), type: 'polygon'|'rect'|'range'|'quad'|'ellipse',
 *     x, y  (parameter names; y is null for 'range'),
 *     xScale, yScale  (scale specs snapshotted when drawn — containment is evaluated in
 *                      this display space, so later axis changes never alter results),
 *     verts: [[x, y], ...]  data units            (polygon)
 *     rect:  {x0, x1, y0, y1} data units          (rect)
 *     range: {lo, hi} data units                  (range)
 *     quad: {cx, cy}, corner: UL|UR|LL|LR, link   (quad: four gates sharing `link`)
 *     ellipse: {cx, cy, rx, ry, angle}            (ellipse: centre in data units; radii and angle
 *                                                  in the gate's own display units, see below)
 *     outside: true                               keep the events *outside* the shape (FlowJo eventsInside="0")
 *     openMax: true                               rect/range upper bounds exclude the bound itself (GatingML,
 *                                                  FlowJo); a null bound is open (no limit on that side)
 *     extra: [{ p, lo, hi }]                      more bounds on other parameters, in data units, [lo, hi)
 *                                                  — how an n-dimensional GatingML rectangle or quadrant is held
 *     color, rev,
 *     perWell: { [well key]: { <one geometry field>, rev } }   optional, see below }
 *
 * Boolean gates have no shape and no axes:
 *     { type: 'bool', x: null, y: null, bool: { op: 'and'|'or', terms: [{ id, not }] } }
 * A NOT gate is op 'and' with one negated term. A term that does not apply to a sample counts
 * as empty there. `parent` is the deepest population holding every term.
 *
 * A gate applies to every well. `perWell` is the exception: one well may carry its own
 * copy of the geometry — and only the geometry. Name, parent, axes and the snapshotted
 * scales stay shared, so "% in Cells" means the same thing in every well of the plate.
 * `gateFor(gate, wellKey)` resolves the pair; `filter` never sees the difference.
 *
 * Populations are index lists (Uint32Array) into a sample's event columns, cached per
 * sample under a stamp built from the gate chain's revisions, so editing a gate
 * invalidates exactly that gate and its descendants — and editing one well's copy
 * invalidates that well alone.
 */
(function (FM) {
  'use strict';
  const T = FM.transforms;

  // -------------------------------------------------------- per-well gates
  /** The one field that holds each gate type's geometry — the only thing a well may differ in. */
  const GEOM = { polygon: 'verts', rect: 'rect', range: 'range', quad: 'quad', ellipse: 'ellipse' };

  /** That well's own geometry for this gate, or null. The single test both callers share. */
  function overrideOf(gate, wellKey) {
    if (!gate || wellKey == null || !gate.perWell) return null;
    const o = gate.perWell[wellKey];
    const k = GEOM[gate.type];
    return o && k && o[k] !== undefined ? o : null;
  }

  /**
   * The gate as it applies to one well: the shared gate itself when that well has no copy
   * of its own (the common case allocates nothing), else a copy with the well's geometry.
   */
  function gateFor(gate, wellKey) {
    const o = overrideOf(gate, wellKey);
    if (!o) return gate;
    const out = Object.assign({}, gate);
    out[GEOM[gate.type]] = o[GEOM[gate.type]];
    // a sample whose axis transform differed (FlowJo allows that) keeps the scale it was drawn on
    if (o.xScale) out.xScale = o.xScale;
    if (o.yScale) out.yScale = o.yScale;
    out.rev = o.rev != null ? o.rev : gate.rev;
    return out;
  }

  // --------------------------------------------------------------- geometry
  function pointInPolygon(x, y, vx, vy) {
    let inside = false;
    const n = vx.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = vy[i], yj = vy[j];
      if ((yi > y) !== (yj > y)) {
        const xint = (vx[j] - vx[i]) * (y - yi) / (yj - yi) + vx[i];
        if (x < xint) inside = !inside;
      }
    }
    return inside;
  }

  /** Polygon vertices in the gate's own display space. */
  function displayVerts(gate) {
    const xs = T.makeScale(gate.xScale), ys = T.makeScale(gate.yScale);
    return gate.verts.map(([x, y]) => [xs.fwd(x), ys.fwd(y)]);
  }

  function polygonArea(pts) {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    return a / 2;
  }

  function centroid(pts) {
    let cx = 0, cy = 0, a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
      cx += (pts[j][0] + pts[i][0]) * f; cy += (pts[j][1] + pts[i][1]) * f; a += f;
    }
    if (Math.abs(a) < 1e-12) {
      const n = pts.length || 1;
      return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
    }
    return [cx / (3 * a), cy / (3 * a)];
  }

  /**
   * Filter `idx` (indices into sample columns, ascending) down to events inside `gate` — or
   * outside it, for a gate marked `outside`. Returns a new Uint32Array, ascending.
   */
  function filter(gate, sample, idx) {
    if (gate.type === 'bool') throw new Error('Boolean gates are evaluated by the engine, not by filter()');
    let inside = filterShape(gate, sample, idx);
    if (gate.extra && gate.extra.length) inside = filterExtra(gate.extra, sample, inside);
    return gate.outside ? complement(idx, inside) : inside;
  }

  /** Sorted [lo, hi] with null as an open side. */
  function span(a, b) {
    if (a != null && b != null && a > b) { const t = a; a = b; b = t; }
    return [a == null ? -Infinity : a, b == null ? Infinity : b];
  }

  /** Extra one-parameter bounds, [lo, hi) in data units. */
  function filterExtra(extra, sample, idx) {
    let cur = idx;
    extra.forEach(c => {
      const col = sample.data[c.p];
      if (!col) throw new Error('Parameter "' + c.p + '" not found in ' + sample.name);
      const [lo, hi] = span(c.lo, c.hi);
      const out = new Uint32Array(cur.length);
      let k = 0;
      for (let i = 0; i < cur.length; i++) { const e = cur[i], x = col[e]; if (x >= lo && x < hi) out[k++] = e; }
      cur = out.slice(0, k);
    });
    return cur;
  }

  /** Elements of `all` not in `sub` (sub is an ascending subsequence of all). */
  function complement(all, sub) {
    const out = new Uint32Array(all.length - sub.length);
    let j = 0, k = 0;
    for (let i = 0; i < all.length; i++) {
      if (j < sub.length && sub[j] === all[i]) { j++; continue; }
      out[k++] = all[i];
    }
    return k === out.length ? out : out.slice(0, k);
  }

  /** The deepest population that holds every term: the common ancestor of the terms' parents. */
  function lca(gatesById, termIds) {
    const pathTo = id => {
      const out = [];
      let g = id ? gatesById(id) : null, guard = 0;
      while (g && guard++ < 256) { out.unshift(g.id); g = g.parent ? gatesById(g.parent) : null; }
      return [null].concat(out);
    };
    const paths = termIds.map(id => pathTo((gatesById(id) || {}).parent || null));
    if (!paths.length) return null;
    let common = null;
    for (let i = 0; i < paths[0].length; i++) {
      const v = paths[0][i];
      if (paths.every(p => p[i] === v)) common = v; else break;
    }
    return common;
  }

  function filterShape(gate, sample, idx) {
    // gate.uncomp: axes evaluated on the uncompensated values (a FlowJo gate drawn on raw channels)
    const rawX = !!(gate.uncomp && gate.uncomp.indexOf('x') >= 0), rawY = !!(gate.uncomp && gate.uncomp.indexOf('y') >= 0);
    const colOf = (p, raw) => (raw ? sample.raw || sample.data : sample.data)[p];
    const xc = colOf(gate.x, rawX);
    if (!xc) throw new Error('Parameter "' + gate.x + '" not found in ' + sample.name);
    const yc = gate.y ? colOf(gate.y, rawY) : null;
    if (gate.y && !yc) throw new Error('Parameter "' + gate.y + '" not found in ' + sample.name);
    const out = new Uint32Array(idx.length);
    let k = 0;

    if (gate.type === 'rect') {
      const r = gate.rect;
      const [x0, x1] = span(r.x0, r.x1), [y0, y1] = span(r.y0, r.y1);
      if (gate.openMax) {
        for (let i = 0; i < idx.length; i++) {
          const e = idx[i], x = xc[e], y = yc[e];
          if (x >= x0 && x < x1 && y >= y0 && y < y1) out[k++] = e;
        }
      } else {
        for (let i = 0; i < idx.length; i++) {
          const e = idx[i], x = xc[e], y = yc[e];
          if (x >= x0 && x <= x1 && y >= y0 && y <= y1) out[k++] = e;
        }
      }
    } else if (gate.type === 'quad') {
      // four linked gates partition the parent exactly: right = x ≥ cx, upper = y ≥ cy
      const cx = gate.quad.cx, cy = gate.quad.cy;
      const right = gate.corner === 'UR' || gate.corner === 'LR';
      const upper = gate.corner === 'UR' || gate.corner === 'UL';
      for (let i = 0; i < idx.length; i++) {
        const e = idx[i], x = xc[e], y = yc[e];
        if (x !== x || y !== y) continue;
        if ((x >= cx) === right && (y >= cy) === upper) out[k++] = e;
      }
    } else if (gate.type === 'range') {
      const [lo, hi] = span(gate.range.lo, gate.range.hi);
      const open = !!gate.openMax;
      for (let i = 0; i < idx.length; i++) {
        const e = idx[i], x = xc[e];
        if (x >= lo && (open ? x < hi : x <= hi)) out[k++] = e;
      }
    } else if (gate.type === 'polygon') {
      const xs = T.makeScale(gate.xScale), ys = T.makeScale(gate.yScale);
      const dv = gate.verts.map(([x, y]) => [xs.fwd(x), ys.fwd(y)]);
      const vx = Float64Array.from(dv, p => p[0]), vy = Float64Array.from(dv, p => p[1]);
      let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
      for (let i = 0; i < vx.length; i++) {
        if (vx[i] < bx0) bx0 = vx[i]; if (vx[i] > bx1) bx1 = vx[i];
        if (vy[i] < by0) by0 = vy[i]; if (vy[i] > by1) by1 = vy[i];
      }
      // display columns are cached per (param, scale), so re-filtering while a vertex is
      // dragged costs only the point-in-polygon tests
      const dx = T.displayColumn(sample, gate.x, gate.xScale, rawX);
      const dy = T.displayColumn(sample, gate.y, gate.yScale, rawY);
      for (let i = 0; i < idx.length; i++) {
        const e = idx[i];
        const tx = dx[e];
        if (tx < bx0 || tx > bx1) continue;
        const ty = dy[e];
        if (ty < by0 || ty > by1) continue;
        if (pointInPolygon(tx, ty, vx, vy)) out[k++] = e;
      }
    } else if (gate.type === 'ellipse') {
      const d = ellipseDisplay(gate);
      const c = Math.cos(d.angle), s = Math.sin(d.angle);
      const irx2 = 1 / (d.rx * d.rx), iry2 = 1 / (d.ry * d.ry), R = Math.max(d.rx, d.ry);
      const dx = T.displayColumn(sample, gate.x, gate.xScale, rawX);
      const dy = T.displayColumn(sample, gate.y, gate.yScale, rawY);
      for (let i = 0; i < idx.length; i++) {
        const e = idx[i];
        const u = dx[e] - d.tcx;
        if (u > R || u < -R) continue;
        const v = dy[e] - d.tcy;
        if (v > R || v < -R) continue;
        const a = u * c + v * s, b = -u * s + v * c;
        if (a * a * irx2 + b * b * iry2 <= 1) out[k++] = e;
      }
    } else {
      throw new Error('Unknown gate type ' + gate.type);
    }
    return out.slice(0, k);
  }

  // ---------------------------------------------------------------- ellipse
  /* An ellipse lives in the display space of the scales it was drawn on, like a polygon:
   * on logicle axes it is an ellipse on the plot, which is what the user drew. Its centre is
   * kept in data units (so it reads as instrument values), its radii and rotation in display
   * units t ∈ [0, 1]. */

  /** Centre in display units plus the radii and rotation: {tcx, tcy, rx, ry, angle}. */
  function ellipseDisplay(gate) {
    const e = gate.ellipse;
    const xs = T.makeScale(gate.xScale), ys = T.makeScale(gate.yScale);
    return { tcx: xs.fwd(e.cx), tcy: ys.fwd(e.cy), rx: Math.max(1e-9, Math.abs(e.rx)), ry: Math.max(1e-9, Math.abs(e.ry)), angle: e.angle || 0 };
  }

  /** n points around the ellipse, in its display units. */
  function ellipsePoints(gate, n) {
    const d = ellipseDisplay(gate), c = Math.cos(d.angle), s = Math.sin(d.angle);
    const out = [];
    for (let i = 0; i < (n || 96); i++) {
      const t = 2 * Math.PI * i / (n || 96);
      const a = d.rx * Math.cos(t), b = d.ry * Math.sin(t);
      out.push([d.tcx + a * c - b * s, d.tcy + a * s + b * c]);
    }
    return out;
  }

  /** The four ends of the axes (display units): +major, +minor, −major, −minor. */
  function ellipseHandles(gate) {
    const d = ellipseDisplay(gate), c = Math.cos(d.angle), s = Math.sin(d.angle);
    return [[d.tcx + d.rx * c, d.tcy + d.rx * s], [d.tcx - d.ry * s, d.tcy + d.ry * c],
      [d.tcx - d.rx * c, d.tcy - d.rx * s], [d.tcx + d.ry * s, d.tcy - d.ry * c]];
  }

  // ------------------------------------------------------ population engine
  function allIndices(sample) {
    if (!sample._all || sample._all.length !== sample.n) {
      const a = new Uint32Array(sample.n);
      for (let i = 0; i < sample.n; i++) a[i] = i;
      sample._all = a;
    }
    return sample._all;
  }

  /**
   * The engine resolves populations against a live gate list.
   * `gatesById` is a function (id) → gate, so the engine never holds stale copies.
   *
   * opts.perWell === false ignores per-well geometry, which is how the app answers
   * "what would this well have read on the shared gate?". Such an engine must be given its
   * own opts.cache, or its populations would overwrite the real ones on the same sample.
   */
  function Engine(gatesById, opts) {
    opts = opts || {};
    this.gatesById = gatesById;
    this.perWell = opts.perWell !== false;
    this.cache = opts.cache || '_pops';
    // applies(gate, sample): does this gate's *own* scope include the sample (see scope.js)
    this.applies = opts.applies || null;
    this._depth = 0;
  }

  /**
   * Stamp identifying the exact definition of a population in one sample: the gate chain,
   * each link at the revision that sample sees. A well with its own copy of a gate gets a
   * different stamp from the rest, so adjusting it leaves every other well's cache intact.
   */
  Engine.prototype.stamp = function (sample, gateId) {
    const key = this.perWell && sample ? sample.key : null;
    let s = '';
    let id = gateId;
    let guard = 0;
    while (id) {
      const g = this.gatesById(id);
      if (!g) return null;
      // a gate (or an ancestor) scoped away from this sample: no population here at all
      if (this.applies && sample && !this.applies(g, sample)) return null;
      const o = overrideOf(g, key);
      // the '*' keeps a well's revision from ever reading as the shared one
      s += g.id + '@' + ((o && o.rev != null ? o.rev : g.rev) || 0) + (o ? '*' : '') + (g.outside ? '~' : '');
      // a Boolean gate is as fresh as the terms it combines
      if (g.type === 'bool' && g.bool) {
        if (++this._depth > 64) { this._depth = 0; throw new Error('Boolean gates refer to each other in a loop'); }
        try { s += '{' + g.bool.terms.map(t => (t.not ? '!' : '') + (this.stamp(sample, t.id) || 'x')).join(',') + '}'; }
        finally { this._depth--; }
      }
      s += '<';
      id = g.parent;
      if (++guard > 256) throw new Error('Gate hierarchy has a cycle');
    }
    return s || 'root';
  };

  /** Indices of events in population `gateId` (null → all events) for `sample`. */
  Engine.prototype.indices = function (sample, gateId) {
    if (!gateId) return allIndices(sample);
    const stamp = this.stamp(sample, gateId);
    if (stamp == null) return new Uint32Array(0);
    const store = sample[this.cache] || (sample[this.cache] = new Map());
    const hit = store.get(gateId);
    if (hit && hit.stamp === stamp) return hit.idx;
    const g = this.gatesById(gateId);
    const parentIdx = this.indices(sample, g.parent);
    let idx;
    try { idx = g.type === 'bool' ? this.boolIndices(sample, g, parentIdx) : filter(this.perWell ? gateFor(g, sample.key) : g, sample, parentIdx); }
    catch (err) { idx = new Uint32Array(0); sample._popErrors = sample._popErrors || {}; sample._popErrors[gateId] = err.message; }
    store.set(gateId, { stamp, idx });
    return idx;
  };

  /** Events of the parent kept by a Boolean gate: every term (and) or any term (or), each maybe negated. */
  Engine.prototype.boolIndices = function (sample, g, parentIdx) {
    const terms = (g.bool && g.bool.terms) || [];
    if (!terms.length) return new Uint32Array(0);
    const and = g.bool.op !== 'or';
    const marks = terms.map(t => {
      const m = new Uint8Array(sample.n);
      const ix = this.indices(sample, t.id);
      for (let i = 0; i < ix.length; i++) m[ix[i]] = 1;
      return { m, not: !!t.not };
    });
    const out = new Uint32Array(parentIdx.length);
    let k = 0;
    for (let i = 0; i < parentIdx.length; i++) {
      const e = parentIdx[i];
      let keep = and;
      for (let j = 0; j < marks.length; j++) {
        const v = (marks[j].m[e] === 1) !== marks[j].not;
        if (and && !v) { keep = false; break; }
        if (!and && v) { keep = true; break; }
      }
      if (keep) out[k++] = e;
    }
    return out.slice(0, k);
  };

  Engine.prototype.count = function (sample, gateId) { return this.indices(sample, gateId).length; };

  /** % of parent population. */
  Engine.prototype.pctParent = function (sample, gateId) {
    if (!gateId) return 100;
    const g = this.gatesById(gateId);
    const p = this.indices(sample, g ? g.parent : null).length;
    return p ? 100 * this.indices(sample, gateId).length / p : NaN;
  };

  /** % of an ancestor population (null → total events). */
  Engine.prototype.pctOf = function (sample, gateId, ancestorId) {
    const d = this.indices(sample, ancestorId || null).length;
    return d ? 100 * this.indices(sample, gateId).length / d : NaN;
  };

  Engine.prototype.clear = function (sample) { if (sample) { sample[this.cache] = new Map(); sample._stats = new Map(); } };

  FM.gating = { pointInPolygon, displayVerts, polygonArea, centroid, filter, complement, lca, span, Engine, allIndices, gateFor, overrideOf, GEOM,
    ellipseDisplay, ellipsePoints, ellipseHandles };
})(FM);
