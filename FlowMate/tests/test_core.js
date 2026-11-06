/* Unit tests for the core engine. */

// ---------------------------------------------------------------- FCS TEXT
test('fcs: TEXT parsing with doubled (escaped) delimiters', () => {
  const m = FM.fcs.parseText('/$P1N/FSC-H/$FIL/a//b.fcs/$tot/12/');
  eq(m['$P1N'], 'FSC-H');
  eq(m['$FIL'], 'a/b.fcs');
  eq(m['$TOT'], '12', 'keys are upper-cased');
});

test('fcs: spillover parsing and identity detection', () => {
  const s = FM.fcs.parseSpillover('2,FL1-H,FL2-H,1,0.1,0.02,1');
  eq(s.params.join(), 'FL1-H,FL2-H');
  approx(s.matrix[0][1], 0.1, 1e-12);
  const inv = FM.fcs.invert(s.matrix);
  // S · S⁻¹ = I
  const I00 = s.matrix[0][0] * inv[0][0] + s.matrix[0][1] * inv[1][0];
  const I01 = s.matrix[0][0] * inv[0][1] + s.matrix[0][1] * inv[1][1];
  approx(I00, 1, 1e-12); absApprox(I01, 0, 1e-12);
});

test('fcs: parses a synthetic integer file with $PnE log amplification and big-endian order', () => {
  // build a tiny FCS2.0 file: 2 params, 3 events, 16-bit ints, big-endian
  const text = '|$BYTEORD|4,3,2,1|$DATATYPE|I|$MODE|L|$PAR|2|$TOT|3|$P1N|FSC|$P1B|16|$P1R|1024|$P1E|0,0|$P2N|FL1|$P2B|16|$P2R|1024|$P2E|4,1|';
  const textStart = 58, textEnd = textStart + text.length - 1;
  const dataStart = textEnd + 1, nbytes = 3 * 2 * 2, dataEnd = dataStart + nbytes - 1;
  const pad = (v) => String(v).padStart(8, ' ');
  const header = 'FCS2.0    ' + pad(textStart) + pad(textEnd) + pad(dataStart) + pad(dataEnd) + pad(0) + pad(0);
  const buf = new ArrayBuffer(dataEnd + 1);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < header.length; i++) u8[i] = header.charCodeAt(i);
  for (let i = 0; i < text.length; i++) u8[textStart + i] = text.charCodeAt(i);
  const dv = new DataView(buf, dataStart);
  const vals = [[10, 0], [500, 512], [1023, 1024 + 256]]; // last FL1 overflows the 10-bit mask
  vals.forEach(([a, b], e) => { dv.setUint16(e * 4, a, false); dv.setUint16(e * 4 + 2, b, false); });
  const s = FM.fcs.parse(buf, 't.fcs');
  eq(s.n, 3);
  eq(s.data.FSC[1], 500);
  approx(s.data.FL1[0], 1, 1e-6, '10^(4*0/1024)');
  approx(s.data.FL1[1], 100, 1e-5, '10^(4*512/1024)');
  approx(s.data.FL1[2], Math.pow(10, 4 * 256 / 1024), 1e-5, 'masked to 10 bits then log-amplified');
});

test('fcs: rejects a non-FCS file with a clear message', () => {
  let msg = '';
  try { FM.fcs.parse(new TextEncoder().encode('hello world, this is not a flow file at all.......................').buffer, 'x'); }
  catch (e) { msg = e.message; }
  assert(/Not an FCS file/.test(msg), msg);
});

// ------------------------------------------------------------- transforms
test('logicle: forward/inverse round-trip and monotonicity', () => {
  const sc = FM.transforms.makeScale({ type: 'logicle', T: 262144, W: 0.5, M: 4.5, A: 0 });
  let prev = -Infinity;
  for (let v = -2000; v <= 262144; v += (v < 1000 ? 17 : 997)) {
    const t = sc.fwd(v);
    assert(t > prev, 'monotone at ' + v);
    prev = t;
    approx(sc.inv(t), v, 1e-7 * Math.max(1, Math.abs(v)) + 1e-6, 'round trip at ' + v);
  }
  approx(sc.fwd(262144), 1, 1e-9, 'T maps to 1');
});

test('logicle: reference values (Parks et al. parameters T=10000, W=0.5, M=4.5)', () => {
  const sc = FM.transforms.makeScale({ type: 'logicle', T: 10000, W: 0.5, M: 4.5, A: 0 });
  approx(sc.fwd(0), 0.5 / 4.5, 1e-12, 'zero sits at W/(M+A)');
  approx(sc.fwd(10000), 1, 1e-12);
  // well above the linear region logicle ≈ log: one decade ≈ 1/M display units
  approx(sc.fwd(10000) - sc.fwd(1000), 1 / 4.5, 2e-3, 'decade spacing');
});

test('scales: log and linear map to [0,1]; ticks label decades', () => {
  const lg = FM.transforms.makeScale({ type: 'log', min: 10, max: 1e6 });
  approx(lg.fwd(1000), 0.4, 1e-12);
  eq(lg.fwd(-5), 0, 'non-positive clamps to 0');
  const ticks = FM.transforms.ticks(lg).filter(t => t.major).map(t => t.label);
  assert(ticks.includes('10^3') && ticks.includes('10^6'), ticks.join());
  const ln = FM.transforms.makeScale({ type: 'lin', min: 0, max: 1e6 });
  const lt = FM.transforms.ticks(ln, 4).map(t => t.label);
  assert(lt.includes('250K') || lt.includes('200K'), lt.join());
  const lc = FM.transforms.makeScale({ type: 'logicle', T: 1e7, W: 0.5, M: 7.3, A: 0 });
  const lct = FM.transforms.ticks(lc).filter(t => t.major).map(t => t.label);
  assert(lct.includes('0') && lct.includes('10^5') && lct.includes('10^7'), lct.join());
});

