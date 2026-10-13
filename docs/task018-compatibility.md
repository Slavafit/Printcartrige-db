# Task 018: compatibility expansion and measured coverage

Implemented and validated on `codex/task-018-mass-compatibility`, 2026-10-13. The experiment imports real HP, Canon and Epson relationships into a new SQLite using the shared Task 016 pipeline. No production SQLite was opened for writing. Task 017 has no merged consumable dataset to apply.

## Results and baseline

The baseline is the repository MVP seed (Brother sitemap + Kyocera/Xerox official snapshots), not the user's installed database. No SQLite was present at the repository root. Reports are in [reports/task018](reports/task018/summary.json). `before.json` and `after.json` contain manufacturer metrics, uncovered model lists and spelling variants; `delta.json` contains the differences.

| Metric | Before | After | Change |
|---|---:|---:|---:|
| Printers | 469 | 3,605 | +3,136 |
| Printers with supplies | 30 | 2,785 | +2,755 |
| Printers without supplies | 439 | 820 | +381 |
| Coverage | 6.40% | 77.25% | +70.85 percentage points |
| Unique supplies | 24 | 1,431 | +1,407 |
| Valid relationships | 55 | 12,705 | +12,650 |
| Official verified OEM relationships | 55 | 55 | 0 |
| Relationships with third-party evidence | 0 | 12,650 | +12,650 |
| Supplies of unknown origin | 0 | 858 | +858 |

| Manufacturer | Before: covered / total | After: covered / total | Coverage | Third-party relationships |
|---|---:|---:|---:|---:|
| HP | 0 / 0 | 1,944 / 2,064 | 94.19% | 9,006 |
| Canon | 0 / 0 | 602 / 769 | 78.28% | 2,416 |
| Epson | 0 / 0 | 209 / 303 | 68.98% | 1,228 |

**Incremental coverage over Task 016 is zero.** A separate in-memory run of the original importer from `e8f1be5`, with the same seed, source files and manufacturer filter, produces identical coverage, supply and relationship counts: see `task016-reference.json`. This task does not claim discovery of a new bulk dataset. The delivered improvements are reproducibility, coverage analytics, preservation of raw spelling assertions, bottle/color metadata, diagnostics, atomic import and protection against false official status. Existing Task 016 imports can be replayed to fill missing metadata without duplicate relationships; source references should be kept consistent to avoid counting a new reference as a new source assertion.

The final import rejected 0 rows. There are 10,609 review warnings across both complete source files, including manufacturers outside the selected import. These are warnings, not failed relationships or distinct rejected products. They identify unknown origin/type and each unmatched or ambiguous reverse identifier. Full diagnostics are reproducibly written to `import.json`; the committed `diagnostics.json` groups identical messages while retaining source file and row numbers. Dry-run predictions, repeat-import counts and diagnostics summaries are in `import-summary.json`. Reimport creates zero printers, supplies, relationships or evidence assertions. SQLite integrity is `ok`, foreign-key violations are zero, and all 55 official rows remain unchanged.

## Source assessment

