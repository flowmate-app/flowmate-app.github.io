/* SVG charts for results: fold-change forest plot, bar chart with replicates, drift scatter.
 * Colours come from CSS custom properties so the same SVG works in the app (both themes)
 * and inside exported reports, which define the same tokens. */
(function (FM) {
  'use strict';
  const S = (...a) => FM.dom.s(...a);
  const fmt = v => FM.analysis.fmtNum(v);

  function niceTicks(lo, hi, n) {
    const span = hi - lo || Math.abs(hi) || 1;
    const raw = span / Math.max(1, n);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    const step = (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }

  function text(x, y, str, attrs) {
    return S('text', Object.assign({ x, y, fill: 'var(--ink-2)', 'font-size': 11, 'font-family': 'var(--font)' }, attrs || {}), str);
  }

  // ------------------------------------------------------------ fold chart
  /**
   * Forest-style chart of mean fold-change vs the reference control on a log2 axis,
   * with each replicate as a dot and the ±threshold band shaded.
   */
  function foldChart(res, opts) {
    opts = opts || {};
    const thr = res.threshold;
    const rows = res.groups.filter(x => x.group.role !== 'gate' && x.summary.n > 0);
    const ctrlMean = res.control ? (res.groups.find(x => x.group.id === res.control.id) || { summary: {} }).summary.mean : NaN;
    const W = opts.width || 720;
    const rowH = 34, top = 34, bottom = 40, left = 150, right = 110;
    const H = top + bottom + rows.length * rowH;
    const svg = S('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', role: 'img', class: 'chart fold-chart',
      'aria-label': 'Fold-change of each condition against ' + (res.control ? res.control.name : 'the control') });
    if (!(ctrlMean > 0) || !rows.length) {
      svg.appendChild(text(W / 2, H / 2, res.control ? 'The reference control has no usable wells' : 'Choose a reference control to see fold-changes', { 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 13 }));
      return svg;
    }
    // log2 domain: always show at least ±(threshold×1.6), extend to the data
    let lo = -Math.log2(thr) * 1.6, hi = Math.log2(thr) * 1.6;
    rows.forEach(x => x.used.forEach(w => {
      const f = Math.log2(Math.max(w.value, 1e-9) / ctrlMean);
      if (Number.isFinite(f)) { lo = Math.min(lo, f - 0.25); hi = Math.max(hi, f + 0.25); }
    }));
    lo = Math.max(lo, -8); hi = Math.min(hi, 8);
    const X = v => left + (Math.log2(v) - lo) / (hi - lo) * (W - left - right);
    const plotB = H - bottom;

    // threshold band
    svg.appendChild(S('rect', { x: X(1 / thr), y: top - 8, width: X(thr) - X(1 / thr), height: plotB - top + 8, fill: 'var(--sunk)', rx: 4 }));
    svg.appendChild(text((X(1 / thr) + X(thr)) / 2, top - 14, 'under ' + thr + '× — not meaningful', { 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 10.5 }));
    // decade-like ticks at powers of two
    for (let e = Math.ceil(lo); e <= Math.floor(hi); e++) {
      const v = Math.pow(2, e);
      const x = X(v);
      svg.appendChild(S('line', { x1: x, x2: x, y1: top - 8, y2: plotB, stroke: e === 0 ? 'var(--ink-2)' : 'var(--line)', 'stroke-width': e === 0 ? 1.3 : 1, 'stroke-dasharray': e === 0 ? null : '2 3' }));
      svg.appendChild(text(x, plotB + 16, v >= 1 ? v + '×' : '1/' + (1 / v) + '×', { 'text-anchor': 'middle', fill: 'var(--muted)', 'font-family': 'var(--mono)', 'font-size': 10.5 }));
    }
    [1 / thr, thr].forEach(v => svg.appendChild(S('line', { x1: X(v), x2: X(v), y1: top - 8, y2: plotB, stroke: 'var(--accent)', 'stroke-width': 1.2, 'stroke-dasharray': '4 3', opacity: 0.8 })));
    svg.appendChild(text((left + W - right) / 2, H - 6, 'Fold-change vs ' + res.control.name + ' (log scale)', { 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 11 }));

    rows.forEach((x, i) => {
      const y = top + i * rowH + rowH / 2;
      const isCtrl = res.control && x.group.id === res.control.id;
      const folds = x.used.map(w => w.value / ctrlMean).filter(f => f > 0);
      svg.appendChild(S('line', { x1: left - 8, x2: W - right + 8, y1: y + rowH / 2, y2: y + rowH / 2, stroke: 'var(--line-soft)' }));
      svg.appendChild(S('rect', { x: 12, y: y - 5, width: 10, height: 10, rx: 2, fill: x.group.color }));
      svg.appendChild(text(28, y + 4, x.group.name + (isCtrl ? ' (reference)' : ''), { 'font-weight': isCtrl ? 400 : 600, fill: 'var(--ink)', 'font-size': 12 }));
      if (folds.length > 1) {
        svg.appendChild(S('line', { x1: X(Math.min(...folds)), x2: X(Math.max(...folds)), y1: y, y2: y, stroke: x.group.color, 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0.35 }));
      }
      folds.forEach(f => svg.appendChild(S('circle', { cx: X(f), cy: y, r: 3.2, fill: x.group.color, opacity: 0.55 })));
      const mf = x.fold;
      if (mf > 0) {
        const hit = x.verdict.key === 'up' || x.verdict.key === 'down';
        svg.appendChild(S('rect', { x: X(mf) - 1.5, y: y - 9, width: 3, height: 18, rx: 1.5, fill: hit ? 'var(--accent)' : 'var(--ink)' }));
        svg.appendChild(text(W - right + 14, y + 4, FM.analysis.fmtFold(mf), { 'font-family': 'var(--mono)', 'font-weight': 600, fill: hit ? 'var(--accent)' : 'var(--ink)', 'font-size': 12 }));
        svg.appendChild(text(W - right + 62, y + 4, hit ? '≥' + thr + '×' : '', { fill: 'var(--accent)', 'font-size': 10.5, 'font-weight': 600 }));
      }
    });
    return svg;
  }

  // ------------------------------------------------------------- bar chart
  function barChart(res, opts) {
    opts = opts || {};
    const rows = res.groups.filter(x => x.members.length);
    const W = opts.width || 720, H = opts.height || 300;
    const left = 64, right = 16, top = 16, bottom = 58;
    const svg = S('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', role: 'img', class: 'chart bar-chart', 'aria-label': res.metric.name + ' by condition' });
    const all = rows.flatMap(x => x.members.map(w => w.value)).filter(Number.isFinite);
    if (!all.length) { svg.appendChild(text(W / 2, H / 2, 'No values', { 'text-anchor': 'middle', fill: 'var(--muted)' })); return svg; }
    const ctrl = res.control ? res.groups.find(x => x.group.id === res.control.id) : null;
    const cm = ctrl ? ctrl.summary.mean : NaN;
    let ymax = Math.max(...all, ...rows.map(x => x.summary.mean + (x.summary.sd || 0)).filter(Number.isFinite));
    if (cm > 0 && opts.showThreshold !== false) ymax = Math.max(ymax, Math.min(cm * res.threshold, ymax * 1.6));
    const ymin = Math.min(0, ...all);
    const ticks = niceTicks(ymin, ymax * 1.05, 5);
    const y1 = ticks[ticks.length - 1];
    const Y = v => top + (1 - (v - ymin) / (y1 - ymin)) * (H - top - bottom);
    ticks.forEach(t => {
      svg.appendChild(S('line', { x1: left, x2: W - right, y1: Y(t), y2: Y(t), stroke: 'var(--line-soft)' }));
      svg.appendChild(text(left - 8, Y(t) + 4, fmt(t), { 'text-anchor': 'end', fill: 'var(--muted)', 'font-family': 'var(--mono)', 'font-size': 10.5 }));
    });
    const bw = (W - left - right) / rows.length;
    rows.forEach((x, i) => {
      const cx = left + bw * (i + 0.5);
      const m = x.summary.mean;
      const bar = Math.min(58, bw * 0.56);
      if (Number.isFinite(m)) {
        svg.appendChild(S('rect', { x: cx - bar / 2, y: Math.min(Y(m), Y(0)), width: bar, height: Math.abs(Y(0) - Y(m)), fill: x.group.color, opacity: x.group.role === 'gate' ? 0.35 : 0.72, rx: 2 }));
        if (Number.isFinite(x.summary.sd)) {
          const a = Y(m + x.summary.sd), b = Y(Math.max(ymin, m - x.summary.sd));
          svg.appendChild(S('path', { d: 'M' + cx + ' ' + a + 'V' + b + 'M' + (cx - 7) + ' ' + a + 'H' + (cx + 7) + 'M' + (cx - 7) + ' ' + b + 'H' + (cx + 7), stroke: 'var(--ink)', 'stroke-width': 1.3, fill: 'none' }));
        }
      }
      const pts = x.members.filter(w => Number.isFinite(w.value));
      pts.forEach((w, j) => {
        const dx = pts.length > 1 ? (j / (pts.length - 1) - 0.5) * Math.min(24, bar * 0.6) : 0;
        svg.appendChild(S('circle', { cx: cx + dx, cy: Y(w.value), r: 3.6, fill: w.excluded ? 'var(--panel)' : 'var(--ink)', stroke: 'var(--ink)', 'stroke-width': 1.2 },
          S('title', {}, (w.well || w.key) + ': ' + fmt(w.value) + (w.excluded ? ' (excluded)' : ''))));
      });
      const label = x.group.name;
      svg.appendChild(text(cx, H - bottom + 18, label.length > 14 ? label.slice(0, 13) + '…' : label, { 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': 11.5 }));
      if (x.group.role !== 'sample') svg.appendChild(text(cx, H - bottom + 33, x.group.role === 'control' ? 'reference' : 'gate control', { 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 10 }));
    });
    if (cm > 0 && opts.showThreshold !== false) {
      const lines = [[cm, '1× reference', 'var(--ink-2)', '5 4'], [cm * res.threshold, res.threshold + '×', 'var(--accent)', '3 3'], [cm / res.threshold, '1/' + res.threshold + '×', 'var(--accent)', '3 3']];
      lines.forEach(([v, lab, col, dash]) => {
        if (v > y1 || v < ymin) return;
        svg.appendChild(S('line', { x1: left, x2: W - right, y1: Y(v), y2: Y(v), stroke: col, 'stroke-dasharray': dash, 'stroke-width': 1.1 }));
        svg.appendChild(text(W - right - 2, Y(v) - 4, lab, { 'text-anchor': 'end', fill: col, 'font-size': 10.5, 'font-weight': 600 }));
      });
    }
    svg.appendChild(S('line', { x1: left, x2: W - right, y1: Y(0), y2: Y(0), stroke: 'var(--ink-2)' }));
    svg.appendChild(text(14, top + (H - top - bottom) / 2, res.metric.name, { transform: 'rotate(-90 14 ' + (top + (H - top - bottom) / 2) + ')', 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 11 }));
    return svg;
  }

  // ----------------------------------------------------------- drift chart
  function driftChart(res, opts) {
    opts = opts || {};
    const W = opts.width || 520, H = opts.height || 260;
    const left = 64, right = 16, top = 14, bottom = 42;
    const pts = res.wells.filter(w => w.minutes != null && Number.isFinite(w.value) && w.group && w.group.role !== 'gate');
    const svg = S('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', role: 'img', class: 'chart drift-chart', 'aria-label': res.metric.name + ' against acquisition time' });
    if (pts.length < 3) { svg.appendChild(text(W / 2, H / 2, 'No acquisition times in these files', { 'text-anchor': 'middle', fill: 'var(--muted)' })); return svg; }
    const xs = pts.map(w => w.minutes), ys = pts.map(w => w.value);
    const xt = niceTicks(0, Math.max(...xs) * 1.04, 6);
    const yt = niceTicks(Math.min(0, ...ys), Math.max(...ys) * 1.08, 5);
    const X = v => left + (v - xt[0]) / (xt[xt.length - 1] - xt[0]) * (W - left - right);
    const Y = v => top + (1 - (v - yt[0]) / (yt[yt.length - 1] - yt[0])) * (H - top - bottom);
    yt.forEach(t => {
      svg.appendChild(S('line', { x1: left, x2: W - right, y1: Y(t), y2: Y(t), stroke: 'var(--line-soft)' }));
      svg.appendChild(text(left - 8, Y(t) + 4, fmt(t), { 'text-anchor': 'end', fill: 'var(--muted)', 'font-family': 'var(--mono)', 'font-size': 10.5 }));
    });
    xt.forEach(t => svg.appendChild(text(X(t), H - bottom + 16, String(Math.round(t)), { 'text-anchor': 'middle', fill: 'var(--muted)', 'font-family': 'var(--mono)', 'font-size': 10.5 })));
    svg.appendChild(text((left + W - right) / 2, H - 6, 'minutes from first acquisition', { 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 11 }));
    const d = res.drift && res.drift.pearson;
    if (d && Number.isFinite(d.slope)) {
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      svg.appendChild(S('line', { x1: X(x0), x2: X(x1), y1: Y(d.intercept + d.slope * x0), y2: Y(d.intercept + d.slope * x1), stroke: 'var(--ink-2)', 'stroke-dasharray': '5 4', 'stroke-width': 1.3 }));
    }
    pts.forEach(w => svg.appendChild(S('circle', { cx: X(w.minutes), cy: Y(w.value), r: 4.5, fill: w.excluded ? 'var(--panel)' : w.group.color, stroke: w.group.color, 'stroke-width': 1.5 },
      S('title', {}, (w.well || w.key) + ' · ' + w.group.name + ' · ' + w.minutes.toFixed(1) + ' min · ' + fmt(w.value)))));
    return svg;
  }

  FM.charts = { foldChart, barChart, driftChart, niceTicks };
})(FM);
