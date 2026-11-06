/* Send to PlotMate: FlowMate tables and results as a BenchMate hand-off (shared/handoff.js, BMH).
 *
 *   fromTable(ws, table)   each statistic column → a Column table with the groups as data sets
 *                          (no groups: one Multiple-variables table, samples as rows)
 *   fromResults(ws, res)   each readout → a Column table of conditions × replicate wells, with a
 *                          suggested one-way ANOVA (Dunnett vs the reference control, else Tukey)
 *                          or t test, and a scatter graph with brackets
 * Excluded wells are left out, as they are from FlowMate's own statistics.
 */
(function (FM) {
  'use strict';
  const FROM = () => 'FlowMate ' + FM.version;

  /** The suggested comparison for k groups with the reference control at index c (or −1). */
  function suggestion(k, c) {
    if (k < 2) return null;
    if (k === 2) return { analysis: 'ttest', params: { design: 'unpaired', gaussian: 'yes', unpairedTest: 'welch' } };
    return c >= 0 ? { analysis: 'anova1', params: { compare: 'control', control: c } } : { analysis: 'anova1', params: { compare: 'all' } };
  }

  function fromTable(ws, table) {
    const b = FM.statTables.build(ws, table);
    const rows = b.rows.filter(r => !r.excluded);
    const groups = [];
    rows.forEach(r => { if (r.group && groups.indexOf(r.group) < 0) groups.push(r.group); });
    const tables = [], suggest = [];
    if (groups.length >= 2) {
      const ctrl = ws.controlGroup && ws.controlGroup();
      const c = ctrl ? groups.indexOf(ctrl.name) : -1;
      b.columns.forEach((col, j) => {
        const title = b.head[j + 2];
        tables.push({ kind: 'column', title, notes: 'From FlowMate table “' + table.name + '” of “' + ws.doc.name + '”: ' + title + ', one data set per group.',
          sets: groups.map(gn => ({ title: gn, values: rows.filter(r => r.group === gn).map(r => r.cells[j]).filter(Number.isFinite) })) });
        const s = suggestion(groups.length, c);
        if (s) suggest.push(Object.assign({ table: tables.length - 1, graph: 'scatter', brackets: 'significant' }, s));
      });
    } else {
      tables.push({ kind: 'multivar', title: table.name, notes: 'From FlowMate table “' + table.name + '” of “' + ws.doc.name + '”. Each row is a sample.',
        rowTitles: rows.map(r => r.name), sets: b.columns.map((col, j) => ({ title: b.head[j + 2], values: rows.map(r => r.cells[j]) })) });
    }
    return BMH.make({ from: FROM(), title: ws.doc.name, tables, suggest });
  }

  /** res: one FM.analysis.analyze() result, or a list of them (one per readout). */
  function fromResults(ws, res) {
    const list = Array.isArray(res) ? res : [res];
    const tables = [], suggest = [];
    list.forEach(r => {
      if (!r || !r.metric) return;
      const tested = r.groups.filter(x => x.group.role !== 'gate' && x.used.length);
      if (!tested.length) return;
      const c = r.control ? tested.findIndex(x => x.group.id === r.control.id) : -1;
      tables.push({ kind: 'column', title: r.metric.name,
        notes: r.metric.name + ' (' + r.metric.expr + ') per well, from FlowMate “' + ws.doc.name + '”. Excluded wells are left out.' + (c >= 0 ? ' Reference control: ' + tested[c].group.name + '.' : ''),
        sets: tested.map(x => ({ title: x.group.name, values: x.used.map(w => w.value) })) });
      const s = suggestion(tested.length, c);
      if (s) suggest.push(Object.assign({ table: tables.length - 1, graph: 'scatter', brackets: 'all' }, s));
    });
    return BMH.make({ from: FROM(), title: ws.doc.name, tables, suggest });
  }

  /** Every readout of the workspace (for the Results view's Send to PlotMate). */
  function fromAllResults(ws) {
    return fromResults(ws, ws.doc.metrics.map(m => FM.analysis.analyze(ws, m.id)));
  }

  FM.handoff = { fromTable, fromResults, fromAllResults };
})(FM);