// ---------------------------------------------------------------- gating
test('gating: point in polygon (concave)', () => {
  const vx = [0, 4, 4, 2, 0], vy = [0, 0, 4, 1, 4]; // a "W"-ish concave shape
  assert(FM.gating.pointInPolygon(1, 0.5, vx, vy));
  assert(!FM.gating.pointInPolygon(2, 3, vx, vy), 'inside the notch is outside');
  assert(!FM.gating.pointInPolygon(5, 1, vx, vy));
});

test('gating: polygon on a log axis is evaluated in display space', () => {
  // triangle drawn on log x: straight edge in log space, curved in linear space
  const gate = { type: 'polygon', x: 'X', y: 'Y', xScale: { type: 'log', min: 1, max: 1e4 }, yScale: { type: 'lin', min: 0, max: 1 },
    verts: [[1, 0], [1e4, 0], [1, 1]] };
  // the hypotenuse runs from (t=1,y=0) to (t=0,y=1): y = 1 - t.  Point x=100 → t=0.5 → inside if y<0.5
  const sample = { name: 's', n: 2, data: { X: new Float32Array([100, 100]), Y: new Float32Array([0.45, 0.55]) } };
  const idx = FM.gating.filter(gate, sample, FM.gating.allIndices(sample));
  eq(idx.length, 1); eq(idx[0], 0);
});

test('gating: engine caches and invalidates on revision change', () => {
  const gates = new Map();
  gates.set('a', { id: 'a', parent: null, type: 'range', x: 'X', range: { lo: 2, hi: 10 }, rev: 1 });
  gates.set('b', { id: 'b', parent: 'a', type: 'range', x: 'X', range: { lo: 5, hi: 10 }, rev: 1 });
  const eng = new FM.gating.Engine(id => gates.get(id));
  const s = { name: 's', n: 10, data: { X: Float32Array.from({ length: 10 }, (_, i) => i) } };
  eq(eng.count(s, 'a'), 9 - 1);
  eq(eng.count(s, 'b'), 5);
  approx(eng.pctParent(s, 'b'), 100 * 5 / 8, 1e-12);
  gates.get('a').range = { lo: 6, hi: 10 }; gates.get('a').rev = 2;
  eq(eng.count(s, 'b'), 4, 'child recomputed after parent edit');
});

// ------------------------------------------------------- per-well gates
/** Ten events at X = 0…9, keyed as one well. */
function wellSample(key, n) {
  n = n || 10;
  return { name: key + '.fcs', key, well: key, n, data: { X: Float32Array.from({ length: n }, (_, i) => i) } };
}

test('per-well: gateFor patches only the geometry, and only for that well', () => {
  const g = { id: 'a', name: 'G', parent: null, type: 'range', x: 'X', range: { lo: 2, hi: 10 }, rev: 1,
    perWell: { B3: { range: { lo: 6, hi: 10 }, rev: 9 } } };
  eq(FM.gating.gateFor(g, 'A1'), g, 'a well with no override gets the very same object');
  const b3 = FM.gating.gateFor(g, 'B3');
  assert(b3 !== g, 'an adjusted well gets a copy');
  eq(b3.range.lo, 6);
  eq(b3.name, 'G', 'name stays shared');
  eq(b3.x, 'X', 'axes stay shared');
  eq(g.range.lo, 2, 'the shared gate is not mutated');
});

test('per-well: an override changes only its own well', () => {
  const gates = new Map();
  gates.set('a', { id: 'a', parent: null, type: 'range', x: 'X', range: { lo: 2, hi: 10 }, rev: 1,
    perWell: { B3: { range: { lo: 6, hi: 10 }, rev: 2 } } });
  const eng = new FM.gating.Engine(id => gates.get(id));
  const a1 = wellSample('A1'), b3 = wellSample('B3');
  eq(eng.count(a1, 'a'), 8, 'A1 uses the shared gate: X = 2…9');
  eq(eng.count(b3, 'a'), 4, 'B3 uses its own: X = 6…9');
});

test('per-well: stamps are per well, so one well\'s edit does not invalidate the others', () => {
  const gates = new Map();
  gates.set('a', { id: 'a', parent: null, type: 'range', x: 'X', range: { lo: 2, hi: 10 }, rev: 1,
    perWell: { B3: { range: { lo: 6, hi: 10 }, rev: 2 } } });
  const eng = new FM.gating.Engine(id => gates.get(id));
  const a1 = wellSample('A1'), b3 = wellSample('B3');
  assert(eng.stamp(a1, 'a') !== eng.stamp(b3, 'a'), 'an adjusted well has its own stamp');
  const a1Before = eng.stamp(a1, 'a');
  const idxA1 = eng.indices(a1, 'a');
  eng.indices(b3, 'a');
  gates.get('a').perWell.B3 = { range: { lo: 7, hi: 10 }, rev: 3 };
  eq(eng.stamp(a1, 'a'), a1Before, 'A1\'s stamp is untouched by B3\'s edit');
  assert(eng.indices(a1, 'a') === idxA1, 'A1 keeps its cached population');
  eq(eng.count(b3, 'a'), 3, 'B3 recomputed');
});

test('per-well: a parent\'s shared edit flows through to an adjusted child', () => {
  const gates = new Map();
  gates.set('p', { id: 'p', parent: null, type: 'range', x: 'X', range: { lo: 0, hi: 9 }, rev: 1 });
  gates.set('c', { id: 'c', parent: 'p', type: 'range', x: 'X', range: { lo: 2, hi: 9 }, rev: 1,
    perWell: { B3: { range: { lo: 4, hi: 9 }, rev: 2 } } });
  const eng = new FM.gating.Engine(id => gates.get(id));
  const b3 = wellSample('B3');
  eq(eng.count(b3, 'c'), 6, 'X = 4…9');
  gates.get('p').range = { lo: 0, hi: 5 }; gates.get('p').rev = 5;
  eq(eng.count(b3, 'c'), 2, 'X = 4…5 — the child\'s numbers follow its parent');
  eq(gates.get('c').perWell.B3.range.lo, 4, 'the outline drawn for B3 is untouched');
});

