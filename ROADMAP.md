# Development roadmap

Statuses reflect the implementation and Git history on 2026-10-08. `Completed` means the deliverables are present in `main`; planned tasks are not marked complete based only on research notes or intent.

| ID | Task | Status | Dependencies |
|---|---|---|---|
| 001 | Database foundation | Completed | None |
| 002 | Official source research and Kyocera collector | Completed | 001 |
| 003 | Brother España sitemap importer | Completed | 001 |
| 004 | OEM compatibility verification | Completed | 001–003 |
| 005 | Epson Europe collector | In progress — access/evidence limited | 004 |
| 006 | Xerox printer and OEM cartridge collection | Implemented on feature branch — awaiting merge | 004 |
| 007 | HP printer and OEM cartridge collection | Planned | 004 |
| 008 | Canon printer and OEM cartridge collection | Planned | 004 |
| 009 | Expand Brother compatibility coverage | Planned | 003–004 |
| 010 | Expand Kyocera model and compatibility coverage | Planned | 002–004 |
| 011 | Cross-manufacturer audit, deduplication, and coverage analysis | Planned | 005–010 |
| 012 | Incremental updates and collection history | Planned | 011 |
| Future | React/Tauri interface | Deferred | Mature data collection foundation |

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

**Delivered on `codex/xerox-europe-collector` (2026-10-09):** rate-limited, resumable ES/IE official-page adapter; strict genuine Xerox-for-Xerox filtering; visible/JSON-LD compatibility cross-checks; exact SKU, color, yield, region and evidence; JSON/CSV export; source HTML and SHA-256 manifest; synthetic and real-snapshot tests. Shared strict compatibility import now accepts CSV without dropping evidence. Existing robots enforcement is shared with Epson without changing Epson behavior.

**Verified snapshot:** 12 Spanish cartridge pages, 2 printer models (VersaLink C400/C405), 12 OEM cartridges, 24 verified relationships; zero request failures, exclusions, manual-review cases or pending discovered pages. Both output formats pass strict dry import; repeated imports are idempotent and preserve existing Kyocera evidence. This is a bounded seed-derived sample, not an exhaustive Xerox catalog. No production database changes or migrations. See [Xerox collection notes](docs/xerox.md). Implementation is ready for user review; `Completed` remains reserved for merged work.

**Deliverables:** official European source integration, genuine Xerox-for-Xerox filtering, exact models/SKUs/colors/yields where available, evidence-preserving JSON/CSV output, retry/resume controls, and fixture tests.

**Acceptance:** “Everyday” third-party-compatible and non-cartridge products are excluded; verified edges have explicit official evidence and region; imports are valid and idempotent; failures and coverage are reported.

## Task 007 — HP printer and OEM cartridge collection

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
