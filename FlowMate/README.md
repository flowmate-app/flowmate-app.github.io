# FlowMate

Flow cytometry analysis in a single offline HTML file.

**Install.** Open **`dist/FlowMate.html`** in Chrome or Edge.
- No server, no Python, no internet.
- FCS files are read inside the browser tab and never leave the computer.
- The file is self-contained: copy it to a USB stick or a lab drive, or email it.

## What it does

FlowMate takes a plate of FCS files from raw data to a graph with the statistics done, in five steps:
**Load → Plate → Gate → Measure → Analysis**. Unmixing opens from the Gate step; the Guide, About and
the Panel planner are pages of their own.

- **Every gate is live on every sample at once.** Draw on one sample and every sample, a plate heat
  map and a filmstrip of all samples update as you drag.
- **Plates.** Paint conditions onto wells, see every well at once, and measure one row per well.
- **Gates.** Polygon, rectangle, ellipse, quadrant and range gates, plus And / Or / Not gates,
  suggested or drawn by hand. Resize any gate by its width, its height or both.
- **Measure.** Any statistic for every well, and formula columns computed from the others.
- **Analysis.** One graph at a time — bar, dot, box or paired — with SD or SEM and the P values,
  testing either wells or cells (nested mixed model).
- **My analyses.** Analyses are saved with their data in the browser and can be shared as one file.

## The steps

Click the FlowMate logo to go back to the start (nothing is lost); **File → New analysis** starts a fresh one.

| Step | What you do |
|---|---|
| **1 Load** | Drop FCS files or a whole folder. Wells (`01-Well-A1.fcs`, `plate_B07.fcs`, `$WELLID` / `$SMNO`) and acquisition times (`$BTIM`) are read automatically. |
| **2 Plate** | Highlight wells (drag, or click a row or column letter) and press **Create condition** to name them. **Wells + tubes** lists tubes and wells together. **Paste layout** takes a layout from Excel. Mark gate controls; exclude failed wells with a reason. |
| **Unmixing** (from the Gate step) | Choose the matrix applied to all samples: the files' own, one of yours, or none. The **Compensation wizard** builds a matrix from single-stain controls (traditional or spectral least squares). The **Matrix editor** edits spill values as a heat map with N×N previews. Imports FlowJo .mtx, Gating-ML, CSV/TSV and FCS spillover keywords. |
| **3 Gate** | A guide bar walks through the hierarchy, **Cells → Singlets → positive**, and suggests gates you accept, drag or dismiss (**G** on any plot). Draw gates yourself, **Combine** populations, or type exact coordinates (right-click → *Edit coordinates*). The side panel shows the % in the selected gate for every well. **Worksheet** puts every gating plot of a well side by side with a statistics table. |
| **4 Measure** | Pick populations and statistics (count, % of parent / total / any ancestor, median, mean, geometric mean, SD, CV, robust CV) as columns, one row per well. Add **formula columns** (`B / A * 100`, `log2(C)`, `B / groupmean(B, "Untreated")`). Copy to Excel or Prism, or export CSV. |
| **5 Analysis** | **New graph**: *Plot [column] by condition, as [Bar · Dot · Box · Paired], error bars [SD · SEM], compare [all pairs · each vs one · nothing]*. The test, adjusted P values and n / mean / SD / SEM sit beside the graph. Statistics on cells use a nested mixed model with the well as a random effect. |

### Per-well adjustments

Every gate applies to all wells. When one well drifts, set **Edits apply to** in the Gate toolbar to
that well, and dragging a gate changes that well only. A gate changed above it still flows through.

An adjusted well is always marked: the plot is ringed in amber, the population tree shows ✦ and a
count, the plate map and filmstrip mark the well, the per-well CSV has a `shared` / `adjusted for this
well` column, and the HTML report lists every adjustment with the number the well would read on the
shared gate. Right-click a gate to put a well back on the shared gate, use its gate for every well, or
reset all adjusted wells.

Templates never carry per-well adjustments; saved analyses keep them.

### The gating table

The bottom panel of the Gate step has two tabs: **Every well** (the filmstrip) and **Table** — every
population's number in every well, grouped by condition, with the median and range in each header.
It shows **% of parent**, **% of all events** or **events**. ✦ marks a gate dragged on that well;
↳ marks a number that moved because a gate above it was adjusted. **Δ vs shared** shows how far each
cell is from the shared gating.

### Figures

**Figures** in the top bar is a page for arranging plots. **Add plots** places one plot per well, per
condition, or for one well; **Tidy** packs them into a grid. **Gating strategy** lays out one plot per
gating step with arrows from each gate to the plot of what is inside it. **Add table** places the
gating summary (% of parent and events per population, per condition or per well). The plots stay
live: adjusting a gate updates every plot on the page. Save as PNG or print to PDF.

From the filmstrip, plate map or tube bars, **Export figures…** saves the selected wells' plots as
titled PNGs, one per well or as one grid.

### Event counts

The relative error of a count of *n* events is about 1/√*n* (Roederer, *Cytometry A* 2008), so every
gate label shows its count beside the percentage (`Cells 59.4% 9,007`), and the **Across all wells**
panel switches between **%**, **Events** and **Both**.

### Suggestions and framing

- **Framing.** Axes are framed on the population shown, pooled across wells (linear: 0 to about the
  97.5th percentile; logicle: T, W and M fitted to the data).
- **Cells:** the densest basin on the scatter plot, past the debris near the origin, as an 8-vertex hull.
- **Singlets:** the band along the H/A diagonal, its width estimated from the upper half of the ratio
  distribution; the lower edge at the doublet valley when there is one.
