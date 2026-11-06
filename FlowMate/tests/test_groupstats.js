/* Analysis-step statistics (core/groupstats.js) against GraphPad Prism 11.
 *
 * The cases and Prism's printed results are PlotMate's reference set (PlotMate/tests/reference):
 * the same data sets run through Prism by hand. Pre-registered rule, fixed before the first run:
 * a number matches when it is within half a unit of the last digit Prism printed (Prism prints
 * 4 significant digits, and P values to 4 decimals); "<0.0001" means below 0.0001. Mismatches
 * are failures to report, not tolerances to widen.
 */
(function () {
  if (!window.PRISM_CASES || !window.DS) {
    test('groupstats: Prism reference cases are loaded', () => { throw new Error('PlotMate/tests/reference not found'); });
    return;
  }
  const G = () => FM.groupStats;
  const caseOf = id => window.PRISM_CASES.find(c => c.id === id);
  const rowsOf = (id, tab) => caseOf(id).results[tab].rows;
  /** The first row whose label is `label`, after the heading `after` if given. */
  function cell(rows, label, after, col) {
    let i = after ? rows.findIndex(r => r[0] === after) : 0;
    if (i < 0) throw new Error('no heading ' + after);
    for (; i < rows.length; i++) if (rows[i][0] === label) return rows[i][col || 1];
    throw new Error('no row ' + label);
  }
  /** Is `v` what Prism printed as `s`? */
  function matches(v, s) {
    s = String(s).trim();
    if (/^<\s*0\.0001$/.test(s)) return v < 0.0001;
    const m = /^-?\d*\.?\d+(e-?\d+)?$/i.exec(s.replace(/,/g, ''));
    if (!m) throw new Error('not a number: ' + s);
    const dec = (s.split('.')[1] || '').length;
    return Math.abs(v - parseFloat(s)) <= 0.5 * Math.pow(10, -dec) * (1 + 1e-9);
  }
  function same(v, s, what) { if (!matches(v, s)) throw new Error(what + ': Prism ' + s + ', FlowMate ' + v); }
  /** Prism's comparison rows: "Column A vs. Column B" → { diff, p } with p from "Adjusted P Value". */
  function prismComparisons(id) {
    const rows = rowsOf(id, 'mc');
    const head = rows.find(r => /multiple comparisons test$/.test(r[0]));
    const pCol = head.indexOf('Adjusted P Value'), dCol = head.indexOf('Mean diff.');
    const out = [];
    for (let i = rows.indexOf(head) + 1; i < rows.length && rows[i].length > 1 && / vs\. /.test(rows[i][0]); i++) {
      const [a, b] = rows[i][0].split(' vs. ').map(n => n.trim().slice(-1).charCodeAt(0) - 65);
      out.push({ a, b, diff: rows[i][dCol], p: rows[i][pCol] });
    }
    return out;
  }
  function checkComparisons(id, res) {
    const ref = prismComparisons(id);
    eq(res.comparisons.length, ref.length, id + ' number of comparisons');
    ref.forEach(r => {
      const c = res.comparisons.find(x => x.a === r.a && x.b === r.b);
      assert(c, id + ': no comparison ' + r.a + ' vs ' + r.b);
      same(c.diff, r.diff, id + ' ' + r.a + '-' + r.b + ' mean diff.');
      same(c.p, r.p, id + ' ' + r.a + '-' + r.b + ' adjusted P');
    });
  }
  const groups = (d, keys) => keys.map(k => ({ name: k, values: d[k] }));

  test('groupstats: ordinary one-way ANOVA + Tukey matches Prism (anova1-tukey-three)', () => {
    const r = G().run({ groups: groups(DS.three, ['A', 'B', 'C']), compare: 'all' });
    const rows = rowsOf('anova1-tukey-three', 'anova');
    eq(r.test.kind, 'anova');
    same(r.test.F, cell(rows, 'F', 'ANOVA summary'), 'F');
    same(r.test.p, cell(rows, 'P value', 'ANOVA summary'), 'P');
    eq(r.test.dfn, 2); eq(r.test.dfd, 21);
    checkComparisons('anova1-tukey-three', r);
  });

  test('groupstats: Dunnett against the first condition matches Prism (anova1-dunnett-three)', () => {
    const r = G().run({ groups: groups(DS.three, ['A', 'B', 'C']), compare: 'control', control: 0 });
    checkComparisons('anova1-dunnett-three', r);
  });

  test('groupstats: paired with 4 conditions = RM ANOVA, Geisser-Greenhouse, Tukey with individual variances (anova1-rm-gg-rm)', () => {
    const m = DS.rm.m;
    const gs = [0, 1, 2, 3].map(j => ({ name: 'ABCD'[j], values: m.map(row => row[j]) }));
    const r = G().run({ groups: gs, paired: true, compare: 'all' });
    const rows = rowsOf('anova1-rm-gg-rm', 'anova');
    eq(r.test.kind, 'rm-anova');
    same(r.test.F, cell(rows, 'F', 'Repeated measures ANOVA summary'), 'F');
    same(r.test.p, cell(rows, 'P value', 'Repeated measures ANOVA summary'), 'P (GG)');
    checkComparisons('anova1-rm-gg-rm', r);
  });

  test('groupstats: two conditions = unpaired t test, equal SDs (ttest-student-two)', () => {
    const r = G().run({ groups: groups(DS.two, ['a', 'b']), compare: 'all' });
    const rows = rowsOf('ttest-student-two', 'res');
    eq(r.test.kind, 't');
    const [, t, df] = /t=([-\d.]+), df=(\d+)/.exec(cell(rows, 't, df'));
    same(r.test.t, t, 't'); eq(r.test.df, +df);
    same(r.test.p, cell(rows, 'P value'), 'P');
    eq(r.comparisons.length, 1);
    same(r.comparisons[0].p, cell(rows, 'P value'), 'the one comparison is the t test');
  });

  test('groupstats: two paired conditions = paired t test (ttest-paired-paired)', () => {
    const r = G().run({ groups: groups(DS.paired, ['before', 'after']), paired: true, compare: 'all' });
    const rows = rowsOf('ttest-paired-paired', 'res');
    eq(r.test.kind, 'paired-t');
    const [, t, df] = /t=([-\d.]+), df=(\d+)/.exec(cell(rows, 't, df'));
    same(r.test.t, t, 't'); eq(r.test.df, +df);
    same(r.test.p, cell(rows, 'P value'), 'P');
    eq(r.pairs, 10, 'number of pairs');
  });

  test('groupstats: mean, SD and SEM per condition match Prism (describe-default-three)', () => {
    const r = G().run({ groups: groups(DS.three, ['A', 'B', 'C']), compare: 'none' });
    const rows = rowsOf('describe-default-three', 'res');
    ['Mean', 'Std. Deviation', 'Std. Error of Mean'].forEach((label, k) => {
      const row = rows.find(x => x[0] === label);
      assert(row, 'Prism row ' + label);
      r.summary.forEach((s, j) => same([s.mean, s.sd, s.sem][k], row[j + 1], label + ' ' + s.name));
    });
    eq(r.comparisons.length, 0, 'compare: none');
    eq(r.test.kind, 'anova', 'the overall test is still reported');
  });

  test('groupstats: too few values, empty conditions and incomplete pairs are left out and said so', () => {
    const r = G().run({ groups: [{ name: 'A', values: [1, 2, 3] }, { name: 'B', values: [4] }, { name: 'C', values: [5, 6, NaN, 7] }, { name: 'D', values: [] }], compare: 'all' });
    eq(r.summary.find(s => s.name === 'C').n, 3, 'NaN is not a value');
    eq(r.tested.join(), '0,2', 'only conditions with 2+ values are tested');
    eq(r.test.kind, 't', 'two conditions left: a t test');
    assert(r.notes.some(n => /B/.test(n) && /D/.test(n)), 'notes name the left-out conditions: ' + r.notes.join(' | '));
    const p = G().run({ groups: [{ name: 'A', values: [1, 2, NaN, 4] }, { name: 'B', values: [2, 3, 4, 6] }], paired: true, compare: 'all' });
    eq(p.pairs, 3, 'the pair with a gap is dropped');
    assert(p.notes.some(n => /1 incomplete/.test(n)), p.notes.join(' | '));
    const one = G().run({ groups: [{ name: 'A', values: [1, 2] }], compare: 'all' });
    eq(one.test, null, 'nothing to compare');
  });

  test('groupstats: P values and stars print the GraphPad way', () => {
    eq(G().pText(0.01234), '0.0123'); eq(G().pText(0.00001), '<0.0001'); eq(G().pText(0.5), '0.5000');
    eq(G().stars(0.04), '*'); eq(G().stars(0.0001), '****'); eq(G().stars(0.2), 'ns');
  });
})();

