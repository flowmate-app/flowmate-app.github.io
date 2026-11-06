/* The Gate step's worksheet: every gating plot of the current sample at once, side by side, with a
 * statistics table among them (as Kaluza lays out a worksheet). Each plot card is a live PlotView —
 * gates are drawn and dragged in any of them — and cards are reordered by dragging their title bar.
 *
 * The arrangement lives in ws.doc.sheet (see Workspace.setSheet). Until it is touched, the worksheet
 * shows the default: every population that has gates, once per pair of axes they are drawn on, then
 * the statistics. Gates added later still get their card.
 */
(function (FM) {
  'use strict';
  const { h, icon, clear, menu, fmtCount, fmtPct } = FM.dom;
  const W = () => FM.ws;
  const SIZES = { s: 280, m: 360, l: 470 };

  let hosts = new Map();      // card id → { host, pv }

  const keyOf = it => (it.type === 'stats' ? 'stats' : (it.pop || 'root') + '|' + it.x + '|' + (it.y || ''));
  const valid = (ws, it) => it.type === 'stats' || ((!it.pop || ws.gate(it.pop)) && ws.paramNames().includes(it.x) && (!it.y || ws.paramNames().includes(it.y)));

  /** The default cards: each population with gates, once per pair of axes its gates use, then the statistics. */
  function defaults(ws, ctx) {
    const out = [];
    [null].concat(FM.io.gatesInOrder().map(g => g.id)).forEach(pid => {
      const seen = new Set();
      ws.children(pid).filter(k => k.x).forEach(k => {
        const it = { pop: pid, x: k.x, y: k.y || null };
        const key = keyOf(it);
        if (seen.has(key)) return;
        seen.add(key);
        out.push(Object.assign({ id: 'd:' + key }, it));
      });
    });
    if (!out.length) { const a = ctx.axesOf(null); out.push({ id: 'd:' + keyOf({ pop: null, x: a.x, y: a.y }), pop: null, x: a.x, y: a.y || null }); }
    out.push({ id: 'stats', type: 'stats' });
    return out;
  }

  /** What the worksheet shows: the saved arrangement, plus default cards for gates added since. */
  function items(ws, ctx) {
    const sheet = ws.doc.sheet;
    const def = defaults(ws, ctx);
    if (!sheet || !Array.isArray(sheet.items)) return def;
    const list = sheet.items.filter(it => valid(ws, it));
    const have = new Set(list.map(keyOf)), hidden = new Set(sheet.hidden || []);
    def.forEach(it => { if (!have.has(keyOf(it)) && !hidden.has(keyOf(it))) list.push(it); });
    return list;
  }

  /** Save a changed arrangement (one undo step). */
  function save(ws, list, patch, label) {
    const sheet = Object.assign({ items: [], hidden: [], size: 'm' }, ws.doc.sheet || {}, patch || {});
    const sz = it => (it.w ? { w: it.w, h: it.h || null } : {});
    sheet.items = list.map(it => Object.assign(it.type === 'stats' ? { id: 'stats', type: 'stats' } : { id: it.id, pop: it.pop || null, x: it.x, y: it.y || null }, sz(it)));
    ws.setSheet(sheet, label);
  }

  const sizeOf = ws => (ws.doc.sheet && SIZES[ws.doc.sheet.size] ? ws.doc.sheet.size : 'm');

  // ------------------------------------------------------------------ render
  function render(el, m, ctx) {
    const ws = W();
    const list = items(ws, ctx);
    const size = sizeOf(ws);
    const px = SIZES[size];
    // a gate being dragged or drawn on a card: moving its plot in the page would drop the gesture —
    // only redraw the plots until it ends
    const busy = [...hosts.values()].some(v => v.pv.drag || v.pv.draft);
    if (busy) {
      list.forEach(it => { const r = hosts.get(it.id); if (r) r.pv.set({ sample: m.sample, popId: it.pop || null, x: it.x, y: it.y || null }); });
      return;
    }
    clear(el);
    const bar = h('div.sheet-bar',
      h('span.muted.small', 'Every plot of ' + (m.sample.well || m.sample.name) + ' · drag a title bar to move a plot, its corner to resize it'),
      h('span.grow'),
      h('button.btn.sm.sheet-add', { 'data-tip': 'A new plot — choose its population at the top of the card', on: { click: () => addPlot(list, ctx) } }, icon('plus'), 'Add plot'),
      list.some(it => it.type === 'stats') ? null : h('button.btn.sm', { on: { click: () => save(ws, list.concat([{ id: 'stats', type: 'stats' }]), { hidden: (ws.doc.sheet && ws.doc.sheet.hidden || []).filter(k => k !== 'stats') }, 'Show statistics') } }, icon('grid'), 'Statistics'),
      h('div.seg.sm.sheet-size', { role: 'group', 'aria-label': 'Plot size' }, [['s', 'S'], ['m', 'M'], ['l', 'L']].map(([k, l]) =>
        h('button' + (size === k ? '.on' : ''), { 'data-tip': { s: 'Small plots — more on the screen', m: 'Medium plots', l: 'Large plots' }[k], on: { click: () => save(ws, list.map(it => Object.assign({}, it, { w: null, h: null })), { size: k }, 'Plot size') } }, l))),
      ws.doc.sheet ? h('button.btn.sm.ghost', { 'data-tip': 'Back to the default: one plot per population with gates', on: { click: () => ws.setSheet(null, 'Reset worksheet') } }, icon('undo'), 'Reset') : null);
    const grid = h('div.sheet-grid');
    const seen = new Set();
    const cards = list.map((it, i) => {
      seen.add(it.id);
      const card = it.type === 'stats' ? statsCard(m, list, i, ctx, px) : plotCard(it, m, list, i, px, ctx);
      card.appendChild(resizer(card, it, list, i, px));
      return card;
    });
    cards.forEach(c => grid.appendChild(c));
    FM.dom.sortable(cards, (from, to) => { const l = list.slice(); const [x] = l.splice(from, 1); l.splice(to, 0, x); save(ws, l, null, 'Move plot'); }, { handle: '.sheet-head' });
    hosts.forEach((v, id) => { if (!seen.has(id)) { v.pv.destroy(); hosts.delete(id); } });
    el.append(bar, grid);
    // the hosts have their size now: draw
    FM.dom.frame(() => hosts.forEach(v => { if (v.pv.model) v.pv.render(); }));
  }

  /**
   * The corner handle: drag it to resize this card (a plot, or the statistics table). The plot follows
   * live; the size is saved when the drag ends, as one undo step.
   */
  function resizer(card, it, list, i, px) {
    const ws = W();
    const grip = h('div.sheet-resize', { 'data-tip': 'Drag to resize', 'aria-label': 'Resize' });
    grip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const stats = it.type === 'stats';
      const target = stats ? card : hosts.get(it.id) && hosts.get(it.id).host;
      if (!target) return;
      const r0 = target.getBoundingClientRect();
      const x0 = e.clientX, y0 = e.clientY;
      let w = r0.width, hh = r0.height;
      card.classList.add('resizing');
      const move = ev => {
        w = Math.round(Math.max(stats ? 260 : 200, Math.min(1400, r0.width + ev.clientX - x0)));
        hh = Math.round(Math.max(stats ? 120 : 180, Math.min(1200, r0.height + ev.clientY - y0)));
        target.style.width = w + 'px';
        if (!stats) target.style.height = hh + 'px';
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        card.classList.remove('resizing');
        if (Math.abs(w - r0.width) < 2 && Math.abs(hh - r0.height) < 2) return;
        const l = list.slice();
        l[i] = Object.assign({}, it, stats ? { w } : { w, h: hh });
        save(ws, l, null, 'Resize plot');
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
    return grip;
  }

  function remove(ws, list, i) {
    const it = list[i];
    const hidden = (ws.doc.sheet && ws.doc.sheet.hidden || []).concat([keyOf(it)]);
    save(ws, list.filter((_, j) => j !== i), { hidden }, 'Remove plot');
  }

  function plotCard(it, m, list, i, px, ctx) {
    const ws = W();
    const names = ws.paramNames();
    const axisSel = (which, cur) => h('select.input.sm.sheet-axis', { 'aria-label': which === 'x' ? 'X axis' : 'Y axis', on: { change: e => {
      const l = list.slice();
      const v = e.target.value || null;
      l[i] = Object.assign({}, it, { [which]: v, id: 'u:' + Date.now().toString(36) });
      if (which === 'x' && !v) return;
      save(ws, l, { hidden: (ws.doc.sheet && ws.doc.sheet.hidden || []).concat([keyOf(it)]) }, 'Change axes');
    } } },
      which === 'y' ? h('option', { value: '', selected: !cur }, 'Histogram') : null,
      names.map(n => h('option', { value: n, selected: n === cur }, n)));
    let rec = hosts.get(it.id);
    if (!rec) {
      const host = h('div.sheet-plot');
      const pv = new FM.PlotView(host, {
        card: true,
        onDrill: id => ctx.open(id),
        onCreated: id => ctx.created(id, rec.pv),
        onGateMenu: (id, at) => ctx.gateMenu(id, at),
        suggestName: (g, model) => ctx.suggestName(g, model),
      });
      rec = { host, pv };
      hosts.set(it.id, rec);
    }
    // every card has a definite size (its own, or the S / M / L one): cards then flow in rows and never overlap
    rec.host.style.width = (it.w || px) + 'px';
    rec.host.style.height = (it.h || Math.round(px * 0.92)) + 'px';
    rec.pv.set({ sample: m.sample, popId: it.pop || null, x: it.x, y: it.y || null });
    const n = ws.count(m.sample, it.pop || null);
    return h('div.sheet-card', { 'data-id': it.id, 'data-pop': it.pop || 'root' },
      h('div.sheet-head', { 'data-tip': 'Drag to move this plot' },
        h('span.sheet-grip', '⠿'),
        popSelect(it, list, i, ctx),
        h('span.mono.muted.small', fmtCount(n)),
        h('span.grow'),
        h('button.btn.ghost.sm.icon', { 'data-tip': 'Open this plot on its own', 'aria-label': 'Open', on: { click: () => ctx.single(it) } }, icon('expand')),
        h('button.btn.ghost.sm.icon', { 'data-tip': 'Take this plot off the worksheet', 'aria-label': 'Remove plot', on: { click: () => remove(ws, list, i) } }, icon('x'))),
      // each axis: its parameter, and its scale (Lin, Log, Logicle… and the range) — the same button as on the single plot
      h('div.sheet-axes',
        it.y ? h('span.sheet-ax', axisSel('y', it.y), FM.axisUI.chip(it.y, it.pop || null)) : axisSel('y', it.y),
        h('span.muted.small', 'vs'),
        h('span.sheet-ax', axisSel('x', it.x), FM.axisUI.chip(it.x, it.pop || null))),
      rec.host);
  }

  /** Every population of the current sample: events, % of its parent, % of all events. */
  function statsCard(m, list, i, ctx, px) {
    const it = list[i];
    const ws = W();
    const s = m.sample;
    const total = ws.count(s, null);
    const depth = g => { let d = 0, p = g.parent; while (p) { d++; p = (ws.gate(p) || {}).parent; } return d; };
    const rows = [h('tr' + (!FM.ui.gateId ? '.on' : ''), h('td', 'All events'), h('td.r.mono', fmtCount(total)), h('td.r.mono', '—'), h('td.r.mono', '100%'))]
      .concat(FM.io.gatesInOrder().map(g => {
        const n = ws.count(s, g.id);
        return h('tr' + (FM.ui.gateId === g.id ? '.on' : ''), { 'data-tip': 'Click to select · right-click to rename, export its events, delete…',
          on: { click: () => FM.setUI({ gateId: g.id }), contextmenu: e => { e.preventDefault(); FM.setUI({ gateId: g.id }); ctx.gateMenu(g.id, { x: e.clientX, y: e.clientY }); } } },
          h('td', { style: { paddingLeft: (8 + depth(g) * 14) + 'px' } }, h('span.sheet-sw', { style: { background: g.color || 'var(--accent)' } }), g.name),
          h('td.r.mono', fmtCount(n)),
          h('td.r.mono', fmtPct(ws.pct(s, g.id))),
          h('td.r.mono', fmtPct(total ? 100 * n / total : NaN)));
      }));
    return h('div.sheet-card.sheet-stats', { 'data-id': 'stats', style: { width: (it.w || Math.max(400, px)) + 'px' } },
      h('div.sheet-head', { 'data-tip': 'Drag to move the table' },
        h('span.sheet-grip', '⠿'), h('span.sheet-name', 'Statistics'), h('span.mono.muted.small', s.well || s.name), h('span.grow'),
        h('button.btn.ghost.sm.icon', { 'data-tip': 'Copy the table (paste into Excel or Prism)', 'aria-label': 'Copy', on: { click: () => copyStats(s) } }, icon('copy')),
        h('button.btn.ghost.sm.icon', { 'data-tip': 'Take the table off the worksheet', 'aria-label': 'Remove table', on: { click: () => remove(ws, list, i) } }, icon('x'))),
      h('div.scroll.sheet-stats-body', h('table.tbl.sheet-tbl',
        h('thead', h('tr', h('th', 'Population'), h('th.r', 'Events'), h('th.r', '% parent'), h('th.r', '% total'))),
        h('tbody', rows))));
  }

  function copyStats(s) {
    const ws = W();
    const total = ws.count(s, null);
    const lines = [['Population', 'Parent', 'Events', '% parent', '% total'].join('\t'), ['All events', '', total, '', 100].join('\t')]
      .concat(FM.io.gatesInOrder().map(g => { const n = ws.count(s, g.id); return [g.name, ws.popName(g.parent), n, +ws.pct(s, g.id).toFixed(2), total ? +(100 * n / total).toFixed(2) : ''].join('\t'); }));
    FM.io.copyText(lines.join('\n'));
    FM.dom.toast('Statistics copied');
  }

  /** A new card: inside the selected gate if there is one (to gate further), else all events. */
  function addPlot(list, ctx) {
    const ws = W();
    const pop = FM.ui.gateId && ws.gate(FM.ui.gateId) ? FM.ui.gateId : null;
    const a = ctx.axesOf(pop);
    save(ws, list.concat([{ id: 'u:' + Date.now().toString(36), pop, x: a.x, y: a.y || null }]), null, 'Add plot');
  }

  /** The population a card plots — its source — chosen at the top of the card. */
  function popSelect(it, list, i, ctx) {
    const ws = W();
    const depth = g => { let d = 0, p = g.parent; while (p) { d++; p = (ws.gate(p) || {}).parent; } return d; };
    return h('select.input.sm.sheet-pop', { 'aria-label': 'Population', 'data-tip': 'The population this plot shows', on: { change: e => {
      const pop = e.target.value || null;
      const a = ctx.axesOf(pop);
      const l = list.slice();
      l[i] = { id: 'u:' + Date.now().toString(36), pop, x: a.x, y: a.y || null };
      save(ws, l, { hidden: (ws.doc.sheet && ws.doc.sheet.hidden || []).concat([keyOf(it)]) }, 'Change population');
    } } },
      h('option', { value: '', selected: !it.pop }, 'All events'),
      FM.io.gatesInOrder().map(g => h('option', { value: g.id, selected: g.id === it.pop }, ' '.repeat(depth(g)) + g.name)));
  }

  function destroy() { hosts.forEach(v => v.pv.destroy()); hosts = new Map(); }
  /** The card plot views (for the UI test). */
  function views() { return hosts; }

  FM.gateSheet = { render, destroy, items, views };
})(FM);
