/* Tests for the gating tree table, strategy chains, and publication text (2026-09-26). */

/** A demo plate with its six conditions painted on, and a two-level hierarchy. */
function paintedPlate(n) {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(n || 400));
  FM.synth.DEMO_GROUPS.forEach(g => {
    const id = ws.addGroup(g.name, g.name === 'THP + beads' ? 'control' : g.name === 'THP alone' ? 'gate' : 'sample');
    ws.assign(ws.samples.filter(s => s.well[0] === g.row).map(s => s.key), id);
  });
  const a = ws.addGate({ name: 'A', parent: null, type: 'range', x: 'FSC-H', xScale: ws.scaleSpec('FSC-H'), range: { lo: 0, hi: 1e9 } });
  const b = ws.addGate({ name: 'B', parent: a, type: 'range', x: 'FSC-H', xScale: ws.scaleSpec('FSC-H'), range: { lo: 3e5, hi: 1e9 } });
  return { ws, a, b };
}

function overlap(p, q) { return p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y; }

// ------------------------------------------------------------- tree table
test('tree table: per condition — mean % of parent ± SD and mean events over included wells', () => {
  const { ws, b } = paintedPlate(400);
  ws.setExcluded(['A3'], true, 'test');
  const t = FM.treeTable.build(ws);
  eq(t.rows.map(r => r.name).join(), 'All events,A,B', 'populations in hierarchy order, root first');
  eq(t.rows[2].depth, 2, 'B indented under A');
  eq(t.cols.length, 6, 'one column per condition');
  const igg1 = t.cols.findIndex(c => c.label === 'IgG1');
  eq(t.cols[igg1].samples.length, 2, 'the excluded well is left out');
  const wells = ['A1', 'A2'].map(k => ws.sample(k));
  const pcts = wells.map(s => ws.pct(s, b));
  const cell = t.rows[2].cells[igg1];
  approx(cell.pct, (pcts[0] + pcts[1]) / 2, 1e-12, 'mean % of parent');
  approx(cell.sd, Math.abs(pcts[0] - pcts[1]) / Math.SQRT2, 1e-9, 'sample SD of two values');
  approx(cell.events, (ws.count(wells[0], b) + ws.count(wells[1], b)) / 2, 1e-12, 'mean events per well');
  approx(t.rows[0].cells[igg1].events, 400, 1e-12, 'All events = events acquired');
  const txt = FM.treeTable.cellText(t, t.rows[2], cell);
  assert(/ ± /.test(txt.pct) && / %$/.test(txt.pct), 'cell text carries mean ± SD: ' + txt.pct);
});

test('tree table: per well and one well give exact values; total mode uses all events', () => {
  const { ws, b } = paintedPlate(400);
  const t = FM.treeTable.build(ws, { mode: 'well', value: 'total' });
  eq(t.cols.length, 18);
  const s = ws.sample('B2');
  const i = t.cols.findIndex(c => c.id === 'B2');
  approx(t.rows[2].cells[i].pct, ws.pctOf(s, b, null), 1e-12, '% of all events');
  eq(t.rows[2].cells[i].events, ws.count(s, b));
  assert(!Number.isFinite(t.rows[2].cells[i].sd), 'no SD for a single well');
  const one = FM.treeTable.build(ws, { mode: 'one', sample: 'C1' });
  eq(one.cols.length, 1);
  eq(one.cols[0].label, 'C1');
});

test('tree table: flags thin populations (†) and hand-adjusted gates (✦ / ↳)', () => {
  const { ws, a } = paintedPlate(150);
  ws.setGateOverride(a, 'B2', { range: { lo: 0, hi: 2e5 } });
  const t = FM.treeTable.build(ws);
  const ib = t.cols.findIndex(c => c.label === 'IgG2');
  eq(t.rows[1].cells[ib].mark, 'adjusted', 'A adjusted on a member well');
  eq(t.rows[2].cells[ib].mark, 'inherited', 'B moved by the adjustment above it');
  const ia = t.cols.findIndex(c => c.label === 'IgG1');
  eq(t.rows[1].cells[ia].mark, '', 'another condition is untouched');
  assert(t.flags.low, 'B holds under 100 events somewhere in a 150-event plate');
  const notes = FM.treeTable.notes(t).join(' ');
  assert(/fewer than 100 events/.test(notes) && /adjusted by hand/.test(notes) && /above it/.test(notes), notes);
  const tsv = FM.treeTable.toTSV(FM.treeTable.toRows(t));
  assert(tsv.split('\n').length === 4 && /\t/.test(tsv), 'TSV: header + three populations');
  const html = FM.treeTable.toHTML(t);
  assert(/<table/.test(html) && /✦/.test(html), 'HTML carries the marks');
});