test('per-well: workspace overrides — set, clear, promote and copy', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(400));
  const keys = ws.samples.map(s => s.key);
  const [k0, k1, k2] = keys;
  const id = ws.addGate({ name: 'Wide', parent: null, type: 'range', x: 'FSC-H',
    xScale: ws.scaleSpec('FSC-H'), range: { lo: 0, hi: 1e9 } });
  const shared0 = ws.count(ws.sample(k0), id);
  assert(shared0 > 0, 'the shared gate catches events');

  ws.setGateOverride(id, k0, { range: { lo: 0, hi: 1 } });
  assert(ws.isAdjusted(id, k0), 'k0 is adjusted');
  assert(!ws.isAdjusted(id, k1), 'k1 is not');
  eq(ws.adjustedWells(id).join(), k0, 'one adjusted well');
  eq(ws.adjustedGates(k0).map(g => g.id).join(), id);
  eq(ws.count(ws.sample(k0), id), 0, 'k0 now catches nothing');
  eq(ws.count(ws.sample(k1), id), ws.count(ws.sample(k1), id), 'k1 still resolves');

  ws.updateGate(id, { range: { lo: 0, hi: 2e9 } }, { label: 'shared edit' });
  assert(ws.isAdjusted(id, k0), 'a shared edit leaves the override in place');
  eq(ws.count(ws.sample(k0), id), 0, 'and does not move it');

  ws.copyOverride(id, k0, [k1, k2]);
  eq(ws.adjustedWells(id).length, 3);
  eq(ws.count(ws.sample(k1), id), 0, 'k1 now matches k0');

  ws.promoteOverride(id, k0);
  eq(ws.adjustedWells(id).length, 0, 'promoting clears every override');
  eq(ws.gate(id).range.hi, 1, 'the promoted shape became the shared one');
  eq(ws.count(ws.sample(keys[3]), id), 0, 'a well that was never adjusted now uses it');

  ws.setGateOverride(id, k1, { range: { lo: 0, hi: 1e9 } });
  ws.clearGateOverride(id, [k1]);
  eq(ws.adjustedWells(id).length, 0, 'cleared');
});

test('per-well: copyAllOverrides carries every adjusted gate to the targets', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(400));
  const [k0, k1] = ws.samples.map(s => s.key);
  const spec = ws.scaleSpec('FSC-H');
  const a = ws.addGate({ name: 'A', parent: null, type: 'range', x: 'FSC-H', xScale: spec, range: { lo: 0, hi: 1e9 } });
  const b = ws.addGate({ name: 'B', parent: a, type: 'range', x: 'FSC-H', xScale: spec, range: { lo: 0, hi: 1e9 } });
  ws.setGateOverride(a, k0, { range: { lo: 0, hi: 1e9 } });
  ws.setGateOverride(b, k0, { range: { lo: 0, hi: 1 } });
  ws.copyAllOverrides(k0, [k1]);
  eq(ws.adjustedGates(k1).length, 2, 'both gates copied');
  eq(ws.count(ws.sample(k1), b), ws.count(ws.sample(k0), b), 'k1 reproduces k0');
});

test('per-well: a quadrant override moves all four corners and still partitions the parent', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(600));
  const k = ws.samples[0].key;
  const ids = ws.addQuadrant({ parent: null, x: 'FSC-H', y: 'SSC-H', xScale: ws.scaleSpec('FSC-H'),
    yScale: ws.scaleSpec('SSC-H'), cx: 1000, cy: 1000 });
  const s = ws.sample(k);
  ws.setGateOverride(ids[1], k, { quad: { cx: 5000, cy: 5000 } });
  eq(ws.adjustedWells(ids[0]).join(), k, 'the other corners moved with it');
  eq(ws.adjustedWells(ids[3]).join(), k);
  const total = ids.reduce((n, i) => n + ws.count(s, i), 0);
  eq(total, s.n, 'the four corners still partition every event exactly');
  const other = ws.samples[1];
  eq(ids.reduce((n, i) => n + ws.count(other, i), 0), other.n, 'and so do they on an unadjusted well');
});

test('per-well: overrides survive a workspace round trip and are stripped from templates', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(300));
  const k = ws.samples[0].key;
  const id = ws.addGate({ name: 'R', parent: null, type: 'range', x: 'FSC-H', xScale: ws.scaleSpec('FSC-H'), range: { lo: 0, hi: 1e9 } });
  ws.setGateOverride(id, k, { range: { lo: 0, hi: 1 } });

  const saved = JSON.parse(JSON.stringify(ws.toJSON()));
  const tmpl = JSON.parse(JSON.stringify(ws.toTemplate()));

  const ws2 = new FM.Workspace();
  ws2.addSamples(FM.synth.demoPlate(300));
  ws2.loadDoc(saved);
  assert(ws2.isAdjusted(id, k), 'a saved workspace keeps its per-well gates');
  eq(ws2.count(ws2.sample(k), id), 0);

  const ws3 = new FM.Workspace();
  ws3.addSamples(FM.synth.demoPlate(300));
  ws3.loadDoc(tmpl, { template: true });
  assert(!ws3.isAdjusted(id, k), 'a template carries the analysis, not this plate\'s hand tweaks');
});

test('per-well: undo restores the previous override state', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(300));
  const k = ws.samples[0].key;
  const id = ws.addGate({ name: 'R', parent: null, type: 'range', x: 'FSC-H', xScale: ws.scaleSpec('FSC-H'), range: { lo: 0, hi: 1e9 } });
  const before = ws.count(ws.sample(k), id);
  ws.setGateOverride(id, k, { range: { lo: 0, hi: 1 } });
  eq(ws.count(ws.sample(k), id), 0);
  ws.undo();
  assert(!ws.isAdjusted(id, k), 'the override is gone');
  eq(ws.count(ws.sample(k), id), before, 'and the count is back');
});

