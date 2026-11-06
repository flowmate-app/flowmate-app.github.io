/* Dev page: load the 8-colour ICS FCS files (tests/public_large) and import a FlowJo workspace,
 * then open the step in the URL hash. For screenshots of the import. ?wsp=<file in public/flowjo> */
const FJ_STEP = (location.hash || '#workspace').slice(1);
window.addEventListener('load', async () => {
  const q = new URLSearchParams(location.search);
  const files = ['101_DEN084Y5_15_E01_008_clean.fcs', '101_DEN084Y5_15_E03_009_clean.fcs', '101_DEN084Y5_15_E05_010_clean.fcs'];
  const samples = [];
  for (const f of files) samples.push(FM.fcs.parse(await (await fetch('public_large/8_color/' + f)).arrayBuffer(), f));
  FM.ws.addSamples(samples);
  const wsp = q.get('wsp') || '8_color_ICS_boolean_gate_testing.wsp';
  const text = await (await fetch('public/flowjo/' + wsp)).text();
  const parsed = FM.wsp.parse(text);
  const rep = FM.wsp.importInto(FM.ws, parsed);
  FM.ws.update('Name', d => { d.name = '8-colour ICS (FlowJo import)'; });
  FM.ui.wsOpen = new Set([FM.ws.samples[0].key]);
  FM.go(FJ_STEP);
  if (q.get('report')) FM.importDialogs.showFlowJoReport(rep, wsp);
  if (q.get('pop')) { const id = rep.paths[q.get('pop')]; if (id) { FM.setUI({ sampleKey: FM.ws.samples[0].key, popId: id, gateId: null }); FM.go('gate'); } }
});