// --------------------------------------------------------------- strategy
test('strategy: steps follow the hierarchy; a branch and a quadrant are one step each', () => {
  const { ws, b } = paintedPlate(200);
  ws.addQuadrant({ parent: b, x: 'FL1-H', y: 'SSC-H', xScale: ws.scaleSpec('FL1-H'), yScale: ws.scaleSpec('SSC-H'), cx: 1e4, cy: 1e4 });
  ws.addGate({ name: 'C2', parent: b, type: 'range', x: 'SSC-H', xScale: ws.scaleSpec('SSC-H'), range: { lo: 0, hi: 1e9 } });
  const st = FM.strategy.steps(ws.doc.gates);
  // root on FSC-H (A), A on FSC-H (B), B on FL1-H × SSC-H (quadrant), B on SSC-H (C2)
  eq(st.length, 4, st.map(s => s.key).join(' '));
  eq(st[0].pop, null);
  eq(st[2].gates.length, 4, 'the quadrant is one step');
  eq(st[2].depth, 2); eq(st[3].depth, 2, 'the branch sits at the same depth');
  const G = FM.strategy.grid(st, new Map(ws.doc.gates.map(g => [g.id, g])));
  const c2 = G.cell.get(st[2].key), c3 = G.cell.get(st[3].key);
  eq(c2.col, c3.col, 'siblings share a column');
  assert(c3.row > c2.row, 'the second branch drops below the first');
});

test('strategy: building lays a chain left → right with a table below, derived arrows, one undo step', () => {
  const { ws, a } = paintedPlate(200);
  const before = ws.undoStack.length;
  ws.addStrategy({ samples: ['A1'], table: true });
  eq(ws.undoStack.length, before + 1, 'one undo step');
  const L = ws.layout();
  const plots = L.items.filter(i => i.kind === 'plot');
  eq(plots.length, 2, 'two steps: root on FSC-H, A on FSC-H');
  assert(plots[1].x > plots[0].x + plots[0].w, 'the second plot is to the right of the first');
  eq(plots[0].y, plots[1].y, 'one row');
  assert(plots[0].head && !plots[1].head, 'the first plot heads the chain');
  const table = L.items.find(i => i.kind === 'table');
  assert(table && table.y >= Math.max(...plots.map(p => p.y + p.h)), 'the table sits below the plots');
  L.items.forEach(it => assert(it.x + it.w <= L.page.w + 0.5 && it.y + it.h <= L.page.h + 0.5, 'on the page'));
  const links = FM.strategy.links(L.items, new Map(ws.doc.gates.map(g => [g.id, g])));
  eq(links.length, 1, 'one arrow');
  eq(links[0].from, plots[0].id); eq(links[0].to, plots[1].id); eq(links[0].gate, a);
  eq(FM.strategy.autoTitle(ws, plots[1]), 'A', 'a chain plot is titled by its population');
  assert(/A1 · IgG1/.test(FM.strategy.autoTitle(ws, plots[0])), 'the head names the well and condition');
  ws.undo();
  eq(ws.layout().items.length, 0, 'undo takes the whole strategy off');
});

