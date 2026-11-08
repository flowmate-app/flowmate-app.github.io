"""Build the website into docs/ (served by GitHub Pages): the landing page, the app, and the files
search engines and AI assistants read (robots.txt, sitemap.xml, llms.txt, structured data).

    python tools/build_site.py

SITE is the public address. When the custom domain is live, change SITE here and add docs/CNAME
(see README → Domain).
"""
import datetime, html, json, pathlib, re, shutil, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE_SRC, OUT = ROOT / 'site', ROOT / 'docs'
SITE = 'https://flowmate-app.github.io/'
REPO = 'https://github.com/flowmate-app/flowmate-app.github.io'
AUTHOR, EMAIL = 'Shir Harel', 'rlshir302010@gmail.com'

FAQ = [
    ('Is FlowMate free?',
     'Yes. FlowMate is free and open source under the MIT licence: no account, no licence key, no limits on files or events. You may copy and adapt the code.'),
    ('Is my data uploaded anywhere?',
     'No. FCS files are read inside your browser tab and never leave your computer; FlowMate has no server. Saved analyses are kept in your browser. You can also download FlowMate as one HTML file and use it offline.'),
    ('Can I save my analysis?',
     'Yes. File → Save (Ctrl+S) keeps the analysis — data, gates, conditions, tables and graphs — under My analyses in your browser, and it keeps saving as you work. Reopen it any time from the start page. To move it to another computer or a colleague, File → Share writes it as one .flowmate file.'),
    ('How do I analyse a plate, step by step?',
     '1. Load: drop the FCS files or a folder; wells are read from the file names. 2. Plate: select wells and name each condition, and mark controls. 3. Gate: accept the suggested Cells, Singlets and positive gates or draw your own; every well updates live. 4. Measure: choose populations and statistics, one row per well. 5. Analysis: make a graph by condition and pick the comparisons; the test and P values appear beside it. The Guide in the app walks through this on a demo plate.'),
    ('Which files can FlowMate open?',
     'FCS 2.0, 3.0 and 3.1 files from any cytometer, FlowJo 10 workspaces (.wsp) with their gates, groups and compensation, and Gating-ML 2.0. It can export Gating-ML, CSV tables, PNG/SVG figures and an HTML report.'),
    ('Is FlowMate a FlowJo alternative?',
     'For gating, compensation, per-well statistics and plate experiments, yes: it imports FlowJo workspaces and shows FlowJo\'s count next to its own for every population. FlowMate is independent and not affiliated with FlowJo or BD.'),
    ('How accurate is it?',
     'FCS values are bit-identical to FlowKit, an independent open-source reader; compensated values match FlowKit and Beckman CytExpert to about 1e-7. Gate counts are compared population by population with FlowKit on published data sets, and the statistics with GraphPad Prism and R. The full validation report is public.'),
    ('What statistics does it do?',
     'Unpaired and paired t tests, ordinary and repeated-measures one-way ANOVA with Tukey or Dunnett multiple comparisons, and nested t tests / nested one-way ANOVA (a linear mixed model with the well as a random effect) for cell-level data — the same tests and numbers as GraphPad Prism.'),
    ('Does it do compensation and spectral unmixing?',
     'Compensation uses the matrix stored in the files, one computed from single-stain controls, or an imported matrix. Spectral unmixing from single-stain controls is available as a beta tool.'),
    ('Can I contribute or build my own version?',
     'Yes — fork it on GitHub and adapt it, or email ' + EMAIL + ' to build it together: new features, more instruments, or validation on your data.'),
]

STEPS = [
    ('Load', 'Drop the FCS files or a folder; wells are read from the file names.'),
    ('Plate', 'Select wells, name each condition, and mark controls.'),
    ('Gate', 'Accept the suggested gates or draw your own; every well updates live.'),
    ('Measure', 'Choose populations and statistics, one row per well.'),
    ('Analysis', 'Graph by condition with t tests, ANOVA, Tukey or Dunnett.'),
]


def validation_html():
    """The validation summary on the landing page (numbers from VALIDATION.md)."""
    rows = json.loads((SITE_SRC / 'validation.json').read_text(encoding='utf-8'))
    tr = ''.join('<tr><td>%s<div class="vs">vs %s</div></td><td class="%s">%s</td></tr>' % (html.escape(r['what']), html.escape(r['against']), r['cls'], html.escape(r['result']))
                 for r in rows if r['against'] != '—')
    return '<table><tbody>' + tr + '</tbody></table>'


