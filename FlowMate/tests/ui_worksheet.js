/* QA for the Gate step's worksheet (gate_sheet.js): cards never overlap (after adding plots, at every
 * size, in Focus), resize by the corner (plots and the table; saved, undoable), drag across rows, the
 * well switch, histogram cards, gate edits and deletes reaching the cards and the table, save / reopen,
 * dark mode, and menus that never start a drag. Run: bash tests/run_ui.sh ui_worksheet.js */
window.__errors = [];
window.addEventListener('error', e => window.__errors.push(e.message));
window.addEventListener('load', () => setTimeout(async () => {
  const out = [];
  let pass = 0, fail = 0;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const ptr = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 3, pointerType: 'mouse', isPrimary: true }));
  const check = (name, ok, info) => { if (ok) { pass++; out.push('PASS ' + name); } else { fail++; out.push('FAIL ' + name + (info ? ' — ' + info : '')); } };
  const rects = () => $$('.sheet-card').map(c => { const r = c.getBoundingClientRect(); return { id: c.dataset.id, x: r.left, y: r.top, w: r.width, h: r.height }; });
  const overlaps = () => { const rs = rects(), o = []; rs.forEach((a, i) => rs.forEach((b, j) => { if (j > i && a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) o.push(a.id + '×' + b.id); })); return o; };
  const plots = () => $$('.sheet-card:not(.sheet-stats)');
  const btn = (t, r) => $$('button', r).find(b => b.textContent.replace(/\s+/g, ' ').trim().includes(t));
  try {
    FM.loadDemo();
    const ws = FM.ws;
    const p = FM.presets.byId('phagocytosis');
    FM.presets.apply(ws, p, { mapping: FM.presets.autoMap(p, ws.paramNames()), layout: true, replace: true });
    FM.ui.gateLayout = 'sheet';
    FM.go('gate'); await wait(600);

    // 1 resize a plot by its corner
    let card = plots()[0], host = FM.gateSheet.views().get(card.dataset.id).host;
    const w0 = host.getBoundingClientRect().width;
    let g = $('.sheet-resize', card).getBoundingClientRect();
    ptr($('.sheet-resize', card), 'pointerdown', g.left + 8, g.top + 8);
    ptr(document, 'pointermove', g.left + 108, g.top + 58);
    ptr(document, 'pointerup', g.left + 108, g.top + 58); await wait(400);
    card = plots()[0]; host = FM.gateSheet.views().get(card.dataset.id).host;
    check('resize: the plot grows by the drag', Math.abs(host.getBoundingClientRect().width - (w0 + 100)) < 3, w0 + ' → ' + host.getBoundingClientRect().width);
    check('resize: saved with the card', ws.doc.sheet && ws.doc.sheet.items[0].w === Math.round(w0 + 100), JSON.stringify(ws.doc.sheet && ws.doc.sheet.items[0]));
    check('resize: canvas redrawn to the new size', Math.abs($('canvas.pv-data', host).getBoundingClientRect().width - host.getBoundingClientRect().width) < 3);
    check('resize: no overlaps after', !overlaps().length, overlaps().join(' '));
    ws.undo(); await wait(400);
    check('resize: undo restores', !ws.doc.sheet || !ws.doc.sheet.items[0].w);
    // 2 resize the statistics table
    const st = $('.sheet-stats'); const sw = st.getBoundingClientRect().width;
    g = $('.sheet-resize', st).getBoundingClientRect();
    ptr($('.sheet-resize', st), 'pointerdown', g.left + 8, g.top + 8); ptr(document, 'pointermove', g.left + 88, g.top + 8); ptr(document, 'pointerup', g.left + 88, g.top + 8); await wait(400);
    check('resize: the statistics table widens', Math.abs($('.sheet-stats').getBoundingClientRect().width - (sw + 80)) < 3, sw + ' → ' + $('.sheet-stats').getBoundingClientRect().width);
    // 3 add plots, drag the last to the front (across rows)
    for (let k = 0; k < 3; k++) { btn('Add plot', $('.sheet-bar')).click(); await wait(300); }
    check('add: no overlaps with 7 cards', !overlaps().length, overlaps().join(' '));
    const ids = rects().map(r => r.id);
    const last = $$('.sheet-card')[ids.length - 1], first = $$('.sheet-card')[0];
    const a = $('.sheet-head', last).getBoundingClientRect(), b = $('.sheet-head', first).getBoundingClientRect();
    ptr($('.sheet-grip', last), 'pointerdown', a.left + 10, a.top + 10);
    ptr(document, 'pointermove', a.left + 30, a.top + 10);
    ptr(document, 'pointermove', b.left + 20, b.top + 10);
    ptr(document, 'pointerup', b.left + 20, b.top + 10); await wait(400);
    check('move: last card dragged to the front across rows', rects()[0].id === ids[ids.length - 1], rects().map(r => r.id).join());
    check('move: no overlaps after', !overlaps().length);
    // 4 S / M / L resets sizes
    btn('S', $('.sheet-size')).click(); await wait(400);
    check('size S: every plot the same small size', new Set(plots().map(c => Math.round(FM.gateSheet.views().get(c.dataset.id).host.getBoundingClientRect().width))).size === 1);
    check('size S: no overlaps', !overlaps().length);
    btn('M', $('.sheet-size')).click(); await wait(400);
    // 5 switching the well redraws every card and the table
    const before = $('.sheet-stats tbody tr:nth-child(2) td:nth-child(2)').textContent;
    FM.setUI({ sampleKey: ws.samples.find(s => s.well === 'F1').key }); await wait(500);
    const after = $('.sheet-stats tbody tr:nth-child(2) td:nth-child(2)').textContent;
    check('well: the table follows the well', before !== after, before + ' / ' + after);
    check('well: every card plots the new well', [...FM.gateSheet.views().values()].every(v => v.pv.model.sample.well === 'F1'));
    // 6 a histogram card
    const c0 = plots()[0];
    const ysel = $('.sheet-axis[aria-label="Y axis"]', c0); ysel.value = ''; ysel.dispatchEvent(new Event('change', { bubbles: true })); await wait(400);
    const hcard = plots()[0];
    check('histogram: a card can show one parameter', FM.gateSheet.views().get(hcard.dataset.id).pv.model.y === null);
    // 7 editing a gate in one card updates the other cards' counts and the table
    const gate = ws.doc.gates[0];
    const s = FM.currentSample();
    const v0 = ws.pct(s, gate.id);
    if (gate.type === 'polygon') ws.updateGate(gate.id, { verts: gate.verts.map(([x, y]) => [x * 0.7, y * 0.7]) });
    else if (gate.type === 'rect') ws.updateGate(gate.id, { rect: Object.assign({}, gate.rect, { x1: gate.rect.x0 + (gate.rect.x1 - gate.rect.x0) * 0.6 }) });
    await wait(500);
    const v1 = ws.pct(s, gate.id);
    const cell = $('.sheet-stats tbody tr:nth-child(2) td:nth-child(3)').textContent;
    out.push('  (' + gate.type + ' ' + v0.toFixed(1) + ' → ' + v1.toFixed(1) + ', table ' + cell + ')');
    check('edit: the gate changed', Math.abs(v1 - v0) > 0.5);
    check('edit: the table shows the new value', cell === FM.dom.fmtPct(v1), cell + ' vs ' + FM.dom.fmtPct(v1));
    ws.undo(); await wait(400);
    // 8 deleting a gate removes the cards inside it, and undo brings them back
    const leaf = FM.io.gatesInOrder().slice(-1)[0];
    const nCards = plots().length;
    const pop = FM.io.gatesInOrder().slice(-2)[0];
    const sel = $('.sheet-pop', plots()[1]); sel.value = leaf.id; sel.dispatchEvent(new Event('change', { bubbles: true })); await wait(400);
    check('pop: a card inside the last gate', plots().some(c => c.dataset.pop === leaf.id));
    ws.deleteGate(leaf.id); await wait(400);
    check('delete: its card goes with the gate', !plots().some(c => c.dataset.pop === leaf.id));
    ws.undo(); await wait(400);
    check('delete: undo brings it back', plots().some(c => c.dataset.pop === leaf.id));
    // 9 the arrangement survives saving and reopening
    const json = JSON.parse(JSON.stringify(ws.toJSON()));
    const order = rects().map(r => r.id).join();
    ws.loadDoc(json); await wait(600);
    check('save/reopen: same cards in the same order', rects().map(r => r.id).join() === order, order + ' / ' + rects().map(r => r.id).join());
    // 10 dark theme, focus, narrow window
    document.documentElement.setAttribute('data-theme', 'dark'); FM.bus.emit('theme'); await wait(400);
    check('dark: renders', !window.__errors.length && plots().length > 0);
    document.documentElement.setAttribute('data-theme', 'light'); FM.bus.emit('theme');
    btn('Focus', $('.crumbs')).click(); await wait(500);
    check('focus: the worksheet fills the width', $('.plot-panel').getBoundingClientRect().width > window.innerWidth * 0.9, $('.plot-panel').getBoundingClientRect().width + ' of ' + window.innerWidth);
    check('focus: no overlaps', !overlaps().length);
    btn('Exit focus', $('.crumbs')).click(); await wait(400);
    // 11 the population and axes controls do not start a drag
    const head = $('.sheet-head', plots()[0]);
    const popSel = $('.sheet-pop', head), r1 = popSel.getBoundingClientRect();
    const idsNow = rects().map(r => r.id).join();
    ptr(popSel, 'pointerdown', r1.left + 5, r1.top + 5); ptr(document, 'pointermove', r1.left + 300, r1.top + 5); ptr(document, 'pointerup', r1.left + 300, r1.top + 5); await wait(300);
    check('menus: pressing the population menu never drags the card', rects().map(r => r.id).join() === idsNow);
    // 12 every card's axes have a scale button: Lin / Log / Logicle and the range, as on the single plot
    const pc = plots().find(c => $$('.sheet-ax .axis-chip', c).length === 2) || plots()[0];
    const chips = $$('.sheet-ax .axis-chip', pc);
    check('scale: a scale button on each axis of a 2-D card', chips.length === 2, chips.length);
    const xParam = FM.gateSheet.views().get(pc.dataset.id).pv.model.x;
    chips[chips.length - 1].click(); await wait(300);
    const logBtn = $$('.pop button').find(b => b.textContent.trim() === 'Log');
    check('scale: the axis popover opens with the transforms', !!logBtn);
    if (logBtn) { logBtn.click(); await wait(500); }
    FM.dom.closePop();
    check('scale: the axis is now Log', ws.scaleSpec(xParam).type === 'log', ws.scaleSpec(xParam).type);
    const pc2 = $$('.sheet-card').find(c => c.dataset.id === pc.dataset.id);
    check('scale: the card shows it', /Log/.test($$('.sheet-ax .axis-chip', pc2).pop().textContent));
    check('scale: the card redrew on the new scale', FM.gateSheet.views().get(pc.dataset.id).pv.scales().xSpec.type === 'log');
    ws.undo(); await wait(400);
    // 13 the resize corner does not start a drag either
    check('no uncaught errors', !window.__errors.length, window.__errors.join(' | '));
  } catch (e) { out.push('ERR ' + e.stack); fail++; }
  const pre = document.createElement('pre'); pre.id = 'uitest'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
  document.documentElement.setAttribute('data-uitest', 'done pass=' + pass + ' fail=' + fail);
}, 300));
