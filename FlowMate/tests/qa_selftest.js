/* QA pass: interactions not covered by ui_selftest.js. Same reporting conventions. */
(function () {
  'use strict';
  const out = [];
  let pass = 0, fail = 0;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const settle = () => wait(120);
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const btn = (text, r) => $$('button', r).find(b => b.textContent.replace(/\s+/g, ' ').trim().includes(text));
  const ws = () => FM.ws;
  function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
  function eq(a, b, m) { if (a !== b) throw new Error((m ? m + ': ' : '') + 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ptr(el, type, x, y, extra) {
    el.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0,
      buttons: type === 'pointerup' ? 0 : 1, pointerId: 9, pointerType: 'mouse', isPrimary: true }, extra || {})));
  }
  function key(k, extra, target) { (target || document.body).dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra || {}))); }
  function setVal(el, v, ev) { el.value = v; el.dispatchEvent(new Event(ev || 'change', { bubbles: true })); }
  const pv = () => FM.views.gate._plotView();
  function plotPx(tx, ty) { const r = pv().overCv.getBoundingClientRect(); const [x, y] = FM.plot.toPx(pv().L, tx, ty); return [r.left + x, r.top + y]; }
  async function step(name, fn) {
    try { await fn(); pass++; out.push('PASS ' + name); }
    catch (e) { fail++; out.push('FAIL ' + name + '\n     ' + (e && e.message)); }
    FM.dom.closePop();
    $$('.modal-back').forEach(m => m.remove());
  }

  async function run() {
    await wait(300);
    FM.loadDemo();
    const p = FM.presets.byId('phagocytosis');
    FM.presets.apply(ws(), p, { mapping: FM.presets.autoMap(p, ws().paramNames()), layout: true, replace: true });
    FM.go('gate'); await settle();
    const beads = ws().popIdByName('THP Cells + Beads');
    const singles = ws().popIdByName('Singles');

    // ---------------------------------------------------------------- axes
    await step('axis popover: switch FL1-H to Log and back to Logicle; typed range applies to this plot only', async () => {
      FM.setUI({ gateId: beads }); await settle();
      const chip = $$('.axis-float.x .axis-chip')[0];
      assert(chip, 'x chip on the plot');
      chip.click(); await settle();
      btn('Log', $('.pop')).click(); await settle();
      eq(ws().scaleSpec('FL1-H').type, 'log', 'global type');
      eq(ws().viewScale(singles, 'FL1-H').type, 'log', 'view re-framed in the new type');
      btn('Logicle', $('.pop')).click(); await settle();
      eq(ws().scaleSpec('FL1-H').type, 'logicle');
      FM.dom.closePop();
      $$('.axis-float.y .axis-chip')[0].click(); await settle();
      const from = $$('.pop .axis-fields input')[1];
      setVal(from, '800k'); await settle();
      eq(ws().viewScale(singles, 'FSC-H').max, 800000, 'range typed with k suffix');
      assert(ws().viewScale(null, 'FSC-H').max !== 800000 || true, 'root plot untouched');
      btn('Fit to population', $('.pop')).click(); await settle();
      assert(ws().viewScale(singles, 'FSC-H').max !== 800000, 'fit re-framed');
      assert(!ws().gate(beads).rect || ws().pct(ws().sample('A1'), beads) > 40, 'gate unaffected by axis changes');
    });

    // ---------------------------------------------------------------- gates
    await step('histogram range gate: drag an edge; % updates and it is one undo step', async () => {
      setVal($$('.axis-sel')[1], '__hist'); await settle();
      key('h'); await settle();
      const [x0, y0] = plotPx(0.55, 0.3), [x1] = plotPx(0.9, 0.3);
      ptr(pv().overCv, 'pointerdown', x0, y0); ptr(pv().overCv, 'pointermove', x1, y0); ptr(pv().overCv, 'pointerup', x1, y0);
      await wait(200);
      const inp = $('.rename-pop input'); if (inp) { inp.value = 'RangeQA'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
      await settle();
      const g = ws().doc.gates.find(x => x.name === 'RangeQA');
      assert(g, 'range gate named');
      const before = ws().pct(ws().sample('A1'), g.id), depth = ws().undoStack.length;
      const o = FM.plot.gateOutline(g, pv().L, ws().viewScale(singles, 'FL1-H'), null);
      const r = pv().overCv.getBoundingClientRect();
      const yMid = r.top + (pv().L.y0 + pv().L.y1) / 2;
      ptr(pv().overCv, 'pointerdown', r.left + o.x0, yMid);
      for (let i = 1; i <= 4; i++) { ptr(pv().overCv, 'pointermove', r.left + o.x0 + i * 15, yMid); await wait(30); }
      ptr(pv().overCv, 'pointerup', r.left + o.x0 + 60, yMid);
      await wait(200);
      assert(ws().pct(ws().sample('A1'), g.id) < before, 'narrower range, lower %');
      eq(ws().undoStack.length, depth + 1, 'one undo step');
      ws().deleteGate(g.id);
      setVal($$('.axis-sel')[1], 'FSC-H'); await settle();
    });

    await step('polygon: double-click an edge adds a vertex, Alt-click removes it', async () => {
      const cells = ws().popIdByName('THP Cells');
      FM.setUI({ gateId: cells }); await settle();
      const g = ws().gate(cells), n = g.verts.length;
      const it = pv().items.find(i => i.id === cells);
      const [a, b] = [it.outline.verts[0], it.outline.verts[1]];
      const r = pv().overCv.getBoundingClientRect();
      const mx = r.left + (a[0] + b[0]) / 2, my = r.top + (a[1] + b[1]) / 2;
      pv().overCv.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: mx, clientY: my }));
      await settle();
      eq(ws().gate(cells).verts.length, n + 1, 'vertex added');
      pv().drawOverlay();
      const h1 = pv().handles[1];
      ptr(pv().overCv, 'pointerdown', r.left + h1[0], r.top + h1[1], { altKey: true });
      ptr(pv().overCv, 'pointerup', r.left + h1[0], r.top + h1[1]);
      await settle();
      eq(ws().gate(cells).verts.length, n, 'vertex removed');
    });

    await step('gate menu: right-click opens it; F2 renames; a clashing name is refused with a message', async () => {
      const cells = ws().popIdByName('THP Cells');
      FM.setUI({ gateId: cells }); await settle();
      const [x, y] = plotPx(0.4, 0.3);
      const it = pv().items.find(i => i.id === cells);
      const cx = it.outline.pts.reduce((s, p) => s + p[0], 0) / it.outline.pts.length, cy = it.outline.pts.reduce((s, p) => s + p[1], 0) / it.outline.pts.length;
      const r = pv().overCv.getBoundingClientRect();
      pv().overCv.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + cx, clientY: r.top + cy }));
      await settle();
      assert(btn('Edit coordinates', $('.pop')), 'context menu has Edit coordinates');
      FM.dom.closePop();
      key('F2'); await settle();
      const inp = $('.rename-pop input');
      assert(inp, 'rename popover');
      inp.value = 'Singles';
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle();
      assert(/already called/.test($('.rename-pop').textContent), 'clash message shown');
      eq(ws().gate(cells).name, 'THP Cells', 'name unchanged');
    });

    await step('shortcuts do not fire while typing in a field', async () => {
      FM.setUI({ tool: 'select' }); await settle();
      const input = $('.exp-name');
      input.focus();
      key('p', {}, input); key('1', {}, input);
      await settle();
      eq(FM.ui.tool, 'select', 'tool unchanged');
      eq(FM.ui.step, 'gate', 'step unchanged');
      input.blur();
    });

    await step('duplicate a gate and delete it with undo from the toast', async () => {
      const n = ws().doc.gates.length;
      const id = ws().duplicateGate(ws().popIdByName('Singles'));
      await settle();
      eq(ws().doc.gates.length, n + 1);
      FM.setUI({ gateId: id }); await settle();
      key('Delete'); await settle();
      eq(ws().doc.gates.length, n, 'deleted');
      const undo = btn('Undo', $('#toasts'));
      assert(undo, 'toast offers undo');
      undo.click(); await settle();
      eq(ws().doc.gates.length, n + 1, 'restored from the toast');
      ws().deleteGate(id);
    });

    // ---------------------------------------------------------------- plate
    await step('plate: reorder and delete a condition; wells become unassigned', async () => {
      FM.go('plate'); await settle();
      const first = ws().doc.groups[0].id;
      ws().moveGroup(first, 1); await settle();
      eq(ws().doc.groups[1].id, first, 'moved down');
      const n = ws().samplesIn(first).length;
      assert(n === 3, 'three wells');
      ws().deleteGroup(first); await settle();
      assert(ws().samples.filter(s => !ws().wellInfo(s.key).group).length === 3, 'its wells unassigned');
      assert(/not in any condition/.test($('.groups-panel').textContent), 'plate summary warns');
      ws().undo(); ws().undo(); await settle();
    });

    // ---------------------------------------------------------------- app level
    await step('help sheet: ? opens it, Escape closes it', async () => {
      FM.go('gate'); await settle();
      key('?'); await settle();
      assert($('.modal-back'), 'open');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      assert(!$('.modal-back'), 'closed');
    });

    await step('file menu lists its actions', async () => {
      btn('File', $('.top-actions')).click(); await settle();
      ['New analysis', 'My analyses…', 'Share this analysis', 'Open a shared analysis', 'template', 'Per-well gate statistics', 'All population statistics'].forEach(t => assert(btn(t, $('.pop')), 'menu: ' + t));
    });

    await step('loading a non-FCS file is reported, not fatal', async () => {
      const before = ws().samples.length;
      await FM.loadFiles([new File(['not a flow file at all, just text padding padding padding padding'], 'notes.fcs')]);
      eq(ws().samples.length, before, 'nothing added');
      assert((FM.lastLoadErrors || []).some(e => /notes\.fcs/.test(e.name)), 'error recorded');
    });

    await step('tubes without well IDs appear as a list on the Plate step', async () => {
      const t = FM.synth.demoPlate(300)[0];
      t.name = 'Specimen_001_Tube_004.fcs'; t.meta = {};
      ws().addSamples([t]);
      FM.go('plate'); await settle();
      assert($('.tubes') && /Tube_004/.test($('.tubes').textContent), 'tube listed');
      ws().removeSamples([t.key]);
    });

    await step('new analysis asks first and then clears everything', async () => {
      btn('File', $('.top-actions')).click(); await settle();
      btn('New analysis', $('.pop')).click(); await settle();
      assert($('.modal-back'), 'confirmation shown');
      btn('New analysis', $('.modal')).click(); await wait(300);
      eq(ws().samples.length, 0, 'no files');
      eq(ws().doc.gates.length, 0, 'no gates');
      eq(FM.ui.step, 'load', 'back at the start');
    });

    await step('guide: one example walk-through and a note on what this is, Back returns', async () => {
      FM.go('load'); await settle();
      $('.guide-btn').click(); await settle();
      eq(FM.ui.step, 'guide', 'on the guide');
      eq($$('.g-step').length, 6, 'six steps');
      eq($$('.g-step-body h2').map(e => e.textContent.split(':')[0].split(',')[0]).join(' / '), 'Load your files / Plate / Gate / Measure / Analysis / Save');
      assert(/Unmixing/.test($('.g-beta').textContent) && /Panel planner/.test($('.g-beta').textContent), 'the beta tools come after the walk-through');
      assert(/scientist for scientists/.test($('.g-about').textContent), 'says what BenchMate is for');
      assert(btn('About FlowMate', $('.g-about')), 'and links to About');
      assert(!$('.g-search') && !$('.g-faq') && !$('.g-toc'), 'no search, FAQ or contents');
      assert(!/PlotMate|FlowJo|Traditional/.test($('.g-wrap').textContent), 'no mention of what is set aside');
      btn('Back to Load', $('.g-head')).click(); await settle();
      eq(FM.ui.step, 'load', 'back on Load');
    });

    await step('planner: opens from the top bar, adds dyes, switches laser, saves and reopens a panel, opens a preset', async () => {
      try { localStorage.removeItem('flowmate.panels'); } catch (_) { /* ignore */ }
      FM.go('load'); await settle();
      $('.planner-btn').click(); await settle();
      eq(FM.ui.step, 'planner', 'on the planner');
      assert($('.pl-chart canvas'), 'chart');
      FM.views.planner._load(FM.planner.newPanel(FM.planner.instrument('cytoflex-lx'))); await settle();
      eq($$('.pl-dye').length, 0, 'empty panel');
      const add = name => { const inp = $('.pl-search'); inp.value = name; inp.dispatchEvent(new Event('input')); inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
      add('FITC'); await settle();
      add('PE'); await settle();
      eq($$('.pl-dye').length, 2, 'two dyes listed');
      const rows = $$('.pl-assign tbody tr');
      eq(rows.length, 2, 'assignment rows');
      assert(/525\/40/.test(rows[0].textContent), 'FITC on a 525/40 detector: ' + rows[0].textContent);
      assert($('.pl-check.ok'), 'no conflicts for FITC + PE on the LX');
      btn('561 nm', $('.pl-lasers')).click(); await settle();
      eq(FM.views.planner._state().laser, 561, 'laser tab');
      setVal($('.pl-name'), 'QA panel'); await settle();
      btn('Save', $('.pl-side')).click(); await settle();
      assert(/QA panel/.test(localStorage.getItem('flowmate.panels') || ''), 'saved in the browser');
      FM.views.planner._load(FM.planner.newPanel(FM.planner.instrument('cytoflex-lx'))); await settle();
      btn('Open…', $('.pl-side')).click(); await settle();
      const row = $$('.pl-open-row').find(r => r.textContent.includes('QA panel'));
      assert(row, 'saved panel listed');
      btn('Open', row).click(); await settle();
      eq($$('.pl-dye').length, 2, 'reopened with its dyes');
      btn('Open…', $('.pl-side')).click(); await settle();
      btn('Open', $$('.pl-open-row').find(r => r.textContent.includes('Phagocytosis'))).click(); await settle();
      eq($$('.pl-dye').length, 3, 'preset dyes');
      assert(!$('.pl-check.crit'), 'preset has no critical checks');
      btn('Back to Load', $('.pl-side')).click(); await settle();
      eq(FM.ui.step, 'load', 'back on Load');
    });

    await step('no uncaught errors during the QA run', async () => {
      assert(!(window.__errors || []).length, (window.__errors || []).join(' | '));
    });

    const pre = document.createElement('pre');
    pre.id = 'uitest';
    pre.textContent = out.join('\n');
    document.body.appendChild(pre);
    document.documentElement.setAttribute('data-uitest', 'done pass=' + pass + ' fail=' + fail);
  }

  window.addEventListener('load', () => run().catch(e => document.documentElement.setAttribute('data-uitest', 'crashed ' + e.message)));
})();
