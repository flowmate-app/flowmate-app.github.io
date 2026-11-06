/* Gating-ML 2.0 import and export (ISAC standard; Spidlen et al., Cytometry A 2015).
 *
 * Import maps every Gating-ML construct FlowMate can evaluate exactly:
 *   transformations  flin, flog, fasinh, logicle, hyperlog  → the gate's display scales
 *   spectrumMatrix   compensation                           → a matrix in doc.comp
 *   RectangleGate    1-D → range, 2-D → rect, more → rect + extra bounds; open sides; [min, max)
 *   PolygonGate      vertices in the dimensions' (transformed) space
 *   EllipsoidGate    2-D: mean + covariance + distance² → ellipse in display space
 *   QuadrantGate     two single-value dividers → a linked quadrant; anything else → one
 *                    rectangle (+ extra bounds) per quadrant
 *   BooleanGate      and / or / not, use-as-complement
 * and names what it cannot (ratio dimensions, 3-D ellipsoids), skipping those gates.
 *
 * Export writes the gate tree back: shapes on non-linear axes carry their transformation and
 * are written in that space, so a straight polygon edge stays where it was drawn.
 */
(function (FM) {
  'use strict';
  const X = () => FM.xml, T = () => FM.transforms;
  const uid = p => FM.workspaceUtil.uid(p);

  // ---------------------------------------------------------------- import
  /**
   * ctx.rangeOf(param) → the parameter's range, used for the linear display scale of an
   * untransformed dimension (any linear scale gives the same result; this one draws well).
   */
  function parse(text, ctx) {
    ctx = ctx || {};
    const x = X(), t = T();
    const doc = x.parse(text);
    const root = doc.documentElement;
    if (x.local(root) !== 'Gating-ML') throw new Error('This is not a Gating-ML file (its root element is ' + x.local(root) + ').');
    const warnings = [], skipped = [];

    // transformations: id → { spec | null, type }
    const xforms = {};
    x.kids(root, 'transformation').forEach(el => {
      const c = el.children[0];
      xforms[x.attr(el, 'id')] = c ? { spec: t.fromGatingML({ type: x.local(c), attrs: x.attrs(c) }), type: x.local(c) } : { spec: null, type: 'empty' };
    });

    // spectrum matrices: id → { params (detectors), fluoro, spill }
    const matrices = {};
    x.kids(root, 'spectrumMatrix').forEach(el => {
      const names = which => x.kids(x.kid(el, which), 'fcs-dimension').map(d => x.attr(d, 'name'));
      const fluoro = names('fluorochromes'), detectors = names('detectors');
      const spill = x.kids(el, 'spectrum').map(row => x.kids(row, 'coefficient').map(c => parseFloat(x.attr(c, 'value'))));
      const id = x.attr(el, 'id');
      if (fluoro.length !== detectors.length || spill.length !== detectors.length || spill.some(r => r.length !== detectors.length)) {
        warnings.push('Matrix ' + id + ' is not square; it was skipped.');
        return;
      }
      matrices[id] = { id: uid('cm'), gmlId: id, name: id, params: detectors, fluoro, spill };
    });

    const linFor = name => ({ type: 'lin', min: 0, max: (ctx.rangeOf && ctx.rangeOf(name)) || 1024 });

    /** A dimension: { name, comp, scale (transform or null), min, max } or { unsupported }. */
    function dim(el) {
      const fd = x.kid(el, 'fcs-dimension');
      if (!fd) return { unsupported: x.kid(el, 'new-dimension') || x.kid(el, 'ratio-dimension') ? 'ratio dimensions' : 'an unrecognised dimension' };
      let name = x.attr(fd, 'name');
      const comp = x.attr(el, 'compensation-ref') || 'uncompensated';
      const m = matrices[comp];
      if (m) { const i = m.fluoro.indexOf(name); if (i >= 0) name = m.params[i]; }
      else if (comp !== 'FCS' && comp !== 'uncompensated') return { unsupported: 'compensation "' + comp + '" which the file does not define' };
      const tid = x.attr(el, 'transformation-ref');
      let scale = null;
      if (tid) {
        const tf = xforms[tid];
        if (!tf || !tf.spec) return { unsupported: (tf ? tf.type : 'an undefined') + ' transformation' };
        scale = tf.spec;
      }
      return { name, comp, scale, min: x.num(x.attr(el, 'min')), max: x.num(x.attr(el, 'max')) };
    }
    const displayScale = d => d.scale || linFor(d.name);
    const toData = (d, v) => (v == null ? null : d.scale ? t.makeScale(d.scale).inv(v) : v);

    const gates = [];           // FlowMate gates, with gmlParent / bool refs resolved below
    const byGml = {};           // gating:id → gate
    const comps = new Set();

    function nameOf(el, id) {
      const ci = x.kid(el, 'custom_info');
      const m = ci && /flowmate-name:\s*(.+)/.exec(ci.textContent || '');
      return m ? m[1].trim() : id;
    }
    function add(g, gmlId, parentGml) {
      g.id = uid('g');
      g.color = null;
      g.gmlParent = parentGml || null;
      gates.push(g);
      byGml[gmlId] = g;
      return g;
    }
    const skip = (id, why) => { skipped.push({ id, reason: why }); };

    /** A box over 1+ dimensions ([lo, hi) in data units each) as range / rect + extra bounds. */
    function box(dims, bounds) {
      const g = { openMax: true };
      if (dims.length === 1) {
        Object.assign(g, { type: 'range', x: dims[0].name, y: null, xScale: displayScale(dims[0]), yScale: null, range: { lo: bounds[0][0], hi: bounds[0][1] } });
      } else {
        Object.assign(g, { type: 'rect', x: dims[0].name, y: dims[1].name, xScale: displayScale(dims[0]), yScale: displayScale(dims[1]),
          rect: { x0: bounds[0][0], x1: bounds[0][1], y0: bounds[1][0], y1: bounds[1][1] } });
        if (dims.length > 2) g.extra = dims.slice(2).map((d, i) => ({ p: d.name, lo: bounds[i + 2][0], hi: bounds[i + 2][1] }));
      }
      return g;
    }

    x.kids(root).forEach(el => {
      const kind = x.local(el);
      const id = x.attr(el, 'id');
      const parent = x.attr(el, 'parent_id');
      if (kind === 'RectangleGate') {
        const dims = x.kids(el, 'dimension').map(dim);
        const bad = dims.find(d => d.unsupported);
        if (bad) return skip(id, bad.unsupported);
        dims.forEach(d => comps.add(d.comp));
        add(Object.assign({ name: nameOf(el, id) }, box(dims, dims.map(d => [toData(d, d.min), toData(d, d.max)]))), id, parent);
      } else if (kind === 'PolygonGate') {
        const dims = x.kids(el, 'dimension').map(dim);
        const bad = dims.find(d => d.unsupported);
        if (bad) return skip(id, bad.unsupported);
        if (dims.length !== 2) return skip(id, 'a polygon needs exactly two dimensions');
        dims.forEach(d => comps.add(d.comp));
        const verts = x.kids(el, 'vertex').map(v => {
          const c = x.kids(v, 'coordinate').map(k => parseFloat(x.attr(k, 'value')));
          return [toData(dims[0], c[0]), toData(dims[1], c[1])];
        });
        add({ name: nameOf(el, id), type: 'polygon', x: dims[0].name, y: dims[1].name, xScale: displayScale(dims[0]), yScale: displayScale(dims[1]), verts }, id, parent);
      } else if (kind === 'EllipsoidGate') {
        const dims = x.kids(el, 'dimension').map(dim);
        const bad = dims.find(d => d.unsupported);
        if (bad) return skip(id, bad.unsupported);
        if (dims.length !== 2) return skip(id, dims.length + '-dimensional ellipsoids (FlowMate draws 2-D ellipses)');
        dims.forEach(d => comps.add(d.comp));
        const mean = x.kids(x.kid(el, 'mean'), 'coordinate').map(k => parseFloat(x.attr(k, 'value')));
        const cov = x.kids(x.kid(el, 'covarianceMatrix'), 'row').map(r => x.kids(r, 'entry').map(k => parseFloat(x.attr(k, 'value'))));
        const d2 = parseFloat(x.attr(x.kid(el, 'distanceSquare'), 'value'));
        add(Object.assign({ name: nameOf(el, id) }, ellipseFrom(dims.map(displayScale), dims.map(d => !!d.scale), dims.map(d => d.name), mean, cov, d2)), id, parent);
      } else if (kind === 'QuadrantGate') {
        quadrants(el, id, parent);
      } else if (kind === 'BooleanGate') {
        const op = el.children ? Array.from(el.children).find(c => ['and', 'or', 'not'].indexOf(x.local(c)) >= 0) : null;
        if (!op) return skip(id, 'a Boolean gate without and / or / not');
        const refs = x.kids(op, 'gateReference').map(r => ({ ref: x.attr(r, 'ref'), comp: x.attr(r, 'use-as-complement') === 'true' }));
        const kindOp = x.local(op);
        const terms = kindOp === 'not' ? refs.slice(0, 1).map(r => ({ ref: r.ref, not: !r.comp })) : refs.map(r => ({ ref: r.ref, not: r.comp }));
        add({ name: nameOf(el, id), type: 'bool', x: null, y: null, xScale: null, yScale: null, bool: { op: kindOp === 'or' ? 'or' : 'and', terms } }, id, parent);
      }
    });

    function quadrants(el, id, parent) {
      const dividers = {};
      for (const dv of x.kids(el, 'divider')) {
        const d = dim(dv);
        if (d.unsupported) return skip(id, d.unsupported);
        comps.add(d.comp);
        dividers[x.attr(dv, 'id')] = Object.assign(d, { values: x.kids(dv, 'value').map(v => parseFloat(v.textContent)).sort((a, b) => a - b) });
      }
      const quads = x.kids(el, 'Quadrant').map(q => ({ id: x.attr(q, 'id'), name: nameOf(q, x.attr(q, 'id')),
        pos: x.kids(q, 'position').map(p => ({ div: dividers[x.attr(p, 'divider_ref')], loc: parseFloat(x.attr(p, 'location')) })) }));
      const divs = Object.values(dividers);
      // the everyday case: two single-value dividers → one linked FlowMate quadrant
      if (divs.length === 2 && divs.every(d => d.values.length === 1) && quads.every(q => q.pos.length === 2 && q.pos.every(p => p.div))) {
        const [dx, dy] = divs, link = uid('q');
        quads.forEach(q => {
          const px = q.pos.find(p => p.div === dx), py = q.pos.find(p => p.div === dy);
          const right = px.loc >= dx.values[0], upper = py.loc >= dy.values[0];
          add({ name: q.name, type: 'quad', x: dx.name, y: dy.name, xScale: displayScale(dx), yScale: displayScale(dy),
            quad: { cx: toData(dx, dx.values[0]), cy: toData(dy, dy.values[0]) }, corner: (upper ? 'U' : 'L') + (right ? 'R' : 'L'), link }, q.id, parent);
        });
        return;
      }
      // anything else: each quadrant is the box between the divider values around its location
      quads.forEach(q => {
        if (q.pos.some(p => !p.div)) return skip(q.id, 'a quadrant that refers to a missing divider');
        const dims = q.pos.map(p => p.div);
        const bounds = q.pos.map(p => {
          const v = p.div.values;
          let lo = null, hi = null;
          v.forEach(b => { if (b <= p.loc) lo = b; else if (hi == null) hi = b; });
          return [toData(p.div, lo), toData(p.div, hi)];
        });
        add(Object.assign({ name: q.name }, box(dims, bounds)), q.id, parent);
      });
    }

    // resolve parents and Boolean references to FlowMate ids
    gates.forEach(g => {
      if (g.gmlParent) {
        const p = byGml[g.gmlParent];
        if (p) g.parent = p.id; else { g.parent = null; warnings.push(g.name + ': parent ' + g.gmlParent + ' is not in the file; placed at the top.'); }
      } else g.parent = null;
      if (g.type === 'bool') {
        const terms = [];
        g.bool.terms.forEach(tm => { const r = byGml[tm.ref]; if (r) terms.push({ id: r.id, not: tm.not }); else warnings.push(g.name + ': refers to ' + tm.ref + ', which is not in the file.'); });
        g.bool = { op: g.bool.op, terms };
      }
      delete g.gmlParent;
    });
    const usable = gates.filter(g => g.type !== 'bool' || g.bool.terms.length);
    const ids = {};
    Object.keys(byGml).forEach(k => { ids[k] = byGml[k].id; });
    skipped.forEach(s => warnings.push(s.id + ' was skipped: FlowMate does not support ' + s.reason + '.'));
    return { gates: usable, matrices: Object.values(matrices), comps: Array.from(comps), warnings, skipped, ids };
  }

  /**
   * Gating-ML ellipsoid → FlowMate ellipse. In display space the covariance is scaled by each
   * linear axis's span; its eigenvectors give the rotation and √(d²·λ) the radii.
   */
  function ellipseFrom(scales, transformed, names, mean, cov, d2) {
    const sc = scales.map(s => T().makeScale(s));
    const span = scales.map((s, i) => (transformed[i] ? 1 : (s.max - s.min) || 1));
    const tm = mean.map((m, i) => (transformed[i] ? m : sc[i].fwd(m)));
    const a = cov[0][0] / (span[0] * span[0]), b = cov[0][1] / (span[0] * span[1]), c = cov[1][1] / (span[1] * span[1]);
    const mid = (a + c) / 2, rad = Math.sqrt(((a - c) / 2) * ((a - c) / 2) + b * b);
    const l1 = mid + rad, l2 = Math.max(0, mid - rad);
    const angle = 0.5 * Math.atan2(2 * b, a - c);
    return { type: 'ellipse', x: names[0], y: names[1], xScale: scales[0], yScale: scales[1],
      ellipse: { cx: sc[0].inv(tm[0]), cy: sc[1].inv(tm[1]), rx: Math.sqrt(d2 * l1), ry: Math.sqrt(d2 * l2), angle } };
  }

  /** Add a Gating-ML file's gates (and matrices) to the workspace in one undo step. */
  function importInto(ws, text) {
    const r = parse(text, { rangeOf: p => { const i = ws.paramInfo(p); return i && i.range; } });
    const taken = new Set(ws.doc.gates.map(g => g.name.toLowerCase()));
    r.gates.forEach(g => {
      let n = g.name, k = 2;
      while (taken.has(n.toLowerCase())) n = g.name + ' ' + (k++);
      taken.add(n.toLowerCase());
      g.name = n;
      g.rev = FM.workspaceUtil.nextRev();
    });
    // one compensation for the workspace: the file's matrix, else the FCS files' own
    let active = null;
    const used = r.matrices.filter(m => r.comps.indexOf(m.gmlId) >= 0);
    if (used.length) {
      active = used[0].id;
      if (used.length > 1) r.warnings.push('The file uses ' + used.length + ' matrices; FlowMate applies one to the whole workspace (' + used[0].name + ').');
    } else if (r.comps.indexOf('FCS') >= 0) active = 'file';
    else if (r.comps.length && ws.samples.some(s => s.spill)) active = 'none';
    if (r.comps.indexOf('uncompensated') >= 0 && active && active !== 'none' && r.comps.length > 1)
      r.warnings.push('Some dimensions are uncompensated and others compensated; FlowMate evaluates every gate with one compensation, so check fluorescence gates.');
    ws.update('Import Gating-ML (' + r.gates.length + ' gates)', d => {
      d.comp = d.comp || FM.comp.defaultComp();
      r.matrices.forEach(m => d.comp.matrices.push({ id: m.id, name: m.name, params: m.params, spill: m.spill, source: 'gatingml' }));
      if (active) d.comp.active = active;
      r.gates.forEach(g => d.gates.push(g));
    }, { kind: 'gates' });
    return { gates: r.gates.length, warnings: r.warnings, skipped: r.skipped, ids: r.ids, compensation: active };
  }

  // ---------------------------------------------------------------- export
  const GML_NS = 'http://www.isac-net.org/std/Gating-ML/v2.0/gating';
  const TR_NS = 'http://www.isac-net.org/std/Gating-ML/v2.0/transformations';
  const DT_NS = 'http://www.isac-net.org/std/Gating-ML/v2.0/datatypes';

  /** A FlowMate scale as a Gating-ML transformation element, or null when linear (data space). */
  function transformXML(spec) {
    const f = v => String(+(+v).toPrecision(15));
    if (!spec || spec.type === 'lin') return null;
    if (spec.type === 'log') return '<transforms:flog transforms:T="' + f(spec.max) + '" transforms:M="' + f(Math.log10(spec.max / spec.min)) + '" />';
    if (spec.type === 'hyperlog') return '<transforms:hyperlog transforms:T="' + f(spec.T) + '" transforms:W="' + f(spec.W) + '" transforms:M="' + f(spec.M) + '" transforms:A="' + f(spec.A || 0) + '" />';
    if (spec.type === 'logicle') return '<transforms:logicle transforms:T="' + f(spec.T) + '" transforms:W="' + f(spec.W) + '" transforms:M="' + f(spec.M) + '" transforms:A="' + f(spec.A || 0) + '" />';
    if (spec.type === 'asinh') {
      const c = spec.cofactor;
      return '<transforms:fasinh transforms:T="' + f(spec.max) + '" transforms:M="' + f(Math.asinh(spec.max / c) / Math.LN10) + '" transforms:A="' + f(-Math.asinh(spec.min / c) / Math.LN10) + '" />';
    }
    return undefined;   // biex: no Gating-ML equivalent
  }

  function exportXML(ws) {
    const x = X(), t = T(), e = x.esc;
    const f = v => String(+(+v).toPrecision(12));
    const warnings = [];
    const comp = ws.doc.comp || FM.comp.defaultComp();
    const mat = comp.active !== 'file' && comp.active !== 'none' ? FM.comp.matrixById(ws, comp.active) : null;
    const compRef = p => {
      if (comp.active === 'none') return 'uncompensated';
      if (mat) return mat.params.indexOf(p) >= 0 ? 'M_' + mat.id : 'uncompensated';
      return ws.samples.some(s => s.spill && s.spill.params.indexOf(p) >= 0) ? 'FCS' : 'uncompensated';
    };
    // ids: Gating-ML ids are NCNames; the FlowMate name travels in custom_info
    const ids = new Map(), used = new Set();
    ws.doc.gates.forEach(g => {
      let base = String(g.name).replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^([^A-Za-z_])/, 'G_$1') || 'Gate';
      let id = base, k = 2;
      while (used.has(id)) id = base + '_' + (k++);
      used.add(id); ids.set(g.id, id);
    });
    const xforms = new Map();
    const xformRef = spec => {
      const body = transformXML(spec);
      if (body == null) return null;
      if (body === undefined) return undefined;
      if (!xforms.has(body)) xforms.set(body, 'T' + (xforms.size + 1));
      return xforms.get(body);
    };
    const info = g => '<data-type:custom_info>flowmate-name: ' + e(g.name) + '</data-type:custom_info>';
    const parentAttr = g => (g.parent ? ' gating:parent_id="' + e(ids.get(g.parent)) + '"' : '');
    const dimXML = (p, tref, extra) => '<gating:dimension gating:compensation-ref="' + e(compRef(p)) + '"' + (tref ? ' gating:transformation-ref="' + tref + '"' : '') + (extra || '') +
      '><data-type:fcs-dimension data-type:name="' + e(p) + '" /></gating:dimension>';
    const bound = (lo, hi) => (lo != null && Number.isFinite(lo) ? ' gating:min="' + f(lo) + '"' : '') + (hi != null && Number.isFinite(hi) ? ' gating:max="' + f(hi) + '"' : '');
    const out = [];
    const doneLinks = new Set();
    if (ws.doc.gates.some(g => g.perWell && Object.keys(g.perWell).length)) warnings.push('Per-sample adjustments are not part of Gating-ML; the shared gates were exported.');
    if (ws.doc.gates.some(g => FM.scope.isScoped(g))) warnings.push('Gating-ML has no groups; gates applied to some groups were exported as applying to every sample.');

    ws.doc.gates.forEach(g => {
      const id = ids.get(g.id);
      if (g.type === 'bool') {
        const terms = g.bool.terms;
        if (terms.length === 1 && terms[0].not) {
          out.push('<gating:BooleanGate gating:id="' + e(id) + '"' + parentAttr(g) + '>' + info(g) + '<gating:not><gating:gateReference gating:ref="' + e(ids.get(terms[0].id)) + '" /></gating:not></gating:BooleanGate>');
        } else {
          const op = g.bool.op === 'or' ? 'or' : 'and';
          out.push('<gating:BooleanGate gating:id="' + e(id) + '"' + parentAttr(g) + '>' + info(g) + '<gating:' + op + '>' +
            terms.map(tm => '<gating:gateReference gating:ref="' + e(ids.get(tm.id)) + '"' + (tm.not ? ' gating:use-as-complement="true"' : '') + ' />').join('') + '</gating:' + op + '></gating:BooleanGate>');
        }
        return;
      }
      let shapeId = id, shapeParent = parentAttr(g);
      if (g.outside) {
        // Gating-ML has no "outside" shape: the shape, then NOT of it under the same parent
        shapeId = id + '_shape';
        out.push('<gating:BooleanGate gating:id="' + e(id) + '"' + parentAttr(g) + '>' + info(g) + '<gating:not><gating:gateReference gating:ref="' + e(shapeId) + '" /></gating:not></gating:BooleanGate>');
        shapeParent = '';
      }
      const extraDims = (g.extra || []).map(c => dimXML(c.p, null, bound(c.lo, c.hi))).join('');
      if (g.type === 'range') {
        const lo = g.range.lo, hi = g.range.hi;
        const a = lo != null && hi != null ? Math.min(lo, hi) : lo, b = lo != null && hi != null ? Math.max(lo, hi) : hi;
        out.push('<gating:RectangleGate gating:id="' + e(shapeId) + '"' + shapeParent + '>' + info(g) + dimXML(g.x, null, bound(a, b)) + extraDims + '</gating:RectangleGate>');
      } else if (g.type === 'rect') {
        const r = g.rect;
        const [x0, x1] = FM.gating.span(r.x0, r.x1), [y0, y1] = FM.gating.span(r.y0, r.y1);
        out.push('<gating:RectangleGate gating:id="' + e(shapeId) + '"' + shapeParent + '>' + info(g) + dimXML(g.x, null, bound(x0, x1)) + dimXML(g.y, null, bound(y0, y1)) + extraDims + '</gating:RectangleGate>');
      } else if (g.type === 'quad') {
        if (doneLinks.has(g.link)) return;
        doneLinks.add(g.link);
        const set = ws.doc.gates.filter(q => q.link === g.link);
        out.push('<gating:QuadrantGate gating:id="' + e(id + '_q') + '"' + parentAttr(g) + '>' +
          '<gating:divider gating:id="' + e(id + '_dx') + '" gating:compensation-ref="' + e(compRef(g.x)) + '"><data-type:fcs-dimension data-type:name="' + e(g.x) + '" /><gating:value>' + f(g.quad.cx) + '</gating:value></gating:divider>' +
          '<gating:divider gating:id="' + e(id + '_dy') + '" gating:compensation-ref="' + e(compRef(g.y)) + '"><data-type:fcs-dimension data-type:name="' + e(g.y) + '" /><gating:value>' + f(g.quad.cy) + '</gating:value></gating:divider>' +
          set.map(q => {
            const right = q.corner === 'UR' || q.corner === 'LR', upper = q.corner === 'UR' || q.corner === 'UL';
            // a location strictly inside the quadrant, away from the divider
            const lx = right ? q.quad.cx + Math.abs(q.quad.cx || 1) + 1 : q.quad.cx - Math.abs(q.quad.cx || 1) - 1;
            const ly = upper ? q.quad.cy + Math.abs(q.quad.cy || 1) + 1 : q.quad.cy - Math.abs(q.quad.cy || 1) - 1;
            return '<gating:Quadrant gating:id="' + e(ids.get(q.id)) + '">' + info(q) +
              '<gating:position gating:divider_ref="' + e(id + '_dx') + '" gating:location="' + f(lx) + '" />' +
              '<gating:position gating:divider_ref="' + e(id + '_dy') + '" gating:location="' + f(ly) + '" /></gating:Quadrant>';
          }).join('') + '</gating:QuadrantGate>');
      } else if (g.type === 'polygon' || g.type === 'ellipse') {
        let tx = xformRef(g.xScale), ty = xformRef(g.yScale);
        let gg = g, verts = g.verts;
        if (tx === undefined || ty === undefined) {
          // no Gating-ML equivalent for this axis (biex): write the outline densely in data space
          warnings.push(g.name + ' is on a FlowJo biex axis, which Gating-ML cannot describe; it was written as a dense polygon.');
          const xs = t.makeScale(g.xScale), ys = t.makeScale(g.yScale);
          const disp = g.type === 'ellipse' ? FM.gating.ellipsePoints(g, 96) : densify(FM.gating.displayVerts(g), 24);
          verts = disp.map(p => [xs.inv(p[0]), ys.inv(p[1])]);
          gg = Object.assign({}, g, { type: 'polygon' });
          tx = ty = null;
        }
        const xs = t.makeScale(g.xScale), ys = t.makeScale(g.yScale);
        const cx = v => (tx ? xs.fwd(v) : v), cy = v => (ty ? ys.fwd(v) : v);
        if (gg.type === 'polygon') {
          out.push('<gating:PolygonGate gating:id="' + e(shapeId) + '"' + shapeParent + '>' + info(g) + dimXML(g.x, tx) + dimXML(g.y, ty) +
            verts.map(v => '<gating:vertex><gating:coordinate data-type:value="' + f(cx(v[0])) + '" /><gating:coordinate data-type:value="' + f(cy(v[1])) + '" /></gating:vertex>').join('') + '</gating:PolygonGate>');
        } else {
          // display-space ellipse → covariance (distance² = 1) in each dimension's own space
          const d = FM.gating.ellipseDisplay(g);
          const sx = tx ? 1 : (g.xScale.max - g.xScale.min) || 1, sy = ty ? 1 : (g.yScale.max - g.yScale.min) || 1;
          const c = Math.cos(d.angle), s = Math.sin(d.angle);
          const a = d.rx * d.rx * c * c + d.ry * d.ry * s * s, b = (d.rx * d.rx - d.ry * d.ry) * c * s, cc = d.rx * d.rx * s * s + d.ry * d.ry * c * c;
          const mx = tx ? d.tcx : g.ellipse.cx, my = ty ? d.tcy : g.ellipse.cy;
          out.push('<gating:EllipsoidGate gating:id="' + e(shapeId) + '"' + shapeParent + '>' + info(g) + dimXML(g.x, tx) + dimXML(g.y, ty) +
            '<gating:mean><gating:coordinate data-type:value="' + f(mx) + '" /><gating:coordinate data-type:value="' + f(my) + '" /></gating:mean>' +
            '<gating:covarianceMatrix><gating:row><gating:entry data-type:value="' + f(a * sx * sx) + '" /><gating:entry data-type:value="' + f(b * sx * sy) + '" /></gating:row>' +
            '<gating:row><gating:entry data-type:value="' + f(b * sx * sy) + '" /><gating:entry data-type:value="' + f(cc * sy * sy) + '" /></gating:row></gating:covarianceMatrix>' +
            '<gating:distanceSquare data-type:value="1" /></gating:EllipsoidGate>');
        }
      }
    });

    const head = [];
    if (mat) {
      head.push('<transforms:spectrumMatrix transforms:id="' + e('M_' + mat.id) + '">' +
        '<transforms:fluorochromes>' + mat.params.map(p => '<data-type:fcs-dimension data-type:name="' + e(p) + '" />').join('') + '</transforms:fluorochromes>' +
        '<transforms:detectors>' + mat.params.map(p => '<data-type:fcs-dimension data-type:name="' + e(p) + '" />').join('') + '</transforms:detectors>' +
        mat.spill.map(row => '<transforms:spectrum>' + row.map(v => '<transforms:coefficient transforms:value="' + f(v) + '" />').join('') + '</transforms:spectrum>').join('') +
        '</transforms:spectrumMatrix>');
    }
    xforms.forEach((tid, body) => head.push('<transforms:transformation transforms:id="' + tid + '">' + body + '</transforms:transformation>'));
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<gating:Gating-ML xmlns:gating="' + GML_NS + '" xmlns:transforms="' + TR_NS + '" xmlns:data-type="' + DT_NS + '">\n' +
      '<data-type:custom_info>Exported from ' + e(FM.appName || 'FlowMate') + ' ' + e(FM.version) + ' · ' + e(ws.doc.name) + '</data-type:custom_info>\n' +
      head.concat(out).join('\n') + '\n</gating:Gating-ML>\n';
    return { xml, warnings };
  }

  /** Points along each polygon edge (display units), so a curve survives a change of space. */
  function densify(pts, per) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      for (let s = 0; s < per; s++) out.push([a[0] + (b[0] - a[0]) * s / per, a[1] + (b[1] - a[1]) * s / per]);
    }
    return out;
  }

  FM.gatingml = { parse, importInto, export: exportXML, ellipseFrom };
})(FM);
