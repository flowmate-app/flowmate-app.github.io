/* The gating table: every population's number in every well, and what a hand adjustment did.
 *
 * A gate applies to the whole plate, so a column of this table should read flat. Where it
 * does not, the table says why — and distinguishes the two ways a well can differ, which a
 * plain grid of percentages would hide:
 *
 *   adjusted   this gate's own shape was dragged on this well
 *   inherited  this gate's shape is the shared one, but a gate ABOVE it was adjusted here,
 *              so it now sees a different set of events — the trickle-down
 *
 * `shared` on each cell is what that well would have read with no adjustment anywhere in
 * its chain, so `delta` is exactly the effect of the hand work.
 */
(function (FM) {
  'use strict';

  /** Gates depth-first, parents before children — the order a gating strategy is read in. */
  function gatesInOrder(ws) {
    const out = [];
    const walk = (parentId, depth) => ws.children(parentId).forEach(g => { out.push({ gate: g, depth }); walk(g.id, depth + 1); });
    walk(null, 0);
    return out;
  }

  /** Is any gate in this one's chain, including itself, adjusted for this well? */
  function chainAdjusted(ws, gateId, wellKey) {
    let id = gateId, guard = 0;
    while (id) {
      if (ws.isAdjusted(id, wellKey)) return true;
      const g = ws.gate(id);
      if (!g) return false;
      id = g.parent;
      if (++guard > 256) return false;
    }
    return false;
  }

  /**
   * opts.mode: 'parent' (default) | 'total' | 'count'
   * opts.samples: which wells, default every loaded well in plate order
   */
  function build(ws, opts) {
    opts = opts || {};
    const mode = opts.mode || 'parent';
    const samples = opts.samples || ws.samples;
    const cols = gatesInOrder(ws);
    const anyAdjusted = ws.anyAdjusted();

    const read = (s, id, shared) => {
      if (mode === 'count') return shared ? ws.countShared(s, id) : ws.count(s, id);
      if (mode === 'total') return shared ? ws.pctOfShared(s, id, null) : ws.pctOf(s, id, null);
      return shared ? ws.pctShared(s, id) : ws.pct(s, id);
    };

    const rows = samples.map(s => {
      const info = ws.wellInfo(s.key);
      const cells = cols.map(({ gate }) => {
        const value = read(s, gate.id, false);
        const own = ws.isAdjusted(gate.id, s.key);
        // the shared baseline only costs a second pass where something was actually adjusted
        const touched = anyAdjusted && chainAdjusted(ws, gate.id, s.key);
        const shared = touched ? read(s, gate.id, true) : value;
        return {
          gate, value, shared,
          delta: Number.isFinite(value) && Number.isFinite(shared) ? value - shared : NaN,
          status: own ? 'adjusted' : touched ? 'inherited' : 'shared',
        };
      });
      return { sample: s, group: ws.groupOf(s.key), excluded: !!info.excluded, cells };
    });

    return { mode, gates: cols.map(c => c.gate), depths: cols.map(c => c.depth), rows, anyAdjusted };
  }

  /** Column header text for a mode, used by both the table and its CSV. */
  function modeLabel(mode) {
    return mode === 'count' ? 'events' : mode === 'total' ? '% of all events' : '% of parent';
  }

  /** The table as rows of strings, ready for `toCSV`. Adjusted cells are flagged in place. */
  function toRows(t) {
    const head = ['well', 'condition', 'excluded'];
    t.gates.forEach(g => {
      head.push(g.name + ' | ' + modeLabel(t.mode));
      if (t.anyAdjusted) head.push(g.name + ' | on the shared gate', g.name + ' | gate');
    });
    const out = [head];
    t.rows.forEach(r => {
      const line = [r.sample.well || r.sample.name, r.group ? r.group.name : '', r.excluded ? 'yes' : 'no'];
      r.cells.forEach(c => {
        line.push(c.value);
        if (t.anyAdjusted) line.push(c.status === 'shared' ? '' : c.shared,
          c.status === 'adjusted' ? 'adjusted on this well' : c.status === 'inherited' ? 'moved by an adjustment above it' : 'shared');
      });
      out.push(line);
    });
    return out;
  }

  FM.summary = { build, toRows, gatesInOrder, chainAdjusted, modeLabel };
})(FM);
