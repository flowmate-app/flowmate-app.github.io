# Public reference data

These files are from the [FlowKit](https://github.com/whitews/FlowKit) test suite (`data/`), which is BSD-3-Clause licensed (Copyright (c) Scott White). FlowMate uses them only to check its numbers against outside references.

| Folder | What it holds | What it checks |
|---|---|---|
| `gatingml/` | The ISAC GatingML 2.0 compliance suite: `data1.fcs`, the gate definitions (`gml/`) and the per-event expected membership (`truth/`) | the GatingML importer and the gating engine, event by event |
| `flowjo/` | FlowJo 10 workspaces (`.wsp`), the small FCS file they use, and a compensation matrix | the FlowJo importer, against the event counts FlowJo itself saved in each workspace |
| `flowjo_xforms/` | FlowJo's own biex lookup table | the biex transform |

The large FCS files are not versioned. They live in `../public_large/`, which is git-ignored:

| File | Size |
|---|---|
| `test_data_diamond_01.fcs` | 1.6 MB |
| the three 8-colour ICS files | 17 MB each |

Tests that need them are skipped when they are missing. To fetch them, download from `https://github.com/whitews/FlowKit/tree/master/data`:

| FlowKit path | Save to |
|---|---|
| `simple_diamond_example/test_data_diamond_01.fcs` | `public_large/flowjo/` |
| `8_color_data_set/fcs_files/*.fcs` | `public_large/8_color/` |
