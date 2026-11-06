/* Formula columns: a small Excel-like language over the other columns of a Measure table.
 *
 *   B / A * 100        log2(C)        B / groupmean(B, "Untreated")
 *
 * Users type columns as letters (A is the first statistic column). Stored formulas name columns
 * by id — "{c3k9x} / {c8a1p}" — so moving or removing a column never quietly changes what a
 * formula means; toText() turns ids back into the current letters.
 *
 * Every value is finite or NaN: a missing input, a divide by zero or log of a negative gives an
 * empty cell, never 0 or ∞.
 */
(function (FM) {
  'use strict';

  const FN1 = {
    log: Math.log10, log10: Math.log10, ln: Math.log, log2: Math.log2,
    sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
  };
  const FNV = { min: Math.min, max: Math.max };
  const CONSTS = { pi: Math.PI };
  const KNOWN_FNS = Object.keys(FN1).concat(Object.keys(FNV), ['round', 'groupmean']);

  function FormulaError(msg, pos) { const e = new Error(msg); e.name = 'FormulaError'; e.pos = pos; return e; }

  /** 0 → A, 25 → Z, 26 → AA. */
  function letter(i) {
    let s = '';
    i = Math.floor(i);
    do { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; } while (i >= 0);
    return s;
  }
  /** A → 0, AA → 26 (case-insensitive). */
  function index(l) {
    let n = 0;
    String(l).toUpperCase().split('').forEach(ch => { n = n * 26 + (ch.charCodeAt(0) - 64); });
    return n - 1;
  }

  const isRefName = s => /^[A-Za-z]{1,2}$/.test(s);
  const fin = v => (Number.isFinite(v) ? v : NaN);

  function tokenize(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        const m = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(src.slice(i));
        if (!m) throw FormulaError('A number is written wrongly here', i);
        toks.push({ t: 'num', v: parseFloat(m[0]), pos: i, end: i + m[0].length }); i += m[0].length; continue;
      }
      if (c === '"' || c === "'") {
        const j = src.indexOf(c, i + 1);
        if (j < 0) throw FormulaError('A quote is not closed', i);
        toks.push({ t: 'str', v: src.slice(i + 1, j), pos: i, end: j + 1 }); i = j + 1; continue;
      }
      if (c === '{') {
        const j = src.indexOf('}', i);
        if (j < 0) throw FormulaError('A column reference is not closed', i);
        toks.push({ t: 'ref', v: src.slice(i + 1, j), pos: i, end: j + 1 }); i = j + 1; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
        toks.push({ t: 'id', v: m[0], pos: i, end: i + m[0].length }); i += m[0].length; continue;
      }
      if ('+-*/^(),'.includes(c)) { toks.push({ t: c, pos: i, end: i + 1 }); i++; continue; }
      throw FormulaError('The character "' + c + '" can’t be used in a formula', i);
    }
    toks.push({ t: 'eof', pos: src.length, end: src.length });
    return toks;
  }

  /** Stored source → AST. Bare letters are not allowed here (toStored has replaced them). */
  function parse(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const eat = (t, what) => {
      if (toks[p].t !== t) throw FormulaError('Expected ' + (what || '"' + t + '"') + (toks[p].t === 'eof' ? ' at the end' : ''), toks[p].pos);
      return toks[p++];
    };
    function add() {
      let n = mul();
      while (peek().t === '+' || peek().t === '-') { const op = toks[p++].t; n = { k: 'bin', op, a: n, b: mul() }; }
      return n;
    }
    function mul() {
      let n = unary();
      while (peek().t === '*' || peek().t === '/') { const op = toks[p++].t; n = { k: 'bin', op, a: n, b: unary() }; }
      return n;
    }
    function unary() {
      if (peek().t === '-') { p++; return { k: 'neg', a: unary() }; }
      if (peek().t === '+') { p++; return unary(); }
      return pow();
    }
    function pow() {
      const base = primary();
      if (peek().t === '^') { p++; return { k: 'bin', op: '^', a: base, b: unary() }; }
      return base;
    }
    function primary() {
      const tk = peek();
      if (tk.t === 'num') { p++; return { k: 'num', v: tk.v }; }
      if (tk.t === 'ref') { p++; return { k: 'ref', id: tk.v, pos: tk.pos }; }
      if (tk.t === 'str') { p++; return { k: 'str', v: tk.v, pos: tk.pos }; }
      if (tk.t === '(') { p++; const n = add(); eat(')', 'a closing ")"'); return n; }
      if (tk.t === 'id') {
        p++;
        const name = tk.v.toLowerCase();
        if (peek().t === '(') {
          p++;
          const args = [];
          if (peek().t !== ')') { args.push(add()); while (peek().t === ',') { p++; args.push(add()); } }
          eat(')', 'a closing ")"');
          return fnNode(name, tk, args);
        }
        if (name in CONSTS) return { k: 'num', v: CONSTS[name] };
        throw FormulaError('Unknown name "' + tk.v + '"', tk.pos);
      }
      if (tk.t === 'eof') throw FormulaError(p === 0 ? 'The formula is empty' : 'The formula ends too early', tk.pos);
      throw FormulaError('Unexpected "' + tk.t + '"', tk.pos);
    }
    function fnNode(name, tk, args) {
      if (!KNOWN_FNS.includes(name)) throw FormulaError('Unknown function "' + tk.v + '" — use ' + KNOWN_FNS.join(', '), tk.pos);
      if (name === 'groupmean') {
        if (args.length !== 2 || args[0].k !== 'ref') throw FormulaError('groupmean needs a column, then a condition name in quotes: groupmean(B, "Untreated")', tk.pos);
        if (args[1].k !== 'str') throw FormulaError('groupmean’s second part is a condition name in quotes: groupmean(B, "Untreated")', tk.pos);
        return { k: 'gmean', id: args[0].id, group: args[1].v };
      }
      args.forEach(a => { if (a.k === 'str') throw FormulaError('Text in quotes only goes in groupmean(…)', a.pos); });
      if (name === 'round') {
        if (args.length < 1 || args.length > 2) throw FormulaError('round takes a value and, optionally, the number of decimals: round(B, 2)', tk.pos);
        return { k: 'round', args };
      }
      if (name in FNV) {
        if (!args.length) throw FormulaError(name + ' needs at least one value', tk.pos);
        return { k: 'fnv', name, args };
      }
      if (args.length !== 1) throw FormulaError(name + ' takes one value: ' + name + '(B)', tk.pos);
      return { k: 'fn1', name, a: args[0] };
    }
    const tree = add();
    if (peek().t !== 'eof') throw FormulaError('Unexpected "' + (peek().t === 'id' || peek().t === 'num' ? src.slice(peek().pos, peek().end) : peek().t) + '"', peek().pos);
    if (tree.k === 'str') throw FormulaError('Text in quotes only goes in groupmean(…)', tree.pos);
    return tree;
  }

  function evalNode(n, env) {
    switch (n.k) {
      case 'num': return n.v;
      case 'ref': return fin(+env.col(n.id));
      case 'neg': return -evalNode(n.a, env);
      case 'bin': {
        const a = evalNode(n.a, env), b = evalNode(n.b, env);
        return fin(n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : n.op === '/' ? a / b : Math.pow(a, b));
      }
      case 'fn1': return fin(FN1[n.name](evalNode(n.a, env)));
      case 'fnv': return fin(FNV[n.name].apply(null, n.args.map(a => evalNode(a, env))));
      case 'round': {
        const x = evalNode(n.args[0], env), d = n.args[1] ? Math.round(evalNode(n.args[1], env)) : 0;
        if (!Number.isFinite(x) || !Number.isFinite(d)) return NaN;
        // half away from zero, without binary drift (round(1.005, 2) = 1.01, as in Excel)
        return fin(Math.sign(x) * Number(Math.round(Number(Math.abs(x) + 'e' + d)) + 'e' + (-d)));
      }
      case 'gmean': return fin(+env.groupMean(n.id, n.group));
      default: return NaN;
    }
  }

  function collect(n, refs, groups) {
    if (!n) return;
    if (n.k === 'ref') refs.push(n.id);
    if (n.k === 'gmean') { refs.push(n.id); groups.push(n.group); }
    [n.a, n.b].concat(n.args || []).forEach(c => collect(c, refs, groups));
  }

  /**
   * Stored source → { refs: [id], groupRefs: [name], eval(env) → number }.
   * With `ids`, a reference to a column not among them is an error.
   */
  function compile(src, ids) {
    const tree = parse(String(src || ''));
    const refs = [], groupRefs = [];
    collect(tree, refs, groupRefs);
    if (ids) {
      const missing = refs.find(r => ids.indexOf(r) < 0);
      if (missing != null) throw FormulaError('This formula uses a column that was removed', 0);
    }
    return { refs, groupRefs, eval: env => fin(evalNode(tree, env)) };
  }

  /** What the user typed (letters) → { src (ids), error }. `ids` are the table's columns in order. */
  function toStored(text, ids) {
    text = String(text == null ? '' : text);
    let toks;
    try { toks = tokenize(text); } catch (e) { return { src: '', error: e.message, pos: e.pos }; }
    let out = '', last = 0;
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (tk.t === 'ref') return { src: '', error: 'Refer to columns by their letter, like B', pos: tk.pos };
      if (tk.t !== 'id' || toks[i + 1].t === '(' || tk.v.toLowerCase() in CONSTS || !isRefName(tk.v)) continue;
      const k = index(tk.v);
      if (k >= ids.length) return { src: '', error: 'There is no column ' + tk.v.toUpperCase() + (ids.length ? ' — the columns are A to ' + letter(ids.length - 1) : ' yet'), pos: tk.pos };
      out += text.slice(last, tk.pos) + '{' + ids[k] + '}';
      last = tk.end;
    }
    const src = out + text.slice(last);
    try { compile(src); } catch (e) { return { src: '', error: e.message, pos: e.pos }; }
    return { src, error: null };
  }

  /** Stored source → the formula as the user sees it now; a removed column reads #REF. */
  function toText(src, ids) {
    return String(src || '').replace(/\{([^}]*)\}/g, (_, id) => { const k = ids.indexOf(id); return k < 0 ? '#REF' : letter(k); });
  }

  /**
   * Evaluation order for a table's columns: formula columns, each after the formula columns it
   * uses. → { order: [column index], cyclic: Set<id> } — cyclic ones are in a loop of references.
   */
  function order(cols) {
    const byId = {};
    cols.forEach((c, i) => { if (c.kind === 'formula') byId[c.id] = i; });
    const deps = {};
    Object.keys(byId).forEach(id => {
      let refs = [];
      try { refs = compile(cols[byId[id]].expr).refs; } catch (_) { /* a broken formula has no usable refs */ }
      deps[id] = refs.filter(r => r in byId);
    });
    // Tarjan's strongly connected components: a component of more than one, or a self-reference, is a loop
    let n = 0;
    const idx = {}, low = {}, onStack = {}, stack = [], cyclic = new Set(), out = [];
    function visit(v) {
      idx[v] = low[v] = n++; stack.push(v); onStack[v] = true;
      deps[v].forEach(w => {
        if (!(w in idx)) { visit(w); low[v] = Math.min(low[v], low[w]); } else if (onStack[w]) low[v] = Math.min(low[v], idx[w]);
      });
      if (low[v] === idx[v]) {
        const comp = [];
        let w;
        do { w = stack.pop(); onStack[w] = false; comp.push(w); } while (w !== v);
        if (comp.length > 1 || deps[v].includes(v)) comp.forEach(x => cyclic.add(x));
        comp.forEach(x => out.push(byId[x]));     // components come out dependencies-first
      }
    }
    Object.keys(byId).forEach(id => { if (!(id in idx)) visit(id); });
    return { order: out, cyclic };
  }

  FM.formula = { letter, index, toStored, toText, compile, order, FUNCTIONS: KNOWN_FNS };
})(FM);
