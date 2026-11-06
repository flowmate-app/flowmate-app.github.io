/* The example FlowJo workspace: a small, synthetic T-cell activation experiment and the
 * FlowJo 10 workspace (.wsp) that describes its analysis, written in FlowJo's own format.
 *
 *   2 donors × (unstimulated, SEB-stimulated) — CD3 FITC, CD4 PE, CD8 APC, IFN-γ BV421
 *   + an unstained tube and one single-stained tube per dye (compensation controls)
 *
 * The data is generated here (seeded, so it is identical every time); nothing is downloaded.
 * The workspace has what a real one has — groups, a gate tree per sample, transforms, the
 * acquisition spillover matrix, an ellipse, Or / Not nodes and one sample whose gate was
 * nudged — but no saved FlowJo counts (FlowJo writes those only when it recalculates).
 */
(function (FM) {
  'use strict';

  const DYES = ['FITC-A', 'PE-A', 'APC-A', 'BV421-A'];
  const MARKER = { 'FITC-A': 'CD3', 'PE-A': 'CD4', 'APC-A': 'CD8', 'BV421-A': 'IFN-g' };
  const PARAMS = ['FSC-A', 'FSC-H', 'SSC-A'].concat(DYES).concat(['Time']);
  // rows: the dye's own detector; columns: where its light also lands
  const SPILL = [
    [1, 0.22, 0, 0],          // FITC → PE
    [0.02, 1, 0.01, 0],       // PE → FITC, APC
    [0, 0.005, 1, 0],         // APC → PE
    [0.08, 0.01, 0, 1],       // BV421 → FITC, PE
  ];
  // % of CD4 / CD8 T cells making IFN-γ
  const IFNG = { Donor1_Unstim: [0.2, 0.3], Donor1_SEB: [4.5, 7.5], Donor2_Unstim: [0.15, 0.25], Donor2_SEB: [2.8, 5.0] };

  /** One tube. kind: 'cells' (stained sample) | 'unstained' | a dye (single stain). */
  function tube(name, seed, n, kind, ifng) {
    const S = FM.synth, r = S.rng(seed), g = () => S.gauss(r);
    const cols = PARAMS.map(() => new Float32Array(n));
    const [FA, FH, SA] = cols, D = cols.slice(3, 7), TIME = cols[7];
    const tru = [0, 0, 0, 0];
    const lg = (m, s) => Math.pow(10, m + s * g());
    for (let e = 0; e < n; e++) {
      tru.fill(0);
      const u = r();
      let fa, ratio = 0.86 + 0.025 * g(), ssc, auto = 120;
      if (u < 0.11) {                                  // debris
        fa = lg(3.85, 0.22); ssc = Math.max(300, 7000 + 3000 * g()); ratio = 0.8 + 0.06 * g();
      } else if (u < 0.25 && kind === 'cells') {       // monocytes: big, granular, CD4 dim
        fa = 115000 + 12000 * g(); ssc = 65000 + 9000 * g(); auto = 380;
        tru[1] = lg(3.0, 0.2);
      } else {                                         // lymphocytes (and the doublets among them)
        fa = 62000 + 7000 * g(); ssc = 20000 + 4000 * g();
        if (kind === 'cells') {
          if (r() < 0.72) {                            // T cells
            tru[0] = lg(4.0, 0.18);
            const v = r();
            if (v < 0.62) { tru[1] = lg(4.1, 0.18); if (r() * 100 < ifng[0]) tru[3] = lg(3.7, 0.3); }
            else if (v < 0.92) { tru[2] = lg(3.9, 0.2); if (r() * 100 < ifng[1]) tru[3] = lg(3.7, 0.3); }
          }
        } else if (kind !== 'unstained' && r() < 0.5) {
          tru[DYES.indexOf(kind)] = lg(kind === 'BV421-A' ? 3.9 : 4.1, 0.15);
        }
        // two cells stuck together: more area, about the same height — inside the lymphocyte cloud
        if (r() < 0.1) { ratio = (0.86 + 0.025 * g()) * 0.95 / 1.35; fa *= 1.35; }
      }
      FA[e] = Math.max(200, fa);
      FH[e] = Math.max(150, FA[e] * ratio);
      SA[e] = Math.max(200, ssc);
      for (let j = 0; j < 4; j++) {
        let v = auto + 0.35 * auto * g();
        for (let i = 0; i < 4; i++) v += tru[i] * SPILL[i][j];
        D[j][e] = v;
      }
      TIME[e] = 60 * e / n + 0.01 * r();
    }
    const data = {};
    PARAMS.forEach((p, k) => { data[p] = cols[k]; });
    const spillKw = '4,' + DYES.join(',') + ',' + SPILL.map(row => row.join(',')).join(',');
    const meta = { '$FIL': name, '$TOT': String(n), '$PAR': String(PARAMS.length), '$CYT': 'Example cytometer (synthetic data)',
      '$DATE': '09-OCT-2026', '$BTIM': '10:' + String(10 + (seed % 40)).padStart(2, '0') + ':00', 'TUBE NAME': name.replace(/\.fcs$/, ''),
      'EXPERIMENT NAME': 'T-cell activation (example)', '$SPILLOVER': spillKw };
    PARAMS.forEach((p, k) => { meta['$P' + (k + 1) + 'N'] = p; meta['$P' + (k + 1) + 'S'] = MARKER[p] || ''; });
    return {
      name, version: 'FCS3.1', meta, n, data,
      params: PARAMS.map((p, k) => ({ index: k, name: p, label: MARKER[p] || '', range: p === 'Time' ? 60 : 262144, bits: 32, logDecades: 0, logOffset: 0, gain: 1,
        displayHint: DYES.includes(p) ? 'log' : 'lin' })),
      spill: { params: DYES.slice(), matrix: SPILL.map(r => r.slice()) },
      acqTime: null, cytometer: meta.$CYT, demo: true,
    };
  }

  /** The nine tubes, in the order a cytometer would have recorded them. */
  function samples() {
    const out = [];
    const exp = ['Donor1_Unstim', 'Donor1_SEB', 'Donor2_Unstim', 'Donor2_SEB'];
    exp.forEach((k, i) => out.push(tube(k + '.fcs', 811 + i, 10000, 'cells', IFNG[k])));
    out.push(tube('Comp_Unstained.fcs', 821, 5000, 'unstained'));
    DYES.forEach((d, i) => out.push(tube('Comp_' + d.replace('-A', '') + '.fcs', 822 + i, 5000, d)));
    return out;
  }

  // ------------------------------------------------------------- the .wsp
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let gid = 0;
  const nextId = () => 'ID' + (1000000 + (++gid) * 7919);

  const dim = (name, lo, hi) => '<gating:dimension' + (lo != null ? ' gating:min="' + lo + '"' : '') + (hi != null ? ' gating:max="' + hi + '"' : '') +
    '><data-type:fcs-dimension data-type:name="' + esc(name) + '" /></gating:dimension>';
  const vtx = pts => pts.map(p => '<gating:vertex>' + p.map(v => '<gating:coordinate data-type:value="' + v + '" />').join('') + '</gating:vertex>').join('');

  function population(name, group, gateXML, kids) {
    const id = nextId();
    return '<Population name="' + esc(name) + '" annotation="" owningGroup="' + esc(group) + '" expanded="1" sortPriority="10" count="-1">' +
      '<Gate gating:id="' + id + '">' + gateXML.replace('__ID__', id) + '</Gate>' +
      (kids && kids.length ? '<Subpopulations>' + kids.join('') + '</Subpopulations>' : '') + '</Population>';
  }
  const poly = (x, y, pts) => '<gating:PolygonGate eventsInside="1" quadId="-1" gateResolution="256" gating:id="__ID__">' + dim(x) + dim(y) + vtx(pts) + '</gating:PolygonGate>';
  const rect = dims => '<gating:RectangleGate eventsInside="1" percentX="0" percentY="0" gating:id="__ID__">' + dims.map(d => dim(d[0], d[1], d[2])).join('') + '</gating:RectangleGate>';
  /** FlowJo's ellipse: foci and four edge points in 256-bin display space (here linear 0–262144). */
  function ellipse(x, y, cx, cy, a, b) {
    const bin = v => +(v / 262144 * 256).toFixed(4);
    const c = Math.sqrt(a * a - b * b);
    return '<gating:EllipsoidGate eventsInside="1" gating:id="__ID__">' + dim(x) + dim(y) +
      '<gating:foci>' + vtx([[bin(cx - c), bin(cy)], [bin(cx + c), bin(cy)]]) + '</gating:foci>' +
      '<gating:edge>' + vtx([[bin(cx - a), bin(cy)], [bin(cx + a), bin(cy)], [bin(cx), bin(cy - b)], [bin(cx), bin(cy + b)]]) + '</gating:edge></gating:EllipsoidGate>';
  }
  function boolNode(kind, name, group, deps) {
    return '<' + kind + ' name="' + esc(name) + '" annotation="" owningGroup="' + esc(group) + '" expanded="1" sortPriority="10" count="-1">' +
      '<Dependents>' + deps.map(d => '<Dependent name="' + esc(d) + '" />').join('') + '</Dependents></' + kind + '>';
  }

  /** The gate tree FlowJo would hold for one sample. */
  function tree(sampleName, isComp) {
    const grp = isComp ? 'Compensation' : 'All Samples';
    const ifngMin = sampleName === 'Donor2_SEB.fcs' ? 1800 : 1500;      // nudged on one sample, as people do
    const lymph = [[38000, 4000], [90000, 4000], [98000, 38000], [70000, 46000], [40000, 36000]];
    const single = [[30000, 21000], [125000, 94000], [125000, 130000], [30000, 33000]];
    const T = 'Lymphocytes/Single Cells/CD3+';
    const tcells = isComp ? [] : [
      population('CD3+', grp, rect([['Comp-FITC-A', 1000, 262144]]), [
        population('CD4+', grp, rect([['Comp-PE-A', 1000, 262144], ['Comp-APC-A', -1000, 1000]]), [
          population('IFNg+', grp, rect([['Comp-BV421-A', ifngMin, 262144]]))]),
        population('CD8+', grp, rect([['Comp-PE-A', -1000, 1000], ['Comp-APC-A', 1000, 262144]]), [
          population('IFNg+', grp, rect([['Comp-BV421-A', 1500, 262144]]))]),
        boolNode('OrNode', 'IFNg+ T cells', grp, [T + '/CD4+/IFNg+', T + '/CD8+/IFNg+'])]),
      boolNode('NotNode', 'Non-T cells', grp, ['Lymphocytes/Single Cells/CD3+'])];
    const root = [population('Lymphocytes', grp, poly('FSC-A', 'SSC-A', lymph), [
      population('Single Cells', grp, poly('FSC-A', 'FSC-H', single), tcells)])];
    if (!isComp) root.push(population('Monocytes', grp, ellipse('FSC-A', 'SSC-A', 115000, 65000, 30000, 22000)));
    return root.join('');
  }

  function transforms() {
    const lin = (p, max) => '<transforms:linear transforms:minRange="0" transforms:maxRange="' + max + '" gain="1"><data-type:parameter data-type:name="' + p + '" /></transforms:linear>';
    const biex = p => '<transforms:biex transforms:length="256" transforms:maxRange="262144" transforms:neg="0" transforms:width="-10" transforms:pos="4.418539922"><data-type:parameter data-type:name="' + p + '" /></transforms:biex>';
    return '<Transformations>' + ['FSC-A', 'FSC-H', 'SSC-A'].map(p => lin(p, 262144)).join('') + lin('Time', 60) +
      DYES.map(biex).join('') + DYES.map(d => biex('Comp-' + d)).join('') + '</Transformations>';
  }

  function spillover() {
    return '<transforms:spilloverMatrix spectral="0" prefix="Comp-" name="Acquisition-defined" editable="0" status="FINALIZED" transforms:id="example-acquisition" suffix="">' +
      '<data-type:parameters>' + DYES.map(d => '<data-type:parameter data-type:name="' + d + '" userProvidedCompInfix="Comp-' + d + '" />').join('') + '</data-type:parameters>' +
      DYES.map((d, i) => '<transforms:spillover data-type:parameter="' + d + '" userProvidedCompInfix="Comp-' + d + '">' +
        DYES.map((e, j) => '<transforms:coefficient data-type:parameter="' + e + '" transforms:value="' + SPILL[i][j] + '" />').join('') + '</transforms:spillover>').join('') +
      '</transforms:spilloverMatrix>';
  }

  /** FlowJo 10 workspace XML for the example's samples (sampleID = position + 1). */
  function workspace(list) {
    gid = 0;
    const id = s => String(list.indexOf(s) + 1);
    const comp = list.filter(s => /^Comp_/.test(s.name)), exp = list.filter(s => !/^Comp_/.test(s.name));
    const group = (name, members) => '<GroupNode name="' + esc(name) + '" annotation="" owningGroup="' + esc(name) + '" expanded="1" sortPriority="10" count="-1">' +
      '<Group name="' + esc(name) + '" live="0"><SampleRefs>' + members.map(s => '<SampleRef sampleID="' + id(s) + '" />').join('') + '</SampleRefs></Group></GroupNode>';
    const sample = s => '<Sample><DataSet uri="file:/Users/example/T-cell%20activation/' + encodeURIComponent(s.name) + '" sampleID="' + id(s) + '" />' +
      spillover() + transforms() +
      '<Keywords>' + Object.keys(s.meta).filter(k => !/^\$SPILLOVER$/.test(k)).map(k => '<Keyword name="' + esc(k) + '" value="' + esc(s.meta[k]) + '" />').join('') + '</Keywords>' +
      '<SampleNode name="' + esc(s.name) + '" annotation="" owningGroup="" expanded="0" sortPriority="10" count="' + s.n + '" sampleID="' + id(s) + '">' +
      '<Subpopulations>' + tree(s.name, /^Comp_/.test(s.name)) + '</Subpopulations></SampleNode></Sample>';
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!-- Example workspace in FlowJo 10 format (flowJoVersion names the format), written by FlowMate for its synthetic T-cell activation example. -->\n' +
      '<Workspace version="20.0" flowJoVersion="10.8.1" modDate="Fri Oct 09 10:00:00 IDT 2026" curGroup="All Samples" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:gating="http://www.isac-net.org/std/Gating-ML/v2.0/gating" ' +
      'xmlns:transforms="http://www.isac-net.org/std/Gating-ML/v2.0/transformations" xmlns:data-type="http://www.isac-net.org/std/Gating-ML/v2.0/datatypes">\n' +
      '<Groups>' + group('All Samples', list) + group('Compensation', comp) +
      group('Unstimulated', exp.filter(s => /Unstim/.test(s.name))) + group('SEB', exp.filter(s => /SEB/.test(s.name))) + '</Groups>\n' +
      '<SampleList>' + list.map(sample).join('\n') + '</SampleList>\n</Workspace>\n';
  }

  FM.examples = Object.assign(FM.examples || {}, { tcell: { samples, workspace, SPILL, DYES, IFNG, fileName: 'T-cell activation (example).wsp' } });
})(FM);
