/* Probability distributions and special functions.
 *
 * Everything here is checked against R (tests/reference/gen_r.R) or SciPy (gen_py.py):
 * normal, t, F, χ² (CDFs, upper tails, quantiles), the studentized range (ptukey / qtukey,
 * ported from R's nmath/ptukey.c, Copenhaver & Holland 1988), Dunnett's two-sided
 * multivariate t, exact Wilcoxon signed-rank and rank-sum distributions, exact two-sample
 * Kolmogorov–Smirnov (ties allowed), binomial and hypergeometric.
 *
 * Conventions: p*(x) are lower-tail CDFs; *Upper(x) are upper tails computed without
 * cancellation; q*(p) are lower-tail quantiles.
 */
(function (PM) {
  'use strict';

  const LN_SQRT_2PI = 0.918938533204672741780329736406;
  const SQRT2 = Math.SQRT2;
  const FPMIN = 1e-300;

  // ------------------------------------------------------------ gamma & beta
  const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

  /** log Γ(x) for x > 0 (reflection for x < 0.5). Lanczos g = 7, ~1e-15 relative. */
  function lgamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
    if (x === 1 || x === 2) return 0;
    x -= 1;
    let a = LANCZOS[0];
    const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  function lbeta(a, b) { return lgamma(a) + lgamma(b) - lgamma(a + b); }
  /** log of the binomial coefficient C(n, k). */
  function lchoose(n, k) { return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1); }

  /** Continued fraction for the incomplete beta (modified Lentz). */
  function betacf(a, b, x) {
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 1000; m++) {
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
      if (Math.abs(del - 1) < 1e-16) break;
    }
    return h;
  }

  /** Regularised incomplete beta I_x(a, b). */
  function ibeta(x, a, b) {
    if (!(x > 0)) return 0;
    if (!(x < 1)) return 1;
    const lbt = a * Math.log(x) + b * Math.log1p(-x) - lbeta(a, b);
    if (x < (a + 1) / (a + b + 2)) return Math.exp(lbt) * betacf(a, b, x) / a;
    return 1 - Math.exp(lbt) * betacf(b, a, 1 - x) / b;
  }
  /** 1 − I_x(a, b) without cancellation. */
  function ibetaUpper(x, a, b) { return ibeta(1 - x, b, a); }

  /** Regularised lower incomplete gamma P(a, x) and upper Q(a, x). */
  function gser(a, x) {
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 10000; n++) {
      ap += 1; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-17) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  function gcf(a, x) {
    let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (let i = 1; i < 10000; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-16) break;
    }
    return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
  }
  function gammp(a, x) { if (!(x > 0)) return 0; if (!Number.isFinite(x)) return 1; return x < a + 1 ? gser(a, x) : 1 - gcf(a, x); }
  function gammq(a, x) { if (!(x > 0)) return 1; if (!Number.isFinite(x)) return 0; return x < a + 1 ? 1 - gser(a, x) : gcf(a, x); }

  // ------------------------------------------------------------------ normal
  /** erfc(x) for x ≥ 0: series for erf below 1.5, Laplace continued fraction above. Also returns log. */
  function logErfcPos(x) {
    if (x < 1.5) {
      // erf(x) = 2/√π · e^{−x²} · Σ 2ⁿ x^{2n+1} / (1·3·…·(2n+1))   (all terms positive)
      let term = x, sum = x;
      const x2 = 2 * x * x;
      for (let n = 1; n < 300; n++) {
        term *= x2 / (2 * n + 1);
        sum += term;
        if (term < 1e-17 * sum) break;
      }
      const erf = 2 / Math.sqrt(Math.PI) * Math.exp(-x * x) * sum;
      return Math.log(1 - erf);
    }
    // erfc(x) = e^{−x²}/√π · 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + …))))
    let f = x, C = x, D = 0;
    for (let n = 1; n < 5000; n++) {
      const a = n / 2;
      D = x + a * D; if (Math.abs(D) < FPMIN) D = FPMIN;
      C = x + a / C; if (Math.abs(C) < FPMIN) C = FPMIN;
      D = 1 / D;
      const delta = C * D;
      f *= delta;
      if (Math.abs(delta - 1) < 1e-16) break;
    }
    return -x * x - 0.5 * Math.log(Math.PI) - Math.log(f);
  }
  /** log Φ(z), accurate in the lower tail. */
  function logPnorm(z) {
    if (z < 0) return Math.log(0.5) + logErfcPos(-z / SQRT2);
    return Math.log1p(-0.5 * Math.exp(logErfcPos(z / SQRT2)));
  }
  // The series (all terms positive, so no cancellation inside it) takes ~45 terms at x = 2.5; the continued fraction needs hundreds there.
  // 1 − erf loses digits as erfc shrinks: at x = 2.5 (erfc ≈ 4·10⁻⁴) the relative error is still ~10⁻¹³, far below what any P value needs.
  const ERFC_SERIES_MAX = 2.5;
  /** erfc(x) for x ≥ 0, the same series and continued fraction as logErfcPos without the log/exp round trip (pnorm is the hot spot of ptukey and pdunnett). */
  function erfcPos(x) {
    if (x < ERFC_SERIES_MAX) {
      let term = x, sum = x;
      const x2 = 2 * x * x;
      for (let n = 1; n < 300; n++) {
        term *= x2 / (2 * n + 1);
        sum += term;
        if (term < 1e-17 * sum) break;
      }
      return 1 - 2 / Math.sqrt(Math.PI) * Math.exp(-x * x) * sum;
    }
    let f = x, C = x, D = 0;
    for (let n = 1; n < 5000; n++) {
      const a = n / 2;
      D = x + a * D; if (Math.abs(D) < FPMIN) D = FPMIN;
      C = x + a / C; if (Math.abs(C) < FPMIN) C = FPMIN;
      D = 1 / D;
      const delta = C * D;
      f *= delta;
      if (Math.abs(delta - 1) < 1e-16) break;
    }
    return Math.exp(-x * x) / (Math.sqrt(Math.PI) * f);
  }
  function pnorm(z) {
    if (Number.isNaN(z)) return NaN;
    if (z === -Infinity) return 0;
    if (z === Infinity) return 1;
    if (z < 0) return 0.5 * erfcPos(-z / SQRT2);
    return 1 - 0.5 * erfcPos(z / SQRT2);
  }
  function pnormUpper(z) { return pnorm(-z); }
  function dnorm(z) { return Math.exp(-0.5 * z * z - LN_SQRT_2PI); }

  /** Φ⁻¹(p): Abramowitz–Stegun 26.2.23 start, then Halley steps in log space (full precision). */
  function qnorm(p) {
    if (Number.isNaN(p) || p < 0 || p > 1) return NaN;
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    if (p === 0.5) return 0;
    const lower = p < 0.5;
    const pp = lower ? p : 1 - p;          // the smaller tail (p > 0.5 keeps ~1e-16 absolute precision)
    const t = Math.sqrt(-2 * Math.log(pp));
    let x = -(t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t));
    const lp = Math.log(pp);
    for (let i = 0; i < 12; i++) {
      // e = (Φ(x) − p)/φ(x), computed as exp(logΦ − logφ) − exp(log p − logφ)
      const lphi = -0.5 * x * x - LN_SQRT_2PI;
      const e = Math.exp(logPnorm(x) - lphi) - Math.exp(lp - lphi);
      const step = e / (1 + x * e / 2);
      x -= step;
      if (Math.abs(step) < 1e-15 * Math.max(1, Math.abs(x))) break;
    }
    return lower ? x : -x;
  }

  // ---------------------------------------------------------------- t, F, χ²
  function pt(t, df) {
    if (Number.isNaN(t) || !(df > 0)) return NaN;
    if (!Number.isFinite(df) || df > 1e7) return pnorm(t);
    if (t === Infinity) return 1;
    if (t === -Infinity) return 0;
    const x = df / (df + t * t);
    const tail = 0.5 * ibeta(x, df / 2, 0.5);
    return t > 0 ? 1 - tail : tail;
  }
  function ptUpper(t, df) { return pt(-t, df); }
  /** Two-sided P value for a t statistic. */
  function pt2(t, df) {
    if (!Number.isFinite(t)) return Number.isNaN(t) ? NaN : 0;
    if (!Number.isFinite(df) || df > 1e7) return 2 * pnorm(-Math.abs(t));
    return ibeta(df / (df + t * t), df / 2, 0.5);
  }
  function dt(t, df) {
    if (!Number.isFinite(df) || df > 1e7) return dnorm(t);
    return Math.exp(lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI) - (df + 1) / 2 * Math.log1p(t * t / df));
  }

  function pf(f, d1, d2) {
    if (!(f > 0)) return 0;
    if (!Number.isFinite(f)) return 1;
    if (!Number.isFinite(d2)) return pchisq(f * d1, d1);
    return ibeta(d1 * f / (d1 * f + d2), d1 / 2, d2 / 2);
  }
  function pfUpper(f, d1, d2) {
    if (!(f > 0)) return 1;
    if (!Number.isFinite(f)) return 0;
    if (!Number.isFinite(d2)) return pchisqUpper(f * d1, d1);
    return ibeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);
  }
  function df_(f, d1, d2) {
    if (!(f > 0)) return 0;
    const lg = lgamma((d1 + d2) / 2) - lgamma(d1 / 2) - lgamma(d2 / 2) + (d1 / 2) * Math.log(d1 / d2) + (d1 / 2 - 1) * Math.log(f) - ((d1 + d2) / 2) * Math.log1p(d1 * f / d2);
    return Math.exp(lg);
  }

  function pchisq(x, df) { return gammp(df / 2, x / 2); }
  function pchisqUpper(x, df) { return gammq(df / 2, x / 2); }
  function dchisq(x, df) {
    if (!(x > 0)) return 0;
    return Math.exp((df / 2 - 1) * Math.log(x) - x / 2 - (df / 2) * Math.LN2 - lgamma(df / 2));
  }

  /**
   * Monotone inversion: the x with cdf(x) = p. Brackets by stepping out from x0, then
   * safeguarded Newton (falls back to bisection when a step leaves the bracket).
   */
  function invert(cdf, pdf, p, x0, lower, upper) {
    let lo = lower, hi = upper;
    let a = x0, b = x0;
    let step = Math.max(1, Math.abs(x0));
    if (cdf(x0) > p) { b = x0; a = x0 - step; while (a > lo && cdf(a) > p) { b = a; step *= 2; a = x0 - step; } if (a < lo) a = lo; }
    else { a = x0; b = x0 + step; while (b < hi && cdf(b) < p) { a = b; step *= 2; b = x0 + step; } if (b > hi) b = hi; }
    let x = Math.min(Math.max(x0, a), b);
    if (x === a || x === b) x = (a + b) / 2;
    for (let i = 0; i < 200; i++) {
      const fx = cdf(x) - p;
      if (fx === 0) return x;
      if (fx < 0) a = x; else b = x;
      const d = pdf(x);
      let nx = d > 0 ? x - fx / d : NaN;
      if (!(nx > a && nx < b)) nx = (a + b) / 2;
      if (Math.abs(nx - x) <= 1e-15 * Math.max(1e-300, Math.abs(nx)) || b - a <= 1e-15 * Math.max(Math.abs(a), Math.abs(b))) return nx;
      x = nx;
    }
    return x;
  }
  function qt(p, df) {
    if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
    if (!Number.isFinite(df) || df > 1e7) return qnorm(p);
    if (df === 1) return Math.tan(Math.PI * (p - 0.5));
    if (df === 2) return (2 * p - 1) / Math.sqrt(2 * p * (1 - p));
    if (p > 0.5) return -qt(1 - p, df);            // symmetric; work in the lower tail
    const z = qnorm(p);
    const x0 = z * (1 + (z * z + 1) / (4 * df));    // Cornish–Fisher first term
    return invert(x => pt(x, df), x => dt(x, df), p, x0, -Infinity, Infinity);
  }
  function qchisq(p, df) {
    if (!(p > 0 && p < 1)) return p === 0 ? 0 : p === 1 ? Infinity : NaN;
    const z = qnorm(p);
    const h = 2 / (9 * df);
    let x0 = df * Math.pow(Math.max(0.01, 1 - h + z * Math.sqrt(h)), 3);
    return invert(x => pchisq(x, df), x => dchisq(x, df), p, x0, 0, Infinity);
  }
  function qf(p, d1, d2) {
    if (!(p > 0 && p < 1)) return p === 0 ? 0 : p === 1 ? Infinity : NaN;
    return invert(x => pf(x, d1, d2), x => df_(x, d1, d2), p, 1, 0, Infinity);
  }

  // ------------------------------------------------------- studentized range
  // Port of R's nmath/ptukey.c (wprob + ptukey), as used by FlowMate.
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
    let pr_w = 2 * pnorm(qsqz) - 1;
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
        const pplus = 2 * pnorm(ac);
        const pminus = 2 * pnorm(ac - w);
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

  /** P(Q ≤ q) for the studentized range of nm means with df error degrees of freedom. */
  function ptukey(q, nm, df, rr) {
    rr = rr || 1;
    const nlegq = 16, ihalfq = 8;
    const eps1 = -30, eps2 = 1e-14, dhaf = 100, dquar = 800, deigh = 5000, dlarg = 25000;
    const xlegq = [0.989400934991649932596154173450, 0.944575023073232576077988415535,
      0.865631202387831743880467897712, 0.755404408355003033895101194847,
      0.617876244402643748446671764049, 0.458016777657227386342419442984,
      0.281603550779258913230460501460, 0.950125098376374401853193354250e-1];
    const alegq = [0.271524594117540948517805724560e-1, 0.622535239386478928628438369944e-1,
      0.951585116824927848099251076022e-1, 0.124628971255533872052476282192,
      0.149595988816576732081501730547, 0.169156519395002538189312079030,
      0.182603415044923588866763667969, 0.189450610455068496285396723208];
    if (!(q > 0)) return 0;
    if (df < 2 || rr < 1 || nm < 2) return NaN;
    if (!Number.isFinite(q)) return 1;
    if (!Number.isFinite(df) || df > dlarg) return wprob(q, rr, nm);
    const f2 = df * 0.5;
    let f2lf = ((f2 * Math.log(df)) - (df * Math.LN2)) - lgamma(f2);
    const f21 = f2 - 1;
    const ff4 = df * 0.25;
    let ulen;
    if (df <= dhaf) ulen = 1; else if (df <= dquar) ulen = 0.5; else if (df <= deigh) ulen = 0.25; else ulen = 0.125;
    f2lf += Math.log(ulen);
    let ans = 0;
    for (let i = 1; i <= 50; i++) {
      let otsum = 0;
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
          const qsqz = ihalfq < jj ? q * Math.sqrt(((xlegq[j] * ulen) + twa1) * 0.5) : q * Math.sqrt(((-(xlegq[j] * ulen)) + twa1) * 0.5);
          otsum += (wprob(qsqz, rr, nm) * alegq[j]) * Math.exp(t1);
        }
      }
      if (i * ulen >= 1.0 && otsum <= eps2) break;
      ans += otsum;
    }
    return ans > 1 ? 1 : ans;
  }
  function ptukeyUpper(q, nm, df) { return Math.max(0, 1 - ptukey(q, nm, df)); }
  /** Studentized-range quantile by bisection on ptukey (more precise than R's secant, which stops at 1e-4). */
  function qtukey(p, nm, df) {
    if (!(p > 0 && p < 1) || !(nm >= 2) || !(df >= 2)) return NaN;
    let lo = 0, hi = 2;
    while (ptukey(hi, nm, df) < p && hi < 1e4) { lo = hi; hi *= 2; }
    for (let i = 0; i < 100 && hi - lo > 1e-12 * hi; i++) {
      const mid = (lo + hi) / 2;
      if (ptukey(mid, nm, df) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // -------------------------------------------------------------- Dunnett
  // Gauss–Legendre nodes on [−1, 1], 20 points (computed once by Newton on P_n).
  function gaussLegendre(n) {
    const x = new Float64Array(n), w = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5)), pp = 0;
      for (let it = 0; it < 100; it++) {
        let p1 = 1, p2 = 0;
        for (let j = 1; j <= n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
        pp = n * (z * p1 - p2) / (z * z - 1);
        const z1 = z; z = z1 - p1 / pp;
        if (Math.abs(z - z1) < 1e-16) break;
      }
      x[i] = z; w[i] = 2 / ((1 - z * z) * pp * pp);
    }
    return { x, w };
  }
  const GL20 = gaussLegendre(20);
  /** ∫_a^b f by composite 20-point Gauss–Legendre over `panels` equal panels. */
  function integrate(f, a, b, panels) {
    let s = 0;
    const h = (b - a) / panels;
    for (let k = 0; k < panels; k++) {
      const c = a + (k + 0.5) * h, r = h / 2;
      for (let i = 0; i < 20; i++) s += GL20.w[i] * f(c + r * GL20.x[i]);
    }
    return s * h / 2;
  }

  /**
   * Dunnett: P(max_i |T_i| ≤ c) where T_i = Z_i / S, corr(Z_i, Z_j) = λ_i λ_j (one-factor
   * structure: λ_i = √(n_i/(n_i+n_0)) for treatment i vs control), S = √(χ²_df/df).
   * Exact double integral: over z ~ N(0,1) for the shared control term, and over S.
   */
  function pdunnett(c, lambdas, df) {
    if (!(c > 0)) return 0;
    // distinct λ with how often each occurs (equal group sizes give one: a power instead of a product)
    const uniq = [];
    lambdas.map(Number).forEach(l => {
      const u = uniq.find(x => Math.abs(x.l - l) < 1e-12);
      if (u) u.n++; else uniq.push({ l, n: 1, sq: Math.sqrt(1 - l * l) });
    });
    // the integrand is even in z (Φ(a) − Φ(b) is unchanged by z → −z), so integrate [0, 8.5] and double
    const inner = (s) => 2 * integrate(z => {
      let prod = dnorm(z);
      for (const u of uniq) {
        prod *= Math.pow(pnorm((c * s - u.l * z) / u.sq) - pnorm((-c * s - u.l * z) / u.sq), u.n);
        if (prod === 0) break;
      }
      return prod;
    }, 0, 8.5, 6);
    if (df == null || !Number.isFinite(df)) return Math.min(1, inner(1));
    const nu = df;
    const logk = Math.LN2 + (nu / 2) * Math.log(nu / 2) - lgamma(nu / 2);
    const dens = s => s > 0 ? Math.exp(logk + (nu - 1) * Math.log(s) - nu * s * s / 2) : 0;
    const hi = Math.sqrt(qchisq(1 - 1e-13, nu) / nu);
    const lo = nu > 4 ? Math.sqrt(Math.max(0, qchisq(1e-13, nu)) / nu) : 0;
    return Math.min(1, integrate(s => dens(s) * inner(s), lo, hi, nu < 6 ? 16 : 10));
  }
  /** c such that P(max|T_i| ≤ c) = p. */
  function qdunnett(p, lambdas, df) {
    let lo = 0, hi = 3;
    while (pdunnett(hi, lambdas, df) < p && hi < 100) { lo = hi; hi *= 1.6; }
    for (let i = 0; i < 60 && hi - lo > 1e-10 * hi; i++) {
      const mid = (lo + hi) / 2;
      if (pdunnett(mid, lambdas, df) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // --------------------------------------------------- exact rank distributions
  const srCache = new Map();
  /** Counts of the Wilcoxon signed-rank statistic V for n (index = V), as floats. */
  function signrankCounts(n) {
    if (srCache.has(n)) return srCache.get(n);
    const max = n * (n + 1) / 2;
    const c = new Float64Array(max + 1);
    c[0] = 1;
    for (let k = 1; k <= n; k++) for (let v = Math.min(max, k * (k + 1) / 2); v >= k; v--) c[v] += c[v - k];
    srCache.set(n, c);
    return c;
  }
  /** P(V ≤ v) for the signed-rank statistic with n non-zero differences (no ties). */
  function psignrank(v, n) {
    v = Math.floor(v + 1e-7);
    if (v < 0) return 0;
    const c = signrankCounts(n);
    if (v >= c.length - 1) return 1;
    let s = 0;
    for (let i = 0; i <= v; i++) s += c[i];
    return s / Math.pow(2, n);
  }
  const wxCache = new Map();
  /** Counts of the Mann–Whitney U for sizes m, n: coefficients of the Gaussian binomial [m+n choose m]_q. */
  function wilcoxCounts(m, n) {
    const key = m < n ? m + ',' + n : n + ',' + m;
    if (wxCache.has(key)) return wxCache.get(key);
    const a = Math.min(m, n), b = Math.max(m, n);
    const max = a * b;
    let poly = new Float64Array(max + 1);
    poly[0] = 1;
    // Π_{i=1..a} (1 − q^{b+i}) / (1 − q^i)
    for (let i = 1; i <= a; i++) {
      const sh = b + i;
      for (let u = max; u >= sh; u--) poly[u] -= poly[u - sh];   // × (1 − q^{b+i})
      for (let u = i; u <= max; u++) poly[u] += poly[u - i];      // ÷ (1 − q^i)
    }
    wxCache.set(key, poly);
    return poly;
  }
  /** P(U ≤ u) for the Mann–Whitney U (= R's pwilcox), sizes m and n, no ties. */
  function pwilcox(u, m, n) {
    u = Math.floor(u + 1e-7);
    if (u < 0) return 0;
    if (u >= m * n) return 1;
    const c = wilcoxCounts(m, n);
    let s = 0, tot = 0;
    for (let i = 0; i < c.length; i++) { tot += c[i]; if (i <= u) s += c[i]; }
    return s / tot;
  }

  /**
   * Exact two-sample Kolmogorov–Smirnov: P(D ≥ d) for samples x (m) and y (n), allowing ties
   * (the lattice path is only checked where the pooled sorted values change, as in R ≥ 4.3).
   */
  function psmirnovUpper(x, y, d) {
    const m = x.length, n = y.length;
    const pooled = x.concat(y).sort((a, b) => a - b);
    // check[k] = true when the boundary between the k-th and (k+1)-th pooled values is a real step
    const N = m + n;
    const check = new Uint8Array(N + 1);
    for (let k = 1; k < N; k++) check[k] = pooled[k] !== pooled[k - 1] ? 1 : 0;
    check[N] = 1;
    const q = (0.5 + Math.floor(d * m * n - 1e-7)) / (m * n);   // R's lattice-safe threshold
    // u[j] = number of lattice paths reaching (i, j) that never cross the boundary where it is
    // checked; every path is equally likely, so P(D < d) = paths(m, n) / C(m+n, m).
    const ok = (i, j) => Math.abs(i / m - j / n) < q;
    const u = new Float64Array(n + 1);
    u[0] = 1;
    for (let j = 1; j <= n; j++) u[j] = (check[j] && !ok(0, j)) ? 0 : u[j - 1];
    let logScale = 0;
    for (let i = 1; i <= m; i++) {
      u[0] = (check[i] && !ok(i, 0)) ? 0 : u[0];
      for (let j = 1; j <= n; j++) u[j] = (check[i + j] && !ok(i, j)) ? 0 : u[j] + u[j - 1];
      // rescale to avoid overflow for large m, n
      const mx = u[n] > 0 ? u[n] : Math.max(...u);
      if (mx > 1e250) { for (let j = 0; j <= n; j++) u[j] /= 1e250; logScale += Math.log(1e250); }
    }
    const logP = Math.log(u[n]) + logScale - lchoose(m + n, m);
    return Math.max(0, Math.min(1, 1 - Math.exp(logP)));
  }

  // ----------------------------------------------- binomial & hypergeometric
  function dbinom(k, n, p) {
    if (k < 0 || k > n || k !== Math.floor(k)) return 0;
    if (p === 0) return k === 0 ? 1 : 0;
    if (p === 1) return k === n ? 1 : 0;
    return Math.exp(lchoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p));
  }
  function pbinom(k, n, p) {
    k = Math.floor(k + 1e-7);
    if (k < 0) return 0;
    if (k >= n) return 1;
    return ibeta(1 - p, n - k, k + 1);
  }
  function pbinomUpper(k, n, p) { k = Math.floor(k + 1e-7); if (k < 0) return 1; if (k >= n) return 0; return ibeta(p, k + 1, n - k); }
  /** Hypergeometric: x white balls drawn in k draws from m white + n black (R's argument order). */
  function dhyper(x, m, n, k) {
    if (x < Math.max(0, k - n) || x > Math.min(k, m)) return 0;
    return Math.exp(lchoose(m, x) + lchoose(n, k - x) - lchoose(m + n, k));
  }
  function phyper(x, m, n, k) {
    let s = 0;
    for (let i = Math.max(0, k - n); i <= Math.min(x, k, m); i++) s += dhyper(i, m, n, k);
    return Math.min(1, s);
  }

  PM.dist = {
    lgamma, lbeta, lchoose, ibeta, ibetaUpper, gammp, gammq,
    pnorm, pnormUpper, dnorm, qnorm, logPnorm,
    pt, ptUpper, pt2, dt, qt, pf, pfUpper, df: df_, qf, pchisq, pchisqUpper, dchisq, qchisq,
    ptukey, ptukeyUpper, qtukey, pdunnett, qdunnett,
    psignrank, signrankCounts, pwilcox, wilcoxCounts, psmirnovUpper,
    dbinom, pbinom, pbinomUpper, dhyper, phyper,
    invert, integrate, gaussLegendre,
  };
})(PM);
