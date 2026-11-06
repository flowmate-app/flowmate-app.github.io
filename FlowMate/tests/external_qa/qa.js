/* FlowMate external QA driver. Runs FlowMate's own engine (src/core) in headless Chrome on a
 * task described by a JSON file (?task=tasks/<name>.json) and writes the result as JSON into
 * <pre id="out"> for run.sh to collect. Nothing here changes FlowMate: it only calls the same
 * functions the app calls (FM.fcs.parse, Workspace.addSamples, FM.wsp.importInto, addGate,
 * count/pct/stat, FM.plot.render).
 *
 * Task types
 *   wsp   import a FlowJo workspace with its FCS files; FlowMate's count vs FlowJo's, per population
 *   gate  apply a hand-drawn gate set to every sample; counts, % of parent and statistics
 *   plot  the same, then draw density plots (FlowMate's renderer) for choosing gates by eye
 */
(function () {
  'use strict';
  const Q = new URLSearchParams(location.search);
  const out = o => { document.getElementById('out').textContent = JSON.stringify(o); };
  const done = s => { document.getElementById('status').textContent = s; };

  async function fetchBuf(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error('fetch ' + path + ' → ' + r.status);
    return r.arrayBuffer();
  }
  const urlOf = (dir, f) => dir + f.split('/').map(encodeURIComponent).join('/');

  // names: { file on disk: name to load it as } — the same as renaming the file before loading it
  async function loadSamples(dir, files, names) {
    const samples = [], errors = [];
    for (const f of files) {
      try { samples.push(FM.fcs.parse(await fetchBuf(urlOf(dir, f)), (names && names[f]) || f)); }
      catch (e) { errors.push({ file: f, error: String(e && e.message || e) }); }
    }
    return { samples, errors };
  }

  function sampleInfo(s) {
    return { name: s.name, key: s.key, events: s.n, params: s.params.map(p => p.name), fcsVersion: s.version,
      spill: s.spill ? s.spill.params : null, cyt: s.cytometer, datatype: s.meta.$DATATYPE, src: s.meta.CREATOR || s.meta.$CREATOR || null };
  }

  // ------------------------------------------------------------------ wsp
  async function runWsp(task) {
    const { samples, errors } = await loadSamples(task.dir, task.fcs, task.names);
    const ws = new FM.Workspace();
    ws.addSamples(samples);
    let text = await (await fetch(urlOf(task.dir, task.wsp))).text();
    // DIAGNOSTIC ONLY: textual substitutions in the workspace (e.g. FlowJo's "LIVE_DEAD" for the
    // file's "LIVE/DEAD"), to see what a defect hides. Never used for a pass/fail result.
    (task.wspReplace || []).forEach(([a, b]) => { text = text.split(a).join(b); });
    const parsed = FM.wsp.parse(text);
    const tally = {}, xf = {};
    parsed.samples.forEach(ps => {
      ps.pops.forEach(n => { const k = n.gate.type + (n.gate.not ? '-not' : '') + (n.gate.op ? '-' + n.gate.op : ''); tally[k] = (tally[k] || 0) + 1; });
      Object.values(ps.transforms).forEach(t => { xf[t.type] = (xf[t.type] || 0) + 1; });
    });
    const t0 = performance.now();
    const rep = FM.wsp.importInto(ws, parsed);
    const ms = performance.now() - t0;
    // DIAGNOSTIC ONLY (task.clampRects): open every rectangle/range edge that the gate's own axis
    // transform puts at or beyond the plot floor/ceiling — FlowJo's display-space rule — to test
    // whether that one difference explains a FlowMate/FlowKit disagreement.
    let clamped = 0;
    if (task.clampRects) {
      const T = FM.transforms;
      const fix = (spec, lo, hi) => {
        if (!spec) return [lo, hi];
        const S = T.makeScale(spec);
        return [lo != null && S.fwd(lo) <= 0 ? null : lo, hi != null && S.fwd(hi) >= 1 && task.clampRects !== 'floor' ? null : hi];
      };
      ws.doc.gates.slice().forEach(g => {
        const geo = gg => {
          if (gg.rect) { const [x0, x1] = fix(g.xScale, gg.rect.x0, gg.rect.x1), [y0, y1] = fix(g.yScale, gg.rect.y0, gg.rect.y1); return { rect: { x0, x1, y0, y1 } }; }
          if (gg.range) { const [lo, hi] = fix(g.xScale, gg.range.lo, gg.range.hi); return { range: { lo, hi } }; }
          return null;
        };
        const base = geo(g);
        if (base) { ws.updateGate(g.id, base); clamped++; }
        Object.entries(g.perWell || {}).forEach(([k, o]) => { const v = geo(o); if (v) ws.setGateOverride(g.id, k, v); });
      });
      rep.compare = rep.compare.map(r => Object.assign({}, r, { ours: ws.count(ws.samples.find(s => s.key === r.sample), r.gateId) }));
    }
    const totals = {};
    parsed.samples.forEach(ps => { totals[ps.file] = ps.count; });
    out({ type: 'wsp', wsp: task.wsp, flowjoVersion: parsed.version, parseWarnings: parsed.warnings,
      importWarnings: rep.warnings, missing: rep.missing, matched: rep.matched.length, gates: rep.gates, compensation: rep.compensation,
      gateTypes: tally, transformTypes: xf, loadErrors: errors, flowjoTotals: totals, ms, wspReplace: task.wspReplace || null, clampedRects: clamped,
      compActive: ws.doc.comp.active, compensated: ws.samples.map(s => !!s.compensated),
      popErrors: ws.samples.map(s => s._popErrors && Object.keys(s._popErrors).length ? s._popErrors : null).filter(Boolean).slice(0, 3),
      samples: samples.map(sampleInfo),
      compare: rep.compare.map(r => ({ file: r.file, path: r.path, flowjo: r.flowjo, ours: r.ours })),
      gatesOut: task.gatesOut ? ws.doc.gates : undefined,
      probe: task.probe ? new Function('FM', 'ws', 'rep', task.probe)(FM, ws, rep) : undefined,
      members: (task.members || []).map(([file, path]) => { const s = ws.samples.find(x => x.name === file); const id = rep.paths[path];
        return { file, path, idx: s && id ? Array.from(ws.indices(s, id)) : null }; }) });
  }

  // ------------------------------------------------------- hand-drawn gates
  /** Build the gates of a task in order. Coordinates given as display fractions (`disp: true`)
   * are converted exactly as a click on the plot is (PlotView.dataOf): t → scale.inv(t) on the
   * parent's framed view scale, which the gate then keeps as its own xScale/yScale. */
  function buildGates(ws, specs) {
    const ids = {};
    const frozen = [];
    (specs || []).forEach(sp => {
      const parent = sp.parent ? ids[sp.parent] : null;
      if (sp.parent && !parent) throw new Error('unknown parent ' + sp.parent);
      let g;
      if (sp.frozen) g = Object.assign({}, sp.frozen, { parent });
      else {
        const xs = sp.xScale || ws.viewScale(parent, sp.x);
        const ys = sp.y ? (sp.yScale || ws.viewScale(parent, sp.y)) : null;
        // the plot's own edge snapping (PlotView snapT): a click at the frame means "open"
        const snap = t => (t <= 0.012 ? -0.35 : t >= 0.988 ? 1.35 : t);
        const X0 = FM.transforms.makeScale(xs), Y0 = ys ? FM.transforms.makeScale(ys) : null;
        // "d:<value>" is a position typed in data units (Edit coordinates); a number is a click
        const X = { inv: t => (typeof t === 'string' ? +t.slice(2) : X0.inv(snap(t))) };
        const Y = Y0 ? { inv: t => (typeof t === 'string' ? +t.slice(2) : Y0.inv(snap(t))) } : null;
        g = { type: sp.type, x: sp.x, y: sp.y || null, xScale: xs, yScale: ys, parent };
        if (sp.type === 'polygon') g.verts = sp.verts.map(([tx, ty]) => sp.disp ? [X.inv(tx), Y.inv(ty)] : [tx, ty]);
        else if (sp.type === 'rect') {
          const [a, b, c, d] = sp.rect; // x0, x1, y0, y1
          g.rect = sp.disp ? { x0: X.inv(a), x1: X.inv(b), y0: Y.inv(c), y1: Y.inv(d) } : { x0: a, x1: b, y0: c, y1: d };
        } else if (sp.type === 'range') {
          const [lo, hi] = sp.range;
          g.range = sp.disp ? { lo: X.inv(lo), hi: X.inv(hi) } : { lo, hi };
        } else throw new Error('type ' + sp.type);
      }
      g.name = sp.name;
      const id = ws.addGate(g);
      ids[sp.name] = id;
      // a range gate dragged on each well until it holds the top fraction of its parent
      // (the per-well "Edits apply to: this well" adjustment)
      if (sp.perWellTop) {
        ws.samples.forEach(s => {
          const col = s.data[sp.x];
          const v = Array.from(ws.indices(s, parent), i => col[i]).sort((a, b) => a - b);
          const lo = FM.transforms.quantile(v, 1 - sp.perWellTop);
          ws.setGateOverride(id, s.key, { range: { lo, hi: g.range.hi } });
        });
      }
      const saved = JSON.parse(JSON.stringify(ws.gate(id)));
      delete saved.id; delete saved.rev; delete saved.parent; delete saved.color;
      frozen.push(Object.assign({ name: sp.name, parentName: sp.parent || null }, { frozen: saved }));
    });
    return { ids, frozen };
  }

  function tabulate(ws, ids, stats) {
    const rows = [];
    ws.samples.forEach(s => {
      const r = { sample: s.name, total: ws.count(s, null), pops: {} };
      Object.entries(ids).forEach(([name, id]) => {
        const o = { count: ws.count(s, id), pct: ws.pct(s, id) };
        (stats || []).filter(st => st.pop === name).forEach(st => { o[st.which + '(' + st.param + ')'] = ws.stat(s, id, st.param, st.which); });
        r.pops[name] = o;
      });
      rows.push(r);
    });
    return rows;
  }

  async function runGate(task) {
    const { samples, errors } = await loadSamples(task.dir, task.fcs, task.names);
    const ws = new FM.Workspace();
    ws.addSamples(samples);
    if (task.comp) ws.setComp(task.comp);
    const { ids, frozen } = buildGates(ws, task.gates);
    const res = { type: 'gate', loadErrors: errors, samples: samples.map(sampleInfo), gates: frozen,
      comp: ws.doc.comp.active, rows: tabulate(ws, ids, task.stats) };
    if (task.quantiles) res.quantiles = quantiles(ws, ids, task.quantiles);
    return { ws, ids, res };
  }

  /** Quantiles of one parameter inside a population, per sample (FlowMate's own population). */
  function quantiles(ws, ids, qs) {
    const o = {};
    ws.samples.forEach(s => {
      o[s.name] = qs.map(q => {
        const idx = ws.indices(s, ids[q.pop] || null);
        const col = s.data[q.param];
        const v = Array.from(idx, i => col[i]).sort((a, b) => a - b);
        return { pop: q.pop, param: q.param, p: q.p, value: v.length ? FM.transforms.quantile(v, q.p) : NaN, n: v.length };
      });
    });
    return o;
  }

  // ------------------------------------------------------------------ plot
  /** A pseudo-sample holding the events of `popId` from every listed sample, for one pooled plot. */
  function pooled(ws, popId, params, which, cap) {
    const parts = ws.samples.filter(s => !which || which.indexOf(s.name) >= 0).map(s => ({ s, idx: ws.indices(s, popId) }));
    const n = parts.reduce((a, p) => a + p.idx.length, 0);
    const step = Math.max(1, Math.ceil(n / (cap || 400000)));
    const data = {};
    params.forEach(p => { data[p] = []; });
    parts.forEach(({ s, idx }) => { for (let i = 0; i < idx.length; i += step) params.forEach(p => data[p].push(s.data[p][idx[i]])); });
    const m = data[params[0]].length;
    params.forEach(p => { data[p] = Float32Array.from(data[p]); });
    return { sample: { name: 'pooled', data, params: params.map(p => ({ name: p })) }, idx: Uint32Array.from({ length: m }, (_, i) => i), n };
  }

  function drawGrid(ctx, L, xs, ys) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.13)'; ctx.fillStyle = '#c0392b'; ctx.lineWidth = 1; ctx.font = '10px sans-serif';
    for (let k = 1; k < 20; k++) {
      const t = k / 20, major = k % 2 === 0;
      ctx.globalAlpha = major ? 1 : 0.45;
      const [px] = FM.plot.toPx(L, t, 0), [, py] = FM.plot.toPx(L, 0, t);
      ctx.beginPath(); ctx.moveTo(px, L.y0); ctx.lineTo(px, L.y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(L.x0, py); ctx.lineTo(L.x1, py); ctx.stroke();
      if (major) { ctx.globalAlpha = 1; ctx.fillText(t.toFixed(1), px + 2, L.y0 + 10); ctx.fillText(t.toFixed(1), L.x0 + 2, py - 2); }
    }
    ctx.restore();
  }

  async function runPlot(task) {
    const { ws, ids, res } = await runGate(task);
    const host = document.getElementById('plots');
    const size = task.size || 520;
    for (const p of task.plots) {
      const popId = p.pop ? ids[p.pop] : null;
      const xs = ws.viewScale(popId, p.x), ys = p.y ? ws.viewScale(popId, p.y) : null;
      const params = p.y ? [p.x, p.y] : [p.x];
      const groups = p.each ? ws.samples.filter(s => !p.samples || p.samples.indexOf(s.name) >= 0).map(s => [s.name.replace(/\.fcs$/i, ''), [s.name]]) : [[p.title || 'pooled', p.samples || null]];
      for (const [title, which] of groups) {
        const pool = pooled(ws, popId, params, which, p.cap);
        const cell = document.createElement('div'); cell.className = 'cell';
        const cap = document.createElement('div'); cap.className = 'cap';
        cap.textContent = (p.label || '') + ' ' + title + ' — ' + (p.pop || 'All events') + ' (' + pool.n + ' ev)';
        const canvas = document.createElement('canvas');
        cell.appendChild(cap); cell.appendChild(canvas); host.appendChild(cell);
        const sz = p.each ? (task.smallSize || 300) : size;
        const L = FM.plot.layout(sz, sz, { dpr: 1, square: true });
        FM.plot.render(canvas, L, { sample: pool.sample, idx: pool.idx, x: p.x, y: p.y || null, xSpec: xs, ySpec: ys,
          xLabel: ws.paramLabel(p.x), yLabel: p.y ? ws.paramLabel(p.y) : '', cmap: 'turbo' });
        const ctx = canvas.getContext('2d');
        if (p.grid !== false && p.y) drawGrid(ctx, L, xs, ys);
        const show = (p.show || []).map(n => ws.gate(ids[n])).filter(Boolean);
        if (show.length) FM.plot.drawGates(ctx, L, show.map(g => ({ gate: g, outline: FM.plot.gateOutline(g, L, xs, ys) })), {});
        if (show.length && which && which.length === 1) {
          const s = ws.samples.find(x => x.name === which[0]);
          cap.textContent += ' | ' + show.map(g => g.name + ' ' + ws.pct(s, g.id).toFixed(2) + '%').join(', ');
        }
      }
    }
    out(Object.assign(res, { plots: task.plots.length }));
  }

  /** The first `n` events of each file as FlowMate holds them (after the active compensation). */
  async function runDump(task) {
    const { samples, errors } = await loadSamples(task.dir, task.fcs, task.names);
    const ws = new FM.Workspace();
    ws.addSamples(samples);
    if (task.comp) ws.setComp(task.comp);
    const o = {};
    ws.samples.forEach(s => {
      const params = task.params || s.params.map(p => p.name);
      o[s.name] = { n: s.n, spill: s.spill, params, rows: Array.from({ length: Math.min(task.n || 2000, s.n) }, (_, i) => params.map(p => s.data[p][i])) };
    });
    out({ type: 'dump', comp: ws.doc.comp.active, loadErrors: errors, samples: o });
  }

  async function main() {
    try {
      const task = await (await fetch(Q.get('task'))).json();
      if (task.type === 'js') out({ type: 'js', value: new Function('FM', task.code)(FM) });
      else if (task.type === 'dump') await runDump(task);
      else if (task.type === 'wsp') await runWsp(task);
      else if (task.type === 'gate') out((await runGate(task)).res);
      else if (task.type === 'plot') await runPlot(task);
      else throw new Error('unknown task type ' + task.type);
      done('DONE');
    } catch (e) {
      out({ error: String(e && e.stack || e) });
      done('ERROR');
    }
  }
  window.addEventListener('load', () => setTimeout(main, 10));
})();
