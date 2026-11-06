/* FlowMate 0.2 engine tests: gate scope, ellipse and Boolean gates, transforms,
 * compensation and tables. */

// ------------------------------------------------------------------ helpers
/** Demo plate with rows A and B as two groups (GA, GB) and the rest unassigned. */
function twoGroupWs(n) {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(n || 400));
  ws.applyLayout({ A1: 'GA', A2: 'GA', A3: 'GA', B1: 'GB', B2: 'GB', B3: 'GB' });
  const gid = name => ws.doc.groups.find(g => g.name === name).id;
  return { ws, GA: gid('GA'), GB: gid('GB'), a: ws.sample('A1'), b: ws.sample('B1'), c: ws.sample('C1') };
}

function wideRange(ws, parent, name) {
  return ws.addGate({ name: name || 'Wide', parent: parent || null, type: 'range', x: 'FSC-H',
    xScale: ws.scaleSpec('FSC-H'), range: { lo: 0, hi: 1e9 } });
}

// --------------------------------------------------------------- gate scope
test('scope: a gate scoped to one group reads on its samples and is NaN elsewhere — never 0', () => {
  const { ws, GA, a, b, c } = twoGroupWs();
  const id = wideRange(ws);
  ws.setGateScope(id, { groups: [GA] });
  assert(ws.count(a, id) > 0, 'applies to group A');
  assert(Number.isNaN(ws.count(b, id)), 'count is NaN on group B, got ' + ws.count(b, id));
  assert(Number.isNaN(ws.pct(b, id)), 'pct is NaN on group B');
  assert(Number.isNaN(ws.pct(c, id)), 'and on an unassigned sample');
  assert(ws.applies(id, a.key) && !ws.applies(id, b.key), 'ws.applies agrees');
});

test('scope: a child of a scoped gate inherits the restriction', () => {
  const { ws, GA, a, b } = twoGroupWs();
  const p = wideRange(ws, null, 'Parent');
  const k = wideRange(ws, p, 'Child');
  ws.setGateScope(p, { groups: [GA] });
  assert(ws.count(a, k) > 0, 'child reads on A');
  assert(Number.isNaN(ws.count(b, k)), 'child is NaN on B although it has no scope of its own');
  assert(!ws.applies(k, b.key), 'applies() walks the parent chain');
});

test('scope: children(parent, sample) lists only the gates that apply to that sample', () => {
  const { ws, GA, a, b } = twoGroupWs();
  const g1 = wideRange(ws, null, 'Everyone');
  const g2 = wideRange(ws, null, 'Only A');
  ws.setGateScope(g2, { groups: [GA] });
  eq(ws.children(null).length, 2, 'without a sample every gate is listed');
  eq(ws.children(null, a.key).map(g => g.id).join(), [g1, g2].join(), 'sample in A sees both');
  eq(ws.children(null, b.key).map(g => g.id).join(), g1, 'sample in B sees only the unscoped gate');
});

test('scope: sample-only scope, addGateScopeGroup, clearing and undo', () => {
  const { ws, GA, GB, a, b, c } = twoGroupWs();
  const id = wideRange(ws);
  ws.setGateScope(id, { samples: [c.key] });
  assert(ws.applies(id, c.key) && !ws.applies(id, a.key), 'only that sample');
  ws.addGateScopeGroup(id, GB);
  assert(ws.applies(id, b.key) && ws.applies(id, c.key) && !ws.applies(id, a.key), 'group added, sample kept');
  ws.setGateScope(id, null);
  assert(ws.applies(id, a.key) && ws.applies(id, b.key), 'cleared → every sample');
  ws.undo();
  assert(!ws.applies(id, a.key) && ws.applies(id, b.key), 'undo restores the scope');
  ws.setGateScope(id, { groups: [], samples: [] });
  eq(ws.gate(id).scope, undefined, 'an empty scope normalises to "every sample"');
  void GA;
});

