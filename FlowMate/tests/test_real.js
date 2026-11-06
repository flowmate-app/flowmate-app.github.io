/* End-to-end: run the real 17-Sep-2026 plate through FlowMate's engine with the
 * phagocytosis preset and require it to reproduce the independent Python analysis
 * (results/per_well_stats.csv, results/statistics_tukey.csv). Skipped when the data
 * files are missing from tests/data/. */

const REAL_WELLS = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3', 'E1', 'E2', 'E3', 'F1', 'F2', 'F3'];
let REAL = null;

async function loadReal() {
  if (REAL) return REAL;
  const samples = [];
  for (const w of REAL_WELLS) {
    const r = await fetch('data/01-Well-' + w + '.fcs');
    if (!r.ok) throw new Error('missing ' + w);
    samples.push(FM.fcs.parse(await r.arrayBuffer(), '01-Well-' + w + '.fcs'));
  }
  const csv = await (await fetch('data/per_well_stats.csv')).text();
  const rows = csv.trim().split(/\r?\n/);
  const head = rows[0].split(',');
  const ref = {};
  rows.slice(1).forEach(line => {
    const c = line.split(',');
    const o = {}; head.forEach((h, i) => { o[h] = c[i]; });
    if (o.gate_variant === 'wide (primary)') ref[o.well] = o;
  });
  const tk = (await (await fetch('data/statistics_tukey.csv')).text()).trim().split(/\r?\n/).slice(1).map(l => {
    const c = l.split(',');
    return { a: c[0], b: c[1], diff: +c[2], p: +c[3], lo: +c[4], hi: +c[5] };
  });
  const ws = new FM.Workspace();
  ws.addSamples(samples);
  const p = FM.presets.byId('phagocytosis');
  FM.presets.apply(ws, p, { mapping: FM.presets.autoMap(p, ws.paramNames()), layout: true, replace: true });
  phagoAnalysisSetup(ws);
  REAL = { ws, ref, tk };
  return REAL;
}

async function realOrSkip() {
  try { return await loadReal(); }
  catch (e) { console.warn('real-data tests skipped: ' + e.message); return null; }
}

test('real: FCS files parse with correct shape and metadata', async () => {
  const R = await realOrSkip(); if (!R) return 'SKIP';
  const s = R.ws.sample('A1');
  eq(s.n, 10000);
  eq(s.params.length, 8);
  eq(s.cytometer, 'CytoFLEX LX');
  eq(s.spill, null, 'identity spillover ignored');
  eq(R.ws.sample('D2').n, 21819);
  eq(R.ws.sample('F1').acqOrder, 1, 'F1 was acquired first');
  eq(R.ws.samples.length, 18);
});

test('real: per-well gating reproduces the Python analysis exactly', async () => {
  const R = await realOrSkip(); if (!R) return 'SKIP';
  const ws = R.ws;
  const ids = ['THP Cells', 'Singles', 'THP Cells + Beads'].map(n => ws.popIdByName(n));
  REAL_WELLS.forEach(w => {
    const s = ws.sample(w), r = R.ref[w];
    eq(ws.count(s, ids[0]), +r.n_thp, w + ' THP count');
    eq(ws.count(s, ids[1]), +r.n_singles, w + ' singles count');
    eq(ws.count(s, ids[2]), +r.n_beadpos, w + ' bead+ count');
    const gm = ws.stat(s, ids[2], 'FL1-H', 'gmean');
    if (+r.n_beadpos > 0) approx(gm, +r.gmfi_final, 1e-6, w + ' gMFI');
  });
});

test('real: phagoscore metric matches per well', async () => {
  const R = await realOrSkip(); if (!R) return 'SKIP';
  const ws = R.ws;
  REAL_WELLS.forEach(w => {
    const v = ws.metricValue(ws.sample(w), ws.doc.settings.primaryMetric);
    assert(!v.error, v.error);
    if (+R.ref[w].n_beadpos > 0) approx(v.value, +R.ref[w].phagoscore, 1e-6, w + ' phagoscore');
  });
});

