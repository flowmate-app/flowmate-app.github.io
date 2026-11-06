/* Small DOM toolkit: element builder, icons, menus, modals, toasts, tooltips, file I/O. */
(function (FM) {
  'use strict';

  /** h('div.cls#id', {attrs, on: {click}}, children...) */
  function h(sel, attrs, ...kids) {
    const m = /^([a-z0-9-]+)?((?:[.#][^.#]+)*)$/i.exec(sel) || [];
    const el = document.createElement(m[1] || 'div');
    (m[2] || '').replace(/([.#])([^.#]+)/g, (_, k, v) => { if (k === '.') el.classList.add(v); else el.id = v; });
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    if (attrs) setAttrs(el, attrs);
    append(el, kids);
    return el;
  }

  function setAttrs(el, attrs) {
    Object.entries(attrs).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'on') Object.entries(v).forEach(([ev, fn]) => el.addEventListener(ev, fn));
      else if (k === 'style' && typeof v === 'object') {
        // custom properties are ignored by Object.assign(el.style, …): they need setProperty
        Object.entries(v).forEach(([p, val]) => { if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val; });
      }
      else if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach(c => el.classList.add(c));
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && k !== 'list' && k !== 'form' && typeof v !== 'string') el[k] = v;
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
  }

  function append(el, kids) {
    kids.flat(Infinity).forEach(k => {
      if (k == null || k === false) return;
      el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    });
    return el;
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  const SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (v == null) return;
      if (k === 'on') Object.entries(v).forEach(([ev, fn]) => el.addEventListener(ev, fn));
      else el.setAttribute(k, v);
    });
    kids.flat(Infinity).forEach(k => { if (k != null && k !== false) el.appendChild(k instanceof Node ? k : document.createTextNode(String(k))); });
    return el;
  }

  // ------------------------------------------------------------------ icons
  const ICONS = {
    pointer: 'M5 3l13 8-6 1.5L9 19z',
    polygon: 'M12 3l8 6-3 11H7L4 9z',
    rect: 'M4 6h16v12H4z',
    ellipse: 'M12 18.5c4.97 0 9-2.91 9-6.5s-4.03-6.5-9-6.5-9 2.91-9 6.5 4.03 6.5 9 6.5z',
    quad: 'M12 3v18M3 12h18M5 5h4v4H5z',
    wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5',
    fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
    range: 'M4 5v14M20 5v14M4 12h16M8 9l-4 3 4 3M16 9l4 3-4 3',
    undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
    redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',
    sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
    download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
    upload: 'M12 21V9M7 14l5-5 5 5M4 3h16',
    folder: 'M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z',
    file: 'M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9zM14 3v6h6',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    expand: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
    shrink: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    left: 'M15 18l-6-6 6-6',
    right: 'M9 18l6-6-6-6',
    down: 'M6 9l6 6 6-6',
    up: 'M18 15l-6-6-6 6',
    gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    check: 'M5 12l5 5L20 7',
    x: 'M6 6l12 12M18 6L6 18',
    eye: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
    eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0112 5c7 0 11 7 11 7a18 18 0 01-3.2 4M6.6 6.6A18 18 0 001 12s4 7 11 7a10 10 0 005.4-1.6M9.9 9.9a3 3 0 004.2 4.2',
    alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
    info: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01',
    chat: 'M4 5h16v11H9l-5 4V5zM8 9.5h8M8 12.5h5',
    okCircle: 'M22 11.1V12a10 10 0 11-5.9-9.1M22 4L12 14l-3-3',
    grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    flask: 'M9 3h6M10 3v6L4 19a1.5 1.5 0 001.3 2h13.4a1.5 1.5 0 001.3-2L14 9V3',
    target: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 18a6 6 0 100-12 6 6 0 000 12zM12 14a2 2 0 100-4 2 2 0 000 4z',
    chart: 'M3 3v18h18M7 16v-5M12 16V7M17 16v-8',
    sigma: 'M18 4H6l6 8-6 8h12',
    help: 'M12 22a10 10 0 100-20 10 10 0 000 20zM9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
    edit: 'M11 4H4v16h16v-7M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z',
    enter: 'M9 10l-5 5 5 5M20 4v7a4 4 0 01-4 4H4',
    hist: 'M3 20h18M5 20V14M9 20V8M13 20V5M17 20V11M21 20v-4',
    layers: 'M12 2l10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5',
    strategy: 'M2 6h6v6H2zM16 12h6v6h-6zM8 9h3a2 2 0 012 2v4h1.5M12.5 13l2 2-2 2',
    table: 'M3 5h18v14H3zM3 10h18M3 14.5h18M9 10v9',
    beaker: 'M4.5 3h15M6 3v16a2 2 0 002 2h8a2 2 0 002-2V3M6 14h12',
    save: 'M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM17 21v-8H7v8M7 3v5h8',
    mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
    ban: 'M12 22a10 10 0 100-20 10 10 0 000 20zM4.9 4.9l14.2 14.2',
    spectrum: 'M2 20h20M3 20c4 0 5-14 8-14s4 14 8 14M17 3v17',
    eyeoff: 'M1 12s4-7 11-7c2 0 3.8.6 5.3 1.4M23 12s-4 7-11 7c-2 0-3.8-.6-5.3-1.4M3 3l18 18',
  };

  function icon(name, cls) {
    const path = ICONS[name] || ICONS.info;
    const el = s('svg', { viewBox: '0 0 24 24', fill: name === 'more' ? 'none' : 'none', stroke: 'currentColor', 'stroke-width': name === 'more' ? 3 : 1.8,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: cls || null });
    el.appendChild(s('path', { d: path }));
    return el;
  }

  // ----------------------------------------------------------------- toasts
  function toast(msg, opts) {
    opts = opts || {};
    let root = document.getElementById('toasts');
    if (!root) { root = h('div#toasts'); document.body.appendChild(root); }
    const t = h('div.toast' + (opts.level === 'crit' ? '.crit' : ''), { role: 'status' }, h('span', msg));
    if (opts.action) t.appendChild(h('button', { on: { click: () => { opts.action.fn(); t.remove(); } } }, opts.action.label));
    const ms = opts.ms || (opts.action ? 6000 : 2600);
    t.style.setProperty('--ms', ms + 'ms');
    root.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  // ------------------------------------------------------------ popover/menu
  let openPop = null;
  function closePop() { if (openPop) { const p = openPop; openPop = null; p.el.remove(); if (p.onClose) p.onClose(); } }

  /** Show a floating element anchored to `anchor` (element or {x,y}). */
  function popover(anchor, content, opts) {
    closePop();
    opts = opts || {};
    const el = h('div.pop', { role: opts.role || 'dialog' }, content);
    if (opts.width) el.style.width = opts.width + 'px';
    document.body.appendChild(el);
    const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0 };
    const pw = el.offsetWidth, ph = el.offsetHeight;
    let x = opts.align === 'right' ? r.right - pw : r.left;
    let y = r.bottom + 4;
    if (x + pw > innerWidth - 8) x = innerWidth - pw - 8;
    if (y + ph > innerHeight - 8) y = Math.max(8, r.top - ph - 4);
    el.style.left = Math.max(8, x) + 'px';
    el.style.top = y + 'px';
    openPop = { el, onClose: opts.onClose };
    setTimeout(() => {
      const away = (e) => {
        if (!openPop || openPop.el !== el) { document.removeEventListener('mousedown', away, true); return; }
        if (!el.contains(e.target) && !(anchor instanceof Element && anchor.contains(e.target))) { closePop(); document.removeEventListener('mousedown', away, true); }
      };
      document.addEventListener('mousedown', away, true);
    }, 0);
    const first = el.querySelector('input,select,textarea,button');
    if (first && opts.focus !== false) first.focus();
    return el;
  }

  /** items: [{label, icon, hint, danger, disabled, fn} | 'sep' | {heading}] */
  function menu(anchor, items, opts) {
    const list = h('div', { role: 'menu' });
    items.forEach(it => {
      if (it === 'sep') { list.appendChild(h('div.menu-sep')); return; }
      if (it.heading) { list.appendChild(h('div.menu-label.eyebrow', it.heading)); return; }
      const b = h('button.menu-item' + (it.danger ? '.danger' : ''), {
        role: 'menuitem', disabled: !!it.disabled,
        on: { click: () => { closePop(); it.fn && it.fn(); } },
      }, it.icon ? icon(it.icon) : null, h('span', it.label), it.hint ? h('span.hint', it.hint) : null);
      if (it.disabled) b.style.opacity = .45;
      list.appendChild(b);
    });
    return popover(anchor, list, Object.assign({ role: 'menu', focus: false }, opts));
  }

  // ------------------------------------------------------------------ modal
  function modal(opts) {
    closePop();
    const back = h('div.modal-back');
    const close = (val) => { back.remove(); document.removeEventListener('keydown', onKey, true); if (opts.onClose) opts.onClose(val); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && opts.onEnter && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); opts.onEnter(); }
    };
    const box = h('div.modal' + (opts.wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true' },
      h('div.modal-head', h('h2', opts.title), opts.subtitle ? h('p', opts.subtitle) : null),
      h('div.modal-body', opts.body),
      opts.buttons ? h('div.modal-foot', opts.buttons.map(b => h('button.btn' + (b.primary ? '.primary' : '') + (b.danger ? '.danger' : ''),
        { on: { click: () => { const r = b.fn ? b.fn() : undefined; if (r !== false) close(b.value); } } }, b.label))) : null);
    back.appendChild(box);
    back.addEventListener('mousedown', e => { if (e.target === back) close(null); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    const f = box.querySelector('.modal-body input, .modal-body select, .modal-body textarea');
    setTimeout(() => (f || box.querySelector('.btn.primary') || box).focus && (f || box.querySelector('.btn.primary')) && (f || box.querySelector('.btn.primary')).focus(), 20);
    return { close, el: box };
  }

  function confirm(title, text, okLabel, danger) {
    return new Promise(res => {
      modal({
        title, body: h('p', { style: { margin: 0, color: 'var(--ink-2)' } }, text),
        buttons: [{ label: 'Cancel', value: false }, { label: okLabel || 'OK', primary: !danger, danger, value: true }],
        onClose: v => res(!!v),
      });
    });
  }

  // ---------------------------------------------------------------- tooltip
  let tipEl = null;
  function initTooltips() {
    document.addEventListener('mouseover', e => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t) { if (tipEl) { tipEl.remove(); tipEl = null; } return; }
      if (!tipEl) { tipEl = h('div.tip'); document.body.appendChild(tipEl); }
      tipEl.textContent = t.dataset.tip;
      const r = t.getBoundingClientRect();
      const w = tipEl.offsetWidth;
      tipEl.style.left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + 'px';
      const below = r.bottom + 6 + tipEl.offsetHeight < innerHeight;
      tipEl.style.top = (below ? r.bottom + 6 : r.top - tipEl.offsetHeight - 6) + 'px';
    });
    document.addEventListener('mousedown', () => { if (tipEl) { tipEl.remove(); tipEl = null; } }, true);
  }

  // --------------------------------------------------------------- file I/O
  function download(filename, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  function pickFiles(opts) {
    return new Promise(res => {
      const inp = h('input', { type: 'file', multiple: !!opts.multiple, accept: opts.accept || null });
      if (opts.directory) { inp.webkitdirectory = true; inp.setAttribute('webkitdirectory', ''); }
      inp.addEventListener('change', () => res(Array.from(inp.files || [])));
      inp.click();
    });
  }

  /** Collect files from a drop event, descending into dropped folders. */
  async function filesFromDrop(dt) {
    const out = [];
    const items = dt.items ? Array.from(dt.items) : [];
    const entries = items.map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (!entries.length) return Array.from(dt.files || []);
    const walk = async (entry) => {
      if (entry.isFile) {
        await new Promise(r => entry.file(f => { out.push(f); r(); }, r));
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise(r => reader.readEntries(r, () => r([])));
          for (const e of batch) await walk(e);
        } while (batch.length);
      }
    };
    for (const e of entries) await walk(e);
    return out;
  }

  // ---------------------------------------------------------------- helpers
  function debounce(fn, ms) {
    let t = null;
    const d = function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
    d.flush = function (...a) { clearTimeout(t); fn.apply(this, a); };
    d.cancel = () => clearTimeout(t);
    return d;
  }
  /**
   * Run fn on the next animation frame — or after 50 ms if frames aren't being produced
   * (background tabs, headless test runs), so state never waits on painting.
   */
  function frame(fn) {
    let done = false, r = 0, t = 0;
    const run = () => { if (done) return; done = true; cancelAnimationFrame(r); clearTimeout(t); fn(); };
    r = requestAnimationFrame(run);
    t = setTimeout(run, 50);
    return { cancel() { done = true; cancelAnimationFrame(r); clearTimeout(t); } };
  }

  function rafThrottle(fn) {
    let queued = false, args = null;
    return function (...a) {
      args = a;
      if (queued) return;
      queued = true;
      frame(() => { queued = false; fn.apply(this, args); });
    };
  }

  function fmtPct(v, digits) {
    if (!Number.isFinite(v)) return '—';
    if (v > 0 && v < 0.01) return '<0.01%';
    return v.toFixed(digits != null ? digits : (v < 10 ? 2 : 1)) + '%';
  }
  function fmtCount(n) { return Number.isFinite(n) ? n.toLocaleString('en-US') : '—'; }
  function fmtTime(ms) {
    if (ms == null) return '—';
    const d = new Date(ms);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  /**
   * Drag to reorder: press on an item, move past a few pixels, drop it where it should go. The others
   * mark the drop place (classes drop-before / drop-after, plus sort-x or sort-y for the direction);
   * onMove(from, to) gets the indices. A drag swallows the click that ends it, so a chip that is also
   * a button still reorders. opts.axis: 'x' (a row of chips, the default) or 'y' (a list);
   * opts.handle: a selector — only a press inside it starts a drag (a card whose body is a plot).
   */
  function sortable(els, onMove, opts) {
    const axis = (opts && opts.axis) || 'x';
    els.forEach((el, i) => {
      el.classList.add('sortable', 'sort-' + axis);
      el.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.target.closest('input, select, textarea')) return;
        if (opts && opts.handle && !e.target.closest(opts.handle)) return;
        const x0 = e.clientX, y0 = e.clientY;
        const rects = els.map(x => x.getBoundingClientRect());
        let on = false, to = i;
        const mark = () => els.forEach((x, j) => { x.classList.toggle('drop-before', on && j === to && to < i); x.classList.toggle('drop-after', on && j === to && to > i); });
        const move = ev => {
          if (!on && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
          on = true;
          el.classList.add('dragging');
          el.style.transform = 'translate(' + (axis === 'y' ? 0 : ev.clientX - x0) + 'px,' + (ev.clientY - y0) + 'px)';
          let best = i, bd = Infinity;
          rects.forEach((r, j) => {
            const dx = Math.abs(ev.clientX - (r.left + r.width / 2)), dy = Math.abs(ev.clientY - (r.top + r.height / 2));
            const d = axis === 'y' ? dy : dx + 3 * dy;
            if (d < bd) { bd = d; best = j; }
          });
          to = best; mark();
        };
        const up = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          el.classList.remove('dragging'); el.style.transform = '';
          const was = on; on = false; mark();
          if (!was) return;
          const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };
          window.addEventListener('click', swallow, true);
          setTimeout(() => window.removeEventListener('click', swallow, true), 0);
          if (to !== i) onMove(i, to);
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      });
    });
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  FM.dom = { h, s, clear, append, setAttrs, icon, ICONS, toast, popover, closePop, menu, modal, confirm, initTooltips,
    download, pickFiles, filesFromDrop, debounce, rafThrottle, frame, fmtPct, fmtCount, fmtTime, esc, sortable };
})(FM);
