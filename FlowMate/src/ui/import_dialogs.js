/* Import / export with other software: FlowJo workspaces in, Gating-ML in and out.
 * Every import ends on a report — what came in, what did not, and (for FlowJo) FlowMate's
 * count beside FlowJo's for every population, so the user can see the import is faithful. */
(function (FM) {
  'use strict';
  const { h, icon, toast, modal, fmtCount } = FM.dom;
  const W = () => FM.ws;

  async function readText(file) { return file.text ? file.text() : new Response(file).text(); }

  // ------------------------------------------------------------------ FlowJo
  async function flowjo(file) {
    if (!file) {
      const f = await FM.dom.pickFiles({ accept: '.wsp,.WSP,.xml' });
      if (!f.length) return null;
      file = f[0];
    }
    let parsed;
    try { parsed = FM.wsp.parse(await readText(file)); }
    catch (e) { toast(e.message, { level: 'crit', ms: 6000 }); return null; }
    if (!parsed.samples.length) { toast('This workspace lists no samples.', { level: 'crit' }); return null; }
    const pairs = FM.wsp.match(W(), parsed);
    const missing = pairs.filter(p => !p.s);
    if (missing.length) {
      const go = await askForFiles(file.name, parsed, pairs);
      if (!go) return null;
    }
    return runImport(parsed, file.name);
  }

  /** Some of the workspace's FCS files are not loaded: offer to load them first. */
  function askForFiles(name, parsed, pairs) {
    return new Promise(done => {
      let settled = false;
      const resolve = v => { if (!settled) { settled = true; done(v); } };
      const have = pairs.filter(p => p.s).length;
      const list = h('ul.imp-missing', pairs.filter(p => !p.s).slice(0, 12).map(p => h('li.mono', p.ps.file)),
        pairs.filter(p => !p.s).length > 12 ? h('li.muted', '… and ' + (pairs.filter(p => !p.s).length - 12) + ' more') : null);
      const load = async dir => {
        const files = await FM.dom.pickFiles(dir ? { directory: true } : { multiple: true, accept: '.fcs,.FCS,.lmd' });
        if (!files.length) return;
        settled = true;          // closing the dialog must not read as Cancel
        m.close();
        await FM.loadFiles(files);
        done(true);
      };
      const m = modal({
        title: 'Load the FCS files for ' + name,
        subtitle: 'The workspace holds the gates; the data is in its FCS files. ' + have + ' of ' + parsed.samples.length + ' are loaded. Choose the rest (FlowMate matches them by file name) or import with what is here.',
        body: h('div.col', list,
          h('div.row', h('button.btn.primary', { on: { click: () => load(false) } }, icon('file'), 'Choose FCS files…'),
            h('button.btn', { on: { click: () => load(true) } }, icon('folder'), 'Choose a folder…'))),
        buttons: [{ label: 'Cancel', fn: () => resolve(false) },
          have ? { label: 'Import with the ' + have + ' loaded', fn: () => resolve(true) } : null].filter(Boolean),
        onClose: () => resolve(false),
      });
    });
  }

  function runImport(parsed, name) {
    let rep;
    try { rep = FM.wsp.importInto(W(), parsed); }
    catch (e) { toast('Import failed: ' + e.message, { level: 'crit', ms: 8000 }); console.error(e); return null; }
    showFlowJoReport(rep, name);
    if (rep.gates) {
      FM.ui.wsOpen = new Set(W().samples.slice(0, 1).map(s => s.key));
      FM.go('workspace');
    }
    return rep;
  }

  // ------------------------------------------------------------- the example
  let example = null;     // { list, text } of the example now open, for "Save the example files"

  /** Open the built-in example: synthetic tubes + a workspace in FlowJo 10's format. */
  async function flowjoExample() {
    const ws = W();
    if (ws.samples.length || ws.doc.gates.length) {
      const ok = await FM.dom.confirm('Open the example workspace?', 'The example replaces what is open now. Save a workspace first (File → Save workspace) if you want to come back to it.', 'Open the example');
      if (!ok) return null;
    }
    FM.resetAll();
    const ex = FM.examples.tcell;
    const list = ex.samples();
    ws.addSamples(list);
    const text = ex.workspace(list);
    example = { list, text };
    const rep = FM.wsp.importInto(ws, FM.wsp.parse(text));
    ws.update('Name the example', d => { d.name = 'T-cell activation (FlowJo example)'; }, { kind: 'settings' });
    ws.undoStack = []; ws.redoStack = [];
    const first = ws.samples.find(s => s.name === 'Donor1_SEB.fcs') || ws.samples[0];
    FM.ui.wsOpen = new Set([first.key]);
    FM.ui.wsSel = { key: first.key, pop: null };
    FM.ui.wsGroup = null;
    FM.go('workspace');
    showFlowJoReport(rep, ex.fileName, { example: true });
    return rep;
  }

  /** The example's .wsp and FCS files, to look at or to open the long way round. */
  async function saveExampleFiles() {
    if (!example) return;
    FM.dom.download('T-cell activation (example).wsp', example.text, 'application/xml');
    for (const s of example.list) {
      await new Promise(r => setTimeout(r, 250));
      FM.dom.download(s.name, new Blob([FM.fcs.write(s)], { type: 'application/vnd.isac.fcs' }));
    }
    toast('Saved the workspace and ' + example.list.length + ' FCS files — your browser may ask before saving several files');
  }

  const TOL = row => Math.max(3, 0.005 * row.flowjo);

  function showFlowJoReport(rep, name, opts) {
    opts = opts || {};
    const rows = rep.compare.slice().sort((a, b) => (b.error ? 1 : 0) - (a.error ? 1 : 0) || Math.abs(b.diffPct) - Math.abs(a.diffPct));
    const na = rows.filter(r => r.error || r.ours == null);
    const ok = rows.filter(r => !(r.error || r.ours == null));
    const exact = ok.filter(r => r.diff === 0).length, close = ok.filter(r => Math.abs(r.diff) <= TOL(r)).length;
    const onlyDiff = h('input', { type: 'checkbox', checked: rows.length > 40 });
    const body = h('tbody');
    const draw = () => {
      FM.dom.clear(body);
      rows.filter(r => !onlyDiff.checked || r.diff !== 0).slice(0, 400).forEach(r => body.appendChild(h('tr' + (r.ours == null || Math.abs(r.diff) > TOL(r) ? '.imp-off' : ''),
        h('td.mono', r.sample), h('td', { title: r.path }, r.path),
        h('td.r.mono', fmtCount(r.flowjo)),
        r.ours == null ? h('td.r', { title: r.error || '' }, 'not available') : h('td.r.mono', fmtCount(r.ours)),
        h('td.r.mono', r.ours == null ? (r.error || '—') : r.diff === 0 ? '=' : (r.diff > 0 ? '+' : '') + r.diff + ' (' + r.diffPct.toFixed(2) + ' %)'))));
      if (!body.children.length) body.appendChild(h('tr', h('td.muted', { colSpan: 5 }, 'Every count is identical.')));
    };
    onlyDiff.addEventListener('change', draw);
    draw();
    const summary = [
      fact('Samples', rep.matched.length + ' matched' + (rep.missing.length ? ' · ' + rep.missing.length + ' not loaded' : '')),
      fact('Gates', String(rep.gates)),
      fact('Groups', String(rep.groups)),
      fact('Compensation', !rep.compensation ? 'none in the workspace'
        : (rep.compensation === 'file' ? 'each file’s own matrix' : 'FlowJo’s matrix') + ' · ' + (rep.compensatedSamples != null ? rep.compensatedSamples + ' of ' + rep.matched.length + ' samples compensated' : '')),
    ];
    const errs = Array.from(new Set(na.map(r => r.error).filter(Boolean)));
    const notComp = rep.compensation && rep.compensatedSamples != null && rep.compensatedSamples < rep.matched.length;
    const problems = [
      na.length ? h('div.note.crit', icon('alert'), h('div', h('strong', na.length + ' population count' + (na.length > 1 ? 's' : '') + ' could not be computed'),
        ' — shown as “not available”, never as 0. ', errs.slice(0, 3).join(' · ') + (errs.length > 3 ? ' …' : ''))) : null,
      notComp ? h('div.note.crit', icon('alert'), h('div', h('strong', (rep.matched.length - rep.compensatedSamples) + ' of ' + rep.matched.length + ' samples are not compensated'),
        ' although the workspace has a matrix: its channels do not match the files’ (see the notes).')) : null,
    ];
    const agree = ok.length ? h('div.note' + (close === ok.length ? '.ok' : '.warn'), icon(close === ok.length ? 'okCircle' : 'alert'),
      h('div', h('strong', close + ' of ' + ok.length + ' population counts within 0.5 % of FlowJo’s'), ' (' + exact + ' identical). ',
        close === ok.length ? 'The import reproduces FlowJo’s numbers.' : 'FlowJo computes statistics on binned data, so exact-geometry counts differ slightly, most at gate edges that cut through dense populations; larger differences are marked.'))
      : h('div.note.small', icon('info'), h('span', 'This workspace has no counts saved by FlowJo (FlowJo writes them when it recalculates), so there is nothing to compare — the gates themselves came in.'));
    const intro = opts.example ? h('div.imp-example',
      h('p', h('strong', 'A FlowJo workspace'), ' (a .wsp file) is the analysis FlowJo saves: which FCS files belong together, the groups, every gate, the compensation and the axis settings. It holds no data — the events stay in the FCS files. Opening one lets you carry on in FlowMate without redrawing anything.'),
      h('p', 'This example is a T-cell activation experiment: two donors, unstimulated or stimulated with SEB, stained for CD3, CD4, CD8 and IFN-γ, plus an unstained tube and four single stains for compensation. The data is synthetic; the workspace is written in FlowJo 10’s format, and FlowKit — an independent reader of FlowJo files — reads it the same way.'),
      h('ul',
        h('li', 'Groups on the left: ', h('em', 'Compensation'), ', ', h('em', 'Unstimulated'), ', ', h('em', 'SEB'), '. The controls only carry scatter gates.'),
        h('li', 'Expand ', h('strong', 'Donor1_SEB'), ': CD3+ → CD4+ / CD8+ → IFNg+, an Or gate (', h('em', 'IFNg+ T cells'), '), a Not gate (', h('em', 'Non-T cells'), ') and an ellipse (', h('em', 'Monocytes'), ').'),
        h('li', h('strong', 'Donor2_SEB'), '’s IFNg+ gate is set a little higher in this workspace: it is marked ✦ — its own version of the shared gate.'),
        h('li', 'Tables (step 6): % IFNg+ for every tube. Comp (step 7): the acquisition matrix from the files.')),
      h('div.row', h('button.btn.sm', { on: { click: saveExampleFiles } }, icon('download'), 'Save the example files (.wsp + 9 FCS)'),
        h('span.muted.small', 'to look inside, or to try File → Import FlowJo workspace yourself'))) : null;
    modal({
      title: opts.example ? 'Example: ' + name : 'Imported ' + name,
      subtitle: opts.example ? 'An example workspace in FlowJo 10’s format, opened in FlowMate.' : 'FlowJo ' + (rep.flowjoVersion || '') + ' workspace → FlowMate. Undo removes the whole import in one step.',
      wide: true,
      body: h('div.col.imp-report',
        intro,
        h('div.imp-facts', summary),
        problems,
        agree,
        rep.warnings.length ? h('details.imp-warn', h('summary', rep.warnings.length + ' note' + (rep.warnings.length > 1 ? 's' : '')), h('ul', rep.warnings.map(w => h('li', w)))) : null,
        rows.length ? h('label.check', onlyDiff, h('span', 'Show only populations that differ')) : null,
        rows.length ? h('div.scroll.imp-table', h('table.tbl', h('thead', h('tr', h('th', 'Sample'), h('th', 'Population'), h('th.r', 'FlowJo'), h('th.r', 'FlowMate'), h('th.r', 'Δ'))), body)) : null),
      buttons: [{ label: 'Close', primary: true }],
    });
  }

  function fact(k, v) { return h('div.fact', h('div.eyebrow', k), h('div.fact-v', v)); }

  // ---------------------------------------------------------------- Gating-ML
  async function gatingml(file) {
    if (!file) {
      const f = await FM.dom.pickFiles({ accept: '.xml,.XML' });
      if (!f.length) return null;
      file = f[0];
    }
    let rep;
    try { rep = FM.gatingml.importInto(W(), await readText(file)); }
    catch (e) { toast(e.message, { level: 'crit', ms: 6000 }); return null; }
    modal({
      title: 'Imported ' + file.name,
      subtitle: rep.gates + ' gate' + (rep.gates === 1 ? '' : 's') + ' added' + (rep.compensation ? ' · compensation: ' + (rep.compensation === 'file' ? 'each file’s matrix' : rep.compensation === 'none' ? 'off (the file asks for uncompensated data)' : 'the file’s matrix') : '') + '. Undo removes the import in one step.',
      body: h('div.col', rep.warnings.length ? h('ul.imp-notes', rep.warnings.map(w => h('li', w))) : h('p.muted', 'Everything in the file was understood.')),
      buttons: [{ label: 'Close', primary: true }],
    });
    if (rep.gates && FM.ui.step === 'workspace' && FM.views.workspace) FM.views.workspace.update('ws:gates');
    return rep;
  }

  function exportGatingml() {
    const ws = W();
    const r = FM.gatingml.export(ws);
    const name = String(ws.doc.name || 'flowmate').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'flowmate';
    FM.dom.download(name + '.gating-ml.xml', r.xml, 'application/xml');
    if (r.warnings.length) modal({ title: 'Exported Gating-ML', subtitle: 'Saved ' + name + '.gating-ml.xml. Some things have no Gating-ML form:', body: h('ul.imp-notes', r.warnings.map(w => h('li', w))), buttons: [{ label: 'OK', primary: true }] });
    else toast('Saved ' + name + '.gating-ml.xml — ' + ws.doc.gates.length + ' gates');
    return r;
  }

  FM.importDialogs = { flowjo, flowjoExample, saveExampleFiles, gatingml, exportGatingml, showFlowJoReport };
})(FM);
