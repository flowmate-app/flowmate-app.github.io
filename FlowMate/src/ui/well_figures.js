/* Export the plot on the Gate step as figures, one per chosen well, each with its own title.
 *
 * The plot is what is on screen — the plotted population, its axes, its zoom and the gates
 * drawn on it — redrawn for every ticked well, the way that well sees its gates. Panels are
 * drawn light (paper) at 3× for print, as one PNG per well or as one figure laid out in a grid.
 * Titles start as "A1 · IgG1" and are kept for the session, so reopening keeps your edits.
 */
(function (FM) {
  'use strict';
  const { h, icon, clear, toast, modal } = FM.dom;
  const W = () => FM.ws;
  const P = () => FM.plot;

  const SIZES = { small: 280, medium: 400, large: 560 };
  const SCALE = 3;
  const titles = new Map();      // sample key → title typed this session

  function defaultTitle(s) {
    const g = W().groupOf(s.key);
    return (s.well || String(s.name).replace(/\.fcs$/i, '')) + (g ? ' · ' + g.name : '');
  }
  const titleOf = s => (titles.has(s.key) ? titles.get(s.key) : defaultTitle(s));

  /** One panel: a title band over the plot, white, at SCALE×. Returns a canvas. */
  function panel(s, v, o) {
    const ws = W(), Pl = P();
    const w = SIZES[o.size] || SIZES.medium;
    const plotH = Math.round(v.y ? w * 0.92 : w * 0.7);
    const title = o.titles !== false ? String(o.title != null ? o.title : titleOf(s)).trim() : '';
    const th = title ? Math.round(w * 0.075) + 10 : 0;
    const out = document.createElement('canvas');
    out.width = Math.round(w * SCALE); out.height = Math.round((plotH + th) * SCALE);
    Pl.withLightTheme(() => {
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
      ctx.scale(SCALE, SCALE);
      if (title) {
        ctx.fillStyle = '#141722';
        ctx.font = '600 ' + Math.round(w * 0.045 + 3) + 'px "IBM Plex Sans", "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(fit(ctx, title, w - 16), w / 2, th / 2 + 2);
      }
      const L = Pl.layout(w, plotH, { square: !!v.y, dpr: SCALE, win: v.win, dense: w < 380 });
      const xSpec = ws.viewScale(v.popId, v.x), ySpec = v.y ? ws.viewScale(v.popId, v.y) : null;
      const tmp = document.createElement('canvas');
      Pl.render(tmp, L, { sample: s, idx: ws.indices(s, v.popId), x: v.x, y: v.y, xSpec, ySpec,
        xLabel: ws.paramLabel(v.x), yLabel: v.y ? ws.paramLabel(v.y) : '', cmap: FM.ui.cmap, dotScale: FM.ui.dotScale });
      if (o.gates !== false) {
        const items = ws.children(v.popId, s.key).filter(g => Pl.gateFits(g, v.x, v.y)).map(g => ws.gateFor(g, s.key))
          .map(g => ({ gate: g, outline: Pl.gateOutline(g, L, xSpec, ySpec), pct: ws.pct(s, g.id), count: o.counts !== false ? ws.count(s, g.id) : undefined, selected: false }));
        Pl.drawGates(tmp.getContext('2d'), L, items, o.labels === false ? { labels: false } : {});
      }
      ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, 0, th, w, plotH);
    });
    return out;
  }

  /** Shorten a title with an ellipsis until it fits. */
  function fit(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  }

  /** Many panels in one image: a grid, an optional figure title on top. */
  function grid(panels, o) {
    const n = panels.length;
    const cols = Math.max(1, Math.min(n, o.cols || Math.ceil(Math.sqrt(n * 1.6))));
    const rows = Math.ceil(n / cols);
    const pw = panels[0].width, ph = Math.max(...panels.map(p => p.height));
    const gap = Math.round(14 * SCALE);
    const head = o.figureTitle ? Math.round(38 * SCALE) : 0;
    const out = document.createElement('canvas');
    out.width = cols * pw + (cols + 1) * gap;
    out.height = head + rows * ph + (rows + 1) * gap;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
    if (head) {
      ctx.fillStyle = '#141722';
      ctx.font = '700 ' + Math.round(19 * SCALE) + 'px "IBM Plex Sans", "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(o.figureTitle, gap, gap + head / 2);
    }
    panels.forEach((p, i) => ctx.drawImage(p, gap + (i % cols) * (pw + gap), head + gap + Math.floor(i / cols) * (ph + gap)));
    return out;
  }

  const toBlob = cv => new Promise(res => cv.toBlob(res, 'image/png'));
  const fileName = t => (String(t).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim() || 'plot');

  /**
   * Build the images. v: { popId, x, y, win }; keys: wells, in order.
   * → [{ name, canvas }] — one per well, or a single figure.
   */
  function build(v, keys, o) {
    const ws = W();
    const list = keys.map(k => ws.sample(k)).filter(Boolean);
    const panels = list.map(s => ({ s, cv: panel(s, v, Object.assign({}, o, { title: o.titleFor ? o.titleFor(s) : titleOf(s) })) }));
    if (o.arrange === 'grid') return [{ name: fileName(o.figureTitle || ws.doc.name + ' figure') + '.png', canvas: grid(panels.map(p => p.cv), o) }];
    const used = new Set();
    return panels.map(({ s, cv }) => {
      let base = fileName(o.titleFor ? o.titleFor(s) : titleOf(s) || s.well || s.name), name = base, k = 2;
      while (used.has(name.toLowerCase())) name = base + ' (' + (k++) + ')';
      used.add(name.toLowerCase());
      return { name: name + '.png', canvas: cv };
    });
  }

  async function save(out) {
    for (let i = 0; i < out.length; i++) {
      if (i) await new Promise(r => setTimeout(r, 220));     // browsers drop downloads fired in one burst
      const b = await toBlob(out[i].canvas);
      if (!b) { toast('Could not build ' + out[i].name, { level: 'crit' }); return; }
      FM.dom.download(out[i].name, b);
    }
  }

  // ------------------------------------------------------------------ dialog
  /** v: the plot on screen { popId, x, y, win }; picked: wells to start ticked. */
  function open(v, picked) {
    const ws = W();
    const order = [];
    const seen = new Set();
    ws.doc.groups.forEach(g => ws.samplesIn(g.id).forEach(s => { order.push(s); seen.add(s.key); }));
    ws.samples.forEach(s => { if (!seen.has(s.key)) order.push(s); });
    const on = new Set((picked && picked.length ? picked : [FM.currentSample() && FM.currentSample().key]).filter(k => k && ws.sample(k)));
    const o = { arrange: on.size > 1 ? 'grid' : 'each', size: 'medium', titles: true, gates: true, labels: true, counts: true, figureTitle: '' };

    const list = h('div.wf-list');
    const countEl = h('span.muted.small');
    let exportBtn = null;     // the dialog's Export button, relabelled with the count
    const prevBox = h('div.wf-prev');
    const drawPrev = FM.dom.debounce(() => {
      clear(prevBox);
      const first = order.find(s => on.has(s.key));
      if (!first) { prevBox.appendChild(h('div.muted.small.pad', 'Tick a well to see it here.')); return; }
      const cv = panel(first, v, Object.assign({}, o, { size: 'small' }));
      cv.style.width = '100%'; cv.style.height = 'auto';
      prevBox.append(cv, h('div.muted.small', 'Preview · ' + (first.well || first.name)));
    }, 120);
    const refresh = () => {
      const n = on.size;
      countEl.textContent = n + ' of ' + order.length + ' wells';
      if (exportBtn) {
        exportBtn.textContent = o.arrange === 'grid' ? 'Export one figure (' + n + ' plot' + (n === 1 ? '' : 's') + ')' : 'Export ' + n + ' image' + (n === 1 ? '' : 's');
        exportBtn.disabled = !n;
      }
      gridOpts.classList.toggle('hidden', o.arrange !== 'grid');
      drawPrev();
    };
    const row = s => {
      const g = ws.groupOf(s.key);
      const box = h('input', { type: 'checkbox', checked: on.has(s.key), 'aria-label': 'Export ' + (s.well || s.name),
        on: { change: e => { if (e.target.checked) on.add(s.key); else on.delete(s.key); r.classList.toggle('off', !e.target.checked); refresh(); } } });
      const inp = h('input.input.sm.wf-title', { value: titleOf(s), placeholder: 'No title', 'aria-label': 'Title for ' + (s.well || s.name),
        on: { input: e => { titles.set(s.key, e.target.value); drawPrev(); } } });
      const r = h('div.wf-row' + (on.has(s.key) ? '' : '.off'),
        h('label.wf-pick', box, h('span.mono.wf-well', s.well || String(s.name).replace(/\.fcs$/i, '')),
          g ? h('span.swatch', { style: { background: g.color }, 'data-tip': g.name }) : h('span.swatch.none')),
        inp);
      return r;
    };
    order.forEach(s => list.appendChild(row(s)));

    const setAll = keys => {
      on.clear(); keys.forEach(k => on.add(k));
      list.querySelectorAll('.wf-row').forEach((r, i) => { const s = order[i]; const c = on.has(s.key); r.querySelector('input[type=checkbox]').checked = c; r.classList.toggle('off', !c); });
      refresh();
    };
    const quick = h('div.wf-quick',
      h('span.muted.small', 'Tick'),
      h('button.btn.ghost.sm', { on: { click: () => setAll(order.map(s => s.key)) } }, 'All'),
      ws.doc.groups.filter(g => ws.samplesIn(g.id).length).map(g => h('button.btn.ghost.sm', { on: { click: () => setAll(ws.samplesIn(g.id).map(s => s.key)) } },
        h('span.swatch', { style: { background: g.color } }), g.name)),
      h('button.btn.ghost.sm', { on: { click: () => setAll([]) } }, 'None'),
      h('span.grow'),
      h('button.btn.ghost.sm', { 'data-tip': 'Put every title back to well · condition', on: { click: () => {
        titles.clear();
        list.querySelectorAll('.wf-title').forEach((inp, i) => { inp.value = defaultTitle(order[i]); });
        drawPrev();
      } } }, 'Reset titles'));

    const seg = (key, opts) => h('div.seg.sm', opts.map(([val, label, tip]) => {
      const b = h('button' + (o[key] === val ? '.on' : ''), { 'data-tip': tip || null, on: { click: () => {
        o[key] = val; b.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); refresh();
      } } }, label);
      return b;
    }));
    const check = (key, label) => h('label.check', h('input', { type: 'checkbox', checked: o[key] !== false, on: { change: e => { o[key] = e.target.checked; drawPrev(); } } }), h('span', label));
    const figTitle = h('input.input.sm', { placeholder: 'Figure title (optional)', on: { input: e => { o.figureTitle = e.target.value; } } });
    const gridOpts = h('div.wf-gridopts', figTitle);
    const options = h('div.wf-opts',
      h('div.field', h('label', 'Save as'), seg('arrange', [['each', 'One image per well', 'A PNG file for every ticked well'], ['grid', 'One figure', 'All ticked wells side by side in one PNG']])),
      gridOpts,
      h('div.field', h('label', 'Size'), seg('size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])),
      h('div.wf-checks', check('titles', 'Titles'), check('gates', 'Gates'), check('labels', 'Gate % labels'), check('counts', 'Event counts')));

    const what = ws.popName(v.popId) + ' · ' + v.x + (v.y ? ' × ' + v.y : ' histogram');
    const doExport = () => {
      const keys = order.filter(s => on.has(s.key)).map(s => s.key);
      if (!keys.length) { toast('Tick at least one well', { level: 'crit' }); return false; }
      const out = build(v, keys, o);
      FM.lastFigureExport = out;    // for the UI self-test
      save(out).then(() => toast(out.length === 1 ? 'Saved ' + out[0].name : 'Saved ' + out.length + ' images — your browser may ask before saving several files'));
      return true;
    };
    const m = modal({
      title: 'Export plots as figures',
      subtitle: what + ' — the plot on screen, redrawn for every well you tick, each with its own title. Saved as PNG at print resolution.',
      wide: true,
      body: h('div.wf-body',
        h('div.wf-left', quick, h('div.scroll.wf-scroll', list), countEl),
        h('div.wf-right', options, prevBox)),
      buttons: [{ label: 'Cancel' }, { label: 'Export', primary: true, fn: doExport }],
    });
    exportBtn = m.el.querySelector('.modal-foot .btn.primary');
    refresh();
  }

  FM.wellFigures = { open, build, panel, titles, defaultTitle };
})(FM);
