/* BenchMate hand-off: how one BenchMate app passes tables to another (FlowMate → PlotMate).
 *
 * One source, inlined by every app's build, defines the payload:
 *
 *   { benchmate: 'handoff/1', from: 'FlowMate 0.2.0', created: ISO time, title?,
 *     tables: [{ kind: 'column' | 'grouped' | 'multivar', title, notes?,
 *                sets: [{ title, values: [number | string | null] }], rowTitles?: [string] }],
 *     suggest: [{ table: index, analysis: registry id, params: {…}, graph?: 'scatter' | 'bar',
 *                 brackets?: 'all' | 'significant' }] }
 *
 * It travels as clipboard text (the JSON, starting {"benchmate":"handoff/1") or as a .plotmate
 * file with the same text. Nothing goes through a server or shared storage.
 */
(function (root) {
  'use strict';
  const MARK = 'handoff/1';
  const KINDS = ['column', 'grouped', 'multivar', 'xy', 'contingency', 'survival', 'parts', 'nested'];

  function cleanValue(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    return String(v);
  }

  /** A payload from {from, title, tables, suggest}; throws on tables that make no sense. */
  function make(o) {
    o = o || {};
    const tables = (o.tables || []).map((t, i) => {
      if (KINDS.indexOf(t.kind) < 0) throw new Error('Table ' + (i + 1) + ': unknown kind ' + t.kind);
      if (!Array.isArray(t.sets) || !t.sets.length) throw new Error('Table ' + (i + 1) + ' has no data sets');
      const out = { kind: t.kind, title: String(t.title || 'Data ' + (i + 1)), sets: t.sets.map(s => ({ title: String(s.title || ''), values: (s.values || []).map(cleanValue) })) };
      if (t.rowTitles) out.rowTitles = t.rowTitles.map(x => x == null ? '' : String(x));
      if (t.notes) out.notes = String(t.notes);
      return out;
    });
    const suggest = (o.suggest || []).filter(s => s && Number.isInteger(s.table) && s.table >= 0 && s.table < tables.length).map(s => {
      const out = { table: s.table };
      if (s.analysis) { out.analysis = String(s.analysis); out.params = s.params || {}; }
      if (s.graph) out.graph = s.graph;
      if (s.brackets) out.brackets = s.brackets;
      return out;
    });
    const p = { benchmate: MARK, from: String(o.from || 'BenchMate'), created: new Date().toISOString(), tables, suggest };
    if (o.title) p.title = String(o.title);
    return p;
  }

  /** Clipboard / file text; the marker comes first so a paste can be recognised at once. */
  function toClipboardText(p) {
    const ordered = Object.assign({ benchmate: MARK }, p);
    return JSON.stringify(ordered);
  }

  /** Does this text look like a hand-off? (cheap: looks at the first characters only) */
  function detect(text) { return /^\s*\{\s*"benchmate"\s*:\s*"handoff\/\d/.test(String(text || '').slice(0, 64)); }

  /** The payload in a text, or null if it is not one (or is malformed). */
  function parse(text) {
    if (!detect(text)) return null;
    let o;
    try { o = JSON.parse(text); } catch (_) { return null; }
    if (!o || typeof o.benchmate !== 'string' || o.benchmate.indexOf('handoff/') !== 0) return null;
    if (+o.benchmate.split('/')[1] > 1) return Object.assign(o, { tooNew: true });
    if (!Array.isArray(o.tables)) return null;
    try { return Object.assign(make(o), { from: o.from, created: o.created || new Date().toISOString() }); } catch (_) { return null; }
  }

  root.BMH = { MARK, KINDS, make, toClipboardText, detect, parse };
})(typeof window !== 'undefined' ? window : globalThis);