test('scope: moving a sample to another group moves the gate with it (no stale cache)', () => {
  const { ws, GA, GB, a } = twoGroupWs();
  const id = wideRange(ws);
  ws.setGateScope(id, { groups: [GA] });
  const before = ws.count(a, id);
  assert(before > 0);
  ws.assign([a.key], GB);
  assert(Number.isNaN(ws.count(a, id)), 'A1 left group A, so the gate no longer applies');
  ws.assign([a.key], GA);
  eq(ws.count(a, id), before, 'back in group A, same count');
});

test('scope: templates keep a group scope; sample-only scopes are dropped with the samples', () => {
  const { ws, GA, c } = twoGroupWs();
  const g1 = wideRange(ws, null, 'GroupScoped');
  const g2 = wideRange(ws, null, 'SampleScoped');
  ws.setGateScope(g1, { groups: [GA] });
  ws.setGateScope(g2, { samples: [c.key] });
  const t = ws.toTemplate();
  eq(t.gates.find(g => g.name === 'GroupScoped').scope.groups.join(), GA, 'group scope survives');
  eq(t.gates.find(g => g.name === 'SampleScoped').scope, undefined, 'sample scope is tied to this run, so it is dropped');
});

test('roles: samples in a compensation-control group are left out of the analysis', () => {
  const { ws, GA } = twoGroupWs();
  const comp = ws.addGroup('Comp controls', 'comp');
  ws.assign(['C1', 'C2', 'C3'], comp);
  const m = ws.addMetric('Events', 'count("All events")');
  const res = FM.analysis.analyze(ws, m);
  assert(!res.wells.some(w => w.key === 'C1'), 'C1 is not an analysed well');
  assert(!res.groups.some(x => x.group.role === 'comp'), 'the comp group is not a result group');
  assert(res.groups.some(x => x.group.id === GA), 'ordinary groups are');
});

// ------------------------------------------------------------- ellipse gates
/** A synthetic sample: a 101 × 101 grid over [0, 1]² on two linear parameters. */
function gridSample(key) {
  const n = 101 * 101, X = new Float32Array(n), Y = new Float32Array(n);
  for (let i = 0; i < 101; i++) for (let j = 0; j < 101; j++) { X[i * 101 + j] = i / 100; Y[i * 101 + j] = j / 100; }
  return { key: key || 'grid', name: key || 'grid', n, data: { X, Y }, params: [{ name: 'X', range: 1 }, { name: 'Y', range: 1 }] };
}
const LIN01 = { type: 'lin', min: 0, max: 1 };
function ellipseGate(e, extra) {
  return Object.assign({ id: 'e1', name: 'E', parent: null, type: 'ellipse', x: 'X', y: 'Y', xScale: LIN01, yScale: LIN01, ellipse: e }, extra || {});
}
function bruteEllipse(s, e) {
  let k = 0;
  const c = Math.cos(e.angle), sn = Math.sin(e.angle);
  for (let i = 0; i < s.n; i++) {
    const u = s.data.X[i] - e.cx, v = s.data.Y[i] - e.cy;
    const a = (u * c + v * sn) / e.rx, b = (-u * sn + v * c) / e.ry;
    if (a * a + b * b <= 1) k++;
  }
  return k;
}

test('ellipse: containment matches the analytic area and a brute-force count, rotated too', () => {
  const s = gridSample();
  const e = { cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.1, angle: 0 };
  const n = FM.gating.filter(ellipseGate(e), s, FM.gating.allIndices(s)).length;
  eq(n, bruteEllipse(s, e), 'filter == brute force');
  approx(n, Math.PI * 0.3 * 0.1 * 100 * 100, 0.03, 'area × grid density');
  const r = Object.assign({}, e, { angle: Math.PI / 2 });
  const nr = FM.gating.filter(ellipseGate(r), s, FM.gating.allIndices(s)).length;
  eq(nr, bruteEllipse(s, r), 'rotated filter == brute force');
  absApprox(nr, n, n * 0.02, 'a quarter turn keeps the area');
});

