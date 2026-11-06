/* Guide: one walk through an example analysis, step by step. Each step lists what you can do
 * there — by hand first, with the automatic helpers as options — and shows short animations of
 * the real app (tools/guide records them into guide_media.js). The beta tools (Unmixing, the
 * Planner) and a pointer to About come last. A page of its own (not a step). */
(function (FM) {
  'use strict';
  const { h, icon, clear } = FM.dom;

  let root = null, returnTo = 'load';

  const go = (step, label) => h('button.btn.sm.g-go', { on: { click: () => FM.go(step) } }, label, icon('right'));
  const kbd = (...k) => k.map((x, i) => [i ? ' + ' : null, h('kbd', x)]);

  /** Nothing loaded yet: load the demo plate and carry on to Plate. Otherwise this is just a link to Load. */
  function startButton() {
    if (FM.ws.samples.length) return go('load', 'Go to Load');
    return h('button.btn.sm.primary.g-go', { on: { click: () => { FM.loadDemo({ controls: true }); FM.go('plate'); } } }, icon('flask'), 'Load the demo plate');
  }

  // ------------------------------------------------------------- content
  /** point(bold, rest…): one thing you can do in a step. */
  const point = (lead, ...rest) => h('li', h('strong', lead + ' '), ...rest);

  const STEPS = () => [
    { title: 'Load your files',
      lead: 'Drop your FCS files, or a whole folder, onto the window, or use Choose files. Wells are read from the file names (A1, B07, Well-C3…). Nothing is uploaded: the files are read inside this browser tab.',
      points: [
        point('Add more later.', 'Press Add files any time; remove a file with its ×.'),
        point('Pick up where you left off.', 'Saved and shared analyses open from this screen and from My analyses.'),
        point('No data yet?', 'The demo plate is 18 wells of synthetic data shaped like a bead-uptake experiment — THP-1 cells given fluorescent beads with four antibody variants, plus controls.'),
      ],
      clips: [{ key: 'load', caption: 'Load a plate: the files appear with their wells and event counts.' }],
      action: startButton() },
    { title: 'Plate: say what is in each well',
      lead: 'Conditions are the groups you compare later. Highlight the wells of one condition, create it, name it — then the next.',
      points: [
        point('Highlight wells.', 'Drag across the plate, or click a row or column letter; hold ', ...kbd('Ctrl'), ' (⌘ on a Mac) to add more. Their plots appear on the right, one under another, to compare them.'),
        point('Create condition.', 'Create condition (on the left) puts the highlighted wells in a new condition with its name ready to type; set its role and colour there too. Click a condition in the list to highlight its wells again; Move to or Add to puts wells in another one.'),
        point('Wells and tubes together.', 'Files without a well ID (tubes) are listed under the plate. Wells + tubes shows everything in one list: click, ', ...kbd('Ctrl'), '-click or ', ...kbd('Shift'), '-click to highlight, then create the condition the same way.'),
        point('Leave a well out.', 'Tick “Exclude from statistics” and say why (a bubble, a clog). It stays in the file but is left out of every number, graph and test.'),
        point('Mark a gate control.', 'A condition without the thing you are looking for — cells without beads — is a gate control: it shows where “positive” starts.'),
        point('Shortcuts:', 'Quick layout (one condition per row or per column) and Paste layout from Excel.'),
      ],
      clips: [{ key: 'plate_paint', caption: 'Highlight wells, click Create condition, and name it.' },
        { key: 'plate_select', caption: 'Exclude a bad well with a reason, highlight wells (Ctrl adds more), and add them to a condition.' }],
      action: go('plate', 'Go to Plate') },
    { title: 'Gate: pick out the cells you want',
      lead: 'A gate is a shape on a plot. Draw it once and every well — and every tube — is gated with it at the same moment; the plate map, the strip of plots and the table follow as you work.',
      points: [
        point('Draw it yourself.', 'Choose a tool — polygon ', ...kbd('P'), ', rectangle ', ...kbd('R'), ', ellipse ', ...kbd('E'), ', quadrant ', ...kbd('Q'), ', or a range on a histogram ', ...kbd('H'), '. Click the corners of a polygon and press ', ...kbd('Enter'), ' to close it, then name it. Drag a corner or the whole shape to adjust it; each drag is one undo step.'),
        point('Axes and scales.', 'Pick any two parameters, or a histogram of one, and Lin, Log or Logicle for each from the button beside it. Double-click a gate to open the population inside it and gate further: cells, then singlets, then the positives.'),
        point('See the dots.', 'Make the dots bigger or smaller with the dot-size control above the plot, or ', ...kbd('['), ' and ', ...kbd(']'), '.'),
        point('Look at any well.', 'Click it in the plate map on the right (Wells + tubes lists the tubes too) or use the arrow keys; show % of parent, events, or both.'),
        point('Adjust one well only.', 'Switch “Edits apply to” from All wells to the well you are on and drag: only that well changes, and it is marked ✦ everywhere.'),
        point('All plots at once.', 'Switch One plot to Worksheet: every gating plot of the well side by side, each one live, with a statistics table among them. Choose a plot’s population from the menu on its card (or press Add plot); drag a card by its title to move it and by its corner to resize it.'),
        point('Take the cells out.', 'The download button on a population exports the value of every cell (one row per event) as a CSV for R, Python or Excel.'),
        point('Want help?', 'Suggest ', ...kbd('G'), ' and the guide bar propose gates you can accept, move or dismiss — you are never forced to use them.'),
      ],
      clips: [{ key: 'gate_draw', caption: 'Draw a polygon by clicking its corners, name it, then drag a corner. Every well follows.' },
        { key: 'gate_tools', caption: 'Choose the axes yourself and draw a rectangle; or switch to a histogram for a range gate.' },
        { key: 'gate_wells', caption: 'Move between wells, change what the plate map shows, adjust a single well, open the table.' },
        { key: 'gate_sheet', caption: 'The worksheet: every plot of the well side by side with its statistics — add a plot, choose its population, move and resize it.' }],
      action: go('gate', 'Go to Gate') },
    { title: 'Measure: choose the numbers',
      lead: 'Every well is a row. A column is a measurement of one population.',
      points: [
        point('Build a column by hand.', 'Pick the population, the statistic — count, % of parent or of total, median, mean, geometric mean, SD, CV — and, for those that need one, the parameter. Press Add column.'),
        point('Arrange the table.', 'Drag a column — its chip or its heading — to where it should go, remove it with ×, and choose the rows: every well, or one condition.'),
        point('Compute your own.', 'Switch to Formula. Columns are lettered A, B, C…; click a letter to put it in, or type it, with + − * / ^ and functions such as log2, sqrt and round. The first row’s answer shows as you type and a mistake is explained.'),
        point('Fold change.', ['B / groupmean(B, "THP + beads")'].map(c => h('code', c)), ' divides by the mean of a condition.'),
        point('Take it with you.', 'Copy pastes a real table into Excel, Prism or Word; Export CSV saves a file; Export events saves every cell’s values instead. Quick add fills in common sets in one go.'),
      ],
      clips: [{ key: 'measure_build', caption: 'Pick a population, a statistic and a parameter, add columns, drag one to reorder, choose the rows.' },
        { key: 'measure_formula', caption: 'A formula column: click letters in, see the answer, see a mistake explained, edit it later.' }],
      action: go('measure', 'Go to Measure') },
    { title: 'Analysis: graph it, with the statistics',
      lead: 'Nothing is drawn until you press New graph — one deliberate graph at a time. Read it as a sentence across the top: plot this column, by condition, as this kind of graph, with these error bars, comparing like this.',
      points: [
        point('Pick the measurement', 'and the kind: bar, dot, box, or paired (lines joining matched wells). Error bars are SD or SEM.'),
        point('Choose the comparison:', 'all pairs, each condition against one, or none. The test is chosen for you (t test for two conditions; ANOVA with Tukey or Dunnett for more), checked against GraphPad Prism.'),
        point('Wells or cells:', 'testing wells uses one value per well — the replicates. Testing cells (for a mean, median or geometric mean column) uses every cell, nested in its well: a mixed model with the well as a random effect (nested t test or nested one-way ANOVA, as in Prism). Cells of one well are not independent, so pooling them as if they were would give falsely small P values; the nested test keeps the wells as the n and lets the cells sharpen each well’s estimate.'),
        point('Show it your way.', 'Drag the condition chips to reorder the bars, leave conditions out and add them back; Show values writes each mean on its bar; stars or P values on the brackets, with or without the non-significant ones; a title and an axis title.'),
        point('Paired data.', 'Match wells by their order in each condition, by plate row, or by plate column.'),
        point('Take the graph out.', 'Copy image, PNG or SVG; the test, every comparison and n, mean, SD and SEM sit beside it. Drag graphs in the list to keep them in order.'),
      ],
      clips: [{ key: 'analysis_build', caption: 'Make a graph, change the measurement and kind, switch SD and SEM, add titles.' },
        { key: 'analysis_compare', caption: 'Compare each condition against one, choose how P is shown, leave conditions out, match wells for a paired graph.' }],
      action: go('analysis', 'Go to Analysis') },
    { title: 'Save, share, start again',
      lead: 'Your work is kept in this browser, and you can hand it to a colleague as one file.',
      points: [
        point('Save.', ...kbd('Ctrl', 'S'), ' puts the analysis and its data into My analyses; from then on it saves itself as you work. Open it again, rename, duplicate or delete it from the list.'),
        point('Share.', 'File → Share this analysis writes one .flowmate file, with the data or without it. The other person opens it from File → Open a shared analysis, or by dropping it on the window.'),
        point('Reuse next week.', 'File → Save gates and layout as a template keeps the gates, conditions and measurements (no data) to apply to the next plate.'),
        point('Start again.', 'File → New analysis clears the screen — after asking, and the saved analysis stays in My analyses. The FlowMate logo takes you back to the start at any time.'),
      ],
      clips: [{ key: 'share_save', caption: 'Save into My analyses and see what you can do with a saved analysis.' },
        { key: 'share_send', caption: 'Share it as one file, with or without the data; save a template; start a new analysis.' }],
      action: null },
  ];

  /** An animation: the real app doing what the text says. Skipped if it was not recorded. */
  function figure(clip, title) {
    const m = FM.guideMedia && FM.guideMedia[clip.key];
    if (!m) return null;
    return h('figure.g-fig', h('img', { src: m.src, width: m.w, height: m.h, loading: 'lazy', decoding: 'async', alt: title + ' — ' + clip.caption }),
      h('figcaption', clip.caption));
  }

  // ---------------------------------------------------------------- render
  function mount(el) {
    root = el;
    render();
  }

  function render() {
    if (!root) return;
    clear(root);
    const back = FM.STEPS.find(s => s.id === returnTo);
    root.appendChild(h('div.g-wrap.g-one',
      h('header.g-head',
        FM.brand.miniCell('g-cell'),
        h('div.g-title', h('div.eyebrow', 'FlowMate ' + FM.version), h('h1', 'Your first analysis'),
          h('p.muted', 'One example, from files to a graph with the statistics done — with the controls you will use at each step.')),
        h('div.g-head-actions', h('button.btn', { on: { click: () => FM.go(back ? returnTo : 'load') } }, icon('left'), 'Back to ' + (back ? back.label : 'the app')))),
      h('div.g-example', icon('beaker'),
        h('div', h('strong', 'The example question: '), 'do four antibody variants (IgG1, IgG2, IgG4, LALA) differ in how many THP-1 cells take up beads? ',
          h('span.muted', 'The recordings use a demo plate; every control shown works the same on your own data.'))),
      h('ol.g-walk', STEPS().map((s, i) => h('li.g-step',
        h('span.g-num', String(i + 1)),
        h('div.g-step-body', h('h2', s.title), h('p.g-lead', s.lead), h('ul.g-points', s.points),
          s.action ? h('div.g-step-act', s.action) : null,
          s.clips.map(c => figure(c, s.title)))))),
      h('section.g-beta', h('h2', 'Beta tools', h('span.beta', 'beta')),
        h('p.muted', 'New tools that work but are still being checked on more instruments and data — use them, and look at their results critically.'),
        h('div.g-beta-grid',
          h('div.g-beta-card', h('h3', icon('spectrum'), 'Unmixing'),
            h('p', 'Compensation for conventional cytometers and least-squares unmixing for spectral ones. Build a matrix from single-stain controls in the wizard — one row per control, with its detector and positive gate — or import a .mtx, CSV or FCS matrix; check every pair of dyes and straighten one by dragging. Mark single-stain and unstained wells with their roles on the Plate step.'),
            h('button.btn.sm', { on: { click: () => FM.go(FM.ws.samples.length ? 'unmix' : 'load') } }, 'Open the unmixing tool', icon('right'))),
          h('div.g-beta-card', h('h3', icon('spectrum'), 'Panel planner'),
            h('p', 'Choose dyes for your cytometer’s lasers and detectors and see where their spectra overlap before you stain. Save panels in this browser.'),
            h('button.btn.sm', { on: { click: () => FM.openPlanner() } }, 'Open the planner', icon('right'))))),
      h('section.g-about', h('h2', 'What is this?'),
        h('p', 'FlowMate is a free, open-source flow cytometry analysis app that runs in your browser, built by a scientist for scientists. ',
          h('button.btn.sm.ghost', { on: { click: () => FM.openAbout() } }, 'About FlowMate', icon('right'))),
        h('p.muted', 'Something not working, or missing? Use the Feedback button in the corner.'))));
  }

  /** Open the guide, remembering where to come back to. */
  function open() {
    if (FM.ui.step !== 'guide') returnTo = FM.ui.step;
    FM.go('guide');
  }

  FM.views = FM.views || {};
  FM.views.guide = { mount, update() {}, unmount() { root = null; } };
  FM.openGuide = open;
})(FM);
