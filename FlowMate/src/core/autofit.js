/* Automatic axis framing.
 *
 * A parameter's transform type (lin / log / logicle / arcsinh) is global — it is a property
 * of the channel. Its range is per plot: each view is framed on the population it shows,
 * pooled across every well, so opening a gate zooms onto the events inside it.
 */
(function (FM) {
  'use strict';
  const T = FM.transforms;

  function niceFloor(v) {
    if (!(v > 0)) return 0;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    let best = 1;
    for (const s of steps) if (s <= m + 1e-9) best = s;
    return best * p;
  }

  /** Round up to a readable axis end with finer steps than niceCeil (1.4M, 700K, 1.8M…). */
  function fineCeil(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    const steps = [1, 1.2, 1.4, 1.5, 1.6, 1.8, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10];
    for (const s of steps) if (m <= s + 1e-9) return s * p;
    return 10 * p;
  }

  /**
   * Values of `param` in population `popId`, pooled across wells (excluded wells skipped),
   * subsampled to about `cap` values in total, sorted ascending.
   */
  function pooled(ws, popId, param, cap) {
    cap = cap || 60000;
    const S = ws.samples.filter(s => !ws.wellInfo(s.key).excluded && s.data[param]);
    const out = [];
    if (!S.length) return out;
    const per = Math.max(200, Math.floor(cap / S.length));
    S.forEach(s => {
      const idx = ws.indices(s, popId);
      const col = s.data[param];
      const step = Math.max(1, Math.floor(idx.length / per));
      for (let i = 0; i < idx.length; i += step) {
        const v = col[idx[i]];
        if (Number.isFinite(v)) out.push(v);
      }
    });
    return out.sort((a, b) => a - b);
  }

  /** A spec of `type` framing the sorted `values`. `base` supplies non-range settings. */
  function fitSpec(type, values, base) {
    const q = p => T.quantile(values, p);
    if (!values.length) return null;
    if (type === 'lin') {
      // frame the bulk: long scatter tails (aggregates, clumps) would otherwise squash the
      // population into a corner; events past the edge pile on the frame and stay gateable
      const lo = q(0.002), hi = q(0.975) * 1.12;
      const span = Math.max(hi - lo, Math.abs(hi) * 1e-3, 1e-9);
      // keep the origin in view when the data start near it (scatter convention, and the
      // singlet diagonal runs through it); otherwise frame the population tightly
      const min = lo >= 0 && lo < 0.35 * hi ? 0 : (lo >= 0 ? niceFloor(lo - 0.08 * span) : -T.niceCeil(-(lo - 0.08 * span)));
      const max = fineCeil(hi + 0.04 * (hi - min));
      return { type: 'lin', min, max: max > min ? max : min + 1 };
    }
    if (type === 'log') {
      const pos = values.filter(v => v > 0);
      if (!pos.length) return { type: 'log', min: 1, max: 1e5 };
      const lo = T.quantile(pos, 0.005), hi = T.quantile(pos, 0.999);
      return { type: 'log', min: Math.pow(10, Math.floor(Math.log10(lo / 2))), max: Math.pow(10, Math.ceil(Math.log10(hi * 1.2))) };
    }
    if (type === 'logicle') {
      const hi = q(0.999);
      const Tt = T.niceCeil(Math.max(hi * 1.3, 10));
      const pos = values.filter(v => v > 0);
      const neg = values.filter(v => v < 0);
      let W = neg.length >= 20 ? T.autoLogicleW(values, Tt, 4.5) : 0.5;
      // the lowest decade worth showing: a little below the bottom of the positive data
      const lowPos = pos.length ? T.quantile(pos, 0.005) / 4 : 1;
      const decades = Math.log10(Tt / Math.max(1, lowPos));
      let M = Math.max(2.5, Math.min(8, Math.round((decades + W) * 10) / 10));
      if (neg.length >= 20) {
        // negative spread: widen the linear region so the compensated negatives stay readable
        W = Math.min(M / 2 - 0.05, T.autoLogicleW(values, Tt, M));
      }
      W = Math.max(0, Math.min(W, M / 2 - 0.05));
      return { type: 'logicle', T: Tt, W: Math.round(W * 100) / 100, M, A: 0 };
    }
    if (type === 'asinh') {
      const lo = q(0.001), hi = q(0.999);
      return { type: 'asinh', cofactor: (base && base.cofactor) || 150, min: Math.min(0, lo), max: T.niceCeil(hi * 1.2) };
    }
    return null;
  }

  /** Framed spec for `param` in population `popId`, keeping the parameter's global type. */
  function fitScale(ws, popId, param) {
    const g = ws.scaleSpec(param);
    const vals = pooled(ws, popId, param);
    if (vals.length < 30) return null;
    const spec = fitSpec(g.type, vals, g);
    if (spec && spec.type === 'logicle') {
      try { new T.Logicle(spec.T, spec.W, spec.M, spec.A || 0); } catch (_) { return null; }
    }
    return spec;
  }

  FM.autofit = { pooled, fitSpec, fitScale, niceFloor };
})(FM);
