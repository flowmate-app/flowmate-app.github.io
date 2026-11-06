/* Compensation (the Unmix step), laid out the way FlowJo users know it: a list of matrices, a
 * Compensation wizard that builds one from single-stain controls (a row per control: use, confidence,
 * detector, positive and negative gates, a universal negative), and a Matrix editor (spill values as
 * a heat map you edit with the arrow keys, an N×N or histogram preview with the uncompensated data
 * overlaid). Matrices can be imported from FlowJo .mtx, CSV or an FCS file and saved as .mtx or CSV.
 * Spectral unmixing uses the same screens (core/unmix.js, core/comp.js, core/matrixio.js). */
(function (FM) {
  'use strict';
  const { h, icon, clear, toast, menu, fmtCount } = FM.dom;
  const W = () => FM.ws;
  const U = () => FM.unmix;
  const T = () => FM.transforms;

  let root = null;
  let sigCache = { key: null, sig: null, err: null };
  let resCache = { key: null, r: null };
  let prevCache = new Map();             // previews computed for a matrix that is not applied
  let drag = null;
  let handleAt = null;                   // the drag handle in client px (for the UI test)

  // ------------------------------------------------------------- state
  const comp = () => W().doc.comp || FM.comp.defaultComp();
  const fileSpill = () => { const s = W().samples.find(x => x.spill); return s ? s.spill : null; };
  const ui = () => FM.ui;
  /** What is applied to every sample: 'file' (acquisition-defined), 'none', or a matrix id. */
  function applied() {
    const a = comp().active || 'file';
    if (a === 'file') return fileSpill() ? 'file' : 'none';
    return a === 'none' || FM.comp.matrixById(W(), a) ? a : 'none';
  }
  /** The matrix shown in the editor as an object the engine understands, or null. */
  function matrixObj(id) {
    if (id === 'file') { const sp = fileSpill(); return sp ? { id: 'file', name: 'Acquisition-defined', kind: 'spillover', params: sp.params, spill: sp.matrix, readOnly: true, color: '#9aa0b4' } : null; }
    return id && id !== 'none' ? FM.comp.matrixById(W(), id) : null;
  }
  function selectedId() {
    let id = ui().unmixMatrix;
    if (!id || !matrixObj(id)) { const a = applied(); id = a !== 'none' ? a : (comp().matrices[0] ? comp().matrices[0].id : (fileSpill() ? 'file' : null)); ui().unmixMatrix = id; }
    return id;
  }
  const tab = () => (ui().unmixTab === 'editor' ? 'editor' : 'wizard');

  function signatures() {
    const ws = W(), c = comp();
    const key = JSON.stringify([c.setup, ws.doc.groups.filter(g => g.role === 'comp' || g.role === 'unstained').map(g => [g.id, g.name, g.role, ws.samplesIn(g.id).map(s => s.key + (ws.wellInfo(s.key).excluded ? 'x' : ''))]), ws.samples.length]);
    if (key !== sigCache.key) {
      sigCache = { key, sig: null, err: null };
      try { if (U().controls(ws).singles.length) sigCache.sig = U().signatures(ws, { population: c.setup && c.setup.population, setup: c.setup && c.setup.controls, universal: !c.setup || c.setup.universal !== false }); }
      catch (e) { sigCache.err = e.message; }
    }
    return sigCache.sig;
  }

  /** Residual spill measured on the controls, for a matrix made from them. */
  function residuals(m) {
    const sig = signatures();
    if (!m || !sig || !m.dyes || m.dyes.length !== sig.used.length || m.dyes.some((d, i) => d.label !== sig.used[i].label)) return null;
    const key = JSON.stringify([sigCache.key, m.kind, m.adjust, m.spill]);
    if (key !== resCache.key) {
      try { resCache = { key, r: U().residuals(W(), sig, U().unmixer(m), { population: comp().setup && comp().setup.population }) }; }
      catch (e) { console.error(e); resCache = { key, r: null }; }
    }
    return resCache.r;
  }

  /** The channels a matrix produces, with labels: detectors (compensation) or dyes (spectral). */
  function channels(m) {
    if (!m) return [];
    const s0 = W().samples[0];
    if (m.kind === 'spectral') return m.dyes.map(d => ({ label: d.label, ch: FM.comp.outName(s0 ? s0.raw || s0.data : {}, d.label) }));
    return m.params.map((p, i) => ({ label: m.dyes && m.dyes[i] ? m.dyes[i].label : p, ch: p }));
  }

  /** A sample's events as matrix `m` would compensate them (thinned), for previews of any matrix. */
  function previewSample(m, sample) {
    const key = JSON.stringify([m.id, m.kind, m.params, m.spill, m.adjust, m.dyes && m.dyes.map(d => d.signature)]) + '|' + sample.key;
    if (prevCache.has(key)) return prevCache.get(key);
    if (prevCache.size > 30) prevCache = new Map();
    const ev = U().eventsOf(W(), sample, null).slice(0, 6000);
    const out = U().unmixer(m)(sample, ev);
    const data = {}, raw = {};
    channels(m).forEach((c, j) => { data[c.ch] = Float32Array.from(out[j]); });
    (m.params || []).forEach(p => { const col = (sample.raw || sample.data)[p]; raw[p] = Float32Array.from(ev.map(e => col[e])); });
    const ps = { key: 'preview:' + sample.key, n: ev.length, data, _disp: new Map(), idx: Uint32Array.from(ev.map((_, i) => i)),
      raw: { key: 'raw:' + sample.key, n: ev.length, data: raw, _disp: new Map(), idx: Uint32Array.from(ev.map((_, i) => i)) } };
    prevCache.set(key, ps);
    return ps;
  }
  /** The axis scale of a channel: the workspace's, or one fitted to the preview data (a matrix not yet applied). */
  function scaleOf(ch, ps) {
    const p = W().doc.params[ch];
    if (p && p.scale) return p.scale;
    const col = ps && ps.data[ch];
    const vals = col ? Array.from(col).filter((_, i) => i % 3 === 0) : [];
    return T().defaultScale({ name: ch, displayHint: 'log', range: 262144 }, vals);
  }

  // ------------------------------------------------------------- render
  function mount(el) { root = el; render(); }

  function render() {
    if (!root) return;
    clear(root);
    const ws = W();
    if (!ws.samples.length) {
      root.appendChild(h('div.empty', FM.brand.miniCell(), h('h2', 'Compensation'),
        h('p', 'Load your FCS files — single-stain controls included — to compensate or unmix them here.'),
        h('div.row', h('button.btn.primary', { on: { click: () => FM.go('load') } }, 'Go to Load'),
          h('button.btn', { on: { click: () => { FM.loadDemo({ controls: true }); ui().unmixTab = 'wizard'; } } }, icon('flask'), 'Demo plate with controls'),
          h('button.btn', { on: { click: loadSpectralDemo } }, icon('flask'), 'Spectral demo'))));
      return;
    }
    root.appendChild(h('div.cmp',
      header(),
      h('div.cmp-body', matrixList(), h('section.cmp-main', tab() === 'wizard' ? wizard() : editor()))));
  }

  // ------------------------------------------------------------ header
  function header() {
    const ws = W(), c = comp(), a = applied();
    const opts = [];
    if (fileSpill()) opts.push(['file', 'Acquisition-defined']);
    c.matrices.forEach(m => opts.push([m.id, m.name]));
    opts.push(['none', 'None (uncompensated)']);
    const sel = h('select.input.cmp-applied', { 'aria-label': 'Matrix applied to all samples', on: { change: e => ws.confirmComp(e.target.value) } },
      opts.map(([v, l]) => h('option', { value: v, selected: v === a }, l)));
    const status = c.confirmed ? h('span.chip.ok', icon('check'), 'Confirmed')
      : h('button.btn.sm.primary.umx-confirm', { 'data-tip': 'Keep what is applied, and mark this step done', on: { click: () => ws.confirmComp(a) } }, icon('check'), 'Confirm');
    const tabs = h('div.seg.cmp-tabs', { role: 'tablist' }, [['wizard', 'Compensation wizard'], ['editor', 'Matrix editor']].map(([id, l]) =>
      h('button' + (tab() === id ? '.on' : ''), { role: 'tab', 'aria-selected': tab() === id ? 'true' : 'false', on: { click: () => { ui().unmixTab = id; render(); } } }, l)));
    return h('header.cmp-head',
      h('div.cmp-title', h('h2', 'Unmixing', h('span.beta', 'beta')), h('p.muted', 'Every dye spills light into detectors other than its own; a matrix removes it, cell by cell, before you gate. This tool is in beta — check its result on your controls.'),
        h('button.btn.sm.cmp-back', { on: { click: () => FM.go('gate') } }, icon('left'), 'Back to gating')),
      h('div.cmp-apply', h('span.muted.small', 'Applied to all samples'), sel, status),
      tabs);
  }

  // ------------------------------------------------------- matrix list
  function matrixList() {
    const ws = W(), c = comp(), a = applied(), sel = tab() === 'editor' ? selectedId() : null;
    const row = (id, name, color, sub, readOnly) => h('button.cmp-mrow' + (sel === id ? '.on' : ''), {
      on: { click: () => { ui().unmixMatrix = id; ui().unmixTab = 'editor'; ui().unmixPair = null; render(); } },
    }, h('span.cmp-dot', { style: { background: color } }), h('div.cmp-mname', h('div', name), h('div.muted.small', sub)),
      readOnly ? h('span.cmp-lock', { 'data-tip': 'From the files — edit a copy' }, icon('ban')) : null,
      a === id ? h('span.chip.accent', 'applied') : null);
    const rows = [];
    if (fileSpill()) rows.push(row('file', 'Acquisition-defined', '#9aa0b4', fileSpill().params.length + ' detectors · from the files', true));
    c.matrices.forEach(m => rows.push(row(m.id, m.name, m.color || '#4c3fb3',
      (m.kind === 'spectral' ? 'Spectral · ' + m.dyes.length + ' dyes' : m.params.length + ' parameters') + ' · ' + ({ computed: 'from controls', imported: 'from a file', edited: 'edited copy' }[m.source] || m.source || '') + (m.edited ? ' · edited' : ''), false)));
    const cur = matrixObj(sel || (a !== 'none' ? a : null));
    return h('aside.panel.cmp-side',
      h('div.panel-head', h('h3', 'Matrices')),
      h('div.cmp-mlist', rows.length ? rows : h('div.muted.small.pad', 'No matrices yet. Create one from your controls in the wizard, or import a file.')),
      h('div.cmp-mtools',
        h('button.btn.sm', { 'data-tip': 'New matrix', on: { click: e => menu(e.currentTarget, [
          { label: 'From controls (wizard)…', icon: 'beaker', fn: () => { ui().unmixTab = 'wizard'; render(); } },
          { label: 'From file…', icon: 'folder', fn: importFile },
          { label: 'Blank matrix', icon: 'grid', fn: blankMatrix },
        ]) } }, icon('plus'), icon('down')),
        h('button.btn.sm', { disabled: !cur, 'data-tip': 'Edit: an editable copy of this matrix', on: { click: () => { const id = ws.duplicateMatrix(cur.id); if (id) { ui().unmixMatrix = id; ui().unmixTab = 'editor'; toast('Made an editable copy'); } } } }, icon('copy'), 'Edit'),
        h('button.btn.sm', { disabled: !cur, 'data-tip': 'Save this matrix as a file', on: { click: e => menu(e.currentTarget, [
          { label: 'FlowJo matrix (.mtx)', icon: 'download', fn: () => saveMatrix(cur, 'mtx') },
          { label: 'CSV', icon: 'download', fn: () => saveMatrix(cur, 'csv') },
        ]) } }, icon('download'), 'Save'),
        h('button.btn.sm.ghost.icon', { disabled: !cur || cur.readOnly, 'data-tip': 'Delete this matrix', 'aria-label': 'Delete matrix', on: { click: () => { ws.deleteMatrix(cur.id); ui().unmixMatrix = null; toast('Deleted ' + cur.name, { action: { label: 'Undo', fn: () => ws.undo() } }); } } }, icon('trash'))));
  }

  function saveMatrix(m, kind) {
    if (m.kind === 'spectral') { toast('Spectral matrices are saved with the analysis; .mtx and CSV hold compensation matrices', { level: 'crit' }); return; }
    const name = FM.io.safeName(m.name);
    if (kind === 'mtx') FM.dom.download(name + '.mtx', FM.matrixio.toMTX(m), 'application/xml');
    else FM.dom.download(name + '.csv', FM.matrixio.toCSV(m), 'text/csv');
    toast('Saved ' + name + '.' + kind);
  }

  async function importFile() {
    const ws = W();
    const files = await FM.dom.pickFiles({ accept: '.mtx,.xml,.csv,.tsv,.txt,.fcs,.FCS' });
    if (!files.length) return;
    return importMatrixFile(files[0]);
  }
  /** A matrix file (FlowJo .mtx, Gating-ML, CSV/TSV/TXT, or an FCS file's own matrix) → a new matrix, applied. */
  async function importMatrixFile(file) {
    const ws = W();
    let m;
    try {
      if (/\.fcs$/i.test(file.name)) {
        const s = FM.fcs.parse(await file.arrayBuffer(), file.name);
        if (!s.spill) throw new Error(file.name + ' carries no spillover matrix (or only an identity one).');
        m = { name: file.name.replace(/\.fcs$/i, '') + ' matrix', params: s.spill.params, spill: s.spill.matrix };
      } else m = FM.matrixio.parse(await file.text(), file.name);
    } catch (e) { toast(e.message, { level: 'crit', ms: 8000 }); return null; }
    const match = FM.matrixio.matchParams(ws, m.params);
    if (match.unmatched.length) { toast('These parameters are not in your files: ' + match.unmatched.join(', ') + '. Rename them in the file to match your $PnN names.', { level: 'crit', ms: 9000 }); return null; }
    const id = ws.importMatrix({ name: m.name, params: match.params, spill: m.spill });
    ui().unmixMatrix = id; ui().unmixTab = 'editor';
    toast('Imported “' + m.name + '” (' + m.params.length + ' parameters) and applied it to all samples');
    return id;
  }

  function blankMatrix() {
    const ws = W();
    const dets = U().detectors(ws);
    if (!dets.length) { toast('These files have no fluorescence parameters'); return; }
    const id = ws.saveMatrix({ name: 'New matrix', params: dets, spill: dets.map((_, i) => dets.map((__, j) => (i === j ? 1 : 0))), source: 'edited' });
    ui().unmixMatrix = id; ui().unmixTab = 'editor';
  }

  // ------------------------------------------------------------ wizard
  function wizard() {
    const ws = W(), c = comp();
    const setup = c.setup || {};
    const sig = signatures();
    const ctl = U().controls(ws);
    if (!ctl.singles.length) {
      return h('div.panel.cmp-wiz.cmp-wiz-empty',
        h('h3', 'Compensation wizard'),
        h('p', 'Build a matrix from single-stain controls: one tube or well per dye, plus an unstained one if you have it.'),
        h('ol',
          h('li', 'On the Plate step, give single-stain wells the role “Single-stain control” and name each after its dye; give the unstained “Unstained control”.'),
          h('li', 'Or add control files here — their dyes are read from the file names.')),
        h('div.row', h('button.btn.primary', { on: { click: addControlFiles } }, icon('plus'), 'Add control files…'),
          h('button.btn', { on: { click: () => FM.go('plate') } }, icon('grid'), 'Mark wells on the Plate'),
          h('button.btn.ghost', { on: { click: importFile } }, icon('folder'), 'Or import a matrix file…')));
    }
    const existing = c.matrices.filter(m => m.source === 'computed').map(m => m.name);
    const nameIn = h('input.input.sm.cmp-name', { value: ui().unmixName || (existing[0] || 'Compensation'), 'aria-label': 'Matrix name', on: { input: e => { ui().unmixName = e.target.value; createBtn.textContent = ''; createBtn.append(icon('check'), createLabel()); } } });
    const createLabel = () => (existing.indexOf((ui().unmixName || existing[0] || 'Compensation').trim()) >= 0 ? 'Update matrix' : 'Create matrix');
    const nDyes = sig ? sig.used.length : ctl.singles.length;
    const autoMethod = ws.unmixMethod(nDyes);
    const mode = h('div.seg.sm.umx-method', [['compensation', 'Traditional'], ['spectral', 'Spectral']].map(([v, l]) => {
      const on = (setup.method === 'auto' || !setup.method ? autoMethod : setup.method) === v;
      return h('button' + (on ? '.on' : ''), { 'data-tip': v === 'compensation' ? 'One detector per dye — classic compensation' : 'Every detector, fitted by least squares — spectral unmixing', on: { click: () => ws.setUnmixSetup({ method: v }) } }, l);
    }));
    const pops = [{ id: '', name: 'All events' }].concat(ws.doc.gates.map(g => ({ id: g.id, name: g.name })));
    const popSel = h('select.input.sm', { 'aria-label': 'Events to use', 'data-tip': 'A clean-up gate: use only the cells (or beads) in this population', on: { change: e => ws.setUnmixSetup({ population: e.target.value || null }) } },
      pops.map(p => h('option', { value: p.id, selected: (setup.population || '') === p.id }, p.name)));
    const universal = ctl.unstained.length > 0 && setup.universal !== false;
    const uni = h('label.cmp-check.cmp-uni', { 'data-tip': ctl.unstained.length ? 'Use the unstained control as the negative for every dye' : 'Mark an unstained control to use one' },
      h('input', { type: 'checkbox', checked: universal, disabled: !ctl.unstained.length, on: { change: e => ws.setUnmixSetup({ universal: e.target.checked }) } }),
      icon('flask'), h('span', 'Universal negative (unstained)'));
    const createBtn = h('button.btn.primary.cmp-create', { disabled: !sig || !sig.used.length, on: { click: () => {
      try {
        const r = ws.computeUnmix({ name: (nameIn.value || 'Compensation').trim() });
        ws.confirmComp(r.id);
        ui().unmixMatrix = r.id; ui().unmixTab = 'editor'; ui().unmixName = null;
        toast('“' + FM.comp.matrixById(ws, r.id).name + '” is applied to all samples — check it in the Matrix editor');
      } catch (e) { toast(e.message, { level: 'crit', ms: 6000 }); }
    } } }, icon('check'), createLabel());
    const rows = sig ? sig.dyes.map(d => controlRow(d, sig, universal)) : [h('div.note.crit', icon('alert'), h('span', sigCache.err || 'The controls could not be read.'))];
    return h('div.panel.cmp-wiz',
      h('div.cmp-wiz-bar',
        h('div.field', h('label', 'Matrix name'), nameIn),
        h('div.field', h('label', 'Mode'), mode),
        h('div.field', h('label', 'Clean-up gate'), popSel),
        uni, h('span.grow'),
        h('button.btn.sm', { on: { click: addControlFiles } }, icon('plus'), 'Add control files…')),
      h('div.cmp-ctl-head', h('span', 'Use'), h('span', ''), h('span', 'Control'), h('span', 'Detector'), h('span', universal ? 'Positive gate' : 'Negative and positive gates'), h('span', '')),
      h('div.cmp-ctl-list', rows,
        ctl.unstained.length ? h('div.cmp-ctl.unst', h('span'), h('span.cmp-q', { style: { background: '#9aa0b4' } }), h('div.cmp-ctl-name', 'Unstained'), h('span.muted.small', ctl.unstained.length + ' sample' + (ctl.unstained.length === 1 ? '' : 's')), h('span.muted.small', universal ? 'Universal negative for every dye' : 'Not used — each control’s own dim events are its negative'), h('span'))
          : h('div.note.small', icon('info'), h('span', 'No unstained control: each control’s own dim events are its negative (the grey gate).'))),
      h('div.cmp-wiz-foot', h('span.muted.small', sig ? sig.used.length + ' of ' + sig.dyes.length + ' controls in use · ' + (autoMethod === 'spectral' && (setup.method === 'auto' || !setup.method) ? 'spectral chosen automatically (' + U().detectors(ws).length + ' detectors)' : '') : ''), h('span.grow'), createBtn));
  }

  const Q_TIP = { good: 'Good control: a clear positive population', fair: 'Usable, but check it: few positives or a weak separation', poor: 'Poor control: no clear positive population' };
  function controlRow(d, sig, universal) {
    const ws = W();
    const use = h('input', { type: 'checkbox', checked: d.use, 'aria-label': 'Use ' + d.label, on: { change: e => ws.setControlSetup(d.group, { use: e.target.checked }) } });
    const name = h('input.input.sm.cmp-ctl-name-in', { value: d.label, 'aria-label': 'Dye', on: { change: e => { const v = e.target.value.trim(); if (v) ws.updateGroup(d.group, { name: v }); } } });
    const peak = h('select.input.sm', { 'aria-label': 'Detector', on: { change: e => ws.setControlSetup(d.group, { peak: e.target.value }) } }, sig.detectors.map(p => h('option', { value: p, selected: p === d.peak }, p)));
    const hist = h('canvas.umx-hist.cmp-hist', { width: 300, height: 58, 'data-tip': universal ? 'Drag the orange line: events to its right are the positives' : 'Drag the lines: grey — the negatives end here; orange — the positives start here' });
    FM.dom.frame(() => drawHist(hist, d, sig, universal));
    return h('div.cmp-ctl' + (d.use ? '' : '.off'),
      use,
      h('span.cmp-q.' + d.quality, { 'data-tip': Q_TIP[d.quality] + ' · ' + fmtCount(d.nPos) + ' positive events' + (Number.isFinite(d.snr) ? ' · separation ' + d.snr.toFixed(0) + '×' : '') }),
      name, peak, hist,
      h('div.cmp-ctl-info.small', h('div.mono', fmtCount(d.nPos) + ' positive'), d.warnings.map(w => h('div.cmp-warn', icon('alert'), w))));
  }

  /** The control's detector: the control (purple), the unstained (grey), the positive and negative gates as draggable lines. */
  function drawHist(cv, d, sig, universal) {
    const ws = W();
    const spec = ws.scaleSpec(d.peak), sc = T().makeScale(spec);
    const ctx = cv.getContext('2d');
    const Wd = cv.width, Ht = cv.height, bins = 90;
    const bin = keys => {
      const counts = new Float64Array(bins);
      keys.forEach(k => { const s = ws.sample(k); if (!s) return; const col = (s.raw || s.data)[d.peak]; U().eventsOf(ws, s, comp().setup && comp().setup.population).forEach(e => { const t = sc.fwd(col[e]); if (t >= 0 && t < 1) counts[Math.floor(t * bins)]++; }); });
      const mx = Math.max(...counts) || 1;
      return Array.from(counts, v => v / mx);
    };
    const ctrl = U().controls(ws).singles.find(c => c.group === d.group);
    const own = bin(ctrl ? ctrl.keys : []);
    const neg = universal ? bin(sig.unstained) : null;
    const lines = { pos: sc.fwd(d.cut), neg: sc.fwd(d.negHi) };
    const draw = () => {
      ctx.clearRect(0, 0, Wd, Ht);
      const area = (arr, color) => { ctx.beginPath(); ctx.moveTo(0, Ht); arr.forEach((v, i) => ctx.lineTo((i + 0.5) / bins * Wd, Ht - 2 - v * (Ht - 8))); ctx.lineTo(Wd, Ht); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); };
      if (neg) area(neg, 'rgba(140,146,166,.45)');
      area(own, 'rgba(76,63,179,.55)');
      const xp = lines.pos * Wd;
      ctx.fillStyle = 'rgba(217,130,43,.10)'; ctx.fillRect(xp, 0, Wd - xp, Ht);
      ctx.strokeStyle = '#d9822b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(xp, 0); ctx.lineTo(xp, Ht); ctx.stroke();
      ctx.fillStyle = '#d9822b'; ctx.font = '10px sans-serif'; ctx.fillText('+', Math.min(Wd - 8, xp + 4), 11);
      if (!universal) {
        const xn = lines.neg * Wd;
        ctx.fillStyle = 'rgba(120,126,146,.10)'; ctx.fillRect(0, 0, xn, Ht);
        ctx.strokeStyle = '#7a8094'; ctx.beginPath(); ctx.moveTo(xn, 0); ctx.lineTo(xn, Ht); ctx.stroke();
        ctx.fillStyle = '#7a8094'; ctx.fillText('−', Math.max(2, xn - 10), 11);
      }
    };
    draw();
    cv.onpointerdown = e => {
      try { cv.setPointerCapture(e.pointerId); } catch (_) { /* not every pointer can be captured */ }
      const r = cv.getBoundingClientRect();
      const at = ev => Math.min(0.995, Math.max(0.005, (ev.clientX - r.left) / r.width));
      const t0 = at(e);
      const which = universal || Math.abs(t0 - lines.pos) <= Math.abs(t0 - lines.neg) ? 'pos' : 'neg';
      lines[which] = t0; draw();
      cv.onpointermove = ev => { lines[which] = at(ev); draw(); };
      cv.onpointerup = () => {
        cv.onpointermove = null; cv.onpointerup = null;
        W().setControlSetup(d.group, which === 'pos' ? { cut: sc.inv(lines.pos) } : { negHi: sc.inv(lines.neg) });
      };
    };
  }

  async function addControlFiles() {
    const ws = W();
    const files = await FM.dom.pickFiles({ multiple: true, accept: '.fcs,.FCS' });
    if (!files.length) return;
    const before = new Set(ws.samples.map(s => s.key));
    await FM.loadFiles(files);
    assignControls(ws.samples.filter(s => !before.has(s.key)));
  }
  function assignControls(samples) {
    const ws = W();
    let n = 0;
    samples.forEach(s => {
      const dye = U().guessDye(s.name) || U().guessDye(s.name + ' ' + s.params.map(p => p.label || '').join(' '));
      if (dye === 'unstained') {
        const g = ws.doc.groups.find(x => x.role === 'unstained') || ws.group(ws.addGroup('Unstained', 'unstained'));
        ws.assign([s.key], g.id); n++;
        return;
      }
      const name = U().controlName(s.name);
      const g = ws.doc.groups.find(x => x.role === 'comp' && x.name.toLowerCase() === name.toLowerCase()) || ws.group(ws.addGroup(name, 'comp'));
      ws.assign([s.key], g.id); n++;
    });
    if (n) toast(n + ' control file' + (n === 1 ? '' : 's') + ' added — check each one’s dye name and detector');
  }

  // ------------------------------------------------------------ editor
  function editor() {
    const ws = W();
    const id = selectedId();
    const m = matrixObj(id);
    if (!m) {
      return h('div.panel.cmp-ed.empty-ed', h('h3', 'Matrix editor'),
        h('p.muted', 'No matrix to edit yet. Build one from your single-stain controls, import a matrix file (FlowJo .mtx, CSV, or an FCS file’s own matrix), or start a blank one.'),
        h('div.row', h('button.btn.primary', { on: { click: () => { ui().unmixTab = 'wizard'; render(); } } }, icon('beaker'), 'Compensation wizard'),
          h('button.btn', { on: { click: importFile } }, icon('folder'), 'Import a matrix file…'),
          h('button.btn', { on: { click: blankMatrix } }, icon('grid'), 'Blank matrix')));
    }
    const isApplied = applied() === id;
    const name = h('input.input.sm.cmp-ed-name', { value: m.name, disabled: !!m.readOnly, 'aria-label': 'Matrix name', on: { change: e => { const v = e.target.value.trim(); if (v) ws.renameMatrix(id, v); } } });
    const head = h('div.cmp-ed-head', h('span.cmp-dot', { style: { background: m.color || '#4c3fb3' } }), name,
      m.readOnly ? h('span.chip', icon('ban'), 'From the files — read only') : null,
      h('span.grow'),
      m.readOnly ? h('button.btn.sm', { on: { click: () => { const nid = ws.duplicateMatrix(id); ui().unmixMatrix = nid; toast('Made an editable copy'); } } }, icon('copy'), 'Edit a copy') : null,
      isApplied ? h('span.chip.accent', icon('check'), 'Applied to all samples') : h('button.btn.sm.primary', { on: { click: () => ws.confirmComp(id) } }, 'Apply to all samples'));
    const body = m.kind === 'spectral' ? spectralBlock(m) : spillGrid(m);
    return h('div.cmp-ed', h('div.panel.cmp-ed-top', head, body), preview(m));
  }

  /** Spill colours, as FlowJo: blue for negative, darkening yellow for higher positive values. */
  function spillColor(v) {
    if (!Number.isFinite(v) || Math.abs(v) < 0.001) return null;
    if (v < 0) return 'rgba(63,111,216,' + Math.min(0.7, 0.06 + Math.abs(v) * 8).toFixed(3) + ')';
    return 'rgba(224,170,40,' + Math.min(0.85, 0.05 + v * 3).toFixed(3) + ')';
  }

  function spillGrid(m) {
    const ws = W();
    const k = m.params.length;
    const show = ui().unmixShow && ui().unmixShow.matrix === m.id ? ui().unmixShow.set : (ui().unmixShow = { matrix: m.id, set: new Set(m.params.slice(0, 8)) }).set;
    const view = ui().unmixView === 'comp' ? 'comp' : 'spill';
    const inv = view === 'comp' ? FM.fcs.invert(m.spill) : null;
    const labels = m.params.map((p, i) => (m.dyes && m.dyes[i] ? m.dyes[i].label + ' (' + p + ')' : p));
    const step = e => (e.shiftKey ? 1 : e.altKey ? 0.01 : 0.1);           // % per arrow press
    const cell = (i, j) => {
      if (i === j) return h('td.diag', '100');
      const v = view === 'comp' ? inv[i][j] : m.spill[i][j];
      const bg = spillColor(view === 'comp' ? -v : v);
      if (view === 'comp' || m.readOnly) return h('td.ro', { style: bg ? { background: bg } : null }, (v * 100).toFixed(2));
      const inp = h('input.cmp-cell', { value: (v * 100).toFixed(2), 'aria-label': m.params[i] + ' into ' + m.params[j], on: {
        keydown: e => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const nv = (parseFloat(inp.value) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * step(e); inp.value = nv.toFixed(2); ws.updateMatrixCell(m.id, i, j, nv / 100); }
          else if (e.key === 'Enter') inp.blur();
        },
        change: () => { const nv = parseFloat(inp.value); if (Number.isFinite(nv)) ws.updateMatrixCell(m.id, i, j, nv / 100); },
      } });
      return h('td', { style: bg ? { background: bg } : null }, inp);
    };
    const rows = m.params.map((p, i) => h('tr',
      h('td.cmp-show', h('input', { type: 'checkbox', checked: show.has(p), 'aria-label': 'Show ' + p + ' in the preview', on: { change: e => { if (e.target.checked) show.add(p); else show.delete(p); render(); } } })),
      h('th', { title: labels[i] }, labels[i]),
      m.params.map((_, j) => cell(i, j))));
    return h('div.cmp-grid-wrap',
      h('div.cmp-grid-bar', h('div.seg.sm', [['spill', 'Spillover'], ['comp', 'Compensation']].map(([v, l]) => h('button' + (view === v ? '.on' : ''), { 'data-tip': v === 'spill' ? 'How much of each row’s dye lands in each column’s detector (%)' : 'The inverse: what is subtracted (read only)', on: { click: () => { ui().unmixView = v; render(); } } }, l))),
        h('span.muted.small', view === 'spill' ? (m.readOnly ? 'Read only — use “Edit a copy”.' : 'Click a value and use ↑ ↓ (Shift ×10, Alt ÷10), or type it. Rows spill into columns.') : 'Compensation coefficients (read only).'),
        h('span.grow'),
        h('label.cmp-check.small', h('input', { type: 'checkbox', checked: m.params.every(p => show.has(p)), on: { change: e => { m.params.forEach(p => (e.target.checked ? show.add(p) : show.delete(p))); render(); } } }), h('span', 'Show all in preview'))),
      h('div.scroll.cmp-grid', h('table.cmp-tbl', h('thead', h('tr', h('th.cmp-show', ''), h('th', 'Spill from ↓  into →'), m.params.map(p => h('th', { title: p }, p)))), h('tbody', rows))));
  }

  // spectral matrices: signatures, similarity, and corrections (in dye space)
  const DYE_COLORS = ['#3f6fd8', '#d9822b', '#1f9e89', '#c2477c', '#7c5cd6', '#6d8a1f', '#c29a14', '#3f8fb0', '#b5533c', '#5c6bc0', '#2e7d32', '#ad1457'];
  function spectralBlock(m) {
    const M = m.dyes.map(d => d.signature), labels = m.dyes.map(d => d.label);
    const S = U().similarity(M), cx = U().complexity(M);
    const close = [];
    S.forEach((row, i) => row.forEach((v, j) => { if (j > i && v > 0.9) close.push(labels[i] + ' and ' + labels[j] + ' (' + v.toFixed(2) + ')'); }));
    return h('div.cmp-spec',
      h('div.umx-res-block', h('div.eyebrow', 'Signatures — each dye across the ' + m.params.length + ' detectors'), signatureChart(m)),
      h('div.umx-res-block', h('div.eyebrow', 'Similarity — 1 means two dyes look the same'), simTable(S, labels),
        h('div.small.umx-cx', h('strong', 'Complexity index ' + (Number.isFinite(cx) ? cx.toFixed(1) : '∞')), h('span.muted', ' — lower is easier to separate; above ~20, expect spread.')),
        close.length ? h('div.note.warn.small', icon('alert'), h('span', 'Very similar: ' + close.join(', ') + '.')) : null),
      adjustTable(m));
  }
  function signatureChart(m) {
    const S = (...a) => FM.dom.s(...a);
    const d = m.params.length, Wd = 640, Ht = 170, l = 30, r = 10, t = 10, b = 34;
    const x = i => l + (i + 0.5) / d * (Wd - l - r), y = v => t + (1 - Math.max(0, v)) * (Ht - t - b);
    const svg = S('svg', { viewBox: '0 0 ' + Wd + ' ' + Ht, class: 'umx-sig', role: 'img', 'aria-label': 'Dye signatures across detectors' });
    const laser = p => (/^([A-Za-z]+)/.exec(p) || ['', p])[1];
    let start = 0;
    m.params.forEach((p, i) => {
      if (i === m.params.length - 1 || laser(m.params[i + 1]) !== laser(p)) {
        svg.appendChild(S('text', { x: (x(start) + x(i)) / 2, y: Ht - 8, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' }, laser(p)));
        if (i < m.params.length - 1) svg.appendChild(S('line', { x1: (x(i) + x(i + 1)) / 2, x2: (x(i) + x(i + 1)) / 2, y1: t, y2: Ht - b, stroke: 'var(--line)', 'stroke-dasharray': '3 3' }));
        start = i + 1;
      }
    });
    [0, 0.5, 1].forEach(v => { svg.appendChild(S('line', { x1: l, x2: Wd - r, y1: y(v), y2: y(v), stroke: 'var(--line-soft)' })); svg.appendChild(S('text', { x: l - 5, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 10, fill: 'var(--muted)' }, String(v))); });
    m.dyes.forEach((dy, k) => svg.appendChild(S('polyline', { points: dy.signature.map((v, i) => x(i) + ',' + y(v)).join(' '), fill: 'none', stroke: DYE_COLORS[k % DYE_COLORS.length], 'stroke-width': 2, 'stroke-linejoin': 'round' }, S('title', {}, dy.label))));
    return h('div.umx-sig-wrap', svg, h('div.umx-legend', m.dyes.map((dy, k) => h('span', h('i', { style: { background: DYE_COLORS[k % DYE_COLORS.length] } }), dy.label))));
  }
  function simTable(S, labels) {
    const heat = v => 'rgba(76,63,179,' + Math.min(0.85, Math.abs(v) * 0.85).toFixed(3) + ')';
    return h('div.scroll.umx-mat', h('table.umx-tbl', h('thead', h('tr', h('th', ''), labels.map(l => h('th', l)))),
      h('tbody', S.map((row, i) => h('tr', h('th', labels[i]), row.map((v, j) => h('td' + (i === j ? '.diag' : v > 0.9 ? '.hot' : ''), { style: i === j ? null : { background: heat(v) } }, i === j ? '' : v.toFixed(2))))))));
  }
  function adjustTable(m) {
    const ws = W();
    const k = m.dyes.length;
    const A = m.adjust;
    const any = A && A.some(r => r.some(v => v));
    return h('div.umx-adj',
      h('div.umx-adj-head', h('div.eyebrow', 'Corrections — % of the row’s dye still showing in the column’s channel'), h('span.grow'),
        h('button.btn.sm.ghost', { disabled: !any, on: { click: () => ws.resetUnmixAdjust(m.id) } }, icon('undo'), 'Reset corrections')),
      h('div.scroll', h('table.umx-tbl.umx-adj-tbl', h('thead', h('tr', h('th', ''), m.dyes.map(d => h('th', d.label)))),
        h('tbody', m.dyes.map((d, i) => h('tr', h('th', d.label), m.dyes.map((_, j) => {
          if (i === j) return h('td.diag', '—');
          const v = A && A[i] ? A[i][j] || 0 : 0;
          return h('td' + (v ? '.set' : ''), h('input.input.sm.mono', { value: v ? (v * 100).toFixed(2) : '', placeholder: '0', 'aria-label': d.label + ' into ' + m.dyes[j].label,
            on: { change: e => { const p = parseFloat(e.target.value); ws.setUnmixAdjust(m.id, i, j, Number.isFinite(p) ? p / 100 : 0); } } }));
        })))))));
  }

  // ----------------------------------------------------------- preview
  function preview(m) {
    const ws = W();
    const chsAll = channels(m);
    const show = m.kind === 'spectral' ? null : (ui().unmixShow && ui().unmixShow.matrix === m.id ? ui().unmixShow.set : null);
    const chs = (show ? chsAll.filter(c => show.has(c.ch)) : chsAll).slice(0, 16);
    if (!ui().unmixSample || !ws.sample(ui().unmixSample)) {
      const stained = ws.samples.find(s => { const g = ws.groupOf(s.key); return g && g.role !== 'comp' && g.role !== 'unstained' && g.role !== 'gate'; });
      ui().unmixSample = (stained || ws.samples[0]).key;
    }
    const sample = ws.sample(ui().unmixSample);
    const ps = previewSample(m, sample);
    const mode = ui().unmixPreview === 'hist' ? 'hist' : 'nxn';
    const overlay = !!ui().unmixOverlay;
    const r = residuals(m);
    const sel = h('select.input.sm', { 'aria-label': 'Sample', on: { change: e => { ui().unmixSample = e.target.value; render(); } } },
      ws.samples.map(s => { const g = ws.groupOf(s.key); return h('option', { value: s.key, selected: s.key === ui().unmixSample }, (s.well || s.name) + (g ? ' — ' + g.name : '')); }));
    const bar = h('div.panel-head.cmp-prev-head', h('h3', 'Preview'), h('span.grow'),
      h('span.muted.small', 'Sample'), sel,
      h('div.seg.sm', [['nxn', 'N×N'], ['hist', 'Histograms']].map(([v, l]) => h('button' + (mode === v ? '.on' : ''), { on: { click: () => { ui().unmixPreview = v; render(); } } }, l))),
      h('label.cmp-check.small', h('input', { type: 'checkbox', checked: overlay, on: { change: e => { ui().unmixOverlay = e.target.checked; render(); } } }), h('span', 'Overlay uncompensated')));
    if (chs.length < (mode === 'nxn' ? 2 : 1)) return h('section.panel.cmp-prev', bar, h('div.muted.small.pad', 'Tick at least ' + (mode === 'nxn' ? 'two parameters' : 'one parameter') + ' in the matrix to preview them.'));
    let body;
    if (mode === 'hist') {
      body = h('div.cmp-hists', chs.map(c => {
        const cv = h('canvas');
        FM.dom.frame(() => {
          const L = FM.plot.layout(180, 120, { dense: true });
          FM.plot.render(cv, L, { sample: ps, idx: ps.idx, x: c.ch, y: null, xSpec: scaleOf(c.ch, ps), xLabel: c.label, cmap: FM.ui.cmap });
          if (overlay && ps.raw.data[c.ch]) overlayHist(cv, L, ps.raw, c.ch, scaleOf(c.ch, ps));
        });
        return h('div.cmp-histcell', cv);
      }));
    } else {
      const k = chs.length;
      const grid = h('div.umx-grid', { style: { gridTemplateColumns: '64px repeat(' + k + ', 78px)' } });
      grid.appendChild(h('div'));
      chs.forEach(c => grid.appendChild(h('div.umx-gh', { title: c.label }, c.label)));
      const idxOf = c => chsAll.findIndex(x => x.ch === c.ch);
      chs.forEach((ci, a) => {
        grid.appendChild(h('div.umx-gh.row', { title: ci.label }, ci.label));
        chs.forEach((cj, b) => {
          if (a === b) { grid.appendChild(h('div.umx-gd')); return; }
          const i = idxOf(ci), j = idxOf(cj);
          const v = r && r[i] && Number.isFinite(r[i][j]) ? r[i][j] : null;
          const flag = v == null ? '' : Math.abs(v) > 0.05 ? '.bad' : Math.abs(v) > 0.02 ? '.warn' : '';
          const sp = m.kind !== 'spectral' && m.spill[i] ? m.spill[i][j] : 0;
          const cv = h('canvas');
          const pair = ui().unmixPair;
          grid.appendChild(h('button.umx-cell' + flag + (pair && pair[0] === i && pair[1] === j ? '.on' : ''), {
            style: spillColor(sp) ? { background: spillColor(sp) } : null,
            'data-tip': ci.label + ' (across) vs ' + cj.label + ' (up)' + (m.kind !== 'spectral' ? ' · spill ' + (sp * 100).toFixed(2) + '%' : '') + (v != null ? ' · ' + (v * 100).toFixed(1) + '% of ' + ci.label + ' still in ' + cj.label : ''),
            on: { click: () => { ui().unmixPair = [i, j]; render(); FM.dom.frame(() => { const z = root.querySelector('.umx-zoom'); if (z) z.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }); } },
          }, cv));
          FM.dom.frame(() => drawPair(cv, ps, ci.ch, cj.ch, 74, true, overlay));
        });
      });
      const nFlag = r ? r.reduce((acc, row, i) => acc + row.filter((x, j) => i !== j && Number.isFinite(x) && Math.abs(x) > 0.02).length, 0) : null;
      body = h('div.umx-review-body',
        h('div.umx-grid-wrap', grid,
          nFlag == null ? h('div.muted.small', 'Click a plot to straighten a pair by dragging.')
            : h('div.small.umx-flags', nFlag ? [h('span.chip.warn', nFlag + ' pair' + (nFlag === 1 ? '' : 's') + ' to look at'), ' Measured on your controls — amber over 2% left, red over 5%.'] : [h('span.chip.ok', icon('check'), 'Every pair is under 2% on your controls')])),
        ui().unmixPair && chsAll[ui().unmixPair[0]] && chsAll[ui().unmixPair[1]] ? zoom(m, chsAll, ui().unmixPair) : h('div.umx-zoom.empty-zoom.muted', 'Click a plot to enlarge it and straighten it.'));
    }
    return h('section.panel.cmp-prev', bar, body);
  }

  function drawPair(cv, ps, cx, cy, size, compact, overlay) {
    const L = FM.plot.layout(size, size, compact ? { compact: true } : { square: true, dense: true });
    if (!ps.data[cx] || !ps.data[cy]) return null;
    const xs = scaleOf(cx, ps), ys = scaleOf(cy, ps);
    FM.plot.render(cv, L, { sample: ps, idx: ps.idx, x: cx, y: cy, xSpec: xs, ySpec: ys, xLabel: compact ? '' : cx, yLabel: compact ? '' : cy, cmap: FM.ui.cmap });
    if (overlay && ps.raw.data[cx] && ps.raw.data[cy]) overlayDots(cv, L, ps.raw, cx, cy, xs, ys);
    return L;
  }
  /** The uncompensated events as faint grey dots over a plot. */
  function overlayDots(cv, L, raw, cx, cy, xs, ys) {
    const ctx = cv.getContext('2d');
    const sx = T().makeScale(xs), sy = T().makeScale(ys);
    const X = raw.data[cx], Y = raw.data[cy];
    ctx.save(); ctx.scale(L.dpr, L.dpr);
    ctx.fillStyle = 'rgba(70,74,90,.35)';
    const step = Math.max(1, Math.floor(X.length / 1500));
    for (let e = 0; e < X.length; e += step) {
      const [px, py] = FM.plot.toPx(L, sx.fwd(X[e]), sy.fwd(Y[e]));
      if (px >= L.x0 && px <= L.x1 && py >= L.y0 && py <= L.y1) ctx.fillRect(px - 0.6, py - 0.6, 1.2, 1.2);
    }
    ctx.restore();
  }
  function overlayHist(cv, L, raw, ch, spec) {
    const ctx = cv.getContext('2d');
    const sc = T().makeScale(spec);
    const bins = 80, counts = new Float64Array(bins);
    raw.data[ch].forEach(v => { const t = sc.fwd(v); if (t >= 0 && t < 1) counts[Math.floor(t * bins)]++; });
    const mx = Math.max(...counts) || 1;
    ctx.save(); ctx.scale(L.dpr, L.dpr);
    ctx.strokeStyle = 'rgba(70,74,90,.7)'; ctx.setLineDash([3, 2]); ctx.beginPath();
    counts.forEach((c, i) => { const [px, py] = FM.plot.toPx(L, (i + 0.5) / bins, c / mx * 0.95); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.stroke(); ctx.restore();
  }

  // -------------------------------------------------------- zoom + drag
  function zoom(m, chs, pair) {
    const ws = W();
    const [i, j] = pair;
    const sig = signatures();
    // straighten on the dye's own single stain when there is one (as FlowJo users check on controls)
    const dye = m.dyes && m.dyes[i] && sig ? sig.dyes.find(d => d.label === m.dyes[i].label) : null;
    const ctrl = dye ? U().controls(ws).singles.find(c => c.group === dye.group) : null;
    const sample = (ctrl && ws.sample(ctrl.keys[0])) || ws.sample(ui().unmixSample);
    const ps = previewSample(m, sample);
    const cv = h('canvas.umx-zcv'), over = h('canvas.umx-zover');
    const box = h('div.umx-zplot', cv, over);
    const val = m.kind === 'spectral' ? (m.adjust && m.adjust[i] ? m.adjust[i][j] || 0 : 0) : m.spill[i][j];
    FM.dom.frame(() => setupDrag(box, cv, over, ps, m, chs, i, j));
    return h('div.umx-zoom',
      h('div.umx-zhead', h('strong', chs[i].label + ' → ' + chs[j].label), h('span.muted.small', ' on ' + (sample.well || sample.name)), h('span.grow'),
        h('span.mono.small', (m.kind === 'spectral' ? 'correction ' : 'spill ') + (val * 100).toFixed(2) + '%')),
      box,
      h('div.muted.small', m.readOnly ? 'Read-only matrix: dragging makes an editable copy first.' : 'Drag the orange handle until the bright population runs flat; the spillover value changes with it.'));
  }

  function setupDrag(box, cv, over, ps, m, chs, i, j) {
    const ws = W();
    const size = Math.min(380, Math.max(260, box.clientWidth || 380));
    const L = drawPair(cv, ps, chs[i].ch, chs[j].ch, size, false, !!ui().unmixOverlay);
    if (!L) return;
    const sx = T().makeScale(scaleOf(chs[i].ch, ps)), sy = T().makeScale(scaleOf(chs[j].ch, ps));
    const X = ps.data[chs[i].ch], Y = ps.data[chs[j].ch];
    const q = (arr, idx, p) => { const v = Float64Array.from(idx.map(e => arr[e])).sort(); return T().quantile(v, p); };
    const all = Array.from(ps.idx);
    const hiCut = q(X, all, 0.8), loCut = q(X, all, 0.3);
    const pos = all.filter(e => X[e] >= hiCut), neg = all.filter(e => X[e] <= loCut);
    const P = { x: q(X, pos, 0.5), y: q(Y, pos, 0.5) }, N = { x: q(X, neg, 0.5), y: q(Y, neg, 0.5) };
    const ctx = FM.plot.sizeCanvas(over, L);
    const px = (vx, vy) => FM.plot.toPx(L, sx.fwd(vx), sy.fwd(vy));
    const paint = yEnd => {
      ctx.clearRect(0, 0, L.W, L.H);
      const [ax, ay] = px(N.x, N.y), [bx, by] = px(P.x, yEnd);
      ctx.strokeStyle = '#d9822b'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#d9822b'; ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      const rr = over.getBoundingClientRect(); handleAt = [rr.left + bx * rr.width / L.W, rr.top + by * rr.height / L.H];
    };
    paint(P.y);
    const span = P.x - N.x;
    over.onpointerdown = e => {
      const r = over.getBoundingClientRect();
      const sxr = r.width / L.W, syr = r.height / L.H;
      const [bx, by] = px(P.x, P.y);
      if (Math.hypot(e.clientX - r.left - bx * sxr, e.clientY - r.top - by * syr) > 18) return;
      try { over.setPointerCapture(e.pointerId); } catch (_) { /* not every pointer can be captured */ }
      drag = { delta: 0 };
      over.onpointermove = ev => {
        const ty = FM.plot.fromPx(L, 0, (ev.clientY - r.top) / syr)[1];
        const yNew = sy.inv(Math.min(1, Math.max(0, ty)));
        drag.delta = (P.y - yNew) / (span || 1);
        paint(yNew);
      };
      over.onpointerup = () => {
        over.onpointermove = null; over.onpointerup = null;
        const delta = drag.delta; drag = null;
        if (!Number.isFinite(delta) || Math.abs(delta) < 1e-6) return;
        let id = m.id;
        if (m.readOnly) { id = ws.duplicateMatrix(m.id); ui().unmixMatrix = id; ws.confirmComp(id); toast('Made an editable copy of the acquisition matrix, applied it, and changed the copy'); }
        const cur = FM.comp.matrixById(ws, id);
        if (cur.kind === 'spectral') ws.setUnmixAdjust(id, i, j, Math.round(((cur.adjust && cur.adjust[i] ? cur.adjust[i][j] || 0 : 0) + delta) * 1e5) / 1e5);
        else ws.nudgeSpill(id, i, j, Math.round(delta * 1e6) / 1e6);
      };
    };
  }

  // ------------------------------------------------------------- demos
  function loadSpectralDemo() {
    const ws = W();
    const demo = FM.synth.spectralDemo(4000);
    ws.addSamples(demo.samples);
    if (!FM.ui.sampleKey) FM.ui.sampleKey = ws.samples[0].key;
    assignControls(ws.samples.filter(s => !/^Stained_/.test(s.name)));
    ws.applyLayout({ A1: 'Stained', A2: 'Stained', A3: 'Stained', B1: 'Stained', B2: 'Stained', B3: 'Stained' });
    ui().unmixTab = 'wizard';
    toast('A synthetic spectral experiment — 32 detectors, 6 dyes, with single-stain controls');
  }

  let pending = null;
  function update(kind) {
    if (!root || drag) return;
    if (kind === 'ws:samples') { sigCache.key = null; prevCache = new Map(); render(); return; }
    if (kind.startsWith('ws:') || kind === 'theme') {
      if (pending) return;
      pending = FM.dom.frame(() => { pending = null; if (root) render(); });
    }
  }

  FM.views = FM.views || {};
  FM.views.unmix = { mount, update, unmount() { root = null; }, _demo: loadSpectralDemo, _assignControls: assignControls, _handle: () => handleAt, _applied: applied, _importFile: importMatrixFile };
})(FM);
