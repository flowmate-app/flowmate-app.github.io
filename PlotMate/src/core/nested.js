/* Nested designs (Prism's Nested table): replicates nested in subjects nested in groups.
 *
 * One-random-factor linear mixed model fitted by REML (as nlme::lme(y ~ group, random = ~1|subject)):
 *   y = μ_group + u_subject + ε,   u ~ N(0, σ²_subject),   ε ~ N(0, σ²)
 * The variance ratio γ = σ²_subject/σ² is found by maximising the restricted likelihood (golden
 * section on log γ, plus the γ = 0 boundary); fixed effects by GLS. Group differences are tested
 * with denominator df = subjects − groups (nlme's between-subject df). "Does nesting matter?" is
 * the REML likelihood-ratio test of the subject variance (as anova(gls, lme)).
 */
(function (PM) {
  'use strict';
  const D = () => PM.dist;

  /** groups[g][s] = values. Returns the REML fit and tests. */
  function fit(groups, opts) {
    opts = opts || {};
    const level = opts.ciLevel || 0.95;
    const G = groups.length;
    const clusters = [];
    groups.forEach((g, gi) => g.forEach(vals => { const v = vals.filter(Number.isFinite); if (v.length) clusters.push({ g: gi, y: v }); }));
    const S = clusters.length, N = clusters.reduce((s, c) => s + c.y.length, 0);
    if (S <= G) return { error: 'Each group needs at least one subject, and there must be more subjects than groups.' };
    const p = G;
    const reml = (gamma) => {
      // XᵀV⁻¹X and XᵀV⁻¹y with V = σ²(I + γJ) per cluster; X = group indicators
      const XtX = PM.range(p).map(() => new Array(p).fill(0)), Xty = new Array(p).fill(0);
      let logdet = 0;
      clusters.forEach(c => {
        const n = c.y.length, sum = PM.sum(c.y);
        const k = gamma / (1 + gamma * n);
        // V⁻¹ = I − kJ ; for an indicator column: 1ᵀV⁻¹1 = n − k n², 1ᵀV⁻¹y = sum − k n sum
        XtX[c.g][c.g] += n - k * n * n;
        Xty[c.g] += sum - k * n * sum;
        logdet += Math.log(1 + gamma * n);
      });
      const beta = Xty.map((v, g) => v / XtX[g][g]);
      let Q = 0;
      clusters.forEach(c => {
        const n = c.y.length, k = gamma / (1 + gamma * n);
        const r = c.y.map(v => v - beta[c.g]);
        const rs = PM.sum(r);
        Q += r.reduce((s, v) => s + v * v, 0) - k * rs * rs;
      });
      const s2 = Q / (N - p);
      const ldX = XtX.reduce((s, row, g) => s + Math.log(row[g]), 0);
      const ll = -0.5 * ((N - p) * Math.log(s2) + logdet + ldX + (N - p) * (1 + Math.log(2 * Math.PI)));
      return { ll, beta, s2, XtX };
    };
    // maximise over log γ, then compare with the boundary γ = 0
    let a = -20, b = 12;
    const f = (lg) => -reml(Math.exp(lg)).ll;
    const gr = (Math.sqrt(5) - 1) / 2;
    let x1 = b - gr * (b - a), x2 = a + gr * (b - a), f1 = f(x1), f2 = f(x2);
    for (let i = 0; i < 200 && b - a > 1e-12; i++) {
      if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = b - gr * (b - a); f1 = f(x1); }
      else { a = x1; x1 = x2; f1 = f2; x2 = a + gr * (b - a); f2 = f(x2); }
    }
    let gamma = Math.exp((a + b) / 2);
    const r0 = reml(0);
    let best = reml(gamma);
    if (r0.ll >= best.ll) { gamma = 0; best = r0; }
    const sigma2 = best.s2, tau2 = gamma * sigma2;
    const cov = best.XtX.map((row, g) => row.map((v, h) => g === h ? sigma2 / v : 0));
    const ddf = S - G;
    const groupMeans = best.beta;
    const se = groupMeans.map((_, g) => Math.sqrt(cov[g][g]));
    const tq = D().qt(1 - (1 - level) / 2, ddf);
    // overall F for equal group means: contrasts g vs first
    let F = NaN, pF = NaN;
    if (G >= 2) {
      const L = PM.range(G - 1).map(i => PM.range(G).map(g => g === 0 ? -1 : g === i + 1 ? 1 : 0));
      const Lb = L.map(r => r.reduce((s, v, g) => s + v * groupMeans[g], 0));
      const LCL = L.map(r1 => L.map(r2 => r1.reduce((s, v, g) => s + v * r2[g] * cov[g][g], 0)));
      const inv = PM.linalg.inverse(LCL);
      let q = 0; Lb.forEach((u, i) => Lb.forEach((w, j) => { q += u * inv[i][j] * w; }));
      F = q / (G - 1); pF = D().pfUpper(F, G - 1, ddf);
    }
    const lrt = 2 * (best.ll - r0.ll);
    const out = {
      G, subjects: S, N, groupMeans, groupSE: se, groupCI: groupMeans.map((m, g) => [m - tq * se[g], m + tq * se[g]]),
      sigma2Subject: tau2, sigma2Residual: sigma2, pctSubject: 100 * tau2 / (tau2 + sigma2), pctResidual: 100 * sigma2 / (tau2 + sigma2),
      F, dfn: G - 1, dfd: ddf, p: pF, logLik: best.ll, logLik0: r0.ll,
      nesting: { chi2: Math.max(0, lrt), df: 1, p: D().pchisqUpper(Math.max(0, lrt), 1) }, cov, ciLevel: level,
    };
    if (G === 2) {
      const diff = groupMeans[1] - groupMeans[0];
      const sed = Math.sqrt(cov[0][0] + cov[1][1]);
      out.t = { diff, se: sed, t: diff / sed, df: ddf, p: D().pt2(diff / sed, ddf), ciLo: diff - tq * sed, ciHi: diff + tq * sed };
    }
    return out;
  }

  /** Multiple comparisons between group means of a nested fit. */
  function compare(res, opts) {
    opts = opts || {};
    const names = opts.names || PM.range(res.G).map(g => PM.table.letter(g));
    const pairs = PM.posthoc.pairsFor(res.G, opts.compare === 'control' ? 'control' : 'all', opts.control || 0);
    const rows = pairs.map(([a, b]) => ({ a, b, label: names[a] + ' vs. ' + names[b], diff: res.groupMeans[a] - res.groupMeans[b],
      se: Math.sqrt(res.cov[a][a] + res.cov[b][b]), df: res.dfd, set: 'all', v0: res.cov[a][a], vi: res.cov[b][b] }));
    return PM.posthoc.applyMethod(rows, { method: opts.method || 'tukey', alpha: opts.alpha, ciLevel: opts.ciLevel, k: res.G, pStyle: opts.pStyle });
  }

  PM.nested = { fit, compare };
})(PM);
