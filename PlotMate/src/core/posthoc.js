/* Multiple comparisons after ANOVA, and P-value adjustment.
 *
 * Every comparison is "a vs. b" with Mean Diff. = mean(a) − mean(b), as in Prism's table.
 *   pooled-variance families (ordinary / RM / two-way ANOVA): Tukey(–Kramer), Dunnett,
 *     Šidák, Bonferroni, Holm–Šidák (step-down, no CIs), Fisher's LSD (unadjusted)
 *   unequal-variance families (Welch / Brown–Forsythe ANOVA): Games–Howell, Dunnett T3,
 *     Tamhane T2
 *   rank-based: Dunn (after Kruskal–Wallis), Dunn for Friedman
 *   adjust(): Bonferroni, Šidák, Holm, Holm–Šidák, Benjamini–Hochberg, Benjamini–Yekutieli,
 *     two-stage Benjamini–Krieger–Yekutieli (q values)
 */
(function (PM) {
  'use strict';
  const D = () => PM.dist;

  /** All pairs (i < j), each vs control, or the given list. */
  function pairsFor(k, family, control, selected) {
    if (family === 'control') return PM.range(k).filter(i => i !== (control || 0)).map(i => [control || 0, i]);
    if (family === 'selected' && selected && selected.length) return selected.map(p => p.slice());
    const out = [];
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) out.push([i, j]);
    return out;
  }

  function sidakAlpha(alpha, m) { return 1 - Math.pow(1 - alpha, 1 / m); }

  /**
   * Comparisons with a pooled error term. opts: {means, ns, mse, df, pairs, method, alpha,
   * ciLevel, names, k (number of means for Tukey; default means.length), seScale}.
   */
  function compare(opts) {
    const { means, ns, mse, df } = opts;
    const method = opts.method || 'tukey';
    const alpha = opts.alpha != null ? opts.alpha : 0.05;
    const level = opts.ciLevel || (1 - alpha);
    const pairs = opts.pairs || pairsFor(means.length, method === 'dunnett' ? 'control' : 'all', opts.control || 0);
    const m = pairs.length;
    const k = opts.k || means.length;
    const names = opts.names || means.map((_, i) => PM.table.letter(i));
    const rows = pairs.map(([a, b]) => {
      const diff = means[a] - means[b];
      const se = Math.sqrt(mse * (1 / ns[a] + 1 / ns[b])) * (opts.seScale || 1);
      const t = diff / se;
      const p = D().pt2(t, df);
      return { a, b, label: names[a] + ' vs. ' + names[b], diff, se, t, df, p, nA: ns[a], nB: ns[b], meanA: means[a], meanB: means[b] };
    });
    if (method === 'tukey') {
      const qc = opts.noCI ? NaN : D().qtukey(level, k, df);       // opts.noCI: only the P values are wanted, so skip the (slow) critical value
      rows.forEach(r => {
        r.q = Math.abs(r.diff) / (r.se / Math.SQRT2);
        r.padj = Math.min(1, D().ptukeyUpper(r.q, k, df));
        const h = qc * r.se / Math.SQRT2;
        r.ciLo = r.diff - h; r.ciHi = r.diff + h;
        r.stat = r.q; r.statName = 'q';
      });
    } else if (method === 'dunnett') {
      // correlation structure: λ_i = √(n_i/(n_i + n_control)) for each comparison i vs the shared control
      const ctrl = pairs[0][0];
      const lam = pairs.map(([c, i]) => { const j = c === ctrl ? i : c; return Math.sqrt(ns[j] / (ns[j] + ns[ctrl])); });
      const qc = opts.noCI ? NaN : D().qdunnett(level, lam, df);
      rows.forEach(r => {
        r.padj = Math.min(1, Math.max(0, 1 - D().pdunnett(Math.abs(r.t), lam, df)));
        r.ciLo = r.diff - qc * r.se; r.ciHi = r.diff + qc * r.se;
        r.stat = Math.abs(r.t); r.statName = 'q';
      });
    } else if (method === 'sidak' || method === 'bonferroni' || method === 'fisher') {
      const a2 = method === 'sidak' ? sidakAlpha(1 - level, m) : method === 'bonferroni' ? (1 - level) / m : 1 - level;
      const tc = D().qt(1 - a2 / 2, df);
      rows.forEach(r => {
        r.padj = method === 'sidak' ? Math.min(1, 1 - Math.pow(1 - r.p, m)) : method === 'bonferroni' ? Math.min(1, r.p * m) : r.p;
        r.ciLo = r.diff - tc * r.se; r.ciHi = r.diff + tc * r.se;
        r.stat = Math.abs(r.t); r.statName = 't';
      });
    } else if (method === 'holm-sidak' || method === 'holm') {
      const adj = adjust(rows.map(r => r.p), method);
      rows.forEach((r, i) => { r.padj = adj[i]; r.ciLo = NaN; r.ciHi = NaN; r.stat = Math.abs(r.t); r.statName = 't'; });
    } else throw new Error('Unknown multiple-comparison method: ' + method);
    rows.forEach(r => finish(r, alpha, opts.pStyle));
    return rows;
  }
  function finish(r, alpha, style) {
    r.significant = r.padj < alpha;
    r.summary = PM.num.stars(r.padj, style || 'GP');
  }

  /** Rows grouped by family (r.set; one family when unset), in first-seen order. Prism corrects within each family. */
  function families(rows) {
    const by = new Map();
    rows.forEach(r => { const k = r.set == null ? '' : r.set; if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
    return Array.from(by.values());
  }

  /**
   * Adjust a prepared list of comparisons. Each row: {diff, se, df, set?, v0?, vi?} where `set`
   * groups comparisons that share a Tukey / Dunnett family (e.g. one row of a two-way table),
   * and v0 / vi are the relative variances of the control and the other mean (Dunnett).
   * opts: {method, alpha, ciLevel, k (means per Tukey set, number or {set: k}), pStyle}.
   * Every method corrects within each family (rows sharing `set`), as Prism does: "Number of
   * families" in its two-way results.
   */
  function applyMethod(rows, opts) {
    const method = opts.method || 'sidak';
    const alpha = opts.alpha != null ? opts.alpha : 0.05;
    const level = opts.ciLevel || (1 - alpha);
    rows.forEach(r => { r.t = r.diff / r.se; r.p = D().pt2(r.t, r.df); });
    if (method === 'tukey') {
      rows.forEach(r => {
        const k = typeof opts.k === 'object' ? opts.k[r.set] : opts.k;
        r.q = Math.abs(r.diff) / (r.se / Math.SQRT2);
        r.padj = Math.min(1, D().ptukeyUpper(r.q, k, r.df));
        const h = D().qtukey(level, k, r.df) * r.se / Math.SQRT2;
        r.ciLo = r.diff - h; r.ciHi = r.diff + h; r.stat = r.q; r.statName = 'q';
      });
    } else if (method === 'dunnett') {
      const sets = {};
      rows.forEach(r => { (sets[r.set] = sets[r.set] || []).push(r); });
      Object.values(sets).forEach(rs => {
        const lam = rs.map(r => Math.sqrt(r.v0 / (r.v0 + r.vi)));
        const qc = D().qdunnett(level, lam, rs[0].df);
        rs.forEach(r => {
          r.padj = Math.min(1, Math.max(0, 1 - D().pdunnett(Math.abs(r.t), lam, r.df)));
          r.ciLo = r.diff - qc * r.se; r.ciHi = r.diff + qc * r.se; r.stat = Math.abs(r.t); r.statName = 'q';
        });
      });
    } else if (method === 'sidak' || method === 'bonferroni' || method === 'fisher') {
      families(rows).forEach(rs => {
        const m = rs.length;
        const a2 = method === 'sidak' ? sidakAlpha(1 - level, m) : method === 'bonferroni' ? (1 - level) / m : 1 - level;
        rs.forEach(r => {
          r.padj = method === 'sidak' ? Math.min(1, 1 - Math.pow(1 - r.p, m)) : method === 'bonferroni' ? Math.min(1, r.p * m) : r.p;
          const tc = D().qt(1 - a2 / 2, r.df);
          r.ciLo = r.diff - tc * r.se; r.ciHi = r.diff + tc * r.se; r.stat = Math.abs(r.t); r.statName = 't';
        });
      });
    } else if (method === 'holm-sidak' || method === 'holm') {
      families(rows).forEach(rs => {
        const adj = adjust(rs.map(r => r.p), method);
        rs.forEach((r, i) => { r.padj = adj[i]; r.ciLo = NaN; r.ciHi = NaN; r.stat = Math.abs(r.t); r.statName = 't'; });
      });
    } else throw new Error('Unknown multiple-comparison method: ' + method);
    rows.forEach(r => finish(r, alpha, opts.pStyle));
    return rows;
  }

  /** Studentized maximum modulus: P(max_{i≤m} |Z_i| ≤ c·S), independent Z, S = √(χ²_df/df). */
  function psmm(c, m, df) {
    if (!(c > 0)) return 0;
    const inner = s => Math.pow(Math.max(0, 2 * D().pnorm(c * s) - 1), m);
    if (!Number.isFinite(df)) return inner(1);
    const nu = df;
    const logk = Math.LN2 + (nu / 2) * Math.log(nu / 2) - D().lgamma(nu / 2);
    const dens = s => s > 0 ? Math.exp(logk + (nu - 1) * Math.log(s) - nu * s * s / 2) : 0;
    const hi = Math.sqrt(D().qchisq(1 - 1e-13, nu) / nu);
    return D().integrate(s => dens(s) * inner(s), 0, hi, 24);
  }
  function qsmm(p, m, df) {
    let lo = 0, hi = 3;
    while (psmm(hi, m, df) < p && hi < 200) { lo = hi; hi *= 1.6; }
    for (let i = 0; i < 60 && hi - lo > 1e-9 * hi; i++) { const mid = (lo + hi) / 2; if (psmm(mid, m, df) < p) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  /** Comparisons without assuming equal SDs: Games–Howell, Dunnett T3, Tamhane T2. */
  function welchFamily(groups, opts) {
    opts = opts || {};
    const method = opts.method || 'games-howell';
    const alpha = opts.alpha != null ? opts.alpha : 0.05;
    const level = opts.ciLevel || (1 - alpha);
    const st = Array.isArray(groups[0]) ? PM.anova1.stats(groups) : groups.map(s => ({ n: s.n, mean: s.mean, var: s.sd * s.sd }));
    const k = st.length;
    const pairs = opts.pairs || pairsFor(k, opts.family || 'all', opts.control || 0, opts.selected);
    const m = pairs.length;
    const names = opts.names || st.map((_, i) => PM.table.letter(i));
    const rows = pairs.map(([a, b]) => {
      const A = st[a], B = st[b];
      const va = A.var / A.n, vb = B.var / B.n;
      const se = Math.sqrt(va + vb);
      const df = (va + vb) * (va + vb) / (va * va / (A.n - 1) + vb * vb / (B.n - 1));
      const diff = A.mean - B.mean;
      const t = diff / se;
      const r = { a, b, label: names[a] + ' vs. ' + names[b], diff, se, t, df, p: D().pt2(t, df), meanA: A.mean, meanB: B.mean, nA: A.n, nB: B.n };
      if (method === 'games-howell') {
        r.q = Math.abs(t) * Math.SQRT2;
        r.padj = Math.min(1, D().ptukeyUpper(r.q, k, df));
        const h = D().qtukey(level, k, df) / Math.SQRT2 * se;
        r.ciLo = diff - h; r.ciHi = diff + h; r.stat = r.q; r.statName = 'q';
      } else if (method === 'dunnett-t3') {
        // Prism looks the studentized maximum modulus up at the Welch df rounded to an integer
        const dfi = opts.exactDf ? df : Math.max(1, Math.round(df));
        r.padj = Math.min(1, Math.max(0, 1 - psmm(Math.abs(t), m, dfi)));
        const h = qsmm(level, m, dfi) * se;
        r.ciLo = diff - h; r.ciHi = diff + h; r.stat = Math.abs(t); r.statName = 't';
      } else if (method === 'tamhane-t2') {
        r.padj = Math.min(1, 1 - Math.pow(1 - r.p, m));
        const h = D().qt(1 - sidakAlpha(1 - level, m) / 2, df) * se;
        r.ciLo = diff - h; r.ciHi = diff + h; r.stat = Math.abs(t); r.statName = 't';
      } else throw new Error('Unknown method ' + method);
      finish(r, alpha, opts.pStyle);
      return r;
    });
    return rows;
  }

  /** Dunn's test after Kruskal–Wallis (z on mean ranks, tie-corrected); padj = Bonferroni unless correct = false. */
  function dunn(groups, opts) {
    opts = opts || {};
    const alpha = opts.alpha != null ? opts.alpha : 0.05;
    const kw = PM.anova1.kruskal(groups);
    const N = kw.N, k = groups.length;
    const pairs = opts.pairs || pairsFor(k, opts.family || 'all', opts.control || 0, opts.selected);
    const m = pairs.length;
    const names = opts.names || PM.range(k).map(i => PM.table.letter(i));
    const v = N * (N + 1) / 12 - kw.tieSum / (12 * (N - 1));
    return pairs.map(([a, b]) => {
      const diff = kw.meanRanks[a] - kw.meanRanks[b];
      const se = Math.sqrt(v * (1 / kw.ns[a] + 1 / kw.ns[b]));
      const z = diff / se;
      const p = 2 * D().pnorm(-Math.abs(z));
      const r = { a, b, label: names[a] + ' vs. ' + names[b], diff, meanRankA: kw.meanRanks[a], meanRankB: kw.meanRanks[b], nA: kw.ns[a], nB: kw.ns[b], z, stat: Math.abs(z), statName: 'Z', p,
        padj: opts.correct === false ? p : Math.min(1, p * m), ciLo: NaN, ciHi: NaN };
      finish(r, alpha, opts.pStyle);
      return r;
    });
  }
  /** Dunn's test after Friedman, on rank sums as Prism reports it: z = ΔR / √(n·k(k+1)/6). */
  function dunnFriedman(matrix, opts) {
    opts = opts || {};
    const alpha = opts.alpha != null ? opts.alpha : 0.05;
    const fr = PM.anova1.friedman(matrix);
    const n = fr.n, k = fr.k;
    const pairs = opts.pairs || pairsFor(k, opts.family || 'all', opts.control || 0, opts.selected);
    const m = pairs.length;
    const names = opts.names || PM.range(k).map(i => PM.table.letter(i));
    const se = Math.sqrt(k * (k + 1) / (6 * n));
    return pairs.map(([a, b]) => {
      const z = (fr.meanRanks[a] - fr.meanRanks[b]) / se;
      const p = 2 * D().pnorm(-Math.abs(z));
      const diff = fr.rankSums[a] - fr.rankSums[b];
      const r = { a, b, label: names[a] + ' vs. ' + names[b], diff, rankSumA: fr.rankSums[a], rankSumB: fr.rankSums[b], meanRankDiff: fr.meanRanks[a] - fr.meanRanks[b], nA: n, nB: n, z, stat: Math.abs(z), statName: 'Z', p,
        padj: opts.correct === false ? p : Math.min(1, p * m), ciLo: NaN, ciHi: NaN };
      finish(r, alpha, opts.pStyle);
      return r;
    });
  }

  /**
   * Adjust a list of P values (returned in the input order).
   * bky returns q values: the smallest Q at which the two-stage BKY procedure rejects each test.
   */
  function adjust(ps, method) {
    const m = ps.length;
    const order = PM.range(m).sort((i, j) => ps[i] - ps[j]);
    const out = new Array(m);
    const cap = v => Math.min(1, Math.max(0, v));
    switch (method) {
      case 'none': return ps.slice();
      case 'bonferroni': return ps.map(p => cap(p * m));
      case 'sidak': return ps.map(p => cap(1 - Math.pow(1 - p, m)));
      case 'holm': case 'holm-sidak': {
        let run = 0;
        order.forEach((i, r) => {
          const k = m - r;
          const v = method === 'holm' ? k * ps[i] : 1 - Math.pow(1 - ps[i], k);
          run = Math.max(run, cap(v));
          out[i] = run;
        });
        return out;
      }
      case 'bh': case 'by': {
        const c = method === 'by' ? PM.range(m).reduce((s, i) => s + 1 / (i + 1), 0) : 1;
        let run = 1;
        for (let r = m - 1; r >= 0; r--) {
          const i = order[r];
          run = Math.min(run, cap(ps[i] * m * c / (r + 1)));
          out[i] = run;
        }
        return out;
      }
      case 'bky': {
        // q value = smallest Q for which the test is a discovery; found by bisection on Q
        return ps.map((p, i) => {
          if (!bkyReject(ps, 1)[i]) return 1;
          let lo = 0, hi = 1;
          for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2; if (bkyReject(ps, mid)[i]) hi = mid; else lo = mid; }
          return hi;
        });
      }
      default: throw new Error('Unknown adjustment ' + method);
    }
  }
  /** Two-stage linear step-up (Benjamini, Krieger & Yekutieli 2006) decisions at FDR Q. */
  function bkyReject(ps, Q) {
    const m = ps.length;
    const q1 = Q / (1 + Q);
    const bhReject = (q) => {
      const order = PM.range(m).sort((i, j) => ps[i] - ps[j]);
      let kmax = -1;
      order.forEach((i, r) => { if (ps[i] <= (r + 1) * q / m) kmax = r; });
      const rej = new Array(m).fill(false);
      for (let r = 0; r <= kmax; r++) rej[order[r]] = true;
      return rej;
    };
    const r1 = bhReject(q1);
    const R1 = r1.filter(Boolean).length;
    if (R1 === 0) return r1;
    if (R1 === m) return r1;
    const m0 = m - R1;
    const q2 = q1 * m / m0;
    return bhReject(q2);
  }


  /**
   * Repeated measures with the Geisser-Greenhouse correction: each comparison uses the variance of
   * its own paired differences (Prism: "with individual variances computed for each comparison"),
   * df = n − 1. M: subjects × treatments (complete rows). opts: {pairs, method, alpha, ciLevel, names}.
   */
  function pairedFamily(M, opts) {
    opts = opts || {};
    const method = opts.method || 'tukey';
    const alpha = opts.alpha != null ? opts.alpha : 0.05;
    const level = opts.ciLevel || (1 - alpha);
    const k = M[0].length, n = M.length, df = n - 1;
    const pairs = opts.pairs || pairsFor(k, method === 'dunnett' ? 'control' : 'all', opts.control || 0);
    const m = pairs.length;
    const names = opts.names || PM.range(k).map(i => PM.table.letter(i));
    const means = PM.range(k).map(j => PM.mean(M.map(r => r[j])));
    const rows = pairs.map(([a, b]) => {
      const d = M.map(r => r[a] - r[b]);
      const md = PM.mean(d);
      let ss = 0; d.forEach(x => { ss += (x - md) * (x - md); });
      const se = Math.sqrt(ss / (n - 1)) / Math.sqrt(n);
      const t = md / se;
      return { a, b, label: names[a] + ' vs. ' + names[b], diff: md, se, t, df, p: D().pt2(t, df), meanA: means[a], meanB: means[b], nA: n, nB: n };
    });
    let qtc = null, qdc = null;      // one critical value for the whole family, not one per row
    rows.forEach(r => {
      if (method === 'tukey') {
        r.q = Math.abs(r.t) * Math.SQRT2;
        r.padj = Math.min(1, D().ptukeyUpper(r.q, k, df));
        if (qtc == null) qtc = opts.noCI ? NaN : D().qtukey(level, k, df);
        const h = qtc / Math.SQRT2 * r.se;
        r.ciLo = r.diff - h; r.ciHi = r.diff + h; r.stat = r.q; r.statName = 'q';
      } else if (method === 'dunnett') {
        const lam = pairs.map(() => Math.SQRT1_2);
        r.padj = Math.min(1, Math.max(0, 1 - D().pdunnett(Math.abs(r.t), lam, df)));
        if (qdc == null) qdc = opts.noCI ? NaN : D().qdunnett(level, lam, df);
        const h = qdc * r.se;
        r.ciLo = r.diff - h; r.ciHi = r.diff + h; r.stat = Math.abs(r.t); r.statName = 'q';
      } else {
        const a2 = method === 'sidak' ? sidakAlpha(1 - level, m) : method === 'bonferroni' ? (1 - level) / m : 1 - level;
        r.padj = method === 'sidak' ? Math.min(1, 1 - Math.pow(1 - r.p, m)) : method === 'bonferroni' ? Math.min(1, r.p * m) : r.p;
        const h = D().qt(1 - a2 / 2, df) * r.se;
        r.ciLo = r.diff - h; r.ciHi = r.diff + h; r.stat = Math.abs(r.t); r.statName = 't';
      }
      finish(r, alpha, opts.pStyle);
    });
    return rows;
  }

  /**
   * Compact letter display (Piepho 2004, insert-absorb): groups that share a letter do not differ.
   * order: group indices from the largest mean (or mean rank) down; rows: comparisons with a, b,
   * significant. → {group index: 'A B'}. Letters are given in the order groups appear.
   */
  function cld(order, rows) {
    let cols = [new Set(order)];
    rows.filter(r => r.significant).forEach(r => {
      const next = [];
      cols.forEach(c => {
        if (c.has(r.a) && c.has(r.b)) {
          const x = new Set(c); x.delete(r.a);
          const y = new Set(c); y.delete(r.b);
          next.push(x, y);
        } else next.push(c);
      });
      // absorb: drop columns contained in another
      cols = next.filter((c, i) => !next.some((o, j) => j !== i && o.size >= c.size && [...c].every(v => o.has(v)) && (o.size > c.size || j < i)));
    });
    const letterOf = new Map();
    let next = 0;
    order.forEach(g => cols.forEach(c => { if (c.has(g) && !letterOf.has(c)) letterOf.set(c, String.fromCharCode(65 + next++)); }));
    const out = {};
    order.forEach(g => { out[g] = cols.filter(c => c.has(g)).map(c => letterOf.get(c)).sort().join(' '); });
    return out;
  }

  PM.posthoc = { pairsFor, compare, applyMethod, welchFamily, pairedFamily, cld, dunn, dunnFriedman, adjust, bkyReject, psmm, qsmm };
})(PM);
