/* Loads the real 17-Sep-2026 plate into the dev app (as File objects, through FM.loadFiles),
 * applies the phagocytosis preset, and opens the step named in the URL hash. For screenshots. */
const TARGET_STEP = (location.hash || '#gate').slice(1);   // read before boot rewrites the hash
window.addEventListener('load', async () => {
  const wells = ['A1','A2','A3','B1','B2','B3','C1','C2','C3','D1','D2','D3','E1','E2','E3','F1','F2','F3'];
  // fetch + parse directly: Blob reads make headless virtual time non-deterministic
  const samples = [];
  for (const w of wells) samples.push(FM.fcs.parse(await (await fetch('data/01-Well-' + w + '.fcs')).arrayBuffer(), '01-Well-' + w + '.fcs'));
  FM.ws.addSamples(samples);
  FM.ui.sampleKey = FM.ws.samples[0].key;
  const q0 = new URLSearchParams(location.search);
  const p = FM.presets.byId('phagocytosis');
  if (!q0.get('nopreset')) FM.presets.apply(FM.ws, p, { mapping: FM.presets.autoMap(p, FM.ws.paramNames()), layout: true, replace: true });
  FM.ws.update('Name', d => { d.name = 'THP-1 bead phagocytosis · 17 Sep 2026'; });
  const q = new URLSearchParams(location.search);
  if (q.get('exclude')) FM.ws.setExcluded([q.get('exclude')], true, 'beads not added (no bead-positive events)');
  if (q.get('select')) FM.setUI({ gateId: FM.ws.popIdByName(q.get('select')) });
  if (q.get('well')) FM.setUI({ sampleKey: q.get('well') });
  if (q.get('dark')) { document.documentElement.setAttribute('data-theme', 'dark'); FM.ui.theme = 'dark'; FM.plot.invalidateTheme(); }
  if (q.get('hist')) { const pid = FM.ws.popIdByName(q.get('hist')); FM.ws.setView(pid, { x: 'FL1-H', y: null }); FM.setUI({ popId: pid, gateId: null, overlay: true }); }
  if (q.get('quad')) { const pid = FM.ws.popIdByName('Singles'); const ids = FM.ws.addQuadrant({ parent: pid, x: 'FL1-H', y: 'SSC-H', xScale: FM.ws.scaleSpec('FL1-H'), yScale: FM.ws.scaleSpec('SSC-H'), cx: 6e4, cy: 3.5e5 }); FM.ws.setView(pid, { x: 'FL1-H', y: 'SSC-H' }); FM.setUI({ gateId: ids[1] }); }
  if (q.get('focus')) FM.ui.focus = true;
  FM.go(TARGET_STEP);
  if (q.get('report')) {
    const ta = document.createElement('textarea');
    ta.id = 'reportOut';
    ta.textContent = FM.report.build(FM.ws);
    document.body.appendChild(ta);
  }
  if (q.get('help')) setTimeout(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true })), 50);
  if (q.get('scroll')) setTimeout(() => { const w = document.querySelector('.res-wrap'); if (w) w.scrollTop = +q.get('scroll'); }, 100);
  if (q.get('flow')) {
    // replay the guided flow: [chip text, 'Accept', ...] up to the requested number of actions
    const script = ['Cells', 'Accept', 'SSC-A × SSC-H', 'Accept', 'FL1-H × FSC-H', 'Accept'];
    const n = +q.get('flow');
    for (let i = 0; i < n; i++) {
      await new Promise(r => setTimeout(r, 150));
      const want = script[i];
      const el = [...document.querySelectorAll('.guide button')].find(b => b.textContent.replace(/\s+/g, ' ').includes(want));
      if (el) el.click(); else document.body.setAttribute('data-flow-miss', want);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  setTimeout(() => {
    const pv = FM.views.gate && FM.views.gate._plotView && FM.views.gate._plotView();
    const host = document.querySelector('.plot-host');
    if (pv && host) {
      const r = host.getBoundingClientRect();
      document.documentElement.setAttribute('data-plotdbg', JSON.stringify({ host: [Math.round(r.width), Math.round(r.height)], L: pv.L && [pv.L.W, pv.L.H, Math.round(pv.L.x0), Math.round(pv.L.y0), Math.round(pv.L.x1), Math.round(pv.L.y1)], wrap: [pv.wrap.clientWidth, pv.wrap.clientHeight] }));
    }
  }, 600);
  document.title = 'READY';
});
