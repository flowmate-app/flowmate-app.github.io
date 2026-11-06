/* Distributions and hypothesis tests: one-way ANOVA, Tukey HSD (Tukey–Kramer),
 * Welch t-test, Pearson / Spearman correlation.
 *
 * ptukey is a port of R's nmath/ptukey.c (Copenhaver & Holland 1988, AS 190).
 */
(function (FM) {
  'use strict';

  // ------------------------------------------------------------ special fns
  const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

  function lgamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
    x -= 1;
    let a = LANCZOS[0];
    const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  /** Continued fraction for the incomplete beta (Numerical Recipes betacf, modified Lentz). */
  function betacf(a, b, x) {
    const MAXIT = 300, EPS = 3e-16, FPMIN = 1e-300;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  /** Regularized incomplete beta I_x(a, b). */
  function ibeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }

  /** Upper tail P(F > f) for F(d1, d2). */
  function pFupper(f, d1, d2) {
    if (!(f > 0)) return 1;
    return ibeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);
  }

  /** Two-sided p-value for Student's t with df degrees of freedom. */
  function pT2(t, df) {
    if (!Number.isFinite(t)) return NaN;
    return ibeta(df / (df + t * t), df / 2, 0.5);
  }

  /** Complementary error function.
   *  |x| < 2.5: Maclaurin series for erf.  |x| ≥ 2.5: Laplace continued fraction (modified Lentz).
   *  Derived directly rather than from fitted constants; accurate to ~1e-13 relative. */
  function erfc(x) {
    const z = Math.abs(x);
    let r;
    if (z < 2.5) {
      let term = z, sum = z;
      const z2 = z * z;
      for (let n = 1; n < 200; n++) {
        term *= -z2 / n;
        const add = term / (2 * n + 1);
        sum += add;
        if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
      }
      r = 1 - 2 / Math.sqrt(Math.PI) * sum;
    } else {
      // erfc(z) = exp(-z²)/√π · 1/(z + (1/2)/(z + 1/(z + (3/2)/(z + 2/(z + ...)))))
      const TINY = 1e-300;
      let f = z, C = z, D = 0;
      for (let n = 1; n < 500; n++) {
        const a = n / 2;
        D = z + a * D; if (Math.abs(D) < TINY) D = TINY;
        C = z + a / C; if (Math.abs(C) < TINY) C = TINY;
        D = 1 / D;
        const delta = C * D;
        f *= delta;
        if (Math.abs(delta - 1) < 1e-16) break;
      }
      r = Math.exp(-z * z) / Math.sqrt(Math.PI) / f;
    }
    return x >= 0 ? r : 2 - r;
  }
  function pnorm(x, mu, sigma) { return 0.5 * erfc(-(x - (mu || 0)) / ((sigma || 1) * Math.SQRT2)); }

  // ------------------------------------------------------ studentized range
  function wprob(w, rr, cc) {
    const nleg = 12, ihalf = 6;
    const C1 = -30, C2 = -50, C3 = 60, bb = 8, wlar = 3, wincr1 = 2, wincr2 = 3;
    const xleg = [0.981560634246719250690549090149, 0.904117256370474856678465866119,
      0.769902674194304687036893833213, 0.587317954286617447296702418941,
      0.367831498998180193752691536644, 0.125233408511468915472441369464];
    const aleg = [0.047175336386511827194615961485, 0.106939325995318430960254718194,
      0.160078328543346226334652529543, 0.203167426723065921749064455810,
      0.233492536538354808760849898925, 0.249147045813402785000562436043];
    const qsqz = w * 0.5;
    if (qsqz >= bb) return 1.0;

    let pr_w = 2 * pnorm(qsqz, 0, 1) - 1;
    if (pr_w >= Math.exp(C2 / cc)) pr_w = Math.pow(pr_w, cc); else pr_w = 0;

    const wincr = w > wlar ? wincr1 : wincr2;
    let blb = qsqz;
    const binc = (bb - qsqz) / wincr;
    let bub = blb + binc;
    let einsum = 0;
    const cc1 = cc - 1;
    for (let wi = 1; wi <= wincr; wi++) {
      let elsum = 0;
      const a = 0.5 * (bub + blb);
      const b = 0.5 * (bub - blb);
      for (let jj = 1; jj <= nleg; jj++) {
        let j, xx;
        if (ihalf < jj) { j = (nleg - jj) + 1; xx = xleg[j - 1]; }
        else { j = jj; xx = -xleg[j - 1]; }
        const c = b * xx;
        const ac = a + c;
        const qexpo = ac * ac;
        if (qexpo > C3) break;
        const pplus = 2 * pnorm(ac, 0, 1);
        const pminus = 2 * pnorm(ac, w, 1);
        let rinsum = (pplus * 0.5) - (pminus * 0.5);
        if (rinsum >= Math.exp(C1 / cc1)) {
          rinsum = (aleg[j - 1] * Math.exp(-(0.5 * qexpo))) * Math.pow(rinsum, cc1);
          elsum += rinsum;
        }
      }
      elsum *= (((2 * b) * cc) / Math.sqrt(2 * Math.PI));
      einsum += elsum;
      blb = bub;
      bub += binc;
    }
    pr_w += einsum;
    if (pr_w <= Math.exp(C1 / rr)) return 0;
    pr_w = Math.pow(pr_w, rr);
    return pr_w >= 1 ? 1 : pr_w;
  }

  /** P(Q ≤ q) for the studentized range with cc groups and df error degrees of freedom. */
  function ptukey(q, cc, df, rr) {
    rr = rr || 1;
    const nlegq = 16, ihalfq = 8;
    const eps1 = -30, eps2 = 1e-14, dhaf = 100, dquar = 800, deigh = 5000, dlarg = 25000;
    const ulen1 = 1, ulen2 = 0.5, ulen3 = 0.25, ulen4 = 0.125;
    const xlegq = [0.989400934991649932596154173450, 0.944575023073232576077988415535,
      0.865631202387831743880467897712, 0.755404408355003033895101194847,
      0.617876244402643748446671764049, 0.458016777657227386342419442984,
      0.281603550779258913230460501460, 0.950125098376374401853193354250e-1];
    const alegq = [0.271524594117540948517805724560e-1, 0.622535239386478928628438369944e-1,
      0.951585116824927848099251076022e-1, 0.124628971255533872052476282192,
      0.149595988816576732081501730547, 0.169156519395002538189312079030,
      0.182603415044923588866763667969, 0.189450610455068496285396723208];

    if (!(q > 0)) return 0;
    if (df < 2 || rr < 1 || cc < 2) return NaN;
    if (!Number.isFinite(q)) return 1;
    if (df > dlarg) return wprob(q, rr, cc);

    const f2 = df * 0.5;
    let f2lf = ((f2 * Math.log(df)) - (df * Math.LN2)) - lgamma(f2);
    const f21 = f2 - 1;
    const ff4 = df * 0.25;
    let ulen;
    if (df <= dhaf) ulen = ulen1;
    else if (df <= dquar) ulen = ulen2;
    else if (df <= deigh) ulen = ulen3;
    else ulen = ulen4;
    f2lf += Math.log(ulen);

    let ans = 0, otsum = 0;
    for (let i = 1; i <= 50; i++) {
      otsum = 0;
      const twa1 = (2 * i - 1) * ulen;
      for (let jj = 1; jj <= nlegq; jj++) {
        let j, t1;
        if (ihalfq < jj) {
          j = jj - ihalfq - 1;
          t1 = (f2lf + (f21 * Math.log(twa1 + (xlegq[j] * ulen)))) - (((xlegq[j] * ulen) + twa1) * ff4);
        } else {
          j = jj - 1;
          t1 = (f2lf + (f21 * Math.log(twa1 - (xlegq[j] * ulen)))) + (((xlegq[j] * ulen) - twa1) * ff4);
        }
        if (t1 >= eps1) {
          let qsqz;
          if (ihalfq < jj) qsqz = q * Math.sqrt(((xlegq[j] * ulen) + twa1) * 0.5);
          else qsqz = q * Math.sqrt(((-(xlegq[j] * ulen)) + twa1) * 0.5);
          const wprb = wprob(qsqz, rr, cc);
          otsum += (wprb * alegq[j]) * Math.exp(t1);
        }
      }
      if (i * ulen >= 1.0 && otsum <= eps2) break;
      ans += otsum;
    }
    return ans > 1 ? 1 : ans;
  }

  /** Quantile of the studentized range: the q with P(Q ≤ q) = p, by bisection on ptukey. */
  function qtukey(p, cc, df) {
    if (!(p > 0 && p < 1) || !(cc >= 2) || !(df >= 2)) return NaN;
    let lo = 0, hi = 2;
    while (ptukey(hi, cc, df) < p && hi < 1e4) { lo = hi; hi *= 2; }
    for (let i = 0; i < 80 && hi - lo > 1e-9 * hi; i++) {
      const mid = (lo + hi) / 2;
      if (ptukey(mid, cc, df) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ------------------------------------------------------------------ tests
  /** One-way ANOVA. groups: array of number arrays. */
  function anova(groups) {
    const gs = groups.map(g => g.filter(Number.isFinite)).filter(g => g.length > 0);
    const k = gs.length;
    const N = gs.reduce((a, g) => a + g.length, 0);
    if (k < 2 || N - k < 1) return { F: NaN, df1: k - 1, df2: N - k, p: NaN, mse: NaN };
    const grand = gs.reduce((a, g) => a + g.reduce((s, v) => s + v, 0), 0) / N;
    let ssb = 0, ssw = 0;
    gs.forEach(g => {
      const m = g.reduce((s, v) => s + v, 0) / g.length;
      ssb += g.length * (m - grand) * (m - grand);
      g.forEach(v => { ssw += (v - m) * (v - m); });
    });
    const df1 = k - 1, df2 = N - k;
    const msb = ssb / df1, mse = ssw / df2;
    const F = msb / mse;
    return { F, df1, df2, p: pFupper(F, df1, df2), mse, ssb, ssw };
  }

  /** Tukey HSD (Tukey–Kramer for unequal n). Returns all pairwise comparisons. */
  function tukey(groups, names, alpha) {
    const gs = groups.map(g => g.filter(Number.isFinite));
    const keep = gs.map((g, i) => i).filter(i => gs[i].length > 0);
    const a = anova(keep.map(i => gs[i]));
    const k = keep.length;
    const out = [];
    // one critical value serves every pair: it depends only on the number of groups and the error df
    const qcrit = k >= 2 && a.df2 >= 2 ? qtukey(1 - (alpha || 0.05), k, a.df2) : NaN;
    for (let ii = 0; ii < k; ii++) {
      for (let jj = ii + 1; jj < k; jj++) {
        const gi = gs[keep[ii]], gj = gs[keep[jj]];
        const mi = gi.reduce((s, v) => s + v, 0) / gi.length;
        const mj = gj.reduce((s, v) => s + v, 0) / gj.length;
        const se = Math.sqrt(a.mse / 2 * (1 / gi.length + 1 / gj.length));
        const q = Math.abs(mj - mi) / se;
        const p = Math.max(0, Math.min(1, 1 - ptukey(q, k, a.df2)));
        // the (1 − alpha) simultaneous confidence interval of the difference, as Prism and statsmodels report it
        out.push({ a: names[keep[ii]], b: names[keep[jj]], meanA: mi, meanB: mj, diff: mj - mi, q, p,
          lo: mj - mi - qcrit * se, hi: mj - mi + qcrit * se, nA: gi.length, nB: gj.length });
      }
    }
    return { anova: a, pairs: out, qcrit, alpha: alpha || 0.05 };
  }

  function welch(a, b) {
    a = a.filter(Number.isFinite); b = b.filter(Number.isFinite);
    const na = a.length, nb = b.length;
    if (na < 2 || nb < 2) return { t: NaN, df: NaN, p: NaN };
    const ma = FM.stats.mean(a), mb = FM.stats.mean(b);
    const va = Math.pow(FM.stats.sd(a, ma), 2), vb = Math.pow(FM.stats.sd(b, mb), 2);
    const se2 = va / na + vb / nb;
    const t = (ma - mb) / Math.sqrt(se2);
    const df = se2 * se2 / ((va / na) * (va / na) / (na - 1) + (vb / nb) * (vb / nb) / (nb - 1));
    return { t, df, p: pT2(t, df) };
  }

  function pearson(x, y) {
    const pts = [];
    for (let i = 0; i < x.length; i++) if (Number.isFinite(x[i]) && Number.isFinite(y[i])) pts.push([x[i], y[i]]);
    const n = pts.length;
    if (n < 3) return { r: NaN, p: NaN, n, slope: NaN, intercept: NaN };
    const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
    let sxx = 0, syy = 0, sxy = 0;
    pts.forEach(([a, b]) => { sxx += (a - mx) * (a - mx); syy += (b - my) * (b - my); sxy += (a - mx) * (b - my); });
    const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
    const t = r * Math.sqrt((n - 2) / Math.max(1e-300, 1 - r * r));
    const slope = sxx ? sxy / sxx : NaN;
    return { r, p: Math.abs(r) >= 1 ? 0 : pT2(t, n - 2), n, slope, intercept: my - slope * mx };
  }

  function ranks(v) {
    const idx = v.map((x, i) => i).sort((a, b) => v[a] - v[b]);
    const r = new Array(v.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && v[idx[j + 1]] === v[idx[i]]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k]] = avg;
      i = j + 1;
    }
    return r;
  }

  function spearman(x, y) {
    const pts = [];
    for (let i = 0; i < x.length; i++) if (Number.isFinite(x[i]) && Number.isFinite(y[i])) pts.push([x[i], y[i]]);
    const res = pearson(ranks(pts.map(p => p[0])), ranks(pts.map(p => p[1])));
    return { rho: res.r, p: res.p, n: res.n };
  }

  FM.inference = { lgamma, ibeta, pFupper, pT2, pnorm, erfc, ptukey, qtukey, anova, tukey, welch, pearson, spearman };
})(FM);
