/* Analysis: graphs you make on purpose. One graph is one Measure column by condition — bar, dot,
 * box or paired — with SD or SEM and the comparisons already tested (core/graphs.js). Nothing is
 * drawn until you ask for it; the left panel lists the graphs made so far. */
(function (FM) {
  'use strict';
  const { h, icon, clear, toast, menu } = FM.dom;
  const W = () => FM.ws;
  const G = () => FM.graphs;

  let root = null, els = {};

  function mount(el) {
    root = el;
    clear(root);
    if (!W().samples.length) {
      root.appendChild(h('div.empty', FM.brand.miniCell(), h('h2', 'No files yet'), h('p', 'Load FCS files, gate them and measure something — then graph it here.'),
        h('button.btn.primary', { on: { click: () => FM.go('load') } }, 'Go to Load')));
      return;
    }
    els = { list: h('div.tbv-list.anv-list'), main: h('section.panel.anv-main') };
    root.appendChild(h('div.tbv-wrap.anv-wrap',
      h('aside.panel.tbv-side', h('div.panel-head', h('h3', 'Graphs'), h('span.grow'),
        h('button.btn.ghost.sm.anv-new-side', { disabled: !G().sources(W()).length, on: { click: () => newGraph() } }, icon('plus'), 'Graph')),
        h('div.scroll', els.list)),
      els.main));
    render();
  }

  function current() {
    const graphs = W().doc.graphs || [];
    let g = FM.ui.graphId && W().graph(FM.ui.graphId);
    if (!g && graphs.length) { g = graphs[graphs.length - 1]; FM.ui.graphId = g.id; }
    return g || null;
  }

  function newGraph(src) {
    const ws = W();
    const s = src || G().sources(ws)[0];
    if (!s) return;
    FM.ui.graphId = ws.addGraph(G().create(ws, s));
  }

  function render() {
    if (!root || !els.list) return;
    renderList();
    renderMain();
  }

  const KIND_ICON = { bar: 'chart', dot: 'grid', box: 'hist', paired: 'strategy' };
  function graphName(ws, g) {
    if (g.name) return g.name;
    const r = G().compute(ws, g);
    return r.error ? 'Graph' : r.yLabel;
  }

  function renderList() {
    const ws = W();
    clear(els.list);
    const items = (ws.doc.graphs || []).map(g => {
      const on = FM.ui.graphId === g.id;
      return h('button.tbv-item' + (on ? '.on' : ''), {
        'data-id': g.id,
        on: { click: () => { FM.ui.graphId = g.id; render(); }, contextmenu: e => { e.preventDefault(); graphMenu(g, { x: e.clientX, y: e.clientY }); } },
      }, icon(KIND_ICON[g.kind] || 'chart'), h('span.grow.tbv-name', graphName(ws, g)));
    });
    items.forEach(el => els.list.appendChild(el));
    FM.dom.sortable(items, (from, to) => ws.moveGraph(from, to), { axis: 'y' });
    if (!(ws.doc.graphs || []).length) els.list.appendChild(h('div.muted.small.pad', 'No graphs yet.'));
  }

  function graphMenu(g, anchor) {
    const ws = W();
    menu(anchor, [
      { label: 'Duplicate', icon: 'copy', fn: () => { const c = Object.assign({}, g); delete c.id; FM.ui.graphId = ws.addGraph(c); } },
      { label: 'Delete', icon: 'trash', danger: true, fn: () => { ws.deleteGraph(g.id); toast('Deleted the graph', { action: { label: 'Undo', fn: () => ws.undo() } }); } },
    ]);
  }

  // ---------------------------------------------------------------- main
  function renderMain() {
    const ws = W();
    clear(els.main);
    const sources = G().sources(ws);
    const g = current();
    if (!g) { els.main.appendChild(emptyState(sources)); return; }
    const r = G().compute(ws, g);
    const set = patch => ws.updateGraph(g.id, patch);

    // ---- title and exports
    // the title is drawn above the graph (and names it in the list); empty: no title on the graph
    const name = h('input.input.tbv-title.anv-title', { value: g.name || '', placeholder: 'Add a title…', 'aria-label': 'Graph title', 'data-tip': 'Shown above the graph and in the exported picture',
      on: { change: e => set({ name: e.target.value.trim() }) } });
    const svg = r.error ? null : FM.statChart.render(r.model);
    const fileName = () => FM.io.safeName(ws.doc.name + ' - ' + graphName(ws, g));
    els.main.appendChild(h('div.tbv-head.anv-head', name, h('span.grow'),
      h('button.btn.sm', { disabled: !svg, 'data-tip': 'Copy the graph as a picture, to paste into a slide or document', on: { click: () => copyImage(svg) } }, icon('copy'), 'Copy image'),
      h('button.btn.sm', { disabled: !svg, on: { click: () => FM.statChart.toPNG(svg, 3).then(b => { FM.dom.download(fileName() + '.png', b); toast('Saved ' + fileName() + '.png'); }) } }, icon('download'), 'PNG'),
      h('button.btn.sm', { disabled: !svg, 'data-tip': 'For Illustrator or Inkscape', on: { click: () => { FM.dom.download(fileName() + '.svg', FM.statChart.toSVGString(svg), 'image/svg+xml'); toast('Saved ' + fileName() + '.svg'); } } }, icon('download'), 'SVG'),
      h('button.btn.ghost.sm.icon', { 'data-tip': 'More', 'aria-label': 'More', on: { click: e => graphMenu(g, e.currentTarget) } }, icon('more'))));

    // ---- the sentence: Plot [column] by condition, as [kind], error bars [SD|SEM], compare [...]
    const srcSel = h('select.input.sm.anv-src', { 'aria-label': 'Column to plot', on: { change: e => { const [table, col] = e.target.value.split('|'); set({ src: { table, col }, yLabel: '' }); } } },
      r.error ? h('option', { value: '', selected: true }, '— pick a column —') : null,
      sources.map(s => h('option', { value: s.table + '|' + s.col, selected: !r.error && s.table === g.src.table && s.col === g.src.col }, s.label)));
    const kindSeg = seg('anv-kind', G().KINDS, g.kind, v => set({ kind: v }));
    const errSeg = seg('anv-err', [{ id: 'sd', label: 'SD', tip: 'Standard deviation: how spread out the wells are' }, { id: 'sem', label: 'SEM', tip: 'Standard error of the mean: how precisely the mean is known' }], g.error, v => set({ error: v }));
    const shown = r.error ? [] : r.shown;
    const cmpVal = g.compare === 'control' ? 'vs:' + g.control : g.compare;
    const cmpSel = h('select.input.sm.anv-cmp', { 'aria-label': 'Comparisons', on: { change: e => {
      const v = e.target.value;
      if (v.startsWith('vs:')) set({ compare: 'control', control: v.slice(3) }); else set({ compare: v });
    } } },
      h('option', { value: 'all', selected: cmpVal === 'all' }, 'all pairs'),
      shown.map(x => h('option', { value: 'vs:' + x.id, selected: cmpVal === 'vs:' + x.id }, 'each vs ' + x.name)),
      h('option', { value: 'none', selected: cmpVal === 'none' }, 'nothing (no test)'));
    // what one n is: a well (the replicate), or every cell, nested in its well
    const unit = g.unit === 'cell' ? 'cell' : 'well';
    const cellsWhy = r.error ? null : r.cellsWhy;
    const unitSeg = h('div.seg.sm.anv-unit', { role: 'group' }, [
      { id: 'well', label: 'wells', tip: 'Each well is one value (n = number of wells). The standard choice: wells are the independent replicates.' },
      { id: 'cell', label: 'cells (nested)', tip: cellsWhy || 'Test every cell of every well. Cells of one well are not independent, so the well is a random effect in a mixed model (nested t test / nested one-way ANOVA, as in Prism): n for the test is still the wells, and the cells sharpen each well’s estimate.' },
    ].map(o => h('button' + (unit === o.id ? '.on' : ''), { 'aria-pressed': unit === o.id ? 'true' : 'false', 'data-tip': o.tip,
      disabled: o.id === 'cell' && !!cellsWhy && unit !== 'cell',
      on: { click: () => { if (unit !== o.id) set({ unit: o.id }); } } }, o.label)));
    els.main.appendChild(h('div.anv-sentence',
      h('span.anv-w', 'Plot'), srcSel, h('span.anv-w', 'by condition, as'), kindSeg,
      g.kind === 'bar' || g.kind === 'dot' ? [h('span.anv-w', 'error bars'), errSeg] : null,
      h('span.anv-w', 'and compare'), cmpSel, h('span.anv-w', 'testing'), unitSeg));

    if (r.error) {
      els.main.appendChild(h('div.note.anv-broken', icon('alert'), h('span', r.error + ' Pick another column above.')));
      return;
    }

    // ---- conditions and display options
    els.main.appendChild(h('div.anv-opts', conditionChips(g, r),
      h('span.grow'),
      g.kind === 'paired' ? h('label.anv-opt', h('span.muted.small', 'Match wells by'), h('select.input.sm.anv-pairby', { on: { change: e => set({ pairBy: e.target.value }) } },
        G().PAIR_BY.map(p => h('option', { value: p.id, selected: g.pairBy === p.id, title: p.tip }, p.label)))) : null,
      h('label.anv-opt.anv-showvals', { 'data-tip': 'Write each condition’s ' + (g.kind === 'box' ? 'median' : 'mean') + ' over its ' + (g.kind === 'bar' ? 'bar' : 'data') },
        h('input', { type: 'checkbox', checked: !!g.showValues, on: { change: e => set({ showValues: e.target.checked }) } }), h('span.small', 'Show values')),
      h('label.anv-opt.anv-showns', { 'data-tip': 'Draw a bracket for every comparison, not only P < 0.05' },
        h('input', { type: 'checkbox', checked: !!g.showNs, on: { change: e => set({ showNs: e.target.checked }) } }), h('span.small', 'Show ns')),
      seg('anv-ptext', [{ id: 'stars', label: 'Stars', tip: '* P ≤ 0.05, ** ≤ 0.01, *** ≤ 0.001, **** ≤ 0.0001 (GraphPad style)' }, { id: 'exact', label: 'P values', tip: 'Print the P value on each bracket' }], g.pText, v => set({ pText: v })),
      h('input.input.sm.anv-ylabel', { value: g.yLabel || '', placeholder: 'Y axis: ' + r.label, 'aria-label': 'Y axis title', on: { change: e => set({ yLabel: e.target.value.trim() }) } })));

    // ---- the graph and its numbers
    // draw a little larger than the graph's paper size: its text stays readable on screen
    if (svg) svg.style.width = Math.round(+svg.getAttribute('width') * 1.3) + 'px';
    const fig = h('div.anv-fig', shown.length ? svg : h('div.empty', h('h2', 'No conditions on the graph'), h('p', 'Add one below the sentence, or assign wells to conditions on the Plate step.')));
    els.main.appendChild(h('div.anv-body', fig, results(g, r)));
  }

  function seg(cls, opts, val, fn) {
    return h('div.seg.sm.' + cls, { role: 'group' }, opts.map(o => h('button' + (val === o.id ? '.on' : ''), {
      'aria-pressed': val === o.id ? 'true' : 'false', 'data-tip': o.tip, on: { click: () => { if (val !== o.id) fn(o.id); } },
    }, o.label)));
  }

  /** Chips for the conditions on the graph (reorder, remove) and the ones you can add back. */
  function conditionChips(g, r) {
    const ws = W();
    const ids = r.shown.map(x => x.id);
    const setIds = next => ws.updateGraph(g.id, { groups: next });
    const move = (i, d) => { const n = ids.slice(); const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setIds(n); };
    const counts = {};
    r.model.groups.forEach((m, i) => { counts[ids[i]] = m.values.length; });
    const chips = r.shown.map(x => h('span.anv-chip', { title: x.name + ' · n = ' + counts[x.id] + ' — drag to reorder' },
      h('span.anv-sw', { style: { background: x.color } }), h('span.anv-cn', x.name), h('span.mono.muted.small', 'n=' + counts[x.id]),
      h('button.btn.ghost.sm.icon.anv-hide', { 'data-tip': 'Leave out of the graph', on: { click: () => setIds(ids.filter(id => id !== x.id)) } }, icon('x'))));
    FM.dom.sortable(chips, (from, to) => move(from, to - from));
    const addable = r.hidden.filter(x => ws.samplesIn(x.id).length);
    const add = addable.length ? h('button.btn.ghost.sm.anv-add', { on: { click: e => menu(e.currentTarget, addable.map(x => ({
      label: x.name + (x.role === 'gate' ? ' (gate control)' : ''), fn: () => setIds(ids.concat([x.id])) }))) } }, icon('plus'), 'Condition') : null;
    return h('div.anv-chips', chips, add);
  }

  const num = v => (Number.isFinite(v) ? (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : String(Number(v.toPrecision(4)))) : '—');

  /** The test, the comparisons and the numbers per condition, under the graph's own words. */
  function results(g, r) {
    const st = r.stats;
    const P = FM.groupStats;
    const box = g.kind === 'box';
    const parts = [];
    if (st.test) {
      parts.push(h('div.anv-test', h('div.eyebrow', 'Test'), h('div.anv-testline', st.test.text),
        st.method && st.comparisons.length > 1 ? h('div.muted.small', 'Comparisons: ' + st.method + ' (adjusted P)') : null,
        st.fit ? h('div.muted.small.anv-nestline', st.fit.cells.toLocaleString('en-US') + ' cells in ' + st.fit.wells + ' wells · ' + num(st.fit.pctBetweenWells) +
          '% of the cell-to-cell variation is between wells' + (st.fit.nesting.p < 0.05 ? ' (significant, P ' + (P.pText(st.fit.nesting.p)[0] === '<' ? '< ' + P.pText(st.fit.nesting.p).slice(1) :'= ' + P.pText(st.fit.nesting.p)) + ': wells differ more than their cells explain — nesting matters)' : '')) : null));
      if (st.comparisons.length) {
        parts.push(h('table.tbl.anv-tbl.anv-cmp-tbl',
          h('thead', h('tr', h('th', 'Comparison'), h('th.r', r.nested && r.cellScale === 'log' ? 'Diff. (log10)' : 'Mean diff.'), h('th.r', 'P'), h('th', ''))),
          h('tbody', st.comparisons.map(c => h('tr' + (c.p <= 0.05 ? '.sig' : ''), h('td', c.label), h('td.r.mono', num(c.diff)), h('td.r.mono', P.pText(c.p)), h('td.mono', c.stars))))));
      }
    } else parts.push(h('div.anv-test', h('div.eyebrow', 'Test'), h('div.muted.small', 'No test: it needs at least two conditions with two or more values each.')));
    parts.push(h('table.tbl.anv-tbl.anv-sum-tbl',
      h('thead', h('tr', h('th', 'Condition'), h('th.r', 'n'), r.nested ? h('th.r', 'Cells') : null, box ? [h('th.r', 'Median'), h('th.r', 'Q1'), h('th.r', 'Q3')] : [h('th.r', 'Mean'), h('th.r', 'SD'), h('th.r', 'SEM')])),
      h('tbody', st.summary.map(s => h('tr', h('td', s.name), h('td.r.mono', String(s.n)), r.nested ? h('td.r.mono', s.cells.toLocaleString('en-US')) : null,
        box ? [h('td.r.mono', num(s.median)), h('td.r.mono', num(s.q1)), h('td.r.mono', num(s.q3))] : [h('td.r.mono', num(s.mean)), h('td.r.mono', num(s.sd)), h('td.r.mono', num(s.sem))])))));
    if (r.notes.length) parts.push(h('div.anv-notes', r.notes.map(n => h('div.note.small', icon('info'), h('span', n)))));
    if (r.nested) parts.push(h('div.anv-how.muted.small', 'Each dot on the graph is a well; the test uses every cell, nested in its well: a linear mixed model with the well as a random effect (REML), so the wells — not the cells — are the replicates. ' +
      'Two conditions: nested t test; three or more: nested one-way ANOVA' + (g.compare === 'none' ? '' : ', then ' + (g.compare === 'control' ? 'Dunnett' : 'Tukey')) + ', as in GraphPad Prism. ' +
      (r.cellScale === 'log' ? 'Cells are tested on log10 of ' + r.col.param + ', the scale a median or geometric mean lives on.' : 'Cells are tested on their ' + r.col.param + ' values.')));
    else parts.push(h('div.anv-how.muted.small', 'Each well is one value. Two conditions: ' + (g.kind === 'paired' ? 'paired' : 'unpaired') + ' t test; three or more: ' +
      (g.kind === 'paired' ? 'repeated-measures one-way ANOVA (Geisser–Greenhouse)' : 'one-way ANOVA') + (g.compare === 'none' ? '.' : ', then ' + (g.compare === 'control' ? 'Dunnett' : 'Tukey') + '. ') +
      'The same tests as GraphPad Prism, with the same results.'));
    return h('aside.anv-res', parts);
  }

  async function copyImage(svg) {
    try {
      const blob = await FM.statChart.toPNG(svg, 3);
      await FM.io.copyImage(blob);
      toast('Graph copied — paste it into a slide or document');
    } catch (_) { toast('The browser blocked copying a picture — use PNG instead', { level: 'crit' }); }
  }

  function emptyState(sources) {
    const ws = W();
    if (!sources.length) {
      return h('div.empty', FM.brand.miniCell(), h('h2', 'Measure something first'),
        h('p', 'A graph plots one measurement — a column of a Measure table, like % positive, a geometric mean or a formula — for every well, grouped by condition.'),
        h('button.btn.primary', { on: { click: () => FM.go('measure') } }, 'Go to Measure'));
    }
    const noConditions = !G().defaultGroups(ws).length;
    return h('div.empty.anv-empty', FM.brand.miniCell(), h('h2', 'Make a graph'),
      h('p', 'Pick one measurement and compare the conditions: bar, dot, box or paired, with SD or SEM, and the P values worked out for you. Nothing is drawn until you ask.'),
      noConditions ? h('div.note.small', icon('info'), h('span', 'Your wells are not in conditions yet — assign them on the Plate step so the graph can group them.')) : null,
      h('div.row',
        h('button.btn.primary.anv-new', { on: { click: () => newGraph() } }, icon('plus'), 'New graph'),
        noConditions ? h('button.btn', { on: { click: () => FM.go('plate') } }, 'Go to Plate') : null));
  }

  let pending = null;
  function update(kind) {
    if (!root) return;
    if (kind === 'ws:samples') { mount(root); return; }
    if (kind.startsWith('ws:')) {
      if (pending) return;
      pending = FM.dom.frame(() => { pending = null; if (root) render(); });
    }
  }

  FM.views = FM.views || {};
  FM.views.analysis = { mount, update, unmount() { root = null; els = {}; }, _new: newGraph, _current: current };
})(FM);
