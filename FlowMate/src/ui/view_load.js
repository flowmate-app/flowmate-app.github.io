/* Load (the first step, and home): bring in FCS files, see what was read, pick up a saved or
 * shared analysis, or start a new one. */
(function (FM) {
  'use strict';
  const { h, icon, clear, fmtCount, fmtTime, toast } = FM.dom;
  const ws = () => FM.ws;

  let root = null, progressEl = null, stopCell = null;

  function mount(el) {
    root = el;
    render();
  }

  function render() {
    if (!root) return;
    clear(root);
    const W = ws();
    const has = W.samples.length > 0;
    root.appendChild(h('div.load-wrap',
      h('section.load-main', has ? filesPanel() : dropZone()),
      h('aside.load-side', startPanel(), has ? paramsPanel() : aboutPanel())));
  }

  // ---------------------------------------------------------------- empty
  function dropZone() {
    const restore = FM.readAutosave();
    progressEl = h('div.load-progress.hidden');
    const cell = h('canvas.flowcell', { 'aria-hidden': 'true' });
    const zone = h('div.dropzone',
      cell,
      h('div.dz-brand', FM.brand.lockup(54), h('span.dz-tag', 'flow cytometry analysis · free · in your browser')),
      h('h1', 'Drop FCS files or a whole folder'),
      h('p.muted', 'Files are read in this browser tab and never uploaded anywhere. FCS 2.0, 3.0 and 3.1 from any cytometer.'),
      h('div.muted.small.dz-mode-d', 'Six steps: load a plate, map the conditions, unmix the dyes, gate every well at once, measure, graph.'),
      h('div.row.dz-actions',
        h('button.btn.primary.lg', { on: { click: async () => { const f = await FM.dom.pickFiles({ multiple: true, accept: '.fcs,.FCS,.lmd' }); if (f.length) { await FM.loadFiles(f); render(); } } } }, icon('file'), 'Choose files'),
        h('button.btn.lg', { on: { click: async () => { const f = await FM.dom.pickFiles({ directory: true }); if (f.length) { await FM.loadFiles(f); render(); } } } }, icon('folder'), 'Choose folder')),
      progressEl,
      h('div.dz-or', h('span', 'or')),
      h('div.row.dz-demos',
        h('button.btn.ghost', { 'data-tip': 'An 18-well plate of synthetic data with three dyes, and the controls to unmix them — the guide walks through it', on: { click: () => { FM.loadDemo({ controls: true }); render(); } } }, icon('flask'), 'Explore with a demo plate')));
    const out = [zone, FM.library.recentPanel()];
    FM.dom.frame(() => { if (stopCell) stopCell(); stopCell = FM.brand.flowCell(cell); });
    // an analysis kept in My analyses is listed there, with its data
    if (restore && !restore.lib) {
      out.push(h('div.restore',
        h('div.restore-icon', icon('save')),
        h('div.grow',
          h('div', h('strong', 'Pick up where you left off')),
          h('div.muted', '“' + restore.doc.name + '” — ' + restore.doc.gates.length + ' gates, ' + restore.doc.groups.length + ' groups, ' +
            restore.doc.metrics.length + ' metrics · saved ' + new Date(restore.savedAt).toLocaleString() +
            '. Restoring brings back the analysis; add the same ' + restore.files.length + ' FCS files to see it again.')),
        h('button.btn', { on: { click: () => { FM.ws.loadDoc(restore.doc); toast('Analysis restored — now add the FCS files'); render(); } } }, 'Restore'),
        h('button.btn.ghost.icon', { 'data-tip': 'Dismiss', on: { click: e => { FM.store.remove('autosave'); e.currentTarget.closest('.restore').remove(); } } }, icon('x'))));
    }
    return out;
  }

  // ----------------------------------------------------------------- files
  function filesPanel() {
    const W = ws();
    const S = W.samples;
    const frame = FM.wells.frame(S.map(s => s.well).filter(Boolean));
    const cyts = [...new Set(S.map(s => s.cytometer).filter(Boolean))];
    const counts = S.map(s => s.n);
    const params = W.paramNames();
    const errors = FM.lastLoadErrors || [];
    const dupes = S.filter(s => s.wellConflict);

    const summary = h('div.load-summary',
      h('div', h('div.eyebrow', 'Loaded'), h('h1', S.length + ' file' + (S.length > 1 ? 's' : ''))),
      h('div.facts',
        frame ? fact('Plate', (frame.r1 - frame.r0 + 1) + ' rows × ' + (frame.c1 - frame.c0 + 1) + ' columns', 'wells ' + FM.wells.id(frame.r0, frame.c0) + '–' + FM.wells.id(frame.r1, frame.c1)) : fact('Layout', 'Tubes', 'no well IDs found'),
        fact('Instrument', cyts.join(', ') || '—', S.some(s => s.demo) ? 'synthetic demo data' : ''),
        fact('Events per file', fmtCount(Math.min(...counts)) + (Math.max(...counts) !== Math.min(...counts) ? '–' + fmtCount(Math.max(...counts)) : ''), fmtCount(counts.reduce((a, b) => a + b, 0)) + ' in total'),
        fact('Parameters', String(params.length), params.slice(0, 4).join(', ') + (params.length > 4 ? '…' : ''))));

    const actions = h('div.row',
      h('button.btn', { on: { click: async () => { const f = await FM.dom.pickFiles({ multiple: true, accept: '.fcs,.FCS,.lmd' }); if (f.length) { await FM.loadFiles(f); render(); } } } }, icon('plus'), 'Add files'),
      h('span.grow'),
      h('button.btn.ghost.danger', { on: { click: async () => {
        if (!await FM.dom.confirm('Remove all files?', 'Gates, groups and metrics stay; only the loaded data is removed.', 'Remove files', true)) return;
        W.clearSamples(); FM.setUI({ sampleKey: null }); render();
      } } }, icon('trash'), 'Remove all'));

    const rows = S.map(s => h('tr',
      h('td.mono', s.well || h('span.faint', '—')),
      h('td', { title: s.name }, h('div.fname', s.name), s.wellConflict ? h('span.chip.warn', 'duplicate well') : null),
      h('td.r.num', fmtCount(s.n)),
      h('td.r.num', s.acqOrder != null ? String(s.acqOrder) : '—'),
      h('td.num', s.acqTime != null ? fmtTime(s.acqTime) : '—'),
      h('td.muted', s.params.length + ' params'),
      h('td.r', h('button.btn.ghost.sm.icon', { 'data-tip': 'Remove this file', on: { click: () => { W.removeSamples([s.key]); render(); } } }, icon('x')))));

    const table = h('div.panel.files-table',
      h('div.scroll', h('table.tbl',
        h('thead', h('tr', h('th', 'Well'), h('th', 'File'), h('th.r', 'Events'), h('th.r', { 'data-tip': 'Acquisition order from $BTIM' }, 'Order'), h('th', 'Acquired'), h('th', ''), h('th', ''))),
        h('tbody', rows))));

    const notes = [];
    if (errors.length) notes.push(h('div.note.crit', icon('alert'), h('div', h('strong', errors.length + ' file' + (errors.length > 1 ? 's' : '') + ' could not be read'),
      h('ul', errors.map(e => h('li', h('span.mono', e.name), ' — ', e.error))))));
    if (dupes.length) notes.push(h('div.note.warn', icon('alert'), h('div', h('strong', 'Two files claim the same well'),
      h('div', dupes.map(s => s.name).join(', ') + ' were keyed by file name instead. Remove the one you don\'t want.'))));

    progressEl = h('div.load-progress.hidden');
    return [summary, actions, progressEl, notes, table];
  }

  function fact(k, v, sub) {
    return h('div.fact', h('div.eyebrow', k), h('div.fact-v', v), sub ? h('div.fact-sub.muted', sub) : null);
  }

  // ---------------------------------------------------------------- start
  function startPanel() {
    const W = ws();
    const has = W.samples.length > 0;
    const configured = W.doc.gates.length > 0;
    return h('div.panel.start',
      h('div.panel-head', h('h3', configured ? 'Analysis' : 'Start the analysis')),
      h('div.start-list',
        configured ? h('div.start-state', icon('okCircle'),
          h('div', h('strong', W.doc.gates.length + ' gates · ' + W.doc.groups.length + ' groups'),
            h('div.muted', 'Continue on the Plate step.'))) : null,
        h('button.start-card', { on: { click: () => FM.io.openDocument() } },
          h('div.start-ico', icon('copy')),
          h('div', h('div.start-t', 'Open a shared analysis or template'),
            h('div.start-d', 'Something a colleague sent you, or gates and layout saved earlier: re-run it on this plate.'))),
        h('button.start-card', { disabled: !has, on: { click: () => FM.go('plate') } },
          h('div.start-ico', icon('grid')),
          h('div', h('div.start-t', 'Start from scratch'),
            h('div.start-d', 'Map your plate, then draw gates on any well — every other well follows live.')))),
      has ? h('div.panel-foot', h('button.btn.primary', { on: { click: () => FM.go(W.doc.groups.length ? 'gate' : 'plate') } }, 'Continue', icon('right'))) : null);
  }

  function aboutPanel() {
    return h('div.panel.about',
      h('div.panel-head', h('h3', 'How FlowMate works')),
      h('ol.about-steps',
        h('li', h('strong', 'Load.'), ' Drop your FCS files or a whole folder. Wells are read from the file names.'),
        h('li', h('strong', 'Plate.'), ' Name your conditions and paint them onto the wells.'),
        h('li', h('strong', 'Unmix.'), ' Separate the dyes — with the instrument’s matrix or your single-stain controls — and check every pair.'),
        h('li', h('strong', 'Gate.'), ' Draw once and every well follows live — polygon, rectangle, ellipse, quadrant or range.'),
        h('li', h('strong', 'Measure.'), ' Pick populations and statistics, or a formula; one row per well. Copy it into Excel or Prism, or export a CSV.'),
        h('li', h('strong', 'Analysis.'), ' Graph a measurement by condition, with SD or SEM and the P values worked out.')),
      h('div.panel-foot', h('button.btn', { on: { click: () => FM.openGuide() } }, icon('help'), 'Walk through an example')));
  }

  // --------------------------------------------------------------- params
  function paramsPanel() {
    const W = ws();
    const list = W.paramNames().map(name => {
      const spec = W.scaleSpec(name);
      const sel = h('select.input.sm', { on: { change: e => changeType(name, e.target.value) } },
        [['lin', 'Linear'], ['log', 'Log'], ['logicle', 'Logicle'], ['asinh', 'Arcsinh']].map(([v, l]) => h('option', { value: v, selected: spec.type === v }, l)));
      return h('div.param-row', h('div.grow', h('div.mono', name), h('div.muted.small', W.paramInfo(name).label && W.paramInfo(name).label !== name ? W.paramInfo(name).label : FM.transforms.describe(spec))), sel);
    });
    return h('div.panel.params',
      h('div.panel-head', h('h3', 'Parameters'), h('span.muted.small', 'axis type, shared by every well')),
      h('div.param-list', list));
  }

  function changeType(name, type) {
    FM.dom.closePop();
    FM.axisUI.setType(name, type);
  }

  function update(kind) {
    if (kind === 'loading') return;
    if (kind === 'ws:samples' || kind === 'ws:doc' || kind === 'ws:axes' || kind === 'ws:gates' || kind === 'ws:groups' || kind === 'ws:metrics') render();
  }

  FM.bus && FM.bus.on((kind, d) => {
    if (kind !== 'loading' || !progressEl) return;
    if (!d) { progressEl.classList.add('hidden'); return; }
    progressEl.classList.remove('hidden');
    if (!progressEl.querySelector('canvas')) { FM.dom.clear(progressEl); progressEl.append(FM.brand.miniCell('inline'), h('span.lp-text')); }
    progressEl.querySelector('.lp-text').textContent = 'Reading ' + d.done + ' of ' + d.total + ' files…';
  });

  FM.views = FM.views || {};
  FM.views.load = { mount, update, unmount() { root = null; if (stopCell) { stopCell(); stopCell = null; } } };
})(FM);