// ------------------------------------------------- trickle-down / summary
test('summary: with nothing adjusted, every well reads the same as the shared gating', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(400));
  const spec = ws.scaleSpec('FSC-H');
  const a = ws.addGate({ name: 'A', parent: null, type: 'range', x: 'FSC-H', xScale: spec, range: { lo: 0, hi: 1e9 } });
  const b = ws.addGate({ name: 'B', parent: a, type: 'range', x: 'FSC-H', xScale: spec, range: { lo: 200, hi: 1e9 } });
  const t = FM.summary.build(ws);
  eq(t.gates.map(g => g.name).join(), 'A,B', 'gates in hierarchy order');
  eq(t.rows.length, ws.samples.length);
  assert(!t.anyAdjusted, 'nothing adjusted');
  t.rows.forEach(r => r.cells.forEach(c => {
    eq(c.status, 'shared');
    assert(!Number.isFinite(c.delta) || Math.abs(c.delta) < 1e-12, 'no difference from the shared gating');
  }));
  void b;
});

test('summary: adjusting one gate moves that cell AND every cell below it, on that well only', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(500));
  const spec = ws.scaleSpec('FSC-H');
  const a = ws.addGate({ name: 'A', parent: null, type: 'range', x: 'FSC-H', xScale: spec, range: { lo: 0, hi: 1e9 } });
  const b = ws.addGate({ name: 'B', parent: a, type: 'range', x: 'FSC-H', xScale: spec, range: { lo: 0, hi: 1e9 } });
  const c = ws.addGate({ name: 'C', parent: b, type: 'range', x: 'SSC-H', xScale: ws.scaleSpec('SSC-H'), range: { lo: 0, hi: 1e9 } });
  const key = ws.samples[0].key, other = ws.samples[1].key;

  // tighten A on one well only — B and C keep their own shapes but see fewer events
  ws.setGateOverride(a, key, { range: { lo: 0, hi: 300 } });
  const t = FM.summary.build(ws);
  const row = t.rows.find(r => r.sample.key === key);
  const oth = t.rows.find(r => r.sample.key === other);
  assert(t.anyAdjusted, 'the table knows something was adjusted');

  eq(row.cells[0].status, 'adjusted', 'A was adjusted here');
  eq(row.cells[1].status, 'inherited', 'B moved because A above it did');
  eq(row.cells[2].status, 'inherited', 'and so did C — the trickle-down');
  assert(Math.abs(row.cells[0].delta) > 1e-9, 'A differs from the shared gating');
  assert(Number.isFinite(row.cells[2].shared), 'C knows what it would have read');

  oth.cells.forEach(cc => eq(cc.status, 'shared', 'another well is untouched'));
  eq(row.cells.length, 3);
  void c;
});

test('summary: a gate adjusted on a well below an adjusted parent reads as adjusted, not inherited', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(400));
  const spec = ws.scaleSpec('FSC-H');
  const a = ws.addGate({ name: 'A', parent: null, type: 'range', x: 'FSC-H', xScale: spec, range: { lo: 0, hi: 1e9 } });
  const b = ws.addGate({ name: 'B', parent: a, type: 'range', x: 'FSC-H', xScale: spec, range: { lo: 0, hi: 1e9 } });
  const key = ws.samples[0].key;
  ws.setGateOverride(a, key, { range: { lo: 0, hi: 5e8 } });
  ws.setGateOverride(b, key, { range: { lo: 0, hi: 4e8 } });
  const row = FM.summary.build(ws).rows.find(r => r.sample.key === key);
  eq(row.cells[0].status, 'adjusted');
  eq(row.cells[1].status, 'adjusted', 'its own shape was dragged, so it is not merely inherited');
});

test('summary: the shared-gating cache never collides with the live one', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(400));
  const spec = ws.scaleSpec('FSC-H');
  const a = ws.addGate({ name: 'A', parent: null, type: 'range', x: 'FSC-H', xScale: spec, range: { lo: 0, hi: 1e9 } });
  const key = ws.samples[0].key;
  const s = ws.sample(key);
  ws.setGateOverride(a, key, { range: { lo: 0, hi: 1 } });
  eq(ws.count(s, a), 0, 'the live value uses this well’s own gate');
  const shared = ws.countShared(s, a);
  assert(shared > 0, 'the shared value ignores it');
  eq(ws.count(s, a), 0, 'and reading one did not poison the other');
  eq(ws.countShared(s, a), shared, 'nor the other way round');
});

test('summary: value modes — % of parent, % of total and counts agree with the engine', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(400));
  const spec = ws.scaleSpec('FSC-H');
  const a = ws.addGate({ name: 'A', parent: null, type: 'range', x: 'FSC-H', xScale: spec, range: { lo: 0, hi: 1e9 } });
  const b = ws.addGate({ name: 'B', parent: a, type: 'range', x: 'FSC-H', xScale: spec, range: { lo: 300, hi: 1e9 } });
  const s = ws.samples[0];
  ['parent', 'total', 'count'].forEach(mode => {
    const row = FM.summary.build(ws, { mode }).rows.find(r => r.sample.key === s.key);
    const want = mode === 'parent' ? ws.pct(s, b) : mode === 'total' ? ws.pctOf(s, b, null) : ws.count(s, b);
    approx(row.cells[1].value, want, 1e-9, mode);
  });
  void a;
});