test('ellipse: evaluated in the display space of its own scales (logicle axes)', () => {
  const spec = { type: 'logicle', T: 262144, W: 0.5, M: 4.5, A: 0 };
  const sc = FM.transforms.makeScale(spec);
  const vals = [100, 1000, 10000, 100000];
  const X = new Float32Array(vals), Y = new Float32Array(vals.map(() => 1000));
  const s = { key: 's', n: 4, data: { X, Y } };
  // centred on 10 000 in data units, radius 0.05 display units: only that event is inside
  const g = ellipseGate({ cx: 10000, cy: 1000, rx: 0.05, ry: 0.05, angle: 0 }, { xScale: spec, yScale: spec });
  const idx = FM.gating.filter(g, s, FM.gating.allIndices(s));
  eq(Array.from(idx).join(), '2', 'only 10 000 is within 0.05 display units');
  const wide = ellipseGate({ cx: 10000, cy: 1000, rx: sc.fwd(10000) - sc.fwd(1000) + 0.001, ry: 0.05, angle: 0 }, { xScale: spec, yScale: spec });
  eq(Array.from(FM.gating.filter(wide, s, FM.gating.allIndices(s))).join(), '1,2,3', 'a decade either side in display space: 1 000 and 100 000 in, 100 (two decades) out');
});

test('ellipse: outline points lie on the ellipse (display units)', () => {
  const g = ellipseGate({ cx: 0.4, cy: 0.6, rx: 0.2, ry: 0.07, angle: 0.6 });
  const pts = FM.gating.ellipsePoints(g, 96);
  eq(pts.length, 96);
  const c = Math.cos(0.6), sn = Math.sin(0.6);
  pts.forEach(([tx, ty]) => {
    const u = tx - 0.4, v = ty - 0.6;
    const a = (u * c + v * sn) / 0.2, b = (-u * sn + v * c) / 0.07;
    absApprox(a * a + b * b, 1, 1e-6, 'on the curve');
  });
  const h = FM.gating.ellipseHandles(g);
  eq(h.length, 4, 'four handles at the ends of the axes');
  absApprox(h[0][0], 0.4 + 0.2 * c, 1e-9); absApprox(h[0][1], 0.6 + 0.2 * sn, 1e-9);
});

test('ellipse: workspace gate, per-sample override, duplicate', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(400));
  const [a, b] = ws.samples;
  const xs = ws.scaleSpec('FSC-H'), ys = ws.scaleSpec('SSC-H');
  const id = ws.addGate({ name: 'Oval', parent: null, type: 'ellipse', x: 'FSC-H', y: 'SSC-H', xScale: xs, yScale: ys,
    ellipse: { cx: FM.transforms.makeScale(xs).inv(0.5), cy: FM.transforms.makeScale(ys).inv(0.5), rx: 0.45, ry: 0.45, angle: 0 } });
  const shared = ws.count(a, id);
  assert(shared > 0, 'catches events');
  ws.setGateOverride(id, a.key, { ellipse: { cx: 0, cy: 0, rx: 0.001, ry: 0.001, angle: 0 } });
  eq(ws.count(a, id), 0, 'the override applies to that sample');
  assert(ws.count(b, id) > 0, 'the other sample keeps the shared ellipse');
  const d = ws.duplicateGate(id);
  eq(ws.gate(d).type, 'ellipse', 'duplicates as an ellipse');
});

