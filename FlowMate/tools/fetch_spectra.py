"""Fetch fluorophore spectra from FPbase and write src/core/spectra_data.js.

    python tools/fetch_spectra.py

Run once when the dye list changes. The output is kept in src/ so builds stay offline.
Spectra: FPbase (https://www.fpbase.org), Lambert TJ, Nat Methods 16:277-278 (2019).
Brightness: typical vendor ranking (1 dim - 5 very bright) for antibody conjugates; None otherwise.
"""
import base64, datetime, json, math, pathlib, sys, urllib.request

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'src' / 'core' / 'spectra_data.js'
API = 'https://www.fpbase.org/graphql/'
START, STEP, END = 300, 2, 900
N = (END - START) // STEP + 1

A, FP, VD, TF, BD = 'Antibody dyes', 'Fluorescent proteins', 'Viability & DNA', 'Tracking & function', 'Beads'
# (id, display name, FPbase name, category, brightness 1-5 or None, also known as)
DYES = [
    ('buv395', 'BUV395', 'BD Horizon BUV395', A, 3, 'Brilliant Ultraviolet 395'),
    ('buv496', 'BUV496', 'BD Horizon BUV496', A, 3, 'Brilliant Ultraviolet 496'),
    ('buv563', 'BUV563', 'BD Horizon BUV563', A, 4, 'Brilliant Ultraviolet 563'),
    ('buv661', 'BUV661', 'BD Horizon BUV661', A, 4, 'Brilliant Ultraviolet 661'),
    ('buv737', 'BUV737', 'BD Horizon BUV737', A, 3, 'Brilliant Ultraviolet 737'),
    ('buv805', 'BUV805', 'BD Horizon BUV805', A, 2, 'Brilliant Ultraviolet 805'),
    ('bv421', 'BV421', 'Brilliant Violet 421', A, 5, 'Brilliant Violet 421'),
    ('af405', 'Alexa Fluor 405', 'Alexa Fluor 405', A, 1, 'AF405'),
    ('pacblue', 'Pacific Blue', 'Pacific Blue', A, 1, 'PB450'),
    ('ef450', 'eFluor 450', 'eFluor 450', A, 2, ''),
    ('v450', 'V450', 'BD Horizon V450', A, 2, ''),
    ('bv480', 'BV480', 'Brilliant Violet 480', A, 4, 'Brilliant Violet 480'),
    ('bv510', 'BV510', 'Brilliant Violet 510', A, 2, 'Brilliant Violet 510'),
    ('v500', 'V500', 'BD Horizon V500', A, 1, ''),
    ('pacorange', 'Pacific Orange', 'Pacific Orange', A, 1, ''),
    ('bv570', 'BV570', 'Brilliant Violet 570', A, 2, 'Brilliant Violet 570'),
    ('bv605', 'BV605', 'Brilliant Violet 605', A, 4, 'Brilliant Violet 605'),
    ('bv650', 'BV650', 'Brilliant Violet 650', A, 4, 'Brilliant Violet 650'),
    ('bv711', 'BV711', 'Brilliant Violet 711', A, 4, 'Brilliant Violet 711'),
    ('bv750', 'BV750', 'Brilliant Violet 750', A, 3, 'Brilliant Violet 750'),
    ('bv785', 'BV785', 'Brilliant Violet 785', A, 3, 'Brilliant Violet 785'),
    ('fitc', 'FITC', 'Fluorescein (FITC)', A, 2, 'fluorescein'),
    ('af488', 'Alexa Fluor 488', 'Alexa Fluor 488', A, 3, 'AF488'),
    ('bb515', 'BB515', 'BD Horizon BB515', A, 4, ''),
    ('percp', 'PerCP', 'PerCP', A, 2, 'peridinin chlorophyll protein'),
    ('percpcy55', 'PerCP-Cy5.5', 'PerCP-Cy5.5', A, 3, ''),
    ('percpef710', 'PerCP-eFluor 710', 'PerCP-eFluor 710', A, 3, ''),
    ('bb700', 'BB700', 'BD Horizon - BB700', A, 4, ''),
    ('pe', 'PE', 'PE (R-PE / R-phycoerythrin)', A, 5, 'R-phycoerythrin R-PE'),
    ('pecf594', 'PE-CF594', 'PE-CF594', A, 4, ''),
    ('pedazzle594', 'PE/Dazzle 594', 'PE/Dazzle 594', A, 4, 'PE-Dazzle'),
    ('petexasred', 'PE-Texas Red', 'PE-Texas Red', A, 3, 'ECD'),
    ('pecy5', 'PE-Cy5', 'PE-Cy5', A, 5, 'PC5'),
    ('pecy55', 'PE-Cy5.5', 'PE-Cy5.5', A, 3, 'PC5.5'),
    ('pecy7', 'PE-Cy7', 'PE-Cy7', A, 4, 'PC7'),
    ('af594', 'Alexa Fluor 594', 'Alexa Fluor 594', A, 2, 'AF594'),
    ('apc', 'APC', 'APC (allophycocyanin)', A, 4, 'allophycocyanin'),
    ('af647', 'Alexa Fluor 647', 'Alexa Fluor 647', A, 3, 'AF647'),
    ('af700', 'Alexa Fluor 700', 'Alexa Fluor 700', A, 1, 'AF700'),
    ('apccy7', 'APC-Cy7', 'APC/Cy7', A, 2, ''),
    ('apcef780', 'APC-eFluor 780', 'APC-eFluor 780', A, 2, ''),
    ('apcfire750', 'APC/Fire 750', 'APC/Fire-750', A, 3, ''),
    ('mtagbfp2', 'mTagBFP2', 'mTagBFP2', FP, None, 'BFP blue fluorescent protein'),
    ('mturquoise2', 'mTurquoise2', 'mTurquoise2', FP, None, 'CFP cyan fluorescent protein'),
    ('egfp', 'EGFP', 'EGFP', FP, None, 'GFP green fluorescent protein'),
    ('mneongreen', 'mNeonGreen', 'mNeonGreen', FP, None, ''),
    ('eyfp', 'EYFP', 'EYFP', FP, None, 'YFP yellow fluorescent protein'),
    ('venus', 'Venus', 'Venus', FP, None, 'YFP'),
    ('tdtomato', 'tdTomato', 'tdTomato', FP, None, 'RFP'),
    ('mscarlet', 'mScarlet', 'mScarlet', FP, None, 'RFP'),
    ('mcherry', 'mCherry', 'mCherry', FP, None, 'RFP red fluorescent protein'),
    ('irfp720', 'iRFP720', 'iRFP720', FP, None, 'near-infrared fluorescent protein'),
    ('dapi', 'DAPI', 'DAPI', VD, None, 'DNA dead cells'),
    ('hoechst33342', 'Hoechst 33342', 'Hoechst 33342', VD, None, 'DNA'),
    ('pi', 'Propidium iodide', 'Propidium Iodide', VD, None, 'PI dead cells'),  # the DNA-range absorption entry; the other peaks in deep UV
    ('7aad', '7-AAD', '7-AAD (7-aminoactinomycin D)', VD, None, 'dead cells'),
    ('draq5', 'DRAQ5', 'DRAQ5', VD, None, 'DNA'),
    ('draq7', 'DRAQ7', 'DRAQ7', VD, None, 'dead cells'),
    ('sytoxblue', 'SYTOX Blue', 'SYTOX Blue', VD, None, 'dead cells'),
    ('sytoxgreen', 'SYTOX Green', 'SYTOX Green', VD, None, 'dead cells'),
    ('zombieuv', 'Zombie UV', 'Zombie UV', VD, None, 'fixable viability'),
    ('zombieviolet', 'Zombie Violet', 'Zombie Violet', VD, None, 'fixable viability'),
    ('zombieaqua', 'Zombie Aqua', 'Zombie Aqua', VD, None, 'fixable viability'),
    ('zombiegreen', 'Zombie Green', 'Zombie Green', VD, None, 'fixable viability'),
    ('zombieyellow', 'Zombie Yellow', 'Zombie Yellow', VD, None, 'fixable viability'),
    ('zombiered', 'Zombie Red', 'Zombie Red', VD, None, 'fixable viability'),
    ('zombienir', 'Zombie NIR', 'Zombie NIR', VD, None, 'fixable viability near-infrared'),
    ('ldblue', 'LIVE/DEAD Fixable Blue', 'LIVE/DEAD Fixable Blue', VD, None, 'viability'),
    ('ldviolet', 'LIVE/DEAD Fixable Violet', 'LIVE/DEAD Fixable Violet', VD, None, 'viability'),
    ('ldaqua', 'LIVE/DEAD Fixable Aqua', 'LIVE/DEAD Fixable Aqua', VD, None, 'viability'),
    ('ldgreen', 'LIVE/DEAD Fixable Green', 'LIVE/DEAD Fixable Green', VD, None, 'viability'),
    ('ldyellow', 'LIVE/DEAD Fixable Yellow', 'LIVE/DEAD Fixable Yellow', VD, None, 'viability'),
    ('ldred', 'LIVE/DEAD Fixable Red', 'LIVE/DEAD Fixable Red', VD, None, 'viability'),
    ('ldfarred', 'LIVE/DEAD Fixable Far Red', 'LIVE/DEAD Fixable Far Red', VD, None, 'viability'),
    ('ldnir', 'LIVE/DEAD Fixable Near-IR', 'LIVE/DEAD Fixable Near-IR', VD, None, 'viability'),
    ('fvd450', 'Fixable Viability Dye eFluor 450', 'Fixable Viability Dye eFluor 450', VD, None, 'FVD viability'),
    ('fvd506', 'Fixable Viability Dye eFluor 506', 'Fixable Viability Dye eFluor 506', VD, None, 'FVD viability'),
    ('fvd520', 'Fixable Viability Dye eFluor 520', 'Fixable Viability Dye eFluor 520', VD, None, 'FVD viability'),
    ('fvd660', 'Fixable Viability Dye eFluor 660', 'Fixable Viability Dye eFluor 660', VD, None, 'FVD viability'),
    ('fvd780', 'Fixable Viability Dye eFluor 780', 'Fixable Viability Dye eFluor 780', VD, None, 'FVD viability'),
    ('cfse', 'CFSE', 'CFSE (fluorescein, CFDA, SE)', TF, None, 'proliferation'),
    ('ctviolet', 'CellTrace Violet', 'CellTrace Violet stain', TF, None, 'proliferation CTV'),
    ('ctyellow', 'CellTrace Yellow', 'CellTrace Yellow', TF, None, 'proliferation'),
    ('ctfarred', 'CellTrace Far Red', 'CellTrace Far Red', TF, None, 'proliferation'),
    ('calcein', 'Calcein AM', 'Calcein AM', TF, None, 'live cells calcein green'),
    ('phrodogreen', 'pHrodo Green', 'pHrodo Green', TF, None, 'phagocytosis pH'),
    ('phrodored', 'pHrodo Red', 'pHrodo Red', TF, None, 'phagocytosis pH'),
    ('fluo4', 'Fluo-4 (calcium-bound)', 'Fluo-4, Calcium Bound', TF, None, 'calcium flux'),
    ('mitogreen', 'MitoTracker Green FM', 'MitoTracker Green FM', TF, None, 'mitochondria'),
    ('mitodeepred', 'MitoTracker Deep Red FM', 'MitoTracker Deep Red FM', TF, None, 'mitochondria'),
    ('fsblue', 'FluoSpheres blue (365/415)', 'FluoSpheres blue (365/415)', BD, None, 'blue beads microspheres'),
    ('fsyg', 'FluoSpheres yellow-green', 'FluoSpheres yellow-green fluorescent microspheres', BD, None, 'YG beads microspheres'),
    ('fsorange', 'FluoSpheres orange', 'FluoSpheres orange fluorescent microspheres', BD, None, 'beads microspheres'),
    ('fsnilered', 'FluoSpheres Nile red', 'FluoSpheres nile red fluorescent microspheres', BD, None, 'beads microspheres'),
    ('fsred', 'FluoSpheres red', 'FluoSpheres red fluorescent microspheres', BD, None, 'beads microspheres'),
    ('fscrimson', 'FluoSpheres crimson', 'FluoSpheres crimson fluorescent microspheres', BD, None, 'beads microspheres'),
    ('fsdarkred', 'FluoSpheres dark red', 'FluoSpheres dark red fluorescent microspheres', BD, None, 'beads microspheres'),
]


