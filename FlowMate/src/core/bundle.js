/* A shared analysis as one file (.flowmate): the analysis document, optionally with the data.
 *
 *   'FMSH' · uint32 header length (little endian) · header (UTF-8 JSON) · column data
 *
 * The header holds everything that is not event data — name, document, where the user was, and
 * for each sample its record minus the columns plus where each column sits in the data section.
 * Columns are stored as the raw bytes of their typed arrays, so a file costs what the data costs
 * and nothing is converted.
 */
(function (FM) {
  'use strict';
  const MAGIC = [0x46, 0x4d, 0x53, 0x48];     // "FMSH"
  const TYPES = { Float32Array, Float64Array, Int32Array, Uint32Array, Int16Array, Uint16Array, Int8Array, Uint8Array };
  const jsonSafe = (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v);

  /**
   * head: { name, doc, ui, files?, withData } · recs: sample records ({ …, cols: { name: typed array } }).
   * → array of Uint8Array parts, for new Blob(parts).
   */
  function pack(head, recs) {
    const parts = [], samples = [];
    let off = 0;
    (recs || []).forEach(r => {
      const cols = [];
      Object.keys(r.cols).forEach(k => {
        let a = r.cols[k];
        if (!ArrayBuffer.isView(a)) a = Float64Array.from(a);
        const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
        cols.push({ k, type: a.constructor.name, off, len: bytes.length });
        parts.push(bytes);
        off += bytes.length;
      });
      const rec = Object.assign({}, r);
      delete rec.cols;
      samples.push({ rec, cols });
    });
    const header = new TextEncoder().encode(JSON.stringify(Object.assign({ kind: 'flowmate-share', v: 1 }, head, { samples }), jsonSafe));
    const pre = new Uint8Array(8 + header.length);
    pre.set(MAGIC, 0);
    new DataView(pre.buffer).setUint32(4, header.length, true);
    pre.set(header, 8);
    return [pre].concat(parts);
  }

  /** Does this buffer start like a shared analysis? */
  function isBundle(buf) {
    const u = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    return u.length === 4 && MAGIC.every((b, i) => u[i] === b);
  }

  /** ArrayBuffer → { head, recs } (recs as pack() was given them), or throws with a plain message. */
  function unpack(buf) {
    if (!isBundle(buf)) throw new Error('This is not a FlowMate shared analysis.');
    const len = new DataView(buf).getUint32(4, true);
    if (8 + len > buf.byteLength) throw new Error('The file is cut short — it may not have finished downloading.');
    let head;
    try { head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, len))); }
    catch (_) { throw new Error('The file’s header is damaged.'); }
    if (head.kind !== 'flowmate-share') throw new Error('This is not a FlowMate shared analysis.');
    const base = 8 + len;
    const recs = (head.samples || []).map(s => {
      const cols = {};
      s.cols.forEach(c => {
        const T = TYPES[c.type];
        if (!T || base + c.off + c.len > buf.byteLength) throw new Error('The file is cut short — its data is incomplete.');
        cols[c.k] = new T(buf.slice(base + c.off, base + c.off + c.len));     // a copy, so it is aligned
      });
      return Object.assign({}, s.rec, { cols });
    });
    delete head.samples;
    return { head, recs };
  }

  FM.bundle = { pack, unpack, isBundle };
})(FM);
