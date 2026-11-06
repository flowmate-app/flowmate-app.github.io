# FlowMate external QA: report

**Date:** 10–11 Oct 2026. **Version tested:** FlowMate 0.2.0, git `b5bbd62`. FlowMate's source was not changed at any point.
The protocol and pass criteria were written before any result existed: `PROTOCOL.md`, sha256 `e3936d7e…`.
The hand-drawn gates were frozen before the reference was opened: `FREEZE_LOG.txt`.

## Verdict

| Question | Answer |
|---|---|
| Does FlowMate read the data correctly? | **Yes.** FCS values are bit-identical to FlowKit. Compensated values match FlowKit to 6×10⁻⁸ and Beckman CytExpert to 1.2×10⁻⁷, event by event (8,501 events). |
| Given the same gates, does it count the same cells? | **Yes, apart from the defects below.** Across 2,776 population counts, FlowMate equals FlowKit (an independent open-source FlowJo reader) everywhere except where one of three defects applies, or where FlowMate follows FlowJo's documented behaviour and FlowKit does not. |
| Can a FlowJo workspace be imported and trusted as it ships today? | **No.** 7 of the 10 real-world workspaces came out wrong. One defect silently turns off compensation, and the import report hides the cause. |
| Can a user hand-gate in FlowMate and reproduce a paper's numbers? | **Not within the pre-set tolerances, and that is about gate placement, not software.** My blind gates put the cytokine cut-offs above the negative control, while the original analyst cut through it. Response calls agreed 77 of 96 times. With the analyst's own gates, FlowMate reproduces FlowKit exactly. |
| Does a rule-based analysis reproduce a paper done in different software (CytExpert)? | **Yes.** All 11 tubes are within 3% of the published values, with the same ranking. |

**Bottom line:** FlowMate's arithmetic can be trusted. These are the parts that do the work: FCS reading, compensation, biex/logicle/linear transforms, polygon/rectangle geometry, statistics. Its **FlowJo import cannot yet be trusted on real workspaces** until the three defects below are fixed.

## Data used (all public, CC-BY-4.0, never used in FlowMate's development)

