/* Metric expression language.
 *
 *   gmean("THP Cells + Beads", "FL1-H") * pct("THP Cells + Beads")
 *
 * Population functions   count(pop)  pct(pop) [% of parent]  pctTotal(pop)  pctOf(pop, ancestor)
 * Parameter statistics    mean  median  gmean  sd  cv  rcv  (pop, param)
 * Math                    + - * / ^, parentheses, log ln log10 log2 sqrt abs exp min max
 * Populations and parameters are quoted strings; "All events" names the root.
 */
(function (FM) {
  'use strict';

  const POP_FNS = { count: 1, pct: 1, pctTotal: 1, pctOf: 2 };
  const STAT_FNS = { mean: 1, median: 1, gmean: 1, sd: 1, cv: 1, rcv: 1 };
  const MATH_FNS = {
    log: Math.log, ln: Math.log, log10: Math.log10, log2: Math.log2, sqrt: Math.sqrt,
    abs: Math.abs, exp: Math.exp,
  };
  const VAR_FNS = { min: Math.min, max: Math.max };
  const CONSTS = { pi: Math.PI, e: Math.E };
  const ROOT_NAMES = ['all events', 'all', 'root', 'ungated'];

  function ExprError(msg, pos) { const e = new Error(msg); e.name = 'ExprError'; e.pos = pos; return e; }

  function tokenize(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        const m = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(src.slice(i));
        if (!m) throw ExprError('Bad number', i);
        toks.push({ t: 'num', v: parseFloat(m[0]), pos: i }); i += m[0].length; continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1, s = '';
        while (j < src.length && src[j] !== c) { if (src[j] === '\\' && j + 1 < src.length) j++; s += src[j]; j++; }
        if (j >= src.length) throw ExprError('Unclosed quote', i);
        toks.push({ t: 'str', v: s, pos: i }); i = j + 1; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
        toks.push({ t: 'id', v: m[0], pos: i }); i += m[0].length; continue;
      }
      if ('+-*/^(),'.includes(c)) { toks.push({ t: c, pos: i }); i++; continue; }
      throw ExprError('Unexpected character "' + c + '"', i);
    }
    toks.push({ t: 'eof', pos: src.length });
    return toks;
  }

  function parse(src) {
    const toks = tokenize(String(src || ''));
    let p = 0;
    const peek = () => toks[p];
    const eat = (t) => {
      if (toks[p].t !== t) throw ExprError('Expected "' + t + '"', toks[p].pos);
      return toks[p++];
    };

    function expr() {
      let n = term();
      while (peek().t === '+' || peek().t === '-') { const op = toks[p++].t; n = { k: 'bin', op, a: n, b: term() }; }
      return n;
    }
    function term() {
      let n = factor();
      while (peek().t === '*' || peek().t === '/') { const op = toks[p++].t; n = { k: 'bin', op, a: n, b: factor() }; }
      return n;
    }
    function factor() {
      const base = unary();
      if (peek().t === '^') { p++; return { k: 'bin', op: '^', a: base, b: factor() }; }
      return base;
    }
    function unary() {
      if (peek().t === '-') { p++; return { k: 'neg', a: unary() }; }
      if (peek().t === '+') { p++; return unary(); }
      return primary();
    }
    function primary() {
      const tk = peek();
      if (tk.t === 'num') { p++; return { k: 'num', v: tk.v }; }
      if (tk.t === 'str') { p++; return { k: 'str', v: tk.v, pos: tk.pos }; }
      if (tk.t === '(') { p++; const n = expr(); eat(')'); return n; }
      if (tk.t === 'id') {
        p++;
        if (peek().t === '(') {
          p++;
          const args = [];
          if (peek().t !== ')') { args.push(expr()); while (peek().t === ',') { p++; args.push(expr()); } }
          eat(')');
          return { k: 'call', fn: tk.v, args, pos: tk.pos };
        }
        const cst = CONSTS[tk.v.toLowerCase()];
        if (cst != null) return { k: 'num', v: cst };
        throw ExprError('Unknown name "' + tk.v + '" — populations and parameters need quotes', tk.pos);
      }
      if (tk.t === 'eof') throw ExprError('Expression ends too early', tk.pos);
      throw ExprError('Unexpected "' + tk.t + '"', tk.pos);
    }
    const ast = expr();
    if (peek().t !== 'eof') throw ExprError('Unexpected "' + (peek().v || peek().t) + '"', peek().pos);
    validate(ast);
    return ast;
  }

  function findFn(name) {
    const lower = name.toLowerCase();
    for (const table of [POP_FNS, STAT_FNS, MATH_FNS, VAR_FNS]) {
      for (const k of Object.keys(table)) if (k.toLowerCase() === lower) return { name: k, table };
    }
    return null;
  }

  function validate(n) {
    if (n.k === 'bin') { validate(n.a); validate(n.b); return; }
    if (n.k === 'neg') { validate(n.a); return; }
    if (n.k === 'str') throw ExprError('A quoted name can only be used inside a function, e.g. pct("' + n.v + '")', n.pos);
    if (n.k !== 'call') return;
    const f = findFn(n.fn);
    if (!f) throw ExprError('Unknown function ' + n.fn + '()', n.pos);
    n.fn = f.name;
    if (f.table === POP_FNS) {
      if (n.args.length !== POP_FNS[f.name]) throw ExprError(f.name + '() takes ' + POP_FNS[f.name] + ' population name' + (POP_FNS[f.name] > 1 ? 's' : ''), n.pos);
      n.args.forEach(a => { if (a.k !== 'str') throw ExprError(f.name + '() expects a quoted population name', n.pos); });
    } else if (f.table === STAT_FNS) {
      if (n.args.length !== 2 || n.args.some(a => a.k !== 'str')) throw ExprError(f.name + '("population", "parameter")', n.pos);
    } else if (f.table === MATH_FNS) {
      if (n.args.length !== 1) throw ExprError(f.name + '() takes one argument', n.pos);
      validate(n.args[0]);
    } else {
      if (!n.args.length) throw ExprError(f.name + '() needs at least one argument', n.pos);
      n.args.forEach(validate);
    }
  }

  /**
   * Evaluate an AST. ctx provides:
   *   popId(name) → gate id | null (root) | undefined (unknown)
   *   hasParam(name) → bool
   *   count(id), pctParent(id), pctOf(id, ancestorId), stat(id, param, which)
   */
  function evaluate(ast, ctx) {
    function pop(nameNode) {
      const name = nameNode.v;
      if (ROOT_NAMES.includes(name.trim().toLowerCase())) return null;
      const id = ctx.popId(name);
      if (id === undefined) throw ExprError('No population named "' + name + '"', nameNode.pos);
      return id;
    }
    function ev(n) {
      switch (n.k) {
        case 'num': return n.v;
        case 'neg': return -ev(n.a);
        case 'bin': {
          const a = ev(n.a), b = ev(n.b);
          if (n.op === '+') return a + b;
          if (n.op === '-') return a - b;
          if (n.op === '*') return a * b;
          if (n.op === '/') return b === 0 ? NaN : a / b;
          return Math.pow(a, b);
        }
        case 'call': {
          if (POP_FNS[n.fn]) {
            const id = pop(n.args[0]);
            if (n.fn === 'count') return ctx.count(id);
            if (n.fn === 'pct') return ctx.pctParent(id);
            if (n.fn === 'pctTotal') return ctx.pctOf(id, null);
            return ctx.pctOf(id, pop(n.args[1]));
          }
          if (STAT_FNS[n.fn]) {
            const id = pop(n.args[0]);
            const param = n.args[1].v;
            if (!ctx.hasParam(param)) throw ExprError('No parameter named "' + param + '"', n.args[1].pos);
            return ctx.stat(id, param, n.fn);
          }
          if (MATH_FNS[n.fn]) return MATH_FNS[n.fn](ev(n.args[0]));
          return VAR_FNS[n.fn].apply(null, n.args.map(ev));
        }
      }
      throw ExprError('Cannot evaluate node ' + n.k);
    }
    return ev(ast);
  }

  /** Every quoted population / parameter reference in an expression. */
  function references(src) {
    const out = { pops: new Set(), params: new Set() };
    let ast;
    try { ast = parse(src); } catch (_) { return out; }
    (function walk(n) {
      if (n.k === 'bin') { walk(n.a); walk(n.b); }
      else if (n.k === 'neg') walk(n.a);
      else if (n.k === 'call') {
        if (POP_FNS[n.fn]) n.args.forEach(a => out.pops.add(a.v));
        else if (STAT_FNS[n.fn]) { out.pops.add(n.args[0].v); out.params.add(n.args[1].v); }
        else n.args.forEach(walk);
      }
    })(ast);
    return out;
  }

  /** Rewrite quoted population references when a gate is renamed. */
  function renamePopulation(src, oldName, newName) {
    let toks;
    try { toks = tokenize(src); } catch (_) { return src; }
    let out = '', last = 0;
    toks.forEach(tk => {
      if (tk.t === 'str' && tk.v === oldName) {
        const q = src[tk.pos];
        const end = src.indexOf(q, tk.pos + 1);
        out += src.slice(last, tk.pos) + q + newName.replace(new RegExp(q, 'g'), '\\' + q) + q;
        last = end + 1;
      }
    });
    return out + src.slice(last);
  }

  function quote(s) { return '"' + String(s).replace(/"/g, '\\"') + '"'; }

  FM.expr = { parse, evaluate, references, renamePopulation, tokenize, quote, ExprError, ROOT_NAMES, POP_FNS, STAT_FNS };
})(FM);
