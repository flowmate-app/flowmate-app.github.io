/* Interoperability: the ISAC Gating-ML 2.0 compliance suite (per-event truth), Gating-ML
 * round trips, and FlowJo workspaces against the counts FlowJo itself saved. Reference data:
 * tests/public (FlowKit test suite, BSD-3). */

// [gating-ml file, truth file (Results_<name>.txt), gate id]
const GML_CASES = [
  ['gml_range_gate.xml', 'Range1', 'Range1'],
  ['gml_rect1_gate.xml', 'Rectangle1', 'Rectangle1'],
  ['gml_rect2_gate.xml', 'Rectangle2', 'Rectangle2'],
  ['gml_poly1_gate.xml', 'Polygon1', 'Polygon1'],
  ['gml_poly2_gate.xml', 'Polygon2', 'Polygon2'],
  ['gml_poly3ns_gate.xml', 'Polygon3NS', 'Polygon3NS'],
  ['gml_ellipse1_gate.xml', 'Ellipse1', 'Ellipse1'],
  ['gml_ellipsoid3d_gate.xml', 'Ellipsoid3D', 'Ellipsoid3D'],
  ['gml_time_range_gate.xml', 'Range2', 'Range2'],
  ['gml_quadrant1_gate.xml', 'FL2N-FL4N', 'FL2N-FL4N'],
  ['gml_quadrant1_gate.xml', 'FL2N-FL4P', 'FL2N-FL4P'],
  ['gml_quadrant1_gate.xml', 'FL2P-FL4N', 'FL2P-FL4N'],
  ['gml_quadrant1_gate.xml', 'FL2P-FL4P', 'FL2P-FL4P'],
  ['gml_quadrant2_gate.xml', 'FSCN-SSCN', 'FSCN-SSCN'],
  ['gml_quadrant2_gate.xml', 'FSCD-SSCN-FL1N', 'FSCD-SSCN-FL1N'],
  ['gml_quadrant2_gate.xml', 'FSCP-SSCN-FL1N', 'FSCP-SSCN-FL1N'],
  ['gml_quadrant2_gate.xml', 'FSCD-FL1P', 'FSCD-FL1P'],
  ['gml_quadrant2_gate.xml', 'FSCN-SSCP-FL1P', 'FSCN-SSCP-FL1P'],
  ['gml_ratio_range1_gate.xml', 'RatRange1', 'RatRange1'],
  ['gml_ratio_range2_gate.xml', 'RatRange2', 'RatRange2'],
  ['gml_log_ratio_range1_gate.xml', 'RatRange1a', 'RatRange1a'],
  ['gml_boolean_and1_gate.xml', 'And1', 'And1'],
  ['gml_boolean_and2_gate.xml', 'And2', 'And2'],
  ['gml_boolean_or1_gate.xml', 'Or1', 'Or1'],
  ['gml_boolean_and3_complement_gate.xml', 'And3', 'And3'],
  ['gml_boolean_not1_gate.xml', 'Not1', 'Not1'],
  ['gml_boolean_and4_not_gate.xml', 'And4', 'And4'],
  ['gml_boolean_or2_gate.xml', 'Or2', 'Or2'],
  ['gml_matrix_poly4_gate.xml', 'Polygon4', 'Polygon4'],
  ['gml_matrix_rect3_gate.xml', 'Rectangle3', 'Rectangle3'],
  ['gml_matrix_rect4_gate.xml', 'Rectangle4', 'Rectangle4'],
  ['gml_matrix_rect5_gate.xml', 'Rectangle5', 'Rectangle5'],
  ['gml_transform_asinh_range1_gate.xml', 'ScaleRange1', 'ScaleRange1'],
  ['gml_transform_hyperlog_range2_gate.xml', 'ScaleRange2', 'ScaleRange2'],
  ['gml_transform_linear_range3_gate.xml', 'ScaleRange3', 'ScaleRange3'],
  ['gml_transform_logicle_range4_gate.xml', 'ScaleRange4', 'ScaleRange4'],
  ['gml_transform_logicle_range5_gate.xml', 'ScaleRange5', 'ScaleRange5'],
  ['gml_transform_log_range6_gate.xml', 'ScaleRange6', 'ScaleRange6'],
  ['gml_matrix_transform_asinh_range1c_gate.xml', 'ScaleRange1c', 'ScaleRange1c'],
  ['gml_matrix_transform_hyperlog_range2c_gate.xml', 'ScaleRange2c', 'ScaleRange2c'],
  ['gml_matrix_transform_linear_range3c_gate.xml', 'ScaleRange3c', 'ScaleRange3c'],
  ['gml_matrix_transform_logicle_range4c_gate.xml', 'ScaleRange4c', 'ScaleRange4c'],
  ['gml_matrix_transform_logicle_range5c_gate.xml', 'ScaleRange5c', 'ScaleRange5c'],
  ['gml_matrix_transform_asinh_range6c_gate.xml', 'ScaleRange6c', 'ScaleRange6c'],
  ['gml_matrix_transform_hyperlog_range7c_gate.xml', 'ScaleRange7c', 'ScaleRange7c'],
  ['gml_matrix_transform_logicle_range8c_gate.xml', 'ScaleRange8c', 'ScaleRange8c'],
  ['gml_matrix_transform_logicle_rect1_gate.xml', 'ScaleRect1', 'ScaleRect1'],
  ['gml_parent_poly1_boolean_and2_gate.xml', 'ParAnd2', 'ParAnd2'],
  ['gml_parent_range1_boolean_and3_gate.xml', 'ParAnd3', 'ParAnd3'],
  ['gml_parent_rect1_rect_par1_gate.xml', 'ScalePar1', 'ScalePar1'],
  ['gml_parent_quadrant_rect_gate.xml', 'ParQuadRect', 'ParRectangle1'],
];
// constructs FlowMate does not claim to support: ratio dimensions, 3-D ellipsoids
const GML_UNSUPPORTED = new Set(['RatRange1', 'RatRange2', 'RatRange1a', 'Ellipsoid3D']);

