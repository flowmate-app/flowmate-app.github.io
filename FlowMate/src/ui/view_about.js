/* About: what FlowMate is, who makes it, how your data is treated, how the numbers are checked,
 * what "beta" means here, and how to get involved. A page of its own (not a step). */
(function (FM) {
  'use strict';
  const { h, icon, clear } = FM.dom;

  let root = null, returnTo = 'load';

  const card = (ic, title, ...body) => h('div.ab-card', h('div.ab-ic', icon(ic)), h('div', h('h3', title), ...body));

  function render() {
    if (!root) return;
    clear(root);
    const back = FM.STEPS.find(s => s.id === returnTo);
    root.appendChild(h('div.ab-wrap',
      h('header.ab-head',
        FM.brand.mark(44),
        h('div.ab-title', h('div.eyebrow', 'FlowMate ' + FM.version + ' · free and open source'), h('h1', 'About FlowMate'),
          h('p.ab-lead', 'Free flow cytometry analysis that runs in your browser: load a plate, gate every well at once, measure, and graph the result with the statistics done.')),
        h('button.btn', { on: { click: () => FM.go(back ? returnTo : 'load') } }, icon('left'), 'Back to ' + (back ? back.label : 'the app'))),

      h('section.ab-mission',
        h('h2', 'Built by a scientist, for scientists'),
        h('p', 'Good flow cytometry software is often locked behind licences that many labs cannot afford — and that gap decides whose data gets analysed well. FlowMate is a free alternative: it opens in a browser with nothing to install, keeps your data on your own computer, and its results are checked against established tools.'),
        h('p', 'FlowMate is made by ', h('strong', FM.project.author), ' as an open-source project, released under the ', FM.project.licence, ' licence.')),

      h('section.ab-grid',
        card('ban', 'Your data stays with you', h('p', 'Your FCS files are read inside this browser tab. Nothing is uploaded — there is no server to upload to. Saved analyses live in this browser, and FlowMate keeps working offline.')),
        card('check', 'Numbers you can check', h('p', 'Gate counts are checked against FlowKit, and the t tests, ANOVA and multiple comparisons in Analysis against GraphPad Prism. Every test, comparison and n is shown next to its graph.')),
        card('target', 'One gate, every well', h('p', 'Draw a gate once and the whole plate is gated with it; adjust a single well where it needs it, and that is marked wherever it shows.')),
        card('sigma', 'Free', h('p', 'No licence, no account, no limits on files or events. Share an analysis with a colleague as one file.'))),

      h('section.ab-beta',
        h('h2', 'Beta tools'),
        h('p', 'Some tools are marked ', h('span.beta', 'beta'), ': they work, but they are new and still being checked on more instruments and data. Use them, look at their results critically, and tell us what you find.'),
        h('ul',
          h('li', h('strong', 'Unmixing'), ' — compensation and spectral unmixing from single-stain controls, or a matrix file. Open it from the Gate step.'),
          h('li', h('strong', 'Panel planner'), ' — choose dyes for your lasers and detectors and see where they overlap. Open it from the top bar.'))),

      h('section.ab-join',
        h('h2', 'Make it yours, or build it with me'),
        h('p', 'FlowMate’s code is open. Copy it and adapt it for your lab, your instrument or your course — that is exactly what it is for. If you would rather build it together — new features, more instruments, validation on your own data — get in touch and join the effort.'),
        h('div.row',
          h('a.btn.primary', { href: 'mailto:' + FM.project.email + '?subject=' + encodeURIComponent('FlowMate'), target: '_blank', rel: 'noopener' }, icon('mail'), 'Email ' + FM.project.email),
          h('a.btn', { href: FM.project.repo, target: '_blank', rel: 'noopener' }, icon('copy'), 'Code on GitHub — fork it'),
          h('a.btn.ghost', { href: FM.project.repo + '/blob/main/VALIDATION.md', target: '_blank', rel: 'noopener' }, icon('check'), 'How it is validated'))),

      h('section.ab-contact',
        h('h2', 'Tell me what to fix or build next'),
        h('p', 'Found a bug, missing a feature, or have a question? The Feedback button in the corner of every page sends it straight to the project.'),
        h('div.row', h('button.btn.primary', { on: { click: () => FM.feedback.open('bug') } }, icon('alert'), 'Report a bug'),
          h('button.btn', { on: { click: () => FM.feedback.open('idea') } }, icon('star'), 'Request a feature'),
          h('button.btn.ghost', { on: { click: () => FM.openGuide() } }, icon('help'), 'Read the guide'))),

      h('footer.ab-foot.muted.small', 'FlowMate ' + FM.version + ' · © ' + FM.project.author + ' · ' + FM.project.licence + ' licence · ', h('a', { href: FM.project.repo, target: '_blank', rel: 'noopener' }, 'source code'))));
  }

  function mount(el) { root = el; render(); }

  /** Open About, remembering where to come back to. */
  function open() {
    if (FM.ui.step !== 'about') returnTo = FM.ui.step;
    FM.go('about');
  }

  FM.views = FM.views || {};
  FM.views.about = { mount, update() {}, unmount() { root = null; } };
  FM.openAbout = open;
})(FM);
