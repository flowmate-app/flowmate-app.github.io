/* The gating table: every population's number in every well, in one grid.
 *
 * Its job is to make a hand adjustment's reach visible. A gate belongs to the whole plate,
 * so a healthy column reads flat; where it does not, the cell says whether *this* gate was
 * dragged here (✦) or whether it simply moved because a gate above it was (↳), which is the
 * thing a plain grid of percentages hides. Δ mode puts a number on both.
 */
(function (FM) {
  'use strict';
  const { h, icon, clear, menu, toast } = FM.dom;

  const MARK = { adjusted: '✦', inherited: '↳', shared: '' };

  function fmt(v, mode) {
    if (!Number.isFinite(v)) return '—';
    if (mode === 'count') return FM.dom.fmtCount(v);
    return v >= 99.95 ? '100' : v.toFixed(v < 10 ? 2 : 1);
  }
  function fmtDelta(v, mode) {
    if (!Number.isFinite(v) || Math.abs(v) < 5e-3) return '';
    const s = mode === 'count' ? FM.dom.fmtCount(Math.abs(Math.round(v))) : Math.abs(v).toFixed(Math.abs(v) < 10 ? 2 : 1);
    return (v > 0 ? '+' : '−') + s;
  }

  /** Median and spread of a column, so a flat gate reads as flat at a glance. */
  function columnStat(t, i) {
    const vals = t.rows.filter(r => !r.excluded).map(r => r.cells[i].value).filter(Number.isFinite);
    if (!vals.length) return null;
    return { med: FM.stats.median(vals), lo: Math.min(...vals), hi: Math.max(...vals) };
  }

  /**
   * opts: { onPick(sampleKey, gateId), mode, delta, onMode(mode), onDelta(bool) }
   * Returns the built table element; the caller owns the host.
   */
  function render(host, opts) {
    const ws = FM.ws;
    opts = opts || {};
    const mode = opts.mode || 'parent';
    const showDelta = !!opts.delta;
    clear(host);
    if (!ws.doc.gates.length) {
      host.appendChild(h('div.gt-empty.muted', 'Draw a gate and every well’s number appears here, side by side.'));
      return host;
    }
    const t = FM.summary.build(ws, { mode });
    const cur = FM.ui.sampleKey;

    const grid = h('table.gt');
    const cols = h('colgroup', h('col.gt-c-well'), h('col.gt-c-cond'), t.gates.map(() => h('col')));
    grid.appendChild(cols);

    // ---- header: the hierarchy, indented so the chain is readable
    const hr = h('tr', h('th.gt-well.gt-corner', 'Well'), h('th.gt-cond.gt-corner', 'Condition'));
    t.gates.forEach((g, i) => {
      const adj = ws.adjustedWells(g.id);
      hr.appendChild(h('th.gt-h', { 'data-tip': ws.popName(g.id) + ' of ' + ws.popName(g.parent) + (adj.length ? ' · adjusted on ' + adj.join(', ') : '') },
        h('div.gt-hname',
          // depth as leading dots: the chain stays readable over right-aligned numbers
          t.depths[i] ? h('span.gt-ind', '·'.repeat(t.depths[i])) : null,
          h('span.gt-hn', g.name),
          adj.length ? h('span.gt-hadj', MARK.adjusted + adj.length) : null)));
    });
    // the sub-row names each gate's parent, so "% of parent" is never ambiguous
    const sub = h('tr.gt-sub', h('th.gt-corner', ''), h('th.gt-corner', ''),
      t.gates.map(g => h('th.gt-h2', mode === 'count' ? 'events' : mode === 'total' ? 'of all events' : 'of ' + ws.popName(g.parent))));
    // the median rides in the header, not a footer: always on screen, and every row below
    // is read against it — an uneven column shows up without reading a single number twice
    const med = h('tr.gt-med', h('th.gt-corner.gt-well', 'Median'), h('th.gt-corner.gt-cond', 'included wells'));
    t.gates.forEach((g, i) => {
      const st = columnStat(t, i);
      med.appendChild(h('th.gt-v', st ? { 'data-tip': 'Median of the wells not excluded · range ' + fmt(st.lo, mode) + ' – ' + fmt(st.hi, mode) } : {},
        st ? h('span.gt-num', fmt(st.med, mode)) : '—',
        st ? h('span.gt-range', fmt(st.lo, mode) + '–' + fmt(st.hi, mode)) : null));
    });
    grid.appendChild(h('thead', hr, sub, med));

    // ---- one row per well, grouped by condition
    const body = h('tbody');
    let lastG = '\u0000';
    t.rows.forEach(r => {
      const gid = r.group ? r.group.id : null;
      if (gid !== lastG) {
        lastG = gid;
        body.appendChild(h('tr.gt-grp', h('td', { colspan: 2 + t.gates.length },
          h('span.swatch', { style: { background: r.group ? r.group.color : 'var(--faint)' } }),
          r.group ? r.group.name : 'No condition')));
      }
      const tr = h('tr.gt-row' + (r.sample.key === cur ? '.cur' : '') + (r.excluded ? '.excl' : ''));
      tr.appendChild(h('td.gt-well.mono', r.sample.well || r.sample.name));
      tr.appendChild(h('td.gt-cond', r.group ? r.group.name : '—'));
      r.cells.forEach(c => {
        const d = showDelta ? fmtDelta(c.delta, mode) : '';
        const tip = c.status === 'shared' ? null
          : (c.status === 'adjusted' ? 'This gate was adjusted on this well. ' : 'A gate above this one was adjusted on this well, so this number moved with it. ')
            + 'On the shared gating it would read ' + fmt(c.shared, mode) + (mode === 'count' ? ' events' : '%') + '.';
        tr.appendChild(h('td.gt-v.mono.st-' + c.status, { 'data-tip': tip, tabindex: 0,
          on: { click: () => opts.onPick && opts.onPick(r.sample.key, c.gate.id),
            keydown: e => { if (e.key === 'Enter') opts.onPick && opts.onPick(r.sample.key, c.gate.id); } } },
          h('span.gt-mark', MARK[c.status]),
          h('span.gt-num', fmt(c.value, mode)),
          d ? h('span.gt-d' + (c.delta > 0 ? '.up' : '.down'), d) : null));
      });
      body.appendChild(tr);
    });
    grid.appendChild(body);
    host.appendChild(grid);
    if (t.anyAdjusted) {
      host.appendChild(h('div.gt-legend',
        h('span', h('b.st-adjusted', MARK.adjusted), ' this gate was adjusted on that well'),
        h('span', h('b.st-inherited', MARK.inherited), ' moved because a gate above it was adjusted — the knock-on effect'),
        showDelta ? h('span.muted', 'The second number is the difference from the shared gating.') : null));
    }
    return host;
  }

  /** Controls for the table, rendered by the view into its panel header. */
  function controls(opts) {
    const mode = opts.mode || 'parent';
    const label = { parent: '% of parent', total: '% of all events', count: 'Events' }[mode];
    return [
      h('button.btn.ghost.sm', { 'data-tip': 'What the numbers show', on: { click: e => menu(e.currentTarget, [
        { label: '% of parent', hint: mode === 'parent' ? '✓' : '', fn: () => opts.onMode('parent') },
        { label: '% of all events', hint: mode === 'total' ? '✓' : '', fn: () => opts.onMode('total') },
        { label: 'Events', hint: mode === 'count' ? '✓' : '', fn: () => opts.onMode('count') },
      ]) } }, label, icon('down')),
      h('button.btn.sm' + (opts.delta ? '.on' : ''), {
        'data-tip': 'Show how far each well is from what it would read with no adjustments at all',
        disabled: !FM.ws.anyAdjusted(), 'aria-pressed': opts.delta ? 'true' : 'false',
        on: { click: () => opts.onDelta(!opts.delta) },
      }, 'Δ vs shared'),
      h('button.btn.ghost.sm.icon', { 'data-tip': 'Save this table as CSV', on: { click: () => exportCSV(opts.mode) } }, icon('download')),
    ];
  }

  function exportCSV(mode) {
    const ws = FM.ws;
    if (!ws.doc.gates.length) return;
    const rows = FM.summary.toRows(FM.summary.build(ws, { mode: mode || 'parent' }));
    FM.io.downloadCSV(ws.doc.name + ' gating table', rows);
    toast('Gating table saved');
  }

  FM.gateTable = { render, controls, exportCSV, fmt, fmtDelta, MARK };
})(FM);
