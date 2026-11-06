/* Spectrum chart for the panel planner: detector bars (one row per laser), laser lines, detector
 * bands, dashed excitation and filled emission curves on a wavelength axis. Canvas 2D; theme
 * colours come from the CSS tokens, dye and laser colours from their wavelengths. */
(function (FM) {
  'use strict';
  const LANE = 15;

  function tokens() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fb) => (cs.getPropertyValue(name) || '').trim() || fb;
    return { bg: v('--plot-bg', '#ffffff'), frame: v('--plot-frame', '#3b4152'), tick: v('--plot-tick', '#737a8f'),
      ink: v('--ink-2', '#363c4e'), muted: v('--muted', '#687087'), grid: v('--line-soft', '#e8eaf0'),
      font: v('--font', 'system-ui, sans-serif'), mono: v('--mono', 'ui-monospace, monospace') };
  }
  function rgb(c) {
    let m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
    if (m) return [+m[1], +m[2], +m[3]];
    m = /^#([0-9a-f]{6})$/i.exec(String(c).trim());
    if (m) { const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
    return [128, 128, 128];
  }
  const rgba = (c, a) => { const [r, g, b] = rgb(c); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; };
  const lum = c => { const [r, g, b] = rgb(c); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
  /** A curve / label colour with enough contrast on the plot background. */
  function ink(c, dark) {
    const [r, g, b] = rgb(c), L = lum(c);
    const k = dark ? (L < 0.35 ? 1.5 : 1) : (L > 0.55 ? 0.62 : 0.85);
    const f = x => Math.max(0, Math.min(255, Math.round(x * k)));
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }
  function line(ctx, xa, ya, xb, yb) { ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.stroke(); }
  function roundRect(ctx, x, y, w, hgt, r) {
    r = Math.min(r, w / 2, hgt / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + hgt, r); ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
    ctx.arcTo(x, y + hgt, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /**
   * Draw the chart and return its layout { x0, x1, yTop, yBase, pxAt(nm), nmAt(px), W, H }.
   * model: { dyes: [{ name, color, ex, em, emScale, peak }], lasers: [{ nm, color, active, label }],
   *   lanes: [{ laser, color, label, dim, dets: [{ a, b, label, used }] }], bands: [{ a, b, label, color }],
   *   showEx, hover, empty, range: [lo, hi] }
   */
  function draw(canvas, m) {
    const W = canvas.clientWidth || 800, H = canvas.clientHeight || 320, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr)) canvas.width = Math.round(W * dpr);
    if (canvas.height !== Math.round(H * dpr)) canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const T = tokens(), dark = lum(T.bg) < 0.4, PL = FM.planner;
    const [lo, hi] = m.range || [300, 850];
    const lanes = m.lanes || [];
    const x0 = 46, x1 = W - 14, laneTop = 6;
    const yTop = laneTop + lanes.length * LANE + (lanes.length ? 24 : 18), yBase = H - 34;
    const pxAt = nm => x0 + (nm - lo) / (hi - lo) * (x1 - x0);
    const nmAt = px => lo + (px - x0) / (x1 - x0) * (hi - lo);
    const yAt = v => yBase - v * (yBase - yTop);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);

    // y grid: 0 / 50 / 100 % of each dye's peak
    ctx.lineWidth = 1; ctx.font = '10px ' + T.mono; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    [0, 0.5, 1].forEach(v => {
      const y = Math.round(yAt(v)) + 0.5;
      ctx.strokeStyle = T.grid; line(ctx, x0, y, x1, y);
      ctx.fillStyle = T.tick; ctx.fillText(Math.round(v * 100) + '%', x0 - 6, y);
    });

    // detector bands of the selected laser
    (m.bands || []).forEach(b => {
      const a = pxAt(b.a), c = pxAt(Math.min(b.b, hi));
      ctx.fillStyle = rgba(b.color, dark ? 0.13 : 0.1); ctx.fillRect(a, yTop, c - a, yBase - yTop);
      ctx.strokeStyle = rgba(b.color, 0.55); ctx.setLineDash([3, 3]);
      line(ctx, a, yTop, a, yBase); line(ctx, c, yTop, c, yBase); ctx.setLineDash([]);   // labelled in the detector rows above
    });

    // curves, clipped to the plot
    const trace = (f, k) => {
      let first = null, last = null;
      ctx.beginPath();
      for (let i = 0; i < f.length; i++) {
        const nm = PL.START + i * PL.STEP;
        if (nm < lo - PL.STEP || nm > hi + PL.STEP) continue;
        const x = pxAt(nm), y = yAt(f[i] * k);
        if (first == null) { ctx.moveTo(x, y); first = x; } else ctx.lineTo(x, y);
        last = x;
      }
      return [first, last];
    };
    const labels = [];
    ctx.save(); ctx.beginPath(); ctx.rect(x0, yTop - 4, x1 - x0, yBase - yTop + 4); ctx.clip();
    (m.dyes || []).forEach(d => {
      const k = d.emScale == null ? 1 : d.emScale, c = ink(d.color, dark);
      if (k > 0.003) {
        const [fx, lx] = trace(d.em, k);
        if (fx != null) {
          ctx.lineTo(lx, yBase); ctx.lineTo(fx, yBase); ctx.closePath();
          ctx.fillStyle = rgba(d.color, dark ? 0.26 : 0.22); ctx.fill();
          trace(d.em, k); ctx.strokeStyle = c; ctx.lineWidth = 1.6; ctx.stroke();
          if (k >= 0.08 && d.peak >= lo && d.peak <= hi) labels.push({ x: pxAt(d.peak), y: yAt(k) - 5, text: d.name, color: c });
        }
      }
      if (m.showEx) {
        trace(d.ex, 1);
        ctx.setLineDash([5, 4]); ctx.strokeStyle = c; ctx.globalAlpha = 0.85; ctx.lineWidth = 1.3; ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
    });
    ctx.restore();

    // dye names above their emission peaks, nudged apart
    ctx.font = '600 11px ' + T.font; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const placed = [];
    labels.sort((a, b) => a.y - b.y).forEach(l => {
      const w = ctx.measureText(l.text).width + 8;
      const hit = yy => placed.some(p => Math.abs(p.x - l.x) < (p.w + w) / 2 && Math.abs(p.y - yy) < 13);
      let y = Math.max(yTop + 12, l.y), tries = 0;
      while (hit(y) && tries++ < 4) y += 13;
      if (hit(y) || y > yBase - 4) return;
      placed.push({ x: l.x, y, w });
      ctx.globalAlpha = 0.8; ctx.fillStyle = T.bg; ctx.fillRect(l.x - w / 2, y - 12, w, 13); ctx.globalAlpha = 1;
      ctx.fillStyle = l.color; ctx.fillText(l.text, l.x, y);
    });

    // laser lines
    (m.lasers || []).forEach(L => {
      if (L.nm < lo || L.nm > hi) return;
      const x = Math.round(pxAt(L.nm)) + 0.5;
      ctx.strokeStyle = L.active ? ink(L.color, dark) : rgba(L.color, 0.45);
      ctx.lineWidth = L.active ? 2 : 1.2;
      if (!L.active) ctx.setLineDash([4, 4]);
      line(ctx, x, yTop - 8, x, yBase); ctx.setLineDash([]);
      ctx.fillStyle = L.active ? ink(L.color, dark) : T.muted; ctx.font = '600 10px ' + T.mono; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(L.label, x, yTop - 9);
    });

    // detector rows: one per laser, a bar per filter (filled with the dye it reads, if any)
    lanes.forEach((ln, r) => {
      const y = laneTop + r * LANE + LANE / 2;
      ctx.globalAlpha = ln.dim ? 0.35 : 1;
      ctx.fillStyle = ink(ln.color, dark); ctx.font = '600 10px ' + T.mono; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(ln.label, x0 - 6, y);
      ctx.strokeStyle = T.grid; ctx.lineWidth = 1; line(ctx, x0, Math.round(y) + 0.5, x1, Math.round(y) + 0.5);
      ln.dets.forEach(d => {
        const a = pxAt(d.a), c = Math.max(pxAt(Math.min(d.b, hi)), a + 3);
        roundRect(ctx, a, y - 5, c - a, 10, 3);
        ctx.fillStyle = d.used || rgba(ln.color, dark ? 0.32 : 0.24); ctx.fill();
        if (d.used) { ctx.strokeStyle = ink(d.used, dark); ctx.lineWidth = 1; ctx.stroke(); }
        if (c - a >= 34) {
          ctx.fillStyle = d.used ? (lum(d.used) > 0.55 ? '#141722' : '#ffffff') : T.ink;
          ctx.font = '9px ' + T.mono; ctx.textAlign = 'center'; ctx.fillText(d.label, (a + c) / 2, y + 0.5);
        }
      });
      ctx.globalAlpha = 1;
    });

    // x axis with the visible spectrum under it
    ctx.strokeStyle = T.frame; ctx.lineWidth = 1; line(ctx, x0, yBase + 0.5, x1, yBase + 0.5);
    for (let x = x0; x < x1; x += 2) { ctx.fillStyle = PL.wavelengthColor(nmAt(x)); ctx.fillRect(x, yBase + 2, 2, 5); }
    ctx.fillStyle = T.tick; ctx.font = '10px ' + T.mono; ctx.textBaseline = 'top';
    for (let nm = Math.ceil(lo / 50) * 50; nm <= hi; nm += 50) {
      const x = Math.round(pxAt(nm)) + 0.5, last = nm + 50 > hi;
      ctx.strokeStyle = T.frame; line(ctx, x, yBase + 7, x, yBase + 10);
      ctx.textAlign = last ? 'right' : 'center';
      ctx.fillText(last ? nm + ' nm' : String(nm), last ? x + 3 : x, yBase + 12);
    }

    if (m.empty) {
      ctx.fillStyle = T.muted; ctx.font = '13px ' + T.font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Add dyes to see their spectra against these lasers and filters', (x0 + x1) / 2, (yTop + yBase) / 2);
    }
    if (m.hover != null && m.hover >= lo && m.hover <= hi) {
      const x = Math.round(pxAt(m.hover)) + 0.5;
      ctx.strokeStyle = T.ink; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; line(ctx, x, yTop - 4, x, yBase); ctx.globalAlpha = 1;
    }
    return { x0, x1, yTop, yBase, pxAt, nmAt, W, H };
  }

  FM.spectraPlot = { draw };
})(FM);