let gmlData1 = null;
async function data1() {
  if (!gmlData1) gmlData1 = await (await fetch('public/gatingml/data1.fcs')).arrayBuffer();
  return FM.fcs.parse(gmlData1.slice(0), 'data1.fcs');
}
const gmlText = async f => (await fetch('public/gatingml/gml/' + f)).text();

GML_CASES.forEach(([file, truthName, gateId]) => {
  const unsupported = GML_UNSUPPORTED.has(truthName);
  test('gating-ml compliance: ' + truthName + (unsupported ? ' (unsupported: must be reported)' : ' — every event agrees with the truth'), async () => {
    const ws = new FM.Workspace();
    ws.addSamples([await data1()]);
    const s = ws.samples[0];
    const rep = FM.gatingml.importInto(ws, await gmlText(file));
    const id = rep.ids[gateId];
    if (unsupported) {
      assert(!id || rep.skipped.length, 'an unsupported construct must be reported as skipped');
      return 'SKIP';
    }
    assert(id, gateId + ' was imported (warnings: ' + rep.warnings.join(' | ') + ')');
    const truth = (await (await fetch('public/gatingml/truth/Results_' + truthName + '.txt')).text()).trim().split(/\r?\n/).map(v => v.trim() === '1');
    eq(truth.length, s.n, 'truth has one line per event');
    const mine = new Uint8Array(s.n);
    ws.indices(s, id).forEach(e => { mine[e] = 1; });
    let wrong = 0, first = -1;
    for (let e = 0; e < s.n; e++) if (!!mine[e] !== truth[e]) { wrong++; if (first < 0) first = e; }
    assert(wrong === 0, wrong + ' of ' + s.n + ' events disagree (first #' + first + '); FlowMate ' + ws.count(s, id) + ' in, truth ' + truth.filter(Boolean).length);
  });
});