def gql(query):
    req = urllib.request.Request(API, data=json.dumps({'query': query}).encode(),
                                 headers={'Content-Type': 'application/json', 'User-Agent': 'FlowMate fetch_spectra'})
    with urllib.request.urlopen(req, timeout=120) as r:
        out = json.load(r)
    if out.get('errors'):
        sys.exit('FPbase error: %s' % out['errors'])
    return out['data']


def resample(points):
    """Linear resampling onto the grid, normalised so the largest value on the grid is 1."""
    pts = sorted((float(x), max(0.0, float(y))) for x, y in points)
    if len(pts) < 2:
        raise ValueError('too few points')
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    out, j = [], 0
    for i in range(N):
        x = START + i * STEP
        if x < xs[0] or x > xs[-1]:
            out.append(0.0)
            continue
        while j < len(xs) - 2 and xs[j + 1] < x:
            j += 1
        x0, x1 = xs[j], xs[j + 1]
        t = 0.0 if x1 == x0 else (x - x0) / (x1 - x0)
        out.append(ys[j] + t * (ys[j + 1] - ys[j]))
    peak = max(out)
    if peak <= 0:
        raise ValueError('empty on %d-%d nm' % (START, END))
    return [v / peak for v in out]


def encode(vals):
    return base64.b64encode(bytes(min(255, round(255 * math.sqrt(v))) for v in vals)).decode('ascii')


