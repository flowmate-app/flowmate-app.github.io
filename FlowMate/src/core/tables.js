/* Tables: populations × statistics, one row per sample — FlowJo's table editor.
 *
 *   doc.tables = [{ id, name, rows: 'samples' | groupId,
 *                   columns: [{ id, pop, stat, param?, of? } | { id, kind: 'formula', name, expr }] }]
 *
 * A formula column computes from the others (core/formula.js); its expr names them by id.
 * A cell where the population does not exist (its gate is scoped elsewhere), or a formula has
 * nothing to compute from, is NaN, written as an empty field — never 0.
 */
(function (FM) {
  'use strict';

  const STATS = {
    count: { label: 'Count' },
    freq_parent: { label: 'Freq. of parent' },
    freq_total: { label: 'Freq. of total' },
    freq_of: { label: 'Freq. of', needsOf: true },
    median: { label: 'Median', needsParam: true },
    mean: { label: 'Mean', needsParam: true },
    gmean: { label: 'Geometric mean', needsParam: true },
    sd: { label: 'SD', needsParam: true },
    cv: { label: 'CV', needsParam: true },
    rcv: { label: 'Robust CV', needsParam: true },
  };

  /** "Cells/Singlets/CD4+", the way FlowJo names a population in a table. */
  function popPath(ws, id) {
    if (!id) return 'All events';
    const g = ws.gate(id);
    if (!g) return '(deleted population)';
    return ws.gatePath(id).map(x => x.name).join('/');
  }

  const isFormula = c => c && c.kind === 'formula';

  /** A formula as the user sees it now: column letters in the table's current order. */
  function formulaText(table, c) { return FM.formula.toText(c.expr, (table.columns || []).map(x => x.id)); }

  function columnLabel(ws, c, table) {
    if (isFormula(c)) return c.name || (table ? '= ' + formulaText(table, c) : 'Formula');
    const st = STATS[c.stat] || { label: c.stat };
    let s = popPath(ws, c.pop) + ' | ' + st.label;
    if (st.needsOf) s += ' ' + (c.of ? ws.popName(c.of) : 'All events');
    if (st.needsParam && c.param) s += ' (' + c.param + ')';
    return s;
  }

  function cell(ws, sample, c) {
    if (c.pop && !ws.gate(c.pop)) return NaN;
    switch (c.stat) {
      case 'count': return ws.count(sample, c.pop);
      case 'freq_parent': return ws.pct(sample, c.pop);
      case 'freq_total': return ws.pctOf(sample, c.pop, null);
      case 'freq_of': return ws.pctOf(sample, c.pop, c.of || null);
      default: return c.param ? ws.stat(sample, c.pop, c.param, c.stat) : NaN;
    }
  }

  function rowSamples(ws, table) {
    if (!table.rows || table.rows === 'samples') return ws.samples;
    return ws.samplesIn(table.rows);
  }

  /**
   * Every column's value for any sample, formulas included, memoised for one build. A formula
   * may use a condition's mean (groupmean), which needs samples outside the table's rows.
   * → { value(sample, j), errors: [string|null] }
   */
  function evaluator(ws, cols) {
    const ids = cols.map(c => c.id);
    const where = {};
    ids.forEach((id, j) => { where[id] = j; });
    const errors = cols.map(() => null);
    const compiled = cols.map((c, j) => {
      if (!isFormula(c)) return null;
      try { return FM.formula.compile(c.expr, ids); } catch (e) { errors[j] = e.message; return null; }
    });
    const { cyclic } = FM.formula.order(cols);
    cols.forEach((c, j) => { if (isFormula(c) && cyclic.has(c.id)) { errors[j] = 'This formula uses itself (directly or through another formula)'; compiled[j] = null; } });
    const memo = new Map();
    function value(s, j) {
      let row = memo.get(s.key);
      if (!row) { row = new Array(cols.length); memo.set(s.key, row); }
      if (row[j] !== undefined) return row[j];
      row[j] = NaN;                                   // guards re-entry while computing
      const c = cols[j];
      let v;
      if (!isFormula(c)) v = cell(ws, s, c);
      else if (!compiled[j]) v = NaN;
      else v = compiled[j].eval({ col: id => value(s, where[id]), groupMean: (id, name) => groupMean(where[id], name) });
      row[j] = v;
      return v;
    }
    const gm = {};
    function groupMean(j, name) {
      const k = j + '|' + String(name).toLowerCase();
      if (k in gm) return gm[k];
      const g = ws.doc.groups.find(x => x.name.toLowerCase() === String(name).trim().toLowerCase());
      const vals = g ? ws.samplesIn(g.id).filter(s => !ws.wellInfo(s.key).excluded).map(s => value(s, j)).filter(Number.isFinite) : [];
      return (gm[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN);
    }
    return { value, errors };
  }

  /** → { head: [string], rows: [{ key, name, group, excluded, cells: [number] }], columns (with .error on broken formulas) } */
  function build(ws, table) {
    const cols = table.columns || [];
    const head = ['Sample', 'Group'].concat(cols.map(c => columnLabel(ws, c, table)));
    const ev = evaluator(ws, cols);
    const rows = rowSamples(ws, table).map(s => {
      const g = ws.groupOf(s.key);
      return { key: s.key, name: s.well || s.name, group: g ? g.name : '', excluded: !!ws.wellInfo(s.key).excluded,
        cells: cols.map((c, j) => ev.value(s, j)) };
    });
    return { head, rows, columns: cols.map((c, j) => (ev.errors[j] ? Object.assign({}, c, { error: ev.errors[j] }) : c)) };
  }

  /**
   * One column's values for every sample, by condition (the Analysis step).
   * → [{ group, rows: [{ key, well, value }] }] in group order; excluded wells left out.
   */
  function groupValues(ws, table, colId) {
    const cols = table.columns || [];
    const j = cols.findIndex(c => c.id === colId);
    if (j < 0) return null;
    const ev = evaluator(ws, cols);
    return ws.doc.groups.map(g => ({ group: g, rows: ws.samplesIn(g.id).filter(s => !ws.wellInfo(s.key).excluded)
      .map(s => ({ key: s.key, well: s.well || null, name: s.well || s.name, value: ev.value(s, j) })) }));
  }

  const num = v => (Number.isFinite(v) ? String(+v.toPrecision(10)) : '');
  function csvField(v) {
    const s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(b) {
    const lines = [b.head.map(csvField).join(',')];
    b.rows.forEach(r => lines.push([r.name, r.group].map(csvField).concat(r.cells.map(num)).join(',')));
    return lines.join('\r\n') + '\r\n';
  }

  function toTSV(b) {
    const clean = s => String(s).replace(/[\t\r\n]+/g, ' ');
    return [b.head.map(clean).join('\t')].concat(b.rows.map(r => [clean(r.name), clean(r.group)].concat(r.cells.map(num)).join('\t'))).join('\n');
  }

  FM.statTables = { STATS, build, toCSV, toTSV, columnLabel, popPath, formulaText, groupValues, isFormula };   // FM.tables is the figure-page table renderer
})(FM);
