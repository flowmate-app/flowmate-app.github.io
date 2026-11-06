"""FlowJo saved count vs FlowMate vs FlowKit, per population (one workspace)."""
import json, sys, collections
fm = json.load(open(sys.argv[1])); fk = json.load(open(sys.argv[2]))
only = sys.argv[3] if len(sys.argv) > 3 else None
agg = collections.defaultdict(lambda: collections.Counter())
for r in fm['compare']:
    k = fk.get(r['file'], {}).get(r['path'])
    if k is None:
        agg[r['path']]['no-fk'] += 1; continue
    a = agg[r['path']]
    a['n'] += 1
    a['FM=FK'] += (r['ours'] == k)
    a['FM=FJ'] += (r['ours'] == r['flowjo'])
    a['FK=FJ'] += (k == r['flowjo'])
    if only and only in r['file']:
        print('  %-70s FJ %7d FM %7d FK %7d' % (r['path'][-70:], r['flowjo'], r['ours'], k))
print('%-75s %4s %6s %6s %6s' % ('population', 'n', 'FM=FK', 'FM=FJ', 'FK=FJ'))
for p, a in agg.items():
    print('%-75s %4d %6d %6d %6d %s' % (p[-75:], a['n'], a['FM=FK'], a['FM=FJ'], a['FK=FJ'], ('no-fk %d' % a['no-fk']) if a['no-fk'] else ''))
