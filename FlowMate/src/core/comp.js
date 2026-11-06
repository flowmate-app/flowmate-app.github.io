/* Compensation: which spillover matrix a sample is read through, and computing one from
 * single-stain controls.
 *
 *   doc.comp = { active: 'file' | 'none' | matrixId, confirmed,
 *                setup: { method, population, controls: { [groupId]: { cut, peak } } },   the Unmix step's inputs
 *                matrices: [{ id, name, kind: 'spillover' | 'spectral', params: [detector…], spill: [[…]],
 *                             dyes: [{ label, peak, signature }], adjust: [[…]], source }] }
 *
 *   'file'  each sample's own acquisition matrix ($SPILLOVER) — the default
 *   'none'  raw data
 *   an id   one matrix for every sample that has its parameters
 *
 * A sample keeps its parsed columns in `raw`. `data` — what gating reads — is either `raw`
 * itself or `raw` with compensated copies of the matrix's parameters (comp = raw · S⁻¹, rows
 * of S are the dyes' primary detectors, columns the detectors they spill into). Switching or
 * editing a matrix rebuilds `data` from `raw`: nothing is ever reloaded or compensated twice.
 * Parameter names stay the same; the UI marks compensated ones.
 *
 * A spectral matrix (core/unmix.js) instead adds one column per dye, named by the dye, fitted by
 * least squares over all its detectors; the detectors stay as recorded. Either kind can carry
 * `adjust`, the user's corrections in dye space, applied after: x' = x · (I + A)⁻¹.
 */
