# FlowMate

Free flow cytometry analysis in a single offline HTML file. FlowMate is a **BenchMate** app.

*Formerly FlowMotion (and before that Gatewell). Workspaces, templates, panels and autosaves
from the old names still open.*

**Install.** Open **`dist/FlowMate.html`** in Chrome or Edge. That's all:
- no server, no Python, no internet
- your FCS files are read inside the browser tab and never leave your computer
- the file is self-contained, so you can copy it anywhere (USB stick, lab drive) or email it to a colleague

## What it does

FlowMate takes a plate of FCS files from raw data to a graph with the statistics done, in five steps:
**Load → Plate → Gate → Measure → Analysis**. Unmixing (beta) opens from the Gate step; the Guide, About and the Planner (beta) are pages of their own, and a Feedback button on every page turns a bug report or a request into a prefilled GitHub issue.
- **Gates.** Polygon, rectangle, ellipse, quadrant and range gates, plus And / Or / Not gates, suggested for you or drawn by hand.
- **Measure.** Any statistic for every well, and formula columns that compute from the others.
- **Analysis.** One deliberate graph at a time — bar, dot, box or paired — with SD or SEM and the P values worked out.
- **Figures.** A figure page.
- **My analyses.** Save an analysis with its data in the browser, and share it with a colleague as one file.

FlowMate also does two things most tools don't:
- **Every gate is live on every sample at once.** Draw on one sample and watch every sample, a plate heat map and a filmstrip of all samples update as you drag.
- **It knows about plates.** Paint conditions onto wells, see every well at once, and measure one row per well.

## What's new in 0.2

| | |
|---|---|
| **Gate scope** | A gate applies to every sample, to some groups, or to some samples. The Gate toolbar's **New gates on: All samples / Group / This sample** decides where the next one goes. A population that doesn't exist on a sample reads "—" and is left out of statistics, never 0 %. |
| **Ellipse gates** (E) | Drawn in the display space of their axes, so an ellipse on logicle axes stays the shape you drew. Stretch and turn it by its handles. |
| **Boolean gates** | **Combine** builds And / Or / Not populations. Each term of an And can be negated. Any shape can also *keep the events outside*. |
| **Measure** | FlowJo's table editor: count, frequency of parent / total / any ancestor, median, mean, geometric mean, SD, CV and robust CV. **Formula columns** compute from the others (`B / A * 100`, `log2(C)`, `B / groupmean(B, "Untreated")`). Copy to Excel or Prism, or export CSV. |
| **Analysis** | One graph at a time, made on purpose: a Measure column by condition as bar, dot, box or paired, with SD or SEM, and the comparisons tested (t test, one-way ANOVA + Tukey or Dunnett, repeated measures for paired) — the same numbers as GraphPad Prism. Copy, PNG, SVG, or Send to PlotMate. |
| **FCS** | The time parameter is scaled by `$TIMESTEP` into seconds, as FlowJo does. |

## Six steps

One flow, in the bar at the top. Click the FlowMate logo any time to go back to the start (nothing is lost);
**File → New analysis** starts a fresh one.

| Step | What you do |
|---|---|
| **1 Load** | Drop FCS files or a whole folder. Wells (`01-Well-A1.fcs`, `plate_B07.fcs`, `$WELLID`/`$SMNO`) and acquisition times (`$BTIM`) are read automatically. |
| **2 Plate** | Highlight wells (drag, or click a row or column letter) and press **Create condition** to name them; **Wells + tubes** lists tubes and wells together to do the same; plots of the highlighted wells show beside the plate. Or **Paste layout** from Excel. Mark any **gate control** (Suggest places thresholds from it). Exclude failed wells with a reason. |
| **Unmixing (beta)** — from the Gate step | Compensation, laid out as in FlowJo. A menu says which matrix is applied to all samples (acquisition-defined, one of yours, or none). The **Compensation wizard** builds a named matrix from single-stain controls (from Plate roles or added files): a row per control with a use checkbox, a confidence dot, its detector, and draggable positive / negative gates; a universal negative (unstained); Traditional or Spectral (least squares) mode. The **Matrix editor** lists matrices (+ from controls, from file, blank; Edit makes a copy; Save as FlowJo .mtx or CSV), shows spill values as a heat map edited with the arrow keys, and previews N×N plots or histograms with the uncompensated data overlaid; drag a pair until it runs flat. Imports FlowJo .mtx, Gating-ML, CSV/TSV and FCS spillover keywords. |
| **3 Gate** | *(see also **One well at a time**, **The gating table** and **Figures**, below.)* A guide bar walks you through the hierarchy, **Cells → Singlets → positive**, and **suggests gates** you accept, drag or dismiss (press **G** on any plot). You can also draw polygon, rectangle, ellipse, quadrant or range gates yourself, **Combine** populations, and type exact coordinates (right-click a gate → *Edit coordinates*). The right-hand panel shows the % in the selected gate for **every well**, as a plate heat map or one bar per tube. The filmstrip shows the gate on every well. **Worksheet** puts every gating plot of a well side by side, each live, with a statistics table — move cards by their title, resize them by their corner, pick each card's population and axes. |
| **4 Measure** | Pick populations and statistics (count, % of parent / total / any ancestor, median, mean, geometric mean, SD, CV, robust CV) as columns; one row per well. Add **formula columns** that compute from them by letter (`B / A * 100`). **Copy** for Excel / Prism, or **Export CSV**. |
| **5 Analysis** | **New graph**, then read it as a sentence: *Plot [column] by condition, as [Bar · Dot · Box · Paired], error bars [SD · SEM], and compare [all pairs · each vs one · nothing]*. The test, adjusted P values and n / mean / SD / SEM sit beside the graph. Nothing is drawn by itself. |

