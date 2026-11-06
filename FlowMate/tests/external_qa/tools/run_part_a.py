"""Part A driver: for each FlowJo workspace, FlowMate's import (official) + FlowKit (referee), and —
only when FlowJo wrote a channel name differently from the FCS file — a DIAGNOSTIC run of both with
the names mapped back. Writes results/a_<id>.json, results/a_<id>_diag.json, results/fk_<id>*.json.

    python tools/run_part_a.py <scratch dir> <fkenv python> [config ids...]
"""
import json, os, re, shutil, subprocess, sys
from urllib.parse import quote as urllib_quote

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(HERE, '..', 'public_large', 'external_qa')
SCRATCH, FKPY = sys.argv[1], sys.argv[2]
strip = lambda f: re.sub(r'^(HC|ALS) ', '', f)
def fil(f):  # the file's $FIL: 'ALS Specimen_001_C1_C01 Negative.fcs' -> 'Specimen_001_C1_C01.fcs'
    m = re.match(r'^(HC|ALS) (Specimen_001_\w+?) \w+\.fcs$', f)
    return m.group(2) + '.fcs' if m else f

def files(d, prefix=None):
    return sorted(f for f in os.listdir(os.path.join(DATA, d)) if f.lower().endswith('.fcs') and (prefix is None or f.startswith(prefix + ' ')))

CONFIGS = {
    'als1_ALS': ('als_ics1', 'ALS Donors.wsp', files('als_ics1', 'ALS'), strip),
    'als1_HC': ('als_ics1', 'Healthy Donors.wsp', files('als_ics1', 'HC'), strip),
    'als2': ('als_ics2', '2-Week ICS #2.wsp', files('als_ics2'), strip),
    'als3_ALS': ('als_ics3', 'Screen #3 ALS ICS.wsp', files('als_ics3', 'ALS'), fil),
    'als3_HC': ('als_ics3', 'Screen #3 HC ICS .wsp', files('als_ics3', 'HC'), fil),
    'als4_ALS': ('als_ics4', 'Screen #4 ALS ICS.wsp', files('als_ics4', 'ALS'), fil),
    'als4_HC': ('als_ics4', 'Screen #4 HC ICS.wsp', files('als_ics4', 'HC'), fil),
    'opc': ('opc_extracted', 'Exp MSD_16_OPC stained.1.wsp', files('opc_extracted'), None),
    'spec3': ('als_spectral', '#3 Spectral.wsp', ['A3 6944 ALS.fcs', 'A4 7195 ALS.fcs', 'A5 6807 HC.fcs', 'A6 3553 HC.fcs', 'A7 3545 HC.fcs', 'A8 4660 HC.fcs', 'A1 6941 ALS.fcs', 'A2 6936 ALS.fcs'], None),
    'spec2': ('als_spectral', '#2 Spectral.wsp', ['A1 7114 ALS.fcs', 'A2 6910 ALS.fcs', 'A3 6989 ALS.fcs', 'A4 3549 HC.fcs', 'A5 3550 HC.fcs', 'A6 7102 HC.fcs'], lambda f: re.sub(r' (ALS|HC)\.fcs$', '.fcs', f)),
}

# held out until the FlowJo import fixes (PROTOCOL_REVALIDATION.md): the files each workspace lists,
# found under their Zenodo names ("A1 8592 ALS.fcs" for the workspace's "A1 8592.fcs")
def _held_out(wsp):
    import urllib.parse
    text = open(os.path.join(DATA, 'als_spectral', wsp), encoding='utf-8', errors='replace').read()
    want = sorted(set(urllib.parse.unquote(u.split('/')[-1]) for u in re.findall(r'uri="([^"]+\.fcs)"', text)))
    have = files('als_spectral')
    pick = lambda w: next((f for f in have if f == w or re.sub(r' (ALS|HC)\.fcs$', '.fcs', f) == w), None)
    return [pick(w) for w in want if pick(w)]
_strip = lambda f: re.sub(r' (ALS|HC)\.fcs$', '.fcs', f)
for _id, _w in (('spec1', '#1 Spectral.wsp'), ('spec4', '#4 Spectral.wsp'), ('spec5', '#5 Spectral.wsp')):
    try:
        _f = _held_out(_w)
        _txt = open(os.path.join(DATA, 'als_spectral', _w), encoding='utf-8', errors='replace').read()
        CONFIGS[_id] = ('als_spectral', _w, _f, _strip if any(_strip(f) != f and ('/' + urllib_quote(_strip(f))) in _txt for f in _f) else None)
    except FileNotFoundError:
        pass

