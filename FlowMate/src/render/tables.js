/* The gating tree table, drawn on canvas.
 *
 * One renderer serves the Layout page and its PNG export, so what is on screen is exactly
 * what leaves the tool. It is laid out at a natural size (measured text), then scaled to
 * the width it is given: a table on a figure page behaves like an image — drag it wider
 * and everything grows together.
 *
 * Booktabs style: a rule above and below, a thin one under the header, no cell borders.
 * Paper colours always, like everything on the figure page.
 */
(function (FM) {
  'use strict';

  const INK = '#141722', INK2 = '#363c4e', MUTED = '#687087', FAINT = '#9ea4b6', RULE = '#141722', SOFT = '#e3e6ee';
  const WARN = '#a8660f';
  const SANS = '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif';
  const PAD = 10, ROW_H = 31, INDENT = 14, COL_PAD = 16;

  function font(w, px) { return w + ' ' + px + 'px ' + SANS; }

  function wrap(ctx, text, width) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    words.forEach(w => {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > width && line) { lines.push(line); line = w; } else line = t;
    });
    if (line) lines.push(line);
    return lines;
  }

  /** Where everything goes at scale 1. */
  function measure(ctx, t, opts) {
    opts = opts || {};
    const texts = t.rows.map(r => r.cells.map(c => FM.treeTable.cellText(t, r, c, opts)));
    ctx.font = font(500, 12);
    const nameW = Math.max(110, ...t.rows.map(r => ctx.measureText(r.name).width + r.depth * INDENT + 8));
    const colW = t.cols.map((c, j) => {
      ctx.font = font(600, 11.5);
      let w = ctx.measureText(c.label).width + (c.color ? 14 : 0);
      ctx.font = font(400, 10);
      w = Math.max(w, c.sub ? ctx.measureText(c.sub).width : 0);
      texts.forEach(row => {
        const x = row[j];
        ctx.font = font(500, 11.5);
        const pw = x.pct ? ctx.measureText(x.pct).width : 0;
        ctx.font = font(600, 9);
        const mw = x.marks ? ctx.measureText(x.marks).width + 2 : 0;
        ctx.font = font(400, 10.5);
        w = Math.max(w, pw + mw, ctx.measureText(x.events).width);
      });
      return Math.ceil(w + COL_PAD);
    });
    const width = Math.ceil(PAD + nameW + colW.reduce((a, b) => a + b, 0) + PAD);
    const caption = opts.caption !== false;
    ctx.font = font(400, 9.5);
    const notes = [];
    FM.treeTable.notes(t).forEach(n => wrap(ctx, n, Math.max(260, width - 2 * PAD)).forEach(l => notes.push(l)));
    const top = PAD + (caption ? 18 : 0);
    const headH = t.cols.some(c => c.sub) ? 34 : 22;
    const bodyTop = top + headH + 4;
    const height = Math.ceil(bodyTop + t.rows.length * ROW_H + 8 + notes.length * 13 + PAD);
    return { texts, nameW, colW, width, height, top, headH, bodyTop, notes, caption };
  }

  function captionText(t) {
    const what = t.value === 'total' ? '% of all events' : '% of parent';
    return 'Gating summary · ' + what + (t.averaged ? ' (mean ± SD) · events per well (mean)' : ' · events');
  }

  /**
   * Draw table `t` into `ctx` at (x, y), scaled to `width` css px (or natural size when omitted).
   * Returns { w, h, scale } — the size it actually took.
   */
  function draw(ctx, t, x, y, width, opts) {
    opts = opts || {};
    const M = measure(ctx, t, opts);
    const s = width ? Math.max(0.3, Math.min(3, width / M.width)) : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.textBaseline = 'alphabetic';

    if (M.caption) {
      ctx.fillStyle = INK2; ctx.font = font(600, 11); ctx.textAlign = 'left';
      ctx.fillText(captionText(t), PAD, PAD + 10);
    }
    const x0 = PAD, x1 = M.width - PAD;
    const rule = (yy, w) => { ctx.strokeStyle = RULE; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke(); };
    rule(M.top, 1.2);

    // ---- header
    let cx = x0 + M.nameW;
    ctx.textAlign = 'left'; ctx.fillStyle = MUTED; ctx.font = font(600, 10.5);
    ctx.fillText('Population', x0 + 2, M.top + 16);
    t.cols.forEach((c, j) => {
      const right = cx + M.colW[j];
      ctx.textAlign = 'right';
      ctx.fillStyle = INK; ctx.font = font(600, 11.5);
      ctx.fillText(c.label, right - 2, M.top + 16);
      if (c.color) {
        const lw = ctx.measureText(c.label).width;
        ctx.fillStyle = c.color;
        ctx.fillRect(right - 2 - lw - 13, M.top + 7, 9, 9);
      }
      if (c.sub) { ctx.fillStyle = MUTED; ctx.font = font(400, 10); ctx.fillText(c.sub, right - 2, M.top + 29); }
      cx = right;
    });
    rule(M.top + M.headH, 0.7);

    // ---- body
    const parentRow = [];
    t.rows.forEach((r, i) => {
      const top = M.bodyTop + i * ROW_H;
      const mid = top + ROW_H / 2;
      if (i % 2 === 1) { ctx.fillStyle = '#f6f7fa'; ctx.fillRect(x0, top, x1 - x0, ROW_H); }
      // tree connectors: a quiet elbow from the parent's row to this one
      if (r.depth > 0) {
        let p = i - 1;
        while (p >= 0 && t.rows[p].depth >= r.depth) p--;
        const px = x0 + 4 + (r.depth - 1) * INDENT + 3;
        const pm = p >= 0 ? M.bodyTop + p * ROW_H + ROW_H / 2 + 5 : top;
        ctx.strokeStyle = FAINT; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(px, pm); ctx.lineTo(px, mid); ctx.lineTo(px + INDENT - 5, mid); ctx.stroke();
      }
      parentRow.push(mid);
      ctx.textAlign = 'left';
      ctx.fillStyle = INK; ctx.font = font(r.depth ? 500 : 600, 12);
      ctx.fillText(r.name, x0 + 4 + r.depth * INDENT, mid + 4);
      let cx2 = x0 + M.nameW;
      r.cells.forEach((c, j) => {
        const right = cx2 + M.colW[j] - 2;
        const txt = M.texts[i][j];
        ctx.textAlign = 'right';
        if (txt.pct) {
          let rr = right;
          if (txt.marks) {
            ctx.font = font(600, 9); ctx.fillStyle = c.mark ? WARN : MUTED;
            ctx.fillText(txt.marks, rr, top + 11);
            rr -= ctx.measureText(txt.marks).width + 2;
          }
          ctx.fillStyle = INK; ctx.font = font(500, 11.5);
          ctx.fillText(txt.pct, rr, top + 14);
          ctx.fillStyle = MUTED; ctx.font = font(400, 10.5);
          ctx.fillText(txt.events, right, top + 27);
        } else {
          ctx.fillStyle = INK2; ctx.font = font(500, 11);
          ctx.fillText(txt.events, right, mid + 4);
        }
        cx2 += M.colW[j];
      });
    });
    const bottom = M.bodyTop + t.rows.length * ROW_H + 2;
    rule(bottom, 1.2);
    ctx.textAlign = 'left'; ctx.fillStyle = MUTED; ctx.font = font(400, 9.5);
    M.notes.forEach((l, k) => ctx.fillText(l, x0, bottom + 15 + k * 13));
    ctx.restore();
    void SOFT;
    return { w: M.width * s, h: M.height * s, scale: s, natural: { w: M.width, h: M.height } };
  }

  /** Natural size only, for sizing an item before it is drawn. */
  function size(t, opts) {
    const c = document.createElement('canvas').getContext('2d');
    const M = measure(c, t, opts);
    return { w: M.width, h: M.height };
  }

  FM.tables = { draw, size, captionText };
})(FM);