// ------------------------------------------------------------- Boolean gates
/** Two overlapping rectangles A and B on FSC-H × SSC-H, both inside a wide parent P. */
function boolWs() {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(500));
  const s = ws.samples[0];
  const xs = ws.scaleSpec('FSC-H'), ys = ws.scaleSpec('SSC-H');
  const q = (p, f) => { const v = Array.from(s.data[p]).sort((a, b) => a - b); return v[Math.floor(f * (v.length - 1))]; };
  const P = ws.addGate({ name: 'P', parent: null, type: 'rect', x: 'FSC-H', y: 'SSC-H', xScale: xs, yScale: ys,
    rect: { x0: q('FSC-H', 0.02), x1: q('FSC-H', 0.98), y0: q('SSC-H', 0.02), y1: q('SSC-H', 0.98) } });
  const A = ws.addGate({ name: 'A', parent: P, type: 'rect', x: 'FSC-H', y: 'SSC-H', xScale: xs, yScale: ys,
    rect: { x0: q('FSC-H', 0.1), x1: q('FSC-H', 0.6), y0: q('SSC-H', 0.1), y1: q('SSC-H', 0.7) } });
  const B = ws.addGate({ name: 'B', parent: P, type: 'rect', x: 'FSC-H', y: 'SSC-H', xScale: xs, yScale: ys,
    rect: { x0: q('FSC-H', 0.4), x1: q('FSC-H', 0.9), y0: q('SSC-H', 0.3), y1: q('SSC-H', 0.95) } });
  return { ws, s, P, A, B };
}
const setOf = idx => new Set(Array.from(idx));

test('boolean: AND, OR, NOT and AND-NOT equal the set operations on their terms', () => {
  const { ws, s, P, A, B } = boolWs();
  const p = setOf(ws.indices(s, P)), a = setOf(ws.indices(s, A)), b = setOf(ws.indices(s, B));
  const and = ws.addBoolGate({ op: 'and', terms: [{ id: A }, { id: B }] });
  const or = ws.addBoolGate({ op: 'or', terms: [{ id: A }, { id: B }] });
  const not = ws.addBoolGate({ op: 'and', terms: [{ id: A, not: true }] });
  const andNot = ws.addBoolGate({ op: 'and', terms: [{ id: A }, { id: B, not: true }] });
  const inter = [...a].filter(e => b.has(e)).length;
  assert(inter > 0 && inter < a.size, 'the rectangles overlap partly (' + inter + ')');
  eq(ws.count(s, and), inter, 'A AND B');
  eq(ws.count(s, or), new Set([...a, ...b]).size, 'A OR B');
  eq(ws.count(s, not), [...p].filter(e => !a.has(e)).length, 'NOT A is the rest of the parent');
  eq(ws.count(s, andNot), [...a].filter(e => !b.has(e)).length, 'A AND NOT B');
  eq(ws.gate(and).parent, P, 'parent is the deepest population holding every term');
  approx(ws.pct(s, and), 100 * inter / p.size, 1e-12, '% of that parent');
  eq(ws.gate(and).name, 'A and B', 'a readable default name');
  eq(ws.gate(not).name, 'not A');
});

test('boolean: editing a term recomputes the Boolean gate (no stale cache)', () => {
  const { ws, s, A, B } = boolWs();
  const and = ws.addBoolGate({ op: 'and', terms: [{ id: A }, { id: B }] });
  const before = ws.count(s, and);
  const r = ws.gate(A).rect;
  ws.updateGate(A, { rect: { x0: r.x0, x1: r.x1, y0: r.y0, y1: (r.y0 + r.y1) / 2 } });
  const a = setOf(ws.indices(s, A)), b = setOf(ws.indices(s, B));
  const now = ws.count(s, and);
  eq(now, [...a].filter(e => b.has(e)).length, 'matches the new intersection');
  assert(now !== before, 'and it changed (' + before + ' → ' + now + ')');
});

test('boolean: deleting a term deletes the gates built on it; undo brings both back', () => {
  const { ws, A, B } = boolWs();
  const and = ws.addBoolGate({ op: 'and', terms: [{ id: A }, { id: B }] });
  const kid = ws.addGate({ name: 'Under AND', parent: and, type: 'range', x: 'FSC-H', xScale: ws.scaleSpec('FSC-H'), range: { lo: 0, hi: 1e9 } });
  eq(ws.boolDependents(A).map(g => g.id).join(), and, 'the AND depends on A');
  ws.deleteGate(A);
  assert(!ws.gate(A) && !ws.gate(and) && !ws.gate(kid), 'A, the AND and its child are gone');
  assert(ws.gate(B), 'B stays');
  ws.undo();
  assert(ws.gate(A) && ws.gate(and) && ws.gate(kid), 'one undo restores all three');
});

