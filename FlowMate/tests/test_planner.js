/* Unit tests for the panel planner engine (src/core/planner.js) and chart (src/render/spectra.js). */
const PL = () => FM.planner;
const LX = () => PL().instrument('cytoflex-lx');
const dyes = (...ids) => ids.map(id => PL().dye(id));

test('planner: library decodes every dye on the 300–900 nm grid, peak = 1', () => {
  const lib = PL().library();
  assert(lib.length >= 80, 'library size ' + lib.length);
  lib.forEach(d => {
    eq(d.ex.length, 301, d.name + ' ex length'); eq(d.em.length, 301, d.name + ' em length');
    approx(Math.max(...d.ex), 1, 0.01, d.name + ' ex peak'); approx(Math.max(...d.em), 1, 0.01, d.name + ' em peak');
    assert(PL().CATEGORIES.includes(d.cat), d.name + ' category ' + d.cat);
  });
});

test('planner: known peaks: FITC 494/518, PE 565/575, APC 650/660, BV421 405/421 (±8 nm)', () => {
  const pk = (id, ex, em) => { const d = PL().dye(id); absApprox(d.exPeak, ex, 8, id + ' ex'); absApprox(d.emPeak, em, 8, id + ' em'); };
  pk('fitc', 494, 518); pk('pe', 565, 575); pk('apc', 650, 660); pk('bv421', 405, 421);
});

test('planner: excitation reads the spectrum at the laser line; PE is excited far more by 561 than 488', () => {
  const pe = PL().dye('pe');
  assert(PL().excitation(pe, 561) > 0.8, 'PE @561 ' + PL().excitation(pe, 561));
  assert(PL().excitation(pe, 488) < PL().excitation(pe, 561), 'PE @488 below @561');
  assert(PL().excitation(PL().dye('fitc'), 488) > 0.7, 'FITC @488 (≈77%: FITC peaks at 494–498 nm)');
  eq(PL().excitation(pe, 250), 0, 'outside the grid is 0');
});

test('planner: captured fraction integrates the emission through the filter', () => {
  const fitc = PL().dye('fitc');
  const bp = { id: 'B525', laser: 488, center: 525, width: 40, type: 'bp' };
  const c = PL().captured(fitc, bp);
  assert(c > 0.3 && c < 0.7, 'FITC in 525/40 ' + c);
  approx(PL().captured(fitc, { id: 'x', laser: 488, center: 300, width: 0, type: 'lp' }), 1, 1e-6, '300LP passes everything');
  assert(PL().captured(fitc, { id: 'y', laser: 488, center: 780, width: 60, type: 'bp' }) < 0.01, 'FITC barely reaches 780/60');
  approx(PL().signal(fitc, bp), PL().excitation(fitc, 488) * c, 1e-12, 'signal = excitation × captured');
});

test('planner: integrate is exact for piecewise-linear data', () => {
  const f = new Float32Array(301).fill(1);
  approx(PL().integrate(f, 400, 450), 50, 1e-9);
  approx(PL().integrate(f, 401, 402.5), 1.5, 1e-9, 'sub-step interval');
  eq(PL().integrate(f, 950, 990), 0, 'outside');
});

test('planner: a custom dye peaks where asked, with the requested width', () => {
  const d = PL().customDye({ name: 'My dye', exPeak: 470, emPeak: 530, exWidth: 40, emWidth: 50 });
  eq(d.custom, true); eq(d.exPeak, 470); eq(d.emPeak, 530);
  absApprox(PL().excitation(d, 470), 1, 0.001, 'peak value');
  let lo = 470, hi = 470;
  while (PL().excitation(d, lo) > 0.5) lo -= 0.25;
  while (PL().excitation(d, hi) > 0.5) hi += 0.25;
  absApprox(hi - lo, 40, 2, 'excitation FWHM');
  assert(470 - lo > hi - 470, 'excitation tail on the blue side');
  let msg = ''; try { PL().customDye({ exPeak: 100, emPeak: 530 }); } catch (e) { msg = e.message; }
  assert(/between/.test(msg), msg);
});

