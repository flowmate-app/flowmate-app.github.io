/* FlowJo 10 workspace (.wsp) import.
 *
 * A FlowJo workspace keeps one gate tree per sample (SampleNode/Subpopulations), its groups
 * (GroupNode/Group/SampleRefs), each sample's transforms and spillover matrix, and — usefully —
 * the event count FlowJo itself computed for every population. Import turns that into one
 * FlowMate gate tree:
 *
 *   - a population path ("Time/Singlets/CD3+") that several samples share becomes one gate;
 *     its geometry is the one most samples use, and a sample that differs keeps its own
 *     geometry as a per-sample adjustment (marked ✦ like every hand adjustment)
 *   - a path only some samples have is scoped to them (or to their group when it is exactly
 *     a FlowJo group)
 *   - transforms become the gates' display scales (linear, log, logicle, biex, arcsinh — biex
 *     through FlowJo's own lookup table), so polygons are evaluated where they were drawn
 *   - "Comp-" parameters read the workspace's compensation
 *   - ellipses, stored by FlowJo as foci and edge points in 256-bin display space, become
 *     ellipses; eventsInside="0" becomes an "outside" gate; And/Or/Not nodes become Boolean gates
 *
 * Three FlowJo conventions are followed (found by the external QA, tests/external_qa/REPORT.md):
 *   - FlowJo writes "/" in a channel name as "_" ("LIVE/DEAD Aqua-A" → "LIVE_DEAD Aqua-A"):
 *     every name in the workspace is mapped back to the loaded files' channel names
 *   - rectangle and range gates are tested on the axis (display) scale, where events below the
 *     axis floor sit on the floor: an edge at or below the floor is open
 *   - a gate on a channel without the "Comp-" prefix was drawn on uncompensated data and is
 *     evaluated there (gate.uncomp)
 *
 * The report compares every population's FlowMate count with FlowJo's, sample by sample.
 * Parsing follows FlowKit's (BSD-3) reading of the format.
 */
