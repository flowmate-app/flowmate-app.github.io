/* FlowMate brand: the tile and wordmark (drawn by the shared BenchMate generator,
 * brand/dist/benchmate-brand.js, so the app always matches the family), and the animated flow
 * cell on the Workspace's empty state.
 *
 * The identity comes from what a flow cytometer does: sheath fluid focuses cells into a
 * single-file stream that crosses a laser beam, where each one flashes. Brand colour is the
 * 405 nm → 488 nm gradient (violet → cyan); the interface itself keeps the single accent.
 */
(function (FM) {
  'use strict';

  /** The FlowMate tile. */
  function mark(size) {
    const span = FM.dom.h('span.brand-mark', { 'aria-hidden': 'true' });
    span.innerHTML = BM.brand.icon('flowmate', size || 26);
    return span;
  }

  /** "flowmate": the first half follows the theme's brand colour, "mate" the ink. */
  function wordmark(height) {
    const span = FM.dom.h('span.brand-name', { role: 'img', 'aria-label': 'FlowMate' });
    span.innerHTML = BM.brand.wordmark('flowmate', { height: height || 19, prefixFill: 'var(--brand-wm)', mateFill: 'var(--ink)' });
    return span;
  }

  /** Tile + wordmark, for the Workspace's welcome. */
  function lockup(height) {
    const span = FM.dom.h('span.brand-lockup', { role: 'img', 'aria-label': 'FlowMate' });
    span.innerHTML = BM.brand.lockup('flowmate', { height: height || 56, byline: false, prefixFill: 'var(--brand-wm)', mateFill: 'var(--ink)' });
    return span;
  }

  // ------------------------------------------------------------ flow cell
  /** rgba() of a hex or rgb() colour, so gradients fade the colour itself (not through black). */
  function withAlpha(c, a) {
    c = String(c).trim();
    let r, g, b;
    const m = /^#([0-9a-f]{6})$/i.exec(c);
    if (m) { const n = parseInt(m[1], 16); r = n >> 16; g = (n >> 8) & 255; b = n & 255; }
    else { const k = /rgba?\(([^)]+)\)/.exec(c); if (!k) return c; [r, g, b] = k[1].split(',').map(Number); }
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  /**
   * Animate a flow cell in `canvas`: particles focused into single file, flashing as they
   * cross the laser; about a third light up (fluorescent), the rest only scatter.
   * Returns a stop() function. Honours prefers-reduced-motion with a still frame.
   */
  function flowCell(canvas, opts) {
    opts = opts || {};
    const subtle = !!opts.subtle;
    const ctx = canvas.getContext('2d');
    const cs = getComputedStyle(document.documentElement);
    const col = n => cs.getPropertyValue(n).trim();
    const C = { a: col('--brand-a'), b: col('--brand-b'), ink: col('--ink-2'), line: col('--line'), faint: col('--faint') };
    let W = 0, H = 0, dpr = 1;
    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      W = canvas.clientWidth || 600; H = canvas.clientHeight || 120;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const rnd = FM.synth ? FM.synth.rng(20260917) : Math.random;
    const P = [], sparks = [];
    const spawn = (x) => P.push({ x: x != null ? x : -4, y0: (rnd() * 2 - 1) * 0.42, r: 1.6 + rnd() * 1.8, fl: rnd() < 0.36, lit: 0, jit: (rnd() * 2 - 1) });
    for (let i = 0; i < (subtle ? 14 : 46); i++) spawn(rnd() * 1.0 * (W || 600));
    const xF = () => W * 0.46, xL = () => W * 0.7, cy = () => H / 2;
    const yAt = (p) => cy() + p.y0 * H * (1 - 0.965 * smooth(0, xF(), p.x)) + p.jit * 0.6;

    function step(dt) {
      const base = W / (subtle ? 11 : 7.5);
      P.forEach(p => {
        const before = p.x;
        p.x += base * (0.55 + 1.9 * smooth(0, xF(), p.x)) * dt;
        if (before < xL() && p.x >= xL()) {
          p.lit = 1;
          const n = subtle ? 2 : 3 + Math.floor(rnd() * 3);
          for (let k = 0; k < n; k++) {
            const ang = (rnd() * 2 - 1) * (k === 0 ? 0.25 : 1.4);
            sparks.push({ x: xL(), y: yAt(p), vx: Math.cos(ang) * 70, vy: Math.sin(ang) * 70, life: 1, c: p.fl ? C.b : C.a });
          }
        }
        if (p.lit > 0) p.lit = Math.max(0, p.lit - dt * 1.6);
      });
      for (let i = P.length - 1; i >= 0; i--) if (P[i].x > W + 10) { P.splice(i, 1); spawn(); }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt * 2.2;
        if (s.life <= 0) sparks.splice(i, 1);
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      if (subtle) ctx.globalAlpha = 0.7;
      // sheath walls: a funnel narrowing into the interrogation channel
      ctx.strokeStyle = C.line; ctx.lineWidth = 1.2;
      [-1, 1].forEach(sg => {
        ctx.beginPath();
        for (let x = 0; x <= W; x += 6) {
          const y = cy() + sg * (H * 0.47 * (1 - 0.8 * smooth(0, xF(), x)) + 4);
          x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      });
      // laser beam
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, withAlpha(C.b, 0)); g.addColorStop(0.5, C.b); g.addColorStop(1, withAlpha(C.b, 0));
      ctx.save();
      ctx.globalAlpha = 0.16; ctx.fillStyle = C.b; ctx.fillRect(xL() - 7, 0, 14, H);
      ctx.globalAlpha = 0.9; ctx.strokeStyle = g; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(xL(), 0); ctx.lineTo(xL(), H); ctx.stroke();
      ctx.restore();
      // particles: neutral until they cross the beam; fluorescent ones keep a glow
      P.forEach(p => {
        const y = yAt(p);
        const after = p.x >= xL();
        ctx.beginPath(); ctx.arc(p.x, y, p.r, 0, Math.PI * 2);
        if (after && p.fl) { ctx.fillStyle = C.b; ctx.globalAlpha = 0.95; }
        else { ctx.fillStyle = after ? C.a : C.ink; ctx.globalAlpha = after ? 0.6 : 0.42; }
        ctx.fill();
        if (p.lit > 0) {
          const rg = ctx.createRadialGradient(p.x, y, 0, p.x, y, 16);
          const hc = p.fl ? C.b : C.a;
          rg.addColorStop(0, withAlpha(hc, 0.9)); rg.addColorStop(1, withAlpha(hc, 0));
          ctx.globalAlpha = p.lit * 0.85; ctx.fillStyle = rg;
          ctx.beginPath(); ctx.arc(p.x, y, 16, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      });
      sparks.forEach(s => {
        ctx.globalAlpha = Math.max(0, s.life) * 0.8; ctx.fillStyle = s.c;
        ctx.beginPath(); ctx.arc(s.x, s.y, 1.3, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      for (let i = 0; i < 90; i++) step(1 / 30);
      draw();
      return () => {};
    }
    let raf = 0, last = performance.now(), stopped = false;
    const loop = (t) => {
      if (stopped || !canvas.isConnected) return;
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      if (canvas.clientWidth !== W) resize();
      step(dt); draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }

  function motionOK() { return !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }

  /** A small, quiet flow cell for empty states and progress; animates once attached. */
  function miniCell(cls) {
    const c = FM.dom.h('canvas.mini-cell' + (cls ? '.' + cls : ''), { 'aria-hidden': 'true' });
    FM.dom.frame(() => { if (c.isConnected) flowCell(c, { subtle: true }); });
    return c;
  }

  /**
   * One laser pass across a rectangle of `host` (px, relative to it): used when a gate is
   * created or accepted, as if the population had just been measured.
   */
  function sweep(host, rect) {
    if (!motionOK() || !host || !rect) return;
    const el = FM.dom.h('div.laser-sweep', { 'aria-hidden': 'true' });
    Object.assign(el.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' });
    const beam = FM.dom.h('div.laser-beam');
    el.appendChild(beam);
    host.appendChild(el);
    const a = beam.animate([{ transform: 'translateX(0)', opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.85 },
      { transform: 'translateX(' + rect.w + 'px)', opacity: 0 }], { duration: 750, easing: 'cubic-bezier(.45,0,.25,1)' });
    a.onfinish = () => el.remove();
  }

  FM.brand = { mark, wordmark, lockup, flowCell, miniCell, sweep, motionOK };
})(FM);