| Set | Source | Instrument | Reference | Size |
|---|---|---|---|---|
| ALS-ICS | Michaelis et al., *Nature* 2025, [doi:10.1038/s41586-025-09588-6](https://doi.org/10.1038/s41586-025-09588-6); Zenodo 16749334/16754553/16754591/16754609 | BD Fortessa X-20, FACSDiva 9.2, FCS 3.0 | 7 FlowJo 10.10.0 workspaces | 90 tubes, 1,728 counts |
| ALS-Spectral | same paper; Zenodo 16749283 (workspaces #2 and #3) | Cytek Aurora, SpectroFlo 3.3, FCS 3.1, 30 params | 2 FlowJo 10.10.0 workspaces | 14 samples, 942 counts |
| OPC | La Manna et al., *Gene* 2023; Zenodo 7849046 (FlowJo .acs archive) | BD (BUV/BV panel) | FlowJo 10.8.1 workspace | 31 samples, 106 counts |
| ALGAE | Torres-Tiji et al., *PLOS ONE* 2026, [doi:10.1371/journal.pone.0345458](https://doi.org/10.1371/journal.pone.0345458); Zenodo 18439538 | Beckman CytoFLEX, CytExpert 2.4 | paper's values + CytExpert's exported gated events | 11 tubes |

Independent referee: FlowKit 1.3.2 (FlowIO 1.4.0, FlowUtils 1.2.2).

## Defects found (none fixed; per instructions)

| # | Severity | Defect | Evidence | Where |
|---|---|---|---|---|
| 1 | **Critical** | FlowJo writes a channel such as `LIVE/DEAD Aqua-A` as `LIVE_DEAD Aqua-A`. FlowMate does not map it back. As a result, (a) the workspace matrix is imported as "different from the file's", it names a channel the samples lack, and `comp.matrixFor` returns null, so **every sample is left uncompensated, silently**; (b) every gate on that channel gets 0 events, and so does everything below it. | All 7 ALS-ICS workspaces: **0 of 90 tubes compensated**; Live gate 0 vs 12,197 in FlowJo; only 337 of 1,728 counts within tolerance. | `wsp.js` `bareName`/`parseMatrix`/`shapeOf`; `comp.js:36` |
| 2 | **High** | The import report misleads. It says "Compensation: FlowJo's matrix" when no sample was compensated. It explains mismatches as "FlowJo saves the counts from its last calculation…" when the cause is `Parameter "LIVE_DEAD Aqua-A" not found`, an error it never shows. Gates on FlowJo-derived parameters (tSNE) show **0 events instead of "not available"**. | screenshot `results/ui_als2_report.png`; OPC `concat_1.fcs`: 9 populations at 0 vs 6,657–22,889 | `import_dialogs.js`, `wsp.js` `compare` |
| 3 | **Medium** | Rectangle and range gates from FlowJo are tested in raw data units. FlowJo tests them on the axis (display) scale. When the biex has no room below zero (`width=-1`, common on Aurora and in FlowJo 10.10), FlowJo piles every negative event onto the axis floor and counts it inside a gate that touches the floor. FlowMate drops it. | CD8 gate: 78 extra events in FlowJo/FlowKit, all below the gate's floor; a child IL-10+ population is 6 in FlowMate vs 11 in FlowJo and FlowKit. Emulating the floor rule makes FlowMate = FlowKit on 1,728/1,728 ALS counts and 576/576 spectral #3 counts. | `gating.js` `filterShape` (rect/range) + `wsp.js` `toGate` |
| 4 | **Medium** | FlowJo gates drawn on **uncompensated** channels (no `Comp-` prefix, typical for compensation controls) are evaluated on compensated data. `wsp.js:128` computes a `comped` flag that nothing reads. | OPC compensation controls: e.g. BV786− 7,703 vs 7,670. Evaluated on raw data, all 8 differing populations equal FlowKit exactly. | `wsp.js:128`, `toGate` |
| 5 | Low (usability) | Workspace samples are matched to files by file name only. Renamed files can't be linked (there is no relink step, and the file's own `$FIL` keyword is ignored, although here it equals the workspace's name). | ALS: 0 of 90 tubes linked until the files were renamed. FlowKit has the mirror problem: it links by `$FIL` only. | `wsp.js` `matchSamples` |
| 6 | Info | Each sample joins one group only; FlowJo's overlapping groups ("HC" + "Donor 4 – HC") are dropped, with a warning. | import notes | `wsp.js` |
| 7 | Info | No "top X %" (percentile) gate. The ALGAE rule had to be done with a per-well range gate dragged to 20 %. | Part C | — |

## Part A — same gates: FlowMate vs FlowKit vs FlowJo

**As shipped**, counting a population as "agreeing" when it is exact, or within 2 events or 0.1 %, of FlowJo's saved count:

| Workspaces | Counts | Exact | Within boundary | Mismatch | Tubes compensated |
|---|---|---|---|---|---|
| ALS-ICS ×7 (FlowJo 10.10.0) | 1,728 | 195 | 142 | **1,391** | **0 / 90** |
| Spectral #3 | 576 | 101 | 187 | 288 | 8 / 8 |
| Spectral #2 | 366 | 67 | 237 | 62 | 6 / 6 |
| OPC (FlowJo 10.8.1) | 106 | 6 | 35 | 65 | 30 / 31 |

Under the protocol's rule (every population exact or within boundary), **0 of 10 workspaces pass.**

**Why, layer by layer** (FlowMate = FlowKit, counts identical):

| Run | ALS-ICS | Spectral #3 | Spectral #2 | OPC |
|---|---|---|---|---|
| as shipped | FlowKit can't read it either (same `LIVE_DEAD` name) | 503 / 576 | 337 / 366 | 89 / 97 |
| diagnostic: channel name mapped back in the workspace text | 1,684 / 1,728 | — | — | — |
| + diagnostic: rectangle edges below the axis floor opened | **1,728 / 1,728** | **576 / 576** | 338 / 366 | 89 / 97 |
| remaining differences, explained | none | none | 10 events: 9 above the axis ceiling, which FlowMate keeps as FlowJo does and FlowKit drops; 1 below the floor (defect 3) | 8: gates on uncompensated channels (defect 4); on raw data all 8 equal FlowKit |

The diagnostics changed only the reference input or the imported gates, inside the test harness (`qa.js`: `wspReplace`, `clampRects`). They are not pass results; they show what each defect hides.

**FlowJo's own numbers are not exactly reproducible by any exact-geometry program.** FlowJo documents that "statistics in FlowJo are calculated on binned data" ([FlowJo docs](https://docs.flowjo.com/flowjo/workspaces-and-samples/ws-statistics/)). FlowKit's author explains that this applies to polygon and ellipse gates ([FlowKit #113](https://github.com/whitews/FlowKit/issues/113), [#173](https://github.com/whitews/FlowKit/issues/173), [#280](https://github.com/whitews/FlowKit/issues/280)). Here FlowJo agreed exactly with FlowKit no more often than with FlowMate (622 vs 623 of 2,776). The size of the gap, with the analyst's own gates and defects 1, 3 emulated:

| | median | 95th percentile | max |
|---|---|---|---|
| ALS-ICS, populations ≥ 10 % of parent | 0.06 pp | 0.99 pp | 7.1 pp (a 14-event parent, where 1 event = 7 pp) |
| ALS-ICS, rarer populations | 0.02 pp | 0.57 pp | 3.9 pp |
| Spectral #3 / #2 | ≤ 0.02 pp | ≤ 0.12 pp | 1.7 pp |
| OPC | 0.06 pp | 0.46 pp | 0.86 pp |

The largest systematic gap is screen 2's IL-10 gate (−2 to −2.7 pp). Its edge cuts through the dense unstimulated population, where binning moves the most events. Coarse display binning reproduces the direction and most of the size (IL-4+, tube C07: exact 550, 128-bin 646, FlowJo 649), but FlowJo's exact method is proprietary (`tools/binning_il4.py`, `tools/lymph_check.py`).

## Part B — blind hand gating (ALS screen 2, 18 tubes)

Gated in FlowMate following the paper's Extended Data Fig. 3, before opening the workspace or the Source Data. The gates were frozen (sha256 `f3b40d40…`, `results/B_frozen_handgates_als2.json`). Pre-registered tolerance: ≤ 5 pp for populations ≥ 10 % of parent; max(0.5 pp, 30 %) and Spearman ρ ≥ 0.9 for rarer ones.

| Population | FlowJo median % | Max \|Δ\| (pp) | Tubes within tolerance | ρ | Result |
|---|---|---|---|---|---|
| Lymphocytes | 58.3 | 10.6 | 3/18 | 0.97 | fail |
| Singlets (SSC) | 99.2 | 0.5 | 18/18 | 0.90 | **pass** |
| Singlets (FSC) | 98.4 | 5.1 | 17/18 | 0.11 | fail |
| Live | 93.2 | 5.9 | 14/18 | 0.99 | fail |
| CD3+ | 79.0 | 10.2 | 10/18 | 0.96 | fail |
| CD4 T | 85.6 | 59.5 | 12/18 | 0.97 | fail |
| CD8 T | 6.0 | 0.7 | 18/18 | 0.99 | **pass** |
| CD4 IFNγ+ / IL-4+ / IL-10+ / IL-17+ | 3.9 / 5.0 / 34.3 / 1.9 | 45.9 / 36.2 / 54.3 / 4.8 | 1 / 0 / 0 / 0 of 18 | 0.85 / 0.85 / 0.88 / 0.74 | fail |
| CD8 IFNγ+ / IL-4+ / IL-10+ / IL-17+ | 0.9 / 0.07 / 0.2 / 0.5 | 3.4 / 4.7 / 0.8 / 5.6 | 15 / 16 / 16 / 15 of 18 | 0.76 / 0.83 / 0.42 / 0.65 | fail |

Response calls (stimulated tube ≥ 2× and ≥ 0.05 pp above the same donor's negative tube) agree **77 of 96**. This exact rule was fixed at reveal time, before the comparison was run.

**Cause: different gate placement, not different software.** The analyst's gates, read from the workspace afterwards:

| Gate | Analyst (FlowJo) | Me (FlowMate) |
|---|---|---|
| CD4 T | CD4 ≥ 761 | CD4 ≥ 138 (I kept the CD4-downregulated cells of the PMA-type Positive-control tubes) |
| IFNγ+ | FITC ≥ ~210–520 (slanted) | ≥ 1,000 (above the negative control's 99.5th–99.9th percentile) |
| IL-4+ | BV421 ≥ ~75–270 | ≥ 300 |
| IL-10+ | APC ≥ ~335–390, inside the unstimulated population (34 % "positive" even in DMSO tubes) | ≥ 1,600 |
| IL-17+ | BV785 ≥ ~440 | ≥ 1,000 (CD4) / 1,500 (CD8) |

With the analyst's gates, FlowMate reproduces FlowKit exactly and FlowJo within FlowJo's binning (Part A). Hand gating cannot test the software beyond that; it measures two analysts.

## Part C — rule-based gating vs CytExpert (ALGAE, 11 tubes)

The rule from the paper's methods: chlorophyll (APC-A) ≥ 770,000; then the top 20 % GFP per tube; then median(GFP) / median(chlorophyll) × 1000.

| Tube | WT1 | WT2 | H1 | H2 | H3 | M1 | M2 | M3 | L1 | L2 | L3 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Paper | 24 | 27 | 539 | 631 | 633 | 175 | 46 | 89 | 29 | 26 | 76 |
| FlowMate | 24.1 | 27.1 | 536.0 | 633.9 | 631.5 | 172.7 | 47.3 | 90.9 | 29.3 | 26.1 | 76.2 |

All within 3 % (criterion 10 %), same ranking: **pass**. The xlsx deposited with the paper holds CytExpert's gated events themselves, and all **8,501** of them were found in FlowMate. FlowMate's compensated values equal CytExpert's to ≤ 1.2×10⁻⁷, while uncompensated values differ by up to 200 %, so FlowMate compensates exactly as CytExpert does. The paper's numbers come from those exports (e.g. H1 539.2, M2 45.9). CytExpert's gates were 2-D shapes, not two thresholds: in 4 tubes the exported set equals "above the two minimum values", in 7 it doesn't.

## How to re-run

The data lives in `tests/public_large/external_qa/` (git-ignored); `tools/` holds the download and comparison scripts.

```
bash tests/external_qa/run.sh tests/external_qa/tasks/<task>.json          # FlowMate in headless Chrome → results/<task>.json
python tests/external_qa/tools/run_part_a.py <scratch> <python-with-flowkit> # Part A for every workspace (FlowMate + FlowKit)
python tests/external_qa/tools/summarize_a.py results/a_<id>.json
python tests/external_qa/tools/agg3.py <ids…>                                 # FlowMate vs FlowKit vs FlowJo
```

**Held out for re-testing after fixes:** spectral workspaces #1, #4 and #5 (Zenodo 16749283) have not been used. Run them only after the defects are fixed, so the fix is checked on data it wasn't tuned on.
