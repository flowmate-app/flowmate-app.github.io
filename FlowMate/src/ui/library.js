/* My analyses: the user's saved analyses, kept in this browser with their data.
 *
 * An analysis is the workspace document (gates, groups, metrics, compensation, tables, layout),
 * every loaded sample's events, and where the user was (step, sample, population). Once an
 * analysis is saved here it keeps itself up to date as the user works; reopening it brings
 * everything back without loading any files. Storage is shared/library.js (IndexedDB).
 *
 * A sample is stored once, as its uncompensated columns (sample.raw) and FCS keywords, and
 * reused by later saves; compensation is recomputed from the document when it is reopened.
 *
 * An analysis can be shared: Share writes one .flowmate file (core/bundle.js), with or without
 * the data, and opening such a file adds it to My analyses and opens it.
 */
(function (FM) {
  'use strict';
  const { h, icon, clear, toast, modal } = FM.dom;
  const ws = () => FM.ws;
  const lib = root().BML && root().BML.available() ? root().BML.open('flowmate') : null;
  const fmtSize = b => root().BML.fmtSize(b), fmtWhen = t => root().BML.fmtWhen(t);
  function root() { return typeof globalThis !== 'undefined' ? globalThis : window; }

  let current = null;          // { id, name, savedAt } of the analysis being worked on
  let state = 'idle';          // 'idle' | 'saving' | 'error'
  let lastError = null;
  let queue = Promise.resolve();
  let dirty = false;           // changed since the last save
  let quotaWarned = false;
  const listeners = new Set();
  function changed() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }

  function uid() { return Math.random().toString(36).slice(2, 10); }

  // ---------------------------------------------------------------- records
  function blobId(s) { return s._libBlob || (s._libBlob = uid()); }
  function columns(s) { return s.raw || s.data; }
  function sampleSize(s) {
    const c = columns(s);
    return Object.keys(c).reduce((a, k) => a + (c[k] && c[k].byteLength || 0), 0);
  }
  function sampleRecord(s) {
    return { v: 1, key: s.key, name: s.name, version: s.version, meta: s.meta, params: s.params, n: s.n,
      spill: s.spill, acqTime: s.acqTime, cytometer: s.cytometer, demo: !!s.demo, cols: columns(s) };
  }
  function fromRecord(rec, id) {
    const s = { name: rec.name, version: rec.version, meta: rec.meta, params: rec.params, n: rec.n, data: rec.cols,
      spill: rec.spill, acqTime: rec.acqTime, cytometer: rec.cytometer };
    if (rec.demo) s.demo = true;
    s.restoreKey = rec.key;
    s._libBlob = id;
    return s;
  }

  function summary() {
    const W = ws(), d = W.doc;
    const parts = [W.samples.length + ' file' + (W.samples.length === 1 ? '' : 's'), d.gates.length + ' gate' + (d.gates.length === 1 ? '' : 's')];
    if (d.groups.length) parts.push(d.groups.length + ' group' + (d.groups.length === 1 ? '' : 's'));
    const nt = (d.tables || []).filter(t => t.columns.length).length;
    if (nt) parts.push(nt + ' measurement table' + (nt === 1 ? '' : 's'));
    return parts.join(' · ');
  }
  function uiState() {
    const u = FM.ui;
    return { step: u.step, sampleKey: u.sampleKey, popId: u.popId, gateId: u.gateId, metricId: u.metricId };
  }
  /** Nothing worth keeping: no data and no analysis. */
  function empty() {
    const W = ws();
    return !W.samples.length && !W.doc.gates.length && !W.doc.groups.length && !W.doc.metrics.length;
  }

  // ------------------------------------------------------------------ saving
  /** Write the open analysis (to `target`, a new analysis when it has no id). */
  function write(target) {
    const W = ws();
    const samples = W.samples.slice();
    const bySid = new Map(samples.map(s => [blobId(s), s]));
    const job = () => lib.save({
      id: target.id || null,
      name: W.doc.name,
      doc: W.toJSON(),
      ui: uiState(),
      summary: summary(),
      blobIds: Array.from(bySid.keys()),
      blob: b => sampleRecord(bySid.get(b)),
      blobSize: b => sampleSize(bySid.get(b)),
    });
    state = 'saving'; dirty = false; changed();
    const p = queue.then(job);
    queue = p.catch(() => {});
    return p.then(m => {
      state = 'idle'; lastError = null; quotaWarned = false;
      if (!target.id || (current && current.id === m.id)) current = { id: m.id, name: m.name, savedAt: m.savedAt };
      FM.store.set('library.last', m.id);
      changed();
      return m;
    }, e => {
      state = 'error'; lastError = e; dirty = true; changed();
      throw e;
    });
  }

  /** Keep the open analysis up to date (called on every change; debounced). */
  const autosave = FM.dom.debounce(() => {
    if (!current || !dirty || empty()) return;
    write(current).catch(e => {
      if (e.quota && quotaWarned) return;
      quotaWarned = !!e.quota;
      toast('My analyses could not save the latest changes: ' + e.message, { level: 'crit', ms: 8000 });
    });
  }, 1200);

  /** Write pending changes now and wait for every save in flight. */
  function flush() { autosave.flush(); return queue; }

  function touch() { if (current) { dirty = true; autosave(); } }

  /** Ctrl+S / Save: save the open analysis now, asking for a name the first time. */
  function save() {
    if (!lib) { unavailable(); return Promise.resolve(null); }
    if (empty()) { toast('Load some FCS files first — there is nothing to save yet'); return Promise.resolve(null); }
    if (!current) return saveAs();
    autosave.cancel();
    return write(current).then(m => { toast('Saved to My analyses'); return m; }, e => { toast(e.message, { level: 'crit', ms: 8000 }); return null; });
  }

  /** Save the open analysis as a new entry in My analyses (asks for its name). */
  function saveAs(opts) {
    opts = opts || {};
    if (!lib) { unavailable(); return Promise.resolve(null); }
    if (empty()) { toast('Load some FCS files first — there is nothing to save yet'); return Promise.resolve(null); }
    const W = ws();
    const base = W.doc.name && W.doc.name !== 'Untitled experiment' ? W.doc.name : '';
    const size = W.samples.reduce((a, s) => a + sampleSize(s), 0);
    return ask({
      title: opts.copy ? 'Save a copy in My analyses' : 'Save to My analyses',
      subtitle: 'The analysis is kept in this browser together with its ' + W.samples.length + ' data file' + (W.samples.length === 1 ? '' : 's') +
        ' (' + fmtSize(size) + '). Open it from My analyses any time to carry on where you left off' + (opts.copy ? '.' : ' — from now on it saves itself as you work.'),
      label: 'Name',
      value: opts.copy ? (base || 'Analysis') + ' (copy)' : base,
      placeholder: 'e.g. T-cell activation, plate 3',
      ok: 'Save',
    }).then(name => {
      if (name == null) return null;
      if (name !== W.doc.name) W.update('Rename experiment', d => { d.name = name; }, { kind: 'settings' });
      autosave.cancel();
      // a copy becomes the analysis being worked on; the one it came from stays as it was
      return write({ id: null }).then(m => {
        current = { id: m.id, name: m.name, savedAt: m.savedAt };
        changed();
        toast('Saved to My analyses as “' + m.name + '”');
        return m;
      }, e => { toast(e.message, { level: 'crit', ms: 8000 }); return null; });
    });
  }

  /** Stop keeping the open analysis up to date (Start over, opening something else). */
  function detach() {
    autosave.cancel();
    current = null; state = 'idle'; lastError = null; dirty = false;
    changed();
  }

  // ----------------------------------------------------------------- opening
  async function open(id) {
    if (!lib) { unavailable(); return false; }
    if (current && current.id === id) { toast('“' + current.name + '” is already open'); return true; }
    if (!current && !empty()) {
      const ok = await FM.dom.confirm('Open this analysis?', 'What is open now is not in My analyses and will be closed. Save it first if you want to keep it.', 'Open');
      if (!ok) return false;
    }
    await flush();
    let rec, data;
    try {
      rec = await lib.load(id);
      if (!rec) throw new Error('This analysis is no longer in My analyses.');
      data = await lib.blobs(id);
    } catch (e) { toast(e.message, { level: 'crit' }); return false; }
    const missing = rec.meta.blobIds.filter(b => !data.has(b));
    const samples = rec.meta.blobIds.filter(b => data.has(b)).map(b => fromRecord(data.get(b), b));
    const cur = { id: rec.meta.id, name: rec.meta.name, savedAt: rec.meta.savedAt };
    if (!restore(rec.meta.name, rec.doc, samples, rec.ui, cur)) return false;
    FM.store.set('library.last', id);
    toast(missing.length
      ? 'Opened “' + rec.meta.name + '” — ' + missing.length + ' data file' + (missing.length > 1 ? 's were' : ' was') + ' missing from the browser’s storage'
      : 'Opened “' + rec.meta.name + '”', { level: missing.length ? 'crit' : null });
    return true;
  }

  /** Replace what is open with an analysis: its document, its samples, and where the user was. */
  function restore(name, doc, samples, u, cur) {
    detach();
    // leave the step first: its view must not redraw while the samples are swapped
    FM.go('load');
    FM.resetAll();
    const W = ws();
    doc.name = name;
    try { W.loadDoc(doc); } catch (e) { toast(e.message, { level: 'crit' }); return false; }
    if (samples.length) W.addSamples(samples);
    W.samples.forEach(s => { delete s.restoreKey; });
    W.undoStack = []; W.redoStack = [];
    current = cur;
    u = u || {};
    const gateOk = id => !id || !!W.gate(id);
    FM.setUI({
      sampleKey: u.sampleKey && W.sample(u.sampleKey) ? u.sampleKey : (W.samples[0] && W.samples[0].key) || null,
      popId: gateOk(u.popId) ? u.popId || null : null,
      gateId: gateOk(u.gateId) ? u.gateId || null : null,
      metricId: u.metricId && W.doc.metrics.some(m => m.id === u.metricId) ? u.metricId : null,
    });
    changed();
    FM.go(W.samples.length && u.step ? u.step : 'load');
    return true;
  }

  // ----------------------------------------------------------------- sharing
  /** What to share: the open analysis (as it is now) or a saved one. → { name, doc, ui, recs, files } */
  async function shareSource(id) {
    if (!id || (current && current.id === id)) {
      await flush();
      const W = ws();
      return { name: W.doc.name, doc: W.toJSON(), ui: uiState(), recs: W.samples.map(sampleRecord), files: W.samples.map(s => s.name) };
    }
    const rec = await lib.load(id);
    if (!rec) throw new Error('This analysis is no longer in My analyses.');
    const data = await lib.blobs(id);
    const recs = rec.meta.blobIds.filter(b => data.has(b)).map(b => data.get(b));
    return { name: rec.meta.name, doc: rec.doc, ui: rec.ui, recs, files: recs.map(r => r.name) };
  }
  const colBytes = r => Object.keys(r.cols).reduce((a, k) => a + (r.cols[k].byteLength || r.cols[k].length * 8), 0);

  /** Share an analysis (the open one, or a saved one by id): one file to send to someone. */
  async function share(id) {
    let src;
    try { src = await shareSource(id); } catch (e) { toast(e.message, { level: 'crit' }); return; }
    if (!src.recs.length && !src.doc.gates.length && !src.doc.groups.length) { toast('Load some FCS files first — there is nothing to share yet'); return; }
    const size = src.recs.reduce((a, r) => a + colBytes(r), 0);
    const withData = h('input', { type: 'checkbox', checked: src.recs.length > 0, disabled: !src.recs.length, 'aria-label': 'Include the data' });
    const note = h('p.muted.small');
    const sync = () => {
      note.textContent = withData.checked
        ? 'They open it and everything is there — gates, conditions, measurements, graphs and the data — without needing your FCS files.'
        : 'Gates, conditions, measurements and graphs only. They add the FCS files themselves, and the analysis runs on them.';
    };
    withData.addEventListener('change', sync);
    sync();
    return new Promise(res => {
      const save = () => {
        const inc = withData.checked && src.recs.length > 0;
        const parts = FM.bundle.pack({ name: src.name, doc: src.doc, ui: src.ui, withData: inc, files: src.files, sharedAt: Date.now(), from: 'FlowMate ' + FM.version }, inc ? src.recs : []);
        const file = FM.io.safeName(src.name) + '.flowmate';
        FM.dom.download(file, new Blob(parts, { type: 'application/octet-stream' }));
        toast('Saved ' + file + ' — send it to your colleague');
        return true;
      };
      modal({
        title: 'Share “' + src.name + '”',
        subtitle: 'This saves one file you can send by email, chat or a shared drive.',
        body: h('div.col',
          h('label.check', withData, h('span', 'Include the data' + (src.recs.length ? ' (' + src.recs.length + ' FCS file' + (src.recs.length === 1 ? '' : 's') + ', ' + fmtSize(size) + ')' : ' (no files loaded)'))),
          note,
          h('p.muted.small', 'To open it: File → Open a shared analysis, or drop the file on the FlowMate window.')),
        buttons: [{ label: 'Cancel' }, { label: 'Save file', primary: true, fn: save }],
        onClose: () => res(),
      });
    });
  }

  /** Open a .flowmate file: with data, it joins My analyses and opens; without, it applies to the loaded files. */
  async function importShared(file) {
    let b;
    try { b = FM.bundle.unpack(await file.arrayBuffer()); }
    catch (e) { toast(file.name + ': ' + e.message, { level: 'crit', ms: 7000 }); return false; }
    const { head, recs } = b;
    if (!recs.length) { FM.io.applyDocument(head.doc, { files: head.files, name: head.name }); return true; }
    if (!current && !empty()) {
      const ok = await FM.dom.confirm('Open this shared analysis?', 'What is open now is not in My analyses and will be closed. Save it first if you want to keep it.', 'Open');
      if (!ok) return false;
    }
    await flush();
    const samples = recs.map(r => fromRecord(r, uid()));
    if (!restore(head.name || file.name.replace(/\.flowmate$/i, ''), head.doc, samples, head.ui, null)) return false;
    if (lib) {
      try {
        const m = await write({ id: null });
        current = { id: m.id, name: m.name, savedAt: m.savedAt };
        changed();
        toast('Opened “' + m.name + '” — it is now in My analyses', { ms: 5000 });
      } catch (e) { toast('Opened, but it could not be added to My analyses: ' + e.message, { level: 'crit', ms: 8000 }); }
    } else toast('Opened “' + head.name + '”');
    return true;
  }

  // ------------------------------------------------------------------ dialog
  function unavailable() {
    toast('This browser does not allow saving analyses (private windows often block it). Use File → Download workspace file instead.', { level: 'crit', ms: 7000 });
  }

  /** A one-field dialog; resolves to the trimmed text, or null when cancelled. */
  function ask(o) {
    return new Promise(res => {
      const input = h('input.input', { value: o.value || '', placeholder: o.placeholder || '', style: { width: '100%' }, 'aria-label': o.label });
      const err = h('div.form-error.hidden');
      let result = null;
      const ok = () => {
        const v = input.value.trim();
        if (!v) { err.textContent = 'Give it a name.'; err.classList.remove('hidden'); input.focus(); return false; }
        result = v;
        return true;
      };
      const m = modal({
        title: o.title, subtitle: o.subtitle,
        body: h('div.col', h('label.lib-label', o.label), input, err),
        buttons: [{ label: 'Cancel' }, { label: o.ok || 'OK', primary: true, fn: ok }],
        onEnter: () => { if (ok()) m.close(true); },
        onClose: () => res(result),
      });
      setTimeout(() => { input.focus(); input.select(); }, 30);
    });
  }

  let dlg = null;       // the open My analyses dialog: { el, refresh }

  /** The My analyses window: every saved analysis, to open, rename, copy or delete. */
  function show() {
    if (!lib) { unavailable(); return; }
    const listEl = h('div.lib-list', h('div.muted.lib-empty', 'Loading…'));
    const foot = h('div.lib-usage.muted.small');
    const head = h('div.lib-head');
    const tools = h('div.lib-tools', h('button.btn.sm', { on: { click: async () => {
      const f = await FM.dom.pickFiles({ accept: '.flowmate,.json' });
      if (f.length && await FM.io.openDocumentFile(f[0])) m.close();
    } } }, icon('folder'), 'Open a shared file…'));
    const body = h('div.col.lib-body', head, tools, listEl, foot);
    const m = modal({
      title: 'My analyses',
      subtitle: 'Your saved analyses, kept in this browser on this computer together with their data. Open one to carry on exactly where you left off.',
      wide: true,
      body,
      buttons: [{ label: 'Close', primary: true }],
      onClose: () => { dlg = null; },
    });
    m.el.classList.add('lib-modal');
    dlg = { el: m.el, refresh, close: m.close };

    async function refresh() {
      clear(head);
      if (!empty()) {
        head.appendChild(current
          ? h('div.lib-now', icon('okCircle'), h('div.grow', h('strong', '“' + current.name + '” is open'), h('div.muted.small', 'It saves itself as you work.')),
            h('button.btn.sm', { on: { click: () => share() } }, icon('upload'), 'Share…'),
            h('button.btn.sm', { on: { click: () => saveAs({ copy: true }).then(r => r && refresh()) } }, icon('copy'), 'Save a copy'))
          : h('div.lib-now.unsaved', icon('save'), h('div.grow', h('strong', 'What is open now is not saved yet'), h('div.muted.small', summary())),
            h('button.btn.primary.sm', { on: { click: () => saveAs().then(r => r && refresh()) } }, icon('save'), 'Save it here')));
      }
      let items;
      try { items = await lib.list(); } catch (e) { clear(listEl); listEl.appendChild(h('div.note.crit', icon('alert'), h('span', e.message))); return; }
      clear(listEl);
      if (!items.length) listEl.appendChild(h('div.lib-empty.muted', 'Nothing saved yet. Load your FCS files, gate them, then press Save (Ctrl+S) — the analysis and its data land here.'));
      items.forEach(it => listEl.appendChild(row(it, refresh, () => m.close())));
      const u = await lib.usage();
      const total = items.reduce((a, it) => a + (it.size || 0), 0);
      foot.textContent = items.length + ' saved · ' + fmtSize(total) + (u && u.quota ? ' · this browser allows about ' + fmtSize(u.quota) + ' for FlowMate' : '');
    }
    refresh();
  }

  function row(it, refresh, closeDlg) {
    const isCur = current && current.id === it.id;
    const more = h('button.btn.ghost.sm.icon', { 'data-tip': 'More', 'aria-label': 'More actions for ' + it.name, on: { click: e => FM.dom.menu(e.currentTarget, [
      { label: 'Share…', icon: 'upload', fn: () => share(it.id) },
      { label: 'Rename…', icon: 'edit', fn: () => rename(it).then(refresh) },
      { label: 'Duplicate', icon: 'copy', fn: () => duplicate(it).then(refresh) },
      'sep',
      { label: 'Delete…', icon: 'trash', danger: true, fn: () => remove(it).then(refresh) },
    ], { align: 'right' }) } }, icon('more'));
    return h('div.lib-row' + (isCur ? '.on' : ''), { 'data-id': it.id },
      h('div.lib-ico', icon('layers')),
      h('div.grow.lib-main',
        h('div.lib-name', it.name, isCur ? h('span.chip.accent', 'open now') : null),
        h('div.muted.small', it.summary || '')),
      h('div.lib-when.muted.small', { title: new Date(it.savedAt).toLocaleString() }, fmtWhen(it.savedAt)),
      h('div.lib-size.muted.small.num', fmtSize(it.size)),
      isCur ? h('span.lib-open-spacer') : h('button.btn.sm.primary', { on: { click: async () => { if (await open(it.id)) closeDlg(); } } }, 'Open', icon('right')),
      more);
  }

  async function rename(it) {
    const name = await ask({ title: 'Rename analysis', label: 'Name', value: it.name, ok: 'Rename' });
    if (name == null || name === it.name) return;
    try {
      await lib.rename(it.id, name);
      if (current && current.id === it.id) {
        current.name = name;
        ws().update('Rename experiment', d => { d.name = name; }, { kind: 'settings' });
      }
      toast('Renamed to “' + name + '”');
    } catch (e) { toast(e.message, { level: 'crit' }); }
  }

  async function duplicate(it) {
    try {
      if (current && current.id === it.id) await flush();
      const m = await lib.duplicate(it.id, it.name + ' (copy)');
      toast('Saved a copy: “' + m.name + '”');
    } catch (e) { toast(e.message, { level: 'crit', ms: 8000 }); }
  }

  async function remove(it) {
    const ok = await FM.dom.confirm('Delete “' + it.name + '”?', 'The analysis and the copy of its data kept in this browser are deleted. Your original FCS files are not touched.', 'Delete', true);
    if (!ok) return;
    try {
      if (current && current.id === it.id) detach();
      await lib.remove(it.id);
      toast('Deleted “' + it.name + '”');
    } catch (e) { toast(e.message, { level: 'crit' }); }
  }

  // ------------------------------------------------------- welcome list
  /** The most recent saved analyses, for the empty Workspace (fills `el` when the list is read). */
  function recentPanel() {
    const el = h('div.lib-recent.hidden');
    if (!lib) return el;
    lib.list().then(items => {
      if (!items.length) return;
      el.classList.remove('hidden');
      el.append(
        h('div.lib-recent-head', h('div.restore-icon', icon('layers')),
          h('div.grow', h('strong', 'My analyses'), h('div.muted.small', 'Pick up where you left off — the data comes back with the analysis.')),
          items.length > 4 ? h('button.btn.ghost.sm', { on: { click: show } }, 'See all ' + items.length) : null),
        ...items.slice(0, 4).map(it => h('button.lib-card', { 'data-id': it.id, on: { click: () => open(it.id) } },
          h('div.grow', h('div.lib-name', it.name), h('div.muted.small', it.summary || '')),
          h('div.muted.small.lib-when', fmtWhen(it.savedAt)), icon('right'))));
    }).catch(() => { /* storage blocked: nothing to show */ });
    return el;
  }

  // ------------------------------------------------------ top-bar status
  /** The save state next to the experiment name: click to save, or to open My analyses. */
  function statusChip() {
    const el = h('button.lib-state', { on: { click: () => (current ? show() : save()) } });
    const render = () => {
      clear(el);
      el.className = 'lib-state' + (state === 'error' ? ' err' : current ? ' saved' : '');
      if (empty() && !current) { el.classList.add('hidden'); return; }
      if (state === 'saving') { el.append(icon('save'), h('span', 'Saving…')); el.dataset.tip = 'Saving to My analyses'; return; }
      if (state === 'error') { el.append(icon('alert'), h('span', 'Not saved')); el.dataset.tip = lastError ? lastError.message : 'The last save failed'; return; }
      if (current) {
        el.append(icon('check'), h('span', 'Saved'));
        el.dataset.tip = 'Kept in My analyses — saves itself as you work' + (current.savedAt ? ' · last saved ' + fmtWhen(current.savedAt) : '');
        return;
      }
      el.append(icon('save'), h('span', 'Save'));
      el.dataset.tip = 'Save this analysis and its data in My analyses (Ctrl+S)';
    };
    listeners.add(render);
    FM.bus.on(k => { if (k === 'ws:samples' || k === 'ws:doc') render(); });
    render();
    return el;
  }

  FM.library = {
    available: !!lib, save, saveAs, open, show, share, importShared, detach, touch, recentPanel, statusChip,
    current: () => current, state: () => state,
    flush,
    onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
  };
})(FM);
