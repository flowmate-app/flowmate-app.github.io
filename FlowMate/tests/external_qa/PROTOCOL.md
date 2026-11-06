# FlowMate external QA — protocol (written before any result was computed)

Written 2026-10-10, before running FlowMate on any of the data below. Its purpose is to fix the
method and the pass criteria in advance, so they cannot drift toward the answer.

**Version under test:** FlowMate 0.2.0, git `b5bbd62` (no FlowMate source changes in the working
tree; `dist/FlowMate.html` is newer than every file in `src/`).

**Ground rule:** nothing in FlowMate is changed during this QA — no code, no defaults, no
transforms. Gates I draw by hand are drawn once and frozen (hashed) before the reference numbers
are opened. A disagreement is investigated to find its cause and reported; it is never tuned away.

## Data (all public, CC-BY-4.0, none used before in FlowMate's development or tests)

| ID | Source | Instrument / acquisition software | Reference analysis |
|---|---|---|---|
| ALS-ICS | Michaelis et al., *Nature* 2025 (doi:10.1038/s41586-025-09588-6); Zenodo 16749334, 16754553, 16754591, 16754609 | BD Fortessa X-20, FACSDiva 9.2 | FlowJo workspaces (.wsp) with FlowJo's saved counts |
| ALS-Spectral | same paper; Zenodo 16749283 | Cytek Aurora, SpectroFlo 3.3 | FlowJo 10.10.0 workspaces |
| OPC | La Manna et al., *Gene* 2023 (doi:10.1016/j.gene.2023.147481); Zenodo 7849046 | (read from the files) | FlowJo archive (.acs) |
| ALGAE | Torres-Tiji et al., *PLOS ONE* 2026 (doi:10.1371/journal.pone.0345458); Zenodo 18439538 | Beckman CytoFLEX, CytExpert 2.4 | the paper's reported values + `Gated cell populations.xlsx` |

## Part A — same gates: does FlowMate compute what FlowJo computed?

Import each FlowJo workspace into FlowMate with its FCS files (FlowMate's own importer, as a user
would), and compare FlowMate's event count for every population of every sample with the count
FlowJo saved in the workspace.

Per population, Δ = FlowMate − FlowJo:
- **exact**: Δ = 0
- **boundary**: |Δ| ≤ 2 events, or |Δ| ≤ 0.1 % of FlowJo's count (events sitting exactly on a gate
  edge, floating-point rounding)
- **mismatch**: anything larger

A workspace **passes** when every population is exact or boundary. Every mismatch is investigated
with FlowKit 1.x (an independent open-source FlowJo-workspace reader) as a referee, and classified
as (a) a FlowMate defect, (b) a stale count in the workspace (FlowJo itself disagrees with its
saved number), or (c) a FlowJo feature FlowMate does not support. Unsupported features count as
**not passed**, not as passed.

## Part B — blind hand gating: can a FlowMate user reach the published result?

On ALS-ICS screen 2 (18 tubes), I gate from scratch in FlowMate following the paper's published
gating strategy (Extended Data Fig. 3): lymphocytes (FSC-A × SSC-A) → singlets (SSC-A × SSC-H) →
singlets (FSC-A × FSC-H) → live (viability dye × SSC-A) → CD3+ → CD4 T / CD8 T (CD8 × CD4) →
IFNγ+, IL-4+, IL-10+, IL-17+ in CD4 T and in CD8 T. I do this **before** opening that workspace's
gates or counts, or the paper's Source Data values; the gates are saved with a SHA-256 hash first.
One gate set is applied identically to all 18 tubes (no per-tube adjustment).

Hand-drawn gates are never in exactly the same place as another analyst's, so the tolerance is
about the conclusion, not the decimal:
- populations FlowJo puts at ≥ 10 % of parent: |Δ % of parent| ≤ 5 percentage points
- rarer populations (cytokine+): |Δ| ≤ max(0.5 pp, 30 % of FlowJo's value) per tube, and the
  ranking across tubes agrees (Spearman ρ ≥ 0.9)
- the biology must match: which tubes respond (peptide / positive control above the negative
  control) must be the same

## Part C — rule-based gating against a different program (CytExpert)

ALGAE (11 tubes): gate as the paper's methods state — viable cells = chlorophyll (APC-A)
≥ ~770,000, then the top 20 % of GFP (FITC-A) events within the viable gate; read out
median(FITC-A) / median(APC-A) × 1000 in that population. Reference: the values the paper
reports (and the xlsx exported from CytExpert). Pass: the clone ranking matches and each value is
within 10 % (relative) of the reference.

## Reporting

Everything — passes, mismatches, unsupported features, things I could not test — goes into
`REPORT.md` with the raw per-population numbers in `results/`.
