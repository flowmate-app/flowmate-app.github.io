/* Compensation matrix files (core/matrixio.js) and the FlowJo-style matrix workflow in the workspace:
 * named matrices from controls, Edit as a copy, import, exact spill edits, the use checkbox and the
 * universal negative. */
(function () {
  const M = () => FM.matrixio;
  const demoWs = () => {
    const ws = new FM.Workspace();
    ws.addSamples(FM.synth.demoPlate(1500));
    FM.synth.demoControls(4000).forEach(c => { ws.addSamples([c.sample]); ws.assign([ws.samples.find(s => s.name === c.sample.name).key], ws.addGroup(c.name, c.role)); });
    return ws;
  };

  test('matrix files: CSV with a "#" header (FlowJo / FlowKit export), fractions', async () => {
    const text = await (await fetch('public/flowjo/den_comp.csv')).text();
    const m = M().parse(text, 'den_comp.csv');
    eq(m.params.length, 8); eq(m.params[0], 'TNFa FITC FLR-A');
    approx(m.spill[0][1], 0.014139, 1e-9); eq(m.spill[3][3], 1);
    eq(m.name, 'den_comp');
  });

  test('matrix files: CSV with plain header, 14 parameters', async () => {
    const m = M().parse(await (await fetch('public/comp_complete_example.csv')).text());
    eq(m.params.length, 14); approx(m.spill[0][1], 0.2986, 1e-12);
  });

  test('matrix files: percent values, row names and an empty corner cell; tabs', () => {
    const m = M().parse('\tFL1-A\tFL2-A\nFL1-A\t100\t12.5\nFL2-A\t0.4\t100\n');
    eq(m.params.join(), 'FL1-A,FL2-A');
    approx(m.spill[0][1], 0.125, 1e-12); approx(m.spill[1][0], 0.004, 1e-12);
  });

  test('matrix files: the FCS keyword form', () => {
    const m = M().parse('2,FL1-A,FL2-A,1,0.1,0.02,1');
    eq(m.params.join(), 'FL1-A,FL2-A'); approx(m.spill[0][1], 0.1, 1e-12);
  });

  test('matrix files: a FlowJo matrix inside a workspace (.wsp) and our own .mtx round-trip', async () => {
    const wsp = await (await fetch('public/flowjo/8_color_ICS.wsp')).text();
    const m = M().parse(wsp);
    eq(m.format, 'FlowJo matrix'); assert(m.params.length >= 8, m.params.length + ' parameters');
    const back = M().parse(M().toMTX({ name: 'Panel 3', params: m.params, spill: m.spill }));
    eq(back.name, 'Panel 3'); eq(back.params.join(), m.params.join());
    back.spill.forEach((r, i) => r.forEach((v, j) => approx(v, m.spill[i][j], 1e-9)));
    const csv = M().parse(M().toCSV(m));
    csv.spill.forEach((r, i) => r.forEach((v, j) => approx(v, m.spill[i][j], 1e-9)));
  });

  test('matrix files: Gating-ML spectrumMatrix', () => {
    const xml = '<gating:Gating-ML xmlns:gating="g" xmlns:transforms="t" xmlns:data-type="d"><transforms:spectrumMatrix transforms:id="SpillA">' +
      '<transforms:fluorochromes><data-type:fcs-dimension data-type:name="FITC"/><data-type:fcs-dimension data-type:name="PE"/></transforms:fluorochromes>' +
      '<transforms:detectors><data-type:fcs-dimension data-type:name="FL1-A"/><data-type:fcs-dimension data-type:name="FL2-A"/></transforms:detectors>' +
      '<transforms:spectrum><transforms:coefficient transforms:value="1"/><transforms:coefficient transforms:value="0.2"/></transforms:spectrum>' +
      '<transforms:spectrum><transforms:coefficient transforms:value="0.01"/><transforms:coefficient transforms:value="1"/></transforms:spectrum></transforms:spectrumMatrix></gating:Gating-ML>';
    const m = M().parse(xml);
    eq(m.format, 'Gating-ML'); eq(m.params.join(), 'FL1-A,FL2-A'); approx(m.spill[0][1], 0.2, 1e-12);
  });

  test('matrix files: bad files are refused with a reason', () => {
    const err = t => { try { M().parse(t); } catch (e) { return e.message; } return ''; };
    assert(/empty/.test(err('')), err(''));
    assert(/not square/.test(err('A,B\n1,0.1\n')), err('A,B\n1,0.1\n'));
    assert(/diagonal/.test(err('A,B\n0.9,0.1\n0,1\n')), err('A,B\n0.9,0.1\n0,1\n'));
    assert(/no compensation matrix/.test(err('<a><b/></a>')), err('<a><b/></a>'));
  });

  test('matrix files: names are matched to the loaded parameters (exact, Comp- prefix, <brackets>, $PnS label)', () => {
    const ws = demoWs();
    const r = M().matchParams(ws, ['FL1-A', 'Comp-FL2-A', '<FL3-A>', '488/585-42-A', 'Nope-A']);
    eq(r.params.slice(0, 3).join(), 'FL1-A,FL2-A,FL3-A');
    eq(r.params[3], 'FL2-A', 'by the $PnS label');
    eq(r.unmatched.join(), 'Nope-A');
  });

  test('matrices: Create matrix names it; the same name updates it; Edit makes a copy; import applies', () => {
    const ws = demoWs();
    const a = ws.computeUnmix({ name: 'Panel A' }).id;
    eq(FM.comp.matrixById(ws, a).name, 'Panel A'); eq(ws.doc.comp.active, a);
    const again = ws.computeUnmix({ name: 'Panel A' }).id;
    eq(again, a, 'same name: updated in place');
    const b = ws.computeUnmix({ name: 'Panel B' }).id;
    assert(b !== a, 'another name: another matrix'); eq(ws.doc.comp.matrices.length, 2);
    const copy = ws.duplicateMatrix(a);
    eq(FM.comp.matrixById(ws, copy).name, 'Panel A (copy)');
    eq(ws.doc.comp.active, b, 'a copy is not applied by itself');
    const imp = ws.importMatrix({ name: 'From file', params: ['FL1-A', 'FL2-A'], spill: [[1, 0.1], [0, 1]] });
    eq(ws.doc.comp.active, imp); eq(ws.doc.comp.confirmed, true);
    const s = ws.samples[0];
    approx(s.data['FL2-A'][3], s.raw['FL2-A'][3] - 0.1 * s.raw['FL1-A'][3], 1e-3, 'the imported matrix compensates');
  });

  test('matrices: dragging straightens by editing the spillover exactly — S\' = (I + δ eᵢeⱼᵀ) S', () => {
    const ws = demoWs();
    const id = ws.computeUnmix({ name: 'C' }).id;
    const before = FM.comp.matrixById(ws, id).spill.map(r => r.slice());
    ws.nudgeSpill(id, 0, 1, 0.05);
    const after = FM.comp.matrixById(ws, id).spill;
    after[0].forEach((v, t) => approx(v, before[0][t] + 0.05 * before[1][t], 1e-12, 'row 0'));
    eq(JSON.stringify(after[1]), JSON.stringify(before[1]), 'other rows untouched');
    assert(FM.comp.matrixById(ws, id).edited, 'marked edited');
    ws.undo();
    eq(JSON.stringify(FM.comp.matrixById(ws, id).spill), JSON.stringify(before));
  });

  test('wizard: an unticked control is left out; without the universal negative each control uses its own dim events', () => {
    const ws = demoWs();
    const pe = ws.doc.groups.find(g => g.name === 'CD11b PE');
    ws.setControlSetup(pe.id, { use: false });
    const m1 = FM.comp.matrixById(ws, ws.computeUnmix().id);
    eq(m1.params.length, 2, 'two of three controls used');
    ws.setControlSetup(pe.id, { use: true });
    ws.setUnmixSetup({ universal: false });
    const m2 = FM.comp.matrixById(ws, ws.computeUnmix().id);
    const at = (from, to) => m2.spill[m2.params.indexOf(from)][m2.params.indexOf(to)];
    assert(Math.abs(at('FL1-A', 'FL2-A') - FM.synth.DEMO_SPILL.beadsToFL2) < 0.01, 'still about right: ' + at('FL1-A', 'FL2-A'));
    const sig = FM.unmix.signatures(ws, { universal: false });
    assert(sig.dyes.every(d => !d.universal && Number.isFinite(d.negHi)), 'negatives from each control');
    assert(sig.dyes.every(d => ['good', 'fair', 'poor'].indexOf(d.quality) >= 0), 'every control rated');
  });
})();
