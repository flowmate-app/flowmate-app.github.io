/* PlotMate namespace and small shared utilities. Everything in core/ is DOM-free. */
var PM = window.PM = window.PM || {};
(function (PM) {
  'use strict';

  PM.version = '0.1.0';
  PM.appName = 'PlotMate';
  /** How the software is cited in methods text. */
  PM.citation = 'PlotMate ' + PM.version + ' (BenchMate)';

  let seq = 0;
  /** Short unique id: prefix + time + counter, stable enough for sheet ids. */
  PM.uid = function (prefix) {
    seq = (seq + 1) % 1e6;
    return (prefix || 'id') + '_' + Date.now().toString(36) + seq.toString(36) + Math.floor(Math.random() * 1296).toString(36);
  };

  /** Deep copy of plain data (objects, arrays, numbers, strings, booleans, null, Sets). */
  PM.clone = function clone(v) {
    if (v == null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(clone);
    if (v instanceof Set) return new Set(Array.from(v, clone));
    if (ArrayBuffer.isView(v)) return v.slice();
    const o = {};
    for (const k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = clone(v[k]);
    return o;
  };

  /** True only for finite numbers (not NaN, not ±Infinity, not numeric strings). */
  PM.isNum = function (x) { return typeof x === 'number' && Number.isFinite(x); };

  PM.sum = function (a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
  PM.mean = function (a) { return a.length ? PM.sum(a) / a.length : NaN; };
  PM.range = function (n, start) { const r = new Array(n); for (let i = 0; i < n; i++) r[i] = (start || 0) + i; return r; };
  PM.clamp = function (x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; };

  /** Seeded PRNG (mulberry32) for reproducible sample data and Monte Carlo steps. */
  PM.rng = function (seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  /** Standard normal deviate from a uniform generator (Box–Muller). */
  PM.randn = function (u) {
    let a = 0, b = 0;
    while (a === 0) a = u();
    while (b === 0) b = u();
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
  };

  /** Tiny event emitter mixin. */
  PM.emitter = function (obj) {
    const ls = new Map();
    obj.on = function (ev, fn) { if (!ls.has(ev)) ls.set(ev, new Set()); ls.get(ev).add(fn); return () => ls.get(ev).delete(fn); };
    obj.emit = function (ev, detail) { (ls.get(ev) || []).forEach(fn => { try { fn(detail); } catch (e) { console.error(e); } }); (ls.get('*') || []).forEach(fn => { try { fn(ev, detail); } catch (e) { console.error(e); } }); };
    return obj;
  };
})(PM);