test('planner: search finds by name and alias, exact matches first', () => {
  eq(PL().search('pe')[0].id, 'pe', 'exact first');
  assert(PL().search('phycoerythrin').some(d => d.id === 'pe'), 'alias');
  assert(PL().search('brilliant violet 421').some(d => d.id === 'bv421'), 'long name');
  eq(PL().search('zzz').length, 0);
});

test('planner: colours and names', () => {
  eq(PL().laserName(488), 'Blue'); eq(PL().laserName(355), 'UV'); eq(PL().laserName(638), 'Red');
  eq(PL().detLabel({ center: 525, width: 40, type: 'bp' }), '525/40');
  eq(PL().detLabel({ center: 670, width: 0, type: 'lp' }), '670LP');
  assert(/^rgb\(\d+,\d+,\d+\)$/.test(PL().wavelengthColor(520)), PL().wavelengthColor(520));
  eq(PL().pct(0.004), '<1%'); eq(PL().pct(0.056), '5.6%'); eq(PL().pct(0.345), '35%');
});

test('planner: instrument presets are well-formed; detectors sit on the instrument’s lasers', () => {
  PL().INSTRUMENTS.forEach(inst => {
    assert(inst.id && inst.name && inst.lasers.length, inst.id);
    const ids = new Set();
    inst.detectors.forEach(d => {
      assert(inst.lasers.includes(d.laser), inst.id + ' ' + d.id + ' laser');
      assert(!ids.has(d.id), inst.id + ' duplicate id ' + d.id); ids.add(d.id);
      assert(d.type === 'bp' ? d.width > 0 : d.type === 'lp', inst.id + ' ' + d.id + ' filter');
    });
  });
  eq(PL().instrument('cytoflex-v5b5r3').detectors.length, 13, 'V5-B5-R3');
  eq(PL().instrument('cytoflex-v0b5r3').detectors.length, 8, 'V0-B5-R3');
  eq(PL().instrument('cytoflex-s-v4b2y4r3').detectors.length, 13, 'S V4-B2-Y4-R3');
  eq(LX().detectors.length, 19, 'LX');
  LX().name = 'changed';
  assert(LX().name !== 'changed', 'instrument() returns a copy');
});

test('planner: CytoFLEX detector names like "488__525-40"', () => {
  const p = PL().parseDetectorName('488__525-40');
  eq(p.laser, 488); eq(p.center, 525); eq(p.width, 40); eq(p.type, 'bp');
  eq(PL().parseDetectorName('355__405-30-H').center, 405, 'parameter suffix');
  eq(PL().parseDetectorName('FSC-H'), null);
});

test('planner: reads the instrument from a real CytoFLEX LX file: 5 lasers, 19 detectors, = the LX preset', async () => {
  // the lab's own file (not in the public repository): skip when it is not there
  let r = null;
  try { r = await fetch('data/01-Well-A1.fcs'); } catch (_) { return 'SKIP'; }
  if (!r.ok) return 'SKIP';
  const s = FM.fcs.parse(await r.arrayBuffer(), '01-Well-A1.fcs');
  const inst = PL().instrumentFromSamples([s]);
  assert(inst, 'instrument found');
  eq(inst.id, 'from-files');
  eq(inst.lasers.join(), '355,405,488,561,638');
  eq(inst.detectors.length, 19);
  const fl1 = inst.detectors.find(d => d.id === 'FL1');
  eq(fl1.laser + ' ' + PL().detLabel(fl1), '355 405/30', 'FL1 is the UV 405/30 detector');
  assert(/CytoFLEX LX/.test(inst.name), inst.name);
  const key = i => i.detectors.map(d => d.id + ':' + d.laser + ':' + d.center + '/' + d.width).sort().join();
  eq(key(LX()), key(inst), 'preset = file');
  eq(PL().instrumentFromSamples([{ meta: { '$P1N': 'FSC-H' } }]), null, 'no detector names → null');
});