test('boolean: never drawn on a plot; terms in different branches use their common ancestor', () => {
  const { ws, s, P, A, B } = boolWs();
  const A2 = ws.addGate({ name: 'A-inner', parent: A, type: 'range', x: 'FSC-H', xScale: ws.scaleSpec('FSC-H'), range: { lo: 0, hi: 1e9 } });
  const or = ws.addBoolGate({ op: 'or', terms: [{ id: A2 }, { id: B }] });
  eq(ws.gate(or).parent, P, 'A-inner (under A) OR B (under P) → under P');
  assert(!FM.plot || !FM.plot.gateFits || !FM.plot.gateFits(ws.gate(or), 'FSC-H', 'SSC-H'), 'not drawable');
  eq(ws.count(s, or), new Set([...setOf(ws.indices(s, A2)), ...setOf(ws.indices(s, B))]).size);
});

test('outside: a gate that keeps the events outside its shape', () => {
  const { ws, s, P, A } = boolWs();
  const inside = ws.count(s, A);
  ws.updateGate(A, { outside: true });
  eq(ws.count(s, A), ws.count(s, P) - inside, 'parent minus the inside');
  ws.updateGate(A, { outside: false });
  eq(ws.count(s, A), inside, 'and back');
});

test('boolean: a term that does not apply to a sample counts as empty there', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(300));
  ws.applyLayout({ A1: 'GA', B1: 'GB' });
  const GA = ws.doc.groups.find(g => g.name === 'GA').id;
  const spec = ws.scaleSpec('FSC-H');
  const A = ws.addGate({ name: 'A', parent: null, type: 'range', x: 'FSC-H', xScale: spec, range: { lo: 0, hi: 1e9 } });
  const B = ws.addGate({ name: 'B', parent: null, type: 'range', x: 'FSC-H', xScale: spec, range: { lo: 0, hi: 1e9 } });
  ws.setGateScope(B, { groups: [GA] });
  const or = ws.addBoolGate({ op: 'or', terms: [{ id: A }, { id: B }] });
  const and = ws.addBoolGate({ op: 'and', terms: [{ id: A }, { id: B }] });
  const b1 = ws.sample('B1');
  eq(ws.count(b1, or), ws.count(b1, A), 'OR on a sample without B = A');
  eq(ws.count(b1, and), 0, 'AND on a sample without B = nothing (the Boolean gate itself applies)');
});

// ----------------------------------------------------------------- transforms
test('biex: reproduces FlowJo\'s own lookup table (w −7.94, neg 1, pos 4.4185, top 262144)', async () => {
  const csv = await (await fetch('public/flowjo_xforms/tr_biex_l256_w-7.943282_n1.000000_m4.418540_r262144.000029.csv')).text();
  const rows = csv.trim().split(/\r?\n/).slice(1).map(l => l.split(',').map(Number));
  eq(rows.length, 4096, 'FlowJo table: one value per channel 0…4095');
  const spec = { type: 'biex', neg: 1, width: -7.943282, pos: 4.418540, max: 262144.000029 };
  const lut = FM.transforms.biexLUT(spec);
  let worst = 0, at = 0;
  rows.forEach(([ch, v]) => {
    const d = Math.abs(lut[ch] - v) / Math.max(1, Math.abs(v));
    if (d > worst) { worst = d; at = ch; }
  });
  assert(worst < 1e-4, 'worst relative difference ' + worst.toExponential(2) + ' at channel ' + at + ' (ours ' + lut[at] + ', FlowJo ' + rows[at][1] + ')');
  // and the scale maps a value to its channel / 4096
  const sc = FM.transforms.makeScale(spec);
  [100, 1000, 2000, 3000, 4000].forEach(ch => absApprox(sc.fwd(rows[ch][1]) * 4096, ch, 0.02, 'channel ' + ch));
  return 'INFO worst relative difference vs FlowJo ' + worst.toExponential(2);
});

