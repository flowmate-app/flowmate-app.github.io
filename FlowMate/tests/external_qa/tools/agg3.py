"""Across workspaces: FlowMate vs FlowKit vs FlowJo agreement (diagnostic or official runs)."""
import json, sys, collections
tot = collections.Counter()
for cid in sys.argv[1:]:
    fm = json.load(open('results/a_%s.json' % cid)); fk = json.load(open('results/fk_%s.json' % cid))
    c = collections.Counter()
    for r in fm['compare']:
        k = fk.get(r['file'], {}).get(r['path'])
        c['n'] += 1
        if k is None: c['no FlowKit'] += 1; continue
        c['FM=FK'] += r['ours'] == k
        c['FM=FJ'] += r['ours'] == r['flowjo']
        c['FK=FJ'] += k == r['flowjo']
        c['FM~FJ(within boundary)'] += abs(r['ours'] - r['flowjo']) <= max(2, 0.001 * r['flowjo'])
    tot.update(c)
    print('%-16s %s' % (cid, dict(c)))
print('%-16s %s' % ('TOTAL', dict(tot)))
