/* Comparing two groups (or one group against a hypothetical value).
 *
 *   t tests: one-sample, unpaired (Student), unpaired with Welch's correction, paired, ratio paired
 *   nonparametric: Mann–Whitney, Wilcoxon signed-rank (one-sample and matched pairs),
 *                  Kolmogorov–Smirnov two-sample
 *   F test comparing two variances
 *
 * Differences follow Prism: B − A (second minus first). Nonparametric P values are exact
 * when there are no ties (or zero differences) and every n < 50, as in R; otherwise a normal
 * approximation with tie and continuity corrections. Hodges–Lehmann estimates are medians of
 * pairwise differences (Walsh averages for paired data) with distribution-free CIs.
 */
(function (PM) {
  'use strict';
  const D = () => PM.dist;
  const S = () => PM.describe;

  function clean(a) { return a.filter(v => typeof v === 'number' && Number.isFinite(v)); }
  function tcrit(level, df) { return D().qt(1 - (1 - level) / 2, df); }

  // ------------------------------------------------------------------ t tests
  function oneSample(x, mu, opts) {
    const level = (opts && opts.ciLevel) || 0.95;
    x = clean(x); mu = mu || 0;
    const n = x.length;
    const { mean, sd } = S().meanSd(x);
    const sem = sd / Math.sqrt(n);
    const df = n - 1;
    const t = (mean - mu) / sem;
    const q = tcrit(level, df);
    return {
      n, mean, sd, sem, mu, t, df, p: D().pt2(t, df),
      diff: mean - mu, ciLo: mean - mu - q * sem, ciHi: mean - mu + q * sem, meanLo: mean - q * sem, meanHi: mean + q * sem,
      r2: t * t / (t * t + df), ciLevel: level,
    };
  }

  /** F test comparing variances: larger / smaller, two-tailed (equals R's var.test P). */
  function fVariance(a, b) {
    const va = S().variance(a), vb = S().variance(b);
    const big = va >= vb;
    const F = big ? va / vb : vb / va;
    const dfn = (big ? a.length : b.length) - 1, dfd = (big ? b.length : a.length) - 1;
    return { F, dfn, dfd, p: Math.min(1, 2 * D().pfUpper(F, dfn, dfd)) };
  }

  /** Unpaired t test (opts.welch for unequal variances). Difference = mean(B) − mean(A). */
  function unpaired(a, b, opts) {
    opts = opts || {};
    const level = opts.ciLevel || 0.95;
    a = clean(a); b = clean(b);
    const na = a.length, nb = b.length;
    const A = S().meanSd(a), B = S().meanSd(b);
    const va = A.sd * A.sd, vb = B.sd * B.sd;
    let se, df;
    if (opts.welch) {
      se = Math.sqrt(va / na + vb / nb);
      df = Math.pow(va / na + vb / nb, 2) / (Math.pow(va / na, 2) / (na - 1) + Math.pow(vb / nb, 2) / (nb - 1));
    } else {
      df = na + nb - 2;
      const sp2 = ((na - 1) * va + (nb - 1) * vb) / df;
      se = Math.sqrt(sp2 * (1 / na + 1 / nb));
    }
    const diff = B.mean - A.mean;
    const t = diff / se;
    const q = tcrit(level, df);
    return {
      welch: !!opts.welch, na, nb, meanA: A.mean, meanB: B.mean, sdA: A.sd, sdB: B.sd, semA: A.sd / Math.sqrt(na), semB: B.sd / Math.sqrt(nb),
      diff, se, ciLo: diff - q * se, ciHi: diff + q * se, ciLevel: level,
      t, df, p: D().pt2(t, df), r2: t * t / (t * t + df),
      fTest: (na > 1 && nb > 1) ? fVariance(a, b) : null,
    };
  }
  /** Unpaired t test from summary data {mean, sd, n} (Prism allows this on grouped tables). */
  function unpairedSummary(A, B, opts) {
    opts = opts || {};
    const level = opts.ciLevel || 0.95;
    const va = A.sd * A.sd, vb = B.sd * B.sd, na = A.n, nb = B.n;
    let se, df;
    if (opts.welch) {
      se = Math.sqrt(va / na + vb / nb);
      df = Math.pow(va / na + vb / nb, 2) / (Math.pow(va / na, 2) / (na - 1) + Math.pow(vb / nb, 2) / (nb - 1));
    } else {
      df = na + nb - 2;
      se = Math.sqrt(((na - 1) * va + (nb - 1) * vb) / df * (1 / na + 1 / nb));
    }
    const diff = B.mean - A.mean, t = diff / se, q = tcrit(level, df);
    return { welch: !!opts.welch, na, nb, meanA: A.mean, meanB: B.mean, sdA: A.sd, sdB: B.sd, diff, se, ciLo: diff - q * se, ciHi: diff + q * se, ciLevel: level, t, df, p: D().pt2(t, df), r2: t * t / (t * t + df) };
  }

  /** Complete pairs (both values numeric). */
  function pairs(a, b) {
    const x = [], y = [];
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const u = a[i], v = b[i];
      if (typeof u === 'number' && Number.isFinite(u) && typeof v === 'number' && Number.isFinite(v)) { x.push(u); y.push(v); }
    }
    return { x, y };
  }

  /** Paired t test on B − A (opts.ratio: on log10(B/A), reporting the geometric mean ratio). */
  function paired(a, b, opts) {
    opts = opts || {};
    const level = opts.ciLevel || 0.95;
    const { x, y } = pairs(a, b);
    const n = x.length;
    let d;
    if (opts.ratio) {
      if (x.some(v => v <= 0) || y.some(v => v <= 0)) return { error: 'The ratio paired t test needs every value to be positive.' };
      d = y.map((v, i) => Math.log10(v / x[i]));
    } else d = y.map((v, i) => v - x[i]);
    const { mean, sd } = S().meanSd(d);
    const se = sd / Math.sqrt(n);
    const df = n - 1;
    const t = mean / se;
    const q = tcrit(level, df);
    const out = { ratio: !!opts.ratio, n, meanDiff: mean, sdDiff: sd, se, ciLo: mean - q * se, ciHi: mean + q * se, ciLevel: level, t, df, p: D().pt2(t, df), r2: t * t / (t * t + df), diffs: d };
    if (opts.ratio) { out.ratioGM = Math.pow(10, mean); out.ratioLo = Math.pow(10, out.ciLo); out.ratioHi = Math.pow(10, out.ciHi); }
    // was the pairing effective? (Pearson r between the pairs, one-tailed P for r > 0)
    if (n > 2) {
      const px = opts.ratio ? x.map(Math.log10) : x, py = opts.ratio ? y.map(Math.log10) : y;   // Prism: on the logs for the ratio test
      const r = PM.regression ? PM.regression.pearsonR(px, py) : pearsonR(px, py);
      const tt = r * Math.sqrt((n - 2) / (1 - r * r));
      out.pairing = { r, p: D().ptUpper(tt, n - 2) };
    }
    return out;
  }
  function pearsonR(x, y) {
    const mx = PM.mean(x), my = PM.mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
    return sxy / Math.sqrt(sxx * syy);
  }

  // ------------------------------------------------- exact shuffles with ties
  /**
   * Two-sided exact P of a rank-sum statistic, with ties: the fraction of every way to split the N
   * (mid)ranks into groups of na and N − na whose rank sum is at least as far from its mean as
   * the observed one (Prism's method, "even in the presence of ties"). Ranks are counted in
   * half units so midranks stay integers. null when the table would be too large.
   */
  function exactRankSumP(ranks, na, obsSum) {
    const N = ranks.length;
    const h = ranks.map(r => Math.round(r * 2));
    const maxS = h.reduce((s, x) => s + x, 0);
    if (N * na * maxS > 6e8) return null;
    const ways = [];
    for (let k = 0; k <= na; k++) ways.push(new Float64Array(maxS + 1));
    ways[0][0] = 1;
    let reach = 0;
    for (let i = 0; i < N; i++) {
      const x = h[i];
      reach += x;
      for (let k = Math.min(i + 1, na); k >= 1; k--) {
        const prev = ways[k - 1], cur = ways[k];
        for (let s = reach; s >= x; s--) { const v = prev[s - x]; if (v) cur[s] += v; }
      }
    }
    const dist = ways[na];
    const mean = na * maxS / N, dev = Math.abs(Math.round(obsSum * 2) - mean) - 1e-7;
    let tot = 0, tail = 0;
    for (let s = 0; s <= maxS; s++) { const c = dist[s]; if (!c) continue; tot += c; if (Math.abs(s - mean) >= dev) tail += c; }
    return Math.min(1, tail / tot);
  }
  /** Two-sided exact P of the signed-rank sum W+ with tied (mid)ranks: every sign assignment. */
  function exactSignedRankP(ranks, wPlus) {
    const h = ranks.map(r => Math.round(r * 2));
    const maxS = h.reduce((s, x) => s + x, 0);
    if (ranks.length * maxS > 4e8) return null;
    const ways = new Float64Array(maxS + 1);
    ways[0] = 1;
    let reach = 0;
    for (const x of h) { reach += x; for (let s = reach; s >= x; s--) ways[s] += ways[s - x]; }
    const mean = maxS / 2, dev = Math.abs(Math.round(wPlus * 2) - mean) - 1e-7;
    let tot = 0, tail = 0;
    for (let s = 0; s <= maxS; s++) { const c = ways[s]; if (!c) continue; tot += c; if (Math.abs(s - mean) >= dev) tail += c; }
    return Math.min(1, tail / tot);
  }

  // ----------------------------------------------------------- Mann–Whitney
  /**
   * Mann–Whitney. U = min(U_A, U_B); R's W = U_A (sum of A's ranks − nA(nA+1)/2).
   * Exact P when no ties and both n < 50; else normal approximation (ties, continuity).
   * Hodges–Lehmann: median of all b_j − a_i, with a distribution-free CI.
   */
  function mannWhitney(a, b, opts) {
    opts = opts || {};
    const level = opts.ciLevel || 0.95;
    a = clean(a); b = clean(b);
    const na = a.length, nb = b.length, N = na + nb;
    const rk = S().ranks(a.concat(b));
    let ra = 0; for (let i = 0; i < na; i++) ra += rk.ranks[i];
    const rb = N * (N + 1) / 2 - ra;
    const Ua = ra - na * (na + 1) / 2;
    const Ub = na * nb - Ua;
    const ties = rk.ties.length > 0;
    // Prism (default): exact, ties included, while the smaller group has ≤ 100 values.
    // opts.rule 'r': R's wilcox.test (exact only without ties and n < 50).
    let exact, p = null;
    if (opts.rule === 'r' || opts.exact === false) exact = opts.exact != null ? opts.exact && !ties : (!ties && na < 50 && nb < 50);
    else {
      exact = Math.min(na, nb) <= 100;
      if (exact) { p = exactRankSumP(rk.ranks, na, ra); if (p == null) exact = false; }
    }
    if (exact && p == null) {
      p = Math.min(1, 2 * Math.min(D().pwilcox(Ua, na, nb), 1 - D().pwilcox(Ua - 1, na, nb)));
    } else if (!exact) {
      const tieSum = rk.ties.reduce((s, t) => s + t * t * t - t, 0);
      const sigma = Math.sqrt((na * nb / 12) * ((N + 1) - tieSum / (N * (N - 1))));
      const dz = Ua - na * nb / 2;
      const z = (dz - Math.sign(dz) * 0.5) / sigma;
      p = Math.min(1, 2 * D().pnorm(-Math.abs(z)));
    }
    // pairwise differences b − a, sorted
    const diffs = [];
    for (let i = 0; i < nb; i++) for (let j = 0; j < na; j++) diffs.push(b[i] - a[j]);
    diffs.sort((x, y) => x - y);
    const hl = medianSorted(diffs);
    const ci = hlCI(diffs, level, (q) => qwilcox(q, na, nb), na * nb, exact, Math.sqrt(na * nb * (N + 1) / 12));
    return {
      na, nb, sumRanksA: ra, sumRanksB: rb, meanRankA: ra / na, meanRankB: rb / nb, Ua, U: Math.min(Ua, Ub), W: Ua,
      exact, p, medianA: S().median(a), medianB: S().median(b), diffMedians: S().median(b) - S().median(a),
      hl, hlLo: ci.lo, hlHi: ci.hi, ciLevel: level, ties,
    };
  }
  function medianSorted(s) { const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
  /** Smallest u with P(U ≤ u) ≥ q. */
  function qwilcox(q, m, n) {
    const c = D().wilcoxCounts(m, n);
    let tot = 0; for (let i = 0; i < c.length; i++) tot += c[i];
    let s = 0;
    for (let u = 0; u < c.length; u++) { s += c[u]; if (s / tot >= q - 1e-12) return u; }
    return m * n;
  }
  function qsignrank(q, n) {
    const c = D().signrankCounts(n);
    const tot = Math.pow(2, n);
    let s = 0;
    for (let v = 0; v < c.length; v++) { s += c[v]; if (s / tot >= q - 1e-12) return v; }
    return n * (n + 1) / 2;
  }
  /**
   * Distribution-free CI from sorted pairwise differences (or Walsh averages): exact order
   * statistics from the statistic's quantile (as R's wilcox.test), or its normal approximation.
   */
  function hlCI(sortedVals, level, qfun, maxStat, exact, sigma) {
    const alpha = 1 - level;
    let qu;
    if (exact) {
      qu = qfun(alpha / 2);
      if (qu === 0) qu = 1;
    } else {
      qu = Math.round(maxStat / 2 - D().qnorm(1 - alpha / 2) * sigma);
      if (qu < 1) qu = 1;
    }
    const ql = maxStat - qu;
    return { lo: sortedVals[qu - 1], hi: sortedVals[Math.min(sortedVals.length - 1, ql)] };
  }

  // -------------------------------------------------------- Wilcoxon signed
  /** Signed-rank test of differences d against 0. Zeros are dropped (Wilcoxon's method) unless opts.pratt. */
  function signedRank(d, opts) {
    opts = opts || {};
    const level = opts.ciLevel || 0.95;
    d = clean(d);
    const nAll = d.length;
    const nz = d.filter(v => v === 0).length;
    let use = opts.pratt ? d : d.filter(v => v !== 0);
    const abs = use.map(Math.abs);
    const rk = S().ranks(abs);
    let Wp = 0, Wm = 0;
    use.forEach((v, i) => { if (v > 0) Wp += rk.ranks[i]; else if (v < 0) Wm += rk.ranks[i]; });
    const n = opts.pratt ? use.filter(v => v !== 0).length : use.length;
    const ties = rk.ties.length > 0;
    // Prism (default): exact below 200 pairs, ties included (zeros dropped, or ranked and left out
    // of the sum with Pratt's method). opts.rule 'r': R's wilcox.test rule.
    let exact, p = null;
    if (opts.rule === 'r' || opts.exact === false) exact = opts.exact != null ? opts.exact && !ties && !nz : (n < 50 && !ties && !nz);
    else {
      exact = n < 200;
      if (exact) {
        const signed = use.map((v, i) => ({ v, r: rk.ranks[i] })).filter(o => o.v !== 0);
        p = exactSignedRankP(signed.map(o => o.r), Wp);
        if (p == null) exact = false;
      }
    }
    if (exact && p == null) {
      p = Math.min(1, 2 * Math.min(D().psignrank(Wp, n), 1 - D().psignrank(Wp - 1, n)));
    } else if (!exact) {
      const tieSum = rk.ties.reduce((s, t) => s + t * t * t - t, 0);
      let sigma = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24 - tieSum / 48);
      let mu = n * (n + 1) / 4;
      if (opts.pratt && nz) {
        // Pratt (1959): ranks of zeros removed from the null mean and variance
        const N = use.length;
        mu = (N * (N + 1) - nz * (nz + 1)) / 4;
        sigma = Math.sqrt((N * (N + 1) * (2 * N + 1) - nz * (nz + 1) * (2 * nz + 1)) / 24 - tieSum / 48);
      }
      const dz = Wp - mu;
      const z = (dz - Math.sign(dz) * 0.5) / sigma;
      p = Math.min(1, 2 * D().pnorm(-Math.abs(z)));
    }
    // Hodges–Lehmann: median of Walsh averages, CI from the signed-rank distribution
    const nn = d.filter(v => v !== 0 || opts.pratt).length;
    const dd = opts.pratt ? d : d.filter(v => v !== 0);
    const walsh = [];
    for (let i = 0; i < dd.length; i++) for (let j = i; j < dd.length; j++) walsh.push((dd[i] + dd[j]) / 2);
    walsh.sort((x, y) => x - y);
    const M = nn * (nn + 1) / 2;
    const ci = walsh.length ? hlCI(walsh, level, (q) => qsignrank(q, nn), M, exact, Math.sqrt(nn * (nn + 1) * (2 * nn + 1) / 24)) : { lo: NaN, hi: NaN };
    return {
      n, nAll, nZeros: nz, Wplus: Wp, Wminus: Wm, W: Wp - Wm, V: Wp, exact, p, ties,
      median: S().median(d), hl: walsh.length ? medianSorted(walsh) : NaN, hlLo: ci.lo, hlHi: ci.hi, ciLevel: level,
    };
  }
  function wilcoxonOne(x, mu, opts) {
    x = clean(x);
    const r = signedRank(x.map(v => v - (mu || 0)), opts);
    r.mu = mu || 0; r.median = S().median(x);
    // report the Hodges–Lehmann pseudomedian of the values themselves (as R and Prism do)
    r.hl += r.mu; r.hlLo += r.mu; r.hlHi += r.mu;
    return r;
  }
  /** Wilcoxon matched pairs on B − A. */
  function wilcoxonPaired(a, b, opts) {
    const { x, y } = pairs(a, b);
    const r = signedRank(y.map((v, i) => v - x[i]), opts);
    r.medianA = S().median(x); r.medianB = S().median(y); r.medianDiff = r.median;
    return r;
  }

  // ------------------------------------------------------ Kolmogorov–Smirnov
  function ks2(a, b, opts) {
    a = clean(a).sort((x, y) => x - y); b = clean(b).sort((x, y) => x - y);
    const m = a.length, n = b.length;
    const all = a.concat(b).sort((x, y) => x - y);
    let Dmax = 0, i = 0, j = 0;
    for (const v of all) {
      while (i < m && a[i] <= v) i++;
      while (j < n && b[j] <= v) j++;
      Dmax = Math.max(Dmax, Math.abs(i / m - j / n));
    }
    const exact = opts && opts.exact != null ? opts.exact : m * n < 10000;
    let p;
    if (exact) p = D().psmirnovUpper(a, b, Dmax);
    else {
      const lam = Math.sqrt(m * n / (m + n)) * Dmax;
      p = kolmogorovUpper(lam);
    }
    return { D: Dmax, p, exact, na: m, nb: n };
  }
  /** P(K > λ) for the Kolmogorov distribution. */
  function kolmogorovUpper(lam) {
    if (lam < 0.2) return 1;
    let s = 0;
    for (let k = 1; k < 100; k++) { const t = 2 * Math.pow(-1, k - 1) * Math.exp(-2 * k * k * lam * lam); s += t; if (Math.abs(t) < 1e-17) break; }
    return Math.max(0, Math.min(1, s));
  }

  PM.ttest = { exactRankSumP, exactSignedRankP, oneSample, unpaired, unpairedSummary, paired, pairs, fVariance, mannWhitney, wilcoxonOne, wilcoxonPaired, signedRank, ks2, kolmogorovUpper, qwilcox, qsignrank, pearsonR };
})(PM);