test('biex: forward and inverse round-trip; values beyond the table clamp to its ends', () => {
  const sc = FM.transforms.makeScale({ type: 'biex', neg: 0, width: -10, pos: 4.418540, max: 262144 });
  const bottom = FM.transforms.biexLUT(sc.spec)[0];
  assert(bottom < -50 && bottom > -1000, "the table reaches into the negatives (" + bottom + ")");
  for (const v of [-50, -10, 0, 3, 50, 900, 12000, 200000]) absApprox(sc.inv(sc.fwd(v)), v, Math.max(0.5, Math.abs(v) * 1e-4), "round trip " + v);
  absApprox(sc.inv(sc.fwd(bottom * 4)), bottom, 1e-6, "far below the table clamps to its bottom");
  let prev = -Infinity;
  for (let v = -800; v < 262144; v += 977) { const t = sc.fwd(v); assert(t >= prev, 'monotone at ' + v); prev = t; }
  eq(sc.fwd(1e9), 1, 'above the top → 1');
  absApprox(sc.fwd(-1e9), 0, 1e-12, 'below the bottom → 0');
});

test('mappings: FlowJo and GatingML transforms land on FlowMate scales exactly', () => {
  const T = FM.transforms, LN10 = Math.LN10;
  // GatingML fasinh(T, M, A)
  const fa = T.fromGatingML({ type: 'fasinh', attrs: { T: '1000', M: '4', A: '1' } });
  const gml = x => (Math.asinh(x * Math.sinh(4 * LN10) / 1000) + LN10) / (5 * LN10);
  [-200, -1, 0, 1, 7, 50, 300, 999, 5000].forEach(x => absApprox(T.makeScale(fa).fwd(x), gml(x), 1e-9, 'fasinh ' + x));
  // FlowJo fasinh uses the same formula
  const fj = T.fromFlowJo({ type: 'fasinh', attrs: { T: '1000', M: '4', A: '1', W: '1', length: '256' } });
  absApprox(T.makeScale(fj).fwd(123), gml(123), 1e-9, 'FlowJo fasinh');
  // GatingML flin(T, A): (x + A) / (T + A)
  const fl = T.makeScale(T.fromGatingML({ type: 'flin', attrs: { T: '1000', A: '100' } }));
  [-100, 0, 450, 1000].forEach(x => absApprox(fl.fwd(x), (x + 100) / 1100, 1e-12, 'flin ' + x));
  // GatingML flog(T, M): log10(x / T) / M + 1
  const fg = T.makeScale(T.fromGatingML({ type: 'flog', attrs: { T: '10000', M: '5' } }));
  [1, 10, 333, 10000].forEach(x => absApprox(fg.fwd(x), Math.log10(x / 10000) / 5 + 1, 1e-12, 'flog ' + x));
  // FlowJo log(offset, decades): values below the offset sit at 0
  const lg = T.makeScale(T.fromFlowJo({ type: 'log', attrs: { offset: '1', decades: '4.5' } }));
  absApprox(lg.fwd(1000), 3 / 4.5, 1e-12, 'FlowJo log');
  eq(lg.fwd(0.2), 0, 'below the offset clamps to 0');
  // FlowJo linear(minRange, maxRange)
  const li = T.makeScale(T.fromFlowJo({ type: 'linear', attrs: { minRange: '50000', maxRange: '150000', gain: '1' } }));
  absApprox(li.fwd(100000), 0.5, 1e-12, 'FlowJo linear');
  // logicle passes through
  const lc = T.fromFlowJo({ type: 'logicle', attrs: { T: '262144', W: '1', M: '4.418539922', A: '0', length: '256' } });
  eq(lc.type, 'logicle'); eq(lc.W, 1); approx(lc.M, 4.418539922, 1e-12);
  // unsupported → null (GatingML) or a clear error (FlowJo)
  eq(T.fromGatingML({ type: 'fratio', attrs: {} }), null, 'ratio transforms unsupported');
  let msg = ''; try { T.fromFlowJo({ type: 'miracle', attrs: {} }); } catch (e) { msg = e.message; }
  assert(/miracle/.test(msg), msg);
});

