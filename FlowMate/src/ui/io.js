/* Files in and out: workspaces, templates, CSV exports, and the HTML report download. */
(function (FM) {
  'use strict';
  const { toast, pickFiles } = FM.dom;
  const download = (...a) => FM.dom.download(...a);   // resolved per call, so it can be intercepted
  const W = () => FM.ws;

  function safeName(s) { return String(s || 'flowmate').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'flowmate'; }
  function stamp() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  /** RFC 4180 CSV. */
  function toCSV(rows) {
    return rows.map(r => r.map(v => {
      if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '';
      const s = typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n') + '\r\n';
  }

  /** Gates in tree order (parents before children). */
  function gatesInOrder() {
    const ws = W(), out = [];
    const walk = pid => ws.children(pid).forEach(g => { out.push(g); walk(g.id); });
    walk(null);
    return out;
  }

  // -------------------------------------------------------------- documents
  function saveWorkspace() {
    const ws = W();
    const doc = ws.toJSON();
    doc.kind = 'workspace';
    doc.files = ws.samples.map(s => ({ name: s.name, key: s.key, events: s.n }));
    download(safeName(ws.doc.name) + '.flowmate.json', JSON.stringify(doc, null, 1), 'application/json');
    toast('Workspace saved — it holds the analysis, not the FCS data');
  }

  function saveTemplate() {
    const ws = W();
    const t = ws.toTemplate();
    download(safeName(ws.doc.name) + ' template.flowmate.json', JSON.stringify(t, null, 1), 'application/json');
    toast('Template saved — open it with next week\'s plate to repeat this analysis');
  }

  async function openDocument() {
    const files = await pickFiles({ accept: '.flowmate,.json,application/json' });
    if (files.length) return openDocumentFile(files[0]);
    return false;
  }

  /** A shared analysis (.flowmate), a template or a workspace file. → whether something was opened. */
  async function openDocumentFile(file) {
    if (typeof file.slice === 'function' && FM.bundle.isBundle(await file.slice(0, 4).arrayBuffer())) return FM.library.importShared(file);
    let doc;
    try { doc = JSON.parse(await file.text()); }
    catch (_) { toast(file.name + ' is not a FlowMate file', { level: 'crit' }); return false; }
    if (doc && (doc.kind === 'flowmate-panel' || doc.kind === 'flowmotion-panel')) { FM.openPlanner(doc); return true; }
    return applyDocument(doc, { files: doc.files });
  }

  /**
   * Put an analysis document on the loaded files: a template re-applies gates and layout, anything
   * else brings the whole analysis back and says which FCS files it expects.
   */
  function applyDocument(doc, o) {
    o = o || {};
    const ws = W();
    try {
      ws.loadDoc(doc, { template: doc.kind === 'template' });
    } catch (e) { toast(e.message, { level: 'crit' }); return false; }
    FM.setUI({ popId: null, gateId: null, metricId: null, resultsMetric: null });
    const n = ws.doc.gates.length + ' gates, ' + ws.doc.groups.length + ' conditions, ' + (ws.doc.tables || []).filter(t => t.columns.length).length + ' measurement tables';
    if (doc.kind === 'template') {
      toast('Template applied — ' + n);
    } else {
      const expected = (o.files || []).map(f => f.name || f);
      const have = new Set(ws.samples.map(s => s.name));
      const missing = expected.filter(f => !have.has(f));
      toast((o.name ? '“' + o.name + '” opened' : 'Analysis opened') + ' — ' + n + (missing.length ? '. Add its ' + missing.length + ' FCS file' + (missing.length > 1 ? 's' : '') + ' to see the data' : ''), { ms: 6000 });
    }
    FM.go(ws.samples.length ? (ws.doc.gates.length ? 'gate' : 'plate') : 'load');
    return true;
  }

  // ------------------------------------------------------------------- CSVs
  function exportWellsCSV() {
    const ws = W();
    if (!ws.samples.length) return;
    const gates = gatesInOrder();
    const head = ['well', 'file', 'condition', 'role', 'excluded', 'exclusion_reason', 'events', 'acquisition_order', 'acquired'];
    gates.forEach(g => head.push(g.name + ' | count', g.name + ' | % of parent', g.name + ' | % of total', g.name + ' | gate'));
    ws.doc.metrics.forEach(m => head.push(m.name));
    const rows = [head];
    ws.samples.forEach(s => {
      const w = ws.wellInfo(s.key), g = ws.groupOf(s.key);
      const r = [s.well || '', s.name, g ? g.name : '', g ? g.role : '', w.excluded ? 'yes' : 'no', w.reason || '', s.n, s.acqOrder,
        s.acqTime != null ? new Date(s.acqTime).toISOString() : ''];
      // a hand-adjusted gate must be readable straight from the numbers it produced
      gates.forEach(gt => r.push(ws.count(s, gt.id), ws.pct(s, gt.id), ws.pctOf(s, gt.id, null),
        ws.isAdjusted(gt.id, s.key) ? 'adjusted for this well' : 'shared'));
      ws.doc.metrics.forEach(m => r.push(ws.metricValue(s, m).value));
      rows.push(r);
    });
    download(safeName(ws.doc.name) + ' per-well ' + stamp() + '.csv', toCSV(rows), 'text/csv');
    toast('Per-well CSV saved');
  }

  function exportPopStatsCSV() {
    const ws = W();
    const pops = [null].concat(gatesInOrder().map(g => g.id));
    const params = ws.paramNames();
    const rows = [['well', 'file', 'condition', 'excluded', 'population', 'parent', 'count', 'pct_of_parent', 'pct_of_total', 'parameter', 'mean', 'median', 'geometric_mean', 'sd', 'cv_pct', 'robust_cv_pct']];
    ws.samples.forEach(s => {
      const g = ws.groupOf(s.key), w = ws.wellInfo(s.key);
      pops.forEach(pid => {
        const gate = pid ? ws.gate(pid) : null;
        const base = [s.well || '', s.name, g ? g.name : '', w.excluded ? 'yes' : 'no', ws.popName(pid), gate ? ws.popName(gate.parent) : '',
          ws.count(s, pid), pid ? ws.pct(s, pid) : 100, ws.pctOf(s, pid, null)];
        params.forEach(p => {
          const st = k => ws.stat(s, pid, p, k);
          rows.push(base.concat([p, st('mean'), st('median'), st('gmean'), st('sd'), st('cv'), st('rcv')]));
        });
      });
    });
    download(safeName(ws.doc.name) + ' population stats ' + stamp() + '.csv', toCSV(rows), 'text/csv');
    toast('Population statistics saved (' + (rows.length - 1).toLocaleString() + ' rows)');
  }



  // ---------------------------------------------------------- event export
  const fmtVal = v => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '');
  const csvCell = s => (/[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);

  /** Can this parameter be written as recorded (uncompensated)? Unmixed dye channels exist only unmixed. */
  const hasRaw = (s, p) => !!(s.raw && s.raw[p]);

  /**
   * Every event of a population, one row per cell: well, file, condition, event number (1-based, as in
   * the FCS file), then the chosen parameters. opts: { popId, keys, params, recorded, maxPerWell }.
   * → { parts: [strings], rows } — parts, so a large export is never one giant string.
   */
  function eventsCSV(opts) {
    const ws = W();
    const params = opts.params;
    const head = ['well', 'file', 'condition', 'event'].concat(params.map(p => { const lab = (ws.paramInfo(p).label || '').replace(/__/g, '/'); return lab && lab !== p ? p + ' (' + lab + ')' : p; }));
    const parts = [head.map(csvCell).join(',') + '\r\n'];
    let rows = 0;
    opts.keys.forEach(k => {
      const s = ws.sample(k);
      if (!s) return;
      const g = ws.groupOf(k);
      const lead = [s.well || '', s.name, g ? g.name : ''].map(csvCell).join(',') + ',';
      const cols = params.map(p => (opts.recorded && hasRaw(s, p) ? s.raw[p] : s.data[p]) || null);
      let idx = ws.indices(s, opts.popId || null);
      const max = opts.maxPerWell || 0;
      if (max && idx.length > max) { const step = idx.length / max, all = idx; idx = new Uint32Array(max); for (let i = 0; i < max; i++) idx[i] = all[Math.floor(i * step)]; }
      let buf = '';
      for (let i = 0; i < idx.length; i++) {
        const e = idx[i];
        let line = lead + (e + 1);
        for (let c = 0; c < cols.length; c++) line += ',' + (cols[c] ? fmtVal(cols[c][e]) : '');
        buf += line + '\r\n';
        if (buf.length > 1 << 20) { parts.push(buf); buf = ''; }
      }
      if (buf) parts.push(buf);
      rows += idx.length;
    });
    return { parts, rows };
  }

  /** The events dialog: which population, wells, parameters, values and how many events per well. */
  function exportEventsDialog(preset) {
    const ws = W();
    if (!ws.samples.length) return;
    const { h, icon } = FM.dom;
    preset = preset || {};
    const depth = g => { let d = 0, p = g.parent; while (p) { d++; p = (ws.gate(p) || {}).parent; } return d; };
    const pop = h('select.input', { 'aria-label': 'Population' },
      h('option', { value: '' }, 'All events'),
      gatesInOrder().map(g => h('option', { value: g.id, selected: g.id === ('popId' in preset ? preset.popId : FM.ui.popId) }, ' '.repeat(depth(g)) + g.name)));
    const cur = FM.currentSample && FM.currentSample();
    const wellOpts = [['all', 'All wells']].concat(ws.doc.groups.filter(g => ws.samplesIn(g.id).length).map(g => ['g:' + g.id, 'Condition: ' + g.name]));
    if (cur) wellOpts.push(['one', 'Only ' + (cur.well || cur.name)]);
    const wells = h('select.input', { 'aria-label': 'Wells' }, wellOpts.map(([v, l]) => h('option', { value: v, selected: v === (preset.wells || 'all') }, l)));
    const withExcluded = h('input', { type: 'checkbox' });
    const anyComp = ws.samples.some(s => s.raw && s.raw !== s.data && Object.keys(s.raw).some(p => s.raw[p] !== s.data[p]));
    const values = h('select.input', { 'aria-label': 'Values', disabled: !anyComp },
      h('option', { value: 'gated' }, anyComp ? 'Compensated, as gated' : 'As recorded (no compensation applied)'),
      anyComp ? h('option', { value: 'recorded' }, 'As recorded (uncompensated)') : null);
    const maxSel = h('select.input', { 'aria-label': 'Events per well' }, [[0, 'All of them'], [100000, 'Up to 100,000'], [10000, 'Up to 10,000'], [1000, 'Up to 1,000']].map(([v, l]) => h('option', { value: v }, l)));
    const params = ws.paramNames().filter(p => !/^time$/i.test(p));
    const boxes = params.map(p => {
      const lab = (ws.paramInfo(p).label || '').replace(/__/g, '/');
      const cb = h('input', { type: 'checkbox', checked: true, value: p });
      return { p, cb, el: h('label.ev-param', cb, h('span.mono', p), lab && lab !== p ? h('span.muted', lab) : null) };
    });
    const est = h('div.small.muted.ev-est');
    const keysNow = () => {
      const v = wells.value;
      let list = v === 'one' && cur ? [cur] : v.startsWith('g:') ? ws.samplesIn(v.slice(2)) : ws.samples;
      if (!withExcluded.checked && v !== 'one') list = list.filter(s => !ws.wellInfo(s.key).excluded);
      return list.map(s => s.key);
    };
    const chosen = () => boxes.filter(b => b.cb.checked && !b.cb.disabled).map(b => b.p);
    const refresh = () => {
      const recorded = values.value === 'recorded';
      boxes.forEach(b => { const ok = !recorded || ws.samples.some(s => hasRaw(s, b.p)); b.cb.disabled = !ok; b.el.classList.toggle('off', !ok); });
      const keys = keysNow(), max = +maxSel.value, pid = pop.value || null;
      const n = keys.reduce((a, k) => { const c = ws.count(ws.sample(k), pid); return a + (max ? Math.min(max, c) : c); }, 0);
      const mb = n * (24 + chosen().length * 8) / 1e6;
      est.textContent = n.toLocaleString() + ' cells × ' + chosen().length + ' parameters from ' + keys.length + ' well' + (keys.length === 1 ? '' : 's') + ' · about ' + (mb < 1 ? '<1' : Math.round(mb)) + ' MB' +
        (n > 3e6 ? ' — a large file; Excel opens at most 1,048,576 rows' : '');
    };
    [pop, wells, withExcluded, values, maxSel].forEach(el => el.addEventListener('change', refresh));
    boxes.forEach(b => b.cb.addEventListener('change', refresh));
    const setAll = on => { boxes.forEach(b => { if (!b.cb.disabled) b.cb.checked = on; }); refresh(); };
    refresh();
    FM.dom.modal({
      title: 'Export events',
      subtitle: 'The value of every cell — one row per event — for the parameters you choose, as a CSV for R, Python, Excel or Prism.',
      wide: true,
      body: h('div.ev-form',
        h('div.ev-grid',
          h('div.field', h('label', 'Population'), pop),
          h('div.field', h('label', 'Wells'), wells, h('label.cmp-check.small', withExcluded, h('span', 'Include excluded wells'))),
          h('div.field', h('label', 'Values'), values),
          h('div.field', h('label', 'Events per well'), maxSel, h('div.muted.small', 'Fewer are taken evenly through the file.'))),
        h('div.field', h('div.row', h('label', 'Parameters'), h('span.grow'),
          h('button.btn.sm.ghost', { on: { click: () => setAll(true) } }, 'All'), h('button.btn.sm.ghost', { on: { click: () => setAll(false) } }, 'None')),
          h('div.ev-params', boxes.map(b => b.el))),
        est),
      buttons: [{ label: 'Cancel' }, { label: 'Export CSV', primary: true, fn: () => {
        const ps = chosen(), keys = keysNow();
        if (!ps.length) { toast('Tick at least one parameter', { level: 'crit' }); return false; }
        if (!keys.length) { toast('No wells to export', { level: 'crit' }); return false; }
        const pid = pop.value || null;
        const { parts, rows } = eventsCSV({ popId: pid, keys, params: ps, recorded: values.value === 'recorded', maxPerWell: +maxSel.value });
        download(safeName(ws.doc.name) + ' events ' + safeName(ws.popName(pid)) + ' ' + stamp() + '.csv', new Blob(parts, { type: 'text/csv' }));
        toast(rows.toLocaleString() + ' events saved');
        return true;
      } }],
    });
  }

  /** Save any row grid as a dated CSV, so callers do not each rebuild the file name. */
  function downloadCSV(name, rows) { download(safeName(name) + ' ' + stamp() + '.csv', toCSV(rows), 'text/csv'); }

  // --------------------------------------------------------------- clipboard
  /* What was copied last, so the automated UI test can read a clipboard it is not allowed to. */
  FM.lastCopy = null;

  /**
   * Put a table on the clipboard twice over: HTML, which Word, PowerPoint and Google Docs keep
   * as a real table, and tab-separated text, which Excel, Prism and Sheets split into cells.
   */
  function copyRich(html, text) {
    FM.lastCopy = { html, text };
    if (navigator.clipboard && window.ClipboardItem) {
      return navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]).catch(() => legacyCopy(html, text));
    }
    return legacyCopy(html, text);
  }

  /** Plain text only (a legend, a methods paragraph). */
  function copyText(text) {
    FM.lastCopy = { text };
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(() => legacyCopy(null, text));
    return legacyCopy(null, text);
  }

  /** The pre-async-clipboard route: select a hidden copy and let the browser copy it. */
  function legacyCopy(html, text) {
    return new Promise((resolve, reject) => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      host.contentEditable = 'true';
      if (html) host.innerHTML = html; else host.textContent = text;
      document.body.appendChild(host);
      const r = document.createRange(); r.selectNodeContents(host);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      sel.removeAllRanges(); host.remove();
      if (ok) resolve(); else reject(new Error('copy refused'));
    });
  }

  /** A PNG blob onto the clipboard, for pasting a figure straight into a slide. */
  function copyImage(blob) {
    FM.lastCopy = { image: blob };
    if (!(navigator.clipboard && window.ClipboardItem)) return Promise.reject(new Error('no image clipboard'));
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  /**
   * (Not offered in the UI for now.) Send to PlotMate: copy the hand-off for pasting into PlotMate, or save it as a .plotmate file
   * that PlotMate opens. make() builds the payload when the user picks one.
   */
  function sendToPlotMate(anchor, make, what) {
    const build = () => {
      let p;
      try { p = make(); } catch (e) { toast('Could not prepare the data: ' + e.message, { level: 'crit' }); return null; }
      if (!p || !p.tables.length) { toast('Nothing to send yet: ' + (what || 'add data first') + '.'); return null; }
      return p;
    };
    FM.dom.menu(anchor, [
      { heading: 'Send to PlotMate' },
      { label: 'Copy for PlotMate', icon: 'copy', fn: () => {
        const p = build();
        if (!p) return;
        const text = BMH.toClipboardText(p);
        FM.lastHandoff = text;
        copyText(text).then(() => toast('Copied ' + p.tables.length + ' table' + (p.tables.length === 1 ? '' : 's') + ' for PlotMate. In PlotMate, press Ctrl+V anywhere outside a table cell.', { ms: 6000 }))
          .catch(() => toast('The browser blocked the clipboard. Use Save .plotmate instead.', { level: 'crit' }));
      } },
      { label: 'Save .plotmate file', icon: 'download', fn: () => {
        const p = build();
        if (!p) return;
        const text = BMH.toClipboardText(p);
        FM.lastHandoff = text;
        download(safeName(W().doc.name) + '.plotmate', text, 'application/json');
        toast('Saved. Open it in PlotMate (File → Open, or drop it on the window).');
      } },
    ]);
  }

  FM.io = { saveWorkspace, saveTemplate, openDocument, openDocumentFile, applyDocument, exportWellsCSV, exportPopStatsCSV, eventsCSV, exportEventsDialog, toCSV, downloadCSV, gatesInOrder, safeName,
    copyRich, copyText, copyImage, sendToPlotMate };
})(FM);
