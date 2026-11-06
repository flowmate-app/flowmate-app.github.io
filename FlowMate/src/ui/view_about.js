/* About: what FlowMate is, who makes it, how your data is treated, how the numbers are checked,
 * what "beta" means here, and how to get involved. A page of its own (not a step). */
(function (FM) {
  'use strict';
  const { h, icon, clear } = FM.dom;

  let root = null, returnTo = 'load';

  const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

  function render() {
    if (!root) return;
    clear(root);
    const back = FM.STEPS.find(s => s.id === returnTo);
    const P = FM.project;
    root.appendChild(h('div.ab-wrap',
      h('header.ab-head',
        h('h1', 'About'),
        h('button.btn.sm', { on: { click: () => FM.go(back ? returnTo : 'load') } }, icon('left'), 'Back')),
      h('p', 'FlowMate ' + FM.version + ' is free flow cytometry analysis software that runs in the browser. Files are processed locally and are not uploaded.'),
      h('p', 'Made by ' + P.author + '. Open source under the ' + P.licence + ' licence: ', link(P.repo, 'source code'), ', ',
        link(P.repo + '/blob/main/VALIDATION.md', 'validation'), '. Tools marked ', h('span.beta', 'beta'), ' are still being tested.'),
      h('p', 'Contact, or to contribute: ', h('a', { href: 'mailto:' + P.email + '?subject=FlowMate' }, P.email), '. Bugs and requests: ',
        h('a', { href: '#', on: { click: e => { e.preventDefault(); FM.feedback.open('bug'); } } }, 'feedback'), '.')));
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
