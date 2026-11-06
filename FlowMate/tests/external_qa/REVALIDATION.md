# FlowMate external QA — re-validation after the FlowJo import fixes

**Date:** 6 Nov 2026. **Protocol:** `PROTOCOL_REVALIDATION.md` (sha256 `2a70e21b…`, logged in
`FREEZE_LOG.txt` before any result). **Data:** held-out ALS-Spectral workspaces #1, #4 and #5
(Michaelis et al., *Nature* 2025, Zenodo 16749283; FlowJo 10.10.0, Cytek Aurora), never used before.
**Referee:** FlowKit 1.3.2 (same version as in October). No code was changed during the run.

## Results

| Workspace | Populations × samples | FlowMate vs FlowKit: exact / boundary / mismatch | Samples compensated | Counts hidden as 0 by an error |
|---|---|---|---|---|
| #1 | 549 | 468 / 77 / **4** | 9 / 9 | 0 |
| #4 | 576 | 360 / 150 / **66** | 8 / 8 | 0 |
| #5 | 576 | 308 / 205 / **63** | 8 / 8 | 0 |
| **all** | **1,701** | **1,136 / 432 / 133** (92.2 % exact or boundary) | **25 / 25** | **0** |

- **E2 (every sample compensated): met.** **E3 (no error shown as 0): met.**
- **E1 (FlowMate = FlowKit except documented FlowJo behaviour): not fully met** — 133 mismatches, in
  three groups, none of them traced to a FlowMate error, but not all proven:

| Group | Count | What it is | Status |
|---|---|---|---|
| Rectangle gates whose edges reach past the axis (CD3+ CD14−, CD19 CD14−, T:M and their children) | 94 | FlowMate's count is **higher than FlowKit's in all 94**, by at most 0.5 % in #1, 6.7 % in #4 and 18 % in #5 (the large relative differences are in populations of tens of events). The pattern is the documented edge-rule difference (REPORT.md): FlowMate keeps events at the axis edge as FlowJo does, FlowKit drops them. | consistent with the documented rule; not yet verified event by event |
| CCR6− branch of #4 (a rectangle on "APC-eFluor 780-A") | 39 | **FlowKit returns 0** in every sample; FlowMate and FlowJo both count thousands of cells. | referee failure suspected (FlowKit), FlowMate unverified here |
| — | 0 | populations where FlowMate is lower than FlowKit | — |

**E4 — agreement with FlowJo's saved counts** (|Δ| in percentage points of the parent, descriptive):

| Workspace | median | 95th percentile | max |
|---|---|---|---|
| #1 | 0.01 pp | 0.06 pp | 0.6 pp |
| #4 | 0.64 pp | 7.5 pp | 63.8 pp |
| #5 | 0.49 pp | 5.0 pp | 17.6 pp |

**Open finding — FlowJo's saved counts in #4 and #5.** From the gate `cd45+, SSC-A subset` down,
FlowJo's saved counts differ from *both* independent programs: FlowJo counts 95–99 % of live cells as
CD45+, FlowMate and FlowKit 62–91 % — and FlowMate equals FlowKit on that gate in all 16 samples
(one differs by 2 events). Every gate above it agrees within about 0.2 %. The cause is not identified yet:
it is not a compensation switch (all samples are compensated, and a FlowKit diagnostic,
`tools/diag_cd45.py`, shows the CD45 channel's values unchanged by the matrix), and the workspace's structure is the same as #3's, which agreed in
October. Until it is explained, **check FlowMate's import report** (it lists FlowJo's count next to
FlowMate's for every population) when importing a workspace like this.

## What this changes from October

The October run (REPORT.md) found 7 of 10 workspaces imported wrongly, one defect silently switching
compensation off. On data never seen before, the fixed import compensates every sample, shows no
error as 0, and agrees with FlowKit on 92 % of counts exactly or within boundary, the rest in a
consistent direction; on workspace #1 it reproduces FlowJo's own numbers to a median of 0.01 pp.

Re-run: `python tools/run_part_a.py <scratch> <python with flowkit 1.3.2> spec1 spec4 spec5`, then
`python tools/reval.py spec1 spec4 spec5` (results in `results/revalidation*.json`).
