/* UI test for the Unmix (compensation) step, FlowJo-style, on the synthetic spectral experiment
 * (core/synth.js spectralDemo): the wizard (controls, use checkbox, gates, Traditional/Spectral, Create
 * matrix), the matrix list and editor (heat-mapped grid, arrow keys), the N×N preview with corrections
 * by dragging and typing, saving and importing matrix files, the applied-matrix menu, undo, and the
 * dye channels reaching the Gate step.
 * Run: bash tests/run_ui.sh ui_unmix.js */
(function () {
  'use strict';
  const out = [];
  let pass = 0, fail = 0;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const settle = () => wait(150);
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const btn = (text, r) => $$('button', r).find(b => b.textContent.replace(/\s+/g, ' ').trim().includes(text));
  function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
  function eq(a, b, m) { if (a !== b) throw new Error((m ? m + ': ' : '') + 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  async function step(name, fn) {
    try { await fn(); pass++; out.push('PASS ' + name); }
    catch (e) { fail++; out.push('FAIL ' + name + '\n     ' + (e && e.message)); }
  }
  const ptr = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 3, pointerType: 'mouse', isPrimary: true }));
  const ws = () => FM.ws;
  const mat = () => FM.comp.matrixById(ws(), ws().doc.comp.active);

  async function run() {
    await wait(300);
    await step('unmix: a beta tool, not a step; an old link to Compensation lands on it', async () => {
      eq($$('.stepper .step-l').map(e => e.textContent).join(' '), 'Load Plate Gate Measure Analysis');
      FM.go('comp'); await settle();
      eq(FM.ui.step, 'unmix');
      assert(btn('Spectral demo'), 'empty state offers the demo');
    });
    await step('unmix: the demo brings controls, read from the file names, into the wizard', async () => {
      btn('Spectral demo').click(); await wait(400);
      assert($('.cmp-title .beta'), 'marked beta');
      FM.go('gate'); await settle();
      const open = $('.pv-toolbar .unmix-beta');
      assert(open && $('.beta', open), 'the Gate step offers the unmixing tool (beta)');
      open.click(); await settle();
      eq(FM.ui.step, 'unmix', 'and opens it');
      btn('Back to gating').click(); await settle();
      eq(FM.ui.step, 'gate', 'Back to gating');
      FM.go('unmix'); await settle();
      const roles = ws().doc.groups.map(g => g.role);
      eq(roles.filter(r => r === 'comp').length, 6, 'six single-stain conditions');
      eq(roles.filter(r => r === 'unstained').length, 1, 'one unstained');
      eq($$('.cmp-ctl').length, 7, 'six controls and the unstained listed');
      eq($$('.cmp-ctl .cmp-q').length, 7, 'each with a confidence dot');
      eq(FM.views.unmix._applied(), 'none', 'files without a matrix start uncompensated');
      eq($('.cmp-applied').value, 'none');
      eq($('.cmp-name').value, 'Compensation', 'default matrix name');
    });
    await step('unmix: Create matrix unmixes spectrally, applies it and opens the editor', async () => {
      btn('Create matrix').click(); await wait(500);
      eq(mat().kind, 'spectral'); eq(mat().name, 'Compensation');
      eq(ws().doc.comp.confirmed, true);
      eq(FM.ui.unmixTab, 'editor');
      assert($('.umx-sig'), 'signatures drawn');
      eq($$('.cmp-mrow').length, 1, 'listed'); assert(/applied/.test($('.cmp-mrow').textContent), 'marked applied');
      eq($$('.umx-cell').length, 30, 'every dye against every other');
      assert(/under 2%/.test($('.umx-flags').textContent), 'all pairs clean: ' + $('.umx-flags').textContent);
    });
    await step('unmix: a correction typed in the table is flagged on the grid, and undo removes it', async () => {
      $$('.umx-cell')[0].click(); await settle();
      assert($('.umx-zoom .umx-zplot'), 'zoom open');
      const inp = $$('.umx-adj-tbl input')[0];               // row 0, column 1 (the diagonal has no input)
      inp.value = '9'; inp.dispatchEvent(new Event('change', { bubbles: true })); await wait(400);
      eq(Math.round(mat().adjust[0][1] * 100), 9);
      assert($('.umx-cell.bad'), 'the over-corrected pair is red');
      ws().undo(); await wait(400);
      eq(mat().adjust[0][1], 0, 'undone');
    });
    await step('unmix: dragging the handle sets the correction, in one undo step', async () => {
      $$('.umx-cell')[0].click(); await wait(300);
      const at = FM.views.unmix._handle();
      assert(at, 'handle drawn');
      const over = $('.umx-zover');
      const depth = ws().undoStack.length;
      ptr(over, 'pointerdown', at[0], at[1]);
      for (let i = 1; i <= 5; i++) { ptr(over, 'pointermove', at[0], at[1] - i * 8); await wait(20); }
      ptr(over, 'pointerup', at[0], at[1] - 40); await wait(400);
      assert(mat().adjust[0][1] !== 0, 'correction set: ' + mat().adjust[0][1]);
      eq(ws().undoStack.length, depth + 1, 'one undo step');
      btn('Reset corrections').click(); await wait(400);
      eq(mat().adjust[0][1], 0, 'reset');
    });
    await step('unmix: the dyes are channels on the Gate step', async () => {
      FM.go('gate'); await wait(300);
      const opts = Array.from($$('.axis-sel')[0].options).map(o => o.value);
      assert(opts.indexOf('CD3 BV421') >= 0 && opts.indexOf('CD14 APC') >= 0, 'axis menus list the dyes');
      FM.go('unmix'); await settle();
    });
    await step('wizard: a dragged positive gate is stored; an unticked control is left out of the update', async () => {
      btn('Compensation wizard', $('.cmp-tabs')).click(); await settle();
      const cv = $$('.cmp-hist')[0];
      const r = cv.getBoundingClientRect();
      const g = ws().doc.groups.find(x => x.role === 'comp');
      ptr(cv, 'pointerdown', r.left + r.width * 0.75, r.top + 10);
      ptr(cv, 'pointermove', r.left + r.width * 0.8, r.top + 10);
      ptr(cv, 'pointerup', r.left + r.width * 0.8, r.top + 10); await wait(500);
      const set = ws().doc.comp.setup.controls[g.id];
      assert(set && Number.isFinite(set.cut), 'cut stored');
      $$('.cmp-ctl > input[type=checkbox]')[5].click(); await wait(400);
      assert($$('.cmp-ctl')[5].classList.contains('off'), 'row dimmed');
      btn('Update matrix').click(); await wait(500);
      eq(mat().dyes.length, 5, 'five dyes'); eq(ws().doc.comp.matrices.length, 1, 'same name: updated in place');
      btn('Compensation wizard', $('.cmp-tabs')).click(); await settle();
      $$('.cmp-ctl > input[type=checkbox]')[5].click(); await wait(400);
      btn('Update matrix').click(); await wait(500);
      eq(mat().dyes.length, 6, 'six again');
    });
    await step('editor: Traditional gives a spillover grid, heat-mapped, edited with the arrow keys', async () => {
      btn('Compensation wizard', $('.cmp-tabs')).click(); await settle();
      btn('Traditional', $('.umx-method')).click(); await wait(400);
      btn('Update matrix').click(); await wait(500);
      eq(mat().kind, 'spillover'); eq(mat().params.length, 6);
      const cells = $$('.cmp-tbl input.cmp-cell');
      eq(cells.length, 30, 'off-diagonal values are editable');
      assert($$('.cmp-tbl td').some(td => td.style.background), 'heat map coloured');
      const before = mat().spill[0][1];
      cells[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      cells[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, shiftKey: true })); await wait(400);
      assert(Math.abs(mat().spill[0][1] - (Math.round(before * 1e4) / 1e4 + 0.011)) < 1e-4, 'up 0.1% then 1%: ' + before + ' → ' + mat().spill[0][1]);
      assert(mat().edited, 'marked edited');
      btn('Compensation', $('.cmp-grid-bar')).click(); await settle();
      eq($$('.cmp-tbl input.cmp-cell').length, 0, 'the compensation view is read only');
      btn('Spillover', $('.cmp-grid-bar')).click(); await settle();
    });
    await step('editor: the preview follows the parameter checkboxes, and has histograms', async () => {
      eq($$('.umx-cell').length, 30);
      $$('.cmp-tbl td.cmp-show input')[0].click(); await settle();
      eq($$('.umx-cell').length, 20, 'five parameters shown');
      btn('Histograms', $('.cmp-prev')).click(); await settle();
      eq($$('.cmp-histcell').length, 5);
      btn('N×N', $('.cmp-prev')).click(); await settle();
      $('.cmp-grid-bar input[type=checkbox]').click(); await settle();
      eq($$('.umx-cell').length, 30, 'all shown again');
    });
    await step('files: Save as .mtx, then import it back as a new applied matrix; a bad file is refused', async () => {
      let saved = null;
      const real = FM.dom.download;
      FM.dom.download = (name, data) => { saved = { name, data }; };
      try { btn('Save', $('.cmp-mtools')).click(); await settle(); btn('FlowJo matrix (.mtx)').click(); await settle(); }
      finally { FM.dom.download = real; }
      assert(saved && /\.mtx$/.test(saved.name) && /spilloverMatrix/.test(saved.data), 'saved ' + (saved && saved.name));
      const orig = mat();
      const id = await FM.views.unmix._importFile(new File([saved.data.replace('name="Compensation"', 'name="Panel from file"')], 'panel.mtx'));
      await wait(400);
      assert(id, 'imported');
      eq(ws().doc.comp.active, id, 'applied');
      eq(mat().name, 'Panel from file'); eq(mat().source, 'imported');
      mat().spill.forEach((row, i) => row.forEach((v, j) => assert(Math.abs(v - orig.spill[i][j]) < 1e-9, 'values kept')));
      eq($$('.cmp-mrow').length, 2);
      const bad = await FM.views.unmix._importFile(new File(['A,B\n1,0.1\n'], 'bad.csv'));
      eq(bad, null, 'not square: refused');
      const unk = await FM.views.unmix._importFile(new File(['Nope-A,FL1-A\n1,0.1\n0,1\n'], 'unk.csv'));
      eq(unk, null, 'unknown parameter: refused');
      eq(ws().doc.comp.matrices.length, 2);
    });
    await step('list: Edit makes an editable copy that is not applied; the applied menu switches matrices', async () => {
      const active = ws().doc.comp.active;
      btn('Edit', $('.cmp-mtools')).click(); await wait(400);
      eq(ws().doc.comp.matrices.length, 3);
      eq(ws().doc.comp.active, active, 'still the same applied');
      assert(/\(copy\)/.test($('.cmp-ed-name').value), 'editing the copy: ' + $('.cmp-ed-name').value);
      const sel = $('.cmp-applied');
      sel.value = 'none'; sel.dispatchEvent(new Event('change', { bubbles: true })); await wait(400);
      eq(ws().doc.comp.active, 'none');
      ws().undo(); await wait(400);
      eq(ws().doc.comp.active, active, 'undo brings it back');
    });
    await step('unmix: the Plate step offers the control roles, and Analysis leaves controls out', async () => {
      FM.go('plate'); await settle();
      const opts = Array.from($('.role-sel').options).map(o => o.value);
      assert(opts.indexOf('comp') >= 0 && opts.indexOf('unstained') >= 0, 'roles: ' + opts.join());
      const shown = FM.graphs.defaultGroups(ws()).map(id => ws().group(id).role);
      assert(shown.length && shown.every(r => r !== 'comp' && r !== 'unstained'), 'controls are not compared: ' + shown.join());
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
  window.addEventListener('load', () => run().catch(e => { document.documentElement.setAttribute('data-uitest', 'crashed ' + e.message); }));
})();
