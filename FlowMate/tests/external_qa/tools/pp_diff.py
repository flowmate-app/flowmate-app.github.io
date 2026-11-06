"""Δ in % of parent between FlowMate (same gates as FlowJo) and FlowJo's saved counts, per population."""
import json, sys, statistics as st
def load(cid):
    d = json.load(open('results/a_%s.json' % cid))
    by = {}
    for r in d['compare']: by.setdefault(r['file'], {})[r['path']] = r
    return d, by
for cid in sys.argv[1:]:
    d, by = load(cid)
    agg = {}
    for f, pops in by.items():
        for p, r in pops.items():
            par = p.rsplit('/', 1)[0] if '/' in p else None
            if par and par not in pops: continue
            dfj = pops[par]['flowjo'] if par else d['flowjoTotals'][f]
            dfm = pops[par]['ours'] if par else d['flowjoTotals'][f]
            if not dfj or not dfm: continue
            a, b = 100 * r['ours'] / dfm, 100 * r['flowjo'] / dfj
            agg.setdefault(p.split('/')[-1] if not par else '/'.join(p.split('/')[-2:]), []).append((abs(a - b), b, abs(r['ours'] - r['flowjo']) / max(1, r['flowjo'])))
    print('==', cid)
    for p, v in agg.items():
        dd = [x[0] for x in v]; rel = [x[2] for x in v]
        print('  %-58s n=%2d  median|Δpp| %5.2f  max|Δpp| %5.2f   median FJ %% %6.2f   median rel Δcount %5.1f%%' % (p[-58:], len(v), st.median(dd), max(dd), st.median([x[1] for x in v]), 100 * st.median(rel)))