def peak(vals):
    return START + STEP * max(range(N), key=lambda i: vals[i])


def main():
    index = {}
    for s in gql('{ spectra { id category subtype owner { name } } }')['spectra']:
        if s['category'] in ('D', 'P'):
            index.setdefault(s['owner']['name'], {})[s['subtype']] = s['id']
    wanted, missing = [], []
    for row in DYES:
        sub = index.get(row[2], {})
        ex_id, em_id = sub.get('EX') or sub.get('AB'), sub.get('EM')
        if not ex_id or not em_id:
            missing.append(row[2])
        wanted.append((row, ex_id, em_id))
    if missing:
        sys.exit('Not on FPbase (or missing EX/EM): ' + ', '.join(missing))
    ids = sorted({i for _, a, b in wanted for i in (a, b)}, key=int)
    data = {}
    for k in range(0, len(ids), 25):
        chunk = ids[k:k + 25]
        q = '{ ' + ' '.join('s%s: spectrum(id: %s) { data }' % (i, i) for i in chunk) + ' }'
        for key, v in gql(q).items():
            data[key[1:]] = v['data']
    rows = []
    for (did, name, fp, cat, b, aka), ex_id, em_id in wanted:
        ex, em = resample(data[ex_id]), resample(data[em_id])
        rows.append({'id': did, 'name': name, 'cat': cat, 'aka': aka, 'b': b, 'xp': peak(ex), 'mp': peak(em), 'ex': encode(ex), 'em': encode(em)})
        print('%-34s ex %3d  em %3d  (%s)' % (name, peak(ex), peak(em), 'EX' if index[fp].get('EX') == ex_id else 'AB'))
    by = {r['id']: r for r in rows}
    assert 488 <= by['fitc']['xp'] <= 500 and 510 <= by['fitc']['mp'] <= 526, 'FITC peaks look wrong'
    head = {'source': 'FPbase (https://www.fpbase.org) · Lambert TJ, Nat Methods 16:277–278 (2019)',
            'fetched': datetime.date.today().isoformat(), 'start': START, 'step': STEP, 'n': N}
    lines = ['/* Fluorophore spectra for the panel planner. GENERATED by tools/fetch_spectra.py; do not edit.',
             ' * Source: ' + head['source'] + '. Fetched ' + head['fetched'] + '.',
             ' * Each spectrum: %d samples, %d–%d nm every %d nm, peak = 1, stored as base64 bytes b = round(255·√v).' % (N, START, END, STEP),
             ' * b = typical vendor brightness rank (1 dim … 5 very bright); xp / mp = excitation / emission peak (nm). */',
             'FM.spectraData = ' + json.dumps(head, ensure_ascii=False)[:-1] + ', "dyes": [']
    lines += [json.dumps(r, ensure_ascii=False) + ',' for r in rows]
    lines[-1] = lines[-1].rstrip(',')
    lines.append(']};')
    OUT.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('wrote %s  (%d dyes, %d KB)' % (OUT.relative_to(ROOT), len(rows), OUT.stat().st_size // 1024))


if __name__ == '__main__':
    main()
