/* Well identification and plate geometry. */
(function (FM) {
  'use strict';

  const ROWS = 'ABCDEFGHIJKLMNOP';

  /** Normalise "a01", "A1", "A-01" → "A1"; returns null if not a well id. */
  function normalize(s) {
    if (!s) return null;
    const m = /^\s*([A-Pa-p])[\s_-]?0*(\d{1,2})\s*$/.exec(String(s));
    if (!m) return null;
    const col = +m[2];
    if (col < 1 || col > 24) return null;
    return m[1].toUpperCase() + col;
  }

  /** Find a well id for a parsed sample from keywords, then the file name. */
  function detect(sample) {
    const meta = sample.meta || {};
    for (const k of ['$WELLID', 'WELL ID', 'WELLID', '$SMNO', 'WELL', 'TUBE NAME', '$SRC']) {
      const w = normalize(meta[k]);
      if (w) return w;
    }
    const base = String(sample.name || '').replace(/\.[^.]+$/, '');
    // prefer an explicit "Well-A1" / "well_A01" token, then any standalone A1..P24 token
    let m = /well[\s_-]*([A-Pa-p])[\s_-]?0*(\d{1,2})(?![0-9])/i.exec(base);
    if (m) return normalize(m[1] + m[2]);
    const re = /(?:^|[^A-Za-z0-9])([A-Pa-p])[_-]?0*(\d{1,2})(?=$|[^0-9A-Za-z])/g;
    let hit = null;
    while ((m = re.exec(base))) hit = normalize(m[1] + m[2]);
    return hit;
  }

  function parse(well) {
    const w = normalize(well);
    if (!w) return null;
    return { row: ROWS.indexOf(w[0]), col: +w.slice(1) - 1 };
  }

  function id(row, col) { return ROWS[row] + (col + 1); }

  /**
   * Plate frame covering the wells in use: the standard format that fits them (96 / 384)
   * and the used row/column span, so an 18-well experiment isn't lost in a 96-well grid.
   */
  function frame(wellIds) {
    const ps = wellIds.map(parse).filter(Boolean);
    if (!ps.length) return null;
    const maxR = Math.max(...ps.map(p => p.row)), maxC = Math.max(...ps.map(p => p.col));
    const minR = Math.min(...ps.map(p => p.row)), minC = Math.min(...ps.map(p => p.col));
    const format = (maxR < 8 && maxC < 12) ? 96 : 384;
    return {
      format,
      rows: format === 96 ? 8 : 16, cols: format === 96 ? 12 : 24,
      r0: minR, r1: maxR, c0: minC, c1: maxC,
    };
  }

  /** Sort comparator: plate order (row-major). Non-well samples go last, by name. */
  function compare(a, b) {
    const pa = parse(a.well), pb = parse(b.well);
    if (pa && pb) return pa.row - pb.row || pa.col - pb.col;
    if (pa) return -1;
    if (pb) return 1;
    return String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
  }

  /**
   * Parse a plate map pasted from a spreadsheet: a grid of condition names, tab- or
   * comma-separated, optionally with a header row of column numbers and a first column of
   * row letters. Without headers the grid is placed at A1. Returns { wells: {A1: name}, names }.
   */
  function parseLayout(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').filter(l => l.trim().length);
    if (!lines.length) return { wells: {}, names: [] };
    const sep = lines.some(l => l.includes('\t')) ? '\t' : (lines.some(l => l.includes(';')) ? ';' : ',');
    let grid = lines.map(l => l.split(sep).map(c => c.trim().replace(/^"(.*)"$/, '$1')));
    const isNum = s => /^\d{1,2}$/.test(s);
    const isRow = s => /^[A-Pa-p]$/.test(s);
    let colIdx = null, rowIdx = null;
    // header row: all non-empty cells after an optional corner cell are column numbers
    const first = grid[0];
    const firstCells = first.slice(isRow(first[0]) || first[0] === '' ? 1 : 0).filter(c => c !== '');
    if (firstCells.length && firstCells.every(isNum)) {
      const offset = first.length - firstCells.length;
      colIdx = first.map((c, i) => (i >= offset && isNum(c) ? +c - 1 : null));
      grid = grid.slice(1);
    }
    // header column: row letters
    if (grid.length && grid.every(r => isRow(r[0] || ''))) {
      rowIdx = grid.map(r => ROWS.indexOf(r[0].toUpperCase()));
      grid = grid.map(r => r.slice(1));
      if (colIdx) colIdx = colIdx.slice(1);
    }
    const wells = {};
    grid.forEach((r, ri) => r.forEach((cell, ci) => {
      if (!cell) return;
      const row = rowIdx ? rowIdx[ri] : ri;
      const col = colIdx ? colIdx[ci] : ci;
      if (row == null || row < 0 || col == null || col < 0 || row > 15 || col > 23) return;
      wells[id(row, col)] = cell;
    }));
    const names = [];
    Object.values(wells).forEach(n => { if (!names.includes(n)) names.push(n); });
    return { wells, names };
  }

  FM.wells = { ROWS, normalize, detect, parse, id, frame, compare, parseLayout };
})(FM);