// ------------------------------------------------------------------ the graph
(function () {
  function model(kind, extra) {
    const vals = [[1, 2, 3], [4, 5, 6.5], [2, 2.5, 3]];
    const groups = vals.map((v, i) => ({ name: 'G' + i, color: '#3f6fd8', values: v.map((x, j) => ({ v: x, label: 'w' + j })), summary: FM.groupStats.describe('G' + i, v) }));
    const res = FM.groupStats.run({ groups: vals.map((v, i) => ({ name: 'G' + i, values: v })), paired: kind === 'paired', compare: 'all' });
    return Object.assign({ yLabel: 'Y', kind, error: 'sd', groups, sets: [0, 1, 2].map(r => vals.map(v => v[r])), comparisons: res.comparisons, showNs: true, pText: 'stars' }, extra || {});
  }
  const count = (svg, cls) => svg.querySelectorAll('.' + cls).length;

  test('statchart: each kind draws what it says, one mark per well', () => {
    const bar = FM.statChart.render(model('bar'));
    eq(count(bar, 'sc-bar'), 3, 'a bar per condition'); eq(count(bar, 'sc-dot'), 9, 'a dot per well'); eq(count(bar, 'sc-err'), 3, 'error bars');
    eq(count(bar, 'sc-bracket'), 3, 'all three pairs with show ns');
    const dot = FM.statChart.render(model('dot'));
    eq(count(dot, 'sc-bar'), 0); eq(count(dot, 'sc-mean'), 3); eq(count(dot, 'sc-dot'), 9);
    const box = FM.statChart.render(model('box'));
    eq(count(box, 'sc-box'), 3); eq(count(box, 'sc-median'), 3); eq(count(box, 'sc-whisker'), 3);
    const pr = FM.statChart.render(model('paired'));
    eq(count(pr, 'sc-pair'), 3, 'a line per matched set'); eq(count(pr, 'sc-dot'), 9);
  });

  test('statchart: non-significant brackets are hidden unless asked; exact P values when asked', () => {
    const m = model('bar', { showNs: false });
    const sig = m.comparisons.filter(c => c.p <= 0.05).length;
    eq(count(FM.statChart.render(m), 'sc-bracket'), sig);
    const ex = FM.statChart.render(model('bar', { pText: 'exact' }));
    assert(Array.from(ex.querySelectorAll('.sc-plabel')).every(t => /^P [=<>] /.test(t.textContent)), Array.from(ex.querySelectorAll('.sc-plabel')).map(t => t.textContent).join(' | '));
    eq(count(FM.statChart.render(model('bar', { comparisons: [] })), 'sc-bracket'), 0, 'no comparisons, no brackets');
  });

  test('statchart: a title is drawn above the graph only when there is one; a long one widens the picture', () => {
    eq(count(FM.statChart.render(model('bar')), 'sc-title'), 0, 'no title by default');
    const svg = FM.statChart.render(model('bar', { title: 'Bead uptake, 2 h' }));
    eq(svg.querySelector('.sc-title').textContent, 'Bead uptake, 2 h');
    const plain = +FM.statChart.render(model('bar')).getAttribute('height');
    assert(+svg.getAttribute('height') > plain, 'room is made for it');
    const long = FM.statChart.render(model('bar', { title: 'A very long title that is much wider than three conditions of bars would be' }));
    assert(+long.getAttribute('width') > +svg.getAttribute('width'), 'wider picture');
  });

  test('statchart: a missing well breaks a paired line instead of bridging it', () => {
    const m = model('paired');
    m.sets = [[1, NaN, 3], [2, 5, 2.5]];
    const svg = FM.statChart.render(m);
    eq(count(svg, 'sc-pair'), 1, 'only the complete set has a line');
  });
})();
