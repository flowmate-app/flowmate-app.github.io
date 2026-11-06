"""Part B: my frozen blind hand gates (FlowMate) vs the original analyst's FlowJo results, screen 2.
Tolerances are the ones written in PROTOCOL.md before any result was computed."""
import json, re, sys
from collections import defaultdict
from scipy.stats import spearmanr

fr = json.load(open('results/B_frozen_handgates_als2.json'))
fj = json.load(open('results/a_als2.json'))            # FlowJo's saved counts come with the import report
P = 'Lymphocytes/Single Cells 1/Single Cells 2/Comp-LIVE_DEAD Aqua-A, SSC-A subset'
MAP = {
    'Lymphocytes': 'Lymphocytes', 'Singlets SSC': 'Lymphocytes/Single Cells 1', 'Singlets FSC': 'Lymphocytes/Single Cells 1/Single Cells 2',
    'Live': P, 'CD3+': P + '/CD3', 'CD4 T': P + '/CD3/CD4 Single Positive', 'CD8 T': P + '/CD3/CD8 Single Positive',
}
for t in ['CD4', 'CD8']:
    for mine, theirs in [('IFNg', 'IFNy FITC +'), ('IL-4', 'IL-4 BV421 +'), ('IL-10', 'IL-10 APC +'), ('IL-17', 'IL-17 BV785 +')]:
        MAP['%s %s+' % (t, mine)] = MAP['%s T' % t] + '/' + theirs
parent_of = {v: v.rsplit('/', 1)[0] if '/' in v else None for v in MAP.values()}

fjc = defaultdict(dict)
for r in fj['compare']: fjc[r['file']][r['path']] = r['flowjo']
tot = fj['flowjoTotals']
def fj_pct(file, path):
    par = parent_of[path]
    den = fjc[file][par] if par else tot[file]
    return 100.0 * fjc[file][path] / den if den else float('nan'), fjc[file][path]

strip = lambda s: re.sub(r'^(HC|ALS) ', '', s)
rows = []
for r in fr['rows']:
    f = strip(r['sample'])
    for mine, path in MAP.items():
        a, n = fj_pct(f, path)
        rows.append({'tube': f, 'pop': mine, 'mine': r['pops'][mine]['pct'], 'mine_n': r['pops'][mine]['count'], 'flowjo': a, 'flowjo_n': n})

out = {'per_pop': {}, 'rows': rows}
print('%-12s %8s %8s %8s %6s  %s' % ('population', 'medianFJ', 'max|Δ|', 'rule', 'pass', 'Spearman'))
for pop in MAP:
    R = [x for x in rows if x['pop'] == pop]
    major = sorted(x['flowjo'] for x in R)[len(R) // 2] >= 10
    ok = []
    for x in R:
        d = abs(x['mine'] - x['flowjo'])
        tol = 5.0 if major else max(0.5, 0.3 * x['flowjo'])
        x['tol'] = tol; x['pass'] = bool(d <= tol)
        ok.append(x['pass'])
    rho = spearmanr([x['mine'] for x in R], [x['flowjo'] for x in R]).correlation
    rule = '≤5pp' if major else 'max(.5pp,30%)'
    passed = all(ok) and (major or rho >= 0.9)
    out['per_pop'][pop] = {'major': major, 'tubes_within': sum(ok), 'n': len(ok), 'spearman': float(rho), 'pass': bool(passed),
                           'max_abs_diff_pp': max(abs(x['mine'] - x['flowjo']) for x in R)}
    print('%-12s %8.2f %8.2f %13s %3d/%-3d rho=%.3f  %s' % (pop, sorted(x['flowjo'] for x in R)[len(R) // 2], out['per_pop'][pop]['max_abs_diff_pp'], rule, sum(ok), len(ok), rho, 'PASS' if passed else 'FAIL'))

# the biology: does each stimulated tube respond above its donor's negative control?
DONORS = {'Donor 4 (HC)': ['C1_C01', 'C2_C02', 'C3_C03'], 'Donor 5 (HC)': ['C7_C07', 'C8_C08', 'C9_C09'], 'Donor 6 (HC)': ['H7_H07', 'H8_H08', 'H9_H09'],
          'Donor 1 (ALS)': ['C4_C04', 'C5_C05', 'C6_C06'], 'Donor 2 (ALS)': ['C10_C10', 'C11_C11', 'C12_C12'], 'Donor 3 (ALS)': ['H1_H01', 'H2_H02', 'H3_H03']}
def val(src, well, pop):
    x = [r for r in rows if well in r['tube'] and r['pop'] == pop][0]
    return x[src]
agree = tot_calls = 0
calls = []
for donor, (neg, pep, posc) in DONORS.items():
    for pop in [p for p in MAP if p.endswith('+') and p != 'CD3+']:
        for cond, well in [('Peptide', pep), ('Positive', posc)]:
            c = {}
            for src in ['mine', 'flowjo']:
                s, n0 = val(src, well, pop), val(src, neg, pop)
                c[src] = bool(s >= 2 * n0 and s - n0 >= 0.05)        # stimulation index ≥ 2 and ≥ 0.05 pp above background
            calls.append({'donor': donor, 'pop': pop, 'cond': cond, 'mine': c['mine'], 'flowjo': c['flowjo']})
            tot_calls += 1; agree += c['mine'] == c['flowjo']
print('\nresponse calls (SI ≥ 2 and ≥ 0.05 pp over the donor\'s negative tube): agree %d / %d' % (agree, tot_calls))
for c in calls:
    if c['mine'] != c['flowjo']: print('  differ:', c)
out['calls'] = calls; out['calls_agree'] = agree; out['calls_total'] = tot_calls
json.dump(out, open('results/B_compare_als2.json', 'w'), indent=1)
