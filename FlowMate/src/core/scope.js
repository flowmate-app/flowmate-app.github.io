/* Gate scope: which samples a gate applies to.
 *
 *   gate.scope absent                        → every sample (FlowMate's default: gate once, all follow)
 *   gate.scope = { groups: [id…], samples: [key…] }
 *                                            → samples in any listed group, or listed by key
 *
 * Effective scope is the intersection along the parent chain: a gate applies to a sample
 * only if it and every ancestor do. A gate that does not apply to a sample has no number
 * there (NaN, shown "—") — never 0 %, which would read as a real measurement.
 */
(function (FM) {
  'use strict';

  /** True when the scope lists anything (an empty scope means "every sample"). */
  function isScoped(gate) {
    const sc = gate && gate.scope;
    return !!(sc && ((sc.groups && sc.groups.length) || (sc.samples && sc.samples.length)));
  }

  /** null for "every sample", else a clean copy with only non-empty, de-duplicated lists. */
  function normalize(scope) {
    if (!scope) return null;
    const out = {};
    const uniq = a => Array.from(new Set((a || []).filter(v => v != null && v !== '')));
    const g = uniq(scope.groups), s = uniq(scope.samples);
    if (g.length) out.groups = g;
    if (s.length) out.samples = s;
    return g.length || s.length ? out : null;
  }

  /** This gate's own scope, ignoring its ancestors. groupOf(key) → group id | null. */
  function ownApplies(gate, sampleKey, groupOf) {
    if (!isScoped(gate)) return true;
    if (sampleKey == null) return true;     // no sample in context: the caller decides per sample
    const sc = gate.scope;
    if (sc.samples && sc.samples.indexOf(sampleKey) >= 0) return true;
    if (sc.groups && sc.groups.length) {
      const g = groupOf(sampleKey);
      if (g && sc.groups.indexOf(g) >= 0) return true;
    }
    return false;
  }

  /** The gate and every ancestor apply to the sample. gateById(id) → gate. */
  function applies(gate, sampleKey, gateById, groupOf) {
    let g = gate, guard = 0;
    while (g) {
      if (!ownApplies(g, sampleKey, groupOf)) return false;
      g = g.parent ? gateById(g.parent) : null;
      if (++guard > 256) break;
    }
    return true;
  }

  /** Plain words for a scope: "every sample", "Stim", "Stim, Ctrl and A3.fcs". */
  function describe(gate, groupName) {
    if (!isScoped(gate)) return 'every sample';
    const parts = (gate.scope.groups || []).map(id => groupName(id) || 'a deleted group').concat(gate.scope.samples || []);
    return parts.length <= 1 ? parts.join('') : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }

  FM.scope = { isScoped, normalize, ownApplies, applies, describe };
})(FM);
