/* Step 3 — Gate: population tree · interactive plot · live results across every well · filmstrip. */
(function (FM) {
  'use strict';
  const { h, icon, clear, fmtPct, fmtCount, menu, popover, toast } = FM.dom;
  const P = FM.plot, T = FM.transforms;
  const W = () => FM.ws;

  const ADJ_MARK = '✦';     // the one mark that means "this well uses its own version"

  let root = null, pv = null;
  let els = {};
  let thumbs = new Map();       // sample key → { el, data, over, dataKey }
  let thumbQueue = [];
  let thumbRaf = null;
  let stripOpen = true;
  let hoverData = null;
  let suggestion = null;        // { s, key } — a proposed gate for the current plot
  const dismissedNext = new Set();

  // ------------------------------------------------------------ plot state
  function defaultAxes(popId) {
    const ws = W();
    const names = ws.paramNames();
    const kids = ws.children(popId).filter(k => k.x);
    const sel = FM.ui.gateId ? ws.gate(FM.ui.gateId) : null;
    if (sel && sel.x && (sel.parent || null) === (popId || null)) return { x: sel.x, y: sel.y };
    if (kids.length) return { x: kids[0].x, y: kids[0].y };
    const fsc = names.find(n => /^FSC-?A$/i.test(n)) || names.find(n => /^FSC/i.test(n));
    const ssc = names.find(n => /^SSC-?A$/i.test(n)) || names.find(n => /^SSC/i.test(n));
    if (!popId && fsc && ssc) return { x: fsc, y: ssc };
    const fl = names.find(n => !/^(FSC|SSC|TIME)/i.test(n) && !/WIDTH/i.test(n));
    if (fl && ssc) return { x: fl, y: ssc };
    return { x: names[0], y: names[1] || null };
  }

  /** Normalise UI state: a selected gate is shown on its parent's plot, on its own axes. */
  function sync() {
    const ws = W();
    if (FM.ui.popId && !ws.gate(FM.ui.popId)) FM.ui.popId = null;
    if (FM.ui.gateId && !ws.gate(FM.ui.gateId)) FM.ui.gateId = null;
    const g = FM.ui.gateId ? ws.gate(FM.ui.gateId) : null;
    if (g && (g.parent || null) !== (FM.ui.popId || null)) FM.ui.popId = g.parent || null;
    let v = ws.view(FM.ui.popId);
    if (g && g.x) {
      if (!v || !P.gateFits(g, v.x, v.y)) { ws.setView(FM.ui.popId, { x: g.x, y: g.y }); v = ws.view(FM.ui.popId); }
    }
    if (!v || !v.x || !ws.paramInfo(v.x) || (v.y && !ws.samples[0].data[v.y])) {
      ws.setView(FM.ui.popId, defaultAxes(FM.ui.popId));
      v = ws.view(FM.ui.popId);
    }
    return v;
  }

  function current() {
    const s = FM.currentSample();
    const v = sync();
    return { sample: s, popId: FM.ui.popId || null, x: v.x, y: v.y || null };
  }

  // ------------------------------------------------------------------ mount
  function mount(el) {
    root = el;
    clear(root);
    if (!W().samples.length) {
      root.appendChild(h('div.empty', FM.brand.miniCell(), h('h2', 'No files yet'), h('p', 'Load FCS files, then draw gates here — each gate applies to every well at once.'),
        h('button.btn.primary', { on: { click: () => FM.go('load') } }, 'Go to Load')));
      return;
    }
    els = {};
    els.tree = h('div.tree');
    els.crumbs = h('div.crumbs');
    els.guide = h('div.guide.hidden');
    els.toolbar = h('div.pv-toolbar');
    els.plotHost = h('div.plot-host');
    els.axisX = h('div.axis-float.x');
    els.axisY = h('div.axis-float.y');
    els.axisSwap = h('div.axis-float.swap');
    els.status = h('div.pv-status');
    els.wells = h('div.wells-body');
    els.wellsHead = h('div.panel-head');
    els.strip = h('div.strip-track');
    els.stripHead = h('div.strip-head');
    els.table = h('div.gt-wrap');

    els.sheet = h('div.sheet');
    els.plotHost.appendChild(els.status);
    const plotPanel = els.plotPanel = h('section.plot-panel', els.toolbar, els.crumbs, els.guide, els.plotHost, els.sheet);
    const treePanel = h('aside.panel.tree-panel',
      h('div.panel-head', h('h3', 'Populations'), h('span.grow'),
        h('button.btn.ghost.sm', { 'data-tip': 'And / Or / Not of populations — a Boolean gate', on: { click: () => FM.combineDialog(FM.ui.gateId ? [FM.ui.gateId] : []) } }, icon('layers'), 'Combine')),
      h('div.scroll', els.tree),
      h('div.tree-foot.muted.small', 'Click a gate to edit it · double-click to open the population inside it'));
    const wellsPanel = h('aside.panel.wells-panel', els.wellsHead, h('div.scroll', els.wells));
    els.stripScroll = h('div.strip-scroll', els.strip);
    const strip = els.stripEl = h('footer.strip' + (stripOpen ? '' : '.closed') + (FM.ui.bottomTab === 'table' ? '.tabled' : ''),
      els.stripHead, els.stripScroll, els.table);

    root.appendChild(h('div.gate-wrap' + (FM.ui.focus ? '.focus' : ''), treePanel, plotPanel, wellsPanel, strip));

    pv = new FM.PlotView(els.plotHost, {
      onDrill: id => drill(id),
      onCreated: id => { measuredSweep(); renamePopover(id, true); },
      onGateMenu: (id, at) => gateMenu(id, at),
      onHover: d => { hoverData = d; renderStatus(); },
      suggestName: suggestName,
      onLayout: L => placeAxes(L),
    });
    els.plotHost.append(els.axisX, els.axisY, els.axisSwap);
    thumbs = new Map();
    renderAll();
  }

  function unmount() {
    if (thumbRaf) thumbRaf.cancel();
    thumbQueue = [];
    if (pv) pv.destroy();
    FM.gateSheet.destroy();
    pv = null; root = null; thumbs = new Map();
  }

  // the scrolling panels the step redraws: a redraw (the worksheet builds its grid anew) must leave
  // each one where the user scrolled it, not jump back to the top
  const SCROLLERS = ['.tree-panel .scroll', '.wells-panel .scroll', '.strip-scroll', '.sheet-grid', '.sheet-stats-body'];
  function keepScroll(fn) {
    const saved = SCROLLERS.map(sel => Array.from(root.querySelectorAll(sel), el => [el.scrollTop, el.scrollLeft]));
    fn();
    SCROLLERS.forEach((sel, i) => root.querySelectorAll(sel).forEach((el, j) => {
      const v = saved[i][j];
      if (v && (el.scrollTop !== v[0] || el.scrollLeft !== v[1])) { el.scrollTop = v[0]; el.scrollLeft = v[1]; }
    }));
  }

  function renderAll() {
    if (!root || !pv) return;
    const t0 = performance.now();
    keepScroll(renderAllInner);
    // panels around the plot (guide, filmstrip) settle after this pass: re-measure once they have
    FM.dom.frame(() => { if (pv) pv.render(); });
    // the plot view paces its drag commits by this, so big plates don't stutter
    FM.ui.lastRenderMs = performance.now() - t0;
  }

  function renderAllInner() {
    const m = current();
    // the per-well mode is only safe if it is impossible to miss
    if (els.plotPanel) els.plotPanel.classList.toggle('scoped', FM.ui.gateScope === 'well');
    renderToolbar(m);
    renderCrumbs(m);
    renderTree(m);
    if (suggestion && suggestion.key !== plotKey(m)) suggestion = null;
    pv.suggestion = suggestion ? suggestion.s : null;
    renderGuide(m);
    pv.set(m);
    renderSheet(m);
    renderStatus();
    renderWells(m);
    renderStrip(m);
  }

  // ---------------------------------------------------------- worksheet
  const sheetMode = () => FM.ui.gateLayout === 'sheet';
  function setLayout(v) { FM.ui.gateLayout = v; FM.savePrefs(); renderAll(); }
  const sheetCtx = {
    axesOf: pid => { const v = W().view(pid); return v && v.x ? { x: v.x, y: v.y || null } : defaultAxes(pid); },
    // double-click a gate on a card: show the population inside it, on its own card
    open: id => {
      const ws = W();
      const el = els.sheet.querySelector('.sheet-card[data-pop="' + id + '"]');
      if (el) { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); return; }
      const list = FM.gateSheet.items(ws, sheetCtx);
      const a = defaultAxes(id);
      const sheet = Object.assign({ hidden: [], size: 'm' }, ws.doc.sheet || {});
      sheet.items = list.map(it => (it.type === 'stats' ? { id: 'stats', type: 'stats' } : { id: it.id, pop: it.pop || null, x: it.x, y: it.y || null }))
        .concat([{ id: 'u:' + Date.now().toString(36), pop: id, x: a.x, y: a.y || null }]);
      ws.setSheet(sheet, 'Add plot');
    },
    created: (id, view) => { measuredSweep(); renamePopover(id, true, view); },
    gateMenu: (id, at) => gateMenu(id, at),
    suggestName: (g, model) => suggestName(g, model),
    single: it => { W().setView(it.pop || null, { x: it.x, y: it.y || null }); FM.ui.gateLayout = 'single'; FM.savePrefs(); drill(it.pop || null); },
  };
  function renderSheet(m) {
    if (!els.plotPanel) return;
    els.plotPanel.classList.toggle('sheet-mode', sheetMode());
    // the worksheet has its own statistics and every plot: the population list and the strip step aside
    const wrap = els.plotPanel.closest('.gate-wrap');
    if (wrap) wrap.classList.toggle('sheet', sheetMode());
    if (sheetMode()) FM.gateSheet.render(els.sheet, m, sheetCtx);
    else { FM.gateSheet.destroy(); clear(els.sheet); }
  }

  function plotKey(m) { return (m.popId || 'root') + '|' + m.x + '|' + (m.y || ''); }

  // ------------------------------------------------------------------ guide
  /** One line that always says what to do next on this plot. */
  function renderGuide(m) {
    const ws = W();
    clear(els.guide);
    const show = on => els.guide.classList.toggle('hidden', !on);
    if (suggestion) {
      const s = suggestion.s;
      const pct = Number.isFinite(s.pct) ? FM.dom.fmtPct(s.pct) + ' of ' + ws.popName(m.popId) + ' across wells' : '';
      FM.dom.append(els.guide, [
        h('span.guide-ic', icon('wand')),
        h('div.guide-text', h('strong', 'Suggested ' + (s.gate.type === 'quad' ? 'quadrant' : s.gate.name)), ' — ', s.explain, pct ? h('span.muted', ' · ' + pct) : null),
        h('span.grow'),
        h('button.btn.sm.primary', { on: { click: acceptSuggestion }, 'data-tip': 'Enter' }, icon('check'), 'Accept'),
        h('button.btn.sm', { on: { click: dismissSuggestion }, 'data-tip': 'Esc' }, 'Dismiss')]);
      show(true);
      return;
    }
    const gate = FM.ui.gateId ? ws.gate(FM.ui.gateId) : null;
    const kids = gate ? ws.children(gate.id) : [];
    if (FM.ui.gateScope === 'well') {
      const well = m.sample.well || m.sample.name;
      const mine = ws.adjustedGates(m.sample.key);
      FM.dom.append(els.guide, [
        h('span.guide-ic', icon('edit')),
        h('div.guide-text', h('strong', 'Editing ' + well + ' only'), ' — every other well keeps the shared gate',
          knockOn(m.sample)),
        h('span.grow'),
        mine.length ? h('button.btn.sm', { 'data-tip': 'Put ' + well + ' back on the shared gates',
          on: { click: () => resetWell(m.sample.key) } }, 'Reset ' + well) : null,
        h('button.btn.sm.primary', { on: { click: () => setScope('all') } }, 'Back to all wells')]);
      show(true);
      return;
    }
    if (!ws.doc.gates.length) {
      FM.dom.append(els.guide, [h('span.guide-ic', icon('wand')), h('span.guide-lead', 'Start by gating the cells:'),
        FM.autogate.nextSteps(ws, null).filter(o => o.label === 'Cells').map(o => stepChip(o, null)),
        h('span.muted.small', 'or pick axes and draw with P, R or Q')]);
      show(true);
      return;
    }
    if (gate && !kids.length && !dismissedNext.has(gate.id) && FM.ui.tool === 'select') {
      FM.dom.append(els.guide, [h('span.guide-ic', icon('right')), h('span.guide-lead', 'Next — gate inside ', h('strong', gate.name), ':'),
        FM.autogate.nextSteps(ws, gate.id).map(o => stepChip(o, gate.id)),
        h('button.btn.ghost.sm', { on: { click: () => drill(gate.id) }, 'data-tip': 'Open it and choose the axes yourself' }, 'Other axes…'),
        h('span.grow'),
        h('button.btn.ghost.sm.icon', { 'data-tip': 'Hide', on: { click: () => { dismissedNext.add(gate.id); renderGuide(m); } } }, icon('x'))]);
      show(true);
      return;
    }
    const here = ws.children(m.popId).filter(g => P.gateFits(g, m.x, m.y));
    if (!here.length && FM.ui.tool === 'select' && !FM.ui.gateId) {
      FM.dom.append(els.guide, [h('span.guide-ic', icon('wand')), h('span.guide-lead', 'Gate ', h('strong', ws.popName(m.popId)), ' on these axes:'),
        h('button.btn.sm.primary', { on: { click: runSuggest } }, icon('wand'), 'Suggest a gate'),
        h('span.muted.small', 'or draw one — P polygon, R rectangle, Q quadrant' + (m.y ? '' : ', H range'))]);
      show(true);
      return;
    }
    show(false);
  }

  /**
   * What this well's adjustments have done to it, live while you drag. A gate sits inside
   * its parent, so moving one moves every number below it too — that consequence belongs
   * on screen at the moment you are causing it, not only in the table afterwards.
   */
  function knockOn(sample) {
    const ws = W();
    if (!ws.anyAdjusted() || !ws.adjustedGates(sample.key).length) return null;
    const row = FM.summary.build(ws, { samples: [sample] }).rows[0];
    const moved = row.cells.filter(c => c.status !== 'shared' && Number.isFinite(c.delta) && Math.abs(c.delta) >= 0.005);
    if (!moved.length) return null;
    const bits = [];
    moved.forEach((c, i) => {
      if (i) bits.push(h('span.muted', ' · '));
      bits.push(h('span.ko' + (c.status === 'adjusted' ? '.own' : ''), { 'data-tip': c.status === 'adjusted'
        ? 'You dragged this gate on this well' : 'Moved because ' + ws.popName(c.gate.parent) + ' above it was adjusted here' },
        c.gate.name, ' ', h('b', (c.delta > 0 ? '+' : '−') + Math.abs(c.delta).toFixed(Math.abs(c.delta) < 10 ? 2 : 1))));
    });
    return h('span.ko-wrap', h('span.muted', ' · vs the shared gating: '), bits);
  }

  function stepChip(o, parentId) {
    return h('button.step-chip', { on: { click: () => openWith(parentId, o.x, o.y) }, 'data-tip': 'Plot ' + (o.y ? o.x + ' × ' + o.y : o.x + ' histogram') + ' and suggest a gate' },
      h('strong', o.label), o.sub && o.sub !== o.label ? h('span', o.sub) : null);
  }

  /** Plot population `parentId` on (x, y), framed on it, and propose a gate there. */
  function openWith(parentId, x, y) {
    const ws = W();
    if (pv) pv.cancelDraft();
    ws.setView(parentId, { x, y: y || null });
    ws.refitView(parentId, [x, y].filter(Boolean));
    FM.setUI({ popId: parentId || null, gateId: null, tool: 'select' });
    runSuggest();
  }

  function runSuggest() {
    const ws = W();
    const m = current();
    // a suggestion is fitted to the pooled plate and proposes a new gate, so it is all-wells work
    if (FM.ui.gateScope === 'well') { toast('Suggestions are fitted across the whole plate. Switch back to All wells to use one.'); return; }
    const s = FM.autogate.suggest(ws, m.popId, m.x, m.y);
    if (s.error) { suggestion = null; toast(s.error); renderAll(); return; }
    suggestion = { s, key: plotKey(m) };
    FM.setUI({ gateId: null, tool: 'select' });
  }

  function acceptSuggestion() {
    const ws = W();
    if (!suggestion) return;
    const g = suggestion.s.gate;
    suggestion = null;
    let id;
    const scope = FM.newGateScope();
    if (g.type === 'quad') {
      id = ws.addQuadrant({ parent: g.parent, x: g.x, y: g.y, xScale: g.xScale, yScale: g.yScale, cx: g.quad.cx, cy: g.quad.cy, scope })[1];
    } else id = ws.addGate(scope ? Object.assign({}, g, { scope }) : g);
    FM.setUI({ gateId: id, tool: 'select' });
    measuredSweep();
    const s = FM.currentSample();
    toast((g.type === 'quad' ? 'Quadrant' : ws.gate(id).name) + ' added to ' + (scope ? ws.scopeText(id) : 'every sample') + (g.type === 'quad' ? '' : ' — ' + FM.dom.fmtPct(ws.pct(s, id)) + ' in ' + (s.well || s.name)) + '. Drag it to adjust.');
  }

  function dismissSuggestion() { suggestion = null; renderAll(); }

  /** One laser pass over the plot: the new population has just been measured on every well. */
  function measuredSweep() {
    FM.dom.frame(() => {
      if (!pv || !pv.L) return;
      const L = pv.L;
      FM.brand.sweep(els.plotHost, { x: L.x0, y: L.y0, w: L.x1 - L.x0, h: L.y1 - L.y0 });
      root && root.querySelectorAll('.thumb').forEach((t, i) => {
        if (FM.brand.motionOK()) t.animate([{ boxShadow: '0 0 0 0 transparent' }, { boxShadow: '0 0 0 3px var(--brand-b)' }, { boxShadow: '0 0 0 0 transparent' }],
          { duration: 520, delay: 120 + i * 28, easing: 'ease-out' });
      });
    });
  }

  // ------------------------------------------------------------------ tree
  function renderTree(m) {
    const ws = W();
    const s = m.sample;
    clear(els.tree);
    const node = (gate, depth) => {
      const id = gate ? gate.id : null;
      const kids = ws.children(id, s.key);
      const plotted = (m.popId || null) === id;
      const selected = gate && FM.ui.gateId === gate.id;
      const pct = gate ? ws.pct(s, id) : 100;
      const n = ws.count(s, id);
      const err = gate && s._popErrors && s._popErrors[id];
      const row = h('div.tnode' + (plotted ? '.plotted' : '') + (selected ? '.selected' : ''), {
        style: { paddingLeft: (8 + depth * 16) + 'px' },
        role: 'treeitem', tabindex: 0, 'aria-selected': selected ? 'true' : 'false',
        on: {
          click: () => { if (gate) FM.setUI({ gateId: gate.id }); else FM.setUI({ popId: null, gateId: null }); },
          dblclick: () => drill(id),
          contextmenu: e => { if (!gate) return; e.preventDefault(); FM.setUI({ gateId: gate.id }); gateMenu(gate.id, { x: e.clientX, y: e.clientY }); },
          keydown: e => { if (e.key === 'Enter') drill(id); if (e.key === 'F2' && gate) renamePopover(gate.id); },
        },
      },
        h('span.tglyph', gate ? gateGlyph(gate) : icon('layers')),
        h('span.tname', gate ? gate.name : 'All events'),
        err ? h('span.chip.crit', { 'data-tip': err }, 'error') : null,
        adjustedChip(gate, s),
        // the % and the events behind it, stacked: a percentage alone cannot be judged
        gate ? h('span.tnums', { 'data-tip': fmtCount(n) + ' events · ' + fmtPct(pct) + ' of ' + ws.popName(gate.parent) },
          h('span.tpct.mono', fmtPct(pct)), h('span.tcount.mono', fmtCount(n))) : h('span.tcount.mono', fmtCount(n)),
        h('button.btn.ghost.sm.icon.tmore.texport', { 'data-tip': 'Export the events in ' + (gate ? gate.name : 'All events') + ' (CSV)', 'aria-label': 'Export events',
          on: { click: e => { e.stopPropagation(); FM.io.exportEventsDialog({ popId: id }); } } }, icon('download')),
        gate ? h('button.btn.ghost.sm.icon.tmore', { 'data-tip': 'More', on: { click: e => { e.stopPropagation(); FM.setUI({ gateId: gate.id }); gateMenu(gate.id, e.currentTarget); } } }, icon('more')) : null);
      if (plotted) row.appendChild(h('span.tplot', { 'data-tip': 'Plotted' }, icon('eye')));
      els.tree.appendChild(row);
      kids.forEach(k => node(k, depth + 1));
    };
    node(null, 0);
    if (!ws.doc.gates.length) {
      els.tree.appendChild(h('div.tree-empty',
        h('p', 'Draw your first gate on the plot with the ', h('strong', 'polygon'), ' or ', h('strong', 'rectangle'), ' tool — or start from a preset.'),
        h('button.btn.sm', { on: { click: () => setTool('polygon') } }, icon('polygon'), 'Draw a polygon')));
    }
  }

  /** How many wells use their own version of this gate — never left implicit. */
  function adjustedChip(gate, s) {
    if (!gate) return null;
    const ws = W();
    const wells = ws.adjustedWells(gate.id);
    if (!wells.length) return null;
    const here = s && ws.isAdjusted(gate.id, s.key);
    const shown = wells.slice(0, 6).join(', ') + (wells.length > 6 ? ' and ' + (wells.length - 6) + ' more' : '');
    return h('span.chip.adj' + (here ? '.here' : ''), {
      'data-tip': wells.length + ' well' + (wells.length > 1 ? 's use' : ' uses') + ' its own version of ' + gate.name + ': ' + shown,
    }, ADJ_MARK, String(wells.length));
  }

  function gateGlyph(g) {
    const S = FM.dom.s;
    const c = 'currentColor';
    if (g.type === 'ellipse') return S('svg', { viewBox: '0 0 14 14' }, S('ellipse', { cx: 7, cy: 7, rx: 5.5, ry: 3.6, transform: 'rotate(-30 7 7)', fill: 'none', stroke: c, 'stroke-width': 1.5 }));
    if (g.type === 'bool') {
      const op = g.bool && g.bool.terms.length === 1 && g.bool.terms[0].not ? '¬' : g.bool && g.bool.op === 'or' ? '∨' : '∧';
      return S('svg', { viewBox: '0 0 14 14' }, S('text', { x: 7, y: 11, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: c }, op));
    }
    if (g.type === 'rect') return S('svg', { viewBox: '0 0 14 14' }, S('rect', { x: 2, y: 3, width: 10, height: 8, fill: 'none', stroke: c, 'stroke-width': 1.5, rx: 1 }));
    if (g.type === 'range') return S('svg', { viewBox: '0 0 14 14' }, S('path', { d: 'M3 3v8M11 3v8M3 7h8', fill: 'none', stroke: c, 'stroke-width': 1.5 }));
    if (g.type === 'quad') {
      const cell = { UL: [2, 2], UR: [7, 2], LL: [2, 7], LR: [7, 7] }[g.corner] || [7, 2];
      return S('svg', { viewBox: '0 0 14 14' }, S('rect', { x: cell[0], y: cell[1], width: 5, height: 5, fill: c, opacity: 0.35 }),
        S('path', { d: 'M7 1.5v11M1.5 7h11', fill: 'none', stroke: c, 'stroke-width': 1.5 }));
    }
    return S('svg', { viewBox: '0 0 14 14' }, S('path', { d: 'M7 1.8l5 3.6-1.9 6.6H3.9L2 5.4z', fill: 'none', stroke: c, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }));
  }

  // --------------------------------------------------------------- toolbar
  function renderToolbar(m) {
    const ws = W();
    clear(els.toolbar);
    const S = ws.samples;
    const i = S.findIndex(s => s.key === m.sample.key);
    const sampleSel = h('select.input.sample-sel', { 'aria-label': 'Well', on: { change: e => setSample(e.target.value) } },
      groupedSampleOptions(m.sample.key));
    const is2d = !!m.y;
    const tool = FM.ui.tool;
    const tb = (id, ic, label, key, enabled) => h('button' + (tool === id ? '.on' : ''), {
      'data-tip': label + ' (' + key + ')' + (enabled ? '' : ' — ' + (id === 'range' ? 'switch Y to Histogram' : 'needs a 2-D plot')),
      disabled: !enabled, 'aria-pressed': tool === id ? 'true' : 'false',
      on: { click: () => setTool(id) },
    }, icon(ic), h('span.tool-l', label));
    const tools = h('div.seg.tools', tb('select', 'pointer', 'Select', 'V', true), tb('polygon', 'polygon', 'Polygon', 'P', is2d),
      tb('rect', 'rect', 'Rectangle', 'R', is2d), tb('ellipse', 'ellipse', 'Ellipse', 'E', is2d), tb('quad', 'quad', 'Quadrant', 'Q', is2d), tb('range', 'range', 'Range', 'H', !is2d));

    const params = ws.paramNames();
    const axisSel = (which) => {
      const val = which === 'x' ? m.x : (m.y || '__hist');
      const sel = h('select.input.axis-sel', { 'aria-label': which.toUpperCase() + ' axis', on: { change: e => {
        const v = e.target.value;
        const cur = ws.view(m.popId) || {};
        ws.setView(m.popId, which === 'x' ? { x: v, y: cur.y } : { x: cur.x, y: v === '__hist' ? null : v });
        if (FM.ui.tool !== 'select') FM.ui.tool = 'select';
        pv && pv.cancelDraft();
        FM.setUI({ gateId: keepSelectionIfFits() });
      } } },
      which === 'y' ? h('option', { value: '__hist' }, 'Histogram') : null,
      params.map(p => h('option', { value: p, selected: p === val }, ws.paramLabel(p))));
      if (which === 'y' && !m.y) sel.value = '__hist';
      return h('div.axis-ctl', h('span.axis-k', which.toUpperCase()), sel,
        which === 'y' && !m.y ? null : FM.axisUI.chip(which === 'x' ? m.x : m.y, m.popId));
    };
    const swap = h('button.btn.ghost.sm.icon', { 'data-tip': 'Swap axes', disabled: !m.y, on: { click: () => {
      ws.setView(m.popId, { x: m.y, y: m.x }); FM.setUI({ gateId: keepSelectionIfFits() });
    } } }, FM.dom.s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' }, FM.dom.s('path', { d: 'M7 4v16M7 4L4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3' })));

    FM.dom.append(els.toolbar, [
      h('button.btn.sm.suggest-btn', { disabled: FM.ui.gateScope === 'well',
        'data-tip': FM.ui.gateScope === 'well' ? 'Suggestions are fitted across the whole plate — switch back to All wells' : 'Suggest a gate for these axes (G)',
        on: { click: runSuggest } }, icon('wand'), 'Suggest'),
      h('div.sample-nav',
        h('button.btn.ghost.sm.icon', { 'data-tip': 'Previous well (←)', disabled: i <= 0, on: { click: () => step(-1) } }, icon('left')),
        sampleSel,
        h('button.btn.ghost.sm.icon', { 'data-tip': 'Next well (→)', disabled: i >= S.length - 1, on: { click: () => step(1) } }, icon('right'))),
      scopeSwitch(m),
      newScopeSwitch(m),
      tools,
      h('span.grow'),
      // unmixing is a beta tool of its own, a click away for the data that needs it
      h('button.btn.ghost.sm.unmix-beta', { 'data-tip': 'Need to unmix your data? Compensation or spectral unmixing from your single-stain controls, or a matrix file', on: { click: () => FM.go('unmix') } },
        icon('spectrum'), h('span.ub-long', 'Need to unmix your data? Try the unmixing tool'), h('span.ub-short', 'Unmix'), h('span.beta', 'beta')),
    ]);
    clear(els.axisX); clear(els.axisY); clear(els.axisSwap);
    FM.dom.append(els.axisX, [axisSel('x')]);
    FM.dom.append(els.axisY, [axisSel('y')]);
    els.axisSwap.appendChild(swap);
    if (pv && pv.L) placeAxes(pv.L);
  }

  /**
   * Where a gate edit lands. Everything in FlowMate is "every well at once", so this is a
   * mode — and the failure it invites is forgetting it is on. It resets on arriving at the
   * step, it names the well it is aimed at, and while it is on "this well" the plot frame
   * is tinted and every gate on it is labelled with the well.
   */
  function scopeSwitch(m) {
    const well = m.sample.well || m.sample.name;
    const on = FM.ui.gateScope === 'well';
    const allowed = !!FM.ui.gateId;
    const why = allowed ? '' : ' — select a gate first: a gate has to exist for every well before one well can differ from it';
    const btn = (scope, label, tip) => h('button' + (on === (scope === 'well') ? '.on' : ''), {
      'data-tip': tip, 'aria-pressed': on === (scope === 'well') ? 'true' : 'false',
      disabled: scope === 'well' && !allowed,
      on: { click: () => setScope(scope) },
    }, label);
    return h('div.scope-sw' + (on ? '.on' : ''),
      h('span.scope-k', 'Edits apply to'),
      h('div.seg',
        btn('all', 'All wells', 'Dragging a gate moves it on every well — what this tool is for'),
        btn('well', well, 'Dragging a gate changes ' + well + ' only, and leaves the other wells alone' + why)));
  }

  /**
   * Where a *new* gate goes: every sample (FlowMate's default — draw once, all follow), the
   * group of the sample on screen, or that sample alone (FlowJo's habit). Hidden while edits
   * are aimed at one sample, which is a different question.
   */
  function newScopeSwitch(m) {
    if (FM.ui.gateScope === 'well') return null;
    const g = FM.ws.groupOf(m.sample.key);
    if (FM.ui.newScope === 'group' && !g) FM.ui.newScope = 'all';
    const btn = (v, label, tip, dis) => h('button' + (FM.ui.newScope === v ? '.on' : ''), { 'data-tip': tip, disabled: !!dis,
      'aria-pressed': FM.ui.newScope === v ? 'true' : 'false', on: { click: () => FM.setUI({ newScope: v }) } }, label);
    return h('div.scope-sw.new-scope',
      h('span.scope-k', 'New gates on'),
      h('div.seg',
        btn('all', 'All samples', 'A new gate applies to every sample'),
        btn('group', g ? g.name : 'Group', g ? 'A new gate applies to the samples in ' + g.name : 'This sample is in no group', !g),
        btn('sample', 'This sample', 'A new gate applies to ' + (m.sample.well || m.sample.name) + ' only')));
  }

  function setScope(scope) {
    if (scope === FM.ui.gateScope) return;
    if (scope === 'well' && !FM.ui.gateId) { toast('Select a gate first — then you can adjust it for this well alone'); return; }
    if (pv) pv.cancelDraft();
    FM.setUI({ gateScope: scope, tool: 'select' });
    if (scope === 'well') {
      const s = FM.currentSample();
      toast('Gate edits now change ' + (s.well || s.name) + ' only. The other wells keep the shared gate.');
    }
  }

  /** Put the axis pickers where the axis titles would be. */
  function placeAxes(L) {
    if (!els.axisX) return;
    const xw = els.axisX.offsetWidth, yw = els.axisY.offsetWidth;
    els.axisX.style.left = Math.max(0, (L.x0 + L.x1) / 2 - xw / 2) + 'px';
    els.axisX.style.top = (L.y1 + 26) + 'px';
    // rotated -90° about its top-left corner: it grows upwards from (left, top)
    els.axisY.style.left = Math.max(0, L.x0 - 88) + 'px';
    els.axisY.style.top = ((L.y0 + L.y1) / 2 + yw / 2) + 'px';
    els.axisSwap.style.left = Math.max(0, L.x0 - 40) + 'px';
    els.axisSwap.style.top = (L.y1 + 26) + 'px';
    // drawing hints and coordinates sit inside the plot's bottom edge, clear of the axis pickers
    els.status.style.left = (L.x0 + 6) + 'px';
    els.status.style.width = Math.max(120, L.x1 - L.x0 - 12) + 'px';
    els.status.style.top = (L.y1 - 26) + 'px';
  }

  function toggleFocus() {
    FM.ui.focus = !FM.ui.focus;
    FM.savePrefs();
    const wrap = root && root.querySelector('.gate-wrap');
    if (wrap) wrap.classList.toggle('focus', FM.ui.focus);
    renderAll();
  }

  function keepSelectionIfFits() {
    const ws = W();
    const g = FM.ui.gateId ? ws.gate(FM.ui.gateId) : null;
    const v = ws.view(FM.ui.popId) || {};
    return g && P.gateFits(g, v.x, v.y) ? g.id : null;
  }

  function groupedSampleOptions(curKey) {
    const ws = W();
    const out = [];
    const seen = new Set();
    ws.doc.groups.forEach(g => {
      const ss = ws.samplesIn(g.id);
      if (!ss.length) return;
      out.push(h('optgroup', { label: g.name }, ss.map(s => { seen.add(s.key); return h('option', { value: s.key, selected: s.key === curKey }, sampleLabel(s)); })));
    });
    const rest = ws.samples.filter(s => !seen.has(s.key));
    if (rest.length) out.push(h('optgroup', { label: ws.doc.groups.length ? 'No condition' : 'Wells' }, rest.map(s => h('option', { value: s.key, selected: s.key === curKey }, sampleLabel(s)))));
    return out;
  }

  function sampleLabel(s) {
    const g = W().groupOf(s.key);
    const ex = W().wellInfo(s.key).excluded;
    return (s.well || s.name) + (g ? ' · ' + g.name : '') + (ex ? ' (excluded)' : '');
  }

  function cmapMenu(anchor) {
    menu(anchor, Object.entries(FM.colormaps.MAPS).map(([k, v]) => ({
      label: v.label, hint: k === FM.ui.cmap ? '✓' : '', fn: () => { FM.ui.cmap = k; FM.savePrefs(); thumbs.forEach(t => { t.dataKey = ''; }); renderAll(); },
    })), { align: 'right' });
  }

  // how big each event is drawn: smaller for crowded plots, bigger to see sparse ones on white
  const DOT_STEPS = [0.5, 0.75, 1, 1.5, 2, 3];
  function setDotScale(dir) {
    const i = DOT_STEPS.indexOf(FM.ui.dotScale);
    const next = DOT_STEPS[Math.max(0, Math.min(DOT_STEPS.length - 1, (i < 0 ? 2 : i) + dir))];
    if (next === FM.ui.dotScale) return;
    FM.ui.dotScale = next; FM.savePrefs();
    thumbs.forEach(t => { t.dataKey = ''; });
    renderAll();
  }
  function dotControl() {
    const i = DOT_STEPS.indexOf(FM.ui.dotScale);
    return h('div.dot-ctl', { role: 'group', 'aria-label': 'Dot size' },
      h('button.btn.ghost.sm.icon', { 'data-tip': 'Smaller dots ( [ )', 'aria-label': 'Smaller dots', disabled: i === 0, on: { click: () => setDotScale(-1) } }, h('span.dot-ic.small')),
      h('span.dot-val.mono', { 'data-tip': 'Dot size' }, Math.round(FM.ui.dotScale * 100) + '%'),
      h('button.btn.ghost.sm.icon', { 'data-tip': 'Bigger dots ( ] )', 'aria-label': 'Bigger dots', disabled: i === DOT_STEPS.length - 1, on: { click: () => setDotScale(1) } }, h('span.dot-ic.big')));
  }

  function pngName(m) { return (m.sample.well || m.sample.name.replace(/\.fcs$/i, '')) + '_' + W().popName(m.popId).replace(/[^\w+-]+/g, '_') + '_' + m.x + (m.y ? '_vs_' + m.y : '') + '.png'; }
  function dataURLtoBlob(url) {
    const [head, b64] = url.split(',');
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: /:(.*?);/.exec(head)[1] });
  }

  // ---------------------------------------------------------------- crumbs
  function renderCrumbs(m) {
    const ws = W();
    clear(els.crumbs);
    const path = m.popId ? ws.gatePath(m.popId) : [];
    const items = [{ id: null, name: 'All events' }].concat(path.map(g => ({ id: g.id, name: g.name })));
    items.forEach((it, i) => {
      if (i) els.crumbs.appendChild(h('span.crumb-sep', icon('right')));
      const last = i === items.length - 1;
      els.crumbs.appendChild(h('button.crumb' + (last ? '.on' : ''), { on: { click: () => drill(it.id) } }, it.name));
    });
    const n = ws.count(m.sample, m.popId);
    els.crumbs.appendChild(h('span.crumb-n.mono', fmtCount(n) + ' events'));
    els.crumbs.appendChild(h('span.grow'));
    els.crumbs.appendChild(h('div.seg.sm.layout-seg', { role: 'group', 'aria-label': 'Layout' }, [['single', 'One plot', 'One large plot — gate step by step'], ['sheet', 'Worksheet', 'Every plot of this sample side by side, with a statistics table — move them where you like']].map(([v, l, tip]) =>
      h('button' + ((sheetMode() ? 'sheet' : 'single') === v ? '.on' : ''), { 'data-tip': tip, 'aria-pressed': (sheetMode() ? 'sheet' : 'single') === v ? 'true' : 'false', on: { click: () => setLayout(v) } }, l))));
    els.crumbs.appendChild(h('button.btn.ghost.sm', { 'data-tip': 'Frame both axes on the events in ' + ws.popName(m.popId) + ' (all wells)',
      on: { click: () => { ws.refitView(m.popId, [m.x, m.y].filter(Boolean)); if (pv) pv.resetZoom(); if (suggestion) runSuggest(); } } }, icon('fit'), 'Fit'));
    els.crumbs.appendChild(h('button.btn.sm' + (FM.ui.focus ? '.on' : ''), { 'data-tip': (FM.ui.focus ? 'Show the side panels' : 'Enlarge the plot — hide side panels and filmstrip') + ' (F)',
      on: { click: toggleFocus } }, icon(FM.ui.focus ? 'shrink' : 'expand'), FM.ui.focus ? 'Exit focus' : 'Focus'));
    // the filmstrip's tiles are thumbnails; this puts the same plots on a page, full size
    els.crumbs.appendChild(h('button.btn.sm', { 'data-tip': 'Put plots on the figure page: this plot for every well, or the whole gating strategy',
      on: { click: e => menu(e.currentTarget, [
        { label: 'This plot, one per well…', icon: 'grid', fn: () => FM.openLayout({ pop: m.popId || null, ax: m.x, ay: m.y || null }) },
        { label: 'Gating strategy for ' + (m.sample.well || m.sample.name) + '…', icon: 'strategy', disabled: !ws.doc.gates.length,
          fn: () => FM.openStrategy({ scope: 'one', sample: m.sample.key }) },
        { label: 'Gating strategy, one row per condition…', icon: 'strategy', disabled: !ws.doc.gates.length || !ws.doc.groups.length,
          fn: () => FM.openStrategy({ scope: 'rows' }) },
      ]) } }, icon('grid'), 'To figure', icon('down')));
    const g = FM.ui.gateId ? ws.gate(FM.ui.gateId) : null;
    if (g) els.crumbs.appendChild(h('button.btn.sm.crumb-open', { on: { click: () => drill(g.id) }, 'data-tip': 'Plot the events inside ' + g.name + ' to gate further (double-click the gate)' }, 'Open ', h('strong', g.name), icon('right')));
    if (!m.y) els.crumbs.appendChild(h('button.btn.sm' + (FM.ui.overlay ? '.on' : ''), { 'data-tip': 'Overlay the other wells of this condition', 'aria-pressed': FM.ui.overlay ? 'true' : 'false',
      on: { click: () => FM.setUI({ overlay: !FM.ui.overlay }) } }, icon('layers'), 'Replicates'));
    els.crumbs.appendChild(dotControl());
    els.crumbs.appendChild(h('button.btn.ghost.sm', { 'data-tip': 'Density colours', on: { click: e => cmapMenu(e.currentTarget) } },
      h('span.cmap-swatch', { style: { background: FM.colormaps.cssGradient(FM.ui.cmap) } })));
    els.crumbs.appendChild(h('button.btn.ghost.sm.icon.crumb-export', { 'data-tip': 'Export: this plot as PNG, or the events in ' + ws.popName(m.popId) + ' as CSV', 'aria-label': 'Export',
      on: { click: e => menu(e.currentTarget, [
        { label: 'This plot as PNG', icon: 'download', fn: () => FM.dom.download(pngName(m), dataURLtoBlob(pv.exportPNG())) },
        { label: 'Events in ' + ws.popName(m.popId) + ' (CSV)…', icon: 'download', fn: () => FM.io.exportEventsDialog({ popId: m.popId || null }) },
      ], { align: 'right' }) } }, icon('download')));
  }

  function renderStatus() {
    if (!els.status) return;
    const m = pv && pv.model;
    clear(els.status);
    const tool = FM.ui.tool;
    // select-mode tips live in the population panel's footer; the plot only hints while drawing
    const foot = root && root.querySelector('.tree-foot');
    if (foot) foot.textContent = FM.ui.gateId
      ? 'Drag the gate or its handles · the small squares on the dashed frame resize it: sides for width or height, corners for both (Shift keeps the proportions) · Alt-click a handle removes it · double-click an edge adds one · Delete removes the gate'
      : 'Click a gate to edit it · double-click to open the population inside it · wheel to zoom';
    const hint = {
      select: '',
      polygon: pv && pv.draft ? 'Click to add points · click the first point or press Enter to close · Backspace removes the last point · Esc cancels'
        : 'Click to place the first point of the polygon',
      rect: 'Drag to draw a rectangle',
      ellipse: 'Drag a box — the ellipse fits inside it; then turn and stretch it by its handles',
      quad: 'Click where the quadrant lines should cross — four gates are created at once',
      range: 'Drag across the histogram to draw a range',
    }[tool];
    if (hint) els.status.appendChild(h('span.pv-hint', hint));
    if (hoverData && m) {
      const f = v => (v == null ? '' : FM.transforms.siLabel(v));
      els.status.appendChild(h('span.pv-coords.mono', m.x + ' ' + f(hoverData[0]) + (m.y ? '   ' + m.y + ' ' + f(hoverData[1]) : '')));
    }
  }

  // ----------------------------------------------------------- wells panel
  /** The population the across-wells panel reports on: the selected gate, else the plotted one. */
  function focusPop(m) { return FM.ui.gateId || m.popId || null; }

  /** What the tooltip adds when a well does not use the shared gate. */
  function adjTip(key, pid) {
    const ws = W();
    if (pid && ws.isAdjusted(pid, key)) return ' · ' + ADJ_MARK + ' uses its own ' + ws.popName(pid);
    const mine = ws.adjustedGates(key);
    return mine.length ? ' · ' + ADJ_MARK + ' its own ' + mine.map(g => g.name).join(', ') : '';
  }

  /** Plain click moves to the well; shift or ctrl builds a selection for the bulk actions. */
  function cellClick(e, key) {
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if (FM.ui.wellSel.length) FM.setUI({ wellSel: [], sampleKey: key });
      else setSample(key);
      return;
    }
    e.preventDefault();
    const sel = new Set(FM.ui.wellSel);
    if (sel.has(key)) sel.delete(key); else sel.add(key);
    FM.setUI({ wellSel: Array.from(sel) });
  }

  /** Event counts short enough for a plate cell: 512 · 5.1K · 48K · 1.2M (exact in the tooltip). */
  function fmtEv(n) {
    if (!Number.isFinite(n)) return '—';
    if (n < 1000) return String(Math.round(n));
    if (n < 1e4) return (n / 1e3).toFixed(1) + 'K';
    if (n < 1e6) return Math.round(n / 1e3) + 'K';
    return (n / 1e6).toFixed(1) + 'M';
  }
  function fmtPctCell(v) { return Number.isFinite(v) ? (v >= 99.95 ? '100' : v.toFixed(v < 10 ? 1 : 0)) : '—'; }

  /** What the panel reads: % of parent, events in the gate, or both side by side. */
  function wellsShow(gate) { return !gate ? 'events' : (FM.ui.wellsShow === 'events' || FM.ui.wellsShow === 'pct' ? FM.ui.wellsShow : 'both'); }
  function setWellsShow(v) { FM.ui.wellsShow = v; FM.savePrefs(); if (root && pv) renderWells(current()); }

  function renderWells(m) {
    const ws = W();
    const pid = focusPop(m);
    const sel = new Set(FM.ui.wellSel.filter(k => ws.sample(k)));
    clear(els.wellsHead); clear(els.wells);
    const gate = pid ? ws.gate(pid) : null;
    const show = wellsShow(gate);
    // wells and tubes are the same to every gate: a plate map shows the wells, and the tubes sit under it
    // (or everything together in the List view)
    const frame = FM.wells.frame(ws.samples.filter(s => s.well && !s.wellConflict).map(s => s.well));
    const tubes = ws.samples.filter(s => !s.well || s.wellConflict);
    const mixed = !!frame && tubes.length > 0;
    const view = frame && FM.ui.wellsView !== 'list' ? 'plate' : 'list';
    const title = !gate ? (mixed ? 'Events per sample' : 'Events per well') : show === 'events' ? 'Events in ' + gate.name : show === 'both' ? '% and events in ' + gate.name : '% in ' + gate.name;
    const SHOWS = [['pct', '%', 'Percentage of the parent population'], ['events', 'Events', 'Number of events inside the gate'], ['both', 'Both', 'Percentage and events side by side']];
    FM.dom.append(els.wellsHead, [
      h('div.wells-title', h('div.eyebrow', mixed ? 'Across all wells and tubes' : 'Across all wells'), h('h3', title),
        gate ? h('div.muted.small', show === 'events' ? 'events inside the gate, per well' : 'of ' + ws.popName(gate.parent) + (show === 'both' ? ' · events below' : '')) : null),
      gate ? h('div.seg.sm.show-seg', { role: 'group', 'aria-label': 'Show' }, SHOWS.map(([v, label, tip]) =>
        h('button' + (show === v ? '.on' : ''), { 'data-tip': tip, 'aria-pressed': show === v ? 'true' : 'false', on: { click: () => setWellsShow(v) } }, label))) : null,
      frame ? h('div.seg.sm.wells-view', { role: 'group', 'aria-label': 'View' }, [['plate', 'Plate', 'The plate map' + (mixed ? ', with the tubes under it' : '')], ['list', mixed ? 'Wells + tubes' : 'List', 'Every well and tube in one list, by condition']].map(([v, label, tip]) =>
        h('button' + (view === v ? '.on' : ''), { 'data-tip': tip, 'aria-pressed': view === v ? 'true' : 'false', on: { click: () => { FM.ui.wellsView = v; renderWells(current()); } } }, label))) : null]);
    // p: % of parent · n: events in the gate · v: the number colours and positions follow
    const vals = ws.samples.map(s => {
      const n = gate ? ws.count(s, pid) : s.n, p = gate ? ws.pct(s, pid) : NaN;
      return { s, p, n, v: show === 'events' ? n : p, info: ws.wellInfo(s.key), g: ws.groupOf(s.key) };
    });
    const finite = vals.filter(x => Number.isFinite(x.v));
    const max = show === 'events' ? Math.max(1, ...finite.map(x => x.v)) : 100;
    const strong = !!gate;   // a gate's numbers differ well to well; raw acquisition counts barely do

    // one bar per sample, grouped by condition (tubes, or wells and tubes together)
    const bars = keys => {
      const want = new Set(keys);
      const order = stripOrder().filter(o => want.has(o.s.key)).map(o => vals.find(x => x.s.key === o.s.key)).filter(Boolean);
      return h('div.tube-bars', order.slice(0, 300).map(x => {
        const frac = Number.isFinite(x.v) ? Math.max(0, Math.min(1, x.v / max)) : 0;
        return h('button.tube-bar' + (x.s.key === m.sample.key ? '.cur' : '') + (x.info.excluded ? '.excl' : '') + (sel.has(x.s.key) ? '.picked' : ''), {
          'data-key': x.s.key,
          'data-tip': (x.s.well || x.s.name) + (x.g ? ' · ' + x.g.name : '') + ' — ' + (gate ? fmtPct(x.p) + ' · ' + fmtCount(x.n) + ' events' : fmtCount(x.n) + ' events') + ' · shift-click to select',
          on: { click: e => cellClick(e, x.s.key) } },
          h('span.tb-name', { title: x.s.name }, x.g ? h('span.swatch', { style: { background: x.g.color } }) : null, x.s.well && !x.s.wellConflict ? x.s.well : x.s.name.replace(/\.fcs$/i, '')),
          h('span.tb-track', h('span.tb-fill', { style: { width: Math.round(frac * 100) + '%', background: x.g ? x.g.color : 'var(--accent)' } })),
          h('span.tb-val.mono', !Number.isFinite(x.v) ? '—' : show === 'events' ? fmtCount(x.n) : fmtPct(x.p)));
      }));
    };

    // plate heatmap
    if (view === 'plate') {
      const nc = frame.c1 - frame.c0 + 1;
      // exact counts wherever the cell is wide enough to hold them; a full plate falls back to 5.1K
      const cellEv = n => ((n < 1e4 && nc <= 8) || (n < 1e5 && nc <= 5) ? fmtCount(n) : fmtEv(n));
      const grid = h('div.mini-plate' + (show === 'both' ? '.both' : ''), { style: { gridTemplateColumns: '16px repeat(' + nc + ', 1fr)' } });
      grid.appendChild(h('span'));
      for (let c = frame.c0; c <= frame.c1; c++) grid.appendChild(h('span.mp-h', String(c + 1)));
      const byWell = new Map(vals.filter(x => x.s.well && !x.s.wellConflict).map(x => [x.s.well, x]));
      for (let r = frame.r0; r <= frame.r1; r++) {
        grid.appendChild(h('span.mp-h', FM.wells.ROWS[r]));
        for (let c = frame.c0; c <= frame.c1; c++) {
          const x = byWell.get(FM.wells.id(r, c));
          if (!x) { grid.appendChild(h('span.mp-cell.none')); continue; }
          const frac = Number.isFinite(x.v) ? Math.max(0, Math.min(1, x.v / max)) : 0;
          const adj = pid ? ws.isAdjusted(pid, x.s.key) : !!ws.adjustedGates(x.s.key).length;
          const picked = sel.has(x.s.key);
          const label = show === 'both' ? [h('span.mp-p', fmtPctCell(x.p)), h('span.mp-n', cellEv(x.n))]
            : show === 'events' ? (gate ? cellEv(x.n) : FM.transforms.siLabel(x.n)) : fmtPctCell(x.p);
          const cell = h('button.mp-cell' + (x.s.key === m.sample.key ? '.cur' : '') + (x.info.excluded ? '.excl' : '')
            + (adj ? '.adj' : '') + (picked ? '.picked' : ''), {
            style: { '--f': Math.round(frac * (strong ? 88 : 38)) + '%', '--gc': x.g ? x.g.color : 'transparent', color: strong && frac > 0.6 ? 'var(--on-accent)' : 'var(--ink)' },
            'data-tip': x.s.well + (x.g ? ' · ' + x.g.name : '') + ' — ' + (gate ? fmtPct(x.p) + ' (' + fmtCount(x.n) + ' events)' : fmtCount(x.n) + ' events')
              + (x.info.excluded ? ' · excluded' : '') + adjTip(x.s.key, pid) + ' · shift-click to select',
            on: { click: e => cellClick(e, x.s.key) },
          }, label);
          grid.appendChild(cell);
        }
      }
      els.wells.appendChild(grid);
      if (tubes.length) {
        els.wells.appendChild(h('div.eyebrow.sect', 'Tubes'));
        els.wells.appendChild(bars(tubes.map(s => s.key)));
      }
      els.wells.appendChild(selectionBar(m, pid, sel));
    } else {
      els.wells.appendChild(bars(ws.samples.map(s => s.key)));
      els.wells.appendChild(selectionBar(m, pid, sel));
    }

    // per-condition replicate strips on a shared axis
    const groups = ws.doc.groups.filter(g => ws.samplesIn(g.id).length);
    if (groups.length) {
      const lo = 0, hi = max;
      const strips = h('div.strips' + (show === 'both' ? '.both' : ''));
      const flags = [];
      const evText = v => (!gate ? FM.transforms.siLabel(v) : v < 1e5 ? fmtCount(Math.round(v)) : fmtEv(v));
      groups.forEach(g => {
        const members = vals.filter(x => x.g && x.g.id === g.id);
        const incl = members.filter(x => !x.info.excluded);
        const used = incl.filter(x => Number.isFinite(x.v));
        const med = used.length ? FM.stats.median(used.map(x => x.v)) : NaN;
        // "far from its replicates" is about the gated fraction, whichever number is on show
        const P = incl.map(x => x.p).filter(Number.isFinite), N = incl.map(x => x.n).filter(Number.isFinite);
        const medP = P.length ? FM.stats.median(P) : NaN, medN = N.length ? FM.stats.median(N) : NaN;
        const track = h('div.strip-track-line');
        members.forEach(x => {
          if (!Number.isFinite(x.v)) return;
          const left = 100 * (x.v - lo) / ((hi - lo) || 1);
          // compare with the whole group's median (see analysis.js: leave-one-out misfires at n = 3)
          const off = gate && P.length >= 3 && !x.info.excluded && Math.abs(x.p - medP) > 15;
          if (off) flags.push(x);
          track.appendChild(h('button.sdot' + (x.s.key === m.sample.key ? '.cur' : '') + (x.info.excluded ? '.excl' : '') + (off ? '.off' : ''), {
            style: { left: Math.max(0, Math.min(100, left)) + '%', background: x.info.excluded ? 'transparent' : g.color, borderColor: g.color },
            'data-tip': (x.s.well || x.s.name) + ' — ' + (gate ? fmtPct(x.p) + ' · ' + fmtCount(x.n) + ' events' : fmtCount(x.n) + ' events') + (x.info.excluded ? ' (excluded)' : ''),
            on: { click: () => setSample(x.s.key) },
          }));
        });
        if (Number.isFinite(med)) track.appendChild(h('span.smed', { style: { left: (100 * (med - lo) / ((hi - lo) || 1)) + '%' } }));
        const val = show === 'both'
          ? h('span.strip-val.mono', { 'data-tip': 'Median of the included wells' }, h('span', Number.isFinite(medP) ? fmtPct(medP) : '—'), h('span.strip-n', Number.isFinite(medN) ? evText(medN) + ' ev' : ''))
          : h('span.strip-val.mono', Number.isFinite(med) ? (show === 'events' ? evText(med) : fmtPct(med)) : '—');
        strips.appendChild(h('div.strip-row', h('span.strip-name', { title: g.name }, h('span.swatch', { style: { background: g.color } }), g.name), track, val));
      });
      const tick = v => (show === 'events' ? evText(v) : Math.round(v) + '%');
      strips.appendChild(h('div.strip-axis', h('span', show === 'events' ? '0' : '0%'), h('span', tick(hi / 2)), h('span', tick(hi))));
      els.wells.appendChild(h('div.eyebrow.sect', 'Replicates by condition' + (gate && show === 'events' ? ' · events' : '')));
      els.wells.appendChild(strips);
      if (flags.length) {
        els.wells.appendChild(h('div.flags', flags.map(x => h('button.note.warn.small.flag', { on: { click: () => setSample(x.s.key) } }, icon('alert'),
          h('span', h('strong', x.s.well || x.s.name), ' is far from its ' + x.g.name + ' replicates (' + fmtPct(x.p) + '). ', h('u', 'Inspect'))))));
      }
    } else {
      els.wells.appendChild(h('div.note.small', icon('info'), h('span', 'Assign wells to conditions on the Plate step to compare replicates here.')));
    }
    if (gate && finite.length) {
      const inc = vals.filter(x => !x.info.excluded);
      const P = inc.map(x => x.p).filter(Number.isFinite), N = inc.map(x => x.n).filter(Number.isFinite);
      const pctLine = P.length ? 'Range ' + fmtPct(Math.min(...P)) + ' – ' + fmtPct(Math.max(...P)) + ' · median ' + fmtPct(FM.stats.median(P)) : '';
      const evLine = N.length ? 'Events ' + fmtCount(Math.min(...N)) + ' – ' + fmtCount(Math.max(...N)) + ' · median ' + fmtCount(Math.round(FM.stats.median(N))) : '';
      els.wells.appendChild(h('div.wells-summary.muted.small',
        show !== 'events' && pctLine ? h('div', pctLine) : null,
        show !== 'pct' && evLine ? h('div', evLine) : null));
    }
  }

  /**
   * Selected wells and what can be done to them: take the gating from the well on screen,
   * or send them back to the shared gates. A summary line when nothing is selected keeps
   * hand-adjusted wells from ever being invisible.
   */
  function selectionBar(m, pid, sel) {
    const ws = W();
    const src = m.sample, srcWell = src.well || src.name;
    const keys = Array.from(sel).filter(k => k !== src.key);
    if (!sel.size) {
      const adjusted = pid ? ws.adjustedWells(pid) : [];
      const anyWells = ws.samples.map(s => s.key).filter(k => ws.adjustedGates(k).length);
      if (!anyWells.length) return h('div.sel-bar.muted.small', 'Shift-click wells to select them — then copy this well’s gating onto them, or export their plots as figures.');
      const txt = pid && adjusted.length
        ? adjusted.length + ' well' + (adjusted.length > 1 ? 's use' : ' uses') + ' its own ' + ws.popName(pid) + ': ' + adjusted.join(', ')
        : anyWells.length + ' well' + (anyWells.length > 1 ? 's do' : ' does') + ' not use the shared gates: ' + anyWells.join(', ');
      return h('div.sel-bar.adj-note', h('span.adj-mark', ADJ_MARK), h('span', txt), h('span.grow'),
        h('button.btn.ghost.sm', { 'data-tip': 'Put every well back on the shared gates',
          on: { click: () => { ws.clearGateOverride(null, anyWells); toast('All wells are back on the shared gates', { action: { label: 'Undo', fn: () => ws.undo() } }); } } }, 'Reset all'));
    }
    const mine = ws.adjustedGates(src.key);
    const gate = pid ? ws.gate(pid) : null;
    const apply = anchor => {
      const items = [];
      if (gate) items.push({ label: 'Use ' + srcWell + '’s ' + gate.name + ' here', icon: 'copy', disabled: !keys.length, fn: () => {
        ws.copyOverride(pid, src.key, keys);
        toast(srcWell + '’s ' + gate.name + ' copied to ' + keys.length + ' well' + (keys.length > 1 ? 's' : ''), { action: { label: 'Undo', fn: () => ws.undo() } });
      } });
      if (mine.length) items.push({ label: 'Use all ' + mine.length + ' gate' + (mine.length > 1 ? 's' : '') + ' ' + srcWell + ' has adjusted', icon: 'layers', disabled: !keys.length, fn: () => {
        ws.copyAllOverrides(src.key, keys);
        toast(srcWell + '’s gating copied to ' + keys.length + ' well' + (keys.length > 1 ? 's' : ''), { action: { label: 'Undo', fn: () => ws.undo() } });
      } });
      if (!items.length) items.push({ label: 'Nothing to copy — ' + srcWell + ' uses the shared gates', disabled: true, fn: () => {} });
      items.push('sep', { label: 'Put these wells back on the shared gates', icon: 'undo', fn: () => {
        ws.clearGateOverride(null, Array.from(sel));
        toast(sel.size + ' well' + (sel.size > 1 ? 's are' : ' is') + ' back on the shared gates', { action: { label: 'Undo', fn: () => ws.undo() } });
      } });
      menu(anchor, items, { align: 'right' });
    };
    return h('div.sel-bar.on',
      h('span', h('strong', String(sel.size)), sel.size > 1 ? ' wells selected' : ' well selected'),
      h('span.grow'),
      h('button.btn.ghost.sm', { on: { click: () => FM.setUI({ wellSel: [] }) } }, 'Clear'),
      h('button.btn.sm.fig-btn', { 'data-tip': 'Save this plot for each selected well as a figure, with a title on each', on: { click: () => openFigures(m) } }, icon('download'), 'Figures…'),
      h('button.btn.sm.primary', { on: { click: e => apply(e.currentTarget) } }, 'Apply…', icon('down')));
  }

  // -------------------------------------------------------------- filmstrip
  function stripOrder() {
    const ws = W();
    const out = [];
    const seen = new Set();
    ws.doc.groups.forEach(g => ws.samplesIn(g.id).forEach(s => { out.push({ s, g }); seen.add(s.key); }));
    ws.samples.forEach(s => { if (!seen.has(s.key)) out.push({ s, g: null }); });
    return out;
  }

  /** The bottom panel: the filmstrip of plots, or the table of every number. */
  function renderStrip(m) {
    const ws = W();
    const tab = FM.ui.bottomTab === 'table' ? 'table' : 'strip';
    clear(els.stripHead);
    const pid = focusPop(m);
    const tabBtn = (id, label, tip) => h('button.bt' + (tab === id ? '.on' : ''), {
      'data-tip': tip, 'aria-pressed': tab === id ? 'true' : 'false',
      on: { click: () => { if (tab === id) return; FM.ui.bottomTab = id; FM.savePrefs(); stripOpen = true; renderAll(); FM.dom.frame(() => pv && pv.render()); } },
    }, label);
    FM.dom.append(els.stripHead, [
      h('button.btn.ghost.sm.icon', { 'data-tip': stripOpen ? 'Hide this panel' : 'Show this panel', on: { click: () => { stripOpen = !stripOpen; els.stripEl.classList.toggle('closed', !stripOpen); if (stripOpen) renderStrip(current()); FM.dom.frame(() => pv && pv.render()); } } }, icon(stripOpen ? 'down' : 'up')),
      h('div.seg.sm.bottom-tabs', tabBtn('strip', 'Every well', 'One plot per well'), tabBtn('table', 'Table', 'Every population’s number in every well, and what adjusting a well did')),
      tab === 'strip'
        ? h('span.muted.small', ws.popName(m.popId) + ' · ' + m.x + (m.y ? ' vs ' + m.y : ' histogram') + (pid && pid !== m.popId ? ' · ' + ws.popName(pid) + ' gate' : ''))
        : h('span.muted.small', ws.doc.gates.length + ' population' + (ws.doc.gates.length === 1 ? '' : 's') + ' × ' + ws.samples.length + ' wells'),
      h('span.grow'),
      tab === 'strip' ? h('button.btn.ghost.sm.fig-export', { 'data-tip': 'Save this plot for chosen wells as figures, each with its own title (shift-click tiles to pick them first)',
        on: { click: () => openFigures(m) } }, icon('download'), FM.ui.wellSel.length ? 'Export ' + FM.ui.wellSel.length + ' as figures…' : 'Export figures…') : null,
      tab === 'table' ? FM.gateTable.controls({
        mode: FM.ui.tableMode, delta: FM.ui.tableDelta,
        onMode: v => { FM.ui.tableMode = v; FM.savePrefs(); renderStrip(current()); },
        onDelta: v => { FM.ui.tableDelta = v; FM.savePrefs(); renderStrip(current()); },
      }) : null]);
    els.stripScroll.classList.toggle('hidden', tab !== 'strip');
    els.table.classList.toggle('hidden', tab !== 'table');
    els.stripEl.classList.toggle('tabled', tab === 'table');
    if (!stripOpen) return;
    if (tab === 'table') {
      FM.gateTable.render(els.table, {
        mode: FM.ui.tableMode, delta: FM.ui.tableDelta,
        onPick: (key, gateId) => FM.setUI({ sampleKey: key, gateId, popId: (ws.gate(gateId) || {}).parent || null }),
      });
      return;
    }
    const order = stripOrder();
    const keys = new Set(order.map(o => o.s.key));
    // drop thumbs for removed samples
    thumbs.forEach((t, k) => { if (!keys.has(k)) { t.el.remove(); thumbs.delete(k); } });
    const frag = document.createDocumentFragment();
    let lastG;
    clear(els.strip);
    order.forEach(({ s, g }) => {
      if (g !== lastG) {
        lastG = g;
        frag.appendChild(h('div.strip-group', { style: { '--gc': g ? g.color : 'var(--faint)' } }, g ? g.name : 'No condition'));
      }
      let t = thumbs.get(s.key);
      if (!t) {
        const data = h('canvas'), over = h('canvas');
        const el = h('button.thumb', { 'data-tip': 'Click to show · shift- or ctrl-click to select for export', on: { click: e => cellClick(e, s.key) } },
          h('div.thumb-cv', data, over), h('div.thumb-l'));
        t = { el, data, over, dataKey: '' };
        thumbs.set(s.key, t);
      }
      const info = ws.wellInfo(s.key);
      const mine = ws.adjustedGates(s.key);
      t.el.classList.toggle('cur', s.key === m.sample.key);
      t.el.classList.toggle('excl', !!info.excluded);
      t.el.classList.toggle('adj', !!mine.length);
      t.el.classList.toggle('picked', FM.ui.wellSel.includes(s.key));
      const lab = t.el.querySelector('.thumb-l');
      clear(lab);
      FM.dom.append(lab, [h('span.mono', s.well || s.name),
        mine.length ? h('span.thumb-adj', { 'data-tip': s.well + ' uses its own ' + mine.map(g => g.name).join(', ') }, ADJ_MARK) : null,
        info.excluded ? h('span.thumb-x', { 'data-tip': info.reason || 'Excluded' }, icon('ban')) : null]);
      frag.appendChild(t.el);
    });
    els.strip.appendChild(frag);
    queueThumbs(order.map(o => o.s), m);
  }

  function queueThumbs(samples, m) {
    thumbQueue = samples.map(s => ({ s, m }));
    // current tile first, then the tiles in view, then the rest by distance from the view
    const sc = els.strip && els.strip.parentElement;
    const mid = sc ? sc.scrollLeft + sc.clientWidth / 2 : 0;
    const dist = s => { const t = thumbs.get(s.key); return t && sc ? Math.abs(t.el.offsetLeft - mid) : 0; };
    thumbQueue.sort((a, b) => ((b.s.key === m.sample.key) - (a.s.key === m.sample.key)) || (dist(a.s) - dist(b.s)));
    if (thumbRaf) thumbRaf.cancel();
    const work = () => {
      const t0 = performance.now();
      while (thumbQueue.length && performance.now() - t0 < 12) {
        const { s, m: mm } = thumbQueue.shift();
        drawThumb(s, mm);
      }
      if (thumbQueue.length) thumbRaf = FM.dom.frame(work);
    };
    thumbRaf = FM.dom.frame(work);
  }

  function drawThumb(s, m) {
    const t = thumbs.get(s.key);
    if (!t || !root) return;
    const ws = W();
    const v = ws.view(m.popId);
    const z = v && v.zoom && v.zoom.x === m.x && (v.zoom.y || null) === (m.y || null) ? v.zoom.win : null;
    const L = P.layout(104, 88, { compact: true, win: z });
    const xSpec = ws.viewScale(m.popId, m.x), ySpec = m.y ? ws.viewScale(m.popId, m.y) : null;
    const key = [ws.engine.stamp(s, m.popId), m.x, m.y, T.specKey(xSpec), T.specKey(ySpec), FM.ui.cmap, FM.ui.dotScale, FM.ui.themeTick || 0, document.documentElement.dataset.theme || '', JSON.stringify(z)].join('|');
    if (key !== t.dataKey) {
      P.render(t.data, L, { sample: s, idx: ws.indices(s, m.popId), x: m.x, y: m.y, xSpec, ySpec, cmap: FM.ui.cmap, dotScale: FM.ui.dotScale });
      t.dataKey = key;
    }
    const ctx = P.sizeCanvas(t.over, L);
    ctx.clearRect(0, 0, L.W, L.H);
    const sel = FM.ui.gateId;
    const items = ws.children(m.popId, s.key).filter(g => P.gateFits(g, m.x, m.y))
      .map(g => ws.gateFor(g, s.key))   // each tile shows the gate as its own well sees it
      .map(g => ({ gate: g, outline: P.gateOutline(g, L, xSpec, ySpec), pct: ws.pct(s, g.id), selected: g.id === sel }));
    P.drawGates(ctx, L, items, { labels: false });
    // with a gate selected only its % is labelled, so the tiles stay readable
    const labelled = items.some(it => it.selected) ? items.filter(it => it.selected) : items.slice(0, 2);
    P.drawGates(ctx, L, labelled, { outlines: false });
  }

  /** The figure dialog for the plot on screen, starting from the selected wells. */
  function openFigures(m) {
    const v = W().view(m.popId);
    const win = v && v.zoom && v.zoom.x === m.x && (v.zoom.y || null) === (m.y || null) ? v.zoom.win : null;
    FM.wellFigures.open({ popId: m.popId || null, x: m.x, y: m.y || null, win }, FM.ui.wellSel.filter(k => W().sample(k)));
  }

  // ----------------------------------------------------------------- actions
  function setSample(key) {
    if (!key || key === FM.ui.sampleKey) return;
    FM.setUI({ sampleKey: key });
  }
  function step(d) {
    const S = W().samples;
    const order = stripOrder().map(o => o.s);
    const list = order.length === S.length ? order : S;
    const i = list.findIndex(s => s.key === FM.ui.sampleKey);
    const j = Math.max(0, Math.min(list.length - 1, i + d));
    if (j !== i) setSample(list[j].key);
    const t = thumbs.get(list[j].key);
    if (t) t.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function setTool(t) {
    if (pv) pv.cancelDraft();
    const m = pv && pv.model;
    if (m && ((t === 'range' && m.y) || ((t === 'polygon' || t === 'rect' || t === 'ellipse' || t === 'quad') && !m.y))) {
      toast(t === 'range' ? 'Range gates are drawn on histograms — set Y to Histogram' : 'That gate needs a 2-D plot — pick a Y parameter');
      return;
    }
    // a new gate is always drawn for the whole plate; a single well can only differ from one later
    const patch = { tool: t };
    if (t !== 'select' && FM.ui.gateScope === 'well') {
      patch.gateScope = 'all';
      toast('Back to all wells — a new gate is drawn on every well. Adjust it for one well after it exists.');
    }
    FM.setUI(patch);
  }

  function drill(popId) {
    const ws = W();
    if (pv) pv.cancelDraft();
    if (popId && !(ws.view(popId) || {}).x) ws.setView(popId, defaultAxes(popId));
    FM.setUI({ popId: popId || null, gateId: null, tool: 'select' });
  }

  function suggestName(gate, model) {
    const m = model || pv.model;
    const ws = W();
    const parent = m.popId ? ws.gate(m.popId) : null;
    if (!parent && /^FSC/i.test(m.x)) return 'Cells';
    if (/^SSC-?A$/i.test(m.x) && /^SSC-?H$/i.test(m.y || '') || /^FSC-?A$/i.test(m.x) && /^FSC-?H$/i.test(m.y || '')) return 'Singles';
    if (gate.type === 'range' || !/^(FSC|SSC)/i.test(m.x)) return m.x.replace(/-[AHW]$/, '') + '+';
    return 'Gate';
  }

  function renamePopover(id, fresh, view) {
    const g = W().gate(id);
    if (!g || !pv) return;
    const at = view || pv;
    FM.dom.frame(() => {
      const inp = h('input.input', { value: g.name, 'aria-label': 'Gate name' });
      const err = h('div.form-error.small.hidden');
      const save = () => {
        const v = inp.value.trim();
        if (!v || v === g.name) { FM.dom.closePop(); return; }
        if (!W().renameGate(id, v)) { err.textContent = 'Another gate is already called “' + v + '”'; err.classList.remove('hidden'); return; }
        FM.dom.closePop();
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') FM.dom.closePop(); });
      popover(at.labelAnchor(id), h('div.rename-pop', h('div.eyebrow', fresh ? 'Name the new gate' : 'Rename gate'), h('div.row', inp, h('button.btn.primary.sm', { on: { click: save } }, 'Save')), err,
        fresh ? h('div.muted.small', 'It already applies to all ' + W().samples.length + ' wells.') : null), { width: 280 });
      inp.select();
    });
  }

  function gateMenu(id, anchor) {
    const ws = W();
    const g = ws.gate(id);
    if (!g) return;
    const kids = ws.descendants(id).length;
    const s = FM.currentSample();
    const well = s.well || s.name;
    const mine = ws.isAdjusted(id, s.key);
    const adjusted = ws.adjustedWells(id);
    const items = [
      { label: 'Rename', icon: 'edit', hint: 'F2', fn: () => renamePopover(id) },
      { label: 'Edit coordinates…', icon: 'gear', fn: () => coordsDialog(id) },
      { label: 'Open population', icon: 'right', hint: 'dbl-click', fn: () => drill(id) },
      { label: 'Duplicate', icon: 'copy', fn: () => { const nid = ws.duplicateGate(id); FM.setUI({ gateId: nid }); } },
      { label: 'Combine with other populations…', icon: 'layers', fn: () => FM.combineDialog([id]) },
      { label: 'Export its events (CSV)…', icon: 'download', fn: () => FM.io.exportEventsDialog({ popId: id }) },
    ];
    if (g.type !== 'bool' && g.type !== 'quad') items.push({ label: g.outside ? 'Keep the events inside' : 'Keep the events outside', icon: 'ban',
      fn: () => ws.updateGate(id, { outside: !g.outside }, { label: (g.outside ? 'Inside ' : 'Outside ') + g.name }) });
    const grp = ws.groupOf(s.key);
    items.push('sep', { heading: 'Applies to · now ' + ws.scopeText(g) },
      { label: 'Every sample', icon: FM.scope.isScoped(g) ? null : 'check', fn: () => ws.setGateScope(id, null) },
      grp ? { label: 'Group ' + grp.name + ' only', fn: () => ws.setGateScope(id, { groups: [grp.id] }) } : null,
      { label: 'Only ' + well, fn: () => ws.setGateScope(id, { samples: [s.key] }) });
    if (mine) {
      items.push('sep',
        { label: 'Put ' + well + ' back on the shared ' + g.name, icon: 'undo', fn: () => {
          ws.clearGateOverride(id, [s.key]);
          toast(well + ' is back on the shared ' + g.name, { action: { label: 'Undo', fn: () => ws.undo() } });
        } },
        { label: 'Use ' + well + '’s ' + g.name + ' for every well', icon: 'layers', fn: () => promote(id, s) });
    }
    if (adjusted.length) {
      items.push({ label: 'Reset all ' + adjusted.length + ' adjusted well' + (adjusted.length > 1 ? 's' : ''), icon: 'undo', fn: () => {
        ws.clearGateOverride(id, adjusted);
        toast(adjusted.length + ' well' + (adjusted.length > 1 ? 's are' : ' is') + ' back on the shared ' + g.name, { action: { label: 'Undo', fn: () => ws.undo() } });
      } });
    }
    items.push('sep',
      { label: 'Delete' + (kids ? ' with ' + kids + ' sub-gate' + (kids > 1 ? 's' : '') : ''), icon: 'trash', danger: true, hint: 'Del', fn: () => deleteGate(id) });
    menu(anchor, items.filter(Boolean));
  }

  /** Make this well's version the shared one — it changes every other well, so it asks first. */
  async function promote(id, s) {
    const ws = W();
    const g = ws.gate(id);
    const well = s.well || s.name;
    const others = ws.samples.length - 1;
    const alsoReset = ws.adjustedWells(id).filter(k => k !== s.key);
    const ok = await FM.dom.confirm('Use ' + well + '’s ' + g.name + ' everywhere?',
      'The shared ' + g.name + ' is replaced by the one you drew on ' + well + ', changing it on ' + others + ' other well' + (others === 1 ? '' : 's') + '.'
      + (alsoReset.length ? ' ' + alsoReset.length + ' well' + (alsoReset.length > 1 ? 's that had' : ' that had') + ' their own version (' + alsoReset.join(', ') + ') go back to the shared gate too.' : ''),
      'Use it everywhere');
    if (!ok) return;
    ws.promoteOverride(id, s.key);
    toast(well + '’s ' + g.name + ' is now the shared gate', { action: { label: 'Undo', fn: () => ws.undo() } });
  }

  /** Put one well back on every shared gate. */
  function resetWell(key) {
    const ws = W();
    const n = ws.adjustedGates(key).length;
    if (!n) return;
    ws.clearGateOverride(null, [key]);
    toast(key + ' is back on the shared gates (' + n + ' gate' + (n > 1 ? 's' : '') + ')', { action: { label: 'Undo', fn: () => ws.undo() } });
  }

  /** Type exact gate boundaries, in the parameters' own units (e.g. FL1-H > 60,000). */
  function coordsDialog(id) {
    const ws = W();
    const shared = ws.gate(id);
    if (!shared) return;
    const s = FM.currentSample();
    const well = s.well || s.name;
    // typing coordinates goes wherever the toolbar switch points, and shows that well's numbers
    const scoped = FM.ui.gateScope === 'well';
    const g = scoped ? ws.gateFor(shared, s.key) : shared;
    const parse = FM.axisUI.parseNumber;
    const fmt = v => (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '');
    const num = (label, value) => {
      const inp = h('input.input.mono', { value: fmt(value), inputmode: 'decimal' });
      return { el: h('div.field', h('label', label), inp), get: () => parse(inp.value), inp };
    };
    let fields = [], build;
    const body = h('div.col');
    const err = h('div.form-error.hidden');
    if (g.type === 'rect') {
      fields = [num(g.x + ' from', Math.min(g.rect.x0, g.rect.x1)), num(g.x + ' to', Math.max(g.rect.x0, g.rect.x1)),
        num(g.y + ' from', Math.min(g.rect.y0, g.rect.y1)), num(g.y + ' to', Math.max(g.rect.y0, g.rect.y1))];
      build = v => ({ rect: { x0: v[0], x1: v[1], y0: v[2], y1: v[3] } });
    } else if (g.type === 'range') {
      fields = [num(g.x + ' from', Math.min(g.range.lo, g.range.hi)), num(g.x + ' to', Math.max(g.range.lo, g.range.hi))];
      build = v => ({ range: { lo: v[0], hi: v[1] } });
    } else if (g.type === 'quad') {
      fields = [num(g.x + ' split at', g.quad.cx), num(g.y + ' split at', g.quad.cy)];
      build = v => ({ quad: { cx: v[0], cy: v[1] } });
    } else if (g.type === 'ellipse') {
      const e = g.ellipse;
      fields = [num('Centre · ' + g.x, e.cx), num('Centre · ' + g.y, e.cy), num('Half-width (axis units, 0–1)', e.rx), num('Half-height (axis units, 0–1)', e.ry), num('Turned by (degrees)', e.angle * 180 / Math.PI)];
      build = v => ({ ellipse: { cx: v[0], cy: v[1], rx: Math.abs(v[2]), ry: Math.abs(v[3]), angle: v[4] * Math.PI / 180 } });
    } else if (g.type === 'bool') {
      toast(g.name + ' is a Boolean gate: it has no shape. Use Combine to make a different one.');
      return;
    } else {
      g.verts.forEach((p, i) => { fields.push(num('Point ' + (i + 1) + ' · ' + g.x, p[0])); fields.push(num('Point ' + (i + 1) + ' · ' + g.y, p[1])); });
      build = v => ({ verts: g.verts.map((_, i) => [v[2 * i], v[2 * i + 1]]) });
    }
    body.appendChild(h('div.coords-grid', fields.map(f => f.el)));
    body.appendChild(h('p.muted.small', 'Values are in instrument units. Shorthand works: 60k, 1.5M, 3e6.' + (g.type === 'rect' || g.type === 'range' ? ' Leave a box empty for no limit on that side.' : '')));
    body.appendChild(err);
    // an empty box on a rectangle or range is an open side (no limit there)
    const openOK = g.type === 'rect' || g.type === 'range';
    const apply = () => {
      const v = fields.map(f => (openOK && !f.inp.value.trim() ? null : f.get()));
      const bad = fields.filter((f, i) => v[i] !== null && !Number.isFinite(v[i]));
      fields.forEach((f, i) => f.inp.classList.toggle('bad', v[i] !== null && !Number.isFinite(v[i])));
      if (bad.length) { err.textContent = 'Enter a number in every field.'; err.classList.remove('hidden'); return false; }
      const patch = build(v);
      if (scoped) ws.setGateOverride(id, s.key, patch, { label: 'Set ' + g.name + ' coordinates for ' + well });
      else if (g.type === 'quad') ws.updateQuad(g.link, patch.quad, { label: 'Set quadrant position' });
      else ws.updateGate(id, patch, { label: 'Set ' + g.name + ' coordinates' });
      toast(g.name + (scoped ? ' updated on ' + well + ' only' : ' updated on every well'));
      return true;
    };
    const m = FM.dom.modal({
      title: 'Coordinates of ' + g.name + (scoped ? ' on ' + well : ''),
      subtitle: scoped ? 'These numbers apply to ' + well + ' alone — every other well keeps the shared gate.'
        : g.type === 'polygon' ? 'Polygon vertices, in order.' : 'The gate applies to every well.',
      body, buttons: [{ label: 'Cancel' }, { label: 'Apply', primary: true, fn: apply }],
      onEnter: () => { if (apply() !== false) m.close(); },
    });
  }

  function deleteGate(id) {
    const ws = W();
    const g = ws.gate(id);
    if (!g) return;
    const kids = ws.descendants(id).length;
    ws.deleteGate(id);
    FM.setUI({ gateId: null });
    toast('Deleted ' + g.name + (kids ? ' and ' + kids + ' sub-gate' + (kids > 1 ? 's' : '') : ''), { action: { label: 'Undo', fn: () => ws.undo() } });
  }

  // ----------------------------------------------------------------- events
  function onKey(e) {
    if (!pv) return false;
    // every shortcut here is a bare key: Ctrl+P must stay Print, not the polygon tool
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key;
    if (k === 'ArrowLeft') { step(-1); return true; }
    if (k === 'ArrowRight') { step(1); return true; }
    if (suggestion && k === 'Enter') { acceptSuggestion(); return true; }
    if (suggestion && k === 'Escape') { dismissSuggestion(); return true; }
    if (k === 'g' || k === 'G') { runSuggest(); return true; }
    if (k === '+' || k === '=') { pv.zoomBy(1 / 1.5); return true; }
    if (k === '-' || k === '_') { pv.zoomBy(1.5); return true; }
    if (k === '0') { pv.resetZoom(); return true; }
    if (k === '[') { setDotScale(-1); return true; }
    if (k === ']') { setDotScale(1); return true; }
    if (k === 'f' || k === 'F') { toggleFocus(); return true; }
    if (k === 'Escape') {
      if (pv.cancelDraft()) return true;
      if (FM.ui.tool !== 'select') { setTool('select'); return true; }
      if (FM.ui.gateId) { FM.setUI({ gateId: null }); return true; }
      return false;
    }
    if (k === 'Enter' && pv.draft && pv.draft.type === 'polygon') { pv.finishDraft(); return true; }
    if (k === 'Backspace' && pv.draft) { pv.undoDraftPoint(); return true; }
    if ((k === 'Delete' || k === 'Backspace') && FM.ui.gateId && !pv.draft) { deleteGate(FM.ui.gateId); return true; }
    if (k === 'F2' && FM.ui.gateId) { renamePopover(FM.ui.gateId); return true; }
    const map = { v: 'select', p: 'polygon', r: 'rect', e: 'ellipse', q: 'quad', h: 'range' };
    if (map[k.toLowerCase()]) { setTool(map[k.toLowerCase()]); return true; }
    return false;
  }

  let pending = null;
  function update(kind, detail) {
    if (!root || !pv) { if (kind === 'ws:samples' && root) mount(root); return; }
    if (kind === 'ws:samples') { mount(root); return; }
    if (kind === 'ui') {
      const keys = Object.keys(detail || {});
      // the scope switch and the plate selection change panels the fast path does not touch
      if (keys.includes('sampleKey') && !keys.includes('wellSel') && !keys.includes('gateScope')) {
        const m = current();
        keepScroll(() => { renderToolbar(m); renderCrumbs(m); renderTree(m); pv.set(m); renderWells(m); });
        thumbs.forEach((t, k) => t.el.classList.toggle('cur', k === m.sample.key));
        return;
      }
      renderAll();
      return;
    }
    if (kind === 'ws:gates' || kind === 'ws:comp' || kind === 'ws:doc' || kind === 'ws:axes' || kind === 'ws:groups' || kind === 'ws:view' || kind === 'theme' || kind === 'resize') {
      if (kind === 'theme') { FM.ui.themeTick = (FM.ui.themeTick || 0) + 1; }
      // gate edits arrive in bursts during a drag: coalesce to one frame
      if (pending) return;
      pending = FM.dom.frame(() => { pending = null; if (root && pv) renderAll(); });
    }
  }

  FM.gateGlyph = gateGlyph;

  /** The scope a new gate gets from the Gate step's switch: null (every sample), a group or a sample. */
  FM.newGateScope = function () {
    const s = FM.currentSample();
    if (!s || FM.ui.newScope === 'all') return null;
    if (FM.ui.newScope === 'sample') return { samples: [s.key] };
    const g = FM.ws.groupOf(s.key);
    return g ? { groups: [g.id] } : null;
  };
  FM.views = FM.views || {};
  FM.views.gate = { mount, update, onKey, unmount, _plotView: () => pv, _coords: id => coordsDialog(id), _figures: () => openFigures(current()), _suggestion: () => suggestion };  // _plotView: for the UI self-test
})(FM);
