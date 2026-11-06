/* Descriptive statistics over event populations and over plain number arrays. */
(function (FM) {
  'use strict';

  /** Gather a parameter's values for a population into a new Float64Array. */
  function gather(col, idx) {
    const out = new Float64Array(idx.length);
    for (let i = 0; i < idx.length; i++) out[i] = col[idx[i]];
    return out;
  }

  function mean(a) {
    let s = 0; for (let i = 0; i < a.length; i++) s += a[i];
    return a.length ? s / a.length : NaN;
  }

  function sd(a, m) {
    if (a.length < 2) return NaN;
    if (m == null) m = mean(a);
    let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - m; s += d * d; }
    return Math.sqrt(s / (a.length - 1));
  }

  /** Geometric mean over strictly positive values (non-positive values are undefined in log space). */
  function gmean(a) {
    let s = 0, n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] > 0) { s += Math.log(a[i]); n++; }
    return n ? Math.exp(s / n) : NaN;
  }

  function sortedCopy(a) { return Float64Array.from(a).sort(); }

  function quantileSorted(s, q) {
    if (!s.length) return NaN;
    const pos = (s.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }

  function median(a) { return quantileSorted(sortedCopy(a), 0.5); }

  /** Full descriptive summary of a value array. */
  function describe(a) {
    const n = a.length;
    if (!n) return { n: 0, mean: NaN, median: NaN, gmean: NaN, sd: NaN, cv: NaN, rcv: NaN, min: NaN, max: NaN, p5: NaN, p95: NaN };
    const s = sortedCopy(a);
    const m = mean(a);
    const d = sd(a, m);
    const med = quantileSorted(s, 0.5);
    // robust CV (FlowJo convention): half the 15.87–84.13 percentile spread over the median
    const rcv = med !== 0 ? 100 * 0.5 * (quantileSorted(s, 0.8413) - quantileSorted(s, 0.1587)) / Math.abs(med) : NaN;
    return {
      n, mean: m, median: med, gmean: gmean(a), sd: d,
      cv: m !== 0 ? 100 * d / Math.abs(m) : NaN, rcv,
      min: s[0], max: s[n - 1], p5: quantileSorted(s, 0.05), p95: quantileSorted(s, 0.95),
    };
  }

  /** Cached per-population, per-parameter summary. `stamp` identifies the population definition. */
  function popStats(sample, stamp, idx, param) {
    sample._stats = sample._stats || new Map();
    const key = stamp + '::' + param;
    const hit = sample._stats.get(key);
    if (hit) return hit;
    const col = sample.data[param];
    const res = col ? describe(gather(col, idx)) : describe([]);
    sample._stats.set(key, res);
    return res;
  }

  /** Summary of a group of per-well values (NaN-safe). */
  function groupSummary(values) {
    const v = values.filter(Number.isFinite);
    const n = v.length;
    const m = mean(v);
    const s = sd(v, m);
    return { n, mean: m, sd: s, sem: n > 1 ? s / Math.sqrt(n) : NaN, cv: m ? 100 * s / Math.abs(m) : NaN, median: n ? median(v) : NaN, values: v };
  }

  FM.stats = { gather, mean, sd, gmean, median, describe, popStats, quantileSorted, groupSummary };
})(FM);
