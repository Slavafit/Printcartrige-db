# Development roadmap

Statuses reflect the implementation and Git history on 2026-10-08. `Completed` means the deliverables are present in `main`; planned tasks are not marked complete based only on research notes or intent.

| ID | Task | Status | Dependencies |
|---|---|---|---|
| 001 | Database foundation | Completed | None |
| 002 | Official source research and Kyocera collector | Completed | 001 |
| 003 | Brother España sitemap importer | Completed | 001 |
| 004 | OEM compatibility verification | Completed | 001–003 |
| 005 | Epson Europe collector | In progress — access/evidence limited | 004 |
| 006 | Xerox printer and OEM cartridge collection | Completed | 004 |
| 007 | HP printer and OEM cartridge collection | In progress — collector merged, dataset empty | 004 |
| 008 | Canon printer and OEM cartridge collection | Planned | 004 |
| 009 | Expand Brother compatibility coverage | Planned | 003–004 |
| 010 | Expand Kyocera model and compatibility coverage | Planned | 002–004 |
| 011 | Cross-manufacturer audit, deduplication, and coverage analysis | Planned | 005–010 |
| 012 | Incremental updates and collection history | Planned | 011 |
| 013 | Read-only browser MVP | Completed on feature branch | 001–007 |
| 014 | PrinterDB Desktop MVP | Completed on `feature/desktop-mvp` | 013 |
| 015 | Lightweight Windows launcher experiment | Completed on `experiment/lightweight-launcher` | 014 |
| 016 | Multi-source import and PrinterTonerDB integration | Completed on `feature/multi-source-import` | 001, 004, 014 |
| 017 | OpenPrinting research, завершено исследование; пригодных данных совместимости не найдено.
| 018 | Mass Consumables Compatibility Expansion | Implemented and validated on `codex/task-018-mass-compatibility`; additional-source growth limited | 016; 017 research |
| 021 | Database restore UI and modal keyboard handling | Implemented and validated on `codex/database-restore-ui` | 014, 016 |
| 022 | Lexmark España official compatibility collector and data UI | Implemented and validated on `feature/lexmark-official-compatibility` | 004, 012, 013 |
| 023 | Russian project component guide | Implemented on `feature/project-guide` | — |
| 024 | Unified supply catalog and Brother import preparation | Implemented and validated on `feature/unified-supply-catalog` | 018, 022; completed Brother collection |
| Future | React/Tauri interface | Deferred | Mature data collection foundation |

## Task 024 — Unified supply catalog and Brother import preparation

**Implemented on `feature/unified-supply-catalog`:** shared supply-type mapping across import, desktop editing, export, search details, UI labels, and statistics; separate counters for OEM cartridges, compatible cartridges, and ink bottles; and deterministic conversion of the completed Brother audit into the existing multi-source format without touching the active SQLite database.

**Brother result:** 1,606 of 1,611 audited relationships were accepted from exact official cross-references, covering 292 printers and 253 supplies. The accepted set contains 1,598 cartridge relationships and 8 ink-bottle relationships. Four candidates and one uncheckable relationship remain outside the import; six supply-page acquisitions had previously failed. The generated file passes a strict in-memory dry run with zero rejected rows or warnings. See [the report and safe commands](docs/brother-supplies.md).

**Acceptance:** non-cartridge supplies no longer inflate cartridge counters; manual editing preserves `supply_form`; per-edge evidence URLs and dates survive conversion/import; fixture tests prove exclusion, dry-run safety, and idempotency; no production database is modified.

## Task 018 — Results on feature branch (2026-10-13)

Reproducible HP/Canon/Epson import into a separate SQLite: 30 → 2,785 printers with supplies; +12,650 third-party relationships; all 55 official relationships preserved. Coverage is unchanged relative to Task 016 importing the same pinned dataset; no additional acceptable bulk source was established. Delivered read-only coverage/delta CLI, bottle/color metadata with additive backup migration, source review diagnostics, atomic imports, and fixture tests. Zero rejected input rows, 10,609 warnings across the complete source files, zero new entities/edges/assertions on repeat. Typecheck, build and 114 tests pass. [Report and limitations](docs/task018-compatibility.md). Awaiting user merge; Tasks 019/020 were not started.

## Task 001 — Database foundation

**Delivered:** normalized SQLite schema; manufacturers, printers, cartridges, sources, and many-to-many compatibility; JSON/CSV import and export; normalization and deduplication; dry runs; manual CRUD; Vitest fixtures and tests.

**Acceptance:** only ink/toner kinds are accepted, cartridge-free printers are representable, imports validate before writes, repeated records do not duplicate entities, and tests pass. Present in history as `246b985`.

