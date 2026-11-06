/* Number formatting and P-value styles.
 *
 * Prism shows results with 4 significant digits by default and its "GP" P-value style:
 *   0.1234 (ns), 0.0332 (*), 0.0021 (**), 0.0002 (***), <0.0001 (****)
 * Also available: APA (.012, *** at <.001), NEJM (0.01, <0.001) and exact P.
 */
(function (PM) {
  'use strict';

  const STYLES = {
    GP: { name: 'GraphPad (GP)', thresholds: [0.05, 0.01, 0.001, 0.0001], example: '0.1234 (ns), 0.0332 (*), 0.0021 (**), 0.0002 (***), <0.0001 (****)' },
    APA: { name: 'APA', thresholds: [0.05, 0.01, 0.001], example: '.123 (ns), .033 (*), .002 (**), <.001 (***)' },
    NEJM: { name: 'NEJM', thresholds: [0.05, 0.01, 0.001], example: '0.12 (ns), 0.03 (*), 0.002 (**), <0.001 (***)' },
    exact: { name: 'Exact P', thresholds: [0.05, 0.01, 0.001, 0.0001], example: '0.1234, 0.03321, 1.234e-05' },
  };

  /**
   * x with `sig` significant digits (Prism's default 4), the way Prism shows results: every value
   * computed by an analysis keeps its digits even when whole ("2.000", "55.00", "0.000"; counts and
   * degrees of freedom are integer cells, see result.js), plain hyphen-minus (so Excel reads
   * pasted results as numbers), and scientific notation outside 1e-4 … 1e7 with a three-digit
   * exponent ("6.952e-008"), as Prism for Windows writes it.
   */
  function fmt(x, opts) {
    if (x == null || Number.isNaN(x)) return '';
    if (x === Infinity) return '∞';
    if (x === -Infinity) return '-∞';
    if (typeof x !== 'number') return String(x);
    const sig = (opts && opts.sig) || 4;
    if (x === 0) return sig > 1 ? '0.' + '0'.repeat(sig - 1) : '0';
    const ax = Math.abs(x);
    let s;
    if (ax < 1e-4 || ax >= 1e7) {
      const m = /^(-?[\d.]+)e([+-])(\d+)$/.exec(x.toExponential(sig - 1));
      s = m[1] + 'e' + m[2] + m[3].padStart(3, '0');
    } else {
      const dp = Math.max(0, sig - 1 - Math.floor(Math.log10(ax)));
      s = x.toFixed(Math.min(dp, 15));
      // rounding can carry into a new digit (9.9996 → 10.000); trim to `sig` digits again
      if (Math.floor(Math.log10(Math.abs(Number(s)))) !== Math.floor(Math.log10(ax))) s = Number(s).toFixed(Math.max(0, dp - 1));
    }
    return s;
  }
  /** Fixed decimals, with a proper minus sign. */
  function fmtFixed(x, dp) {
    if (x == null || Number.isNaN(x)) return '';
    if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞';
    return x.toFixed(dp).replace('-', '−');
  }
  /** Plain ASCII number for CSV / clipboard (no typographic minus, full precision trimmed). */
  function plain(x) {
    if (x == null || Number.isNaN(x)) return '';
    if (typeof x !== 'number') return String(x);
    return String(Number(x.toPrecision(12)));
  }

  /** The P value as text in a style. */
  function pText(p, style) {
    style = style || 'GP';
    if (p == null || Number.isNaN(p)) return '';
    if (style === 'APA') {
      if (p < 0.001) return '<.001';
      return p.toFixed(3).replace(/^0/, '');
    }
    if (style === 'NEJM') {
      if (p < 0.001) return '<0.001';
      if (p < 0.01) return p.toFixed(3);
      if (p >= 0.045 && p < 0.05) return p.toFixed(3);   // don't let 0.0499 round to 0.05
      return p.toFixed(2);
    }
    if (style === 'exact') {
      if (p < 1e-4) return p.toExponential(3).replace(/e\+?/, 'e');
      return Number(p.toPrecision(4)).toString();
    }
    if (p < 0.0001) return '<0.0001';
    if (p >= 0.99995) return '>0.9999';
    return p.toFixed(4);
  }
  /** "P=0.0050" / "P<0.0001": the P column of Prism's ANOVA tables. */
  function pEq(p, style) {
    const t = pText(p, style);
    if (!t) return '';
    return /^[<>]/.test(t) ? 'P' + t : 'P=' + t;
  }
  /** Asterisk summary ("ns", "*" … "****"; APA/NEJM stop at three). */
  function stars(p, style) {
    if (p == null || Number.isNaN(p)) return '';
    const th = (STYLES[style || 'GP'] || STYLES.GP).thresholds;
    let n = 0;
    for (const t of th) if (p <= t) n++;
    return n === 0 ? 'ns' : '*'.repeat(n);
  }
  /** "0.0123 (*)". */
  function pSummary(p, style) { return pText(p, style) + ' (' + stars(p, style) + ')'; }
  /** "P = 0.0123" or "P < 0.0001", for prose. */
  function pProse(p, style) {
    const t = pText(p, style);
    if (!t) return '';
    return t[0] === '<' ? 'P ' + t.replace('<', '< ') : 'P = ' + t;
  }
  /** Legend key for the stars of a style: "*P ≤ 0.05, **P ≤ 0.01, …". */
  function starKey(style) {
    const st = STYLES[style || 'GP'] || STYLES.GP;
    return st.thresholds.map((t, i) => '*'.repeat(i + 1) + 'P ≤ ' + (style === 'APA' ? String(t).replace(/^0/, '') : String(t))).join(', ');
  }
  /** "1.23 to 4.56" (Prism's CI range format). */
  function ciText(lo, hi, opts) {
    const f = v => (v == null || Number.isNaN(v)) ? '???' : fmt(v, opts);
    return f(lo) + ' to ' + f(hi);
  }

  PM.num = { STYLES, fmt, fmtFixed, plain, pText, pEq, stars, pSummary, pProse, starKey, ciText };
})(PM);
