/* Step 7 — Compensation: which spillover matrix the data is read through, the matrix itself
 * (editable), a before/after check plot, and a wizard that computes a matrix from
 * single-stain controls. Switching or editing never reloads a file (see core/comp.js). */
(function (FM) {
  'use strict';
  const { h, icon, clear, toast, modal, fmtCount } = FM.dom;
  const W = () => FM.ws;

  let root = null, els = {};
  const check = { x: null, y: null, key: null, raw: false };

  function mount(el) {
    root = el;
    clear(root);
    const ws = W();
    if (!ws.samples.length) {
      root.appendChild(h('div.empty', FM.brand.miniCell(), h('h2', 'Compensation'),
        h('p', 'Load your FCS files — single-stain controls included — to compute or edit a spillover matrix here. Or try it on synthetic controls with a known spillover.'),
        h('div.row', h('button.btn.primary', { on: { click: () => FM.go('workspace') } }, 'Go to the Workspace'),
          h('button.btn', { on: { click: loadDemoControls } }, icon('flask'), 'Try with demo controls'))));
      return;
    }
    els = { side: h('div.cpv-side-body'), mat: h('section.panel.cpv-mat'), chk: h('aside.panel.cpv-check') };
    root.appendChild(h('div.cpv-wrap',
      h('aside.panel.cpv-side', h('div.panel-head', h('h3', 'Compensation')), els.side),
      els.mat, els.chk));
    render();
  }

  function render() {
    if (!root || !els.side) return;
    renderSide(); renderMatrix(); renderCheck();
  }

  /** The matrix on show: the active one, or the one picked in the list. */
  function shown() {
    const ws = W();
    const c = ws.doc.comp;
    const id = FM.ui.compShow || c.active;
    if (id !== 'file' && id !== 'none' && FM.comp.matrixById(ws, id)) return id;
    return c.active;
  }

  function renderSide() {
    const ws = W();
    clear(els.side);
    const c = ws.doc.comp;
    const withSpill = ws.samples.filter(s => s.spill).length;
    const opt = (id, title, sub, extra) => {
      const on = c.active === id;
      const el = h('button.cpv-opt' + (on ? '.on' : '') + (shown() === id ? '.shown' : ''), { on: { click: () => { FM.ui.compShow = id; if (!on) ws.setComp(id); else render(); } } },
        h('span.cpv-radio', on ? icon('check') : null),
        h('span.grow', h('div.cpv-t', title), sub ? h('div.muted.small', sub) : null), extra || null);
      return el;
    };
    els.side.appendChild(h('div.eyebrow.cpv-eb', 'Read the data through'));
    els.side.appendChild(opt('file', 'Each file’s own matrix', withSpill ? withSpill + ' of ' + ws.samples.length + ' files carry one ($SPILLOVER)' : 'no file carries one'));
    els.side.appendChild(opt('none', 'No compensation', 'raw detector values'));
    c.matrices.forEach(m => els.side.appendChild(opt(m.id, m.name, m.params.length + ' detectors · ' + ({ computed: 'from single-stain controls', edited: 'edited', imported: 'from FlowJo', gatingml: 'from Gating-ML' }[m.source] || m.source),
      h('button.btn.ghost.sm.icon', { 'data-tip': 'More', on: { click: e => { e.stopPropagation(); matrixMenu(m, e.currentTarget); } } }, icon('more')))));
    els.side.appendChild(h('div.cpv-actions',
      h('button.btn.primary', { on: { click: wizard } }, icon('wand'), 'New from single-stain controls…'),
      h('button.btn', { 'data-tip': 'A matrix you can edit, starting from the one on show', on: { click: duplicateShown } }, icon('copy'), 'Duplicate to edit')));
    const comps = ws.samples.filter(s => { const g = ws.groupOf(s.key); return g && g.role === 'comp'; });
    els.side.appendChild(h('p.muted.small.cpv-note', comps.length
      ? comps.length + ' samples are in a compensation-controls group; they are kept out of the results.'
      : 'Tip: put your single-stain controls in a group and give it the “Compensation controls” role on the Workspace — the wizard picks them up and the results leave them out.'));
  }

  function matrixMenu(m, anchor) {
    const ws = W();
    FM.dom.menu(anchor, [
      { label: 'Rename…', icon: 'edit', fn: () => {
        const inp = h('input.input', { value: m.name });
        FM.dom.modal({ title: 'Rename matrix', body: h('div.col', inp), buttons: [{ label: 'Cancel' }, { label: 'Save', primary: true, fn: () => ws.renameMatrix(m.id, inp.value) }] });
      } },
      { label: 'Duplicate', icon: 'copy', fn: () => { FM.ui.compShow = ws.saveMatrix({ name: m.name + ' copy', params: m.params, spill: m.spill, source: 'edited' }); } },
      { label: 'Delete', icon: 'trash', danger: true, fn: () => { ws.deleteMatrix(m.id); toast('Deleted ' + m.name, { action: { label: 'Undo', fn: () => ws.undo() } }); } },
    ]);
  }

  /** The matrix on show as {params, spill, name, editable, id}. */
  function shownMatrix() {
    const ws = W();
    const id = shown();
    if (id === 'none') return null;
    if (id === 'file') {
      const s = ws.samples.find(x => x.spill);
      return s ? { params: s.spill.params, spill: s.spill.matrix, name: 'Acquisition matrix of ' + (s.well || s.name), editable: false } : null;
    }
    const m = FM.comp.matrixById(ws, id);
    return m ? { params: m.params, spill: m.spill, name: m.name, editable: m.source === 'edited' || m.source === 'computed', id: m.id, source: m.source } : null;
  }

  function duplicateShown() {
    const ws = W();
    const m = shownMatrix();
    if (!m) { toast('Nothing to duplicate — compute a matrix from controls, or pick one'); return; }
    FM.ui.compShow = ws.saveMatrix({ name: (m.name || 'Matrix') + ' (edited)', params: m.params, spill: m.spill, source: 'edited' }, { activate: true });
    toast('Editable copy created and applied');
  }

  function renderMatrix() {
    const ws = W();
    clear(els.mat);
    const m = shownMatrix();
    const head = h('div.panel-head', h('h3', m ? m.name : 'No compensation'), h('span.grow'),
      m && !m.editable ? h('span.chip', { 'data-tip': 'Duplicate it to edit' }, 'read-only') : null,
      m && m.editable ? h('span.muted.small', 'click a cell to edit · % of the dye’s own signal') : null);
    els.mat.appendChild(head);
    if (!m) {
      els.mat.appendChild(h('div.empty', h('p', ws.doc.comp.active === 'none' ? 'The data is read raw — no spillover is removed.' : 'None of the files carries an acquisition matrix.'),
        h('button.btn.primary', { on: { click: wizard } }, icon('wand'), 'Compute one from single-stain controls')));
      return;
    }
    const n = m.params.length;
    const cell = (i, j) => {
      const v = m.spill[i][j];
      const pct = v * 100;
      const tone = i === j ? 'diag' : Math.abs(pct) >= 50 ? 'hi' : Math.abs(pct) >= 10 ? 'mid' : Math.abs(pct) >= 1 ? 'lo' : 'zero';
      if (i === j || !m.editable) return h('td.r.mono.cpv-cell.' + tone, i === j ? '100' : pct.toFixed(2));
      const inp = h('input.cpv-in.mono', { value: pct.toFixed(2), 'aria-label': m.params[i] + ' into ' + m.params[j], inputmode: 'decimal',
        on: { change: e => { const x = parseFloat(String(e.target.value).replace(',', '.')); if (Number.isFinite(x)) ws.updateMatrixCell(m.id, i, j, x / 100); else e.target.value = pct.toFixed(2); },
          keydown: e => { if (e.key === 'Enter') e.target.blur(); } } });
      return h('td.r.cpv-cell.' + tone, inp);
    };
    els.mat.appendChild(h('div.scroll.cpv-scroll', h('table.tbl.cpv-table',
      h('thead', h('tr', h('th', h('span.muted', 'spills into →')), m.params.map(p => h('th.r.mono', { title: ws.paramLabel(p) }, short(p))))),
      h('tbody', m.params.map((p, i) => h('tr', h('th.mono', { title: ws.paramLabel(p) }, short(p)), Array.from({ length: n }, (_, j) => cell(i, j))))))));
    const big = [];
    m.spill.forEach((row, i) => row.forEach((v, j) => { if (i !== j && v > 1) big.push(short(m.params[i]) + ' → ' + short(m.params[j])); }));
    if (big.length) els.mat.appendChild(h('div.note.warn.small', icon('alert'), h('span', 'More than 100 % spillover: ' + big.join(', ') + '. Check the controls.')));
    if (m.source === 'computed' && FM.lastCompDiag) els.mat.appendChild(diagList(FM.lastCompDiag));
  }

  const short = p => String(p).replace(/[-_ ]?A$/, '').replace(/ FLR$/, '');

  function diagList(diag) {
    return h('details.cpv-diag', h('summary', 'How each control was read'),
      h('table.tbl', h('thead', h('tr', h('th', 'Control'), h('th', 'Detector'), h('th.r', 'Positive'), h('th.r', 'Negative'), h('th', 'Notes'))),
        h('tbody', diag.map(d => h('tr', h('td', d.sampleKey), h('td.mono', d.param), h('td.r.mono', fmtCount(d.nPos)), h('td.r.mono', fmtCount(d.nNeg)), h('td.small', d.warnings.join(' ') || h('span.faint', '—')))))));
  }

  // --------------------------------------------------------------- check plot
  function renderCheck() {
    const ws = W();
    clear(els.chk);
    const fl = FM.comp.fluorParams(ws);
    const mat = shownMatrix();
    const pool = mat ? mat.params : fl;
    if (!check.x || ws.paramNames().indexOf(check.x) < 0) check.x = pool[0] || ws.paramNames()[0];
    if (!check.y || ws.paramNames().indexOf(check.y) < 0) check.y = pool[1] || pool[0] || ws.paramNames()[1];
    if (!check.key || !ws.sample(check.key)) {
      const comp = ws.samples.find(s => { const g = ws.groupOf(s.key); return g && g.role === 'comp'; });
      check.key = (comp || ws.samples[0]).key;
    }
    const sel = (val, list, on, label) => h('select.input.sm', { 'aria-label': label, on: { change: e => { on(e.target.value); renderCheck(); } } },
      list.map(p => h('option', { value: p.v || p, selected: (p.v || p) === val }, p.l || p)));
    const s = ws.sample(check.key);
    els.chk.appendChild(h('div.panel-head', h('h3', 'Check'), h('span.grow'),
      h('div.seg.sm', h('button' + (!check.raw ? '.on' : ''), { on: { click: () => { check.raw = false; renderCheck(); } } }, 'Compensated'),
        h('button' + (check.raw ? '.on' : ''), { on: { click: () => { check.raw = true; renderCheck(); } } }, 'Raw'))));
    els.chk.appendChild(h('div.cpv-chkctl',
      sel(check.key, ws.samples.map(x => ({ v: x.key, l: x.well ? x.well + ' · ' + x.name : x.name })), v => { check.key = v; }, 'Sample'),
      h('div.row', sel(check.x, ws.paramNames(), v => { check.x = v; }, 'X'), h('span.muted', '×'), sel(check.y, ws.paramNames(), v => { check.y = v; }, 'Y'))));
    const data = h('canvas'), over = h('canvas');
    const box = h('div.wsv-plot.cpv-plot', data, over);
    els.chk.appendChild(box);
    els.chk.appendChild(h('p.muted.small.cpv-note', 'A single-stain control should sit flat after compensation: its positive cells at the same height as its negative ones in every other detector.'));
    FM.dom.frame(() => {
      if (!box.isConnected || !s) return;
      const w = Math.max(220, Math.floor(box.clientWidth || 320));
      const L = FM.plot.layout(w, Math.round(w * 0.95), { square: true });
      const src = check.raw ? { key: s.key + '#raw', name: s.name, n: s.n, data: s.raw || s.data } : s;
      const xSpec = ws.scaleSpec(check.x), ySpec = ws.scaleSpec(check.y);
      FM.plot.render(data, L, { sample: src, idx: FM.gating.allIndices(s), x: check.x, y: check.y, xSpec, ySpec, xLabel: ws.paramLabel(check.x) + (check.raw ? ' (raw)' : ''), yLabel: ws.paramLabel(check.y) + (check.raw ? ' (raw)' : ''), cmap: FM.ui.cmap });
      FM.plot.sizeCanvas(over, L).clearRect(0, 0, L.W, L.H);
    });
  }

  // -------------------------------------------------------------- wizard
  function wizard() {
    const ws = W();
    if (ws.samples.length < 2) { toast('Load your single-stain controls first', { level: 'crit' }); return; }
    const isComp = s => { const g = ws.groupOf(s.key); return g && g.role === 'comp'; };
    const looksUnstained = s => /unstain|blank|\bneg|\bUS\b|no.?stain/i.test(s.name);
    const looksControl = s => isComp(s) || /comp|single|stain|ctrl|control/i.test(s.name);
    const picks = new Set(ws.samples.filter(s => looksControl(s) && !looksUnstained(s)).map(s => s.key));
    let unstained = (ws.samples.find(looksUnstained) || {}).key || '';
    let population = '';
    const channel = {};          // sampleKey → chosen detector ('' = detect)
    const listEl = h('div.cpv-wlist'), resultEl = h('div.cpv-wres');
    let result = null;
    const fl = FM.comp.fluorParams(ws);

    const drawList = () => {
      clear(listEl);
      ws.samples.forEach(s => {
        const on = picks.has(s.key);
        const box = h('input', { type: 'checkbox', checked: on, on: { change: e => { if (e.target.checked) picks.add(s.key); else picks.delete(s.key); recompute(); } } });
        const det = on ? h('select.input.sm', { on: { change: e => { channel[s.key] = e.target.value; recompute(); } } },
          h('option', { value: '' }, 'detect'), fl.map(p => h('option', { value: p, selected: channel[s.key] === p }, p))) : null;
        listEl.appendChild(h('div.cpv-wrow' + (s.key === unstained ? '.unst' : ''), h('label.check', box, h('span', s.well ? s.well + ' · ' + s.name : s.name)),
          s.key === unstained ? h('span.chip', 'unstained') : det));
      });
    };
    const recompute = () => {
      clear(resultEl);
      result = null;
      const controls = Array.from(picks).filter(k => k !== unstained).map(k => ({ sampleKey: k, param: channel[k] || undefined }));
      if (controls.length < 2) { resultEl.appendChild(h('p.muted', 'Tick at least two single-stain controls.')); return; }
      try {
        result = FM.comp.compute(ws, { controls, unstained: unstained || undefined, population: population || undefined });
      } catch (e) { resultEl.appendChild(h('div.note.crit.small', icon('alert'), h('span', e.message))); return; }
      const warn = result.diagnostics.filter(d => d.warnings.length);
      resultEl.appendChild(h('div.scroll.cpv-wmat', h('table.tbl.cpv-table',
        h('thead', h('tr', h('th', ''), result.params.map(p => h('th.r.mono', short(p))))),
        h('tbody', result.params.map((p, i) => h('tr', h('th.mono', short(p)), result.spill[i].map((v, j) => h('td.r.mono.cpv-cell.' + (i === j ? 'diag' : Math.abs(v) >= 0.5 ? 'hi' : Math.abs(v) >= 0.1 ? 'mid' : Math.abs(v) >= 0.01 ? 'lo' : 'zero'), i === j ? '100' : (v * 100).toFixed(2)))))))));
      resultEl.appendChild(warn.length ? h('div.note.warn.small', icon('alert'), h('div', warn.map(d => h('div', h('strong', d.sampleKey + ': '), d.warnings.join(' ')))))
        : h('div.note.ok.small', icon('okCircle'), h('span', result.params.length + ' controls read cleanly — each lit its own detector.')));
    };
    const unstSel = h('select.input', { on: { change: e => { unstained = e.target.value; picks.delete(unstained); drawList(); recompute(); } } },
      h('option', { value: '' }, 'None — use each control’s own negative cells'),
      ws.samples.map(s => h('option', { value: s.key, selected: s.key === unstained }, s.well ? s.well + ' · ' + s.name : s.name)));
    const popSel = h('select.input', { on: { change: e => { population = e.target.value; recompute(); } } },
      h('option', { value: '' }, 'All events'),
      ws.doc.gates.filter(g => g.type !== 'bool').map(g => h('option', { value: g.id }, ws.gatePath(g.id).map(x => x.name).join(' / '))));
    drawList(); recompute();
    modal({
      title: 'New matrix from single-stain controls', wide: true,
      subtitle: 'Each control lights one detector. FlowMate finds its bright cells, compares them with negative cells in every other detector, and turns the difference into spillover.',
      body: h('div.cpv-wiz',
        h('div.col', h('div.field', h('label', 'Unstained control'), unstSel), h('div.field', h('label', 'Read the controls in'), popSel),
          h('div.eyebrow', 'Single-stain controls'), h('div.scroll.cpv-wscroll', listEl)),
        h('div.col', h('div.eyebrow', 'Resulting matrix'), resultEl)),
      buttons: [{ label: 'Cancel' }, { label: 'Create and apply', primary: true, fn: () => {
        if (!result) { toast('Pick the controls first', { level: 'crit' }); return false; }
        FM.lastCompDiag = result.diagnostics;
        const id = ws.saveMatrix({ name: 'From controls', params: result.params, spill: result.spill, source: 'computed' }, { activate: true });
        FM.ui.compShow = id;
        toast('Matrix computed from ' + result.params.length + ' controls and applied to every sample');
        return true;
      } }],
    });
  }

  function loadDemoControls() {
    const ws = W();
    const set = FM.synth.compControls(5000);
    ws.addSamples(set.samples);
    const gid = ws.addGroup('Compensation controls', 'comp');
    ws.assign(['Unstained.fcs', 'Comp-FL1.fcs', 'Comp-FL2.fcs', 'Comp-FL3.fcs'], gid);
    if (!FM.ui.sampleKey) FM.ui.sampleKey = ws.samples[0].key;
    toast('Demo: an unstained tube, three single stains and a mixed sample, with a known spillover');
    if (FM.ui.step === 'comp' && root) mount(root);
  }

  let pending = null;
  function update(kind) {
    if (!root) return;
    if (kind === 'ws:samples') { mount(root); return; }
    if (kind.startsWith('ws:') || kind === 'theme' || kind === 'resize') {
      if (pending) return;
      pending = FM.dom.frame(() => { pending = null; if (root) render(); });
    }
  }

  FM.views = FM.views || {};
  FM.views.comp = { mount, update, unmount() { root = null; els = {}; }, _wizard: wizard, _demo: loadDemoControls };
})(FM);
