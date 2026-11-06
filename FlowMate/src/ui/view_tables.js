/* Measure — one view. Pick populations and
 * statistics as columns, or compute a column from the others with a formula (B / A * 100);
 * every sample (or one group) is a row; copy it into Excel / Prism or save it as CSV. */
(function (FM) {
  'use strict';
  const { h, icon, clear, toast, menu, popover } = FM.dom;
  const W = () => FM.ws;
  const T = () => FM.statTables;
  const L = i => FM.formula.letter(i);

  let root = null, els = {};
  const draft = { kind: 'stat', pop: null, stat: 'freq_parent', param: '', of: null, fname: '', ftext: '' };


  function mount(el) {
    root = el;
    clear(root);
    if (!W().samples.length) {
      root.appendChild(h('div.empty', FM.brand.miniCell(), h('h2', 'No files yet'), h('p', 'Load FCS files, gate them, then measure any statistic for every sample here.'),
        h('button.btn.primary', { on: { click: () => FM.go('load') } }, 'Go to Load')));
      return;
    }
    els = { list: h('div.tbv-list'), main: h('section.panel.tbv-main') };
    root.appendChild(h('div.tbv-wrap',
      h('aside.panel.tbv-side', h('div.panel-head', h('h3', 'Measurements'), h('span.grow'),
        h('button.btn.ghost.sm', { on: { click: () => { const id = W().addTable(); FM.ui.tableId = id; } } }, icon('plus'), 'Table')),
        h('div.scroll', els.list)),
      els.main));
    render();
  }

  function current() {
    const ws = W();
    const tabs = ws.doc.tables || [];
    let t = FM.ui.tableId && ws.table(FM.ui.tableId);
    if (!t && tabs.length) { t = tabs[0]; FM.ui.tableId = t.id; }
    return t || null;
  }

  function render() {
    if (!root || !els.list) return;
    renderList();
    renderMain();
  }

  function renderList() {
    const ws = W();
    clear(els.list);
    (ws.doc.tables || []).forEach(t => {
      const on = FM.ui.tableId === t.id;
      els.list.appendChild(h('button.tbv-item' + (on ? '.on' : ''), {
        on: { click: () => { FM.ui.tableId = t.id; render(); }, contextmenu: e => { e.preventDefault(); tableMenu(t, { x: e.clientX, y: e.clientY }); } },
      }, icon('table'), h('span.grow.tbv-name', t.name), h('span.muted.small.mono', String(t.columns.length))));
    });
    if (!(ws.doc.tables || []).length) els.list.appendChild(h('div.muted.small.pad', 'No tables yet.'));
  }

  function tableMenu(t, anchor) {
    const ws = W();
    menu(anchor, [
      { label: 'Duplicate', icon: 'copy', fn: () => { const id = ws.addTable(t.name + ' copy', t.rows); ws.addTableColumns(id, t.columns); FM.ui.tableId = id; } },
      { label: 'Delete', icon: 'trash', danger: true, fn: () => { ws.deleteTable(t.id); toast('Deleted ' + t.name, { action: { label: 'Undo', fn: () => ws.undo() } }); } },
    ]);
  }

  // ---------------------------------------------------------------- main
  function renderMain() {
    const ws = W();
    clear(els.main);
    const t = current();
    if (!t) {
      els.main.appendChild(h('div.empty',
        h('h2', 'What do you want to measure?'),
        h('p', 'Rows are wells, columns are a population and a statistic — count, % of parent or of all events, median, mean, geometric mean, CV… Copy it into Excel or Prism, or export a CSV.'),
        h('div.row',
          h('button.btn.primary', { on: { click: () => { FM.ui.tableId = ws.addTable(); } } }, icon('plus'), 'New table'),
          ws.doc.gates.length ? h('button.btn', { on: { click: quickTable } }, icon('wand'), 'Every population: count and % of parent') : null),
        h('div.tbv-ev', h('span.muted.small', 'Need the value of every single cell instead — GFP for each event, say?'),
          h('button.btn.sm', { disabled: !ws.samples.length, on: { click: () => FM.io.exportEventsDialog() } }, icon('download'), 'Export events…'))));
      return;
    }
    const name = h('input.input.tbv-title', { value: t.name, 'aria-label': 'Table name', on: { change: e => ws.updateTable(t.id, { name: e.target.value.trim() || t.name }) } });
    const rowsSel = h('select.input.sm', { 'aria-label': 'Rows', on: { change: e => ws.updateTable(t.id, { rows: e.target.value }) } },
      h('option', { value: 'samples', selected: t.rows === 'samples' }, 'Every sample'),
      ws.doc.groups.map(g => h('option', { value: g.id, selected: t.rows === g.id }, 'Group: ' + g.name)));
    const built = T().build(ws, t);
    els.main.appendChild(h('div.tbv-head', name, h('span.muted.small', 'Rows'), rowsSel, h('span.grow'),
      h('button.btn.sm', { 'data-tip': 'The value of every cell — one row per event — as a CSV', on: { click: () => FM.io.exportEventsDialog({ wells: t.rows !== 'samples' ? 'g:' + t.rows : 'all' }) } }, icon('download'), 'Export events…'),
      h('button.btn.sm', { disabled: !t.columns.length, on: { click: () => copy(built) } }, icon('copy'), 'Copy'),
      h('button.btn.sm.primary', { disabled: !t.columns.length, on: { click: () => exportCSV(t, built) } }, icon('download'), 'Export CSV')));
    els.main.appendChild(builder(t, built));
    els.main.appendChild(columnChips(t, built));
    els.main.appendChild(grid(built, t));
  }

  function quickTable() {
    const ws = W();
    const id = ws.addTable('Populations');
    const cols = [];
    ws.doc.gates.forEach(g => { cols.push({ pop: g.id, stat: 'count' }); cols.push({ pop: g.id, stat: 'freq_parent' }); });
    ws.addTableColumns(id, cols);
    FM.ui.tableId = id;
  }

  /** Statistic | Formula, then the fields for that kind of column. */
  function builder(t, built) {
    const kind = h('div.seg.sm.tbv-kind', { role: 'group', 'aria-label': 'Kind of column' },
      [['stat', 'Statistic', 'A population and a statistic, measured in every sample'], ['formula', 'Formula', 'Compute a column from the others, like B / A * 100']].map(([k, label, tip]) =>
        h('button' + (draft.kind === k ? '.on' : ''), { 'aria-pressed': draft.kind === k ? 'true' : 'false', 'data-tip': tip, on: { click: () => { draft.kind = k; renderMain(); } } }, label)));
    const fields = draft.kind === 'formula' && t.columns.length ? formulaBuilder(t, built) : statBuilder(t);
    if (draft.kind === 'formula' && !t.columns.length) fields.appendChild(h('span.muted.small.tbv-fhint', 'Add a statistic column first — a formula computes from the other columns.'));
    return h('div.tbv-builder', h('div.field', h('label', 'Column'), kind), fields);
  }

  /** Name, formula with live check and preview, and the letters to click in. */
  function formulaBuilder(t) {
    const ws = W();
    const ids = t.columns.map(c => c.id);
    const nameIn = h('input.input.sm.tbv-fname', { value: draft.fname, placeholder: 'e.g. CD4 : CD8', 'aria-label': 'Column name', on: { input: e => { draft.fname = e.target.value; } } });
    const status = h('div.tbv-fstatus.small');
    const addBtn = h('button.btn.sm.primary.tbv-add', { on: { click: () => add() } }, icon('plus'), 'Add column');
    const exprIn = h('input.input.sm.mono.tbv-expr', { value: draft.ftext, placeholder: 'e.g. B / A * 100', 'aria-label': 'Formula', spellcheck: 'false', autocomplete: 'off',
      on: { input: e => { draft.ftext = e.target.value; check(); }, keydown: e => { if (e.key === 'Enter' && !addBtn.disabled) { e.preventDefault(); add(); } } } });
    function check() {
      const r = formulaCheck(ws, t, draft.ftext, null);
      const typed = !!draft.ftext.trim();
      clear(status);
      status.className = 'tbv-fstatus small' + (r.error && typed ? ' bad' : '');
      status.appendChild(r.error ? h('span', typed ? r.error : 'Type a formula using the column letters') : h('span', 'First row: ', h('strong.mono', r.preview)));
      addBtn.disabled = !!r.error;
    }
    function add() {
      const st = FM.formula.toStored(draft.ftext, ids);
      if (st.error) return;
      const name = draft.fname.trim();
      draft.fname = ''; draft.ftext = '';
      ws.addTableColumn(t.id, { kind: 'formula', name, expr: st.src });
    }
    check();
    return h('div.tbv-fields',
      h('div.field', h('label', 'Name'), nameIn),
      h('div.field.tbv-exprf', h('label', 'Formula'), exprIn, status),
      h('div.field', h('label', 'Columns'), letterPad(t, exprIn)),
      addBtn,
      h('button.btn.ghost.sm.icon.tbv-fhelp', { 'data-tip': 'What can go in a formula', 'aria-label': 'Formula help', on: { click: e => formulaHelp(e.currentTarget) } }, icon('help')));
  }

  /** One button per column letter; clicking types the letter into the formula at the cursor. */
  function letterPad(t, input) {
    const ws = W();
    return h('div.tbv-letters', t.columns.map((c, i) => h('button.btn.sm.tbv-lt', {
      'data-tip': T().columnLabel(ws, c, t), on: { mousedown: e => e.preventDefault(), click: () => insertAt(input, L(i)) },
    }, L(i))));
  }

  /** Type `text` at the cursor and tell the input's listeners. */
  function insertAt(input, text) {
    const a = input.selectionStart != null ? input.selectionStart : input.value.length;
    const b = input.selectionEnd != null ? input.selectionEnd : a;
    input.value = input.value.slice(0, a) + text + input.value.slice(b);
    input.focus();
    input.setSelectionRange(a + text.length, a + text.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** → { error } or { src, preview } for formula text on table t (selfId: the column being edited). */
  function formulaCheck(ws, t, text, selfId) {
    const ids = t.columns.map(c => c.id);
    const st = FM.formula.toStored(text, ids);
    if (st.error) return { error: st.error };
    if (selfId && FM.formula.compile(st.src).refs.indexOf(selfId) >= 0) return { error: 'A formula can’t use its own column' };
    const cols = t.columns.map(c => (c.id === selfId ? Object.assign({}, c, { expr: st.src }) : c));
    if (!selfId) cols.push({ id: '__new', kind: 'formula', expr: st.src });
    const b = T().build(ws, Object.assign({}, t, { columns: cols }));
    const j = selfId ? cols.findIndex(c => c.id === selfId) : cols.length - 1;
    if (b.columns[j].error) return { error: b.columns[j].error };
    const row = b.rows.find(r => !r.excluded) || b.rows[0];
    return { src: st.src, preview: row ? fmt(row.cells[j]) : '—' };
  }

  function formulaHelp(anchor) {
    const row = (code, what) => h('div.tbv-hrow', h('code.mono', code), h('span.muted', what));
    popover(anchor, h('div.tbv-help',
      h('div.eyebrow', 'Formulas'),
      row('B / A * 100', 'columns by letter; + − * / and ^ for powers'),
      row('log(B)  ln(B)  log2(B)', 'log is base 10, ln is natural'),
      row('sqrt(B)  abs(B)  exp(B)', 'one value each'),
      row('min(A, B)  max(A, B)', 'smallest or largest'),
      row('round(B, 2)', 'round to 2 decimals'),
      row('B / groupmean(B, "Untreated")', 'divide by a condition’s mean — a fold change'),
      h('p.muted.small', 'An empty input, a division by zero or the log of a negative number leaves the cell empty.')), { width: 400, align: 'right' });
  }

  /** Population · statistic · parameter · denominator → Add column. */
  function statBuilder(t) {
    const ws = W();
    const pops = [{ id: '', label: 'All events' }];
    const walk = (pid, depth) => ws.children(pid).forEach(g => { pops.push({ id: g.id, label: ' '.repeat(depth) + g.name }); walk(g.id, depth + 1); });
    walk(null, 0);
    if (draft.pop && !ws.gate(draft.pop)) draft.pop = null;
    if (draft.pop == null && ws.doc.gates.length) draft.pop = ws.doc.gates[ws.doc.gates.length - 1].id;
    const st = T().STATS[draft.stat];
    const params = ws.paramNames();
    if (st.needsParam && !draft.param) draft.param = params.find(p => !/^(FSC|SSC|TIME)/i.test(p)) || params[0];
    const popSel = h('select.input.sm.tbv-pop', { 'aria-label': 'Population', on: { change: e => { draft.pop = e.target.value || null; renderMain(); } } },
      pops.map(p => h('option', { value: p.id, selected: (draft.pop || '') === p.id }, p.label)));
    const statSel = h('select.input.sm', { 'aria-label': 'Statistic', on: { change: e => { draft.stat = e.target.value; renderMain(); } } },
      Object.entries(T().STATS).map(([k, v]) => h('option', { value: k, selected: draft.stat === k }, v.label + (v.needsOf ? '…' : ''))));
    const paramSel = st.needsParam ? h('select.input.sm', { 'aria-label': 'Parameter', on: { change: e => { draft.param = e.target.value; } } },
      params.map(p => h('option', { value: p, selected: draft.param === p }, ws.paramLabel(p)))) : null;
    const ancestors = draft.pop ? [{ id: '', name: 'All events' }].concat(ws.gatePath(draft.pop).slice(0, -1).map(g => ({ id: g.id, name: g.name }))) : [];
    const ofSel = st.needsOf ? h('select.input.sm', { 'aria-label': 'Denominator', on: { change: e => { draft.of = e.target.value || null; } } },
      ancestors.map(a => h('option', { value: a.id, selected: (draft.of || '') === a.id }, a.name))) : null;
    const add = () => {
      const col = { pop: draft.pop || null, stat: draft.stat };
      if (st.needsParam) col.param = draft.param;
      if (st.needsOf) col.of = draft.of || null;
      ws.addTableColumn(t.id, col);
    };
    const quick = e => menu(e.currentTarget, [
      { label: 'Count and % of parent for every population', fn: () => { const c = []; ws.doc.gates.forEach(g => { c.push({ pop: g.id, stat: 'count' }); c.push({ pop: g.id, stat: 'freq_parent' }); }); ws.addTableColumns(t.id, c); } },
      { label: 'Median of every fluorescence parameter in this population', fn: () => ws.addTableColumns(t.id, ws.paramNames().filter(p => !/^(FSC|SSC|TIME)|WIDTH/i.test(p)).map(p => ({ pop: draft.pop || null, stat: 'median', param: p }))) },
      { label: 'Geometric mean of every fluorescence parameter in this population', fn: () => ws.addTableColumns(t.id, ws.paramNames().filter(p => !/^(FSC|SSC|TIME)|WIDTH/i.test(p)).map(p => ({ pop: draft.pop || null, stat: 'gmean', param: p }))) },
    ]);
    return h('div.tbv-fields',
      h('div.field', h('label', 'Population'), popSel),
      h('div.field', h('label', 'Statistic'), statSel),
      paramSel ? h('div.field', h('label', 'Parameter'), paramSel) : null,
      ofSel ? h('div.field', h('label', 'Of'), ofSel) : null,
      h('button.btn.sm.primary.tbv-add', { on: { click: add } }, icon('plus'), 'Add column'),
      h('button.btn.sm', { disabled: !W().doc.gates.length, on: { click: quick } }, icon('wand'), 'Quick add', icon('down')));
  }

  function columnChips(t, built) {
    const ws = W();
    if (!t.columns.length) return h('div.note.small', icon('info'), h('span', 'Add columns above. Each is a population and a statistic; the table fills in for every sample at once. Then add formula columns that compute from them.'));
    const chips = t.columns.map((c, i) => {
      const f = T().isFormula(c);
      const err = built.columns[i] && built.columns[i].error;
      const label = T().columnLabel(ws, c, t);
      return h('span.tbv-col' + (f ? '.is-formula' : '') + (err ? '.bad' : ''), { title: err || (f ? label + ' = ' + T().formulaText(t, c) : label) },
      h('span.tbv-letter.mono', L(i)),
      f ? h('button.tbv-cl.tbv-fedit', { 'data-tip': err ? err + ' — click to fix' : 'Edit the formula', on: { click: e => editFormula(t, c, e.currentTarget) } },
        err ? icon('alert') : null, c.name ? h('span', c.name) : null, h('span.mono.muted', (c.name ? ' = ' : '= ') + T().formulaText(t, c)))
        : h('span.tbv-cl', label),
      h('button.btn.ghost.sm.icon', { 'data-tip': 'Remove', on: { click: () => ws.removeTableColumn(t.id, i) } }, icon('x')));
    });
    FM.dom.sortable(chips, (from, to) => ws.moveTableColumn(t.id, from, to - from));
    return h('div.tbv-cols', { 'data-tip': 'Drag a column to move it' }, chips);
  }

  /** Edit a formula column's name and formula in place. */
  function editFormula(t, c, anchor) {
    const ws = W();
    const nameIn = h('input.input.sm', { value: c.name || '', placeholder: 'Name', 'aria-label': 'Column name' });
    const exprIn = h('input.input.sm.mono.tbv-expr', { value: T().formulaText(t, c).replace(/#REF/g, ''), 'aria-label': 'Formula', spellcheck: 'false', autocomplete: 'off' });
    const status = h('div.tbv-fstatus.small');
    const save = h('button.btn.sm.primary', { on: { click: () => apply() } }, 'Save');
    function check() {
      const r = formulaCheck(ws, t, exprIn.value, c.id);
      clear(status);
      status.className = 'tbv-fstatus small' + (r.error ? ' bad' : '');
      status.appendChild(r.error ? h('span', r.error) : h('span', 'First row: ', h('strong.mono', r.preview)));
      save.disabled = !!r.error;
      return r;
    }
    function apply() {
      const r = check();
      if (r.error) return;
      FM.dom.closePop();
      ws.updateTableColumn(t.id, c.id, { name: nameIn.value.trim(), expr: r.src });
    }
    exprIn.addEventListener('input', check);
    [nameIn, exprIn].forEach(x => x.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }));
    popover(anchor, h('div.tbv-fedit-pop',
      h('div.field', h('label', 'Name'), nameIn),
      h('div.field', h('label', 'Formula'), exprIn, status),
      h('div.field', h('label', 'Columns'), letterPad(t, exprIn)),
      h('div.row', h('span.grow'), h('button.btn.sm', { on: { click: () => FM.dom.closePop() } }, 'Cancel'), save)), { width: 360 });
    check();
    exprIn.focus();
  }

  const fmt = (v, stat) => {
    if (!Number.isFinite(v)) return '—';
    if (stat === 'count') return Math.round(v).toLocaleString('en-US');
    if (/^freq|cv$/.test(stat)) return v.toFixed(2);
    const a = Math.abs(v);
    return a >= 1e5 ? Math.round(v).toLocaleString('en-US') : a >= 100 ? v.toFixed(1) : v.toPrecision(4);
  };

  function grid(b, t) {
    if (!b.columns.length) return h('div');
    const heads = b.head.map((x, i) => h('th' + (i > 1 ? '.r.tbv-drag' : ''), i > 1 ? { 'data-tip': 'Drag to move this column' } : null, i > 1 ? h('span.col-letter.mono', L(i - 2)) : null, x));
    if (t) FM.dom.sortable(heads.slice(2), (from, to) => W().moveTableColumn(t.id, from, to - from));
    return h('div.scroll.tbv-grid', h('table.tbl.tbv-table',
      h('thead', h('tr', heads)),
      h('tbody', b.rows.map(r => h('tr' + (r.excluded ? '.dim' : ''),
        h('td.mono', r.name, r.excluded ? h('span.chip.warn', 'excluded') : null), h('td', r.group || h('span.faint', '—')),
        r.cells.map((v, i) => h('td.r.mono', fmt(v, b.columns[i].stat))))))));
  }

  async function copy(b) {
    const tsv = T().toTSV(b);
    const html = '<table><tr>' + b.head.map(x => '<th>' + FM.dom.esc(x) + '</th>').join('') + '</tr>' +
      b.rows.map(r => '<tr><td>' + FM.dom.esc(r.name) + '</td><td>' + FM.dom.esc(r.group) + '</td>' + r.cells.map((v, i) => '<td>' + (Number.isFinite(v) ? fmt(v, b.columns[i].stat).replace(/,/g, '') : '') + '</td>').join('') + '</tr>').join('') + '</table>';
    try {
      if (navigator.clipboard && window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([tsv], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
      else await navigator.clipboard.writeText(tsv);
      toast('Table copied — paste into Excel, Prism or Word');
    } catch (_) { toast('Copy was blocked by the browser — use Export CSV', { level: 'crit' }); }
  }

  function exportCSV(t, b) {
    const name = String(W().doc.name + ' - ' + t.name).replace(/[\\/:*?"<>|]+/g, '_').trim();
    FM.dom.download(name + '.csv', T().toCSV(b), 'text/csv');
    FM.lastTableCSV = T().toCSV(b);    // for the UI self-test
    toast('Saved ' + name + '.csv');
  }

  let pending = null;
  function update(kind) {
    if (!root) return;
    if (kind === 'ws:samples') { mount(root); return; }
    if (kind.startsWith('ws:')) {
      if (pending) return;
      pending = FM.dom.frame(() => { pending = null; if (root) render(); });
    }
  }

  FM.views = FM.views || {};
  FM.views.tables = { mount, update, unmount() { root = null; els = {}; }, _quick: quickTable, _export: () => { const t = current(); if (t) exportCSV(t, T().build(W(), t)); } };
  FM.views.measure = FM.views.tables;
})(FM);
