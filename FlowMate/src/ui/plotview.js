/* Interactive plot: data canvas + overlay canvas, gate drawing and editing.
 *
 * Drafts and drags are held locally in display units and drawn every frame; the workspace
 * is updated on a short throttle (one coalesced undo step per gesture), so the plate
 * heatmap and filmstrip follow a drag without redrawing everything at 60 Hz.
 */
(function (FM) {
  'use strict';
  const T = FM.transforms, P = FM.plot;

  const EDGE_SNAP = 0.012;      // display units: vertices this close to the frame snap beyond it
  const BEYOND = 0.35;          // how far beyond the frame a snapped vertex goes
  const HANDLE_R = 7;

  function PlotView(host, opts) {
    this.opts = opts || {};
    this.host = host;
    this.wrap = FM.dom.h('div.plotview');
    this.dataCv = FM.dom.h('canvas.pv-data');
    this.overCv = FM.dom.h('canvas.pv-over', { tabindex: 0, 'aria-label': 'Plot. Use the gate tools to draw.' });
    this.zoomEl = FM.dom.h('div.zoom-ctl',
      FM.dom.h('button.btn.sm.icon', { 'data-tip': 'Zoom in (+ or wheel)', on: { click: () => this.zoomBy(1 / 1.5) } }, FM.dom.icon('plus')),
      FM.dom.h('button.btn.sm.icon', { 'data-tip': 'Zoom out (−)', on: { click: () => this.zoomBy(1.5) } }, FM.dom.icon('minus')),
      FM.dom.h('button.btn.sm.icon.zoom-reset', { 'data-tip': 'Show everything (0)', on: { click: () => this.resetZoom() } }, FM.dom.icon('fit')),
      FM.dom.h('span.zoom-level.mono'));
    this.wrap.append(this.dataCv, this.overCv, this.zoomEl);
    this._saveZoom = FM.dom.debounce(() => this.commitZoom(), 350);
    host.appendChild(this.wrap);
    this.draft = null;
    this.drag = null;
    this.hover = null;
    this.preview = null;       // { gateId, gate } local geometry during a drag
    this.dataKey = '';
    this.L = null;
    this._commit = FM.dom.rafThrottle(() => this._commitPreview(false));
    this._lastCommit = 0;
    this._bind();
    // the host resizes when neighbouring panels (filmstrip, wells panel) re-flow: follow it
    if (window.ResizeObserver) {
      // re-render inside the observer (before paint) so a resize never shows a stretched frame
      this._ro = new ResizeObserver(() => {
        if (!this.model) return;
        const [w, h] = this.size();
        if (this.L && w === this.L.W && h === this.L.H) return;
        this.render();
      });
      this._ro.observe(host);
    }
  }

  const PV = PlotView.prototype;

  /** model: { sample, popId, x, y|null } */
  PV.set = function (model) {
    const k = model ? (model.popId || 'root') + '|' + model.x + '|' + (model.y || '') : '';
    if (k !== this._modelKey) { this.liveZoom = null; this._zoomTouched = false; this._modelKey = k; }
    this.model = model;
    this.render();
  };

  // ------------------------------------------------------------------ zoom
  /** Zoom window stored for this plot (null = everything), valid only for the same axes. */
  PV.storedZoom = function () {
    const m = this.model, v = FM.ws.view(m.popId);
    const z = v && v.zoom;
    return z && z.x === m.x && (z.y || null) === (m.y || null) ? z.win : null;
  };
  /** Live zoom once the user has zoomed or panned this plot; otherwise the saved one. */
  PV.currentWin = function () { return this._zoomTouched ? this.liveZoom : this.storedZoom(); };

  function clampWin(w, hist) {
    const fit = (a, b) => {
      let s = Math.max(0.008, b - a);
      if (s >= 0.999) return null;
      let c = (a + b) / 2;
      a = c - s / 2; b = c + s / 2;
      if (a < -0.04) { b += -0.04 - a; a = -0.04; }
      if (b > 1.04) { a -= b - 1.04; b = 1.04; }
      return [a, b];
    };
    const X = fit(w.x0, w.x1);
    const Y = hist ? null : fit(w.y0, w.y1);
    if (!X && !Y) return null;
    return { x0: X ? X[0] : 0, x1: X ? X[1] : 1, y0: Y ? Y[0] : 0, y1: Y ? Y[1] : 1 };
  }

  PV.setWin = function (win) {
    this._zoomTouched = true;
    this.liveZoom = win;
    this.render();
    this._saveZoom();
  };

  /** Zoom by factor f (<1 in, >1 out) about display point (cx, cy), default the centre. */
  PV.zoomBy = function (f, cx, cy) {
    const w = this.currentWin() || P.FULL;
    const hist = !this.model.y;
    if (cx == null) { cx = (w.x0 + w.x1) / 2; cy = (w.y0 + w.y1) / 2; }
    const nw = { x0: cx - (cx - w.x0) * f, x1: cx + (w.x1 - cx) * f, y0: hist ? 0 : cy - (cy - w.y0) * f, y1: hist ? 1 : cy + (w.y1 - cy) * f };
    this.setWin(clampWin(nw, hist));
  };
  PV.resetZoom = function () { this.setWin(null); };

  PV.commitZoom = function () {
    const m = this.model;
    if (!m) return;
    const win = this.currentWin();
    FM.ws.setView(m.popId, { zoom: win ? { x: m.x, y: m.y || null, win } : null });
  };

  PV.size = function () {
    const r = this.host.getBoundingClientRect();
    const min = this.opts.card ? 160 : 260;
    return [Math.max(min, Math.floor(r.width)), Math.max(this.opts.card ? 150 : 220, Math.floor(r.height))];
  };

  PV.scales = function () {
    const m = this.model, ws = FM.ws;
    const xSpec = ws.viewScale(m.popId, m.x);
    const ySpec = m.y ? ws.viewScale(m.popId, m.y) : null;
    return { xSpec, ySpec, xs: T.makeScale(xSpec), ys: ySpec ? T.makeScale(ySpec) : null };
  };

  /** Gates drawable here: children of the plotted population on these axes. */
  PV.visibleGates = function () {
    const m = this.model;
    return FM.ws.children(m.popId, m.sample.key).filter(g => P.gateFits(g, m.x, m.y));
  };

  PV.render = function (force) {
    const m = this.model;
    if (!m || !m.sample) return;
    const [W, H] = this.size();
    const ws = FM.ws;
    const { xSpec, ySpec } = this.scales();
    const win = this.currentWin();
    // a worksheet card writes its axis titles on the plot; the main plot has menus for them instead
    this.L = P.layout(W, H, { square: !!m.y, axisControls: !this.opts.card, win });
    // histogram overlays: the other wells of the current well's condition
    const overlayWells = !m.y && FM.ui.overlay ? this.overlaySamples() : [];
    const key = [m.sample.key, ws.engine.stamp(m.sample, m.popId), m.x, m.y, T.specKey(xSpec), T.specKey(ySpec), FM.ui.cmap, FM.ui.dotScale, W, H,
      document.documentElement.dataset.theme || '', FM.ui.themeTick || 0, overlayWells.map(s => s.key).join(','), JSON.stringify(win)].join('|');
    if (force || key !== this.dataKey) {
      this.dataKey = key;
      const g = ws.groupOf(m.sample.key);
      const col = g ? g.color : P.theme().muted;
      this.plotModel = {
        sample: m.sample, idx: ws.indices(m.sample, m.popId), x: m.x, y: m.y, xSpec, ySpec,
        xLabel: ws.paramLabel(m.x), yLabel: m.y ? ws.paramLabel(m.y) : '', cmap: FM.ui.cmap, dotScale: FM.ui.dotScale, noTitles: !this.opts.card,
        histColor: overlayWells.length ? col : null,
        overlays: overlayWells.map((s, i) => ({ sample: s, idx: ws.indices(s, m.popId), color: col, dash: [[6, 3], [2, 2], [9, 3, 2, 3]][i % 3], key: s.key })),
      };
      P.render(this.dataCv, this.L, this.plotModel);
    }
    this.drawOverlay();
    this.placeZoom(win);
    if (this.opts.onLayout) this.opts.onLayout(this.L);
  };

  PV.placeZoom = function (win) {
    const L = this.L;
    this.zoomEl.style.left = (L.x1 - this.zoomEl.offsetWidth - 6) + 'px';
    this.zoomEl.style.top = (L.y0 + 6) + 'px';
    const lvl = win ? Math.sqrt(1 / ((win.x1 - win.x0) * (this.model.y ? (win.y1 - win.y0) : 1))) : 1;
    this.zoomEl.classList.toggle('on', !!win);
    this.zoomEl.querySelector('.zoom-level').textContent = win ? lvl.toFixed(lvl < 10 ? 1 : 0) + '×' : '';
  };

  PV.overlaySamples = function () {
    const ws = FM.ws, s = this.model.sample;
    const g = ws.groupOf(s.key);
    const pool = g ? ws.samplesIn(g.id) : ws.samples;
    return pool.filter(o => o.key !== s.key).slice(0, 7);
  };

  /** Legend for histogram overlays, top right of the plot. */
  PV.drawOverlayLegend = function (ctx) {
    const pm = this.plotModel;
    if (!pm || !pm.overlays || !pm.overlays.length) return;
    const th = P.theme(), L = this.L;
    const rows = [{ label: this.model.sample.well || this.model.sample.name, fill: true, color: pm.histColor }]
      .concat(pm.overlays.map(o => ({ label: o.sample.well || o.sample.name, dash: o.dash, color: o.color })));
    ctx.save();
    ctx.font = '11px ' + th.mono;
    const w = 88, h = rows.length * 16 + 8, x = L.x1 - w - 8, y = L.y0 + 8;
    ctx.globalAlpha = 0.92; ctx.fillStyle = th.tagBg; P.roundRect(ctx, x, y, w, h, 4); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = th.frame; ctx.lineWidth = 0.6; P.roundRect(ctx, x, y, w, h, 4); ctx.stroke();
    rows.forEach((r, i) => {
      const yy = y + 12 + i * 16;
      ctx.strokeStyle = r.color; ctx.lineWidth = r.fill ? 3 : 1.6; ctx.setLineDash(r.dash || []);
      ctx.beginPath(); ctx.moveTo(x + 8, yy); ctx.lineTo(x + 30, yy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = th.text; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillText(r.label + (r.fill ? ' ●' : ''), x + 36, yy);
    });
    ctx.restore();
  };

  // -------------------------------------------------------------- overlay
  /** Just the geometry of a gate — the one field a well is allowed to differ in. */
  function geometryOf(g) {
    return g.type === 'quad' ? { quad: g.quad } : g.type === 'polygon' ? { verts: g.verts }
      : g.type === 'ellipse' ? { ellipse: g.ellipse } : g.type === 'rect' ? { rect: g.rect } : { range: g.range };
  }

  /** The gate as this well sees it — its own version where it has one. */
  PV.resolved = function (g) { return FM.ws.gateFor(g, this.model.sample.key); };

  /**
   * Write geometry for a gate. The toolbar switch decides where it lands: on every well
   * (the default, and what this tool is for) or on the well on screen alone.
   */
  PV.applyGeometry = function (gateId, patch, opts) {
    opts = opts || {};
    const ws = FM.ws, g = ws.gate(gateId);
    if (!g) return;
    if (FM.ui.gateScope === 'well') {
      const key = this.model.sample.key;
      ws.setGateOverride(gateId, key, patch, {
        coalesce: opts.coalesce ? opts.coalesce + ':' + key : null,
        label: (opts.label || 'Adjust ' + g.name) + ' for ' + key,
      });
      return;
    }
    if (g.type === 'quad') { ws.updateQuad(g.link, patch.quad, { coalesce: opts.coalesce, label: opts.label }); return; }
    ws.updateGate(gateId, patch, { coalesce: opts.coalesce, label: opts.label });
  };

  /** The geometry to draw for g: its live preview during a drag (a quadrant moves as a set). */
  PV.gateForDraw = function (g) {
    const base = this.resolved(g);
    const pr = this.preview;
    if (!pr) return base;
    if (pr.gateId === g.id) return pr.gate;
    if (pr.gate.link && g.link === pr.gate.link) return Object.assign({}, base, { quad: pr.gate.quad });
    return base;
  };

  /** True while this gate is being dragged — the one case the cached % is behind the screen. */
  PV.isLive = function (g) {
    const pr = this.preview;
    return !!pr && (pr.gateId === g.id || (pr.gate.link && g.link === pr.gate.link));
  };

  PV.pctFor = function (g) {
    const ws = FM.ws, m = this.model;
    // only a live drag needs recomputing; a well's saved version is already in the cache
    if (this.isLive(g)) {
      this.preview.pcts = this.preview.pcts || {};
      if (this.preview.pcts[g.id] == null) {
        const parent = ws.indices(m.sample, g.parent);
        const idx = FM.gating.filter(this.gateForDraw(g), m.sample, parent);
        this.preview.pcts[g.id] = parent.length ? 100 * idx.length / parent.length : NaN;
        this.preview.counts = this.preview.counts || {};
        this.preview.counts[g.id] = idx.length;
      }
      return this.preview.pcts[g.id];
    }
    return ws.pct(m.sample, g.id);
  };

  /** Events in the gate on this well — live while it is being dragged, like its %. */
  PV.countFor = function (g) {
    if (this.isLive(g)) { this.pctFor(g); return this.preview.counts ? this.preview.counts[g.id] : NaN; }
    return FM.ws.count(this.model.sample, g.id);
  };

  PV.drawOverlay = function () {
    const L = this.L;
    if (!L) return;
    const ctx = P.sizeCanvas(this.overCv, L);
    ctx.clearRect(0, 0, L.W, L.H);
    const { xSpec, ySpec } = this.scales();
    const sel = FM.ui.gateId;
    const items = this.visibleGates().map(g => {
      const gg = this.gateForDraw(g);
      return { gate: gg, id: g.id, outline: P.gateOutline(gg, L, xSpec, ySpec), pct: this.pctFor(g), count: this.countFor(g), selected: g.id === sel, hover: this.hover && this.hover.gateId === g.id };
    });
    this.items = items;
    P.drawGates(ctx, L, items);
    const selItem = items.find(i => i.selected);
    if (selItem && FM.ui.tool === 'select') {
      const o = selItem.outline;
      let handles = [];
      if (o.type === 'polygon') handles = o.verts;
      else if (o.type === 'quad') handles = [o.center];
      else if (o.type === 'rect') handles = o.pts;
      else if (o.type === 'range') { const yb = L.y0 + 18; handles = [[o.x0, (yb + L.y1) / 2], [o.x1, (yb + L.y1) / 2]]; }
      this.handles = handles.map(p => [Math.max(L.x0, Math.min(L.x1, p[0])), Math.max(L.y0, Math.min(L.y1, p[1]))]);
      this.frame = this.frameFor(selItem);
      if (this.frame) P.drawFrame(ctx, this.frame, this.hover && this.hover.gateId === selItem.id ? this.hover.frame : -1);
      P.drawHandles(ctx, this.handles, this.hover && this.hover.gateId === selItem.id ? this.hover.vertex : -1);
    } else { this.handles = []; this.frame = null; }
    this.drawDraft(ctx);
    this.drawSuggestion(ctx, xSpec, ySpec);
    this.drawOverlayLegend(ctx);
  };

  /**
   * The resize frame around a selected 2-D gate: its bounding box on screen with 8 handles —
   * corners TL, TR, BR, BL (width and height together; Shift keeps the proportions) and the
   * middles of the top, right, bottom and left sides (only the height, or only the width).
   * A rectangle's corners are its own vertex handles, so it gets the side handles only.
   */
  const FRAME = [
    { id: 'tl', sx: -1, sy: -1, cur: 'nwse-resize' }, { id: 'tr', sx: 1, sy: -1, cur: 'nesw-resize' },
    { id: 'br', sx: 1, sy: 1, cur: 'nwse-resize' }, { id: 'bl', sx: -1, sy: 1, cur: 'nesw-resize' },
    { id: 't', sx: 0, sy: -1, cur: 'ns-resize' }, { id: 'r', sx: 1, sy: 0, cur: 'ew-resize' },
    { id: 'b', sx: 0, sy: 1, cur: 'ns-resize' }, { id: 'l', sx: -1, sy: 0, cur: 'ew-resize' },
  ];
  PV.frameFor = function (item) {
    const o = item.outline, g = item.gate;
    if (!this.model.y || !(g.type === 'polygon' || g.type === 'ellipse' || g.type === 'rect') || !o.pts || o.pts.length < 3) return null;
    const L = this.L;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    o.pts.forEach(([x, y]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; });
    // the frame is what you can grab: parts past the plot edge are pulled onto it, and it sits a
    // few pixels outside the gate so its handles never cover the gate's own (vertices, axis ends)
    const cx = v => Math.max(L.x0, Math.min(L.x1, v)), cy = v => Math.max(L.y0, Math.min(L.y1, v));
    if (cx(x1) - cx(x0) < 6 || cy(y1) - cy(y0) < 6) return null;
    const PAD = 9;
    const inner = [cx(x0), cy(y0), cx(x1), cy(y1)];
    const box = [cx(x0 - PAD), cy(y0 - PAD), cx(x1 + PAD), cy(y1 + PAD)];
    const mx = (box[0] + box[2]) / 2, my = (box[1] + box[3]) / 2;
    const at = f => [f.sx < 0 ? box[0] : f.sx > 0 ? box[2] : mx, f.sy < 0 ? box[1] : f.sy > 0 ? box[3] : my];
    const handles = FRAME.map((f, i) => ({ i, f, p: at(f) })).filter(hd => !(g.type === 'rect' && hd.f.sx && hd.f.sy));
    return { box, inner, handles };
  };

  /** A proposed gate (or quadrant), drawn dashed with its % in the current well. */
  PV.setSuggestion = function (s) { this.suggestion = s || null; this.drawOverlay(); };

  PV.drawSuggestion = function (ctx, xSpec, ySpec) {
    const sg = this.suggestion && this.suggestion.gate;
    const m = this.model;
    if (!sg || (sg.parent || null) !== (m.popId || null) || !P.gateFits(sg, m.x, m.y)) return;
    const ws = FM.ws, L = this.L;
    const gates = sg.type === 'quad' ? ['UL', 'UR', 'LL', 'LR'].map(c => Object.assign({}, sg, { corner: c, name: c })) : [sg];
    const parent = ws.indices(m.sample, m.popId);
    this.suggestion.pcts = this.suggestion.pcts || {};
    const items = gates.map(g => {
      const key = m.sample.key + ':' + (g.corner || '');
      if (this.suggestion.pcts[key] == null) {
        const n = FM.gating.filter(g, m.sample, parent).length;
        this.suggestion.pcts[key] = parent.length ? 100 * n / parent.length : NaN;
        this.suggestion.counts = this.suggestion.counts || {};
        this.suggestion.counts[key] = n;
      }
      return { gate: g, outline: P.gateOutline(g, L, xSpec, ySpec), pct: this.suggestion.pcts[key], count: (this.suggestion.counts || {})[key], selected: true,
        label: sg.type === 'quad' ? '' : 'Suggested · ' + sg.name };
    });
    ctx.save();
    ctx.setLineDash([7, 5]);
    P.drawGates(ctx, L, items, { labels: false });
    ctx.restore();
    P.drawGates(ctx, L, items, { outlines: false });
  };

  PV.drawDraft = function (ctx) {
    const d = this.draft, L = this.L;
    if (!d) return;
    const th = P.theme();
    ctx.save();
    ctx.strokeStyle = th.gateSel; ctx.fillStyle = th.gateSel; ctx.lineWidth = 1.8;
    ctx.setLineDash([5, 4]);
    if (d.type === 'polygon') {
      const pts = d.pts.map(p => P.toPx(L, p[0], p[1]));
      if (d.cursor) pts.push(P.toPx(L, d.cursor[0], d.cursor[1]));
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
      ctx.setLineDash([]);
      d.pts.forEach((p, i) => {
        const q = P.toPx(L, p[0], p[1]);
        ctx.beginPath(); ctx.arc(q[0], q[1], i === 0 ? 5 : 3, 0, Math.PI * 2);
        if (i === 0 && d.pts.length >= 3 && d.nearFirst) { ctx.fill(); } else { ctx.fillStyle = th.tagBg; ctx.fill(); ctx.stroke(); ctx.fillStyle = th.gateSel; }
      });
    } else if (d.type === 'rect' && d.b) {
      const a = P.toPx(L, d.a[0], d.a[1]), b = P.toPx(L, d.b[0], d.b[1]);
      ctx.globalAlpha = 0.08; ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      ctx.globalAlpha = 1;
      ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    } else if (d.type === 'ellipse' && d.b) {
      // the ellipse inscribed in the dragged box
      const a = P.toPx(L, d.a[0], d.a[1]), b = P.toPx(L, d.b[0], d.b[1]);
      ctx.beginPath();
      ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
      ctx.globalAlpha = 0.08; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
    } else if (d.type === 'range' && d.b != null) {
      const x0 = P.toPx(L, Math.min(d.a, d.b), 0)[0], x1 = P.toPx(L, Math.max(d.a, d.b), 0)[0];
      ctx.globalAlpha = 0.08; ctx.fillRect(x0, L.y0, x1 - x0, L.h); ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.moveTo(x0, L.y0); ctx.lineTo(x0, L.y1); ctx.moveTo(x1, L.y0); ctx.lineTo(x1, L.y1); ctx.stroke();
    }
    ctx.restore();
  };

  // ------------------------------------------------------------ geometry
  PV.eventPos = function (e) {
    const r = this.overCv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  PV.toDisplay = function (px, py) { return P.fromPx(this.L, px, py); };
  PV.inPlot = function (px, py) { const L = this.L; return px >= L.x0 && px <= L.x1 && py >= L.y0 && py <= L.y1; };

  function snapT(t) {
    if (t <= EDGE_SNAP) return -BEYOND;
    if (t >= 1 - EDGE_SNAP) return 1 + BEYOND;
    return t;
  }

  /** display → data for the current plot axes */
  PV.dataOf = function (tx, ty) {
    const { xs, ys } = this.scales();
    return [xs.inv(tx), ys ? ys.inv(ty) : null];
  };

  PV.hitTest = function (px, py) {
    const items = this.items || [];
    const sel = items.find(i => i.selected);
    if (sel && this.handles && this.handles.length) {
      for (let i = 0; i < this.handles.length; i++) {
        const h = this.handles[i];
        if (Math.hypot(px - h[0], py - h[1]) <= HANDLE_R) return { gateId: sel.id, vertex: i, kind: 'vertex' };
      }
    }
    if (sel && this.frame) {
      for (const hd of this.frame.handles) {
        if (Math.abs(px - hd.p[0]) <= HANDLE_R - 1 && Math.abs(py - hd.p[1]) <= HANDLE_R - 1) return { gateId: sel.id, frame: hd.i, kind: 'frame' };
      }
    }
    // labels first (they sit on top), then shapes; selected gate wins ties
    const order = sel ? [sel].concat(items.filter(i => i !== sel)) : items;
    for (const it of order) {
      if (it.labelBox) {
        const [bx, by, bw, bh] = it.labelBox;
        if (px >= bx && px <= bx + bw && py >= by && py <= by + bh) return { gateId: it.id, kind: 'body' };
      }
    }
    for (const it of order) {
      const o = it.outline;
      if (o.type === 'range') {
        if (Math.abs(px - o.x0) < 5) return { gateId: it.id, kind: 'edge', edge: 0 };
        if (Math.abs(px - o.x1) < 5) return { gateId: it.id, kind: 'edge', edge: 1 };
        if (px > o.x0 && px < o.x1 && py > this.L.y0 + 12) return { gateId: it.id, kind: 'body' };
      } else {
        if (P.insidePts(px, py, o.pts)) return { gateId: it.id, kind: 'body' };
        for (let i = 0; i < o.pts.length; i++) {
          if (P.distToSeg(px, py, o.pts[i], o.pts[(i + 1) % o.pts.length]).d < 4) return { gateId: it.id, kind: 'body' };
        }
      }
    }
    return null;
  };

  // --------------------------------------------------------------- events
  PV._bind = function () {
    const cv = this.overCv;
    cv.addEventListener('pointerdown', e => this.onDown(e));
    cv.addEventListener('pointermove', e => this.onMove(e));
    cv.addEventListener('pointerup', e => this.onUp(e));
    cv.addEventListener('pointercancel', e => this.onUp(e));
    cv.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = null; if (this.draft) this.draft.cursor = null; this.drawOverlay(); } });
    cv.addEventListener('dblclick', e => this.onDbl(e));
    cv.addEventListener('contextmenu', e => this.onContext(e));
    cv.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    cv.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
  };

  PV.onWheel = function (e) {
    if (!this.L) return;
    const [px, py] = this.eventPos(e);
    if (!this.inPlot(px, py)) return;
    e.preventDefault();
    const [tx, ty] = this.toDisplay(px, py);
    // pixel deltas from trackpads are small and many; line deltas from wheels are few and big
    const f = Math.exp(Math.max(-0.6, Math.min(0.6, e.deltaY * (e.deltaMode === 1 ? 0.06 : 0.0022))));
    this.zoomBy(f, tx, ty);
  };

  PV.startPan = function (e, px, py, clickDeselect) {
    this.drag = { kind: 'pan', start: [px, py], win: this.currentWin() || P.FULL, moved: false, clickDeselect };
    this.capture(e);
    this.overCv.style.cursor = 'grabbing';
  };

  PV.onDown = function (e) {
    if (!this.L) return;
    if (e.button === 1) {                      // middle button pans at any time
      e.preventDefault();
      const [px, py] = this.eventPos(e);
      if (this.inPlot(px, py)) this.startPan(e, px, py, false);
      return;
    }
    if (e.button !== 0) return;
    const [px, py] = this.eventPos(e);
    const tool = FM.ui.tool;
    const [tx, ty] = this.toDisplay(px, py);
    this.overCv.focus({ preventScroll: true });

    if (tool === 'polygon' && this.model.y) {
      if (!this.inPlot(px, py)) return;
      if (!this.draft) this.draft = { type: 'polygon', pts: [] };
      const d = this.draft;
      if (d.pts.length >= 3) {
        const f = P.toPx(this.L, d.pts[0][0], d.pts[0][1]);
        if (Math.hypot(px - f[0], py - f[1]) < 9) { this.finishDraft(); return; }
      }
      // keep draft points on the plot while drawing; edge snapping is applied when the polygon closes
      d.pts.push([Math.max(0, Math.min(1, tx)), Math.max(0, Math.min(1, ty))]);
      this.drawOverlay();
      return;
    }
    if (tool === 'quad' && this.model.y) {
      if (!this.inPlot(px, py)) return;
      const { xSpec, ySpec } = this.scales();
      const [cx, cy] = this.dataOf(tx, ty);
      const ids = FM.ws.addQuadrant({ parent: this.model.popId || null, x: this.model.x, y: this.model.y, xScale: xSpec, yScale: ySpec, cx, cy, scope: FM.newGateScope ? FM.newGateScope() : null });
      FM.setUI({ gateId: ids[1], tool: 'select' });
      FM.brand.sweep(this.host, { x: this.L.x0, y: this.L.y0, w: this.L.x1 - this.L.x0, h: this.L.y1 - this.L.y0 });
      return;
    }
    if ((tool === 'rect' || tool === 'ellipse') && this.model.y) {
      if (!this.inPlot(px, py)) return;
      this.draft = { type: tool, a: [tx, ty], b: null };
      this.drag = { kind: 'draft' };
      this.capture(e);
      return;
    }
    if (tool === 'range' && !this.model.y) {
      if (!this.inPlot(px, py)) return;
      this.draft = { type: 'range', a: tx, b: null };
      this.drag = { kind: 'draft' };
      this.capture(e);
      return;
    }
    // select tool
    const hit = this.hitTest(px, py);
    if (!hit) {
      // empty space: drag pans a zoomed plot, a plain click deselects
      if (this.inPlot(px, py)) { this.startPan(e, px, py, true); return; }
      if (FM.ui.gateId) FM.setUI({ gateId: null });
      this.drawOverlay();
      return;
    }
    if (hit.gateId !== FM.ui.gateId) FM.setUI({ gateId: hit.gateId });
    const shared = FM.ws.gate(hit.gateId);
    // a well with its own version of this gate drags from where *it* sits, not the shared shape
    const g = this.resolved(shared);
    if (e.altKey && hit.kind === 'vertex' && g.type === 'polygon') {
      if (g.verts.length > 3) this.applyGeometry(g.id, { verts: g.verts.filter((_, i) => i !== hit.vertex) }, { label: 'Remove vertex' });
      else FM.dom.toast('A polygon needs at least 3 points');
      return;
    }
    this.drag = { kind: hit.kind, gateId: g.id, vertex: hit.vertex, edge: hit.edge, frame: hit.frame, box: this.frame ? this.frame.inner.slice() : null, startPx: [px, py],
      start: [tx, ty], orig: JSON.parse(JSON.stringify(g)), moved: false };
    this.capture(e);
    this.drawOverlay();
  };

  PV.capture = function (e) {
    // capture can fail for pointers the browser no longer tracks (e.g. a pen lifted mid-gesture)
    try { this.overCv.setPointerCapture(e.pointerId); } catch (_) { /* keep going without capture */ }
  };

  PV.onMove = function (e) {
    if (!this.L) return;
    const [px, py] = this.eventPos(e);
    const [tx, ty] = this.toDisplay(px, py);
    const tool = FM.ui.tool;

    if (this.draft && this.draft.type === 'polygon') {
      this.draft.cursor = [tx, ty];
      const f = this.draft.pts[0] && P.toPx(this.L, this.draft.pts[0][0], this.draft.pts[0][1]);
      this.draft.nearFirst = f && this.draft.pts.length >= 3 && Math.hypot(px - f[0], py - f[1]) < 9;
      this.drawOverlay();
      return;
    }
    if (this.drag && this.drag.kind === 'draft') {
      const cl = v => Math.max(0, Math.min(1, v));
      if (this.draft.type === 'rect' || this.draft.type === 'ellipse') this.draft.b = [cl(tx), cl(ty)];
      else this.draft.b = cl(tx);
      this.drawOverlay();
      return;
    }
    if (this.drag && this.drag.kind === 'pan') {
      const d = this.drag, L = this.L;
      const dpx = px - d.start[0], dpy = py - d.start[1];
      if (Math.abs(dpx) + Math.abs(dpy) > 3) d.moved = true;
      if (!d.moved || !P.zoomed(Object.assign({}, L, { win: d.win }))) return;
      const sx = (d.win.x1 - d.win.x0) / (L.x1 - L.x0), sy = (d.win.y1 - d.win.y0) / (L.y1 - L.y0);
      const nw = { x0: d.win.x0 - dpx * sx, x1: d.win.x1 - dpx * sx, y0: d.win.y0 + dpy * sy, y1: d.win.y1 + dpy * sy };
      if (!this.model.y) { nw.y0 = 0; nw.y1 = 1; }
      this.liveZoom = clampWin(nw, !this.model.y);
      this._zoomTouched = true;
      this.render();
      return;
    }
    if (this.drag) { this.lastPx = [px, py]; this.dragTo(tx, ty, e); return; }

    if (tool === 'select') {
      const hit = this.hitTest(px, py);
      const prev = this.hover;
      this.hover = hit ? { gateId: hit.gateId, vertex: hit.kind === 'vertex' ? hit.vertex : -1, frame: hit.kind === 'frame' ? hit.frame : -1 } : null;
      this.overCv.style.cursor = !hit ? (P.zoomed(this.L) && this.inPlot(px, py) ? 'grab' : 'default') : hit.kind === 'vertex' ? 'grab' : hit.kind === 'frame' ? FRAME[hit.frame].cur : hit.kind === 'edge' ? 'ew-resize' : 'move';
      if (JSON.stringify(prev) !== JSON.stringify(this.hover)) this.drawOverlay();
    } else {
      this.overCv.style.cursor = 'crosshair';
    }
    if (this.opts.onHover) this.opts.onHover(this.inPlot(px, py) ? this.dataOf(tx, ty) : null);
  };

  /** Apply the current drag to a local copy of the gate. */
  PV.dragTo = function (tx, ty, e) {
    const d = this.drag;
    const g = JSON.parse(JSON.stringify(d.orig));
    const { xs, ys } = this.scales();
    const dtx = tx - d.start[0], dty = ty - d.start[1];
    if (Math.abs(dtx) + Math.abs(dty) > 0.002) d.moved = true;
    if (!d.moved) return;
    const shiftData = (x, y) => {
      // move a data point by (dtx, dty) in plot display space
      const nx = xs.inv(xs.fwd(x) + dtx);
      const ny = ys ? ys.inv(ys.fwd(y) + dty) : null;
      return [nx, ny];
    };
    if (d.kind === 'frame') {
      this.resizeTo(g, d, e);
    } else if (g.type === 'ellipse') {
      // handles sit at the ends of the axes: dragging one sets that radius and turns the ellipse;
      // the body moves the centre. Everything in the gate's own display space.
      const gx = T.makeScale(g.xScale), gy = T.makeScale(g.yScale);
      const toG = (x, y) => [gx.fwd(xs.inv(x)), gy.fwd(ys.inv(y))];
      if (d.kind === 'vertex') {
        const c = [gx.fwd(g.ellipse.cx), gy.fwd(g.ellipse.cy)];
        const p = toG(tx, ty);
        const dx = p[0] - c[0], dy = p[1] - c[1];
        const r = Math.max(0.004, Math.hypot(dx, dy));
        const ang = Math.atan2(dy, dx);
        // handles: 0 +major, 1 +minor, 2 −major, 3 −minor
        if (d.vertex === 0 || d.vertex === 2) g.ellipse = Object.assign({}, g.ellipse, { rx: r, angle: d.vertex === 0 ? ang : ang - Math.PI });
        else g.ellipse = Object.assign({}, g.ellipse, { ry: r, angle: d.vertex === 1 ? ang - Math.PI / 2 : ang + Math.PI / 2 });
      } else if (d.kind === 'body') {
        const c = shiftData(d.orig.ellipse.cx, d.orig.ellipse.cy);
        g.ellipse = Object.assign({}, d.orig.ellipse, { cx: c[0], cy: c[1] });
      }
    } else if (g.type === 'quad') {
      // the centre handle follows the pointer; dragging a quadrant's body shifts the crosshair
      if (d.kind === 'vertex') g.quad = { cx: xs.inv(tx), cy: ys.inv(ty) };
      else g.quad = { cx: xs.inv(xs.fwd(d.orig.quad.cx) + dtx), cy: ys.inv(ys.fwd(d.orig.quad.cy) + dty) };
    } else if (d.kind === 'vertex') {
      const [sx, sy] = [snapT(tx), snapT(ty)];
      const nx = xs.inv(sx), ny = ys ? ys.inv(sy) : null;
      if (g.type === 'polygon') g.verts[d.vertex] = [nx, ny];
      else if (g.type === 'rect') {
        // handles run bottom-left, bottom-right, top-right, top-left in outline order
        const r = g.rect;
        const lo = { x: Math.min(r.x0, r.x1), X: Math.max(r.x0, r.x1), y: Math.min(r.y0, r.y1), Y: Math.max(r.y0, r.y1) };
        const i = d.vertex;
        if (i === 0) { lo.x = nx; lo.y = ny; } else if (i === 1) { lo.X = nx; lo.y = ny; } else if (i === 2) { lo.X = nx; lo.Y = ny; } else { lo.x = nx; lo.Y = ny; }
        g.rect = { x0: lo.x, x1: lo.X, y0: lo.y, y1: lo.Y };
      } else if (g.type === 'range') {
        if (d.vertex === 0) g.range.lo = nx; else g.range.hi = nx;
      }
    } else if (d.kind === 'edge' && g.type === 'range') {
      const nx = xs.inv(snapT(tx));
      if (d.edge === 0) g.range.lo = nx; else g.range.hi = nx;
    } else if (d.kind === 'body') {
      if (g.type === 'polygon') g.verts = d.orig.verts.map(([x, y]) => shiftData(x, y));
      else if (g.type === 'rect') {
        const a = shiftData(d.orig.rect.x0, d.orig.rect.y0), b = shiftData(d.orig.rect.x1, d.orig.rect.y1);
        g.rect = { x0: a[0], y0: a[1], x1: b[0], y1: b[1] };
      } else if (g.type === 'range') {
        g.range = { lo: shiftData(d.orig.range.lo, 0)[0], hi: shiftData(d.orig.range.hi, 0)[0] };
      }
    }
    // a polygon drawn on other axes keeps its own scale: vertices are data, so this stays exact
    this.preview = { gateId: d.gateId, gate: g, pcts: null };
    this.drawOverlay();
    this._commit();
  };

  /**
   * Resize `g` (a copy of d.orig) by the frame handle being dragged: the opposite corner or side
   * stays put; a side handle scales one axis, a corner both (Shift: the same factor, keeping the
   * proportions). Scaling is in the plot's display space, the space the frame is drawn in.
   */
  PV.resizeTo = function (g, d, e) {
    // b is the gate's own box (the handles sit a little outside it): the side being dragged moves
    // by as much as the pointer, the opposite side stays
    const f = FRAME[d.frame], b = d.box;
    const [pxp, pyp] = this.lastPx || d.startPx;
    const anchorPx = [f.sx < 0 ? b[2] : b[0], f.sy < 0 ? b[3] : b[1]];
    const handlePx = [f.sx < 0 ? b[0] : b[2], f.sy < 0 ? b[1] : b[3]];
    const MIN = 0.03;
    let sx = f.sx ? (handlePx[0] + pxp - d.startPx[0] - anchorPx[0]) / (handlePx[0] - anchorPx[0]) : 1;
    let sy = f.sy ? (handlePx[1] + pyp - d.startPx[1] - anchorPx[1]) / (handlePx[1] - anchorPx[1]) : 1;
    if (f.sx && f.sy && e && e.shiftKey) { const s = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy; sx = sy = s; }   // follow the axis moved more
    sx = Math.max(MIN, sx); sy = Math.max(MIN, sy);
    const [ax, ay] = this.toDisplay(anchorPx[0], anchorPx[1]);
    const { xs, ys } = this.scales();
    const mapT = (x, y) => [Number.isFinite(x) ? xs.inv(ax + sx * (xs.fwd(x) - ax)) : x, Number.isFinite(y) ? ys.inv(ay + sy * (ys.fwd(y) - ay)) : y];
    const o = d.orig;
    if (g.type === 'polygon') g.verts = o.verts.map(([x, y]) => mapT(x, y));
    else if (g.type === 'rect') {
      const a = mapT(o.rect.x0, o.rect.y0), c = mapT(o.rect.x1, o.rect.y1);
      g.rect = { x0: a[0], y0: a[1], x1: c[0], y1: c[1] };
    } else if (g.type === 'ellipse') {
      // in the ellipse's own display space: the anchor goes there through data; the shape
      // S·R·diag(rx, ry) is an ellipse again — its axes are the eigenvectors of M Mᵀ
      const gx = T.makeScale(o.xScale), gy = T.makeScale(o.yScale);
      const A = [gx.fwd(xs.inv(ax)), gy.fwd(ys.inv(ay))];
      const E = o.ellipse, c0 = [gx.fwd(E.cx), gy.fwd(E.cy)];
      const c = [A[0] + sx * (c0[0] - A[0]), A[1] + sy * (c0[1] - A[1])];
      const ca = Math.cos(E.angle || 0), sa = Math.sin(E.angle || 0), rx = Math.abs(E.rx), ry = Math.abs(E.ry);
      const m = [[sx * ca * rx, -sx * sa * ry], [sy * sa * rx, sy * ca * ry]];
      const p = m[0][0] * m[0][0] + m[0][1] * m[0][1], q = m[0][0] * m[1][0] + m[0][1] * m[1][1], r = m[1][0] * m[1][0] + m[1][1] * m[1][1];
      const mid = (p + r) / 2, dd = Math.sqrt(((p - r) / 2) ** 2 + q * q);
      const angle = 0.5 * Math.atan2(2 * q, p - r);
      g.ellipse = { cx: gx.inv(c[0]), cy: gy.inv(c[1]), rx: Math.sqrt(Math.max(1e-12, mid + dd)), ry: Math.sqrt(Math.max(1e-12, mid - dd)), angle };
    }
  };

  PV._commitPreview = function (final) {
    if (!this.preview) return;
    const now = performance.now();
    // pace intermediate commits by what a full re-render costs: ~90 ms on a small plate,
    // longer on a big one, so a drag stays smooth either way (the final commit is immediate)
    const interval = Math.max(90, 2.5 * (FM.ui.lastRenderMs || 0));
    if (!final && now - this._lastCommit < interval) { this._commit(); return; }
    this._lastCommit = now;
    const g = this.preview.gate;
    const patch = geometryOf(g);
    this.applyGeometry(this.preview.gateId, patch,
      { coalesce: 'drag:' + this.preview.gateId + ':' + this.dragSerial, label: 'Adjust ' + g.name });
  };

  PV.onUp = function (e) {
    if (this.drag && this.drag.kind === 'pan') {
      const d = this.drag;
      this.drag = null;
      this.overCv.style.cursor = 'default';
      if (d.moved) this._saveZoom();
      else if (d.clickDeselect && FM.ui.gateId) FM.setUI({ gateId: null });
      return;
    }
    if (this.drag && this.drag.kind === 'draft') {
      this.drag = null;
      const d = this.draft;
      if ((d.type === 'rect' || d.type === 'ellipse') && d.b && Math.abs(d.b[0] - d.a[0]) > 0.01 && Math.abs(d.b[1] - d.a[1]) > 0.01) this.finishDraft();
      else if (d.type === 'range' && d.b != null && Math.abs(d.b - d.a) > 0.005) this.finishDraft();
      else { this.draft = null; this.drawOverlay(); }
      return;
    }
    if (this.drag) {
      const moved = this.drag.moved;
      this.drag = null;
      if (moved && this.preview) this._commitPreview(true);
      this.preview = null;
      this.dragSerial = (this.dragSerial || 0) + 1;
      this.drawOverlay();
    }
  };

  PV.onDbl = function (e) {
    const [px, py] = this.eventPos(e);
    if (FM.ui.tool === 'polygon' && this.draft) { this.finishDraft(); return; }
    const hit = this.hitTest(px, py);
    if (!hit) return;
    const g = this.resolved(FM.ws.gate(hit.gateId));
    // double-click an edge of the selected polygon: insert a vertex there
    if (g.type === 'polygon' && hit.gateId === FM.ui.gateId) {
      const it = (this.items || []).find(i => i.id === g.id);
      const o = it && it.outline;
      if (o && !o.curved) {
        for (let i = 0; i < o.verts.length; i++) {
          const a = o.verts[i], b = o.verts[(i + 1) % o.verts.length];
          if (P.distToSeg(px, py, a, b).d < 5) {
            const [tx, ty] = this.toDisplay(px, py);
            const verts = g.verts.slice();
            verts.splice(i + 1, 0, this.dataOf(tx, ty));
            this.applyGeometry(g.id, { verts }, { label: 'Add vertex' });
            return;
          }
        }
      }
    }
    if (this.opts.onDrill) this.opts.onDrill(hit.gateId);
  };

  PV.onContext = function (e) {
    const [px, py] = this.eventPos(e);
    const hit = this.hitTest(px, py);
    if (!hit || !this.opts.onGateMenu) return;
    e.preventDefault();
    FM.setUI({ gateId: hit.gateId });
    this.opts.onGateMenu(hit.gateId, { x: e.clientX, y: e.clientY });
  };

  // --------------------------------------------------------------- drafts
  PV.cancelDraft = function () { if (this.draft) { this.draft = null; this.drawOverlay(); return true; } return false; };
  PV.undoDraftPoint = function () {
    if (this.draft && this.draft.type === 'polygon' && this.draft.pts.length) {
      this.draft.pts.pop();
      if (!this.draft.pts.length) this.draft = null;
      this.drawOverlay();
      return true;
    }
    return false;
  };

  PV.finishDraft = function () {
    const d = this.draft;
    if (!d) return false;
    const m = this.model, ws = FM.ws;
    const { xSpec, ySpec } = this.scales();
    const clone = o => JSON.parse(JSON.stringify(o));
    let gate = null;
    if (d.type === 'polygon') {
      if (d.pts.length < 3) { FM.dom.toast('A polygon needs at least 3 points'); return false; }
      gate = { type: 'polygon', verts: d.pts.map(([tx, ty]) => this.dataOf(snapT(tx), snapT(ty))) };
    } else if (d.type === 'rect') {
      const a = [snapT(d.a[0]), snapT(d.a[1])], b = [snapT(d.b[0]), snapT(d.b[1])];
      const p = this.dataOf(a[0], a[1]), q = this.dataOf(b[0], b[1]);
      gate = { type: 'rect', rect: { x0: Math.min(p[0], q[0]), x1: Math.max(p[0], q[0]), y0: Math.min(p[1], q[1]), y1: Math.max(p[1], q[1]) } };
    } else if (d.type === 'range') {
      const lo = this.dataOf(snapT(Math.min(d.a, d.b)), 0)[0], hi = this.dataOf(snapT(Math.max(d.a, d.b)), 0)[0];
      gate = { type: 'range', range: { lo, hi } };
    } else if (d.type === 'ellipse') {
      // inscribed in the dragged box: centre in data units, radii in this plot's display units
      const c = this.dataOf((d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2);
      gate = { type: 'ellipse', ellipse: { cx: c[0], cy: c[1], rx: Math.abs(d.b[0] - d.a[0]) / 2, ry: Math.abs(d.b[1] - d.a[1]) / 2, angle: 0 } };
    }
    this.draft = null;
    Object.assign(gate, { parent: m.popId || null, x: m.x, y: m.y || null, xScale: clone(xSpec), yScale: ySpec ? clone(ySpec) : null,
      name: ws.uniqueGateName(this.opts.suggestName ? this.opts.suggestName(gate, m) : 'Gate') });
    const scope = FM.newGateScope ? FM.newGateScope() : null;
    if (scope) gate.scope = scope;
    const id = ws.addGate(gate);
    FM.setUI({ gateId: id, tool: 'select' });
    if (this.opts.onCreated) this.opts.onCreated(id);
    return true;
  };

  /** Screen position of a gate's label (for the rename popover). */
  PV.labelAnchor = function (gateId) {
    const it = (this.items || []).find(i => i.id === gateId);
    const r = this.overCv.getBoundingClientRect();
    if (it && it.labelBox) return { x: r.left + it.labelBox[0], y: r.top + it.labelBox[1] + it.labelBox[3] };
    return { x: r.left + r.width / 2, y: r.top + 40 };
  };

  PV.exportPNG = function () {
    const c = document.createElement('canvas');
    c.width = this.dataCv.width; c.height = this.dataCv.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = P.theme().tagBg; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(this.dataCv, 0, 0);
    ctx.drawImage(this.overCv, 0, 0);
    return c.toDataURL('image/png');
  };

  PV.destroy = function () { if (this._ro) this._ro.disconnect(); this.wrap.remove(); };

  FM.PlotView = PlotView;
})(FM);