// ---------------------------------------------------------------- layout
test('layout: items are added, moved, reordered and removed, each undoable', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(200));
  eq(ws.layout().items.length, 0, 'a fresh document has an empty page');

  const ids = ws.addLayoutItems([
    { kind: 'plot', sample: ws.samples[0].key, pop: null, ax: 'FSC-H', ay: 'SSC-H' },
    { kind: 'text', text: 'Figure 1' },
  ]);
  eq(ids.length, 2);
  eq(ws.layout().items.length, 2);
  const [p, txt] = ws.layout().items;
  assert(p.w > 0 && p.h > 0, 'a plot gets a default size');
  eq(txt.kind, 'text');

  ws.updateLayoutItem(ids[0], { x: 40, y: 60 });
  eq(ws.layoutItem(ids[0]).x, 40);

  ws.reorderLayoutItem(ids[0], 'front');
  eq(ws.layout().items[ws.layout().items.length - 1].id, ids[0], 'brought to the front');
  ws.reorderLayoutItem(ids[0], 'back');
  eq(ws.layout().items[0].id, ids[0], 'sent to the back');

  ws.removeLayoutItems([ids[0]]);
  eq(ws.layout().items.length, 1);
  ws.undo();
  eq(ws.layout().items.length, 2, 'undo brings it back');
});

test('layout: a page of one plot per well, tidied into a grid that stays on the page', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(200));
  const specs = ws.samples.map(s => ({ kind: 'plot', sample: s.key, pop: null, ax: 'FSC-H', ay: 'SSC-H', title: s.well }));
  ws.addLayoutItems(specs);
  ws.tidyLayout();
  const L = ws.layout();
  eq(L.items.length, 18);
  L.items.forEach(it => {
    assert(it.x >= 0 && it.y >= 0, 'on the page at ' + it.x + ',' + it.y);
    assert(it.x + it.w <= L.page.w + 0.5, 'within the page width');
  });
  // the page grows downwards rather than clipping content
  const bottom = Math.max(...L.items.map(it => it.y + it.h));
  assert(bottom <= L.page.h + 0.5, 'the page is tall enough for everything: ' + bottom + ' vs ' + L.page.h);
});

test('layout: survives a workspace round trip, and templates keep the page design', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(200));
  ws.addLayoutItems([{ kind: 'text', text: 'Panel A' }]);
  const saved = JSON.parse(JSON.stringify(ws.toJSON()));
  const tmpl = JSON.parse(JSON.stringify(ws.toTemplate()));

  const ws2 = new FM.Workspace();
  ws2.addSamples(FM.synth.demoPlate(200));
  ws2.loadDoc(saved);
  eq(ws2.layout().items.length, 1, 'kept in a workspace');
  eq(ws2.layout().items[0].text, 'Panel A');

  const ws3 = new FM.Workspace();
  ws3.addSamples(FM.synth.demoPlate(200));
  ws3.loadDoc(tmpl, { template: true });
  eq(ws3.layout().items.length, 1, 'a page design is part of the reusable analysis');
});

test('layout: an item pointing at a deleted gate or a missing well is reported, not fatal', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(200));
  const g = ws.addGate({ name: 'G', parent: null, type: 'range', x: 'FSC-H', xScale: ws.scaleSpec('FSC-H'), range: { lo: 0, hi: 1e9 } });
  const ids = ws.addLayoutItems([
    { kind: 'plot', sample: ws.samples[0].key, pop: g, ax: 'FSC-H', ay: 'SSC-H' },
    { kind: 'plot', sample: 'NOPE', pop: null, ax: 'FSC-H', ay: 'SSC-H' },
  ]);
  eq(ws.layoutProblem(ws.layoutItem(ids[0])), null, 'a good item has no problem');
  assert(/well/i.test(ws.layoutProblem(ws.layoutItem(ids[1])) || ''), 'a missing well is named');
  ws.deleteGate(g);
  assert(/population|gate/i.test(ws.layoutProblem(ws.layoutItem(ids[0])) || ''), 'a deleted population is named');
});

// ----------------------------------------------------------------- stats
test('stats: descriptive values', () => {
  const d = FM.stats.describe([1, 2, 4, 8]);
  approx(d.mean, 3.75, 1e-12);
  approx(d.gmean, Math.pow(64, 1 / 4), 1e-12);
  approx(d.median, 3, 1e-12);
  approx(d.sd, Math.sqrt(((1 - 3.75) ** 2 + (2 - 3.75) ** 2 + (4 - 3.75) ** 2 + (8 - 3.75) ** 2) / 3), 1e-12);
  approx(FM.stats.gmean([0, -1, 4, 9]), 6, 1e-12, 'gmean ignores non-positive');
});

// ------------------------------------------------------------- inference
const REF = {"pnorm": [[-6, 9.865876450376948e-10], [-3, 0.001349898031630093], [-1.96, 0.024997895148220435], [-0.5, 0.3085375387259869], [0, 0.5], [0.3, 0.6179114221889526], [1, 0.8413447460685429], [1.96, 0.9750021048517795], [2.4, 0.9918024640754038], [2.6, 0.9953388119762813], [3.5, 0.9997673709209645], [5, 0.9999997133484281]], "pF": [[2.6769, 4, 9, 0.10125653262043145], [1.0, 2, 10, 0.401877572016461], [5.5, 3, 20, 0.006389447001977167], [0.2, 1, 5, 0.6734284355375535], [12, 4, 9, 0.0011828842066403365]], "pT2": [[2.1, 5, 0.08975324988459868], [0.5, 10, 0.6278936057429729], [-3.3, 12, 0.006340750106287178], [1.0, 1, 0.49999999999999956], [4.0, 2, 0.05719095841793663]], "ptukey": [[3.877, 3, 10, 0.9500129112467469], [2.0, 5, 9, 0.3654308366130313], [3.5, 4, 20, 0.9050415494536981], [4.5, 5, 9, 0.9348725253559599], [1.2, 2, 30, 0.5971361169231773], [5.0, 6, 12, 0.9628411590286837], [2.8, 5, 9, 0.6538321865377408]]};

test('inference: normal CDF matches scipy', () => {
  REF.pnorm.forEach(([x, p]) => {
    const got = FM.inference.pnorm(x);
    assert(Math.abs(got - p) <= 1e-12 + 1e-9 * p, 'pnorm(' + x + ') = ' + got + ' vs ' + p);
  });
});