test('real: ANOVA and Tukey HSD match statsmodels with E1 excluded', async () => {
  const R = await realOrSkip(); if (!R) return 'SKIP';
  const ws = R.ws;
  ws.setExcluded(['E1'], true, 'beads not added');
  const res = FM.analysis.analyze(ws, ws.doc.settings.primaryMetric);
  approx(res.anova.F, 2.6769, 1e-4, 'F');
  approx(res.anova.p, 0.1013, 1e-3, 'ANOVA p');
  R.tk.forEach(ref => {
    const pr = res.pairs.find(p => (p.a === ref.a && p.b === ref.b) || (p.a === ref.b && p.b === ref.a));
    assert(pr, 'pair ' + ref.a + '/' + ref.b);
    absApprox(pr.p, ref.p, 6e-4, 'Tukey p ' + ref.a + ' vs ' + ref.b);
  });
  // the 95% simultaneous CI of each difference (Prism's "95% CI of diff."), same as statsmodels
  R.tk.forEach(ref => {
    const pr = res.pairs.find(p => (p.a === ref.a && p.b === ref.b) || (p.a === ref.b && p.b === ref.a));
    const flip = pr.a !== ref.a;
    const diff = flip ? -pr.diff : pr.diff, lo = flip ? -pr.hi : pr.lo, hi = flip ? -pr.lo : pr.hi;
    approx(diff, ref.diff, 1e-6, 'mean diff ' + ref.a + ' vs ' + ref.b);
    approx(lo, ref.lo, 1e-4, 'CI low ' + ref.a + ' vs ' + ref.b);
    approx(hi, ref.hi, 1e-4, 'CI high ' + ref.a + ' vs ' + ref.b);
  });
  approx(res.maxSpread, 1.4317, 1e-3, 'max spread');
  assert(res.pairs.every(p => !p.meaningful), 'no pair reaches 2×');
  const ctrl = res.groups.find(g => g.group.name === 'THP + beads');
  eq(ctrl.summary.n, 2);
  const igg1 = res.groups.find(g => g.group.name === 'IgG1');
  approx(igg1.fold, 0.6985, 1e-3, 'IgG1 fold vs control');
  eq(igg1.verdict.key, 'flat');
  ws.setExcluded(['E1'], false);
});

test('real: checks catch the failed well and the acquisition-time confound', async () => {
  const R = await realOrSkip(); if (!R) return 'SKIP';
  const ws = R.ws;
  const res = FM.analysis.analyze(ws, ws.doc.settings.primaryMetric);
  const e1 = res.checks.find(c => c.kind === 'outlier' && c.wells[0] === 'E1');
  assert(e1 && e1.level === 'critical', 'E1 flagged');
  assert(/gate-setting control/.test(e1.detail), 'E1 recognised as resembling the gate control');
  const others = res.checks.filter(c => c.kind === 'outlier' && c.wells[0] !== 'E1');
  eq(others.length, 0, 'only E1 is an outlier (E2/E3 must not be dragged in by it): ' + others.map(c => c.title).join('; '));
  ws.setExcluded(['E1'], true, 'beads not added');
  const res2 = FM.analysis.analyze(ws, ws.doc.settings.primaryMetric);
  const drift = res2.checks.find(c => c.kind === 'drift');
  assert(drift && drift.level === 'warning', 'drift flagged: ' + (drift && drift.title));
  approx(res2.drift.pearson.r, 0.730, 2e-3, 'drift r');
  approx(res2.drift.pearson.p, 0.003008, 0.02, 'drift p');
  approx(res2.drift.beyond.p, 0.9806, 2e-3, 'group beyond time p');
  assert(/blocks/.test(drift.title), 'confound recognised');
  const gc = res2.checks.find(c => c.kind === 'gate-control');
  assert(gc && gc.level === 'ok', 'THP alone clean');
  ws.setExcluded(['E1'], false);
});

/** Rebuild the hierarchy from scratch with suggestions only (no preset) on the real plate. */
async function suggestedHierarchy() {
  const R = await realOrSkip(); if (!R) return null;
  const ws = new FM.Workspace();
  ws.addSamples(R.ws.samples.slice());
  const rows = { A: 'IgG1', B: 'IgG2', C: 'IgG4', D: 'LALA', E: 'THP + beads', F: 'THP alone' };
  const layout = {};
  Object.entries(rows).forEach(([r, n]) => [1, 2, 3].forEach(c => { layout[r + c] = n; }));
  const ids = ws.applyLayout(layout);
  ws.updateGroup(ids['THP alone'], { role: 'gate' });
  ws.updateGroup(ids['THP + beads'], { role: 'control' });
  const accept = s => { if (s.error) throw new Error(s.error); return ws.addGate(s.gate); };
  const cells = accept(FM.autogate.suggest(ws, null, 'FSC-H', 'SSC-H'));
  const singles = accept(FM.autogate.suggest(ws, cells, 'SSC-A', 'SSC-H'));
  const sPos = FM.autogate.suggest(ws, singles, 'FL1-H', 'FSC-H');
  const pos = accept(sPos);
  return { ws, R, cells, singles, pos, sPos };
}

