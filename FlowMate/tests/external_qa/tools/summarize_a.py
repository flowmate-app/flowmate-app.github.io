"""Part A summary for one wsp result: agreement classes and every mismatch."""
import json, sys, collections
d = json.load(open(sys.argv[1]))
print('FlowJo', d['flowjoVersion'], '| matched', d['matched'], '| missing', len(d['missing']), '| gates', d['gates'], '| comp', d['compensation'], '| %.0f ms' % d['ms'])
print('gate types', d['gateTypes'], '| transforms', d['transformTypes'])
for w in d['parseWarnings'] + d['importWarnings']: print('  warning:', w)
rows = d['compare']
def cls(r):
    df = r['ours'] - r['flowjo']
    if df == 0: return 'exact'
    if abs(df) <= 2 or abs(df) <= 0.001 * r['flowjo']: return 'boundary'
    return 'MISMATCH'
c = collections.Counter(cls(r) for r in rows)
print(len(rows), 'population-sample pairs:', dict(c))
for r in rows:
    if cls(r) != 'exact': print('  %-9s %-40s %-55s FlowJo %7d FlowMate %7d' % (cls(r), r['file'][:40], r['path'][:55], r['flowjo'], r['ours']))