### One well at a time

Every gate applies to all wells — that is the point of the tool, and it is why a comparison
between conditions can't come from gate placement. But one well sometimes drifts: a weaker
stain, a bubble, the instrument moving between the first and last well of a plate.

The **Edits apply to** switch in the Gate toolbar handles that. Leave it on **All wells**
and everything behaves as before. Flip it to the well's name and dragging that gate changes
**that well only**; every other well keeps the shared gate. A well that has its own version
of a gate keeps it when you later change the shared one — it sits the change out. Changing a
gate *above* it still flows through, so the outline you drew stays put while its numbers
follow the parent.

Because this is exactly how results get biased by accident, an adjusted well is never quiet:

- the plot is ringed in amber while the switch is on one well, and says which
- the population tree shows ✦ and a count on any gate some wells differ on
- the plate map corners and the filmstrip tiles mark those wells
- the per-well CSV gains a `shared` / `adjusted for this well` column per gate
- the **HTML report withdraws** its "one fixed gate set, applied identically to every well"
  sentence and lists every adjustment instead, with the number that well read on its own
  gate beside the number it would have read on the shared one

Getting back out: right-click a gate for *Put this well back on the shared gate*, *Use this
well's gate for every well*, or *Reset all adjusted wells*. To do several at once,
shift-click wells on the plate map and use **Apply…** — copy this well's gate, copy every
gate this well has adjusted, or send them all back to the shared gates. Every one of these
is a single undo step.

Templates never carry per-well adjustments: a nudge made for *this* plate's B3 has no
business on next week's plate. Saved workspaces keep them.

### Plots as figures

Shift- or ctrl-click wells on the filmstrip, the plate map or the tube bars and press
**Figures…** (or **Export figures…** above the filmstrip). Tick the wells you want, give each
one a title (it starts as *well · group*), and save either one PNG per well or one figure
with all of them in a grid under a shared title. Size, gates, gate % labels and event counts
are options; the plot is drawn at the zoom you are looking at, at 3× resolution.

### The gating table

The bottom panel of the Gate step has two tabs. **Every well** is the filmstrip. **Table** is
every population's number in every well, in one grid: wells down the side grouped by
condition, populations across the top in the order they are gated, and the median with its
range pinned in the header so an uneven column is obvious without reading a single number.

Switch what it shows between **% of parent**, **% of all events** and **events**. Click any
cell to jump to that well with that gate selected. The ⬇ button saves the whole grid as CSV.

Its real job is showing how far a per-well adjustment reaches. Adjusting **Cells** on B2
doesn't only change B2's Cells number — Singlets and Bead+ sit *inside* Cells, so they now
count a different set of events even though nobody touched their outlines. The table
separates those two things:

| Mark | Means |
|---|---|
| ✦ | this gate's own shape was dragged on this well |
| ↳ | this number moved because a gate **above** it was adjusted here — the knock-on effect |

Turn on **Δ vs shared** and each affected cell also shows how far it is from what that well
would read with no adjustment anywhere in its chain. That is the size of the hand work, per
population, in one view.

You don't have to open the table to see this, either: while the **Edits apply to** switch is
on one well, the amber bar above the plot keeps a running tally — *vs the shared gating: THP
Cells −1.02 · Singlets −0.08 · Bead+ +0.28* — with the gate you actually dragged underlined
and the rest being knock-on. It updates as you drag.

### Figures — the figure page

