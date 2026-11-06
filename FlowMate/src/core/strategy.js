/* Gating-strategy chains on the Layout page.
 *
 * A *step* is (population, x, y): a population plotted on the axes one of its child gates
 * was drawn on. A gating strategy is one plot per step, read left to right — scatter, then
 * singlets, then the positive gate — with an arrow from each gate to the plot of what is
 * inside it.
 *
 * A chain is a set of ordinary plot items tagged `chain: <id>`, all for one well. Arrows are
 * DERIVED, never stored: one runs from gate G on the plot of G's parent step to the plot
 * whose population is G, when both are in the same chain. So moving or deleting a plot can
 * never leave an arrow pointing at nothing.
 *
 * Every function here works on a plain doc, so the workspace can call it inside the same
 * update — undo takes a gate and the plot it added off the page together.
 */
(function (FM) {
  'use strict';

  const GAP_X = 46;       // room between two plots for an arrow
  const GAP_Y = 22;
  const CHAIN_GAP = 30;   // between two chains stacked on one page
  const MAX_COLS = 5;     // deeper strategies wrap onto a second band
  const TITLE_H = 22;

  const U = () => FM.workspaceUtil;
  const pad = () => U().PAGE_PAD;
  const gap = () => U().ITEM_GAP;

  /** Is this gate drawn on these axes? (Same rule as the plot's.) */
  function fits(g, ax, ay) {
    if (!g || g.type === 'bool') return false;
    if (g.type === 'range') return !ay && g.x === ax;
    return g.x === ax && (g.y || null) === (ay || null);
  }

  function stepKey(pop, x, y) { return (pop || 'root') + '|' + x + '|' + (y || ''); }
  function itemStepKey(it) { return stepKey(it.pop || null, it.ax, it.ay || null); }

  function childrenOf(gates, pid) { return gates.filter(g => (g.parent || null) === (pid || null)); }

  /** Every step of the hierarchy, depth-first, parents before children. */
  function steps(gates) {
    const out = [];
    const walk = (pid, depth) => {
      const kids = childrenOf(gates, pid);
      const seen = [];
      kids.forEach(k => {
        if (k.type === 'bool') return;     // no axes to plot it on; what is inside it still is
        const key = stepKey(pid, k.x, k.y || null);
        let st = seen.find(s => s.key === key);
        if (!st) { st = { key, pop: pid || null, x: k.x, y: k.y || null, depth, gates: [] }; seen.push(st); out.push(st); }
        st.gates.push(k.id);
      });
      kids.forEach(k => walk(k.id, depth + 1));
    };
    walk(null, 0);
    return out;
  }

  /**
   * Grid cells for a list of steps: column = depth, and each step starts on its feeder's row
   * (the step whose plot draws the gate it shows), moving down only when that cell is taken.
   * So a straight chain reads as one row and a branch drops below its sibling.
   */
  function grid(list, gatesById) {
    const cell = new Map(), taken = new Set();
    list.forEach(st => {
      const g = st.pop ? gatesById.get(st.pop) : null;
      const feeder = g ? list.find(o => (o.pop || null) === (g.parent || null) && fits(g, o.x, o.y)) : null;
      const col = st.depth;
      let row = feeder && cell.has(feeder.key) ? cell.get(feeder.key).row : 0;
      while (taken.has(col + ':' + row)) row++;
      taken.add(col + ':' + row);
      cell.set(st.key, { col, row });
    });
    const nCols = list.length ? Math.max.apply(null, list.map(s => cell.get(s.key).col)) + 1 : 0;
    const nRows = list.length ? Math.max.apply(null, list.map(s => cell.get(s.key).row)) + 1 : 0;
    // strategies deeper than MAX_COLS wrap: each band of columns sits below the previous one
    const bands = Math.ceil(nCols / MAX_COLS) || 1;
    list.forEach(st => {
      const c = cell.get(st.key);
      const band = Math.floor(c.col / MAX_COLS);
      c.col = c.col % MAX_COLS;
      c.row = band * nRows + c.row;
    });
    return { cell, cols: Math.min(nCols, MAX_COLS), rows: nRows * bands };
  }

  /** A plot width that fits `cols` plots and their arrows across the page. */
  function plotSize(pageW, cols, rows, chains, pageH, reserve) {
    const avail = pageW - 2 * pad();
    let w = Math.floor((avail - (Math.max(1, cols) - 1) * GAP_X) / Math.max(1, cols));
    w = Math.max(150, Math.min(360, w));
    // shrink to fit the page height only where plots stay readable (≥ 170 px); past that the
    // page grows instead — half a sheet of empty width helps nobody
    const totalRows = rows * chains;
    const availH = pageH - 2 * pad() - (reserve || 0) - (chains - 1) * CHAIN_GAP;
    const byH = Math.floor(((availH - (totalRows - 1) * GAP_Y) / Math.max(1, totalRows) - TITLE_H) / 0.9);
    if (byH < w && byH >= 170) w = byH;
    else if (byH < 170 && chains > 1) w = Math.min(w, 280);   // a tall grid of rows: modest plots, page grows
    return { w, h: Math.round(w * 0.9) + TITLE_H };
  }

  /** A rough height for a gating tree table with this many populations (the view refines it). */
  function tableHeight(nPops) { return 58 + nPops * 30 + 34; }

  function overlaps(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

  function growPage(L) {
    const bottom = Math.ceil(Math.max.apply(null, L.items.map(i => i.y + i.h).concat([0])) + pad());
    if (bottom > L.page.h) { L.page.h = bottom; L.page.preset = 'custom'; }
  }

  /** Tables belong at the bottom: push any that a plot now overlaps below every plot. */
  function settleTables(L) {
    const others = L.items.filter(i => i.kind !== 'table');
    L.items.filter(i => i.kind === 'table').forEach(t => {
      if (!others.some(o => overlaps(o, t))) return;
      t.y = Math.ceil(Math.max.apply(null, others.map(o => o.y + o.h)) + gap() * 2);
    });
  }

  /**
   * Build chains into doc `d`: one per well in opts.samples, stacked. opts.replace drops the
   * chains already on the page; opts.table adds a gating tree table at the bottom when the
   * page has none. Returns the new item ids.
   */
  function build(d, opts) {
    const L = d.layout;
    const gatesById = new Map(d.gates.map(g => [g.id, g]));
    const list = steps(d.gates);
    if (!list.length || !opts.samples.length) return [];
    if (opts.replace) L.items = L.items.filter(i => !i.chain);
    const G = grid(list, gatesById);
    const hasTable = L.items.some(i => i.kind === 'table');
    const reserve = opts.table && !hasTable ? tableHeight(d.gates.length + 1) + gap() * 2 : 0;
    const sz = plotSize(L.page.w, G.cols, G.rows, opts.samples.length, L.page.h, reserve);
    // start below whatever else is on the page (tables excepted: they sink below the chain)
    const above = L.items.filter(i => i.kind !== 'table');
    let y0 = above.length ? Math.ceil(Math.max.apply(null, above.map(i => i.y + i.h)) + CHAIN_GAP) : pad();
    const made = [];
    opts.samples.forEach(key => {
      const cid = U().uid('ch');
      list.forEach((st, i) => {
        const c = G.cell.get(st.key);
        made.push({
          id: U().uid('li'), kind: 'plot', chain: cid, head: i === 0, sample: key,
          pop: st.pop, ax: st.x, ay: st.y,
          x: pad() + c.col * (sz.w + GAP_X), y: y0 + c.row * (sz.h + GAP_Y), w: sz.w, h: sz.h,
          title: '', autoTitle: true, showGates: true, showPct: true, showCount: true,
        });
      });
      y0 += G.rows * (sz.h + GAP_Y) - GAP_Y + CHAIN_GAP;
    });
    L.items = L.items.concat(made);
    if (opts.table && !hasTable) {
      const bottom = Math.max.apply(null, L.items.map(i => i.y + i.h));
      const w = L.page.w - 2 * pad();
      made.push({ id: U().uid('li'), kind: 'table', mode: opts.tableMode || 'condition', value: 'parent',
        sample: opts.samples[0], x: pad(), y: Math.ceil(bottom + gap() * 2), w, h: tableHeight(d.gates.length + 1), scale: 1 });
      L.items.push(made[made.length - 1]);
    }
    settleTables(L);
    growPage(L);
    return made.map(i => i.id);
  }

  function chainIds(items) {
    const ids = [];
    items.forEach(i => { if (i.kind === 'plot' && i.chain && ids.indexOf(i.chain) < 0) ids.push(i.chain); });
    return ids;
  }

  /** The chain plot that draws gate `popId` — the plot the arrow into `popId`'s plot leaves from. */
  function feederOf(items, gatesById, popId) {
    const g = gatesById.get(popId);
    if (!g) return null;
    return items.find(i => (i.pop || null) === (g.parent || null) && fits(g, i.ax, i.ay)) || null;
  }

  /**
   * New gates join every chain on the page: a gate drawn on axes that have no plot in the
   * chain yet gets one, beside the plot that feeds it. Called inside the gate's own update.
   */
  function extend(d, gateIds) {
    const L = d.layout;
    if (!L || !Array.isArray(L.items)) return [];
    const cids = chainIds(L.items);
    if (!cids.length) return [];
    const gatesById = new Map(d.gates.map(g => [g.id, g]));
    const fresh = [];
    gateIds.forEach(id => {
      const g = gatesById.get(id);
      if (!g || g.type === 'bool') return;
      const key = stepKey(g.parent || null, g.x, g.y || null);
      if (!fresh.some(s => s.key === key)) fresh.push({ key, pop: g.parent || null, x: g.x, y: g.y || null });
    });
    const made = [];
    cids.forEach(cid => fresh.forEach(st => {
      const items = L.items.filter(i => i.kind === 'plot' && i.chain === cid);
      if (!items.length || items.some(i => itemStepKey(i) === st.key)) return;
      const head = items.find(i => i.head) || items[0];
      // a head left with no gates (all deleted) takes the new first step rather than sit empty
      if (!st.pop && !head.pop && !d.gates.some(g => !g.parent && fits(g, head.ax, head.ay))) {
        head.ax = st.x; head.ay = st.y;
        return;
      }
      const feeder = st.pop ? feederOf(items, gatesById, st.pop) : null;
      const ref = feeder || (st.pop ? items[items.length - 1] : head);
      const box = { w: ref.w, h: ref.h, x: 0, y: 0 };
      if (!st.pop) { box.x = head.x; box.y = head.y + head.h + GAP_Y; }
      else { box.x = ref.x + ref.w + GAP_X; box.y = ref.y; }
      if (box.x + box.w > L.page.w - pad() + 0.5) {
        // no room to the right: start a new row under the chain
        box.x = Math.min.apply(null, items.map(i => i.x));
        box.y = Math.max.apply(null, items.map(i => i.y + i.h)) + GAP_Y;
      }
      for (let guard = 0; guard < 80; guard++) {
        const hit = L.items.filter(o => o.kind !== 'table' && overlaps(o, box));
        if (!hit.length) break;
        box.y = Math.max.apply(null, hit.map(o => o.y + o.h)) + GAP_Y;
      }
      const it = { id: U().uid('li'), kind: 'plot', chain: cid, head: false, sample: head.sample,
        pop: st.pop, ax: st.x, ay: st.y, x: box.x, y: box.y, w: box.w, h: box.h,
        title: '', autoTitle: true, showGates: true, showPct: true, showCount: head.showCount !== false };
      L.items.push(it);
      made.push(it.id);
    }));
    if (made.length) { settleTables(L); growPage(L); }
    return made;
  }

  /**
   * Chain plots are derived from gates, so they go when their gate goes: a plot of a deleted
   * population, or of a step no gate is drawn on any more. The head (the chain's first plot)
   * stays, so the chain survives having every gate deleted and redrawn.
   */
  function prune(d) {
    const L = d.layout;
    if (!L || !Array.isArray(L.items)) return;
    const byId = new Map(d.gates.map(g => [g.id, g]));
    L.items = L.items.filter(it => {
      if (it.kind !== 'plot' || !it.chain || it.head) return true;
      if (it.pop && !byId.has(it.pop)) return false;
      return d.gates.some(g => (g.parent || null) === (it.pop || null) && fits(g, it.ax, it.ay));
    });
  }

  /** The arrows to draw: from gate `gate` on plot `from` to plot `to`, within each chain. */
  function links(items, gatesById) {
    const out = [];
    const plots = items.filter(i => i.kind === 'plot' && i.chain);
    plots.forEach(b => {
      if (!b.pop) return;
      const same = plots.filter(a => a.chain === b.chain && a !== b);
      const a = feederOf(same, gatesById, b.pop);
      if (a) out.push({ from: a.id, to: b.id, gate: b.pop });
    });
    return out;
  }

  /**
   * Re-grid one chain in place (Tidy): same sizes, positions from the hierarchy, starting at
   * (x0, y0). Returns the bottom edge.
   */
  function arrange(items, gatesById, x0, y0) {
    const list = [];
    const depthOf = pop => { let d = 0, id = pop, guard = 0; while (id && guard++ < 256) { d++; const g = gatesById.get(id); id = g ? g.parent : null; } return d; };
    items.forEach(it => list.push({ key: itemStepKey(it) + '#' + it.id, pop: it.pop || null, x: it.ax, y: it.ay || null, depth: depthOf(it.pop), it }));
    // parents before children, so each step can find its feeder's row
    list.sort((p, q) => p.depth - q.depth);
    const G = grid(list, gatesById);
    const w = Math.max.apply(null, items.map(i => i.w)), h = Math.max.apply(null, items.map(i => i.h));
    list.forEach(st => {
      const c = G.cell.get(st.key);
      st.it.x = x0 + c.col * (w + GAP_X);
      st.it.y = y0 + c.row * (h + GAP_Y);
    });
    return Math.max.apply(null, items.map(i => i.y + i.h));
  }

  /** The title a chain plot shows: its population, and on the first plot the well too. */
  function autoTitle(ws, it) {
    const pop = ws.popName(it.pop);
    if (!it.head) return pop;
    const s = ws.sample(it.sample);
    const g = s ? ws.groupOf(s.key) : null;
    return (s ? (s.well || s.name) : it.sample) + (g ? ' · ' + g.name : '') + '  —  ' + pop;
  }

  FM.strategy = { steps, grid, build, extend, prune, links, arrange, feederOf, fits, stepKey, autoTitle, chainIds,
    tableHeight, settleTables, growPage, GAP_X, GAP_Y, CHAIN_GAP, TITLE_H };
})(FM);