test('gating-ml: export then import gives the same numbers for every gate type', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(500));
  const xs = ws.scaleSpec('FSC-H'), ys = ws.scaleSpec('SSC-H'), fl = ws.scaleSpec('FL1-H');
  const sc = FM.transforms.makeScale;
  const cells = ws.addGate({ name: 'Cells', parent: null, type: 'polygon', x: 'FSC-H', y: 'SSC-H', xScale: xs, yScale: ys,
    verts: [[sc(xs).inv(0.15), sc(ys).inv(0.1)], [sc(xs).inv(0.9), sc(ys).inv(0.15)], [sc(xs).inv(0.8), sc(ys).inv(0.9)], [sc(xs).inv(0.2), sc(ys).inv(0.7)]] });
  ws.addGate({ name: 'Box', parent: cells, type: 'rect', x: 'FSC-H', y: 'SSC-H', xScale: xs, yScale: ys, rect: { x0: sc(xs).inv(0.3), x1: sc(xs).inv(0.6), y0: sc(ys).inv(0.2), y1: sc(ys).inv(0.5) } });
  const pos = ws.addGate({ name: 'FL1+', parent: cells, type: 'range', x: 'FL1-H', y: null, xScale: fl, yScale: null, range: { lo: sc(fl).inv(0.55), hi: sc(fl).inv(1) } });
  ws.addGate({ name: 'Oval', parent: cells, type: 'ellipse', x: 'FL1-H', y: 'SSC-H', xScale: fl, yScale: ys, ellipse: { cx: sc(fl).inv(0.6), cy: sc(ys).inv(0.4), rx: 0.2, ry: 0.08, angle: 0.5 } });
  ws.addGate({ name: 'Logicle poly', parent: cells, type: 'polygon', x: 'FL1-H', y: 'SSC-H', xScale: fl, yScale: ys, verts: [[sc(fl).inv(0.3), sc(ys).inv(0.2)], [sc(fl).inv(0.8), sc(ys).inv(0.3)], [sc(fl).inv(0.5), sc(ys).inv(0.8)]] });
  ws.addQuadrant({ parent: cells, x: 'FL1-H', y: 'SSC-H', xScale: fl, yScale: ys, cx: sc(fl).inv(0.5), cy: sc(ys).inv(0.5) });
  const box = ws.popIdByName('Box');
  ws.addBoolGate({ op: 'and', terms: [{ id: box }, { id: pos, not: true }] });
  const out = ws.addGate({ name: 'Outside box', parent: cells, type: 'rect', x: 'FSC-H', y: 'SSC-H', xScale: xs, yScale: ys, rect: { x0: sc(xs).inv(0.3), x1: sc(xs).inv(0.6), y0: sc(ys).inv(0.2), y1: sc(ys).inv(0.5) } });
  ws.updateGate(out, { outside: true });
  const { xml } = FM.gatingml.export(ws);
  const ws2 = new FM.Workspace();
  ws2.addSamples(FM.synth.demoPlate(500));
  const rep = FM.gatingml.importInto(ws2, xml);
  assert(rep.gates >= ws.doc.gates.length, 'every gate came back (' + rep.gates + ')');
  ws.doc.gates.forEach(g => {
    const g2 = ws2.popIdByName(g.name);
    assert(g2, g.name + ' is there');
    ws.samples.forEach((s, i) => eq(ws2.count(ws2.samples[i], g2), ws.count(s, g.id), g.name + ' on ' + s.key));
  });
  eq(ws2.doc.gates.filter(g => g.type === 'quad').length, 4, 'the quadrant comes back as one linked quadrant');
});

// ------------------------------------------------------------ FlowJo .wsp
async function fcsFile(path, name) { return FM.fcs.parse(await (await fetch(path)).arrayBuffer(), name); }
async function haveFile(path) { try { return (await fetch(path)).ok; } catch (_) { return false; } }
const wspText = async f => (await fetch('public/flowjo/' + f)).text();

test('flowjo: simple polygon + rectangle on linear axes (counts checked by brute force)', async () => {
  const ws = new FM.Workspace();
  ws.addSamples([await fcsFile('public/flowjo/data_set_simple_line_100.fcs', 'data_set_simple_line_100.fcs')]);
  const rep = FM.wsp.importInto(ws, await wspText('simple_poly_and_rect.wsp'));
  eq(rep.matched.length, 1, 'the sample is matched by file name');
  eq(rep.gates, 2, 'poly1 and rect1');
  const s = ws.samples[0];
  const poly = ws.gate(ws.popIdByName('poly1')), rect = ws.gate(ws.popIdByName('rect1'));
  eq(poly.type, 'polygon'); eq(rect.type, 'rect');
  // brute force: polygon straight in its linear display space, rectangle [min, max)
  const xs = FM.transforms.makeScale(poly.xScale), ys = FM.transforms.makeScale(poly.yScale);
  const vx = poly.verts.map(v => xs.fwd(v[0])), vy = poly.verts.map(v => ys.fwd(v[1]));
  let np = 0, nr = 0;
  for (let e = 0; e < s.n; e++) {
    const a = s.data.channel_A[e], b = s.data.channel_B[e];
    if (FM.gating.pointInPolygon(xs.fwd(a), ys.fwd(b), vx, vy)) np++;
    if (a >= rect.rect.x0 && a < rect.rect.x1 && b >= rect.rect.y0 && b < rect.rect.y1) nr++;
  }
  eq(ws.count(s, poly.id), np, 'poly1');
  eq(ws.count(s, rect.id), nr, 'rect1');
  // every event sits at channel_B = 131072, just above both gates: 0 is the right answer here
});