## Task 002 — Official source research and Kyocera collector

**Delivered:** official-source assessment for six manufacturers; collector adapter guidance; resumable and rate-limited Kyocera Europe collection; JSON/CSV output; saved official-source snapshot and fixture-based tests.

**Acceptance:** collector uses accessible official pages, excludes non-printer related products, retains source and region, supports retries/resume, produces records accepted by the shared importer, and does not bypass restrictions. Present in history as `3cad7ae` and merged to `main`.

## Task 003 — Brother España sitemap importer

**Delivered:** offline parsing of the committed official sitemap, device URL validation, model normalization, rejection and duplicate reports, `printer_sources` provenance, dry-run/import/list CLI support, idempotency tests, and real-file integration verification.

**Acceptance:** Brother models import without duplicates or fabricated cartridge relationships; existing verified records survive; dry-run does not write; actual sitemap is processed offline. Present in history as `d9adfb4` and merged to `main`.

## Task 004 — OEM compatibility verification

**Delivered:** shared strict JSON compatibility import; official-evidence fields and verification date; OEM/product-type filtering; quarantine/manual-review reporting; compatibility query and statistics commands; Kyocera compatibility integration; Brother HL-2070N/TN-2000 fixture; tests for exclusions and idempotency.

**Acceptance:** only valid OEM ink/toner relationships are written, verified claims require explicit official evidence, many-to-many relationships work, excluded consumables never become cartridges, and Kyocera data remains importable. Present in history as `e1006fa` and merged to `main`.

## Task 005 — Epson Europe collector

**Status:** In progress on `codex/epson-europe-collector`, not completed or merged. A conservative acquisition adapter, JSON/CSV export, resumable queue, robots enforcement, exclusion/manual-review reports and synthetic tests are implemented. The 2026-10-09 live attempt produced zero printer/cartridge records: Epson's declared 04:00–08:45 UTC visit window was closed. The accessible rendered example also qualifies compatibility as applying to one or more items in a range; no exact-SKU relationships are promoted automatically. See [Epson acquisition notes](docs/epson.md).

**Remaining:** retrieve and validate raw product HTML during permitted hours (or from a permitted supplied artifact), establish exact-SKU evidence from an official source, implement its verified-edge mapping with representative fixtures, then collect and dry-import a real dataset. Current semantic parser tests are synthetic reconstructions, not proof of production HTML coverage. No completed coverage claim is made.

**Deliverables:** identify an accessible official Epson Europe source; implement a rate-limited, resumable adapter using the common import shape; collect exact printer, OEM cartridge, region, and evidence data; strictly exclude EcoTank ink bottles and maintenance products; export JSON/CSV; add offline fixtures and tests.

**Acceptance:** every verified edge is explicit in an official source, blocked or ambiguous items are reported, EcoTank printers can exist without cartridge relationships, dry import succeeds, repeat runs are idempotent, and typecheck/build/tests pass.

## Task 006 — Xerox printer and OEM cartridge collection

**Delivered and merged from `codex/xerox-europe-collector` (2026-10-09):** rate-limited, resumable ES/IE official-page adapter; strict genuine Xerox-for-Xerox filtering; visible/JSON-LD compatibility cross-checks; exact SKU, color, yield, region and evidence; JSON/CSV export; source HTML and SHA-256 manifest; synthetic and real-snapshot tests. Shared strict compatibility import now accepts CSV without dropping evidence. Existing robots enforcement is shared with Epson without changing Epson behavior.

**Verified snapshot:** 12 Spanish cartridge pages, 2 printer models (VersaLink C400/C405), 12 OEM cartridges, 24 verified relationships; zero request failures, exclusions, manual-review cases or pending discovered pages. Both output formats pass strict dry import; repeated imports are idempotent and preserve existing Kyocera evidence. This is a bounded seed-derived sample, not an exhaustive Xerox catalog. No production database changes or migrations. See [Xerox collection notes](docs/xerox.md).

**Evidence snapshot repair (2026-10-14):** restored the Xerox report and structured outputs to the original hash-verifiable 2026-10-09 snapshot after a later unrelated commit referenced two raw HTML hashes whose files were not committed. The 12 cartridges and 24 verified relationships are unchanged, every manifest page again has its retained source artifact, and no SQLite database is modified.

**Deliverables:** official European source integration, genuine Xerox-for-Xerox filtering, exact models/SKUs/colors/yields where available, evidence-preserving JSON/CSV output, retry/resume controls, and fixture tests.

**Acceptance:** “Everyday” third-party-compatible and non-cartridge products are excluded; verified edges have explicit official evidence and region; imports are valid and idempotent; failures and coverage are reported.