**Figures** in the top bar is a white page you arrange plots on. **Add plots** puts one plot
per well (or per condition, or one well) onto it, sized to tile the page width; **Tidy**
packs everything back into a neat grid. Drag to move, corners to resize, shift-click for
several at once, arrow keys to nudge. Edges snap to their neighbours and to the page centre.
Scroll the page, zoom with the buttons or Ctrl+wheel, and press **0** to fit it in the window.

**Gating strategy** lays out one plot per gating step, left to right — scatter, then singlets,
then the positive gate — with an arrow from each gate to the plot of what is inside it, for
one well or as one row per condition. Drag a plot and its arrows follow. Every gate you draw
on the Gate step afterwards joins the chain by itself (beside the plot it was drawn in), and
Undo takes the gate and its plot off together; deleting a gate takes its plot away too. The
arrows are worked out from the gates each time, so they can never point at nothing.

**Add table** puts the **gating summary** on the page: every population as a tree, with its
% of parent and the events behind it — per condition (mean ± SD over the included wells,
mean events per well), per well, or for one well. It sits at the bottom (Tidy keeps it
there), scales with its width like an image, and right-click copies it for Word or Excel.
A population with fewer than 100 events in any well is marked †; a gate adjusted by hand
is marked ✦ / ↳ here as everywhere else.

On the Gate step, **Lay out** sends whatever plot you are looking at straight to the page,
one per well — the filmstrip's tiles are thumbnails, this is the same thing full size.

The plots are live, not pictures. Adjust a gate afterwards and every plot on the page moves
with it, including the one well carrying its own version. Double-click a plot to open it back
on the Gate step. Save the page as a PNG, or print it (which is also how you get a PDF). The
page is stored in the workspace and in templates, so a figure layout is reusable next week.

### Event counts beside every percentage

A percentage is only as precise as the events behind it — the relative error of a count of
*n* events is about 1/√*n*, so 100 events is ±10% and 400 is ±5% (Roederer, *Cytometry A*
2008). Every gate label now reads `Cells 59.4% 9,007`, the population tree shows the count
under each %, and figure-page plots carry counts too (right-click → *Hide event counts*).
The **Across all wells** panel beside the plot has a **% · Events · Both** switch: the plate
map, the replicate strips and the range line read the % of parent, the events inside the
gate, or both at once (each cell shows its % with the count underneath). The choice is
remembered.

### How suggestions and framing work

- **Framing.** Every plot frames its axes on the population it shows, pooled across all wells
  (linear axes: from 0 to ~the 97.5th percentile plus headroom; logicle: T, W and M fitted to the
  data). Opening a gate zooms onto the events inside it. The transform type belongs to the
  channel; the range belongs to the plot.
- **Cells:** the heaviest density basin on the scatter plot (debris near the origin is passed
  over), the convex hull of its dense core, simplified to 8 draggable vertices.
- **Singlets:** the band along the H/A diagonal. Its width is estimated from the upper half of the
  ratio distribution, which doublets don't contaminate. The lower edge sits at the doublet valley
  when one exists, otherwise at 3 widths below the median.
- **Positive:** with a gate control (e.g. THP alone), the cut goes in the middle of the empty
  valley above the control's 99.5th percentile. Without one, it goes in the valley between the
  two main peaks. Two fluorescence axes give a quadrant.

On the 17-Sep-2026 plate, the suggestions alone (no preset) put bead+ within 0.8 points of the
hand-drawn gate in every well.

## Panel planner

**Planner** (beta) in the top bar opens a page for choosing dyes before an experiment. Pick the
cytometer (this lab's CytoFLEX LX, standard CytoFLEX / CytoFLEX S configurations, the one
recorded in loaded FCS files, or your own lasers and filters), add dyes from a library of 97
(antibody dyes and tandems, fluorescent proteins, viability and DNA dyes, trackers, FluoSpheres)
or from their excitation/emission peaks, and see:

- the spectra against the laser lines and detector filters. Pick a laser to see what its
  detectors actually receive;
- the detector each dye lands on (chosen automatically, or by you), how strongly it is excited and
  how much of its light passes the filter;
- a spillover matrix and plain-language checks (shared detectors, weak excitation, heavy spillover,
  a dye excited by a second laser).

