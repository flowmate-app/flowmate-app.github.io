/* Panel planner page: choose an instrument and dyes, see their spectra against the lasers and
 * detector filters, the detector each dye lands on, spillover and plain-language checks.
 * The current panel autosaves in the browser; panels can be saved by name, exported/imported as
 * .panel.json, and started from presets. A page of its own (not a step), like the Guide. */
(function (FM) {
  'use strict';
  const { h, icon, clear, toast, modal } = FM.dom;
  const P = FM.planner;
  const KEY_CURRENT = 'planner', KEY_SAVED = 'panels';

  let root = null, returnTo = 'load';
  let panel = null;          // { name, instrument, dyes: [{ ref, custom, target, detector, hidden }] }
  let calc = null;           // derived: { dyes, assignment, spill, checks }
  let laser = 'all';         // 'all' or a laser wavelength
  let showEx = true, hoverNm = null, layout = null;
  const el = {};

  // -------------------------------------------------------------- storage
  function readJSON(key, fallback) { return FM.store.getJSON(key, fallback); }
  function writeJSON(key, v) { return FM.store.setJSON(key, v); }
  function savedList() { const l = readJSON(KEY_SAVED, []); return Array.isArray(l) ? l.filter(x => x && x.name && x.panel) : []; }
  const autosave = FM.dom.debounce(() => { if (panel) writeJSON(KEY_CURRENT, JSON.parse(P.serialize(panel))); }, 300);

  function filesInstrument() { return FM.ws && FM.ws.samples.length ? P.instrumentFromSamples(FM.ws.samples) : null; }
  function startingPanel() {
    const cur = readJSON(KEY_CURRENT, null);
    if (cur) { try { return P.deserialize(cur).panel; } catch (_) { /* start fresh */ } }
    return P.newPanel(filesInstrument() || P.instrument('cytoflex-lx'));
  }

  // -------------------------------------------------------------- derived
  const colorOf = d => P.wavelengthColor(d.emPeak);
  const detById = id => panel.instrument.detectors.find(d => d.id === id) || null;
  function compute() {
    const dyes = panel.dyes.map(P.resolve);
    const assignment = P.assign(dyes, panel.instrument, panel.dyes.map(e => e.detector));
    calc = { dyes, assignment, spill: P.spillover(dyes, panel.instrument, assignment), checks: P.checks(dyes, panel.instrument, assignment) };
  }
  /** After any change: recompute, autosave, redraw (`side` also rebuilds the sidebar). */
  function changed(side) {
    compute();
    autosave();
    if (!root) return;
    if (side) renderSide();
    renderMain();
  }
  function load(p, message) {
    panel = p;
    if (laser !== 'all' && !panel.instrument.lasers.includes(laser)) laser = 'all';
    changed(true);
    if (message) toast(message);
  }
  const withWarnings = (msg, w) => msg + (w.length ? '. ' + w.join(' ') : '');

  // ------------------------------------------------------------------ mount
  function mount(host) {
    root = host;
    if (!panel) panel = startingPanel();
    compute();
    el.side = h('aside.pl-side');
    el.main = h('div.pl-main');
    root.appendChild(h('div.pl-wrap', el.side, el.main));
    buildMain();
    renderSide();
    renderMain();
  }

  // ---------------------------------------------------------------- sidebar
  function renderSide() {
    clear(el.side);
    const back = (FM.STEPS.find(s => s.id === returnTo) || { label: 'the app' }).label;
    el.side.append(
      h('header.pl-head',
        h('div.eyebrow', 'FlowMate ' + FM.version),
        h('h1', 'Panel planner', h('span.beta', 'beta')),
        h('p.muted', 'Choose dyes for your cytometer’s lasers and detectors, and see where they overlap before you stain.'),
        h('button.btn.sm', { on: { click: () => FM.go(returnTo || 'workspace') } }, icon('left'), 'Back to ' + back)),
      instrumentSection(), dyeSection(), savedSection());
  }

  function instrumentSection() {
    const inst = panel.instrument, fromFiles = filesInstrument();
    const known = P.INSTRUMENTS.some(i => i.id === inst.id) || (inst.id === 'from-files' && !!fromFiles);
    const sel = h('select.input.pl-inst', { 'aria-label': 'Instrument', on: { change: () => {
      if (sel.value !== '__current') setInstrument(sel.value === 'from-files' ? filesInstrument() : P.instrument(sel.value));
    } } },
      known ? null : h('option', { value: '__current' }, inst.name + ' (edited)'),
      fromFiles ? h('option', { value: 'from-files' }, fromFiles.name) : null,
      P.INSTRUMENTS.map(i => h('option', { value: i.id }, i.name)));
    sel.value = known ? inst.id : '__current';
    return h('section.pl-sec',
      h('div.eyebrow', 'Instrument'), sel,
      h('div.pl-laser-chips', inst.lasers.map(nm => h('span.pl-laser-chip', { 'data-tip': P.laserName(nm) + ' laser · ' + inst.detectors.filter(d => d.laser === nm).length + ' detectors' },
        h('span.dot', { style: { background: P.wavelengthColor(nm) } }), nm + ' nm'))),
      h('div.pl-note.muted', inst.detectors.length + ' detectors' + (inst.note ? ' · ' + inst.note : '')),
      h('div.row', h('button.btn.sm', { on: { click: editInstrument } }, icon('edit'), 'Edit lasers & filters')));
  }

  function setInstrument(next) {
    if (!next) return;
    panel.instrument = next;
    panel.dyes.forEach(e => { if (e.detector && !detById(e.detector)) e.detector = null; });
    if (laser !== 'all' && !next.lasers.includes(laser)) laser = 'all';
    changed(true);
  }

  function brightness(b) {
    if (b == null) return null;
    return h('span.pl-bright', { 'data-tip': 'Brightness ' + b + ' of 5 (typical vendor ranking). Put rare or dim markers on bright dyes.' }, '●'.repeat(b) + '○'.repeat(5 - b));
  }

  function dyeSection() {
    const list = h('div.pl-dyes');
    if (!panel.dyes.length) list.appendChild(h('div.pl-empty', 'No dyes yet. Search below, or open a preset panel.'));
    panel.dyes.forEach((e, i) => {
      const d = calc.dyes[i], c = colorOf(d);
      list.appendChild(h('div.pl-dye' + (e.hidden ? '.off' : ''), { style: { '--c': c } },
        h('span.swatch', { style: { background: c } }),
        h('div.pl-dye-main',
          h('div.pl-dye-name', h('span', d.name), h('span.muted', d.exPeak + '/' + d.emPeak), brightness(d.brightness)),
          h('input.pl-target', { value: e.target, placeholder: 'What it marks (e.g. CD4)', 'aria-label': 'Marker for ' + d.name,
            on: { change: ev => { e.target = ev.target.value.trim(); changed(false); } } })),
        h('button.btn.ghost.sm.icon', { 'data-tip': e.hidden ? 'Show on the chart' : 'Hide from the chart', 'aria-label': (e.hidden ? 'Show ' : 'Hide ') + d.name,
          on: { click: () => { e.hidden = !e.hidden; changed(true); } } }, icon(e.hidden ? 'eyeoff' : 'eye')),
        h('button.btn.ghost.sm.icon', { 'data-tip': 'Remove', 'aria-label': 'Remove ' + d.name,
          on: { click: () => { panel.dyes.splice(i, 1); changed(true); } } }, icon('x'))));
    });
    const search = h('input.input.pl-search', { type: 'search', placeholder: 'Add a dye: FITC, PE, BV421, GFP, Zombie…', 'aria-label': 'Add a dye',
      on: {
        input: () => showResults(search), focus: () => showResults(search),
        keydown: ev => {
          if (ev.key === 'Escape') { FM.dom.closePop(); return; }
          if (ev.key !== 'Enter') return;
          ev.preventDefault();
          const have = new Set(panel.dyes.map(x => x.ref));
          const r = search.value.trim() && P.search(search.value).find(d => !have.has(d.id));
          if (r) addDye({ ref: r.id });
        },
      } });
    return h('section.pl-sec',
      h('div.eyebrow', 'Panel'),
      h('input.input.pl-name', { value: panel.name, 'aria-label': 'Panel name', on: { change: ev => { panel.name = ev.target.value.trim() || 'Untitled panel'; autosave(); } } }),
      list, search,
      h('div.row', h('button.btn.sm', { on: { click: customDyeDialog } }, icon('plus'), 'Custom dye from its peaks…')));
  }

  function showResults(input) {
    const q = input.value.trim();
    const hits = P.search(q, q ? 40 : undefined);
    const have = new Set(panel.dyes.map(e => e.ref));
    const box = h('div.pl-results');
    let cat = null;
    hits.forEach(d => {
      if (!q && d.cat !== cat) { box.appendChild(h('div.menu-label.eyebrow', d.cat)); cat = d.cat; }
      box.appendChild(h('button.menu-item.pl-result', { disabled: have.has(d.id), on: { mousedown: ev => ev.preventDefault(), click: () => addDye({ ref: d.id }) } },
        h('span.swatch', { style: { background: colorOf(d) } }), h('span', d.name),
        h('span.hint', (q ? d.cat + ' · ' : '') + d.exPeak + '/' + d.emPeak)));
    });
    if (!hits.length) box.appendChild(h('div.pl-empty.pad', 'No dye matches “' + q + '”. Add it with “Custom dye from its peaks”.'));
    FM.dom.popover(input, box, { focus: false, width: Math.max(300, input.offsetWidth) });
  }

  function addDye(e) {
    FM.dom.closePop();
    panel.dyes.push({ ref: e.ref || null, custom: e.custom || null, target: '', detector: null, hidden: false });
    changed(true);
    const i = calc.dyes.length - 1, a = calc.assignment[i];
    toast(calc.dyes[i].name + (a ? ' → ' + P.detName(detById(a)) : ': no free detector'));
  }

  function customDyeDialog() {
    const field = (label, input, hint) => h('div.field', h('label', label), input, hint ? h('div.muted.pl-hint', hint) : null);
    const name = h('input.input', { placeholder: 'e.g. My bead lot' });
    const ex = h('input.input', { type: 'number', min: P.START, max: P.END, placeholder: 'e.g. 490' });
    const em = h('input.input', { type: 'number', min: P.START, max: P.END, placeholder: 'e.g. 520' });
    const exW = h('input.input', { type: 'number', value: 40, min: 5, max: 200 });
    const emW = h('input.input', { type: 'number', value: 45, min: 5, max: 200 });
    const br = h('select.input', h('option', { value: '' }, 'Unknown'),
      ['dim', 'dim–moderate', 'moderate', 'bright', 'very bright'].map((t, k) => h('option', { value: k + 1 }, (k + 1) + ': ' + t)));
    const msg = h('div.pl-form-msg');
    const submit = () => {
      try {
        if (ex.value === '' || em.value === '') throw new Error('Enter both peaks, in nm.');
        const d = P.customDye({ name: name.value, exPeak: ex.value, emPeak: em.value, exWidth: exW.value, emWidth: emW.value, brightness: br.value });
        addDye({ custom: d.spec });
        if (d.emPeak <= d.exPeak) toast('Emission usually peaks at a longer wavelength than excitation. Check the numbers.');
        return true;
      } catch (err) { msg.textContent = err.message; return false; }
    };
    const m = modal({
      title: 'Custom dye',
      subtitle: 'For a dye that isn’t in the list: enter its excitation and emission peaks from the vendor’s data sheet. The shape of the curves is modelled.',
      body: h('div.pl-form', field('Name', name),
        h('div.pl-form-row', field('Excitation peak (nm)', ex), field('Emission peak (nm)', em)),
        h('div.pl-form-row', field('Excitation width (nm)', exW, 'Full width at half maximum'), field('Emission width (nm)', emW, 'Full width at half maximum')),
        field('Brightness', br), msg),
      buttons: [{ label: 'Cancel' }, { label: 'Add dye', primary: true, fn: submit }],
      onEnter: () => { if (submit()) m.close(); },
    });
  }

  function editInstrument() {
    const draft = JSON.parse(JSON.stringify(panel.instrument));
    const body = h('div.pl-inst-edit'), msg = h('div.pl-form-msg');
    const name = h('input.input', { value: draft.name, on: { input: ev => { draft.name = ev.target.value; } } });
    const select = (value, options, onChange) => { const s = h('select.input.sm', { on: { change: ev => onChange(ev.target.value) } }, options); s.value = value; return s; };
    const render = () => {
      clear(body);
      const add = h('input.input.sm', { type: 'number', placeholder: 'nm', min: P.START, max: P.END, style: { width: '80px' } });
      body.append(
        h('div.field', h('label', 'Name'), name),
        h('div.field', h('label', 'Lasers'),
          h('div.pl-laser-chips',
            draft.lasers.map(nm => h('span.pl-laser-chip', h('span.dot', { style: { background: P.wavelengthColor(nm) } }), nm + ' nm',
              h('button.pl-chip-x', { 'aria-label': 'Remove the ' + nm + ' nm laser', on: { click: () => {
                draft.lasers = draft.lasers.filter(x => x !== nm); draft.detectors = draft.detectors.filter(d => d.laser !== nm); render();
              } } }, '×'))),
            add,
            h('button.btn.sm', { on: { click: () => {
              const v = Math.round(+add.value);
              if (v >= P.START && v <= P.END && !draft.lasers.includes(v)) { draft.lasers.push(v); draft.lasers.sort((a, b) => a - b); render(); }
            } } }, icon('plus'), 'Add laser'))),
        h('div.field', h('label', 'Detectors'),
          h('div.scroll.pl-inst-scroll', h('table.tbl.pl-inst-table',
            h('thead', h('tr', h('th', 'Name'), h('th', 'Laser'), h('th', 'Filter'), h('th', 'Centre / edge (nm)'), h('th', 'Width (nm)'), h('th', ''))),
            h('tbody', draft.detectors.map((d, i) => h('tr',
              h('td', h('input.input.sm', { value: d.id, style: { width: '72px' }, on: { input: ev => { d.id = ev.target.value; } } })),
              h('td', select(d.laser, draft.lasers.map(nm => h('option', { value: nm }, nm + ' nm')), v => { d.laser = +v; })),
              h('td', select(d.type, [h('option', { value: 'bp' }, 'Band-pass'), h('option', { value: 'lp' }, 'Long-pass')], v => { d.type = v; render(); })),
              h('td', h('input.input.sm', { type: 'number', value: d.center, style: { width: '76px' }, on: { input: ev => { d.center = +ev.target.value; } } })),
              h('td', d.type === 'lp' ? h('span.muted', '—') : h('input.input.sm', { type: 'number', value: d.width, style: { width: '66px' }, on: { input: ev => { d.width = +ev.target.value; } } })),
              h('td', h('button.btn.ghost.sm.icon', { 'aria-label': 'Remove detector', on: { click: () => { draft.detectors.splice(i, 1); render(); } } }, icon('x')))))))),
          h('div.row', h('button.btn.sm', { disabled: !draft.lasers.length, on: { click: () => {
            draft.detectors.push({ id: '', laser: draft.lasers[0], center: 530, width: 30, type: 'bp' }); render();
          } } }, icon('plus'), 'Add detector'))),
        msg);
    };
    render();
    modal({
      title: 'Lasers & filters', wide: true,
      subtitle: 'Match your cytometer: its lasers, and for each detector the laser it sits on and its filter. 525/40 means centred at 525 nm and 40 nm wide; 670LP means everything above 670 nm.',
      body,
      buttons: [{ label: 'Cancel' }, { label: 'Use this configuration', primary: true, fn: () => {
        const inst = P.normInstrument(Object.assign({}, draft, { id: 'custom', name: String(draft.name || '').trim() || 'Custom instrument', note: 'Edited by hand.' }));
        if (!inst) { msg.textContent = 'Add at least one laser.'; return false; }
        const dropped = draft.detectors.length - inst.detectors.length;
        setInstrument(inst);
        if (dropped > 0) toast(dropped + ' detector' + (dropped > 1 ? 's' : '') + ' with missing or out-of-range values were left out');
        return true;
      } }],
    });
  }

  function savedSection() {
    return h('section.pl-sec',
      h('div.eyebrow', 'Save & share'),
      h('div.pl-btns',
        h('button.btn.sm.primary', { on: { click: savePanel } }, icon('save'), 'Save'),
        h('button.btn.sm', { on: { click: openDialog } }, icon('folder'), 'Open…'),
        h('button.btn.sm', { on: { click: newPanelAsk } }, icon('plus'), 'New')),
      h('div.pl-btns',
        h('button.btn.sm', { on: { click: () => FM.dom.download(FM.io.safeName(panel.name) + '.panel.json', P.serialize(panel), 'application/json') } }, icon('download'), 'Export file'),
        h('button.btn.sm', { on: { click: importPanel } }, icon('upload'), 'Import file')),
      h('div.pl-note.muted', 'The current panel is kept in this browser automatically. Save it by name to keep several, or export a file to share it.'));
  }

  function savePanel() {
    const list = savedList(), i = list.findIndex(x => x.name === panel.name);
    const item = { name: panel.name, savedAt: Date.now(), panel: JSON.parse(P.serialize(panel)) };
    if (i >= 0) list[i] = item; else list.push(item);
    if (writeJSON(KEY_SAVED, list)) toast((i >= 0 ? 'Updated “' : 'Saved “') + panel.name + '”');
    else toast('Could not save: browser storage is unavailable. Use Export file instead.', { level: 'crit' });
  }

  function openDialog() {
    const body = h('div.pl-open');
    let m = null;
    const render = () => {
      clear(body);
      const list = savedList().sort((a, b) => b.savedAt - a.savedAt);
      body.appendChild(h('div.eyebrow', 'Saved in this browser'));
      if (!list.length) body.appendChild(h('div.pl-empty', 'Nothing saved yet. Save keeps the current panel under its name.'));
      list.forEach(item => body.appendChild(h('div.pl-open-row',
        h('div.grow', h('div.pl-open-name', item.name),
          h('div.muted', (item.panel.dyes || []).length + ' dyes · ' + ((item.panel.instrument || {}).name || '') + ' · ' + new Date(item.savedAt).toLocaleDateString())),
        h('button.btn.sm', { on: { click: () => {
          try { const r = P.deserialize(item.panel); load(r.panel, withWarnings('Opened “' + item.name + '”', r.warnings)); } catch (e) { toast(e.message, { level: 'crit' }); }
          m.close();
        } } }, 'Open'),
        h('button.btn.sm.ghost.icon', { 'data-tip': 'Delete', 'aria-label': 'Delete ' + item.name, on: { click: () => {
          writeJSON(KEY_SAVED, savedList().filter(x => x.name !== item.name)); render();
        } } }, icon('trash')))));
      body.appendChild(h('div.eyebrow.pl-open-gap', 'Presets'));
      P.PANEL_PRESETS.forEach(p => body.appendChild(h('div.pl-open-row',
        h('div.grow', h('div.pl-open-name', p.name), h('div.muted', p.description)),
        h('button.btn.sm', { on: { click: () => { load(P.presetPanel(p.id), 'Opened preset “' + p.name + '”'); m.close(); } } }, 'Open'))));
    };
    render();
    m = modal({ title: 'Open a panel', wide: true, body, buttons: [{ label: 'Close' }] });
  }

  async function newPanelAsk() {
    if (panel.dyes.length && !(await FM.dom.confirm('Start a new panel?', 'The current panel is replaced. Save it first if you want to keep it.', 'New panel'))) return;
    load(P.newPanel(panel.instrument));
  }

  async function importPanel() {
    const files = await FM.dom.pickFiles({ accept: '.json,application/json' });
    if (!files.length) return;
    try { const r = P.deserialize(await files[0].text()); load(r.panel, withWarnings('Imported “' + r.panel.name + '”', r.warnings)); }
    catch (e) { toast(files[0].name + ': ' + e.message, { level: 'crit' }); }
  }

  // ------------------------------------------------------------------- main
  function buildMain() {
    el.lasers = h('div.seg.pl-lasers', { role: 'tablist', 'aria-label': 'Which laser to look at' });
    el.hint = h('span.muted.pl-bar-hint');
    el.canvas = h('canvas', { role: 'img', 'aria-label': 'Excitation and emission spectra with laser lines and detector filters' });
    el.tip = h('div.pl-tip.hidden');
    el.chart = h('div.pl-chart', el.canvas, el.tip);
    el.canvas.addEventListener('pointermove', onHover);
    el.canvas.addEventListener('pointerleave', () => { hoverNm = null; el.tip.classList.add('hidden'); drawChart(); });
    el.assign = h('div');
    el.checks = h('div.pl-checks');
    el.spill = h('div');
    el.main.append(
      h('div.pl-bar', el.lasers,
        h('label.pl-toggle', h('input', { type: 'checkbox', checked: showEx, on: { change: ev => { showEx = ev.target.checked; drawChart(); } } }), 'Excitation curves'),
        el.hint),
      el.chart,
      explainer(),
      h('div.pl-grid',
        h('section.panel.pl-card', h('div.panel-head', h('h3', 'Detectors'), h('span.muted.pl-sub', 'Where each dye is read, and how much of its light gets there')), el.assign),
        h('section.panel.pl-card', h('div.panel-head', h('h3', 'Checks')), el.checks)),
      h('section.panel.pl-card', h('div.panel-head', h('h3', 'Spillover'), h('span.muted.pl-sub', 'How much of each dye (row) shows up in the other dyes’ detectors (columns), as % of its own signal')), el.spill));
  }

  function renderMain() {
    renderLaserTabs();
    renderAssign();
    renderChecks();
    renderSpill();
    drawChart();
  }

  function renderLaserTabs() {
    clear(el.lasers);
    const tab = (value, kids, tip) => h('button' + (laser === value ? '.on' : ''), { role: 'tab', 'aria-selected': laser === value ? 'true' : 'false', 'data-tip': tip,
      on: { click: () => { laser = value; renderMain(); } } }, kids);
    el.lasers.appendChild(tab('all', 'All lasers', 'Every dye’s full spectrum, with every laser'));
    panel.instrument.lasers.forEach(nm => el.lasers.appendChild(tab(nm, [h('span.dot', { style: { background: P.wavelengthColor(nm) } }), nm + ' nm'],
      'What the ' + P.laserName(nm).toLowerCase() + ' laser’s detectors see')));
    el.hint.textContent = laser === 'all' ? 'Pick a laser to see what its detectors actually receive.'
      : P.laserName(laser) + ' laser: each dye’s emission is scaled by how strongly ' + laser + ' nm excites it.';
  }

  function chartModel() {
    const inst = panel.instrument, used = {};
    calc.assignment.forEach((id, i) => { if (id && !used[id]) used[id] = colorOf(calc.dyes[i]); });
    return {
      lasers: inst.lasers.map(nm => ({ nm, color: P.wavelengthColor(nm), active: laser === 'all' || laser === nm, label: String(nm) })),
      lanes: inst.lasers.map(nm => ({ laser: nm, color: P.wavelengthColor(nm), label: String(nm), dim: laser !== 'all' && laser !== nm,
        dets: inst.detectors.filter(d => d.laser === nm).map(d => { const [a, b] = P.edges(d); return { a, b, label: P.detLabel(d), used: used[d.id] || null }; }) })),
      bands: laser === 'all' ? [] : inst.detectors.filter(d => d.laser === laser).map(d => { const [a, b] = P.edges(d); return { a, b, label: P.detLabel(d), color: P.wavelengthColor(laser) }; }),
      dyes: calc.dyes.map((d, i) => ({ d, i })).filter(x => !panel.dyes[x.i].hidden).map(({ d }) => ({
        name: d.name, color: colorOf(d), ex: d.ex, em: d.em, peak: d.emPeak, emScale: laser === 'all' ? 1 : P.excitation(d, laser) })),
      showEx, hover: hoverNm, empty: !calc.dyes.length, range: [300, 850],
    };
  }
  function drawChart() { if (root && el.canvas && el.canvas.isConnected) layout = FM.spectraPlot.draw(el.canvas, chartModel()); }

  function colourWord(nm) {
    return nm < 400 ? 'ultraviolet' : nm < 450 ? 'violet' : nm < 495 ? 'blue' : nm < 570 ? 'green' : nm < 590 ? 'yellow' : nm < 620 ? 'orange' : nm < 700 ? 'red' : nm < 750 ? 'far red' : 'near-infrared';
  }
  function onHover(ev) {
    if (!layout) return;
    const cr = el.chart.getBoundingClientRect(), r = el.canvas.getBoundingClientRect();
    const x = ev.clientX - r.left;
    if (x < layout.x0 || x > layout.x1) { hoverNm = null; el.tip.classList.add('hidden'); drawChart(); return; }
    hoverNm = Math.round(layout.nmAt(x));
    clear(el.tip);
    el.tip.appendChild(h('div.pl-tip-head', hoverNm + ' nm', h('span.muted', ' · ' + colourWord(hoverNm))));
    calc.dyes.forEach((d, i) => {
      if (panel.dyes[i].hidden) return;
      const k = laser === 'all' ? 1 : P.excitation(d, laser);
      el.tip.appendChild(h('div.pl-tip-row', h('span.swatch', { style: { background: colorOf(d) } }), h('span', d.name),
        h('span.mono.muted', 'ex ' + Math.round(P.excitation(d, hoverNm) * 100) + '% · em ' + Math.round(P.at(d.em, hoverNm) * k * 100) + '%')));
    });
    const dets = panel.instrument.detectors.filter(d => (laser === 'all' || d.laser === laser) && hoverNm >= P.edges(d)[0] && hoverNm <= P.edges(d)[1]);
    if (dets.length) el.tip.appendChild(h('div.pl-tip-foot.muted', 'Detectors here: ' + dets.map(d => d.id + ' (' + d.laser + ' · ' + P.detLabel(d) + ')').join(', ')));
    el.tip.classList.remove('hidden');
    const tx = ev.clientX - cr.left, ty = ev.clientY - cr.top, tw = el.tip.offsetWidth;
    el.tip.style.left = (tx + 18 + tw > cr.width ? tx - tw - 12 : tx + 18) + 'px';
    el.tip.style.top = Math.max(6, Math.min(cr.height - el.tip.offsetHeight - 6, ty - 20)) + 'px';
    drawChart();
  }

  function renderAssign() {
    clear(el.assign);
    if (!calc.dyes.length) { el.assign.appendChild(h('div.pl-empty.pad', 'Add dyes to see which detector reads each one.')); return; }
    const inst = panel.instrument;
    const rows = calc.dyes.map((d, i) => {
      const e = panel.dyes[i], det = calc.assignment[i] && detById(calc.assignment[i]);
      const ex = det ? P.excitation(d, det.laser) : 0, cap = det ? P.captured(d, det) : 0, sig = ex * cap;
      const sel = h('select.input.sm.pl-det', { 'aria-label': 'Detector for ' + d.name, on: { change: ev => { e.detector = ev.target.value || null; changed(false); } } },
        h('option', { value: '' }, 'Auto' + (e.detector ? '' : det ? ': ' + det.id + ' · ' + det.laser + ' ' + P.detLabel(det) : ': none free')),
        inst.lasers.map(nm => h('optgroup', { label: nm + ' nm · ' + P.laserName(nm) },
          inst.detectors.filter(x => x.laser === nm).map(x => h('option', { value: x.id }, x.id + ' · ' + P.detLabel(x) + ': collects ' + P.pct(P.signal(d, x)))))));
      sel.value = e.detector || '';
      return h('tr',
        h('td.pl-td-dye', h('div.pl-cell-dye', h('span.swatch', { style: { background: colorOf(d) } }), h('div', h('strong', d.name), e.target ? h('div.muted.pl-cell-target', e.target) : null))),
        h('td', sel),
        h('td.r.mono', det ? P.pct(ex) : '—'),
        h('td.r.mono', det ? P.pct(cap) : '—'),
        h('td', h('div.pl-meter', { 'data-tip': det ? 'Collects ' + P.pct(sig) + ' of the most this dye could give' : 'Not read' },
          h('span', { style: { width: Math.round(Math.min(1, sig) * 100) + '%', background: colorOf(d) } }))));
    });
    el.assign.appendChild(h('div.scroll', h('table.tbl.pl-assign',
      h('thead', h('tr', h('th', 'Dye'), h('th', 'Detector'),
        h('th.r', { 'data-tip': 'How strongly the detector’s laser excites the dye, as % of its peak' }, 'Excited'),
        h('th.r', { 'data-tip': 'Share of the dye’s emission that passes the filter' }, 'Passes'),
        h('th', { 'data-tip': 'Excited × passes' }, 'Collected'))),
      h('tbody', rows))));
  }

  const CHECK_ICON = { crit: 'alert', warn: 'alert', ok: 'check', info: 'info' };
  function renderChecks() {
    clear(el.checks);
    if (!calc.dyes.length) { el.checks.appendChild(h('div.pl-empty', 'Checks appear once the panel has dyes.')); return; }
    calc.checks.forEach(c => el.checks.appendChild(h('div.pl-check.' + c.level, icon(CHECK_ICON[c.level]), h('span', c.text))));
  }

  function renderSpill() {
    clear(el.spill);
    const idx = calc.dyes.map((_, i) => i).filter(i => calc.assignment[i]);
    if (idx.length < 2) { el.spill.appendChild(h('div.pl-empty.pad', 'Spillover appears once two or more dyes have detectors.')); return; }
    const cls = v => (v >= 0.3 ? 's-crit' : v >= 0.1 ? 's-warn' : v < 0.01 ? 's-low' : 's-mid');
    const sw = d => h('span.swatch', { style: { background: colorOf(d) } });
    el.spill.append(
      h('div.scroll', h('table.tbl.pl-spill',
        h('thead', h('tr', h('th', 'Dye ↓   into detector →'), idx.map(j => {
          const det = detById(calc.assignment[j]);
          return h('th.r', { 'data-tip': P.detName(det) }, sw(calc.dyes[j]), ' ', calc.dyes[j].name, h('div.pl-th-sub', det.id));
        }))),
        h('tbody', idx.map(i => h('tr', h('td', h('div.pl-cell-dye', sw(calc.dyes[i]), calc.dyes[i].name)),
          idx.map(j => (i === j ? h('td.r.mono.s-diag', '—') : h('td.r.mono.' + cls(calc.spill[i][j]), P.pct(calc.spill[i][j]))))))))),
      h('div.pl-legend.muted', h('span.pl-key.s-warn', '10–30%'), ' needs compensation and care with dim markers · ',
        h('span.pl-key.s-crit', '≥ 30%'), ' makes the two dyes hard to separate'));
  }

  function explainer() {
    return h('details.pl-explain',
      h('summary', icon('help'), 'What am I looking at?'),
      h('div.pl-explain-body',
        h('p', h('strong', 'Lasers'), ' (the coloured vertical lines) excite dyes. How strongly depends on the dye’s ', h('strong', 'excitation curve'),
          ' (dashed) at the laser’s wavelength: a laser that hits the curve near its top gives a bright signal.'),
        h('p', 'The excited dye glows across a range of colours: its ', h('strong', 'emission curve'), ' (filled). Each ', h('strong', 'detector'),
          ' sits behind one laser and collects one band of colours through a filter. ', h('code', '525/40'),
          ' means centred at 525 nm and 40 nm wide (505–545 nm). The bars along the top show every detector, one row per laser, filled with the colour of the dye it reads.'),
        h('p', 'Pick a laser above the chart to see what that laser’s detectors actually receive: each dye’s emission is scaled by how strongly that laser excites it. On most modern cytometers, including the CytoFLEX, each laser hits the cells at its own spot, so a detector only sees dyes excited by its own laser.'),
        h('p', h('strong', 'Spillover'), ' is the part of a dye’s light that lands in another dye’s detector. Some is normal and compensation removes it, but it adds spread and makes dim populations harder to see.'),
        h('ul',
          h('li', 'One dye per detector.'),
          h('li', 'Put rare or dimly expressed markers on bright dyes (PE, BV421, APC), and abundant markers on dimmer dyes (FITC, Pacific Blue).'),
          h('li', 'Keep pairs with high spillover off markers found on the same cells.'),
          h('li', 'Run a single-stained control for every dye so compensation can be calculated.'))));
  }

  // --------------------------------------------------------------- register
  function open(doc) {
    if (FM.ui.step !== 'planner') returnTo = FM.ui.step;
    FM.go('planner');
    if (!doc) return;
    try { const r = P.deserialize(doc); load(r.panel, withWarnings('Opened “' + r.panel.name + '”', r.warnings)); }
    catch (e) { toast(e.message, { level: 'crit' }); }
  }

  FM.views = FM.views || {};
  FM.views.planner = {
    mount,
    update(kind) {
      if (!root) return;
      if (kind === 'resize' || kind === 'theme') drawChart();
      if (kind === 'ws:samples') renderSide();
    },
    unmount() { autosave.flush(); FM.dom.closePop(); root = null; layout = null; },
    _load: p => load(p),
    _state: () => ({ panel, calc, laser }),
  };
  FM.openPlanner = open;
})(FM);