def jsonld(version):
    app = {
        '@context': 'https://schema.org', '@type': 'SoftwareApplication',
        'name': 'FlowMate', 'url': SITE, 'applicationCategory': 'ScientificApplication', 'applicationSubCategory': 'Flow cytometry analysis',
        'operatingSystem': 'Any (runs in a web browser)', 'softwareVersion': version, 'isAccessibleForFree': True,
        'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'},
        'description': 'Free, open-source flow cytometry analysis in the browser: plate-wide gating, compensation, FlowJo workspace import, and statistics, validated against FlowKit and CytExpert.',
        'featureList': ['Gate every well of a plate at once', 'Polygon, rectangle, ellipse, quadrant, range and Boolean gates',
                        'Compensation from files, single stains or imported matrices', 'FlowJo 10 workspace (.wsp) and Gating-ML 2.0 import',
                        't tests, one-way ANOVA, Tukey and Dunnett, nested mixed-model tests', 'Local processing: data never leaves the computer'],
        'screenshot': SITE + 'screens/worksheet.png', 'image': SITE + 'og.png', 'license': REPO + '/blob/main/LICENSE',
        'author': {'@type': 'Person', 'name': AUTHOR, 'email': 'mailto:' + EMAIL},
        'sameAs': [REPO],
    }
    code = {'@context': 'https://schema.org', '@type': 'SoftwareSourceCode', 'name': 'FlowMate', 'codeRepository': REPO,
            'programmingLanguage': 'JavaScript', 'license': 'https://opensource.org/licenses/MIT', 'author': {'@type': 'Person', 'name': AUTHOR}}
    howto = {'@context': 'https://schema.org', '@type': 'HowTo', 'name': 'Analyse a flow cytometry plate with FlowMate',
             'tool': [{'@type': 'HowToTool', 'name': 'FlowMate (web browser)'}], 'supply': [{'@type': 'HowToSupply', 'name': 'FCS files'}],
             'step': [{'@type': 'HowToStep', 'position': i + 1, 'name': n, 'text': t, 'url': SITE + '#how'} for i, (n, t) in enumerate(STEPS)]}
    site = {'@context': 'https://schema.org', '@type': 'WebSite', 'name': 'FlowMate', 'url': SITE}
    faq = {'@context': 'https://schema.org', '@type': 'FAQPage',
           'mainEntity': [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in FAQ]}
    return json.dumps([site, app, code, howto, faq], indent=1, ensure_ascii=False).replace('</', '<\\/')


def llms_txt(version):
    faq = '\n'.join('- **%s** %s' % (q, a) for q, a in FAQ)
    return f"""# FlowMate

> FlowMate is free, open-source flow cytometry analysis that runs in a web browser. It gates every well of a plate at once, compensates, imports FlowJo workspaces, and reports statistics (t tests, ANOVA, Tukey/Dunnett, nested mixed models). Data never leaves the user's computer. Made by {AUTHOR}; MIT licence; version {version}.

## Links

- [Open the app]({SITE}app/): runs in Chrome, Edge or Firefox, nothing to install
- [Source code]({REPO}): plain JavaScript, MIT licence
- [Validation report]({REPO}/blob/main/VALIDATION.md): checked against FlowKit, Beckman CytExpert, GraphPad Prism and R on public data
- [Contact](mailto:{EMAIL}): {EMAIL} — to contribute, report a problem or build it together

## Facts

{faq}
"""


def main():
    subprocess.run([sys.executable, str(ROOT / 'FlowMate' / 'build.py')], check=True, cwd=ROOT / 'FlowMate')
    version = re.search(r"FM.version = '([^']+)'", (ROOT / 'FlowMate/src/core/ns.js').read_text(encoding='utf-8')).group(1)
    if OUT.exists():
        for p in OUT.iterdir():
            if p.name != 'CNAME':
                shutil.rmtree(p) if p.is_dir() else p.unlink()
    OUT.mkdir(exist_ok=True)
    faq_html = ''.join('<details><summary>%s</summary><p>%s</p></details>' % (html.escape(q), html.escape(a)) for q, a in FAQ)
    page = (SITE_SRC / 'landing.html').read_text(encoding='utf-8')
    for k, v in {'{{SITE}}': SITE, '{{REPO}}': REPO, '{{AUTHOR}}': AUTHOR, '{{EMAIL}}': EMAIL, '{{VERSION}}': version,
                 '{{YEAR}}': str(datetime.date.today().year), '{{FAQ_HTML}}': faq_html, '{{VALIDATION}}': validation_html(), '{{JSONLD}}': jsonld(version)}.items():
        page = page.replace(k, v)
    assert '{{' not in page, re.findall(r'{{\w+}}', page)
    (OUT / 'index.html').write_text(page, encoding='utf-8')

    # the app, with a description and canonical address of its own
    app = (ROOT / 'FlowMate/dist/FlowMate.html').read_text(encoding='utf-8')
    head = ('<title>FlowMate app — free flow cytometry analysis</title>\n'
            '<meta name="description" content="Open FCS files and analyse them in your browser: plate-wide gating, compensation, FlowJo workspace import and statistics. Free and open source; data never leaves your computer.">\n'
            '<link rel="canonical" href="' + SITE + 'app/">\n<meta property="og:title" content="FlowMate — free flow cytometry analysis">\n'
            '<meta property="og:image" content="' + SITE + 'og.png">\n<meta property="og:url" content="' + SITE + 'app/">')
    app = app.replace('<title>FlowMate</title>', head, 1)
    (OUT / 'app').mkdir()
    (OUT / 'app' / 'index.html').write_text(app, encoding='utf-8')

    for name in ['icon.svg', 'og.png'] + [p.name for p in SITE_SRC.glob('*.txt') if len(p.stem) == 32] + [p.name for p in SITE_SRC.glob('google*.html')]:   # + IndexNow key, Search Console file
        shutil.copy2(SITE_SRC / name, OUT / name)
    shutil.copytree(SITE_SRC / 'screens', OUT / 'screens')
    (OUT / '.nojekyll').write_text('', encoding='utf-8')
    (OUT / 'robots.txt').write_text('User-agent: *\nAllow: /\n\nSitemap: ' + SITE + 'sitemap.xml\n', encoding='utf-8')
    today = datetime.date.today().isoformat()
    (OUT / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        ''.join('  <url><loc>%s</loc><lastmod>%s</lastmod></url>\n' % (u, today) for u in (SITE, SITE + 'app/')) + '</urlset>\n', encoding='utf-8')
    (OUT / 'llms.txt').write_text(llms_txt(version), encoding='utf-8')
    print('built docs/ for', SITE, '(FlowMate', version + ')')


if __name__ == '__main__':
    main()
