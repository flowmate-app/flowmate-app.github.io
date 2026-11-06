"""Lymphocytes gate (ALS screen 2): FlowJo's saved count vs exact point-in-polygon (FlowKit) vs
binned evaluations, per tube. Hypothesis test for the ~0.1 % difference."""
import sys, os, re, glob, json, warnings
import numpy as np, flowkit as fk
from matplotlib.path import Path
warnings.simplefilter('ignore')
wsp, fcsdir = sys.argv[1], sys.argv[2]
t = open(wsp, encoding='utf-8', errors='replace').read()
fm = {r['file']: r for r in json.load(open('results/a_als2.json'))['compare'] if r['path'] == 'Lymphocytes'}
for sm in re.finditer(r'<Sample>.*?</Sample>', t, re.S):
    s = sm.group(0)
    name = re.search(r'<SampleNode name="([^"]+)"', s).group(1)
    j = s.find('<Population name="Lymphocytes"')
    cnt = int(re.search(r'count="(\d+)"', s[j:j + 300]).group(1))
    g = s[s.find('<gating:PolygonGate', j):s.find('</gating:PolygonGate>', j)]
    v = [float(x) for x in re.findall(r'data-type:value="([^"]+)"', g)]
    verts = np.array(v).reshape(-1, 2)
    smp = fk.Sample(os.path.join(fcsdir, name), sample_id=name, ignore_offset_error=True)
    ev = smp.get_events(source='raw')
    lab = smp.pnn_labels
    xy = ev[:, [lab.index('FSC-A'), lab.index('SSC-A')]]
    # FlowKit's own polygon gate
    dims = [fk.Dimension('FSC-A', compensation_ref='uncompensated'), fk.Dimension('SSC-A', compensation_ref='uncompensated')]
    gs = fk.GatingStrategy(); gs.add_gate(fk.gates.PolygonGate('L', dims, [tuple(p) for p in verts]), ('root',))
    fkc = gs.gate_sample(smp).get_gate_count('L')
    mpl = int(Path(verts).contains_points(xy).sum())
    res = {}
    P = Path(verts)
    for bins in (256, 512, 1024):
        w = 262144 / bins
        lo = np.floor(xy / w) * w
        anyc = np.zeros(len(xy), bool)
        for dx in (0, 0.5, 1):
            for dy in (0, 0.5, 1):
                anyc |= P.contains_points(lo + np.array([dx * w, dy * w]))
        res[bins] = int(anyc.sum())
    # distance-tolerance: inside, or within d data units of the outline
    from matplotlib.path import Path as _P
    tol = {}
    for d in (64, 256, 512):
        tol[d] = int((P.contains_points(xy, radius=d) | P.contains_points(xy, radius=-d)).sum())
    print('%-28s FlowJo %6d | FlowMate %6d FlowKit %6d | bin-touch 256:%6d 512:%6d 1024:%6d | within 64:%6d 256:%6d 512:%6d' % (name[:28], cnt, fm[name]['ours'], fkc, res[256], res[512], res[1024], tol[64], tol[256], tol[512]))
