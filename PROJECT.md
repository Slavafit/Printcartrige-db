# Project specification

## Purpose and priority

Printcartridge DB is a manufacturer-independent database of printer models and genuine OEM ink and toner cartridges, with compatibility relationships backed by official evidence. The current priority is **data collection first**: improve trustworthy catalog coverage before building user-facing applications.

Do not add a UI, authentication, hosting, deployment, or unrelated product features unless a task explicitly requests them. React/Vite and Tauri are possible future application technologies, not current implementation priorities.

## Scope

The initial manufacturer scope is:

- Brother
- Canon
- Epson
- HP
- Kyocera
- Xerox

The data model and collector boundary must continue to allow additional manufacturers without creating manufacturer-specific databases or write paths.

Geographic scope is Europe, with Spain prioritized. Historical and discontinued printers belong in the catalog when official evidence is available; their lifecycle must not be guessed from absence on a current storefront.

## Printer catalog

- Store a printer even when no cartridge relationship is known.
- Support printers without replaceable cartridges, including cartridge-free systems such as Epson EcoTank.
- Preserve manufacturer, original model name, normalized identity, official source URL, region, and verification status when known.
- Prevent duplicates by manufacturer and normalized model identity while retaining the original display value.
- A sitemap or URL-derived model may be retained as unverified provenance, but it is not cartridge compatibility evidence.

## Cartridge catalog

- The verified OEM cartridge view contains only genuine manufacturer-branded ink and toner cartridges.
- The broader supply catalog may retain explicitly typed drums, waste containers, belts, compatible/remanufactured products, other products, and unknown candidates from identified sources, but never present them as verified OEM cartridges.
- Exclude unrelated products from cartridge results and retain uncertain classification as `unknown` for review.
- Preserve original OEM part number, normalized identity, kind, color, yield, and official source when available.
- If product type or OEM status cannot be established reliably, reject or hold the candidate for manual review.

## Compatibility

Printer-to-cartridge compatibility is many-to-many. A printer may accept multiple genuine cartridges and a cartridge may support multiple printers.

A relationship may be `verified` only when an official manufacturer source explicitly identifies both the printer and the compatible OEM cartridge. Each relationship retains its exact evidence, source URL, source classification, verification status, verification date, and region. Model similarity, family naming, search snippets, and sitemap presence are not evidence. Compatibility must never be fabricated.

Detailed operational rules are in [DATA_POLICY.md](DATA_POLICY.md).

## Implemented architecture

The repository currently uses:

- Node.js 22+ and TypeScript, managed with pnpm;
- SQLite through `better-sqlite3`;
- a command-line interface in `src/cli.ts`;
- normalized tables for manufacturers, printers, cartridges, sources, printer provenance, and compatibility;
- JSON and CSV import/export, validation, normalization, dry runs, manual CRUD, queries, and quality statistics;
- Vitest unit and integration tests with synthetic fixtures clearly separated from production data;
- an offline Brother España sitemap importer using the committed `data/sitemap.xml`;
- a resumable, rate-limited Kyocera Europe collector that emits neutral JSON and CSV records;
- a shared strict JSON compatibility importer for official OEM evidence.
- an offline OpenPrinting Foomatic XML adapter for broad printer-model and capability coverage;
- a local editable browser/desktop MVP using React/Vite and a Node HTTP API bound to `127.0.0.1`;
- a portable Windows launcher with an embedded Node runtime and system tray controls.
- an experimental self-contained .NET tray launcher that uses the system browser and preserves the Electron option.

Collectors are adapters and must emit the shared import representation rather than write directly to SQLite. See [docs/collectors.md](docs/collectors.md) and [docs/data-sources.md](docs/data-sources.md).

There is no authentication layer, hosted service, Docker setup, or PostgreSQL deployment. The write API is local-only and intended for one Windows user.