test('flowjo: ellipse on linear axes matches FlowJo (51 events)', async () => {
  const ws = new FM.Workspace();
  ws.addSamples([await fcsFile('public/flowjo/data_set_simple_line_100.fcs', 'data_set_simple_line_100.fcs')]);
  const rep = FM.wsp.importInto(ws, await wspText('single_ellipse_51_events.wsp'));
  const row = rep.compare.find(r => r.path === 'ellipse1');
  eq(ws.gate(row.gateId).type, 'ellipse', 'imported as an ellipse');
  eq(row.flowjo, 51);
  eq(row.ours, 51, 'FlowMate count');
});

async function diamondWs(wsp) {
  if (!(await haveFile('public_large/flowjo/test_data_diamond_01.fcs'))) return null;
  const ws = new FM.Workspace();
  ws.addSamples([await fcsFile('public_large/flowjo/test_data_diamond_01.fcs', 'test_data_diamond_01.fcs')]);
  return { ws, rep: FM.wsp.importInto(ws, await wspText(wsp)) };
}

test('flowjo: quadrant (four rectangles with open sides) matches FlowJo exactly', async () => {
  const r = await diamondWs('simple_diamond_example_quad_gate.wsp');
  if (!r) return 'SKIP';
  const want = { 'Q1: channel_A- , channel_B+': 49671, 'Q2: channel_A+ , channel_B+': 50596, 'Q3: channel_A+ , channel_B-': 50330, 'Q4: channel_A- , channel_B-': 49403 };
  Object.keys(want).forEach(p => { const row = r.rep.compare.find(x => x.path === p); eq(row && row.ours, want[p], p); });
});

test('flowjo: biex and arcsinh axes — rectangles match FlowJo exactly', async () => {
  const cases = [['test_data_diamond_biex_rect.wsp', 50605], ['test_data_diamond_asinh_rect.wsp', 50559], ['test_data_diamond_asinh_rect2.wsp', 50699]];
  for (const [f, n] of cases) {
    const r = await diamondWs(f);
    if (!r) return 'SKIP';
    const row = r.rep.compare.find(x => x.path === 'upper_right');
    eq(row.ours, n, f + ' (FlowJo ' + row.flowjo + ')');
  }
});

const EIGHT = ['101_DEN084Y5_15_E01_008_clean.fcs', '101_DEN084Y5_15_E03_009_clean.fcs', '101_DEN084Y5_15_E05_010_clean.fcs'];
let eightSamples = null;
async function eightWs(wsp) {
  if (!(await haveFile('public_large/8_color/' + EIGHT[0]))) return null;
  if (!eightSamples) eightSamples = await Promise.all(EIGHT.map(async f => (await fetch('public_large/8_color/' + f)).arrayBuffer()));
  const ws = new FM.Workspace();
  ws.addSamples(eightSamples.map((b, i) => FM.fcs.parse(b.slice(0), EIGHT[i])));
  return { ws, rep: FM.wsp.importInto(ws, await wspText(wsp)) };
}
function agreement(rows) {
  const bad = rows.filter(r => Math.abs(r.diff) > Math.max(3, 0.005 * r.flowjo));
  const worst = rows.slice().sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct))[0];
  return { bad, worst, exact: rows.filter(r => r.diff === 0).length };
}

/* The 8-colour ICS workspaces carry FlowJo's own saved counts. An independent implementation
 * (FlowKit 1.3.2, tools/flowkit_counts.py) lands within 0.5 % of most of them but not of a few
 * (mostly sample E03, and the ellipse), and there FlowMate agrees with FlowKit to the event. So
 * FlowKit's counts are the exact reference, and FlowJo's are checked wherever FlowKit agrees. */
