/* The Analysis step's graphs: one Measure column, grouped by condition (the Plate step's groups).
 *
 *   doc.graphs = [{ id, name, src: { table, col }, kind: 'bar'|'dot'|'box'|'paired',
 *                   error: 'sd'|'sem', groups: [groupId] | null (every condition), compare: 'all'|'control'|'none',
 *                   control: groupId, pairBy: 'order'|'row'|'col', showNs, showValues, pText: 'stars'|'exact', yLabel,
 *                   unit: 'well' | 'cell' }]
 *
 * compute() turns one into what the view shows: the chart model (render/statchart.js) and the
 * statistics (core/groupstats.js). Each well is one value on the graph; excluded wells never take part.
 *
 * unit 'cell' tests the cells themselves for an intensity column (mean, median or geometric mean of a
 * channel in a population): every event of the population in every well, nested in its well, by a
 * mixed model with the well as the random effect (groupstats.js). Mean columns are tested on the
 * channel's values; median and geometric mean columns on log10 of them, the scale those statistics
 * live on (events at or below zero have no log and are left out, and counted in a note).
 */
(function (FM) {
  'use strict';
  const T = () => FM.statTables;
  const finite = Number.isFinite;

  const KINDS = [
    { id: 'bar', label: 'Bar', tip: 'Mean as a bar with error bars, every well as a dot' },
    { id: 'dot', label: 'Dot', tip: 'Every well as a dot, with the mean and error bars' },
    { id: 'box', label: 'Box', tip: 'Median and quartiles, whiskers from min to max' },
    { id: 'paired', label: 'Paired', tip: 'Lines join matched wells across conditions (before / after, same donor); paired tests' },
  ];
  const PAIR_BY = [
    { id: 'order', label: 'order in condition', tip: 'The first well of each condition is one set, the second the next, …' },
    { id: 'row', label: 'plate row', tip: 'Wells in the same plate row (A, B, …) are one set — one donor per row' },
    { id: 'col', label: 'plate column', tip: 'Wells in the same plate column (1, 2, …) are one set — one donor per column' },
  ];

  /** A column's name for an axis: "THP Cells + Beads, % of parent", "Geometric mean FL1-H", a formula's name. */
  function shortLabel(ws, table, c) {
    if (T().isFormula(c)) return c.name || '= ' + T().formulaText(table, c);
    const pop = ws.popName(c.pop);
    const st = { count: 'count', freq_parent: '% of parent', freq_total: '% of total', freq_of: '% of ' + ws.popName(c.of) }[c.stat];
    if (st) return pop + ', ' + st;
    const lab = (T().STATS[c.stat] || { label: c.stat }).label;
    return pop + ', ' + lab.toLowerCase() + (c.param ? ' ' + ws.paramLabel(c.param) : '');
  }

  /** Every column of every Measure table, as something to plot. */
  function sources(ws) {
    const out = [];
    const tabs = ws.doc.tables || [];
    tabs.forEach(t => t.columns.forEach((c, i) => out.push({ table: t.id, col: c.id, letter: FM.formula.letter(i),
      label: (tabs.length > 1 ? t.name + ' › ' : '') + FM.formula.letter(i) + ' · ' + shortLabel(ws, t, c), short: shortLabel(ws, t, c) })));
    return out;
  }

  /** Conditions a new graph shows: every group with wells, except gate and unmixing controls. */
  function defaultGroups(ws) {
    return ws.doc.groups.filter(g => g.role !== 'gate' && g.role !== 'comp' && g.role !== 'unstained' && ws.samplesIn(g.id).length).map(g => g.id);
  }

  const CELL_STATS = { mean: 'linear', median: 'log', gmean: 'log' };
  /** Can this column be tested per cell? → null, or why not. */
  function cellsUnavailable(col, kind) {
    if (kind === 'paired') return 'Per-cell tests are for unpaired conditions; paired graphs compare matched wells.';
    if (!col || T().isFormula(col) || !CELL_STATS[col.stat] || !col.param) return 'Per-cell tests need a column that is a mean, median or geometric mean of a channel — a value every cell has.';
    return null;
  }
  /** One well's cells for the column, on the scale they are tested on. → { values, dropped } */
  function cellValues(ws, key, col) {
    const s = ws.sample(key);
    const data = s && s.data[col.param];
    if (!data) return { values: new Float64Array(0), dropped: 0 };
    const idx = ws.indices(s, col.pop || null);
    const log = CELL_STATS[col.stat] === 'log';
    const out = new Float64Array(idx.length);
    let n = 0, dropped = 0;
    for (let i = 0; i < idx.length; i++) {
      const v = data[idx[i]];
      if (!finite(v)) { dropped++; continue; }
      if (log) { if (v > 0) out[n++] = Math.log10(v); else dropped++; } else out[n++] = v;
    }
    return { values: out.subarray(0, n), dropped };
  }

  /** A new graph of `src` with the defaults: bar, SD, every pair compared. */
  function create(ws, src) {
    const ids = defaultGroups(ws);
    return { name: '', src: { table: src.table, col: src.col }, kind: 'bar', error: 'sd', groups: null, compare: 'all',
      control: ids[0] || null, pairBy: 'order', showNs: false, pText: 'stars', yLabel: '', unit: 'well' };
  }

  /** The conditions on the graph, in its order (null: every default condition). */
  function shownIds(ws, g) {
    const exist = new Set(ws.doc.groups.map(x => x.id));
    return (g.groups || defaultGroups(ws)).filter(id => exist.has(id));
  }

  /** Where a well sits in a matched set. */
  function pairKey(row, idx, by) {
    if (by === 'order') return idx;
    const p = row.well ? FM.wells.parse(row.well) : null;
    if (!p) return null;
    return by === 'row' ? p.row : p.col;
  }
  const keyName = (k, by) => (by === 'order' ? 'set ' + (k + 1) : by === 'row' ? 'row ' + FM.wells.ROWS[k] : 'column ' + (k + 1));

  /**
   * → { error } or { table, col, label, yLabel, shown: [group], hidden: [group], model, stats, notes }
   */
  function compute(ws, g) {
    const table = ws.table(g.src && g.src.table);
    if (!table) return { error: 'The Measure table this graph used was deleted.' };
    const col = table.columns.find(c => c.id === g.src.col);
    if (!col) return { error: 'The column this graph used was removed from “' + table.name + '”.' };
    const label = shortLabel(ws, table, col);
    const all = T().groupValues(ws, table, col.id);
    const byId = {};
    all.forEach(e => { e.rows.sort(FM.wells.compare); byId[e.group.id] = e; });
    const ids = shownIds(ws, g);
    const shown = ids.map(id => byId[id]);
    const hidden = ws.doc.groups.filter(x => ids.indexOf(x.id) < 0);
    const notes = [];

    const empty = [];
    shown.forEach(e => e.rows.forEach(r => { if (!finite(r.value)) empty.push(r.name); }));
    if (empty.length) notes.push(empty.length + ' well' + (empty.length === 1 ? ' has' : 's have') + ' no value for this column and ' + (empty.length === 1 ? 'is' : 'are') + ' left out (' + empty.slice(0, 6).join(', ') + (empty.length > 6 ? ', …' : '') + ').');

    const paired = g.kind === 'paired';
    let sets = null, statGroups;
    if (paired) {
      const by = g.pairBy || 'order';
      const keys = new Set();
      const maps = shown.map(e => {
        const m = new Map();
        let i = 0, unplaced = 0;
        e.rows.forEach(r => {
          if (!finite(r.value)) return;
          const k = pairKey(r, i++, by);
          if (k == null) { unplaced++; return; }
          if (m.has(k)) { notes.push(e.group.name + ' has more than one well in ' + keyName(k, by) + '; only the first is paired.'); return; }
          m.set(k, r.value); keys.add(k);
        });
        if (unplaced) notes.push(unplaced + ' well' + (unplaced === 1 ? '' : 's') + ' of ' + e.group.name + ' have no plate position, so they can’t be matched by ' + PAIR_BY.find(x => x.id === by).label + '.');
        return m;
      });
      const order = Array.from(keys).sort((a, b) => a - b);
      sets = order.map(k => maps.map(m => (m.has(k) ? m.get(k) : NaN)));
      statGroups = shown.map((e, i) => ({ name: e.group.name, values: sets.map(r => r[i]) }));
    } else {
      statGroups = shown.map(e => ({ name: e.group.name, values: e.rows.map(r => r.value) }));
    }
    // per cell: each well's events instead of its one value (the graph still shows one dot per well)
    const why = cellsUnavailable(col, g.kind);
    const nested = g.unit === 'cell' && !why;
    let cellScale = null;
    if (g.unit === 'cell' && why) notes.push(why + ' Tested per well instead.');
    if (nested) {
      cellScale = CELL_STATS[col.stat];
      let dropped = 0;
      statGroups = shown.map(e => {
        const rows = e.rows.filter(r => finite(r.value));
        return { name: e.group.name, values: rows.map(r => r.value), cells: rows.map(r => { const c = cellValues(ws, r.key, col); dropped += c.dropped; return c.values; }) };
      });
      if (dropped) notes.push(dropped.toLocaleString('en-US') + ' event' + (dropped === 1 ? ' is' : 's are') + ' at or below zero on ' + col.param + ' and ' + (dropped === 1 ? 'is' : 'are') + ' left out of the per-cell test (the test uses log10 of each cell’s value).');
    }
    const ci = ids.indexOf(g.control);
    const stats = FM.groupStats.run({ groups: statGroups, paired, nested, compare: g.compare === 'control' && ci < 0 ? 'none' : g.compare, control: Math.max(0, ci) });
    if (g.compare === 'control' && ci < 0) notes.push('Pick the condition to compare against.');
    const yLabel = g.yLabel || label;
    const model = {
      title: g.name || '', yLabel, kind: g.kind, error: g.error, showNs: !!g.showNs, showValues: !!g.showValues, pText: g.pText, sets, comparisons: stats.comparisons,
      groups: shown.map((e, i) => ({ name: e.group.name, color: e.group.color,
        values: e.rows.filter(r => finite(r.value)).map(r => ({ v: r.value, label: r.name })), summary: stats.summary[i] })),
    };
    return { table, col, label, yLabel, shown: shown.map(e => e.group), hidden, model, stats, nested, cellScale, cellsWhy: why, notes: Array.from(new Set(notes.concat(stats.notes))) };
  }

  /** The graph's data for PlotMate: one Column table, a data set per condition (rows = matched sets when paired). */
  function handoff(ws, g) {
    const r = compute(ws, g);
    if (r.error) throw new Error(r.error);
    const paired = g.kind === 'paired';
    const sets = r.model.groups.map((x, i) => ({ title: x.name, values: paired ? r.model.sets.map(row => row[i]) : x.values.map(v => v.v) }));
    const k = sets.length;
    const ci = r.shown.findIndex(x => x.id === g.control);
    const suggest = k < 2 ? [] : [k === 2
      ? { table: 0, analysis: 'ttest', params: { design: paired ? 'paired' : 'unpaired', gaussian: 'yes', unpairedTest: 'student' } }
      : { table: 0, analysis: 'anova1', params: Object.assign({ compare: g.compare === 'none' ? 'none' : g.compare === 'control' && ci >= 0 ? 'control' : 'all' },
        g.compare === 'control' && ci >= 0 ? { control: ci } : {}, paired ? { design: 'matched', sphericity: 'gg' } : {}) }];
    suggest.forEach(s => Object.assign(s, { graph: g.kind === 'bar' ? 'bar' : 'scatter', brackets: g.showNs ? 'all' : 'significant' }));
    return BMH.make({ from: 'FlowMate ' + FM.version, title: ws.doc.name, suggest,
      tables: [{ kind: 'column', title: r.yLabel, notes: r.label + ' per well, by condition, from FlowMate “' + ws.doc.name + '”. Excluded wells are left out.' + (paired ? ' Each row is a matched set.' : ''), sets }] });
  }

  FM.graphs = { KINDS, PAIR_BY, CELL_STATS, cellsUnavailable, cellValues, shortLabel, sources, defaultGroups, create, shownIds, compute, handoff };
})(FM);