test('strategy: a new gate joins the chain in its own undo step; deleting it takes the plot away', () => {
  const { ws, b } = paintedPlate(200);
  ws.addStrategy({ samples: ['A1', 'B1'], table: true });
  const plotsOf = () => ws.layout().items.filter(i => i.kind === 'plot');
  eq(plotsOf().length, 4, 'two chains of two');
  const steps = ws.undoStack.length;
  ws.addGate({ name: 'C', parent: b, type: 'range', x: 'SSC-H', xScale: ws.scaleSpec('SSC-H'), range: { lo: 0, hi: 1e9 } });
  eq(ws.undoStack.length, steps + 1, 'gate and plot are one undo step');
  eq(plotsOf().length, 6, 'each chain gained a plot of B on SSC-H');
  const added = plotsOf().filter(p => p.pop === b);
  eq(added.length, 2);
  const feeder = plotsOf().find(p => p.chain === added[0].chain && p.pop === ws.gate(b).parent);
  assert(added[0].x > feeder.x, 'placed to the right of the plot that feeds it');
  plotsOf().forEach(p => plotsOf().forEach(q => { if (p !== q) assert(!overlap(p, q), 'no two plots overlap'); }));
  const table = ws.layout().items.find(i => i.kind === 'table');
  assert(table.y >= Math.max(...plotsOf().map(p => p.y + p.h)), 'the table is still below everything');
  // a second gate on the same axes adds no plot: it is drawn on the existing one
  ws.addGate({ name: 'C bis', parent: b, type: 'range', x: 'SSC-H', xScale: ws.scaleSpec('SSC-H'), range: { lo: 0, hi: 5 } });
  eq(plotsOf().length, 6, 'same step, no new plot');
  ws.undo(); ws.undo();
  eq(plotsOf().length, 4, 'undo removes the gate and its plots together');
  const c2 = ws.addGate({ name: 'C', parent: b, type: 'range', x: 'SSC-H', xScale: ws.scaleSpec('SSC-H'), range: { lo: 0, hi: 1e9 } });
  eq(plotsOf().length, 6);
  ws.deleteGate(c2);
  eq(plotsOf().length, 4, 'deleting the gate removes the plots that existed for it');
  ws.deleteGate(ws.gate(b).parent);
  eq(plotsOf().length, 2, 'deleting everything leaves the head of each chain');
  assert(plotsOf().every(p => p.head), 'only heads remain');
});

test('strategy: a quadrant adds one plot, tidy restores the chain shape, and ordinary plots are never pruned', () => {
  const { ws, b } = paintedPlate(200);
  ws.addLayoutItems([{ kind: 'plot', sample: 'C1', pop: b, ax: 'FSC-H', ay: 'SSC-H' }]);
  ws.addStrategy({ samples: ['A1'], table: false });
  ws.addQuadrant({ parent: b, x: 'FL1-H', y: 'SSC-H', xScale: ws.scaleSpec('FL1-H'), yScale: ws.scaleSpec('SSC-H'), cx: 1e4, cy: 1e4 });
  const chain = () => ws.layout().items.filter(i => i.chain);
  eq(chain().length, 3, 'root, A and the quadrant step');
  ws.updateLayoutItem(chain()[2].id, { x: 700, y: 600 });
  ws.tidyLayout();
  const c = chain();
  eq(c[0].y, c[1].y); eq(c[1].y, c[2].y, 'tidy puts the chain back on one row');
  assert(c[2].x > c[1].x && c[1].x > c[0].x, 'in order');
  ws.deleteGate(b);
  eq(ws.layout().items.filter(i => !i.chain).length, 1, 'the ordinary plot of a deleted population stays (as a placeholder)');
});

test('strategy: survives a workspace round trip and a preset replacing the gates', () => {
  const { ws } = paintedPlate(200);
  ws.addStrategy({ samples: ['A1'], table: true });
  const saved = JSON.parse(JSON.stringify(ws.toJSON()));
  const ws2 = new FM.Workspace();
  ws2.addSamples(FM.synth.demoPlate(200));
  ws2.loadDoc(saved);
  eq(ws2.layout().items.filter(i => i.chain).length, 2, 'chain kept');
  const p = FM.presets.byId('phagocytosis');
  FM.presets.apply(ws2, p, { mapping: FM.presets.autoMap(p, ws2.paramNames()), layout: false, replace: true });
  const chain = ws2.layout().items.filter(i => i.chain);
  const gatesById = new Map(ws2.doc.gates.map(g => [g.id, g]));
  chain.forEach(it => assert(!it.pop || gatesById.has(it.pop), 'no chain plot points at a replaced gate'));
  assert(chain.length >= 3, 'the chain follows the preset’s hierarchy: ' + chain.length + ' plots');
  eq(FM.strategy.links(ws2.layout().items, gatesById).length, chain.length - 1, 'every plot but the head has an arrow in');
});

