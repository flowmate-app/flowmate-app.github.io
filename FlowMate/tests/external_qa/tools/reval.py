"""Re-validation (PROTOCOL_REVALIDATION.md): FlowMate vs FlowKit (E1) and vs FlowJo (E4, descriptive)."""
import json, sys, collections, statistics

def cls(a, b):
    if a is None or b is None: return 'n/a'
    d = abs(a - b)
    return 'exact' if d == 0 else 'boundary' if d <= 2 or d <= 0.001 * max(b, 1) else 'mismatch'

out = {}
for cid in sys.argv[1:]:
    fm = json.load(open('results/a_%s.json' % cid)); fk = json.load(open('results/fk_%s.json' % cid))
    c, cj = collections.Counter(), collections.Counter()
    mism, pp = [], []
    parent = {}
    for r in fm['compare']:
        k = fk.get(r['file'], {}).get(r['path'])
        x = cls(r['ours'], k); c[x] += 1
        if x == 'mismatch': mism.append((r['file'], r['path'], r['ours'], k, r['flowjo']))
        cj[cls(r['ours'], r['flowjo'])] += 1
    out[cid] = {'vsFlowKit': dict(c), 'vsFlowJo': dict(cj), 'mismatches': mism,
                'compensated': '%d/%d' % (sum(fm['compensated']), len(fm['compensated'])), 'popErrors': len(fm['popErrors'] or []),
                'zeros_with_error': sum(1 for r in fm['compare'] if r.get('error') and r['ours'] == 0)}
    print(cid, 'vs FlowKit', dict(c), '| vs FlowJo', dict(cj), '| compensated', out[cid]['compensated'], '| errors', out[cid]['popErrors'])
json.dump(out, open('results/revalidation.json', 'w'), indent=1)