// --------------------------------------------------------------- compensation
const TRUE_SPILL = [[1, 0.15, 0.02], [0, 1, 0.08], [0.01, 0, 1]];

test('comp: synthetic controls carry the known spillover', () => {
  const set = FM.synth.compControls(4000);
  eq(set.samples.length, 5, 'unstained, three single stains and one mixed sample');
  eq(set.params.join(), 'FL1-A,FL2-A,FL3-A');
  eq(JSON.stringify(set.spill), JSON.stringify(TRUE_SPILL));
});

test('comp: single-stain controls recover the spillover matrix within 0.01', () => {
  const ws = new FM.Workspace();
  const set = FM.synth.compControls(4000);
  ws.addSamples(set.samples);
  const res = FM.comp.compute(ws, {
    controls: ['Comp-FL1.fcs', 'Comp-FL2.fcs', 'Comp-FL3.fcs'].map(k => ({ sampleKey: k })),
    unstained: 'Unstained.fcs',
  });
  eq(res.params.join(), 'FL1-A,FL2-A,FL3-A', 'each control finds its own channel');
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    absApprox(res.spill[i][j], TRUE_SPILL[i][j], 0.01, 'S[' + i + '][' + j + ']');
  res.diagnostics.forEach(d => assert(d.nPos >= 100, d.sampleKey + ' has positives (' + d.nPos + ')'));
  // and without an unstained control, the controls' own negatives serve
  const res2 = FM.comp.compute(ws, { controls: ['Comp-FL1.fcs', 'Comp-FL2.fcs', 'Comp-FL3.fcs'].map(k => ({ sampleKey: k })) });
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    absApprox(res2.spill[i][j], TRUE_SPILL[i][j], 0.015, 'no unstained: S[' + i + '][' + j + ']');
});

test('comp: applying a matrix compensates from the raw data; switching and undo never reload', () => {
  const ws = new FM.Workspace();
  const set = FM.synth.compControls(3000);
  ws.addSamples(set.samples);
  const mixed = ws.sample('Mixed.fcs');
  eq(ws.doc.comp.active, 'file', 'default: each file\'s own matrix (none here)');
  assert(mixed.data['FL2-A'] === mixed.raw['FL2-A'], 'no matrix: data is the raw columns');
  // FL2-positive gate: on raw data FL1-bright cells spill into it
  const g = ws.addGate({ name: 'FL2+', parent: null, type: 'range', x: 'FL2-A', xScale: ws.scaleSpec('FL2-A'), range: { lo: 1500, hi: 1e9 } });
  const rawCount = ws.count(mixed, g);
  const id = ws.saveMatrix({ name: 'Truth', params: set.params, spill: set.spill, source: 'edited' });
  ws.setComp(id);
  const compCount = ws.count(mixed, g);
  assert(compCount < rawCount, 'compensation removes the FL1 spillover from FL2+ (' + rawCount + ' → ' + compCount + ')');
  absApprox(compCount, set.truePos['FL2-A'], set.samples[4].n * 0.01, 'and lands on the true FL2+ count');
  assert(mixed.raw['FL2-A'] !== mixed.data['FL2-A'], 'compensated copy, raw kept');
  ws.undo();
  eq(ws.doc.comp.active, 'file');
  eq(ws.count(mixed, g), rawCount, 'undo restores the uncompensated count');
  ws.redo();
  eq(ws.count(mixed, g), compCount, 'redo re-applies it');
  ws.updateMatrixCell(id, 0, 1, 0);
  assert(ws.count(mixed, g) > compCount, 'editing a cell recomputes (FL1→FL2 back to 0)');
  ws.setComp('none');
  eq(ws.count(mixed, g), rawCount, 'none = raw');
});

