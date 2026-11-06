/* UI test: the resize frame on a selected gate — side handles change only the width or only the
 * height, corners change both, Shift on a corner keeps the proportions. Polygon, ellipse and
 * rectangle. Run with: bash tests/run_ui.sh ui_resize.js */
(function () {
  'use strict';
  const out = [];
  let pass = 0, fail = 0;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
  const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, (m || '') + ': expected ' + b + ', got ' + a);
  async function step(name, fn) {
    try { await fn(); pass++; out.push('PASS ' + name); }
    catch (e) { fail++; out.push('FAIL ' + name + '\n     ' + (e && e.message)); }
  }
  const ws = () => FM.ws;
  const pv = () => FM.views.gate._plotView();
  function ptr(type, x, y, extra) {
    pv().overCv.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0,
      buttons: type === 'pointerup' ? 0 : 1, pointerId: 7, pointerType: 'mouse', isPrimary: true }, extra || {})));
  }
  /** client px of a canvas px point */
  function client(p) { const r = pv().overCv.getBoundingClientRect(); return [r.left + p[0], r.top + p[1]]; }
  /** The selected gate's frame box (canvas px) and a handle by id. */
  const frame = () => pv().frame;
  const handle = id => frame().handles.find(hd => hd.f.id === id);
  async function drag(id, dx, dy, extra) {
    const [x, y] = client(handle(id).p);
    ptr('pointerdown', x, y, extra);
    ptr('pointermove', x + dx / 2, y + dy / 2, extra);
    ptr('pointermove', x + dx, y + dy, extra);
    ptr('pointerup', x + dx, y + dy, extra);
    await wait(250);
  }
  async function select(id) { FM.setUI({ gateId: id, tool: 'select' }); await wait(250); assert(frame(), 'a frame around the selected gate'); }
  const size = () => { const b = frame().inner; return [b[2] - b[0], b[3] - b[1]]; };

  async function run() {
    await wait(300);
    FM.loadDemo();
    FM.ui.gateLayout = 'single';
    FM.go('gate');
    await wait(300);
    const x = FM.views.gate._plotView().model.x, y = FM.views.gate._plotView().model.y;
    const xs = ws().scaleSpec(x), ys = ws().scaleSpec(y);
    const sx = FM.transforms.makeScale(xs), sy = FM.transforms.makeScale(ys);

    let polyId, ellId, rectId;
    await step('polygon: side handles change only the width, or only the height', async () => {
      polyId = ws().addGate({ name: 'Poly', parent: null, type: 'polygon', x, y, xScale: xs, yScale: ys,
        verts: [[0.3, 0.3], [0.6, 0.32], [0.55, 0.6], [0.35, 0.55]].map(([a, b]) => [sx.inv(a), sy.inv(b)]) });
      await select(polyId);
      assert(frame().handles.length === 8, '8 handles');
      const [w0, h0] = size();
      await drag('r', 40, 0);
      const [w1, h1] = size();
      near(w1, w0 + 40, 1.5, 'width grows by the drag');
      near(h1, h0, 0.5, 'height unchanged');
      await drag('t', 0, -30);
      const [w2, h2] = size();
      near(w2, w1, 0.5, 'width unchanged');
      near(h2, h1 + 30, 1.5, 'height grows by the drag');
      assert(ws().undoLabel().startsWith('Adjust'), 'one undo step per drag: ' + ws().undoLabel());
    });

    await step('polygon: a corner changes both; Shift keeps the proportions', async () => {
      const [w0, h0] = size();
      await drag('br', -30, 12);
      const [w1, h1] = size();
      near(w1, w0 - 30, 1.5, 'width'); near(h1, h0 + 12, 1.5, 'height');
      const r = w1 / h1;
      await drag('tl', 25, 0, { shiftKey: true });
      const [w2, h2] = size();
      near(w2 / h2, r, 0.02, 'aspect ratio kept with Shift');
      assert(w2 < w1 - 15, 'and it shrank');
    });

    await step('ellipse: width-only resize stretches it; it stays an ellipse with the same height', async () => {
      ellId = ws().addGate({ name: 'Oval', parent: null, type: 'ellipse', x, y, xScale: xs, yScale: ys,
        ellipse: { cx: sx.inv(0.5), cy: sy.inv(0.5), rx: 0.1, ry: 0.06, angle: 0 } });
      await select(ellId);
      const [w0, h0] = size();
      await drag('l', -50, 0);
      const [w1, h1] = size();
      near(w1, w0 + 50, 2, 'width'); near(h1, h0, 1, 'height');
      const e = ws().gate(ellId).ellipse;
      near(e.ry, 0.06, 1e-6, 'ry unchanged'); near(Math.abs(Math.sin(e.angle)), 0, 1e-6, 'not rotated');
      near(e.rx / 0.1, w1 / w0, 0.03, 'rx scaled with the width');
    });

    await step('ellipse: a rotated one is still exactly an ellipse after a height-only resize', async () => {
      ws().updateGate(ellId, { ellipse: { cx: sx.inv(0.5), cy: sy.inv(0.5), rx: 0.12, ry: 0.05, angle: 0.6 } });
      await select(ellId);
      const [w0, h0] = size();
      await drag('b', 0, 30);
      const [w1, h1] = size();
      near(w1, w0, 1.5, 'width unchanged'); near(h1, h0 + 30, 2, 'height');
      const e = ws().gate(ellId).ellipse;
      assert(e.rx > 0 && e.ry > 0 && Number.isFinite(e.angle), 'valid ellipse');
    });

    await step('rectangle: side handles for width or height (its corners are its own handles)', async () => {
      rectId = ws().addGate({ name: 'Box', parent: null, type: 'rect', x, y, xScale: xs, yScale: ys,
        rect: { x0: sx.inv(0.3), x1: sx.inv(0.5), y0: sy.inv(0.3), y1: sy.inv(0.5) } });
      await select(rectId);
      eq(frame().handles.length, 4, 'four side handles');
      const r0 = Object.assign({}, ws().gate(rectId).rect);
      await drag('r', 35, 0);
      const r1 = ws().gate(rectId).rect;
      near(r1.y0, r0.y0, 1e-9 * Math.abs(r0.y0) + 1e-9, 'bottom unchanged'); near(r1.y1, r0.y1, 1e-9 * Math.abs(r0.y1) + 1e-9, 'top unchanged');
      near(r1.x0, r0.x0, 1e-9 * Math.abs(r0.x0) + 1e-9, 'left side stays');
      assert(r1.x1 > r0.x1, 'right side moved out');
    });

    await step('no uncaught errors', async () => {
      assert(!(window.__errors || []).length, (window.__errors || []).join(' | '));
    });

    const pre = document.createElement('pre');
    pre.id = 'uitest';
    pre.textContent = out.join('\n');
    document.body.appendChild(pre);
    document.documentElement.setAttribute('data-uitest', 'done pass=' + pass + ' fail=' + fail);
  }
  function eq(a, b, m) { if (a !== b) throw new Error((m ? m + ': ' : '') + 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  window.addEventListener('load', () => run().catch(e => document.documentElement.setAttribute('data-uitest', 'crashed ' + e.message)));
})();
