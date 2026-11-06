/* The FlowJo import defects the external QA found (tests/external_qa/REPORT.md, Oct 2026), each on
 * synthetic data built for the test — never on the QA's data sets, which stay for re-validation. */
(function () {
  const tcell = () => FM.examples.tcell;
  /** The example's nine tubes, with one channel renamed in the files (and its matrix). */
  function samplesRenamed(from, to) {
    const list = tcell().samples();
    list.forEach(s => {
      s.params.forEach(p => { if (p.name === from) p.name = to; });
      s.data[to] = s.data[from]; delete s.data[from];
      if (s.spill) s.spill.params = s.spill.params.map(p => (p === from ? to : p));
    });
    return list;
  }
  function countsOf(ws, rep) {
    const out = {};
    ws.samples.forEach(s => Object.keys(rep.paths).forEach(path => { out[s.name + '|' + path] = ws.count(s, rep.paths[path]); }));
    return out;
  }

  test('flowjo fix #1: a channel FlowJo wrote with "_" for "/" maps back — compensated, same counts', () => {
    const base = new FM.Workspace();
    const baseList = tcell().samples();
    base.addSamples(baseList);
    const baseRep = FM.wsp.importInto(base, tcell().workspace(baseList));
    // the same experiment, but the PE channel is "PE/Cy5-A" in the files; FlowJo writes it "PE_Cy5-A"
    const ws = new FM.Workspace();
    const list = samplesRenamed('PE-A', 'PE/Cy5-A');
    ws.addSamples(list);
    const text = tcell().workspace(tcell().samples()).split('PE-A').join('PE_Cy5-A');
    assert(text.indexOf('PE_Cy5-A') > 0 && text.indexOf('PE/Cy5-A') < 0, 'the workspace uses FlowJo’s form');
    const rep = FM.wsp.importInto(ws, text);
    eq(rep.compensatedSamples, baseRep.compensatedSamples, 'every sample compensated as before');
    assert(rep.compensatedSamples > 0, 'and some are');
    const cd4 = ws.gate(rep.paths['Lymphocytes/Single Cells/CD3+/CD4+']);
    eq(cd4.x, 'PE/Cy5-A', 'the gate is on the files’ channel');
    const a = countsOf(base, baseRep), b = countsOf(ws, rep);
    Object.keys(a).forEach(k => assert(Object.is(b[k], a[k]), k + ': ' + b[k] + ' vs ' + a[k]));
    assert(rep.warnings.some(w => /mapped back/.test(w) && /PE\/Cy5-A/.test(w)), 'the report says so');
  });

  const LIN = { type: 'lin', min: 0, max: 1024 };
  const sampleWith = (comp, transforms) => ({ transforms: transforms || {}, comp });
  const COMP = { prefix: 'Comp-', suffix: '', params: ['X', 'Y'] };

  test('flowjo fix #3: a rectangle edge at or below the axis floor is open (FlowJo tests on the axis)', () => {
    const node = { gate: { type: 'rect', dims: [{ name: 'X', comped: true, min: -50, max: 900 }, { name: 'Y', comped: true, min: 100, max: 500 }] } };
    const g = FM.wsp._toGate(node, sampleWith(COMP, { 'Comp-X': LIN, 'Comp-Y': LIN }));
    eq(g.rect.x0, null, 'below the floor: open');
    eq(g.rect.y0, 100, 'above the floor: kept');
    eq(g.rect.x1, 900); eq(g.rect.y1, 500);
    const atFloor = FM.wsp._toGate({ gate: { type: 'rect', dims: [{ name: 'X', comped: true, min: 0, max: 900 }] } }, sampleWith(COMP, { 'Comp-X': LIN }));
    eq(atFloor.type, 'range'); eq(atFloor.range.lo, null, 'exactly on the floor: open too');
    // and the engine then takes in the events below the floor
    const ws = new FM.Workspace();
    const n = 6;
    const xs = Float32Array.from([-30, -5, 0, 50, 950, 400]);
    ws.addSamples([{ name: 's.fcs', version: 'FCS3.1', meta: {}, n, params: [{ name: 'X', label: '', range: 1024 }], data: { X: xs }, spill: null, acqTime: null, cytometer: '' }]);
    const id = ws.addGate(Object.assign({ name: 'G', parent: null }, atFloor));
    eq(ws.count(ws.samples[0], id), 5, 'every event below 900, the negative ones included');
  });

  test('flowjo fix #4: a gate on uncompensated channels is evaluated on the uncompensated values', () => {
    const g = FM.wsp._toGate({ gate: { type: 'rect', dims: [{ name: 'X', comped: false, min: 10, max: 100 }, { name: 'Y', comped: true, min: 10, max: 100 }] } },
      sampleWith(COMP, { X: LIN, 'Comp-Y': LIN }));
    eq(JSON.stringify(g.uncomp), '["x"]', 'only the axis drawn without "Comp-"');
    const none = FM.wsp._toGate({ gate: { type: 'rect', dims: [{ name: 'X', comped: false, min: 10, max: 100 }] } }, sampleWith(null, { X: LIN }));
    eq(none.uncomp, undefined, 'no matrix: nothing to undo');
    // engine: a tube with a strong spillover; the raw-channel gate counts the raw values
    const list = tcell().samples();
    const ws = new FM.Workspace();
    ws.addSamples(list);
    const s = ws.samples.find(x => x.spill);
    assert(s && s.compensated, 'a compensated tube');
    const p = s.spill.params[0], q = s.spill.params[1];
    // a threshold inside the data: the 70th percentile of the raw values
    const cut = Float64Array.from(s.raw[p]).sort()[Math.floor(0.7 * s.n)];
    const gate = { name: 'Raw', parent: null, type: 'rect', x: p, y: q, xScale: ws.scaleSpec(p), yScale: ws.scaleSpec(q), openMax: true,
      rect: { x0: cut, x1: 1e9, y0: -1e9, y1: 1e9 } };
    const onRaw = ws.addGate(Object.assign({}, gate, { uncomp: ['x', 'y'] }));
    const onComp = ws.addGate(Object.assign({}, gate, { name: 'Comp' }));
    let raw = 0, comp = 0;
    for (let e = 0; e < s.n; e++) { if (s.raw[p][e] >= cut) raw++; if (s.data[p][e] >= cut) comp++; }
    assert(raw !== comp, 'compensation changes this count (' + raw + ' vs ' + comp + ')');
    eq(ws.count(s, onRaw), raw, 'uncompensated');
    eq(ws.count(s, onComp), comp, 'compensated');
  });

  test('flowjo fix #2: the report shows what failed — "not available" instead of 0, and uncompensated samples', () => {
    const list = tcell().samples();
    const ws = new FM.Workspace();
    ws.addSamples(list);
    // FlowJo counts saved for every population; the APC channel exists only in FlowJo (like tSNE)
    const text = tcell().workspace(list).split('count="-1"').join('count="100"').split('APC-A').join('tSNE1');
    const rep = FM.wsp.importInto(ws, text);
    const cd8 = rep.compare.filter(r => /\/CD8\+$/.test(r.path));
    assert(cd8.length, 'rows for CD8+');
    assert(cd8.every(r => r.ours === null && /tSNE1/.test(r.error)), 'not available, with the reason: ' + JSON.stringify(cd8[0]));
    assert(rep.compare.some(r => r.ours === 0 || r.ours > 0), 'other populations are counted');
    assert(rep.compensatedSamples < rep.matched.length, 'the matrix names a channel the files lack: not compensated, and counted');
  });
})();
