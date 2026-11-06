/* The publication figure: one bar per condition (mean ± SD or SEM), every well as a dot,
 * and Tukey's pairwise comparisons as brackets with stars.
 *
 * Paper, not screen: explicit colours and Arial, no gridlines, axis ticks outward — the
 * figure has to look the same pasted into Word, PowerPoint or Illustrator as it does here,
 * so it never reads the app's theme variables.
 */
(function (FM) {
  'use strict';
  const S = (...a) => FM.dom.s(...a);

  const INK = '#1a1a1a', MUTED = '#555b6e', WARN = '#b26a00';
  const FONT = 'Arial, Helvetica, sans-serif';

  function niceMax(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }

  /** Tick label: plain digits for a paper (no K/M suffixes a journal would query). */
  function tickLabel(v, step) {
    if (Math.abs(v) < step * 1e-6) return '0';
    const d = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function txt(x, y, str, a) {
    return S('text', Object.assign({ x, y, fill: INK, 'font-family': FONT, 'font-size': 13 }, a || {}), str);
  }


  /**
   * res: FM.analysis result. o: pubtext options (errorBars, brackets, pStyle, showGate).
   * Returns an <svg> with width/height set, ready to serialise.
   */
  function pubChart(ws, res, o) {
    o = FM.pubtext.options(ws, o);
    const groups = FM.pubtext.shownGroups(res, o);
    const adjusted = new Set(FM.pubtext.adjustedWells(ws, res).map(a => a.key));
    const n = groups.length;
    const bw = 84;
    const left = 78, right = 18, dataH = 250;
    const W = left + right + Math.max(2, n) * bw;
    // labels rotate when any would collide with its neighbour
    const longest = Math.max(0, ...groups.map(x => x.group.name.length));
    const rotate = longest * 6.4 > bw - 6;
    const bottom = rotate ? 30 + Math.min(120, longest * 5.2) : 44;

    const stat = groups.map(x => {
      const s = x.summary;
      const err = o.errorBars === 'sem' ? s.sem : s.sd;
      const vals = x.used.map(w => ({ v: w.value, w }));
      return { x, mean: s.mean, err: Number.isFinite(err) ? err : 0, vals };
    });
    const all = stat.flatMap(s => s.vals.map(v => v.v).concat([s.mean + s.err])).filter(Number.isFinite);
    const hi = niceMax(Math.max(...all, 0) * 1.04);
    const step = hi / 5;
    const lo = Math.min(0, ...all) < 0 ? -Math.ceil(-Math.min(...all) / step) * step : 0;
    // big numbers go on the axis title as ×10ⁿ, so the ticks stay short integers
    const exp = hi >= 1e5 ? Math.floor(Math.log10(step) + 1e-9) : 0;
    const unit = Math.pow(10, exp);

    // brackets: Tukey pairs among the tested (non-gate) groups on the figure
    const idx = new Map(groups.map((x, i) => [x.group.name, i]));
    let brackets = res.pairs.filter(p => idx.has(p.a) && idx.has(p.b))
      .map(p => ({ i: Math.min(idx.get(p.a), idx.get(p.b)), j: Math.max(idx.get(p.a), idx.get(p.b)), p: p.p, label: FM.analysis.stars(p.p, o.pStyle) }));
    if (o.brackets === 'sig') brackets = brackets.filter(b => b.p <= 0.05);

    // lay the brackets out in a coordinate system where the data top is y = 0 (negative is up)
    const Yd = v => dataH * (1 - (v - lo) / (hi - lo));
    const tops = stat.map(s => Math.min(Yd(s.mean + s.err), ...s.vals.map(v => Yd(v.v)).concat([Yd(Math.max(s.mean, 0))])));
    // a level is a label's height plus the tick above it, so a tick never lands in a label
    const STEP = 25, PADB = 12;
    const placed = FM.pubtext.stackBrackets(brackets, tops, STEP, PADB);
    const minY = placed.length ? Math.min(...placed.map(b => b.y)) - 18 : 0;
    const top = 14 + Math.max(0, -minY);
    const H = top + dataH + bottom;
    const Y = v => top + Yd(v);
    const X = i => left + bw * (i + 0.5);

    const svg = S('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', class: 'pub-chart',
      'aria-label': res.metric.name + ' by condition, with Tukey comparisons' });
    svg.appendChild(S('rect', { x: 0, y: 0, width: W, height: H, fill: '#ffffff' }));

    // ---- axes
    svg.appendChild(S('line', { x1: left, x2: left, y1: Y(hi), y2: Y(lo), stroke: INK, 'stroke-width': 1.2 }));
    svg.appendChild(S('line', { x1: left, x2: W - right, y1: Y(Math.max(lo, 0)), y2: Y(Math.max(lo, 0)), stroke: INK, 'stroke-width': 1.2 }));
    for (let v = lo; v <= hi + step * 1e-6; v += step) {
      const yy = Y(v);
      svg.appendChild(S('line', { x1: left - 5, x2: left, y1: yy, y2: yy, stroke: INK, 'stroke-width': 1.2 }));
      svg.appendChild(txt(left - 8, yy + 4, tickLabel(v / unit, step / unit), { 'text-anchor': 'end', 'font-size': 12 }));
    }
    const ym = top + dataH / 2;
    const title = txt(18, ym, res.metric.name + (exp ? ' (×10' : ''), { transform: 'rotate(-90 18 ' + ym + ')', 'text-anchor': 'middle', 'font-size': 13.5, 'font-weight': 700 });
    if (exp) { title.appendChild(S('tspan', { dy: -5, 'font-size': 9.5 }, String(exp))); title.appendChild(S('tspan', { dy: 5 }, ')')); }
    svg.appendChild(title);

    // ---- bars, error bars, dots
    stat.forEach((s, i) => {
      const cx = X(i), bar = Math.min(50, bw * 0.6);
      const isGate = s.x.group.role === 'gate';
      if (Number.isFinite(s.mean)) {
        const y0 = Y(Math.max(lo, 0)), y1 = Y(s.mean);
        svg.appendChild(S('rect', { x: cx - bar / 2, y: Math.min(y0, y1), width: bar, height: Math.abs(y0 - y1),
          fill: s.x.group.color, 'fill-opacity': isGate ? 0.28 : 0.78, stroke: INK, 'stroke-width': 1.1 }));
        if (s.err > 0) {
          const a = Y(s.mean + s.err), b = Y(Math.max(lo, s.mean - s.err));
          svg.appendChild(S('path', { d: 'M' + cx + ' ' + a + 'V' + b + 'M' + (cx - 8) + ' ' + a + 'H' + (cx + 8) + 'M' + (cx - 8) + ' ' + b + 'H' + (cx + 8),
            stroke: INK, 'stroke-width': 1.3, fill: 'none' }));
        }
      }
      const k = s.vals.length;
      s.vals.forEach((v, j) => {
        const dx = k > 1 ? (j / (k - 1) - 0.5) * Math.min(26, bar * 0.62) : 0;
        const px = cx + dx, py = Y(v.v);
        const tip = S('title', {}, (v.w.well || v.w.key) + ': ' + v.v);
        if (adjusted.has(v.w.key)) {
          // a well that read through a hand-adjusted gate is never drawn like the others
          svg.appendChild(S('path', { d: 'M' + px + ' ' + (py - 5) + 'L' + (px + 5) + ' ' + py + 'L' + px + ' ' + (py + 5) + 'L' + (px - 5) + ' ' + py + 'Z',
            fill: '#fff', stroke: WARN, 'stroke-width': 1.6 }, tip));
        } else {
          svg.appendChild(S('circle', { cx: px, cy: py, r: 3.6, fill: INK, stroke: '#fff', 'stroke-width': 0.8 }, tip));
        }
      });
      // condition names under the axis
      const ly = Y(Math.max(lo, 0)) + 18;
      if (rotate) svg.appendChild(txt(cx + 4, ly - 4, s.x.group.name, { 'text-anchor': 'end', transform: 'rotate(-40 ' + (cx + 4) + ' ' + (ly - 4) + ')', 'font-size': 12.5 }));
      else svg.appendChild(txt(cx, ly, s.x.group.name, { 'text-anchor': 'middle', 'font-size': 12.5 }));
    });

    // ---- brackets
    placed.forEach(b => {
      const x1 = X(b.i) + 3, x2 = X(b.j) - 3, yy = top + b.y;
      svg.appendChild(S('path', { d: 'M' + x1 + ' ' + (yy + 5) + 'V' + yy + 'H' + x2 + 'V' + (yy + 5), stroke: INK, 'stroke-width': 1.1, fill: 'none' }));
      const ns = b.label === 'ns';
      svg.appendChild(txt((x1 + x2) / 2, yy - (ns ? 3 : 1), b.label, { 'text-anchor': 'middle', 'font-size': ns ? 11 : 15, 'font-weight': ns ? 400 : 700,
        fill: ns ? MUTED : INK }));
    });
    return svg;
  }

  /** Serialise an SVG element to standalone markup. */
  function toSVGString(svg) {
    const s = new XMLSerializer().serializeToString(svg);
    return s.indexOf('xmlns=') < 0 ? s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"') : s;
  }

  /** Rasterise at `scale`× for slides and documents. Resolves to a PNG Blob. */
  function toPNG(svg, scale) {
    scale = scale || 3;
    const w = +svg.getAttribute('width'), h = +svg.getAttribute('height');
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(toSVGString(svg));
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = Math.round(w * scale); c.height = Math.round(h * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => (b ? resolve(b) : reject(new Error('no image'))), 'image/png');
      };
      img.onerror = () => reject(new Error('could not render the figure'));
      img.src = url;
    });
  }

  FM.pubchart = { pubChart, toSVGString, toPNG };
})(FM);