Panels autosave in the browser, can be saved by name, exported/imported as `.panel.json`, and
started from a preset (**Phagocytosis**: blue beads, pHrodo Red, Zombie NIR on the LX).
Spectra come from [FPbase](https://www.fpbase.org) (Lambert, *Nat Methods* 2019);
`python tools/fetch_spectra.py` refreshes them.

## Saving, sharing and reusing

- **My analyses** (File → Save, `Ctrl+S`) keeps the analysis and its data in this browser; it then saves itself as you work.
- **Share** (File → Share this analysis, or from My analyses) writes one `.flowmate` file. Include the data and the
  other person opens it — File → Open a shared analysis, or drop it on the window — with everything in place; leave
  the data out and they add their own FCS files.
- **Templates** (File → Save gates and layout as a template) keep the gates, conditions (by well position) and Measure
  tables, with no data. Next week, load the new plate, open the template, and the analysis is re-applied.

## Exports

- **Measure → Export CSV**: your table, one row per well.
- **Per-well gate statistics CSV**: every well × every gate (count, % of parent, % of total).
- **All population statistics CSV**: long format, every well × population × parameter
  (mean, median, geometric mean, SD, CV, robust CV).
- **Events CSV** (File › Export, or right-click a gate): the value of every cell, one row per event — well, file, condition, event number, then the chosen parameters — for one population and all wells, one condition or one well; compensated or as recorded; optionally thinned evenly to 1,000–100,000 events per well.
- **PNG** of any plot (download button above the plot).
- **Figure page**: PNG or print, including strategy arrows and the gating summary table.

## Guide

The **Guide** button in the top bar opens one short, step-by-step walk through an example analysis on the built-in
demo plate, with a note on what BenchMate is for.

## Shortcuts

| Where | Keys |
|---|---|
| **Anywhere** | `1`–`5` steps · `Ctrl+Z` / `Ctrl+Shift+Z` undo / redo · `Ctrl+S` save to My analyses · `?` help |
| **Gate: tools** | `V` select · `P` polygon · `R` rectangle · `E` ellipse · `Q` quadrant · `H` range |
| **Gate: suggestions** | `G` suggest a gate · `Enter` accept · `Esc` dismiss |
| **Gate: drawing and editing** | `Enter` close polygon · `Backspace` remove the last point · `Esc` cancel · `Delete` remove the gate · `Alt`-click a vertex to remove it · double-click an edge to add one · double-click a gate to open its population |
| **Gate: view** | `←` `→` previous / next sample · `Wheel` zoom · `+` `−` `0` zoom in / out / show all · `F` focus |

## Set aside for now

To keep FlowMate tight, these are out of the app for the time being. Their engines and tests are still in the
repository, and they will come back one at a time:

- **Traditional gating** (the FlowJo-style Workspace, Tables and Compensation pages)
- **FlowJo workspace and Gating-ML** import and export
- **Send to PlotMate**
- **The phagocytosis preset**

## How the numbers are computed

**FCS reading.** Supported:
- FCS 2.0, 3.0 and 3.1
- float, double and integer data, in either byte order
- `$PnR` bit masks, `$PnE` log amplification and `$PnG` gain
- header offsets of 0
- `$TIMESTEP` scaling of the time parameter, in double precision

**Compensation.** Each sample keeps its raw columns. Gating reads either those columns or compensated copies of the active matrix's parameters, where comp = raw · S⁻¹.
- The default is each file's own `$SPILLOVER`/`SPILL`, when it isn't the identity.
- A matrix from single-stain controls takes median(positive) − median(negative) in every detector and divides it by the same difference in the control's own detector. The negatives come from the unstained tube, or else from the control's dimmest 30%. The positives are above the unstained tube's 99.5th percentile, or else the brightest 5%.

**Axes.** Every parameter has one transform, which applies to every sample:
- linear and log
- logicle, using the reference Parks/Moore algorithm with Parks' auto-W
- arcsinh
- hyperlog, as defined in Gating-ML 2.0
- FlowJo's **biex**, computed from FlowJo's own lookup table, ported from FlowKit/cytolib

**Gates** are evaluated in the display scale they were drawn on (Gating-ML 2.0 semantics, and how FlowJo works too). A gate keeps that scale, so changing an axis later never changes a result.
- **Polygons and ellipses** are tested in that display space.
- **Rectangles and ranges** are tested in data units. Imported ones exclude their upper bound, as Gating-ML does, and may have open sides.
- **A quadrant** is four linked gates that partition their parent exactly (right = x ≥ split, upper = y ≥ split), so every event lands in exactly one quadrant.
- **Boolean gates** combine populations event by event, within the deepest population that holds all of their terms.

**Statistics.**
- The geometric mean is taken over positive values.
- Robust CV follows FlowJo's convention.
- Group comparisons use one-way ANOVA and Tukey HSD (Tukey–Kramer), with a port of R's `ptukey`.
- Pearson/Spearman correlation and OLS are used for the drift F-test.

### Validation

Every claim below is a test in `tests/`, run in headless Chrome.

| What | Reference | Result |
|---|---|---|
| A real 18-well plate (17 Sep 2026): event counts in all three gates in every well, gMFI, phagoscore, ANOVA, all ten Tukey p-values, drift statistics | an independent Python analysis (statsmodels) | identical |
| Gating-ML 2.0 import | ISAC compliance suite: `data1.fcs`, 13,367 events, per-event truth | **47 of 47 supported cases agree on every event**; 4 cases (ratio dimensions, a 3-D ellipsoid) are reported as unsupported |
| FlowJo biex transform | FlowJo's exported lookup table | within 4.8 × 10⁻⁶ relative |
| FlowJo `.wsp`: ellipse, quadrant, biex and arcsinh rectangles | FlowJo's saved counts | identical |
| FlowJo `.wsp`: 8-colour ICS, 3 samples × 14–20 populations (logicle, compensation, ellipse, And / Or / Not) | FlowKit 1.3.2 | all 147 population counts identical except the ellipse, which is within 1 event (FlowKit approximates ellipses by a polygon). Every saved FlowJo count that FlowKit reproduces within 0.5 %, FlowMate reproduces too |
| Single-stain compensation | synthetic controls with a known matrix | recovered within 0.01 |
| Gating-ML export → import | FlowMate itself | every count identical for every gate type |

`tools/flowkit_counts.py` regenerates the FlowKit reference counts. It needs `pip install flowkit` in a separate environment.

**Test suites (FlowMate 0.2):**

| Command | Count | What it covers |
|---|---|---|
| `bash tests/run_tests.sh` | 174 pass, 4 skipped as unsupported | engine and interoperability |
| `bash tests/run_ui.sh` | 46 | the original UI self-test |
| `bash tests/run_ui.sh ui_v1.js` | 17 | the 0.2 views |
| `bash tests/run_ui.sh qa_selftest.js` | 19 | QA pass |
| `bash tests/run_ui.sh qa_layout.js` | 12 | QA pass |
| `bash tests/run_ui.sh qa_pub.js` | 19 | QA pass |
| `bash tests/smoke.sh` | 17 | every screen loads |

## Limitations (0.2)

- **Groups.** A sample belongs to one group. FlowJo samples in several groups join the first one, and the import says so.
- **Not yet built:**
  - tSNE / UMAP and clustering
  - cell-cycle and proliferation platforms
  - spectral unmixing
  - FlowJo `.wsp` export (Gating-ML export covers the gates)
- **Gating-ML.** Ratio dimensions and ellipsoids with three or more dimensions are reported as unsupported.
- **Compensation.** One matrix applies to the whole workspace. FlowJo workspaces with different matrices per sample use the first one, with a warning.
- **Statistics.** The Analysis step compares conditions with one factor (t tests, one-way ANOVA, Tukey, Dunnett, repeated measures). For two factors (treatment × dose), nonparametric tests or log axes, Send to PlotMate.
- **Multi-dataset FCS files.** Only the first dataset is read.
- **Very large plates.** 96 wells × 50k+ events stay responsive, but dragging a root gate updates the whole plate a few times per second rather than continuously.

## Developing

**Layout.** Sources live in `src/`:
- `core/` has no DOM dependencies.
- `render/`, `ui/` and `styles/` hold everything else.

**Build.** `python build.py` inlines everything into `dist/FlowMate.html`, including the BenchMate brand generator from `../brand/dist/benchmate-brand.js` and the favicon from `../brand/svg`. It also writes `tests/app_dev.html`, which loads the unbundled sources for debugging.

**Spectra.** The planner's spectra live in the generated `src/core/spectra_data.js`. `python tools/fetch_spectra.py` rebuilds it from FPbase (needs internet).

**Test data.**
- `tests/public/` holds public reference data (FlowKit test suite, BSD-3; see its README).
- The large FCS files go in `tests/public_large/`, which is git-ignored. Their tests are skipped when it is missing.
- The lab's own plate (`tests/data`) is not versioned.

**Tests.**

| Command | What it runs |
|---|---|
| `bash tests/run_tests.sh` | engine, real plate, interoperability |
| `bash tests/run_ui.sh` | the original UI self-test |
| `bash tests/run_ui.sh ui_v1.js` | the 0.2 views |
| `bash tests/run_ui.sh qa_selftest.js` | menus, errors, tubes, guide, start over |
| `bash tests/run_ui.sh qa_layout.js` | the figure page |
| `bash tests/run_ui.sh qa_pub.js` | counts, the strategy page, the tree table, the publication tab |
| `bash tests/smoke.sh` | every view of the built file |