## Task 007 — HP printer and OEM cartridge collection

**Status:** In progress. The HP collector and synthetic parser tests are merged in `main`, but the committed official output contains zero records, so collection coverage is not complete.

**Deliverables:** evaluate and implement the best official European HP source path; distinguish cartridge families from exact orderable part numbers; emit printer-level evidence and regional metadata; add fixtures and collection reports.

**Acceptance:** no family-to-model inference is promoted to verified, exact retained evidence supports each edge, excluded products do not enter the catalog, and repeat collection/import is safe.

## Task 008 — Canon printer and OEM cartridge collection

**Deliverables:** official Canon Europe catalog/document adapter; canonical printer and cartridge identifiers; region/variant handling; strict product filtering; JSON/CSV output and offline parser tests.

**Acceptance:** storefront variants are not conflated, official evidence supports verified compatibility, imports validate and deduplicate, and limitations are documented.

## Task 009 — Expand Brother compatibility coverage

**Deliverables:** obtain permitted official compatibility evidence for the existing Brother catalog; add a reproducible collector or structured offline acquisition workflow; retain per-edge region, URL, evidence, and date; report printers still lacking verification.

**Acceptance:** sitemap presence alone is never evidence, protected pages are not bypassed, drums and other supplies are excluded, imports preserve the 439-model catalog and existing verified data, and coverage counts are reproducible.

## Task 010 — Expand Kyocera model and compatibility coverage

**Deliverables:** broaden official Kyocera discovery beyond currently rendered related-product cards where permitted; cover historical models and regional variants; retain collection failures/history; extend fixtures for changed official formats.

**Acceptance:** no model-family inference, all verified edges have explicit evidence, existing 31 relationships remain stable unless evidence-backed corrections are recorded, and before/after coverage is reported.

## Task 011 — Cross-manufacturer data audit, deduplication, and coverage analysis

**Deliverables:** audit normalization collisions, aliases, regional variants, evidence completeness, rejected categories, and orphaned entities; produce per-manufacturer coverage metrics and a review queue; implement safe correction tooling where needed.

**Acceptance:** the audit is reproducible and read-only by default, proposed merges preserve original values/evidence, corrections are tested and transactional, and unresolved ambiguities remain visible.

## Task 012 — Incremental data updates and collection history

**Deliverables:** additive collection-run history, source retrieval timestamps/checksums, changed/removed claim detection, resumable incremental updates, and reporting without destructive synchronization.

**Acceptance:** unchanged runs are idempotent, verified records are never silently downgraded or deleted, source changes are auditable, failures can resume, and migrations preserve existing databases.

## Future — React/Tauri interface

Consider a React/Vite and Tauri application only after manufacturer coverage, evidence quality, audit tooling, and incremental updates are sufficiently mature. UI work must consume the existing data model rather than replace the collection and verification foundation.

**Acceptance:** a separately approved task defines user workflows, the application reads the established schema through a stable boundary, collection and verification remain independently testable, and no data-quality rule is weakened for presentation convenience.

## Task 013 — Read-only browser MVP

**Delivered on `feature/web-mvp`:** responsive React/Vite catalog interface with a viewport-fitting application shell; printer/model search with numbered 10-item pagination; manufacturer filtering; database statistics, including separate OEM and compatible cartridge counts; printer details with genuine cartridge type, color, yield, region, verification state, date, and official evidence link; explicit catalog-only state for printers without compatibility; idempotent seed command for a separate local database; production static serving; local collector control panel with a fixed command whitelist, live status/logs, and explicit validated import; read-model and command-whitelist tests.

**Acceptance:** the MVP reads the existing SQLite schema without a parallel data model, never infers missing compatibility, distinguishes verified and catalog-only results, works on desktop and mobile browsers, restricts collection/import mutations to localhost and the existing named adapters, preserves all source access and validation policies, builds successfully, and passes all automated tests.

## Task 014 — PrinterDB Desktop MVP

**Delivered on `feature/desktop-mvp`:** Windows portable EXE; tray open/exit commands; compact Spanish-language browser interface backed by a `127.0.0.1` server; search by printer, manufacturer and cartridge part number; ten-query local history; manual printer/cartridge/compatibility CRUD with notes and duplicate guards; CSV/XLSX preview and import; XLSX export; SQLite backup; persistent per-user database copied from the existing 469-printer seed on first launch.

**Interface refinement on `feature/catalog-ui-optimization`:** replaced the oversized promotional hero with a compact catalog header, moved search and actions above the fold, strengthened model-name contrast, added a clearer blue information hierarchy, and added a Spanish `?` usage guide with responsive behavior.

