/* BenchMate library: "My analyses", the saved analyses kept in this browser (IndexedDB).
 *
 * One source, inlined by every app's build. Each app opens its own database
 * (BML.open('flowmate') → "benchmate-flowmate"), with three stores:
 *
 *   meta   { id, name, created, savedAt, summary, size, blobIds }   — what the list shows
 *   docs   { id, doc, ui }                                          — the analysis itself
 *   blobs  key "<id>/<blobId>" → any structured-cloneable value      — data files (typed arrays)
 *
 * A save is one transaction over all three stores, so a save that runs out of space leaves
 * the previous version intact. Blobs are written once and reused while their id is unchanged:
 * the app passes every blob id the analysis needs, and a function that makes the value of
 * any blob the library does not hold yet.
 *
 * Nothing leaves the browser; clearing the site's data removes the library.
 */
(function (root) {
  'use strict';

  function req(r) {
    return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  function done(tx) {
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onabort = () => rej(tx.error || new Error('The save was cancelled'));
      tx.onerror = () => { /* onabort follows with the cause */ };
    });
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  const range = id => IDBKeyRange.bound(id + '/', id + '/￿');

  /** A friendlier message for the errors a save can meet. */
  function explain(e) {
    const name = e && e.name;
    if (name === 'QuotaExceededError') {
      const err = new Error('There is not enough space in this browser to save the analysis. Delete analyses you no longer need in My analyses, or free some disk space, then save again.');
      err.quota = true;
      return err;
    }
    if (name === 'InvalidStateError' || name === 'UnknownError') return new Error('This browser refused to store the analysis (private windows often do). Download it as a file instead.');
    return e instanceof Error ? e : new Error(String(e));
  }

  function open(app) {
    const DB = 'benchmate-' + app;
    let dbp = null;

    function db() {
      if (dbp) return dbp;
      dbp = new Promise((res, rej) => {
        let r;
        try { r = indexedDB.open(DB, 1); } catch (e) { rej(explain(e)); return; }
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
        };
        r.onsuccess = () => {
          const d = r.result;
          d.onversionchange = () => { d.close(); dbp = null; };
          res(d);
        };
        r.onerror = () => rej(explain(r.error));
        r.onblocked = () => rej(new Error('My analyses is busy in another tab — close the other FlowMate or PlotMate tabs and try again.'));
      });
      dbp.catch(() => { dbp = null; });
      return dbp;
    }

    /** Every saved analysis, most recent first (metadata only). */
    async function list() {
      const d = await db();
      const all = await req(d.transaction('meta').objectStore('meta').getAll());
      return all.sort((a, b) => b.savedAt - a.savedAt);
    }

    async function meta(id) {
      const d = await db();
      return (await req(d.transaction('meta').objectStore('meta').get(id))) || null;
    }

    /** { meta, doc, ui } of one analysis, or null. */
    async function load(id) {
      const d = await db();
      const tx = d.transaction(['meta', 'docs']);
      const [m, rec] = await Promise.all([req(tx.objectStore('meta').get(id)), req(tx.objectStore('docs').get(id))]);
      return m && rec ? { meta: m, doc: rec.doc, ui: rec.ui || null } : null;
    }

    /** Map blobId → value for every blob of an analysis. */
    async function blobs(id) {
      const d = await db();
      const st = d.transaction('blobs').objectStore('blobs');
      const [keys, vals] = await Promise.all([req(st.getAllKeys(range(id))), req(st.getAll(range(id)))]);
      const out = new Map();
      keys.forEach((k, i) => out.set(String(k).slice(id.length + 1), vals[i]));
      return out;
    }

    /**
     * Create or update an analysis.
     *   o.id        existing id to update (omit to create)
     *   o.name, o.doc, o.ui, o.summary
     *   o.blobIds   every blob the analysis needs; others stored under this id are deleted
     *   o.blob(id)  → value of a blob the library does not hold yet
     *   o.blobSize(id) → its size in bytes, for the size shown in the list (or o.size: the total)
     * Resolves to the new meta record.
     */
    async function save(o) {
      const d = await db();
      const id = o.id || uid();
      const prev = o.id ? await meta(o.id) : null;
      const have = new Set(prev ? prev.blobIds || [] : []);
      const want = o.blobIds || [];
      const fresh = want.filter(b => !have.has(b)).map(b => [b, o.blob(b)]);
      const now = Date.now();
      const docSize = JSON.stringify(o.doc).length + JSON.stringify(o.ui || null).length;
      const m = {
        id, name: o.name || (prev && prev.name) || 'Untitled analysis',
        created: prev ? prev.created : now, savedAt: now,
        summary: o.summary || '', blobIds: want.slice(),
        size: o.size != null ? o.size : docSize + want.reduce((a, b) => a + (o.blobSize ? o.blobSize(b) || 0 : 0), 0),
      };
      try {
        const tx = d.transaction(['meta', 'docs', 'blobs'], 'readwrite');
        const fin = done(tx);
        const bs = tx.objectStore('blobs');
        fresh.forEach(([b, v]) => bs.put(v, id + '/' + b));
        have.forEach(b => { if (want.indexOf(b) < 0) bs.delete(id + '/' + b); });
        tx.objectStore('docs').put({ id, doc: o.doc, ui: o.ui || null });
        tx.objectStore('meta').put(m);
        await fin;
      } catch (e) { throw explain(e); }
      persist();
      return m;
    }

    async function rename(id, name) {
      const d = await db();
      const tx = d.transaction('meta', 'readwrite');
      const st = tx.objectStore('meta');
      const m = await req(st.get(id));
      if (!m) throw new Error('This analysis is no longer in My analyses.');
      m.name = name;
      st.put(m);
      await done(tx);
      return m;
    }

    async function remove(id) {
      const d = await db();
      const tx = d.transaction(['meta', 'docs', 'blobs'], 'readwrite');
      tx.objectStore('meta').delete(id);
      tx.objectStore('docs').delete(id);
      tx.objectStore('blobs').delete(range(id));
      await done(tx);
    }

    /** A copy of a saved analysis under a new name (data included). */
    async function duplicate(id, name) {
      const src = await load(id);
      if (!src) throw new Error('This analysis is no longer in My analyses.');
      const data = await blobs(id);
      return save({ name, doc: src.doc, ui: src.ui, summary: src.meta.summary, size: src.meta.size,
        blobIds: Array.from(data.keys()), blob: b => data.get(b) });
    }

    /** { used, quota } in bytes for this site, when the browser says. */
    async function usage() {
      try {
        if (navigator.storage && navigator.storage.estimate) {
          const e = await navigator.storage.estimate();
          return { used: e.usage || 0, quota: e.quota || 0 };
        }
      } catch (_) { /* ignore */ }
      return null;
    }

    // ask once that the browser keep the library when the disk runs low
    let asked = false;
    function persist() {
      if (asked) return;
      asked = true;
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (_) { /* ignore */ }
    }

    return { list, meta, load, blobs, save, rename, remove, duplicate, usage, name: DB };
  }

  function available() {
    try { return typeof indexedDB !== 'undefined' && !!indexedDB; } catch (_) { return false; }
  }

  function fmtSize(b) {
    if (!(b > 0)) return '—';
    if (b < 1024 * 1024) return Math.max(1, Math.round(b / 1024)) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
    return (b / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  }

  /** "today 14:32", "yesterday 09:10", "12 Oct 2026". */
  function fmtWhen(t) {
    const d = new Date(t), now = new Date();
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diff === 0) return 'today ' + time;
    if (diff === 1) return 'yesterday ' + time;
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  }

  root.BML = { open, available, fmtSize, fmtWhen };
})(typeof globalThis !== 'undefined' ? globalThis : window);
