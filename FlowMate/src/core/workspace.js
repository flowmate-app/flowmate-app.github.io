/* Workspace: the serializable analysis document plus the loaded samples.
 *
 * doc (JSON, undoable, saved as templates/workspaces):
 *   { version, name,
 *     params:  { [param]: { scale } },                 axis settings shared by all samples
 *     gates:   [gate],                                  see gating.js
 *     groups:  [{ id, name, color, role }],            role: 'sample' | 'control' | 'gate' | 'comp' (single-stain control) | 'unstained'
 *     wells:   { [key]: { group, excluded, reason } },  key = well id ("A1") or file name
 *     metrics: [{ id, name, expr }],
 *     tables:  [{ id, name, rows, columns: [{ id, … }] }], see tables.js
 *     graphs:  [{ id, src: { table, col }, kind, … }],  the Analysis step, see graphs.js
 *     views:   { [popId|'root']: { x, y } },           last axes used to view a population
 *     settings:{ threshold, primaryMetric },
 *     comp:    { active: 'file'|'none'|matrixId, matrices: [...] }   see comp.js }
 *
 * Samples are runtime only (event data is never serialised).
 */
(function (FM) {
  'use strict';

  const GROUP_COLORS = ['#3f6fd8', '#d9822b', '#1f9e89', '#c2477c', '#7c5cd6', '#6d8a1f', '#c29a14', '#3f8fb0', '#b5533c', '#5c6bc0'];
  const ROLE_COLORS = { control: '#5f6680', gate: '#9aa0b4' };

  let revCounter = 0;
  const nextRev = () => ++revCounter;

  function uid(prefix) { return prefix + Math.random().toString(36).slice(2, 8); }

  function defaultDoc() {
    return {
      version: 1,
      name: 'Untitled experiment',
      params: {},
      gates: [],
      groups: [],
      wells: {},
      metrics: [],
      tables: [],
      graphs: [],
      views: {},
      layout: defaultLayout(),
      settings: { threshold: 2, primaryMetric: null },
      comp: { active: 'file', matrices: [], confirmed: false, setup: { method: 'auto', population: null, controls: {} } },
    };
  }

  // A4 landscape at 96 dpi: the page most of these figures end up printed on.
  const PAGE_PRESETS = {
    'a4-landscape': { w: 1123, h: 794, label: 'A4 landscape' },
    'a4-portrait': { w: 794, h: 1123, label: 'A4 portrait' },
    'letter-landscape': { w: 1056, h: 816, label: 'Letter landscape' },
    'slide': { w: 1280, h: 720, label: 'Slide (16:9)' },
  };
  const PAGE_PAD = 36, ITEM_GAP = 14;

  function defaultLayout() {
    return { page: Object.assign({ preset: 'a4-landscape' }, { w: PAGE_PRESETS['a4-landscape'].w, h: PAGE_PRESETS['a4-landscape'].h }), items: [] };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function Workspace() {
    this.doc = defaultDoc();
    this.samples = [];
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this._gateMap = new Map();
    // a gate scoped to some groups or samples has no population anywhere else (scope.js)
    const applies = (g, s) => FM.scope.ownApplies(g, s.key, k => this._groupOf(k));
    this.engine = new FM.gating.Engine(id => this._gateMap.get(id), { applies });
    // the same gating with every per-well adjustment ignored, for "what would it have read?"
    this.sharedEngine = new FM.gating.Engine(id => this._gateMap.get(id), { perWell: false, cache: '_popsShared', applies });
    this._reindex();
  }

  const P = Workspace.prototype;

  // ------------------------------------------------------------------ events
  P.on = function (fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  P.emit = function (kind, detail) {
    this.listeners.forEach(fn => { try { fn(kind, detail); } catch (e) { console.error(e); } });
  };

  P._reindex = function () {
    this._gateMap = new Map(this.doc.gates.map(g => [g.id, g]));
  };

  // ---------------------------------------------------------------- mutation
  /**
   * Apply a mutation to the doc with one undo step.
   * opts.coalesce: a key — consecutive updates with the same key within 1.5 s share one undo step
   *               (used for vertex drags and slider edits).
   * opts.kind: event kind to emit (default 'doc').
   */
  P.update = function (label, fn, opts) {
    opts = opts || {};
    const now = Date.now();
    const top = this.undoStack[this.undoStack.length - 1];
    const coalesce = opts.coalesce && top && top.coalesce === opts.coalesce && now - top.time < 1500;
    if (!coalesce) {
      this.undoStack.push({ label, doc: JSON.stringify(this.doc), time: now, coalesce: opts.coalesce || null });
      if (this.undoStack.length > 200) this.undoStack.shift();
    } else top.time = now;
    this.redoStack.length = 0;
    const result = fn(this.doc);
    this._reindex();
    this._syncComp();
    this.emit(opts.kind || 'doc', { label });
    return result;
  };

  P.undo = function () {
    const top = this.undoStack.pop();
    if (!top) return null;
    this.redoStack.push({ label: top.label, doc: JSON.stringify(this.doc), time: Date.now() });
    this.doc = JSON.parse(top.doc);
    this._reindex();
    this._syncComp();
    this.emit('doc', { label: 'Undo ' + top.label, undo: true });
    return top.label;
  };

  P.redo = function () {
    const top = this.redoStack.pop();
    if (!top) return null;
    this.undoStack.push({ label: top.label, doc: JSON.stringify(this.doc), time: Date.now() });
    this.doc = JSON.parse(top.doc);
    this._reindex();
    this._syncComp();
    this.emit('doc', { label: 'Redo ' + top.label, redo: true });
    return top.label;
  };

  P.canUndo = function () { return this.undoStack.length > 0; };
  P.canRedo = function () { return this.redoStack.length > 0; };
  P.undoLabel = function () { const t = this.undoStack[this.undoStack.length - 1]; return t ? t.label : ''; };
  P.redoLabel = function () { const t = this.redoStack[this.redoStack.length - 1]; return t ? t.label : ''; };

  // ----------------------------------------------------------------- samples
  P.addSamples = function (parsed) {
    const added = [];
    const taken = new Set(this.samples.map(s => s.key));
    parsed.forEach(s => {
      s.well = FM.wells.detect(s);
      // a sample reopened from My analyses keeps the key its gates and groups refer to
      let key = s.restoreKey && !taken.has(s.restoreKey) ? s.restoreKey : s.well || s.name;
      if (taken.has(key)) {
        // two files for the same well (or same name): fall back to the file name, then suffix it
        key = s.name;
        let k = 2;
        while (taken.has(key)) key = s.name + ' (' + (k++) + ')';
        if (s.well && !taken.has(s.name)) s.wellConflict = true;
      }
      s.key = key;
      taken.add(key);
      FM.comp.applyTo(this, s);
      this.samples.push(s);
      added.push(s);
    });
    this.samples.sort(FM.wells.compare);
    this._ensureParamScales();
    // wells without an entry get one; existing entries (e.g. from a template) are kept
    this.samples.forEach(s => { if (!this.doc.wells[s.key]) this.doc.wells[s.key] = { group: null, excluded: false, reason: '' }; });
    this._assignOrder();
    this.emit('samples', { added });
    return added;
  };

  /** Acquisition order (1-based) from $BTIM/$DATE, for drift checks and plate overlays. */
  P._assignOrder = function () {
    const timed = this.samples.filter(s => s.acqTime != null).slice().sort((a, b) => a.acqTime - b.acqTime);
    this.samples.forEach(s => { s.acqOrder = null; s.acqMinutes = null; });
    if (!timed.length) return;
    const t0 = timed[0].acqTime;
    timed.forEach((s, i) => { s.acqOrder = i + 1; s.acqMinutes = (s.acqTime - t0) / 60000; });
  };

  P.removeSamples = function (keys) {
    const ks = new Set(keys);
    this.samples = this.samples.filter(s => !ks.has(s.key));
    this._assignOrder();
    this.emit('samples', { removed: keys });
  };

  P.clearSamples = function () { this.samples = []; this.emit('samples', { cleared: true }); };

  P.sample = function (key) { return this.samples.find(s => s.key === key) || null; };

  /** Union of parameter names across samples, in first-seen order. */
  P.paramNames = function () {
    const seen = new Set(), out = [];
    this.samples.forEach(s => s.params.forEach(p => { if (!seen.has(p.name)) { seen.add(p.name); out.push(p.name); } }));
    return out;
  };

  P.paramInfo = function (name) {
    for (const s of this.samples) { const p = s.params.find(q => q.name === name); if (p) return p; }
    return { name, label: '', range: 0 };
  };

  /** "FL1-H · 355/405-30" style label using $PnS when it adds information. */
  P.paramLabel = function (name) {
    const p = this.paramInfo(name);
    const lab = (p.label || '').replace(/__/g, '/').replace(/[-_ ]?[HAW]$/, '');
    return lab && lab !== name && !name.includes(lab) ? name + ' · ' + lab : name;
  };

  P._ensureParamScales = function () {
    this.paramNames().forEach(name => {
      if (this.doc.params[name] && this.doc.params[name].scale) return;
      const info = this.paramInfo(name);
      // pool a subsample across all samples so every well shares the same axis
      const pooled = [];
      this.samples.forEach(s => {
        const c = s.data[name]; if (!c) return;
        const step = Math.max(1, Math.floor(c.length / 4000));
        for (let i = 0; i < c.length; i += step) pooled.push(c[i]);
      });
      this.doc.params[name] = { scale: FM.transforms.defaultScale(info, pooled) };
    });
  };

  P.scaleSpec = function (name) {
    const p = this.doc.params[name];
    return p && p.scale ? p.scale : { type: 'lin', min: 0, max: 1 };
  };

  /**
   * The scale a plot of population `popId` uses for `param`: the parameter's global transform
   * type, framed on that population. Framing is computed the first time the view is shown and
   * then kept (so axes don't jump while a parent gate is edited) until refitted.
   */
  P.viewScale = function (popId, param) {
    const g = this.scaleSpec(param);
    if (!this.samples.length) return g;
    const key = popId || 'root';
    const v = this.doc.views[key] || (this.doc.views[key] = {});
    v.ranges = v.ranges || {};
    const o = v.ranges[param];
    if (o && o.type === g.type) return o;
    const fit = FM.autofit.fitScale(this, popId, param) || g;
    v.ranges[param] = fit;
    return fit;
  };

  /** Re-frame a view's axes on its population (all its ranges, or just `params`). */
  P.refitView = function (popId, params) {
    const key = popId || 'root';
    const v = this.doc.views[key] || (this.doc.views[key] = {});
    v.ranges = v.ranges || {};
    (params || Object.keys(v.ranges).concat([v.x, v.y].filter(Boolean))).forEach(p => {
      const fit = FM.autofit.fitScale(this, popId, p);
      if (fit) v.ranges[p] = fit; else delete v.ranges[p];
    });
    this.emit('view', { popId, refit: true });
  };

  /** Set one plot's range for a parameter (the transform type stays global). */
  P.setViewRange = function (popId, param, spec) {
    const key = popId || 'root';
    const v = this.doc.views[key] || (this.doc.views[key] = {});
    v.ranges = Object.assign({}, v.ranges, { [param]: spec });
    this.emit('view', { popId });
  };

  /** Change a parameter's transform type everywhere; every plot re-frames in the new type. */
  P.setParamType = function (name, spec) {
    this.update('Change ' + name + ' axis', d => {
      d.params[name] = Object.assign({}, d.params[name], { scale: spec });
      Object.values(d.views).forEach(v => { if (v && v.ranges) delete v.ranges[name]; });
    }, { kind: 'axes' });
  };

  P.setScale = function (name, spec, coalesce) {
    this.update('Change ' + name + ' axis', d => { d.params[name] = Object.assign({}, d.params[name], { scale: spec }); },
      { kind: 'axes', coalesce: coalesce ? 'axis:' + name : null });
  };

  // ----------------------------------------------------------- compensation
  /** Re-read every sample through the active matrix when the compensation part of the doc changed. */
  P._syncComp = function () {
    if (!this.doc.comp) this.doc.comp = FM.comp.defaultComp();
    const sig = JSON.stringify(this.doc.comp);
    if (sig === this._compSig) return;
    this._compSig = sig;
    if (FM.comp.applyAll(this)) {
      this._ensureParamScales();          // a spectral matrix brings new dye channels
      this.emit('comp', {});
    }
  };

  // ------------------------------------------------------------- the Unmix step
  /** The comp document with every field the Unmix step uses (old documents lack some). */
  function compOf(d) {
    d.comp = d.comp || FM.comp.defaultComp();
    d.comp.matrices = d.comp.matrices || [];
    d.comp.setup = Object.assign({ method: 'auto', population: null, controls: {} }, d.comp.setup || {});
    d.comp.setup.controls = d.comp.setup.controls || {};
    return d.comp;
  }

  /** How the data is unmixed: 'file' (instrument's matrix), 'none' (as recorded) or a matrix id — a confirmed choice. */
  P.confirmComp = function (active) {
    const label = active === 'none' ? 'No unmixing' : active === 'file' ? 'Use the instrument’s matrix' : 'Unmix from controls';
    this.update(label, d => { const c = compOf(d); c.active = active; c.confirmed = true; }, { kind: 'comp' });
  };

  /** Method ('auto' | 'compensation' | 'spectral') or population for computing from controls. */
  P.setUnmixSetup = function (patch) {
    this.update('Change unmixing setup', d => { Object.assign(compOf(d).setup, clone(patch)); }, { kind: 'comp' });
  };

  /** A control's positive cut-off or peak detector. */
  P.setControlSetup = function (groupId, patch) {
    this.update('Adjust control', d => {
      const c = compOf(d);
      c.setup.controls[groupId] = Object.assign({}, c.setup.controls[groupId] || {}, clone(patch));
    }, { kind: 'comp', coalesce: 'ctrl:' + groupId + ':' + Object.keys(patch).join(',') });
  };

  /** Spectral when the files have at least twice as many detectors as there are dyes, else compensation. */
  P.unmixMethod = function (nDyes) {
    const m = (compOf(this.doc).setup || {}).method;
    if (m === 'spectral' || m === 'compensation') return m;
    return FM.unmix.detectors(this).length >= 2 * Math.max(1, nDyes) ? 'spectral' : 'compensation';
  };

  const MATRIX_COLORS = ['#4c3fb3', '#1f9e89', '#d9822b', '#c2477c', '#3f6fd8', '#6d8a1f', '#b5533c', '#7c5cd6'];
  function nextColor(c) { const used = new Set(c.matrices.map(m => m.color)); return MATRIX_COLORS.find(x => !used.has(x)) || MATRIX_COLORS[c.matrices.length % MATRIX_COLORS.length]; }

  /**
   * Compute a matrix from the controls in use and apply it (FlowJo's Create Matrix). opts.name names it
   * (default "Compensation"); a matrix of that name made from controls is updated in place, keeping its
   * corrections while the dyes stay the same. → { sig, id } or throws with a reason.
   */
  P.computeUnmix = function (opts) {
    opts = opts || {};
    const c = compOf(this.doc);
    const all = FM.unmix.signatures(this, { population: c.setup.population, setup: c.setup.controls, universal: c.setup.universal !== false });
    const sig = Object.assign({}, all, { dyes: all.used });
    if (!sig.dyes.length) throw new Error(all.dyes.length ? 'Tick at least one control to use.' : 'Mark at least one single-stain control first.');
    const method = this.unmixMethod(sig.dyes.length);
    const labels = sig.dyes.map(x => x.label);
    let mat;
    if (method === 'spectral') {
      mat = { kind: 'spectral', params: sig.detectors.slice(), dyes: sig.dyes.map(x => ({ label: x.label, peak: x.peak, signature: x.signature.slice() })) };
    } else {
      const peaks = sig.dyes.map(x => x.peak);
      if (new Set(peaks).size !== peaks.length) throw new Error('Two controls peak on the same detector — use spectral unmixing, or set each control’s detector.');
      const at = peaks.map(pk => sig.detectors.indexOf(pk));
      const spill = sig.dyes.map((x, i) => at.map(t => x.signature[t] / (x.signature[at[i]] || 1)));
      mat = { kind: 'spillover', params: peaks, spill, dyes: sig.dyes.map(x => ({ label: x.label, peak: x.peak, signature: x.signature.slice() })) };
    }
    const name = String(opts.name || '').trim() || (c.matrices.find(m => m.id === c.active && m.source === 'computed') || {}).name || 'Compensation';
    const old = c.matrices.find(m => m.source === 'computed' && m.name === name);
    const sameDyes = old && old.kind === mat.kind && JSON.stringify((old.dyes || []).map(x => x.label)) === JSON.stringify(labels);
    mat.adjust = sameDyes && old.adjust ? old.adjust : labels.map(() => labels.map(() => 0));
    const id = old ? old.id : uid('cm');
    const color = old && old.color ? old.color : nextColor(c);
    this.update((old ? 'Update matrix ' : 'Create matrix ') + name, d => {
      const cc = compOf(d);
      const m = Object.assign({ id, name, color, source: 'computed' }, clone(mat));
      const i = cc.matrices.findIndex(x => x.id === id);
      if (i >= 0) cc.matrices[i] = m; else cc.matrices.push(m);
      cc.active = id;
    }, { kind: 'comp' });
    return { sig, id };
  };

  /**
   * A correction: the share of dye i still showing in dye j's channel. On the instrument's own matrix,
   * the first correction makes an editable copy of it. → the id of the matrix corrected.
   */
  P.setUnmixAdjust = function (id, i, j, value) {
    if (!Number.isFinite(value) || i === j) return id;
    if (id === 'file') {
      const s = this.samples.find(x => x.spill);
      if (!s) return id;
      const k = s.spill.params.length;
      id = uid('cm');
      const mat = { id, name: 'Instrument matrix, corrected', kind: 'spillover', params: s.spill.params.slice(), spill: s.spill.matrix.map(r => r.slice()),
        adjust: Array.from({ length: k }, () => new Array(k).fill(0)), source: 'edited' };
      this.update('Correct the instrument’s matrix', d => { const c = compOf(d); c.matrices.push(mat); c.active = id; }, { kind: 'comp' });
    }
    this.update('Correct unmixing', d => {
      const m = compOf(d).matrices.find(x => x.id === id);
      if (!m) return;
      const k = m.kind === 'spectral' ? m.dyes.length : m.params.length;
      if (!m.adjust) m.adjust = Array.from({ length: k }, () => new Array(k).fill(0));
      if (m.adjust[i]) m.adjust[i][j] = value;
    }, { kind: 'comp', coalesce: 'adj:' + id + ':' + i + ':' + j });
    return id;
  };

  /** FlowJo's Edit: an editable copy of a matrix ('file' copies the acquisition matrix). → the copy's id. */
  P.duplicateMatrix = function (id) {
    const c = compOf(this.doc);
    let src;
    if (id === 'file') {
      const s = this.samples.find(x => x.spill);
      if (!s) return null;
      src = { name: 'Acquisition-defined', kind: 'spillover', params: s.spill.params, spill: s.spill.matrix };
    } else src = c.matrices.find(m => m.id === id);
    if (!src) return null;
    const names = new Set(c.matrices.map(m => m.name));
    let name = src.name + ' (copy)', n = 2;
    while (names.has(name)) name = src.name + ' (copy ' + (n++) + ')';
    const copy = Object.assign(clone(src), { id: uid('cm'), name, source: 'edited', color: nextColor(c) });
    this.update('Edit a copy of ' + src.name, d => { compOf(d).matrices.push(copy); }, { kind: 'comp' });
    return copy.id;
  };

  /** Add a matrix read from a file ({ name, params, spill }) and apply it. → its id. */
  P.importMatrix = function (m) {
    const c = compOf(this.doc);
    const id = uid('cm');
    const mat = { id, name: m.name || 'Imported matrix', kind: 'spillover', params: m.params.slice(), spill: m.spill.map(r => r.slice()), source: 'imported', color: nextColor(c) };
    this.update('Import matrix ' + mat.name, d => { const cc = compOf(d); cc.matrices.push(mat); cc.active = id; cc.confirmed = true; }, { kind: 'comp' });
    return id;
  };

  /**
   * Straighten dye i's population in dye j's channel by δ, the FlowJo way: by changing the spillover
   * itself — S' = (I + δ·eᵢeⱼᵀ)·S, i.e. row i gains δ × row j (exact, not a small-step guess).
   */
  P.nudgeSpill = function (id, i, j, delta) {
    if (!Number.isFinite(delta) || i === j) return;
    this.update('Edit spillover', d => {
      const m = compOf(d).matrices.find(x => x.id === id);
      if (!m || !m.spill || !m.spill[i]) return;
      const rowJ = m.spill[j].slice();
      m.spill[i] = m.spill[i].map((v, t) => v + delta * rowJ[t]);
      m.edited = true;
    }, { kind: 'comp', coalesce: 'nudge:' + id + ':' + i + ':' + j });
  };

  P.resetUnmixAdjust = function (id) {
    this.update('Reset corrections', d => {
      const m = compOf(d).matrices.find(x => x.id === id);
      if (m && m.adjust) m.adjust = m.adjust.map(r => r.map(() => 0));
    }, { kind: 'comp' });
  };

  /** 'file' (each file's own matrix), 'none', or a matrix id. One undo step. */
  P.setComp = function (active) {
    const m = active !== 'file' && active !== 'none' ? FM.comp.matrixById(this, active) : null;
    const label = active === 'none' ? 'Turn compensation off' : active === 'file' ? 'Compensate with each file’s matrix' : 'Compensate with ' + (m ? m.name : 'a matrix');
    this.update(label, d => { d.comp = d.comp || FM.comp.defaultComp(); d.comp.active = active; }, { kind: 'comp' });
  };

  /** Store a matrix {name, params, spill, source}; returns its id. opts.activate applies it too. */
  P.saveMatrix = function (m, opts) {
    const id = m.id || uid('cm');
    const names = new Set(((this.doc.comp || {}).matrices || []).map(x => x.name.toLowerCase()));
    let name = m.name || 'Matrix', k = 2;
    while (names.has(name.toLowerCase())) name = (m.name || 'Matrix') + ' ' + (k++);
    const mat = { id, name, kind: 'spillover', params: m.params.slice(), spill: m.spill.map(r => r.slice()), source: m.source || 'edited', color: nextColor(compOf(this.doc)) };
    this.update((opts && opts.activate ? 'Compensate with ' : 'Save matrix ') + name, d => {
      d.comp = d.comp || FM.comp.defaultComp();
      d.comp.matrices.push(mat);
      if (opts && opts.activate) d.comp.active = id;
    }, { kind: 'comp' });
    return id;
  };

  P.updateMatrixCell = function (id, i, j, value) {
    if (!Number.isFinite(value)) return;
    this.update('Edit spillover', d => {
      const m = (d.comp.matrices || []).find(x => x.id === id);
      if (!m || !m.spill[i] || i === j) return;
      m.spill[i][j] = value;
      m.edited = true;
    }, { kind: 'comp', coalesce: 'mcell:' + id + ':' + i + ':' + j });
  };

  P.renameMatrix = function (id, name) {
    name = String(name || '').trim();
    if (!name) return;
    this.update('Rename matrix', d => { const m = (d.comp.matrices || []).find(x => x.id === id); if (m) m.name = name; }, { kind: 'comp' });
  };

  P.deleteMatrix = function (id) {
    const m = FM.comp.matrixById(this, id);
    this.update('Delete matrix ' + (m ? m.name : ''), d => {
      d.comp.matrices = (d.comp.matrices || []).filter(x => x.id !== id);
      if (d.comp.active === id) d.comp.active = 'file';
    }, { kind: 'comp' });
  };

  // ------------------------------------------------------------------- gates
  P.gate = function (id) { return this._gateMap.get(id) || null; };
  /** Gates directly under parentId; with a sample key, only those that apply to it. */
  P.children = function (parentId, sampleKey) {
    const kids = this.doc.gates.filter(g => (g.parent || null) === (parentId || null));
    return sampleKey == null ? kids : kids.filter(g => this.applies(g, sampleKey));
  };
  P.descendants = function (id) {
    const out = [];
    const walk = pid => this.children(pid).forEach(c => { out.push(c); walk(c.id); });
    walk(id);
    return out;
  };
  P.gatePath = function (id) {
    const path = [];
    let g = this.gate(id);
    while (g) { path.unshift(g); g = g.parent ? this.gate(g.parent) : null; }
    return path;
  };
  P.popName = function (id) { return id ? (this.gate(id) || {}).name || '?' : 'All events'; };
  P.popIdByName = function (name) {
    const n = String(name).trim().toLowerCase();
    const g = this.doc.gates.find(x => x.name.trim().toLowerCase() === n);
    return g ? g.id : undefined;
  };

  P.uniqueGateName = function (base) {
    const names = new Set(this.doc.gates.map(g => g.name.toLowerCase()));
    if (!names.has(base.toLowerCase())) return base;
    let i = 2;
    while (names.has((base + ' ' + i).toLowerCase())) i++;
    return base + ' ' + i;
  };

  P.addGate = function (gate) {
    const g = Object.assign({ id: uid('g'), color: null }, gate);
    g.name = this.uniqueGateName(g.name || 'Gate');
    g.rev = nextRev();
    // a gating strategy on the Layout page grows with the hierarchy, in this same undo step
    this.update('Add gate ' + g.name, d => { d.gates.push(g); if (FM.strategy) FM.strategy.extend(d, [g.id]); }, { kind: 'gates' });
    return g.id;
  };

  /** Patch a gate. Geometry changes bump its revision so cached populations recompute. */
  P.updateGate = function (id, patch, opts) {
    opts = opts || {};
    const geometric = ['verts', 'rect', 'range', 'ellipse', 'quad', 'outside', 'bool', 'x', 'y', 'xScale', 'yScale', 'type', 'parent'].some(k => k in patch);
    this.update(opts.label || 'Edit gate', d => {
      const g = d.gates.find(x => x.id === id);
      if (!g) return;
      const oldName = g.name;
      Object.assign(g, clone(patch));
      if (geometric) g.rev = nextRev();
      if (patch.name && patch.name !== oldName) {
        d.metrics.forEach(m => { m.expr = FM.expr.renamePopulation(m.expr, oldName, patch.name); });
      }
    }, { kind: 'gates', coalesce: opts.coalesce });
  };

  P.renameGate = function (id, name) {
    name = String(name || '').trim();
    const g = this.gate(id);
    if (!g || !name || name === g.name) return false;
    const clash = this.doc.gates.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase());
    if (clash) return false;
    this.updateGate(id, { name }, { label: 'Rename gate to ' + name });
    return true;
  };

  /** Short parameter label for quadrant names: "FL1-H" → "FL1". */
  function shortParam(p) { return String(p).replace(/[-_ ]?[AHW]$/, ''); }

  /**
   * Add a quadrant: four linked gates that partition `parent` at (cx, cy), in one undo step.
   * Returns the ids in UL, UR, LL, LR order.
   */
  P.addQuadrant = function (o) {
    const link = uid('q');
    const X = shortParam(o.x), Y = shortParam(o.y);
    const names = { UL: X + '− ' + Y + '+', UR: X + '+ ' + Y + '+', LL: X + '− ' + Y + '−', LR: X + '+ ' + Y + '−' };
    const ids = [];
    this.update('Add quadrant ' + X + ' × ' + Y, d => {
      const taken = new Set(d.gates.map(g => g.name.toLowerCase()));
      ['UL', 'UR', 'LL', 'LR'].forEach(corner => {
        let name = names[corner], k = 2;
        while (taken.has(name.toLowerCase())) name = names[corner] + ' ' + (k++);
        taken.add(name.toLowerCase());
        const g = { id: uid('g'), name, parent: o.parent || null, type: 'quad', x: o.x, y: o.y,
          xScale: clone(o.xScale), yScale: clone(o.yScale), quad: { cx: o.cx, cy: o.cy }, corner, link, color: null, rev: nextRev() };
        if (o.scope) g.scope = clone(o.scope);
        d.gates.push(g);
        ids.push(g.id);
      });
      if (FM.strategy) FM.strategy.extend(d, ids);
    }, { kind: 'gates' });
    return ids;
  };

  /** Move a quadrant's crosshair: all four linked gates change together. */
  P.updateQuad = function (link, quad, opts) {
    opts = opts || {};
    this.update(opts.label || 'Move quadrant', d => {
      d.gates.forEach(g => { if (g.link === link) { g.quad = { cx: quad.cx, cy: quad.cy }; g.rev = nextRev(); } });
    }, { kind: 'gates', coalesce: opts.coalesce });
  };

  /**
   * A Boolean gate made of terms: { op: 'and'|'or', terms: [{ id, not }], name? } → id.
   * It sits under the deepest population holding every term; a single term is a NOT gate.
   */
  P.addBoolGate = function (o) {
    const terms = (o.terms || []).filter(t => t && this.gate(t.id)).map(t => ({ id: t.id, not: !!t.not }));
    if (!terms.length) throw new Error('A Boolean gate needs at least one population');
    const op = terms.length === 1 ? 'and' : (o.op === 'or' ? 'or' : 'and');
    const auto = terms.map(t => (t.not ? 'not ' : '') + this.gate(t.id).name).join(op === 'or' ? ' or ' : ' and ');
    const g = { id: uid('g'), name: this.uniqueGateName(o.name || auto), parent: FM.gating.lca(i => this._gateMap.get(i), terms.map(t => t.id)),
      type: 'bool', x: null, y: null, xScale: null, yScale: null, bool: { op, terms }, color: null, rev: nextRev() };
    this.update('Add Boolean gate ' + g.name, d => { d.gates.push(g); }, { kind: 'gates' });
    return g.id;
  };

  /** Boolean gates that combine this gate or anything inside it. */
  P.boolDependents = function (id) {
    const inside = new Set([id].concat(this.descendants(id).map(g => g.id)));
    return this.doc.gates.filter(g => g.type === 'bool' && g.bool && g.bool.terms.some(t => inside.has(t.id)) && !inside.has(g.id));
  };

  P.deleteGate = function (id) {
    const g = this.gate(id);
    if (!g) return;
    // a quadrant is one unit: deleting any of its four gates removes the set
    const roots = g.link ? this.doc.gates.filter(x => x.link === g.link).map(x => x.id) : [id];
    const doomed = new Set();
    roots.forEach(r => { doomed.add(r); this.descendants(r).forEach(x => doomed.add(x.id)); });
    // a Boolean gate built on anything doomed goes too (with what is inside it), until nothing changes
    for (let changed = true; changed;) {
      changed = false;
      this.doc.gates.forEach(x => {
        if (doomed.has(x.id) || x.type !== 'bool' || !x.bool || !x.bool.terms.some(t => doomed.has(t.id))) return;
        doomed.add(x.id); this.descendants(x.id).forEach(y => doomed.add(y.id)); changed = true;
      });
    }
    this.update('Delete ' + (g.link ? 'quadrant' : 'gate ' + g.name), d => {
      d.gates = d.gates.filter(x => !doomed.has(x.id));
      doomed.forEach(k => { delete d.views[k]; });
      // strategy plots are derived from gates: they leave with them
      if (FM.strategy) FM.strategy.prune(d);
    }, { kind: 'gates' });
  };

  // -------------------------------------------------------- per-well gates
  /* A gate applies to every well; one well may carry its own copy of its geometry.
   * These never touch the shared shape, and the shared edits above never touch these. */

  /** Every gate id a per-well change must be written to: a quadrant moves as one crosshair. */
  P._overrideTargets = function (gate) {
    return gate.link ? this.doc.gates.filter(x => x.link === gate.link).map(x => x.id) : [gate.id];
  };

  P.gateFor = function (gateOrId, wellKey) {
    const g = typeof gateOrId === 'string' ? this.gate(gateOrId) : gateOrId;
    return FM.gating.gateFor(g, wellKey);
  };

  P.isAdjusted = function (gateId, wellKey) { return !!FM.gating.overrideOf(this.gate(gateId), wellKey); };

  /** Wells with their own copy of this gate, in plate order. */
  P.adjustedWells = function (gateId) {
    const g = this.gate(gateId);
    if (!g || !g.perWell) return [];
    return this.samples.map(s => s.key).filter(k => FM.gating.overrideOf(g, k));
  };

  /** Gates this well has its own copy of, in the document's order. */
  P.adjustedGates = function (wellKey) {
    return this.doc.gates.filter(g => FM.gating.overrideOf(g, wellKey));
  };

  P.anyAdjusted = function () { return this.doc.gates.some(g => g.perWell && Object.keys(g.perWell).length); };

  /** Give one well its own geometry for a gate. `geometry` is {verts}|{rect}|{range}|{quad}. */
  P.setGateOverride = function (gateId, wellKey, geometry, opts) {
    opts = opts || {};
    const g = this.gate(gateId);
    if (!g || wellKey == null) return;
    const ids = new Set(this._overrideTargets(g));
    const field = FM.gating.GEOM[g.type];
    if (geometry[field] === undefined) return;
    this.update(opts.label || ('Adjust ' + g.name + ' for ' + wellKey), d => {
      d.gates.forEach(x => {
        if (!ids.has(x.id)) return;
        x.perWell = Object.assign({}, x.perWell);
        x.perWell[wellKey] = { [field]: clone(geometry[field]), rev: nextRev() };
      });
    }, { kind: 'gates', coalesce: opts.coalesce });
  };

  /** Put wells back on the shared gate. `gateId` null → every gate. */
  P.clearGateOverride = function (gateId, wellKeys) {
    const keys = Array.isArray(wellKeys) ? wellKeys : [wellKeys];
    const g = gateId ? this.gate(gateId) : null;
    if (gateId && !g) return;
    const ids = g ? new Set(this._overrideTargets(g)) : null;
    const label = g ? 'Reset ' + g.name + ' on ' + keys.length + ' well' + (keys.length > 1 ? 's' : '')
      : 'Reset ' + keys.length + ' well' + (keys.length > 1 ? 's' : '') + ' to the shared gates';
    this.update(label, d => {
      d.gates.forEach(x => {
        if (ids && !ids.has(x.id)) return;
        if (!x.perWell) return;
        x.perWell = Object.assign({}, x.perWell);
        keys.forEach(k => { delete x.perWell[k]; });
        if (!Object.keys(x.perWell).length) delete x.perWell;
      });
    }, { kind: 'gates' });
  };

  /** One well's version becomes the shared gate; every other well's copy is dropped. */
  P.promoteOverride = function (gateId, wellKey) {
    const g = this.gate(gateId);
    const o = FM.gating.overrideOf(g, wellKey);
    if (!g || !o) return;
    const ids = new Set(this._overrideTargets(g));
    const field = FM.gating.GEOM[g.type];
    this.update('Use ' + wellKey + '’s ' + g.name + ' for every well', d => {
      d.gates.forEach(x => {
        if (!ids.has(x.id)) return;
        const mine = x.perWell && x.perWell[wellKey];
        if (mine && mine[field] !== undefined) x[field] = clone(mine[field]);
        delete x.perWell;
        x.rev = nextRev();
      });
    }, { kind: 'gates' });
  };

  /** Copy one well's version of a gate onto other wells. */
  P.copyOverride = function (gateId, fromKey, toKeys) {
    const g = this.gate(gateId);
    if (!g) return;
    const ids = new Set(this._overrideTargets(g));
    const keys = toKeys.filter(k => k !== fromKey);
    if (!keys.length) return;
    this.update('Use ' + fromKey + '’s ' + g.name + ' on ' + keys.length + ' well' + (keys.length > 1 ? 's' : ''), d => {
      d.gates.forEach(x => {
        if (!ids.has(x.id)) return;
        // every corner of a quadrant keeps its own corner and shares only the crosshair
        const field = FM.gating.GEOM[x.type];
        const geom = clone(this.gateFor(x, fromKey)[field]);
        x.perWell = Object.assign({}, x.perWell);
        keys.forEach(k => { x.perWell[k] = { [field]: clone(geom), rev: nextRev() }; });
      });
    }, { kind: 'gates' });
  };

  /** Copy every gate this well has adjusted onto other wells, in one undo step. */
  P.copyAllOverrides = function (fromKey, toKeys) {
    const mine = this.adjustedGates(fromKey);
    const keys = toKeys.filter(k => k !== fromKey);
    if (!mine.length || !keys.length) return 0;
    const ids = new Set();
    mine.forEach(g => this._overrideTargets(g).forEach(i => ids.add(i)));
    this.update('Use ' + fromKey + '’s gating on ' + keys.length + ' well' + (keys.length > 1 ? 's' : ''), d => {
      d.gates.forEach(x => {
        if (!ids.has(x.id)) return;
        const field = FM.gating.GEOM[x.type];
        const geom = clone(this.gateFor(x, fromKey)[field]);
        x.perWell = Object.assign({}, x.perWell);
        keys.forEach(k => { x.perWell[k] = { [field]: clone(geom), rev: nextRev() }; });
      });
    }, { kind: 'gates' });
    return ids.size;
  };

  P.duplicateGate = function (id) {
    const g = this.gate(id);
    if (!g) return null;
    if (g.type === 'quad') return this.addQuadrant({ parent: g.parent, x: g.x, y: g.y, xScale: g.xScale, yScale: g.yScale, cx: g.quad.cx, cy: g.quad.cy })[1];
    const copy = clone(g);
    delete copy.id;
    copy.name = this.uniqueGateName(g.name + ' copy');
    return this.addGate(copy);
  };

  // ------------------------------------------------------------------ scope
  P._groupOf = function (key) { const w = this.doc.wells[key]; return w && w.group ? w.group : null; };

  /** Does the gate (and every ancestor) apply to this sample? See scope.js. */
  P.applies = function (gateOrId, sampleKey) {
    const g = typeof gateOrId === 'string' ? this.gate(gateOrId) : gateOrId;
    if (!g) return false;
    return FM.scope.applies(g, sampleKey, id => this._gateMap.get(id), k => this._groupOf(k));
  };

  P.scopeText = function (gateOrId) {
    const g = typeof gateOrId === 'string' ? this.gate(gateOrId) : gateOrId;
    return FM.scope.describe(g, id => (this.group(id) || {}).name);
  };

  /** Set which samples a gate applies to (null = every sample). One undo step; a quadrant moves as one. */
  P.setGateScope = function (id, scope, opts) {
    const g = this.gate(id);
    if (!g) return;
    const sc = FM.scope.normalize(scope);
    const label = (opts && opts.label) || (sc ? 'Apply ' + g.name + ' to ' + FM.scope.describe({ scope: sc }, gid => (this.group(gid) || {}).name)
      : 'Apply ' + g.name + ' to every sample');
    const ids = g.link ? this.doc.gates.filter(x => x.link === g.link).map(x => x.id) : [id];
    this.update(label, d => {
      d.gates.forEach(x => { if (ids.indexOf(x.id) < 0) return; if (sc) x.scope = clone(sc); else delete x.scope; });
    }, { kind: 'gates' });
  };

  /** Add a group to a gate's scope (a gate on every sample becomes that group's alone). */
  P.addGateScopeGroup = function (id, groupId) {
    const g = this.gate(id);
    if (!g || !groupId) return;
    const cur = FM.scope.isScoped(g) ? g.scope : { groups: [] };
    this.setGateScope(id, { groups: (cur.groups || []).concat([groupId]), samples: cur.samples || [] });
  };

  // ------------------------------------------------------------- populations
  /* A population that does not exist on a sample (its gate is scoped elsewhere) reads NaN. */
  P._na = function (sample, popId) { return !!popId && !this.applies(popId, sample.key); };
  P.indices = function (sample, popId) { return this.engine.indices(sample, popId || null); };
  P.count = function (sample, popId) { return this._na(sample, popId) ? NaN : this.engine.count(sample, popId || null); };
  P.pct = function (sample, popId) { return this._na(sample, popId) ? NaN : this.engine.pctParent(sample, popId || null); };
  P.pctOf = function (sample, popId, ancestor) {
    return this._na(sample, popId) || this._na(sample, ancestor) ? NaN : this.engine.pctOf(sample, popId || null, ancestor || null);
  };
  /* The same three numbers as if no well had ever been adjusted — the baseline the summary
   * table measures a hand adjustment against. */
  P.countShared = function (sample, popId) { return this._na(sample, popId) ? NaN : this.sharedEngine.count(sample, popId || null); };
  P.pctShared = function (sample, popId) { return this._na(sample, popId) ? NaN : this.sharedEngine.pctParent(sample, popId || null); };
  P.pctOfShared = function (sample, popId, ancestor) {
    return this._na(sample, popId) || this._na(sample, ancestor) ? NaN : this.sharedEngine.pctOf(sample, popId || null, ancestor || null);
  };

  P.stat = function (sample, popId, param, which) {
    if (this._na(sample, popId)) return NaN;
    const idx = this.indices(sample, popId);
    const stamp = this.engine.stamp(sample, popId || null);
    if (sample._stats && sample._stats.size > 4000) sample._stats.clear();
    const st = FM.stats.popStats(sample, stamp, idx, param);
    return st[which];
  };

  // ------------------------------------------------------------ groups/wells
  P.group = function (id) { return this.doc.groups.find(g => g.id === id) || null; };
  P.groupOf = function (key) { const w = this.doc.wells[key]; return w && w.group ? this.group(w.group) : null; };
  P.wellInfo = function (key) { return this.doc.wells[key] || { group: null, excluded: false, reason: '' }; };

  P.addGroup = function (name, role) {
    const used = new Set(this.doc.groups.map(g => g.color));
    const color = role === 'control' ? ROLE_COLORS.control : role === 'gate' ? ROLE_COLORS.gate
      : (GROUP_COLORS.find(c => !used.has(c)) || GROUP_COLORS[this.doc.groups.length % GROUP_COLORS.length]);
    const g = { id: uid('grp'), name: name || ('Group ' + (this.doc.groups.length + 1)), color, role: role || 'sample' };
    this.update('Add group ' + g.name, d => {
      if (g.role === 'control') d.groups.forEach(x => { if (x.role === 'control') x.role = 'sample'; });
      d.groups.push(g);
    }, { kind: 'groups' });
    return g.id;
  };

  /** A new condition holding these wells (moved from any other), as one undo step. → its id */
  P.createGroupFrom = function (keys, name) {
    const used = new Set(this.doc.groups.map(g => g.color));
    const g = { id: uid('grp'), name: name || ('Condition ' + (this.doc.groups.length + 1)), role: 'sample',
      color: GROUP_COLORS.find(c => !used.has(c)) || GROUP_COLORS[this.doc.groups.length % GROUP_COLORS.length] };
    this.update('Create condition ' + g.name, d => {
      d.groups.push(g);
      keys.forEach(k => { d.wells[k] = Object.assign({ excluded: false, reason: '' }, d.wells[k], { group: g.id }); });
    }, { kind: 'groups' });
    return g.id;
  };

  P.updateGroup = function (id, patch) {
    this.update('Edit group', d => {
      const g = d.groups.find(x => x.id === id);
      if (!g) return;
      if (patch.role === 'control') d.groups.forEach(x => { if (x.id !== id && x.role === 'control') x.role = 'sample'; });
      Object.assign(g, patch);
    }, { kind: 'groups', coalesce: patch.name != null ? 'grpname:' + id : null });
  };

  P.deleteGroup = function (id) {
    const g = this.group(id);
    this.update('Delete group ' + (g ? g.name : ''), d => {
      // a gate scoped to this group keeps applying to exactly the samples that were in it
      const members = Object.keys(d.wells).filter(k => d.wells[k].group === id);
      d.gates.forEach(x => {
        if (!x.scope || !x.scope.groups || x.scope.groups.indexOf(id) < 0) return;
        const n = FM.scope.normalize({ groups: x.scope.groups.filter(q => q !== id), samples: (x.scope.samples || []).concat(members) });
        x.scope = n || { samples: ['(none)'] };
      });
      d.groups = d.groups.filter(x => x.id !== id);
      Object.values(d.wells).forEach(w => { if (w.group === id) w.group = null; });
    }, { kind: 'groups' });
  };

  P.moveGroup = function (id, delta) {
    this.update('Reorder groups', d => {
      const i = d.groups.findIndex(x => x.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= d.groups.length) return;
      const [g] = d.groups.splice(i, 1);
      d.groups.splice(j, 0, g);
    }, { kind: 'groups' });
  };

  P.assign = function (keys, groupId) {
    this.update(groupId ? 'Assign wells' : 'Clear wells', d => {
      keys.forEach(k => { d.wells[k] = Object.assign({ excluded: false, reason: '' }, d.wells[k], { group: groupId || null }); });
    }, { kind: 'groups' });
  };

  /** Create/reuse conditions by name and assign wells: { A1: 'IgG1', ... } → one undo step. */
  P.applyLayout = function (wellNames) {
    const byName = {};
    this.update('Paste plate layout', d => {
      Object.values(wellNames).forEach(name => {
        if (byName[name]) return;
        let g = d.groups.find(x => x.name.toLowerCase() === String(name).toLowerCase());
        if (!g) {
          const used = new Set(d.groups.map(x => x.color));
          g = { id: uid('grp'), name, color: GROUP_COLORS.find(c => !used.has(c)) || GROUP_COLORS[d.groups.length % GROUP_COLORS.length], role: 'sample' };
          d.groups.push(g);
        }
        byName[name] = g.id;
      });
      // keyed by well id, so wells whose files are added later pick up their condition too
      Object.entries(wellNames).forEach(([wid, n]) => {
        const s = this.samples.find(x => x.well === wid && !x.wellConflict);
        const key = s ? s.key : wid;
        d.wells[key] = Object.assign({ excluded: false, reason: '' }, d.wells[key], { group: byName[n] });
      });
    }, { kind: 'groups' });
    return byName;
  };

  P.setExcluded = function (keys, excluded, reason) {
    this.update(excluded ? 'Exclude wells' : 'Include wells', d => {
      keys.forEach(k => {
        d.wells[k] = Object.assign({ group: null }, d.wells[k], { excluded: !!excluded, reason: excluded ? (reason || '') : '' });
      });
    }, { kind: 'groups' });
  };

  P.controlGroup = function () { return this.doc.groups.find(g => g.role === 'control') || null; };

  /** Samples belonging to a group, in plate order. */
  P.samplesIn = function (groupId) { return this.samples.filter(s => (this.doc.wells[s.key] || {}).group === groupId); };

  // ----------------------------------------------------------------- metrics
  P.metric = function (id) { return this.doc.metrics.find(m => m.id === id) || null; };

  P.addMetric = function (name, expr) {
    const m = { id: uid('m'), name: name || 'Metric', expr: expr || '' };
    this.update('Add metric ' + m.name, d => {
      d.metrics.push(m);
      if (!d.settings.primaryMetric) d.settings.primaryMetric = m.id;
    }, { kind: 'metrics' });
    return m.id;
  };

  P.updateMetric = function (id, patch) {
    this.update('Edit metric', d => {
      const m = d.metrics.find(x => x.id === id);
      if (m) Object.assign(m, patch);
    }, { kind: 'metrics', coalesce: 'metric:' + id + ':' + Object.keys(patch).join(',') });
  };

  P.deleteMetric = function (id) {
    this.update('Delete metric', d => {
      d.metrics = d.metrics.filter(x => x.id !== id);
      if (d.settings.primaryMetric === id) d.settings.primaryMetric = d.metrics.length ? d.metrics[0].id : null;
    }, { kind: 'metrics' });
  };

  /** Evaluate a metric for one sample → { value, error }. */
  P.metricValue = function (sample, metricOrId) {
    const m = typeof metricOrId === 'string' ? this.metric(metricOrId) : metricOrId;
    if (!m) return { value: NaN, error: 'No metric' };
    try {
      this._astCache = this._astCache || new Map();
      let ast = this._astCache.get(m.expr);
      if (!ast) { ast = FM.expr.parse(m.expr); this._astCache.set(m.expr, ast); }
      const ws = this;
      const value = FM.expr.evaluate(ast, {
        popId: name => ws.popIdByName(name),
        hasParam: name => !!sample.data[name],
        count: id => ws.count(sample, id),
        pctParent: id => ws.pct(sample, id),
        pctOf: (id, anc) => ws.pctOf(sample, id, anc),
        stat: (id, param, which) => ws.stat(sample, id, param, which),
      });
      return { value, error: null };
    } catch (e) {
      return { value: NaN, error: e.message };
    }
  };

  P.setSetting = function (key, value, coalesce) {
    this.update('Change ' + key, d => { d.settings[key] = value; }, { kind: 'settings', coalesce: coalesce ? 'set:' + key : null });
  };

  // ----------------------------------------------------------------- tables
  P.table = function (id) { return (this.doc.tables || []).find(t => t.id === id) || null; };

  P.addTable = function (name, rows) {
    const t = { id: uid('t'), name: name || 'Table ' + ((this.doc.tables || []).length + 1), rows: rows || 'samples', columns: [] };
    this.update('Add table ' + t.name, d => { d.tables = d.tables || []; d.tables.push(t); }, { kind: 'tables' });
    return t.id;
  };

  P.updateTable = function (id, patch) {
    this.update('Edit table', d => { const t = (d.tables || []).find(x => x.id === id); if (t) Object.assign(t, clone(patch)); },
      { kind: 'tables', coalesce: patch.name != null ? 'tname:' + id : null });
  };

  P.deleteTable = function (id) {
    const t = this.table(id);
    this.update('Delete table ' + (t ? t.name : ''), d => { d.tables = (d.tables || []).filter(x => x.id !== id); }, { kind: 'tables' });
  };

  /** A column keeps the id it brings (a duplicated table's formulas refer to them) unless the table already uses it. */
  function withColumnId(t, col) {
    const c = clone(col);
    if (!c.id || t.columns.some(x => x.id === c.id)) c.id = uid('c');
    return c;
  }

  P.addTableColumn = function (id, col) {
    this.update('Add column', d => { const t = (d.tables || []).find(x => x.id === id); if (t) t.columns.push(withColumnId(t, col)); }, { kind: 'tables' });
  };

  P.addTableColumns = function (id, cols) {
    this.update('Add ' + cols.length + ' columns', d => { const t = (d.tables || []).find(x => x.id === id); if (t) cols.forEach(c => t.columns.push(withColumnId(t, c))); }, { kind: 'tables' });
  };

  P.updateTableColumn = function (id, colId, patch) {
    this.update('Edit column', d => {
      const t = (d.tables || []).find(x => x.id === id);
      const c = t && t.columns.find(x => x.id === colId);
      if (c) Object.assign(c, clone(patch));
    }, { kind: 'tables' });
  };

  P.removeTableColumn = function (id, index) {
    this.update('Remove column', d => { const t = (d.tables || []).find(x => x.id === id); if (t) t.columns.splice(index, 1); }, { kind: 'tables' });
  };

  P.moveTableColumn = function (id, index, delta) {
    this.update('Move column', d => {
      const t = (d.tables || []).find(x => x.id === id);
      if (!t) return;
      const j = index + delta;
      if (index < 0 || j < 0 || j >= t.columns.length) return;
      const [c] = t.columns.splice(index, 1);
      t.columns.splice(j, 0, c);
    }, { kind: 'tables' });
  };

  // ----------------------------------------------------------------- graphs
  P.graph = function (id) { return (this.doc.graphs || []).find(g => g.id === id) || null; };

  P.addGraph = function (spec) {
    const g = Object.assign({ id: uid('gr') }, clone(spec));
    this.update('Add graph', d => { d.graphs = d.graphs || []; d.graphs.push(g); }, { kind: 'graphs' });
    return g.id;
  };

  P.updateGraph = function (id, patch) {
    this.update('Edit graph', d => { const g = (d.graphs || []).find(x => x.id === id); if (g) Object.assign(g, clone(patch)); },
      { kind: 'graphs', coalesce: patch.name != null || patch.yLabel != null ? 'graph:' + id + ':' + Object.keys(patch).join(',') : null });
  };

  /** Move the graph at index `from` to index `to` in the list. */
  P.moveGraph = function (from, to) {
    this.update('Move graph', d => {
      const gs = d.graphs || [];
      if (from < 0 || from >= gs.length || to < 0 || to >= gs.length || from === to) return;
      const [g] = gs.splice(from, 1);
      gs.splice(to, 0, g);
    }, { kind: 'graphs' });
  };

  P.deleteGraph = function (id) {
    this.update('Delete graph', d => { d.graphs = (d.graphs || []).filter(x => x.id !== id); }, { kind: 'graphs' });
  };

  // ------------------------------------------------------------ layout page
  /* A sheet you arrange plots on. Items hold only *what* to draw — a well key, a population
   * id, two parameter names — never pixels of data, so a page re-renders from live gating
   * and follows a gate edit the way every other view does. */

  const ITEM_DEFAULTS = {
    plot: { w: 268, h: 236, showGates: true, showPct: true, title: '' },
    text: { w: 340, h: 34, text: 'Text', size: 15, weight: 600, align: 'left' },
    // the gating tree: width-driven (it scales with its width), height follows its content
    table: { w: 700, h: 200, mode: 'condition', value: 'parent', sd: true, sample: null },
  };

  P.layout = function () {
    if (!this.doc.layout || !Array.isArray(this.doc.layout.items)) this.doc.layout = defaultLayout();
    if (!this.doc.layout.page) this.doc.layout.page = defaultLayout().page;
    return this.doc.layout;
  };
  P.layoutItem = function (id) { return this.layout().items.find(i => i.id === id) || null; };
  P.pagePresets = function () { return PAGE_PRESETS; };

  /** Why this item cannot be drawn, in words, or null. Deleting a gate must not break a page. */
  P.layoutProblem = function (it) {
    if (!it) return 'This item is gone.';
    if (it.kind === 'table') return this.doc.gates.length ? null : 'There are no gates to summarise yet.';
    if (it.kind !== 'plot') return null;
    if (!this.sample(it.sample)) return 'Well ' + it.sample + ' is not loaded.';
    if (it.pop && !this.gate(it.pop)) return 'The population this plot showed has been deleted.';
    const s = this.sample(it.sample);
    if (!s.data[it.ax]) return 'This well has no ' + it.ax + '.';
    if (it.ay && !s.data[it.ay]) return 'This well has no ' + it.ay + '.';
    return null;
  };

  P.addLayoutItems = function (specs, opts) {
    opts = opts || {};
    const L = this.layout();
    const made = specs.map(sp => Object.assign({ id: uid('li'), x: PAGE_PAD, y: PAGE_PAD },
      ITEM_DEFAULTS[sp.kind] || ITEM_DEFAULTS.plot, clone(sp)));
    this.update(opts.label || ('Add ' + made.length + ' item' + (made.length > 1 ? 's' : '') + ' to the page'),
      d => { d.layout = d.layout || defaultLayout(); d.layout.items = d.layout.items.concat(made); }, { kind: 'layout' });
    void L;
    return made.map(i => i.id);
  };

  P.updateLayoutItem = function (id, patch, opts) {
    opts = opts || {};
    this.update(opts.label || 'Move item', d => {
      const it = (d.layout.items || []).find(x => x.id === id);
      if (it) Object.assign(it, clone(patch));
    }, { kind: 'layout', coalesce: opts.coalesce });
  };

  /** Patch several items in one undo step — a multi-item drag is one gesture. */
  P.updateLayoutItems = function (patches, opts) {
    opts = opts || {};
    this.update(opts.label || 'Move items', d => {
      (d.layout.items || []).forEach(it => { if (patches[it.id]) Object.assign(it, clone(patches[it.id])); });
    }, { kind: 'layout', coalesce: opts.coalesce });
  };

  P.removeLayoutItems = function (ids) {
    const set = new Set(ids);
    this.update('Remove ' + set.size + ' item' + (set.size > 1 ? 's' : '') + ' from the page',
      d => { d.layout.items = (d.layout.items || []).filter(i => !set.has(i.id)); }, { kind: 'layout' });
  };

  P.reorderLayoutItem = function (id, where) {
    this.update(where === 'front' ? 'Bring to front' : 'Send to back', d => {
      const arr = d.layout.items || [];
      const i = arr.findIndex(x => x.id === id);
      if (i < 0) return;
      const [it] = arr.splice(i, 1);
      if (where === 'front') arr.push(it); else arr.unshift(it);
    }, { kind: 'layout' });
  };

  /**
   * Put a gating strategy on the page: one plot per step for each well in opts.samples, with
   * arrows from each gate to the plot of what is inside it. opts.replace drops chains already
   * there; opts.table adds a gating tree table at the bottom if the page has none.
   */
  P.addStrategy = function (opts) {
    let ids = [];
    this.update(opts.label || 'Lay out the gating strategy', d => {
      d.layout = d.layout || defaultLayout();
      ids = FM.strategy.build(d, opts);
    }, { kind: 'layout' });
    return ids;
  };

  P.setPage = function (patch) {
    this.update('Change page size', d => { d.layout.page = Object.assign({}, d.layout.page, patch); }, { kind: 'layout' });
  };

  /**
   * A plot size that tiles the page width evenly. Figures want the whole sheet used, so the
   * column count is chosen to land each plot near a readable 260 px and the width is then
   * divided exactly — no dead strip down the right-hand side.
   */
  P.gridSize = function (withTitle) {
    const avail = this.layout().page.w - 2 * PAGE_PAD;
    const cols = Math.max(1, Math.min(6, Math.round(avail / 260)));
    const w = Math.floor((avail - (cols - 1) * ITEM_GAP) / cols);
    return { cols, w, h: Math.round(w * 0.9) + (withTitle ? 22 : 0) };
  };

  /**
   * Pack every item into a left-to-right grid inside the page margins, in their current
   * order, so nothing falls off the page. A page we sized ourselves is re-fitted to its
   * contents; a page the user chose a size for is only ever grown, never shrunk under them.
   */
  P.tidyLayout = function () {
    this.update('Tidy the page', d => {
      const L = d.layout, items = L.items || [];
      if (!items.length) return;
      const avail = L.page.w - 2 * PAGE_PAD;
      let x = PAGE_PAD, y = PAGE_PAD, rowH = 0;
      // gating-strategy chains keep their shape: re-gridded from the hierarchy, one under another
      const gatesById = new Map(d.gates.map(g => [g.id, g]));
      const chains = FM.strategy ? FM.strategy.chainIds(items) : [];
      chains.forEach(cid => {
        const bottom = FM.strategy.arrange(items.filter(i => i.chain === cid && i.kind === 'plot'), gatesById, PAGE_PAD, y);
        y = Math.ceil(bottom + FM.strategy.CHAIN_GAP);
      });
      const loose = items.filter(i => !(i.kind === 'plot' && i.chain) && i.kind !== 'table');
      const tables = items.filter(i => i.kind === 'table');
      loose.forEach(it => {
        // a full-width item (a heading) always starts its own row
        const wide = it.kind === 'text' && it.w >= avail - ITEM_GAP;
        if (wide || (x > PAGE_PAD && x + it.w > PAGE_PAD + avail + 0.5)) {
          x = PAGE_PAD; y += rowH ? rowH + ITEM_GAP : 0; rowH = 0;
        }
        it.x = x; it.y = y;
        rowH = Math.max(rowH, it.h);
        x += it.w + ITEM_GAP;
        if (wide) { x = PAGE_PAD; y += it.h + ITEM_GAP; rowH = 0; }
      });
      // tables sit at the bottom, one under another
      let ty = Math.max(PAGE_PAD, Math.ceil(Math.max.apply(null, items.filter(i => i.kind !== 'table').map(i => i.y + i.h).concat([PAGE_PAD])) + (loose.length || chains.length ? ITEM_GAP * 2 : 0)));
      tables.forEach(t => { t.x = PAGE_PAD; t.y = ty; ty += t.h + ITEM_GAP * 2; });
      const bottom = Math.ceil(Math.max.apply(null, items.map(i => i.y + i.h)) + PAGE_PAD);
      if (L.page.preset === 'custom') L.page.h = Math.max(200, bottom);
      else if (bottom > L.page.h) { L.page.h = bottom; L.page.preset = 'custom'; }
    }, { kind: 'layout' });
  };

  P.setView = function (popId, view) {
    // view changes are not worth an undo step
    this.doc.views[popId || 'root'] = Object.assign({}, this.doc.views[popId || 'root'], view);
    this.emit('view', { popId });
  };
  P.view = function (popId) { return this.doc.views[popId || 'root'] || null; };

  /**
   * The Gate step's worksheet (all plots at once): { items: [{ id, pop, x, y } | { id, type: 'stats' }],
   * hidden: [keys of default cards taken off], size: 's'|'m'|'l' }. null: the default arrangement.
   */
  P.setSheet = function (sheet, label) {
    this.update(label || 'Arrange worksheet', d => { d.sheet = sheet ? clone(sheet) : null; }, { kind: 'view' });
  };

  // ----------------------------------------------------------- serialisation
  P.toJSON = function () {
    const d = clone(this.doc);
    d.savedAt = new Date().toISOString();
    d.app = 'FlowMate ' + FM.version;
    return d;
  };

  /** Validate a loaded doc just enough to fail loudly on the wrong kind of file. */
  function checkDoc(doc) {
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.gates) || !doc.settings)
      throw new Error('This file is not a FlowMate workspace or template.');
    return doc;
  }

  /**
   * Replace the doc. options.template: keep only gates, metrics, groups, params, settings and
   * well assignments (the reusable analysis), leaving currently loaded samples in place.
   */
  P.loadDoc = function (doc, options) {
    options = options || {};
    checkDoc(doc);
    const base = defaultDoc();
    const next = Object.assign(base, clone(doc));
    next.settings = Object.assign(defaultDoc().settings, doc.settings || {});
    // documents with only a compensate on/off setting
    if (!doc.comp) next.comp = { active: doc.settings && doc.settings.compensate === false ? 'none' : 'file', matrices: [] };
    compOf(next);
    delete next.settings.compensate;
    next.gates.forEach(g => { if (typeof g.rev === 'number' && g.rev > revCounter) revCounter = g.rev; });
    // table columns are referred to by id (formula columns, graphs); older documents had none
    (next.tables || []).forEach(t => (t.columns || []).forEach(c => { if (!c.id) c.id = uid('c'); }));
    // a template is the reusable analysis: per-well nudges belong to the plate they were made on
    if (options.template) next.gates.forEach(g => { delete g.perWell; });
    next.gates.forEach(g => {
      g.rev = nextRev();
      if (g.perWell) Object.values(g.perWell).forEach(o => { o.rev = nextRev(); });
    });
    this.update(options.template ? 'Apply template' : 'Open workspace', () => { this.doc = next; }, { kind: 'doc' });
    this._reindex();
    this.samples.forEach(s => this.engine.clear(s));
    this._syncComp();
    this._ensureParamScales();
    this.samples.forEach(s => { if (!this.doc.wells[s.key]) this.doc.wells[s.key] = { group: null, excluded: false, reason: '' }; });
    this.emit('doc', { loaded: true });
  };

  /** A template is the analysis without anything tied to this run's files. */
  P.toTemplate = function () {
    const d = this.toJSON();
    d.kind = 'template';
    // a well was nudged because *this* plate's well drifted — never carry that to the next plate
    d.gates.forEach(g => { delete g.perWell; });
    // a scope naming samples belongs to this run; a group scope travels with the groups
    d.gates.forEach(g => {
      if (!g.scope) return;
      const n = FM.scope.normalize({ groups: g.scope.groups });
      if (n) g.scope = n; else delete g.scope;
    });
    // keep assignments that are keyed by well position; drop file-name keyed ones
    Object.keys(d.wells).forEach(k => {
      if (!FM.wells.normalize(k)) delete d.wells[k];
      else { d.wells[k].excluded = false; d.wells[k].reason = ''; }
    });
    return d;
  };

  FM.Workspace = Workspace;
  FM.workspaceUtil = { defaultDoc, clone, uid, GROUP_COLORS, ROLE_COLORS, nextRev, PAGE_PAD, ITEM_GAP };
})(FM);