**Catalog motion refinement on `feature/catalog-motion-and-data`:** limited the animated gradient to the header divider and added a slow, non-interactive footer strip populated from the manufacturers currently present in the catalog.

**Acceptance:** the packaged application requires no installed Node.js, does not start collectors, never promotes manual or third-party records to verified, keeps its database outside the EXE, preserves data across restarts, and passes typecheck, build and automated tests. The user request called this “Task 006”, but ID 006 was already assigned to the completed Xerox collector, so this roadmap records it as 014 without rewriting history.

## Task 015 — Lightweight Windows launcher experiment

**Delivered on `experiment/lightweight-launcher`:** self-contained .NET 8 WinForms tray launcher; embedded Node 22 runtime; bundled existing backend/frontend; Node-compatible native SQLite module; single-instance enforcement; browser opening; graceful authenticated local shutdown; repeatable PowerShell packaging; measured Electron comparison.

**Acceptance:** Electron remains available, the alternative requires neither installed Node.js nor .NET, binds only to localhost, preserves the per-user database, supports existing catalog workflows, and has a measured size. See [experiment details](docs/lightweight-launcher.md).

## Task 016 — Multi-source import and PrinterTonerDB integration

**Delivered on `feature/multi-source-import`:** additive multi-source schema; independent source category, reliability and supply-origin fields; CSV/TSV/XLS/XLSX/JSON parser; preview/dry-run and 500-row transactional imports; per-relationship source history; conservative PrinterTonerDB adapter; one-time pre-migration backup; browser import preview; tests and attribution.

**Acceptance:** third-party claims are never promoted to official verification, uncertain types/origins remain unknown, one relationship retains multiple sources, blank-supply rows preserve printers, repeated imports are idempotent, existing official evidence is preserved, and no third-party dataset enters the production database automatically.

## Task 021 — Database restore UI and modal keyboard handling

**Implemented and validated on `codex/database-restore-ui`:** local UI for selecting and restoring a PrinterDB SQLite backup; SQLite header, integrity, foreign-key and required-table validation before replacement; automatic pre-restore safety backup; live API/database reconnection; restore rejection while a collector is running; 256 MB upload limit; accessible add-record dialog that closes without saving on `Escape`; synthetic fixture and automated failure/success coverage.

**Acceptance:** invalid or unrelated files leave the active database unchanged, a successful restore reloads the catalog without restarting the desktop application, the replaced database remains recoverable from the reported safety path, add-printer/add-cartridge forms close on `Escape`, and typecheck, build and all tests pass. Tasks 019 and 020 remain reserved for the official-verification and coverage-audit work defined by Task 018.

## Task 022 — Lexmark España official compatibility collector and data UI

**Implemented and validated on `feature/lexmark-official-compatibility`:** conservative, resumable collection from the public Lexmark España sitemap and printer pages; exact Return Program and standard-cartridge table parsing; official evidence, raw snapshots, hashes, exclusions, and review reporting; strict shared import output; fixture-based parser, boundary, import, and resume tests; and a dedicated official-source section inside the existing data/import dialog.

**Verified pilot:** the sitemap exposed 631 printer product pages. A deliberately bounded live run visited the sitemap and two printer pages, producing 2 printers, 40 OEM cartridges, and 56 explicit verified relationships with zero failures or review items; the generated JSON passed strict dry import. No records were written to the active SQLite database.

**Acceptance:** only explicit official printer-page cartridge rows become verified edges; non-cartridge supplies and ambiguous rows remain excluded or reviewable; access challenges fail closed; collection and import are separate user actions; the UI never imports automatically; repeat collection/import is safe; and typecheck, build, and all tests pass. See [Lexmark collection notes](docs/lexmark.md) and [Task 022](tasks/022-lexmark-official-compatibility.md).

**Progress UI refinement:** online collector cards now expose checkpoint-based batch progress, accumulated entity counts, failures, pending work and estimated remaining time. The live log opens automatically, and the user can stop the one active whitelisted process without deleting its resumable checkpoint.

**First verified Lexmark data batch:** `feature/lexmark-official-batch-01` retains 50 hash-verified official pages, 46 printer models, 150 OEM SKUs, and 575 explicit relationships. The strict dry run accepted every relationship; 3 pages remain in review, 352 non-cartridge supply rows are explicitly excluded, request failures are zero, and 582 discovered pages remain pending. The batch is not imported automatically.

## Task 023 — Russian project component guide

**Implemented on `feature/project-guide`:** a Russian-language architectural guide covering the database, import layers, official collectors, local API, React UI, Windows launchers, data directories, tests, common commands, change locations, and the project invariants that protect evidence quality. The guide is linked from the README and intentionally does not add generated Lexmark collection output to Git.