| Source / owner | License and decision | Structure, identification and scale |
|---|---|---|
| [PrinterTonerDB / kurcz](https://github.com/kurcz/PrinterTonerDB/tree/ded2df49109534569dabe7b6a39df7713ac44bfc) | Accepted as a third-party dataset; Apache-2.0 publication license retained in `licenses/`. Original scraped site's identity is not supplied upstream. No claim of OEM verification. | Two tab-delimited files: `Brand, Series, Model, Description` and reverse `Model, Brand, Series, Description, printer identifiers...`. Exact supplied SKUs and explicit edges; reverse identifiers join only unambiguous known models. 3,136 selected printer identities and 12,650 unique selected edges; primary/reverse assertions overlap. |
| [OpenPrinting / Linux Foundation community](https://github.com/OpenPrinting/foomatic-db) | Rejected for this task's compatibility import; repository licensing is mixed, including GPL. Task 017 remains separate. | XML driver/printer support catalog. Printer/driver relationships are not consumable SKU evidence. No validated bulk cartridge-edge count; no importer added. |
| [pc-hardware-mcp / KaliStudent](https://github.com/KaliStudent/pc-hardware-mcp) | Rejected. [LICENSE](https://github.com/KaliStudent/pc-hardware-mcp/blob/main/LICENSE) includes both public-domain wording and a conflicting requirement for express written permission. No permission obtained and no data imported. | Per-printer JSON and consumables API are advertised. Size and compatibility quality were not audited after the license restriction was found. |
| [cartridge_chip_resetter / wcyb](https://github.com/wcyb/cartridge_chip_resetter) | Rejected: non-commercial restriction and resetter compatibility is not enough to establish direct printer-to-SKU edges. No protection mechanisms used or bypassed. | README lists 60 printer/MFP models and chip/resetter models; not a suitable direct mass-compatibility dataset. |

The two local source files match upstream byte-for-byte at the pinned commit. SHA-256 hashes and retrieval verification date are recorded in `summary.json`; the runner refuses changed source bytes. The original source files and license are retained without editing. Local derived candidate CSVs are not trusted as extra evidence.

## Gaps and alternatives

No suitable additional mass source was established in this research. PrinterTonerDB alone cannot close all gaps. The remaining uncovered models are listed in `after.json`: HP 120, Canon 167, Epson 94, plus 439 Brother models outside this experiment. In this snapshot MAXIFY is absent; i-SENSYS has only 3 covered models; EcoTank has 6, WorkForce 84/88, Expression 32/38 and PIXMA 159/169. HP has DeskJet 410/410, OfficeJet 298/302 and LaserJet 469/571 (including Color LaserJet 133/165). Family counts use literal names, overlap where appropriate, and are not global market coverage.

25 distinct supplies are classified as ink bottles; 266 supplies still have unknown kind. Regional information is absent in the source, so it remains `unknown` rather than being guessed from the EU project context. Similar family/model names and potentially equivalent regional aliases are not merged. The existing normalization removes case/spacing/punctuation, but retains suffix letters and digits. Known raw spelling variants are reported, without an automatic alias table or family-based inference.

Further growth requires a permissively licensed direct-compatibility dataset, permission from a catalog owner, or exact manufacturer evidence through existing collectors (the future Task 019). Official HP/Epson access limitations remain documented in their tasks. This task does not circumvent them or promote catalog assertions to verified OEM evidence.

## Reproduce safely

Run from the repository root in Windows PowerShell. The output directory must not exist; the command refuses to reuse it and always creates its own `experiment.sqlite`.

```powershell
pnpm.cmd task:018 --output-dir .collector-state/task018-reproduction
pnpm.cmd db --db .collector-state/task018-reproduction/experiment.sqlite coverage --baseline .collector-state/task018-reproduction/before.json --output .collector-state/task018-reproduction/coverage-with-delta.json
```

`coverage` opens an existing database read-only, never initializes/migrates it, and refuses to overwrite an output file. It needs the Task 016 schema. Coverage excludes rejected and conflicting edges; unknown type/origin alone does not invalidate an explicit catalog relationship. Overall supply counts include all catalog supplies; per-manufacturer supply counts count distinct valid linked supplies for that printer manufacturer. Third-party and verified evidence may overlap on one relationship, so those counts must not be summed. `coveragePercent` deltas are percentage points.

To import into a selected user SQLite **manually**, close the application, keep a backup, and specify its path explicitly. These commands are documentation, not actions performed by this task. The following example uses a disposable copy:

```powershell
Copy-Item -LiteralPath .\printcartridge.sqlite -Destination .\task018-copy.sqlite
pnpm.cmd db --db task018-copy.sqlite coverage --output task018-before.json
pnpm.cmd db --db task018-copy.sqlite import:printertonerdb data/Printers2Toners.txt data/Toner2Printers.txt --manufacturers HP,Canon,Epson --dry-run
pnpm.cmd db --db task018-copy.sqlite import:printertonerdb data/Printers2Toners.txt data/Toner2Printers.txt --manufacturers HP,Canon,Epson
pnpm.cmd db --db task018-copy.sqlite coverage --baseline task018-before.json --output task018-after.json
```

Without `--manufacturers`, the existing command imports all manufacturers in the dataset. `--region` explicitly overrides source regions; omit it for this dataset. Generic imports now retain each row's region unless overridden. CLI import commands print JSON reports; the reproduction command writes JSON directly without PowerShell output-encoding ambiguity.

## Schema and safety

An additive nullable `cartridges.supply_form` column stores `ink_bottle`; its legacy `kind` is `other`. `compatibility` CLI output additionally exposes `supply_type = COALESCE(supply_form,kind)`. No table rebuild, old-row deletion or change to the strict official `ink`/`toner` validator is needed. Task 005's exclusion from **verified cartridge collection** remains intact; a bottle is now separately representable in the broader third-party supply catalog.

For an existing Task 016 database, initialization first creates `<db>.pre-supply-form.sqlite` with SQLite `VACUUM INTO`. An existing backup causes a safe failure instead of overwrite; archive it before retrying. A legacy pre-016 DB continues to use its existing migration backup. Dry-run never migrates or backs up an existing DB. Reopening no longer reruns the historical compatibility migration and overwrites current reliability decisions. Import transaction rollback includes source creation, even if a later chunk fails. Existing official relationships and their primary sources are preserved; missing non-official descriptive metadata may be filled, user notes and origin are retained.

Fixture tests cover HP/Canon/Epson normalization, regional suffixes, ambiguous parts, competing manufacturers, bottle/color classification, preserved official evidence, multiple sources, idempotency, rollback, rejected/conflicting coverage, additive migration backups, and byte-identical read-only dry-runs. Full typecheck, build and 114 tests pass.
