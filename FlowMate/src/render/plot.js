/* Plot renderer: pseudocolour density scatter or histogram, axes, and gate overlays.
 *
 * Coordinates: data (instrument units) → display t ∈ [0,1] (via the axis scale) → CSS px.
 * The density image is drawn in device pixels for crisp output on HiDPI screens.
 */
(function (FM) {
  'use strict';
  const T = FM.transforms;

  // ---------------------------------------------------------------- theme
  let themeCache = null;
  let themeOverride = null;
  const LIGHT = {
    plotBg: '#ffffff', frame: '#3b4152', tick: '#737a8f', grid: '#eef0f4', text: '#363c4e', muted: '#687087',
    gate: '#141722', gateSel: '#4c3fb3', accent: '#4c3fb3', tagBg: '#ffffff', hist: '#4c3fb3', crit: '#bf3326',
  };
  /** Render with the light palette regardless of the app theme (report figures). */
  function withLightTheme(fn) {
    const prev = themeOverride;
    themeOverride = Object.assign({}, theme(), LIGHT);
    try { return fn(); } finally { themeOverride = prev; }
  }
  function theme() {
    if (themeOverride) return themeOverride;
    if (themeCache) return themeCache;
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => (cs.getPropertyValue(n).trim() || d);
    themeCache = {
      plotBg: v('--plot-bg', '#fff'), frame: v('--plot-frame', '#3a4052'), tick: v('--plot-tick', '#6b7288'),
      grid: v('--plot-grid', '#eef0f4'), text: v('--ink-2', '#3a4052'), muted: v('--muted', '#6b7288'),
      gate: v('--gate', '#151823'), gateSel: v('--accent', '#4c3fb3'), accent: v('--accent', '#4c3fb3'),
      tagBg: v('--panel', '#fff'), hist: v('--accent', '#4c3fb3'), crit: v('--crit', '#c0392b'),
      font: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif', mono: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
    };
    return themeCache;
  }
  function invalidateTheme() { themeCache = null; }
  /** Is the plot background light (white or near it)? */
  function lightBg() {
    const c = theme().plotBg;
    let r, g, b;
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
    if (hex) { const x = hex[1].length === 3 ? hex[1].replace(/./g, d => d + d) : hex[1]; r = parseInt(x.slice(0, 2), 16); g = parseInt(x.slice(2, 4), 16); b = parseInt(x.slice(4, 6), 16); }
    else { const m = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(c); if (!m) return true; r = +m[1]; g = +m[2]; b = +m[3]; }
    return 0.299 * r + 0.587 * g + 0.114 * b > 140;
  }

  // --------------------------------------------------------------- layout
  function layout(cssW, cssH, opts) {
    opts = opts || {};
    const compact = !!opts.compact;
    const dpr = opts.dpr || window.devicePixelRatio || 1;
    // dense: a grid of small plots on a figure page still needs its axes, but not the
    // margins a full-window plot can afford
    const m = compact ? { l: 4, r: 4, t: 4, b: 4 } : opts.dense ? { l: 58, r: 9, t: 9, b: 36 }
      : opts.axisControls ? { l: 92, r: 14, t: 10, b: 62 } : { l: 62, r: 14, t: 12, b: 46 };
    let x0 = m.l, x1 = cssW - m.r, y0 = m.t, y1 = cssH - m.b;
    if (opts.square) {
      // density plots read best square: centre a square plot area in the space available
      const side = Math.max(120, Math.min(x1 - x0, y1 - y0));
      const padX = Math.max(0, (x1 - x0 - side) / 2);
      x0 += padX; x1 = x0 + side;
      y0 = y0 + Math.max(0, (y1 - y0 - side) / 2); y1 = y0 + side;
    }
    return {
      W: cssW, H: cssH, dpr, compact, dense: !!opts.dense,
      x0, x1, y0, y1,
      // zoom: the part of display space [0,1]² that is visible
      win: opts.win || FULL,
      get w() { return this.x1 - this.x0; }, get h() { return this.y1 - this.y0; },
    };
  }

  const FULL = { x0: 0, x1: 1, y0: 0, y1: 1 };
  function toPx(L, tx, ty) {
    const w = L.win || FULL;
    return [L.x0 + (tx - w.x0) / (w.x1 - w.x0) * (L.x1 - L.x0), L.y1 - (ty - w.y0) / (w.y1 - w.y0) * (L.y1 - L.y0)];
  }
  function fromPx(L, px, py) {
    const w = L.win || FULL;
    return [w.x0 + (px - L.x0) / (L.x1 - L.x0) * (w.x1 - w.x0), w.y0 + (L.y1 - py) / (L.y1 - L.y0) * (w.y1 - w.y0)];
  }
  function zoomed(L) { const w = L.win || FULL; return w.x0 > 1e-6 || w.x1 < 1 - 1e-6 || w.y0 > 1e-6 || w.y1 < 1 - 1e-6; }

  function sizeCanvas(canvas, L) {
    const W = Math.round(L.W * L.dpr), H = Math.round(L.H * L.dpr);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    canvas.style.width = L.W + 'px';
    canvas.style.height = L.H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    return ctx;
  }

  // ------------------------------------------------------------ box blur
  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    const norm = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc * norm;
        acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc * norm;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  // -------------------------------------------------------------- density
  /**
   * How big one event is drawn, in device px: about 2.5 CSS px for a few thousand events, down to 1.25
   * for hundreds of thousands, so sparse plots stay readable on a white background; m.dotScale
   * (the − / + control) multiplies it.
   */
  function dotPx(L, n, m) {
    const auto = L.compact ? (n < 3000 ? 1.5 : 1) : n < 3000 ? 2.5 : n < 20000 ? 2 : n < 100000 ? 1.5 : 1.25;
    const css = (m.dot || auto) * (m.dotScale || 1);
    return Math.max(1, Math.min(14, Math.round(css * L.dpr)));
  }

  function drawDensity(ctx, L, m) {
    const dpr = L.dpr;
    const w = Math.max(1, Math.round(L.w * dpr)), h = Math.max(1, Math.round(L.h * dpr));
    const dx = T.displayColumn(m.sample, m.x, m.xSpec);
    const dy = T.displayColumn(m.sample, m.y, m.ySpec);
    if (!dx || !dy) return 0;
    const idx = m.idx;
    const counts = new Float32Array(w * h);
    const Z = L.win || FULL;
    const zx0 = Z.x0, zxs = Z.x1 - Z.x0, zy0 = Z.y0, zys = Z.y1 - Z.y0;
    const pileL = Z.x0 <= 0, pileR = Z.x1 >= 1, pileB = Z.y0 <= 0, pileT = Z.y1 >= 1;
    let n = 0;
    for (let i = 0; i < idx.length; i++) {
      const e = idx[i];
      const tx = dx[e], ty = dy[e];
      if (!(tx === tx) || !(ty === ty)) continue; // NaN
      let u = (tx - zx0) / zxs, v = (ty - zy0) / zys;
      if (u < 0) { if (!pileL) continue; u = 0; } else if (u >= 1) { if (!pileR) continue; u = 0.9999999; }
      if (v < 0) { if (!pileB) continue; v = 0; } else if (v >= 1) { if (!pileT) continue; v = 0.9999999; }
      const ix = Math.floor(u * w), iy = Math.floor((1 - v) * h);
      counts[iy * w + ix] += 1;
      n++;
    }
    if (!n) return 0;
    // smoothing radius grows as events get sparse relative to the pixel grid
    const sparsity = (w * h) / Math.max(1, n);
    const r = Math.max(1, Math.round(dpr * Math.min(L.compact ? 2.5 : 4, 1 + Math.sqrt(sparsity) / 6)));
    const dens = boxBlur(boxBlur(counts, w, h, r), w, h, r);
    let max = 0;
    for (let i = 0; i < counts.length; i++) if (counts[i] > 0 && dens[i] > max) max = dens[i];
    const lut = FM.colormaps.lut(m.cmap || 'turbo');
    const img = ctx.createImageData(w, h);
    const px = img.data;
    const lmax = Math.log1p(max * 6);
    // each event is a square of `s` device px; denser colours win where squares overlap
    const s = dotPx(L, n, m);
    // on a light background the colour scale starts at the sparsest events, so a lone cell is drawn
    // in the colour map's dark end instead of a pale mid-tone that disappears on white
    let lo = 0;
    if (lightBg()) {
      let dmin = Infinity;
      for (let i = 0; i < counts.length; i++) if (counts[i] > 0 && dens[i] < dmin) dmin = dens[i];
      lo = Math.min(0.6, Math.log1p(dmin * 6) / lmax) * 0.95;
    }
    const top = new Int16Array(w * h).fill(-1);
    const a = Math.floor((s - 1) / 2), b = s - 1 - a;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] <= 0) continue;
      const k = Math.max(0, Math.min(255, Math.round((Math.log1p(dens[i] * 6) / lmax - lo) / (1 - lo) * 255)));
      if (s === 1) { if (k > top[i]) top[i] = k; continue; }
      const x = i % w, y = (i - x) / w;
      for (let yy = Math.max(0, y - a); yy <= Math.min(h - 1, y + b); yy++) {
        const row = yy * w;
        for (let xx = Math.max(0, x - a); xx <= Math.min(w - 1, x + b); xx++) if (k > top[row + xx]) top[row + xx] = k;
      }
    }
    for (let i = 0; i < top.length; i++) {
      const k = top[i];
      if (k < 0) continue;
      const o = i * 4, c = k * 4;
      px[o] = lut[c]; px[o + 1] = lut[c + 1]; px[o + 2] = lut[c + 2]; px[o + 3] = 255;
    }
    // putImageData ignores the context transform: place it in device pixels
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').putImageData(img, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cv, Math.round(L.x0 * dpr), Math.round(L.y0 * dpr));
    ctx.restore();
    return n;
  }

  // ------------------------------------------------------------ histogram
  function histogramCurve(sample, idx, x, xSpec, bins, win) {
    const dx = T.displayColumn(sample, x, xSpec);
    const c = new Float64Array(bins);
    const Z = win || FULL, z0 = Z.x0, zs = Z.x1 - Z.x0;
    for (let i = 0; i < idx.length; i++) {
      const t = dx[idx[i]];
      if (!(t === t)) continue;
      const u = (t - z0) / zs;
      let b = Math.floor(u * bins);
      if (b < 0) { if (Z.x0 > 0) continue; b = 0; } else if (b >= bins) { if (Z.x1 < 1) continue; b = bins - 1; }
      c[b]++;
    }
    // gaussian smoothing, sigma ≈ 1.2 bins
    const k = [0.05, 0.12, 0.2, 0.26, 0.2, 0.12, 0.05];
    const s = new Float64Array(bins);
    for (let i = 0; i < bins; i++) {
      let acc = 0, wsum = 0;
      for (let j = -3; j <= 3; j++) { const q = i + j; if (q >= 0 && q < bins) { acc += c[q] * k[j + 3]; wsum += k[j + 3]; } }
      s[i] = acc / wsum;
    }
    return s;
  }

  function drawHistogram(ctx, L, m, th) {
    const bins = Math.max(32, Math.min(256, Math.round(L.w / 2)));
    const layers = [{ sample: m.sample, idx: m.idx, color: m.histColor || th.hist, fill: true }].concat(m.overlays || []);
    const Z = L.win || FULL;
    const curves = layers.map(l => histogramCurve(l.sample, l.idx, m.x, m.xSpec, bins, Z));
    const norm = m.overlays && m.overlays.length; // overlays compare shapes: scale each to its mode
    let ymax = 0;
    curves.forEach(c => { for (let i = 0; i < c.length; i++) if (c[i] > ymax) ymax = c[i]; });
    if (!(ymax > 0)) return 0;
    layers.forEach((l, li) => {
      const c = curves[li];
      let cmax = 0; for (let i = 0; i < c.length; i++) if (c[i] > cmax) cmax = c[i];
      const scale = norm ? (cmax > 0 ? 1 / cmax : 0) : 1 / (ymax * 1.08);
      ctx.beginPath();
      const p0 = toPx(L, Z.x0, 0);
      ctx.moveTo(p0[0], p0[1]);
      for (let i = 0; i < bins; i++) {
        const p = toPx(L, Z.x0 + (i + 0.5) / bins * (Z.x1 - Z.x0), c[i] * scale * (norm ? 0.92 : 1));
        ctx.lineTo(p[0], p[1]);
      }
      const p1 = toPx(L, Z.x1, 0);
      ctx.lineTo(p1[0], p1[1]);
      if (l.fill) { ctx.globalAlpha = 0.18; ctx.fillStyle = l.color; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.strokeStyle = l.color; ctx.lineWidth = l.fill ? 1.6 : 1.4;
      if (l.dash) ctx.setLineDash(l.dash);
      ctx.stroke();
      ctx.setLineDash([]);
    });
    m._histMax = norm ? null : ymax * 1.08;
    return m.idx.length;
  }

  // ------------------------------------------------------------------ axes
  function drawDecadeLabel(ctx, x, y, tk, align, baseline, th) {
    // "10" with a superscript exponent, laid out manually
    const neg = tk.sign < 0 ? '−' : '';
    const base = neg + '10', exp = String(tk.decade);
    ctx.font = '11px ' + th.font;
    const bw = ctx.measureText(base).width;
    ctx.font = '8px ' + th.font;
    const ew = ctx.measureText(exp).width;
    const total = bw + ew + 0.5;
    let left = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    ctx.textAlign = 'left';
    ctx.textBaseline = baseline;
    ctx.font = '11px ' + th.font;
    ctx.fillText(base, left, y);
    ctx.font = '8px ' + th.font;
    ctx.fillText(exp, left + bw + 0.5, y - (baseline === 'top' ? -1 : 5));
  }

  function tickLabelText(tk) { return tk.decade != null ? null : tk.label; }

  /** Ticks for the visible part [lo, hi] (display units) of a scale. */
  function visibleTicks(scale, lo, hi, target) {
    if (scale.spec.type === 'lin' && (lo > 1e-6 || hi < 1 - 1e-6)) {
      const sub = T.makeScale({ type: 'lin', min: scale.inv(lo), max: scale.inv(hi) });
      return T.ticks(sub, target).map(k => Object.assign({}, k, { t: scale.fwd(k.v) }));
    }
    return T.ticks(scale, target).filter(k => k.t >= lo - 1e-9 && k.t <= hi + 1e-9);
  }

  function drawAxes(ctx, L, m, th) {
    const xs = T.makeScale(m.xSpec);
    const Z = L.win || FULL;
    const xt = visibleTicks(xs, Z.x0, Z.x1, Math.max(3, Math.round(L.w / 90)));
    ctx.strokeStyle = th.frame;
    ctx.lineWidth = 1;
    ctx.strokeRect(L.x0 + 0.5, L.y0 + 0.5, L.w - 1, L.h - 1);
    if (L.compact) return;

    ctx.fillStyle = th.text;
    ctx.strokeStyle = th.tick;
    // x ticks
    let lastRight = -Infinity;
    xt.forEach(tk => {
      const [px] = toPx(L, tk.t, 0);
      if (px < L.x0 - 1 || px > L.x1 + 1) return;
      const len = tk.major ? 5 : 3;
      ctx.beginPath(); ctx.moveTo(Math.round(px) + 0.5, L.y1); ctx.lineTo(Math.round(px) + 0.5, L.y1 + len); ctx.stroke();
      if (!tk.major) return;
      const txt = tickLabelText(tk);
      ctx.font = '11px ' + th.font;
      const wdt = txt ? ctx.measureText(txt).width : 26;
      if (px - wdt / 2 < lastRight + 6) return;
      lastRight = px + wdt / 2;
      ctx.fillStyle = th.text;
      if (txt) { ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(txt, px, L.y1 + 7); }
      else drawDecadeLabel(ctx, px, L.y1 + 7, tk, 'center', 'top', th);
    });

    // y ticks (histogram: counts or relative)
    let yt;
    if (m.y) yt = visibleTicks(T.makeScale(m.ySpec), Z.y0, Z.y1, Math.max(3, Math.round(L.h / 60)));
    else if (m._histMax) yt = T.ticks(T.makeScale({ type: 'lin', min: 0, max: m._histMax }), 4);
    else yt = [];
    let lastTop = Infinity;
    yt.forEach(tk => {
      const [, py] = toPx(L, 0, tk.t);
      if (py < L.y0 - 1 || py > L.y1 + 1) return;
      const len = tk.major ? 5 : 3;
      ctx.strokeStyle = th.tick;
      ctx.beginPath(); ctx.moveTo(L.x0, Math.round(py) + 0.5); ctx.lineTo(L.x0 - len, Math.round(py) + 0.5); ctx.stroke();
      if (!tk.major) return;
      if (py + 7 > lastTop - 4) return;
      lastTop = py - 7;
      const txt = tickLabelText(tk);
      ctx.fillStyle = th.text;
      if (txt) { ctx.font = '11px ' + th.font; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(txt, L.x0 - 8, py); }
      else drawDecadeLabel(ctx, L.x0 - 8, py + 4, tk, 'right', 'alphabetic', th);
    });

    // titles (the interactive plot puts axis pickers there instead)
    if (m.noTitles) return;
    ctx.fillStyle = th.text;
    ctx.font = '500 12px ' + th.font;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(m.xLabel || m.x, (L.x0 + L.x1) / 2, L.H - 6);
    ctx.save();
    // the rotated title sits inside the tick labels; dense margins leave it less room
    ctx.translate(Math.max(12, L.x0 - (L.dense ? 42 : 48)), (L.y0 + L.y1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText(m.y ? (m.yLabel || m.y) : (m.overlays && m.overlays.length ? '% of mode' : 'Count'), 0, 0);
    ctx.restore();
  }

  /**
   * Render the data layer of a plot into `canvas`.
   * model: { sample, idx, x, y|null, xSpec, ySpec, xLabel, yLabel, cmap, dot (CSS px), dotScale, overlays, histColor }
   */
  function render(canvas, L, m) {
    const th = theme();
    const ctx = sizeCanvas(canvas, L);
    ctx.clearRect(0, 0, L.W, L.H);
    ctx.fillStyle = th.plotBg;
    ctx.fillRect(L.x0, L.y0, L.w, L.h);
    let n = 0;
    try {
      if (m.sample && m.idx) n = m.y ? drawDensity(ctx, L, m) : drawHistogram(ctx, L, m, th);
    } catch (e) { console.error(e); }
    drawAxes(ctx, L, m, th);
    if (!n && !L.compact && m.sample) {
      ctx.fillStyle = th.muted; ctx.font = '12px ' + th.font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('No events in this population', (L.x0 + L.x1) / 2, (L.y0 + L.y1) / 2);
    }
    return n;
  }

  // ------------------------------------------------------------- gates
  /** Outline of a gate in plot px for a plot whose axes use xSpec/ySpec. */
  function gateOutline(gate, L, xSpec, ySpec) {
    const px = T.makeScale(xSpec), py = ySpec ? T.makeScale(ySpec) : null;
    // an open side (null bound) is drawn past the plot edge
    const tx = (v, side) => (Number.isFinite(v) ? px.fwd(v) : side < 0 ? -0.5 : 1.5);
    const ty = (v, side) => (Number.isFinite(v) ? py.fwd(v) : side < 0 ? -0.5 : 1.5);
    if (gate.type === 'range') {
      const [lo, hi] = FM.gating.span(gate.range.lo, gate.range.hi);
      return { type: 'range', x0: toPx(L, tx(lo, -1), 0)[0], x1: toPx(L, tx(hi, 1), 0)[0] };
    }
    if (gate.type === 'quad') {
      // axis-aligned boundaries map consistently under any monotone axis transform
      const cxT = px.fwd(gate.quad.cx), cyT = py.fwd(gate.quad.cy);
      const right = gate.corner === 'UR' || gate.corner === 'LR';
      const upper = gate.corner === 'UR' || gate.corner === 'UL';
      const a = toPx(L, right ? cxT : -0.5, upper ? cyT : -0.5), b = toPx(L, right ? 1.5 : cxT, upper ? 1.5 : cyT);
      return { type: 'quad', corner: gate.corner, center: toPx(L, cxT, cyT), pts: [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]] };
    }
    if (gate.type === 'rect') {
      const r = gate.rect;
      const [x0, x1] = FM.gating.span(r.x0, r.x1), [y0, y1] = FM.gating.span(r.y0, r.y1);
      const a = toPx(L, tx(x0, -1), ty(y0, -1));
      const b = toPx(L, tx(x1, 1), ty(y1, 1));
      return { type: 'rect', pts: [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]] };
    }
    if (gate.type === 'ellipse') {
      // drawn through the gate's own display space, so it stays exact on any axes
      const gx = T.makeScale(gate.xScale), gy = T.makeScale(gate.yScale);
      const map = p => toPx(L, px.fwd(gx.inv(p[0])), py.fwd(gy.inv(p[1])));
      const pts = FM.gating.ellipsePoints(gate, 96).map(map);
      return { type: 'polygon', pts, verts: FM.gating.ellipseHandles(gate).map(map), curved: true, ellipse: true };
    }
    // polygon: straight edges in the gate's own display space
    // straight edges survive the mapping when both spaces agree, or when both are linear (affine)
    const sameAxis = (a, b) => T.sameSpec(a, b) || (a && b && a.type === 'lin' && b.type === 'lin');
    const same = sameAxis(gate.xScale, xSpec) && sameAxis(gate.yScale, ySpec);
    const pts = [];
    if (same) {
      gate.verts.forEach(([x, y]) => pts.push(toPx(L, px.fwd(x), py.fwd(y))));
      return { type: 'polygon', pts, verts: pts.slice() };
    }
    const gx = T.makeScale(gate.xScale), gy = T.makeScale(gate.yScale);
    const gv = gate.verts.map(([x, y]) => [gx.fwd(x), gy.fwd(y)]);
    const verts = [];
    for (let i = 0; i < gv.length; i++) {
      const a = gv[i], b = gv[(i + 1) % gv.length];
      verts.push(toPx(L, px.fwd(gx.inv(a[0])), py.fwd(gy.inv(a[1]))));
      for (let s = 0; s < 24; s++) {
        const u = s / 24;
        const tx = a[0] + (b[0] - a[0]) * u, ty = a[1] + (b[1] - a[1]) * u;
        pts.push(toPx(L, px.fwd(gx.inv(tx)), py.fwd(gy.inv(ty))));
      }
    }
    return { type: 'polygon', pts, verts, curved: true };
  }

  /** Is a gate drawable on a plot with these axes? */
  function gateFits(gate, x, y) {
    if (!gate || gate.type === 'bool') return false;      // a Boolean gate has no shape to draw
    if (gate.type === 'range') return !y && gate.x === x;
    if (gate.type === 'quad') return gate.x === x && gate.y === y;
    return gate.x === x && gate.y === y;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /** Events in a gate, written in full (a count is read exactly) until it no longer fits a tag. */
  function fmtEvents(n) {
    if (!Number.isFinite(n)) return '';
    return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M' : Math.round(n).toLocaleString('en-US');
  }

  /**
   * Draw gate outlines and labels.
   * items: [{ gate, outline, pct, count, selected, hover, label }]
   * A label reads name · % · events; the count is drawn only where the item carries one, in
   * lighter ink, because a percentage without the events behind it cannot be judged.
   */
  function drawGates(ctx, L, items, opts) {
    const th = theme();
    opts = opts || {};
    ctx.save();
    ctx.beginPath(); ctx.rect(L.x0, L.y0, L.w, L.h); ctx.clip();
    if (opts.outlines !== false) items.forEach(it => {
      const o = it.outline;
      const col = it.selected ? th.gateSel : (it.gate.color || th.gate);
      ctx.strokeStyle = col;
      ctx.lineWidth = it.selected ? 2 : (it.hover ? 2 : (L.compact ? 1.2 : 1.5));
      ctx.lineJoin = 'round';
      if (o.type === 'quad') {
        const [cx, cy] = o.center;
        if (it.selected) {
          ctx.globalAlpha = 0.08; ctx.fillStyle = col;
          ctx.beginPath(); o.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        ctx.moveTo(cx, L.y0); ctx.lineTo(cx, L.y1);
        ctx.moveTo(L.x0, cy); ctx.lineTo(L.x1, cy);
        ctx.stroke();
      } else if (o.type === 'range') {
        const yb = L.y0 + (L.compact ? 6 : 18);
        ctx.beginPath();
        ctx.moveTo(o.x0, L.y1); ctx.lineTo(o.x0, yb);
        ctx.moveTo(o.x1, L.y1); ctx.lineTo(o.x1, yb);
        ctx.moveTo(o.x0, yb); ctx.lineTo(o.x1, yb);
        ctx.stroke();
        if (it.selected) {
          ctx.globalAlpha = 0.08; ctx.fillStyle = col; ctx.fillRect(o.x0, yb, o.x1 - o.x0, L.y1 - yb); ctx.globalAlpha = 1;
        }
      } else {
        ctx.beginPath();
        o.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
        if (it.selected) { ctx.globalAlpha = 0.07; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1; }
        ctx.stroke();
      }
    });
    ctx.restore();

    // labels outside the clip so they stay legible near edges
    if (opts.labels === false) return;
    items.forEach(it => {
      const o = it.outline;
      let ax, ay;
      if (o.type === 'quad') {
        const pct = Number.isFinite(it.pct) ? (it.pct >= 99.95 ? '100' : it.pct.toFixed(it.pct < 10 ? 2 : 1)) + '%' : '—';
        const right = o.corner === 'UR' || o.corner === 'LR', upper = o.corner === 'UR' || o.corner === 'UL';
        const name = L.compact || L.dense ? '' : (it.label || it.gate.name);
        const cnt = L.compact ? '' : fmtEvents(it.count);
        ctx.font = (L.compact ? '600 10px ' : '600 11px ') + th.mono;
        const pw = ctx.measureText(pct).width;
        ctx.font = '400 10.5px ' + th.mono;
        const cw = cnt ? ctx.measureText(cnt).width + 7 : 0;
        ctx.font = '500 11px ' + th.font;
        const nw = name ? ctx.measureText(name).width + 8 : 0;
        const w = pw + nw + cw + (L.compact ? 6 : 12), h = L.compact ? 13 : 20;
        const bx = right ? L.x1 - w - 3 : L.x0 + 3, by = upper ? L.y0 + 3 : L.y1 - h - 3;
        ctx.fillStyle = th.tagBg; ctx.globalAlpha = 0.92; roundRect(ctx, bx, by, w, h, 3); ctx.fill(); ctx.globalAlpha = 1;
        if (!L.compact) { ctx.strokeStyle = it.selected ? th.gateSel : th.frame; ctx.lineWidth = it.selected ? 1.4 : 0.8; roundRect(ctx, bx, by, w, h, 3); ctx.stroke(); }
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        if (name) { ctx.fillStyle = th.text; ctx.font = '500 11px ' + th.font; ctx.fillText(name, bx + 6, by + h / 2 + 0.5); }
        ctx.fillStyle = it.selected ? th.gateSel : th.text; ctx.font = (L.compact ? '600 10px ' : '600 11px ') + th.mono;
        ctx.fillText(pct, bx + (L.compact ? 3 : 6) + nw, by + h / 2 + 0.5);
        if (cnt) { ctx.fillStyle = th.muted; ctx.font = '400 10.5px ' + th.mono; ctx.fillText(cnt, bx + 6 + nw + pw + 7, by + h / 2 + 0.5); }
        it.labelBox = [bx, by, w, h];
        return;
      }
      if (o.type === 'range') { ax = (o.x0 + o.x1) / 2; ay = L.y0 + (L.compact ? 6 : 18); }
      else {
        const xs = o.pts.map(p => p[0]), ys = o.pts.map(p => p[1]);
        ax = Math.max(L.x0, Math.min(L.x1, Math.min(...xs)));
        ay = Math.max(L.y0, Math.min(L.y1, Math.min(...ys)));
      }
      const pct = Number.isFinite(it.pct) ? (it.pct >= 99.95 ? '100' : it.pct < 0.01 && it.pct > 0 ? '<0.01' : it.pct.toFixed(it.pct < 10 ? 2 : 1)) + '%' : '—';
      if (L.compact) {
        ctx.font = '600 10px ' + th.mono;
        const tw = ctx.measureText(pct).width;
        const bx = Math.min(L.x1 - tw - 6, Math.max(L.x0 + 1, ax + 2)), by = Math.max(L.y0 + 1, Math.min(L.y1 - 14, ay - 14));
        ctx.fillStyle = th.tagBg; ctx.globalAlpha = 0.9; ctx.fillRect(bx, by, tw + 6, 13); ctx.globalAlpha = 1;
        ctx.fillStyle = it.selected ? th.gateSel : th.text; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(pct, bx + 3, by + 7);
        return;
      }
      const name = L.dense ? '' : (it.label || it.gate.name);
      const cnt = fmtEvents(it.count);
      ctx.font = '500 11px ' + th.font;
      const nw = name ? ctx.measureText(name).width : 0;
      ctx.font = '400 10.5px ' + th.mono;
      const cw = cnt ? ctx.measureText(cnt).width + 7 : 0;
      ctx.font = '600 11px ' + th.mono;
      const pw = ctx.measureText(pct).width;
      const w = nw + pw + cw + (name ? 18 : 12), h = L.dense ? 17 : 20;
      let bx = ax + 4, by = ay - h - 4;
      if (o.type === 'range') { bx = ax - w / 2; by = L.y0 + 22; }
      bx = Math.max(L.x0 + 2, Math.min(L.x1 - w - 2, bx));
      by = Math.max(L.y0 + 2, Math.min(L.y1 - h - 2, by));
      ctx.fillStyle = th.tagBg; ctx.globalAlpha = 0.94;
      roundRect(ctx, bx, by, w, h, 3); ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = it.selected ? th.gateSel : th.frame; ctx.lineWidth = it.selected ? 1.4 : 0.8;
      roundRect(ctx, bx, by, w, h, 3); ctx.stroke();
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillStyle = th.text; ctx.font = '500 11px ' + th.font;
      if (name) ctx.fillText(name, bx + 6, by + h / 2 + 0.5);
      const px = name ? bx + 12 + nw : bx + 6;
      ctx.fillStyle = it.selected ? th.gateSel : th.text; ctx.font = '600 11px ' + th.mono;
      ctx.fillText(pct, px, by + h / 2 + 0.5);
      if (cnt) { ctx.fillStyle = th.muted; ctx.font = '400 10.5px ' + th.mono; ctx.fillText(cnt, px + pw + 7, by + h / 2 + 0.5); }
      it.labelBox = [bx, by, w, h];
    });
  }

  function drawHandles(ctx, pts, hoverIdx) {
    const th = theme();
    pts.forEach((p, i) => {
      const r = i === hoverIdx ? 5.5 : 4;
      ctx.fillStyle = th.tagBg; ctx.strokeStyle = th.gateSel; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.rect(p[0] - r, p[1] - r, 2 * r, 2 * r); ctx.fill(); ctx.stroke();
    });
  }

  /** The resize frame of a selected gate: a thin dashed box and small filled squares. */
  function drawFrame(ctx, frame, hoverIdx) {
    const th = theme();
    const [x0, y0, x1, y1] = frame.box;
    ctx.save();
    ctx.strokeStyle = th.gateSel; ctx.globalAlpha = 0.55; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0), Math.round(y1 - y0));
    ctx.restore();
    frame.handles.forEach(hd => {
      const r = hd.i === hoverIdx ? 4.5 : 3.2;
      ctx.fillStyle = th.gateSel; ctx.strokeStyle = th.tagBg; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.rect(hd.p[0] - r, hd.p[1] - r, 2 * r, 2 * r); ctx.fill(); ctx.stroke();
    });
  }

  // ------------------------------------------------------------ hit tests
  function distToSeg(px, py, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const l2 = vx * vx + vy * vy;
    let t = l2 ? ((px - a[0]) * vx + (py - a[1]) * vy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const x = a[0] + t * vx, y = a[1] + t * vy;
    return { d: Math.hypot(px - x, py - y), t };
  }

  function insidePts(px, py, pts) {
    return FM.gating.pointInPolygon(px, py, pts.map(p => p[0]), pts.map(p => p[1]));
  }

  FM.plot = { fmtEvents, theme, invalidateTheme, withLightTheme, layout, toPx, fromPx, zoomed, FULL, sizeCanvas, render, gateOutline, gateFits, drawGates, drawHandles, drawFrame, distToSeg, insidePts, histogramCurve, roundRect };
})(FM);
