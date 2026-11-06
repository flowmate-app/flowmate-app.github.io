/* App shell: UI state, top bar and stepper, view routing, file loading, keyboard, autosave. */
(function (FM) {
  'use strict';
  const { h, icon, clear, toast, menu, modal } = FM.dom;

  // --------------------------------------------------------------- UI state
  const listeners = new Set();
  FM.bus = {
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(kind, detail) { listeners.forEach(fn => { try { fn(kind, detail); } catch (e) { console.error(e); } }); },
  };

  const prefs = FM.store.getJSON('prefs', {}) || {};
  FM.ui = {
    step: 'load',
    newScope: 'all',           // Gate: where a new gate applies — 'all' | 'group' | 'sample'
    multiSel: [],              // Gate: populations picked for Combine
    sampleKey: null,
    popId: null,
    gateId: null,
    tool: 'select',
    gateScope: 'all',          // 'all' | 'well' — which wells a gate edit lands on
    wellSel: [],               // wells picked on the Gate step's plate map, for bulk actions
    metricId: null,
    cmap: prefs.cmap || 'turbo',
    gateLayout: prefs.gateLayout === 'sheet' ? 'sheet' : 'single',   // Gate step: one plot, or the worksheet of all plots
    dotScale: [0.5, 0.75, 1, 1.5, 2, 3].includes(prefs.dotScale) ? prefs.dotScale : 1,   // − / + on the Gate step: how big events are drawn
    focus: !!prefs.focus,
    bottomTab: prefs.bottomTab === 'table' ? 'table' : 'strip',   // Gate step's bottom panel
    tableMode: prefs.tableMode || 'parent',
    tableDelta: !!prefs.tableDelta,
    wellsShow: ['pct', 'events', 'both'].includes(prefs.wellsShow2) ? prefs.wellsShow2 : 'both',   // Gate step's plate panel: % and events by default
    showOrder: false,
    theme: prefs.theme || 'system',
  };
  FM.setUI = function (patch) {
    Object.assign(FM.ui, patch);
    FM.bus.emit('ui', patch);
  };
  function savePrefs() {
    FM.store.setJSON('prefs', { cmap: FM.ui.cmap, dotScale: FM.ui.dotScale, gateLayout: FM.ui.gateLayout, theme: FM.ui.theme, focus: FM.ui.focus, bottomTab: FM.ui.bottomTab, tableMode: FM.ui.tableMode, tableDelta: FM.ui.tableDelta, wellsShow2: FM.ui.wellsShow });
  }
  FM.savePrefs = savePrefs;

  const ws = FM.ws = new FM.Workspace();
  ws.on((kind, detail) => FM.bus.emit('ws:' + kind, detail));

  /** Current sample (falls back to the first loaded). */
  FM.currentSample = function () {
    let s = FM.ui.sampleKey ? ws.sample(FM.ui.sampleKey) : null;
    if (!s && ws.samples.length) { s = ws.samples[0]; FM.ui.sampleKey = s.key; }
    return s;
  };

  // ------------------------------------------------------------------ steps
  /* One flow, five steps: load a plate, map the conditions, gate every well at once, measure, then
   * graph a measurement by condition. Unmixing (beta) is a page of its own, opened from the Gate step;
   * the Guide, the Planner (beta) and About are pages too. */
  const STEPS = [
    { id: 'load', label: 'Load', icon: 'file' },
    { id: 'plate', label: 'Plate', icon: 'grid' },
    { id: 'gate', label: 'Gate', icon: 'target' },
    { id: 'measure', label: 'Measure', icon: 'table' },
    { id: 'analysis', label: 'Analysis', icon: 'chart' },
  ];
  // old links and saved analyses name steps that have been renamed or folded in
  const ALIAS = { results: 'measure', tables: 'measure', workspace: 'load', comp: 'unmix' };
  FM.STEPS = STEPS;
  FM.views = FM.views || {};

  let current = null;     // mounted view object
  let viewEl = null;

  function go(step) {
    step = ALIAS[step] || step;
    if (!FM.views[step]) return;
    if (FM.ui.step !== step) FM.library.touch();
    if (current && current.unmount) current.unmount();
    FM.dom.closePop();
    // the per-well scope is a mode: arriving at a step always starts on "all wells"
    FM.ui.gateScope = 'all';
    FM.ui.wellSel = [];
    FM.ui.step = step;
    clear(viewEl);
    viewEl.className = 'view view-' + step;
    current = FM.views[step];
    current.mount(viewEl);
    renderStepper();
    try { history.replaceState(null, '', '#' + step); } catch (_) { /* file:// may refuse */ }
  }
  FM.go = go;
  /** Home is the Load step: files, My analyses, a new start. */
  const homeStep = () => 'load';
  FM.homeStep = homeStep;

  // ---------------------------------------------------------------- top bar
  let stepperEl, undoBtn, redoBtn, nameInput, statusEl;

  function stepState(id) {
    const n = ws.samples.length;
    if (id === 'load') return n ? 'done' : 'todo';
    if (!n) return 'locked';
    if (id === 'measure') return (ws.doc.tables || []).some(t => t.columns.length) ? 'done' : 'todo';
    if (id === 'plate') return ws.doc.groups.length ? 'done' : 'todo';
    if (id === 'unmix') return ws.doc.comp && ws.doc.comp.confirmed ? 'done' : 'todo';
    if (id === 'gate') return ws.doc.gates.length ? 'done' : 'todo';
    if (id === 'analysis') return (ws.doc.graphs || []).length ? 'done' : 'todo';
    return 'todo';
  }

  function renderStepper() {
    if (!stepperEl) return;
    clear(stepperEl);
    const steps = STEPS;
    const cur = steps.findIndex(s => s.id === FM.ui.step);
    steps.forEach((st, i) => {
      const state = stepState(st.id);
      const b = h('button.step' + (FM.ui.step === st.id ? '.on' : '') + '.' + state, {
        on: { click: () => go(st.id) }, 'data-tip': st.label + ' — press ' + (i + 1), 'aria-label': st.label,
        'aria-current': FM.ui.step === st.id ? 'step' : null,
      },
        h('span.step-n', state === 'done' && FM.ui.step !== st.id ? icon('check') : String(i + 1)),
        h('span.step-l', st.label));
      stepperEl.appendChild(b);
      // connectors on the way to the current step carry a drifting particle
      if (i < steps.length - 1) stepperEl.appendChild(h('span.step-join' + (i < cur ? '.flowing' : '')));
    });
  }

  function renderUndo() {
    if (!undoBtn) return;
    undoBtn.disabled = !ws.canUndo();
    redoBtn.disabled = !ws.canRedo();
    undoBtn.dataset.tip = ws.canUndo() ? 'Undo ' + ws.undoLabel() + ' (Ctrl+Z)' : 'Nothing to undo';
    redoBtn.dataset.tip = ws.canRedo() ? 'Redo ' + ws.redoLabel() + ' (Ctrl+Shift+Z)' : 'Nothing to redo';
  }

  function renderStatus() {
    if (!statusEl) return;
    const n = ws.samples.length;
    const ev = ws.samples.reduce((a, s) => a + s.n, 0);
    statusEl.textContent = n ? n + ' files · ' + FM.dom.fmtCount(ev) + ' events' : '';
  }

  function applyTheme() {
    const t = FM.ui.theme;
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    FM.plot.invalidateTheme();
  }
  function isDark() {
    const t = FM.ui.theme;
    return t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function buildTopbar() {
    nameInput = h('input.exp-name', {
      value: ws.doc.name, spellcheck: false, 'aria-label': 'Experiment name',
      on: {
        change: () => ws.update('Rename experiment', d => { d.name = nameInput.value.trim() || 'Untitled experiment'; }, { kind: 'settings' }),
        keydown: e => { if (e.key === 'Enter') nameInput.blur(); },
      },
    });
    stepperEl = h('nav.stepper', { 'aria-label': 'Analysis steps' });
    undoBtn = h('button.btn.ghost.icon', { on: { click: () => doUndo() } }, icon('undo'));
    redoBtn = h('button.btn.ghost.icon', { on: { click: () => doRedo() } }, icon('redo'));
    const themeBtn = h('button.btn.ghost.icon', { 'data-tip': 'Light / dark', on: { click: () => {
      FM.ui.theme = isDark() ? 'light' : 'dark';
      applyTheme(); savePrefs();
      clear(themeBtn); themeBtn.appendChild(icon(isDark() ? 'sun' : 'moon'));
      FM.bus.emit('theme');
    } } }, icon(isDark() ? 'sun' : 'moon'));
    const fileBtn = h('button.btn.sm', { on: { click: e => fileMenu(e.currentTarget) } }, icon('save'), h('span.lbl', 'File'), icon('down'));
    const layBtn = h('button.btn.ghost.sm.layout-btn', { 'data-tip': 'Arrange plots on a page to build a figure', on: { click: () => FM.openLayout() } }, icon('grid'), h('span.lbl', 'Figures'));
    const planBtn = h('button.btn.ghost.sm.planner-btn', { 'data-tip': 'Plan which dyes, lasers and detectors to use — a beta tool', on: { click: () => FM.openPlanner() } }, icon('spectrum'), h('span.lbl', 'Planner'), h('span.beta', 'beta'));
    const aboutBtn = h('button.btn.ghost.sm.about-btn', { 'data-tip': 'What FlowMate is, how it is checked, and how to get involved', on: { click: () => FM.openAbout() } }, icon('info'), h('span.lbl', 'About'));
    const helpBtn = h('button.btn.ghost.sm.guide-btn', { 'data-tip': 'A short walk through an example analysis', on: { click: () => FM.openGuide() } }, icon('help'), h('span.lbl', 'Guide'));
    statusEl = h('span.status.mono');
    const libBtn = h('button.btn.ghost.sm.lib-btn', { 'data-tip': 'Your saved analyses — open one to carry on where you left off', on: { click: () => FM.library.show() } }, icon('layers'), h('span.lbl', 'My analyses'));

    return h('header.topbar', h('span.laser-glint', { 'aria-hidden': 'true' }),
      h('div.brand.home-link', { role: 'link', tabindex: '0', title: 'FlowMate ' + FM.version + ' — back to the start',
        on: { click: () => go(homeStep()), keydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(homeStep()); } } } },
        FM.brand.mark(26), FM.brand.wordmark()),
      h('div.exp', nameInput, FM.library.statusChip(), statusEl),
      stepperEl,
      h('div.top-actions', undoBtn, redoBtn, h('span.sep'), themeBtn, layBtn, planBtn, helpBtn, aboutBtn, libBtn, fileBtn));
  }

  function doUndo() { const l = ws.undo(); if (l) toast('Undid ' + l); }
  function doRedo() { const l = ws.redo(); if (l) toast('Redid ' + l); }

  function fileMenu(anchor) {
    const hasData = ws.samples.length > 0;
    menu(anchor, [
      { label: 'New analysis…', icon: 'plus', fn: newAnalysis },
      'sep',
      { heading: 'My analyses' },
      { label: FM.library.current() ? 'Save now' : 'Save to My analyses…', icon: 'save', hint: 'Ctrl+S', fn: () => FM.library.save() },
      { label: 'Save a copy…', icon: 'copy', fn: () => FM.library.saveAs({ copy: true }), disabled: !FM.library.current() },
      { label: 'My analyses…', icon: 'layers', fn: () => FM.library.show() },
      'sep',
      { heading: 'Share' },
      { label: 'Share this analysis…', icon: 'upload', fn: () => FM.library.share(), disabled: !hasData && !ws.doc.gates.length },
      { label: 'Open a shared analysis or template…', icon: 'folder', fn: () => FM.io.openDocument() },
      { label: 'Save gates and layout as a template', icon: 'copy', fn: () => FM.io.saveTemplate(), disabled: !ws.doc.gates.length && !ws.doc.groups.length },
      'sep',
      { heading: 'Export' },
      { label: 'Per-well gate statistics (CSV)', icon: 'download', fn: () => FM.io.exportWellsCSV(), disabled: !hasData },
      { label: 'All population statistics (CSV)', icon: 'download', fn: () => FM.io.exportPopStatsCSV(), disabled: !hasData || !ws.doc.gates.length },
      { label: 'Events — the value of every cell (CSV)…', icon: 'download', fn: () => FM.io.exportEventsDialog(), disabled: !hasData },
    ], { align: 'right' });
  }

  /** Clear files, gates, groups and metrics without asking (Start over asks first). */
  FM.resetAll = function () {
    // leave the step first: a view must not redraw while the samples are taken from under it
    if (current && FM.ui.step !== 'load') go('load');
    // what was open stays in My analyses as it was; the empty workspace is not saved over it
    FM.library.detach();
    ws.samples = [];
    ws.loadDoc(FM.workspaceUtil.defaultDoc());
    ws.undoStack = []; ws.redoStack = [];
    FM.store.remove('autosave');
    FM.setUI({ sampleKey: null, popId: null, gateId: null });
    if (nameInput) nameInput.value = ws.doc.name;
    FM.bus.emit('ws:samples', {});
  };

  /** Close what is open and start again from the Load step. */
  async function newAnalysis() {
    if (empty()) { go(homeStep()); return; }
    const saved = FM.library.current();
    const ok = await FM.dom.confirm('Start a new analysis?',
      saved ? 'This closes “' + saved.name + '”. It stays in My analyses, saved as it is now.'
        : 'What is open is not in My analyses and will be cleared: files, gates, conditions and graphs. Save it first (Ctrl+S) if you want to come back to it.',
      'New analysis', !saved);
    if (!ok) return;
    FM.resetAll();
    go(homeStep());
  }
  FM.newAnalysis = newAnalysis;
  const empty = () => !ws.samples.length && !ws.doc.gates.length && !ws.doc.groups.length;

  function showHelp() {
    const row = (keys, what) => h('div.help-row', h('span.help-keys', keys.map(k => h('kbd', k))), h('span', what));
    modal({
      title: 'Shortcuts',
      subtitle: 'FlowMate keeps every gate live on every well: draw once, see the whole plate move with it.',
      wide: true,
      body: h('div.help-grid',
        h('div', h('div.eyebrow', 'Anywhere'),
          row(['1', '…', '6'], 'Go to step'), row(['Ctrl', 'Z'], 'Undo'), row(['Ctrl', 'Shift', 'Z'], 'Redo'),
          row(['Ctrl', 'S'], 'Save to My analyses'), row(['?'], 'This sheet')),
        h('div', h('div.eyebrow', 'Gate step'),
          row(['←', '→'], 'Previous / next well'), row(['Wheel'], 'Zoom the plot · drag empty space to pan'), row(['+', '−', '0'], 'Zoom in / out / show all'), row(['F'], 'Focus: enlarge the plot'), row(['V'], 'Pointer'), row(['P'], 'Polygon gate'), row(['R'], 'Rectangle gate'), row(['Q'], 'Quadrant (four gates)'),
          row(['E'], 'Ellipse gate'), row(['H'], 'Range gate (histograms)'), row(['G'], 'Suggest a gate'), row(['Enter'], 'Close polygon'), row(['Backspace'], 'Remove last polygon point'),
          row(['Esc'], 'Cancel drawing / deselect'), row(['Delete'], 'Delete selected gate'),
          row(['Alt', 'click'], 'Remove a polygon vertex'), row(['Dbl-click'], 'Open the population inside a gate'))),
      buttons: [{ label: 'Close', primary: true }],
    });
  }

  // --------------------------------------------------------------- loading
  /** Parse and add FCS files. Non-FCS files are reported, not fatal. */
  FM.loadFiles = async function (files) {
    const fcs = files.filter(f => /\.(fcs|lmd)$/i.test(f.name) || !/\.[a-z0-9]{2,5}$/i.test(f.name));
    const skipped = files.length - fcs.length;
    if (!fcs.length) {
      toast(files.length ? 'No FCS files found among ' + files.length + ' file' + (files.length > 1 ? 's' : '') : 'No files', { level: 'crit' });
      return [];
    }
    const parsed = [], errors = [];
    FM.bus.emit('loading', { done: 0, total: fcs.length });
    // read every file in parallel (I/O overlaps), then parse in order, yielding for progress
    const bufs = await Promise.all(fcs.map(f => f.arrayBuffer().catch(e => e)));
    for (let i = 0; i < fcs.length; i++) {
      const f = fcs[i], buf = bufs[i];
      try {
        if (buf instanceof Error) throw buf;
        parsed.push(FM.fcs.parse(buf, f.name));
      } catch (e) {
        errors.push({ name: f.name, error: e.message });
      }
      if (i % 6 === 5) { FM.bus.emit('loading', { done: i + 1, total: fcs.length }); await new Promise(r => setTimeout(r, 0)); }
    }
    FM.bus.emit('loading', null);
    if (parsed.length) {
      ws.addSamples(parsed);
      if (!FM.ui.sampleKey) FM.ui.sampleKey = ws.samples[0].key;
    }
    FM.lastLoadErrors = errors;
    const msg = parsed.length + ' file' + (parsed.length === 1 ? '' : 's') + ' loaded' +
      (errors.length ? ' · ' + errors.length + ' could not be read' : '') + (skipped ? ' · ' + skipped + ' non-FCS skipped' : '');
    toast(msg, { level: errors.length && !parsed.length ? 'crit' : null });
    return parsed;
  };

  /** The demo plate; opts.controls adds single-stain and unstained tubes, with their roles, for the Unmix step. */
  FM.loadDemo = function (opts) {
    const demo = FM.synth.demoPlate(6000);
    ws.addSamples(demo);
    if (!FM.ui.sampleKey) FM.ui.sampleKey = ws.samples[0].key;
    if (opts && opts.controls) {
      const ctl = FM.synth.demoControls(6000);
      ws.addSamples(ctl.map(c => c.sample));
      ctl.forEach(c => {
        const s = ws.samples.find(x => x.name === c.sample.name);
        if (s) ws.assign([s.key], ws.addGroup(c.name, c.role));
      });
      toast('Demo plate loaded — 18 wells, plus 4 control tubes for unmixing (CD11b PE, Live/Dead APC and the bead dye spill into each other)', { ms: 6000 });
      return;
    }
    toast('Demo plate loaded — 18 synthetic wells');
  };

  // --------------------------------------------------------------- autosave
  const autosave = FM.dom.debounce(() => {
    try {
      const cur = FM.library.current();
      const payload = { doc: ws.toJSON(), files: ws.samples.map(s => s.name), savedAt: Date.now(), lib: cur ? cur.id : null };
      FM.store.setJSON('autosave', payload);
    } catch (_) { /* storage full or unavailable */ }
  }, 900);

  FM.readAutosave = function () {
    try {
      const a = FM.store.getJSON('autosave', null);
      if (!a || !a.doc || (!a.doc.gates.length && !a.doc.groups.length && !a.doc.metrics.length)) return null;
      return a;
    } catch (_) { return null; }
  };

  // --------------------------------------------------------------- keyboard
  function typing(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  function onKey(e) {
    if (document.querySelector('.modal-back')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !typing(e) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && !typing(e) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); FM.library.save(); return; }
    if (typing(e)) return;
    // the view gets first refusal, including on modifier combos of its own (the layout page
    // uses Ctrl+D and Ctrl+A); views with plain-letter shortcuts guard against modifiers
    if (current && current.onKey && current.onKey(e) === true) { e.preventDefault(); return; }
    if (mod || e.altKey) return;
    if (/^[1-9]$/.test(e.key) && FM.STEPS[+e.key - 1]) { go(FM.STEPS[+e.key - 1].id); e.preventDefault(); return; }
    if (e.key === '?') { showHelp(); e.preventDefault(); }
  }

  // ------------------------------------------------------------------- boot
  function boot() {
    applyTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (FM.ui.theme === 'system') { applyTheme(); FM.bus.emit('theme'); } });
    FM.dom.initTooltips();
    const app = document.getElementById('app');
    viewEl = h('main.view');
    app.appendChild(buildTopbar());
    app.appendChild(viewEl);
    FM.feedback.mount(document.body);

    FM.bus.on(kind => {
      if (kind.startsWith('ws:')) {
        renderUndo(); renderStepper(); renderStatus();
        if (kind === 'ws:doc' || kind === 'ws:settings') { if (document.activeElement !== nameInput) nameInput.value = ws.doc.name; }
        if (kind !== 'ws:view') autosave();
        FM.library.touch();
        if (current && current.update) current.update(kind);
      } else if (current && current.update) current.update(kind);
      if (kind === 'theme') { FM.plot.invalidateTheme(); if (current && current.update) current.update('theme'); }
    });

    document.addEventListener('keydown', onKey);
    // drop files anywhere
    document.addEventListener('dragover', e => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); document.body.classList.add('dragging'); } });
    document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
    document.addEventListener('drop', async e => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      document.body.classList.remove('dragging');
      const files = await FM.dom.filesFromDrop(e.dataTransfer);
      // a shared analysis or template dropped on its own
      const docs = files.filter(f => /\.(json|flowmate)$/i.test(f.name));
      if (docs.length && docs.length === files.length) { FM.io.openDocumentFile(docs[0]); return; }
      const fcs = files.filter(f => !docs.includes(f));
      if (fcs.length) await FM.loadFiles(fcs);
    });
    window.addEventListener('resize', FM.dom.debounce(() => { if (current && current.update) current.update('resize'); }, 120));
    window.addEventListener('beforeunload', () => { autosave.flush(); FM.library.flush(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') FM.library.flush(); });

    renderUndo(); renderStatus();
    const params = new URLSearchParams(location.search);
    if (params.get('demo')) {
      FM.loadDemo();
      if (params.get('preset')) {
        const p = FM.presets.byId('phagocytosis');
        FM.presets.apply(ws, p, { mapping: FM.presets.autoMap(p, ws.paramNames()), layout: true, replace: true });
      }
    }
    if (params.get('select')) {
      const id = ws.popIdByName(params.get('select'));
      if (id) FM.setUI({ gateId: id });
    }
    if (params.get('well') && ws.sample(params.get('well'))) FM.ui.sampleKey = params.get('well');
    const hash = (location.hash || '').slice(1);
    const target = ALIAS[hash] || hash;
    go(FM.views[target] && (ws.samples.length || target === 'load' || target === 'guide' || target === 'planner' || target === 'about') ? target : homeStep());
  }

  FM.boot = boot;
})(FM);
