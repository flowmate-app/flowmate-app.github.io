/* UI test: a gate's label can be dragged on its own — the gate and its counts stay, the place is
 * kept in the analysis (and so in saves and templates), undo puts it back, and the gate menu
 * resets it. Run with: bash tests/run_ui.sh ui_label.js */
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
  function ptr(type, x, y) {
    pv().overCv.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0,
      buttons: type === 'pointerup' ? 0 : 1, pointerId: 9, pointerType: 'mouse', isPrimary: true }));
  }
  const client = p => { const r = pv().overCv.getBoundingClientRect(); return [r.left + p[0], r.top + p[1]]; };
  const item = id => (pv().items || []).find(i => i.id === id);
  async function dragLabel(id, dx, dy) {
    const b = item(id).labelBox;
    const [x, y] = client([b[0] + 6, b[1] + b[3] / 2]);
    ptr('pointerdown', x, y); ptr('pointermove', x + dx / 2, y + dy / 2); ptr('pointermove', x + dx, y + dy); ptr('pointerup', x + dx, y + dy);
    await wait(300);
  }

  async function run() {
    await wait(300);
    FM.loadDemo();
    FM.ui.gateLayout = 'single';
    FM.go('gate');
    await wait(300);
    const m = pv().model, xs = ws().scaleSpec(m.x), ys = ws().scaleSpec(m.y);
    const sx = FM.transforms.makeScale(xs), sy = FM.transforms.makeScale(ys);
    const id = ws().addGate({ name: 'Lab', parent: m.popId || null, type: 'polygon', x: m.x, y: m.y, xScale: xs, yScale: ys,
      verts: [[0.3, 0.3], [0.6, 0.32], [0.55, 0.6], [0.35, 0.55]].map(([a, b]) => [sx.inv(a), sy.inv(b)]) });
    FM.setUI({ gateId: id, tool: 'select' });
    await wait(300);
    const s = FM.currentSample();

    let box0, verts0, count0;
    await step('dragging the label moves the label, not the gate', async () => {
      box0 = item(id).labelBox.slice();
      verts0 = JSON.stringify(ws().gate(id).verts);
      count0 = ws().count(s, id);
      await dragLabel(id, -60, 70);
      const b = item(id).labelBox;
      near(b[0], box0[0] - 60, 1.5, 'label x'); near(b[1], box0[1] + 70, 1.5, 'label y');
      assert(JSON.stringify(ws().gate(id).verts) === verts0, 'gate vertices unchanged');
      assert(ws().count(s, id) === count0, 'same events in the gate');
      assert(Array.isArray(ws().gate(id).labelPos), 'position stored on the gate');
    });

    await step('the label keeps its place when the plot is drawn again, and in a saved document', async () => {
      const lp = ws().gate(id).labelPos.slice();
      const doc = JSON.parse(JSON.stringify(ws().doc));
      assert(JSON.stringify(doc.gates.find(g => g.id === id).labelPos) === JSON.stringify(lp), 'in the saved document');
      FM.go('plate'); await wait(200); FM.go('gate'); await wait(300);
      const b = item(id).labelBox;
      near(b[0], box0[0] - 60, 1.5, 'x after redraw'); near(b[1], box0[1] + 70, 1.5, 'y after redraw');
    });

    await step('the label stays inside the plot', async () => {
      await dragLabel(id, 5000, 5000);
      const b = item(id).labelBox, L = pv().L;
      assert(b[0] + b[2] <= L.x1 && b[1] + b[3] <= L.y1 && b[0] >= L.x0 && b[1] >= L.y0, 'inside: ' + b.join(','));
    });

    await step('undo puts it back; the menu resets it', async () => {
      ws().undo(); await wait(300);
      near(item(id).labelBox[0], box0[0] - 60, 1.5, 'undo returns to the previous place');
      ws().updateGate(id, { labelPos: null }); await wait(300);
      const b = item(id).labelBox;
      near(b[0], box0[0], 0.5, 'reset x'); near(b[1], box0[1], 0.5, 'reset y');
    });

    await step('dragging the gate body still moves the gate', async () => {
      const o = item(id).outline.pts;
      const cx = o.reduce((a, p) => a + p[0], 0) / o.length, cy = o.reduce((a, p) => a + p[1], 0) / o.length;
      const [x, y] = client([cx, cy]);
      ptr('pointerdown', x, y); ptr('pointermove', x + 15, y); ptr('pointermove', x + 30, y); ptr('pointerup', x + 30, y);
      await wait(300);
      assert(JSON.stringify(ws().gate(id).verts) !== verts0, 'vertices moved');
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
  window.addEventListener('load', () => run().catch(e => document.documentElement.setAttribute('data-uitest', 'crashed ' + e.message)));
})();