['8_color_ICS.wsp', '8_color_ICS_with_ellipse.wsp', '8_color_ICS_boolean_gate_testing.wsp'].forEach(f => {
  test('flowjo: 8-colour ICS (' + f + ') — every population of every sample equals FlowKit, and FlowJo where the two agree', async () => {
    const r = await eightWs(f);
    if (!r) return 'SKIP';
    eq(r.rep.matched.length, 3, 'three samples matched');
    const ref = JSON.parse(await (await fetch('public/flowjo/flowkit_counts_' + f.replace('.wsp', '.json'))).text());
    let n = 0, worst = 0, worstAt = '';
    const off = [];
    Object.keys(ref).forEach(file => {
      const s = r.ws.samples.find(x => x.name === file);
      Object.keys(ref[file]).forEach(path => {
        const id = r.rep.paths[path];
        assert(id, path + ' was imported');
        const ours = r.ws.count(s, id), want = ref[file][path];
        n++;
        // an ellipse is exact here; FlowKit approximates it by a 128-gon, so allow its sliver
        const tol = r.ws.gate(id).type === 'ellipse' ? Math.max(2, 0.001 * want) : 0;
        if (Math.abs(ours - want) > tol) off.push(file.slice(16, 19) + ' ' + path + ' FlowKit ' + want + ' vs ' + ours);
        if (Math.abs(ours - want) > worst) { worst = Math.abs(ours - want); worstAt = path; }
      });
    });
    assert(!off.length, off.length + ' populations differ from FlowKit: ' + off.slice(0, 4).join('; '));
    // FlowJo's own saved counts: wherever FlowKit is within 0.5 % (or 3 events) of them, FlowMate must be too
    const near = (a, b) => Math.abs(a - b) <= Math.max(3, 0.005 * b);
    let fair = 0, near2 = 0, farBoth = 0;
    const farSamples = new Set();
    r.rep.compare.forEach(row => {
      const fk = (ref[row.file] || {})[row.path];
      if (fk === undefined) return;
      if (near(fk, row.flowjo)) { fair++; assert(near(row.ours, row.flowjo), row.file.slice(16, 19) + ' ' + row.path + ': FlowJo ' + row.flowjo + ', FlowKit ' + fk + ', FlowMate ' + row.ours); near2++; }
      else { farBoth++; farSamples.add(row.file.slice(16, 19)); }
    });
    return 'INFO ' + n + ' counts equal FlowKit (largest difference ' + worst + (worstAt ? ' at ' + worstAt : '') + '); ' + near2 + ' of FlowJo’s saved counts within 0.5 % for FlowKit and FlowMate alike; ' + farBoth + ' saved counts differ from both (samples: ' + Array.from(farSamples).join(', ') + ')';
  });
});

