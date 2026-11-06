# Validation

FlowMate's results are compared with independent tools on public data (CC-BY 4.0) that was not used
to develop it. The protocol and pass criteria were written before the comparisons were run. Code is
not adjusted to match a reference number.

## Results

| What was checked | Against | Result |
|---|---|---|
| Reading FCS files (FCS 3.0 / 3.1; BD Fortessa, Cytek Aurora) | FlowKit 1.3.2 | Bit-identical event values |
| Compensation, event by event | FlowKit · Beckman CytExpert | Equal to 6×10⁻⁸ · 1.2×10⁻⁷ |
| Gate counts, FlowJo workspaces (1,701 counts, 3 workspaces) | FlowKit 1.3.2 | 92 % exact or within 2 events / 0.1 % |
| FlowJo import: compensation applied | — | 25 / 25 samples |
| Rule-based gating of a published experiment (11 tubes, CytoFLEX) | The paper's values | All within 3 % |
| t tests, ANOVA, Tukey, Dunnett | GraphPad Prism 11 | Match to the digits Prism prints |
| Nested (mixed-model) tests on cells | R `nlme` | Match to 1×10⁻⁵ |

## Known differences

- **Rectangle gates at the axis edge.** In 94 of the 133 gate counts that differ from FlowKit, FlowMate
  is higher. All of these are rectangle gates whose edges extend past the axis: FlowMate follows
  FlowJo's rule for events at the edge and FlowKit does not. This has not been checked event by event.
- **One gate where FlowKit returns 0.** That accounts for the other 39 differences. FlowMate and FlowJo
  both count thousands of events there, so it is probably a FlowKit issue, but FlowMate is unchecked
  for that gate.
- **FlowJo's saved counts (open).** In 2 of the 3 workspaces, the counts saved in the FlowJo file
  differ from both FlowMate and FlowKit from the CD45 gate onward. FlowMate and FlowKit agree with
  each other there. The cause is not known. In the third workspace, FlowMate matches FlowJo to a
  median of 0.01 percentage points. The import report shows FlowJo's count next to FlowMate's for
  every population.

## Details and re-running

Full reports, protocols and scripts: [`FlowMate/tests/external_qa`](FlowMate/tests/external_qa)
([REPORT.md](FlowMate/tests/external_qa/REPORT.md), [REVALIDATION.md](FlowMate/tests/external_qa/REVALIDATION.md)).

```bash
python FlowMate/tests/external_qa/tools/run_part_a.py <scratch dir> <python with flowkit==1.3.2> spec1 spec4 spec5
python FlowMate/tests/external_qa/tools/reval.py spec1 spec4 spec5
```

The FCS files are downloaded from Zenodo (record numbers in REPORT.md) into
`FlowMate/tests/public_large/external_qa/`; they are not in the repository.

Found a wrong number? [Open an issue](https://github.com/rlshir302010-cpu/flowmate/issues) or email
rlshir302010@gmail.com.
