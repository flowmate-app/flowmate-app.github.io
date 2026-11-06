/* Scripted UI test for FlowMate 0.2: Workspace, ellipse and Boolean gates, the new-gate scope
 * switch, Tables, Compensation and the FlowJo / Gating-ML dialogs. Run: bash tests/run_ui.sh ui_v1.js */
(function () {
  'use strict';
  const out = [];
  let pass = 0, fail = 0;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const settle = () => wait(90);
  const until = async (ok, ms) => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < (ms || 4000)) await wait(50); };
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const btn = (text, r) => $$('button', r).find(b => b.textContent.replace(/\s+/g, ' ').trim().includes(text));
  function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
  function eq(a, b, m) { if (a !== b) throw new Error((m || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
  function ptr(el, type, x, y, extra) {
    el.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0,
      buttons: type === 'pointerup' ? 0 : 1, pointerId: 9, pointerType: 'mouse', isPrimary: true }, extra || {})));
  }
  function key(k) { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); }
  async function step(name, fn) {
    try { await fn(); pass++; out.push('PASS ' + name); }
    catch (e) { fail++; out.push('FAIL ' + name + '\n     ' + (e && e.message)); }
  }
  function plotPx(tx, ty) {
    const pv = FM.views.gate._plotView();
    const r = pv.overCv.getBoundingClientRect();
    const [x, y] = FM.plot.toPx(pv.L, tx, ty);
    return [r.left + x, r.top + y];
  }
  async function drag(a, b) {
    const cv = FM.views.gate._plotView().overCv;
    const [x0, y0] = plotPx(a[0], a[1]), [x1, y1] = plotPx(b[0], b[1]);
    ptr(cv, 'pointerdown', x0, y0); await wait(20);
    for (let i = 1; i <= 6; i++) { ptr(cv, 'pointermove', x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6); await wait(16); }
    ptr(cv, 'pointerup', x1, y1); await settle();
  }
  const ws = () => FM.ws;
  const asFile = async (path, name, type) => new File([await (await fetch(path)).arrayBuffer()], name, { type: type || 'application/octet-stream' });

  async function run() {
    await wait(300);

    await step('workspace: empty, it is the Load screen with the FlowJo option', async () => {
      FM.go('workspace'); await settle();
      eq(FM.ui.step, 'workspace');
      eq(FM.views.workspace._mode(), 'load', 'load mode');
      assert(btn('Open a FlowJo workspace'), 'FlowJo card');
    });

    await step('workspace: with samples it becomes the sample table, groups and preview', async () => {
      FM.loadDemo();
      const p = FM.presets.byId('phagocytosis');
      FM.presets.apply(ws(), p, { mapping: FM.presets.autoMap(p, ws().paramNames()), layout: true, replace: true });
      await wait(200);
      eq(FM.views.workspace._mode(), 'table', 'table mode');
      eq($$('.wsv-group').length, 1 + ws().doc.groups.length, 'All samples + one row per group');
      eq($$('.wsv-sample').length, 18, 'one row per sample');
      assert($('.wsv-plot canvas'), 'preview plot');
    });

    await step('workspace: expanding a sample shows its population tree with % and counts', async () => {
      FM.views.workspace._toggle('A1'); await settle();
      const rows = $$('.wsv-pop[data-key="A1"]');
      eq(rows.length, ws().doc.gates.length, 'one row per gate');
      assert(/%/.test(rows[0].textContent), 'shows a %');
    });

    await step('workspace: clicking a group filters the table', async () => {
      const g = ws().doc.groups[0];
      $('.wsv-group[data-gid="' + g.id + '"]').click(); await settle();
      eq($$('.wsv-sample').length, ws().samplesIn(g.id).length, 'only that group');
      $('.wsv-group[data-gid=""]').click(); await settle();
      eq($$('.wsv-sample').length, 18, 'back to all');
    });

    await step('workspace: dropping a population on a group scopes its gate there; undo restores', async () => {
      const gate = ws().doc.gates[0];
      const g = ws().groupOf('A1');
      FM.views.workspace._dropPop(gate.id, g.id, true); await settle();
      assert(ws().applies(gate.id, 'A1') && !ws().applies(gate.id, 'B1'), 'A1 has it, B1 does not');
      assert(Number.isNaN(ws().count(ws().sample('B1'), gate.id)), 'B1 reads NaN, not 0');
      FM.views.workspace._toggle('B1'); await settle();
      eq($$('.wsv-pop[data-key="B1"]').length, 0, 'B1 shows no populations from that branch');
      ws().undo(); await settle();
      assert(ws().applies(gate.id, 'B1'), 'undo: every sample again');
    });

    await step('workspace: dropping samples on a group moves them', async () => {
      const target = ws().groupOf('B1');
      FM.views.workspace._dropSamples(['A1'], target.id); await settle();
      eq(ws().groupOf('A1').id, target.id);
      ws().undo(); await settle();
      assert(ws().groupOf('A1').id !== target.id, 'undo');
    });

    await step('workspace: double-clicking a population opens it on the Gate step', async () => {
      const gate = ws().doc.gates[0];
      FM.views.workspace._open('A2', gate.id); await settle();
      eq(FM.ui.step, 'gate');
      eq(FM.ui.sampleKey, 'A2');
      eq(FM.ui.popId, gate.id, 'plots the events inside that population');
    });

    await step('gate: the ellipse tool draws an ellipse; its handle stretches and turns it', async () => {
      FM.setUI({ popId: null, gateId: null, tool: 'select' });
      ws().setView(null, { x: 'FSC-H', y: 'SSC-H' }); await settle();
      const n0 = ws().doc.gates.length;
      key('e'); await settle();
      eq(FM.ui.tool, 'ellipse');
      await drag([0.25, 0.25], [0.65, 0.55]);
      eq(ws().doc.gates.length, n0 + 1, 'one gate added');
      const g = ws().gate(FM.ui.gateId);
      eq(g.type, 'ellipse');
      assert(ws().count(ws().sample('A2'), g.id) > 0, 'catches events');
      const rx0 = g.ellipse.rx;
      const h0 = FM.gating.ellipseHandles(g)[0];
      const pv = FM.views.gate._plotView();
      const xs = FM.transforms.makeScale(pv.scales().xSpec), gx = FM.transforms.makeScale(g.xScale);
      const ys = FM.transforms.makeScale(pv.scales().ySpec), gy = FM.transforms.makeScale(g.yScale);
      const at = [xs.fwd(gx.inv(h0[0])), ys.fwd(gy.inv(h0[1]))];
      await drag(at, [at[0] + 0.08, at[1] + 0.05]);
      const g2 = ws().gate(g.id);
      assert(g2.ellipse.rx > rx0 * 1.05, 'wider (' + rx0.toFixed(3) + ' → ' + g2.ellipse.rx.toFixed(3) + ')');
      assert(Math.abs(g2.ellipse.angle) > 0.02, 'and turned');
    });

    await step('gate: "New gates on: This sample" makes a sample-only gate', async () => {
      FM.setUI({ newScope: 'sample', gateId: null }); await settle();
      assert($('.new-scope'), 'the switch is there');
      key('r'); await settle();
      await drag([0.6, 0.6], [0.8, 0.8]);
      const g = ws().gate(FM.ui.gateId);
      eq(g.type, 'rect');
      eq(JSON.stringify(g.scope), JSON.stringify({ samples: ['A2'] }), 'scoped to A2');
      assert(Number.isNaN(ws().count(ws().sample('A3'), g.id)), 'not on A3');
      FM.setUI({ newScope: 'all' });
    });

    await step('gate: Combine makes an AND gate whose count is the intersection', async () => {
      const ell = ws().doc.gates.find(g => g.type === 'ellipse');
      const cells = ws().doc.gates[0];
      FM.combineDialog([cells.id, ell.id]); await settle();
      assert($('.modal'), 'dialog open');
      btn('Add gate', $('.modal')).click(); await settle();
      const b = ws().doc.gates.find(g => g.type === 'bool');
      assert(b, 'a Boolean gate exists');
      const s = ws().sample('A2');
      const A = new Set(Array.from(ws().indices(s, cells.id))), E = Array.from(ws().indices(s, ell.id));
      eq(ws().count(s, b.id), E.filter(e => A.has(e)).length, 'count = |Cells ∩ ellipse|');
      assert($$('.tnode').some(n => n.textContent.includes(b.name)), 'shown in the population tree');
    });

    await step('gate: shift-click wells on the filmstrip, export them as figures, each with its own title', async () => {
      FM.go('gate'); FM.setUI({ wellSel: [], gateId: null }); await settle();
      const tiles = $$('.thumb');
      tiles[0].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      await settle();
      $$('.thumb')[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      await settle();
      eq(FM.ui.wellSel.length, 2, 'two wells picked');
      eq($$('.thumb.picked').length, 2, 'the tiles show it');
      const [k1, k2] = FM.ui.wellSel;
      btn('Figures…', $('.sel-bar')).click(); await settle();
      const dlg = $('.modal');
      assert(dlg && /Export plots as figures/.test(dlg.textContent), 'dialog open');
      eq($$('.wf-row', dlg).length, ws().samples.length, 'every well listed');
      eq($$('.wf-row input[type=checkbox]', dlg).filter(c => c.checked).length, 2, 'the two picked wells are ticked');
      const rows = $$('.wf-row', dlg).filter(r => r.querySelector('input[type=checkbox]').checked);
      const t1 = rows[0].querySelector('.wf-title');
      assert(/·/.test(t1.value), 'default title is well · condition: ' + t1.value);
      t1.value = 'Donor A, stimulated'; t1.dispatchEvent(new Event('input'));
      btn('One image per well', dlg).click(); await settle();
      const saved = [];
      const real = FM.dom.download;
      FM.dom.download = (name, blob) => saved.push({ name, blob });
      try {
        btn('Export 2 images', dlg).click(); await until(() => saved.length >= 2);
        eq(saved.length, 2, 'two files');
        assert(saved.some(f => f.name === 'Donor A, stimulated.png'), 'the typed title names the file: ' + saved.map(f => f.name).join(', '));
        assert(saved.every(f => f.blob.size > 5000 && f.blob.type === 'image/png'), 'real PNGs');
        eq(FM.lastFigureExport[0].canvas.width, 400 * 3, 'medium size at 3× for print');
        // again, as one figure with a figure title
        FM.views.gate._figures(); await settle();
        const d2 = $$('.modal').pop();
        eq($$('.wf-row input[type=checkbox]', d2).filter(c => c.checked).length, 2, 'the selection is still ticked');
        assert($$('.wf-title', d2).some(i => i.value === 'Donor A, stimulated'), 'titles are remembered');
        btn('One figure', d2).click(); await settle();
        const ft = $('.wf-gridopts input', d2); ft.value = 'Bead uptake'; ft.dispatchEvent(new Event('input'));
        saved.length = 0;
        btn('Export one figure', d2).click(); await until(() => saved.length >= 1);
        eq(saved.length, 1, 'one file');
        eq(saved[0].name, 'Bead uptake.png');
        assert(FM.lastFigureExport[0].canvas.width > 2 * 400 * 3, 'two panels side by side');
      } finally { FM.dom.download = real; }
      assert(!$('.modal'), 'dialogs closed');
      FM.setUI({ wellSel: [] });
      void k1; void k2;
    });

    await step('tables: quick table, every sample a row, CSV export', async () => {
      FM.go('tables'); await settle();
      FM.views.tables._quick(); await settle();
      const t = ws().doc.tables[ws().doc.tables.length - 1];
      eq(t.columns.length, 2 * ws().doc.gates.length, 'count + % for every gate');
      eq($$('.tbv-table tbody tr').length, 18, 'one row per sample');
      FM.views.tables._export(); await settle();
      assert(/^Sample,Group,/.test(FM.lastTableCSV), 'CSV header: ' + (FM.lastTableCSV || '').slice(0, 60));
      eq(FM.lastTableCSV.trim().split(/\r?\n/).length, 19, 'header + 18 rows');
    });
    await step('tables: Send to PlotMate → Copy gives a hand-off of the table', async () => {
      btn('Send to PlotMate').click(); await settle();
      $$('.pop .menu-item').find(b => /Copy for PlotMate/.test(b.textContent)).click(); await settle();
      assert(FM.lastHandoff && FM.lastHandoff.indexOf('{"benchmate":"handoff/1"') === 0, 'marker');
      const p = BMH.parse(FM.lastHandoff);
      const t = ws().doc.tables[ws().doc.tables.length - 1];
      const groups = new Set(FM.statTables.build(ws(), t).rows.filter(r => !r.excluded && r.group).map(r => r.group));
      if (groups.size >= 2) { eq(p.tables.length, t.columns.length, 'one Column table per statistic'); eq(p.tables[0].sets.length, groups.size, 'groups as data sets'); }
      else { eq(p.tables.length, 1); eq(p.tables[0].kind, 'multivar'); eq(p.tables[0].sets.length, t.columns.length, 'statistics as variables'); }
    });

    await step('comp: demo controls, the wizard recovers the spillover and applies it; undo', async () => {
      FM.go('comp'); await settle();
      FM.views.comp._demo(); await wait(200);
      FM.views.comp._wizard(); await settle();
      assert($('.modal .cpv-wiz'), 'wizard open');
      btn('Create and apply', $('.modal')).click(); await settle();
      const c = ws().doc.comp;
      const m = FM.comp.matrixById(ws(), c.active);
      assert(m && m.source === 'computed', 'a computed matrix is active');
      const truth = FM.synth.compControls(10).spill;
      const i1 = m.params.indexOf('FL1-A'), i2 = m.params.indexOf('FL2-A');
      assert(Math.abs(m.spill[i1][i2] - truth[0][1]) < 0.015, 'FL1 → FL2 ≈ ' + truth[0][1] + ' (got ' + m.spill[i1][i2].toFixed(3) + ')');
      assert(ws().sample('Mixed.fcs').compensated, 'the mixed sample is compensated');
      assert($$('.cpv-cell').length >= 9, 'matrix grid rendered');
      ws().undo(); await settle();
      eq(ws().doc.comp.active, 'file', 'undo puts the files’ own matrices back');
    });

    await step('import: FlowJo workspace through the dialog, with its FCS file — report shows FlowJo vs FlowMate', async () => {
      const fcs = await asFile('public/flowjo/data_set_simple_line_100.fcs', 'data_set_simple_line_100.fcs');
      await FM.loadFiles([fcs]); await settle();
      const wsp = new File([await (await fetch('public/flowjo/single_ellipse_51_events.wsp')).text()], 'single_ellipse_51_events.wsp', { type: 'application/xml' });
      await FM.importDialogs.flowjo(wsp); await wait(250);
      const modal = $('.modal');
      assert(modal && /Imported single_ellipse_51_events\.wsp/.test(modal.textContent), 'report dialog');
      assert(/1 of 1 population counts within 0\.5 %/.test(modal.textContent), 'agreement line: ' + modal.textContent.slice(0, 300));
      const g = ws().doc.gates.find(x => x.name === 'ellipse1');
      assert(g && g.type === 'ellipse', 'ellipse1 imported as an ellipse');
      eq(ws().count(ws().samples.find(s => s.name === 'data_set_simple_line_100.fcs'), g.id), 51, 'FlowJo says 51');
      btn('Close', modal).click(); await settle();
      eq(FM.ui.step, 'workspace', 'lands on the Workspace');
    });

    await step('gating-ml: export writes every gate; importing it back adds them again', async () => {
      const n = ws().doc.gates.length;
      const r = FM.importDialogs.exportGatingml(); await settle();
      assert(/<gating:Gating-ML/.test(r.xml), 'Gating-ML document');
      const close = $('.modal') && btn('OK', $('.modal')); if (close) close.click();
      await FM.importDialogs.gatingml(new File([r.xml], 'roundtrip.xml', { type: 'application/xml' })); await settle();
      assert(ws().doc.gates.length >= 2 * n, 'gates doubled (' + n + ' → ' + ws().doc.gates.length + ')');
      const m = $('.modal'); if (m) btn('Close', m).click();
    });

    await step('example: the FlowJo example replaces the analysis (after asking) and explains itself', async () => {
      FM.importDialogs.flowjoExample(); await settle();
      const ask = $('.modal');
      assert(ask && /Open the example workspace/.test(ask.textContent), 'asks before replacing what is open');
      btn('Open the example', ask).click(); await wait(400);
      const rep = $('.modal');
      assert(rep && /Example: T-cell activation/.test(rep.textContent), 'the report opens');
      assert(/A FlowJo workspace/.test(rep.textContent) && /holds no data/.test(rep.textContent), 'it says what a workspace is');
      assert(/no counts saved by FlowJo/.test(rep.textContent), 'and that there is nothing to compare');
      assert(btn('Save the example files', rep), 'offers the files');
      btn('Close', rep).click(); await settle();
      eq(FM.ui.step, 'workspace');
      eq(ws().samples.length, 9, 'nine tubes');
      eq(ws().doc.groups.map(g => g.name).join(), 'Compensation,Unstimulated,SEB');
      eq(ws().doc.name, 'T-cell activation (FlowJo example)');
      assert($$('.wsv-pop').length >= 10, 'Donor1_SEB is expanded with its populations');
      FM.views.workspace._toggle(ws().samples.find(s => s.name === 'Donor2_SEB.fcs').key); await settle();
      assert($$('.wsv-pop .chip.adj').length >= 1, 'Donor2_SEB shows its own IFNg+ gate (✦)');
      eq(ws().undoStack.length, 0, 'opening the example is a fresh start, not an undo step');
    });

    await step('every new view renders without errors in dark mode too', async () => {
      document.documentElement.setAttribute('data-theme', 'dark'); FM.ui.theme = 'dark'; FM.plot.invalidateTheme(); FM.bus.emit('theme');
      for (const v of ['workspace', 'gate', 'tables', 'comp']) { FM.go(v); await settle(); }
      document.documentElement.removeAttribute('data-theme'); FM.ui.theme = 'system'; FM.plot.invalidateTheme(); FM.bus.emit('theme');
    });

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
