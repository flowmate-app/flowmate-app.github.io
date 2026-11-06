/* Unmixing (core/unmix.js, core/comp.js): spectral unmixing and compensation from controls.
 *
 * Pre-registered (docs/superpowers/specs/2026-10-23-unmix-step-design.md), fixed before the first
 * run: on the synthetic spectral plate, every dye's unmixed values correlate with the truth at
 * Pearson r ≥ 0.99, and the median of (unmixed − truth) is within 2% of the dye's median true
 * signal. Failures are reported, not tuned.
 */
(function () {
  /** A workspace with the spectral demo: controls in conditions with the right roles. */
  function spectralWs(opts) {
    opts = opts || {};
    const demo = FM.synth.spectralDemo(opts.n || 3000);
    const ws = new FM.Workspace();
    ws.addSamples(demo.samples);
    const unst = ws.addGroup('Unstained', 'unstained');
    ws.assign([ws.samples.find(s => /Unstained/.test(s.name)).key], unst);
    demo.dyes.forEach(d => {
      const s = ws.samples.find(x => x.name === d.label + ' single stain.fcs');
      const g = ws.addGroup(d.label, 'comp');
      ws.assign([s.key], g);
    });
    const stained = ws.addGroup('Stained', 'sample');
    ws.assign(ws.samples.filter(s => /^Stained_/.test(s.name)).map(s => s.key), stained);
    return { ws, demo };
  }
  function pearson(a, b) {
    const n = a.length; let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return sab / Math.sqrt(saa * sbb);
  }
  const med = a => { const s = Float64Array.from(a).sort(); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

  test('unmix: the synthetic spectral plate has 32 detectors, 6 single stains, an unstained and 6 stained wells', () => {
    const demo = FM.synth.spectralDemo(500);
    eq(demo.detectors.length, 32);
    eq(demo.dyes.length, 6);
    eq(demo.samples.length, 13);
    demo.dyes.forEach(d => eq(Math.max(...d.signature), 1, d.label + ' peak is 1'));
    eq(FM.wells.detect(demo.samples[1]), null, 'a control named “CD3 BV421 …” is not mistaken for well D3');
  });

  test('unmix: controls come from conditions marked single stain and unstained', () => {
    const { ws } = spectralWs({ n: 500 });
    const c = FM.unmix.controls(ws);
    eq(c.singles.length, 6); eq(c.unstained.length, 1);
    eq(c.singles[0].label, 'CD3 BV421');
    eq(ws.unmixMethod(6), 'spectral', '32 detectors for 6 dyes: spectral by default');
  });

  test('unmix: spectral unmixing recovers every dye (pre-registered: r ≥ 0.99, |median error| ≤ 2%)', () => {
    const { ws, demo } = spectralWs();
    const { sig } = ws.computeUnmix();
    eq(sig.dyes.length, 6);
    sig.dyes.forEach(d => assert(!d.warnings.some(w => /No positive/.test(w)), d.label + ': ' + d.warnings.join('; ')));
    const out = [];
    demo.dyes.forEach(d => {
      const truth = [], got = [], pos = [];
      ws.samples.filter(s => /^Stained_/.test(s.name)).forEach(s => {
        const t = s._truth[d.label], u = s.data[d.label];
        assert(u, 'an unmixed column named ' + d.label);
        for (let e = 0; e < s.n; e++) { truth.push(t[e]); got.push(u[e]); if (t[e] > 0) pos.push(t[e]); }
      });
      const r = pearson(got, truth);
      const err = Math.abs(med(got.map((v, i) => v - truth[i]))) / med(pos);
      out.push(d.label + ' r=' + r.toFixed(4) + ' err=' + (err * 100).toFixed(2) + '%');
      assert(r >= 0.99, d.label + ': r = ' + r);
      assert(err <= 0.02, d.label + ': median error ' + (err * 100).toFixed(2) + '% of the signal');
    });
    return 'INFO ' + out.join(' · ');
  });

  test('unmix: the signatures measured on the controls match the true ones', () => {
    const { ws, demo } = spectralWs();
    const sig = FM.unmix.signatures(ws, {});
    demo.dyes.forEach((d, i) => {
      const got = sig.dyes.find(x => x.label === d.label).signature;
      const worst = Math.max(...got.map((v, t) => Math.abs(v - d.signature[t])));
      assert(worst < 0.05, d.label + ': off by ' + worst.toFixed(3) + ' at worst');
    });
  });

  test('unmix: with one detector per dye, least squares is exactly compensation', () => {
    const ctrl = FM.synth.compControls(3000);
    const ws = new FM.Workspace();
    ws.addSamples(ctrl.samples ? ctrl.samples : ctrl.list || ctrl);
    const byName = n => ws.samples.find(s => s.name === n);
    const names = ws.samples.map(s => s.name);
    const unst = names.find(n => /unstained/i.test(n));
    const singles = names.filter(n => /FL\d/.test(n) && !/mix/i.test(n));
    assert(unst && singles.length === 3, 'demo controls: ' + names.join(', '));
    ws.assign([byName(unst).key], ws.addGroup('Unstained', 'unstained'));
    singles.forEach(n => ws.assign([byName(n).key], ws.addGroup(n.replace(/\.fcs$/, ''), 'comp')));
    ws.setUnmixSetup({ method: 'compensation' });
    ws.computeUnmix();
    const m = FM.comp.matrixById(ws, ws.doc.comp.active);
    eq(m.kind, 'spillover');
    const mixed = ws.samples.find(s => /mix/i.test(s.name)) || ws.samples[0];
    const comp = m.params.map(p => Float64Array.from(mixed.data[p]));
    ws.setUnmixSetup({ method: 'spectral' });
    ws.computeUnmix();
    const sp = FM.comp.matrixById(ws, ws.doc.comp.active);
    eq(sp.kind, 'spectral'); eq(sp.params.length, 3, 'three detectors, three dyes');
    sp.dyes.forEach((d, j) => {
      const col = mixed.data[FM.comp.outName(mixed.raw, d.label)];
      const i = m.params.indexOf(d.peak);
      let worst = 0;
      for (let e = 0; e < mixed.n; e += 7) worst = Math.max(worst, Math.abs(col[e] - comp[i][e]) / (Math.abs(comp[i][e]) + 1));
      assert(worst < 1e-6, d.label + ': differs by ' + worst);
    });
  });

  test('unmix: corrections act after unmixing, as (I + A)⁻¹, and reset exactly', () => {
    const { ws } = spectralWs({ n: 1500 });
    const { id } = ws.computeUnmix();
    const s = ws.samples.find(x => /^Stained_A1/.test(x.name));
    const L = FM.comp.matrixById(ws, id).dyes.map(d => d.label);
    const before = L.map(l => Float64Array.from(s.data[l]));
    ws.setUnmixAdjust(id, 0, 1, 0.05);
    const e = 17;
    const x = before.map(c => c[e]);
    const want = FM.unmix.mul([x], FM.unmix.correction(FM.comp.matrixById(ws, id).adjust, L.length))[0];
    L.forEach((l, j) => approx(s.data[l][e], want[j], 1e-5, l));
    assert(Math.abs(s.data[L[1]][e] - (x[1] - 0.05 * x[0])) < Math.abs(x[0]) * 0.01 + 1, 'about 5% of dye 0 taken out of dye 1');
    ws.resetUnmixAdjust(id);
    L.forEach((l, j) => approx(s.data[l][e], before[j][e], 1e-6, 'reset ' + l));
    ws.setUnmixAdjust(id, 2, 3, 0.1);
    ws.undo();
    L.forEach((l, j) => approx(s.data[l][e], before[j][e], 1e-6, 'undo ' + l));
  });

  test('unmix: the review numbers — residuals near zero when right, flagged when wrong; similarity; complexity', () => {
    const { ws } = spectralWs({ n: 2500 });
    const { sig, id } = ws.computeUnmix();
    const m = FM.comp.matrixById(ws, id);
    const r = FM.unmix.residuals(ws, sig, FM.unmix.unmixer(m), {});
    let worst = 0;
    r.forEach((row, i) => row.forEach((v, j) => { if (i !== j && Number.isFinite(v)) worst = Math.max(worst, Math.abs(v)); }));
    assert(worst < 0.01, 'computed matrix leaves under 1% anywhere: ' + (worst * 100).toFixed(2) + '%');
    ws.setUnmixAdjust(id, 0, 1, 0.08);
    const r2 = FM.unmix.residuals(ws, sig, FM.unmix.unmixer(FM.comp.matrixById(ws, id)), {});
    assert(Math.abs(r2[0][1] + 0.08) < 0.01, 'a wrong correction shows up where it was made: ' + r2[0][1]);
    const M = sig.dyes.map(d => d.signature);
    const S = FM.unmix.similarity(M);
    S.forEach((row, i) => approx(row[i], 1, 1e-12, 'self-similarity'));
    approx(FM.unmix.similarity([M[0], M[0]])[0][1], 1, 1e-12, 'identical signatures');
    const easy = FM.unmix.complexity(M), hard = FM.unmix.complexity([M[0], M[0].map((v, t) => v * 0.98 + M[1][t] * 0.02)]);
    assert(easy >= 1 && hard > easy * 5, 'complexity rises as signatures converge: ' + easy.toFixed(2) + ' vs ' + hard.toFixed(2));
  });

  test('unmix: dyes are recognised in file names', () => {
    eq(FM.unmix.guessDye('CD4 BV510 single stain.fcs'), 'BV510');
    eq(FM.unmix.guessDye('CD56 PE-Cy7.fcs'), 'PE-Cy7');
    eq(FM.unmix.guessDye('CD19 PE.fcs'), 'PE');
    eq(FM.unmix.guessDye('Unstained control.fcs'), 'unstained');
    eq(FM.unmix.guessDye('Tube_004.fcs'), null);
    eq(FM.unmix.controlName('CD4 BV510 single stain.fcs'), 'CD4 BV510');
  });

  test('unmix: the choice is part of the document — confirmed, undoable, and old documents load', () => {
    const { ws } = spectralWs({ n: 500 });
    eq(ws.doc.comp.confirmed, false);
    ws.confirmComp('none');
    eq(ws.doc.comp.active, 'none'); eq(ws.doc.comp.confirmed, true);
    assert(/as recorded/.test(FM.comp.describe(ws)), FM.comp.describe(ws));
    ws.undo();
    eq(ws.doc.comp.confirmed, false);
    const doc = ws.toJSON();
    doc.comp = { active: 'file', matrices: [] };            // a document from before the Unmix step
    ws.loadDoc(doc);
    eq(ws.doc.comp.setup.method, 'auto'); eq(typeof ws.doc.comp.setup.controls, 'object');
  });

  test('unmix: unmixed dyes become parameters you can gate on, with an axis scale', () => {
    const { ws } = spectralWs({ n: 800 });
    ws.computeUnmix();
    const names = ws.paramNames();
    assert(names.indexOf('CD3 BV421') >= 0 && names.indexOf('CD14 APC') >= 0, 'dye channels listed');
    assert(ws.paramInfo('CD3 BV421').unmixed, 'marked as unmixed');
    assert(ws.doc.params['CD3 BV421'] && ws.doc.params['CD3 BV421'].scale, 'with a scale');
    assert(FM.unmix.detectors(ws).indexOf('CD3 BV421') < 0, 'and never used as a detector');
    ws.confirmComp('none');
    assert(ws.paramNames().indexOf('CD3 BV421') < 0, 'gone when unmixing is turned off');
  });
})();

// The demo plate's controls recover the spillover the demo was built with (pre-registered: within 0.5 percentage points).
test('unmix: the demo plate controls recover its built-in spillover, by compensation', () => {
  const ws = new FM.Workspace();
  ws.addSamples(FM.synth.demoPlate(3000));
  FM.synth.demoControls(6000).forEach(c => { ws.addSamples([c.sample]); ws.assign([ws.samples.find(s => s.name === c.sample.name).key], ws.addGroup(c.name, c.role)); });
  eq(FM.unmix.detectors(ws).join(), 'FL1-A,FL2-A,FL3-A', 'one reading per detector (area)');
  eq(ws.unmixMethod(3), 'compensation', 'three detectors, three dyes');
  const { id } = ws.computeUnmix();
  const m = FM.comp.matrixById(ws, id);
  const at = (from, to) => m.spill[m.params.indexOf(from)][m.params.indexOf(to)];
  const S = FM.synth.DEMO_SPILL;
  [['FL1-A', 'FL2-A', S.beadsToFL2], ['FL1-A', 'FL3-A', S.beadsToFL3], ['FL2-A', 'FL3-A', S.peToFL3], ['FL3-A', 'FL2-A', S.apcToFL2], ['FL2-A', 'FL1-A', 0], ['FL3-A', 'FL1-A', 0]]
    .forEach(([a, b, want]) => assert(Math.abs(at(a, b) - want) <= 0.005, a + ' → ' + b + ': ' + (at(a, b) * 100).toFixed(2) + '% (built in: ' + (want * 100) + '%)'));
});
