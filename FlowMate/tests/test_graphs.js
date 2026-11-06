/* The Analysis step's graph model (core/graphs.js) on the synthetic two-group plate. */
(function () {
  function setup() {
    const g = twoGroupWs(400);
    const P = wideRange(g.ws, null, 'Cells');
    const K = g.ws.addGate({ name: 'Bright', parent: P, type: 'range', x: 'FL1-H', xScale: g.ws.scaleSpec('FL1-H'), range: { lo: 2e4, hi: 1e9 } });
    const t = g.ws.addTable('T');
    g.ws.addTableColumn(t, { pop: K, stat: 'freq_parent' });
    const col = g.ws.table(t).columns[0].id;
    return Object.assign(g, { P, K, t, col });
  }

  test('graphs: a new graph plots every condition with wells as a bar graph, all pairs compared', () => {
    const g = setup();
    const src = FM.graphs.sources(g.ws);
    eq(src.length, 1);
    eq(src[0].short, 'Bright, % of parent');
    const spec = FM.graphs.create(g.ws, src[0]);
    eq(spec.kind, 'bar'); eq(spec.error, 'sd'); eq(spec.compare, 'all');
    const r = FM.graphs.compute(g.ws, spec);
    eq(r.shown.map(x => x.name).join(), 'GA,GB');
    eq(r.model.groups[0].values.length, 3, 'three wells in GA');
    eq(r.stats.test.kind, 't');
    const a = ['A1', 'A2', 'A3'].map(k => g.ws.pct(g.ws.sample(k), g.K)), b = ['B1', 'B2', 'B3'].map(k => g.ws.pct(g.ws.sample(k), g.K));
    const ref = FM.groupStats.run({ groups: [{ name: 'GA', values: a }, { name: 'GB', values: b }], compare: 'all' });
    eq(r.stats.test.p, ref.test.p, 'same P as running the test on the wells directly');
    approx(r.model.groups[0].summary.mean, (a[0] + a[1] + a[2]) / 3, 1e-12);
  });

  test('graphs: excluded wells and hidden conditions stay out', () => {
    const g = setup();
    g.ws.setExcluded(['A2'], true);
    const spec = FM.graphs.create(g.ws, { table: g.t, col: g.col });
    eq(FM.graphs.compute(g.ws, spec).model.groups[0].values.length, 2);
    spec.groups = [g.GB];
    const r = FM.graphs.compute(g.ws, spec);
    eq(r.shown.length, 1); eq(r.hidden.map(x => x.name).join(), 'GA');
    eq(r.stats.test, null, 'one condition: nothing to test');
  });

  test('graphs: paired wells match by order, plate row or plate column', () => {
    const g = setup();
    const spec = Object.assign(FM.graphs.create(g.ws, { table: g.t, col: g.col }), { kind: 'paired' });
    let r = FM.graphs.compute(g.ws, spec);
    eq(r.model.sets.length, 3, 'by order: three sets');
    eq(r.stats.test.kind, 'paired-t');
    spec.pairBy = 'col';                         // A1 with B1, A2 with B2 …
    r = FM.graphs.compute(g.ws, spec);
    eq(r.stats.pairs, 3);
    eq(r.model.sets[0][0], g.ws.pct(g.ws.sample('A1'), g.K)); eq(r.model.sets[0][1], g.ws.pct(g.ws.sample('B1'), g.K));
    spec.pairBy = 'row';                         // GA is all row A, GB all row B: nothing matches
    r = FM.graphs.compute(g.ws, spec);
    eq(r.stats.test, null);
    eq(r.notes.filter(n => /more than one well in row A/.test(n)).length, 1, 'says why, once: ' + r.notes.join(' | '));
  });

  test('graphs: a deleted column or table says so', () => {
    const g = setup();
    const spec = FM.graphs.create(g.ws, { table: g.t, col: g.col });
    g.ws.removeTableColumn(g.t, 0);
    assert(/removed/.test(FM.graphs.compute(g.ws, spec).error));
    g.ws.deleteTable(g.t);
    assert(/deleted/.test(FM.graphs.compute(g.ws, spec).error));
  });

  test('graphs: graphs are part of the document, undoable', () => {
    const g = setup();
    const id = g.ws.addGraph(FM.graphs.create(g.ws, { table: g.t, col: g.col }));
    g.ws.updateGraph(id, { kind: 'box' });
    eq(g.ws.graph(id).kind, 'box');
    g.ws.undo();
    eq(g.ws.graph(id).kind, 'bar');
    const doc = g.ws.toJSON();
    eq(doc.graphs.length, 1);
    g.ws.deleteGraph(id);
    eq(g.ws.doc.graphs.length, 0);
    g.ws.loadDoc(doc);
    eq(g.ws.doc.graphs.length, 1, 'restored with the document');
  });

  test('graphs: Send to PlotMate is one Column table with a data set per condition and the same test', () => {
    const g = setup();
    const spec = FM.graphs.create(g.ws, { table: g.t, col: g.col });
    const p = FM.graphs.handoff(g.ws, spec);
    eq(p.tables.length, 1); eq(p.tables[0].kind, 'column');
    eq(p.tables[0].sets.map(s => s.title).join(), 'GA,GB');
    eq(p.suggest[0].analysis, 'ttest'); eq(p.suggest[0].params.unpairedTest, 'student');
  });
})();
