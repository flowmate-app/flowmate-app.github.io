"""DIAGNOSTIC ONLY (re-validation, workspace #4): why FlowJo counts ~98 % of live cells as CD45+
while FlowKit and FlowMate count 62–89 %. Looks at the CD45 channel (Comp-PE-Dazzle594-A) of the
live events: compensated vs uncompensated, against the gate's left edge (~22,300).

    diag_cd45.py <wsp> <fcs dir> <sample file>
"""
import sys, os, warnings, numpy as np
import flowkit as fk
warnings.simplefilter('ignore')
wsp_path, fcs_dir, sid = sys.argv[1:4]
s = fk.Sample(os.path.join(fcs_dir, sid), sample_id=sid, ignore_offset_error=True)
wsp = fk.Workspace(wsp_path, fcs_samples=[s])
wsp.analyze_samples(sample_id=sid)
res = wsp.get_gating_results(sample_id=sid)
ids = dict((n, p) for n, p in wsp.get_gate_ids(sid))
live = res.get_gate_membership('Live, SSC-A subset', ids['Live, SSC-A subset'])
cd45 = res.get_gate_membership('cd45+, SSC-A subset', ids['cd45+, SSC-A subset'])
ch = 'PE-Dazzle594-A'
raw = s.get_channel_events(s.get_channel_index(ch), source='raw')
comp_m = wsp.get_comp_matrix(sid)
s.apply_compensation(comp_m)
comp = s.get_channel_events(s.get_channel_index(ch), source='comp')
print('live', live.sum(), 'cd45+ (FlowKit)', cd45.sum(), '%.1f%%' % (100 * cd45.sum() / live.sum()))
for name, v in (('compensated', comp), ('uncompensated', raw)):
    x = v[live]
    print('%-13s live events with CD45 >= 22,300: %.1f%%   median %.0f   p5 %.0f' % (name, 100 * (x >= 22300).mean(), np.median(x), np.percentile(x, 5)))
print('matrix', comp_m.id if comp_m is not None else None, 'detectors', len(comp_m.fluorochomes) if comp_m is not None and hasattr(comp_m, 'fluorochomes') else '')
spill = s.metadata.get('spill') or s.metadata.get('spillover') or s.metadata.get('$spillover')
print('file has a spillover keyword:', bool(spill))