test('inference: F and t tail probabilities match scipy', () => {
  REF.pF.forEach(([f, a, b, p]) => approx(FM.inference.pFupper(f, a, b), p, 1e-8, 'pF ' + f));
  REF.pT2.forEach(([t, df, p]) => approx(FM.inference.pT2(t, df), p, 1e-8, 'pT ' + t));
});

test('inference: studentized range CDF matches scipy', () => {
  REF.ptukey.forEach(([q, k, df, p]) => absApprox(FM.inference.ptukey(q, k, df), p, 2e-6, 'ptukey(' + q + ',' + k + ',' + df + ')'));
});

// ------------------------------------------------------------------ expr
test('expr: parses and evaluates the phagoscore formula', () => {
  const ast = FM.expr.parse('gmean("THP Cells + Beads", "FL1-H") * pct(\'THP Cells + Beads\') / 1e6 + 2^3 - -1');
  const ctx = {
    popId: n => (n === 'THP Cells + Beads' ? 'g3' : undefined), hasParam: p => p === 'FL1-H',
    count: () => 0, pctParent: () => 50, pctOf: () => 0, stat: (id, p, w) => (w === 'gmean' ? 2e5 : 0),
  };
  approx(FM.expr.evaluate(ast, ctx), 2e5 * 50 / 1e6 + 8 + 1, 1e-12);
});

test('expr: helpful errors', () => {
  const msg = src => { try { FM.expr.parse(src); return ''; } catch (e) { return e.message; } };
  assert(/need quotes/.test(msg('pct(Singles)')), msg('pct(Singles)'));
  assert(/Unknown function/.test(msg('foo("x")')));
  assert(/inside a function/.test(msg('"Singles" * 2')));
  assert(/population", "parameter/.test(msg('gmean("Singles")')));
  let em = '';
  try { FM.expr.evaluate(FM.expr.parse('pct("Nope")'), { popId: () => undefined }); } catch (e) { em = e.message; }
  assert(/No population named "Nope"/.test(em), em);
});

test('expr: renaming a population rewrites references only', () => {
  const out = FM.expr.renamePopulation('gmean("Beads", "FL1-H") * pct("Beads") + count("Beads 2")', 'Beads', 'Beads+');
  eq(out, 'gmean("Beads+", "FL1-H") * pct("Beads+") + count("Beads 2")');
});

// ----------------------------------------------------------------- wells
test('wells: detection from keywords and file names', () => {
  eq(FM.wells.detect({ name: '01-Well-A1.fcs', meta: {} }), 'A1');
  eq(FM.wells.detect({ name: 'plate3_B07.fcs', meta: {} }), 'B7');
  eq(FM.wells.detect({ name: 'x.fcs', meta: { '$WELLID': 'h12' } }), 'H12');
  eq(FM.wells.detect({ name: 'Specimen_001_Tube_003.fcs', meta: {} }), null);
  const f = FM.wells.frame(['A1', 'F3', 'C2']);
  eq(f.format, 96); eq(f.r1, 5); eq(f.c1, 2);
});

// ------------------------------------------------------------- workspace
test('workspace: undo/redo, rename propagates into metrics', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(500));
  const id = ws.addGate({ name: 'Beads', parent: null, type: 'range', x: 'FL1-H', range: { lo: 6e4, hi: 1e7 }, xScale: ws.scaleSpec('FL1-H') });
  const mid = ws.addMetric('pos', 'pct("Beads")');
  assert(ws.renameGate(id, 'Beads+'));
  eq(ws.metric(mid).expr, 'pct("Beads+")');
  ws.undo();
  eq(ws.metric(mid).expr, 'pct("Beads")');
  eq(ws.gate(id).name, 'Beads');
  ws.redo();
  eq(ws.gate(id).name, 'Beads+');
  assert(!ws.renameGate(id, ''), 'empty name refused');
});

test('workspace: coalesced edits make one undo step', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(300));
  const id = ws.addGate({ name: 'R', parent: null, type: 'range', x: 'FL1-H', range: { lo: 1, hi: 2 }, xScale: ws.scaleSpec('FL1-H') });
  const before = ws.undoStack.length;
  for (let i = 0; i < 5; i++) ws.updateGate(id, { range: { lo: 1, hi: 3 + i } }, { coalesce: 'drag' });
  eq(ws.undoStack.length, before + 1);
  ws.undo();
  eq(ws.gate(id).range.hi, 2);
});

/** The phagoscore read-outs and the reference control: no longer made by the preset (FlowMate's UI
 * dropped formula metrics and Results), but the analysis engine still computes them, so its
 * validation against the independent Python analysis keeps running. */
function phagoAnalysisSetup(ws) {
  const bead = ws.gate(ws.popIdByName('THP Cells + Beads')).x;
  const id = ws.addMetric('Phagoscore', 'gmean("THP Cells + Beads", "' + bead + '") * pct("THP Cells + Beads")');
  ws.addMetric('% bead-positive', 'pct("THP Cells + Beads")');
  ws.addMetric('gMFI in gate', 'gmean("THP Cells + Beads", "' + bead + '")');
  ws.setSetting('primaryMetric', id);
  const ctrl = ws.doc.groups.find(g => g.name === 'THP + beads');
  if (ctrl) ws.updateGroup(ctrl.id, { role: 'control' });
}

test('workspace: template round-trip keeps gates, the Measure table and well-keyed layout', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(300));
  const p = FM.presets.byId('phagocytosis');
  FM.presets.apply(ws, p, { mapping: FM.presets.autoMap(p, ws.paramNames()), layout: true, replace: true });
  const tpl = JSON.parse(JSON.stringify(ws.toTemplate()));
  const ws2 = new FM.Workspace();
  ws2.addSamples(FM.synth.demoPlate(300));
  ws2.loadDoc(tpl, { template: true });
  eq(ws2.doc.gates.length, 3);
  eq(ws2.doc.tables.length, 1, 'the Measure table from the preset');
  eq(ws2.doc.tables[0].columns.length, 3);
  eq(ws2.groupOf('A1').name, 'IgG1');
  eq(ws2.groupOf('F3').name, 'THP alone');
});

