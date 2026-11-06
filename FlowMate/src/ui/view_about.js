/* About: what FlowMate is, who makes it, how your data is treated, how the numbers are checked,
 * what "beta" means here, and how to get involved. A page of its own (not a step). */
(function (FM) {
  'use strict';
  const { h, icon, clear } = FM.dom;

  let root = null, returnTo = 'load';

  const ext = (cls, href, ic, text) => h('a.btn' + cls, { href, target: '_blank', rel: 'noopener' }, icon(ic), text);
  const fact = (k, v) => h('div.ab-fact', h('dt', k), h('dd', v));

  function render() {
    if (!root) return;
    clear(root);
    const back = FM.STEPS.find(s => s.id === returnTo);
    const P = FM.project;
    root.appendChild(h('div.ab-wrap',
      h('button.btn.ghost.sm.ab-back', { on: { click: () => FM.go(back ? returnTo : 'load') } }, icon('left'), 'Back'),
      h('div.ab-card',
        h('header.ab-head', FM.brand.mark(40),
          h('div', h('h1', 'FlowMate'), h('div.muted.small', 'Version ' + FM.version))),
        h('p.ab-lead', 'Free flow cytometry analysis in the browser. Files are processed locally and never uploaded.'),
        h('dl.ab-facts',
          fact('Author', P.author),
          fact('Licence', P.licence + ', open source'),
          fact('Contact', h('a', { href: 'mailto:' + P.email + '?subject=FlowMate' }, P.email))),
        h('p.ab-note.small', 'Contributions are welcome — fork the code or get in touch. Tools marked ', h('span.beta', 'beta'), ' are still being tested.'),
        h('div.ab-actions',
          ext('.primary', P.repo, 'copy', 'Source code'),
          ext('', P.repo + '/blob/main/VALIDATION.md', 'check', 'Validation'),
          h('button.btn.ghost', { on: { click: () => FM.feedback.open('bug') } }, icon('alert'), 'Send feedback')))));
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
