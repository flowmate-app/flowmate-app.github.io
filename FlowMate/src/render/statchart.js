/* The Analysis step's graph: one column per condition, every well a dot, and the chosen
 * comparisons as brackets.
 *
 *   bar     mean as a bar, ± SD or SEM
 *   dot     mean as a line, ± SD or SEM, no bar
 *   box     median and quartiles, whiskers min to max
 *   paired  one line per matched set of wells across the conditions
 *
 * Paper, not screen: explicit colours and Arial, no gridlines, axis ticks outward — the graph
 * looks the same pasted into Word, PowerPoint or Illustrator as it does in the app.
 */
(function (FM) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const INK = '#1a1a1a', MUTED = '#555b6e', LINE = '#8a90a2';
  const FONT = 'Arial, Helvetica, sans-serif';

  function S(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (v != null) el.setAttribute(k, v); });
    kids.forEach(k => { if (k != null) el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    return el;
  }
  const txt = (x, y, str, a) => S('text', Object.assign({ x, y, fill: INK, 'font-family': FONT, 'font-size': 13 }, a || {}), str);
  const finite = Number.isFinite;

  function niceMax(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  /** Tick label: plain digits (no K/M suffixes a journal would query). */
  function tickLabel(v, step) {
    if (Math.abs(v) < step * 1e-6) return '0';
    const d = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  /** Spread k dots across `width`, centred. */
  const spread = (j, k, width) => (k > 1 ? (j / (k - 1) - 0.5) * width : 0);

  /**
   * model: { title?, yLabel, kind, error: 'sd'|'sem', groups: [{ name, color, values: [{ v, label }], summary }],
   *          sets: [[number|null per group]] (paired), comparisons: [{ a, b, p, stars }] (indices into groups),
   *          showNs, pText: 'stars'|'exact' }
   * → <svg> with width and height set, ready to show or serialise.
   */
  /** A value as written over a bar: whole numbers with separators, smaller ones to 3 significant digits. */
  function fmtValue(v) {
    const a = Math.abs(v);
    if (a >= 1000) return Math.round(v).toLocaleString('en-US');
    if (a === 0) return '0';
    return String(Number(v.toPrecision(3)));
  }

  function render(model) {
    const groups = model.groups;
    const kind = model.kind || 'bar';
    const n = groups.length;
    const bw = n > 8 ? 64 : 84;
    const left = 80, right = 18, dataH = 260;
    const plotRight = left + Math.max(2, n) * bw;
    // a title wider than the plot widens the picture, not the axis
    const title = String(model.title || '').trim();
    const titleH = title ? 30 : 0;
    const W = Math.max(plotRight + right, title ? Math.ceil(title.length * 9) + 40 : 0);
    const longest = Math.max(0, ...groups.map(g => g.name.length));
    const rotate = longest * 6.4 > bw - 6;
    const bottom = rotate ? 30 + Math.min(120, longest * 5.2) : 44;

    const errOf = s => (model.error === 'sem' ? s.sem : s.sd);
    const all = [];
    groups.forEach(g => {
      g.values.forEach(x => all.push(x.v));
      const s = g.summary;
      if ((kind === 'bar' || kind === 'dot') && finite(s.mean)) { const e = errOf(s); all.push(s.mean + (finite(e) ? e : 0), s.mean - (finite(e) ? e : 0)); }
    });
    const vals = all.filter(finite);
    const hi = niceMax(Math.max(...vals, 0) * 1.04) || 1;
    const step = hi / 5;
    const lo = Math.min(0, ...vals) < 0 ? -Math.ceil(-Math.min(...vals) / step) * step : 0;
    // big numbers go on the axis title as ×10ⁿ, so the ticks stay short
    const exp = hi >= 1e5 ? Math.floor(Math.log10(step) + 1e-9) : 0;
    const unit = Math.pow(10, exp);

    const Yd = v => dataH * (1 - (v - lo) / (hi - lo));
    // brackets, in a frame where the data top is y = 0 (negative is up)
    let brackets = (model.comparisons || []).map(c => ({ i: Math.min(c.a, c.b), j: Math.max(c.a, c.b), p: c.p,
      label: model.pText === 'exact' ? FM.groupStats.pText(c.p).replace(/^(?=\d)/, 'P = ').replace(/^</, 'P < ').replace(/^>/, 'P > ') : c.stars }));
    if (!model.showNs) brackets = brackets.filter(b => b.p <= 0.05);
    // the value written over each condition: the mean (the median on a box plot), just above its bar,
    // error bar or box — brackets then stack above the label as they do above the data
    const valueOf = s => (kind === 'box' ? s.median : s.mean);
    const labelAt = s => {
      const e = errOf(s);
      if (kind === 'box') return Yd(s.max) - 7;
      return Yd(Math.max(s.mean, 0) + ((kind === 'bar' || kind === 'dot') && finite(e) ? e : 0)) - 7;
    };
    const tops = groups.map(g => {
      const s = g.summary, e = errOf(s);
      const ys = g.values.map(x => Yd(x.v)).filter(finite);
      if (kind === 'bar' || kind === 'dot') ys.push(Yd(s.mean + (finite(e) ? e : 0)));
      if (kind === 'box') ys.push(Yd(s.max));
      if (model.showValues && finite(valueOf(s))) ys.push(labelAt(s) - 12);
      return ys.filter(finite).length ? Math.min(...ys.filter(finite)) : dataH;
    });
    const STEP = 25, PADB = 12;
    const placed = FM.pubtext ? FM.pubtext.stackBrackets(brackets, tops, STEP, PADB) : [];
    const minY = placed.length ? Math.min(...placed.map(b => b.y)) - 18 : 0;
    const top = 16 + titleH + Math.max(0, -minY);
    const H = top + dataH + bottom;
    const Y = v => top + Yd(v);
    const X = i => left + bw * (i + 0.5);
    const base = Y(Math.max(lo, 0));

    const svg = S('svg', { xmlns: NS, viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', class: 'stat-chart',
      'aria-label': (title ? title + ': ' : '') + model.yLabel + ' by condition' });
    svg.appendChild(S('rect', { x: 0, y: 0, width: W, height: H, fill: '#ffffff' }));
    if (title) svg.appendChild(txt(W / 2, 24, title, { class: 'sc-title', 'text-anchor': 'middle', 'font-size': 16, 'font-weight': 700 }));

    // ---- axes
    svg.appendChild(S('line', { x1: left, x2: left, y1: Y(hi), y2: Y(lo), stroke: INK, 'stroke-width': 1.2 }));
    svg.appendChild(S('line', { x1: left, x2: plotRight, y1: base, y2: base, stroke: INK, 'stroke-width': 1.2 }));
    for (let v = lo; v <= hi + step * 1e-6; v += step) {
      const yy = Y(v);
      svg.appendChild(S('line', { x1: left - 5, x2: left, y1: yy, y2: yy, stroke: INK, 'stroke-width': 1.2 }));
      svg.appendChild(txt(left - 8, yy + 4, tickLabel(v / unit, step / unit), { 'text-anchor': 'end', 'font-size': 12 }));
    }
    const ym = top + dataH / 2;
    const yTitle = txt(18, ym, model.yLabel + (exp ? ' (×10' : ''), { transform: 'rotate(-90 18 ' + ym + ')', 'text-anchor': 'middle', 'font-size': 13.5, 'font-weight': 700 });
    if (exp) { yTitle.appendChild(S('tspan', { dy: -5, 'font-size': 9.5 }, String(exp))); yTitle.appendChild(S('tspan', { dy: 5 }, ')')); }
    svg.appendChild(yTitle);

    const dotW = Math.min(26, bw * 0.36);
    const errBar = (cx, s, half) => {
      const e = errOf(s);
      if (!finite(s.mean) || !(e > 0)) return;
      const a = Y(s.mean + e), b = Y(Math.max(lo, s.mean - e));
      svg.appendChild(S('path', { class: 'sc-err', d: 'M' + cx + ' ' + a + 'V' + b + 'M' + (cx - half) + ' ' + a + 'H' + (cx + half) + 'M' + (cx - half) + ' ' + b + 'H' + (cx + half),
        stroke: INK, 'stroke-width': 1.3, fill: 'none' }));
    };
    const dot = (px, py, label, attrs) => svg.appendChild(S('circle', Object.assign({ class: 'sc-dot', cx: px, cy: py, r: 3.6, fill: INK, stroke: '#fff', 'stroke-width': 0.8 }, attrs || {}),
      S('title', {}, label)));

    // ---- paired: a line per matched set, under the dots
    if (kind === 'paired') {
      (model.sets || []).forEach(row => {
        // a missing well breaks the line rather than bridging the gap
        let d = '', pen = false;
        row.forEach((v, i) => {
          if (!finite(v)) { pen = false; return; }
          d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
          pen = true;
        });
        if (/L/.test(d))svg.appendChild(S('path', { class: 'sc-pair', d, stroke: LINE, 'stroke-width': 1.2, fill: 'none' }));
      });
    }

    groups.forEach((g, i) => {
      const cx = X(i), s = g.summary, bar = Math.min(50, bw * 0.6);
      const k = g.values.length;
      if (kind === 'bar' && finite(s.mean)) {
        const y1 = Y(s.mean);
        svg.appendChild(S('rect', { class: 'sc-bar', x: cx - bar / 2, y: Math.min(base, y1), width: bar, height: Math.abs(base - y1),
          fill: g.color, 'fill-opacity': 0.78, stroke: INK, 'stroke-width': 1.1 }));
        errBar(cx, s, 8);
      }
      if (kind === 'dot' && finite(s.mean)) {
        svg.appendChild(S('line', { class: 'sc-mean', x1: cx - bar / 2, x2: cx + bar / 2, y1: Y(s.mean), y2: Y(s.mean), stroke: INK, 'stroke-width': 2 }));
        errBar(cx, s, 10);
      }
      if (kind === 'box' && s.n) {
        const bx = cx - bar / 2;
        svg.appendChild(S('path', { class: 'sc-whisker', d: 'M' + cx + ' ' + Y(s.max) + 'V' + Y(s.q3) + 'M' + cx + ' ' + Y(s.q1) + 'V' + Y(s.min) +
          'M' + (cx - 8) + ' ' + Y(s.max) + 'H' + (cx + 8) + 'M' + (cx - 8) + ' ' + Y(s.min) + 'H' + (cx + 8), stroke: INK, 'stroke-width': 1.2, fill: 'none' }));
        svg.appendChild(S('rect', { class: 'sc-box', x: bx, y: Y(s.q3), width: bar, height: Math.max(0.5, Y(s.q1) - Y(s.q3)), fill: g.color, 'fill-opacity': 0.45, stroke: INK, 'stroke-width': 1.1 }));
        svg.appendChild(S('line', { class: 'sc-median', x1: bx, x2: bx + bar, y1: Y(s.median), y2: Y(s.median), stroke: INK, 'stroke-width': 2 }));
      }
      if (kind === 'paired' && finite(s.mean)) {
        svg.appendChild(S('line', { class: 'sc-mean', x1: cx - bar / 2, x2: cx + bar / 2, y1: Y(s.mean), y2: Y(s.mean), stroke: g.color, 'stroke-width': 3, 'stroke-linecap': 'round' }));
      }
      g.values.forEach((x, j) => {
        if (!finite(x.v)) return;
        const px = kind === 'paired' ? cx : cx + spread(j, k, kind === 'dot' ? dotW * 1.3 : dotW);
        if (kind === 'dot' || kind === 'paired') dot(px, Y(x.v), x.label + ': ' + x.v, { fill: g.color, stroke: INK, 'stroke-width': 0.9, r: 4 });
        else dot(px, Y(x.v), x.label + ': ' + x.v, kind === 'box' ? { r: 3, 'fill-opacity': 0.75 } : null);
      });
      const ly = base + 18;
      if (rotate) svg.appendChild(txt(cx + 4, ly - 4, g.name, { 'text-anchor': 'end', transform: 'rotate(-40 ' + (cx + 4) + ' ' + (ly - 4) + ')', 'font-size': 12.5 }));
      else svg.appendChild(txt(cx, ly, g.name, { 'text-anchor': 'middle', 'font-size': 12.5 }));
    });

    // ---- values over the bars
    if (model.showValues) groups.forEach((g, i) => {
      const v = valueOf(g.summary);
      if (!finite(v)) return;
      svg.appendChild(txt(X(i), top + labelAt(g.summary), fmtValue(v), { class: 'sc-value', 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600 }));
    });

    // ---- brackets
    placed.forEach(b => {
      const x1 = X(b.i) + 3, x2 = X(b.j) - 3, yy = top + b.y;
      svg.appendChild(S('path', { class: 'sc-bracket', d: 'M' + x1 + ' ' + (yy + 5) + 'V' + yy + 'H' + x2 + 'V' + (yy + 5), stroke: INK, 'stroke-width': 1.1, fill: 'none' }));
      const small = b.label === 'ns' || model.pText === 'exact';
      svg.appendChild(txt((x1 + x2) / 2, yy - (small ? 3 : 1), b.label, { class: 'sc-plabel', 'text-anchor': 'middle', 'font-size': small ? 11 : 15, 'font-weight': small ? 400 : 700,
        fill: b.label === 'ns' ? MUTED : INK }));
    });
    return svg;
  }

  /** Serialise to standalone SVG markup. */
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
      img.onerror = () => reject(new Error('could not render the graph'));
      img.src = url;
    });
  }

  FM.statChart = { render, toSVGString, toPNG };
})(FM);