// -------------------------------------------------------------- pub text
function pubPlate() {
  const { ws, a, b } = paintedPlate(400);
  ws.addMetric('% B', 'pct("B")');
  return { ws, a, b, res: FM.analysis.analyze(ws, ws.doc.metrics[0].id) };
}

test('legend: names n in wells, the ANOVA + Tukey test, the star scale, the gate control', () => {
  const { ws, res } = pubPlate();
  const L = FM.pubtext.legend(ws, res, { brackets: 'all' });
  assert(/mean ± SD of n = 3 replicate wells per condition/.test(L), L);
  assert(/one-way ANOVA \(F\(4, 10\) = [\d.]+, p [=<>] /.test(L), 'ANOVA with its F and df: ' + L);
  assert(/Tukey’s multiple comparisons test; p values are adjusted/.test(L), L);
  assert(/\*\*\*\*, p ≤ 0\.0001/.test(L), 'GraphPad scale by default');
  assert(/THP alone wells set the positive gate/.test(L), L);
  assert(!/Only significant/.test(L), 'all brackets shown: no "only significant" note');
  const bio = FM.pubtext.legend(ws, res, { replicates: 'bio', errorBars: 'sem', pStyle: 'apa' });
  assert(/mean ± SEM of n = 3 independent biological replicates/.test(bio), bio);
  assert(!/\*\*\*\*/.test(bio), 'APA stops at three stars');
  const M = FM.pubtext.methods(ws, res);
  assert(/A median of 400 events was recorded per well/.test(M), M);
  assert(/not the individual event/.test(M), 'the statistical unit is stated');
  assert(/One gate set was applied identically to every well/.test(M), M);
});

test('legend: two conditions are a t-test; exclusions and hand adjustments are disclosed', () => {
  const { ws, a } = pubPlate();
  // keep only two tested conditions
  ws.doc.groups.slice(2).forEach(g => { if (g.role !== 'gate') ws.updateGroup(g.id, { role: 'gate' }); });
  ws.setExcluded(['A3'], true, 'bubble');
  ws.setGateOverride(a, 'B2', { range: { lo: 0, hi: 5e8 } });
  const res = FM.analysis.analyze(ws, ws.doc.metrics[0].id);
  const L = FM.pubtext.legend(ws, res);
  assert(/two-tailed unpaired Student’s t-test/.test(L), L);
  assert(/Well A3 \(bubble\) was excluded/.test(L), L);
  assert(/adjusted by hand for B2 \(A\)/.test(L), 'the adjustment is named in the legend: ' + L);
  assert(/except that 1 gate was adjusted by hand for B2/.test(FM.pubtext.methods(ws, res)), 'and withdrawn from the methods claim');
});

test('brackets: shortest spans first, each clear of the marks and brackets it spans', () => {
  const tops = [100, 80, 120];
  const out = FM.pubtext.stackBrackets([{ i: 0, j: 2 }, { i: 0, j: 1 }, { i: 1, j: 2 }], tops, 20, 10);
  const by = k => out.find(o => o.i === k[0] && o.j === k[1]);
  eq(by([0, 1]).y, 70, 'above the taller of its two bars');
  eq(by([1, 2]).y, 50, 'overlaps [0,1] at bar 1, so one step above it');
  eq(by([0, 2]).y, 30, 'the long bracket clears both');
  const apart = FM.pubtext.stackBrackets([{ i: 0, j: 1 }, { i: 2, j: 3 }], [100, 100, 100, 100], 20, 10);
  eq(apart[0].y, apart[1].y, 'brackets that do not overlap share a level');
});
