"""Independent reference (needs `pip install flowkit` in a separate environment): FlowKit's counts for every population of every sample in a FlowJo
workspace, written as JSON for FlowMate's interop tests.

    fk_counts.py <wsp> <fcs dir> <out.json>
"""
import json, sys, warnings
import flowkit as fk

wsp_path, fcs_dir, out = sys.argv[1], sys.argv[2], sys.argv[3]
warnings.simplefilter('ignore')
wsp = fk.Workspace(wsp_path, fcs_samples=fcs_dir)
res = {}
for sid in wsp.get_sample_ids():
    try:
        wsp.analyze_samples(sample_id=sid)
        r = wsp.get_gating_results(sample_id=sid)
    except Exception as e:  # noqa
        print('skip', sid, e)
        continue
    rows = {}
    for gate_name, gate_path in wsp.get_gate_ids(sid):
        path = '/'.join(list(gate_path[1:]) + [gate_name])
        rows[path] = int(r.get_gate_count(gate_name, gate_path))
    res[sid] = rows
json.dump(res, open(out, 'w'), indent=1)
print('wrote', out, {k: len(v) for k, v in res.items()})