test('synth + preset: demo plate analysis flags the failed well', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(4000));
  const p = FM.presets.byId('phagocytosis');
  FM.presets.apply(ws, p, { mapping: FM.presets.autoMap(p, ws.paramNames()), layout: true, replace: true });
  phagoAnalysisSetup(ws);
  const res = FM.analysis.analyze(ws, ws.doc.settings.primaryMetric);
  const out = res.checks.find(c => c.kind === 'outlier' && c.wells[0] === 'E1');
  assert(out && out.level === 'critical', 'E1 flagged critical: ' + JSON.stringify(res.checks.map(c => c.title)));
  const gc = res.checks.find(c => c.kind === 'gate-control');
  assert(gc && gc.level === 'ok', 'THP alone is empty in the bead gate');
});

// ------------------------------------------------------------ edge cases
function buildFCS(opts) {
  // minimal FCS3.0 writer for tests: params [{name}], rows: array of arrays
  const { params, rows, datatype, bigEndian, zeroHeaderOffsets } = opts;
  const bytes = datatype === 'D' ? 8 : 4;
  const nbytes = rows.length * params.length * bytes;
  let text = '/$BYTEORD/' + (bigEndian ? '4,3,2,1' : '1,2,3,4') + '/$DATATYPE/' + datatype + '/$MODE/L/$PAR/' + params.length + '/$TOT/' + rows.length + '/';
  params.forEach((p, i) => { text += '$P' + (i + 1) + 'N/' + p + '/$P' + (i + 1) + 'B/' + (bytes * 8) + '/$P' + (i + 1) + 'R/262144/$P' + (i + 1) + 'E/0,0/'; });
  const textStart = 58;
  // $BEGINDATA/$ENDDATA need their own width: pad to a fixed width so offsets are stable
  const placeholder = '/$BEGINDATA/0000000000/$ENDDATA/0000000000/';
  let full = text.slice(0, -1) + placeholder;
  const dataStart = textStart + full.length;
  full = full.replace('/$BEGINDATA/0000000000/', '/$BEGINDATA/' + String(dataStart).padStart(10, '0') + '/')
             .replace('/$ENDDATA/0000000000/', '/$ENDDATA/' + String(dataStart + nbytes - 1).padStart(10, '0') + '/');
  const pad = v => String(v).padStart(8, ' ');
  const hdr = 'FCS3.0    ' + pad(textStart) + pad(textStart + full.length - 1) + (zeroHeaderOffsets ? pad(0) + pad(0) : pad(dataStart) + pad(dataStart + nbytes - 1)) + pad(0) + pad(0);
  const buf = new ArrayBuffer(dataStart + nbytes);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < hdr.length; i++) u8[i] = hdr.charCodeAt(i);
  for (let i = 0; i < full.length; i++) u8[textStart + i] = full.charCodeAt(i);
  const dv = new DataView(buf, dataStart);
  let o = 0;
  rows.forEach(r => r.forEach(v => { if (bytes === 8) dv.setFloat64(o, v, !bigEndian); else dv.setFloat32(o, v, !bigEndian); o += bytes; }));
  return buf;
}

test('fcs: double-precision, big-endian, data offsets only in $BEGINDATA', () => {
  const buf = buildFCS({ params: ['FSC-A', 'APC-A'], rows: [[1.5, -20.25], [300000.125, 1e6]], datatype: 'D', bigEndian: true, zeroHeaderOffsets: true });
  const s = FM.fcs.parse(buf, 'd.fcs');
  eq(s.n, 2);
  approx(s.data['APC-A'][0], -20.25, 1e-6);
  approx(s.data['FSC-A'][1], 300000.125, 1e-6);
});

test('engine: a gate on a parameter a file lacks yields an empty population, not a crash', () => {
  const ws = new FM.Workspace();
  const a = FM.fcs.parse(buildFCS({ params: ['FSC-A', 'FL1-A'], rows: [[1, 2], [3, 4]], datatype: 'F' }), 'a.fcs');
  const b = FM.fcs.parse(buildFCS({ params: ['FSC-A'], rows: [[1], [3]], datatype: 'F' }), 'b.fcs');
  ws.addSamples([a, b]);
  const id = ws.addGate({ name: 'Pos', parent: null, type: 'range', x: 'FL1-A', range: { lo: 0, hi: 10 }, xScale: ws.scaleSpec('FL1-A') });
  eq(ws.count(ws.sample('a.fcs'), id), 2);
  eq(ws.count(ws.sample('b.fcs'), id), 0);
  assert(/FL1-A/.test(ws.sample('b.fcs')._popErrors[id]), 'error recorded for the file');
});

test('engine: a metric that points at a deleted gate reports a readable error', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(200));
  const id = ws.addGate({ name: 'Beads', parent: null, type: 'range', x: 'FL1-H', range: { lo: 6e4, hi: 1e7 }, xScale: ws.scaleSpec('FL1-H') });
  const mid = ws.addMetric('pos', 'pct("Beads")');
  ws.deleteGate(id);
  const v = ws.metricValue(ws.samples[0], mid);
  assert(!Number.isFinite(v.value) && /No population named "Beads"/.test(v.error), v.error);
  const res = FM.analysis.analyze(ws, mid);   // must not throw
  eq(res.wells.length, 18);
});

test('analysis: no reference control, and a single condition, degrade gracefully', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(300));
  const mid = ws.addMetric('events', 'count("All events")');
  let res = FM.analysis.analyze(ws, mid);
  eq(res.control, null);
  eq(res.anova, null);
  eq(FM.analysis.headline(res).level, 'info');
  const g = ws.addGroup('Only');
  ws.assign(ws.samples.map(s => s.key), g);
  ws.updateGroup(g, { role: 'control' });
  res = FM.analysis.analyze(ws, mid);
  eq(res.groups.length, 1);
  eq(res.anova, null, 'no ANOVA with one group');
  approx(res.groups[0].fold, 1, 1e-12);
});

