/* Small XML helpers over DOMParser. Gating-ML and FlowJo workspaces bind the same names to
 * different prefixes from file to file, so everything here matches on local names only. */
(function (FM) {
  'use strict';

  function parse(text) {
    const doc = new DOMParser().parseFromString(String(text).replace(/^﻿/, ''), 'application/xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    if (err) throw new Error('This file is not valid XML: ' + (err.textContent || '').trim().split('\n')[0].slice(0, 160));
    return doc;
  }

  const local = el => (el && (el.localName || String(el.nodeName || '').replace(/^.*:/, ''))) || '';

  /** Element children, optionally only those with this local name. */
  function kids(el, name) {
    const out = [];
    if (!el) return out;
    for (const c of el.children) if (!name || local(c) === name) out.push(c);
    return out;
  }
  function kid(el, name) { if (!el) return null; for (const c of el.children) if (local(c) === name) return c; return null; }

  /** Every descendant with this local name, in document order. */
  function all(el, name) {
    const out = [];
    const walk = e => { for (const c of e.children) { if (local(c) === name) out.push(c); walk(c); } };
    if (el) walk(el);
    return out;
  }

  function attr(el, name) {
    if (!el || !el.attributes) return null;
    for (const a of el.attributes) if ((a.localName || a.name.replace(/^.*:/, '')) === name) return a.value;
    return null;
  }
  function attrs(el) {
    const o = {};
    if (el && el.attributes) for (const a of el.attributes) o[a.localName || a.name.replace(/^.*:/, '')] = a.value;
    return o;
  }

  function num(v) { if (v == null || v === '') return null; const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  FM.xml = { parse, local, kids, kid, all, attr, attrs, num, esc };
})(FM);
