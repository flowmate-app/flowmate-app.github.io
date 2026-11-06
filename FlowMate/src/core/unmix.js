/* Unmixing from single-stain controls — one model for compensation and spectral unmixing.
 *
 * Each dye has a signature: how its light spreads across the detectors, measured on its
 * single-stain control as (median of positive events − median of negative events) per detector,
 * scaled so its peak is 1. Each event is then fitted as a mix of signatures by least squares:
 *
 *   x = y · W,   W = Mᵀ (M Mᵀ)⁻¹          (M: dyes × detectors)
 *
 * With one detector per dye (compensation) M is square and W = M⁻¹: classic spillover
 * compensation. With more detectors than dyes it is spectral unmixing. Corrections the user makes
 * are kept apart, in dye space: x' = x · (I + A)⁻¹, A[i][j] = the share of dye i still showing in
 * dye j's channel.
 *
 * Controls are samples in conditions with role 'comp' (single stain; the condition's name is the
 * dye) or 'unstained'. DOM-free.
 */
(function (FM) {
  'use strict';

  const identity = k => Array.from({ length: k }, (_, i) => Array.from({ length: k }, (__, j) => (i === j ? 1 : 0)));
  const MAX_EVENTS = 20000;          // medians from at most this many events per control (evenly spaced)

  function quantile(values, q) {
    if (!values.length) return NaN;
    const s = Float64Array.from(values).sort();
    return FM.transforms.quantile(s, q);
  }
  const median = v => quantile(v, 0.5);

  /**
   * Detectors that can carry dye light: every parameter but scatter, time, width and unmixed outputs —
   * one reading per detector: its area (-A) when the file also records height (-H) or width (-W).
   */
  function detectors(ws) {
    const all = FM.comp.fluorParams(ws).filter(p => !ws.paramInfo(p).unmixed);
    const has = new Set(all);
    return all.filter(p => { const m = /^(.*)-([HW])$/.exec(p); return !(m && has.has(m[1] + '-A')); });
  }

  /** The control conditions on the plate: [{ group, label, keys }], and the unstained sample keys. */
  function controls(ws) {
    const live = keys => keys.filter(k => !ws.wellInfo(k).excluded);
    const singles = ws.doc.groups.filter(g => g.role === 'comp')
      .map(g => ({ group: g.id, label: g.name, keys: live(ws.samplesIn(g.id).map(s => s.key)) }))
      .filter(c => c.keys.length);
    const unstained = [];
    ws.doc.groups.filter(g => g.role === 'unstained').forEach(g => live(ws.samplesIn(g.id).map(s => s.key)).forEach(k => unstained.push(k)));
    return { singles, unstained };
  }

  /** Event indices of `sample` to use (in `pop` when given), thinned to MAX_EVENTS. */
  function eventsOf(ws, sample, pop) {
    let idx = pop ? ws.indices(sample, pop) : null;
    const n = idx ? idx.length : sample.n;
    const step = Math.max(1, Math.floor(n / MAX_EVENTS));
    const out = [];
    for (let i = 0; i < n; i += step) out.push(idx ? idx[i] : i);
    return out;
  }
  const rawCol = (s, p) => (s.raw || s.data)[p];
  const valuesAt = (s, p, ev) => { const c = rawCol(s, p); const out = new Float64Array(ev.length); for (let i = 0; i < ev.length; i++) out[i] = c[ev[i]]; return out; };

  /**
   * Positive and negative events of one control. → { peak, cut, autoCut, pos: [{s, ev}], negMed(det) }
   * peak: the detector the dye lights most (relative to the unstained); cut: positives are above it.
   */
  function posNeg(ws, ctrl, unstainedKeys, dets, opts) {
    opts = opts || {};
    const pop = opts.population || null;
    const samples = ctrl.keys.map(k => ws.sample(k)).filter(Boolean);
    const unst = unstainedKeys.map(k => ws.sample(k)).filter(Boolean);
    const evs = samples.map(s => eventsOf(ws, s, pop));
    const unstEvs = unst.map(s => eventsOf(ws, s, pop));
    const pooled = (list, evList, p) => { const parts = list.map((s, i) => valuesAt(s, p, evList[i])); const out = new Float64Array(parts.reduce((a, x) => a + x.length, 0)); let o = 0; parts.forEach(x => { out.set(x, o); o += x.length; }); return out; };
    let peak = opts.peak && dets.indexOf(opts.peak) >= 0 ? opts.peak : null;
    if (!peak) {
      let best = -Infinity;
      dets.forEach(p => {
        const hi = quantile(pooled(samples, evs, p), 0.99);
        const ref = unst.length ? quantile(pooled(unst, unstEvs, p), 0.99) : quantile(pooled(samples, evs, p), 0.5);
        const score = (hi - ref) / (Math.abs(ref) + 1);
        if (score > best) { best = score; peak = p; }
      });
    }
    const own = pooled(samples, evs, peak);
    const autoCut = unst.length ? quantile(pooled(unst, unstEvs, peak), 0.995) : quantile(own, 0.95);
    const cut = Number.isFinite(opts.cut) ? opts.cut : autoCut;
    const pos = [];
    samples.forEach((s, i) => { const c = rawCol(s, peak); const e = evs[i].filter(x => c[x] > cut); pos.push({ s, ev: e }); });
    // negatives: the unstained control (FlowJo's "universal negative"), or this control's own dim events
    const universal = unst.length > 0 && opts.universal !== false;
    const autoNegHi = quantile(own, 0.3);
    const negHi = Number.isFinite(opts.negHi) ? opts.negHi : autoNegHi;
    let negMed, negPeak;
    if (universal) { negMed = p => median(pooled(unst, unstEvs, p)); negPeak = pooled(unst, unstEvs, peak); }
    else {
      const negs = samples.map((s, i) => { const c = rawCol(s, peak); return evs[i].filter(x => c[x] <= negHi); });
      negMed = p => median(pooled(samples, negs, p));
      negPeak = pooled(samples, negs, peak);
    }
    // how cleanly the positives stand above the negatives on the peak detector (for the confidence dot)
    const posPeak = []; pos.forEach(x => { const c = rawCol(x.s, peak); x.ev.forEach(e => posPeak.push(c[e])); });
    const spread = Math.max(1, (quantile(negPeak, 0.84) - quantile(negPeak, 0.16)) / 2);
    const snr = (median(posPeak) - median(negPeak)) / spread;
    return { peak, cut, autoCut, negHi, autoNegHi, universal, pos, negMed, snr, nNeg: negPeak.length };
  }

  /**
   * Signatures of every single-stain control.
   * opts: { population, universal (default true), setup: { [groupId]: { cut, negHi, peak, use } } }
   * → { detectors, dyes: [{ group, label, use, peak, cut, autoCut, negHi, autoNegHi, signature, nPos, snr, quality, warnings }],
   *     used (the dyes with use on), unstained }
   */
  function signatures(ws, opts) {
    opts = opts || {};
    const dets = detectors(ws);
    const { singles, unstained } = controls(ws);
    const dyes = singles.map(ctrl => {
      const set = (opts.setup || {})[ctrl.group] || {};
      const pn = posNeg(ws, ctrl, unstained, dets, { population: opts.population, cut: set.cut, negHi: set.negHi, peak: set.peak, universal: opts.universal });
      const nPos = pn.pos.reduce((a, x) => a + x.ev.length, 0);
      const warnings = [];
      if (nPos < 50) warnings.push('Only ' + nPos + ' positive events — the signature is rough. Lower the cut-off or add events.');
      const sig = dets.map(p => {
        const parts = pn.pos.map(x => valuesAt(x.s, p, x.ev));
        const all = new Float64Array(parts.reduce((a, v) => a + v.length, 0)); let o = 0; parts.forEach(v => { all.set(v, o); o += v.length; });
        return median(all) - pn.negMed(p);
      });
      const top = Math.max(...sig.filter(Number.isFinite));
      if (!(top > 0)) warnings.push('No positive population found on ' + pn.peak + '.');
      // FlowJo's dot: green for a clean control, yellow for a doubtful one, red for one that cannot be used
      const quality = !(top > 0) || nPos < 20 || !(pn.snr >= 3) ? 'poor' : nPos >= 100 && pn.snr >= 10 && !warnings.length ? 'good' : 'fair';
      return { group: ctrl.group, label: ctrl.label, use: set.use !== false, peak: pn.peak, cut: pn.cut, autoCut: pn.autoCut, negHi: pn.negHi, autoNegHi: pn.autoNegHi,
        universal: pn.universal, nPos, snr: pn.snr, quality, signature: sig.map(v => (top > 0 && Number.isFinite(v) ? v / top : 0)), warnings };
    });
    const used = dyes.filter(d => d.use);
    const peaks = used.map(d => d.peak);
    used.forEach((d, i) => { if (peaks.indexOf(d.peak) !== i) d.warnings.push('Another control peaks on ' + d.peak + ' too.'); });
    return { detectors: dets, dyes, used, unstained };
  }

  /** Least-squares unmixing matrix W (detectors × dyes) for signatures M (dyes × detectors). */
  function unmixingMatrix(M) {
    const k = M.length, d = M[0].length;
    const G = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (__, j) => { let s = 0; for (let t = 0; t < d; t++) s += M[i][t] * M[j][t]; return s; }));
    const Gi = FM.fcs.invert(G);
    return Array.from({ length: d }, (_, t) => Array.from({ length: k }, (__, j) => { let s = 0; for (let i = 0; i < k; i++) s += M[i][t] * Gi[i][j]; return s; }));
  }

  /** (I + A)⁻¹, the correction applied after unmixing. */
  function correction(A, k) {
    if (!A) return identity(k);
    const m = identity(k);
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) if (i !== j) m[i][j] = A[i] && Number.isFinite(A[i][j]) ? A[i][j] : 0;
    return FM.fcs.invert(m);
  }
  const mul = (P, Q) => P.map(row => Q[0].map((_, j) => row.reduce((s, v, t) => s + v * Q[t][j], 0)));

  /** Cosine similarity between signatures: 1 = indistinguishable. */
  function similarity(M) {
    const norm = M.map(r => Math.sqrt(r.reduce((s, v) => s + v * v, 0)) || 1);
    return M.map((a, i) => M.map((b, j) => a.reduce((s, v, t) => s + v * b[t], 0) / (norm[i] * norm[j])));
  }

  /** Eigenvalues of a symmetric matrix (Jacobi rotations). */
  function eigenSym(S) {
    const n = S.length, a = S.map(r => r.slice());
    for (let sweep = 0; sweep < 60; sweep++) {
      let off = 0;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
      if (off < 1e-22) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let r = 0; r < n; r++) { const arp = a[r][p], arq = a[r][q]; a[r][p] = c * arp - s * arq; a[r][q] = s * arp + c * arq; }
        for (let r = 0; r < n; r++) { const apr = a[p][r], aqr = a[q][r]; a[p][r] = c * apr - s * aqr; a[q][r] = s * apr + c * aqr; }
      }
    }
    return a.map((r, i) => r[i]);
  }
  /** Complexity index: the condition number of the signature matrix (1 = perfectly separable; higher = harder). */
  function complexity(M) {
    const G = M.map(a => M.map(b => a.reduce((s, v, t) => s + v * b[t], 0)));
    const ev = eigenSym(G).map(v => Math.max(v, 0));
    const hi = Math.max(...ev), lo = Math.min(...ev);
    return lo > 0 ? Math.sqrt(hi / lo) : Infinity;
  }

  /**
   * Residual spill measured on the controls after unmixing: r[i][j] = how much of dye i's signal
   * still appears in dye j's channel (fraction). Near 0 is right; the review flags large ones.
   * `unmix(sample, events)` → per-event outputs (dyes × events) for the matrix being checked.
   */
  function residuals(ws, sig, unmixEvents, opts) {
    const dyesUsed = sig.used || sig.dyes;
    const k = dyesUsed.length;
    const { singles, unstained } = controls(ws);
    const r = Array.from({ length: k }, () => new Array(k).fill(NaN));
    const unstOut = unstained.map(key => ws.sample(key)).filter(Boolean).map(s => unmixEvents(s, eventsOf(ws, s, opts && opts.population)));
    dyesUsed.forEach((d, i) => {
      const ctrl = singles.find(c => c.group === d.group);
      if (!ctrl) return;
      const pn = posNeg(ws, ctrl, unstained, sig.detectors, { population: opts && opts.population, cut: d.cut, negHi: d.negHi, peak: d.peak, universal: d.universal });
      const pos = pn.pos.map(x => unmixEvents(x.s, x.ev));
      let neg;
      if (unstOut.length && d.universal) neg = unstOut;
      else {
        const samples = ctrl.keys.map(k2 => ws.sample(k2));
        neg = samples.map(s => { const c = rawCol(s, d.peak); const ev = eventsOf(ws, s, opts && opts.population); return unmixEvents(s, ev.filter(e => c[e] <= d.negHi)); });
      }
      const med = (outs, j) => median([].concat(...outs.map(o => Array.from(o[j]))));
      const si = med(pos, i) - med(neg, i);
      for (let j = 0; j < k; j++) if (j !== i) r[i][j] = si > 0 ? (med(pos, j) - med(neg, j)) / si : NaN;
    });
    return r;
  }

  /**
   * A function that unmixes chosen events of a sample with matrix `m` (as stored in doc.comp):
   * (sample, events) → [Float64Array per dye]. Reads the recorded detectors, so it does not depend
   * on which matrix is active.
   */
  function unmixer(m) {
    const spectral = m.kind === 'spectral';
    const k = spectral ? m.dyes.length : m.params.length;
    const W = spectral ? mul(unmixingMatrix(m.dyes.map(d => d.signature)), correction(m.adjust, k))
      : mul(FM.fcs.invert(m.spill), correction(m.adjust, k));
    return (s, ev) => {
      const src = m.params.map(p => rawCol(s, p));
      const out = Array.from({ length: k }, () => new Float64Array(ev.length));
      for (let e = 0; e < ev.length; e++) {
        const x = ev[e];
        for (let j = 0; j < k; j++) { let v = 0; for (let t = 0; t < src.length; t++) v += src[t][x] * W[t][j]; out[j][e] = v; }
      }
      return out;
    };
  }

  // ----------------------------------------------------------- dye names
  const UNSTAINED = /\b(unstained|unstain|blank|no[\s_-]?stain|negative|neg ctrl|autofluo\w*)\b/i;
  let dyeIndex = null;
  /** The dye a file or keyword names ("CD4 BV510 single stain.fcs" → "BV510"), or 'unstained', or null. */
  function guessDye(text) {
    const t = String(text || '');
    if (UNSTAINED.test(t)) return 'unstained';
    if (!dyeIndex) {
      const names = ((FM.spectraData && FM.spectraData.dyes) || []).map(d => d.name)
        .concat(['FITC', 'PE', 'APC', 'PerCP', 'PerCP-Cy5.5', 'PE-Cy5', 'PE-Cy7', 'APC-Cy7', 'APC-H7', 'PE-CF594', 'PE-Dazzle 594', 'Pacific Blue', 'BV421', 'BV510', 'BV605', 'BV650', 'BV711', 'BV785', 'AF488', 'AF647', 'AF700', 'DAPI', 'GFP', 'mCherry']);
      const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      dyeIndex = Array.from(new Set(names)).map(n => ({ n, k: norm(n) })).filter(x => x.k.length >= 2).sort((a, b) => b.k.length - a.k.length);
    }
    const tokens = t.replace(/\.[a-z0-9]+$/i, '').split(/[\s_,;()]+/).filter(Boolean);
    // whole tokens first ("PE" must not match inside "PerCP"), then joined neighbours ("PE Cy7")
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cands = tokens.map(norm).concat(tokens.slice(1).map((x, i) => norm(tokens[i] + x)));
    for (const d of dyeIndex) if (cands.indexOf(d.k) >= 0) return d.n;
    return null;
  }

  /** Name a condition for a control file: "CD4 BV510" from "CD4 BV510 single stain.fcs". */
  function controlName(fileName) {
    return String(fileName || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ')
      .replace(/\b(single[\s-]?stain(ed)?|comp(ensation)?|control|ctrl|tube|beads?)\b/gi, '').replace(/\s{2,}/g, ' ').trim() || fileName;
  }

  FM.unmix = { detectors, controls, signatures, unmixingMatrix, correction, unmixer, similarity, complexity, eigenSym, residuals, guessDye, controlName, mul, identity, eventsOf };
})(FM);