test('flowjo: Boolean gates match FlowKit\'s published counts for E01', async () => {
  const r = await eightWs('8_color_ICS_boolean_gate_testing.wsp');
  if (!r) return 'SKIP';
  const s = r.ws.samples.find(x => x.name === EIGHT[0]);
  const at = p => { const id = r.rep.paths[p]; assert(id, p + ' imported (have: ' + Object.keys(r.rep.paths).filter(k => /CD4\+\//.test(k)).join(' | ') + ')'); return r.ws.count(s, id); };
  eq(at('Time/Singlets/aAmine-/CD3+/CD4+/CD107a+ & IFNg+'), 0, 'AND');
  eq(at('Time/Singlets/aAmine-/CD3+/CD4+/CD107a+ or IFNg+'), 72, 'OR');
  eq(at('Time/Singlets/aAmine-/CD3+/CD4+/IL2+-'), 82478, 'NOT IL2+');
  eq(at('Time/Singlets/aAmine-/CD3+/CD4+/TNFa+-'), 82463, 'NOT TNFa+ (CD4)');
  eq(at('Time/Singlets/aAmine-/CD3+/CD8+/TNFa+-'), 47157, 'NOT TNFa+ (CD8)');
  eq(at('Time/Singlets/aAmine-/CD3+/CD8+/TNFa+-/CD107a+'), 70, 'child of a Boolean gate');
});

// ------------------------------------------------------------ the built-in example
test('fcs: write → parse round-trips values, names, labels and the spillover keyword', () => {
  const s = FM.examples.tcell.samples()[1];
  const back = FM.fcs.parse(FM.fcs.write(s), s.name);
  eq(back.n, s.n, 'events');
  eq(back.params.map(p => p.name).join(), s.params.map(p => p.name).join(), 'parameter names');
  eq(back.params[3].label, 'CD3', '$PnS label kept');
  ['FSC-A', 'PE-A', 'BV421-A', 'Time'].forEach(p => { for (let e = 0; e < 200; e++) eq(back.data[p][e], s.data[p][e], p + ' event ' + e); });
  eq(JSON.stringify(back.spill.matrix), JSON.stringify(s.spill.matrix), 'spillover matrix survives');
  eq(back.meta['TUBE NAME'], 'Donor1_SEB', 'other keywords survive');
});

function exampleWs() {
  const ws = new FM.Workspace();
  const list = FM.examples.tcell.samples();
  ws.addSamples(list);
  const rep = FM.wsp.importInto(ws, FM.examples.tcell.workspace(list));
  return { ws, rep, s: name => ws.samples.find(x => x.name === name), g: path => rep.paths[path] };
}

test('example workspace: groups, compensation, scopes and the nudged gate come through', () => {
  const { ws, rep, s, g } = exampleWs();
  eq(rep.matched.length, 9, 'nine tubes matched');
  eq(rep.gates, 10, 'ten populations');
  eq(ws.doc.groups.map(x => x.name).join(), 'Compensation,Unstimulated,SEB');
  eq(ws.doc.groups[0].role, 'comp', 'the Compensation group keeps the controls out of results');
  eq(rep.compensation, 'file', 'FlowJo used the acquisition matrix, so FlowMate uses each file’s own');
  assert(s('Donor1_SEB.fcs').compensated, 'compensated');
  const cd3 = g('Lymphocytes/Single Cells/CD3+');
  assert(ws.applies(cd3, s('Donor1_SEB.fcs').key) && !ws.applies(cd3, s('Comp_PE.fcs').key), 'the controls only have scatter gates');
  const ifn = g('Lymphocytes/Single Cells/CD3+/CD4+/IFNg+');
  eq(ws.adjustedWells(ifn).join(), s('Donor2_SEB.fcs').key, 'Donor2_SEB keeps its own IFNg+ gate (✦)');
  eq(rep.compare.length, 0, 'no saved FlowJo counts in this example');
});

test('example workspace: the gates find the populations planted in the data', () => {
  const { ws, s, g } = exampleWs();
  const d1 = s('Donor1_SEB.fcs'), d1u = s('Donor1_Unstim.fcs');
  const T = 'Lymphocytes/Single Cells/CD3+';
  const pct = (smp, p) => ws.pct(smp, g(p));
  approx(pct(d1, T), 72, 0.06, 'T cells: 72 % of single lymphocytes');
  approx(pct(d1, T + '/CD4+'), 62, 0.06, 'CD4: 62 % of T cells');
  approx(pct(d1, T + '/CD8+'), 30, 0.08, 'CD8: 30 % of T cells');
  absApprox(pct(d1, T + '/CD4+/IFNg+'), 4.5, 1.2, 'IFN-γ in CD4 after SEB');
  absApprox(pct(d1, T + '/CD8+/IFNg+'), 7.5, 1.8, 'IFN-γ in CD8 after SEB');
  assert(pct(d1u, T + '/CD4+/IFNg+') < 1, 'little IFN-γ without stimulation');
  eq(ws.count(d1, g(T + '/IFNg+ T cells')), ws.count(d1, g(T + '/CD4+/IFNg+')) + ws.count(d1, g(T + '/CD8+/IFNg+')), 'Or = CD4 IFNg+ plus CD8 IFNg+');
  eq(ws.count(d1, g('Lymphocytes/Single Cells/Non-T cells')), ws.count(d1, g('Lymphocytes/Single Cells')) - ws.count(d1, g(T)), 'Not CD3+ = the rest of the single cells');
  approx(ws.pct(d1, g('Monocytes')), 14, 0.15, 'the ellipse catches the monocytes');
  approx(pct(d1, 'Lymphocytes/Single Cells'), 90, 0.05, 'doublets (~10 %) are excluded');
});

/* FlowKit 1.3.2 read the example (.wsp + the nine FCS files written by FM.fcs.write) as a valid
 * FlowJo 10 workspace; its counts are the reference here. The example data is seeded: if
 * example_tcell.js changes, regenerate this file (see tools/flowkit_counts.py). */
test('example workspace: FlowKit reads it as FlowJo 10 and agrees with FlowMate on all 50 counts', async () => {
  const ref = JSON.parse(await (await fetch('public/flowjo/flowkit_counts_example_tcell.json')).text());
  const { ws, rep, s } = exampleWs();
  let n = 0, worst = 0;
  Object.keys(ref).forEach(file => Object.keys(ref[file]).forEach(path => {
    const id = rep.paths[path];
    assert(id, path + ' imported');
    const ours = ws.count(s(file), id), want = ref[file][path];
    const tol = ws.gate(id).type === 'ellipse' ? 2 : 0;     // FlowKit draws ellipses as 128-gons
    assert(Math.abs(ours - want) <= tol, file + ' ' + path + ': FlowKit ' + want + ', FlowMate ' + ours);
    worst = Math.max(worst, Math.abs(ours - want)); n++;
  }));
  eq(n, 50, 'every population of every tube');
  return 'INFO ' + n + ' counts; largest difference ' + worst + ' event (the ellipse)';
});