test('planner: normInstrument cleans a hand-edited instrument', () => {
  const n = PL().normInstrument({ name: 'X', lasers: [488, 'x'], detectors: [
    { id: 'a', laser: 488, center: 530, width: 30, type: 'bp' }, { id: 'b', laser: 999, center: 1, width: 1 }, { id: '', laser: 488, center: 670, type: 'lp' }] });
  eq(n.lasers.join(), '488');
  eq(n.detectors.length, 2, 'detector on a missing laser dropped');
  eq(n.detectors[1].id, 'B670', 'unnamed detector gets a name');
  eq(PL().normInstrument(null), null);
  eq(PL().normInstrument({ lasers: [], detectors: [] }), null, 'no lasers');
});

test('planner: hungarian finds the minimum-cost assignment', () => {
  eq(PL().hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]]).join(), '1,0,2', 'cost 1+2+2 = 5');
  eq(PL().hungarian([[1, 9, 9, 9], [9, 9, 1, 9]]).join(), '0,2', 'rectangular');
});

test('planner: assign gives each dye its own detector: the classic ones on the LX', () => {
  const a = PL().assign(dyes('fitc', 'pe', 'apc', 'bv421'), LX());
  eq(new Set(a).size, 4, 'unique');
  const where = id => { const d = LX().detectors.find(x => x.id === id); return d.laser + ' ' + PL().detLabel(d); };
  eq(where(a[0]), '488 525/40', 'FITC');
  eq(where(a[1]), '561 585/42', 'PE');
  eq(where(a[2]), '638 660/10', 'APC');
  eq(where(a[3]), '405 450/45', 'BV421');
});

test('planner: overrides are honoured; with more dyes than detectors the extras get none', () => {
  const inst = { name: 't', lasers: [488], detectors: [{ id: 'A', laser: 488, center: 525, width: 40, type: 'bp' }, { id: 'B', laser: 488, center: 690, width: 50, type: 'bp' }] };
  const ds = dyes('fitc', 'percpcy55', 'pe');
  const a = PL().assign(ds, inst);
  eq(a[0], 'A', 'FITC'); eq(a[1], 'B', 'PerCP-Cy5.5'); eq(a[2], null, 'PE gets none');
  const o = PL().assign(ds, inst, ['B', null, null]);
  eq(o[0], 'B', 'override kept');
  eq(o.filter(x => x === 'A').length, 1, 'the free detector is used once');
  eq(PL().assign(ds, inst, ['nope'])[0], 'A', 'invalid override ignored');
});

test('planner: spillover: FITC into the PE detector on a blue-only instrument, much less when PE sits on 561', () => {
  const ds = dyes('fitc', 'pe');
  const b = PL().instrument('cytoflex-v0b5r3');
  const S = PL().spillover(ds, b, PL().assign(ds, b));
  eq(S[0][0], 1); eq(S[1][1], 1);
  assert(S[0][1] > 0.05 && S[0][1] < 0.6, 'FITC → PE (488 · 585/42) ' + S[0][1]);
  assert(S[1][0] < S[0][1], 'PE → FITC is smaller');
  const L = PL().spillover(ds, LX(), PL().assign(ds, LX()));
  assert(L[0][1] < S[0][1] / 5, 'with PE read off the 561 laser, FITC hardly reaches it: ' + L[0][1]);
});

test('planner: checks: a clean panel says so; shared detector, unexcited dye and heavy spill are flagged', () => {
  const inst = LX();
  let ds = dyes('fitc', 'pe', 'apc');
  let c = PL().checks(ds, inst, PL().assign(ds, inst));
  eq(c[0].level, 'ok', JSON.stringify(c.map(x => x.text)));
  ds = dyes('fitc', 'af488');
  c = PL().checks(ds, inst, PL().assign(ds, inst, ['FL9', 'FL9']));
  assert(c.some(x => x.kind === 'shared' && x.level === 'crit'), 'shared detector');
  const uv = PL().customDye({ name: 'Deep UV', exPeak: 310, emPeak: 330, exWidth: 20, emWidth: 20 });
  c = PL().checks([uv], inst, PL().assign([uv], inst));
  assert(c.some(x => x.kind === 'unexcited' && x.level === 'crit'), 'unexcited');
  c = PL().checks(ds, inst, PL().assign(ds, inst));
  assert(c.some(x => x.kind === 'spill' && x.level === 'crit'), 'FITC + AF488: ' + JSON.stringify(c.map(x => x.text)));
  eq(['crit', 'warn', 'ok', 'info'].indexOf(c[0].level), 0, 'critical first');
});

