/* Layout — a white page you arrange plots on, to build the figure that leaves the tool.
 *
 * Items store what to draw, never pixels: a well key, a population id, two parameter names.
 * So a page is live — adjust a gate and every plot on the page moves with it, including the
 * one well that carries its own version of that gate.
 *
 * Zoom is a CSS transform on the page; everything else works in page units, so a drag at
 * 40% and a drag at 300% land in the same place.
 */
(function (FM) {
  'use strict';
  const { h, icon, clear, toast, menu, modal } = FM.dom;
  const P = FM.plot;
  const W = () => FM.ws;

  const SNAP = 6;              // page units a dragged edge jumps to a neighbour's
  const MIN_W = 90, MIN_H = 70;

  let root = null, els = {}, zoom = 1, sel = new Set();
  let drag = null, guides = [], queue = [], raf = null;
  const canvases = new Map();  // item id → { cv, key }

  // ------------------------------------------------------------------ mount
  function mount(el) {
    root = el;
    clear(root);
    els = {};
    zoom = 1; sel = new Set(); guides = [];
    canvases.clear();
    if (!W().samples.length) {
      root.appendChild(h('div.empty', FM.brand.miniCell(), h('h2', 'Nothing to lay out yet'),
        h('p', 'Load FCS files and draw a gate or two, then build the figure here.'),
        h('button.btn.primary', { on: { click: () => FM.go('load') } }, 'Go to Load')));
      return;
    }
    els.toolbar = h('div.lay-toolbar');
    els.page = h('div.lay-page', { tabindex: 0, 'aria-label': 'Figure page' });
    els.guides = h('div.lay-guides');
    els.stage = h('div.lay-stage', els.page, els.guides);
    els.canvas = h('div.lay-canvas', els.stage);
    els.hint = h('div.lay-hint');
    root.appendChild(h('div.layout-wrap', els.toolbar, els.canvas, els.hint));
    bindCanvas();
    renderToolbar();
    renderPage();
    fitToWindow();
  }

  function unmount() {
    if (raf) raf.cancel();
    queue = [];
    root = null; els = {}; sel = new Set(); canvases.clear();
  }

  // ---------------------------------------------------------------- toolbar
  function renderToolbar() {
    const ws = W();
    clear(els.toolbar);
    const L = ws.layout();
    const n = sel.size;
    FM.dom.append(els.toolbar, [
      h('button.btn.sm.primary', { 'data-tip': 'Put plots on the page', on: { click: () => addDialog() } }, icon('plus'), 'Add plots'),
      h('button.btn.sm', { 'data-tip': 'One plot per gating step, left to right, with arrows — new gates join it as you draw them',
        on: { click: () => strategyDialog() } }, icon('strategy'), 'Gating strategy'),
      h('button.btn.sm', { 'data-tip': 'A tree of every population with its % and events', on: { click: () => addTable() } }, icon('table'), 'Add table'),
      h('button.btn.sm', { 'data-tip': 'Add a heading or a caption', on: { click: () => addText() } }, 'Add text'),
      h('button.btn.sm', { 'data-tip': 'Pack everything into a neat grid, in order', disabled: !L.items.length,
        on: { click: () => { ws.tidyLayout(); renderPage(); fitToWindow(); toast('Page tidied'); } } }, icon('grid'), 'Tidy'),
      h('span.sep'),
      h('button.btn.ghost.sm', { 'data-tip': 'Page size', on: { click: e => pageMenu(e.currentTarget) } },
        icon('file'), pageLabel(L.page), icon('down')),
      h('span.grow'),
      n ? h('span.lay-selinfo', n + ' selected') : null,
      n ? h('button.btn.ghost.sm', { 'data-tip': 'Duplicate (Ctrl+D)', on: { click: () => duplicateSel() } }, icon('copy')) : null,
      n ? h('button.btn.ghost.sm', { 'data-tip': 'Remove from the page (Delete)', on: { click: () => deleteSel() } }, icon('trash')) : null,
      n ? h('span.sep') : null,
      h('div.seg.sm.lay-zoom',
        h('button', { 'data-tip': 'Zoom out (−)', on: { click: () => setZoom(zoom / 1.25) } }, icon('minus')),
        h('button.lay-zlevel', { 'data-tip': 'Fit the page in the window (0)', on: { click: fitToWindow } }, Math.round(zoom * 100) + '%'),
        h('button', { 'data-tip': 'Zoom in (+)', on: { click: () => setZoom(zoom * 1.25) } }, icon('plus'))),
      h('button.btn.ghost.sm.icon', { 'data-tip': 'Save the page as a PNG image', disabled: !L.items.length, on: { click: exportPNG } }, icon('download')),
      h('button.btn.ghost.sm.icon', { 'data-tip': 'Print, or save as PDF', disabled: !L.items.length, on: { click: () => window.print() } }, icon('file')),
    ]);
    if (els.hint) {
      clear(els.hint);
      els.hint.appendChild(h('span.muted.small', L.items.length
        ? 'Drag to move · corners resize · shift-click to select several · double-click a plot to open it on the Gate step'
        : 'The page is empty — Gating strategy lays out every gating step with arrows; Add plots puts one plot per well.'));
    }
  }

  function pageLabel(p) {
    const presets = W().pagePresets();
    const hit = Object.keys(presets).find(k => presets[k].w === p.w && presets[k].h === p.h);
    return hit ? presets[hit].label : Math.round(p.w) + ' × ' + Math.round(p.h);
  }

  function pageMenu(anchor) {
    const ws = W(), presets = ws.pagePresets();
    menu(anchor, Object.keys(presets).map(k => ({
      label: presets[k].label,
      hint: ws.layout().page.w === presets[k].w && ws.layout().page.h === presets[k].h ? '✓' : '',
      fn: () => { ws.setPage({ w: presets[k].w, h: presets[k].h, preset: k }); renderPage(); fitToWindow(); },
    })).concat([{ label: 'Fit the page to its contents', icon: 'fit', fn: () => fitPageToContent() }]));
  }

  function fitPageToContent() {
    const ws = W(), L = ws.layout();
    if (!L.items.length) return;
    const pad = 36;
    const w = Math.ceil(Math.max.apply(null, L.items.map(i => i.x + i.w)) + pad);
    const hh = Math.ceil(Math.max.apply(null, L.items.map(i => i.y + i.h)) + pad);
    ws.setPage({ w: Math.max(240, w), h: Math.max(200, hh), preset: 'custom' });
    renderPage(); fitToWindow();
  }

  // ------------------------------------------------------------------- zoom
  function setZoom(z) {
    zoom = Math.max(0.15, Math.min(4, z));
    applyZoom();
    const lbl = els.toolbar && els.toolbar.querySelector('.lay-zlevel');
    if (lbl) lbl.textContent = Math.round(zoom * 100) + '%';
    queueAll();       // canvases re-render at the new scale so the page stays sharp
  }

  function applyZoom() {
    const L = W().layout();
    const m = 28;
    els.page.style.width = L.page.w + 'px';
    els.page.style.height = L.page.h + 'px';
    els.page.style.transform = 'scale(' + zoom + ')';
    els.stage.style.width = (L.page.w * zoom + m * 2) + 'px';
    els.stage.style.height = (L.page.h * zoom + m * 2) + 'px';
    els.page.style.left = m + 'px';
    els.page.style.top = m + 'px';
  }

  function fitToWindow() {
    const L = W().layout();
    const r = els.canvas.getBoundingClientRect();
    if (!r.width) return;
    setZoom(Math.min((r.width - 72) / L.page.w, (r.height - 72) / L.page.h, 2));
  }

  // ------------------------------------------------------------------- page
  function renderPage() {
    if (!root) return;
    const ws = W(), L = ws.layout();
    const live = new Set(L.items.map(i => i.id));
    canvases.forEach((v, k) => { if (!live.has(k)) canvases.delete(k); });
    sel = new Set(Array.from(sel).filter(id => live.has(id)));
    clear(els.page);
    L.items.forEach(it => els.page.appendChild(itemEl(it)));
    // arrows ride above the plots, in page units, so they scale with the zoom like everything else
    els.links = FM.dom.s('svg', { class: 'lay-links', width: L.page.w, height: L.page.h, 'aria-hidden': 'true' });
    els.page.appendChild(els.links);
    renderLinks();
    applyZoom();
    renderToolbar();
    queueAll();
  }

  /** A chain plot's title follows its population's name; any other plot keeps what it was given. */
  function titleOf(it) { return it.autoTitle ? FM.strategy.autoTitle(W(), it) : (it.title || ''); }

  function itemEl(it) {
    const ws = W();
    const on = sel.has(it.id);
    const el = h('div.lay-item.k-' + it.kind + (on ? '.on' : '') + (it.chain ? '.chained' : ''), {
      'data-id': it.id,
      style: { left: it.x + 'px', top: it.y + 'px', width: it.w + 'px', height: it.h + 'px' },
    });
    if (it.kind === 'text') {
      el.appendChild(h('div.lay-text', { style: { fontSize: it.size + 'px', fontWeight: String(it.weight || 600), textAlign: it.align || 'left' } }, it.text || ''));
    } else {
      const problem = ws.layoutProblem(it);
      if (problem) {
        el.appendChild(h('div.lay-broken', icon('alert'), h('span', problem),
          h('button.btn.ghost.sm', { on: { click: e => { e.stopPropagation(); ws.removeLayoutItems([it.id]); renderPage(); } } }, 'Remove')));
      } else {
        const title = it.kind === 'plot' ? titleOf(it) : '';
        if (title) el.appendChild(h('div.lay-title', title));
        const cv = h('canvas.lay-cv');
        canvases.set(it.id, { cv, key: '' });
        el.appendChild(h('div.lay-cvwrap', cv));
      }
    }
    if (on) ['nw', 'ne', 'se', 'sw'].forEach(c => el.appendChild(h('span.lay-handle.h-' + c, { 'data-h': c })));
    return el;
  }

  // ------------------------------------------------------------- rendering
  function queueAll() {
    const L = W().layout();
    queue = L.items.filter(i => (i.kind === 'plot' || i.kind === 'table') && canvases.has(i.id)).map(i => i.id);
    if (raf) raf.cancel();
    const work = () => {
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < 12) drawItem(queue.shift());
      if (queue.length) raf = FM.dom.frame(work);
    };
    raf = FM.dom.frame(work);
  }

  function titleH(it) { return it.kind === 'plot' && titleOf(it) ? 22 : 0; }

  /** Gate items for a plot as its well sees them, with the events behind each %. */
  function gateItems(it, s, L, xSpec, ySpec) {
    const ws = W();
    return ws.children(it.pop).filter(g => P.gateFits(g, it.ax, it.ay)).map(g => ws.gateFor(g, s.key))
      .map(g => ({ gate: g, outline: P.gateOutline(g, L, xSpec, ySpec), pct: ws.pct(s, g.id),
        count: it.showCount === false ? NaN : ws.count(s, g.id), selected: false }));
  }

  function drawItem(id) {
    const ws = W();
    const it = ws.layoutItem(id);
    const box = canvases.get(id);
    if (!it || !box || ws.layoutProblem(it)) return;
    if (it.kind === 'table') { drawTable(it, box); return; }
    const s = ws.sample(it.sample);
    const cvW = it.w - 2, cvH = it.h - titleH(it) - 2;
    if (cvW < 20 || cvH < 20) return;
    // supersample by the zoom so the page stays sharp when you zoom in to inspect it
    const dpr = Math.max(1.5, Math.min(3, zoom * (window.devicePixelRatio || 1)));
    const xSpec = ws.viewScale(it.pop, it.ax), ySpec = it.ay ? ws.viewScale(it.pop, it.ay) : null;
    const key = [s.key, ws.engine.stamp(s, it.pop), it.ax, it.ay, FM.transforms.specKey(xSpec), FM.transforms.specKey(ySpec),
      Math.round(cvW), Math.round(cvH), Math.round(dpr * 20), FM.ui.cmap, it.showGates, it.showPct, it.showCount,
      document.documentElement.dataset.theme || '', FM.ui.themeTick || 0].join('|');
    if (key === box.key) return;
    box.key = key;
    const L = P.layout(cvW, cvH, { square: !!it.ay, dpr, dense: cvW < 380 });
    // the page is a sheet of paper in either theme, and must look on screen exactly as it
    // prints and exports — so it is always drawn light, whatever the app is set to
    P.withLightTheme(() => {
      P.render(box.cv, L, { sample: s, idx: ws.indices(s, it.pop), x: it.ax, y: it.ay, xSpec, ySpec,
        xLabel: ws.paramLabel(it.ax), yLabel: it.ay ? ws.paramLabel(it.ay) : '', cmap: FM.ui.cmap });
      const gates = gateItems(it, s, L, xSpec, ySpec);
      if (it.showGates && gates.length) P.drawGates(box.cv.getContext('2d'), L, gates, it.showPct ? {} : { labels: false });
    });
    box.cv.style.width = cvW + 'px';
    box.cv.style.height = cvH + 'px';
  }

  function tableModel(it) { return FM.treeTable.build(W(), { mode: it.mode, value: it.value, sample: it.sample }); }

  /**
   * A table is width-driven: it scales to the width it is given, and its height follows its
   * content. That height is derived, so it is kept in step quietly rather than as an undo step.
   */
  function drawTable(it, box) {
    const ws = W();
    const dpr = Math.max(1.5, Math.min(3, zoom * (window.devicePixelRatio || 1)));
    const key = ['t', it.w, it.mode, it.value, it.sd, it.sample, Math.round(dpr * 20), box.rev || 0].join('|');
    if (key === box.key) return;
    box.key = key;
    const t = tableModel(it);
    const nat = FM.tables.size(t, { sd: it.sd });
    const w = it.w - 2, hh = Math.ceil(nat.h * w / nat.w);
    box.cv.width = Math.round(w * dpr); box.cv.height = Math.round(hh * dpr);
    box.cv.style.width = w + 'px'; box.cv.style.height = hh + 'px';
    const ctx = box.cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh);
    FM.tables.draw(ctx, t, 0, 0, w, { sd: it.sd });
    const need = hh + 2;
    if (Math.abs(it.h - need) > 1) {
      it.h = need;
      const el = els.page && els.page.querySelector('.lay-item[data-id="' + it.id + '"]');
      if (el) el.style.height = need + 'px';
      const L = ws.layout();
      if (it.y + it.h + 24 > L.page.h) { L.page.h = Math.ceil(it.y + it.h + 36); L.page.preset = 'custom'; applyZoom(); if (els.links) els.links.setAttribute('height', L.page.h); }
    }
  }

  // ------------------------------------------------------------------ arrows
  /** An item's box as drawn right now — mid-drag the element leads the document. */
  function liveBox(it) {
    const el = els.page && els.page.querySelector('.lay-item[data-id="' + it.id + '"]');
    if (!el) return it;
    const n = v => parseFloat(v);
    return { x: n(el.style.left), y: n(el.style.top), w: n(el.style.width), h: n(el.style.height) };
  }

  /**
   * Where the arrow from `gate` on plot `a` into plot `b` runs, in page units: it leaves the
   * gate (its right edge, or its bottom when the next plot sits below) and enters the next
   * plot's frame, curving so it never doubles back.
   */
  function arrowPath(a, abox, b, bbox, gate) {
    const ws = W();
    const s = ws.sample(a.sample);
    const cvW = abox.w - 2, cvH = abox.h - titleH(a) - 2;
    const PL = P.layout(cvW, cvH, { square: !!a.ay, dpr: 1, dense: cvW < 380 });
    const xSpec = ws.viewScale(a.pop, a.ax), ySpec = a.ay ? ws.viewScale(a.pop, a.ay) : null;
    const ox = abox.x + 1, oy = abox.y + titleH(a) + 1;
    let gx0 = PL.x0, gx1 = PL.x1, gy0 = PL.y0, gy1 = PL.y1;
    try {
      const o = P.gateOutline(ws.gateFor(gate, s.key), PL, xSpec, ySpec);
      if (o.type === 'range') { gx0 = o.x0; gx1 = o.x1; gy0 = (PL.y0 + PL.y1) / 2 - 10; gy1 = gy0 + 20; }
      else if (o.pts && o.pts.length) {
        gx0 = Math.min(...o.pts.map(p => p[0])); gx1 = Math.max(...o.pts.map(p => p[0]));
        gy0 = Math.min(...o.pts.map(p => p[1])); gy1 = Math.max(...o.pts.map(p => p[1]));
      }
    } catch (_) { /* fall back to the frame */ }
    const clampX = v => Math.max(PL.x0, Math.min(PL.x1, v)), clampY = v => Math.max(PL.y0, Math.min(PL.y1, v));
    gx0 = clampX(gx0); gx1 = clampX(gx1); gy0 = clampY(gy0); gy1 = clampY(gy1);
    const bTop = bbox.y + titleH(b);
    const right = bbox.x >= abox.x + abox.w - 12;
    let sx, sy, ex, ey, c1, c2;
    if (right) {
      sx = ox + gx1; sy = oy + (gy0 + gy1) / 2;
      ex = bbox.x - 2; ey = bTop + (bbox.h - titleH(b)) * 0.45;
      const dx = Math.max(24, (ex - sx) * 0.5);
      c1 = [sx + dx, sy]; c2 = [ex - dx, ey];
    } else {
      sx = ox + (gx0 + gx1) / 2; sy = oy + gy1;
      ex = bbox.x + bbox.w / 2; ey = bbox.y - 2;
      const dy = Math.max(24, (ey - sy) * 0.5);
      c1 = [sx, sy + dy]; c2 = [ex, ey - dy];
    }
    // arrowhead along the final tangent
    const ang = Math.atan2(ey - c2[1], ex - c2[0]);
    const hl = 8, hw = 4.2;
    const head = [[ex, ey], [ex - hl * Math.cos(ang) + hw * Math.sin(ang), ey - hl * Math.sin(ang) - hw * Math.cos(ang)],
      [ex - hl * Math.cos(ang) - hw * Math.sin(ang), ey - hl * Math.sin(ang) + hw * Math.cos(ang)]];
    const tip = [ex - hl * 0.8 * Math.cos(ang), ey - hl * 0.8 * Math.sin(ang)];
    return { s: [sx, sy], c1, c2, e: tip, head };
  }

  function allArrows() {
    const ws = W(), L = ws.layout();
    const gatesById = new Map(ws.doc.gates.map(g => [g.id, g]));
    const byId = new Map(L.items.map(i => [i.id, i]));
    return FM.strategy.links(L.items, gatesById).map(k => {
      const a = byId.get(k.from), b = byId.get(k.to), g = gatesById.get(k.gate);
      if (!a || !b || !g || ws.layoutProblem(a) || ws.layoutProblem(b)) return null;
      return arrowPath(a, liveBox(a), b, liveBox(b), g);
    }).filter(Boolean);
  }

  const ARROW = '#363c4e';

  function renderLinks() {
    if (!els.links) return;
    const S = FM.dom.s;
    while (els.links.firstChild) els.links.removeChild(els.links.firstChild);
    let arrows = [];
    try { arrows = allArrows(); } catch (e) { console.error(e); }
    arrows.forEach(a => {
      els.links.appendChild(S('circle', { cx: a.s[0], cy: a.s[1], r: 2.4, fill: ARROW }));
      els.links.appendChild(S('path', { d: 'M' + a.s + 'C' + a.c1 + ' ' + a.c2 + ' ' + a.e, fill: 'none', stroke: ARROW, 'stroke-width': 1.5, 'stroke-linecap': 'round' }));
      els.links.appendChild(S('path', { d: 'M' + a.head.map(p => p.join(',')).join('L') + 'Z', fill: ARROW }));
    });
  }

  function drawArrows(ctx) {
    allArrows().forEach(a => {
      ctx.fillStyle = ARROW; ctx.strokeStyle = ARROW; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(a.s[0], a.s[1], 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(a.s[0], a.s[1]); ctx.bezierCurveTo(a.c1[0], a.c1[1], a.c2[0], a.c2[1], a.e[0], a.e[1]); ctx.stroke();
      ctx.beginPath(); a.head.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
    });
  }

  // -------------------------------------------------------------- pointers
  function pagePos(e) {
    const r = els.page.getBoundingClientRect();
    return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom];
  }

  function bindCanvas() {
    els.canvas.addEventListener('pointerdown', onDown);
    els.canvas.addEventListener('pointermove', onMove);
    els.canvas.addEventListener('pointerup', onUp);
    els.canvas.addEventListener('pointercancel', onUp);
    els.canvas.addEventListener('dblclick', onDbl);
    els.canvas.addEventListener('contextmenu', onContext);
    els.canvas.addEventListener('wheel', e => {
      if (!(e.ctrlKey || e.metaKey)) return;         // plain wheel scrolls the page, as expected
      e.preventDefault();
      setZoom(zoom * Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }

  function itemAt(e) {
    const el = e.target.closest ? e.target.closest('.lay-item') : null;
    return el ? W().layoutItem(el.dataset.id) : null;
  }

  function onDown(e) {
    if (e.button !== 0) return;
    els.page.focus({ preventScroll: true });
    const handle = e.target.classList && e.target.classList.contains('lay-handle') ? e.target.dataset.h : null;
    const it = itemAt(e);
    const [px, py] = pagePos(e);
    if (handle && it) {
      drag = { kind: 'resize', h: handle, id: it.id, start: [px, py], orig: { x: it.x, y: it.y, w: it.w, h: it.h }, moved: false };
      capture(e);
      return;
    }
    if (it) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) { if (sel.has(it.id)) sel.delete(it.id); else sel.add(it.id); }
      else if (!sel.has(it.id)) sel = new Set([it.id]);
      const orig = {};
      W().layout().items.forEach(x => { if (sel.has(x.id)) orig[x.id] = { x: x.x, y: x.y }; });
      drag = { kind: 'move', start: [px, py], orig, moved: false };
      capture(e);
      renderSelection();
      return;
    }
    // empty page: marquee
    sel = new Set();
    drag = { kind: 'marquee', start: [px, py], moved: false };
    capture(e);
    renderSelection();
  }

  function capture(e) { try { els.canvas.setPointerCapture(e.pointerId); } catch (_) { /* fine without */ } }

  function onMove(e) {
    if (!drag) return;
    const [px, py] = pagePos(e);
    const dx = px - drag.start[0], dy = py - drag.start[1];
    if (Math.abs(dx) + Math.abs(dy) > 1.5) drag.moved = true;
    if (!drag.moved) return;
    if (drag.kind === 'move') {
      const snapped = snapMove(dx, dy);
      Object.keys(drag.orig).forEach(id => {
        const el = els.page.querySelector('.lay-item[data-id="' + id + '"]');
        if (el) { el.style.left = (drag.orig[id].x + snapped[0]) + 'px'; el.style.top = (drag.orig[id].y + snapped[1]) + 'px'; }
      });
      drag.delta = snapped;
      renderLinks();   // arrows follow the plots while they move
    } else if (drag.kind === 'resize') {
      const o = drag.orig, hd = drag.h;
      let x = o.x, y = o.y, w = o.w, hh = o.h;
      if (hd.indexOf('e') >= 0) w = Math.max(MIN_W, o.w + dx);
      if (hd.indexOf('s') >= 0) hh = Math.max(MIN_H, o.h + dy);
      if (hd.indexOf('w') >= 0) { w = Math.max(MIN_W, o.w - dx); x = o.x + (o.w - w); }
      if (hd.indexOf('n') >= 0) { hh = Math.max(MIN_H, o.h - dy); y = o.y + (o.h - hh); }
      drag.box = { x, y, w, h: hh };
      const el = els.page.querySelector('.lay-item[data-id="' + drag.id + '"]');
      if (el) { el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.width = w + 'px'; el.style.height = hh + 'px'; }
      renderLinks();
    } else if (drag.kind === 'marquee') {
      drag.box = { x: Math.min(drag.start[0], px), y: Math.min(drag.start[1], py), w: Math.abs(dx), h: Math.abs(dy) };
      drawMarquee(drag.box);
    }
  }

  /** Nudge a move so edges and centres line up with neighbours and the page. */
  function snapMove(dx, dy) {
    const L = W().layout();
    const moving = L.items.filter(i => drag.orig[i.id]);
    const others = L.items.filter(i => !drag.orig[i.id]);
    const xs = [0, L.page.w / 2, L.page.w], ys = [0, L.page.h / 2, L.page.h];
    others.forEach(o => { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h); });
    let bx = dx, by = dy, bdx = SNAP, bdy = SNAP;
    const gl = [];
    moving.forEach(m => {
      const o = drag.orig[m.id];
      [o.x + dx, o.x + dx + m.w / 2, o.x + dx + m.w].forEach((edge, k) => {
        xs.forEach(t => { const d = Math.abs(edge - t); if (d < bdx) { bdx = d; bx = dx + (t - edge); gl.push({ v: t, axis: 'x' }); } void k; });
      });
      [o.y + dy, o.y + dy + m.h / 2, o.y + dy + m.h].forEach(edge => {
        ys.forEach(t => { const d = Math.abs(edge - t); if (d < bdy) { bdy = d; by = dy + (t - edge); gl.push({ v: t, axis: 'y' }); } });
      });
    });
    drawGuides(gl.slice(-2));
    return [bx, by];
  }

  function drawGuides(list) {
    clear(els.guides);
    const m = 28;
    list.forEach(g => els.guides.appendChild(h('div.lay-guide.' + g.axis, {
      style: g.axis === 'x' ? { left: (m + g.v * zoom) + 'px' } : { top: (m + g.v * zoom) + 'px' },
    })));
  }

  function drawMarquee(b) {
    clear(els.guides);
    const m = 28;
    els.guides.appendChild(h('div.lay-marquee', { style: {
      left: (m + b.x * zoom) + 'px', top: (m + b.y * zoom) + 'px', width: (b.w * zoom) + 'px', height: (b.h * zoom) + 'px' } }));
  }

  function onUp() {
    if (!drag) return;
    const ws = W(), d = drag;
    drag = null;
    clear(els.guides);
    if (!d.moved) { if (d.kind === 'marquee') { renderSelection(); } return; }
    if (d.kind === 'move' && d.delta) {
      const patches = {};
      Object.keys(d.orig).forEach(id => { patches[id] = { x: Math.round(d.orig[id].x + d.delta[0]), y: Math.round(d.orig[id].y + d.delta[1]) }; });
      ws.updateLayoutItems(patches, { label: 'Move item' + (Object.keys(patches).length > 1 ? 's' : '') });
    } else if (d.kind === 'resize' && d.box) {
      ws.updateLayoutItem(d.id, { x: Math.round(d.box.x), y: Math.round(d.box.y), w: Math.round(d.box.w), h: Math.round(d.box.h) }, { label: 'Resize item' });
      const b = canvases.get(d.id); if (b) b.key = '';
    } else if (d.kind === 'marquee' && d.box) {
      const b = d.box;
      sel = new Set(ws.layout().items.filter(i => i.x < b.x + b.w && i.x + i.w > b.x && i.y < b.y + b.h && i.y + i.h > b.y).map(i => i.id));
      renderSelection();
      return;
    }
    renderPage();
  }

  /** Repaint only selection chrome — a click should not re-render eighteen canvases. */
  function renderSelection() {
    els.page.querySelectorAll('.lay-item').forEach(el => {
      const on = sel.has(el.dataset.id);
      el.classList.toggle('on', on);
      el.querySelectorAll('.lay-handle').forEach(x => x.remove());
      if (on) ['nw', 'ne', 'se', 'sw'].forEach(c => el.appendChild(h('span.lay-handle.h-' + c, { 'data-h': c })));
    });
    renderToolbar();
  }

  function onDbl(e) {
    const it = itemAt(e);
    if (!it) return;
    if (it.kind === 'text') { editText(it); return; }
    if (it.kind === 'table') { onContext(e); return; }
    if (W().layoutProblem(it)) return;
    // a plot on the page is a window onto the Gate step: open exactly what it shows
    FM.setUI({ sampleKey: it.sample, popId: it.pop || null, gateId: null });
    W().setView(it.pop || null, { x: it.ax, y: it.ay || null });
    FM.go('gate');
  }

  function onContext(e) {
    const it = itemAt(e);
    if (!it) return;
    e.preventDefault();
    if (!sel.has(it.id)) { sel = new Set([it.id]); renderSelection(); }
    const ws = W();
    const set = (patch, label) => { ws.updateLayoutItem(it.id, patch, { label }); bust(it.id); renderPage(); };
    const tick = on => (on ? '✓' : '');
    const head = it.kind === 'text' ? [{ label: 'Edit text', icon: 'edit', fn: () => editText(it) }]
      : it.kind === 'table' ? [
        { label: 'One column per condition (mean ± SD)', hint: tick(it.mode === 'condition'), fn: () => set({ mode: 'condition' }, 'Table per condition') },
        { label: 'One column per well', hint: tick(it.mode === 'well'), fn: () => set({ mode: 'well' }, 'Table per well') },
        { label: 'One well only' + (ws.sample(it.sample) ? ' (' + (ws.sample(it.sample).well || it.sample) + ')' : ''), hint: tick(it.mode === 'one'),
          fn: () => set({ mode: 'one', sample: it.sample || (FM.currentSample() || {}).key }, 'Table for one well') },
        'sep',
        { label: '% of parent', hint: tick(it.value !== 'total'), fn: () => set({ value: 'parent' }, 'Table: % of parent') },
        { label: '% of all events', hint: tick(it.value === 'total'), fn: () => set({ value: 'total' }, 'Table: % of all events') },
        { label: it.sd === false ? 'Show ± SD' : 'Hide ± SD', icon: 'sigma', fn: () => set({ sd: it.sd === false }, 'Toggle SD') },
        'sep',
        { label: 'Copy the table (for Word, PowerPoint, Excel)', icon: 'copy', fn: () => copyTable(it) },
        { label: 'Save the table as CSV', icon: 'download', fn: () => { FM.io.downloadCSV(ws.doc.name + ' gating summary', FM.treeTable.toRows(tableModel(it))); toast('Gating summary saved'); } },
      ]
      : [{ label: 'Open on the Gate step', icon: 'right', fn: () => onDbl(e) },
        { label: it.showGates ? 'Hide the gates' : 'Show the gates', icon: 'polygon', fn: () => set({ showGates: !it.showGates }, 'Toggle gates') },
        { label: it.showPct ? 'Hide the percentages' : 'Show the percentages', icon: 'sigma', fn: () => set({ showPct: !it.showPct }, 'Toggle percentages') },
        { label: it.showCount === false ? 'Show event counts' : 'Hide event counts', icon: 'hist', fn: () => set({ showCount: it.showCount === false }, 'Toggle event counts') },
        it.chain ? { label: 'Take out of the gating strategy', fn: () => set({ chain: null, head: false, autoTitle: false, title: titleOf(it) }, 'Detach from the strategy') } : null];
    menu({ x: e.clientX, y: e.clientY }, head.filter(Boolean).concat([
      'sep',
      { label: 'Duplicate', icon: 'copy', hint: 'Ctrl+D', fn: duplicateSel },
      { label: 'Bring to front', fn: () => { ws.reorderLayoutItem(it.id, 'front'); renderPage(); } },
      { label: 'Send to back', fn: () => { ws.reorderLayoutItem(it.id, 'back'); renderPage(); } },
      'sep',
      { label: 'Remove from the page', icon: 'trash', danger: true, hint: 'Del', fn: deleteSel },
    ]));
  }

  /** Rich HTML for Word/PowerPoint and tab-separated text for Excel, in one clipboard write. */
  function copyTable(it) {
    const t = tableModel(it);
    FM.io.copyRich(FM.treeTable.toHTML(t, { sd: it.sd }), FM.treeTable.toTSV(FM.treeTable.toRows(t)))
      .then(() => toast('Gating summary copied — paste into Word, PowerPoint or Excel'))
      .catch(() => toast('Could not copy — use Save as CSV instead', { level: 'warn' }));
  }

  function bust(id) { const b = canvases.get(id); if (b) b.key = ''; }

  // -------------------------------------------------------------- editing
  /** The gating tree table, full width at the bottom of the page. */
  function addTable(silent) {
    const ws = W();
    if (!ws.doc.gates.length) { toast('Draw a gate first — the table summarises every gate'); return null; }
    const L = ws.layout();
    const pad = FM.workspaceUtil.PAGE_PAD;
    const bottom = L.items.length ? Math.max(...L.items.map(i => i.y + i.h)) + 24 : pad;
    const cur = FM.currentSample();
    const id = ws.addLayoutItems([{ kind: 'table', mode: 'condition', value: 'parent', sd: true, sample: cur ? cur.key : null,
      x: pad, y: Math.ceil(bottom), w: L.page.w - 2 * pad, h: FM.strategy.tableHeight(ws.doc.gates.length + 1) }], { label: 'Add the gating summary table' })[0];
    if (!silent) {
      sel = new Set([id]);
      renderPage();
      toast('Gating summary added — right-click it to show wells instead of conditions, or to copy it');
    }
    return id;
  }

  /**
   * One plot per gating step, left to right, arrows from each gate to the plot of what is
   * inside it. New gates drawn on the Gate step join the chain on their own.
   */
  function strategyDialog(preset) {
    const ws = W();
    if (!ws.doc.gates.length) { toast('Draw a gate first — the strategy is built from your gates'); return; }
    const L = ws.layout();
    const cur = FM.currentSample();
    const hasChain = L.items.some(i => i.chain);
    const hasTable = L.items.some(i => i.kind === 'table');
    const st = Object.assign({ scope: 'one', sample: cur ? cur.key : ws.samples[0].key, table: !hasTable, replace: true }, preset || {});
    const nSteps = FM.strategy.steps(ws.doc.gates).length;
    const reps = () => ws.doc.groups.map(g => ws.samplesIn(g.id).find(s => !ws.wellInfo(s.key).excluded)).filter(Boolean);

    const wellSel = h('select.input', { on: { change: e => { st.sample = e.target.value; } } },
      ws.samples.map(s => {
        const g = ws.groupOf(s.key);
        return h('option', { value: s.key, selected: s.key === st.sample }, (s.well || s.name) + (g ? ' · ' + g.name : ''));
      }));
    const count = h('span.muted.small');
    const scopeRow = (id, label, hint) => h('label.radio',
      h('input', { type: 'radio', name: 'lay-strat', checked: st.scope === id, on: { change: () => { st.scope = id; sync(); } } }),
      h('span', h('strong', label), hint ? h('span.muted.small', ' · ' + hint) : null));
    function chosen() { return st.scope === 'rows' ? reps().map(s => s.key) : [st.sample]; }
    function sync() {
      wellSel.disabled = st.scope !== 'one';
      const n = chosen().length;
      count.textContent = nSteps + ' plot' + (nSteps === 1 ? '' : 's') + (n > 1 ? ' in each of ' + n + ' rows' : '') + ', joined by arrows';
    }
    const body = h('div.col.lay-add',
      h('p.muted.small', 'Each gating step becomes one plot, read left to right, with an arrow from each gate to the plot of what is inside it. ' +
        'Gates you draw later on the Gate step are added to the end of the chain automatically. Every plot stays draggable; the arrows follow.'),
      h('div.field', h('label', 'For'),
        h('div.col.tight',
          h('div.row', scopeRow('one', 'One well'), wellSel),
          ws.doc.groups.length ? scopeRow('rows', 'One row per condition', 'its first included well') : null)),
      h('div.row.wrap',
        checkbox('Gating summary table at the bottom', st.table, v2 => { st.table = v2; }),
        hasChain ? checkbox('Replace the strategy already on the page', st.replace, v2 => { st.replace = v2; }) : null),
      count);
    sync();
    modal({
      title: 'Lay out the gating strategy',
      subtitle: 'The figure most papers put in a supplement: how each population was reached.',
      body,
      buttons: [{ label: 'Cancel' }, { label: 'Lay out', primary: true, fn: () => {
        const samples = chosen();
        if (!samples.length) { toast('No wells to lay out'); return false; }
        ws.addStrategy({ samples, table: st.table, replace: st.replace, label: 'Lay out the gating strategy' });
        sel = new Set();
        renderPage(); fitToWindow();
        toast('Gating strategy laid out — new gates will join it as you draw them');
        return true;
      } }],
    });
  }

  function addText() {
    const ws = W();
    const id = ws.addLayoutItems([{ kind: 'text', text: ws.doc.name, size: 20, y: 12 }], { label: 'Add text' })[0];
    sel = new Set([id]);
    renderPage();
    const it = ws.layoutItem(id);
    FM.dom.frame(() => editText(it));
  }

  function editText(it) {
    const el = els.page.querySelector('.lay-item[data-id="' + it.id + '"]');
    if (!el) return;
    const ta = h('textarea.lay-edit', { style: { fontSize: it.size + 'px', fontWeight: String(it.weight || 600) } });
    ta.value = it.text || '';
    const done = commit => {
      const v = ta.value;
      ta.remove();
      if (commit && v !== it.text) W().updateLayoutItem(it.id, { text: v }, { label: 'Edit text' });
      renderPage();
    };
    ta.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(true); }
    });
    ta.addEventListener('blur', () => done(true));
    el.appendChild(ta);
    ta.focus(); ta.select();
  }

  function duplicateSel() {
    const ws = W();
    if (!sel.size) return;
    const specs = ws.layout().items.filter(i => sel.has(i.id)).map(i => {
      const c = JSON.parse(JSON.stringify(i));
      delete c.id;
      c.x += 16; c.y += 16;
      return c;
    });
    const ids = ws.addLayoutItems(specs, { label: 'Duplicate' });
    sel = new Set(ids);
    renderPage();
  }

  function deleteSel() {
    const ws = W();
    if (!sel.size) return;
    const n = sel.size;
    ws.removeLayoutItems(Array.from(sel));
    sel = new Set();
    renderPage();
    toast('Removed ' + n + ' item' + (n > 1 ? 's' : '') + ' from the page', { action: { label: 'Undo', fn: () => { ws.undo(); renderPage(); } } });
  }

  // ------------------------------------------------------------ add dialog
  function addDialog(preset) {
    const ws = W();
    const params = ws.paramNames();
    const gates = FM.io.gatesInOrder();
    const cur = FM.currentSample();
    const v = ws.view(FM.ui.popId) || {};
    const st = Object.assign({
      pop: FM.ui.popId || null,
      ax: v.x || params[0],
      ay: v.y || params[1] || null,
      scope: 'all',
      group: (ws.groupOf(cur.key) || {}).id || (ws.doc.groups[0] || {}).id || null,
      sample: cur.key,
      titles: true, showGates: true, showPct: true, showCount: true,
      table: !ws.layout().items.some(i => i.kind === 'table') && ws.doc.gates.length > 0,
    }, preset || {});

    const popSel = h('select.input', { on: { change: e => { st.pop = e.target.value || null; } } },
      h('option', { value: '' }, 'All events'),
      gates.map(g => h('option', { value: g.id, selected: g.id === st.pop }, ws.gatePath(g.id).map(x => x.name).join(' › '))));
    const xSel = h('select.input', { on: { change: e => { st.ax = e.target.value; } } },
      params.map(p => h('option', { value: p, selected: p === st.ax }, ws.paramLabel(p))));
    const ySel = h('select.input', { on: { change: e => { st.ay = e.target.value === '__hist' ? null : e.target.value; } } },
      h('option', { value: '__hist' }, 'Histogram'),
      params.map(p => h('option', { value: p, selected: p === st.ay }, ws.paramLabel(p))));
    if (!st.ay) ySel.value = '__hist';

    const grpSel = h('select.input', { on: { change: e => { st.group = e.target.value; } } },
      ws.doc.groups.map(g => h('option', { value: g.id, selected: g.id === st.group }, g.name)));
    const wellSel = h('select.input', { on: { change: e => { st.sample = e.target.value; } } },
      ws.samples.map(s => h('option', { value: s.key, selected: s.key === st.sample }, s.well || s.name)));

    const count = h('span.muted.small');
    const scopeRow = (id, label, hint) => h('label.radio',
      h('input', { type: 'radio', name: 'lay-scope', checked: st.scope === id, on: { change: () => { st.scope = id; sync(); } } }),
      h('span', h('strong', label), hint ? h('span.muted.small', ' · ' + hint) : null));

    function chosen() {
      if (st.scope === 'one') return ws.samples.filter(s => s.key === st.sample);
      if (st.scope === 'group') return ws.samplesIn(st.group);
      if (st.scope === 'included') return ws.samples.filter(s => !ws.wellInfo(s.key).excluded);
      return ws.samples;
    }
    function sync() {
      grpSel.disabled = st.scope !== 'group';
      wellSel.disabled = st.scope !== 'one';
      const n = chosen().length;
      count.textContent = n + ' plot' + (n === 1 ? '' : 's') + ' will be added';
    }

    const body = h('div.col.lay-add',
      h('div.field', h('label', 'Population'), popSel),
      h('div.row2', h('div.field', h('label', 'X axis'), xSel), h('div.field', h('label', 'Y axis'), ySel)),
      h('div.field', h('label', 'One plot for…'),
        h('div.col.tight',
          scopeRow('all', 'Every well', ws.samples.length + ' wells'),
          scopeRow('included', 'Every well not excluded'),
          h('div.row', scopeRow('group', 'One condition'), grpSel),
          h('div.row', scopeRow('one', 'A single well'), wellSel))),
      h('div.row.wrap',
        checkbox('Label each plot with its well', st.titles, v2 => { st.titles = v2; }),
        checkbox('Draw the gates', st.showGates, v2 => { st.showGates = v2; }),
        checkbox('Show percentages', st.showPct, v2 => { st.showPct = v2; }),
        checkbox('Show event counts', st.showCount, v2 => { st.showCount = v2; }),
        ws.doc.gates.length ? checkbox('Gating summary table at the bottom', st.table, v2 => { st.table = v2; }) : null),
      count);
    sync();

    const m = modal({
      title: 'Add plots to the page',
      subtitle: 'Each plot stays live: adjust a gate later and the page follows, including a well with its own version.',
      body,
      buttons: [{ label: 'Cancel' }, { label: 'Add', primary: true, fn: () => {
        const list = chosen();
        if (!list.length) { toast('No wells match that choice'); return false; }
        // size them to tile the page width exactly, so the sheet is used rather than striped
        const g = ws.gridSize(st.titles);
        ws.addLayoutItems(list.map(s => {
          // a figure is read by condition, so the label carries it where the well has one
          const grp = ws.groupOf(s.key);
          const label = (s.well || s.name) + (grp && st.scope !== 'group' ? '  ' + grp.name : '');
          return { kind: 'plot', sample: s.key, pop: st.pop || null, ax: st.ax, ay: st.ay, w: g.w, h: g.h,
            title: st.titles ? label : '', showGates: st.showGates, showPct: st.showPct, showCount: st.showCount };
        }), { label: 'Add ' + list.length + ' plots' });
        if (st.table && !ws.layout().items.some(i => i.kind === 'table')) addTable(true);
        ws.tidyLayout();
        renderPage(); fitToWindow();
        toast(list.length + ' plot' + (list.length > 1 ? 's' : '') + ' added');
        return true;
      } }],
    });
    void m;
  }

  function checkbox(label, on, fn) {
    return h('label.check', h('input', { type: 'checkbox', checked: !!on, on: { change: e => fn(e.target.checked) } }), h('span', label));
  }

  // -------------------------------------------------------------- export
  function exportPNG() {
    const ws = W(), L = ws.layout();
    if (!L.items.length) return;
    const scale = 2;
    P.withLightTheme(() => {
      const out = document.createElement('canvas');
      out.width = Math.round(L.page.w * scale); out.height = Math.round(L.page.h * scale);
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
      ctx.scale(scale, scale);
      L.items.forEach(it => {
        if (it.kind === 'text') {
          ctx.fillStyle = '#141722';
          ctx.font = (it.weight || 600) + ' ' + (it.size || 15) + 'px "IBM Plex Sans", system-ui, sans-serif';
          ctx.textBaseline = 'top'; ctx.textAlign = it.align === 'center' ? 'center' : it.align === 'right' ? 'right' : 'left';
          const ax = it.align === 'center' ? it.x + it.w / 2 : it.align === 'right' ? it.x + it.w : it.x;
          String(it.text || '').split('\n').forEach((line, i) => ctx.fillText(line, ax, it.y + i * (it.size || 15) * 1.3));
          return;
        }
        if (ws.layoutProblem(it)) return;
        if (it.kind === 'table') {
          // vector text, drawn straight onto the page at export resolution
          ctx.fillStyle = '#fff'; ctx.fillRect(it.x + 1, it.y + 1, it.w - 2, it.h - 2);
          FM.tables.draw(ctx, tableModel(it), it.x + 1, it.y + 1, it.w - 2, { sd: it.sd });
          return;
        }
        const s = ws.sample(it.sample);
        const th = titleH(it);
        const cvW = it.w - 2, cvH = it.h - th - 2;
        if (cvW < 20 || cvH < 20) return;
        if (th) {
          ctx.fillStyle = '#363c4e'; ctx.font = '600 12px "IBM Plex Mono", monospace';
          ctx.textBaseline = 'top'; ctx.textAlign = 'left';
          ctx.fillText(titleOf(it), it.x + 2, it.y + 3);
        }
        const xSpec = ws.viewScale(it.pop, it.ax), ySpec = it.ay ? ws.viewScale(it.pop, it.ay) : null;
        const PL = P.layout(cvW, cvH, { square: !!it.ay, dpr: scale, dense: cvW < 380 });
        const tmp = document.createElement('canvas');
        P.render(tmp, PL, { sample: s, idx: ws.indices(s, it.pop), x: it.ax, y: it.ay, xSpec, ySpec,
          xLabel: ws.paramLabel(it.ax), yLabel: it.ay ? ws.paramLabel(it.ay) : '', cmap: FM.ui.cmap });
        if (it.showGates) P.drawGates(tmp.getContext('2d'), PL, gateItems(it, s, PL, xSpec, ySpec), it.showPct ? {} : { labels: false });
        ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, it.x + 1, it.y + th + 1, cvW, cvH);
      });
      drawArrows(ctx);
      out.toBlob(b => {
        if (!b) { toast('Could not build the image', { level: 'crit' }); return; }
        FM.dom.download(FM.io.safeName(ws.doc.name) + ' figure.png', b);
        toast('Figure saved as PNG');
      }, 'image/png');
    });
  }

  // ------------------------------------------------------------------ keys
  function onKey(e) {
    if (!root || !els.page) return false;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    // the two combos this page owns; everything below is a bare key
    if (mod && (k === 'd' || k === 'D')) { duplicateSel(); return true; }
    if (mod && (k === 'a' || k === 'A')) { sel = new Set(W().layout().items.map(i => i.id)); renderSelection(); return true; }
    if (mod || e.altKey) return false;
    if (k === 'Delete' || k === 'Backspace') { if (sel.size) { deleteSel(); return true; } return false; }
    if (k === 'Escape') { if (sel.size) { sel = new Set(); renderSelection(); return true; } return false; }
    if (k === '+' || k === '=') { setZoom(zoom * 1.25); return true; }
    if (k === '-' || k === '_') { setZoom(zoom / 1.25); return true; }
    if (k === '0') { fitToWindow(); return true; }
    if (sel.size && /^Arrow/.test(k)) {
      const d = e.shiftKey ? 10 : 1;
      const dx = k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0;
      const dy = k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0;
      const ws = W(), patches = {};
      ws.layout().items.forEach(i => { if (sel.has(i.id)) patches[i.id] = { x: i.x + dx, y: i.y + dy }; });
      ws.updateLayoutItems(patches, { label: 'Nudge', coalesce: 'nudge' });
      renderPage();
      return true;
    }
    return false;
  }

  function update(kind) {
    if (!root) return;
    if (kind === 'ws:samples') { mount(root); return; }
    if (kind === 'theme') { FM.ui.themeTick = (FM.ui.themeTick || 0) + 1; canvases.forEach(b => { b.key = ''; }); }
    if (kind === 'ws:gates' || kind === 'ws:comp' || kind === 'ws:doc' || kind === 'ws:axes' || kind === 'ws:view' || kind === 'ws:groups' || kind === 'theme') {
      canvases.forEach(b => { b.key = ''; });
      renderPage();
      return;
    }
    if (kind === 'ws:layout') { renderPage(); return; }
    if (kind === 'resize') { applyZoom(); }
  }

  /** Open the page, optionally filling it from what the Gate step is showing. */
  function open(preset) {
    FM.go('layout');
    if (preset) FM.dom.frame(() => addDialog(preset));
  }

  FM.views = FM.views || {};
  FM.views.layout = { mount, update, unmount, onKey, _zoom: () => zoom, _sel: () => sel, _add: addDialog, _png: exportPNG,
    _strategy: strategyDialog, _addTable: addTable, _arrows: () => (root ? allArrows() : []) };
  FM.openStrategy = preset => { FM.go('layout'); FM.dom.frame(() => strategyDialog(preset)); };
  FM.openLayout = open;
})(FM);
