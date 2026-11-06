/* Guided step 2 — Plate: highlight wells (or tubes), then Create condition — it takes those wells and
 * is defined right there (name, role, colour). Conditions can also be pasted from a spreadsheet or laid
 * out one per row / column. */
(function (FM) {
  'use strict';
  const { h, icon, clear, fmtCount, fmtTime, menu, toast } = FM.dom;

  const ROLES = [
    { id: 'sample', label: 'Condition', short: 'Condition', desc: 'An ordinary group of wells' },
    { id: 'gate', label: 'Gate control', short: 'Gate control', desc: 'Sets gate boundaries (e.g. unstained, no beads) — Suggest places gates from it' },
    { id: 'comp', label: 'Single-stain control', short: 'Single stain', desc: 'One dye only, for unmixing — name the condition after the dye (e.g. “CD4 FITC”)' },
    { id: 'unstained', label: 'Unstained control', short: 'Unstained', desc: 'No dyes, for unmixing — the negative reference' },
  ];

  let root = null;
  let selected = new Set();  // highlighted well / tube keys
  let painting = null;       // { keys:Set, additive } while dragging across wells
  let overlay = 'events';    // what the small line in each well shows: 'events' | 'order'
  let lastGroups = null;     // well → group at the previous render, to flash wells that just changed
  let axes = null;            // { x, y } of the plots beside the plate (null: the Gate step's view)
  const MAX_PLOTS = 48;
  let lastClick = null;       // the anchor of a Shift-click range in the list
  let focusName = null;      // a condition just created: focus its name in the side panel

  const W = () => FM.ws;

  function mount(el) { root = el; render(); }

  function render() {
    if (!root) return;
    clear(root);
    if (!W().samples.length) {
      root.appendChild(h('div.empty', FM.brand.miniCell(), h('h2', 'No files yet'), h('p', 'Load FCS files first; wells are detected from the file names or $WELLID.'),
        h('button.btn.primary', { on: { click: () => FM.go('load') } }, 'Go to Load')));
      return;
    }
    selected = new Set([...selected].filter(k => W().sample(k)));
    root.appendChild(h('div.plate-wrap', groupsPanel(), platePanel()));
    const now = {};
    W().samples.forEach(s => { now[s.key] = (W().doc.wells[s.key] || {}).group || null; });
    if (lastGroups) root.querySelectorAll('.well[data-key]').forEach(el => {
      const k = el.dataset.key;
      if (now[k] && now[k] !== lastGroups[k]) el.classList.add('flash');
    });
    lastGroups = now;
    if (focusName) {
      const id = focusName; focusName = null;
      FM.dom.frame(() => { const inp = root && root.querySelector('.cond-card[data-group="' + id + '"] .cond-name'); if (inp) { inp.focus(); inp.select(); } });
    }
  }

  // ------------------------------------------------------------- actions
  function createCondition() {
    const keys = [...selected];
    if (!keys.length) { toast('Highlight the wells of the condition first — drag across them on the plate'); return; }
    const id = W().createGroupFrom(keys, nextGroupName());
    focusName = id;
    render();
  }
  function select(keys, additive) {
    if (additive) {
      const allIn = keys.every(k => selected.has(k));
      keys.forEach(k => (allIn ? selected.delete(k) : selected.add(k)));
    } else selected = new Set(keys);
    render();
  }

  // ---------------------------------------------------------------- groups
  function groupsPanel() {
    const ws = W(), doc = ws.doc;
    const list = h('div.group-list');
    doc.groups.forEach((g, i) => {
      const keys = ws.samplesIn(g.id).map(s => s.key);
      const on = keys.length > 0 && keys.length === selected.size && keys.every(k => selected.has(k));
      const nameIn = h('input.group-name', { value: g.name, spellcheck: false, 'aria-label': 'Condition name', on: {
        click: e => e.stopPropagation(),
        change: () => { const v = nameIn.value.trim(); if (v) ws.updateGroup(g.id, { name: v }); else nameIn.value = g.name; },
        keydown: e => { if (e.key === 'Enter') nameIn.blur(); },
      } });
      const roleSel = h('select.input.sm.role-sel', { 'aria-label': 'Role', on: { click: e => e.stopPropagation(), change: e => ws.updateGroup(g.id, { role: e.target.value }) } },
        ROLES.map(r => h('option', { value: r.id, selected: (ROLES.some(x => x.id === g.role) ? g.role : 'sample') === r.id, title: r.label }, r.short)));
      const row = h('div.group-row' + (on ? '.on' : ''), {
        role: 'button', tabindex: 0, 'data-tip': 'Click to highlight its wells',
        // keys typed in the name box bubble up here: only the row's own keys select (a space is a space in a name)
        on: { click: e => select(keys, e.shiftKey || e.ctrlKey || e.metaKey), keydown: e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(keys, false); } } },
      },
        h('button.swatch-btn', { style: { background: g.color }, 'data-tip': 'Colour', on: { click: e => { e.stopPropagation(); colorMenu(e.currentTarget, g); } } }),
        h('div.grow.group-main', nameIn, h('div.group-sub', roleSel, h('span.muted.small', keys.length + (keys.length === 1 ? ' well' : ' wells')))),
        h('button.btn.ghost.sm.icon', { 'data-tip': 'More', on: { click: e => { e.stopPropagation(); groupMenu(e.currentTarget, g, i); } } }, icon('more')));
      list.appendChild(row);
    });

    return h('aside.panel.groups-panel',
      h('div.scroll.groups-scroll',
        selectionBlock(),
        h('div.panel-head', h('h3', 'Conditions'), h('span.grow'), doc.groups.length ? h('span.muted.small', 'click one to highlight its wells') : null),
        doc.groups.length ? list : h('div.groups-empty',
          h('ol.plate-howto', h('li', 'Highlight the wells of one condition — drag across them, or click a row or column letter.'), h('li', 'Click ', h('strong', 'Create condition'), ' and name it.'), h('li', 'Repeat for the next condition.')),
          h('div.muted.small', 'Or lay them out at once:'), h('div.col', quickButtons())),
        selected.size ? null : summaryBlock(),
        h('details.roles-legend', h('summary.small.muted', 'What the roles mean'), ROLES.map(r => h('div.role-l', h('strong', r.label), h('span.muted', ' — ' + r.desc))))));
  }

  function nextGroupName() {
    const names = new Set(W().doc.groups.map(g => g.name));
    let i = W().doc.groups.length + 1;
    while (names.has('Condition ' + i)) i++;
    return 'Condition ' + i;
  }

  function quickButtons() {
    return [
      h('button.btn', { on: { click: () => quickLayout('row') } }, icon('grid'), 'One condition per row'),
      h('button.btn', { on: { click: () => quickLayout('col') } }, icon('grid'), 'One condition per column'),
    ];
  }

  /** Create or reuse conditions and assign them by row or column, as one undo step. */
  function quickLayout(by) {
    const ws = W();
    const pos = ws.samples.map(s => ({ s, p: FM.wells.parse(s.well) })).filter(x => x.p);
    if (!pos.length) { toast('No well IDs found — assign tubes in the list below the plate', { level: 'crit' }); return; }
    const keys = [...new Set(pos.map(x => (by === 'row' ? x.p.row : x.p.col)))].sort((a, b) => a - b);
    const U = FM.workspaceUtil;
    ws.update(by === 'row' ? 'One condition per row' : 'One condition per column', d => {
      const ids = keys.map((k, i) => {
        if (d.groups[i]) return d.groups[i].id;
        const used = new Set(d.groups.map(g => g.color));
        const g = { id: U.uid('grp'), name: by === 'row' ? 'Row ' + FM.wells.ROWS[k] : 'Column ' + (k + 1),
          color: U.GROUP_COLORS.find(c => !used.has(c)) || U.GROUP_COLORS[i % U.GROUP_COLORS.length], role: 'sample' };
        d.groups.push(g);
        return g.id;
      });
      pos.forEach(({ s, p }) => {
        const gi = keys.indexOf(by === 'row' ? p.row : p.col);
        d.wells[s.key] = Object.assign({ excluded: false, reason: '' }, d.wells[s.key], { group: ids[gi] });
      });
    }, { kind: 'groups' });
    toast('Assigned ' + keys.length + (by === 'row' ? ' rows' : ' columns') + ' — now rename the conditions');
  }

  function colorGrid(g) {
    const U = FM.workspaceUtil;
    const colors = U.GROUP_COLORS.concat([U.ROLE_COLORS.control, U.ROLE_COLORS.gate]);
    return h('div.color-grid', colors.map(c => h('button.color-cell' + (c === g.color ? '.on' : ''), {
      style: { background: c }, 'aria-label': c, on: { click: () => { W().updateGroup(g.id, { color: c }); FM.dom.closePop(); } },
    })));
  }
  function colorMenu(anchor, g) { FM.dom.popover(anchor, colorGrid(g), { focus: false }); }

  function groupMenu(anchor, g, i) {
    const n = W().doc.groups.length;
    menu(anchor, [
      { label: 'Move up', icon: 'up', disabled: i === 0, fn: () => W().moveGroup(g.id, -1) },
      { label: 'Move down', icon: 'down', disabled: i === n - 1, fn: () => W().moveGroup(g.id, 1) },
      { label: 'Add the highlighted wells', icon: 'plus', disabled: !selected.size, fn: () => W().assign([...selected], g.id) },
      'sep',
      { label: 'Delete condition', icon: 'trash', danger: true, fn: () => W().deleteGroup(g.id) },
    ]);
  }

  // ----------------------------------------------------------------- plate
  function platePanel() {
    const ws = W();
    const wellSamples = ws.samples.filter(s => s.well && !s.wellConflict);
    const tubes = ws.samples.filter(s => !s.well || s.wellConflict);
    const frame = FM.wells.frame(wellSamples.map(s => s.well));
    const bySample = new Map(wellSamples.map(s => [s.well, s]));
    const n = selected.size;
    const listView = !!frame && FM.ui.plateView === 'list';

    const tools = h('div.plate-tools',
      n ? h('div.sel-bar',
        h('span.chip.accent', n + (n === 1 ? ' well' : ' wells') + ' highlighted'),
        h('button.btn.sm.ghost', { on: { click: () => { selected.clear(); render(); } } }, 'Clear selection'))
        : h('div.brush-state.muted', 'Drag across wells to highlight them (Ctrl or Shift adds more), then ', h('strong', 'Create condition'), ' on the left.'),
      h('span.grow'),
      h('button.btn.sm', { 'data-tip': 'Highlight every well', on: { click: () => select(ws.samples.map(s => s.key), false) } }, 'Select all'),
      h('button.btn.sm', { 'data-tip': 'Paste a plate map copied from Excel', on: { click: pasteDialog } }, icon('copy'), 'Paste layout'),
      ws.doc.groups.length ? h('button.btn.sm', { on: { click: e => menu(e.currentTarget, [
        { label: 'Conditions by row, in list order', icon: 'grid', fn: () => quickLayout('row') },
        { label: 'Conditions by column, in list order', icon: 'grid', fn: () => quickLayout('col') },
      ], { align: 'right' }) } }, 'Quick layout', icon('down')) : null,
      frame ? h('div.seg.sm.plate-view', { role: 'group', 'aria-label': 'View' }, [['plate', 'Plate', 'The plate map' + (tubes.length ? ', with the tubes under it' : '')], ['list', tubes.length ? 'Wells + tubes' : 'List', 'Every well and tube in one list, to highlight and name them together']].map(([k, l, tip]) =>
        h('button' + (listView === (k === 'list') ? '.on' : ''), { 'data-tip': tip, on: { click: () => { FM.ui.plateView = k; render(); } } }, l))) : null,
      h('div.seg.sm', [['events', 'Events'], ['order', 'Run order']].map(([k, l]) =>
        h('button' + (overlay === k ? '.on' : ''), { 'data-tip': k === 'order' ? 'Acquisition order from $BTIM — blocks of one condition in a row reveal time confounding' : 'Events acquired', on: { click: () => { overlay = k; render(); } } }, l))));

    const body = h('div.plate-body');
    if (listView) body.appendChild(sampleList(ws.samples, 'Every well and tube'));
    else if (frame) {
      const nr = frame.r1 - frame.r0 + 1, nc = frame.c1 - frame.c0 + 1;
      const grid = h('div.plate-grid', { style: { gridTemplateColumns: '28px repeat(' + nc + ', minmax(64px, 132px))' } });
      const colKeys = c => wellSamples.filter(s => FM.wells.parse(s.well).col === c).map(s => s.key);
      const rowKeys = r => wellSamples.filter(s => FM.wells.parse(s.well).row === r).map(s => s.key);
      grid.appendChild(h('div'));
      for (let c = frame.c0; c <= frame.c1; c++) grid.appendChild(h('button.plate-head', { on: { click: e => select(colKeys(c), e.shiftKey || e.ctrlKey || e.metaKey) }, 'data-tip': 'Column ' + (c + 1) + ' — click to highlight (Ctrl adds)' }, String(c + 1)));
      for (let r = frame.r0; r <= frame.r1; r++) {
        grid.appendChild(h('button.plate-head', { on: { click: e => select(rowKeys(r), e.shiftKey || e.ctrlKey || e.metaKey) }, 'data-tip': 'Row ' + FM.wells.ROWS[r] + ' — click to highlight (Ctrl adds)' }, FM.wells.ROWS[r]));
        for (let c = frame.c0; c <= frame.c1; c++) {
          const id = FM.wells.id(r, c);
          const s = bySample.get(id);
          grid.appendChild(s ? wellCell(s) : h('div.well.empty-well', h('span.well-id', id)));
        }
      }
      body.appendChild(grid);
      body.appendChild(h('div.plate-caption.muted.small', nr + ' × ' + nc + ' of a ' + frame.format + '-well plate · ' + wellSamples.length + ' wells with data'));
    }
    if (tubes.length && !listView) body.appendChild(sampleList(tubes, frame ? 'Tubes and files without a well ID' : 'Tubes'));
    return h('section.plate-main', tools, h('div.plate-split', h('div.scroll.plate-scroll', body), plotsPanel()));
  }

  function wellCell(s) {
    const ws = W();
    const w = ws.wellInfo(s.key);
    const g = w.group ? ws.group(w.group) : null;
    const cls = ['well'];
    if (g) cls.push('assigned');
    if (w.excluded) cls.push('excluded');
    if (selected.has(s.key)) cls.push('sel');
    if (painting && painting.keys.has(s.key)) cls.push('painting');
    const el = h('button.' + cls.join('.'), {
      style: g ? { '--gc': g.color } : null,
      'data-key': s.key,
      'aria-label': s.well + (g ? ', ' + g.name : ', unassigned') + (w.excluded ? ', excluded' : ''),
    },
      h('span.well-id', s.well),
      w.excluded ? h('span.well-x', { 'data-tip': 'Excluded' + (w.reason ? ': ' + w.reason : '') }, icon('ban')) : null,
      h('span.well-name', g ? g.name : h('span.faint', '—')),
      h('span.well-meta.mono', overlay === 'order' ? (s.acqOrder ? '#' + s.acqOrder : '—') : fmtCount(s.n)));
    el.addEventListener('pointerdown', e => startPaint(e, s.key));
    el.addEventListener('pointerenter', () => { if (painting) { painting.keys.add(s.key); el.classList.add('painting'); } });
    return el;
  }

  /**
   * Samples as a table — the tubes under a plate, or (List view) every well and tube together — so
   * they are highlighted and named the same way: click one, Ctrl-click to add, Shift-click a range.
   */
  function sampleList(list, title) {
    const ws = W();
    const all = list.length > 0 && list.every(s => selected.has(s.key));
    const keys = list.map(s => s.key);
    const click = (e, k) => {
      if (e.shiftKey && lastClick && keys.includes(lastClick)) {
        const [i, j] = [keys.indexOf(lastClick), keys.indexOf(k)].sort((x, y) => x - y);
        keys.slice(i, j + 1).forEach(x => selected.add(x));
        render();
        return;
      }
      lastClick = k;
      select([k], e.ctrlKey || e.metaKey);
    };
    const hasWells = list.some(s => s.well && !s.wellConflict);
    return h('div.tubes',
      h('div.eyebrow', title),
      h('table.tbl', h('thead', h('tr',
        h('th', h('input', { type: 'checkbox', checked: all, 'aria-label': 'Highlight all of them', on: { change: e => { list.forEach(s => (e.target.checked ? selected.add(s.key) : selected.delete(s.key))); render(); } } })),
        hasWells ? h('th', 'Well') : null, h('th', 'File'), h('th.r', 'Events'), h('th', 'Condition'), h('th', ''))),
      h('tbody', list.map(s => {
        const w = ws.wellInfo(s.key);
        const g = w.group ? ws.group(w.group) : null;
        return h('tr.tube' + (selected.has(s.key) ? '.sel' : ''), { 'data-key': s.key, on: { click: e => { if (e.target.closest('input')) return; click(e, s.key); } } },
          h('td', h('input.tube-sel', { type: 'checkbox', checked: selected.has(s.key), 'aria-label': 'Highlight ' + s.name, on: { change: e => { if (e.target.checked) selected.add(s.key); else selected.delete(s.key); lastClick = s.key; render(); } } })),
          hasWells ? h('td.mono', s.well && !s.wellConflict ? s.well : h('span.faint', 'tube')) : null,
          h('td', h('div.fname', s.name)),
          h('td.r.num', fmtCount(s.n)),
          h('td', g ? h('span.row.small', h('span.swatch', { style: { background: g.color } }), g.name) : h('span.faint', '—')),
          h('td', w.excluded ? h('span.chip', icon('ban'), 'excluded') : null));
      }))));
  }

  function pasteDialog() {
    const ws = W();
    const ta = h('textarea.input.mono.paste-area', { rows: 7, spellcheck: false,
      placeholder: '\t1\t2\t3\nA\tIgG1\tIgG1\tIgG1\nB\tIgG2\tIgG2\tIgG2\n…  (copy the grid from Excel, with or without row/column labels)' });
    const preview = h('div.paste-preview');
    const have = new Set(ws.samples.map(s => s.well).filter(Boolean));
    let parsed = { wells: {}, names: [] };
    const draw = () => {
      parsed = FM.wells.parseLayout(ta.value);
      clear(preview);
      const keys = Object.keys(parsed.wells);
      if (!keys.length) { preview.appendChild(h('p.muted.small', 'Nothing recognised yet.')); return; }
      const f = FM.wells.frame(keys);
      const colors = {};
      parsed.names.forEach((n, i) => { const ex = ws.doc.groups.find(g => g.name.toLowerCase() === n.toLowerCase()); colors[n] = ex ? ex.color : FM.workspaceUtil.GROUP_COLORS[i % 10]; });
      const grid = h('div.paste-grid', { style: { gridTemplateColumns: '18px repeat(' + (f.c1 + 1) + ', minmax(40px, 1fr))' } });
      grid.appendChild(h('span'));
      for (let c = 0; c <= f.c1; c++) grid.appendChild(h('span.mp-h', String(c + 1)));
      for (let r = 0; r <= f.r1; r++) {
        grid.appendChild(h('span.mp-h', FM.wells.ROWS[r]));
        for (let c = 0; c <= f.c1; c++) {
          const wid = FM.wells.id(r, c), n = parsed.wells[wid];
          grid.appendChild(h('span.paste-cell' + (n && !have.has(wid) ? '.nodata' : ''), { style: n ? { '--gc': colors[n] } : null, title: wid + (n ? ': ' + n : '') + (n && !have.has(wid) ? ' (no file for this well)' : '') }, n || ''));
        }
      }
      const matched = keys.filter(k => have.has(k)).length;
      preview.append(grid, h('p.small.muted', parsed.names.length + ' condition' + (parsed.names.length > 1 ? 's' : '') + ' · ' + matched + ' of ' + keys.length + ' wells have a loaded file' +
        (matched < keys.length ? ' (the rest are kept for when their files are added)' : '')));
    };
    ta.addEventListener('input', draw);
    draw();
    FM.dom.modal({
      title: 'Paste a plate layout',
      subtitle: 'Copy the plate map from Excel or a CSV and paste it here. Conditions are created by name; existing ones are reused.',
      wide: true,
      body: h('div.col', ta, preview),
      buttons: [{ label: 'Cancel' }, { label: 'Apply layout', primary: true, fn: () => {
        if (!Object.keys(parsed.wells).length) { toast('Paste a layout first', { level: 'crit' }); return false; }
        ws.applyLayout(parsed.wells);
        toast('Layout applied — ' + parsed.names.length + ' conditions');
        return true;
      } }],
    });
  }

  function startPaint(e, key) {
    if (e.button !== 0) return;
    e.preventDefault();
    painting = { keys: new Set([key]), additive: e.shiftKey || e.ctrlKey || e.metaKey };
    const el = e.currentTarget;
    el.classList.add('painting');
    // pointer capture would swallow pointerenter on sibling wells: track the pointer on the document instead
    const move = ev => {
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      const cell = t && t.closest && t.closest('.well[data-key]');
      if (cell && painting && !painting.keys.has(cell.dataset.key)) { painting.keys.add(cell.dataset.key); cell.classList.add('painting'); }
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      const p = painting; painting = null;
      if (!p) return;
      const keys = [...p.keys];
      if (p.additive) keys.forEach(k => (selected.has(k) && keys.length === 1 ? selected.delete(k) : selected.add(k)));
      else if (keys.length === 1 && selected.size === 1 && selected.has(keys[0])) selected.clear();   // click a lone highlighted well again: off
      else selected = new Set(keys);
      render();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  // ------------------------------------------------------------- selection
  /** The condition of the highlighted wells, defined in place: name, role, colour. */
  function conditionCard(g, keys) {
    const ws = W();
    const all = ws.samplesIn(g.id).length;
    const nameIn = h('input.input.cond-name', { value: g.name, spellcheck: false, 'aria-label': 'Condition name', on: {
      change: () => { const v = nameIn.value.trim(); if (v) ws.updateGroup(g.id, { name: v }); else nameIn.value = g.name; },
      keydown: e => { if (e.key === 'Enter') nameIn.blur(); },
    } });
    return h('div.cond-card', { 'data-group': g.id, style: { '--gc': g.color } },
      h('div.row', h('button.swatch-btn', { style: { background: g.color }, 'data-tip': 'Colour', on: { click: e => colorMenu(e.currentTarget, g) } }), nameIn),
      h('div.field', h('label', 'Role'),
        h('select.input.cond-role', { on: { change: e => ws.updateGroup(g.id, { role: e.target.value }) } },
          ROLES.map(r => h('option', { value: r.id, selected: (ROLES.some(x => x.id === g.role) ? g.role : 'sample') === r.id }, r.label))),
        h('div.muted.small', (ROLES.find(r => r.id === g.role) || ROLES[0]).desc)),
      h('div.row.small.muted', h('span.grow', all + (all === 1 ? ' well' : ' wells') + ' in this condition' + (all !== keys.length ? ' (' + keys.length + ' highlighted)' : '')),
        h('button.btn.sm.ghost', { 'data-tip': 'Take the highlighted wells out of this condition', on: { click: () => ws.assign(keys, null) } }, icon('x'), 'Unassign')),
      h('div.row.small', h('button.btn.sm', { 'data-tip': 'Put the highlighted wells in a new condition instead', on: { click: createCondition } }, icon('plus'), 'Create condition'),
        addToSelect(keys, 'Move to…', g.id)));
  }

  /** A menu that puts the highlighted wells into an existing condition. */
  function addToSelect(keys, placeholder, skip) {
    const ws = W();
    const groups = ws.doc.groups.filter(g => g.id !== skip);
    if (!groups.length) return null;
    return h('select.input.sm.add-to', { 'aria-label': placeholder, on: { change: e => { if (e.target.value) ws.assign(keys, e.target.value); } } },
      h('option', { value: '' }, placeholder),
      groups.map(g => h('option', { value: g.id }, g.name)));
  }

  /** The top of the side panel: what to do with the highlighted wells (or how to highlight some). */
  function selectionBlock() {
    const ws = W();
    const keys = [...selected].filter(k => ws.sample(k));
    if (!keys.length) {
      return h('div.plate-sel.empty-sel',
        h('button.btn.add-group', { disabled: true, 'data-tip': 'Highlight wells on the plate first' }, icon('plus'), 'Create condition'),
        h('div.muted.small', 'Highlight wells on the plate — drag across them, or click a row or column letter — then create a condition from them.'));
    }
    const samples = keys.map(k => ws.sample(k));
    const infos = keys.map(k => ws.wellInfo(k));
    const allExcluded = infos.every(w => w.excluded);
    const groupIds = [...new Set(infos.map(w => w.group))];
    const one = groupIds.length === 1 && groupIds[0] ? ws.group(groupIds[0]) : null;
    const reason = h('input.input', { placeholder: 'Reason (shown in the report)', value: infos.length === 1 ? infos[0].reason : '', on: {
      change: () => ws.setExcluded(keys, true, reason.value.trim()),
    } });
    const single = samples.length === 1 ? samples[0] : null;
    const condition = one ? conditionCard(one, keys)
      : h('div.cond-new',
        groupIds.length > 1 ? h('div.note.small', icon('info'), h('span', 'These wells are in ' + groupIds.filter(Boolean).length + ' different conditions' + (groupIds.includes(null) ? ' (some in none)' : '') + '.')) : null,
        h('button.btn.primary.create-cond', { on: { click: createCondition } }, icon('plus'), 'Create condition'),
        ws.doc.groups.length ? h('div.field', h('label', 'Or add to'), addToSelect(keys, '— choose a condition —')) : null);
    const panel = h('div.plate-sel',
      h('div.panel-head', h('h3', single ? 'Well ' + (single.well || single.name) : samples.length + ' wells highlighted'), h('span.grow'),
        h('button.btn.ghost.sm.icon', { 'data-tip': 'Clear selection', on: { click: () => { selected.clear(); render(); } } }, icon('x'))),
      h('div.panel-body.col',
        h('div.eyebrow', 'Condition'),
        condition,
        h('div.eyebrow', single ? 'File' : 'Wells'),
        single ? h('dl.kv',
          h('dt', 'File'), h('dd', h('span.fname', single.name)),
          h('dt', 'Events'), h('dd.mono', fmtCount(single.n)),
          h('dt', 'Acquired'), h('dd.mono', single.acqTime != null ? fmtTime(single.acqTime) + (single.acqOrder ? '  · #' + single.acqOrder + ' in run' : '') : '—'),
          h('dt', 'Instrument'), h('dd', single.cytometer || '—')) : h('div.muted.small', samples.map(s => s.well || s.name).join(', ')),
        h('label.check', h('input', { type: 'checkbox', checked: allExcluded, on: { change: e => ws.setExcluded(keys, e.target.checked, reason.value.trim()) } }),
          h('span', 'Exclude from statistics')),
        allExcluded ? reason : null,
        single ? h('button.btn', { on: { click: () => { FM.setUI({ sampleKey: single.key }); FM.go('gate'); } } }, icon('target'), 'Open on the Gate step') : null));
    return panel;
  }

  // ----------------------------------------------------------------- plots
  /** The axes of the plots: chosen here, else the Gate step's top view, else FSC × SSC. */
  function plotAxes() {
    const ws = W(), names = ws.paramNames();
    const v = ws.view(null);
    const x = axes && names.includes(axes.x) ? axes.x : (v && v.x) || names.find(n => /^FSC/i.test(n)) || names[0];
    const y = axes && names.includes(axes.y) ? axes.y : (v && v.y) || names.find(n => /^SSC/i.test(n)) || names[1];
    return { x, y };
  }

  /** Beside the plate: a plot for every highlighted well or tube, scrolling. */
  function plotsPanel() {
    const ws = W();
    const keys = [...selected].filter(k => ws.sample(k));
    const { x, y } = plotAxes();
    const names = ws.paramNames();
    const axisSel = (which, cur) => h('select.input.sm', { 'aria-label': which === 'x' ? 'X axis' : 'Y axis', on: { change: e => { axes = Object.assign(plotAxes(), { [which]: e.target.value }); render(); } } },
      names.map(n => h('option', { value: n, selected: n === cur }, n)));
    const head = h('div.plots-head', h('strong', keys.length ? keys.length + (keys.length === 1 ? ' plot' : ' plots') : 'Plots'), h('span.grow'),
      axisSel('y', y), h('span.muted.small', 'vs'), axisSel('x', x));
    if (!keys.length) return h('aside.plate-plots', head, h('div.plots-empty.muted.small', 'Highlight wells or tubes to see their plots here — one for each, to compare them side by side.'));
    const order = ws.samples.map(s => s.key).filter(k => selected.has(k));
    const cards = order.slice(0, MAX_PLOTS).map(k => {
      const s = ws.sample(k), g = ws.groupOf(k), w = ws.wellInfo(k);
      const cv = h('canvas.well-preview');
      FM.dom.frame(() => drawPreview(cv, s, x, y));
      return h('div.plot-card' + (w.excluded ? '.excluded' : ''), { 'data-key': k, style: g ? { '--gc': g.color } : null },
        h('div.plot-card-head', h('span.mono', s.well || s.name), g ? h('span.plot-cond', g.name) : h('span.faint', 'no condition'), h('span.grow'),
          w.excluded ? h('span.chip', icon('ban'), 'excluded') : null,
          h('button.btn.ghost.sm.icon', { 'data-tip': 'Open on the Gate step', 'aria-label': 'Open on the Gate step', on: { click: () => { FM.setUI({ sampleKey: k }); FM.go('gate'); } } }, icon('target'))),
        s.well ? h('div.fname.small.muted', s.name) : null,
        cv);
    });
    return h('aside.plate-plots', head, h('div.scroll.plots-list', cards,
      order.length > MAX_PLOTS ? h('div.muted.small.pad', 'Showing the first ' + MAX_PLOTS + ' of ' + order.length + '.') : null));
  }

  function drawPreview(canvas, s, x, y) {
    const ws = W();
    if (!x || !y || !canvas.isConnected) return;
    const L = FM.plot.layout(Math.max(160, canvas.parentElement.clientWidth - 20), 190, { compact: true });
    const m = { sample: s, idx: ws.indices(s, null), x, y, xSpec: ws.viewScale(null, x), ySpec: ws.viewScale(null, y), cmap: FM.ui.cmap, dotScale: FM.ui.dotScale };
    FM.plot.render(canvas, L, m);
    const items = ws.children(null).filter(g => FM.plot.gateFits(g, x, y)).map(g => ({ gate: g, outline: FM.plot.gateOutline(g, L, m.xSpec, m.ySpec), pct: ws.pct(s, g.id) }));
    FM.plot.drawGates(canvas.getContext('2d'), L, items);
  }

  function summaryBlock() {
    const ws = W();
    if (!ws.doc.groups.length) return null;
    const unassigned = ws.samples.filter(s => !ws.wellInfo(s.key).group).length;
    const excluded = ws.samples.filter(s => ws.wellInfo(s.key).excluded);
    return h('div.panel-body.col.plate-summary',
      h('div.eyebrow', 'Plate summary'),
      ws.doc.groups.map(g => {
        const n = ws.samplesIn(g.id).length;
        return h('div.row.small', h('span.swatch', { style: { background: g.color } }), h('span.grow', g.name),
          g.role === 'gate' ? h('span.chip', 'gate control') : null, h('span.mono.muted', 'n=' + n));
      }),
      unassigned ? h('div.note.warn.small', icon('info'), h('span', unassigned + ' well' + (unassigned > 1 ? 's are' : ' is') + ' not in any condition')) : null,
      excluded.length ? h('div.note.small', icon('ban'), h('span', 'Excluded: ' + excluded.map(s => (s.well || s.name) + (ws.wellInfo(s.key).reason ? ' (' + ws.wellInfo(s.key).reason + ')' : '')).join(', '))) : null,
      h('button.btn.primary', { on: { click: () => FM.go('gate') } }, 'Continue to gating', icon('right')));
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;   // bare keys only
    if (e.key === 'Escape' && selected.size) { selected.clear(); render(); return true; }
    return false;
  }

  function update(kind) {
    if (kind === 'ws:groups' || kind === 'ws:doc' || kind === 'ws:samples' || kind === 'theme' || kind === 'resize') render();
  }

  FM.views = FM.views || {};
  FM.views.plate = { mount, update, onKey, unmount() { root = null; painting = null; lastGroups = null; } };
})(FM);
