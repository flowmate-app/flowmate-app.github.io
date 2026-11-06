/* FCS 2.0 / 3.0 / 3.1 reader.
 *
 * Produces a columnar sample: one Float32Array per parameter, plus parsed TEXT metadata.
 * Handles $DATATYPE F / D / I, both byte orders, integer bit-masking by $PnR,
 * $PnE log amplification and $PnG gain, header offsets of 0 (large files), and
 * escaped (doubled) delimiters in the TEXT segment.
 */
(function (FM) {
  'use strict';

  function FCSError(msg) { const e = new Error(msg); e.name = 'FCSError'; return e; }

  function decodeText(bytes) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (_) { return new TextDecoder('latin1').decode(bytes); }
  }

  /** Split a TEXT segment into key/value pairs. The first char is the delimiter;
   *  a doubled delimiter inside a key or value is a literal delimiter character. */
  function parseText(text) {
    const delim = text[0];
    const tokens = [];
    let cur = '';
    let i = 1;
    while (i < text.length) {
      const ch = text[i];
      if (ch === delim) {
        if (text[i + 1] === delim) { cur += delim; i += 2; continue; }
        tokens.push(cur); cur = ''; i += 1; continue;
      }
      cur += ch; i += 1;
    }
    if (cur.length) tokens.push(cur);
    const meta = {};
    for (let k = 0; k + 1 < tokens.length; k += 2) {
      meta[tokens[k].trim().toUpperCase()] = tokens[k + 1].trim();
    }
    return meta;
  }

  function int(s, dflt) {
    const v = parseInt(String(s == null ? '' : s).trim(), 10);
    return Number.isFinite(v) ? v : dflt;
  }

  function parseHeader(bytes) {
    const h = new TextDecoder('latin1').decode(bytes.subarray(0, 58));
    const version = h.substring(0, 6);
    if (!/^FCS[23]\.\d/.test(version)) throw FCSError('Not an FCS file (header is "' + version.replace(/[^\x20-\x7e]/g, '?') + '")');
    const f = (a, b) => int(h.substring(a, b), 0);
    return {
      version,
      textBegin: f(10, 18), textEnd: f(18, 26),
      dataBegin: f(26, 34), dataEnd: f(34, 42),
    };
  }

  function nextPow2Mask(range) {
    if (!(range > 0)) return 0xffffffff;
    let bits = Math.ceil(Math.log2(range));
    if (bits >= 32) return 0xffffffff;
    return (Math.pow(2, bits) - 1) >>> 0;
  }

  /** Parse a spillover keyword "n,p1..pn,v11..vnn" into {params, matrix}. */
  function parseSpillover(s) {
    if (!s) return null;
    const parts = s.split(',').map(x => x.trim());
    const n = int(parts[0], 0);
    if (!(n > 0) || parts.length < 1 + n + n * n) return null;
    const params = parts.slice(1, 1 + n);
    const vals = parts.slice(1 + n, 1 + n + n * n).map(Number);
    if (vals.some(v => !Number.isFinite(v))) return null;
    const matrix = [];
    for (let r = 0; r < n; r++) matrix.push(vals.slice(r * n, r * n + n));
    return { params, matrix };
  }

  function isIdentity(m) {
    for (let r = 0; r < m.length; r++)
      for (let c = 0; c < m.length; c++)
        if (Math.abs(m[r][c] - (r === c ? 1 : 0)) > 1e-12) return false;
    return true;
  }

  /** Parse a $BTIM / $DATE pair into ms since epoch (local), or null. */
  function parseAcqTime(meta) {
    const t = meta['$BTIM'];
    if (!t) return null;
    const m = /^(\d{1,2}):(\d{2}):(\d{2})(?:[.:](\d+))?/.exec(t);
    if (!m) return null;
    let secs = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    if (m[4]) {
      // FCS 3.0: hh:mm:ss:tt is 1/60 s; FCS 3.1: hh:mm:ss.cc is 1/100 s
      secs += t.includes('.') ? (+m[4]) / Math.pow(10, m[4].length) : (+m[4]) / 60;
    }
    let dayMs = 0;
    const d = meta['$DATE'];
    const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
    if (d) {
      const dm = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(d.trim());
      if (dm) {
        let y = +dm[3]; if (y < 100) y += 2000;
        const mo = MONTHS[dm[2].toUpperCase()];
        if (mo != null) dayMs = new Date(y, mo, +dm[1]).getTime();
      }
    }
    return dayMs + secs * 1000;
  }

  /**
   * Parse an FCS file.
   * @param {ArrayBuffer} buffer
   * @param {string} name  file name, used for display and well detection
   * @returns {{name, version, meta, params, n, data, spill, acqTime}}
   */
  function parse(buffer, name) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 58) throw FCSError('File too small to be FCS');
    const hdr = parseHeader(bytes);
    if (!(hdr.textEnd > hdr.textBegin)) throw FCSError('Missing TEXT segment');
    const meta = parseText(decodeText(bytes.subarray(hdr.textBegin, hdr.textEnd + 1)));

    let dataBegin = hdr.dataBegin, dataEnd = hdr.dataEnd;
    if (dataBegin === 0 || dataEnd === 0) {
      dataBegin = int(meta['$BEGINDATA'], 0);
      dataEnd = int(meta['$ENDDATA'], 0);
    }
    const npar = int(meta['$PAR'], 0);
    const ntot = int(meta['$TOT'], 0);
    if (!(npar > 0)) throw FCSError('$PAR missing or zero');
    const mode = (meta['$MODE'] || 'L').toUpperCase();
    if (mode !== 'L') throw FCSError('Only list-mode ($MODE L) data is supported, found ' + mode);
    const dtype = (meta['$DATATYPE'] || '').toUpperCase();
    const byteord = (meta['$BYTEORD'] || '1,2,3,4').replace(/\s/g, '');
    const little = byteord === '1,2,3,4' || byteord === '1,2';
    if (!little && byteord !== '4,3,2,1' && byteord !== '2,1')
      throw FCSError('Unsupported byte order ' + byteord);

    const params = [];
    for (let i = 1; i <= npar; i++) {
      const pn = meta['$P' + i + 'N'] || ('P' + i);
      const ps = meta['$P' + i + 'S'] || '';
      const range = Number(meta['$P' + i + 'R']) || 0;
      const bits = int(meta['$P' + i + 'B'], dtype === 'D' ? 64 : 32);
      const eParts = (meta['$P' + i + 'E'] || '0,0').split(',').map(Number);
      const gain = Number(meta['$P' + i + 'G']) || 1;
      const disp = (meta['P' + i + 'DISPLAY'] || meta['$P' + i + 'D'] || '').toUpperCase();
      params.push({
        index: i - 1, name: pn, label: ps, range, bits,
        logDecades: eParts[0] || 0, logOffset: eParts[1] || 0, gain,
        displayHint: disp.startsWith('LOG') ? 'log' : (disp.startsWith('LIN') ? 'lin' : ''),
      });
    }

    let bytesPerEvent;
    if (dtype === 'F') bytesPerEvent = 4 * npar;
    else if (dtype === 'D') bytesPerEvent = 8 * npar;
    else if (dtype === 'I') {
      if (params.some(p => p.bits % 8 !== 0)) throw FCSError('Integer data with non-byte-aligned $PnB is not supported');
      bytesPerEvent = params.reduce((a, p) => a + p.bits / 8, 0);
    } else throw FCSError('Unsupported $DATATYPE "' + dtype + '"');

    const avail = dataEnd >= dataBegin ? (dataEnd - dataBegin + 1) : 0;
    let n = ntot > 0 ? ntot : Math.floor(avail / bytesPerEvent);
    if (n * bytesPerEvent > avail) n = Math.floor(avail / bytesPerEvent); // truncated file: keep what exists
    if (dataBegin + n * bytesPerEvent > bytes.length) n = Math.max(0, Math.floor((bytes.length - dataBegin) / bytesPerEvent));

    const data = {};
    const cols = params.map(() => new Float32Array(n));
    const dv = new DataView(buffer, dataBegin, n * bytesPerEvent);

    if (dtype === 'F' && little && dataBegin % 4 === 0) {
      // fast path: aligned little-endian float32
      const all = new Float32Array(buffer, dataBegin, n * npar);
      for (let e = 0, o = 0; e < n; e++) for (let p = 0; p < npar; p++, o++) cols[p][e] = all[o];
    } else if (dtype === 'F') {
      for (let e = 0, o = 0; e < n; e++) for (let p = 0; p < npar; p++, o += 4) cols[p][e] = dv.getFloat32(o, little);
    } else if (dtype === 'D') {
      for (let e = 0, o = 0; e < n; e++) for (let p = 0; p < npar; p++, o += 8) cols[p][e] = dv.getFloat64(o, little);
    } else {
      const masks = params.map(p => nextPow2Mask(p.range));
      for (let e = 0, o = 0; e < n; e++) {
        for (let p = 0; p < npar; p++) {
          const b = params[p].bits;
          let v;
          if (b === 8) v = dv.getUint8(o);
          else if (b === 16) v = dv.getUint16(o, little);
          else if (b === 32) v = dv.getUint32(o, little);
          else if (b === 64) v = Number(dv.getBigUint64(o, little));
          else throw FCSError('Unsupported integer width ' + b);
          o += b / 8;
          cols[p][e] = (b <= 32 ? (v & masks[p]) >>> 0 : v);
        }
      }
    }

    // $PnE log amplification (integer data) and $PnG gain for linear parameters
    params.forEach((p, i) => {
      const c = cols[i];
      if (p.logDecades > 0) {
        const f2 = p.logOffset > 0 ? p.logOffset : 1;
        const R = p.range || 1;
        for (let e = 0; e < n; e++) c[e] = Math.pow(10, p.logDecades * c[e] / R) * f2;
      } else if (p.gain && p.gain !== 1 && dtype === 'I') {
        for (let e = 0; e < n; e++) c[e] = c[e] / p.gain;
      }
      data[p.name] = c;
    });

    // the time parameter in seconds: FCS 3.x stores ticks of $TIMESTEP (FlowJo and FlowKit scale it too)
    const timestep = parseFloat(meta['$TIMESTEP']);
    if (timestep > 0 && timestep !== 1) {
      params.forEach((p, i) => {
        if (!/^time$/i.test(p.name)) return;
        // in double precision: ticks × 0.01 in float32 lands a hair off a gate set at 1.28 s
        const c = cols[i], d = new Float64Array(n);
        for (let e = 0; e < n; e++) d[e] = c[e] * timestep;
        cols[i] = d;
        data[p.name] = d;
        p.timestep = timestep;
      });
    }

    const spillRaw = meta['$SPILLOVER'] || meta['SPILL'] || meta['$SPILL'] || meta['SPILLOVER'] || meta['$COMP'];
    let spill = parseSpillover(spillRaw);
    // an identity matrix (e.g. CytoFLEX's "2,FL1-H,FL1-A,1,0,0,1") means nothing to compensate
    if (spill && (isIdentity(spill.matrix) || !spill.params.every(pn => data[pn]))) spill = null;

    return {
      name: name || meta['$FIL'] || 'sample',
      version: hdr.version,
      meta, params, n, data,
      spill,
      acqTime: parseAcqTime(meta),
      cytometer: meta['$CYT'] || '',
    };
  }

  /** Invert a square matrix (Gauss-Jordan with partial pivoting). */
  function invert(m) {
    const n = m.length;
    const a = m.map((row, i) => row.concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
      if (Math.abs(a[piv][c]) < 1e-15) throw FCSError('Spillover matrix is singular');
      [a[c], a[piv]] = [a[piv], a[c]];
      const d = a[c][c];
      for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = a[r][c];
        if (f) for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
      }
    }
    return a.map(row => row.slice(n));
  }

  /** Apply spillover compensation in place: comp = raw · S⁻¹ over the listed parameters. */
  function compensate(sample) {
    const sp = sample.spill;
    if (!sp || sample.compensated) return false;
    const inv = invert(sp.matrix);
    const cols = sp.params.map(p => sample.data[p]);
    if (cols.some(c => !c)) return false;
    const k = cols.length, n = sample.n;
    const raw = new Float64Array(k);
    for (let e = 0; e < n; e++) {
      for (let i = 0; i < k; i++) raw[i] = cols[i][e];
      for (let j = 0; j < k; j++) {
        let s = 0;
        for (let i = 0; i < k; i++) s += raw[i] * inv[i][j];
        cols[j][e] = s;
      }
    }
    sample.compensated = true;
    return true;
  }

  /**
   * Write a sample as an FCS 3.1 file (list mode, little-endian float32) from its raw columns.
   * Keywords in sample.meta are kept, except the layout ones this writer sets itself.
   * Returns an ArrayBuffer.
   */
  function write(sample) {
    const cols = sample.raw || sample.data;
    const params = sample.params.map(p => p.name).filter(p => cols[p]);
    const n = sample.n, np = params.length;
    const kw = {};
    Object.keys(sample.meta || {}).forEach(k => {
      if (/^\$(BEGIN|END)(DATA|ANALYSIS|STEXT)$|^\$(BYTEORD|DATATYPE|MODE|NEXTDATA|PAR|TOT)$|^\$P\d+[A-Z]$/i.test(k)) return;
      kw[k] = String(sample.meta[k]);
    });
    Object.assign(kw, { '$BYTEORD': '1,2,3,4', '$DATATYPE': 'F', '$MODE': 'L', '$NEXTDATA': '0', '$PAR': String(np), '$TOT': String(n),
      '$BEGINANALYSIS': '0', '$ENDANALYSIS': '0', '$BEGINSTEXT': '0', '$ENDSTEXT': '0' });
    params.forEach((p, i) => {
      const info = sample.params.find(q => q.name === p) || {};
      kw['$P' + (i + 1) + 'N'] = p;
      if (info.label) kw['$P' + (i + 1) + 'S'] = info.label;
      kw['$P' + (i + 1) + 'B'] = '32';
      kw['$P' + (i + 1) + 'E'] = '0,0';
      kw['$P' + (i + 1) + 'R'] = String(Math.round(info.range || 262144));
    });
    const D = '|';
    const textOf = (b, e) => {
      const all = Object.assign({}, kw, { '$BEGINDATA': String(b).padStart(12, '0'), '$ENDDATA': String(e).padStart(12, '0') });
      return D + Object.keys(all).map(k => k + D + String(all[k]).split(D).join(D + D)).join(D) + D;
    };
    const textStart = 58;
    const probe = new TextEncoder().encode(textOf(0, 0));
    const dataStart = Math.ceil((textStart + probe.length) / 8) * 8;     // aligned, so readers can map floats directly
    const dataBytes = n * np * 4;
    const text = new TextEncoder().encode(textOf(dataStart, dataStart + dataBytes - 1));
    const pad = v => String(v).padStart(8, ' ');
    const textEnd = textStart + text.length - 1;
    const big = dataStart + dataBytes - 1 > 99999999;
    const header = 'FCS3.1    ' + pad(textStart) + pad(textEnd) + pad(big ? 0 : dataStart) + pad(big ? 0 : dataStart + dataBytes - 1) + pad(0) + pad(0);
    const buf = new ArrayBuffer(dataStart + dataBytes);
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < header.length; i++) u8[i] = header.charCodeAt(i);
    u8.set(text, textStart);
    const dv = new DataView(buf, dataStart);
    const src = params.map(p => cols[p]);
    for (let e = 0, o = 0; e < n; e++) for (let j = 0; j < np; j++, o += 4) dv.setFloat32(o, src[j][e], true);
    return buf;
  }

  FM.fcs = { parse, parseText, parseSpillover, compensate, invert, parseAcqTime, write, FCSError };
})(FM);