- **Positive:** with a gate control, the middle of the empty valley above the control's 99.5th
  percentile; without one, the valley between the two main peaks. Two fluorescence axes give a quadrant.

## Panel planner

**Planner** in the top bar is for choosing dyes before an experiment. Pick a cytometer (CytoFLEX
configurations, the one recorded in loaded FCS files, or your own lasers and filters), add dyes from a
library of 97 or by their excitation / emission peaks, and see the spectra against the laser lines and
filters, the detector each dye lands on, a spillover matrix, and checks for shared detectors, weak
excitation, heavy spillover and cross-laser excitation. Panels are saved in the browser and exported as
`.panel.json`. Spectra come from [FPbase](https://www.fpbase.org) (Lambert, *Nat Methods* 2019).

## Saving, sharing and reusing

- **My analyses** (File → Save, `Ctrl+S`) keeps the analysis and its data in the browser, and saves as you work.
- **Share** writes one `.flowmate` file, with or without the data.
- **Templates** keep the gates, conditions (by well position) and Measure tables, with no data, to re-apply to the next plate.
- **FlowJo 10 workspaces** (`.wsp`) import with a population-by-population comparison against FlowJo's counts.
- **Gating-ML 2.0** in and out.

## Exports

- **Measure → Export CSV**: the table, one row per well.
- **Per-well gate statistics CSV**: every well × gate (count, % of parent, % of total).
- **All population statistics CSV**: every well × population × parameter (mean, median, geometric mean, SD, CV, robust CV).
- **Events CSV**: every event of a population, for all wells, one condition or one well; compensated or as recorded; optionally thinned to 1,000–100,000 events per well.
- **PNG / SVG** of plots and graphs, the figure page as PNG or PDF, and an HTML report.

## Shortcuts

| Where | Keys |
|---|---|
| **Anywhere** | `1`–`5` steps · `Ctrl+Z` / `Ctrl+Shift+Z` undo / redo · `Ctrl+S` save · `?` help |
| **Gate: tools** | `V` select · `P` polygon · `R` rectangle · `E` ellipse · `Q` quadrant · `H` range |
| **Gate: suggestions** | `G` suggest a gate · `Enter` accept · `Esc` dismiss |
| **Gate: editing** | `Enter` close polygon · `Backspace` remove the last point · `Esc` cancel · `Delete` remove the gate · `Alt`-click a vertex to remove it · double-click an edge to add one · `Shift`-drag a side handle to keep proportions |
| **Gate: view** | `←` `→` previous / next sample · `Wheel` zoom · `+` `−` `0` zoom in / out / show all · `F` focus |

## How the numbers are computed

**FCS reading.** FCS 2.0, 3.0 and 3.1; float, double and integer data in either byte order; `$PnR`
bit masks, `$PnE` log amplification, `$PnG` gain; `$TIMESTEP` scaling of the time parameter.

**Compensation.** Each sample keeps its raw columns; gating reads those or compensated copies,
comp = raw · S⁻¹. The default is each file's own `$SPILLOVER` / `SPILL`. A matrix from single-stain
controls takes median(positive) − median(negative) in every detector, divided by the same difference
in the control's own detector.

**Axes.** Linear, log, logicle (Parks / Moore, with Parks' auto-W), arcsinh, hyperlog (Gating-ML 2.0),
and FlowJo's biex from FlowJo's own lookup table.

**Gates** are evaluated in the display scale they were drawn on (Gating-ML 2.0 semantics, as in FlowJo).
Polygons and ellipses are tested in display space; rectangles and ranges in data units, with FlowJo's
rule at the axis edge. A quadrant partitions its parent exactly. Boolean gates combine populations
event by event. Gates drawn on uncompensated channels use the raw values.

**Statistics.** The geometric mean is over positive values; robust CV follows FlowJo's convention.
t tests, one-way ANOVA, Tukey (with a port of R's `ptukey`), Dunnett and repeated measures match
GraphPad Prism; the nested mixed model (REML) matches R's `nlme`.

### Validation

| What | Reference | Result |
|---|---|---|
| Gating-ML 2.0 import | ISAC compliance suite, 13,367 events with per-event truth | 47 of 47 supported cases agree on every event |
| FlowJo biex transform | FlowJo's exported lookup table | within 4.8 × 10⁻⁶ relative |
| FlowJo `.wsp`: ellipse, quadrant, biex and arcsinh rectangles | FlowJo's saved counts | identical |
| FlowJo `.wsp`: 8-colour ICS, logicle, compensation, ellipse, And / Or / Not | FlowKit 1.3.2 | all 147 counts identical, the ellipse within 1 event |
| Single-stain compensation | synthetic controls with a known matrix | recovered within 0.01 |
| Gating-ML export → import | FlowMate itself | every count identical for every gate type |
| Held-out public data sets | FlowKit, CytExpert, Prism, R | see [`tests/external_qa`](tests/external_qa) |

## Developing

Sources live in `src/`: `core/` has no DOM dependencies; `render/`, `ui/` and `styles/` hold the rest.
`python build.py` inlines everything into `dist/FlowMate.html` and writes `tests/app_dev.html`, which
loads the unbundled sources for debugging. `python tools/fetch_spectra.py` rebuilds the planner's
spectra from FPbase.

`bash tests/run_all.sh` runs every suite in headless Chrome. `tests/public/` holds public reference
data (FlowKit test suite, BSD-3); the large FCS files go in `tests/public_large/` (git-ignored), and
their tests are skipped when it is missing.