(function (FM) {
  'use strict';
  const X = () => FM.xml, T = () => FM.transforms;
  const SEP = '\u0001';

  // ----------------------------------------------------------------- parse
  function parse(text) {
    const x = X();
    const doc = x.parse(text);
    const root = doc.documentElement;
    if (x.local(root) !== 'Workspace') throw new Error('This is not a FlowJo workspace (its root element is ' + x.local(root) + ').');
    const warnings = [];
    const version = x.attr(root, 'flowJoVersion') || x.attr(root, 'version') || '';

    // groups: name → [sampleID]
    const groups = [];
    x.kids(x.kid(root, 'Groups'), 'GroupNode').forEach(gn => {
      const name = x.attr(gn, 'name');
      const refs = x.all(gn, 'SampleRef').map(r => x.attr(r, 'sampleID'));
      groups.push({ name, sampleIds: Array.from(new Set(refs)) });
    });

    const samples = [];
    x.kids(x.kid(root, 'SampleList'), 'Sample').forEach(se => {
      const ds = x.kid(se, 'DataSet');
      const node = x.kid(se, 'SampleNode');
      if (!node) return;
      const id = x.attr(node, 'sampleID') || (ds && x.attr(ds, 'sampleID'));
      const uri = ds ? x.attr(ds, 'uri') || '' : '';
      const keywords = {};
      x.kids(x.kid(se, 'Keywords'), 'Keyword').forEach(k => { keywords[x.attr(k, 'name')] = x.attr(k, 'value'); });
      const transforms = {};
      x.kids(x.kid(se, 'Transformations')).forEach(tel => {
        const p = x.all(tel, 'parameter')[0];
        if (!p) return;
        try { transforms[x.attr(p, 'name')] = T().fromFlowJo({ type: x.local(tel), attrs: x.attrs(tel) }); }
        catch (err) { warnings.push(err.message + ' (' + x.attr(p, 'name') + ')'); }
      });
      const comp = parseMatrix(se);
      const file = decodeURIComponent(uri.replace(/^file:\/*/, '').split(/[\\/]/).pop() || '') || x.attr(node, 'name');
      const pops = [];
      walk(x.kid(node, 'Subpopulations'), [], pops, comp, warnings);
      samples.push({ id, file, name: x.attr(node, 'name'), uri, count: parseInt(x.attr(node, 'count'), 10), keywords, transforms, comp, pops });
    });
    return { version, groups, samples, warnings };
  }

  /** The sample's spillover matrix: { name, prefix, suffix, params (detectors), spill } or null. */
  function parseMatrix(sampleEl) {
    const x = X();
    const m = x.all(sampleEl, 'spilloverMatrix')[0];
    if (!m) return null;
    const detectors = x.all(x.kid(m, 'parameters'), 'parameter').map(p => x.attr(p, 'name'));
    const rows = {};
    x.kids(m, 'spillover').forEach(sp => {
      const r = {};
      x.kids(sp, 'coefficient').forEach(c => { r[x.attr(c, 'parameter')] = parseFloat(x.attr(c, 'value')); });
      rows[x.attr(sp, 'parameter')] = r;
    });
    const spill = detectors.map(a => detectors.map(b => { const v = rows[a] && rows[a][b]; return Number.isFinite(v) ? v : (a === b ? 1 : 0); }));
    return { name: x.attr(m, 'name') || 'FlowJo matrix', prefix: x.attr(m, 'prefix') || 'Comp-', suffix: x.attr(m, 'suffix') || '', params: detectors, spill };
  }

  /** Strip FlowJo's compensation prefix/suffix: "Comp-FITC-A" → "FITC-A". */
  function bareName(name, comp) {
    let n = name;
    if (comp) {
      if (comp.prefix && n.indexOf(comp.prefix) === 0) n = n.slice(comp.prefix.length);
      if (comp.suffix && n.length > comp.suffix.length && n.slice(-comp.suffix.length) === comp.suffix) n = n.slice(0, -comp.suffix.length);
    } else if (/^Comp-/.test(n)) n = n.slice(5);
    return n;
  }

  /** Depth-first over Population / AndNode / OrNode / NotNode, collecting raw nodes. */
  function walk(subpop, path, out, comp, warnings) {
    const x = X();
    if (!subpop) return;
    x.kids(subpop).forEach(el => {
      const kind = x.local(el);
      if (['Population', 'AndNode', 'OrNode', 'NotNode'].indexOf(kind) < 0) return;
      const name = x.attr(el, 'name');
      const here = path.concat([name]);
      const count = parseInt(x.attr(el, 'count'), 10);
      let gate = null;
      if (kind === 'Population') {
        const g = x.kid(el, 'Gate');
        const shape = g && g.children[0];
        if (!shape) { warnings.push(here.join('/') + ' has no gate; skipped.'); return; }
        gate = shapeOf(shape, comp, here.join('/'), warnings);
        if (!gate) return;
      } else {
        const deps = x.all(x.kid(el, 'Dependents'), 'Dependent').map(d => x.attr(d, 'name'));
        gate = { type: 'bool', op: kind === 'OrNode' ? 'or' : 'and', not: kind === 'NotNode', deps };
      }
      out.push({ path: here, name, count, gate });
      walk(x.kid(el, 'Subpopulations'), here, out, comp, warnings);
    });
  }

  /** A FlowJo gate element → a raw shape: { type, dims: [name], …geometry in data / 256-bin units }. */
  function shapeOf(el, comp, where, warnings) {
    const x = X();
    const kind = x.local(el);
    const outside = x.attr(el, 'eventsInside') === '0';
    const dims = x.kids(el, 'dimension').map(d => {
      const fd = x.kid(d, 'fcs-dimension');
      return { name: fd ? bareName(x.attr(fd, 'name'), comp) : null, comped: !!(fd && comp && x.attr(fd, 'name') !== bareName(x.attr(fd, 'name'), comp)),
        min: x.num(x.attr(d, 'min')), max: x.num(x.attr(d, 'max')) };
    });
    if (dims.some(d => !d.name)) { warnings.push(where + ': a dimension FlowMate cannot read; skipped.'); return null; }
    const coords = v => x.kids(v, 'coordinate').map(c => parseFloat(x.attr(c, 'value')));
    if (kind === 'PolygonGate') return { type: 'polygon', dims, outside, verts: x.kids(el, 'vertex').map(coords) };
    if (kind === 'RectangleGate') return { type: 'rect', dims, outside };
    if (kind === 'EllipsoidGate') {
      return { type: 'ellipse', dims, outside, foci: x.kids(x.kid(el, 'foci'), 'vertex').map(coords), edge: x.kids(x.kid(el, 'edge'), 'vertex').map(coords) };
    }
    warnings.push(where + ': FlowJo ' + kind + ' gates are not supported; skipped.');
    return null;
  }

  // ------------------------------------------------------------- convert
  /**
   * FlowJo ellipse (foci + 4 edge points, 256 bins of display space) → FlowMate ellipse in
   * display units, the way FlowKit reads it: the foci give the centre and rotation, the edge
   * points the major half-axis, and the minor one follows from the focal distance.
   */
  function ellipseFromFlowJo(foci, edge) {
    const f = foci.map(p => [p[0] / 256, p[1] / 256]);
    const e = edge.map(p => [p[0] / 256, p[1] / 256]);
    const c = [(f[0][0] + f[1][0]) / 2, (f[0][1] + f[1][1]) / 2];
    const dxf = f[1][0] - f[0][0];
    const theta = Math.atan(dxf === 0 ? Infinity : (f[1][1] - f[0][1]) / dxf);
    const cs = Math.cos(theta), sn = Math.sin(theta);
    const rot = p => { const u = p[0] - c[0], v = p[1] - c[1]; return [u * cs + v * sn, -u * sn + v * cs]; };
    const fr = rot(f[0]);
    const r1 = rot(e[0]).map(Math.abs), r3 = rot(e[2]).map(Math.abs);
    const p1 = r1[0] >= r1[1] ? 0 : 1, p3 = r3[0] >= r3[1] ? 0 : 1;
    const a = Math.max(r1[p1], r3[p3]);
    const b = Math.sqrt(Math.abs(fr[0] * fr[0] - a * a));
    // FlowKit: if the first edge point lies on the rotated x axis, a runs along the foci
    return p1 === 0 ? { tcx: c[0], tcy: c[1], rx: a, ry: b, angle: theta } : { tcx: c[0], tcy: c[1], rx: b, ry: a, angle: theta };
  }

  /** A raw node + the sample's transforms → a FlowMate gate body (no id/parent/name yet). */
  function toGate(node, sample, rangeOf) {
    const g = node.gate;
    if (g.type === 'bool') return { type: 'bool', x: null, y: null, xScale: null, yScale: null };
    const pre = sample.comp ? sample.comp.prefix : 'Comp-', suf = sample.comp ? sample.comp.suffix : '';
    const fallback = name => ({ type: 'lin', min: 0, max: (rangeOf && rangeOf(name)) || 262144 });
    const scaleOf = dim => (dim.comped ? sample.transforms[pre + dim.name + suf] || sample.transforms[dim.name] : sample.transforms[dim.name] || sample.transforms[pre + dim.name + suf]) || fallback(dim.name);
    const d = g.dims;
    const out = { outside: g.outside || undefined };
    // FlowJo tests rectangles and ranges on the axis, where every event below the axis floor is
    // drawn on the floor: an edge at or below the floor takes them all in (FlowJo, and FlowKit)
    const floor = (v, dim) => (v != null && Number.isFinite(v) && T().makeScale(scaleOf(dim)).fwd(v) <= 0 ? null : v);
    if (g.type === 'rect') {
      out.openMax = true;
      if (d.length === 1) Object.assign(out, { type: 'range', x: d[0].name, y: null, xScale: scaleOf(d[0]), yScale: null, range: { lo: floor(d[0].min, d[0]), hi: d[0].max } });
      else {
        Object.assign(out, { type: 'rect', x: d[0].name, y: d[1].name, xScale: scaleOf(d[0]), yScale: scaleOf(d[1]),
          rect: { x0: floor(d[0].min, d[0]), x1: d[0].max, y0: floor(d[1].min, d[1]), y1: d[1].max } });
        if (d.length > 2) out.extra = d.slice(2).map(k => ({ p: k.name, lo: k.min, hi: k.max }));
      }
    } else if (g.type === 'polygon') {
      Object.assign(out, { type: 'polygon', x: d[0].name, y: d[1].name, xScale: scaleOf(d[0]), yScale: scaleOf(d[1]), verts: g.verts.map(v => [v[0], v[1]]) });
    } else if (g.type === 'ellipse') {
      const xs = scaleOf(d[0]), ys = scaleOf(d[1]);
      const el = ellipseFromFlowJo(g.foci, g.edge);
      Object.assign(out, { type: 'ellipse', x: d[0].name, y: d[1].name, xScale: xs, yScale: ys,
        ellipse: { cx: T().makeScale(xs).inv(el.tcx), cy: T().makeScale(ys).inv(el.tcy), rx: el.rx, ry: el.ry, angle: el.angle } });
    }
    if (!out.outside) delete out.outside;
    // drawn on a channel without FlowJo's "Comp-" prefix while the sample has a matrix: FlowJo
    // evaluated it on the uncompensated values (typical for compensation controls)
    if (sample.comp) {
      const raw = ['x', 'y'].filter((a, i) => d[i] && !d[i].comped && sample.comp.params.indexOf(d[i].name) >= 0);
      if (raw.length) out.uncomp = raw;
    }
    return out;
  }

  const GEOM_KEYS = ['verts', 'rect', 'range', 'ellipse'];
  const round = v => (typeof v === 'number' ? +v.toPrecision(10) : Array.isArray(v) ? v.map(round) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, w]) => [k, round(w)])) : v);
  /* Polygons and ellipses are evaluated in their display space, so their scales are part of
   * the geometry; rectangles and ranges are evaluated in data units, where the scale only
   * decides how they are drawn. */
  const scaled = g => g.type === 'polygon' || g.type === 'ellipse';
  const geomKey = g => JSON.stringify(GEOM_KEYS.filter(k => g[k] !== undefined).map(k => [k, round(g[k])])
    .concat([['outside', !!g.outside], ['extra', round(g.extra || null)], ['uncomp', g.uncomp || null]])
    .concat(scaled(g) ? [['scales', T().specKey(g.xScale), T().specKey(g.yScale)]] : []));
  const shapeKey = g => JSON.stringify([g.type, g.x, g.y, g.uncomp || null]);

  /**
   * The loaded files' name for a channel the workspace names: itself when the files have it,
   * else the file channel FlowJo rewrote ("/" → "_"). Unknown names are returned unchanged.
   */
  function channelResolver(names) {
    const have = new Set(names);
    const flowjoForm = new Map();
    names.forEach(n => { const f = n.replace(/\//g, '_'); if (f !== n && !have.has(f)) flowjoForm.set(f, n); });
    const fix = n => (n == null || have.has(n) ? n : flowjoForm.get(n) || n);
    fix.renamed = () => Array.from(flowjoForm.values());
    return fix;
  }

  /** The parsed workspace with every channel name mapped to the loaded files' names. */
  function resolveChannels(parsed, fix) {
    const prefixed = (n, comp) => {
      const pre = comp ? comp.prefix : 'Comp-', suf = comp ? comp.suffix : '';
      const bare = bareName(n, comp);
      return bare !== n ? pre + fix(bare) + suf : fix(n);
    };
    parsed.samples.forEach(ps => {
      if (ps.comp) ps.comp.params = ps.comp.params.map(fix);
      const t = {};
      Object.keys(ps.transforms).forEach(k => { t[prefixed(k, ps.comp)] = ps.transforms[k]; });
      ps.transforms = t;
      ps.pops.forEach(n => { if (n.gate && n.gate.dims) n.gate.dims.forEach(d => { d.name = fix(d.name); }); });
    });
    return parsed;
  }

  /** Match workspace samples to loaded ones by file name, then by $FIL. */
  function matchSamples(ws, parsed) {
    const byName = new Map(ws.samples.map(s => [String(s.name).toLowerCase(), s]));
    return parsed.samples.map(ps => {
      const cands = [ps.file, ps.name, ps.keywords.$FIL].filter(Boolean).map(v => String(v).toLowerCase());
      const s = cands.map(c => byName.get(c)).find(Boolean) || null;
      return { ps, s };
    });
  }

  /**
   * Import into the workspace (one undo step). Samples are matched by file name; those not
   * loaded are listed in report.missing — load their FCS files and import again to include them.
   */
  function importInto(ws, text, opts) {
    opts = opts || {};
    const parsed = resolveChannels(typeof text === 'string' ? parse(text) : text, channelResolver(ws.paramNames()));
    const warnings = parsed.warnings.slice();
    const pairs = matchSamples(ws, parsed);
    const matched = pairs.filter(p => p.s);
    const missing = pairs.filter(p => !p.s).map(p => p.ps.file);
    if (!matched.length) {
      return { matched: [], missing, gates: 0, groups: 0, warnings: warnings.concat(['None of the workspace’s samples are loaded. Load their FCS files, then import the workspace again.']), compare: [], compensation: null };
    }
    const rangeOf = p => { const i = ws.paramInfo(p); return i && i.range; };

    // ---- compensation: the files' own matrices when FlowJo used them, else the workspace's
    const mats = [];
    let allFile = true;
    matched.forEach(({ ps, s }) => {
      if (!ps.comp) return;
      const sameAsFile = s.spill && s.spill.params.length === ps.comp.params.length && ps.comp.params.every((p, i) => s.spill.params[i] === p) &&
        ps.comp.spill.every((row, i) => row.every((v, j) => Math.abs(v - s.spill.matrix[i][j]) < 1e-6));
      if (!sameAsFile) allFile = false;
      const key = JSON.stringify([ps.comp.params, round(ps.comp.spill)]);
      if (!mats.some(m => m.key === key)) mats.push({ key, comp: ps.comp });
    });
    let compActive = null, newMatrix = null;
    if (mats.length) {
      if (allFile) compActive = 'file';
      else {
        newMatrix = { id: FM.workspaceUtil.uid('cm'), name: mats[0].comp.name + ' (FlowJo)', params: mats[0].comp.params.slice(), spill: mats[0].comp.spill.map(r => r.slice()), source: 'imported' };
        compActive = newMatrix.id;
        if (mats.length > 1) warnings.push('Samples use ' + mats.length + ' different matrices in FlowJo; FlowMate applies one per workspace (' + newMatrix.name + ').');
      }
    }

    // ---- groups (one per sample in FlowMate: the first FlowJo group that lists it)
    const flowjoGroups = parsed.groups.filter(g => g.name !== 'All Samples' && g.sampleIds.length);
    const sampleGroup = {};
    const multi = [];
    matched.forEach(({ ps }) => {
      const gs = flowjoGroups.filter(g => g.sampleIds.indexOf(ps.id) >= 0);
      if (gs.length) sampleGroup[ps.id] = gs[0].name;
      if (gs.length > 1) multi.push(ps.file + ' (' + gs.map(g => g.name).join(', ') + ')');
    });
    if (multi.length) warnings.push('In FlowMate a sample belongs to one group; these were in several and joined the first: ' + multi.join('; ') + '.');

    // ---- unify the per-sample trees by population path
    const byPath = new Map();     // key → { path, name, entries: [{ s, node, gate }] }
    const order = [];
    matched.forEach(({ ps, s }) => {
      ps.pops.forEach(node => {
        const key = node.path.join(SEP);
        let e = byPath.get(key);
        if (!e) { e = { path: node.path, name: node.name, entries: [] }; byPath.set(key, e); order.push(key); }
        e.entries.push({ s, ps, node, gate: toGate(node, ps, rangeOf) });
      });
    });

    const created = [];             // FlowMate gates to add
    const idOf = new Map();         // path key → gate id
    const taken = new Set(ws.doc.gates.map(g => g.name.toLowerCase()));
    const uniq = (name, parentName) => {
      let n = name;
      if (taken.has(n.toLowerCase()) && parentName) n = name + ' (' + parentName + ')';
      let k = 2;
      while (taken.has(n.toLowerCase())) n = name + ' ' + (k++);
      taken.add(n.toLowerCase());
      return n;
    };
    const mismatched = [];
    order.forEach(key => {
      const e = byPath.get(key);
      const parentKey = e.path.slice(0, -1).join(SEP);
      const parentId = e.path.length > 1 ? idOf.get(parentKey) : null;
      if (e.path.length > 1 && !parentId) return;    // its parent was skipped
      const first = e.entries[0].gate;
      // the shape everyone agrees on (type, axes, scales); a sample drawn differently is listed
      const compatible = e.entries.filter(x => shapeKey(x.gate) === shapeKey(first));
      if (compatible.length < e.entries.length) mismatched.push(e.path.join('/'));
      const tally = new Map();
      compatible.forEach(x => { const k = geomKey(x.gate); tally.set(k, (tally.get(k) || 0) + 1); });
      const common = Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0][0];
      const base = compatible.find(x => geomKey(x.gate) === common).gate;
      const gate = Object.assign({ id: FM.workspaceUtil.uid('g'), name: uniq(e.name, e.path.length > 1 ? e.path[e.path.length - 2] : null), parent: parentId, color: null, rev: FM.workspaceUtil.nextRev() }, JSON.parse(JSON.stringify(base)));
      if (first.type === 'bool') {
        const n = e.entries[0].node.gate;
        gate.bool = { op: n.op, terms: n.deps.map(dp => ({ path: dp, not: n.not })) };
      } else {
        const field = FM.gating.GEOM[gate.type];
        compatible.forEach(x => {
          if (geomKey(x.gate) === common || !field) return;
          gate.perWell = gate.perWell || {};
          const o = { [field]: JSON.parse(JSON.stringify(x.gate[field])), rev: FM.workspaceUtil.nextRev() };
          if (scaled(gate) && T().specKey(x.gate.xScale) !== T().specKey(gate.xScale)) o.xScale = x.gate.xScale;
          if (scaled(gate) && T().specKey(x.gate.yScale) !== T().specKey(gate.yScale)) o.yScale = x.gate.yScale;
          gate.perWell[x.s.key] = o;
          if (!!x.gate.outside !== !!gate.outside) warnings.push(e.path.join('/') + ' keeps inside on some samples and outside on others; FlowMate uses ' + (gate.outside ? 'outside' : 'inside') + '.');
        });
      }
      // scope: the samples that have this population (all of them → no scope)
      const have = new Set(compatible.map(x => x.s.key));
      if (have.size < matched.length) {
        const haveIds = new Set(compatible.map(x => x.ps.id));
        const exactGroup = flowjoGroups.find(g => g.sampleIds.length === haveIds.size && g.sampleIds.every(i => haveIds.has(i)) && matched.filter(p => g.sampleIds.indexOf(p.ps.id) >= 0).every(p => sampleGroup[p.ps.id] === g.name));
        gate.scope = exactGroup ? { groupName: exactGroup.name } : { samples: Array.from(have) };
      }
      gate._path = key;
      idOf.set(key, gate.id);
      created.push(gate);
    });
    if (mismatched.length) warnings.push('Drawn on different parameters in different samples (FlowMate used the first sample’s): ' + mismatched.slice(0, 6).join(', ') + (mismatched.length > 6 ? '…' : '') + '.');

    // Boolean terms are paths relative to the root ("Time/Singlets/CD4+/IFNg+")
    created.forEach(g => {
      if (g.type !== 'bool') return;
      const terms = [];
      g.bool.terms.forEach(t => {
        const id = idOf.get(t.path.split('/').join(SEP));
        if (id) terms.push({ id, not: t.not }); else warnings.push(g.name + ': refers to ' + t.path + ', which was not imported.');
      });
      g.bool = { op: g.bool.op, terms };
    });

    // ---- one undo step: groups, assignments, comp, axes, gates
    ws.update('Import FlowJo workspace', d => {
      const groupId = {};
      flowjoGroups.forEach(fg => {
        if (!matched.some(p => sampleGroup[p.ps.id] === fg.name)) return;
        let g = d.groups.find(x => x.name.toLowerCase() === fg.name.toLowerCase());
        if (!g) {
          const used = new Set(d.groups.map(x => x.color));
          const C = FM.workspaceUtil.GROUP_COLORS;
          g = { id: FM.workspaceUtil.uid('grp'), name: fg.name, color: C.find(c => !used.has(c)) || C[d.groups.length % C.length], role: /^comp/i.test(fg.name) ? 'comp' : 'sample' };
          d.groups.push(g);
        }
        groupId[fg.name] = g.id;
      });
      matched.forEach(({ ps, s }) => {
        if (!sampleGroup[ps.id]) return;
        d.wells[s.key] = Object.assign({ excluded: false, reason: '' }, d.wells[s.key], { group: groupId[sampleGroup[ps.id]] });
      });
      if (newMatrix) d.comp.matrices.push(newMatrix);
      if (compActive) d.comp.active = compActive;
      // FlowJo's axes become the parameters' default scales, so plots look as they did there
      const firstT = matched[0].ps.transforms;
      Object.keys(firstT).forEach(p => {
        const name = bareName(p, matched[0].ps.comp);
        if (!ws.paramNames().includes(name)) return;
        d.params[name] = Object.assign({}, d.params[name], { scale: firstT[p] });
        Object.values(d.views).forEach(v => { if (v && v.ranges) delete v.ranges[name]; });
      });
      created.forEach(g => {
        if (g.scope && g.scope.groupName) g.scope = groupId[g.scope.groupName] ? { groups: [groupId[g.scope.groupName]] } : undefined;
        if (!g.scope) delete g.scope;
        const clean = Object.assign({}, g);
        delete clean._path;
        d.gates.push(clean);
      });
    }, { kind: 'gates' });

    const renamed = channelResolver(ws.paramNames()).renamed().filter(n => parsed.samples.some(ps => ps.pops.some(p => p.gate && p.gate.dims && p.gate.dims.some(dm => dm.name === n)) || (ps.comp && ps.comp.params.indexOf(n) >= 0)));
    if (renamed.length) warnings.push('FlowJo writes “/” in channel names as “_”; mapped back to the files’ names: ' + renamed.join(', ') + '.');
    const uncomp = created.filter(g => g.uncomp);
    if (uncomp.length) warnings.push(uncomp.length + ' gate' + (uncomp.length > 1 ? 's were' : ' was') + ' drawn in FlowJo on uncompensated channels (no “Comp-” prefix) and ' + (uncomp.length > 1 ? 'are' : 'is') +
      ' evaluated on uncompensated values, as FlowJo does: ' + uncomp.slice(0, 6).map(g => g.name).join(', ') + (uncomp.length > 6 ? '…' : '') + '.');
    const report = { matched: matched.map(p => ({ file: p.ps.file, key: p.s.key })), missing, gates: created.length,
      groups: flowjoGroups.length, warnings, compensation: compActive, flowjoVersion: parsed.version, compare: [],
      compensatedSamples: matched.filter(p => p.s.compensated).length };
    report.compare = compare(ws, parsed, created);
    // every imported population by its FlowJo path ("Time/Singlets/CD3+"), for lookups
    report.paths = {};
    created.forEach(g => { report.paths[g._path.split(SEP).join('/')] = g.id; });
    return report;
  }

  /** FlowJo's own count vs FlowMate's, for every population of every matched sample. */
  function compare(ws, parsed, created) {
    const idOf = new Map(created.map(g => [g._path, g.id]));
    const rows = [];
    matchSamples(ws, parsed).forEach(({ ps, s }) => {
      if (!s) return;
      ps.pops.forEach(node => {
        if (!(node.count >= 0)) return;
        const id = idOf.get(node.path.join(SEP));
        if (!id) return;
        const n = ws.count(s, id);
        // a population FlowMate cannot compute (a missing parameter, a FlowJo-derived one like
        // tSNE) is "not available" — never a count of 0
        const error = (s._popErrors && s._popErrors[id]) || null;
        const ours = error || !Number.isFinite(n) ? null : n;
        const diff = ours == null ? null : ours - node.count;
        rows.push({ sample: s.key, file: ps.file, path: node.path.join('/'), gateId: id, flowjo: node.count, ours, diff, error,
          diffPct: diff == null ? null : node.count ? 100 * diff / node.count : (ours ? 100 : 0) });
      });
    });
    return rows;
  }

  FM.wsp = { parse, importInto, match: matchSamples, ellipseFromFlowJo, bareName, channelResolver, _toGate: toGate };   // _toGate: for the tests
})(FM);
