/* Synthetic demo plate, shaped like a THP-1 bead phagocytosis assay:
 * debris, free beads, doublets, a bead-negative and a bead-positive cell population,
 * one failed well (no beads) and gentle drift with acquisition order.
 * Two more stains — CD11b PE (FL2) and a live/dead dye in APC (FL3) — spill into each other's
 * detectors, and the bead dye spills into FL2, so the plate can be unmixed with the single-stain
 * controls from demoControls(). They are drawn from a second random stream, so FL1 and the
 * scatter channels are exactly what they were before the stains were added.
 * Deterministic (seeded) so screenshots and tests are reproducible. */
(function (FM) {
  'use strict';

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gauss(r) {
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  const PARAMS = ['FSC-H', 'FSC-A', 'SSC-H', 'SSC-A', 'FL1-H', 'FL1-A', 'FSC-Width', 'Time', 'FL2-H', 'FL2-A', 'FL3-H', 'FL3-A'];
  const LABELS = { 'FL1-H': '355__405-30-H', 'FL1-A': '355__405-30-A', 'FL2-H': '488__585-42-H', 'FL2-A': '488__585-42-A', 'FL3-H': '638__660-10-H', 'FL3-A': '638__660-10-A' };
  /** Spillover between the demo's dyes: beads (FL1) → FL2 12%, FL3 1.5%; PE (FL2) → FL3 3%; APC (FL3) → FL2 4%. */
  const DEMO_SPILL = { beadsToFL2: 0.12, beadsToFL3: 0.015, peToFL3: 0.03, apcToFL2: 0.04 };

  const DEMO_GROUPS = [
    { row: 'A', name: 'IgG1', pos: 0.62, mfi: 2.4e5 },
    { row: 'B', name: 'IgG2', pos: 0.70, mfi: 2.6e5 },
    { row: 'C', name: 'IgG4', pos: 0.73, mfi: 2.7e5 },
    { row: 'D', name: 'LALA', pos: 0.74, mfi: 2.9e5 },
    { row: 'E', name: 'THP + beads', pos: 0.79, mfi: 3.1e5 },
    { row: 'F', name: 'THP alone', pos: 0, mfi: 0 },
  ];

  /** stains: which of the extra dyes the well carries (default: both); name: a file name for a control tube. */
  function makeWell(well, spec, order, seed, nEvents, failed, stains, name) {
    const r = rng(seed);
    const r2 = rng(seed + 7919);                 // the stains' own stream: FL1 and scatter stay as they were
    const st = Object.assign({ pe: 0.6, apc: 0.08 }, stains || {});
    const n = nEvents;
    const cols = PARAMS.map(() => new Float32Array(n));
    const [FSCH, FSCA, SSCH, SSCA, FLH, FLA, FW, TIME, F2H, F2A, F3H, F3A] = cols;
    const drift = 1 + 0.012 * order;
    const posFrac = failed ? 0.008 : Math.min(0.95, spec.pos * (0.97 + 0.02 * order / 3));
    const hasBeads = spec.pos > 0 && !failed;

    for (let i = 0; i < n; i++) {
      const u = r();
      let fsch, ssch, ratio, fl, kind = 'cell';
      if (u < 0.10) {
        kind = 'debris';
        // debris
        fsch = Math.exp(Math.log(5.2e4) + 0.35 * gauss(r));
        ssch = Math.exp(Math.log(6e4) + 0.7 * gauss(r));
        ratio = 0.55 + 0.08 * gauss(r);
        fl = Math.exp(Math.log(2500) + 0.5 * gauss(r));
      } else if (u < 0.13 && hasBeads) {
        // free beads: small, bright
        kind = 'bead';
        fsch = Math.exp(Math.log(4.5e4) + 0.2 * gauss(r));
        ssch = Math.exp(Math.log(3.5e4) + 0.3 * gauss(r));
        ratio = 0.6 + 0.05 * gauss(r);
        fl = Math.exp(Math.log(3.2e5) + 0.25 * gauss(r));
      } else {
        // cells
        fsch = Math.max(8e4, 2.95e5 + 7.5e4 * gauss(r));
        ssch = Math.max(5e4, 0.62 * fsch * (1 + 0.28 * gauss(r)) + 2e4 * gauss(r));
        const doublet = r() < 0.12;
        ratio = doublet ? 0.26 + 0.06 * gauss(r) : 0.535 + 0.045 * gauss(r);
        if (doublet) { fsch *= 1.25; }
        if (r() < posFrac) {
          const beadsIn = 1 + Math.floor(-Math.log(r()) * 1.6);
          fl = Math.exp(Math.log(spec.mfi * drift * 0.72) + Math.log(beadsIn) * 0.9 + 0.28 * gauss(r));
        } else {
          fl = Math.exp(Math.log(3300) + 0.3 * gauss(r));
        }
      }
      FSCH[i] = fsch;
      FSCA[i] = fsch * (1.62 + 0.08 * gauss(r));
      SSCH[i] = Math.max(80, ssch);
      SSCA[i] = Math.max(100, ssch / Math.max(0.12, ratio));
      FLH[i] = Math.max(60, fl);
      FLA[i] = Math.max(80, fl * (0.95 + 0.1 * r()));
      FW[i] = 1700 + 180 * gauss(r);
      TIME[i] = i * 170 + 40 * r();
      // the two stains, and how every dye's light spreads over FL2 and FL3
      const pe = kind === 'cell' && r2() < st.pe ? Math.pow(10, 4.3 + 0.25 * gauss(r2)) : 0;
      const dead = kind === 'debris' ? r2() < Math.min(1, st.apc * 6) : kind === 'cell' && r2() < st.apc;
      const apc = dead ? Math.pow(10, 4.6 + 0.2 * gauss(r2)) : 0;
      const bead = Math.max(0, fl - 3300);         // the bead dye's light, above the cells' own glow
      const f2 = 420 + 110 * gauss(r2) + pe + DEMO_SPILL.beadsToFL2 * bead + DEMO_SPILL.apcToFL2 * apc;
      const f3 = 380 + 100 * gauss(r2) + apc + DEMO_SPILL.peToFL3 * pe + DEMO_SPILL.beadsToFL3 * bead;
      F2H[i] = Math.max(40, f2); F2A[i] = Math.max(50, f2 * (0.95 + 0.1 * r2()));
      F3H[i] = Math.max(40, f3); F3A[i] = Math.max(50, f3 * (0.95 + 0.1 * r2()));
    }
    const data = {};
    PARAMS.forEach((p, k) => { data[p] = cols[k]; });
    const params = PARAMS.map((p, k) => ({
      index: k, name: p, label: LABELS[p] || p, range: p === 'Time' ? 9e8 : 16777216, bits: 32,
      logDecades: 0, logOffset: 0, gain: 1, displayHint: /FL/.test(p) ? 'log' : 'lin',
    }));
    const t0 = new Date(2026, 8, 17, 14, 28, 0).getTime();
    return {
      name: name || 'Demo-Well-' + well + '.fcs', version: 'FCS3.0',
      meta: Object.assign(well ? { '$SMNO': well } : {}, { '$CYT': 'Demo cytometer', '$TOT': String(n), '$PAR': String(PARAMS.length) }),
      params, n, data, spill: null, acqTime: t0 + order * 95000, cytometer: 'Demo cytometer', demo: true,
    };
  }

  /** 6 × 3 demo plate. Well E1 is a failed well (beads never added). */
  function demoPlate(nEvents) {
    nEvents = nEvents || 6000;
    const out = [];
    let order = 0;
    DEMO_GROUPS.forEach((g, gi) => {
      for (let c = 1; c <= 3; c++) {
        const well = g.row + c;
        out.push(makeWell(well, g, order++, 1000 + gi * 17 + c, nEvents, well === 'E1'));
      }
    });
    return out;
  }

  /**
   * Single-stain controls for the demo plate's three dyes, plus an unstained tube: cells given beads
   * but no stains, cells with only CD11b PE, cells with only the live/dead dye (half killed, so there
   * is a bright population), and cells with nothing. → [{ sample, name, role }]
   */
  function demoControls(nEvents) {
    const n = nEvents || 6000;
    const none = { pe: 0, apc: 0 };
    const beads = DEMO_GROUPS[4], plain = DEMO_GROUPS[5];
    return [
      { name: 'Unstained', role: 'unstained', sample: makeWell(null, plain, 0, 4101, n, false, none, 'Control - Unstained.fcs') },
      { name: 'Beads (FL1)', role: 'comp', sample: makeWell(null, beads, 0, 4102, n, false, none, 'Control - Beads only.fcs') },
      { name: 'CD11b PE', role: 'comp', sample: makeWell(null, plain, 0, 4103, n, false, { pe: 0.6, apc: 0 }, 'Control - CD11b PE.fcs') },
      { name: 'Live/Dead APC', role: 'comp', sample: makeWell(null, plain, 0, 4104, n, false, { pe: 0, apc: 0.5 }, 'Control - Live-Dead APC.fcs') },
    ];
  }

  /** A full plate for performance testing: rows cycle through the demo conditions. */
  function bigPlate(rows, cols, nEvents) {
    const out = [];
    let order = 0;
    for (let r = 0; r < rows; r++) for (let c = 1; c <= cols; c++) {
      const g = DEMO_GROUPS[r % DEMO_GROUPS.length];
      out.push(makeWell(FM.wells.ROWS[r] + c, g, order++, 7000 + r * 31 + c, nEvents, false));
    }
    return out;
  }

  /**
   * Single-stain compensation controls with a known spillover: an unstained sample, one
   * control per dye (half the cells bright in that dye) and a mixed sample. Detector j reads
   * Σᵢ trueᵢ·S[i][j] + autofluorescence, so compensating with S recovers the true signal.
   * truePos[param] counts the mixed sample's cells that are truly positive for that dye.
   */
  function compControls(nEvents) {
    const n = nEvents || 5000;
    const params = ['FL1-A', 'FL2-A', 'FL3-A'];
    const spill = [[1, 0.15, 0.02], [0, 1, 0.08], [0.01, 0, 1]];
    const names = ['FSC-A', 'SSC-A'].concat(params);
    const truePos = {};
    const make = (name, seed, posProb) => {
      const r = rng(seed);
      const cols = names.map(() => new Float32Array(n));
      const counts = [0, 0, 0];
      for (let e = 0; e < n; e++) {
        cols[0][e] = 52000 + 5200 * gauss(r);
        cols[1][e] = 21000 + 2600 * gauss(r);
        const tru = posProb.map((p, k) => {
          if (r() >= p) return 0;
          counts[k]++;
          return Math.pow(10, 4.3 + 0.22 * gauss(r));
        });
        for (let j = 0; j < 3; j++) {
          let v = 150 + 40 * gauss(r);
          for (let i = 0; i < 3; i++) v += tru[i] * spill[i][j];
          cols[2 + j][e] = v;
        }
      }
      const data = {};
      names.forEach((nm, k) => { data[nm] = cols[k]; });
      return { counts, sample: {
        name, version: 'FCS3.1', meta: { '$FIL': name, '$CYT': 'Demo cytometer', '$TOT': String(n), '$PAR': String(names.length) },
        params: names.map((nm, k) => ({ index: k, name: nm, label: nm, range: 262144, bits: 32, logDecades: 0, logOffset: 0, gain: 1, displayHint: /FL/.test(nm) ? 'log' : 'lin' })),
        n, data, spill: null, acqTime: null, cytometer: 'Demo cytometer', demo: true,
      } };
    };
    const out = [make('Unstained.fcs', 501, [0, 0, 0]).sample];
    params.forEach((p, k) => out.push(make('Comp-' + p.replace('-A', '') + '.fcs', 502 + k, [0, 1, 2].map(i => (i === k ? 0.5 : 0))).sample));
    const mixed = make('Mixed.fcs', 509, [0.3, 0.25, 0.35]);
    params.forEach((p, k) => { truePos[p] = mixed.counts[k]; });
    out.push(mixed.sample);
    return { samples: out, params, spill, truePos };
  }

  /**
   * A spectral experiment with a known answer: 32 detectors (4 lasers × 8), 6 dyes with smooth
   * emission spectra, single-stain controls, an unstained sample and six stained wells. Detector d
   * reads Σᵢ aᵢ·Mᵢ[d] + noise, where aᵢ is the true amount of dye i (kept as sample._truth) and Mᵢ its
   * signature (peak 1), so unmixing with the right signatures recovers aᵢ.
   */
  const SPECTRAL_LASERS = ['V', 'B', 'YG', 'R'];
  const SPECTRAL_DYES = [
    { label: 'CD3 BV421', excite: { V: 1, B: 0.02 }, centre: 1, width: 1.0 },
    { label: 'CD4 BV510', excite: { V: 1, B: 0.06 }, centre: 3.2, width: 1.1 },
    { label: 'CD8 FITC', excite: { B: 1, V: 0.05 }, centre: 1, width: 1.0 },
    { label: 'CD19 PE', excite: { YG: 1, B: 0.3 }, centre: 2, width: 1.0 },
    { label: 'CD56 PE-Cy7', excite: { YG: 1, B: 0.25 }, centre: 7, width: 0.9, shoulder: 0.12 },
    { label: 'CD14 APC', excite: { R: 1, YG: 0.1 }, centre: 2, width: 1.0 },
  ];
  function spectralSignature(dye) {
    const sig = [];
    SPECTRAL_LASERS.forEach(L => {
      const e = dye.excite[L] || 0.004;
      for (let i = 0; i < 8; i++) {
        let v = Math.exp(-((i - dye.centre) * (i - dye.centre)) / (2 * dye.width * dye.width));
        if (dye.shoulder) v += dye.shoulder * Math.exp(-((i - 2) * (i - 2)) / 2);    // a tandem's donor emission
        sig.push(e * v);
      }
    });
    const peak = Math.max(...sig);
    return sig.map(v => v / peak);
  }
  function spectralDemo(nEvents) {
    const n = nEvents || 4000;
    const detectors = [];
    SPECTRAL_LASERS.forEach(L => { for (let i = 1; i <= 8; i++) detectors.push(L + i + '-A'); });
    const sigs = SPECTRAL_DYES.map(spectralSignature);
    const names = ['FSC-A', 'SSC-A'].concat(detectors);
    const make = (name, well, seed, probs) => {
      const r = rng(seed);
      const cols = names.map(() => new Float32Array(n));
      const truth = SPECTRAL_DYES.map(() => new Float32Array(n));
      for (let e = 0; e < n; e++) {
        cols[0][e] = 60000 + 6000 * gauss(r);
        cols[1][e] = 25000 + 3000 * gauss(r);
        const amt = probs.map((pr, i) => (r() < pr ? Math.pow(10, 4.1 + 0.25 * gauss(r)) : 0));
        amt.forEach((a, i) => { truth[i][e] = a; });
        for (let d = 0; d < detectors.length; d++) {
          let v = 120 + 35 * gauss(r);
          for (let i = 0; i < amt.length; i++) v += amt[i] * sigs[i][d];
          cols[2 + d][e] = v;
        }
      }
      const data = {};
      names.forEach((nm, k) => { data[nm] = cols[k]; });
      const t = {};
      SPECTRAL_DYES.forEach((dy, i) => { t[dy.label] = truth[i]; });
      return {
        name, version: 'FCS3.1', meta: { '$FIL': name, '$CYT': 'Demo spectral cytometer', '$TOT': String(n), '$PAR': String(names.length), '$WELLID': well || '' },
        params: names.map((nm, k) => ({ index: k, name: nm, label: nm, range: 4194304, bits: 32, logDecades: 0, logOffset: 0, gain: 1, displayHint: k > 1 ? 'log' : 'lin' })),
        n, data, spill: null, acqTime: null, cytometer: 'Demo spectral cytometer', demo: true, _truth: t,
      };
    };
    const zero = SPECTRAL_DYES.map(() => 0);
    const samples = [make('Unstained control.fcs', null, 501, zero)];
    SPECTRAL_DYES.forEach((dy, i) => samples.push(make(dy.label + ' single stain.fcs', null, 600 + i, zero.map((_, j) => (j === i ? 0.5 : 0)))));
    ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'].forEach((w, k) => samples.push(make('Stained_' + w + '.fcs', w, 700 + k, [0.6, 0.4, 0.3, 0.15, 0.1, 0.12])));
    return { samples, detectors, dyes: SPECTRAL_DYES.map((d, i) => ({ label: d.label, signature: sigs[i] })) };
  }

  FM.synth = { demoPlate, demoControls, bigPlate, compControls, spectralDemo, rng, gauss, DEMO_GROUPS, DEMO_SPILL };
})(FM);
