/* Dev page: the demo single-stain controls with a matrix computed from them, on the Comp step. */
window.addEventListener('load', async () => {
  FM.views.comp._demo();
  const ws = FM.ws;
  const res = FM.comp.compute(ws, { controls: ['Comp-FL1.fcs', 'Comp-FL2.fcs', 'Comp-FL3.fcs'].map(k => ({ sampleKey: k })), unstained: 'Unstained.fcs' });
  FM.lastCompDiag = res.diagnostics;
  FM.ui.compShow = ws.saveMatrix({ name: 'From controls', params: res.params, spill: res.spill, source: 'computed' }, { activate: true });
  ws.update('Name', d => { d.name = 'Compensation demo'; });
  FM.go('comp');
});