test('real: suggested FL1+ threshold (from THP alone) matches the validated bead gate in every well', async () => {
  const R = await realOrSkip(); if (!R) return 'SKIP';
  const ws = R.ws;
  const singles = ws.popIdByName('Singles');
  const s = FM.autogate.suggest(ws, singles, 'FL1-H', 'FSC-H');
  assert(!s.error, s.error);
  assert(/gate control/.test(s.explain), s.explain);
  const id = ws.addGate(s.gate);
  const wells = ['A1','A2','A3','B1','B2','B3','C1','C2','C3','D1','D2','D3','E1','E2','E3','F1','F2','F3'];
  const signed = wells.map(w => ws.pct(ws.sample(w), id) - +R.ref[w].pct_beadpos);
  const d = signed.map(Math.abs);
  const thr = s.gate.rect.x0;
  // what the validated FSC bounds would give with the suggested threshold
  const bounded = ws.addGate({ name: 'dbg', parent: singles, type: 'rect', x: 'FL1-H', y: 'FSC-H', xScale: s.gate.xScale, yScale: s.gate.yScale, rect: { x0: thr, x1: 3e6, y0: 130000, y1: 720000 } });
  const sb = wells.map(w => ws.pct(ws.sample(w), bounded) - +R.ref[w].pct_beadpos);
  ws.deleteGate(bounded);
  ws.deleteGate(id);
  assert(Math.max(...d) < 1.5, 'worst well differs by ' + Math.max(...d).toFixed(2) + '; thr=' + Math.round(thr) +
    ' signed=' + signed.map((v, i) => wells[i] + ':' + v.toFixed(2)).join(' ') + ' | with FSC bounds: ' + sb.map((v, i) => wells[i] + ':' + v.toFixed(2)).join(' '));
  return 'INFO threshold FL1-H ≥ ' + Math.round(thr) + ' (validated 60000) · worst well Δ ' + Math.max(...d).toFixed(2) + ' points';
});

test('real: fully suggested hierarchy (Cells → Singlets → FL1+) reaches the same conclusion', async () => {
  const H = await suggestedHierarchy(); if (!H) return 'SKIP';
  const { ws, R, cells, singles, pos } = H;
  const a1 = ws.sample('A1');
  const got = [ws.pct(a1, cells), ws.pct(a1, singles), ws.pct(a1, pos)];
  const ref = [+R.ref.A1.pct_thp, +R.ref.A1.pct_singles, +R.ref.A1.pct_beadpos];
  assert(Math.abs(got[0] - ref[0]) < 10, 'cells within 10 points: ' + got[0].toFixed(1));
  assert(got[1] > 80 && got[1] < 97, 'a plausible singlet fraction: ' + got[1].toFixed(1));
  // same verdict with a phagoscore built on the suggested gates
  const mid = ws.addMetric('Phagoscore', 'gmean("' + ws.gate(pos).name + '", "FL1-H") * pct("' + ws.gate(pos).name + '")');
  ws.setExcluded(['E1'], true, 'beads not added');
  const res = FM.analysis.analyze(ws, mid);
  const folds = res.groups.filter(x => x.group.role === 'sample').map(x => x.group.name + ' ' + x.fold.toFixed(2) + '×');
  assert(res.pairs.every(p => !p.meaningful), 'still no 2-fold difference');
  return 'INFO A1 suggested vs validated — cells ' + got[0].toFixed(1) + ' vs ' + ref[0].toFixed(1) + ', singlets ' + got[1].toFixed(1) + ' vs ' + ref[1].toFixed(1) +
    ', FL1+ ' + got[2].toFixed(1) + ' vs ' + ref[2].toFixed(1) + ' | folds: ' + folds.join(', ') + ' (validated 0.70, 0.78, 0.81, 0.88)';
});
