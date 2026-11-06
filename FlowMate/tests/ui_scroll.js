/* UI test: editing a gate must not scroll the Gate step's panels back to the top (the worksheet
 * rebuilds its grid on every change). Run with: bash tests/run_ui.sh ui_scroll.js */
(function () {
  'use strict';
  const out = [];
  let pass = 0, fail = 0;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const $ = (s, r) => (r || document).querySelector(s);
  function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
  async function step(name, fn) {
    try { await fn(); pass++; out.push('PASS ' + name); }
    catch (e) { fail++; out.push('FAIL ' + name + '\n     ' + (e && e.message)); }
  }
  const ws = () => FM.ws;
  /** Change a gate the way a drag does: move its first vertex a little. */
  function nudge(g) {
    if (g.verts) ws().updateGate(g.id, { verts: g.verts.map((v, i) => (i ? v : [v[0] * 1.01, v[1]])) });
    else if (g.rect) ws().updateGate(g.id, { rect: Object.assign({}, g.rect, { x0: g.rect.x0 * 1.01 }) });
    else ws().updateGate(g.id, { color: g.color === '#c2477c' ? '#3f6fd8' : '#c2477c' });
  }

  async function run() {
    await wait(300);
    FM.loadDemo();
    const p = FM.presets.byId('phagocytosis');
    FM.presets.apply(ws(), p, { mapping: FM.presets.autoMap(p, ws().paramNames()), layout: true, replace: true });
    FM.go('gate');
    await wait(300);

    await step('worksheet: editing a gate keeps the scroll position', async () => {
      FM.ui.gateLayout = 'sheet';
      FM.go('gate');
      await wait(200);
      // large plots, so the worksheet is taller than the screen
      const list = FM.gateSheet.items(ws(), { axesOf: () => ({ x: ws().paramNames()[0], y: ws().paramNames()[1] }) });
      ws().setSheet({ items: list.concat(list.filter(it => it.type !== 'stats').map((it, k) => Object.assign({}, it, { id: 'u:extra' + k, pop: null }))), hidden: [], size: 'l' }, 'Big sheet');
      await wait(300);
      const grid = $('.sheet-grid');
      assert(grid && grid.scrollHeight > grid.clientHeight + 100, 'worksheet overflows: ' + (grid && grid.scrollHeight) + ' vs ' + (grid && grid.clientHeight));
      grid.scrollTop = 300;
      await wait(50);
      nudge(ws().doc.gates[0]);
      await wait(300);
      const after = $('.sheet-grid');
      assert(after.scrollTop === 300, 'scrollTop after the edit: ' + after.scrollTop);
    });

    await step('single plot: editing a gate keeps the well panel scroll', async () => {
      FM.ui.gateLayout = 'single';
      FM.go('gate');
      await wait(300);
      const sc = $('.wells-panel .scroll');
      if (sc.scrollHeight <= sc.clientHeight) { out.push('     (well panel does not scroll at this size; checked nothing)'); return; }
      sc.scrollTop = sc.scrollHeight;
      const want = sc.scrollTop;
      nudge(ws().doc.gates[0]);
      await wait(300);
      assert($('.wells-panel .scroll').scrollTop === want, 'scrollTop ' + $('.wells-panel .scroll').scrollTop + ', was ' + want);
    });

    await step('no uncaught errors', async () => {
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
