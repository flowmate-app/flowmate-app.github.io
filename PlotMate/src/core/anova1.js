/* One-way ANOVA and its relatives.
 *
 *   ordinary        F test; R²; Bartlett's and Brown–Forsythe tests for equal SDs
 *   ordinarySummary the same from mean / SD / N
 *   welch           Welch's ANOVA (unequal SDs)
 *   brownForsythe   Brown–Forsythe ANOVA F* (unequal SDs)
 *   rm              repeated measures (complete rows), Geisser–Greenhouse ε, matching F
 *   kruskal         Kruskal–Wallis H (tie-corrected, χ² approximation)
 *   friedman        Friedman (tie-corrected, χ² approximation)
 *   trend           post test for a linear trend across the group order
 */
(function (PM) {
  'use strict';
  const D = () => PM.dist;
  const S = () => PM.describe;

  function clean(a) { return a.filter(v => typeof v === 'number' && Number.isFinite(v)); }

  function stats(groups) {
    return groups.map(g => { const x = clean(g); const ms = S().meanSd(x); return { n: x.length, mean: ms.mean, sd: ms.sd, var: ms.sd * ms.sd, x }; });
  }

  function ordinaryCore(st) {
    const k = st.length;
    const N = st.reduce((s, g) => s + g.n, 0);
    const grand = st.reduce((s, g) => s + g.n * g.mean, 0) / N;
    let ssb = 0, ssw = 0;
    st.forEach(g => { ssb += g.n * (g.mean - grand) * (g.mean - grand); ssw += (g.n - 1) * (g.n > 1 ? g.var : 0); });
    const dfb = k - 1, dfw = N - k;
    const msb = ssb / dfb, msw = ssw / dfw;
    const F = msb / msw;
    const out = { k, N, grand, ssb, ssw, sst: ssb + ssw, dfb, dfw, dft: N - 1, msb, msw, F, dfn: dfb, dfd: dfw, p: D().pfUpper(F, dfb, dfw), r2: ssb / (ssb + ssw),
      means: st.map(g => g.mean), ns: st.map(g => g.n), sds: st.map(g => g.sd) };
    // Bartlett's test (needs n ≥ 2 and SD > 0 in every group)
    if (st.every(g => g.n > 1 && g.var > 0)) {
      const sp2 = msw;
      let a = 0, c = 0;
      st.forEach(g => { a += (g.n - 1) * Math.log(g.var); c += 1 / (g.n - 1); });
      const chi2 = ((N - k) * Math.log(sp2) - a) / (1 + (c - 1 / (N - k)) / (3 * (k - 1)));
      out.bartlett = { chi2, df: k - 1, p: D().pchisqUpper(chi2, k - 1) };
    }
    return out;
  }

  /** Ordinary one-way ANOVA on raw values. */
  function ordinary(groups) {
    const st = stats(groups);
    const out = ordinaryCore(st);
    // Brown–Forsythe test for equal variances: ANOVA on |x − group median|
    if (st.every(g => g.n > 1)) {
      const dev = st.map(g => { const m = S().median(g.x); return g.x.map(v => Math.abs(v - m)); });
      const b = ordinaryCore(stats(dev));
      out.brownForsythe = { F: b.F, dfn: b.dfn, dfd: b.dfd, p: b.p };
    }
    out.groups = st.map(g => ({ n: g.n, mean: g.mean, sd: g.sd }));
    return out;
  }
  /** Ordinary one-way ANOVA from summary data [{mean, sd, n}]. */
  function ordinarySummary(sum) {
    const st = sum.map(s => ({ n: s.n, mean: s.mean, sd: s.sd, var: s.sd * s.sd }));
    const out = ordinaryCore(st);
    out.groups = st.map(g => ({ n: g.n, mean: g.mean, sd: g.sd }));
    return out;
  }

  /** Welch's ANOVA. */
  function welch(groups) {
    const st = Array.isArray(groups[0]) ? stats(groups) : groups.map(s => ({ n: s.n, mean: s.mean, var: s.sd * s.sd }));
    const k = st.length;
    const w = st.map(g => g.n / g.var);
    const W = PM.sum(w);
    const xw = st.reduce((s, g, i) => s + w[i] * g.mean, 0) / W;
    let A = 0, L = 0;
    st.forEach((g, i) => { A += w[i] * (g.mean - xw) * (g.mean - xw); L += Math.pow(1 - w[i] / W, 2) / (g.n - 1); });
    A /= (k - 1);
    const B = 1 + 2 * (k - 2) / (k * k - 1) * L;
    const F = A / B;
    const dfd = (k * k - 1) / (3 * L);
    return { F, dfn: k - 1, dfd, p: D().pfUpper(F, k - 1, dfd) };
  }

  /** Brown–Forsythe ANOVA (1974): F* with Satterthwaite denominator df. */
  function brownForsythe(groups) {
    const st = Array.isArray(groups[0]) ? stats(groups) : groups.map(s => ({ n: s.n, mean: s.mean, var: s.sd * s.sd }));
    const k = st.length, N = st.reduce((s, g) => s + g.n, 0);
    const grand = st.reduce((s, g) => s + g.n * g.mean, 0) / N;
    let num = 0, den = 0;
    st.forEach(g => { num += g.n * (g.mean - grand) * (g.mean - grand); den += (1 - g.n / N) * g.var; });
    const F = num / den;
    let sf = 0;
    st.forEach(g => { const f = (1 - g.n / N) * g.var / den; sf += f * f / (g.n - 1); });
    const dfd = 1 / sf;
    return { F, dfn: k - 1, dfd, p: D().pfUpper(F, k - 1, dfd) };
  }

  /** Rows (subjects) where every treatment has a number. */
  function completeRows(matrix) {
    const keep = [], dropped = [];
    matrix.forEach((row, i) => (row.every(v => typeof v === 'number' && Number.isFinite(v)) ? keep : dropped).push(i));
    return { rows: keep.map(i => matrix[i]), keep, dropped };
  }

  /** Repeated-measures one-way ANOVA. matrix: subjects × treatments. */
  function rm(matrix, opts) {
    opts = opts || {};
    const cr = completeRows(matrix);
    const Y = cr.rows;
    const n = Y.length, k = n ? Y[0].length : 0;
    if (n < 2 || k < 2) return { error: 'Repeated measures needs at least two subjects with every value present.' };
    let grand = 0; Y.forEach(r => r.forEach(v => { grand += v; })); grand /= n * k;
    const tm = PM.range(k).map(j => PM.mean(Y.map(r => r[j])));
    const sm = Y.map(r => PM.mean(r));
    let sst = 0; Y.forEach(r => r.forEach(v => { sst += (v - grand) * (v - grand); }));
    const ssTreat = n * tm.reduce((s, m) => s + (m - grand) * (m - grand), 0);
    const ssSubj = k * sm.reduce((s, m) => s + (m - grand) * (m - grand), 0);
    const ssRes = sst - ssTreat - ssSubj;
    const dfT = k - 1, dfS = n - 1, dfR = (n - 1) * (k - 1);
    const msT = ssTreat / dfT, msS = ssSubj / dfS, msR = ssRes / dfR;
    const F = msT / msR;
    // Geisser–Greenhouse epsilon from the treatment covariance matrix
    const cov = PM.range(k).map(i => PM.range(k).map(j => {
      let s = 0; Y.forEach(r => { s += (r[i] - tm[i]) * (r[j] - tm[j]); }); return s / (n - 1);
    }));
    let diag = 0, all = 0, sq = 0;
    const rowMean = cov.map(r => PM.mean(r));
    cov.forEach((r, i) => { diag += r[i]; r.forEach(v => { all += v; sq += v * v; }); });
    diag /= k; all /= k * k;
    const rms = rowMean.reduce((s, m) => s + m * m, 0);
    const eps = (k * k * (diag - all) * (diag - all)) / ((k - 1) * (sq - 2 * k * rms + k * k * all * all));
    const epsilon = Math.min(1, Math.max(1 / (k - 1), eps));
    return {
      n, k, ssTreat, ssSubj, ssRes, sst, dfTreat: dfT, dfSubj: dfS, dfRes: dfR, msTreat: msT, msSubj: msS, msRes: msR,
      F, dfn: dfT, dfd: dfR, p: D().pfUpper(F, dfT, dfR),
      epsilon, pGG: D().pfUpper(F, epsilon * dfT, epsilon * dfR), dfnGG: epsilon * dfT, dfdGG: epsilon * dfR,
      matching: { F: msS / msR, dfn: dfS, dfd: dfR, p: D().pfUpper(msS / msR, dfS, dfR) },
      r2: ssTreat / (ssTreat + ssRes), means: tm, ns: tm.map(() => n), droppedRows: cr.dropped, keptRows: cr.keep,
    };
  }

  /** Kruskal–Wallis H with tie correction; mean ranks per group. */
  function kruskal(groups) {
    const g = groups.map(clean);
    const all = [].concat(...g);
    const N = all.length, k = g.length;
    const rk = S().ranks(all);
    let pos = 0, H = 0;
    const meanRanks = [], rankSums = [];
    g.forEach(x => { let s = 0; for (let i = 0; i < x.length; i++) s += rk.ranks[pos + i]; pos += x.length; rankSums.push(s); meanRanks.push(s / x.length); H += s * s / x.length; });
    H = 12 / (N * (N + 1)) * H - 3 * (N + 1);
    const tieSum = rk.ties.reduce((s, t) => s + t * t * t - t, 0);
    const C = 1 - tieSum / (N * N * N - N);
    H /= C;
    return { H, df: k - 1, p: D().pchisqUpper(H, k - 1), meanRanks, rankSums, ns: g.map(x => x.length), N, tieCorrection: C, tieSum, ranks: rk.ranks };
  }

  /** Friedman test on complete rows; rank sums and mean ranks per treatment. */
  function friedman(matrix) {
    const cr = completeRows(matrix);
    const Y = cr.rows;
    const n = Y.length, k = n ? Y[0].length : 0;
    if (n < 2 || k < 2) return { error: 'Friedman needs at least two subjects with every value present.' };
    const rankSums = new Array(k).fill(0);
    let tieSum = 0;
    Y.forEach(r => {
      const rr = S().ranks(r);
      rr.ranks.forEach((v, j) => { rankSums[j] += v; });
      rr.ties.forEach(t => { tieSum += t * t * t - t; });
    });
    let ss = 0; rankSums.forEach(R => { ss += (R - n * (k + 1) / 2) * (R - n * (k + 1) / 2); });
    const Fr = 12 * ss / (n * k * (k + 1) - tieSum / (k - 1));
    return { Fr, df: k - 1, p: D().pchisqUpper(Fr, k - 1), rankSums, meanRanks: rankSums.map(R => R / n), n, k, droppedRows: cr.dropped };
  }

  /** Post test for linear trend across groups in their column order (contrast weighted by n). */
  function trend(groups) {
    const st = stats(groups);
    const a = ordinaryCore(st);
    const N = a.N;
    const xbar = st.reduce((s, g, i) => s + g.n * (i + 1), 0) / N;
    let num = 0, den = 0;
    st.forEach((g, i) => { const c = i + 1 - xbar; num += g.n * c * g.mean; den += g.n * c * c; });
    const slope = num / den;
    const ssLin = num * num / den;
    const F = ssLin / a.msw;
    const ssDev = a.ssb - ssLin;
    const dfDev = a.k - 2;
    return {
      slope, ssLinear: ssLin, F, dfn: 1, dfd: a.dfw, p: D().pfUpper(F, 1, a.dfw), r2: ssLin / a.sst,
      nonlinear: dfDev > 0 ? { F: ssDev / dfDev / a.msw, dfn: dfDev, dfd: a.dfw, p: D().pfUpper(ssDev / dfDev / a.msw, dfDev, a.dfw) } : null,
    };
  }

  PM.anova1 = { stats, ordinary, ordinarySummary, welch, brownForsythe, rm, kruskal, friedman, trend, completeRows };
})(PM);
