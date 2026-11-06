/* Feedback: a floating button on every page that opens a short form — a bug, a feature idea or a
 * question. FlowMate has no server, so the report becomes a prefilled issue on the project's public
 * GitHub repository (opened in a new tab, where the person reviews and submits it), or text to copy
 * into an email. Technical details are added only if the box is ticked, and never any data or file
 * names. */
(function (FM) {
  'use strict';
  const { h, icon, toast } = FM.dom;

  const REPO = FM.project.repo;
  const KINDS = [
    { id: 'bug', label: 'Something is wrong', tag: 'Bug', label2: 'bug', ph: 'What did you do, what did you expect, and what happened instead?' },
    { id: 'idea', label: 'An idea or a request', tag: 'Feature request', label2: 'enhancement', ph: 'What would you like FlowMate to do? What is it for in your work?' },
    { id: 'question', label: 'A question', tag: 'Question', label2: 'question', ph: 'What would you like to know?' },
  ];

  /** Version, browser and where in the app — no data, no file names. */
  function details() {
    const ws = FM.ws;
    const n = ws ? ws.samples.length : 0;
    return [
      'FlowMate ' + FM.version,
      'Page: ' + (FM.ui && FM.ui.step || '—'),
      'Files loaded: ' + n + (n ? ' (' + ws.samples.filter(s => s.well).length + ' with a well ID)' : ''),
      'Gates: ' + (ws ? ws.doc.gates.length : 0),
      'Browser: ' + navigator.userAgent,
      'Screen: ' + window.innerWidth + '×' + window.innerHeight + ' @' + (window.devicePixelRatio || 1) + 'x',
    ].join('\n');
  }

  function compose(kind, title, text, withDetails) {
    const k = KINDS.find(x => x.id === kind) || KINDS[0];
    const t = (title || '').trim() || (text || '').trim().split('\n')[0].slice(0, 80) || k.tag;
    const body = (text || '').trim() + (withDetails ? '\n\n---\n' + details() : '');
    return { title: '[' + k.tag + '] ' + t, body, label: k.label2 };
  }

  function issueUrl(r) {
    return REPO + '/issues/new?title=' + encodeURIComponent(r.title) + '&body=' + encodeURIComponent(r.body) + '&labels=' + encodeURIComponent(r.label);
  }

  /** The form. `kind` preselects bug / idea / question. */
  function open(kind) {
    let cur = kind || 'bug';
    const seg = h('div.seg.fb-kind', { role: 'group', 'aria-label': 'Kind' });
    const titleIn = h('input.input.fb-title', { placeholder: 'A short title', 'aria-label': 'Title' });
    const textIn = h('textarea.input.fb-text', { rows: 6, 'aria-label': 'Details' });
    const withDetails = h('input', { type: 'checkbox', checked: true });
    const drawSeg = () => {
      FM.dom.clear(seg);
      KINDS.forEach(k => seg.appendChild(h('button' + (cur === k.id ? '.on' : ''), { 'aria-pressed': cur === k.id ? 'true' : 'false', on: { click: () => { cur = k.id; drawSeg(); } } }, k.label)));
      textIn.placeholder = (KINDS.find(k => k.id === cur) || KINDS[0]).ph;
    };
    drawSeg();
    const check = () => {
      if (textIn.value.trim() || titleIn.value.trim()) return true;
      toast('Write a few words first', { level: 'crit' });
      textIn.focus();
      return false;
    };
    FM.dom.modal({
      title: 'Report a bug or request a feature',
      subtitle: 'FlowMate is built with the people who use it — every report is read.',
      body: h('div.fb-form',
        seg, titleIn, textIn,
        h('label.fb-check', withDetails, h('span', 'Add technical details (version, browser, which page) — never your data or file names')),
        h('div.muted.small', 'Send it as a GitHub issue (opens in a new tab; you need a free GitHub account), or copy the text and send it however you like.')),
      buttons: [
        { label: 'Cancel' },
        { label: 'Copy text', fn: () => {
          if (!check()) return false;
          const r = compose(cur, titleIn.value, textIn.value, withDetails.checked);
          FM.io.copyText(r.title + '\n\n' + r.body).then(() => toast('Copied — paste it into an email or a message'), () => toast('The browser blocked copying', { level: 'crit' }));
          FM.feedback.last = r;
          return true;
        } },
        { label: 'Open as a GitHub issue', primary: true, fn: () => {
          if (!check()) return false;
          const r = compose(cur, titleIn.value, textIn.value, withDetails.checked);
          FM.feedback.last = r;
          window.open(issueUrl(r), '_blank', 'noopener');
          toast('Opened in a new tab — check it there and press Submit');
          return true;
        } },
      ],
    });
  }

  /** The floating button, on every page. */
  function mount(parent) {
    if (document.querySelector('.fb-fab')) return;
    parent.appendChild(h('button.fb-fab', { 'data-tip': 'Report a bug or request a feature', 'aria-label': 'Report a bug or request a feature', on: { click: () => open() } },
      icon('chat'), h('span', 'Feedback')));
  }

  FM.feedback = { mount, open, compose, issueUrl, REPO, last: null };
})(FM);
