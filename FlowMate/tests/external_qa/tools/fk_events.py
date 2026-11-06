"""Compare FlowMate's event values (raw and compensated with the file's $SPILLOVER) with FlowKit's.
    fk_events.py <fcs dir> <flowmate dump json (comp none)> <flowmate dump json (comp file)>"""
import json, sys, os, warnings
import numpy as np, flowkit as fk
warnings.simplefilter('ignore')
d, raw_j, comp_j = sys.argv[1:4]
raw, comp = json.load(open(raw_j))['samples'], json.load(open(comp_j))['samples']
for name in raw:
    s = fk.Sample(os.path.join(d, name), ignore_offset_error=True)
    params = raw[name]['params']
    n = len(raw[name]['rows'])
    fm_raw = np.array(raw[name]['rows'], dtype=float)
    fm_comp = np.array(comp[name]['rows'], dtype=float)
    fk_raw = s.get_events(source='raw')[:n]
    labels = s.pnn_labels
    idx = [labels.index(p) for p in params]
    fk_raw = fk_raw[:, idx]
    print('==', name, 'events', s.event_count, 'FlowMate', raw[name]['n'])
    print('  raw  max |FlowMate - FlowKit| =', np.nanmax(np.abs(fm_raw - fk_raw)))
    m = s.metadata.get('spill') or s.metadata.get('spillover')
    s.apply_compensation(m)
    fk_comp = s.get_events(source='comp')[:n][:, idx]
    diff = np.abs(fm_comp - fk_comp)
    rel = diff / np.maximum(1, np.abs(fk_comp))
    print('  comp max |Δ| = %.4g   max rel = %.3g' % (np.nanmax(diff), np.nanmax(rel)))
    for j, p in enumerate(params):
        print('   %-18s raw[0]=%10.2f  FM comp[0]=%10.2f  FK comp[0]=%10.2f  max|Δ|=%.3g' % (p, fk_raw[0, j], fm_comp[0, j], fk_comp[0, j], diff[:, j].max()))
