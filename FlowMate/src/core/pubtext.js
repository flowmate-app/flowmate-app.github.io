/* Words for a paper: the figure legend and the methods paragraph, written from the analysis
 * itself so they cannot drift from what was computed.
 *
 * What a flow figure's legend has to say (flow reporting guidance; Cossarizza et al.,
 * Eur J Immunol guidelines): what the bars, error bars and dots are; n and what n counts;
 * the test and that its p-values are adjusted; the star scale; which control set the
 * positive gate; what was excluded; and — FlowMate's own rule — any gate that was
 * adjusted by hand for a single well.
 *
 * n is the number of WELLS, never events. 15,000 events in a well are not 15,000
 * observations; a test on event counts calls every difference significant.
 */
(function (FM) {
  'use strict';
  const A = () => FM.analysis;

  const DEFAULTS = { errorBars: 'sd', brackets: 'sig', pStyle: 'graphpad', replicates: 'wells', showGate: true };

  function options(ws, o) {
    const s = (ws && ws.doc.settings.pub) || {};
    return Object.assign({}, DEFAULTS, s, o || {});
  }

  function list(words) {
    if (words.length <= 1) return words.join('');
    return words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
  }

  function nPhrase(ns, reps) {
    const lo = Math.min.apply(null, ns), hi = Math.max.apply(null, ns);
    const unit = reps === 'bio' ? 'independent biological replicates' : 'replicate wells';
    return 'n = ' + (lo === hi ? lo : lo + '–' + hi) + ' ' + unit + ' per condition';
  }

  /** The test, named the way a reviewer expects to read it. */
  function testSentence(res, style) {
    const k = (res.tested || []).length;
    if (k < 2 || !res.pairs.length) return 'No statistical test was run (fewer than two conditions with replicate values).';
    if (k === 2) {
      // Tukey's HSD with two groups is exactly the pooled two-tailed t-test
      const p = res.pairs[0];
      return 'The two conditions were compared by a two-tailed unpaired Student’s t-test (p = ' + A().fmtPpub(p.p, style).replace(/^</, '< ') + ').';
    }
    const an = res.anova;
    return 'Conditions were compared by one-way ANOVA' +
      (an && Number.isFinite(an.F) ? ' (F(' + an.df1 + ', ' + an.df2 + ') = ' + an.F.toFixed(2) + ', p ' + pEq(an.p, style) + ')' : '') +
      ' followed by Tukey’s multiple comparisons test; p values are adjusted for multiple comparisons.';
  }

  function pEq(p, style) {
    const s = A().fmtPpub(p, style);
    return /^[<>]/.test(s) ? s.replace(/^([<>])/, '$1 ') : '= ' + s;
  }

  /** Wells whose value came through a hand-adjusted gate the metric reads (or one above it). */
  function adjustedWells(ws, res) {
    const refs = FM.expr.references(res.metric.expr);
    const ids = Array.from(refs.pops).map(n => ws.popIdByName(n)).filter(Boolean);
    const out = [];
    res.wells.forEach(w => {
      if (w.excluded || !w.group || w.group.role === 'gate') return;
      const gates = [];
      ids.forEach(id => ws.gatePath(id).forEach(g => { if (ws.isAdjusted(g.id, w.key) && gates.indexOf(g.name) < 0) gates.push(g.name); }));
      if (gates.length) out.push({ key: w.key, well: w.well || w.key, gates });
    });
    return out;
  }

  /** Which groups the figure shows, in the Plate step's order. */
  function shownGroups(res, o) {
    return res.groups.filter(x => x.used.length && (o.showGate || x.group.role !== 'gate'));
  }

  function legend(ws, res, o) {
    o = options(ws, o);
    const style = o.pStyle;
    const shown = shownGroups(res, o);
    const tested = shown.filter(x => x.group.role !== 'gate');
    const parts = [];
    parts.push(res.metric.name + ' by condition.');
    if (tested.length) {
      parts.push('Bars show the mean ± ' + (o.errorBars === 'sem' ? 'SEM' : 'SD') + ' of ' + nPhrase(tested.map(x => x.summary.n), o.replicates) +
        '; each dot is one ' + (o.replicates === 'bio' ? 'replicate' : 'well') + '.');
    }
    parts.push(testSentence(res, style));
    if (res.pairs.length) {
      const sig = res.pairs.filter(p => p.p <= 0.05);
      parts.push(A().starScale(style) + '.');
      if (o.brackets === 'sig') parts.push(sig.length ? 'Only significant comparisons are shown.' : 'No comparison reached significance (all adjusted p > 0.05).');
    }
    const gateGroups = shown.filter(x => x.group.role === 'gate');
    if (gateGroups.length) parts.push(list(gateGroups.map(x => x.group.name)) + ' wells set the positive gate and were not included in the statistics.');
    const excl = res.wells.filter(w => w.excluded && w.group);
    if (excl.length) parts.push((excl.length === 1 ? 'Well ' : 'Wells ') + list(excl.map(w => (w.well || w.key) + (w.reason ? ' (' + w.reason + ')' : ''))) +
      (excl.length === 1 ? ' was' : ' were') + ' excluded.');
    const adj = adjustedWells(ws, res);
    if (adj.length) parts.push('Gates were adjusted by hand for ' + list(adj.map(a => a.well + ' (' + a.gates.join(', ') + ')')) + '; these wells are marked ✦.');
    return parts.join(' ');
  }

  /** "FSC-H × SSC-H" in the names the files use. */
  function axes(ws, g) {
    if (g.type === 'bool') return 'a Boolean combination of ' + g.bool.terms.map(t => (t.not ? 'not ' : '') + ws.popName(t.id)).join(g.bool.op === 'or' ? ' or ' : ' and ');
    return g.type === 'range' || !g.y ? ws.paramLabel(g.x) : ws.paramLabel(g.x) + ' × ' + ws.paramLabel(g.y);
  }

  function eventsSentence(ws, res) {
    const used = res.wells.filter(w => !w.excluded);
    if (!used.length) return '';
    const n = used.map(w => w.sample.n);
    const med = FM.stats.median(n);
    const fmt = v => Math.round(v).toLocaleString('en-US');
    let s = 'A median of ' + fmt(med) + ' events was recorded per well (range ' + fmt(Math.min.apply(null, n)) + '–' + fmt(Math.max.apply(null, n)) + ')';
    // the smallest population the read-out rests on, since that is what limits its precision
    const refs = FM.expr.references(res.metric.expr);
    let deep = null, depth = -1;
    refs.pops.forEach(nm => { const id = ws.popIdByName(nm); if (id) { const d = ws.gatePath(id).length; if (d > depth) { depth = d; deep = id; } } });
    if (deep) {
      const c = used.filter(w => w.group && w.group.role !== 'gate').map(w => ws.count(w.sample, deep));
      if (c.length) s += '; the ' + ws.popName(deep) + ' population contained ' + fmt(Math.min.apply(null, c)) + '–' + fmt(Math.max.apply(null, c)) + ' events per well';
    }
    return s + '.';
  }

  function methods(ws, res, o) {
    o = options(ws, o);
    const style = o.pStyle;
    const S = ws.samples;
    const parts = [];
    const cyts = [...new Set(S.map(s => s.cytometer).filter(Boolean))];
    parts.push('Flow cytometry data' + (cyts.length ? ' (' + cyts.join(', ') + ')' : '') + ' were analysed in FlowMate ' + FM.version + '.');
    parts.push(FM.comp.describe(ws));
    const gates = FM.summary.gatesInOrder(ws).map(o2 => o2.gate);
    if (gates.length) {
      parts.push('Populations were gated hierarchically: ' + gates.map(g => g.name + ' on ' + axes(ws, g) + (g.parent ? ' within ' + ws.popName(g.parent) : '')).join('; ') + '.');
      const n = gates.reduce((k, g) => k + ws.adjustedWells(g.id).length, 0);
      if (!n) parts.push('One gate set was applied identically to every well.');
      else {
        const wells = new Set(); gates.forEach(g => ws.adjustedWells(g.id).forEach(w => wells.add(w)));
        parts.push('One gate set was applied to every well, except that ' + n + ' gate' + (n > 1 ? 's were' : ' was') + ' adjusted by hand for ' +
          list(Array.from(wells)) + '.');
      }
    }
    const gateGroups = ws.doc.groups.filter(g => g.role === 'gate');
    if (gateGroups.length) parts.push('The positive gate was set on ' + list(gateGroups.map(g => g.name)) + ' (gate-setting control).');
    const ev = eventsSentence(ws, res);
    if (ev) parts.push(ev);
    parts.push(res.metric.name + ' was calculated per well as ' + res.metric.expr + '.');
    const tested = res.groups.filter(x => x.group.role !== 'gate' && x.summary.n > 0);
    if (tested.length) parts.push('Data are presented as mean ± ' + (o.errorBars === 'sem' ? 'SEM' : 'SD') + ' of ' + nPhrase(tested.map(x => x.summary.n), o.replicates) +
      '; the statistical unit is the ' + (o.replicates === 'bio' ? 'biological replicate' : 'well') + ', not the individual event.');
    parts.push(testSentence(res, style));
    if (res.pairs.length) parts.push('Significance: ' + A().starScale(style) + '.');
    const excl = res.wells.filter(w => w.excluded);
    if (excl.length) parts.push('Excluded: ' + excl.map(w => (w.well || w.key) + (w.reason ? ' (' + w.reason + ')' : '')).join('; ') + '.');
    return parts.join(' ');
  }

  /**
   * Stack significance brackets so none collide: shortest spans first, each sitting just
   * above the tallest mark it spans and above every bracket it overlaps. Pixel space, y down.
   *   list:  [{ i, j, ... }] with i < j indexes into the bars
   *   topPx: per bar, the y of its highest mark (bar, error bar or dot)
   * Returns the brackets with a `y` (the bracket's horizontal line).
   */
  function stackBrackets(list2, topPx, step, padPx) {
    const sorted = list2.slice().sort((a, b) => (a.j - a.i) - (b.j - b.i) || a.i - b.i);
    const placed = [];
    sorted.forEach(br => {
      let y = Math.min.apply(null, topPx.slice(br.i, br.j + 1)) - padPx;
      placed.forEach(p => { if (p.i <= br.j && br.i <= p.j && p.y - step < y) y = p.y - step; });
      placed.push(Object.assign({}, br, { y }));
    });
    return placed;
  }

  FM.pubtext = { legend, methods, stackBrackets, options, adjustedWells, shownGroups, DEFAULTS };
})(FM);
