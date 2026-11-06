/* Formula columns: the expression language (core/formula.js) and formula columns in tables. */

(function () {
  const F = () => FM.formula;
  // three columns, ids in position order: A = c1, B = c2, C = c3
  const IDS = ['c1', 'c2', 'c3'];
  const VALS = { c1: 10, c2: 4, c3: NaN };
  const env = { col: id => VALS[id], groupMean: (id, name) => (name === 'Ctl' ? VALS[id] / 2 : NaN) };
  /** Evaluate the formula as a user types it. */
  function ev(text, ids) {
    const st = F().toStored(text, ids || IDS);
    if (st.error) throw new Error('unexpected error: ' + st.error);
    return F().compile(st.src).eval(env);
  }
  const err = (text, ids) => F().toStored(text, ids || IDS).error || '';

  test('formula: letters and indices, Excel-style', () => {
    eq(F().letter(0), 'A'); eq(F().letter(25), 'Z'); eq(F().letter(26), 'AA'); eq(F().letter(27), 'AB'); eq(F().letter(51), 'AZ'); eq(F().letter(52), 'BA');
    eq(F().index('A'), 0); eq(F().index('ab'), 27); eq(F().index('BA'), 52);
  });

  test('formula: arithmetic precedence, power right-associative and above unary minus', () => {
    eq(ev('2+3*4^2'), 50);
    eq(ev('-2^2'), -4);
    eq(ev('2^3^2'), 512);
    eq(ev('(2+3)*4'), 20);
    eq(ev('10/4/5'), 0.5);
    eq(ev('1.5e3 + .5'), 1500.5);
    eq(ev('--3'), 3);
  });

  test('formula: column references, case-insensitive', () => {
    eq(ev('A / B'), 2.5);
    eq(ev('a*b'), 40);
    eq(ev('A - b + 1'), 7);
  });

  test('formula: functions', () => {
    eq(ev('log(100)'), 2, 'log is base 10, as in Excel and Prism');
    approx(ev('ln(exp(1))'), 1, 1e-15);
    eq(ev('log2(B)'), 2);
    eq(ev('log10(1000)'), 3);
    eq(ev('sqrt(B)'), 2);
    eq(ev('abs(B - A)'), 6);
    eq(ev('round(1.23456, 2)'), 1.23);
    eq(ev('round(2.5)'), 3);
    eq(ev('min(A, B, 7)'), 4);
    eq(ev('max(A, B, 7)'), 10);
    approx(ev('pi'), Math.PI, 0);
    eq(ev('groupmean(A, "Ctl")'), 5);
    eq(ev("A / groupmean(A, 'Ctl')"), 2);
  });

  test('formula: missing values and impossible maths are empty, never 0 or infinity', () => {
    assert(Number.isNaN(ev('A / 0')), 'divide by zero');
    assert(Number.isNaN(ev('C + 1')), 'a missing input propagates');
    assert(Number.isNaN(ev('log(-1)')), 'log of a negative');
    assert(Number.isNaN(ev('sqrt(0 - 4)')), 'square root of a negative');
    assert(Number.isNaN(ev('groupmean(A, "Nope")')), 'unknown condition');
    assert(Number.isNaN(ev('10^400')), 'overflow');
  });

  test('formula: errors are explained in plain words', () => {
    assert(/empty/i.test(err('')), err(''));
    assert(/Unknown name "foo"/.test(err('foo + 1')), err('foo + 1'));
    assert(/Unknown function "mean"/.test(err('mean(A)')), err('mean(A)'));
    assert(/no column D/i.test(err('A + D')), err('A + D'));
    assert(/\)/.test(err('(A + B')), err('(A + B'));
    assert(/Unexpected/.test(err('A + * B')), err('A + * B'));
    assert(/character/.test(err('A # B')), err('A # B'));
    assert(/round/.test(err('round()')), err('round()'));
    assert(/condition name/i.test(err('groupmean(A, B)')), err('groupmean(A, B)'));
    assert(/column/i.test(err('groupmean(2, "Ctl")')), err('groupmean(2, "Ctl")'));
  });

  test('formula: references are stored by column id and follow the columns when they move', () => {
    const st = F().toStored('B / A * 100', IDS);
    eq(st.src, '{c2} / {c1} * 100');
    eq(F().toText(st.src, IDS), 'B / A * 100');
    // the user moves column c2 to the front: B is now c1, A is c2
    eq(F().toText(st.src, ['c2', 'c1', 'c3']), 'A / B * 100');
    // a referenced column is removed
    const t = F().toText(st.src, ['c1', 'c3']);
    eq(t, '#REF / A * 100');
    let msg = '';
    try { F().compile(st.src, ['c1', 'c3']); } catch (e) { msg = e.message; }
    assert(/removed/.test(msg), 'compiling against the current ids reports the removed column: ' + msg);
    eq(F().compile(st.src).refs.join(), 'c2,c1');
  });

  test('formula: evaluation order and circular references', () => {
    const cols = [
      { id: 'a', stat: 'count' },
      { id: 'b', kind: 'formula', expr: '{c} * 2' },
      { id: 'c', kind: 'formula', expr: '{a} + 1' },
      { id: 'x', kind: 'formula', expr: '{y}' },
      { id: 'y', kind: 'formula', expr: '{x} + 1' },
      { id: 's', kind: 'formula', expr: '{s}' },
    ];
    const o = F().order(cols);
    assert(o.order.indexOf(2) < o.order.indexOf(1), 'c before b: ' + o.order);
    eq(Array.from(o.cyclic).sort().join(), 's,x,y');
  });
})();

