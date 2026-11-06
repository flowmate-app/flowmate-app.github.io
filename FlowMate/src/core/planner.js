/* Panel planner engine: fluorophore spectra, instruments (lasers + detector filters) and the
 * numbers behind the planner page — excitation, captured emission, spillover, detector
 * assignment and plain-language checks. No DOM dependencies.
 *
 * Model: a laser excites a dye in proportion to the dye's excitation spectrum at the laser line;
 * a detector sits behind one laser and collects the part of the emission that passes its filter.
 *   signal(dye, det)   = excitation(dye, laser of det) × captured(dye, filter of det)
 *   spillover(i → j)   = signal(dye i, detector of j) / signal(dye i, its own detector) */
(function (FM) {
  'use strict';
  const P = FM.planner = {};
  const D = FM.spectraData;
  const START = D.start, STEP = D.step, N = D.n, END = START + STEP * (N - 1);

  // --------------------------------------------------------------- spectra
  function decode(b64) {
    const bin = atob(b64);
    const f = new Float32Array(N);
    for (let i = 0; i < N; i++) { const q = bin.charCodeAt(i) / 255; f[i] = q * q; }
    return f;
  }

  /** A grid-sampled spectrum at any wavelength (linear between samples, 0 outside the grid). */
  function at(f, nm) {
    if (!(nm >= START && nm <= END)) return 0;
    const t = (nm - START) / STEP, i = Math.min(N - 2, Math.floor(t)), u = t - i;
    return f[i] + (f[i + 1] - f[i]) * u;
  }

  /** ∫ f dλ over [a, b] nm, exact for the piecewise-linear spectrum. */
  function integrate(f, a, b) {
    a = Math.max(a, START); b = Math.min(b, END);
    if (!(b > a)) return 0;
    let s = 0;
    const i0 = Math.floor((a - START) / STEP), i1 = Math.min(N - 2, Math.floor((b - START) / STEP));
    for (let i = i0; i <= i1; i++) {
      const xa = START + i * STEP, lo = Math.max(a, xa), hi = Math.min(b, xa + STEP);
      if (hi <= lo) continue;
      const slope = (f[i + 1] - f[i]) / STEP;
      s += (2 * f[i] + slope * (lo - xa + hi - xa)) / 2 * (hi - lo);
    }
    return s;
  }

  function peakOf(f) { let k = 0; for (let i = 1; i < N; i++) if (f[i] > f[k]) k = i; return START + k * STEP; }

  function makeDye(base, ex, em) {
    return Object.assign({}, base, { ex, em, exPeak: peakOf(ex), emPeak: peakOf(em), emArea: integrate(em, START, END) || 1 });
  }

  const CATEGORIES = ['Antibody dyes', 'Fluorescent proteins', 'Viability & DNA', 'Tracking & function', 'Beads'];
  let lib = null;
  function library() {
    if (!lib) lib = D.dyes.map(r => {
      const d = makeDye({ id: r.id, name: r.name, cat: r.cat, aka: r.aka || '', brightness: r.b == null ? null : r.b, custom: false }, decode(r.ex), decode(r.em));
      if (r.xp) d.exPeak = r.xp;
      if (r.mp) d.emPeak = r.mp;
      return d;
    });
    return lib;
  }
  function dye(id) { return library().find(d => d.id === id) || null; }

  function search(q, limit) {
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const nq = norm(q);
    if (!nq) return library().slice(0, limit || undefined);
    const hits = [];
    library().forEach(d => {
      const n = norm(d.name), a = norm(d.aka);
      const score = n === nq ? 0 : n.startsWith(nq) ? 1 : n.includes(nq) ? 2 : a.includes(nq) ? 3 : -1;
      if (score >= 0) hits.push([score, d]);
    });
    hits.sort((x, y) => x[0] - y[0] || x[1].name.localeCompare(y[1].name));
    return hits.slice(0, limit || undefined).map(x => x[1]);
  }

  /** Asymmetric Gaussian band with the given FWHM; `skew` = σ(blue side) / σ(red side). */
  function band(peak, fwhm, skew) {
    const S = fwhm / 1.1774;                       // FWHM = 1.1774 · (σ_blue + σ_red)
    const sBlue = S * skew / (1 + skew), sRed = S / (1 + skew);
    const f = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = START + i * STEP, z = (x - peak) / (x < peak ? sBlue : sRed);
      f[i] = Math.exp(-0.5 * z * z);
    }
    return f;
  }

  /** A dye modelled from its peaks (vendor data sheet): excitation tails toward blue, emission toward red. */
  function customDye(spec) {
    const exPeak = +spec.exPeak, emPeak = +spec.emPeak;
    if (!(exPeak >= START && exPeak <= END && emPeak >= START && emPeak <= END)) throw new Error('Peaks must be between ' + START + ' and ' + END + ' nm.');
    const exWidth = +spec.exWidth > 0 ? +spec.exWidth : 40, emWidth = +spec.emWidth > 0 ? +spec.emWidth : 45;
    const name = String(spec.name || '').trim() || 'Custom ' + exPeak + '/' + emPeak;
    const b = spec.brightness == null || spec.brightness === '' ? null : Math.max(1, Math.min(5, Math.round(+spec.brightness) || 1));
    const d = makeDye({ id: 'custom:' + name, name, cat: 'Custom', aka: '', brightness: b, custom: true,
      spec: { name, exPeak, emPeak, exWidth, emWidth, brightness: b } }, band(exPeak, exWidth, 1.6), band(emPeak, emWidth, 1 / 1.6));
    d.exPeak = exPeak; d.emPeak = emPeak;
    return d;
  }

  // --------------------------------------------------------------- physics
  function edges(det) { return det.type === 'lp' ? [det.center, END] : [det.center - det.width / 2, det.center + det.width / 2]; }
  function excitation(d, nm) { return at(d.ex, nm); }
  function captured(d, det) { const [a, b] = edges(det); return integrate(d.em, a, b) / d.emArea; }
  function signal(d, det) { return excitation(d, det.laser) * captured(d, det); }

  // ------------------------------------------------------- colours & names
  /** Approximate display colour of a wavelength; UV and near-IR stay visible (violet / dark red). */
  function wavelengthColor(nm) {
    let r = 0, g = 0, b = 0;
    if (nm < 380) { r = 0.42; b = 0.62; }
    else if (nm < 440) { r = (440 - nm) / 60; b = 1; }
    else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
    else if (nm < 510) { g = 1; b = (510 - nm) / 20; }
    else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
    else if (nm < 645) { r = 1; g = (645 - nm) / 65; }
    else r = 1;
    let k = 1;
    if (nm >= 380 && nm < 420) k = 0.5 + 0.5 * (nm - 380) / 40;
    else if (nm > 700) k = Math.max(0.5, 1 - 0.5 * (nm - 700) / 100);
    const c = v => Math.round(255 * Math.pow(v * k, 0.8));
    return 'rgb(' + c(r) + ',' + c(g) + ',' + c(b) + ')';
  }
  function laserName(nm) {
    return nm < 380 ? 'UV' : nm < 430 ? 'Violet' : nm < 500 ? 'Blue' : nm < 540 ? 'Green' : nm < 600 ? 'Yellow-green' : nm < 700 ? 'Red' : 'Near-IR';
  }
  function detLabel(det) { return det.type === 'lp' ? det.center + 'LP' : det.center + '/' + det.width; }
  function detName(det) { return det.id + ' (' + det.laser + ' nm · ' + detLabel(det) + ')'; }
  function pct(v) { return !Number.isFinite(v) ? '—' : v < 0.01 ? '<1%' : v < 0.1 ? (v * 100).toFixed(1) + '%' : Math.round(v * 100) + '%'; }

  Object.assign(P, { START, END, STEP, N, CATEGORIES, library, dye, search, customDye, at, integrate,
    edges, excitation, captured, signal, wavelengthColor, laserName, detLabel, detName, pct });

  // ----------------------------------------------------------- instruments
  const LETTER = { 355: 'U', 405: 'V', 488: 'B', 561: 'Y', 638: 'R' };
  const autoId = (laser, center) => (LETTER[laser] || 'L' + laser) + center;
  /** Detectors from { laser: ['525/40', '670LP', …] }, named like "B525". */
  function config(spec) {
    const detectors = [];
    Object.keys(spec).forEach(l => spec[l].forEach(f => {
      const laser = +l, m = /^(\d+)(?:\/(\d+)|LP)$/.exec(f);
      detectors.push({ id: autoId(laser, +m[1]), laser, center: +m[1], width: m[2] ? +m[2] : 0, type: m[2] ? 'bp' : 'lp' });
    }));
    return { lasers: Object.keys(spec).map(Number).sort((a, b) => a - b), detectors };
  }
  // This lab's CytoFLEX LX (serial BA39013), exactly as recorded in the 17-Sep-2026 FCS files.
  const LX_DETECTORS = [
    ['FL1', 355, 405, 30], ['FL2', 355, 525, 40], ['FL3', 355, 675, 30],
    ['FL4', 405, 450, 45], ['FL5', 405, 525, 40], ['FL6', 405, 610, 20], ['FL7', 405, 660, 10], ['FL8', 405, 763, 43],
    ['FL9', 488, 525, 40], ['FL10', 488, 610, 20], ['FL11', 488, 690, 50],
    ['FL13', 561, 585, 42], ['FL16', 561, 610, 20], ['FL12', 561, 675, 30], ['FL14', 561, 710, 50], ['FL15', 561, 763, 43],
    ['FL19', 638, 660, 10], ['FL17', 638, 712, 25], ['FL18', 638, 763, 43],
  ];
  const CHECK = 'Beckman’s standard configuration. Filters can be moved, so check yours.';
  const INSTRUMENTS = [
    { id: 'cytoflex-lx', name: 'CytoFLEX LX · 5 lasers (your lab)', note: 'As recorded in the 17-Sep-2026 plate files (serial BA39013).',
      lasers: [355, 405, 488, 561, 638], detectors: LX_DETECTORS.map(([id, laser, center, width]) => ({ id, laser, center, width, type: 'bp' })) },
    Object.assign({ id: 'cytoflex-v5b5r3', name: 'CytoFLEX V5-B5-R3 · 3 lasers', note: CHECK },
      config({ 405: ['450/45', '525/40', '610/20', '660/10', '780/60'], 488: ['525/40', '585/42', '610/20', '690/50', '780/60'], 638: ['660/10', '712/25', '780/60'] })),
    Object.assign({ id: 'cytoflex-v0b5r3', name: 'CytoFLEX V0-B5-R3 · 2 lasers', note: CHECK },
      config({ 488: ['525/40', '585/42', '610/20', '690/50', '780/60'], 638: ['660/10', '712/25', '780/60'] })),
    Object.assign({ id: 'cytoflex-s-v4b2y4r3', name: 'CytoFLEX S V4-B2-Y4-R3 · 4 lasers', note: CHECK },
      config({ 405: ['450/45', '525/40', '610/20', '660/10'], 488: ['525/40', '690/50'], 561: ['585/42', '610/20', '690/50', '780/60'], 638: ['660/10', '712/25', '780/60'] })),
  ];
  const clone = o => JSON.parse(JSON.stringify(o));
  function instrument(id) { const i = INSTRUMENTS.find(x => x.id === id); return i ? clone(i) : null; }
  function sortDetectors(dets) { return dets.sort((a, b) => a.laser - b.laser || a.center - b.center); }

  /** CytoFLEX names a detector "<laser>__<centre>-<width>", e.g. "488__525-40" (parameters add -A/-H/-W). */
  function parseDetectorName(s) {
    const m = /^(\d{3})__(\d{3})-(\d{1,3})(?:-[AHW])?$/.exec(String(s || '').trim());
    return m ? { laser: +m[1], center: +m[2], width: +m[3], type: 'bp' } : null;
  }

  /** The instrument recorded in loaded FCS files (CytoFLEX CHnNM / $PnS keywords), or null. */
  function instrumentFromSamples(samples) {
    for (const s of samples || []) {
      const m = s && s.meta;
      if (!m) continue;
      const dets = [], seen = new Set();
      const add = (p, id) => {
        const key = p.laser + ':' + p.center + '/' + p.width;
        if (seen.has(key)) return;
        seen.add(key);
        dets.push(Object.assign({ id }, p));
      };
      for (let k = 1; k <= 64; k++) { const p = parseDetectorName(m['CH' + k + 'NM']); if (p) add(p, String(m['CH' + k + 'ID'] || 'CH' + k)); }
      if (!dets.length) {
        for (let i = 1; i <= (+m['$PAR'] || 0); i++) { const p = parseDetectorName(m['$P' + i + 'S']); if (p) add(p, String(m['$P' + i + 'N'] || 'P' + i).replace(/-[AHW]$/, '')); }
      }
      if (!dets.length) continue;
      const sn = m['$CYTSN'] || m['SN'];
      return { id: 'from-files', name: (m['$CYT'] || 'Cytometer') + (sn ? ' · ' + sn : '') + ' (from loaded files)', note: 'Read from ' + (s.name || 'the loaded files') + '.',
        lasers: [...new Set(dets.map(d => d.laser))].sort((a, b) => a - b), detectors: sortDetectors(dets) };
    }
    return null;
  }

  /** A clean copy of a hand-edited or imported instrument, or null when it has no usable laser. */
  function normInstrument(x) {
    if (!x || !Array.isArray(x.lasers) || !Array.isArray(x.detectors)) return null;
    const lasers = [...new Set(x.lasers.map(Number).filter(nm => nm >= START && nm <= END))].sort((a, b) => a - b);
    if (!lasers.length) return null;
    const ids = new Set();
    const detectors = sortDetectors(x.detectors.filter(Boolean).map(d => ({
      id: String(d.id || '').trim(), laser: +d.laser, center: +d.center, width: +d.width || 0, type: d.type === 'lp' ? 'lp' : 'bp',
    })).filter(d => lasers.includes(d.laser) && d.center >= START && d.center <= END && (d.type === 'lp' || d.width > 0)));
    detectors.forEach(d => {
      const base = d.id || autoId(d.laser, d.center);
      let id = base, k = 2;
      while (ids.has(id)) id = base + '-' + k++;
      d.id = id; ids.add(id);
      if (d.type === 'lp') d.width = 0;
    });
    return { id: String(x.id || 'custom'), name: String(x.name || '').trim() || 'Custom instrument', note: x.note ? String(x.note) : '', lasers, detectors };
  }

  Object.assign(P, { INSTRUMENTS, instrument, parseDetectorName, instrumentFromSamples, normInstrument });

  // ------------------------------------------------------------ assignment
  /** Minimum-cost assignment (Kuhn–Munkres) for an n×m cost matrix with n ≤ m. Returns row → column. */
  function hungarian(cost) {
    const n = cost.length, m = cost[0].length, INF = 1e18;
    const u = new Float64Array(n + 1), v = new Float64Array(m + 1), p = new Int32Array(m + 1), way = new Int32Array(m + 1);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Float64Array(m + 1).fill(INF), used = new Uint8Array(m + 1);
      do {
        used[j0] = 1;
        const i0 = p[j0];
        let delta = INF, j1 = 0;
        for (let j = 1; j <= m; j++) if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const out = new Array(n).fill(-1);
    for (let j = 1; j <= m; j++) if (p[j]) out[p[j] - 1] = j - 1;
    return out;
  }

  const FLOOR = 1e-9;
  /**
   * A detector for each dye: valid overrides first (they may share a detector — checks flag it),
   * then one free detector per remaining dye, maximising Σ log(signal). null = none left.
   */
  function assign(dyes, inst, overrides) {
    overrides = overrides || [];
    const dets = inst.detectors;
    const out = dyes.map((_, i) => (overrides[i] && dets.some(d => d.id === overrides[i]) ? overrides[i] : null));
    const taken = new Set(out.filter(Boolean));
    const rows = dyes.map((_, i) => i).filter(i => !out[i]);
    const cols = dets.filter(d => !taken.has(d.id));
    if (!rows.length || !cols.length) return out;
    const pad = Math.max(0, rows.length - cols.length);   // "no detector" columns, worse than any real one
    const cost = rows.map(i => cols.map(d => -Math.log(Math.max(FLOOR, signal(dyes[i], d)))).concat(new Array(pad).fill(-Math.log(FLOOR) + 1)));
    const a = hungarian(cost);
    rows.forEach((i, r) => { out[i] = a[r] >= 0 && a[r] < cols.length ? cols[a[r]].id : null; });
    return out;
  }

  function spillover(dyes, inst, assignment) {
    const det = id => inst.detectors.find(d => d.id === id);
    return dyes.map((di, i) => {
      const own = assignment[i] ? signal(di, det(assignment[i])) : 0;
      return dyes.map((_, j) => (i === j ? 1 : own > 0 && assignment[j] ? signal(di, det(assignment[j])) / own : NaN));
    });
  }

  // ---------------------------------------------------------------- checks
  const RANK = { crit: 0, warn: 1, ok: 2, info: 3 };
  function checks(dyes, inst, assignment) {
    const out = [];
    const det = id => inst.detectors.find(d => d.id === id);
    const push = (level, kind, idx, text) => out.push({ level, kind, dyes: idx, text });
    dyes.forEach((d, i) => { if (!assignment[i]) push('crit', 'nodetector', [i], d.name + ' has no free detector: the instrument has ' + inst.detectors.length + ' and every one is taken.'); });
    const byDet = {};
    assignment.forEach((id, i) => { if (id) (byDet[id] = byDet[id] || []).push(i); });
    Object.keys(byDet).forEach(id => {
      const idx = byDet[id];
      if (idx.length > 1) push('crit', 'shared', idx, idx.map(i => dyes[i].name).join(' and ') + ' are both read in ' + detName(det(id)) + ', so they can’t be told apart.');
    });
    dyes.forEach((d, i) => {
      const best = Math.max(0, ...inst.lasers.map(nm => excitation(d, nm)));
      if (best < 0.05) { push('crit', 'unexcited', [i], 'No laser on this instrument excites ' + d.name + ' (best ' + pct(best) + '). It is excited best at ' + d.exPeak + ' nm.'); return; }
      if (!assignment[i]) return;
      const dd = det(assignment[i]), ex = excitation(d, dd.laser), cap = captured(d, dd);
      if (ex < 0.2) push('warn', 'weakex', [i], 'The ' + dd.laser + ' nm laser excites ' + d.name + ' at only ' + pct(ex) + ' of its peak, so expect a dim signal.');
      if (cap < 0.1) push('warn', 'lowcapture', [i], 'Only ' + pct(cap) + ' of ' + d.name + '’s light passes the ' + detLabel(dd) + ' filter of ' + dd.id + '.');
    });
    const S = spillover(dyes, inst, assignment), pairs = [];
    dyes.forEach((_, i) => dyes.forEach((__, j) => {
      if (i !== j && assignment[i] !== assignment[j] && S[i][j] >= 0.1) pairs.push([S[i][j], i, j]);
    }));
    pairs.sort((a, b) => b[0] - a[0]).forEach(([v, i, j]) => {
      const A = dyes[i].name, B = dyes[j].name, where = detName(det(assignment[j]));
      push(v >= 0.3 ? 'crit' : 'warn', 'spill', [i, j],
        v > 1 ? A + ' is brighter in ' + B + '’s detector ' + where + ' than in its own. Move one of them, or choose a different dye.'
          : A + ' spills ' + pct(v) + ' into ' + B + '’s detector ' + where + '. ' + (v >= 0.3
            ? 'That makes the two hard to separate: choose a different dye for one of them, or keep them on markers that are never on the same cells.'
            : 'Compensation handles this, but avoid a dim ' + B + ' marker on cells that are bright for ' + A + '.'));
    });
    dyes.forEach((d, i) => {
      if (!assignment[i]) return;
      const own = det(assignment[i]).laser;
      inst.lasers.forEach(nm => {
        const e = excitation(d, nm);
        if (nm !== own && e >= 0.3) push('info', 'crosslaser', [i], d.name + ' is also excited ' + pct(e) + ' by the ' + nm + ' nm laser, so it shows up in that laser’s detectors too.');
      });
    });
    if (dyes.length && !out.some(c => c.level === 'crit' || c.level === 'warn')) {
      push('ok', 'clear', [], 'No conflicts: every dye has its own detector, is well excited, and spills less than 10% into the others.');
    }
    return out.sort((a, b) => RANK[a.level] - RANK[b.level]);
  }

  Object.assign(P, { hungarian, assign, spillover, checks });

  // ---------------------------------------------------------------- panels
  const PANEL_PRESETS = [
    { id: 'phagocytosis', name: 'Phagocytosis: blue beads, pHrodo Red, viability', instrument: 'cytoflex-lx',
      description: 'Blue FluoSpheres read on the UV laser (355 nm · 405/30, the channel your 17-Sep plate used), pHrodo Red to show particles that reached acidic phagosomes, and Zombie NIR to leave out dead cells.',
      dyes: [{ ref: 'fsblue', target: 'Beads' }, { ref: 'phrodored', target: 'Acidified phagosomes' }, { ref: 'zombienir', target: 'Dead cells' }] },
  ];
  function entry(e) {
    return { ref: e.ref || null, custom: e.custom || null, target: String(e.target || ''), detector: e.detector || null, hidden: !!e.hidden };
  }
  function newPanel(inst) { return { name: 'Untitled panel', instrument: clone(inst || INSTRUMENTS[0]), dyes: [] }; }
  function presetPanel(id) {
    const p = PANEL_PRESETS.find(x => x.id === id);
    return p ? { name: p.name, instrument: instrument(p.instrument), dyes: p.dyes.map(entry) } : null;
  }
  function resolve(e) { return e.custom ? customDye(e.custom) : dye(e.ref); }
  function serialize(panel) {
    return JSON.stringify({ kind: 'flowmate-panel', version: 1, name: panel.name, instrument: panel.instrument, dyes: panel.dyes.map(entry) }, null, 2);
  }
  function deserialize(input) {
    let o = input;
    if (typeof input === 'string') { try { o = JSON.parse(input); } catch (_) { throw new Error('This file is not valid JSON.'); } }
    if (!o || (o.kind !== 'flowmate-panel' && o.kind !== 'flowmotion-panel')) throw new Error('This is not a FlowMate panel file.');
    const warnings = [], dyes = [];
    (Array.isArray(o.dyes) ? o.dyes : []).forEach(raw => {
      const e = entry(raw || {});
      if (e.custom) { try { customDye(e.custom); dyes.push(e); } catch (err) { warnings.push('Skipped a custom dye: ' + err.message); } }
      else if (e.ref && dye(e.ref)) dyes.push(e);
      else warnings.push('Unknown dye “' + (e.ref || '?') + '” was skipped.');
    });
    return { panel: { name: String(o.name || 'Untitled panel'), instrument: normInstrument(o.instrument) || instrument('cytoflex-lx'), dyes }, warnings };
  }

  Object.assign(P, { PANEL_PRESETS, newPanel, presetPanel, resolve, serialize, deserialize });
})(FM);
