# How FlowMate is validated

Software that counts your cells has to be right, and "it looks right" is not a check. FlowMate is
compared with **independent tools** on **published data it was never developed on**, with the
protocol and pass criteria **written before any result existed**, and every failure is reported as
found. Code is never adjusted until a reference number matches; a defect is understood, fixed, and
the fix is checked on data held back for that purpose.

All data used is public (CC-BY 4.0). Everything here can be re-run with the scripts in
[`FlowMate/tests/external_qa`](FlowMate/tests/external_qa).

## Summary

| What was checked | Against | Result |
|---|---|---|
| Reading FCS files (FCS 3.0 and 3.1; BD Fortessa, Cytek Aurora) | FlowKit 1.3.2 | **bit-identical** event values |
| Compensation, event by event | FlowKit · Beckman CytExpert | equal to **6×10⁻⁸** · **1.2×10⁻⁷** (8,501 events) |
| Rule-based gating of a published experiment (11 tubes, CytoFLEX) | the paper's values | **all within 3 %**, same ranking |
| Gate counts, same gates (FlowJo workspaces, after the fixes, held-out data) | FlowKit 1.3.2 | **92 %** of 1,701 counts exact or within 2 events / 0.1 %; the rest explained below |
| FlowJo workspace import: compensation and errors | — | **25 / 25** samples compensated; **0** errors shown as a count |
| t tests, ANOVA, Tukey, Dunnett | GraphPad Prism 11 | match to the digits Prism prints |
| Nested (mixed-model) tests on cell-level data | R `nlme` | match to 1×10⁻⁵ |

## 1. The first round (October 2026) — and what it found

[`REPORT.md`](FlowMate/tests/external_qa/REPORT.md) · protocol [`PROTOCOL.md`](FlowMate/tests/external_qa/PROTOCOL.md)

Four public data sets: ALS intracellular cytokine staining and spectral panels (Michaelis et al.,
*Nature* 2025), an oligodendrocyte panel (La Manna et al., *Gene* 2023) and algae on a CytoFLEX
(Torres-Tiji et al., *PLOS ONE* 2026) — 10 FlowJo workspaces, 2,776 population counts.

**Trustworthy:** FCS reading, compensation, transforms, gate geometry and statistics — FlowMate
equals FlowKit wherever the same gates are applied, and reproduces the algae paper within 3 %.

**Not trustworthy at the time — the FlowJo import**, with seven of ten workspaces coming out wrong:

1. FlowJo writes "/" in a channel name as "_" (`LIVE/DEAD` → `LIVE_DEAD`); FlowMate didn't map it
   back, which **silently turned compensation off** and emptied every gate on that channel.
2. The import report hid it (it claimed FlowJo's matrix was in use and showed 0 for gates it could
   not compute).
3. Rectangle and range gates were tested in data units, not on the axis as FlowJo does.
4. Gates drawn on uncompensated channels were evaluated on compensated data.
5. Samples were matched by file name only.

Blind hand-gating of 18 tubes did not reach the paper's numbers within the pre-set tolerance — because
two analysts put the cytokine gates in different places (documented gate by gate), not because of the
software: with the analyst's own gates, FlowMate reproduces FlowKit exactly.

## 2. The fixes, and the re-validation on held-out data (November 2026)

[`REVALIDATION.md`](FlowMate/tests/external_qa/REVALIDATION.md) · protocol
[`PROTOCOL_REVALIDATION.md`](FlowMate/tests/external_qa/PROTOCOL_REVALIDATION.md) (hash logged before the run)

All five defects are fixed: channel names are mapped back, the report shows "not available" with the
reason and how many samples are compensated, rectangle edges at the axis floor follow FlowJo's rule,
raw-channel gates use raw values, and samples also match by their `$FIL` keyword. Each fix has a test
on synthetic data. Then three spectral workspaces **held out since October** were run once:

| Workspace | Counts | vs FlowKit: exact / boundary / mismatch | Compensated |
|---|---|---|---|
| #1 | 549 | 468 / 77 / 4 | 9 / 9 |
| #4 | 576 | 360 / 150 / 66 | 8 / 8 |
| #5 | 576 | 308 / 205 / 63 | 8 / 8 |

- **94 of the 133 mismatches**: FlowMate is *higher* than FlowKit in every one, on rectangle gates
  whose edges reach past the axis — the documented difference in how the two treat events at the axis
  edge (FlowMate follows FlowJo). Not yet verified event by event.
- **39**: one rectangle gate where FlowKit returns 0 in every sample while FlowMate and FlowJo count
  thousands — most likely a FlowKit problem, but it leaves FlowMate unchecked there.
- **Open:** in workspaces #4 and #5, FlowJo's *saved* counts differ from both FlowMate and FlowKit from
  the CD45 gate down (FlowJo ≈ 98 % CD45+ of live cells, the two independent programs 62–91 %, and
  equal to each other). Workspace #1 matches FlowJo to a median of 0.01 percentage points. The cause
  is being investigated; until then, read the import report, which lists FlowJo's count next to
  FlowMate's for every population.

## 3. Statistics

The Analysis step uses the statistics engine of PlotMate, checked cell by cell against GraphPad
Prism 11 on reference data sets (t tests, one-way and two-way ANOVA families, multiple comparisons),
and its nested mixed model against R's `nlme`. FlowMate's own tests re-check them
(`FlowMate/tests/test_groupstats.js`, `test_nested_cells.js`).

## Re-running

```bash
python FlowMate/tests/external_qa/tools/run_part_a.py <scratch dir> <python with flowkit==1.3.2> spec1 spec4 spec5
python FlowMate/tests/external_qa/tools/reval.py spec1 spec4 spec5
```

Download the FCS files from Zenodo (record numbers in REPORT.md) into
`FlowMate/tests/public_large/external_qa/` — they are not in the repository (1–2 GB per data set).

Found a case where FlowMate's numbers are wrong? Please [open an issue](https://github.com/rlshir302010-cpu/flowmate/issues)
or email rlshir302010@gmail.com.