test('comp: "file" mode matches the classic in-place compensation; old docs migrate', () => {
  const parse = () => { const s = FM.synth.compControls(800).samples[4]; s.spill = { params: ['FL1-A', 'FL2-A', 'FL3-A'], matrix: TRUE_SPILL }; return s; };
  const ws = new FM.Workspace();
  ws.addSamples([parse()]);
  const ref = parse();
  FM.fcs.compensate(ref);
  const s = ws.samples[0];
  for (let i = 0; i < 50; i++) absApprox(s.data['FL2-A'][i], ref.data['FL2-A'][i], 1e-3, 'event ' + i);
  const ws2 = new FM.Workspace();
  ws2.loadDoc(Object.assign(FM.workspaceUtil.defaultDoc(), { comp: undefined, settings: { threshold: 2, compensate: false } }));
  eq(ws2.doc.comp.active, 'none', 'compensate:false becomes comp.active none');
});

// --------------------------------------------------------------------- tables
test('tables: every statistic equals the direct workspace call; rows follow a group', () => {
  const { ws, GA, a } = twoGroupWs(500);
  const P = wideRange(ws, null, 'Cells');
  const K = ws.addGate({ name: 'Bright', parent: P, type: 'range', x: 'FL1-H', xScale: ws.scaleSpec('FL1-H'), range: { lo: 2e4, hi: 1e9 } });
  const t = ws.addTable('My table');
  ws.addTableColumn(t, { pop: K, stat: 'count' });
  ws.addTableColumn(t, { pop: K, stat: 'freq_parent' });
  ws.addTableColumn(t, { pop: K, stat: 'freq_total' });
  ws.addTableColumn(t, { pop: K, stat: 'freq_of', of: P });
  ['median', 'mean', 'gmean', 'sd', 'cv', 'rcv'].forEach(st => ws.addTableColumn(t, { pop: K, stat: st, param: 'FL1-H' }));
  const b = FM.statTables.build(ws, ws.table(t));
  eq(b.rows.length, ws.samples.length, 'one row per sample');
  eq(b.head.length, 2 + 10, 'Sample, Group and ten columns');
  assert(/Cells\/Bright/.test(b.head[2]) && /Count/.test(b.head[2]), 'headers name the population path and statistic: ' + b.head[2]);
  const row = b.rows.find(r => r.key === a.key);
  eq(row.cells[0], ws.count(a, K));
  eq(row.cells[1], ws.pct(a, K));
  eq(row.cells[2], ws.pctOf(a, K, null));
  eq(row.cells[3], ws.pctOf(a, K, P));
  eq(row.cells[4], ws.stat(a, K, 'FL1-H', 'median'));
  eq(row.cells[9], ws.stat(a, K, 'FL1-H', 'rcv'));
  ws.updateTable(t, { rows: GA });
  eq(FM.statTables.build(ws, ws.table(t)).rows.length, 3, 'rows = one group');
});

test('tables: a scoped gate gives empty cells, CSV quotes awkward names, TSV is tab-separated', () => {
  const { ws, GA } = twoGroupWs(300);
  const P = wideRange(ws, null, 'Cells, live');
  ws.setGateScope(P, { groups: [GA] });
  const t = ws.addTable('T');
  ws.addTableColumn(t, { pop: P, stat: 'count' });
  const b = FM.statTables.build(ws, ws.table(t));
  const rb = b.rows.find(r => r.key === 'B1');
  assert(Number.isNaN(rb.cells[0]), 'B1 has no Cells population');
  const csv = FM.statTables.toCSV(b).split(/\r?\n/);
  assert(/"Cells, live \| Count"/.test(csv[0]), 'quoted header: ' + csv[0]);
  const b1 = csv.find(l => l.startsWith('B1'));
  assert(/,$/.test(b1), 'empty cell for NaN: ' + b1);
  eq(FM.statTables.toTSV(b).split('\n')[0].split('\t').length, 3);
  ws.removeTableColumn(t, 0);
  eq(ws.table(t).columns.length, 0);
  ws.deleteTable(t);
  eq(ws.doc.tables.length, 0);
});
