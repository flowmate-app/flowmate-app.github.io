/* Experiment-level analysis of one metric: per-well values, group summaries,
 * fold-change against the control with the meaningfulness threshold, ANOVA + Tukey,
 * and automated quality checks. */
(function (FM) {
  'use strict';
  const I = FM.inference, S = FM.stats;

  /** Ordinary least squares via normal equations. X: rows of predictors (include intercept). */
  function ols(X, y) {
    const n = X.length, k = X[0].length;
    const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
    const Xty = new Array(k).fill(0);
    for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
    let inv;
    try { inv = FM.fcs.invert(XtX); } catch (_) { return null; }
    const beta = inv.map(row => row.reduce((s, v, j) => s + v * Xty[j], 0));
    let rss = 0;
    for (let i = 0; i < n; i++) { const r = y[i] - X[i].reduce((s, v, j) => s + v * beta[j], 0); rss += r * r; }
    return { beta, rss, df: n - k };
  }

  function fmtFold(f) {
    if (!Number.isFinite(f)) return '—';
    return f >= 10 ? f.toFixed(0) + '×' : f.toFixed(2) + '×';
  }

  function verdict(fold, thr) {
    if (!Number.isFinite(fold)) return { key: 'na', label: 'n/a' };
    if (fold >= thr) return { key: 'up', label: '≥' + thr + '× up' };
    if (fold <= 1 / thr) return { key: 'down', label: '≥' + thr + '× down' };
    return { key: 'flat', label: 'under ' + thr + '×' };
  }

  /**
   * Analyse `metricId` across the loaded plate.
   * Returns { metric, threshold, wells[], groups[], control, anova, pairs[], checks[] }.
   */
  function analyze(ws, metricId) {
    const metric = ws.metric(metricId);
    const thr = Number(ws.doc.settings.threshold) > 1 ? Number(ws.doc.settings.threshold) : 2;
    const res = { metric, threshold: thr, wells: [], groups: [], control: null, anova: null, pairs: [], checks: [] };
    if (!metric) return res;

    // ---- per-well values (compensation controls are not part of the experiment)
    ws.samples.forEach(s => {
      const w = ws.wellInfo(s.key);
      const g = w.group ? ws.group(w.group) : null;
      if (g && g.role === 'comp') return;
      const mv = ws.metricValue(s, metric);
      res.wells.push({
        key: s.key, well: s.well, name: s.name, sample: s,
        group: g, excluded: !!w.excluded, reason: w.reason || '',
        value: mv.value, error: mv.error,
        order: s.acqOrder, minutes: s.acqMinutes,
      });
    });

    const control = ws.controlGroup();
    res.control = control;

    // ---- group summaries (excluded wells never count)
    ws.doc.groups.forEach(g => {
      if (g.role === 'comp') return;
      const members = res.wells.filter(w => w.group && w.group.id === g.id);
      const used = members.filter(w => !w.excluded && Number.isFinite(w.value));
      const sum = S.groupSummary(used.map(w => w.value));
      res.groups.push({ group: g, members, used, summary: sum, fold: NaN, verdict: verdict(NaN, thr) });
    });
    const ctrl = control ? res.groups.find(x => x.group.id === control.id) : null;
    const ctrlMean = ctrl ? ctrl.summary.mean : NaN;
    res.groups.forEach(x => {
      x.fold = Number.isFinite(ctrlMean) && ctrlMean !== 0 ? x.summary.mean / ctrlMean : NaN;
      x.verdict = x.group.role === 'gate' ? { key: 'gate', label: 'gate control' } : verdict(x.fold, thr);
    });

    // ---- statistics over groups that are not gate-setting controls
    const tested = res.groups.filter(x => x.group.role !== 'gate' && x.summary.n > 0);
    if (tested.length >= 2 && tested.every(x => x.summary.n >= 1) && tested.some(x => x.summary.n >= 2)) {
      const tk = I.tukey(tested.map(x => x.summary.values), tested.map(x => x.group.name));
      res.anova = tk.anova;
      res.qcrit = tk.qcrit;
      res.tested = tested.map(x => x.group.id);
      res.pairs = tk.pairs.map(p => {
        const hi = Math.max(p.meanA, p.meanB), lo = Math.min(p.meanA, p.meanB);
        const fold = lo > 0 ? hi / lo : NaN;
        return Object.assign(p, { fold, meaningful: Number.isFinite(fold) && fold >= thr, significant: p.p < 0.05 });
      });
    }
    const spread = tested.filter(x => x.summary.mean > 0);
    if (spread.length >= 2) {
      const ms = spread.map(x => x.summary.mean);
      res.maxSpread = Math.max(...ms) / Math.min(...ms);
    }

    res.checks = checks(ws, res, thr);
    return res;
  }

  // ------------------------------------------------------------------ checks
  function checks(ws, res, thr) {
    const out = [];
    const gateGroups = res.groups.filter(x => x.group.role === 'gate');
    const gateMean = gateGroups.length ? S.mean(gateGroups.flatMap(x => x.summary.values)) : NaN;

    // 1. replicate outliers: a well more than `thr`-fold away from its group's median.
    //    The median includes the well itself: with n = 3 and one failed well, a leave-one-out
    //    median of the other two is their mean, which would drag healthy wells into the flag too.
    res.groups.forEach(x => {
      if (x.group.role === 'gate') return;
      const vals = x.members.filter(w => Number.isFinite(w.value));
      if (vals.length < 3) return;
      const med = S.median(vals.map(o => o.value));
      vals.forEach(w => {
        if (!(med > 0)) return;
        const ratio = w.value / med;
        if (ratio < thr && ratio > 1 / thr) return;
        const far = Math.max(ratio, 1 / Math.max(ratio, 1e-12));
        const looksLikeGate = Number.isFinite(gateMean) && w.value <= Math.max(gateMean * 3, med * 0.05);
        out.push({
          id: 'outlier:' + w.key,
          level: w.excluded ? 'done' : (far >= 5 ? 'critical' : 'warning'),
          kind: 'outlier',
          title: (w.well || w.key) + ' is ' + (far >= 100 ? Math.round(far) : far.toFixed(1)) + '× ' + (ratio < 1 ? 'below' : 'above') + ' its replicates',
          detail: (w.well || w.key) + ' (' + x.group.name + ') reads ' + fmtNum(w.value) + ' against a median of ' + fmtNum(med) + ' for its ' + x.group.name + ' replicates.' +
            (looksLikeGate ? ' Its value is in the range of the gate-setting control — the signature of a well that never received its stimulus (e.g. beads not added), rather than a biological result.' : '') +
            (w.excluded ? ' Excluded' + (w.reason ? ': ' + w.reason : '') + '.' : ''),
          wells: [w.key],
          action: w.excluded ? null : { type: 'exclude', keys: [w.key], reason: 'Technical outlier: ' + far.toFixed(0) + '× off replicates' },
        });
      });
    });

    // 2. acquisition-time drift and confounding with group
    const timed = res.wells.filter(w => !w.excluded && w.group && w.group.role !== 'gate' && Number.isFinite(w.value) && w.minutes != null);
    if (timed.length >= 6) {
      const pr = I.pearson(timed.map(w => w.minutes), timed.map(w => w.value));
      const mean = S.mean(timed.map(w => w.value));
      const span = Math.max(...timed.map(w => w.minutes)) - Math.min(...timed.map(w => w.minutes));
      const pctChange = 100 * pr.slope * span / mean;
      // how strongly group identity determines acquisition time (blocks → confounded)
      const gids = [...new Set(timed.map(w => w.group.id))];
      const tAnova = I.anova(gids.map(id => timed.filter(w => w.group.id === id).map(w => w.minutes)));
      const r2Time = tAnova.ssb != null ? tAnova.ssb / (tAnova.ssb + tAnova.ssw) : NaN;
      // does group explain anything beyond time? nested OLS F-test
      let beyond = null;
      if (gids.length >= 2 && timed.length > gids.length + 1) {
        const y = timed.map(w => w.value);
        const Xa = timed.map(w => [1, w.minutes]);
        const Xb = timed.map(w => [1, w.minutes].concat(gids.slice(1).map(id => (w.group.id === id ? 1 : 0))));
        const A = ols(Xa, y), B = ols(Xb, y);
        if (A && B && B.df > 0) {
          const F = ((A.rss - B.rss) / (A.df - B.df)) / (B.rss / B.df);
          const tss = y.reduce((s, v) => s + (v - mean) * (v - mean), 0);
          beyond = { F, p: I.pFupper(Math.max(F, 0), A.df - B.df, B.df), r2Time: 1 - A.rss / tss, r2Both: 1 - B.rss / tss };
        }
      }
      res.drift = { pearson: pr, pctChange, span, r2GroupTime: r2Time, beyond };
      if (pr.p < 0.05) {
        const confounded = r2Time > 0.7;
        out.push({
          id: 'drift', level: 'warning', kind: 'drift',
          title: 'Metric ' + (pr.r > 0 ? 'rises' : 'falls') + ' with acquisition time' + (confounded ? ' — and groups were run in blocks' : ''),
          detail: 'r = ' + (pr.r >= 0 ? '+' : '') + pr.r.toFixed(2) + ', p = ' + fmtP(pr.p) + '; about ' + (pctChange >= 0 ? '+' : '') + pctChange.toFixed(0) + '% over the ' + span.toFixed(0) + '-minute run.' +
            (confounded ? ' Acquisition time is ' + (100 * r2Time).toFixed(0) + '% determined by group, so group differences and time drift cannot be separated in this run.' : '') +
            (beyond ? ' Time alone explains R² = ' + beyond.r2Time.toFixed(2) + '; adding group on top of it gives p = ' + fmtP(beyond.p) + '.' : '') +
            ' Next time, acquire in randomised or interleaved order and stop the reaction (ice/fix) before acquisition.',
        });
      } else {
        out.push({ id: 'drift', level: 'ok', kind: 'drift', title: 'No drift with acquisition time', detail: 'r = ' + (pr.r >= 0 ? '+' : '') + pr.r.toFixed(2) + ', p = ' + fmtP(pr.p) + ' across ' + timed.length + ' wells.' });
      }
    }

    // 3. gate-setting controls should sit (near) empty in the populations the metric reads
    const refs = FM.expr.references(res.metric.expr);
    gateGroups.forEach(x => {
      refs.pops.forEach(popName => {
        const pid = ws.popIdByName(popName);
        if (!pid) return;
        const pcts = x.members.filter(w => !w.excluded).map(w => ws.pct(w.sample, pid)).filter(Number.isFinite);
        if (!pcts.length) return;
        const hi = Math.max(...pcts);
        const lvl = hi < 1 ? 'ok' : hi < 5 ? 'warning' : 'critical';
        out.push({
          id: 'gatectl:' + x.group.id + ':' + pid, level: lvl, kind: 'gate-control',
          title: x.group.name + ' reads ' + pcts.map(p => p.toFixed(2) + '%').join(', ') + ' in ' + popName,
          detail: lvl === 'ok'
            ? 'The gate-setting control is essentially empty in this gate, so its boundary is clean.'
            : 'A gate-setting control should be near 0% here. Tighten the ' + popName + ' gate or check the control wells.',
        });
      });
    });

    // 4. replicate precision
    res.groups.forEach(x => {
      if (x.group.role === 'gate' || x.summary.n < 2) return;
      if (x.summary.cv > 30) out.push({
        id: 'cv:' + x.group.id, level: 'warning', kind: 'cv',
        title: x.group.name + ' replicates vary by ' + x.summary.cv.toFixed(0) + '% (CV)',
        detail: 'With n = ' + x.summary.n + ', a single well dominates this group\'s mean. Inspect its wells on the Gate step.',
      });
    });

    // 5. thin final populations make gMFI-type statistics unreliable
    refs.pops.forEach(popName => {
      const pid = ws.popIdByName(popName);
      if (!pid) return;
      const thin = res.wells.filter(w => !w.excluded && w.group && w.group.role !== 'gate' && ws.count(w.sample, pid) < 200);
      if (thin.length) out.push({
        id: 'thin:' + pid, level: 'warning', kind: 'counts',
        title: thin.length + ' well' + (thin.length > 1 ? 's have' : ' has') + ' under 200 events in ' + popName,
        detail: thin.map(w => (w.well || w.key) + ' (' + ws.count(w.sample, pid) + ')').join(', ') + '. Means and gMFIs from so few events are noisy.',
        wells: thin.map(w => w.key),
      });
    });

    // 6. inconsistent stopping criteria
    const counts = res.wells.map(w => w.sample.n);
    if (counts.length >= 4) {
      const lo = Math.min(...counts), hi = Math.max(...counts);
      if (hi / lo > 1.5) out.push({
        id: 'events', level: 'info', kind: 'events',
        title: 'Event counts range ' + lo.toLocaleString() + '–' + hi.toLocaleString() + ' per well',
        detail: 'Wells were probably stopped on different criteria (event cap vs time cap). Percentages and gMFIs are unaffected, but statistical weight differs between wells.',
      });
    }

    const rank = { critical: 0, warning: 1, info: 2, done: 3, ok: 4 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  }

  function fmtNum(v) {
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e8 ? 0 : 2) + 'M';
    if (a >= 1e4) return (v / 1e3).toFixed(1) + 'K';
    if (a >= 100) return v.toFixed(0);
    if (a >= 1) return v.toFixed(2);
    return v.toPrecision(3);
  }
  function fmtP(p) {
    if (!Number.isFinite(p)) return '—';
    if (p < 0.001) return p.toExponential(1);
    return p < 0.01 ? p.toFixed(3) : p.toFixed(2);
  }

  // ----------------------------------------------------- publication style
  /* How significance is written in a paper. Stars always come from the multiplicity-adjusted
   * p-value, on a fixed scale that does not move with alpha (GraphPad FAQ 978/1871). APA and
   * NEJM stop at three stars; GraphPad goes to four. */
  const P_STYLES = {
    graphpad: { label: 'GraphPad', max: 4 },
    apa: { label: 'APA', max: 3 },
    nejm: { label: 'NEJM', max: 3 },
  };

  function pStyle(style) { return P_STYLES[style] ? style : 'graphpad'; }

  /** 'ns', '*', '**', '***' or '****' for an adjusted p-value. */
  function stars(p, style) {
    if (!Number.isFinite(p)) return '';
    const max = P_STYLES[pStyle(style)].max;
    if (max >= 4 && p <= 0.0001) return '****';
    if (p <= 0.001) return '***';
    if (p <= 0.01) return '**';
    if (p <= 0.05) return '*';
    return 'ns';
  }

  /** The star scale in words, for a figure legend. */
  function starScale(style) {
    const four = P_STYLES[pStyle(style)].max >= 4;
    return 'ns, p > 0.05; *, p ≤ 0.05; **, p ≤ 0.01; ***, p ≤ 0.001' + (four ? '; ****, p ≤ 0.0001' : '');
  }

  /** A p-value written the way the chosen style prints it: GraphPad 0.0123 / <0.0001,
   *  NEJM 0.012 / <0.001, APA .012 / <.001. */
  function fmtPpub(p, style) {
    if (!Number.isFinite(p)) return '—';
    style = pStyle(style);
    if (style === 'graphpad') {
      if (p < 0.0001) return '<0.0001';
      if (p > 0.9999) return '>0.9999';
      return p.toFixed(4);
    }
    const lead = style === 'apa' ? '' : '0';
    if (p < 0.001) return '<' + lead + '.001';
    if (p > 0.999) return '>' + lead + '.999';
    return lead + p.toFixed(3).slice(1);
  }

  /** One-sentence answer to "did anything change?", written from the numbers. */
  function headline(res) {
    const thr = res.threshold;
    const ctrl = res.control;
    if (!ctrl) return { level: 'info', text: 'Choose a reference control on the Plate step — results are fold-changes against it.' };
    const conds = res.groups.filter(x => x.group.role === 'sample' && x.summary.n > 0);
    if (!conds.length) return { level: 'info', text: 'Assign wells to conditions on the Plate step to compare them with ' + ctrl.name + '.' };
    const hits = conds.filter(x => x.verdict.key === 'up' || x.verdict.key === 'down');
    const pOf = name => { const p = res.pairs.find(q => (q.a === name && q.b === ctrl.name) || (q.b === name && q.a === ctrl.name)); return p ? p.p : NaN; };
    if (!hits.length) {
      const top = conds.reduce((a, b) => (Math.abs(Math.log(b.fold)) > Math.abs(Math.log(a.fold)) ? b : a));
      return {
        level: 'flat',
        text: 'No condition differs from ' + ctrl.name + ' by ' + thr + '× or more.',
        sub: 'The largest change is ' + top.group.name + ' at ' + fmtFold(top.fold) + (Number.isFinite(pOf(top.group.name)) ? ' (Tukey p = ' + fmtP(pOf(top.group.name)) + ')' : '') + '.',
      };
    }
    const parts = hits.map(x => x.group.name + ' ' + fmtFold(x.fold) + (x.verdict.key === 'down' ? ' (lower)' : ''));
    const weak = hits.filter(x => !(pOf(x.group.name) < 0.05));
    return {
      level: 'hit',
      text: hits.length === 1 ? parts[0] + ' — the only condition past ' + thr + '× vs ' + ctrl.name + '.' : parts.join(', ') + ' — past ' + thr + '× vs ' + ctrl.name + '.',
      sub: weak.length ? weak.map(x => x.group.name).join(', ') + (weak.length > 1 ? ' are' : ' is') + ' past the threshold but not statistically significant (Tukey p ≥ 0.05) — check replicates before calling it.' : 'All of these are also statistically significant (Tukey p < 0.05).',
    };
  }


  FM.analysis = { analyze, ols, verdict, fmtNum, fmtP, fmtFold, headline, stars, starScale, fmtPpub, pStyle, P_STYLES };
})(FM);