def channel_names(path):
    """$PnN names straight from the FCS TEXT segment (no FlowMate involved)."""
    with open(path, 'rb') as fh:
        head = fh.read(58)
        t0, t1 = int(head[10:18]), int(head[18:26])
        fh.seek(t0); text = fh.read(t1 - t0 + 1).decode('latin-1')
    d = text[0]; parts = text[1:].split(d)
    kv = {parts[i].upper(): parts[i + 1] for i in range(0, len(parts) - 1, 2)}
    return [kv['$P%dN' % i] for i in range(1, int(kv['$PAR']) + 1)]

def sanitized_map(wsp_text, names):
    """Channels FlowJo wrote with '_' where the file has '/' (or other characters)."""
    out = []
    for n in names:
        if ('data-type:name="%s"' % n) in wsp_text: continue
        s = re.sub(r'[^A-Za-z0-9 ._+-]', '_', n)
        if s != n and ('data-type:name="%s"' % s) in wsp_text:
            out.append((s, n))
    return out

def diag_replacements(pairs):
    reps = []
    for a, b in pairs:
        for attr in ['data-type:name="', 'data-type:parameter="', 'userProvidedCompInfix="', 'value="']:
            for pre in ['', 'Comp-']:
                reps.append([attr + pre + a, attr + pre + b])
        reps.append([',' + a + ',', ',' + b + ','])
    return reps

def run_fm(task_name, task):
    json.dump(task, open(os.path.join(HERE, 'tasks', task_name + '.json'), 'w'), indent=1)
    r = subprocess.run(['bash', os.path.join(HERE, 'run.sh'), 'tasks/%s.json' % task_name], cwd=HERE, capture_output=True, text=True, encoding='utf-8', errors='replace')
    print('   FlowMate', task_name, r.stdout.strip().splitlines()[0] if r.stdout.strip() else r.stderr[-300:])

def run_fk(wsp_path, fcs_dir, out):
    r = subprocess.run([FKPY, '-I', '-X', 'utf8', '-W', 'ignore', os.path.join(HERE, 'tools', 'fk_counts.py'), wsp_path, fcs_dir, out], cwd=HERE, capture_output=True, text=True, encoding='utf-8', errors='replace')
    tail = (r.stdout + r.stderr).strip().splitlines()
    print('   FlowKit ', os.path.basename(out), (tail[-1][:150] if tail else ''), '| skipped:', sum(1 for l in tail if l.startswith('skip')))

for cid in (sys.argv[3:] or CONFIGS):
    d, wsp, fcs, ren = CONFIGS[cid]
    print('==', cid, wsp, len(fcs), 'files')
    names = {f: ren(f) for f in fcs} if ren else {}
    task = {'type': 'wsp', 'dir': '../public_large/external_qa/%s/' % d, 'fcs': fcs, 'wsp': wsp, 'names': names}
    run_fm('a_' + cid, task)
    # FlowKit needs the files under the workspace's names
    rl = os.path.join(SCRATCH, 'relinked', cid)
    os.makedirs(rl, exist_ok=True)
    for f in fcs:
        dst = os.path.join(rl, names.get(f, f))
        if not os.path.exists(dst): shutil.copy(os.path.join(DATA, d, f), dst)
    wsp_path = os.path.join(DATA, d, wsp)
    run_fk(wsp_path, rl, os.path.join(HERE, 'results', 'fk_%s.json' % cid))
    text = open(wsp_path, encoding='utf-8', errors='replace').read()
    pairs = sanitized_map(text, channel_names(os.path.join(DATA, d, fcs[0])))
    if pairs:
        print('   FlowJo renamed channels:', pairs, '→ diagnostic runs')
        reps = diag_replacements(pairs)
        run_fm('a_%s_diag' % cid, dict(task, wspReplace=reps))
        dt = text
        for a, b in reps: dt = dt.replace(a, b)
        dpath = os.path.join(SCRATCH, 'relinked', cid + '_diag.wsp')
        open(dpath, 'w', encoding='utf-8').write(dt)
        run_fk(dpath, rl, os.path.join(HERE, 'results', 'fk_%s_diag.json' % cid))
