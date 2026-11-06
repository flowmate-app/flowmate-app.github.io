"""Build dist/FlowMate.html: one self-contained, offline file (fonts, CSS and JS inlined).

The BenchMate brand generator (../brand/dist/benchmate-brand.js), the shared hand-off format
(../shared/handoff.js, for Send to PlotMate) and the saved-analyses store (../shared/library.js,
for My analyses) are inlined first, then PlotMate's statistics engine (../PlotMate/src/core: t tests,
one-way ANOVA and multiple comparisons, checked against Prism) for the Analysis step. The favicon is
the FlowMate tile from ../brand/svg — run ../brand/build_brand.py after changing the brand.

    python build.py
"""
import pathlib, re, sys, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / 'src'
BRAND = ROOT.parent / 'brand'
BRAND_JS = BRAND / 'dist' / 'benchmate-brand.js'
SHARED = ROOT.parent / 'shared'
SHARED_JS = [SHARED / 'handoff.js', SHARED / 'library.js']
PLOTMATE_CORE = ROOT.parent / 'PlotMate' / 'src' / 'core'
PLOTMATE_JS = [PLOTMATE_CORE / (n + '.js') for n in ('ns', 'num', 'dist', 'linalg', 'describe', 'ttest', 'anova1', 'posthoc', 'nested')]
APP_ID = 'flowmate'

CSS = ['styles/base.css', 'styles/shell.css', 'styles/views.css', 'styles/results.css', 'styles/planner.css', 'styles/layout.css', 'styles/workspace.css']
JS = [
    'core/ns.js', 'core/fcs.js', 'core/transforms.js', 'core/scope.js', 'core/gating.js', 'core/stats.js',
    'core/inference.js', 'core/expr.js', 'core/wells.js', 'core/workspace.js', 'core/comp.js', 'core/unmix.js', 'core/matrixio.js', 'core/formula.js', 'core/tables.js', 'core/groupstats.js', 'core/graphs.js', 'core/bundle.js', 'core/xml.js', 'core/gatingml.js', 'core/wsp.js', 'core/analysis.js', 'core/summary.js', 'core/treetable.js', 'core/strategy.js', 'core/pubtext.js',
    'core/autofit.js', 'core/autogate.js', 'core/presets.js', 'core/synth.js', 'core/example_tcell.js', 'core/spectra_data.js', 'core/planner.js', 'core/handoff.js',
    'render/colormaps.js', 'render/plot.js', 'render/charts.js', 'render/tables.js', 'render/pubchart.js', 'render/statchart.js', 'render/spectra.js',
    'ui/dom.js', 'ui/brand.js', 'ui/library.js', 'ui/app.js', 'ui/axis.js', 'ui/plotview.js', 'ui/io.js', 'ui/gate_table.js',
    'ui/view_load.js', 'ui/view_plate.js', 'ui/view_unmix.js', 'ui/well_figures.js', 'ui/gate_sheet.js', 'ui/view_gate.js', 'ui/view_layout.js', 'ui/view_tables.js', 'ui/view_analysis.js', 'ui/guide_media.js', 'ui/view_guide.js', 'ui/view_about.js', 'ui/feedback.js', 'ui/view_planner.js',
]


def read(rel):
    p = SRC / rel
    if not p.exists():
        print('  (skipping missing ' + rel + ')')
        return ''
    return p.read_text(encoding='utf-8')


def favicon():
    svg = (BRAND / 'svg' / (APP_ID + '-icon.svg')).read_text(encoding='utf-8')
    return 'data:image/svg+xml,' + urllib.parse.quote(svg, safe='')


def write_dev_page(template):
    """tests/app_dev.html: the app from unbundled sources, for the UI self-test and debugging."""
    links = '\n'.join('<link rel="stylesheet" href="../src/%s">' % f for f in CSS if (SRC / f).exists())
    scripts = '<script src="../../brand/dist/benchmate-brand.js"></script>\n' + \
        ''.join('<script src="../../shared/%s"></script>\n' % p.name for p in SHARED_JS) + \
        ''.join('<script src="../../PlotMate/src/core/%s"></script>\n' % p.name for p in PLOTMATE_JS) + \
        '\n'.join('<script src="../src/%s"></script>' % f for f in JS if (SRC / f).exists())
    page = template.replace('<style>\n{{FONTS}}\n</style>', '<link rel="stylesheet" href="../assets/fonts.css">')
    page = page.replace('<style>\n{{CSS}}\n</style>', links)
    page = page.replace('<script>\n{{JS}}\n</script>', scripts + '\n<!--SELFTEST-->')
    page = page.replace('{{VERSION}}', 'dev').replace('{{FAVICON}}', favicon())
    (ROOT / 'tests' / 'app_dev.html').write_text(page, encoding='utf-8')


def main():
    version = re.search(r"FM.version = '([^']+)'", read('core/ns.js')).group(1)
    html = read('index.html')
    fonts = (ROOT / 'assets' / 'fonts.css').read_text(encoding='utf-8')
    css = '\n'.join('/* --- ' + f + ' --- */\n' + read(f) for f in CSS)
    js = ('/* --- brand/dist/benchmate-brand.js --- */\n' + BRAND_JS.read_text(encoding='utf-8') + '\n' +
          ''.join('/* --- shared/' + p.name + ' --- */\n' + p.read_text(encoding='utf-8') + '\n' for p in SHARED_JS) +
          ''.join('/* --- PlotMate/src/core/' + p.name + ' --- */\n' + p.read_text(encoding='utf-8') + '\n' for p in PLOTMATE_JS) +
          '\n'.join('/* --- ' + f + ' --- */\n' + read(f) for f in JS))
    if '</script' in js.lower():
        sys.exit('A JS source contains "</script" — it would terminate the inline script early.')
    out = html.replace('{{FONTS}}', fonts).replace('{{CSS}}', css).replace('{{JS}}', js).replace('{{VERSION}}', version).replace('{{FAVICON}}', favicon())
    write_dev_page(html)
    dist = ROOT / 'dist' / 'FlowMate.html'
    dist.parent.mkdir(parents=True, exist_ok=True)
    dist.write_text(out, encoding='utf-8')
    print('built %s  (%d KB, v%s)' % (dist.relative_to(ROOT), dist.stat().st_size // 1024, version))
    # dist/site/ is the drag-and-drop folder for static hosts (Netlify Drop etc.):
    # same page, named index.html so the host serves it at the root URL.
    site = ROOT / 'dist' / 'site'
    site.mkdir(parents=True, exist_ok=True)
    (site / 'index.html').write_text(out, encoding='utf-8')
    print('built %s  (drag this folder to app.netlify.com/drop)' % (site.relative_to(ROOT)))


if __name__ == '__main__':
    main()
