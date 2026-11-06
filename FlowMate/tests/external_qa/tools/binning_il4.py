"""FlowJo's binned polygon statistics: the CD4 IL-4 BV421+ gate of ALS screen 2, counted exactly
and on display-bin centres at several resolutions, against FlowJo's saved count.
Needs results/x_als2_cd4m.json (CD4 members from FlowMate, name-mapped run) and
results/x_als2_gates.json (the imported gates): run.sh tasks/x_als2_cd4m.json and tasks/x_als2_gates.json first.

    binning_il4.py <dir with the screen-2 FCS files under their workspace names>
"""
import json, os, sys
import numpy as np, flowkit as fk
from matplotlib.path import Path
from flowkit._models.transforms._wsp_transforms import WSPBiexTransform

d = sys.argv[1]
res = json.load(open('results/x_als2_cd4m.json'))
members = {m['file']: np.array(m['idx']) for m in res['members']}
fj = {r['file']: r for r in res['compare'] if r['path'].endswith('CD4 Single Positive/IL-4 BV421 +')}
g = [x for x in json.load(open('results/x_als2_gates.json'))['gatesOut'] if x['name'] == 'IL-4 BV421 +'][0]
T = WSPBiexTransform(negative=0, width=-100, positive=4.418539922, max_value=262144)
bx = lambda v: T.apply(np.asarray(v, float).reshape(-1, 1)).ravel() / 4096
P = Path(np.c_[bx([p[0] for p in g['verts']]), np.array([p[1] for p in g['verts']]) / 262144])
print('%-34s %6s %6s | bin centres at 64 / 128 / 256 / 512 / 1024' % ('tube', 'FlowJo', 'exact'))
for f in sorted(fj):
    s = fk.Sample(os.path.join(d, f), sample_id=f)
    s.apply_compensation(s.metadata['spill'])
    e = s.get_events(source='comp'); lab = s.pnn_labels
    idx = members[f]
    pts = np.c_[bx(e[idx, lab.index('BV421-A')]), e[idx, lab.index('SSC-A')] / 262144]
    out = [int(P.contains_points((np.floor(pts * R) + 0.5) / R).sum()) for R in (64, 128, 256, 512, 1024)]
    print('%-34s %6d %6d | %s' % (f[:34], fj[f]['flowjo'], int(P.contains_points(pts).sum()), ' '.join('%6d' % o for o in out)))
