/* Axis transforms. Every scale maps data values to display units t ∈ [0, 1] and back.
 *
 *   {type:'lin',     min, max}
 *   {type:'log',     min, max}             min > 0; values ≤ 0 pile up at t = 0
 *   {type:'logicle', T, W, M, A}           Parks, Roederer & Moore 2006; Moore & Parks 2012
 *   {type:'asinh',   cofactor, min, max}
 *   {type:'hyperlog', T, W, M, A}          Bagwell's hyperlog, as defined in Gating-ML 2.0
 *   {type:'biex',    neg, width, pos, max}  FlowJo's biexponential (width is FlowJo's negative
 *                                          "width basis"); t = FlowJo channel / 4096
 *
 * FlowJo and GatingML transforms map onto these exactly (fromFlowJo / fromGatingML below).
 *
 * Gates are evaluated in the display space of the scale they were drawn on, so a
 * polygon edge is a straight line on the plot where the user drew it (GatingML 2.0).
 */
(function (FM) {
  'use strict';

  // ---------------------------------------------------------------- logicle
  /* Port of the reference Logicle implementation (Moore & Parks, Cytometry A 2012).
   * T: top of scale (data units), W: linearisation width in decades,
   * M: total display width in decades, A: extra negative decades. */
  function Logicle(T, W, M, A) {
    if (!(T > 0)) throw new Error('logicle: T must be > 0');
    if (!(M > 0)) throw new Error('logicle: M must be > 0');
    if (!(W >= 0)) throw new Error('logicle: W must be ≥ 0');
    if (2 * W > M) throw new Error('logicle: W is too large for M');
    if (-A > W || A + W > M - W) throw new Error('logicle: A is out of range');
    this.T = T; this.W = W; this.M = M; this.A = A;

    const w = W / (M + A);
    const x2 = A / (M + A);
    const x1 = x2 + w;
    const x0 = x2 + 2 * w;
    const b = (M + A) * Math.LN10;
    const d = solveD(b, w);
    const c_a = Math.exp(x0 * (b + d));
    const mf_a = Math.exp(b * x1) - c_a / Math.exp(d * x1);
    const a = T / ((Math.exp(b) - mf_a) - c_a / Math.exp(d));
    const c = c_a * a;
    const f = -mf_a * a;
    Object.assign(this, { w, x0, x1, x2, a, b, c, d, f });

    // Taylor series about x1, used near zero where the closed form loses precision
    this.xTaylor = x1 + w / 4;
    let posCoef = a * Math.exp(b * x1);
    let negCoef = -c / Math.exp(d * x1);
    this.taylor = new Float64Array(16);
    for (let i = 0; i < 16; i++) {
      posCoef *= b / (i + 1);
      negCoef *= -d / (i + 1);
      this.taylor[i] = posCoef + negCoef;
    }
    this.taylor[1] = 0; // exact by the logicle condition
  }

  /* Solve 2(ln d − ln b) + w(b + d) = 0 for d on (0, b): safeguarded Newton (rtsafe). */
  function solveD(b, w) {
    if (w === 0) return b;
    const tol = 2 * b * Number.EPSILON;
    let lo = 0, hi = b;
    let d = (lo + hi) / 2;
    let lastDelta = hi - lo;
    const fb = -2 * Math.log(b) + w * b;
    let f = 2 * Math.log(d) + w * d + fb;
    for (let i = 0; i < 60; i++) {
      const df = 2 / d + w;
      let delta;
      if (((d - hi) * df - f) * ((d - lo) * df - f) >= 0 || Math.abs(1.9 * f) > Math.abs(lastDelta * df)) {
        delta = (hi - lo) / 2;
        d = lo + delta;
        if (d === lo) return d;
      } else {
        delta = f / df;
        const t = d;
        d -= delta;
        if (d === t) return d;
      }
      if (Math.abs(delta) < tol) return d;
      lastDelta = delta;
      f = 2 * Math.log(d) + w * d + fb;
      if (f === 0) return d;
      if (f < 0) lo = d; else hi = d;
    }
    return d;
  }

  Logicle.prototype.series = function (scale) {
    const x = scale - this.x1;
    const t = this.taylor;
    let sum = t[15] * x;
    for (let i = 14; i >= 2; --i) sum = (sum + t[i]) * x;
    return (sum * x + t[0]) * x;
  };

  /** display → data */
  Logicle.prototype.inverse = function (scale) {
    const negative = scale < this.x1;
    if (negative) scale = 2 * this.x1 - scale;
    let v;
    if (scale < this.xTaylor) v = this.series(scale);
    else v = (this.a * Math.exp(this.b * scale) + this.f) - this.c / Math.exp(this.d * scale);
    return negative ? -v : v;
  };

  /** data → display (Halley's method) */
  Logicle.prototype.scale = function (value) {
    if (value === 0) return this.x1;
    const negative = value < 0;
    if (negative) value = -value;
    let x;
    if (value < this.f) x = this.x1 + value / this.taylor[0];
    else x = Math.log(value / this.a) / this.b;
    const tol = 3 * Number.EPSILON * Math.max(1, Math.abs(x));
    for (let i = 0; i < 40; i++) {
      const ae2bx = this.a * Math.exp(this.b * x);
      const ce2mdx = this.c / Math.exp(this.d * x);
      let y;
      if (x < this.xTaylor) y = this.series(x) - value;
      else y = (ae2bx + this.f) - (ce2mdx + value);
      const abe2bx = this.b * ae2bx;
      const cde2mdx = this.d * ce2mdx;
      const dy = abe2bx + cde2mdx;
      const ddy = this.b * abe2bx - this.d * cde2mdx;
      const delta = y / (dy * (1 - y * ddy / (2 * dy * dy)));
      x -= delta;
      if (Math.abs(delta) < tol) break;
    }
    return negative ? 2 * this.x1 - x : x;
  };

  // --------------------------------------------------------------- hyperlog
  /* Hyperlog (Bagwell 2005) in the parameterisation of Gating-ML 2.0 / Moore & Parks 2012:
   * the display value y of x solves EH(y) = x, where above x1
   *   EH(y) = a·e^(b·y) + c·y − f
   * and below x1 it is the point reflection, −EH(2·x1 − y). Like logicle it is linear near
   * zero and logarithmic above; the inverse is closed form, the forward a safeguarded Newton. */
  function Hyperlog(T, W, M, A) {
    A = A || 0;
    if (!(T > 0) || !(M > 0) || !(W > 0)) throw new Error('hyperlog: T, W and M must be > 0');
    const w = W / (M + A), x2 = A / (M + A), x1 = x2 + w, x0 = x2 + 2 * w;
    const b = (M + A) * Math.LN10;
    const ca = Math.exp(b * x0) / w;
    const fa = Math.exp(b * x1) + ca * x1;
    const a = T / (Math.exp(b) + ca - fa);
    Object.assign(this, { T, W, M, A, x1, a, b, c: ca * a, f: fa * a });
  }
  Hyperlog.prototype.inverse = function (y) {
    const { a, b, c, f, x1 } = this;
    if (y >= x1) return a * Math.exp(b * y) + c * y - f;
    const r = 2 * x1 - y;
    return -(a * Math.exp(b * r) + c * r - f);
  };
  Hyperlog.prototype.scale = function (x) {
    if (!Number.isFinite(x)) return x !== x ? NaN : x > 0 ? Infinity : -Infinity;
    let lo = -1, hi = 2;
    while (this.inverse(lo) > x) lo = lo * 2 - 1;
    while (this.inverse(hi) < x) hi = hi * 2 + 1;
    let y = (lo + hi) / 2;
    for (let i = 0; i < 100; i++) {
      const v = this.inverse(y) - x;
      if (v === 0) return y;
      if (v > 0) hi = y; else lo = y;
      // derivative of EH: a·b·e^(b·y) + c on either side of x1
      const r = y >= this.x1 ? y : 2 * this.x1 - y;
      const d = this.a * this.b * Math.exp(this.b * r) + this.c;
      let next = y - v / d;
      if (!(next > lo && next < hi)) next = (lo + hi) / 2;
      if (Math.abs(next - y) < 1e-14 * Math.max(1, Math.abs(y))) return next;
      y = next;
    }
    return y;
  };

  // ------------------------------------------------------------------- biex
  /* FlowJo's biexponential, exactly as FlowJo computes it: a 4097-point lookup table from
   * channel to value, interpolated linearly. Ported from FlowKit's generate_biex_lut (BSD-3),
   * itself from cytolib, "directly ported from the legacy Java code from TreeStar". Its root
   * finder keeps a quirk of the original on the first iteration (w·b rather than w·d); it is
   * kept so the table matches FlowJo's to the last digit. */
  function biexLogRoot(b, w) {
    let xLo = 0, xHi = b;
    let d = (xLo + xHi) / 2;
    let dx = Math.abs(Math.trunc(xLo - xHi));
    let dxLast = dx;
    const fb = -2 * Math.log(b) + w * b;
    let f = 2 * Math.log(d) + w * b + fb;
    let df = 2 / d + w;
    if (w === 0) return b;
    for (let i = 0; i < 100; i++) {
      if ((((d - xHi) * df - f) - ((d - xLo) * df - f)) > 0 || Math.abs(2 * f) > Math.abs(dxLast * df)) {
        dx = (xHi - xLo) / 2;
        d = xLo + dx;
        if (d === xLo) return d;
      } else {
        dx = f / df;
        const t = d;
        d -= dx;
        if (d === t) return d;
      }
      if (Math.abs(dx) < 1e-12) return d;
      dxLast = dx;
      f = 2 * Math.log(d) + w * d + fb;
      df = 2 / d + w;
      if (f < 0) xLo = d; else xHi = d;
    }
    return d;
  }

  /** Data value at each channel 0…4096 for a biex spec (ascending). */
  const biexCache = new Map();
  function biexLUT(spec) {
    const key = [spec.neg, spec.width, spec.pos, spec.max].join('|');
    let lut = biexCache.get(key);
    if (lut) return lut;
    const channelRange = 4096;
    const ln10 = Math.LN10;
    let decades = spec.pos;
    let width = Math.log10(-spec.width);
    decades = decades - width / 2;
    let extra = spec.neg < 0 ? 0 : spec.neg;
    extra = extra + width / 2;
    let zeroPoint = Math.trunc((extra * channelRange) / (extra + decades));
    zeroPoint = Math.trunc(Math.min(zeroPoint, channelRange / 2));
    if (zeroPoint > 0) decades = extra * channelRange / zeroPoint;
    width = width / (2 * decades);
    const positiveRange = ln10 * decades;
    const minimum = spec.max / Math.exp(positiveRange);
    const negativeRange = biexLogRoot(positiveRange, width);
    const n = channelRange + 1;
    const pos = new Float64Array(n), neg = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      pos[i] = Math.exp(i / n * positiveRange);
      neg[i] = Math.exp(i / n * -negativeRange);
    }
    const sc = Math.exp((positiveRange + negativeRange) * (width + extra / decades));
    for (let i = 0; i < n; i++) neg[i] *= sc;
    const s0 = pos[zeroPoint] - neg[zeroPoint];
    for (let i = zeroPoint; i < n; i++) pos[i] = minimum * ((pos[i] - neg[i]) - s0);
    for (let i = 0; i < zeroPoint; i++) pos[i] = -pos[2 * zeroPoint - i];
    biexCache.set(key, pos);
    return pos;
  }

  /** value → channel by binary search and linear interpolation; ends clamp, like FlowKit. */
  function biexScale(spec) {
    const L = biexLUT(spec), n = L.length, top = n - 1;
    const fwd = v => {
      if (!(v > L[0])) return 0;
      if (v >= L[top]) return 1;
      let lo = 0, hi = top;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (L[mid] <= v) lo = mid; else hi = mid; }
      return (lo + (v - L[lo]) / (L[hi] - L[lo])) / (n - 1);
    };
    const inv = t => {
      const c = t * (n - 1);
      if (c <= 0) return L[0];
      if (c >= top) return L[top];
      const i = Math.floor(c);
      return L[i] + (L[i + 1] - L[i]) * (c - i);
    };
    return { fwd, inv };
  }

  // --------------------------------------------------------------- factory
  const logicleCache = new Map();
  function getLogicle(spec) {
    const key = spec.T + '|' + spec.W + '|' + spec.M + '|' + spec.A;
    let L = logicleCache.get(key);
    if (!L) { L = new Logicle(spec.T, spec.W, spec.M, spec.A || 0); logicleCache.set(key, L); }
    return L;
  }

  /** Build a scale object {spec, fwd(v)→t, inv(t)→v} from a spec. */
  function makeScale(spec) {
    const s = Object.assign({}, spec);
    switch (s.type) {
      case 'lin': {
        const lo = s.min, span = (s.max - s.min) || 1;
        return { spec: s, fwd: v => (v - lo) / span, inv: t => lo + t * span };
      }
      case 'log': {
        const l0 = Math.log10(s.min > 0 ? s.min : 1), l1 = Math.log10(s.max > 0 ? s.max : 10);
        const span = (l1 - l0) || 1;
        // clampLow (FlowJo's log): values under the bottom of the scale sit at 0, not below it
        const lowest = s.clampLow ? s.min : 0;
        return {
          spec: s,
          fwd: v => (v > lowest ? (Math.log10(v) - l0) / span : 0),
          inv: t => Math.pow(10, l0 + t * span),
        };
      }
      case 'biex': {
        const b = biexScale(s);
        return { spec: s, fwd: b.fwd, inv: b.inv };
      }
      case 'hyperlog': {
        const H = new Hyperlog(s.T, s.W, s.M, s.A || 0);
        return { spec: s, fwd: v => H.scale(v), inv: t => H.inverse(t) };
      }
      case 'logicle': {
        const L = getLogicle(s);
        return { spec: s, fwd: v => L.scale(v), inv: t => L.inverse(t), logicle: L };
      }
      case 'asinh': {
        const c = s.cofactor || 150;
        const a0 = Math.asinh(s.min / c), a1 = Math.asinh(s.max / c);
        const span = (a1 - a0) || 1;
        return { spec: s, fwd: v => (Math.asinh(v / c) - a0) / span, inv: t => c * Math.sinh(a0 + t * span) };
      }
      default: throw new Error('Unknown scale type ' + s.type);
    }
  }

  /** Transform a whole Float32Array (or indexed subset) into display units. */
  function applyScale(scale, col, idx, out) {
    const n = idx ? idx.length : col.length;
    out = out && out.length >= n ? out : new Float32Array(n);
    const f = scale.fwd;
    if (idx) for (let i = 0; i < n; i++) out[i] = f(col[idx[i]]);
    else for (let i = 0; i < n; i++) out[i] = f(col[i]);
    return out;
  }

  // ------------------------------------------------------------- defaults
  function niceCeil(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (const s of steps) if (m <= s + 1e-9) return s * p;
    return 10 * p;
  }

  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /** Recommended logicle W from the data's negative tail (Parks et al.):
   *  W = (M − log10(T/|r|)) / 2, r = 5th percentile of the negative values. */
  function autoLogicleW(values, T, M) {
    const neg = [];
    for (let i = 0; i < values.length; i++) if (values[i] < 0) neg.push(values[i]);
    if (neg.length < 20) return 0.5;
    neg.sort((a, b) => a - b);
    const r = quantile(neg, 0.05);
    if (!(r < 0)) return 0.5;
    const w = (M - Math.log10(T / Math.abs(r))) / 2;
    return Math.max(0, Math.min(M / 2 - 0.05, Math.round(w * 100) / 100));
  }

  /**
   * Pick a default scale for a parameter given pooled sample values.
   * Scatter and time parameters get a linear axis; fluorescence gets logicle.
   */
  function defaultScale(param, values) {
    const name = (param.name || '').toUpperCase();
    const isScatter = /^(FSC|SSC|FS|SS)(\b|[-_ ])/.test(name) || /SCATTER/.test(name);
    const isTime = /^TIME/.test(name);
    const isWidth = /WIDTH|-W$/.test(name);
    const wantLog = param.displayHint === 'log' || (!isScatter && !isTime && !isWidth && param.displayHint !== 'lin');

    const sample = [];
    const step = Math.max(1, Math.floor(values.length / 50000));
    for (let i = 0; i < values.length; i += step) if (Number.isFinite(values[i])) sample.push(values[i]);
    sample.sort((a, b) => a - b);
    const hi = quantile(sample, 0.999);

    if (!wantLog) {
      // scatter tails are long (doublets, aggregates, clumps): frame the bulk of the events
      // the way an operator would, ~98th percentile with headroom
      const lo = quantile(sample, 0.001);
      const top = isTime ? quantile(sample, 1) * 1.02 : quantile(sample, 0.98) * 1.4;
      return { type: 'lin', min: lo < 0 && !isTime ? -niceCeil(-lo) : 0, max: niceCeil(top) };
    }
    const range = param.range > 0 ? param.range : Math.max(hi * 4, 262144);
    const T = Math.max(niceCeil(Math.max(hi * 1.5, 1)), Math.min(range, niceCeil(hi * 3)));
    const M = Math.max(3, Math.min(8, Math.round(Math.log10(T) * 10) / 10 + 0.3));
    const W = autoLogicleW(sample, T, M);
    return { type: 'logicle', T, W, M, A: 0 };
  }

  // ---------------------------------------------------------------- ticks
  function siLabel(v) {
    const a = Math.abs(v);
    if (a === 0) return '0';
    const fmt = (x, suf) => {
      const r = Math.round(x * 100) / 100;
      return (Number.isInteger(r) ? r.toFixed(0) : String(r)) + suf;
    };
    if (a >= 1e9) return fmt(v / 1e9, 'G');
    if (a >= 1e6) return fmt(v / 1e6, 'M');
    if (a >= 1e3) return fmt(v / 1e3, 'K');
    if (a >= 1) return fmt(v, '');
    return String(Math.round(v * 1000) / 1000);
  }

  function niceStep(span, target) {
    const raw = span / Math.max(1, target);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  }

  /**
   * Axis ticks for a scale: [{v, t, label, major, decade}] with t in display units.
   * `decade` (an integer) is set for power-of-ten labels so renderers can superscript.
   */
  function ticks(scale, target) {
    const s = scale.spec;
    const out = [];
    target = target || 5;
    if (s.type === 'lin') {
      const step = niceStep(s.max - s.min, target);
      for (let v = Math.ceil(s.min / step) * step; v <= s.max + step * 1e-9; v += step) {
        const vv = Math.abs(v) < step * 1e-9 ? 0 : v;
        out.push({ v: vv, t: scale.fwd(vv), label: siLabel(vv), major: true });
      }
      return out;
    }
    const addDecades = (sign, fromExp, toExp) => {
      for (let e = fromExp; e <= toExp; e++) {
        const base = Math.pow(10, e);
        const v = sign * base;
        const t = scale.fwd(v);
        if (t >= -1e-9 && t <= 1 + 1e-9) out.push({ v, t, label: (sign < 0 ? '-' : '') + '10^' + e, decade: e, sign, major: true });
        for (let m = 2; m <= 9; m++) {
          const mv = sign * m * base;
          const mt = scale.fwd(mv);
          if (mt >= 0 && mt <= 1) out.push({ v: mv, t: mt, major: false });
        }
      }
    };
    if (s.type === 'log') {
      const e0 = Math.floor(Math.log10(s.min)), e1 = Math.ceil(Math.log10(s.max));
      addDecades(1, e0, e1);
      return out.filter(k => k.t >= -1e-9 && k.t <= 1 + 1e-9);
    }
    if (s.type === 'logicle' || s.type === 'asinh' || s.type === 'biex' || s.type === 'hyperlog') {
      const top = s.type === 'logicle' || s.type === 'hyperlog' ? s.T : s.type === 'biex' ? s.max : Math.max(Math.abs(s.max), Math.abs(s.min));
      const e1 = Math.ceil(Math.log10(top));
      const zeroT = scale.fwd(0);
      out.push({ v: 0, t: zeroT, label: '0', major: true, zero: true });
      // a decade is only labelled once the axis is log-like there: it must sit clearly away from zero
      const minGap = 0.045;
      for (let e = 0; e <= e1; e++) {
        const base = Math.pow(10, e);
        [1, -1].forEach(sign => {
          const v = sign * base;
          const t = scale.fwd(v);
          if (t < -1e-9 || t > 1 + 1e-9) return;
          if (Math.abs(t - zeroT) < minGap) return;
          out.push({ v, t, label: (sign < 0 ? '-' : '') + '10^' + e, decade: e, sign, major: true });
        });
        for (let m = 2; m <= 9; m++) {
          [1, -1].forEach(sign => {
            const mv = sign * m * base;
            const mt = scale.fwd(mv);
            if (mt >= 0 && mt <= 1 && Math.abs(mt - zeroT) > 0.012) out.push({ v: mv, t: mt, major: false });
          });
        }
      }
      return out.sort((a, b) => a.t - b.t);
    }
    return out;
  }

  function describe(spec) {
    if (!spec) return '';
    if (spec.type === 'lin') return 'Linear ' + siLabel(spec.min) + '–' + siLabel(spec.max);
    if (spec.type === 'log') return 'Log ' + siLabel(spec.min) + '–' + siLabel(spec.max);
    if (spec.type === 'logicle') return 'Logicle T=' + siLabel(spec.T) + ' W=' + spec.W + ' M=' + spec.M + (spec.A ? ' A=' + spec.A : '');
    if (spec.type === 'asinh') return 'Arcsinh c=' + siLabel(spec.cofactor);
    if (spec.type === 'hyperlog') return 'Hyperlog T=' + siLabel(spec.T) + ' W=' + spec.W + ' M=' + spec.M + (spec.A ? ' A=' + spec.A : '');
    if (spec.type === 'biex') return 'Biex (FlowJo) width ' + spec.width + ', pos ' + spec.pos + ', neg ' + spec.neg + ', top ' + siLabel(spec.max);
    return spec.type;
  }

  function sameSpec(a, b) {
    if (!a || !b || a.type !== b.type) return false;
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    for (const k of keys) if (a[k] !== b[k]) return false;
    return true;
  }

  // --------------------------------------------------- display-space cache
  function specKey(spec) {
    if (!spec) return 'none';
    return Object.keys(spec).sort().map(k => k + '=' + spec[k]).join(';');
  }

  /**
   * A whole parameter column in display units for `spec`, cached on the sample.
   * Logicle needs a Newton solve per value, so plots and polygon gates share this.
   */
  function displayColumn(sample, param, spec, raw) {
    const col = (raw ? sample.raw || sample.data : sample.data)[param];
    if (!col) return null;
    sample._disp = sample._disp || new Map();
    const key = (raw ? 'raw|' : '') + param + '|' + specKey(spec);
    let hit = sample._disp.get(key);
    if (hit) return hit;
    if (sample._disp.size > 48) sample._disp.clear();
    hit = applyScale(makeScale(spec), col);
    sample._disp.set(key, hit);
    return hit;
  }

  // ------------------------------------------------------------- mappings
  /* Transforms from other software, mapped onto FlowMate's scales. Each mapping is exact:
   * the same value lands at the same display position, so gates drawn there mean the same. */
  const num = (attrs, k, dflt) => { const v = parseFloat(attrs[k]); return Number.isFinite(v) ? v : dflt; };

  /** asinh in GatingML / FlowJo form: (asinh(x·sinh(M ln10)/T) + A ln10) / ((M + A) ln10). */
  function asinhTMA(T, M, A) {
    const c = T / Math.sinh(M * Math.LN10);
    return { type: 'asinh', cofactor: c, min: -c * Math.sinh(A * Math.LN10), max: T };
  }

  /** A FlowJo workspace transform element {type: local name, attrs} → scale spec. */
  function fromFlowJo(el) {
    const a = el.attrs || {};
    switch (el.type) {
      case 'linear': return { type: 'lin', min: num(a, 'minRange', 0), max: num(a, 'maxRange', 262144) };
      case 'log': { const o = num(a, 'offset', 1), d = num(a, 'decades', 4.5); return { type: 'log', min: o, max: o * Math.pow(10, d), clampLow: true }; }
      case 'logicle': return { type: 'logicle', T: num(a, 'T', 262144), W: num(a, 'W', 0.5), M: num(a, 'M', 4.5), A: num(a, 'A', 0) };
      case 'biex': return { type: 'biex', neg: num(a, 'neg', 0), width: num(a, 'width', -10), pos: num(a, 'pos', 4.418540), max: num(a, 'maxRange', 262144) };
      case 'fasinh': return asinhTMA(num(a, 'T', 262144), num(a, 'M', 4.5), num(a, 'A', 0));
      default: throw new Error('FlowJo transform "' + el.type + '" is not supported (use linear, log, logicle, biex or arcsinh)');
    }
  }

  /** A GatingML 2.0 transformation {type: local name, attrs} → scale spec, or null if unsupported. */
  function fromGatingML(el) {
    const a = el.attrs || {};
    switch (el.type) {
      case 'flin': { const T = num(a, 'T', 1), A = num(a, 'A', 0); return { type: 'lin', min: -A, max: T }; }
      case 'flog': { const T = num(a, 'T', 1), M = num(a, 'M', 1); return { type: 'log', min: T * Math.pow(10, -M), max: T }; }
      case 'fasinh': return asinhTMA(num(a, 'T', 1), num(a, 'M', 1), num(a, 'A', 0));
      case 'logicle': return { type: 'logicle', T: num(a, 'T', 1), W: num(a, 'W', 0), M: num(a, 'M', 4.5), A: num(a, 'A', 0) };
      case 'hyperlog': return { type: 'hyperlog', T: num(a, 'T', 1), W: num(a, 'W', 1), M: num(a, 'M', 4.5), A: num(a, 'A', 0) };
      default: return null;     // ratios and anything newer: not supported
    }
  }

  FM.transforms = { Logicle, makeScale, applyScale, displayColumn, specKey, defaultScale, autoLogicleW, ticks, siLabel, niceCeil, quantile, describe, sameSpec,
    biexLUT, fromFlowJo, fromGatingML, asinhTMA, Hyperlog };
})(FM);
