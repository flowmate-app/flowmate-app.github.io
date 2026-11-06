/* QA page: open ALS ICS screen 2 in the real FlowMate UI the way a user would — load the FCS
 * files (under the names the workspace uses), import the FlowJo workspace, and show FlowMate's
 * own import report. ?step=workspace|gate */
window.addEventListener('load', async () => {
  const q = new URLSearchParams(location.search);
  const dir = '../public_large/external_qa/als_ics2/';
  const files = ['ALS Specimen_001_C10_C10 Negative.fcs', 'ALS Specimen_001_C11_C11 Peptide.fcs', 'ALS Specimen_001_C12_C12 Positive.fcs',
    'ALS Specimen_001_C4_C04 Negative.fcs', 'ALS Specimen_001_C5_C05 Peptide.fcs', 'ALS Specimen_001_C6_C06 Positive.fcs',
    'ALS Specimen_001_H1_H01 Negatice.fcs', 'ALS Specimen_001_H2_H02 Peptide.fcs', 'ALS Specimen_001_H3_H03 Positive.fcs',
    'HC Specimen_001_C1_C01 Negative.fcs', 'HC Specimen_001_C2_C02 Peptide.fcs', 'HC Specimen_001_C3_C03 Positive.fcs',
    'HC Specimen_001_C7_C07 Negative.fcs', 'HC Specimen_001_C8_C08 Peptide.fcs', 'HC Specimen_001_C9_C09 Positive.fcs',
    'HC Specimen_001_H7_H07 Negative.fcs', 'HC Specimen_001_H8_H08 Peptide.fcs', 'HC Specimen_001_H9_H09 Positive.fcs'];
  const samples = [];
  for (const f of files) samples.push(FM.fcs.parse(await (await fetch(dir + encodeURIComponent(f))).arrayBuffer(), f.replace(/^(HC|ALS) /, '')));
  FM.ws.addSamples(samples);
  const name = '2-Week ICS #2.wsp';
  const text = await (await fetch(dir + encodeURIComponent(name))).text();
  const rep = FM.wsp.importInto(FM.ws, FM.wsp.parse(text));
  FM.ws.update('Name', d => { d.name = 'ALS ICS screen 2 (FlowJo import)'; });
  FM.go(q.get('step') || 'workspace');
  if (q.get('report')) FM.importDialogs.showFlowJoReport(rep, name);
  if (q.get('pop')) { const id = rep.paths[q.get('pop')]; if (id) { FM.setUI({ sampleKey: FM.ws.samples[0].key, popId: id, gateId: null }); FM.go('gate'); } }
});