test('wells: plates without well IDs fall back to file names', () => {
  const ws = new FM.Workspace();
  const s1 = FM.fcs.parse(buildFCS({ params: ['FSC-A'], rows: [[1]], datatype: 'F' }), 'Specimen_001_Tube_001.fcs');
  const s2 = FM.fcs.parse(buildFCS({ params: ['FSC-A'], rows: [[1]], datatype: 'F' }), 'Specimen_001_Tube_002.fcs');
  ws.addSamples([s1, s2]);
  eq(ws.samples[0].key, 'Specimen_001_Tube_001.fcs');
  eq(FM.wells.frame(ws.samples.map(s => s.well).filter(Boolean)), null);
});

test('quadrants: four linked gates partition the parent exactly, move and delete as a set', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(2000));
  const ids = ws.addQuadrant({ parent: null, x: 'FL1-H', y: 'SSC-H', xScale: ws.scaleSpec('FL1-H'), yScale: ws.scaleSpec('SSC-H'), cx: 6e4, cy: 2e5 });
  eq(ids.length, 4);
  eq(ws.undoStack.length, 1, 'one undo step');
  const s = ws.sample('A1');
  const counts = ids.map(id => ws.count(s, id));
  eq(counts.reduce((a, b) => a + b, 0), s.n, 'every event in exactly one quadrant');
  const names = ids.map(id => ws.gate(id).name);
  eq(names.join('|'), 'FL1− SSC+|FL1+ SSC+|FL1− SSC−|FL1+ SSC−');
  const link = ws.gate(ids[0]).link;
  ws.updateQuad(link, { cx: 1e5, cy: 2e5 });
  assert(ids.every(id => ws.gate(id).quad.cx === 1e5), 'all four moved');
  eq(ids.map(id => ws.count(s, id)).reduce((a, b) => a + b, 0), s.n, 'still a partition after moving');
  ws.deleteGate(ids[2]);
  eq(ws.doc.gates.length, 0, 'deleting one quadrant removes the set');
  ws.undo();
  eq(ws.doc.gates.length, 4);
});

test('wells: pasted plate maps with and without row/column labels', () => {
  const withLabels = '\t1\t2\t3\nA\tIgG1\tIgG1\tIgG1\nB\tLALA\t\tLALA\n';
  let p = FM.wells.parseLayout(withLabels);
  eq(p.wells.A1, 'IgG1'); eq(p.wells.B3, 'LALA'); eq(p.wells.B2, undefined);
  eq(p.names.join('|'), 'IgG1|LALA');
  p = FM.wells.parseLayout('ctrl,ctrl\ndrug,drug');
  eq(p.wells.A2, 'ctrl'); eq(p.wells.B1, 'drug');
  p = FM.wells.parseLayout('\t10\t11\nG\tx\ty\n');
  eq(p.wells.G10, 'x'); eq(p.wells.G11, 'y');
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(200));
  ws.applyLayout(FM.wells.parseLayout(withLabels).wells);
  eq(ws.groupOf('A2').name, 'IgG1'); eq(ws.groupOf('B1').name, 'LALA'); eq(ws.groupOf('B2'), null);
  eq(ws.undoStack.length, 1, 'one undo step');
  // a well pasted before its file exists is assigned once the file arrives
  const ws2 = new FM.Workspace();
  ws2.applyLayout({ H12: 'late' });
  ws2.addSamples([FM.fcs.parse(buildFCS({ params: ['FSC-A'], rows: [[1]], datatype: 'F' }), 'x_H12.fcs')]);
  eq(ws2.groupOf('H12').name, 'late');
});

// ------------------------------------------------------ publication stats
test('qtukey inverts ptukey (reference: scipy studentized_range.ppf)', () => {
  [[0.95, 3, 10, 3.876776750013159], [0.95, 5, 10, 4.654292997854541], [0.99, 4, 20, 5.018016131510624],
    [0.9, 2, 30, 2.400289364706577], [0.95, 6, 12, 4.75023144671096]].forEach(([p, k, df, q]) =>
    approx(FM.inference.qtukey(p, k, df), q, 2e-6, 'qtukey(' + p + ',' + k + ',' + df + ')'));
  assert(Number.isNaN(FM.inference.qtukey(1.2, 3, 10)), 'p outside (0,1) is NaN');
});

test('stars: GraphPad scale on the boundaries, APA and NEJM stop at three', () => {
  const A = FM.analysis;
  eq(A.stars(0.05), '*', 'p = 0.05 is significant (≤)');
  eq(A.stars(0.0501), 'ns');
  eq(A.stars(0.01), '**');
  eq(A.stars(0.001), '***');
  eq(A.stars(0.0001), '****');
  eq(A.stars(0.00001, 'apa'), '***');
  eq(A.stars(0.00001, 'nejm'), '***');
  eq(A.stars(NaN), '');
  assert(/\*\*\*\*, p ≤ 0.0001/.test(A.starScale('graphpad')), 'scale names four stars');
  assert(!/\*\*\*\*/.test(A.starScale('apa')), 'APA scale stops at three');
});

test('p-values are printed the way each style prints them', () => {
  const A = FM.analysis;
  eq(A.fmtPpub(0.01234, 'graphpad'), '0.0123');
  eq(A.fmtPpub(0.00001, 'graphpad'), '<0.0001');
  eq(A.fmtPpub(0.01234, 'nejm'), '0.012');
  eq(A.fmtPpub(0.0004, 'nejm'), '<0.001');
  eq(A.fmtPpub(0.01234, 'apa'), '.012');
  eq(A.fmtPpub(0.0004, 'apa'), '<.001');
});
