# FlowMate external QA — re-validation after the FlowJo import fixes

**Written 2026-11-06, before any result on the data below existed.** Hash this file before the run.

## What changed

FlowJo import (src/core/wsp.js, gating.js, transforms.js, import_dialogs.js), fixing defects 1–4 of
REPORT.md (Oct 2026):

1. channel names FlowJo wrote with "_" for "/" are mapped back to the files' names
2. the import report shows "not available" with the reason instead of 0, and how many samples
   are compensated
3. rectangle and range edges at or below their axis floor are open (FlowJo tests them on the axis)
4. gates FlowJo drew on uncompensated channels are evaluated on uncompensated values

The fixes were designed from FlowJo's documented behaviour and the October root-cause analysis,
and tested on synthetic data only (tests/test_flowjo_fixes.js).

## Data — held out, never used before

ALS-Spectral, Michaelis et al., *Nature* 2025, Zenodo 16749283: workspaces **#1, #4 and #5**
(FlowJo 10.10.0, Cytek Aurora, FCS 3.1). Not opened, imported or inspected (other than listing
the FCS file names each one references) before this protocol was written.

## Method and pass criteria — the same as Part A of PROTOCOL.md, unchanged

Import each workspace with FlowMate's own importer (as shipped after the fixes, no harness
diagnostics), and compare every population of every sample with:

- **FlowKit 1.3.2** (independent referee, same version as in October) — the exact reference
- **FlowJo's saved counts** — with the binning caveat of REPORT.md

Per population, Δ = FlowMate − reference: **exact** Δ = 0; **boundary** |Δ| ≤ 2 events or
≤ 0.1 % of the reference; **mismatch** otherwise.

Pre-registered expectations, to be reported as found:

- **E1 (primary):** FlowMate equals FlowKit (exact or boundary) for every population, except where
  FlowMate follows FlowJo's documented behaviour and FlowKit does not (events above the axis
  ceiling, REPORT.md), each such case explained event by event.
- **E2:** every sample with a matrix in the workspace is compensated.
- **E3:** no population is reported as 0 because of an error; any population FlowMate cannot
  compute is "not available" with its reason.
- **E4 (secondary, descriptive):** agreement with FlowJo's saved counts, as median / 95th percentile /
  max |Δ| in percentage points, as in REPORT.md. No pass threshold: FlowJo counts binned data.

No code change is made during this run. Any mismatch is investigated and reported, not fixed.