(function (FM) {
  'use strict';

  const SCATTER = /^(FSC|SSC|FS|SS)\b|^(FSC|SSC)[-_ ]|TIME|WIDTH|^EVENT/i;

  function defaultComp() { return { active: 'file', matrices: [], confirmed: false, setup: { method: 'auto', population: null, controls: {} } }; }

  function matrixById(ws, id) { return ((ws.doc.comp || {}).matrices || []).find(m => m.id === id) || null; }

  /** The matrix this sample is read through: {params, spill, name, id?} or null. */
  function matrixFor(ws, sample) {
    const c = ws.doc.comp || defaultComp();
    const raw = sample.raw || sample.data;
    if (c.active === 'none') return null;
    if (c.active === 'file' || !c.active) {
      return sample.spill ? { params: sample.spill.params, spill: sample.spill.matrix, name: 'Acquisition matrix' } : null;
    }
    const m = matrixById(ws, c.active);
    if (!m) return null;
    // a sample without every detector of the matrix (another panel) is left uncompensated
    if (!m.params.every(p => raw[p])) return null;
    return { kind: m.kind || 'spillover', params: m.params, spill: m.spill, dyes: m.dyes, adjust: m.adjust, name: m.name, id: m.id };
  }

  function clearCaches(sample) {
    sample._pops = new Map();
    sample._popsShared = new Map();
    sample._disp = new Map();
    sample._stats = new Map();
    sample._popErrors = {};
  }

  /** The column name a dye's unmixed values get: its label, unless a recorded parameter already has that name. */
  function outName(raw, label) { return raw[label] ? label + ' (unmixed)' : label; }

  /** Rebuild sample.data from sample.raw for the active matrix. True when it changed. */
  function applyTo(ws, sample) {
    if (!sample.raw) sample.raw = sample.data;
    const m = matrixFor(ws, sample);
    const key = m ? JSON.stringify([m.kind, m.params, m.spill, m.dyes && m.dyes.map(d => [d.label, d.signature]), m.adjust]) : 'none';
    if (sample._compKey === key) return false;
    sample._compKey = key;
    sample.params = sample.params.filter(p => !p.unmixed);          // a previous spectral matrix's outputs
    if (!m) {
      sample.data = sample.raw;
      sample.compensated = false;
      sample.compMatrix = null;
    } else if (m.kind === 'spectral') {
      const k = m.dyes.length;
      // W: detectors × dyes, then the user's corrections
      const W = FM.unmix.mul(FM.unmix.unmixingMatrix(m.dyes.map(d => d.signature)), FM.unmix.correction(m.adjust, k));
      const d = m.params.length, n = sample.n;
      const src = m.params.map(p => sample.raw[p]);
      const dst = m.dyes.map(() => new Float32Array(n));
      for (let e = 0; e < n; e++) {
        for (let j = 0; j < k; j++) {
          let s = 0;
          for (let t = 0; t < d; t++) s += src[t][e] * W[t][j];
          dst[j][e] = s;
        }
      }
      const data = Object.assign({}, sample.raw);
      const range = Math.max(...sample.params.filter(p => m.params.indexOf(p.name) >= 0).map(p => p.range || 0), 262144);
      m.dyes.forEach((dy, j) => {
        const name = outName(sample.raw, dy.label);
        data[name] = dst[j];
        sample.params.push({ index: -1, name, label: dy.label, range, bits: 32, logDecades: 0, logOffset: 0, gain: 1, displayHint: 'log', unmixed: true });
      });
      sample.data = data;
      sample.compensated = true;
      sample.compMatrix = { name: m.name, id: m.id || null, params: m.dyes.map(dy => outName(sample.raw, dy.label)), spectral: true };
    } else {
      const k0 = m.params.length;
      const inv = m.adjust ? FM.unmix.mul(FM.fcs.invert(m.spill), FM.unmix.correction(m.adjust, k0)) : FM.fcs.invert(m.spill);
      const k = m.params.length, n = sample.n;
      const src = m.params.map(p => sample.raw[p]);
      const dst = m.params.map(() => new Float32Array(n));
      const v = new Float64Array(k);
      for (let e = 0; e < n; e++) {
        for (let i = 0; i < k; i++) v[i] = src[i][e];
        for (let j = 0; j < k; j++) {
          let s = 0;
          for (let i = 0; i < k; i++) s += v[i] * inv[i][j];
          dst[j][e] = s;
        }
      }
      const data = Object.assign({}, sample.raw);
      m.params.forEach((p, j) => { data[p] = dst[j]; });
      sample.data = data;
      sample.compensated = true;
      sample.compMatrix = { name: m.name, id: m.id || null, params: m.params.slice() };
    }
    clearCaches(sample);
    return true;
  }

  function applyAll(ws) {
    let changed = 0;
    ws.samples.forEach(s => { if (applyTo(ws, s)) changed++; });
    return changed;
  }

  /** Fluorescence parameters: everything but scatter, time and width. */
  function fluorParams(ws) { return ws.paramNames().filter(p => !SCATTER.test(p)); }

  // ------------------------------------------------------------ computing
  function quantileOf(arr, q) {
    if (!arr.length) return NaN;
    const s = Float64Array.from(arr).sort();
    return FM.transforms.quantile(s, q);
  }
  const median = a => quantileOf(a, 0.5);

  /** Raw values of `param` for `sample` over population `pop` (null = all events). */
  function rawValues(ws, sample, param, pop) {
    const col = (sample.raw || sample.data)[param];
    if (!col) return new Float64Array(0);
    const idx = pop ? ws.indices(sample, pop) : null;
    if (!idx) return Float64Array.from(col);
    const out = new Float64Array(idx.length);
    for (let i = 0; i < idx.length; i++) out[i] = col[idx[i]];
    return out;
  }

  /**
   * The detector a single-stain control lights up: the one where it is brightest relative
   * to the reference (the unstained sample, else the other controls).
   */
  function detectChannel(ws, sampleKey, candidates, opts) {
    opts = opts || {};
    const s = ws.sample(sampleKey);
    const refKeys = opts.unstained ? [opts.unstained] : (opts.others || []).filter(k => k !== sampleKey);
    let best = null, bestScore = -Infinity;
    candidates.forEach(p => {
      const hi = quantileOf(rawValues(ws, s, p, opts.population), 0.99);
      const refs = refKeys.map(k => ws.sample(k)).filter(Boolean).map(r => quantileOf(rawValues(ws, r, p, opts.population), 0.99)).filter(Number.isFinite);
      const ref = refs.length ? median(refs) : quantileOf(rawValues(ws, s, p, opts.population), 0.5);
      const score = (hi - ref) / (Math.abs(ref) + 1);
      if (score > bestScore) { bestScore = score; best = p; }
    });
    return best;
  }

  /**
   * A spillover matrix from single-stain controls.
   * opts: { controls: [{ sampleKey, param? }], unstained?: key, population?: gateId, candidates?: [param] }
   * → { params, spill, diagnostics: [{ sampleKey, param, nPos, nNeg, warnings }] }
   */
  function compute(ws, opts) {
    const controls = (opts.controls || []).filter(c => ws.sample(c.sampleKey));
    if (controls.length < 2) throw new Error('Choose at least two single-stain controls.');
    const pop = opts.population || null;
    const candidates = opts.candidates || fluorParams(ws);
    const keys = controls.map(c => c.sampleKey);
    controls.forEach(c => { if (!c.param) c.param = detectChannel(ws, c.sampleKey, candidates, { unstained: opts.unstained, others: keys, population: pop }); });
    const params = controls.map(c => c.param);
    const diagnostics = controls.map(c => ({ sampleKey: c.sampleKey, param: c.param, nPos: 0, nNeg: 0, warnings: [] }));
    const dup = params.filter((p, i) => params.indexOf(p) !== i);
    if (dup.length) diagnostics.forEach(d => { if (dup.indexOf(d.param) >= 0) d.warnings.push('Two controls light up ' + d.param + '; pick each control\'s detector by hand.'); });
    const unst = opts.unstained ? ws.sample(opts.unstained) : null;
    const k = params.length;
    const spill = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (__, j) => (i === j ? 1 : 0)));
    controls.forEach((c, i) => {
      const s = ws.sample(c.sampleKey), d = diagnostics[i];
      const own = rawValues(ws, s, c.param, pop);
      let posIdx, negMed;
      if (unst) {
        const thr = quantileOf(rawValues(ws, unst, c.param, pop), 0.995);
        posIdx = [];
        for (let e = 0; e < own.length; e++) if (own[e] > thr) posIdx.push(e);
        if (posIdx.length < 100) posIdx = topFraction(own, 0.05);
        negMed = params.map(p => median(rawValues(ws, unst, p, pop)));
        d.nNeg = unst.n;
      } else {
        const lowCut = quantileOf(own, 0.3);
        const negIdx = [];
        for (let e = 0; e < own.length; e++) if (own[e] <= lowCut) negIdx.push(e);
        posIdx = topFraction(own, 0.05);
        negMed = params.map(p => { const v = rawValues(ws, s, p, pop); return median(negIdx.map(e => v[e])); });
        d.nNeg = negIdx.length;
      }
      d.nPos = posIdx.length;
      const posMed = params.map(p => { const v = rawValues(ws, s, p, pop); return median(posIdx.map(e => v[e])); });
      const signal = posMed[i] - negMed[i];
      if (!(signal > 0)) { d.warnings.push('No positive population on ' + c.param + '.'); return; }
      for (let j = 0; j < k; j++) {
        if (j === i) continue;
        spill[i][j] = (posMed[j] - negMed[j]) / signal;
        if (spill[i][j] > 1) d.warnings.push('Spills more into ' + params[j] + ' than into its own detector (' + Math.round(spill[i][j] * 100) + '%).');
      }
      if (d.nPos < 50) d.warnings.push('Only ' + d.nPos + ' positive events: the estimate is rough.');
    });
    return { params, spill, diagnostics };
  }

  /** Indices of the brightest `frac` of values. */
  function topFraction(values, frac) {
    const cut = quantileOf(values, 1 - frac);
    const out = [];
    for (let e = 0; e < values.length; e++) if (values[e] >= cut) out.push(e);
    return out;
  }

  /** One sentence for the methods text and the report. */
  function describe(ws) {
    const c = ws.doc.comp || defaultComp();
    const S = ws.samples;
    if (!S.some(s => s.compensated)) return c.active === 'none' && c.confirmed ? 'No compensation or unmixing was applied: the data was used as recorded.' : 'No compensation was applied.';
    if (c.active === 'file') return 'Spillover compensation was applied from the files’ acquisition matrices.';
    const m = matrixById(ws, c.active);
    if (m && m.kind === 'spectral') return 'Spectral unmixing (ordinary least squares over ' + m.params.length + ' detectors) separated ' + m.dyes.length + ' dyes, with signatures measured on single-stain controls' + (m.adjust && m.adjust.some(r => r.some(v => v)) ? ' and corrected by hand where single-stain populations were not straight' : '') + '.';
    const how = m && m.source === 'computed' ? ' computed from single-stain controls' : m && m.source === 'imported' ? ' imported from a FlowJo workspace' : m && m.source === 'gatingml' ? ' imported from Gating-ML' : '';
    return 'Spillover compensation was applied with the matrix “' + (m ? m.name : 'custom') + '”' + how + ' (' + (m ? m.params.length : '?') + ' detectors).';
  }

  FM.comp = { defaultComp, matrixFor, matrixById, applyTo, applyAll, fluorParams, detectChannel, compute, describe, clearCaches, outName };
})(FM);
