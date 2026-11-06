/* Scripted UI test: drives the real app with synthetic pointer/keyboard events and
 * records PASS/FAIL lines into <pre id="uitest">; run_ui.sh reads them via --dump-dom. */
(function () {
  'use strict';
  const out = [];
  let pass = 0, fail = 0;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const settle = () => wait(80);
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const btn = (text, r) => $$('button', r).find(b => b.textContent.replace(/\s+/g, ' ').trim().includes(text));
  function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
  function ptr(el, type, x, y, extra) {
    el.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0,
      buttons: type === 'pointerup' ? 0 : 1, pointerId: 7, pointerType: 'mouse', isPrimary: true }, extra || {})));
  }
  function key(k, extra) { document.body.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra || {}))); }
  function setVal(el, v, ev) { el.value = v; el.dispatchEvent(new Event(ev || 'change', { bubbles: true })); }
  async function step(name, fn) {
    try { await fn(); pass++; out.push('PASS ' + name); }
    catch (e) { fail++; out.push('FAIL ' + name + '\n     ' + (e && e.message)); }
  }
  /** client px of display coords (tx, ty) on the gate plot */
  function plotPx(tx, ty) {
    const pv = FM.views.gate._plotView();
    const r = pv.overCv.getBoundingClientRect();
    const [x, y] = FM.plot.toPx(pv.L, tx, ty);
    return [r.left + x, r.top + y];
  }
  const ws = () => FM.ws;

  async function run() {
    await wait(300);
    FM.loadDemo();
    FM.go('plate');
    await settle();

    // ------------------------------------------------------------------ plate
    await step('plate: one condition per row assigns all 18 wells', async () => {
      btn('One condition per row').click();
      await settle();
      eq(ws().doc.groups.length, 6, 'groups');
      assert(ws().samples.every(s => ws().wellInfo(s.key).group), 'every well assigned');
    });
    await step('plate: rename a condition and mark the gate control', async () => {
      setVal($$('.group-name')[0], 'IgG1');
      await settle();
      setVal($$('.role-sel')[5], 'gate');
      await settle();
      eq(ws().doc.groups[0].name, 'IgG1');
      eq(ws().doc.groups[5].role, 'gate');
      assert(!$$('.role-sel option').some(o => o.value === 'control'), 'no reference-control role any more');
    });
    await step('plate: highlighted wells show their plots beside the plate, one each', async () => {
      assert(/Highlight wells or tubes/.test($('.plate-plots').textContent), 'empty hint');
      btn('B', $('.plate-grid')).click(); await settle();
      eq($$('.plate-plots .plot-card').length, 3, 'a plot per well of row B');
      eq($$('.plot-card .mono').map(e => e.textContent).join(), 'B1,B2,B3', 'in plate order');
      const ysel = $('.plots-head select[aria-label="Y axis"]');
      setVal(ysel, 'FL1-H'); await settle();
      eq($('.plots-head select[aria-label="Y axis"]').value, 'FL1-H', 'axis kept');
      eq($$('.plate-plots .plot-card').length, 3, 'still three');
      key('Escape'); await settle();
      eq($$('.plate-plots .plot-card').length, 0, 'cleared');
    });
    await step('plate: a space typed in a condition name stays a space', async () => {
      const inp = $$('.group-name')[0];
      inp.focus();
      const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      inp.dispatchEvent(ev);
      assert(!ev.defaultPrevented, 'the space is not swallowed');
      eq($$('.well.sel').length, 0, 'and does not highlight the wells');
      setVal(inp, 'IgG1 isotype'); await settle();
      eq(ws().doc.groups[0].name, 'IgG1 isotype');
      setVal($$('.group-name')[0], 'IgG1'); await settle();
    });
    await step('plate: highlight wells, Create condition, name it in place, then undo', async () => {
      const a1 = $('.well[data-key="A1"]'), a2 = $('.well[data-key="A2"]');
      const r1 = a1.getBoundingClientRect(), r2 = a2.getBoundingClientRect();
      ptr(a1, 'pointerdown', r1.left + 10, r1.top + 10);
      ptr(document, 'pointermove', r2.left + 10, r2.top + 10);
      ptr(document, 'pointerup', r2.left + 10, r2.top + 10);
      await settle();
      eq($$('.well.sel').length, 2, 'two wells highlighted');
      eq(ws().wellInfo('A1').group, ws().doc.groups[0].id, 'highlighting assigns nothing');
      const depth = ws().undoStack.length;
      btn('Create condition', $('.plate-sel')).click(); await settle();
      eq(ws().doc.groups.length, 7, 'a new condition');
      const g = ws().doc.groups[6];
      eq(ws().wellInfo('A1').group, g.id, 'A1 in it'); eq(ws().wellInfo('A2').group, g.id, 'A2 in it');
      eq(ws().undoStack.length, depth + 1, 'one undo step');
      const name = $('.cond-card .cond-name');
      assert(name && document.activeElement === name, 'its name is ready to type');
      setVal(name, 'Vehicle'); await settle();
      setVal($('.cond-card .cond-role'), 'gate'); await settle();
      eq(ws().doc.groups[6].name, 'Vehicle'); eq(ws().doc.groups[6].role, 'gate');
      key('z', { ctrlKey: true }); key('z', { ctrlKey: true }); key('z', { ctrlKey: true }); await settle();
      eq(ws().doc.groups.length, 6, 'undo removes it');
      eq(ws().wellInfo('A1').group, ws().doc.groups[0].id, 'undo restores A1');
      $$('.group-row')[1].click(); await settle();
      eq($$('.well.sel').length, 3, 'clicking a condition highlights its wells');
      key('Escape');
      await settle();
      eq($$('.well.sel').length, 0, 'Esc clears');
    });
    await step('plate: paste a layout from a spreadsheet', async () => {
      btn('Paste layout').click(); await settle();
      const ta = $('.paste-area');
      assert(ta, 'dialog open');
      ta.value = '\t1\t2\t3\nA\tIgG1\tIgG1\tIgG1\nB\tIgG2\tIgG2\tIgG2\n';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await settle();
      eq($$('.paste-cell').filter(c => c.textContent).length, 6, 'preview shows six wells');
      btn('Apply layout').click(); await settle();
      eq(ws().groupOf('B2').name, 'IgG2');
      key('z', { ctrlKey: true }); await settle();   // keep the rest of the test on the row layout
      eq(ws().groupOf('B2').name, ws().doc.groups[1].name);
    });
    await step('plate: select a well and exclude it with a reason', async () => {
      const e1 = $('.well[data-key="E1"]');
      const r = e1.getBoundingClientRect();
      ptr(e1, 'pointerdown', r.left + 8, r.top + 8);
      ptr(document, 'pointerup', r.left + 8, r.top + 8);
      await settle();
      assert(/Well E1/.test($('.plate-sel h3').textContent), 'inspector shows E1');
      const box = $$('.plate-sel input[type=checkbox]')[0];
      box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
      assert(ws().wellInfo('E1').excluded, 'E1 excluded');
      setVal($('.plate-sel input[placeholder^="Reason"]'), 'beads not added');
      await settle();
      eq(ws().wellInfo('E1').reason, 'beads not added');
      assert($('.well[data-key="E1"]').classList.contains('excluded'), 'hatched');
    });

    // ------------------------------------------------------------------- gate
    FM.go('gate');
    await settle();
    let cellsId, beadsId;
    await step('gate: Across all wells shows % and events together by default', async () => {
      eq(FM.ui.wellsShow, 'both');
      eq(JSON.parse(localStorage.getItem('flowmate.prefs') || '{}').wellsShow2, undefined, 'a default, not a saved choice');
    });
    await step('gate: dot size − / + (and [ ]) redraws the plot and is remembered', async () => {
      eq(FM.ui.dotScale, 1, 'starts at 100%');
      $('.dot-ctl button[aria-label="Bigger dots"]').click(); await settle();
      eq(FM.ui.dotScale, 1.5);
      eq($('.dot-val').textContent, '150%');
      key(']'); await settle();
      eq(FM.ui.dotScale, 2, '] is bigger');
      key('['); key('['); key('['); key('['); key('['); await settle();
      eq(FM.ui.dotScale, 0.5, '[ is smaller, down to 50%');
      assert($('.dot-ctl button[aria-label="Smaller dots"]').disabled, 'the smallest');
      assert(/"dotScale":0.5/.test(JSON.stringify(FM.store.getJSON('prefs'))), 'saved with the preferences');
      FM.ui.dotScale = 1; FM.savePrefs(); FM.go('plate'); FM.go('gate'); await settle();
    });
    await step('gate: set axes FSC-H × SSC-H from the toolbar', async () => {
      const [xs, ys] = $$('.axis-sel');
      setVal(xs, 'FSC-H'); await settle();
      setVal($$('.axis-sel')[1], 'SSC-H'); await settle();
      const v = ws().view(null);
      eq(v.x, 'FSC-H'); eq(v.y, 'SSC-H');
    });
    await step('gate: draw a polygon with the keyboard tool and name it', async () => {
      key('p'); await settle();
      eq(FM.ui.tool, 'polygon');
      const pv = FM.views.gate._plotView();
      const pts = [[0.12, 0.06], [0.2, 0.72], [0.85, 0.55], [0.7, 0.08]];
      for (const [tx, ty] of pts) { const [x, y] = plotPx(tx, ty); ptr(pv.overCv, 'pointerdown', x, y); ptr(pv.overCv, 'pointerup', x, y); }
      key('Enter');
      await wait(150);
      eq(ws().doc.gates.length, 1, 'gate created');
      cellsId = ws().doc.gates[0].id;
      eq(ws().gate(cellsId).verts.length, 4);
      const inp = $('.rename-pop input');
      assert(inp, 'rename popover shown');
      inp.value = 'THP';
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle();
      eq(ws().gate(cellsId).name, 'THP');
      eq(FM.ui.tool, 'select', 'tool returns to select');
    });
    await step('gate: each population row, and the export menu above the plot, export its events', async () => {
      const rows = $$('.tnode');
      const gateRow = rows[rows.length - 1];
      const name = gateRow.querySelector('.tname').textContent;
      gateRow.querySelector('.texport').click(); await settle();
      let dlg = $('.modal');
      assert(dlg && /Export events/.test(dlg.textContent), 'dialog from the row');
      eq(dlg.querySelector('select').selectedOptions[0].textContent.trim(), name, 'that population chosen');
      key('Escape'); await settle();
      rows[0].querySelector('.texport').click(); await settle();
      eq($('.modal select').value, '', 'All events from its row');
      key('Escape'); await settle();
      $('.crumb-export').click(); await settle();
      assert(btn('This plot as PNG'), 'PNG still there');
      btn('Events in').click(); await settle();
      assert($('.modal') && /Export events/.test($('.modal').textContent), 'dialog from the export menu');
      key('Escape'); await settle();
    });
    await step('gate: the new gate applies to every well, with a filmstrip tile each', async () => {
      const pcts = ws().samples.map(s => ws().pct(s, cellsId));
      assert(pcts.every(p => p > 40 && p < 99.9), 'plausible % in every well: ' + pcts.map(p => p.toFixed(0)).join(','));
      await wait(200);
      eq($$('.thumb').length, 18, 'thumbnails');
      assert($$('.mp-cell').length >= 18, 'heatmap cells');
    });
    await step('gate: dragging a vertex is one undo step', async () => {
      FM.setUI({ gateId: cellsId }); await settle();
      const pv = FM.views.gate._plotView();
      const before = JSON.stringify(ws().gate(cellsId).verts);
      const depth = ws().undoStack.length;
      const h = pv.handles[2];
      const r = pv.overCv.getBoundingClientRect();
      ptr(pv.overCv, 'pointerdown', r.left + h[0], r.top + h[1]);
      for (let i = 1; i <= 6; i++) { ptr(pv.overCv, 'pointermove', r.left + h[0] + i * 6, r.top + h[1] + i * 3); await wait(30); }
      ptr(pv.overCv, 'pointerup', r.left + h[0] + 36, r.top + h[1] + 18);
      await wait(150);
      assert(JSON.stringify(ws().gate(cellsId).verts) !== before, 'vertex moved');
      eq(ws().undoStack.length, depth + 1, 'one undo step for the whole drag');
      key('z', { ctrlKey: true }); await settle();
      eq(JSON.stringify(ws().gate(cellsId).verts), before, 'undo restores the vertex');
    });
    await step('gate: double-click inside a gate opens its population', async () => {
      const pv = FM.views.gate._plotView();
      const [x, y] = plotPx(0.45, 0.35);
      pv.overCv.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: x, clientY: y }));
      await settle();
      eq(FM.ui.popId, cellsId, 'plotting the THP population');
      assert(/THP/.test($('.crumb.on').textContent), 'breadcrumb');
    });
    await step('gate: histogram range gate on FL1-H', async () => {
      setVal($$('.axis-sel')[0], 'FL1-H'); await settle();
      setVal($$('.axis-sel')[1], '__hist'); await settle();
      eq(ws().view(cellsId).y, null, 'histogram mode');
      key('h'); await settle();
      eq(FM.ui.tool, 'range');
      const pv = FM.views.gate._plotView();
      const [x0, y0] = plotPx(0.62, 0.3), [x1] = plotPx(0.97, 0.3);
      ptr(pv.overCv, 'pointerdown', x0, y0);
      ptr(pv.overCv, 'pointermove', (x0 + x1) / 2, y0);
      ptr(pv.overCv, 'pointermove', x1, y0);
      ptr(pv.overCv, 'pointerup', x1, y0);
      await wait(150);
      const g = ws().doc.gates.find(x => x.type === 'range');
      assert(g, 'range gate created');
      beadsId = g.id;
      const inp = $('.rename-pop input');
      inp.value = 'Beads+';
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle();
      eq(ws().gate(beadsId).name, 'Beads+');
      const a1 = ws().pct(ws().sample('A1'), beadsId), f1 = ws().pct(ws().sample('F1'), beadsId), e1 = ws().pct(ws().sample('E1'), beadsId);
      assert(a1 > 40, 'A1 bead-positive ' + a1.toFixed(1));
      assert(f1 < 2, 'THP alone negative ' + f1.toFixed(2));
      assert(e1 < 5, 'failed well E1 negative ' + e1.toFixed(2));
    });
    await step('gate: quadrant tool places four gates; dragging the crosshair is one undo step', async () => {
      setVal($$('.axis-sel')[1], 'SSC-H'); await settle();      // back to 2-D inside THP
      key('q'); await settle();
      eq(FM.ui.tool, 'quad');
      const pv = FM.views.gate._plotView();
      const [x, y] = plotPx(0.6, 0.4);
      ptr(pv.overCv, 'pointerdown', x, y); ptr(pv.overCv, 'pointerup', x, y);
      await settle();
      const quads = ws().doc.gates.filter(g => g.type === 'quad');
      eq(quads.length, 4, 'four quadrant gates');
      const s = ws().sample('A1');
      const sum = quads.reduce((a, g) => a + ws().count(s, g.id), 0);
      eq(sum, ws().count(s, cellsId), 'quadrants partition the parent');
      const before = quads[0].quad.cx, depth = ws().undoStack.length;
      const hnd = pv.handles[0];
      const r = pv.overCv.getBoundingClientRect();
      ptr(pv.overCv, 'pointerdown', r.left + hnd[0], r.top + hnd[1]);
      for (let i = 1; i <= 5; i++) { ptr(pv.overCv, 'pointermove', r.left + hnd[0] + i * 8, r.top + hnd[1]); await wait(30); }
      ptr(pv.overCv, 'pointerup', r.left + hnd[0] + 40, r.top + hnd[1]);
      await wait(150);
      const moved = ws().doc.gates.filter(g => g.type === 'quad');
      assert(moved.every(g => g.quad.cx !== before && g.quad.cx === moved[0].quad.cx), 'all four moved together');
      eq(ws().undoStack.length, depth + 1, 'one undo step');
      key('Delete'); await settle();
      eq(ws().doc.gates.filter(g => g.type === 'quad').length, 0, 'Delete removes the whole quadrant');
      setVal($$('.axis-sel')[1], '__hist'); await settle();
    });
    await step('gate: exact coordinates can be typed for a gate', async () => {
      FM.setUI({ gateId: beadsId }); await settle();
      const before = JSON.stringify(ws().gate(beadsId).range);   // snapshot: gates are patched in place
      FM.views.gate._coords(beadsId); await settle();
      const inputs = $$('.coords-grid input');
      eq(inputs.length, 2, 'range gate has from/to');
      inputs[0].value = '60k'; inputs[1].value = '1e7';
      btn('Apply', $('.modal')).click(); await settle();
      eq(ws().gate(beadsId).range.lo, 60000); eq(ws().gate(beadsId).range.hi, 1e7);
      key('z', { ctrlKey: true }); await settle();
      eq(JSON.stringify(ws().gate(beadsId).range), before, 'undo restores');
    });
    await step('gate: arrow keys move between wells', async () => {
      FM.setUI({ sampleKey: 'A1' }); await settle();
      key('ArrowRight'); await settle();
      eq(FM.ui.sampleKey, 'A2');
      key('ArrowLeft'); await settle();
      eq(FM.ui.sampleKey, 'A1');
    });
    await step('gate: Delete removes the selected gate, Ctrl+Z brings it back', async () => {
      FM.setUI({ gateId: beadsId }); await settle();
      key('Delete'); await settle();
      assert(!ws().gate(beadsId), 'deleted');
      key('z', { ctrlKey: true }); await settle();
      assert(ws().gate(beadsId), 'restored');
    });

    // ------------------------------------------------- per-well adjustments
    await step('per-well: the scope switch needs a gate selected first', async () => {
      FM.setUI({ gateId: null }); await settle();
      const b = btn(ws().samples[0].well, $('.scope-sw'));
      assert(b, 'the switch names the current well');
      assert(b.disabled, 'and refuses until a gate is selected');
      FM.setUI({ gateId: beadsId }); await settle();
      assert(!btn(ws().samples[0].well, $('.scope-sw')).disabled, 'enabled once a gate is selected');
    });

    let adjKey;
    await step('per-well: dragging on this well leaves every other well alone', async () => {
      const s = FM.currentSample();
      adjKey = s.key;
      FM.setUI({ gateId: beadsId, popId: ws().gate(beadsId).parent, tool: 'select' });
      await settle();
      const other = ws().samples.find(x => x.key !== adjKey);
      const beforeMine = ws().pct(s, beadsId), beforeOther = ws().pct(other, beadsId);
      const sharedBefore = JSON.stringify(ws().gate(beadsId).range);

      btn(s.well, $('.scope-sw')).click();
      await settle();
      eq(FM.ui.gateScope, 'well', 'switch is on this well');

      // drag the gate's body a little — Beads+ is a range gate, so along x only
      const pv = FM.views.gate._plotView();
      const it = (pv.items || []).find(i => i.id === beadsId);
      assert(it, 'the gate is on the plot');
      const o = it.outline;
      const cx = o.pts ? o.pts.reduce((a, p) => a + p[0] / o.pts.length, 0) : (o.x0 + o.x1) / 2;
      const cy = o.pts ? o.pts.reduce((a, p) => a + p[1] / o.pts.length, 0) : (pv.L.y0 + pv.L.y1) / 2;
      const r = pv.overCv.getBoundingClientRect();
      ptr(pv.overCv, 'pointerdown', r.left + cx, r.top + cy);
      ptr(pv.overCv, 'pointermove', r.left + cx - 30, r.top + cy);
      ptr(pv.overCv, 'pointerup', r.left + cx - 30, r.top + cy);
      await settle();

      assert(ws().isAdjusted(beadsId, adjKey), 'this well now has its own version');
      eq(JSON.stringify(ws().gate(beadsId).range), sharedBefore, 'the shared gate never moved');
      assert(Math.abs(ws().pct(s, beadsId) - beforeMine) > 0.01, 'this well’s number changed');
      eq(ws().pct(other, beadsId), beforeOther, 'another well’s number did not');
      eq(ws().adjustedWells(beadsId).join(), adjKey, 'exactly one adjusted well');
    });

    await step('per-well: the adjusted well is marked where it is shown', async () => {
      FM.setUI({ gateScope: 'all' }); await settle();
      assert($('.chip.adj'), 'the population tree marks the gate');
      assert($('.mp-cell.adj'), 'the plate map marks the well');
      assert($('.thumb.adj'), 'the filmstrip marks the tile');
    });

    await step('per-well: a shared edit leaves the adjusted well where it is', async () => {
      const s = ws().sample(adjKey);
      const mine = ws().pct(s, beadsId);
      const g = ws().gate(beadsId);
      ws().updateGate(beadsId, { range: { lo: g.range.lo * 0.8, hi: g.range.hi } }, { label: 'shared' });
      await settle();
      eq(ws().pct(s, beadsId), mine, 'the adjusted well sat the change out');
      assert(ws().isAdjusted(beadsId, adjKey), 'and kept its own version');
    });

    await step('table: the bottom panel switches to the gating table', async () => {
      btn('Table', $('.bottom-tabs')).click();
      await settle();
      assert($('table.gt'), 'the table is shown');
      assert(!$('.strip-track').offsetParent, 'the filmstrip is hidden');
      eq($$('.gt tbody .gt-row').length, 18, 'one row per well');
      eq($$('.gt thead .gt-h').length, ws().doc.gates.length, 'one column per population');
      assert($('.gt-med'), 'the median rides in the header');
    });

    await step('table: the gating table spans the panel instead of sitting on the left', async () => {
      const wrap = $('.gt-wrap'), t = $('.gt');
      assert(wrap && t, 'table shown');
      assert(t.getBoundingClientRect().width >= wrap.getBoundingClientRect().width - 40, 'table width ' + t.getBoundingClientRect().width + ' of ' + wrap.getBoundingClientRect().width);
    });
    await step('table: adjusting a parent marks it ✦ and its untouched child ↳', async () => {
      // start from a child that has no version of its own, so ↳ can only mean trickle-down
      ws().clearGateOverride(null, [adjKey]);
      const g = ws().gateFor(ws().gate(cellsId), adjKey);
      ws().setGateOverride(cellsId, adjKey, { verts: g.verts.map(p => [p[0] * 1.12, p[1]]) });
      await settle();
      const dump = () => FM.summary.build(ws()).rows.find(r => r.sample.key === adjKey).cells.map(c => c.gate.name + '=' + c.status).join(' ');
      const row = $$('.gt tbody .gt-row').find(r => r.querySelector('.gt-well').textContent.trim() === adjKey);
      assert(row, 'the adjusted well has a row');
      const vs = Array.from(row.querySelectorAll('.gt-v'));
      assert(vs.length >= 2, 'a parent and a child are both columns | ' + dump());
      assert(vs[0].classList.contains('st-adjusted'), 'the parent reads as adjusted | ' + dump());
      assert(vs[1].classList.contains('st-inherited'), 'the child moved with it, without being touched | ' + dump());
      assert(!ws().isAdjusted(beadsId, adjKey), 'the child really has no version of its own');
      assert($('.gt-legend'), 'the legend explains both marks');
    });

    await step('table: Δ mode shows the distance from the shared gating', async () => {
      btn('Δ vs shared').click();
      await settle();
      const ds = $$('.gt-d');
      assert(ds.length, 'deltas are shown');
      assert(ds.some(d => /[+−]/.test(d.textContent)), 'signed: ' + ds.slice(0, 3).map(d => d.textContent).join('|'));
    });

    await step('table: clicking a cell jumps to that well and gate', async () => {
      const rows = $$('.gt tbody .gt-row');
      const target = rows.find(r => r.querySelector('.gt-well').textContent.trim() !== FM.ui.sampleKey);
      const want = target.querySelector('.gt-well').textContent.trim();
      target.querySelectorAll('.gt-v')[0].click();
      await settle();
      eq(FM.ui.sampleKey, want, 'moved to that well');
      eq(FM.ui.gateId, ws().doc.gates[0].id, 'and selected that gate');
    });

    await step('per-well: reset puts the well back on the shared gate', async () => {
      ws().clearGateOverride(null, ws().samples.map(s => s.key));
      FM.setUI({ bottomTab: 'strip' });
      await settle();
      assert(!ws().anyAdjusted(), 'no adjustments left');
      assert(!$('.chip.adj'), 'and the mark is gone');
    });

    // ---------------------------------------------------------------- measure
    FM.go('measure');
    await settle();
    await step('steps: five steps, every one named in the bar; unmixing is a beta tool off the Gate step', async () => {
      const steps = $$('.stepper .step');
      eq(steps.map(b => b.querySelector('.step-l').textContent).join(' '), 'Load Plate Gate Measure Analysis');
      assert(steps.every(b => getComputedStyle(b.querySelector('.step-l')).display !== 'none'), 'no step hides its name');
      assert(!FM.views.results && !$$('.stepper .step').some(b => /Results/.test(b.textContent)), 'no Results step');
      assert(/Figures/.test($('.layout-btn').textContent), 'the layout page is called Figures');
    });
    await step('measure: quick add makes count and % for every population, one row per well', async () => {
      assert($('.tbv-wrap'), 'Measure is the statistics table');
      btn('Every population: count and % of parent').click(); await settle();
      const t = ws().doc.tables[0];
      eq(t.columns.length, ws().doc.gates.length * 2, 'two columns per gate');
      eq($$('.tbv-table tbody tr').length, 18, 'a row per well');
    });
    await step('measure: drag a column chip, or a heading, to reorder; one undo step each', async () => {
      const t = () => ws().doc.tables[0];
      const ids = t().columns.map(c => c.id);
      const drag = (from, to) => {
        const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
        ptr(from, 'pointerdown', a.left + 8, a.top + a.height / 2);
        ptr(document, 'pointermove', a.left + 20, a.top + a.height / 2);
        ptr(document, 'pointermove', b.left + b.width / 2, b.top + b.height / 2);
        ptr(document, 'pointerup', b.left + b.width / 2, b.top + b.height / 2);
      };
      drag($$('.tbv-col')[2], $$('.tbv-col')[0]); await settle();
      eq(t().columns.map(c => c.id).join(), [ids[2], ids[0], ids[1]].concat(ids.slice(3)).join(), 'chip C moved to the front');
      assert(!$$('.tbv-col button[data-tip="Move left"]').length, 'no arrow buttons');
      drag($$('.tbv-table thead th.tbv-drag')[0], $$('.tbv-table thead th.tbv-drag')[1]); await settle();
      eq(t().columns.map(c => c.id).join(), [ids[0], ids[2], ids[1]].concat(ids.slice(3)).join(), 'heading A dragged one place right');
      key('z', { ctrlKey: true }); key('z', { ctrlKey: true }); await settle();
      eq(t().columns.map(c => c.id).join(), ids.join(), 'undone');
    });
    await step('measure: Export events opens the per-cell export for the table’s wells', async () => {
      btn('Export events', $('.tbv-head')).click(); await settle();
      const dlg = $('.modal');
      assert(dlg && /Export events/.test(dlg.textContent), 'dialog open');
      eq(dlg.querySelectorAll('select')[1].value, 'all', 'every well, like the table');
      key('Escape'); await settle();
      assert(!$('.modal'), 'closed');
    });
    await step('measure: Export CSV saves the table', async () => {
      const files = [];
      const orig = FM.dom.download;
      FM.dom.download = (name, data) => files.push({ name, data });
      try { btn('Export CSV').click(); } finally { FM.dom.download = orig; }
      eq(files.length, 1, 'one file');
      assert(/\.csv$/.test(files[0].name), 'csv: ' + files[0].name);
      const lines = String(files[0].data).trim().split(/\r?\n/);
      assert(/^Sample,Group,/.test(lines[0]), 'header ' + lines[0].slice(0, 40));
      eq(lines.length, 19, 'header + 18 wells');
    });
    await step('measure: a formula column computes from the lettered columns, with a live check', async () => {
      const t = () => ws().doc.tables[0];
      const n = t().columns.length;
      eq($$('.tbv-table th .col-letter').map(e => e.textContent).slice(0, 3).join(''), 'ABC', 'columns are lettered');
      btn('Formula', $('.tbv-kind')).click(); await settle();
      const ex = $('.tbv-expr');
      setVal(ex, 'A + Z', 'input');
      assert($('.tbv-fstatus.bad') && /no column Z/i.test($('.tbv-fstatus').textContent), 'explains the bad letter: ' + $('.tbv-fstatus').textContent);
      assert(btn('Add column').disabled, 'cannot add a broken formula');
      setVal(ex, '', 'input');
      $$('.tbv-lt')[1].click();               // the letter pad types B
      eq($('.tbv-expr').value, 'B');
      setVal($('.tbv-expr'), 'B / A * 100', 'input');
      assert(/First row/.test($('.tbv-fstatus').textContent), 'preview: ' + $('.tbv-fstatus').textContent);
      setVal($('.tbv-fname'), 'ratio', 'input');
      btn('Add column').click(); await settle();
      eq(t().columns.length, n + 1);
      const c = t().columns[n];
      eq(c.kind, 'formula'); eq(c.name, 'ratio');
      const b = FM.statTables.build(ws(), t());
      const r = b.rows.find(x => Number.isFinite(x.cells[0]) && x.cells[0] > 0);
      assert(Math.abs(r.cells[n] - r.cells[1] / r.cells[0] * 100) < 1e-9, 'B / A * 100 in every row');
      assert($$('.tbv-table thead th').some(th => /ratio/.test(th.textContent)), 'the grid has the column');
    });
    await step('measure: clicking a formula column edits it in place', async () => {
      const t = () => ws().doc.tables[0];
      $$('.tbv-fedit').pop().click(); await settle();
      const ex = $('.tbv-fedit-pop .tbv-expr');
      eq(ex.value, 'B / A * 100');
      setVal(ex, 'A + 1', 'input');
      btn('Save', $('.tbv-fedit-pop')).click(); await settle();
      const c = t().columns[t().columns.length - 1];
      eq(FM.statTables.formulaText(t(), c), 'A + 1');
      ws().undo(); await settle();
      eq(FM.statTables.formulaText(t(), t().columns[t().columns.length - 1]), 'B / A * 100', 'one undo step');
    });
    // -------------------------------------------------------------- analysis
    await step('analysis: starts empty, and New graph makes exactly one graph', async () => {
      FM.go('analysis'); await settle();
      eq(FM.ui.step, 'analysis');
      eq((ws().doc.graphs || []).length, 0, 'nothing made by itself');
      assert(!$('.stat-chart'), 'no graph drawn yet');
      btn('New graph').click(); await settle();
      eq(ws().doc.graphs.length, 1);
      const shown = FM.graphs.defaultGroups(ws()).length;
      eq($$('.stat-chart .sc-bar').length, shown, 'a bar per condition (gate controls left out)');
      eq($$('.anv-chip').length, shown, 'a chip per condition');
      assert(/one-way ANOVA/.test($('.anv-testline').textContent), 'the test is reported: ' + $('.anv-testline').textContent);
      assert($$('.anv-sum-tbl tbody tr').length === shown, 'n, mean, SD per condition');
      assert($$('.stepper .step').find(b => /Analysis/.test(b.textContent)).classList.contains('done') || FM.ui.step === 'analysis', 'stepper knows');
    });
    await step('analysis: switching the graph type and error bars redraws, in one undo step each', async () => {
      const g = () => ws().graph(FM.ui.graphId);
      btn('Dot', $('.anv-kind')).click(); await settle();
      eq(g().kind, 'dot'); eq($$('.stat-chart .sc-bar').length, 0); assert($$('.stat-chart .sc-mean').length > 0, 'mean lines');
      btn('SEM', $('.anv-err')).click(); await settle();
      eq(g().error, 'sem');
      btn('Box', $('.anv-kind')).click(); await settle();
      assert($$('.stat-chart .sc-box').length > 0, 'boxes'); assert(!$('.anv-err'), 'no error-bar choice for a box plot');
      assert(/Median/.test($('.anv-sum-tbl thead').textContent), 'box summary shows the median');
      ws().undo(); await settle();
      eq(g().kind, 'dot', 'undo goes back one change');
      btn('Bar', $('.anv-kind')).click(); await settle();
    });
    await step('analysis: compare all pairs, each vs one, or nothing', async () => {
      const g = () => ws().graph(FM.ui.graphId);
      const ns = $('.anv-showns input'); ns.checked = true; ns.dispatchEvent(new Event('change', { bubbles: true })); await settle();
      const k = FM.graphs.defaultGroups(ws()).length;
      eq($$('.stat-chart .sc-bracket').length, k * (k - 1) / 2, 'every pair, with ns shown');
      const cmp = $('.anv-cmp');
      setVal(cmp, cmp.options[1].value); await settle();
      eq(g().compare, 'control');
      eq($$('.stat-chart .sc-bracket').length, k - 1, 'each vs one');
      assert(/Dunnett/.test($('.anv-res').textContent), 'named');
      setVal($('.anv-cmp'), 'none'); await settle();
      eq($$('.stat-chart .sc-bracket').length, 0); assert(!$('.anv-cmp-tbl'), 'no comparison table');
      setVal($('.anv-cmp'), 'all'); await settle();
    });
    await step('analysis: paired graphs match wells and use a repeated-measures test', async () => {
      btn('Paired', $('.anv-kind')).click(); await settle();
      setVal($('.anv-pairby'), 'col'); await settle();
      eq(ws().graph(FM.ui.graphId).pairBy, 'col');
      assert($$('.stat-chart .sc-pair').length > 0, 'lines between matched wells');
      assert(/Repeated-measures/.test($('.anv-testline').textContent), $('.anv-testline').textContent);
      btn('Bar', $('.anv-kind')).click(); await settle();
    });
    await step('analysis: leave a condition out and add it back', async () => {
      const n = $$('.anv-chip').length;
      $$('.anv-chip .anv-hide')[0].click(); await settle();
      eq($$('.anv-chip').length, n - 1); eq($$('.stat-chart .sc-bar').length, n - 1);
      btn('Condition', $('.anv-chips')).click(); await settle();
      const item = $$('.pop .menu-item').find(b => !/gate control/.test(b.textContent));
      item.click(); await settle();
      eq($$('.anv-chip').length, n);
    });
    await step('analysis: drag a condition chip to reorder the graph, and drag graphs in the list', async () => {
      const drag = (from, to) => {
        const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
        ptr(from, 'pointerdown', a.left + 8, a.top + a.height / 2);
        ptr(document, 'pointermove', a.left + 20, a.top + a.height / 2);
        ptr(document, 'pointermove', b.left + b.width / 2, b.top + b.height / 2);
        ptr(document, 'pointerup', b.left + b.width / 2, b.top + b.height / 2);
      };
      const names = () => $$('.anv-chip .anv-cn').map(e => e.textContent);
      const before = names();
      assert(!$$('.anv-chip button[data-tip="Move left"]').length, 'no arrow buttons');
      drag($$('.anv-chip')[2], $$('.anv-chip')[0]); await settle();
      eq(names().join(), [before[2], before[0], before[1]].concat(before.slice(3)).join(), 'third condition moved first');
      eq($$('.stat-chart .sc-bar').length, before.length, 'graph redrawn');
      key('z', { ctrlKey: true }); await settle();
      eq(names().join(), before.join(), 'undone');
      const g = ws().graph(FM.ui.graphId);
      const copy = Object.assign({}, g); delete copy.id; copy.name = 'Second graph';
      ws().addGraph(copy); await settle();
      const ids = () => ws().doc.graphs.map(x => x.id);
      const order = ids();
      drag($$('.anv-list .tbv-item')[order.length - 1], $$('.anv-list .tbv-item')[0]); await settle();
      eq(ids()[0], order[order.length - 1], 'the last graph dragged to the top');
      key('z', { ctrlKey: true }); key('z', { ctrlKey: true }); await settle();
      eq(ids().join(), order.slice(0, -1).join(), 'undone, and the copy removed');
    });
    await step('analysis: Show values writes each condition’s mean over its bar', async () => {
      eq($$('.stat-chart .sc-value').length, 0, 'off by default');
      const box = $('.anv-showvals input');
      box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); await settle();
      const labels = $$('.stat-chart .sc-value');
      eq(labels.length, $$('.stat-chart .sc-bar').length, 'one per bar');
      const g = ws().graph(FM.ui.graphId);
      assert(g.showValues, 'saved with the graph');
      const r = FM.graphs.compute(ws(), g);
      const mean = r.model.groups[0].summary.mean;
      assert(Math.abs(parseFloat(labels[0].textContent.replace(/,/g, '')) - mean) <= Math.abs(mean) * 0.01 + 1e-9, labels[0].textContent + ' vs ' + mean);
      const bars = $$('.stat-chart .sc-bar');
      labels.forEach((l, i) => assert(l.getBBox().y + l.getBBox().height <= bars[i].getBBox().y + 1, 'label ' + i + ' sits above its bar'));
      box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })); await settle();
      eq($$('.stat-chart .sc-value').length, 0, 'off again');
    });
    await step('analysis: a title typed above the graph is drawn on it and names it in the list', async () => {
      setVal($('.anv-title'), 'Bead uptake by IgG subclass'); await settle();
      eq(ws().graph(FM.ui.graphId).name, 'Bead uptake by IgG subclass');
      eq($('.stat-chart .sc-title').textContent, 'Bead uptake by IgG subclass');
      assert(/Bead uptake by IgG subclass/.test($('.anv-list .tbv-item.on').textContent), 'the list uses it');
    });
    await step('analysis: PNG and SVG exports', async () => {
      const files = [];
      const orig = FM.dom.download;
      FM.dom.download = (name, data) => files.push({ name, data });
      try {
        btn('SVG', $('.anv-head')).click();
        btn('PNG', $('.anv-head')).click();
        for (let i = 0; i < 40 && !files.some(f => /\.png$/.test(f.name)); i++) await wait(100);   // the PNG is drawn asynchronously
      } finally { FM.dom.download = orig; }
      assert(files.some(f => /\.svg$/.test(f.name) && /<svg/.test(f.data)), 'svg: ' + files.map(f => f.name));
      assert(files.some(f => /\.png$/.test(f.name) && f.data instanceof Blob && f.data.size > 1000), 'png');
    });
    await step('analysis: a graph whose column is removed says so instead of breaking', async () => {
      const g = ws().graph(FM.ui.graphId);
      const t = ws().table(g.src.table);
      const i = t.columns.findIndex(c => c.id === g.src.col);
      ws().removeTableColumn(t.id, i); await settle();
      assert(/removed/.test($('.anv-broken').textContent), 'explains');
      ws().undo(); await settle();
      assert($('.stat-chart'), 'back after undo');
    });
    await step('one way of working: no mode switch, no Workspace or Compensation, no PlotMate or FlowJo wording', async () => {
      assert(!$('.mode-switch') && !FM.setMode && !FM.MODES, 'no Guided | Traditional switch');
      eq($$('.stepper .step-l').map(e => e.textContent).join(' '), 'Load Plate Gate Measure Analysis');
      for (const old of ['workspace', 'tables', 'comp']) { FM.go(old); await settle(); assert(['load', 'measure', 'unmix'].includes(FM.ui.step), old + ' links land on a step that exists: ' + FM.ui.step); }
      FM.go('measure'); await settle();
      assert(!btn('PlotMate'), 'no Send to PlotMate on Measure');
      FM.go('analysis'); await settle();
      assert(!btn('PlotMate'), 'no Send to PlotMate on Analysis');
      FM.go('load'); await settle();
      assert(!/FlowJo|PlotMate|Traditional/.test(document.body.textContent), 'the start screen does not mention them');
    });
    await step('home: the logo goes to the start, and File → New analysis starts again', async () => {
      FM.go('gate'); await settle();
      $('.topbar .brand').click(); await settle();
      eq(FM.ui.step, 'load', 'the logo goes home');
      assert(ws().samples.length > 0, 'nothing is lost by going home');
      btn('File', $('.top-actions')).click(); await settle();
      assert(btn('New analysis', $('.pop')), 'File has New analysis');
      btn('New analysis', $('.pop')).click(); await settle();
      assert($('.modal-back'), 'asks first');
      FM.dom.closePop();
      $('.modal-back') && btn('Cancel', $('.modal')).click(); await settle();
      assert(ws().samples.length > 0, 'cancel keeps the analysis');
    });

    // ----------------------------------------------------------- layout page
    await step('layout: the Gate step hands the current plot to the page', async () => {
      FM.go('gate'); await settle();
      btn('To figure').click();
      await settle();
      // To figure offers this plot per well, or the gating strategy
      btn('This plot, one per well').click();
      await wait(200);
      eq(FM.ui.step, 'layout', 'the layout page opened');
      assert($('.lay-page'), 'a white page is shown');
      assert($('.modal-back'), 'and the add dialog is pre-filled and waiting');
    });

    await step('layout: adding every well fills the page with one plot each', async () => {
      btn('Add', $('.modal-back')).click();
      await wait(600);
      const items = ws().layout().items.filter(i => i.kind === 'plot');
      eq(items.length, 18, 'one plot per well');
      eq(ws().layout().items.filter(i => i.kind === 'table').length, 1, 'and the gating summary table at the bottom');
      eq($$('.lay-item').length, 19, 'one element each');
      const L = ws().layout();
      items.forEach(it => {
        assert(it.x >= 0 && it.x + it.w <= L.page.w + 0.5, it.title + ' is within the page width');
        assert(it.y >= 0 && it.y + it.h <= L.page.h + 0.5, it.title + ' is within the page height');
      });
      assert($$('.lay-cv').length > 0, 'plots are drawn onto canvases');
    });

    await step('layout: dragging an item moves it, in one undo step', async () => {
      const el = $$('.lay-item')[0];
      const id = el.dataset.id;
      const before = { x: ws().layoutItem(id).x, y: ws().layoutItem(id).y };
      const depth = ws().undoStack.length;
      const r = el.getBoundingClientRect();
      const cv = $('.lay-canvas');
      ptr(el, 'pointerdown', r.left + r.width / 2, r.top + r.height / 2);
      for (let i = 1; i <= 4; i++) { ptr(cv, 'pointermove', r.left + r.width / 2 + i * 14, r.top + r.height / 2 + i * 9); await wait(20); }
      ptr(cv, 'pointerup', r.left + r.width / 2 + 56, r.top + r.height / 2 + 36);
      await settle();
      const after = ws().layoutItem(id);
      assert(after.x !== before.x || after.y !== before.y, 'it moved');
      eq(ws().undoStack.length, depth + 1, 'one undo step for the whole drag');
      key('z', { ctrlKey: true }); await settle();
      eq(ws().layoutItem(id).x, before.x, 'undo puts it back');
    });

    await step('layout: select, duplicate and delete', async () => {
      const el = $$('.lay-item')[0];
      const r = el.getBoundingClientRect();
      const cv = $('.lay-canvas');
      ptr(el, 'pointerdown', r.left + 8, r.top + 8);
      ptr(cv, 'pointerup', r.left + 8, r.top + 8);
      await settle();
      eq(FM.views.layout._sel().size, 1, 'one item selected');
      key('d', { ctrlKey: true }); await wait(200);
      eq(ws().layout().items.length, 20, 'duplicated');
      key('Delete'); await wait(200);
      eq(ws().layout().items.length, 19, 'and the copy removed');
    });

    await step('layout: zoom in, out and fit', async () => {
      const z0 = FM.views.layout._zoom();
      key('+'); await settle();
      assert(FM.views.layout._zoom() > z0, 'zoomed in');
      key('-'); key('-'); await settle();
      assert(FM.views.layout._zoom() < z0 * 1.1, 'zoomed back out');
      key('0'); await settle();
      const L = ws().layout();
      const r = $('.lay-canvas').getBoundingClientRect();
      assert(L.page.w * FM.views.layout._zoom() <= r.width, 'fit puts the whole page in view');
    });

    await step('layout: a plot whose population is deleted says so instead of breaking', async () => {
      // a gate made only to be deleted, so the rest of the run keeps its gating intact
      const victim = { id: ws().addGate({ name: 'Scratch', parent: null, type: 'range', x: 'FSC-H',
        xScale: ws().scaleSpec('FSC-H'), range: { lo: 0, hi: 1e9 } }) };
      const ids = ws().addLayoutItems([{ kind: 'plot', sample: ws().samples[0].key, pop: victim.id, ax: 'FSC-H', ay: 'SSC-H' }]);
      FM.views.layout.update('ws:layout'); await settle();
      ws().deleteGate(victim.id);
      await wait(250);
      assert($('.lay-broken'), 'the item shows a plain explanation');
      assert(/deleted/i.test($('.lay-broken').textContent), $('.lay-broken').textContent);
      ws().removeLayoutItems(ids);
      FM.views.layout.update('ws:layout'); await settle();
    });

    await step('layout: the page exports as a PNG image', async () => {
      let saved = null;
      const orig = FM.dom.download;
      FM.dom.download = (name, data) => { saved = { name, data }; };
      FM.views.layout._png();
      for (let i = 0; i < 40 && !saved; i++) await wait(100);
      FM.dom.download = orig;
      assert(saved, 'something was saved');
      assert(/\.png$/.test(saved.name), 'named as a PNG: ' + saved.name);
      assert(saved.data && saved.data.size > 2000, 'and it has real content: ' + (saved.data && saved.data.size));
    });

    await step('layout: the page is part of the saved workspace', async () => {
      const doc = JSON.parse(JSON.stringify(ws().toJSON()));
      assert(doc.layout && doc.layout.items.length === 19, 'items travel with the document');
      FM.go('gate'); await settle();
    });

    await step('csv: per-well export has one row per well', async () => {
      const rows = [];
      const orig = FM.dom.download;
      FM.dom.download = (name, data) => rows.push(data);
      try { FM.io.exportWellsCSV(); } finally { FM.dom.download = orig; }
      const lines = String(rows[0]).trim().split(/\r?\n/);
      eq(lines.length, 19, 'header + 18 wells');
      assert(/Beads\+ \| % of parent/.test(lines[0]), 'gate columns');
    });
    await step('csv: Export events writes every cell of a population, with its values', async () => {
      const gate = ws().doc.gates.find(g => g.name === 'Beads+');
      FM.io.exportEventsDialog({ popId: gate.id }); await settle();
      const dlg = $('.modal');
      assert(dlg && /Export events/.test(dlg.textContent), 'dialog open');
      eq(dlg.querySelector('select').value, gate.id, 'population preset');
      const wellsSel = dlg.querySelectorAll('select')[1];
      const g1 = ws().doc.groups[0];
      wellsSel.value = 'g:' + g1.id; wellsSel.dispatchEvent(new Event('change'));
      btn('None', dlg).click();
      const fl1 = $$('.ev-param input', dlg).find(i => i.value === 'FL1-H');
      fl1.checked = true; fl1.dispatchEvent(new Event('change'));
      const keys = ws().samplesIn(g1.id).filter(s => !ws().wellInfo(s.key).excluded);
      const want = keys.reduce((a, s) => a + ws().count(s, gate.id), 0);
      assert(new RegExp(want.toLocaleString() + ' cells × 1 parameter').test($('.ev-est', dlg).textContent), $('.ev-est', dlg).textContent);
      let saved = null;
      const orig = FM.dom.download;
      FM.dom.download = (name, data) => { saved = { name, data }; };
      try { btn('Export CSV', dlg).click(); } finally { FM.dom.download = orig; }
      const text = await saved.data.text();
      const lines = text.trim().split(/\r?\n/);
      eq(lines[0].split(',').slice(0, 4).join(), 'well,file,condition,event', 'header'); assert(/^FL1-H \(/.test(lines[0].split(',')[4]), 'the parameter, with its label: ' + lines[0]);
      eq(lines.length - 1, want, 'one row per gated cell');
      const [well, , , ev, v] = lines[1].split(',');
      const s = ws().samples.find(x => x.well === well);
      assert(Array.from(ws().indices(s, gate.id)).indexOf(+ev - 1) >= 0, 'the event is in the gate');
      assert(Math.abs(+v - s.data['FL1-H'][+ev - 1]) < 0.01, 'its value');
      assert(!$('.modal'), 'closed');
    });
    await step('template: round-trips gates, conditions and measurements', async () => {
      const t = JSON.parse(JSON.stringify(ws().toTemplate()));
      const n = [ws().doc.gates.length, ws().doc.groups.length, ws().doc.tables.length];
      ws().loadDoc(t, { template: true });
      await settle();
      eq(JSON.stringify([ws().doc.gates.length, ws().doc.groups.length, ws().doc.tables.length]), JSON.stringify(n));
      eq(ws().groupOf('A1').name, 'IgG1');
    });
    await step('autosave: the analysis is stored in the browser and can be restored', async () => {
      await wait(1200);   // autosave is debounced
      const a = FM.readAutosave();
      assert(a, 'autosave present');
      eq(a.doc.gates.length, ws().doc.gates.length, 'gates saved');
      eq(a.files.length, 18, 'file list saved');
    });
    await step('workspace: saving then opening restores the analysis on the loaded data', async () => {
      ws().setExcluded(['E1'], true, 'beads not added');   // templates (previous step) drop exclusions by design
      let saved = null;
      const orig = FM.dom.download;
      FM.dom.download = (name, data) => { saved = { name, data }; };
      try { FM.io.saveWorkspace(); } finally { FM.dom.download = orig; }
      assert(/\.flowmate\.json$/.test(saved.name), 'file name ' + saved.name);
      const n = ws().doc.gates.length;
      ws().deleteGate(ws().doc.gates[0].id);
      eq(ws().doc.gates.length, 0, 'root deleted with its children');
      await FM.io.openDocumentFile({ name: saved.name, text: async () => saved.data });
      await settle();
      eq(ws().doc.gates.length, n, 'gates restored');
      assert(ws().wellInfo('E1').excluded, 'exclusion restored');
      assert(ws().pct(ws().sample('A1'), ws().popIdByName('Beads+')) > 40, 'populations recompute');
    });
    await step('guided gating: Cells → Singlets → FL1+ with chips and Accept only', async () => {
      ws().doc.gates.filter(g => !g.parent).map(g => g.id).forEach(id => ws().deleteGate(id));
      FM.setUI({ popId: null, gateId: null });
      FM.go('gate'); await wait(150);
      const click = async text => {
        const b = $$('.guide button').find(x => x.textContent.replace(/\s+/g, ' ').includes(text));
        assert(b, 'guide offers "' + text + '": ' + ($('.guide') || {}).textContent);
        b.click(); await wait(150);
      };
      await click('Cells'); assert(FM.views.gate._suggestion(), 'cells suggested');
      await click('Accept');
      const cells = ws().doc.gates.find(g => g.name === 'Cells');
      assert(cells, 'Cells gate created');
      await click('SSC-A × SSC-H'); await click('Accept');
      const singlets = ws().doc.gates.find(g => g.name === 'Singlets' && g.parent === cells.id);
      assert(singlets, 'Singlets inside Cells');
      // the guide offers one chip per fluorescence channel (FL1, and the demo's FL2 / FL3 stains)
      const fl1 = $$('.guide button').map(x => x.textContent.replace(/\s+/g, ' ')).find(t => /FL1-[AH] × FSC-[AH]/.test(t));
      assert(fl1, 'an FL1 chip: ' + ($('.guide') || {}).textContent);
      await click(/FL1-[AH] × FSC-[AH]/.exec(fl1)[0]); await click('Accept');
      const pos = ws().doc.gates.find(g => g.parent === singlets.id);
      assert(pos && pos.type === 'rect', 'FL1 gate inside Singlets');
      const a1 = ws().sample('A1'), f1 = ws().sample('F1');
      const pc = ws().pct(a1, cells.id), ps = ws().pct(a1, singlets.id), pp = ws().pct(a1, pos.id);
      assert(pc > 60 && pc < 95 && ps > 75 && ps < 99 && pp > 40, 'plausible: ' + [pc, ps, pp].map(v => v.toFixed(1)).join(' / '));
      assert(ws().pct(f1, pos.id) < 2, 'THP alone negative');
      // each new plot was framed on its population: the singlets view is zoomed in
      const root = ws().viewScale(null, 'SSC-A'), inner = ws().viewScale(cells.id, 'SSC-A');
      assert(inner.max <= root.max, 'framed on the gated cells');
    });
    await step('worksheet: every plot side by side with a statistics table; drag, remove, reset, resize', async () => {
      btn('Worksheet', $('.layout-seg')).click(); await settle(); await wait(200);
      const cards = () => $$('.sheet-card');
      const plots = () => $$('.sheet-card:not(.sheet-stats)');
      const parents = new Set(ws().doc.gates.map(g => g.parent || 'root'));
      assert(plots().length >= parents.size, plots().length + ' plots for ' + parents.size + ' gated populations');
      eq(FM.gateSheet.views().size, plots().length, 'a live plot each');
      const shown = sel => { const e = $(sel); return !!e && getComputedStyle(e).display !== 'none'; };
      assert(!shown('.tree-panel') && !shown('.gate-wrap .strip'), 'the population list and the plot strip step aside');
      assert(shown('.wells-panel'), 'the wells panel stays');
      assert(plots().every(c => c.querySelector('canvas.pv-data').width > 0), 'drawn');
      eq($$('.sheet-stats tbody tr').length, ws().doc.gates.length + 1, 'a statistics row per population');
      const order = () => cards().map(c => c.dataset.id);
      const before = order();
      const a = $$('.sheet-head')[1].getBoundingClientRect(), b = $$('.sheet-head')[0].getBoundingClientRect();
      ptr($$('.sheet-head')[1], 'pointerdown', a.left + 30, a.top + 8);
      ptr(document, 'pointermove', a.left + 50, a.top + 8);
      ptr(document, 'pointermove', b.left + b.width / 2, b.top + 8);
      ptr(document, 'pointerup', b.left + b.width / 2, b.top + 8); await settle();
      eq(order().slice(0, 2).join(), [before[1], before[0]].join(), 'second card dragged first');
      assert(ws().doc.sheet && ws().doc.sheet.items.length, 'arrangement saved with the analysis');
      const n = cards().length;
      cards()[0].querySelector('button[aria-label="Remove plot"]').click(); await settle();
      eq(cards().length, n - 1, 'a card taken off');
      $('.sheet-size button:first-child').click(); await settle();
      eq(ws().doc.sheet.size, 's', 'small plots');
      btn('Reset', $('.sheet-bar')).click(); await settle();
      eq(ws().doc.sheet, null); eq(order().join(), before.join(), 'back to the default');
      const row = $$('.sheet-stats tbody tr')[1];
      row.click(); await settle();
      eq(FM.ui.gateId, FM.io.gatesInOrder()[0].id, 'a statistics row selects its gate');
      // Add plot: a new card inside the selected gate; its population is chosen at the top of the card
      const nCards = plots().length;
      btn('Add plot', $('.sheet-bar')).click(); await settle();
      eq(plots().length, nCards + 1, 'a card added');
      const added = plots()[plots().length - 1];
      eq(added.querySelector('.sheet-pop').value, FM.io.gatesInOrder()[0].id, 'inside the selected gate');
      setVal(added.querySelector('.sheet-pop'), FM.io.gatesInOrder()[1].id); await settle();
      const changed = plots()[plots().length - 1];
      eq(changed.querySelector('.sheet-pop').value, FM.io.gatesInOrder()[1].id, 'source changed from the card');
      eq(FM.gateSheet.views().get(changed.dataset.id).pv.model.popId, FM.io.gatesInOrder()[1].id, 'and the plot follows');
      // draw a rectangle on the last plot card: the new gate belongs to that card's population
      const last = plots()[plots().length - 1];
      const rec = FM.gateSheet.views().get(last.dataset.id);
      const pop = rec.pv.model.popId;
      const nGates = ws().doc.gates.length;
      FM.setUI({ tool: 'rect' }); await settle();
      const cv = rec.host.querySelector('canvas.pv-over'), r = cv.getBoundingClientRect(), L = rec.pv.L;
      const at = (fx, fy) => [r.left + L.x0 + fx * (L.x1 - L.x0), r.top + L.y0 + fy * (L.y1 - L.y0)];
      const [x1, y1] = at(0.3, 0.3), [x2, y2] = at(0.7, 0.7);
      ptr(cv, 'pointerdown', x1, y1); ptr(cv, 'pointermove', x2, y2); ptr(cv, 'pointerup', x2, y2); await settle();
      FM.dom.closePop();
      eq(ws().doc.gates.length, nGates + 1, 'a gate drawn on the card');
      eq(ws().doc.gates[nGates].parent || null, pop || null, 'inside the card’s population');
      ws().undo(); await settle();
      btn('One plot', $('.layout-seg')).click(); await settle();
      eq(cards().length, 0, 'single plot again'); eq(FM.gateSheet.views().size, 0, 'card plots released');
      assert(shown('.tree-panel') && shown('.gate-wrap .strip'), 'list and strip back in One plot');
    });
    await step('zoom: the wheel zooms about the cursor and is saved; 0 resets; F focuses', async () => {
      FM.go('gate'); await settle();
      const pv = FM.views.gate._plotView();
      const [x, y] = plotPx(0.5, 0.5);
      for (let i = 0; i < 4; i++) pv.overCv.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY: -120, deltaMode: 0 }));
      await wait(600);
      assert(FM.plot.zoomed(pv.L), 'plot zoomed');
      const v = ws().view(FM.ui.popId || null);
      assert(v && v.zoom && v.zoom.win && (v.zoom.win.x1 - v.zoom.win.x0) < 0.5, 'zoom saved on the view');
      assert(/×/.test($('.zoom-level').textContent), 'zoom level shown');
      key('0'); await wait(600);
      assert(!FM.plot.zoomed(pv.L), 'reset to everything');
      key('f'); await settle();
      assert($('.gate-wrap').classList.contains('focus'), 'focus mode');
      key('f'); await settle();
      assert(!$('.gate-wrap').classList.contains('focus'), 'focus off');
    });
    await step('theme: dark mode re-renders without errors', async () => {
      FM.go('gate'); await settle();
      const themeBtn = $$('.top-actions button')[2];   // undo, redo, theme, help, file
      themeBtn.click();
      await wait(150);
      eq(document.documentElement.getAttribute('data-theme'), 'dark');
      themeBtn.click();
      await wait(100);
    });
    await step('feedback: a floating button opens a form that becomes a prefilled GitHub issue, without data', async () => {
      const fab = $('.fb-fab');
      assert(fab && getComputedStyle(fab).position === 'fixed', 'a floating button on every page');
      fab.click(); await settle();
      assert(/Report a bug or request a feature/.test($('.modal').textContent), 'the form');
      btn('An idea or a request', $('.modal')).click(); await settle();
      setVal($('.fb-title'), 'Export to FlowJo', 'input');
      setVal($('.fb-text'), 'Please add a FlowJo workspace export.', 'input');
      let opened = null;
      const realOpen = window.open;
      window.open = url => { opened = url; return null; };
      try { btn('Open as a GitHub issue', $('.modal')).click(); } finally { window.open = realOpen; }
      await settle();
      assert(opened && opened.startsWith(FM.feedback.REPO + '/issues/new?'), 'a new issue on the project: ' + opened);
      const q = new URLSearchParams(opened.split('?')[1]);
      eq(q.get('title'), '[Feature request] Export to FlowJo');
      assert(/FlowJo workspace export/.test(q.get('body')) && /FlowMate \d/.test(q.get('body')), 'the text and the version');
      assert(!ws().samples.some(s => q.get('body').includes(s.name)), 'no file names in the report');
      eq(q.get('labels'), 'enhancement');
      assert(!$('.modal'), 'closed');
    });
    await step('about: a page of its own from the top bar, with the mission, privacy, beta tools and feedback', async () => {
      const from = FM.ui.step;
      $('.about-btn').click(); await settle();
      eq(FM.ui.step, 'about');
      const text = $('.ab-wrap').textContent;
      assert(/scientist, for scientists/.test(text) && /Nothing is uploaded/.test(text) && /Beta tools/.test(text), 'what it says');
      assert($('.planner-btn .beta'), 'the Planner is marked beta in the top bar');
      btn('Request a feature', $('.ab-wrap')).click(); await settle();
      assert(/Report a bug/.test($('.modal').textContent), 'feedback from About');
      key('Escape'); await settle();
      btn('Back to', $('.ab-head')).click(); await settle();
      eq(FM.ui.step, from, 'back where we were');
    });
    await step('wells + tubes: Plate shows both; the list view highlights and names them together', async () => {
      FM.resetAll(); await settle();
      FM.loadDemo({ controls: true }); FM.ui.plateView = 'plate'; FM.go('plate'); await settle();
      eq($$('.plate-grid .well[data-key]').length, 18, 'the plate');
      eq($$('.tubes tr.tube').length, 4, 'and the tubes under it');
      btn('Wells + tubes', $('.plate-view')).click(); await settle();
      eq($$('.tubes tr.tube').length, 22, 'one list of all 22');
      const row = k => $('.tubes tr.tube[data-key="' + k + '"]');
      const tube = ws().samples.find(s => !s.well).key;
      row('A1').click();
      row(tube).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); await settle();
      eq($$('.tubes tr.tube.sel').length, 2, 'a well and a tube highlighted');
      btn('Create condition', $('.plate-sel')).click(); await settle();
      const g = ws().doc.groups[ws().doc.groups.length - 1];
      eq(ws().wellInfo('A1').group, g.id); eq(ws().wellInfo(tube).group, g.id, 'one condition holds both');
      row('A1').click(); row('A3').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); await settle();
      eq($$('.tubes tr.tube.sel').length, 3, 'shift-click: a range');
      FM.ui.plateView = 'plate';
    });
    await step('wells + tubes: a gate applies to both, and the Gate panel shows both', async () => {
      FM.go('gate'); await settle();
      const tube = ws().samples.find(s => !s.well);
      const id = ws().addGate({ type: 'rect', name: 'Mixed', x: 'FSC-A', y: 'SSC-A', rect: { x0: 100000, x1: 700000, y0: 50000, y1: 600000 }, parent: null });
      FM.setUI({ gateId: id }); await settle();
      assert(ws().count(tube, id) > 0 && ws().count(ws().sample('A1'), id) > 0, 'counts in a tube and a well');
      assert(/wells and tubes/.test($('.wells-title').textContent), 'titled for both');
      assert($$('.mini-plate .mp-cell:not(.none)').length === 18, 'plate map');
      eq($$('.tube-bars .tube-bar').length, 4, 'tubes under it');
      $('.tube-bar[data-key="' + tube.key + '"]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); await settle();
      assert(FM.ui.wellSel.includes(tube.key), 'a tube can be selected like a well');
      btn('Wells + tubes', $('.wells-view')).click(); await settle();
      eq($$('.tube-bars .tube-bar').length, 22, 'everything in one list');
      FM.ui.wellsView = 'plate'; FM.setUI({ wellSel: [] });
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

  function eq(a, b, m) { if (a !== b) throw new Error((m ? m + ': ' : '') + 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

  window.addEventListener('load', () => run().catch(e => {
    document.documentElement.setAttribute('data-uitest', 'crashed ' + e.message);
  }));
})();
