/* Descriptive statistics, as Prism's "Column statistics" reports them.
 *
 * Percentiles use the (n+1)p method (Hyndman–Fan type 6, R quantile(type = 6)), which is what
 * Prism uses. SD has n − 1 in the denominator. Skewness and kurtosis are the sample-adjusted
 * G1 and G2 (as Excel's SKEW and KURT); kurtosis is excess (0 for a normal distribution).
 */
(function (PM) {
  'use strict';
  const D = () => PM.dist;

  function sorted(a) { return Float64Array.from(a).sort(); }

  /** Type-6 quantile of an ascending-sorted array. */
  function quantile(s, p) {
    const n = s.length;
    if (!n) return NaN;
    const h = (n + 1) * p;
    if (h <= 1) return s[0];
    if (h >= n) return s[n - 1];
    const lo = Math.floor(h);
    return s[lo - 1] + (h - lo) * (s[lo] - s[lo - 1]);
  }
  function median(a) { return quantile(sorted(a), 0.5); }

  function meanSd(a) {
    const n = a.length;
    if (!n) return { mean: NaN, sd: NaN };
    let m = 0;
    for (let i = 0; i < n; i++) m += a[i];
    m /= n;
    let ss = 0;
    for (let i = 0; i < n; i++) ss += (a[i] - m) * (a[i] - m);
    return { mean: m, sd: n > 1 ? Math.sqrt(ss / (n - 1)) : NaN, ss };
  }
  function variance(a) { const r = meanSd(a); return r.sd * r.sd; }

  /** Everything Prism's column statistics offers. ciLevel defaults to 0.95. */
  function column(values, opts) {
    const level = (opts && opts.ciLevel) || 0.95;
    const a = values.filter(v => typeof v === 'number' && Number.isFinite(v));
    const n = a.length;
    const s = sorted(a);
    const { mean, sd } = meanSd(a);
    const sem = sd / Math.sqrt(n);
    const tq = n > 1 ? D().qt(1 - (1 - level) / 2, n - 1) : NaN;
    const out = {
      n, sum: PM.sum(a), mean, sd, sem, ciLevel: level,
      ciLo: mean - tq * sem, ciHi: mean + tq * sem,
      min: n ? s[0] : NaN, max: n ? s[n - 1] : NaN, range: n ? s[n - 1] - s[0] : NaN,
      p10: quantile(s, 0.10), q25: quantile(s, 0.25), median: quantile(s, 0.5), q75: quantile(s, 0.75), p90: quantile(s, 0.90),
      p5: quantile(s, 0.05), p95: quantile(s, 0.95), p2_5: quantile(s, 0.025), p97_5: quantile(s, 0.975),
      cv: sd / mean * 100,
      gmean: NaN, gsdFactor: NaN, gciLo: NaN, gciHi: NaN, hmean: NaN, hciLo: NaN, hciHi: NaN, qmean: NaN, qciLo: NaN, qciHi: NaN, skew: NaN, kurt: NaN,
      medianCiLo: NaN, medianCiHi: NaN, medianCiLevel: NaN,
    };
    if (n && a.every(v => v > 0)) {
      const logs = a.map(Math.log);
      const ls = meanSd(logs);
      out.gmean = Math.exp(ls.mean);
      out.gsdFactor = Math.exp(ls.sd);
      out.gciLo = Math.exp(ls.mean - tq * ls.sd / Math.sqrt(n));
      out.gciHi = Math.exp(ls.mean + tq * ls.sd / Math.sqrt(n));
      // harmonic mean: the CI of the mean of the reciprocals, inverted (as Prism)
      const rs = meanSd(a.map(v => 1 / v));
      out.hmean = 1 / rs.mean;
      out.hciLo = 1 / (rs.mean + tq * rs.sd / Math.sqrt(n));
      out.hciHi = rs.mean - tq * rs.sd / Math.sqrt(n) > 0 ? 1 / (rs.mean - tq * rs.sd / Math.sqrt(n)) : Infinity;
    }
    if (n) {
      // quadratic mean (RMS): the CI of the mean of the squares, square-rooted (as Prism)
      const sq = meanSd(a.map(v => v * v));
      out.qmean = Math.sqrt(sq.mean);
      out.qciLo = Math.sqrt(Math.max(0, sq.mean - tq * sq.sd / Math.sqrt(n)));
      out.qciHi = Math.sqrt(sq.mean + tq * sq.sd / Math.sqrt(n));
    }
    if (n > 2 && sd > 0) {
      let m3 = 0; a.forEach(v => { const z = (v - mean) / sd; m3 += z * z * z; });
      out.skew = n / ((n - 1) * (n - 2)) * m3;
    }
    if (n > 3 && sd > 0) {
      let m4 = 0; a.forEach(v => { const z = (v - mean) / sd; m4 += z * z * z * z; });
      out.kurt = n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * m4 - 3 * (n - 1) * (n - 1) / ((n - 2) * (n - 3));
    }
    // CI of the median from order statistics (binomial), the nonparametric interval Prism reports
    if (n >= 2) {
      const ci = medianCI(s, level);
      out.medianCiLo = ci.lo; out.medianCiHi = ci.hi; out.medianCiLevel = ci.level;
    }
    return out;
  }

  /**
   * Distribution-free CI of the median: the widest symmetric pair of order statistics
   * (x_(k), x_(n−k+1)) whose coverage is ≥ level; reports the actual coverage.
   */
  function medianCI(s, level) {
    const n = s.length;
    let best = { lo: s[0], hi: s[n - 1], level: 1 - 2 * Math.pow(0.5, n) };
    for (let k = 1; k <= Math.floor(n / 2); k++) {
      const cover = 1 - 2 * PM.dist.pbinom(k - 1, n, 0.5);
      if (cover >= level) best = { lo: s[k - 1], hi: s[n - k], level: cover }; else break;
    }
    return best;
  }

  /** Gaussian kernel density, Silverman's rule × smoothing factor; evaluated at `points` x values. */
  function kde(values, opts) {
    opts = opts || {};
    const a = values.filter(Number.isFinite);
    const n = a.length;
    if (n < 2) return { xs: [], ys: [], bw: NaN };
    const s = sorted(a);
    const { sd } = meanSd(a);
    const iqr = quantile(s, 0.75) - quantile(s, 0.25);
    let bw = 0.9 * Math.min(sd, iqr > 0 ? iqr / 1.34 : sd) * Math.pow(n, -0.2);
    if (!(bw > 0)) bw = sd > 0 ? sd : 1;
    bw *= opts.smoothing || 1;
    const lo = opts.from != null ? opts.from : s[0];
    const hi = opts.to != null ? opts.to : s[n - 1];
    const m = opts.points || 64;
    const xs = [], ys = [];
    const c = 1 / (n * bw * Math.sqrt(2 * Math.PI));
    for (let i = 0; i < m; i++) {
      const x = lo + (hi - lo) * i / (m - 1);
      let d = 0;
      for (let j = 0; j < n; j++) { const z = (x - a[j]) / bw; d += Math.exp(-0.5 * z * z); }
      xs.push(x); ys.push(d * c);
    }
    return { xs, ys, bw };
  }

  /** A "nice" number near x (1, 2, 2.5, 5 × 10^k). */
  function nice(x) {
    if (!(x > 0)) return 1;
    const e = Math.floor(Math.log10(x)), f = x / Math.pow(10, e);
    const n = f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10;
    return n * Math.pow(10, e);
  }

  /**
   * Frequency distribution. Bins are [start + k·w, start + (k+1)·w); a value exactly on a boundary
   * goes to the higher bin. Default width: Freedman–Diaconis, rounded to a nice number.
   * Returns bin centres and counts (plus relative and cumulative versions).
   */
  function freqDist(values, opts) {
    opts = opts || {};
    const a = values.filter(Number.isFinite);
    const s = sorted(a);
    const n = s.length;
    if (!n) return { centers: [], counts: [], relative: [], cumulative: [], cumRelative: [], width: NaN, start: NaN };
    let w = opts.binWidth;
    if (!(w > 0)) {
      const iqr = quantile(s, 0.75) - quantile(s, 0.25);
      w = iqr > 0 ? 2 * iqr / Math.cbrt(n) : (s[n - 1] - s[0]) / Math.max(1, Math.ceil(Math.log2(n) + 1));
      w = nice(w > 0 ? w : 1);
    }
    const start = opts.start != null ? opts.start : Math.floor(s[0] / w) * w;
    const nb = Math.max(1, Math.floor((s[n - 1] - start) / w) + 1);
    const counts = new Array(nb).fill(0);
    s.forEach(v => { const k = Math.min(nb - 1, Math.max(0, Math.floor((v - start) / w + 1e-12))); counts[k]++; });
    const centers = counts.map((_, k) => start + (k + 0.5) * w);
    const cumulative = []; let c = 0;
    counts.forEach(k => { c += k; cumulative.push(c); });
    return { centers, counts, relative: counts.map(k => k / n), cumulative, cumRelative: cumulative.map(k => k / n), width: w, start, n };
  }

  /** Ranks with ties averaged (1-based). Also returns the tie groups' sizes. */
  function ranks(a) {
    const idx = a.map((v, i) => i).sort((i, j) => a[i] - a[j]);
    const r = new Array(a.length);
    const ties = [];
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[i]]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k]] = avg;
      if (j > i) ties.push(j - i + 1);
      i = j + 1;
    }
    return { ranks: r, ties };
  }

  PM.describe = { sorted, quantile, median, meanSd, variance, column, medianCI, kde, nice, freqDist, ranks };
})(PM);
