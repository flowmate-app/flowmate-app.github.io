/* Step 1 — Workspace: the FlowJo-familiar home. Groups on the left, every sample with its
 * population tree in the middle, a live preview on the right.
 *
 * Drag samples onto a group to assign them; drag a population onto a group to apply its gate
 * to that group (shift: to that group only). Double-click a sample or a population to open it
 * on the Gate step. With nothing loaded, the Load screen (drop zone, demo, restore) shows here.
 */
(function (FM) {
  'use strict';
  const { h, icon, clear, fmtPct, fmtCount, menu, popover, toast } = FM.dom;
  const W = () => FM.ws;
  const DND = 'application/x-flowmate';

  let root = null, els = {}, mode = null;
  let search = '';
  let selKeys = new Set();          // samples picked with ctrl/shift for bulk actions
  let anchorKey = null;
  let rowsOrder = [];               // visible rows, for keyboard navigation

  // ----------------------------------------------------------------- mount
  function mount(el) {
    root = el;
    clear(root);
    if (!W().samples.length) {
      mode = 'load';
      FM.views.load.mount(el);
      return;
    }
    mode = 'table';
    els = {};
    els.bar = h('div.wsv-bar');
    els.groups = h('div.wsv-glist');
    els.head = h('div.wsv-row.wsv-headrow');
    els.rows = h('div.wsv-rows', { tabindex: 0, 'aria-label': 'Samples and populations' });
    els.preview = h('div.wsv-pbody');
    els.foot = h('div.wsv-foot.muted.small');
    root.appendChild(h('div.wsv-wrap',
      els.bar,
      h('aside.panel.wsv-groups',
        h('div.panel-head', h('h3', 'Groups'), h('span.grow'),
          h('button.btn.ghost.sm', { 'data-tip': 'New group', on: { click: e => newGroup(e.currentTarget) } }, icon('plus'), 'Group')),
        h('div.scroll', els.groups),
        h('div.wsv-ghint.muted.small', 'Drag samples onto a group to put them in it. Drag a population onto a group to apply its gate there.')),
      h('section.panel.wsv-table', els.head, h('div.scroll.wsv-scroll', els.rows), els.foot),
      h('aside.panel.wsv-preview', h('div.panel-head', h('h3', 'Preview'), h('span.grow'), h('span.muted.small', 'double-click to open')), els.preview)));
    renderAll();
  }

  function unmount() {
    if (mode === 'load' && FM.views.load.unmount) FM.views.load.unmount();
    root = null; mode = null;
  }

  function renderAll() {
    if (!root || mode !== 'table') return;
    sanitize();
    renderBar();
    renderGroups();
    renderTable();
    renderPreview();
  }

  /** Drop selections that point at things that no longer exist. */
  function sanitize() {
    const ws = W();
    if (FM.ui.wsGroup && !ws.group(FM.ui.wsGroup)) FM.ui.wsGroup = null;
    const sel = FM.ui.wsSel;
    if (sel && (!ws.sample(sel.key) || (sel.pop && !ws.gate(sel.pop)))) FM.ui.wsSel = null;
    if (!FM.ui.wsSel && ws.samples.length) FM.ui.wsSel = { key: visibleSamples()[0] ? visibleSamples()[0].key : ws.samples[0].key, pop: null };
    selKeys.forEach(k => { if (!ws.sample(k)) selKeys.delete(k); });
  }

  // ------------------------------------------------------------------ bar
  function renderBar() {
    const ws = W();
    clear(els.bar);
    const kwSel = h('select.input.sm.wsv-kw', { 'aria-label': 'Keyword column', on: { change: e => { FM.ui.wsKeyword = e.target.value; FM.savePrefs(); renderTable(); } } },
      h('option', { value: '' }, 'No keyword column'),
      keywordNames().map(k => h('option', { value: k, selected: k === FM.ui.wsKeyword }, k)));
    const searchBox = h('input.input.sm.wsv-search', { type: 'search', placeholder: 'Find a sample…', value: search, 'aria-label': 'Find a sample',
      on: { input: e => { search = e.target.value; renderTable(); } } });
    const anyOpen = FM.ui.wsOpen.size > 0;
    FM.dom.append(els.bar, [
      h('button.btn.sm', { on: { click: async () => { const f = await FM.dom.pickFiles({ multiple: true, accept: '.fcs,.FCS,.lmd' }); if (f.length) await FM.loadFiles(f); } } }, icon('plus'), 'Add files'),
      h('button.btn.sm', { on: { click: async () => { const f = await FM.dom.pickFiles({ directory: true }); if (f.length) await FM.loadFiles(f); } } }, icon('folder'), 'Add folder'),
      h('button.btn.sm', { 'data-tip': 'Bring in a FlowJo workspace (.wsp): the groups, gates, compensation and axes of an analysis done in FlowJo', on: { click: () => FM.importDialogs.flowjo() } }, icon('enter'), 'Open FlowJo workspace'),
      h('button.btn.ghost.sm', { 'data-tip': 'Open an example FlowJo workspace (synthetic T-cell data)', on: { click: () => FM.importDialogs.flowjoExample() } }, icon('flask'), 'Example'),
      h('span.sep'),
      searchBox,
      h('span.grow'),
      h('span.muted.small.wsv-count', ws.samples.length + ' samples · ' + ws.doc.gates.length + ' gates · ' + ws.doc.groups.length + ' groups'),
      h('button.btn.ghost.sm', { 'data-tip': anyOpen ? 'Collapse every sample' : 'Show every sample’s populations', on: { click: () => {
        if (anyOpen) FM.ui.wsOpen = new Set(); else FM.ui.wsOpen = new Set(visibleSamples().map(s => s.key));
        renderBar(); renderTable();
      } } }, icon(anyOpen ? 'up' : 'down'), anyOpen ? 'Collapse all' : 'Expand all'),
      kwSel,
    ]);
  }

  /** Keywords worth a column: present in the files, not per-parameter detail. */
  function keywordNames() {
    const ws = W();
    const seen = new Map();
    ws.samples.forEach(s => Object.keys(s.meta || {}).forEach(k => {
      if (/^\$?P\d+[A-Z]$/i.test(k) || /^\$(BEGIN|END)|^\$(BYTEORD|DATATYPE|MODE|NEXTDATA|PAR|TOT|SPILLOVER)$|^SPILL$/i.test(k)) return;
      seen.set(k, (seen.get(k) || 0) + 1);
    }));
    const pri = ['$DATE', '$BTIM', '$ETIM', 'TUBE NAME', '$SRC', '$WELLID', '$SMNO', 'EXPERIMENT NAME', '$FIL', '$CYT'];
    return Array.from(seen.keys()).sort((a, b) => ((pri.indexOf(a) + 1 || 99) - (pri.indexOf(b) + 1 || 99)) || a.localeCompare(b));
  }

  // --------------------------------------------------------------- groups
  const ROLE_LABEL = { gate: 'gate control', comp: 'comp controls' };

  function renderGroups() {
    const ws = W();
    clear(els.groups);
    const row = (g, n) => {
      const id = g ? g.id : null;
      const on = (FM.ui.wsGroup || null) === id;
      const el = h('button.wsv-group' + (on ? '.on' : ''), {
        'data-gid': id || '', 'aria-pressed': on ? 'true' : 'false',
        on: {
          click: () => { FM.ui.wsGroup = id; FM.ui.wsSel = null; renderAll(); },
          contextmenu: e => { if (!g) return; e.preventDefault(); groupMenu(g, { x: e.clientX, y: e.clientY }); },
          dragover: e => { if (Array.from(e.dataTransfer.types || []).includes(DND)) { e.preventDefault(); el.classList.add('drop'); } },
          dragleave: () => el.classList.remove('drop'),
          drop: e => { el.classList.remove('drop'); const d = readDrag(e); if (!d) return; e.preventDefault(); onDropGroup(d, id, e.shiftKey); },
        },
      },
        g ? h('span.swatch', { style: { background: g.color } }) : h('span.wsv-allico', icon('layers')),
        h('span.wsv-gname', g ? g.name : 'All samples'),
        g && ROLE_LABEL[g.role] ? h('span.chip.wsv-role', ROLE_LABEL[g.role]) : null,
        h('span.wsv-gn.mono', String(n)),
        g ? h('span.btn.ghost.sm.icon.wsv-gmore', { role: 'button', 'data-tip': 'More', on: { click: e => { e.stopPropagation(); groupMenu(g, e.currentTarget); } } }, icon('more')) : null);
      return el;
    };
    els.groups.appendChild(row(null, ws.samples.length));
    ws.doc.groups.forEach(g => els.groups.appendChild(row(g, ws.samplesIn(g.id).length)));
    const none = ws.samples.filter(s => !ws.groupOf(s.key)).length;
    if (ws.doc.groups.length && none) els.groups.appendChild(h('div.wsv-gnone.muted.small', none + ' sample' + (none > 1 ? 's are' : ' is') + ' in no group'));
  }

  function newGroup(anchor, thenAssign) {
    const inp = h('input.input', { placeholder: 'Group name', 'aria-label': 'Group name' });
    const save = () => {
      const v = inp.value.trim();
      if (!v) return;
      FM.dom.closePop();
      const id = W().addGroup(v, /^comp/i.test(v) ? 'comp' : 'sample');
      if (thenAssign && thenAssign.length) W().assign(thenAssign, id);
      toast('Group “' + v + '” added' + (thenAssign && thenAssign.length ? ' with ' + thenAssign.length + ' sample' + (thenAssign.length > 1 ? 's' : '') : ''));
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') FM.dom.closePop(); });
    popover(anchor, h('div.rename-pop', h('div.eyebrow', 'New group'), h('div.row', inp, h('button.btn.primary.sm', { on: { click: save } }, 'Add'))), { width: 260 });
    FM.dom.frame(() => inp.focus());
  }

  function groupMenu(g, anchor) {
    const ws = W();
    const role = r => ({ label: { sample: 'Ordinary group', gate: 'Gate control (Suggest places gates from it)', comp: 'Compensation controls' }[r],
      icon: g.role === r ? 'check' : null, hint: g.role === r ? '✓' : '', fn: () => ws.updateGroup(g.id, { role: r }) });
    menu(anchor, [
      { label: 'Rename…', icon: 'edit', fn: () => renameGroup(g, anchor) },
      { label: 'Select its samples', icon: 'check', fn: () => { selKeys = new Set(ws.samplesIn(g.id).map(s => s.key)); renderTable(); } },
      'sep', { heading: 'Role' }, role('sample'), role('gate'), role('comp'),
      'sep',
      { label: 'Delete group', icon: 'trash', danger: true, fn: () => {
        ws.deleteGroup(g.id);
        toast('Deleted group ' + g.name + ' — its samples are kept', { action: { label: 'Undo', fn: () => ws.undo() } });
      } },
    ]);
  }

  function renameGroup(g, anchor) {
    const inp = h('input.input', { value: g.name, 'aria-label': 'Group name' });
    const save = () => { const v = inp.value.trim(); FM.dom.closePop(); if (v && v !== g.name) W().updateGroup(g.id, { name: v }); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') FM.dom.closePop(); });
    popover(anchor && anchor.getBoundingClientRect ? anchor : { x: anchor.x, y: anchor.y }, h('div.rename-pop', h('div.eyebrow', 'Rename group'), h('div.row', inp, h('button.btn.primary.sm', { on: { click: save } }, 'Save'))), { width: 260 });
    FM.dom.frame(() => inp.select());
  }

  // ----------------------------------------------------------- drag & drop
  function readDrag(e) {
    try { return JSON.parse(e.dataTransfer.getData(DND)); } catch (_) { return null; }
  }

  /** Samples dropped on a group join it; a population dropped on a group applies its gate there. */
  function onDropGroup(d, groupId, replace) {
    const ws = W();
    if (d.kind === 'samples') return dropSamples(d.keys, groupId);
    if (d.kind === 'gate') return dropPop(d.id, groupId, replace);
  }

  function dropSamples(keys, groupId) {
    const ws = W();
    keys = keys.filter(k => ws.sample(k));
    if (!keys.length) return;
    ws.assign(keys, groupId);
    const g = groupId ? ws.group(groupId) : null;
    toast(keys.length + ' sample' + (keys.length > 1 ? 's' : '') + (g ? ' moved to ' + g.name : ' taken out of their group'), { action: { label: 'Undo', fn: () => ws.undo() } });
  }

  function dropPop(gateId, groupId, replace) {
    const ws = W();
    const g = ws.gate(gateId);
    if (!g) return;
    if (!groupId) ws.setGateScope(gateId, null);
    else if (replace || !FM.scope.isScoped(g)) ws.setGateScope(gateId, { groups: [groupId] });
    else ws.addGateScopeGroup(gateId, groupId);
    toast(g.name + ' now applies to ' + ws.scopeText(gateId), { action: { label: 'Undo', fn: () => ws.undo() } });
  }

  // ---------------------------------------------------------------- table
  function visibleSamples() {
    const ws = W();
    const q = search.trim().toLowerCase();
    return ws.samples.filter(s => {
      if (FM.ui.wsGroup && (ws.wellInfo(s.key).group || null) !== FM.ui.wsGroup) return false;
      if (q && !(String(s.name).toLowerCase().includes(q) || String(s.well || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function renderTable() {
    const ws = W();
    clear(els.head); clear(els.rows);
    const kw = FM.ui.wsKeyword;
    els.rows.classList.toggle('with-kw', !!kw);
    els.head.classList.toggle('with-kw', !!kw);
    FM.dom.append(els.head, [h('span', 'Name'), h('span', 'Group'), h('span.r', { 'data-tip': '% of the parent population' }, 'Statistic'), h('span.r', '#Events'), kw ? h('span', kw) : null]);
    const list = visibleSamples();
    rowsOrder = [];
    const frag = document.createDocumentFragment();
    list.forEach(s => {
      frag.appendChild(sampleRow(s, kw));
      rowsOrder.push({ key: s.key, pop: null });
      if (FM.ui.wsOpen.has(s.key)) popRows(s, null, 1, frag);
    });
    els.rows.appendChild(frag);
    if (!list.length) els.rows.appendChild(h('div.wsv-empty.muted', search ? 'No sample matches “' + search + '”.' : 'No samples in this group yet — drag some onto it.'));
    clear(els.foot);
    FM.dom.append(els.foot, [selKeys.size
      ? h('span', h('strong', String(selKeys.size)), ' selected · ', h('button.btn.ghost.sm', { on: { click: e => bulkMenu(e.currentTarget) } }, 'Actions', icon('down')), h('button.btn.ghost.sm', { on: { click: () => { selKeys.clear(); renderTable(); } } }, 'Clear'))
      : h('span', 'Click a row to preview it · ctrl- or shift-click to select several · drag rows onto a group')]);
  }

  function sampleRow(s, kw) {
    const ws = W();
    const g = ws.groupOf(s.key);
    const info = ws.wellInfo(s.key);
    const open = FM.ui.wsOpen.has(s.key);
    const sel = FM.ui.wsSel && FM.ui.wsSel.key === s.key && !FM.ui.wsSel.pop;
    const kids = ws.children(null, s.key).length;
    const row = h('div.wsv-row.wsv-sample' + (sel ? '.sel' : '') + (selKeys.has(s.key) ? '.picked' : '') + (info.excluded ? '.excl' : ''), {
      draggable: true, 'data-key': s.key, role: 'row',
      on: {
        click: e => clickRow(e, s.key, null),
        dblclick: () => openInGate(s.key, null),
        contextmenu: e => { e.preventDefault(); clickRow(e, s.key, null, true); sampleMenu(s, { x: e.clientX, y: e.clientY }); },
        dragstart: e => {
          const keys = selKeys.has(s.key) ? Array.from(selKeys) : [s.key];
          e.dataTransfer.setData(DND, JSON.stringify({ kind: 'samples', keys }));
          e.dataTransfer.effectAllowed = 'move';
        },
      },
    },
      h('span.wsv-name',
        h('button.wsv-tw' + (kids ? '' : '.none'), { 'aria-label': open ? 'Collapse' : 'Expand', on: { click: e => { e.stopPropagation(); toggle(s.key); } } }, kids ? icon(open ? 'down' : 'right') : null),
        h('span.wsv-ico', icon('file')),
        h('span.wsv-label', { title: s.name }, s.well ? h('span.wsv-well.mono', s.well) : null, s.name),
        info.excluded ? h('span.chip.warn', { 'data-tip': info.reason || 'Excluded' }, 'excluded') : null,
        s.compensated ? h('span.chip.wsv-comp', { 'data-tip': 'Read through ' + ((s.compMatrix && s.compMatrix.name) || 'a spillover matrix') }, 'comp') : null),
      h('span.wsv-grp', g ? [h('span.swatch', { style: { background: g.color } }), g.name] : h('span.faint', '—')),
      h('span.r.mono.faint', ''),
      h('span.r.mono', fmtCount(s.n)),
      kw ? h('span.mono.wsv-kwv', { title: (s.meta || {})[kw] || '' }, (s.meta || {})[kw] || '') : null);
    return row;
  }

  function popRows(s, parentId, depth, frag) {
    const ws = W();
    ws.children(parentId, s.key).forEach(g => {
      const sel = FM.ui.wsSel && FM.ui.wsSel.key === s.key && FM.ui.wsSel.pop === g.id;
      const adj = ws.isAdjusted(g.id, s.key);
      const pct = ws.pct(s, g.id), n = ws.count(s, g.id);
      const err = s._popErrors && s._popErrors[g.id];
      const row = h('div.wsv-row.wsv-pop' + (sel ? '.sel' : ''), {
        draggable: true, 'data-key': s.key, 'data-gate': g.id, role: 'row',
        on: {
          click: e => clickRow(e, s.key, g.id),
          dblclick: () => openInGate(s.key, g.id),
          contextmenu: e => { e.preventDefault(); clickRow(e, s.key, g.id, true); popMenu(s, g, { x: e.clientX, y: e.clientY }); },
          dragstart: e => { e.dataTransfer.setData(DND, JSON.stringify({ kind: 'gate', id: g.id })); e.dataTransfer.effectAllowed = 'link'; },
        },
      },
        h('span.wsv-name', { style: { paddingLeft: (6 + depth * 18) + 'px' } },
          h('span.wsv-ico', FM.gateGlyph ? FM.gateGlyph(g) : icon('polygon')),
          h('span.wsv-label', g.name),
          g.outside ? h('span.chip', { 'data-tip': 'Keeps the events outside the shape' }, 'outside') : null,
          adj ? h('span.chip.adj', { 'data-tip': 'This sample uses its own version of ' + g.name }, '✦') : null,
          FM.scope.isScoped(g) ? h('span.wsv-scope', { 'data-tip': 'Applies to ' + ws.scopeText(g) }, icon('target')) : null,
          err ? h('span.chip.crit', { 'data-tip': err }, 'error') : null),
        h('span'),
        h('span.r.mono', fmtPct(pct)),
        h('span.r.mono', fmtCount(n)),
        FM.ui.wsKeyword ? h('span') : null);
      frag.appendChild(row);
      rowsOrder.push({ key: s.key, pop: g.id });
      popRows(s, g.id, depth + 1, frag);
    });
  }

  function toggle(key) {
    if (FM.ui.wsOpen.has(key)) FM.ui.wsOpen.delete(key); else FM.ui.wsOpen.add(key);
    renderBar(); renderTable();
  }

  function clickRow(e, key, pop, keepSel) {
    if (!pop && (e.ctrlKey || e.metaKey)) {
      if (selKeys.has(key)) selKeys.delete(key); else selKeys.add(key);
      anchorKey = key;
      renderTable();
      return;
    }
    if (!pop && e.shiftKey && anchorKey) {
      const vis = visibleSamples().map(s => s.key);
      const a = vis.indexOf(anchorKey), b = vis.indexOf(key);
      if (a >= 0 && b >= 0) { selKeys = new Set(vis.slice(Math.min(a, b), Math.max(a, b) + 1)); renderTable(); return; }
    }
    if (!keepSel && selKeys.size && !pop) selKeys.clear();
    anchorKey = key;
    select(key, pop);
  }

  function select(key, pop) {
    FM.ui.wsSel = { key, pop: pop || null };
    els.rows.querySelectorAll('.wsv-row.sel').forEach(r => r.classList.remove('sel'));
    const sel = Array.from(els.rows.querySelectorAll('.wsv-row')).find(r => r.dataset.key === key && (r.dataset.gate || null) === (pop || null));
    if (sel) { sel.classList.add('sel'); sel.scrollIntoView({ block: 'nearest' }); }
    renderPreview();
    if (selKeys.size) renderTable();
  }

  function openInGate(key, pop) {
    const ws = W();
    if (!ws.sample(key)) return;
    // a population opens as the plot of its events, ready to gate further, like FlowJo
    if (pop && !(ws.view(pop) || {}).x) {
      const kid = ws.children(pop, key).find(k => k.x);
      if (kid) ws.setView(pop, { x: kid.x, y: kid.y || null });
    }
    FM.ui.newScope = FM.ui.wsGroup ? 'group' : 'all';
    FM.setUI({ sampleKey: key, popId: pop || null, gateId: null, tool: 'select' });
    FM.go('gate');
  }

  // ------------------------------------------------------------- menus
  function sampleMenu(s, anchor) {
    const ws = W();
    const keys = selKeys.size && selKeys.has(s.key) ? Array.from(selKeys) : [s.key];
    const many = keys.length > 1;
    const info = ws.wellInfo(s.key);
    menu(anchor, [
      { label: 'Open in Gate', icon: 'target', hint: 'dbl-click', fn: () => openInGate(s.key, null) },
      { label: FM.ui.wsOpen.has(s.key) ? 'Collapse' : 'Show populations', icon: FM.ui.wsOpen.has(s.key) ? 'up' : 'down', fn: () => toggle(s.key) },
      'sep', { heading: many ? 'Put ' + keys.length + ' samples in' : 'Put in group' },
      ...ws.doc.groups.map(g => ({ label: g.name, icon: ws.wellInfo(s.key).group === g.id ? 'check' : null, fn: () => dropSamples(keys, g.id) })),
      { label: 'New group…', icon: 'plus', fn: () => newGroup(anchor, keys) },
      ws.doc.groups.length ? { label: 'No group', fn: () => dropSamples(keys, null) } : null,
      'sep',
      { label: info.excluded && !many ? 'Include again' : 'Exclude from statistics…', icon: 'ban', fn: () => excludeDialog(keys, !(info.excluded && !many)) },
      { label: 'Keywords…', icon: 'info', disabled: many, fn: () => keywordsDialog(s) },
      { label: many ? 'Remove ' + keys.length + ' files' : 'Remove file', icon: 'trash', danger: true, fn: () => {
        ws.removeSamples(keys); selKeys.clear();
        toast('Removed ' + keys.length + ' file' + (keys.length > 1 ? 's' : '') + ' — gates and groups stay');
      } },
    ].filter(Boolean));
  }

  function bulkMenu(anchor) {
    const keys = Array.from(selKeys);
    const s = W().sample(keys[0]);
    if (s) sampleMenu(s, anchor);
  }

  function excludeDialog(keys, exclude) {
    const ws = W();
    if (!exclude) { ws.setExcluded(keys, false); return; }
    const inp = h('input.input', { placeholder: 'Why? e.g. clog, no beads added', 'aria-label': 'Reason' });
    const m = FM.dom.modal({
      title: 'Exclude ' + (keys.length > 1 ? keys.length + ' samples' : keys[0]) + ' from statistics',
      subtitle: 'They stay on screen, marked, and the reason is written into the report.',
      body: h('div.col', inp),
      buttons: [{ label: 'Cancel' }, { label: 'Exclude', primary: true, fn: () => { ws.setExcluded(keys, true, inp.value.trim()); } }],
      onEnter: () => { ws.setExcluded(keys, true, inp.value.trim()); m.close(); },
    });
    FM.dom.frame(() => inp.focus());
  }

  function keywordsDialog(s) {
    const rows = Object.entries(s.meta || {}).sort((a, b) => a[0].localeCompare(b[0]));
    const filter = h('input.input.sm', { type: 'search', placeholder: 'Filter keywords…' });
    const body = h('tbody');
    const draw = () => {
      clear(body);
      const q = filter.value.trim().toLowerCase();
      rows.filter(([k, v]) => !q || k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q))
        .forEach(([k, v]) => body.appendChild(h('tr', h('td.mono', k), h('td.mono.wsv-kwcell', String(v)))));
    };
    filter.addEventListener('input', draw);
    draw();
    FM.dom.modal({ title: s.name, subtitle: rows.length + ' keywords in the file', wide: true,
      body: h('div.col', filter, h('div.scroll.wsv-kwtable', h('table.tbl', h('thead', h('tr', h('th', 'Keyword'), h('th', 'Value'))), body))),
      buttons: [{ label: 'Close', primary: true }] });
  }

  function popMenu(s, g, anchor) {
    const ws = W();
    const groups = ws.doc.groups;
    menu(anchor, [
      { label: 'Open in Gate', icon: 'target', hint: 'dbl-click', fn: () => openInGate(s.key, g.id) },
      { label: 'Show its gate', icon: 'eye', fn: () => { FM.setUI({ sampleKey: s.key, popId: g.parent || null, gateId: g.id }); FM.go('gate'); } },
      'sep', { heading: 'Applies to · now ' + ws.scopeText(g) },
      { label: 'Every sample', icon: FM.scope.isScoped(g) ? null : 'check', fn: () => ws.setGateScope(g.id, null) },
      ...groups.map(gr => ({ label: 'Group ' + gr.name + ' only', icon: g.scope && (g.scope.groups || []).length === 1 && g.scope.groups[0] === gr.id && !(g.scope.samples || []).length ? 'check' : null,
        fn: () => ws.setGateScope(g.id, { groups: [gr.id] }) })),
      groups.length > 1 ? { label: 'Also group…', icon: 'plus', fn: () => menu(anchor, groups.map(gr => ({ label: gr.name, fn: () => ws.addGateScopeGroup(g.id, gr.id) }))) } : null,
      { label: 'Only ' + (s.well || s.name), fn: () => ws.setGateScope(g.id, { samples: [s.key] }) },
      'sep',
      { label: 'Combine with other populations…', icon: 'layers', fn: () => FM.combineDialog([g.id]) },
      { label: 'Delete gate', icon: 'trash', danger: true, fn: () => {
        const deps = ws.boolDependents(g.id);
        ws.deleteGate(g.id);
        toast('Deleted ' + g.name + (deps.length ? ' and the Boolean gate' + (deps.length > 1 ? 's' : '') + ' built on it' : ''), { action: { label: 'Undo', fn: () => ws.undo() } });
      } },
    ].filter(Boolean));
  }

  // -------------------------------------------------------------- preview
  function axesFor(popId, key) {
    const ws = W();
    const kid = ws.children(popId, key).find(k => k.x);
    if (kid) return { x: kid.x, y: kid.y || null };
    const v = ws.view(popId);
    if (v && v.x && ws.paramInfo(v.x)) return { x: v.x, y: v.y || null };
    const names = ws.paramNames();
    const fsc = names.find(n => /^FSC-?A$/i.test(n)) || names.find(n => /^FSC/i.test(n));
    const ssc = names.find(n => /^SSC-?A$/i.test(n)) || names.find(n => /^SSC/i.test(n));
    if (!popId && fsc && ssc) return { x: fsc, y: ssc };
    const fl = names.find(n => !/^(FSC|SSC|TIME)/i.test(n) && !/WIDTH/i.test(n));
    return { x: fl || names[0], y: ssc || names[1] || null };
  }

  function renderPreview() {
    const ws = W();
    clear(els.preview);
    const sel = FM.ui.wsSel;
    const s = sel && ws.sample(sel.key);
    if (!s) { els.preview.appendChild(h('p.muted.pad', 'Select a sample or a population.')); return; }
    const pop = sel.pop || null;
    const g = pop ? ws.gate(pop) : null;
    const ax = axesFor(pop, s.key);
    const data = h('canvas'), over = h('canvas');
    const box = h('div.wsv-plot', data, over);
    const title = h('div.wsv-ptitle',
      h('div.wsv-ptop', h('strong', s.well || s.name), h('span.muted', ' · '), h('span', g ? g.name : 'All events')),
      h('div.muted.small.mono', fmtCount(ws.count(s, pop)) + ' events' + (g ? ' · ' + fmtPct(ws.pct(s, pop)) + ' of ' + ws.popName(g.parent) : '')));
    els.preview.append(title, box);
    FM.dom.frame(() => drawPreview(data, over, box, s, pop, ax));
    const facts = [];
    if (g) {
      const shape = g.type === 'bool' ? 'Boolean — ' + g.bool.terms.map(t => (t.not ? 'not ' : '') + ws.popName(t.id)).join(g.bool.op === 'or' ? ' or ' : ' and ')
        : ({ polygon: 'Polygon', rect: 'Rectangle', range: 'Range', quad: 'Quadrant', ellipse: 'Ellipse' }[g.type] || g.type) + ' on ' + g.x + (g.y ? ' × ' + g.y : '');
      facts.push(h('div.wsv-fact', h('span.muted', 'Gate'), h('span', shape + (g.outside ? ' (outside)' : ''))));
      facts.push(h('div.wsv-fact', h('span.muted', 'Applies to'), h('span', ws.scopeText(g))));
      if (ws.isAdjusted(g.id, s.key)) facts.push(h('div.wsv-fact', h('span.muted', 'This sample'), h('span', '✦ uses its own version')));
    }
    facts.push(h('div.wsv-fact', h('span.muted', 'Plotted'), h('span.mono', ax.x + (ax.y ? ' × ' + ax.y : ' histogram'))));
    els.preview.appendChild(h('div.wsv-facts', facts));
    els.preview.appendChild(h('div.row.wsv-pact',
      h('button.btn.primary.sm', { on: { click: () => openInGate(s.key, pop) } }, icon('target'), 'Open in Gate'),
      g ? h('button.btn.sm', { on: { click: e => popMenu(s, g, e.currentTarget) } }, 'Gate…', icon('down')) : null));
  }

  function drawPreview(data, over, box, s, pop, ax) {
    if (!root || !box.isConnected) return;
    const ws = W();
    const w = Math.max(220, Math.floor(box.clientWidth || 320));
    const L = FM.plot.layout(w, Math.round(w * (ax.y ? 0.92 : 0.7)), { square: !!ax.y });
    const xSpec = ws.viewScale(pop, ax.x), ySpec = ax.y ? ws.viewScale(pop, ax.y) : null;
    FM.plot.render(data, L, { sample: s, idx: ws.indices(s, pop), x: ax.x, y: ax.y, xSpec, ySpec, xLabel: ws.paramLabel(ax.x), yLabel: ax.y ? ws.paramLabel(ax.y) : '', cmap: FM.ui.cmap });
    const ctx = FM.plot.sizeCanvas(over, L);
    ctx.clearRect(0, 0, L.W, L.H);
    const items = ws.children(pop, s.key).filter(k => FM.plot.gateFits(k, ax.x, ax.y)).map(k => ws.gateFor(k, s.key))
      .map(k => ({ gate: k, outline: FM.plot.gateOutline(k, L, xSpec, ySpec), pct: ws.pct(s, k.id), count: ws.count(s, k.id), selected: false }));
    FM.plot.drawGates(ctx, L, items);
  }

  // ------------------------------------------------------------ keyboard
  function onKey(e) {
    if (mode !== 'table' || e.ctrlKey || e.metaKey || e.altKey) return false;
    const sel = FM.ui.wsSel;
    const i = sel ? rowsOrder.findIndex(r => r.key === sel.key && (r.pop || null) === (sel.pop || null)) : -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const j = Math.max(0, Math.min(rowsOrder.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      if (rowsOrder[j]) select(rowsOrder[j].key, rowsOrder[j].pop);
      return true;
    }
    if (e.key === 'ArrowRight' && sel && !sel.pop && !FM.ui.wsOpen.has(sel.key)) { toggle(sel.key); return true; }
    if (e.key === 'ArrowLeft' && sel && !sel.pop && FM.ui.wsOpen.has(sel.key)) { toggle(sel.key); return true; }
    if (e.key === 'Enter' && sel) { openInGate(sel.key, sel.pop); return true; }
    return false;
  }

  // --------------------------------------------------------------- update
  let pending = null;
  function update(kind) {
    if (!root) return;
    const has = W().samples.length > 0;
    if ((mode === 'load') === has) { mount(root); return; }   // files arrived, or the last one left
    if (mode === 'load') { if (FM.views.load.update) FM.views.load.update(kind); return; }
    if (kind === 'loading') return;
    if (kind === 'resize' || kind === 'theme') { renderPreview(); return; }
    if (kind.startsWith('ws:') || kind === 'ui') {
      if (pending) return;
      pending = FM.dom.frame(() => { pending = null; renderAll(); });
    }
  }

  // ---------------------------------------------------- combine (shared)
  /** Build an AND / OR / NOT gate from populations (also used by the Gate step). */
  function combineDialog(preselect) {
    const ws = W();
    if (!ws.doc.gates.length) { toast('Draw some gates first'); return; }
    const picked = new Map((preselect || []).map(id => [id, false]));   // id → negated
    let op = 'and';
    const name = h('input.input', { placeholder: 'Name (optional)' });
    const list = h('div.cmb-list');
    const opSeg = h('div.seg');
    const preview = h('div.muted.small.cmb-preview');
    const s = FM.currentSample();
    const drawOps = () => {
      clear(opSeg);
      [['and', 'And — in all of them'], ['or', 'Or — in any of them'], ['not', 'Not — outside one population']].forEach(([k, l]) =>
        opSeg.appendChild(h('button' + (op === k ? '.on' : ''), { on: { click: () => { op = k; drawOps(); drawList(); } } }, l)));
    };
    const drawList = () => {
      clear(list);
      const walk = (pid, depth) => ws.children(pid).forEach(g => {
        const on = picked.has(g.id);
        const box = h('input', { type: op === 'not' ? 'radio' : 'checkbox', name: 'cmb', checked: on, on: { change: e => {
          if (op === 'not') picked.clear();
          if (e.target.checked) picked.set(g.id, false); else picked.delete(g.id);
          drawList();
        } } });
        const neg = op === 'and' && on ? h('label.cmb-not', h('input', { type: 'checkbox', checked: picked.get(g.id), on: { change: e => { picked.set(g.id, e.target.checked); drawPreview(); } } }), 'not') : null;
        list.appendChild(h('div.cmb-row', { style: { paddingLeft: (4 + depth * 16) + 'px' } }, h('label.check', box, h('span', g.name)), neg));
        walk(g.id, depth + 1);
      });
      walk(null, 0);
      drawPreview();
    };
    const terms = () => (op === 'not' ? Array.from(picked.keys()).slice(0, 1).map(id => ({ id, not: true })) : Array.from(picked.entries()).map(([id, not]) => ({ id, not })));
    const drawPreview = () => {
      const t = terms();
      preview.textContent = t.length ? (op === 'or' ? 'Events in any of: ' : 'Events in ') + t.map(x => (x.not ? 'not ' : '') + ws.popName(x.id)).join(op === 'or' ? ', ' : ' and ') : 'Pick ' + (op === 'not' ? 'one population' : 'two or more populations') + '.';
    };
    drawOps(); drawList();
    const make = () => {
      const t = terms();
      if (op !== 'not' && t.length < 2) { toast('Pick at least two populations', { level: 'crit' }); return false; }
      if (!t.length) { toast('Pick a population', { level: 'crit' }); return false; }
      const id = ws.addBoolGate({ op: op === 'or' ? 'or' : 'and', terms: t, name: name.value.trim() || undefined });
      const g = ws.gate(id);
      toast('Added ' + g.name + (s ? ' — ' + fmtCount(ws.count(s, id)) + ' events in ' + (s.well || s.name) : ''));
      FM.bus.emit('combined', { id });
      return true;
    };
    FM.dom.modal({ title: 'Combine populations', subtitle: 'A Boolean gate is a population built from others — like FlowJo’s And, Or and Not gates. It updates whenever they do.', wide: true,
      body: h('div.col', opSeg, h('div.scroll.cmb-scroll', list), preview, name),
      buttons: [{ label: 'Cancel' }, { label: 'Add gate', primary: true, fn: make }] });
  }

  FM.combineDialog = combineDialog;
  FM.views = FM.views || {};
  FM.views.workspace = { mount, update, onKey, unmount,
    // for the UI self-test
    _dropPop: dropPop, _dropSamples: dropSamples, _select: select, _toggle: toggle, _open: openInGate, _mode: () => mode };
})(FM);
