/* Adversarial QA for the Layout page and the gating table.
 *
 * The happy paths live in ui_selftest.js. This one goes after the states that tend to break
 * a new view: nothing to show, one of everything, far too many, things deleted underneath
 * it, and undo crossing between features. Same reporting contract as ui_selftest.js, so
 * `bash tests/run_ui.sh qa_layout.js` runs it. */
(function () {
  'use strict';
  const out = [];
  let pass = 0, fail = 0;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const settle = () => wait(90);
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const btn = (text, r) => $$('button', r).find(b => b.textContent.replace(/\s+/g, ' ').trim().includes(text));
  function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
  function eq(a, b, m) { if (a !== b) throw new Error((m ? m + ': ' : '') + 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function key(k, extra) { document.body.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra || {}))); }
  async function step(name, fn) {
    try { await fn(); pass++; out.push('PASS ' + name); }
    catch (e) { fail++; out.push('FAIL ' + name + '\n     ' + (e && e.message)); }
  }
  const ws = () => FM.ws;
  const errsBefore = () => (window.__errors || []).length;

  /** A clean workspace with `n` synthetic wells and no analysis. */
  function freshPlate(samples) {
    ws().samples = [];
    ws().loadDoc(FM.workspaceUtil.defaultDoc());
    ws().undoStack = []; ws().redoStack = [];
    ws().addSamples(samples);
    FM.setUI({ sampleKey: null, popId: null, gateId: null, wellSel: [], gateScope: 'all' });
    FM.bus.emit('ws:samples', {});
  }

  function rangeGate(name, parent, param) {
    return ws().addGate({ name, parent: parent || null, type: 'range', x: param || 'FSC-H',
      xScale: ws().scaleSpec(param || 'FSC-H'), range: { lo: 0, hi: 1e9 } });
  }

  async function run() {
    await wait(300);

    // ------------------------------------------------- nothing to show yet
    await step('empty: the table says what to do instead of rendering a bare grid', async () => {
      freshPlate(FM.synth.demoPlate(200));
      FM.go('gate'); await settle();
      FM.setUI({ bottomTab: 'table' }); await settle();
      assert($('.gt-empty'), 'an explanation is shown');
      assert(!$('table.gt'), 'and no empty table');
      assert(/gate/i.test($('.gt-empty').textContent), $('.gt-empty').textContent);
    });

    await step('empty: the layout page opens with no gates and offers All events', async () => {
      const e0 = errsBefore();
      FM.go('layout'); await settle();
      assert($('.lay-page'), 'the page is there');
      assert(/empty/i.test($('.lay-hint').textContent), 'and says it is empty');
      FM.views.layout._add(); await settle();
      const opts = $$('.modal-back select')[0];
      assert(opts, 'the add dialog opened');
      assert(/All events/.test(opts.textContent), 'All events is offered with no gates drawn');
      btn('Add', $('.modal-back')).click();
      await wait(700);
      eq(ws().layout().items.length, 18, 'a plot per well of the ungated data');
      eq(errsBefore(), e0, 'no errors raised');
    });

    // ------------------------------------------------------- a single well
    await step('one well: table, median and layout all behave with n = 1', async () => {
      const e0 = errsBefore();
      freshPlate(FM.synth.demoPlate(300).slice(0, 1));
      eq(ws().samples.length, 1);
      const a = rangeGate('A');
      FM.go('gate'); await settle();
      FM.setUI({ bottomTab: 'table' }); await settle();
      eq($$('.gt tbody .gt-row').length, 1, 'one row');
      assert($('.gt-med'), 'a median of one is still a median');
      FM.go('layout'); await settle();
      ws().addLayoutItems([{ kind: 'plot', sample: ws().samples[0].key, pop: a, ax: 'FSC-H', ay: 'SSC-H' }]);
      ws().tidyLayout();
      FM.views.layout.update('ws:layout'); await wait(300);
      eq($$('.lay-item').length, 1);
      eq(errsBefore(), e0, 'no errors raised');
    });

    // ----------------------------------------------------- quadrants
    await step('quadrants: four columns that still sum to their parent, and move as one', async () => {
      freshPlate(FM.synth.demoPlate(500));
      const cells = rangeGate('Cells');
      const ids = ws().addQuadrant({ parent: cells, x: 'FSC-H', y: 'SSC-H',
        xScale: ws().scaleSpec('FSC-H'), yScale: ws().scaleSpec('SSC-H'), cx: 300000, cy: 300000 });
      FM.go('gate'); await settle();
      FM.setUI({ bottomTab: 'table' }); await settle();
      eq($$('.gt thead .gt-h').length, 5, 'Cells plus four corners');
      const s = ws().samples[0];
      const sum = ids.reduce((n, i) => n + ws().count(s, i), 0);
      eq(sum, ws().count(s, cells), 'the corners partition the parent exactly');

      // adjusting one corner must move the whole crosshair, and mark all four
      ws().setGateOverride(ids[1], s.key, { quad: { cx: 500000, cy: 500000 } });
      await settle();
      ids.forEach(i => assert(ws().isAdjusted(i, s.key), 'every corner of the quadrant is adjusted'));
      eq(ids.reduce((n, i) => n + ws().count(s, i), 0), ws().count(s, cells), 'and they still partition it');
      const row = $$('.gt tbody .gt-row').find(r => r.querySelector('.gt-well').textContent.trim() === s.key);
      eq($$('.gt-v.st-adjusted', row).length, 4, 'all four cells read as adjusted');
    });

    // ------------------------------------------------------ excluded wells
    await step('excluded wells are struck through and kept out of the median', async () => {
      freshPlate(FM.synth.demoPlate(400));
      const a = rangeGate('A');
      const victim = ws().samples[0].key;
      ws().setExcluded([victim], true, 'qa');
      FM.go('gate'); await settle();
      FM.setUI({ bottomTab: 'table' }); await settle();
      const row = $$('.gt tbody .gt-row').find(r => r.querySelector('.gt-well').textContent.trim() === victim);
      assert(row.classList.contains('excl'), 'the row is marked excluded');
      const t = FM.summary.build(ws());
      const included = t.rows.filter(r => !r.excluded).map(r => r.cells[0].value);
      eq(included.length, ws().samples.length - 1, 'the median is taken over the rest');
      void a;
    });

    // ------------------------------------- things deleted underneath the page
    await step('removing a well leaves its plot explained, not broken', async () => {
      freshPlate(FM.synth.demoPlate(300));
      const e0 = errsBefore();
      const doomed = ws().samples[0].key;
      ws().addLayoutItems(ws().samples.slice(0, 3).map(s => ({ kind: 'plot', sample: s.key, pop: null, ax: 'FSC-H', ay: 'SSC-H' })));
      FM.go('layout'); await wait(400);
      eq($$('.lay-item').length, 3);
      ws().removeSamples([doomed]);
      FM.bus.emit('ws:samples', {});
      await wait(400);
      assert($('.lay-broken'), 'the orphaned plot explains itself');
      assert(/not loaded/i.test($('.lay-broken').textContent), $('.lay-broken').textContent);
      eq(errsBefore(), e0, 'and nothing threw');
    });

    // --------------------------------------------------------- undo crossing
    await step('undo walks back across layout and per-well edits in order', async () => {
      freshPlate(FM.synth.demoPlate(300));
      const a = rangeGate('A');
      const k = ws().samples[0].key;
      ws().setGateOverride(a, k, { range: { lo: 0, hi: 1 } });
      ws().addLayoutItems([{ kind: 'text', text: 'Panel A' }]);
      ws().tidyLayout();
      eq(ws().layout().items.length, 1);
      assert(ws().isAdjusted(a, k), 'adjusted');
      ws().undo();                       // tidy
      ws().undo();                       // add item
      eq(ws().layout().items.length, 0, 'the item is gone');
      assert(ws().isAdjusted(a, k), 'the adjustment is still there');
      ws().undo();                       // override
      assert(!ws().isAdjusted(a, k), 'and one more step removes it');
      ws().redo();
      assert(ws().isAdjusted(a, k), 'redo restores it');
    });

    // ---------------------------------------------------------- a big plate
    await step('96 wells: the table and a full page render in reasonable time', async () => {
      const e0 = errsBefore();
      freshPlate(FM.synth.bigPlate(8, 12, 300));
      eq(ws().samples.length, 96);
      const cells = rangeGate('Cells');
      rangeGate('Sub', cells, 'SSC-H');
      FM.go('gate'); await settle();
      const t0 = performance.now();
      FM.setUI({ bottomTab: 'table' });
      await wait(400);
      const tTable = performance.now() - t0;
      eq($$('.gt tbody .gt-row').length, 96, 'every well has a row');
      assert(tTable < 4000, 'the table appeared in ' + Math.round(tTable) + ' ms');

      FM.go('layout'); await settle();
      const t1 = performance.now();
      const g = ws().gridSize(true);
      ws().addLayoutItems(ws().samples.map(s => ({ kind: 'plot', sample: s.key, pop: cells, ax: 'FSC-H', ay: 'SSC-H', title: s.well, w: g.w, h: g.h })));
      ws().tidyLayout();
      FM.views.layout.update('ws:layout');
      await wait(2500);
      const tPage = performance.now() - t1;
      eq($$('.lay-item').length, 96, '96 plots on the page');
      const L = ws().layout();
      L.items.forEach(it => assert(it.x + it.w <= L.page.w + 0.5 && it.y + it.h <= L.page.h + 0.5, it.title + ' stays on the page'));
      assert(tPage < 20000, 'the page filled in ' + Math.round(tPage) + ' ms');
      eq(errsBefore(), e0, 'no errors raised');
      out.push('       (96 wells: table ' + Math.round(tTable) + ' ms, page ' + Math.round(tPage) + ' ms)');
    });

    // ------------------------------------------------------------ dark mode
    await step('dark mode redraws both new surfaces without errors', async () => {
      const e0 = errsBefore();
      FM.ui.theme = 'dark';
      document.documentElement.setAttribute('data-theme', 'dark');
      FM.plot.invalidateTheme();
      FM.bus.emit('theme');
      await wait(900);
      assert($$('.lay-item').length > 0, 'the page still has its items');
      FM.go('gate'); await settle();
      FM.setUI({ bottomTab: 'table' }); await wait(400);
      assert($('table.gt'), 'the table still renders');
      eq(errsBefore(), e0, 'no errors raised');
      FM.ui.theme = 'light';
      document.documentElement.setAttribute('data-theme', 'light');
      FM.plot.invalidateTheme(); FM.bus.emit('theme');
      await wait(400);
    });

    // ------------------------------------------- page size and text editing
    await step('changing the page size re-tidies without losing anything', async () => {
      freshPlate(FM.synth.demoPlate(250));
      rangeGate('A');
      FM.go('layout'); await settle();
      const g = ws().gridSize(true);
      ws().addLayoutItems(ws().samples.map(s => ({ kind: 'plot', sample: s.key, pop: null, ax: 'FSC-H', ay: 'SSC-H', title: s.well, w: g.w, h: g.h })));
      ws().tidyLayout();
      FM.views.layout.update('ws:layout'); await wait(500);
      const n = ws().layout().items.length;
      ws().setPage({ w: 794, h: 1123, preset: 'a4-portrait' });
      ws().tidyLayout();
      FM.views.layout.update('ws:layout'); await wait(500);
      eq(ws().layout().items.length, n, 'nothing was lost');
      const L = ws().layout();
      L.items.forEach(it => assert(it.x + it.w <= L.page.w + 0.5, it.title + ' fits the narrower page'));
    });

    await step('keyboard: Ctrl+A selects all, Escape clears, Delete removes', async () => {
      FM.go('layout'); await settle();
      const n = ws().layout().items.length;
      key('a', { ctrlKey: true }); await settle();
      eq(FM.views.layout._sel().size, n, 'all selected');
      key('Escape'); await settle();
      eq(FM.views.layout._sel().size, 0, 'cleared');
      key('a', { ctrlKey: true }); await settle();
      key('Delete'); await wait(300);
      eq(ws().layout().items.length, 0, 'the page is empty');
      key('z', { ctrlKey: true }); await wait(300);
      eq(ws().layout().items.length, n, 'and undo brings the whole page back');
    });

    await step('no uncaught errors during the whole QA run', async () => {
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
