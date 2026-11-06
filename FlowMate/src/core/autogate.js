/* Gate suggestions and the "what next" guide.
 *
 * suggest() reads the plot's axes to decide what kind of gate is wanted, then proposes one
 * computed from the plotted population pooled across wells:
 *   cells     scatter × scatter        main density basin (debris passed over), convex hull
 *   singlets  X-A × X-H (or width)     H/A ratio band, lower edge at the doublet valley
 *   positive  fluorescence axis        gate-control 99.5th percentile, else the valley between peaks
 *   quadrant  fluorescence × fluor.    both thresholds
 * Every suggestion is an ordinary gate spec the user accepts, adjusts or discards.
 */
(function (FM) {
  'use strict';
  const T = FM.transforms;

  // ------------------------------------------------------------ channel kinds
  const isScatter = p => /^(FSC|SSC|FS|SS)(?=[-_ ]|$)/i.test(p) || /SCATTER/i.test(p);
  const isTime = p => /^TIME/i.test(p);
  const suffix = p => { const m = /[-_ ]?(A|H|W|AREA|HEIGHT|WIDTH)$/i.exec(p); return m ? m[1].toUpperCase()[0] : ''; };
  const family = p => String(p).replace(/[-_ ]?(A|H|W|AREA|HEIGHT|WIDTH)$/i, '').toUpperCase();
  const isFluor = p => !isScatter(p) && !isTime(p) && suffix(p) !== 'W';
  const short = p => String(p).replace(/[-_ ]?[AHW]$/, '');

  function intent(x, y) {
    if (!y) return isFluor(x) ? 'positive' : 'range';
    if (family(x) === family(y) && suffix(x) && suffix(y) && suffix(x) !== suffix(y)) return 'singlets';
    if (isScatter(x) && isScatter(y)) return 'cells';
    if (isFluor(x) && isFluor(y)) return 'quadrant';
    return 'positive';
  }

  // ----------------------------------------------------------------- pooling
  /** Display-space coordinates of the population pooled across (non-excluded) wells. */
  function pooledXY(ws, popId, x, y, xSpec, ySpec, cap) {
    cap = cap || 50000;
    const S = ws.samples.filter(s => !ws.wellInfo(s.key).excluded && s.data[x] && (!y || s.data[y]));
    const xs = [], ys = [];
    const per = Math.max(300, Math.floor(cap / Math.max(1, S.length)));
    S.forEach(s => {
      const idx = ws.indices(s, popId);
      const dx = T.displayColumn(s, x, xSpec);
      const dy = y ? T.displayColumn(s, y, ySpec) : null;
      const step = Math.max(1, Math.floor(idx.length / per));
      for (let i = 0; i < idx.length; i += step) {
        const e = idx[i];
        const tx = dx[e], ty = dy ? dy[e] : 0;
        if (tx === tx && ty === ty) { xs.push(tx); ys.push(ty); }
      }
    });
    return { xs, ys, n: xs.length };
  }

  function blur2d(src, G, r) {
    const tmp = new Float64Array(src.length), out = new Float64Array(src.length);
    for (let yy = 0; yy < G; yy++) for (let xx = 0; xx < G; xx++) {
      let s = 0, c = 0;
      for (let k = -r; k <= r; k++) { const q = xx + k; if (q >= 0 && q < G) { s += src[yy * G + q]; c++; } }
      tmp[yy * G + xx] = s / c;
    }
    for (let xx = 0; xx < G; xx++) for (let yy = 0; yy < G; yy++) {
      let s = 0, c = 0;
      for (let k = -r; k <= r; k++) { const q = yy + k; if (q >= 0 && q < G) { s += tmp[q * G + xx]; c++; } }
      out[yy * G + xx] = s / c;
    }
    return out;
  }

  function smooth1d(c, sigma) {
    const r = Math.ceil(sigma * 3), k = [];
    for (let i = -r; i <= r; i++) k.push(Math.exp(-i * i / (2 * sigma * sigma)));
    return c.map((_, i) => {
      let s = 0, w = 0;
      for (let j = -r; j <= r; j++) { const q = i + j; if (q >= 0 && q < c.length) { s += c[q] * k[j + r]; w += k[j + r]; } }
      return s / w;
    });
  }

  // ------------------------------------------------------------ convex hull
  function hull(points) {
    const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    p.forEach(pt => { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop(); lower.push(pt); });
    for (let i = p.length - 1; i >= 0; i--) { const pt = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop(); upper.push(pt); }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  /** Reduce a convex polygon to `n` vertices by dropping the vertex whose triangle is smallest,
   *  then push the survivors outward so the simplified shape still contains the original. */
  function simplify(poly, n) {
    const pts = poly.slice();
    const area = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    while (pts.length > n) {
      let best = 0, bestA = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const A = area(pts[(i - 1 + pts.length) % pts.length], pts[i], pts[(i + 1) % pts.length]);
        if (A < bestA) { bestA = A; best = i; }
      }
      pts.splice(best, 1);
    }
    return pts;
  }

  function expand(poly, f) {
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    return poly.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f]);
  }

  // ---------------------------------------------------------------- cells
  function cellsPolygon(xs, ys) {
    const G = 72;
    const counts = new Float64Array(G * G);
    for (let i = 0; i < xs.length; i++) {
      const tx = xs[i], ty = ys[i];
      if (tx < 0 || tx > 1 || ty < 0 || ty > 1) continue;
      counts[Math.min(G - 1, Math.floor(ty * G)) * G + Math.min(G - 1, Math.floor(tx * G))]++;
    }
    const d = blur2d(blur2d(counts, G, 2), G, 1);
    const maxD = d.reduce((a, b) => Math.max(a, b), 0);
    if (!(maxD > 0)) return null;
    // steepest-ascent labelling: every cell belongs to the density peak it climbs to
    const label = new Int32Array(G * G).fill(-1);
    const climb = (i) => {
      const path = [];
      let cur = i;
      while (label[cur] === -1) {
        path.push(cur);
        const cx = cur % G, cy = (cur / G) | 0;
        let best = cur, bv = d[cur];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
          const q = ny * G + nx;
          if (d[q] > bv) { bv = d[q]; best = q; }
        }
        if (best === cur) { label[cur] = cur; break; }
        cur = best;
      }
      const root = label[cur];
      path.forEach(p => { label[p] = root; });
      return root;
    };
    const mass = new Map();
    for (let i = 0; i < G * G; i++) {
      if (d[i] < maxD * 1e-4) continue;
      const r = climb(i);
      mass.set(r, (mass.get(r) || 0) + counts[i]);
    }
    // the cell population is the heaviest basin; debris piles against the origin
    const peaks = [...mass.entries()].map(([p, m]) => ({ p, m, tx: (p % G + 0.5) / G, ty: (((p / G) | 0) + 0.5) / G }))
      .filter(o => o.m > 0).sort((a, b) => b.m - a.m);
    if (!peaks.length) return null;
    const nonDebris = peaks.filter(o => !(o.tx < 0.12 && o.ty < 0.12));
    const pick = (nonDebris.length && nonDebris[0].m > 0.15 * peaks[0].m) ? nonDebris[0] : peaks[0];
    // merge neighbouring minor basins that belong to the same blob (saddle higher than 30% of the peak)
    const peakD = d[pick.p];
    const members = new Set([pick.p]);
    peaks.forEach(o => {
      if (o === pick || (o.tx < 0.12 && o.ty < 0.12)) return;
      if (d[o.p] > 0.3 * peakD && Math.hypot(o.tx - pick.tx, o.ty - pick.ty) < 0.25) members.add(o.p);
    });
    const tau = 0.035 * peakD;
    const pts = [];
    const h = 0.5 / G;
    for (let i = 0; i < G * G; i++) {
      if (!members.has(label[i]) || d[i] < tau) continue;
      const cx = (i % G + 0.5) / G, cy = (((i / G) | 0) + 0.5) / G;
      pts.push([cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]);
    }
    if (pts.length < 12) return null;
    let poly = hull(pts);
    poly = expand(simplify(poly, 8), 1.07);
    return poly.map(([x, y]) => [Math.max(-0.02, Math.min(1.02, x)), Math.max(-0.02, Math.min(1.02, y))]);
  }

  // -------------------------------------------------------------- thresholds
  /** Smoothed display-space histogram of the pooled population. */
  function histogram(ws, popId, param, spec, B) {
    const { xs } = pooledXY(ws, popId, param, null, spec, null);
    const c = new Array(B).fill(0);
    xs.forEach(t => { if (t >= 0 && t <= 1) c[Math.min(B - 1, Math.floor(t * B))]++; });
    return { s: smooth1d(c, 2.5), n: xs.length };
  }

  /** Centre of the emptiest stretch between bin `from` and bin `to` (display units). */
  function valleyCentre(s, from, to, B) {
    let mi = from;
    for (let i = from; i <= to; i++) if (s[i] < s[mi]) mi = i;
    const tol = s[mi] + 0.02 * Math.max(s[from], s[to]);
    let a = mi, b = mi;
    while (a - 1 >= from && s[a - 1] <= tol) a--;
    while (b + 1 <= to && s[b + 1] <= tol) b++;
    return (a + b + 1) / 2 / B;
  }

  /**
   * Threshold on `param` for "positive". With a gate control, its 99.5th percentile is the
   * floor and the cut goes in the middle of the empty valley above it (pooled over all wells,
   * so one well whose negatives sit higher doesn't leak in). Without one, the valley between
   * the two main peaks.
   */
  function threshold(ws, popId, param, spec) {
    const sc = T.makeScale(spec);
    const B = 160;
    const gcs = ws.doc.groups.filter(g => g.role === 'gate');
    const ctl = [];
    gcs.forEach(g => ws.samplesIn(g.id).forEach(s => {
      if (ws.wellInfo(s.key).excluded || !s.data[param]) return;
      const idx = ws.indices(s, popId);
      const col = s.data[param];
      for (let i = 0; i < idx.length; i++) { const v = col[idx[i]]; if (Number.isFinite(v)) ctl.push(v); }
    }));
    const { s, n } = histogram(ws, popId, param, spec, B);
    if (n < 100) return null;
    const isPeak = i => i > 0 && i < B - 1 && s[i] >= s[i - 1] && s[i] > s[i + 1];

    if (ctl.length >= 150) {
      ctl.sort((a, b) => a - b);
      const q = T.quantile(ctl, 0.995);
      const from = Math.max(0, Math.min(B - 2, Math.floor(sc.fwd(q) * B)));
      let pk = -1;
      for (let i = from + 1; i < B - 1; i++) if (isPeak(i) && (pk < 0 || s[i] > s[pk])) pk = i;
      const names = gcs.map(g => g.name).join(', ');
      if (pk > from + 2 && s[pk] > 0.02 * Math.max(...s)) {
        return { value: sc.inv(valleyCentre(s, from, pk, B)), source: 'control',
          detail: 'in the empty valley above the gate control (' + names + ', 99.5th percentile ' + T.siLabel(q) + ')' };
      }
      return { value: sc.inv(sc.fwd(q) + 0.01), source: 'control',
        detail: 'just above the 99.5th percentile of the gate control (' + names + ')' };
    }
    const top = Math.max(...s);
    const peaks = [];
    for (let i = 1; i < B - 1; i++) if (isPeak(i) && s[i] > 0.04 * top) peaks.push(i);
    const real = peaks.filter(p => peaks.filter(q => q !== p).every(q => {
      const lo = Math.min(p, q), hi = Math.max(p, q);
      return Math.min(...s.slice(lo, hi + 1)) < 0.6 * Math.min(s[p], s[q]);
    }));
    if (real.length < 2) return null;
    real.sort((a, b) => s[b] - s[a]);
    const a = Math.min(real[0], real[1]), b = Math.max(real[0], real[1]);
    return { value: sc.inv(valleyCentre(s, a, b, B)), source: 'valley', detail: 'in the valley between the negative and positive populations' };
  }

  // ------------------------------------------------------------------ suggest
  const BEYOND_LO = -0.35, BEYOND_HI = 1.35;

  function pctOf(ws, gate, parent) {
    // share of the pooled population inside the proposal, for the explanation
    let inside = 0, total = 0;
    ws.samples.forEach(s => {
      if (ws.wellInfo(s.key).excluded) return;
      const par = ws.indices(s, parent);
      if (!par.length) return;
      total += par.length;
      if (gate.type === 'quad') return;
      inside += FM.gating.filter(gate, s, par).length;
    });
    return total ? 100 * inside / total : NaN;
  }

  /**
   * Propose a gate for the plot of `popId` on (x, y). Returns
   * { kind, gate, explain, pct } or { error } when nothing sensible can be proposed.
   */
  function suggest(ws, popId, x, y) {
    const xSpec = ws.viewScale(popId, x), ySpec = y ? ws.viewScale(popId, y) : null;
    const xs = T.makeScale(xSpec), ys = ySpec ? T.makeScale(ySpec) : null;
    const kind = intent(x, y);
    const base = { parent: popId || null, x, y: y || null, xScale: JSON.parse(JSON.stringify(xSpec)), yScale: ySpec ? JSON.parse(JSON.stringify(ySpec)) : null };
    const out = (gate, explain) => {
      gate.name = ws.uniqueGateName(gate.name);
      return { kind, gate, explain, pct: pctOf(ws, gate, popId) };
    };

    if (kind === 'cells') {
      const p = pooledXY(ws, popId, x, y, xSpec, ySpec);
      if (p.n < 200) return { error: 'Too few events here to find a population.' };
      const poly = cellsPolygon(p.xs, p.ys);
      if (!poly) return { error: 'No clear cell population on these axes — draw the gate by hand.' };
      return out(Object.assign({ type: 'polygon', name: popId ? 'Cells' : 'Cells', verts: poly.map(([tx, ty]) => [xs.inv(tx), ys.inv(ty)]) }, base),
        'the main population on ' + x + ' × ' + y + ', debris and outliers left out');
    }

    if (kind === 'singlets') {
      const sx = suffix(x), sy = suffix(y);
      const S = ws.samples.filter(s => !ws.wellInfo(s.key).excluded);
      if (sx === 'W' || sy === 'W') {
        // width vs height/area: singlets have the ordinary width, doublets are wider
        const wp = sx === 'W' ? x : y;
        const vals = FM.autofit.pooled(ws, popId, wp);
        if (vals.length < 200) return { error: 'Too few events here.' };
        const med = T.quantile(vals, 0.5);
        const mad = 1.4826 * T.quantile(vals.map(v => Math.abs(v - med)).sort((a, b) => a - b), 0.5);
        const lo = T.quantile(vals, 0.001), hi = med + 3 * mad;
        const other = wp === x ? y : x;
        const os = T.makeScale(wp === x ? ySpec : xSpec);
        const rect = wp === x ? { x0: lo, x1: hi, y0: os.inv(BEYOND_LO), y1: os.inv(BEYOND_HI) } : { x0: os.inv(BEYOND_LO), x1: os.inv(BEYOND_HI), y0: lo, y1: hi };
        return out(Object.assign({ type: 'rect', name: 'Singlets', rect }, base), 'events of ordinary ' + wp + ' (up to median + 3 MAD); doublets are wider — ' + other + ' unrestricted');
      }
      // A vs H: the singlet diagonal is H ≈ r·A with r near the population median
      const aP = sx === 'A' ? x : y, hP = sx === 'A' ? y : x;
      const r = [];
      S.forEach(s => {
        const idx = ws.indices(s, popId), A = s.data[aP], H = s.data[hP];
        if (!A || !H) return;
        const step = Math.max(1, Math.floor(idx.length / 4000));
        for (let i = 0; i < idx.length; i += step) { const a = A[idx[i]], hh = H[idx[i]]; if (a > 0 && hh > 0) r.push(hh / a); }
      });
      if (r.length < 200) return { error: 'Too few events here.' };
      r.sort((a, b) => a - b);
      const med = T.quantile(r, 0.5);
      // spread of singlets from the upper half only: doublets smear the ratio downwards and
      // would inflate a symmetric MAD until the gate excluded nothing
      let mad = (T.quantile(r, 0.75) - med) / 0.6745;
      if (!(mad > 0)) mad = 1.4826 * T.quantile(r.map(v => Math.abs(v - med)).sort((a, b) => a - b), 0.5);
      // look for the doublet valley below the singlet peak
      const B = 140, lo0 = Math.max(0, med - 6 * mad), hi0 = med + 4 * mad;
      const c = new Array(B).fill(0);
      r.forEach(v => { if (v >= lo0 && v < hi0) c[Math.floor((v - lo0) / (hi0 - lo0) * B)]++; });
      const s = smooth1d(c, 2);
      const peak = s.indexOf(Math.max(...s));
      let rLo = med - 3 * mad, how = '3 singlet-widths below the median H/A ratio';
      let vi = peak;
      for (let i = peak; i >= 0; i--) if (s[i] < s[vi]) vi = i;
      const rise = Math.max(...s.slice(0, vi + 1));
      if (vi > 2 && s[vi] < 0.35 * s[peak] && rise > 1.25 * s[vi] + 1) {
        rLo = lo0 + (vi + 0.5) / B * (hi0 - lo0);
        how = 'the valley between singlets and doublets in the H/A ratio';
      }
      rLo = Math.max(med - 6 * mad, Math.min(med - 1.5 * mad, rLo));
      const rHi = med + 3.5 * mad;
      // band along the diagonal, sampled so it stays true on non-linear axes
      const ax = T.makeScale(aP === x ? xSpec : ySpec);
      const aMin = Math.max(ax.inv(0.01), T.quantile(r.length ? FM.autofit.pooled(ws, popId, aP) : [1], 0.001) / 2, 1e-9);
      const aMax = ax.inv(BEYOND_HI);
      const line = (ratio, reverse) => {
        const out = [];
        for (let k = 0; k <= 8; k++) {
          const u = reverse ? 1 - k / 8 : k / 8;
          const a = aMin * Math.pow(aMax / aMin, u);
          const hh = a * ratio;
          out.push(aP === x ? [a, hh] : [hh, a]);
        }
        return out;
      };
      const verts = xSpec.type === 'lin' && ySpec.type === 'lin'
        ? [[aMin, aMin * rLo], [aMax, aMax * rLo], [aMax, aMax * rHi], [aMin, aMin * rHi]].map(([a, hh]) => (aP === x ? [a, hh] : [hh, a]))
        : line(rLo, false).concat(line(rHi, true));
      return out(Object.assign({ type: 'polygon', name: 'Singlets', verts }, base),
        'the ' + short(aP) + ' diagonal: ' + hP + '/' + aP + ' from ' + rLo.toFixed(2) + ' to ' + rHi.toFixed(2) + ', lower edge at ' + how);
    }

    if (kind === 'quadrant') {
      const tx = threshold(ws, popId, x, xSpec), ty = threshold(ws, popId, y, ySpec);
      if (!tx || !ty) return { error: 'Could not find a positive threshold on ' + (!tx ? x : y) + ' — mark a gate control on the Plate step, or place the quadrant by hand (Q).' };
      return { kind, gate: Object.assign({ type: 'quad', name: 'Quadrant', quad: { cx: tx.value, cy: ty.value } }, base), pct: NaN,
        explain: x + ' split ' + tx.detail + '; ' + y + ' split ' + ty.detail };
    }

    if (kind === 'positive') {
      const fl = !y || isFluor(x) ? x : y;
      const flSpec = fl === x ? xSpec : ySpec;
      const t = threshold(ws, popId, fl, flSpec);
      if (!t) return { error: 'No clear positive population on ' + fl + ' — mark a gate control on the Plate step so the threshold can come from it, or draw the gate by hand.' };
      const fs = T.makeScale(flSpec);
      const top = fs.inv(BEYOND_HI);
      if (!y) return out(Object.assign({ type: 'range', name: short(fl) + '+', range: { lo: t.value, hi: top } }, base), fl + ' positive, ' + t.detail);
      const other = fl === x ? ys : xs;
      const rect = fl === x ? { x0: t.value, x1: top, y0: other.inv(BEYOND_LO), y1: other.inv(BEYOND_HI) }
        : { x0: other.inv(BEYOND_LO), x1: other.inv(BEYOND_HI), y0: t.value, y1: top };
      return out(Object.assign({ type: 'rect', name: short(fl) + '+', rect }, base), fl + ' positive, ' + t.detail);
    }
    return { error: 'Pick two axes (or a fluorescence histogram) to get a suggestion.' };
  }

  // ------------------------------------------------------------------ next steps
  /** Axis pairs worth plotting inside `gateId`, most likely first. */
  function nextSteps(ws, gateId) {
    const params = ws.paramNames();
    const chain = gateId ? ws.gatePath(gateId) : [];
    const has = k => chain.some(g => g.x && intent(g.x, g.y) === k);
    const out = [];
    const pick = (fam, suf) => params.find(p => family(p) === fam && suffix(p) === suf);
    if (!has('cells') && !chain.length) {
      const fx = pick('FSC', 'A') || pick('FSC', 'H'), sy = pick('SSC', 'A') || pick('SSC', 'H');
      if (fx && sy) out.push({ label: 'Cells', sub: fx + ' × ' + sy, x: fx, y: sy });
    }
    if (!has('singlets')) {
      ['FSC', 'SSC'].forEach(fam => {
        const a = pick(fam, 'A'), hh = pick(fam, 'H');
        if (a && hh) out.push({ label: 'Singlets', sub: a + ' × ' + hh, x: a, y: hh });
      });
    }
    const fls = params.filter(isFluor);
    const fams = [...new Set(fls.map(family))];
    const scatterFor = p => pick('FSC', suffix(p)) || pick('FSC', 'H') || pick('FSC', 'A') || params.find(isScatter);
    // with one or two colours show both height and area read-outs; with many, one per colour
    const usedSuffix = chain.filter(g => g.x).map(g => [g.x, g.y]).flat().filter(Boolean).map(suffix).find(s => s === 'H' || s === 'A') || 'H';
    const variants = f => {
      const all = fls.filter(p => family(p) === f).sort((a, b) => (suffix(b) === 'H') - (suffix(a) === 'H'));
      return fams.length <= 2 ? all : [all.find(p => suffix(p) === usedSuffix) || all[0]];
    };
    fams.slice(0, 4).forEach((f, fi) => {
      const vs = variants(f);
      vs.forEach(p => { const sy = scatterFor(p); if (sy) out.push({ label: short(p), sub: p + ' × ' + sy, x: p, y: sy }); });
      if (fi === 0 && vs[0]) out.push({ label: short(vs[0]) + ' histogram', sub: vs[0], x: vs[0], y: null });
    });
    if (fams.length >= 2) {
      const a2 = variants(fams[0])[0], b2 = variants(fams[1])[0];
      out.push({ label: short(a2) + ' × ' + short(b2), sub: 'quadrant', x: a2, y: b2 });
    }
    return out.slice(0, 6);
  }

  FM.autogate = { suggest, nextSteps, intent, threshold, isFluor, isScatter, family, suffix, cellsPolygon };
})(FM);
