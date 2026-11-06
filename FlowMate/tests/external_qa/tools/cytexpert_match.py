"""Event-level comparison of FlowMate with CytExpert's exported gated events (algae data set).
    cytexpert_match.py <xlsx> <flowmate dump comp=file> <flowmate dump comp=none> <out.json>"""
import json, sys
import numpy as np, openpyxl
xlsx, fj, nj, outp = sys.argv[1:5]
wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
fm_c = json.load(open(fj))['samples']; fm_n = json.load(open(nj))['samples']
sheets = {}
for ws in wb.worksheets:
    rows = [r for r in ws.iter_rows(values_only=True)][1:]
    sheets[ws.title] = np.array([[float(v) for v in r[:4]] for r in rows if r and r[0] is not None])
name_of = {s: (s.replace(' gated events', '') if s != 'Gated cell populations' else None) for s in sheets}
res = {}
for sheet, ex in sheets.items():
    tube = name_of[sheet]
    cands = [tube] if tube else [k[:-4] for k in fm_c]
    best = None
    for t in cands:
        c = np.array(fm_c[t + '.fcs']['rows'], dtype=np.float64); n = np.array(fm_n[t + '.fcs']['rows'], dtype=np.float64)
        # match each exported event to FlowMate's event with the same FSC-A and SSC-A (raw scatter is never compensated)
        key = {(round(a, 1), round(b, 1)): i for i, (a, b) in enumerate(c[:, :2])}
        idx = [key.get((round(a, 1), round(b, 1))) for a, b in ex[:, :2]]
        hit = sum(i is not None for i in idx)
        if best is None or hit > best[1]: best = (t, hit, idx, c, n)
    t, hit, idx, c, n = best
    ok = [k for k, i in enumerate(idx) if i is not None]
    I = np.array([idx[k] for k in ok]); E = ex[ok]
    def rel(a, b): return float(np.max(np.abs(a - b) / np.maximum(1, np.abs(b)))) if len(a) else None
    r = {'sheet': sheet, 'tube': t, 'exported': len(ex), 'matched': hit,
         'gfp_vs_comp': rel(c[I, 2], E[:, 2]), 'gfp_vs_raw': rel(n[I, 2], E[:, 2]),
         'apc_vs_comp': rel(c[I, 3], E[:, 3]), 'apc_vs_raw': rel(n[I, 3], E[:, 3]),
         'export_min_gfp': float(E[:, 2].min()), 'export_min_apc': float(E[:, 3].min()),
         'export_ratio_x1000': 1000 * float(np.median(ex[:, 2]) / np.median(ex[:, 3]))}
    # the exported set vs FlowMate's events above the same two thresholds (compensated values)
    thr_g, thr_a = r['export_min_gfp'], r['export_min_apc']
    sel = np.where((c[:, 2] >= thr_g) & (c[:, 3] >= thr_a))[0]
    r['flowmate_events_at_export_thresholds'] = int(len(sel))
    r['same_event_set'] = set(sel.tolist()) == set(I.tolist())
    res[t] = r
    print(json.dumps(r))
json.dump(res, open(outp, 'w'), indent=1)
