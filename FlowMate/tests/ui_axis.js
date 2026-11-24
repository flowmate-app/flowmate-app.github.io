/* UI test: an axis transform belongs to one plot — changing it leaves other plots alone, survives
 * Fit and undo, and "use for every plot" makes it the channel's. Run with: bash tests/run_ui.sh ui_axis.js */
(function () {
  'use strict';
  const out = [];
  let pass = 0, fail = 0;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
  const eq = (a, b, m) => assert(a === b, (m ? m + ': ' : '') + 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
  async function step(name, fn) {
    try { await fn(); pass++; out.push('PASS ' + name); }
    catch (e) { fail++; out.push('FAIL ' + name + '\n     ' + (e && e.message)); }
  }
  async function run() {
    await wait(300);
    FM.loadDemo();
    const p = FM.presets.byId('phagocytosis');
    FM.presets.apply(FM.ws, p, { mapping: FM.presets.autoMap(p, FM.ws.paramNames()), layout: true, replace: true });
    FM.go('gate'); await wait(300);
    const ws = FM.ws, cells = ws.popIdByName('THP Cells'), P = 'SSC-A';
    const base = ws.scaleSpec(P).type;
    const other = base === 'log' ? 'lin' : 'log';

    await step('changing the transform in one plot leaves the other plots alone', async () => {
      FM.axisUI.setPlotType(P, other, null); await wait(200);
      eq(ws.viewScale(null, P).type, other, 'this plot');
      eq(ws.viewScale(cells, P).type, base, 'another plot');
      eq(ws.scaleSpec(P).type, base, 'the channel default');
    });
    await step('Fit keeps the plot’s own transform', async () => {
      ws.refitView(null, [P]); await wait(100);
      eq(ws.viewScale(null, P).type, other);
    });
    await step('undo puts it back', async () => {
      ws.undo(); await wait(200);
      eq(ws.viewScale(null, P).type, base);
      ws.redo(); await wait(200);
      eq(ws.viewScale(null, P).type, other);
    });
    await step('the popover changes this plot only, and "use for every plot" applies everywhere', async () => {
      const anchor = document.body.appendChild(document.createElement('button'));
      FM.axisUI.open(anchor, P, cells); await wait(200);
      const pop = document.querySelector('.axis-pop');
      assert(/this plot only/.test(pop.textContent), 'says it applies to this plot');
      [...pop.querySelectorAll('.seg button')].find(b => b.textContent === 'Logicle').click(); await wait(200);
      eq(ws.viewScale(cells, P).type, 'logicle', 'cells plot');
      eq(ws.viewScale(null, P).type, other, 'all-events plot unchanged');
      const use = [...document.querySelectorAll('.axis-pop a')].find(a => /every plot/.test(a.textContent));
      assert(use, 'a "use for every plot" link'); use.click(); await wait(200);
      eq(ws.scaleSpec(P).type, 'logicle', 'channel');
      eq(ws.viewScale(null, P).type, 'logicle', 'all-events plot follows');
      document.body.click();
    });
    await step('gates keep their counts through all of it', async () => {
      const s = FM.currentSample();
      assert(ws.count(s, cells) > 0, 'cells still counted');
    });
    await step('no uncaught errors', async () => { assert(!(window.__errors || []).length, (window.__errors || []).join(' | ')); });
    const pre = document.createElement('pre'); pre.id = 'uitest'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
    document.documentElement.setAttribute('data-uitest', 'done pass=' + pass + ' fail=' + fail);
  }
  window.addEventListener('load', () => run().catch(e => document.documentElement.setAttribute('data-uitest', 'crashed ' + e.message)));
})();