test('planner: the phagocytosis preset lands blue beads on FL1 (355 · 405/30) with no critical checks', () => {
  const p = PL().presetPanel('phagocytosis');
  eq(p.instrument.id, 'cytoflex-lx');
  const ds = p.dyes.map(PL().resolve);
  assert(ds.every(Boolean), 'all dyes known');
  const a = PL().assign(ds, p.instrument, p.dyes.map(e => e.detector));
  eq(a[0], 'FL1', 'beads → the channel the 17-Sep plate used');
  const c = PL().checks(ds, p.instrument, a);
  assert(!c.some(x => x.level === 'crit'), JSON.stringify(c.map(x => x.text)));
});

test('planner: serialize → deserialize round-trips; bad files are refused with a clear message', () => {
  const p = PL().presetPanel('phagocytosis');
  p.name = 'Round trip'; p.dyes[1].target = 'CD14'; p.dyes[2].detector = 'FL18';
  p.dyes.push({ ref: null, custom: { name: 'Mine', exPeak: 500, emPeak: 540, exWidth: 40, emWidth: 45, brightness: 3 }, target: '', detector: null, hidden: true });
  const r = PL().deserialize(PL().serialize(p));
  eq(r.warnings.length, 0);
  eq(r.panel.name, 'Round trip');
  eq(r.panel.dyes.length, 4);
  eq(r.panel.dyes[1].target, 'CD14'); eq(r.panel.dyes[2].detector, 'FL18'); eq(r.panel.dyes[3].hidden, true);
  eq(PL().resolve(r.panel.dyes[3]).emPeak, 540);
  eq(r.panel.instrument.detectors.length, 19);
  let m = ''; try { PL().deserialize('{"kind":"something"}'); } catch (e) { m = e.message; }
  assert(/not a FlowMate panel/.test(m), m);
  m = ''; try { PL().deserialize('not json'); } catch (e) { m = e.message; }
  assert(/JSON/.test(m), m);
  const w = PL().deserialize({ kind: 'flowmotion-panel', version: 1, name: 'x', dyes: [{ ref: 'no-such-dye' }] });
  eq(w.panel.dyes.length, 0); eq(w.warnings.length, 1);
  assert(w.panel.instrument.detectors.length > 0, 'a missing instrument falls back to a preset');
});

test('spectra plot: laser line in its colour, emission fill under the peak, nmAt inverts pxAt', () => {
  const cv = document.createElement('canvas');
  cv.style.cssText = 'width:800px;height:300px';
  document.body.appendChild(cv);
  const fitc = PL().dye('fitc');
  const L = FM.spectraPlot.draw(cv, {
    dyes: [{ name: 'FITC', color: PL().wavelengthColor(fitc.emPeak), ex: fitc.ex, em: fitc.em, emScale: 1, peak: fitc.emPeak }],
    lasers: [{ nm: 488, color: 'rgb(0,90,255)', active: true, label: '488' }], lanes: [], bands: [], showEx: true, hover: null,
  });
  const ctx = cv.getContext('2d'), dpr = cv.width / 800;
  const px = (x, y) => Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
  const [r, g, b] = px(L.pxAt(488), L.yTop + 4);
  assert(b > 120 && b > r + 60, 'laser line colour: ' + [r, g, b]);
  const fill = px(L.pxAt(518), L.yBase - 4);
  assert(fill[1] > fill[2] && fill[1] > fill[0], 'green FITC emission fill: ' + fill);
  approx(L.nmAt(L.pxAt(600)), 600, 1e-9);
  cv.remove();
});
