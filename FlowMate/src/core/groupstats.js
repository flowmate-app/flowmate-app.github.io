/* Statistics for one Analysis graph: a value per well, grouped by condition.
 *
 *   2 conditions   unpaired t test (equal SDs)        | paired t test
 *   3 or more      ordinary one-way ANOVA, then Tukey  | repeated-measures one-way ANOVA with the
 *                  (all pairs) or Dunnett (vs one)    | Geisser–Greenhouse correction, then the same
 *                                                     | families with individual variances
 *
 * Per cell (spec.nested): each well's cells are nested in the well, and the well — the replicate —
 * is a random effect: a linear mixed model fitted by REML (PM.nested, checked against R's nlme),
 * reported as Prism's nested t test (2 conditions) or nested one-way ANOVA (3 or more), then Tukey
 * or Dunnett on the model's means. Cells are never counted as independent replicates: the test's
 * degrees of freedom come from the number of wells.
 *
 * The arithmetic is PlotMate's (PM.ttest, PM.anova1, PM.posthoc — checked against Prism 11),
 * inlined into FlowMate's build; this module only arranges the data and the wording. With two
 * conditions the t test is the comparison, as it is in Prism (Tukey with two means is that test).
 */
(function (FM) {
  'use strict';
  const PM = () => window.PM;

  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const sig4 = v => (finite(v) ? String(Number(v.toPrecision(4))) : '—');
  const pText = p => PM().num.pText(p, 'GP');
  const stars = p => PM().num.stars(p, 'GP');
  /** "P = 0.0123", "P < 0.0001". */
  const pPhrase = p => { const t = pText(p); return /^[<>]/.test(t) ? 'P ' + t[0] + ' ' + t.slice(1) : 'P = ' + t; };

  /** n, mean, SD, SEM, median and quartiles (Prism's method), min, max. */
  function describe(name, values) {
    const x = values.filter(finite);
    const n = x.length;
    const D = PM().describe;
    const s = D.sorted(x);
    const ms = D.meanSd(x);
    return { name, n, mean: ms.mean, sd: n > 1 ? ms.sd : NaN, sem: n > 1 ? ms.sd / Math.sqrt(n) : NaN,
      median: D.quantile(s, 0.5), q1: D.quantile(s, 0.25), q3: D.quantile(s, 0.75), min: n ? s[0] : NaN, max: n ? s[n - 1] : NaN };
  }

  const listNames = names => (names.length < 3 ? names.join(' and ') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]);

  /**
   * spec: { groups: [{ name, values: [number] }], paired, compare: 'all' | 'control' | 'none', control: index }
   * For paired data, values[i] of every condition belong to the same matched set.
   * → { summary: [describe], tested: [index], test: { kind, name, text, p, … } | null,
   *     comparisons: [{ a, b, label, diff (mean a − mean b), p (adjusted), stars }], notes: [string], pairs, method }
   */
  const cache = new Map();           // the multiple-comparison P values are slow to work out; the same data gives the same answer
  function run(spec) {
    const key = JSON.stringify([spec.nested ? spec.groups.map(g => ({ name: g.name, values: g.values, cells: g.cells.map(sig) })) : spec.groups,
      !!spec.paired, !!spec.nested, spec.compare || 'all', spec.control || 0]);
    if (cache.has(key)) return cache.get(key);
    const res = compute(spec);
    cache.set(key, res);
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    return res;
  }

  /** A well's cells, cheaply: count, sum and sum of squares (the cache key; arrays can be huge). */
  function sig(c) { let s = 0, q = 0; for (let i = 0; i < c.length; i++) { s += c[i]; q += c[i] * c[i]; } return [c.length, s, q]; }

  function compute(spec) {
    if (spec.nested) return computeNested(spec);
    const groups = spec.groups || [];
    const paired = !!spec.paired;
    const compare = spec.compare || 'all';
    const summary = groups.map(g => describe(g.name, g.values || []));
    const notes = [];
    const out = { summary, tested: [], test: null, comparisons: [], notes, pairs: null, method: null };

    let tested = summary.map((s, i) => i).filter(i => summary[i].n >= 2);
    const left = summary.filter((s, i) => tested.indexOf(i) < 0).map(s => s.name);
    if (left.length) notes.push(listNames(left) + (left.length === 1 ? ' has' : ' have') + ' fewer than 2 values, so ' + (left.length === 1 ? 'it is' : 'they are') + ' not in the test.');

    // paired: the matched sets where every tested condition has a value
    let M = null;
    if (paired && tested.length >= 2) {
      const len = Math.max(...tested.map(i => groups[i].values.length));
      M = [];
      let dropped = 0;
      for (let r = 0; r < len; r++) {
        const row = tested.map(i => groups[i].values[r]);
        if (row.every(finite)) M.push(row); else if (row.some(finite)) dropped++;
      }
      if (dropped) notes.push(dropped + ' incomplete matched set' + (dropped === 1 ? '' : 's') + ' left out (a well missing in some condition).');
      out.pairs = M.length;
      if (M.length < 2) { notes.push('A paired test needs at least 2 complete matched sets.'); tested = []; }
    }
    out.tested = tested;
    if (tested.length < 2) {
      if (groups.length >= 2 && !notes.length) notes.push('There is nothing to compare yet.');
      return out;
    }

    const k = tested.length;
    const names = tested.map(i => summary[i].name);
    const vals = tested.map(i => groups[i].values.filter(finite));
    let ctrl = 0;
    if (compare === 'control') {
      ctrl = tested.indexOf(spec.control || 0);
      if (ctrl < 0) { notes.push('The condition to compare against is not in the test, so there are no comparisons.'); }
    }
    const wantPairs = compare !== 'none' && !(compare === 'control' && ctrl < 0);
    const back = r => ({ a: tested[r.a], b: tested[r.b], label: summary[tested[r.a]].name + ' vs. ' + summary[tested[r.b]].name,
      diff: r.diff, p: r.padj, stars: stars(r.padj) });

    if (k === 2) {
      const r = paired ? PM().ttest.paired(M.map(x => x[0]), M.map(x => x[1])) : PM().ttest.unpaired(vals[0], vals[1], { welch: false });
      out.test = { kind: paired ? 'paired-t' : 't', name: paired ? 'Paired t test' : 'Unpaired t test', t: r.t, df: r.df, p: r.p,
        text: (paired ? 'Paired t test' : 'Unpaired t test') + ': t(' + sig4(r.df) + ') = ' + sig4(Math.abs(r.t)) + ', ' + pPhrase(r.p) };
      out.method = out.test.name;
      if (wantPairs) {
        const diff = paired ? -r.meanDiff : summary[tested[0]].mean - summary[tested[1]].mean;
        out.comparisons = [back({ a: 0, b: 1, diff, padj: r.p })];
      }
      return out;
    }

    const method = compare === 'control' ? 'dunnett' : 'tukey';
    const pairs = PM().posthoc.pairsFor(k, compare === 'control' ? 'control' : 'all', Math.max(0, ctrl));
    if (paired) {
      const r = PM().anova1.rm(M);
      if (r.error) { notes.push(r.error); return out; }
      out.test = { kind: 'rm-anova', name: 'Repeated-measures one-way ANOVA (Geisser–Greenhouse)', F: r.F, dfn: r.dfnGG, dfd: r.dfdGG, p: r.pGG, epsilon: r.epsilon };
      if (wantPairs) out.comparisons = PM().posthoc.pairedFamily(M, { method, pairs, names, control: Math.max(0, ctrl), noCI: true }).map(back);
    } else {
      const o = PM().anova1.ordinary(vals);
      out.test = { kind: 'anova', name: 'Ordinary one-way ANOVA', F: o.F, dfn: o.dfb, dfd: o.dfw, p: o.p };
      if (wantPairs) out.comparisons = PM().posthoc.compare({ means: o.means, ns: o.ns, mse: o.msw, df: o.dfw, pairs, method, names, noCI: true }).map(back);
    }
    const t = out.test;
    t.text = t.name + ': F(' + sig4(t.dfn) + ', ' + sig4(t.dfd) + ') = ' + sig4(t.F) + ', ' + pPhrase(t.p);
    out.method = wantPairs ? (method === 'tukey' ? (paired ? 'Tukey’s test with individual variances' : 'Tukey’s multiple comparisons test')
      : (paired ? 'Dunnett’s test with individual variances' : 'Dunnett’s multiple comparisons test')) : null;
    return out;
  }

  /**
   * spec.groups: [{ name, values: [well value], cells: [[cell value] per well] }] — values are what
   * the graph shows (one per well); cells are what is tested.
   */
  function computeNested(spec) {
    const groups = spec.groups || [];
    const compare = spec.compare || 'all';
    const summary = groups.map(g => {
      const wells = (g.cells || []).filter(c => c.length);
      return Object.assign(describe(g.name, g.values || []), { wells: wells.length, cells: wells.reduce((a, c) => a + c.length, 0) });
    });
    const notes = [];
    const out = { summary, tested: [], test: null, comparisons: [], notes, pairs: null, method: null, nested: true };
    let tested = summary.map((s, i) => i).filter(i => summary[i].wells >= 2);
    const left = summary.filter((s, i) => tested.indexOf(i) < 0).map(s => s.name);
    if (left.length) notes.push(listNames(left) + (left.length === 1 ? ' has' : ' have') + ' fewer than 2 wells with cells, so ' + (left.length === 1 ? 'it is' : 'they are') +
      ' not in the test: cells of one well are not independent replicates, so a condition needs at least 2 wells.');
    out.tested = tested;
    if (tested.length < 2) {
      if (groups.length >= 2 && !notes.length) notes.push('There is nothing to compare yet.');
      return out;
    }
    const k = tested.length;
    const names = tested.map(i => summary[i].name);
    const fit = PM().nested.fit(tested.map(i => groups[i].cells.filter(c => c.length).map(c => Array.from(c))));
    if (fit.error) { notes.push(fit.error); return out; }
    out.fit = { means: fit.groupMeans, pctBetweenWells: fit.pctSubject, nesting: fit.nesting, wells: fit.subjects, cells: fit.N };
    let ctrl = 0;
    if (compare === 'control') {
      ctrl = tested.indexOf(spec.control || 0);
      if (ctrl < 0) notes.push('The condition to compare against is not in the test, so there are no comparisons.');
    }
    const wantPairs = compare !== 'none' && !(compare === 'control' && ctrl < 0);
    const back = r => ({ a: tested[r.a], b: tested[r.b], label: summary[tested[r.a]].name + ' vs. ' + summary[tested[r.b]].name, diff: r.diff, p: r.padj, stars: stars(r.padj) });
    if (k === 2) {
      const t = fit.t;
      out.test = { kind: 'nested-t', name: 'Nested t test', t: t.t, df: t.df, p: t.p,
        text: 'Nested t test: t(' + sig4(t.df) + ') = ' + sig4(Math.abs(t.t)) + ', ' + pPhrase(t.p) };
      out.method = out.test.name;
      if (wantPairs) out.comparisons = [back({ a: 0, b: 1, diff: fit.groupMeans[0] - fit.groupMeans[1], padj: t.p })];
      return out;
    }
    const method = compare === 'control' ? 'dunnett' : 'tukey';
    out.test = { kind: 'nested-anova', name: 'Nested one-way ANOVA', F: fit.F, dfn: fit.dfn, dfd: fit.dfd, p: fit.p };
    out.test.text = 'Nested one-way ANOVA: F(' + sig4(fit.dfn) + ', ' + sig4(fit.dfd) + ') = ' + sig4(fit.F) + ', ' + pPhrase(fit.p);
    if (wantPairs) out.comparisons = PM().nested.compare(fit, { method, names, compare: compare === 'control' ? 'control' : 'all', control: Math.max(0, ctrl) }).map(back);
    out.method = wantPairs ? (method === 'tukey' ? 'Tukey’s multiple comparisons test' : 'Dunnett’s multiple comparisons test') : null;
    return out;
  }

  FM.groupStats = { run, describe, pText, stars };
})(FM);
