/* Analysis presets: a gate hierarchy, a Measure table, and optionally a plate layout,
 * defined against named parameter "slots" that the user can remap to their own channels. */
(function (FM) {
  'use strict';

  // THP Cells polygon from the validated 17-Sep-2026 analysis: transcribed from the CytExpert
  // gate and scaled 1.07× about its vertex mean (reproduces 76.95% vs 76.90% on well A1).
  const THP_BASE = [[150000, 60000], [232000, 740000], [505000, 655000], [760000, 455000], [620000, 175000], [300000, 65000]];
  const thpVerts = (() => {
    const cx = THP_BASE.reduce((s, v) => s + v[0], 0) / THP_BASE.length;
    const cy = THP_BASE.reduce((s, v) => s + v[1], 0) / THP_BASE.length;
    return THP_BASE.map(([x, y]) => [cx + (x - cx) * 1.07, cy + (y - cy) * 1.07]);
  })();

  const PHAGO = {
    id: 'phagocytosis',
    name: 'Phagocytosis — bead uptake',
    summary: 'Cells → Singles → Bead-positive, with phagoscore = gMFI of the bead channel in the bead-positive gate × % bead-positive.',
    slots: [
      { key: 'fscH', label: 'Forward scatter (height)', want: ['FSC-H', 'FS-H', 'FSC'] },
      { key: 'sscH', label: 'Side scatter (height)', want: ['SSC-H', 'SS-H', 'SSC'] },
      { key: 'sscA', label: 'Side scatter (area)', want: ['SSC-A', 'SS-A'] },
      { key: 'bead', label: 'Bead fluorescence', want: ['FL1-H', 'FITC-H', 'FL1-A', 'FITC-A'] },
    ],
    layout: {
      label: 'Rows = IgG1, IgG2, IgG4, LALA, THP + beads (control), THP alone (gate control)',
      groups: [
        { name: 'IgG1', role: 'sample' }, { name: 'IgG2', role: 'sample' },
        { name: 'IgG4', role: 'sample' }, { name: 'LALA', role: 'sample' },
        { name: 'THP + beads', role: 'sample' }, { name: 'THP alone', role: 'gate' },
      ],
      byRow: true,
    },
    build(p) {
      const lin = (max) => ({ type: 'lin', min: 0, max });
      return {
        gates: [
          {
            key: 'cells', name: 'THP Cells', parent: null, type: 'polygon', x: p.fscH, y: p.sscH,
            xScale: lin(1e6), yScale: lin(1e6), verts: thpVerts,
          },
          {
            key: 'singles', name: 'Singles', parent: 'cells', type: 'polygon', x: p.sscA, y: p.sscH,
            xScale: lin(1.5e6), yScale: lin(8e5),
            verts: [[100000, 31000], [1500000, 465000], [1500000, 800000], [1203000, 800000], [100000, 66500]],
          },
          {
            key: 'beads', name: 'THP Cells + Beads', parent: 'singles', type: 'rect', x: p.bead, y: p.fscH,
            xScale: null, yScale: lin(1e6),
            rect: { x0: 6e4, x1: 3e6, y0: 130000, y1: 720000 },
          },
        ],
        // what the Measure step shows: % bead-positive, the bead-positive cells' gMFI, and the events behind them
        table: { name: 'Bead uptake', columns: [
          { pop: 'beads', stat: 'freq_parent' },
          { pop: 'beads', stat: 'gmean', param: p.bead },
          { pop: 'beads', stat: 'count' },
        ] },
        views: { root: { x: p.fscH, y: p.sscH }, cells: { x: p.sscA, y: p.sscH }, singles: { x: p.bead, y: p.fscH } },
        scales: { [p.fscH]: lin(1e6), [p.sscH]: lin(1e6), [p.sscA]: lin(1.5e6) },
      };
    },
  };

  const PRESETS = [PHAGO];

  /** Best-guess mapping of a preset's slots to the loaded parameter names. */
  function autoMap(preset, paramNames) {
    const lower = paramNames.map(n => n.toLowerCase());
    const map = {};
    preset.slots.forEach(s => {
      const hit = s.want.map(w => lower.indexOf(w.toLowerCase())).find(i => i >= 0);
      map[s.key] = hit != null && hit >= 0 ? paramNames[hit] : null;
    });
    return map;
  }

  /**
   * Apply a preset to the workspace as one undo step.
   * opts: { mapping, layout (bool), replace (bool: remove existing gates/metrics first) }
   */
  function apply(ws, preset, opts) {
    const mapping = opts.mapping;
    const missing = preset.slots.filter(s => !mapping[s.key]);
    if (missing.length) throw new Error('Choose a parameter for: ' + missing.map(s => s.label).join(', '));
    const spec = preset.build(mapping);
    const U = FM.workspaceUtil;

    ws.update('Apply ' + preset.name + ' preset', d => {
      if (opts.replace) { d.gates = []; d.metrics = []; d.views = {}; d.tables = []; }
      const idOf = {};
      const taken = new Set(d.gates.map(g => g.name.toLowerCase()));
      spec.gates.forEach(g => {
        const id = U.uid('g');
        idOf[g.key] = id;
        let name = g.name, k = 2;
        while (taken.has(name.toLowerCase())) name = g.name + ' ' + (k++);
        taken.add(name.toLowerCase());
        const gate = {
          id, name, parent: g.parent ? idOf[g.parent] : null, type: g.type, x: g.x, y: g.y,
          xScale: g.xScale || U.clone(ws.scaleSpec(g.x)),
          yScale: g.yScale || (g.y ? U.clone(ws.scaleSpec(g.y)) : null),
          color: null, rev: U.nextRev(),
        };
        if (g.verts) gate.verts = g.verts.map(v => v.slice());
        if (g.rect) gate.rect = Object.assign({}, g.rect);
        if (g.range) gate.range = Object.assign({}, g.range);
        d.gates.push(gate);
      });
      // a strategy on the Layout page follows the new hierarchy in this same step
      if (FM.strategy) { FM.strategy.prune(d); FM.strategy.extend(d, Object.values(idOf)); }
      Object.entries(spec.scales || {}).forEach(([param, sc]) => { d.params[param] = Object.assign({}, d.params[param], { scale: sc }); });
      Object.entries(spec.views).forEach(([k, v]) => {
        // views take the preset's validated ranges where it has them; other axes auto-frame
        const ranges = {};
        [v.x, v.y].filter(Boolean).forEach(p => { if (spec.scales && spec.scales[p]) ranges[p] = spec.scales[p]; });
        d.views[k === 'root' ? 'root' : idOf[k]] = Object.assign({}, v, { ranges });
      });
      if (spec.table) {
        d.tables = d.tables || [];
        d.tables.push({ id: U.uid('t'), name: spec.table.name, rows: 'samples',
          columns: spec.table.columns.map(c => Object.assign({ id: U.uid('c') }, c, { pop: idOf[c.pop] })) });
      }

      if (opts.layout && preset.layout) {
        const groupIds = [];
        preset.layout.groups.forEach((g, i) => {
          let ex = d.groups.find(x => x.name.toLowerCase() === g.name.toLowerCase());
          if (!ex) {
            const used = new Set(d.groups.map(x => x.color));
            const color = g.role === 'control' ? U.ROLE_COLORS.control : g.role === 'gate' ? U.ROLE_COLORS.gate
              : (U.GROUP_COLORS.find(c => !used.has(c)) || U.GROUP_COLORS[i % U.GROUP_COLORS.length]);
            ex = { id: U.uid('grp'), name: g.name, color, role: g.role };
            d.groups.push(ex);
          }
          if (g.role === 'control') d.groups.forEach(x => { if (x !== ex && x.role === 'control') x.role = 'sample'; });
          ex.role = g.role;
          groupIds.push(ex.id);
        });
        if (preset.layout.byRow) {
          ws.samples.forEach(s => {
            const pos = FM.wells.parse(s.well);
            if (!pos || pos.row >= groupIds.length) return;
            d.wells[s.key] = Object.assign({ excluded: false, reason: '' }, d.wells[s.key], { group: groupIds[pos.row] });
          });
        }
      }
    }, { kind: 'doc' });
  }

  FM.presets = { list: PRESETS, byId: id => PRESETS.find(p => p.id === id), autoMap, apply };
})(FM);
