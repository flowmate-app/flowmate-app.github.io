/* UI tests for event counts, the gating-strategy page and the tree table
 * (2026-09-26). Same reporting contract as ui_selftest.js:
 *   bash tests/run_ui.sh qa_pub.js
 */
(function () {
  'use strict';
  const out = [];
  let pass = 0, fail = 0;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const settle = () => wait(120);
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const btn = (text, r) => $$('button', r).find(b => b.textContent.replace(/\s+/g, ' ').trim().includes(text));
  function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
  function eq(a, b, m) { if (a !== b) throw new Error((m ? m + ': ' : '') + 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ptr(el, type, x, y) {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0,
      buttons: type === 'pointerup' ? 0 : 1, pointerId: 9, pointerType: 'mouse', isPrimary: true }));
  }
  function key(k, extra) { document.body.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra || {}))); }
  async function step(name, fn) {
    try { await fn(); pass++; out.push('PASS ' + name); }
    catch (e) { fail++; out.push('FAIL ' + name + '\n     ' + (e && e.message)); }
  }
  const ws = () => FM.ws;
  const chain = () => ws().layout().items.filter(i => i.kind === 'plot' && i.chain);

  async function run() {
    await wait(300);
    FM.loadDemo();
    const p = FM.presets.byId('phagocytosis');
    FM.presets.apply(ws(), p, { mapping: FM.presets.autoMap(p, ws().paramNames()), layout: true, replace: true });
    ws().undoStack = []; ws().redoStack = [];
    FM.setUI({ sampleKey: 'A1', popId: null, gateId: null });
    FM.go('gate');
    await wait(400);

    // ------------------------------------------------------------- counts
    await step('gate step: every gate label carries its event count', async () => {
      const pv = FM.views.gate._plotView();
      assert(pv.items && pv.items.length, 'gates are drawn');
      const s = ws().sample('A1');
      pv.items.forEach(it => eq(it.count, ws().count(s, it.id), it.gate.name + ' count'));
    });

    await step('gate step: the population tree shows events under each %', async () => {
      const nums = $$('.tree .tnums');
      eq(nums.length, ws().doc.gates.length, 'one per gate');
      const g = ws().doc.gates[0];
      const txt = $('.tcount', nums[0]).textContent;
      eq(txt, FM.dom.fmtCount(ws().count(ws().sample('A1'), g.id)), 'the count is the engine’s');
    });

    await step('plate panel: % · Events · Both switch what the heatmap and strips read', async () => {
      const g = ws().doc.gates[0];
      FM.setUI({ gateId: g.id }); await settle();
      const cellOf = well => $('.mini-plate .mp-cell[data-tip^="' + well + ' "]');
      btn('Events', $('.show-seg')).click(); await settle();
      eq(FM.ui.wellsShow, 'events');
      assert(/^Events in /.test($('.wells-panel h3').textContent), 'title says events');
      const n = ws().count(ws().sample('A2'), g.id);
      eq(cellOf('A2').textContent, FM.dom.fmtCount(n), 'the cell reads the exact event count');
      assert(/Events [\d,]+ – [\d,]+/.test($('.wells-summary').textContent), 'range line in events');
      btn('Both', $('.show-seg')).click(); await settle();
      assert($('.mp-p', cellOf('A2')) && $('.mp-n', cellOf('A2')), '% and events side by side in the cell');
      eq($('.mp-n', cellOf('A2')).textContent, FM.dom.fmtCount(n));
      assert($$('.strips.both .strip-n').length > 0, 'strips show the median events beside the median %');
      eq($$('.wells-summary div').length, 2, 'both range lines');
      btn('%', $('.show-seg')).click(); await settle();
      assert(/^% in /.test($('.wells-panel h3').textContent), 'back to %');
      assert(!$('.mp-n'), 'no counts in % mode');
      eq(JSON.parse(localStorage.getItem('flowmate.prefs') || '{}').wellsShow2, 'pct', 'the choice is remembered');
      FM.setUI({ gateId: null }); await settle();
    });

    // ----------------------------------------------------------- strategy
    await step('To figure → Gating strategy builds the chain with arrows and a table', async () => {
      btn('To figure').click(); await settle();
      btn('Gating strategy for A1').click();
      await wait(300);
      eq(FM.ui.step, 'layout', 'the layout page opened');
      assert($('.modal-back'), 'the strategy dialog is waiting');
      btn('Lay out', $('.modal-back .modal')).click();
      await wait(700);
      eq(chain().length, 3, 'three gating steps for the phagocytosis preset');
      eq(ws().layout().items.filter(i => i.kind === 'table').length, 1, 'with the summary table');
      eq(FM.views.layout._arrows().length, 2, 'two arrows');
      eq($$('.lay-links path').length, 4, 'drawn as a curve and a head each');
      const heads = chain().filter(i => i.head);
      eq(heads.length, 1);
      assert(/A1/.test($('.lay-item[data-id="' + heads[0].id + '"] .lay-title').textContent), 'the head names the well');
    });

    await step('the table item is drawn and its height follows its content', async () => {
      await wait(400);
      const t = ws().layout().items.find(i => i.kind === 'table');
      const cv = $('.lay-item[data-id="' + t.id + '"] canvas');
      assert(cv && cv.width > 100 && cv.height > 50, 'a canvas with content');
      const cssH = parseFloat(cv.style.height);
      assert(Math.abs(t.h - (cssH + 2)) <= 1.5, 'item height ' + t.h + ' matches the drawn table ' + cssH);
      const plotsBottom = Math.max(...chain().map(i => i.y + i.h));
      assert(t.y >= plotsBottom, 'below the plots');
    });

    await step('arrows follow a plot while it is dragged', async () => {
      const it = chain()[1];
      const y0 = it.y;
      const el = $('.lay-item[data-id="' + it.id + '"]');
      const d0 = $$('.lay-links path').map(p => p.getAttribute('d')).join('|');
      const r = el.getBoundingClientRect();
      const cv = $('.lay-canvas');
      ptr(el, 'pointerdown', r.left + r.width / 2, r.top + 30);
      for (let i = 1; i <= 4; i++) { ptr(cv, 'pointermove', r.left + r.width / 2, r.top + 30 + i * 25); await wait(20); }
      const dMid = $$('.lay-links path').map(p => p.getAttribute('d')).join('|');
      assert(dMid !== d0, 'the arrows moved mid-drag');
      ptr(cv, 'pointerup', r.left + r.width / 2, r.top + 130);
      await settle();
      assert(ws().layoutItem(it.id).y > y0, 'the plot moved');
      eq(FM.views.layout._arrows().length, 2, 'and is still joined up');
      key('z', { ctrlKey: true }); await settle();
    });

    await step('a gate drawn on the Gate step joins the chain; undo takes it back off', async () => {
      FM.go('gate'); await settle();
      const deep = ws().doc.gates[ws().doc.gates.length - 1];
      const n0 = chain().length;
      ws().addGate({ name: 'SSC split', parent: deep.id, type: 'range', x: 'SSC-H', xScale: ws().scaleSpec('SSC-H'), range: { lo: 0, hi: 1e9 } });
      FM.go('layout'); await wait(500);
      eq(chain().length, n0 + 1, 'one new plot');
      const added = chain().find(i => i.pop === deep.id);
      assert(added, 'showing the population the new gate was drawn in');
      eq(FM.views.layout._arrows().length, 3, 'with an arrow into it');
      const L = ws().layout();
      assert(added.x + added.w <= L.page.w + 0.5 && added.y + added.h <= L.page.h + 0.5, 'on the page');
      key('z', { ctrlKey: true }); await wait(300);
      eq(chain().length, n0, 'undo removes gate and plot together');
    });

    await step('the table switches to per well and copies as HTML + tab-separated text', async () => {
      const t = ws().layout().items.find(i => i.kind === 'table');
      ws().updateLayoutItem(t.id, { mode: 'well' }, { label: 'Table per well' });
      await wait(300);
      eq(ws().layoutItem(t.id).mode, 'well');
      const el = $('.lay-item[data-id="' + t.id + '"]');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20 }));
      await settle();
      FM.lastCopy = null;
      btn('Copy the table').click();
      await wait(300);
      assert(FM.lastCopy && /<table/.test(FM.lastCopy.html), 'HTML table copied');
      assert(/\t/.test(FM.lastCopy.text) && /A1/.test(FM.lastCopy.text), 'and TSV with a column per well');
      ws().updateLayoutItem(t.id, { mode: 'condition' }, { label: 'Table per condition' });
      await settle();
    });

    await step('the page exports as a PNG with tables and arrows', async () => {
      let saved = null;
      const orig = FM.dom.download;
      FM.dom.download = (name, data) => { saved = { name, data }; };
      FM.views.layout._png();
      for (let i = 0; i < 40 && !saved; i++) await wait(100);
      FM.dom.download = orig;
      assert(saved && saved.data && saved.data.size > 5000, 'a real image: ' + (saved && saved.data && saved.data.size));
    });

    // -------------------------------------------------------- publication
    await step('no uncaught errors during the run', async () => {
      assert(!(window.__errors || []).length, (window.__errors || []).join(' | '));
    });

    const pre = document.createElement('pre');
    pre.id = 'uitest';
    pre.textContent = out.join('\n');
    document.body.appendChild(pre);
    document.documentElement.setAttribute('data-uitest', 'done pass=' + pass + ' fail=' + fail);
  }

  window.addEventListener('load', () => run().catch(e => {
    document.documentElement.setAttribute('data-uitest', 'crashed ' + e.message);
  }));
})();