// ------------------------------------------------------------ formula columns in tables
(function () {
  /** A table with A = count and B = % of parent of a population, on the two-group demo plate. */
  function setup() {
    const g = twoGroupWs(400);
    const P = wideRange(g.ws, null, 'Cells');
    const K = g.ws.addGate({ name: 'Bright', parent: P, type: 'range', x: 'FL1-H', xScale: g.ws.scaleSpec('FL1-H'), range: { lo: 2e4, hi: 1e9 } });
    const t = g.ws.addTable('T');
    g.ws.addTableColumn(t, { pop: K, stat: 'count' });
    g.ws.addTableColumn(t, { pop: K, stat: 'freq_parent' });
    return Object.assign(g, { P, K, t, T: () => g.ws.table(t) });
  }
  const ids = tb => tb.columns.map(c => c.id);
  const addFormula = (g, name, text) => {
    const st = FM.formula.toStored(text, ids(g.T()));
    if (st.error) throw new Error(st.error);
    g.ws.addTableColumn(g.t, { kind: 'formula', name, expr: st.src });
  };

  test('formula columns: every column gets a stable id; a formula computes per sample', () => {
    const g = setup();
    assert(g.T().columns.every(c => typeof c.id === 'string' && c.id), 'ids assigned on add');
    eq(new Set(ids(g.T())).size, 2, 'ids are distinct');
    addFormula(g, 'Count per %', 'A / B');
    const b = FM.statTables.build(g.ws, g.T());
    eq(b.head[4], 'Count per %', 'the header is the formula name');
    const row = b.rows.find(r => r.key === g.a.key);
    approx(row.cells[2], g.ws.count(g.a, g.K) / g.ws.pct(g.a, g.K), 1e-12);
    eq(FM.statTables.columnLabel(g.ws, g.T().columns[2]), 'Count per %');
    const csv = FM.statTables.toCSV(b).split(/\r?\n/);
    assert(/,Count per %$/.test(csv[0]), 'CSV header: ' + csv[0]);
  });

  test('formula columns: an unnamed formula is labelled by its formula in letters', () => {
    const g = setup();
    addFormula(g, '', 'b*2');
    eq(FM.statTables.columnLabel(g.ws, g.T().columns[2], g.T()), '= B*2');
  });

  test('formula columns: moving columns keeps the meaning; removing one empties the formula', () => {
    const g = setup();
    addFormula(g, 'ratio', 'A / B');
    const before = FM.statTables.build(g.ws, g.T()).rows[0].cells[2];
    g.ws.moveTableColumn(g.t, 0, 1);              // swap A and B
    const tb = g.T();
    eq(FM.statTables.formulaText(tb, tb.columns[2]), 'B / A', 'letters follow the columns');
    eq(FM.statTables.build(g.ws, tb).rows[0].cells[2], before, 'same value after the move');
    g.ws.removeTableColumn(g.t, 0);
    const b = FM.statTables.build(g.ws, g.T());
    assert(b.rows.every(r => Number.isNaN(r.cells[1])), 'every cell empty');
    assert(/removed/.test(b.columns[1].error), 'error says why: ' + b.columns[1].error);
    eq(FM.statTables.formulaText(g.T(), g.T().columns[1]), 'A / #REF');
  });

  test('formula columns: formulas can use formulas; loops are reported, not hung on', () => {
    const g = setup();
    addFormula(g, 'double', 'A * 2');
    addFormula(g, 'quad', 'C * 2');
    const b = FM.statTables.build(g.ws, g.T());
    const r = b.rows.find(x => x.key === g.a.key);
    eq(r.cells[3], g.ws.count(g.a, g.K) * 4);
    // make C refer to D: a loop
    const tb = g.T();
    g.ws.updateTableColumn(g.t, tb.columns[2].id, { expr: FM.formula.toStored('D + 1', ids(tb)).src });
    const b2 = FM.statTables.build(g.ws, g.T());
    assert(b2.rows.every(x => Number.isNaN(x.cells[2]) && Number.isNaN(x.cells[3])), 'both empty');
    assert(/itself/.test(b2.columns[2].error), 'error: ' + b2.columns[2].error);
  });

  test('formula columns: groupmean normalises to a condition, over its included wells, whatever the rows', () => {
    const g = setup();
    addFormula(g, 'vs GA', 'A / groupmean(A, "ga")');
    g.ws.setExcluded(['A3'], true);
    const ga = ['A1', 'A2'].map(k => g.ws.count(g.ws.sample(k), g.K));
    const m = (ga[0] + ga[1]) / 2;
    g.ws.updateTable(g.t, { rows: g.GB });        // rows are the other group only
    const b = FM.statTables.build(g.ws, g.T());
    const r = b.rows.find(x => x.key === g.b.key);
    approx(r.cells[2], g.ws.count(g.b, g.K) / m, 1e-12);
  });

  test('formula columns: a loaded document without column ids gets them, and formulas still work', () => {
    const g = setup();
    const doc = g.ws.toJSON();
    doc.tables[0].columns.forEach(c => { delete c.id; });
    g.ws.loadDoc(doc);
    assert(g.ws.doc.tables[0].columns.every(c => c.id), 'ids backfilled');
    addFormula(g, 'x', 'A + 1');
    const r = FM.statTables.build(g.ws, g.T()).rows.find(x => x.key === g.a.key);
    eq(r.cells[2], g.ws.count(g.a, g.K) + 1);
  });
})();
