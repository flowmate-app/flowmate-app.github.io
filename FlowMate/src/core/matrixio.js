/* Compensation matrix files, in and out.
 *
 * Reads: FlowJo matrix files (.mtx — XML, transforms:spilloverMatrix), Gating-ML 2.0
 * spectrumMatrix, CSV / TSV / plain text (a header row of parameter names, optionally a first column
 * of names, values as fractions or percent), and the FCS keyword form ("3,FL1-A,FL2-A,FL3-A,1,0.1,…").
 * Writes: FlowJo-compatible .mtx and CSV.
 *
 * Parameter names are matched to the loaded files' parameters exactly, then without FlowJo's
 * "Comp-" prefix or <> brackets, then by their $PnS label — and unmatched names are reported.
 * DOM-free (XML is read with core/xml.js).
 */
(function (FM) {
  'use strict';

  function MatrixError(msg) { const e = new Error(msg); e.name = 'MatrixError'; return e; }

  // ------------------------------------------------------------------ reading
  function fromXML(text) {
    const x = FM.xml;
    const doc = x.parse(text);
    const m = x.all(doc, 'spilloverMatrix')[0];
    if (m) {
      const params = x.all(x.kid(m, 'parameters'), 'parameter').map(p => x.attr(p, 'name'));
      const rows = {};
      x.kids(m, 'spillover').forEach(sp => {
        const r = {};
        x.kids(sp, 'coefficient').forEach(c => { r[x.attr(c, 'parameter')] = parseFloat(x.attr(c, 'value')); });
        rows[x.attr(sp, 'parameter')] = r;
      });
      const spill = params.map(a => params.map(b => { const v = rows[a] && rows[a][b]; return Number.isFinite(v) ? v : (a === b ? 1 : 0); }));
      return { name: x.attr(m, 'name') || 'Imported matrix', params, spill, format: 'FlowJo matrix' };
    }
    const g = x.all(doc, 'spectrumMatrix')[0];
    if (g) {
      const names = which => x.kids(x.kid(g, which), 'fcs-dimension').map(d => x.attr(d, 'name'));
      const params = names('detectors');
      const spill = x.kids(g, 'spectrum').map(row => x.kids(row, 'coefficient').map(c => parseFloat(x.attr(c, 'value'))));
      return { name: x.attr(g, 'id') || 'Imported matrix', params, spill, format: 'Gating-ML' };
    }
    throw MatrixError('This XML file has no compensation matrix in it (expected a FlowJo spilloverMatrix or a Gating-ML spectrumMatrix).');
  }

  function fromDelimited(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^#\s*$/.test(l));
    if (lines.length < 2) throw MatrixError('The file has fewer than two lines — it does not look like a matrix.');
    const sep = [/\t/, /;/, /,/].find(re => re.test(lines[0])) || /\s{2,}|\s/;
    const split = l => l.replace(/^#\s*/, '').split(sep).map(c => c.trim().replace(/^"(.*)"$/, '$1'));
    const isNum = c => c !== '' && Number.isFinite(Number(c));
    let rows = lines.map(split);
    let params = null;
    if (!rows[0].every(isNum)) { params = rows[0]; rows = rows.slice(1); }
    let rowNames = null;
    if (rows.length && !isNum(rows[0][0])) { rowNames = rows.map(r => r[0]); rows = rows.map(r => r.slice(1)); }
    if (params && rowNames && params.length === rows[0].length + 1) params = params.slice(1);      // an empty corner cell
    if (!params) params = rowNames;
    if (!params) throw MatrixError('The file has no parameter names: its first row (or first column) should name the detectors.');
    const k = params.length;
    if (rows.length !== k || rows.some(r => r.length !== k || !r.every(isNum))) throw MatrixError('The matrix is not square: ' + k + ' parameter names but ' + rows.length + ' rows of ' + (rows[0] || []).length + ' numbers.');
    let spill = rows.map(r => r.map(Number));
    // percent (diagonal 100) or fractions (diagonal 1)
    const diag = spill.map((r, i) => r[i]);
    if (diag.every(v => Math.abs(v - 100) < 1e-6)) spill = spill.map(r => r.map(v => v / 100));
    return { name: 'Imported matrix', params, spill, format: 'table' };
  }

  /** Text of a matrix file → { name, params, spill, format }, or throws with a plain reason. */
  function parse(text, fileName) {
    const t = String(text || '').replace(/^﻿/, '').trim();
    if (!t) throw MatrixError('The file is empty.');
    let m;
    if (t[0] === '<') m = fromXML(t);
    else if (/^\d+\s*,/.test(t) && !/\n/.test(t.trim())) {
      const s = FM.fcs.parseSpillover(t);
      if (!s) throw MatrixError('This looks like an FCS spillover keyword, but it could not be read.');
      m = { name: 'Imported matrix', params: s.params, spill: s.matrix, format: 'FCS keyword' };
    } else m = fromDelimited(t);
    if (!m.params.length) throw MatrixError('The matrix has no parameters.');
    m.spill.forEach((r, i) => { if (Math.abs(r[i] - 1) > 1e-6) throw MatrixError('The diagonal should be 1 (or 100%): ' + m.params[i] + ' has ' + r[i] + '.'); });
    if (fileName && m.name === 'Imported matrix') m.name = String(fileName).replace(/\.[a-z0-9]+$/i, '');
    return m;
  }

  /**
   * Match a matrix's parameter names to the workspace's: exact, without "Comp-" / <brackets>, or by
   * $PnS label (also "label name"). → { params (workspace names), unmatched: [names] }
   */
  function matchParams(ws, names) {
    const all = ws.paramNames();
    const low = s => String(s).toLowerCase().trim();
    const bare = s => low(s).replace(/^<|>$/g, '').replace(/^comp-/, '');
    const byLabel = {};
    all.forEach(p => {
      const lab = (ws.paramInfo(p).label || '').replace(/__/g, '/');
      if (lab) { byLabel[low(lab)] = p; byLabel[low(lab + ' ' + p)] = p; }
    });
    const params = [], unmatched = [];
    names.forEach(n => {
      const hit = all.find(p => p === n) || all.find(p => low(p) === bare(n)) || byLabel[low(n)] || byLabel[bare(n)];
      if (hit) params.push(hit); else { params.push(null); unmatched.push(n); }
    });
    return { params, unmatched };
  }

  // ------------------------------------------------------------------ writing
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const num = v => String(+Number(v).toPrecision(10));

  /** A FlowJo-compatible matrix file (.mtx): an XML transforms:spilloverMatrix. */
  function toMTX(m) {
    const id = 'flowmate-' + Math.random().toString(36).slice(2, 10);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gating:gatingML xmlns:gating="http://www.isac-net.org/std/Gating-ML/v2.0/gating" xmlns:transforms="http://www.isac-net.org/std/Gating-ML/v2.0/transformations" xmlns:data-type="http://www.isac-net.org/std/Gating-ML/v2.0/datatypes">\n' +
      '<transforms:spilloverMatrix spectral="0" prefix="Comp-" name="' + esc(m.name) + '" editable="1" color="' + esc(m.color || '#4c3fb3') + '" version="FlowMate-' + esc(FM.version) + '" status="FINALIZED" transforms:id="' + id + '" suffix="">\n' +
      '<data-type:parameters>\n' + m.params.map(p => '<data-type:parameter data-type:name="' + esc(p) + '" userProvidedCompInfix="Comp-' + esc(p) + '"/>\n').join('') + '</data-type:parameters>\n' +
      m.params.map((p, i) => '<transforms:spillover data-type:parameter="' + esc(p) + '" userProvidedCompInfix="Comp-' + esc(p) + '">\n' +
        m.params.map((q, j) => '<transforms:coefficient data-type:parameter="' + esc(q) + '" transforms:value="' + num(m.spill[i][j]) + '"/>\n').join('') + '</transforms:spillover>\n').join('') +
      '</transforms:spilloverMatrix>\n</gating:gatingML>\n';
  }

  /** CSV: a header row of parameter names, then one row of spillover fractions per parameter. */
  function toCSV(m) {
    const q = s => (/[",\n]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : s);
    return [m.params.map(q).join(',')].concat(m.spill.map(r => r.map(num).join(','))).join('\r\n') + '\r\n';
  }

  FM.matrixio = { parse, matchParams, toMTX, toCSV };
})(FM);
