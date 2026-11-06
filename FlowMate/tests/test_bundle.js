/* The shared-analysis file (core/bundle.js): the analysis, optionally with its data, as one file. */
(function () {
  const recs = () => [
    { key: 'A1', name: 'a1.fcs', n: 4, meta: { '$TOT': '4' }, params: [{ name: 'FSC-H' }, { name: 'FL1-H' }], spill: null,
      cols: { 'FSC-H': Float32Array.from([1, 2.5, 3, 4]), 'FL1-H': Float64Array.from([10, 20, 30, 40.25]) } },
    { key: 'A2', name: 'a2.fcs', n: 2, meta: {}, params: [], cols: { X: Int32Array.from([7, -8]) } },
  ];
  const bytes = parts => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; }); return out.buffer; };

  test('bundle: the analysis and every column come back exactly', () => {
    const doc = { name: 'T', gates: [{ id: 'g1' }], groups: [] };
    const buf = bytes(FM.bundle.pack({ name: 'My run', doc, ui: { step: 'gate' }, withData: true, files: ['a1.fcs', 'a2.fcs'] }, recs()));
    assert(FM.bundle.isBundle(buf), 'recognised');
    const { head, recs: back } = FM.bundle.unpack(buf);
    eq(head.name, 'My run'); eq(head.ui.step, 'gate'); eq(head.doc.gates[0].id, 'g1'); eq(head.withData, true);
    eq(back.length, 2);
    eq(back[0].key, 'A1'); eq(back[0].meta.$TOT, '4'); eq(back[0].params[1].name, 'FL1-H');
    assert(back[0].cols['FSC-H'] instanceof Float32Array && back[0].cols['FL1-H'] instanceof Float64Array && back[1].cols.X instanceof Int32Array, 'types kept');
    eq(Array.from(back[0].cols['FSC-H']).join(), '1,2.5,3,4'); eq(Array.from(back[0].cols['FL1-H']).join(), '10,20,30,40.25'); eq(Array.from(back[1].cols.X).join(), '7,-8');
  });

  test('bundle: without data it is just the analysis', () => {
    const buf = bytes(FM.bundle.pack({ name: 'No data', doc: { gates: [] }, withData: false, files: ['a1.fcs'] }, []));
    const { head, recs: back } = FM.bundle.unpack(buf);
    eq(back.length, 0); eq(head.withData, false); eq(head.files[0], 'a1.fcs');
  });

  test('bundle: a damaged or foreign file is explained, not half-opened', () => {
    const buf = bytes(FM.bundle.pack({ name: 'X', doc: {}, withData: true }, recs()));
    const err = f => { try { f(); } catch (e) { return e.message; } return ''; };
    assert(/not a FlowMate/.test(err(() => FM.bundle.unpack(new TextEncoder().encode('{"a":1}').buffer))), 'plain JSON is not a bundle');
    assert(/cut short/.test(err(() => FM.bundle.unpack(buf.slice(0, buf.byteLength - 10)))), 'truncated data');
    assert(/cut short/.test(err(() => FM.bundle.unpack(buf.slice(0, 20)))), 'truncated header');
    eq(FM.bundle.isBundle(new ArrayBuffer(2)), false);
  });
})();
