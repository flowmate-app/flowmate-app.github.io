/* The gating tree: every population, indented under its parent, with its percentage and
 * the number of events behind it — the table a paper prints beside a gating strategy.
 *
 * A percentage without its event count cannot be judged: the count's CV is about 1/√n
 * (Roederer, Cytometry A 2008), so 59% of 9,000 events is precise and 59% of 40 is not.
 * Every cell carries both, and a population under LOW_EVENTS in any well it summarises is
 * flagged. Hand-adjusted gates are marked in the cells they produced (✦ adjusted here,
 * ↳ moved by an adjustment above), as everywhere else a gate-derived number is read.
 *
 * Columns: 'condition' (mean ± SD over each condition's included wells), 'well' (every
 * included well), or 'one' (a single well). No DOM here: renderers live in the UI.
 */
(function (FM) {
  'use strict';

  const LOW_EVENTS = 100;   // ≈ ±10% relative precision on a count of events
  const MARK = { adjusted: '✦', inherited: '↳', low: '†' };

  function included(ws, s) { return !ws.wellInfo(s.key).excluded; }

  /** Which wells feed which column. */
  function columns(ws, mode, sampleKey) {
    if (mode === 'one') {
      const s = ws.sample(sampleKey) || ws.samples.find(x => included(ws, x)) || ws.samples[0];
      if (!s) return [];
      const g = ws.groupOf(s.key);
      return [{ id: s.key, label: s.well || s.name, sub: g ? g.name : '', color: g ? g.color : null, samples: [s], kind: 'well' }];
    }
    if (mode === 'well') {
      // grouped by condition, in the Plate step's order, so a condition's wells sit together
      const order = [];
      ws.doc.groups.forEach(g => ws.samplesIn(g.id).forEach(s => order.push(s)));
      ws.samples.forEach(s => { if (order.indexOf(s) < 0) order.push(s); });
      return order.filter(s => included(ws, s)).map(s => {
        const g = ws.groupOf(s.key);
        return { id: s.key, label: s.well || s.name, sub: g ? g.name : '', color: g ? g.color : null, samples: [s], kind: 'well' };
      });
    }
    const cols = ws.doc.groups.map(g => ({
      id: g.id, label: g.name, color: g.color, role: g.role, kind: 'group',
      sub: g.role === 'control' ? 'reference' : g.role === 'gate' ? 'gate control' : '',
      samples: ws.samplesIn(g.id).filter(s => included(ws, s)),
    })).filter(c => c.samples.length);
    if (!cols.length) {
      // nothing painted on the plate yet: one column over every included well
      const all = ws.samples.filter(s => included(ws, s));
      if (all.length) cols.push({ id: 'all', label: 'All wells', sub: '', color: null, samples: all, kind: 'group' });
    }
    return cols;
  }

  /** Is any gate in this one's chain, including itself, adjusted for this well? */
  function chainTouched(ws, gateId, key) { return FM.summary.chainAdjusted(ws, gateId, key); }

  /**
   * opts.mode:  'condition' (default) | 'well' | 'one'
   * opts.value: 'parent' (default, % of parent) | 'total' (% of all events)
   * opts.sample: the well for mode 'one'
   */
  function build(ws, opts) {
    opts = opts || {};
    const mode = opts.mode || 'condition';
    const value = opts.value === 'total' ? 'total' : 'parent';
    const cols = columns(ws, mode, opts.sample);
    const order = [{ gate: null, depth: 0 }].concat(FM.summary.gatesInOrder(ws).map(o => ({ gate: o.gate, depth: o.depth + 1 })));
    const anyAdj = ws.anyAdjusted();
    const flags = { adjusted: false, inherited: false, low: false };

    const rows = order.map(({ gate, depth }) => {
      const id = gate ? gate.id : null;
      const cells = cols.map(c => {
        const pcts = [], events = [];
        let mark = '', low = false;
        c.samples.forEach(s => {
          const n = ws.count(s, id);
          events.push(n);
          if (gate) pcts.push(value === 'total' ? ws.pctOf(s, id, null) : ws.pct(s, id));
          if (gate && n < LOW_EVENTS) low = true;
          if (gate && anyAdj) {
            if (ws.isAdjusted(id, s.key)) mark = 'adjusted';
            else if (mark !== 'adjusted' && chainTouched(ws, id, s.key)) mark = 'inherited';
          }
        });
        const p = FM.stats.groupSummary(pcts);
        const e = FM.stats.groupSummary(events);
        if (mark) flags[mark] = true;
        if (low) flags.low = true;
        return {
          n: c.samples.length,
          pct: gate ? p.mean : NaN, sd: gate && p.n > 1 ? p.sd : NaN,
          events: e.mean, eventsMin: events.length ? Math.min.apply(null, events) : NaN,
          mark, low,
        };
      });
      return { id, name: gate ? gate.name : 'All events', depth, parent: gate ? ws.popName(gate.parent) : '', cells };
    });

    return { mode, value, cols, rows, flags, averaged: mode === 'condition' };
  }

  // ------------------------------------------------------------------ text
  function fmtPct(v) {
    if (!Number.isFinite(v)) return '—';
    if (v >= 99.95) return '100';
    return v.toFixed(v < 10 ? 2 : 1);
  }
  /** "59.4 ± 1.2" — the SD printed to the same precision as the mean it qualifies. */
  function fmtPctSd(m, sd) {
    if (!Number.isFinite(m)) return '—';
    const d = m < 10 && m < 99.95 ? 2 : 1;
    return (m >= 99.95 ? '100' : m.toFixed(d)) + (Number.isFinite(sd) ? ' ± ' + sd.toFixed(d) : '');
  }
  function fmtEvents(v) { return Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—'; }

  /** The strings a renderer draws for one cell: the percentage line and the events line. */
  function cellText(t, row, cell, opts) {
    opts = opts || {};
    const showSd = opts.sd !== false && t.averaged;
    const pct = row.id == null ? '' : (showSd ? fmtPctSd(cell.pct, cell.sd) : fmtPct(cell.pct)) + ' %';
    const marks = (cell.mark ? MARK[cell.mark] : '') + (cell.low ? MARK.low : '');
    return { pct, events: fmtEvents(cell.events), marks };
  }

  /** Footnotes for exactly the marks that appear. */
  function notes(t) {
    const out = [];
    out.push(t.value === 'total' ? 'Percentages are of all events.' : 'Percentages are of the parent population.');
    if (t.averaged) out.push('Mean ± SD over each condition’s included wells; events are the mean per well.');
    if (t.flags.low) out.push(MARK.low + ' fewer than ' + LOW_EVENTS + ' events in at least one well: that percentage is imprecise (±10% or worse).');
    if (t.flags.adjusted) out.push(MARK.adjusted + ' the gate was adjusted by hand on at least one of these wells.');
    if (t.flags.inherited) out.push(MARK.inherited + ' moved because a gate above it was adjusted on at least one of these wells.');
    return out;
  }

  const escH = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  /** A plain HTML table with inline styles — what Word, PowerPoint and Google Docs keep on paste. */
  function toHTML(t, opts) {
    opts = opts || {};
    const td = 'style="padding:3px 10px;border-bottom:1px solid #d0d3db;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap"';
    const tl = 'style="padding:3px 10px;border-bottom:1px solid #d0d3db;text-align:left;white-space:nowrap"';
    let h = '<table style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:10pt">';
    h += '<thead><tr><th ' + tl + '>Population</th>' + t.cols.map(c => '<th ' + td + '>' + escH(c.label) + (c.sub ? '<br><span style="font-weight:normal;color:#687087">' + escH(c.sub) + '</span>' : '') + '</th>').join('') + '</tr></thead><tbody>';
    t.rows.forEach(r => {
      h += '<tr><td ' + tl + '>' + '&nbsp;&nbsp;&nbsp;'.repeat(r.depth) + (r.depth ? '└ ' : '') + escH(r.name) + '</td>';
      r.cells.forEach(c => {
        const x = cellText(t, r, c, opts);
        h += '<td ' + td + '>' + (x.pct ? escH(x.pct) + (x.marks ? '<sup>' + escH(x.marks) + '</sup>' : '') + '<br>' : '') +
          '<span style="color:#687087">' + escH(x.events) + ' events</span></td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table>';
    h += '<p style="font-family:Arial,Helvetica,sans-serif;font-size:8pt;color:#687087">' + notes(t).map(escH).join(' ') + '</p>';
    return h;
  }

  /** Rows of plain values for TSV/CSV: one % and one events column per table column. */
  function toRows(t, opts) {
    opts = opts || {};
    const head = ['Population', 'Parent'];
    t.cols.forEach(c => {
      head.push(c.label + ' | %' + (t.averaged ? ' (mean)' : ''));
      if (t.averaged) head.push(c.label + ' | SD');
      head.push(c.label + ' | events' + (t.averaged ? ' (mean per well)' : ''));
      if (t.flags.adjusted || t.flags.inherited || t.flags.low) head.push(c.label + ' | notes');
    });
    const out = [head];
    t.rows.forEach(r => {
      const line = ['  '.repeat(r.depth) + r.name, r.parent];
      r.cells.forEach(c => {
        line.push(r.id == null ? '' : round(c.pct, 3));
        if (t.averaged) line.push(r.id == null || !Number.isFinite(c.sd) ? '' : round(c.sd, 3));
        line.push(Number.isFinite(c.events) ? Math.round(c.events) : '');
        if (t.flags.adjusted || t.flags.inherited || t.flags.low) {
          line.push([c.mark === 'adjusted' ? 'gate adjusted on a well' : c.mark === 'inherited' ? 'moved by an adjustment above' : '',
            c.low ? 'under ' + LOW_EVENTS + ' events' : ''].filter(Boolean).join('; '));
        }
      });
      out.push(line);
    });
    return out;
  }

  function round(v, d) { return Number.isFinite(v) ? Math.round(v * Math.pow(10, d)) / Math.pow(10, d) : ''; }

  /** Tab-separated text: pastes into Excel, Prism and Sheets as cells. */
  function toTSV(rows) {
    return rows.map(r => r.map(v => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
  }

  FM.treeTable = { build, cellText, notes, toHTML, toRows, toTSV, fmtPct, fmtPctSd, fmtEvents, LOW_EVENTS, MARK };
})(FM);
