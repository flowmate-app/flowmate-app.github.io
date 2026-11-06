/* UI test for My analyses: save an analysis with its data, close it, reopen it from the
 * list and check that everything comes back — samples, gates, counts, groups, measurements and the
 * step the user was on. Run with: bash tests/run_ui.sh ui_library.js */
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
  function key(k, extra) { document.body.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra || {}))); }
  function log() {
    let pre = document.getElementById('uitest');
    if (!pre) { pre = document.createElement('pre'); pre.id = 'uitest'; document.body.appendChild(pre); }
    return pre;
  }
  async function step(name, fn) {
    log().textContent = out.concat('… ' + name).join('\n');
    try { await fn(); pass++; out.push('PASS ' + name); }
    catch (e) { fail++; out.push('FAIL ' + name + '\n     ' + (e && e.message)); }
  }
  async function until(fn, ms, what) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 4000)) { const v = await fn(); if (v) return v; await wait(50); }
    throw new Error('timed out waiting for ' + (what || 'condition'));
  }
  const ws = () => FM.ws;
  const L = () => FM.library;
  const db = BML.open('flowmate');
  const modalBox = () => $$('.modal').pop();
  /** Every gate's count in every sample, keyed "sample|gate name". */
  function counts() {
    const o = {};
    ws().samples.forEach(s => ws().doc.gates.forEach(g => { o[s.key + '|' + g.name] = ws().count(s, g.id); }));
    return o;
  }
  async function clearLibrary() {
    for (const it of await db.list()) await db.remove(it.id);
  }

  async function run() {
    await wait(300);
    log().textContent = 'clearing library';
    await clearLibrary();
    let before = null, savedStep = null, savedWell = null, firstId = null;

    await step('library: available in this browser', async () => {
      assert(L().available, 'IndexedDB library');
      eq((await db.list()).length, 0, 'starts empty');
    });

    await step('save: Ctrl+S asks for a name and saves the analysis with its data', async () => {
      FM.loadDemo();
      const p = FM.presets.byId('phagocytosis');
      FM.presets.apply(ws(), p, { mapping: FM.presets.autoMap(p, ws().paramNames()), layout: true, replace: true });
      FM.setUI({ sampleKey: 'B2' });
      FM.go('gate');
      await settle();
      const chip = $('.lib-state');
      assert(chip && !chip.classList.contains('hidden') && /Save/.test(chip.textContent), 'top bar offers Save');
      key('s', { ctrlKey: true });
      await settle();
      const box = modalBox();
      assert(box && /Save to My analyses/.test(box.textContent), 'save dialog');
      const input = $('input', box);
      input.value = 'Phagocytosis plate 1';
      btn('Save', $('.modal-foot', box)).click();
      await until(() => L().current() && L().state() === 'idle', 6000, 'save');
      const list = await db.list();
      eq(list.length, 1, 'one analysis');
      eq(list[0].name, 'Phagocytosis plate 1');
      eq(list[0].blobIds.length, 18, 'one data record per well');
      assert(list[0].size > 1e6, 'size counts the events: ' + list[0].size);
      eq(ws().doc.name, 'Phagocytosis plate 1', 'experiment takes the name');
      assert(/Saved/.test($('.lib-state').textContent), 'top bar says Saved');
      firstId = list[0].id;
      before = counts();
      savedStep = FM.ui.step; savedWell = FM.ui.sampleKey;
    });

    await step('autosave: a change after saving is kept without pressing Save', async () => {
      const g = ws().doc.gates[0];
      ws().renameGate(g.id, 'Cells (renamed)');
      before = counts();
      await wait(1500);
      await L().flush();
      const rec = await db.load(firstId);
      assert(rec.doc.gates.some(x => x.name === 'Cells (renamed)'), 'renamed gate saved');
      eq(rec.ui.step, 'gate', 'the step is saved');
      eq(rec.ui.sampleKey, 'B2', 'the sample is saved');
    });

    await step('start over: the analysis closes but stays in My analyses', async () => {
      FM.resetAll();
      FM.go('load');
      await settle();
      eq(ws().samples.length, 0, 'no samples');
      eq(L().current(), null, 'nothing open');
      eq((await db.list()).length, 1, 'still saved');
      const rec = await db.load(firstId);
      eq(rec.doc.gates.length, Object.keys(before).length / 18, 'the saved copy was not overwritten by the empty workspace');
      await until(() => $('.lib-card'), 3000, 'recent list on the empty workspace');
      assert(/Phagocytosis plate 1/.test($('.lib-recent').textContent), 'listed by name');
    });

    await step('reopen: one click brings back data, gates, counts and the step', async () => {
      $('.lib-card').click();
      await until(() => L().current() && ws().samples.length, 6000, 'open');
      await settle();
      eq(ws().samples.length, 18, 'samples');
      const after = counts();
      eq(Object.keys(after).length, Object.keys(before).length, 'same gates × samples');
      Object.keys(before).forEach(k => eq(after[k], before[k], 'count ' + k));
      eq(ws().doc.groups.length, 6, 'groups');
      assert(ws().doc.tables.length > 0, 'the Measure table');
      eq(FM.ui.step, savedStep, 'back on the step');
      eq(FM.ui.sampleKey, savedWell, 'on the same well');
      assert(!ws().canUndo(), 'fresh undo history');
      assert(ws().samples.every(s => s.demo), 'synthetic flag kept');
    });

    await step('reopened analysis keeps saving into the same entry', async () => {
      ws().update('Rename experiment', d => { d.name = 'Phagocytosis plate 1 (final)'; }, { kind: 'settings' });
      await wait(1500);
      await L().flush();
      const list = await db.list();
      eq(list.length, 1, 'no new entry');
      eq(list[0].name, 'Phagocytosis plate 1 (final)', 'name follows the experiment');
    });

    await step('dialog: lists the analysis, duplicates, renames and deletes', async () => {
      L().show();
      await until(() => $('.lib-row'), 3000, 'rows');
      eq($$('.lib-row').length, 1);
      assert($('.lib-row.on'), 'the open one is marked');
      $('.lib-row button[aria-label^="More"]').click();
      await settle();
      btn('Duplicate', $('.pop')).click();
      await until(() => $$('.lib-row').length === 2, 4000, 'copy listed');
      eq((await db.list()).length, 2);
      const copy = (await db.list()).find(x => /\(copy\)$/.test(x.name));
      assert(copy, 'copy named');
      eq(copy.blobIds.length, 18, 'copy has the data');
      eq((await db.blobs(copy.id)).size, 18, 'copy data stored');
      // rename the copy
      $(`.lib-row[data-id="${copy.id}"] button[aria-label^="More"]`).click();
      await settle();
      btn('Rename', $('.pop')).click();
      await settle();
      let box = modalBox();
      $('input', box).value = 'Plate 1 backup';
      btn('Rename', $('.modal-foot', box)).click();
      await until(async () => (await db.meta(copy.id)).name === 'Plate 1 backup', 3000, 'rename');
      await until(() => /Plate 1 backup/.test($('.lib-list').textContent), 3000, 'list refresh');
      // delete it
      $(`.lib-row[data-id="${copy.id}"] button[aria-label^="More"]`).click();
      await settle();
      btn('Delete', $('.pop')).click();
      await settle();
      box = modalBox();
      btn('Delete', $('.modal-foot', box)).click();
      await until(async () => (await db.list()).length === 1, 3000, 'delete');
      eq((await db.blobs(copy.id)).size, 0, 'its data is gone too');
      eq((await db.blobs(firstId)).size, 18, 'the original keeps its data');
      key('Escape');
      await settle();
    });

    let realId = null, realFirst = null;
    await step('real FCS files: saved and reopened event for event', async () => {
      FM.resetAll();
      FM.go('load');
      const names = ['01-Well-A1.fcs', '01-Well-A2.fcs', '01-Well-B1.fcs'];
      const files = await Promise.all(names.map(async n => new File([await (await fetch('data/' + n)).arrayBuffer()], n)));
      await FM.loadFiles(files);
      eq(ws().samples.length, 3, 'loaded');
      const s0 = ws().samples[0];
      const p0 = s0.params[0].name;
      realFirst = { key: s0.key, n: s0.n, sum: s0.raw[p0].reduce((a, v) => a + v, 0), param: p0, params: s0.params.length, meta: s0.meta.$TOT };
      const sp = L().saveAs();
      await settle();
      const box = modalBox();
      $('input', box).value = 'Real plate';
      btn('Save', $('.modal-foot', box)).click();
      await sp;
      realId = L().current().id;
      // open the other analysis, then come back
      await L().open(firstId);
      await until(() => ws().samples.length === 18, 6000, 'first analysis');
      await L().open(realId);
      await until(() => ws().samples.length === 3, 6000, 'real analysis');
      const r0 = ws().sample(realFirst.key);
      assert(r0, 'same key');
      eq(r0.n, realFirst.n, 'events');
      eq(r0.params.length, realFirst.params, 'parameters');
      eq(r0.meta.$TOT, realFirst.meta, 'keywords');
      eq(r0.raw[realFirst.param].reduce((a, v) => a + v, 0), realFirst.sum, 'event values');
      eq(FM.ui.step, 'load', 'never gated: opens on the Load step');
    });

    await step('opening over unsaved work asks first', async () => {
      FM.resetAll();
      FM.loadDemo();
      const pr = L().open(firstId);
      await settle();
      const box = modalBox();
      assert(box && /not in My analyses/.test(box.textContent), 'warns');
      btn('Cancel', $('.modal-foot', box)).click();
      eq(await pr, false, 'cancelled');
      eq(L().current(), null, 'nothing opened');
      eq(ws().samples.length, 18, 'demo still there');
    });

    /** Share an analysis from the dialog; resolves to the file FlowMate would download. */
    async function shareFile(id, withData) {
      const files = [];
      const orig = FM.dom.download;
      FM.dom.download = (name, data) => files.push({ name, data });
      try {
        const pr = L().share(id); await settle();
        const box = modalBox();
        assert(box && /Share/.test(box.querySelector('h2').textContent), 'share dialog');
        const cb = $('input[type=checkbox]', box);
        assert(cb && cb.checked, 'the data is included by default');
        if (!withData) { cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); }
        btn('Save file', $('.modal-foot', box)).click();
        await pr;
      } finally { FM.dom.download = orig; }
      eq(files.length, 1, 'one file');
      assert(/\.flowmate$/.test(files[0].name), 'named .flowmate: ' + files[0].name);
      return files[0];
    }

    await step('share: one file with the data opens as its own analysis, event for event', async () => {
      const f = await shareFile(firstId, true);
      assert(f.data.size > 1e6, 'the data is in the file: ' + f.data.size);
      const nBefore = (await db.list()).length;
      FM.resetAll(); await settle();                         // a different person's FlowMate: nothing open
      eq(await FM.io.openDocumentFile(new File([f.data], f.name)), true, 'opened');
      await until(() => L().current() && L().state() === 'idle', 6000, 'saved into My analyses');
      assert(L().current().id !== firstId, 'a new entry, not the original');
      eq((await db.list()).length, nBefore + 1, 'it joined My analyses');
      eq(ws().samples.length, 18, 'all wells');
      eq(JSON.stringify(counts()), JSON.stringify(before), 'every gate count in every well is the same');
      eq(ws().doc.name, (await db.list()).find(x => x.id === firstId).name, 'keeps its name');
      eq(FM.ui.step, savedStep, 'at the step it was shared from');
    });

    await step('share: without the data it is the analysis alone, applied to whatever is loaded', async () => {
      const f = await shareFile(L().current().id, false);
      assert(f.data.size < 300000, 'no data in the file: ' + f.data.size);
      const groups = ws().doc.groups.length, gates = ws().doc.gates.length;
      FM.resetAll(); await settle();
      eq(await FM.io.openDocumentFile(new File([f.data], f.name)), true, 'opened');
      eq(ws().samples.length, 0, 'no data came with it');
      eq(ws().doc.gates.length, gates, 'gates'); eq(ws().doc.groups.length, groups, 'conditions');
    });

    await step('share: a file that is not a FlowMate analysis is refused with a reason', async () => {
      const before2 = ws().doc.gates.length;
      eq(await FM.io.openDocumentFile(new File(['not json, not a bundle'], 'x.flowmate')), false);
      eq(ws().doc.gates.length, before2, 'nothing changed');
    });

    await step('File menu has the My analyses entries', async () => {
      btn('File').click();
      await settle();
      const pop = $('.pop');
      assert(btn('Save to My analyses', pop) && btn('My analyses…', pop) && btn('Share this analysis', pop) && btn('New analysis', pop), 'menu items');
      FM.dom.closePop();
    });

    await step('no uncaught errors during the run', async () => {
      assert(!(window.__errors || []).length, (window.__errors || []).join(' | '));
    });

    await clearLibrary();
    log().textContent = out.join('\n');
    document.documentElement.setAttribute('data-uitest', 'done pass=' + pass + ' fail=' + fail);
  }

  window.addEventListener('load', () => run().catch(e => {
    document.documentElement.setAttribute('data-uitest', 'crashed ' + e.message);
  }));
})();
