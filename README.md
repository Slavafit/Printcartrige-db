# Printcartridge DB

A small, manufacturer-independent SQLite database and CLI for printer-to-cartridge compatibility. Only ink and toner cartridges are accepted. Drums, waste containers, maintenance kits, and other consumables are intentionally outside the data model.

Official-source snapshots are stored under `data/official/`. Synthetic files under `tests/fixtures/` are non-production test data and must not be imported into a production database.

## Project documentation

- [Project specification](PROJECT.md)
- [Development roadmap](ROADMAP.md)
- [Data quality policy](DATA_POLICY.md)
- [Instructions for future Codex sessions](AGENTS.md)
- [Official data-source assessment](docs/data-sources.md)
- [Collector integration guide](docs/collectors.md)

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

Node.js 22 or newer is required.

## Browser MVP

The read-only browser interface searches the existing SQLite catalog and shows OEM cartridge details, verification status, region, and official evidence links. Search runs automatically while typing; results are shown 10 models per page with numbered navigation. Prepare a separate local MVP database from the committed Brother, Kyocera, and Xerox sources, then start the API and Vite client:

```powershell
pnpm.cmd mvp:seed
pnpm.cmd dev
```

Open `http://127.0.0.1:5173`. The seed command writes `mvp.sqlite` and is idempotent; it does not modify another database. To use an existing database in development:

```powershell
$env:WEB_DB_PATH = ".\printcartridge.sqlite"
pnpm.cmd dev
```

For a production-style local run, build and serve the static client from the Node server:

```powershell
pnpm.cmd build
pnpm.cmd web:start
```

Then open `http://127.0.0.1:4173`. This MVP has no write API, authentication, hosting, or remote database. Set the `PORT` environment variable before starting if that port is already occupied.

## Commands

The default database is `printcartridge.sqlite`; override it with `--db path/to/file.sqlite`.

```bash
pnpm db init
pnpm db import data.json --dry-run
pnpm db import data.csv
pnpm db export backup.json
pnpm db export backup.csv
pnpm db list printers
```

Imports are fully validated before a transaction starts. A failing row prevents all rows in that file from being written. JSON imports contain an array of objects. CSV headers use the same names as the JSON fields; see `tests/fixtures/` for the format.

Manual CRUD accepts a table name and a JSON object using database column names:

```bash
pnpm db create manufacturers '{"name":"Example Manufacturer"}'
pnpm db update manufacturers 1 '{"name":"Renamed Manufacturer"}'
pnpm db delete manufacturers 1
```

Valid tables are `manufacturers`, `printers`, `cartridges`, `data_sources`, `printer_sources`, and `compatibility`. Foreign-key and uniqueness constraints still apply. On PowerShell, store complex JSON in a variable if shell quoting is inconvenient.

## Import fields

Every row needs `printerManufacturer`, `printerModel`, and `hasReplaceableCartridges`. When that boolean is `false`, cartridge and compatibility fields are omitted. Otherwise these fields are required: `cartridgeManufacturer`, `cartridgePartNumber`, `cartridgeKind` (`ink` or `toner`), `sourceName`, `sourceUrl`, `verificationStatus` (`unverified`, `verified`, or `rejected`), `region`, and `isGenuineOem`. `cartridgeColor` is optional.

Printer models and cartridge part numbers are normalized for matching while their original display values are retained. Duplicate manufacturers, printers, cartridges, and identical compatibility evidence are prevented by database constraints.

## Schema

- `manufacturers`: one normalized identity for printer and cartridge makers.
- `printers`: unique by manufacturer and normalized model; supports `has_replaceable_cartridges = 0`.
- `cartridges`: unique by manufacturer and normalized part number; kind is constrained to `ink` or `toner`.
- `data_sources`: reusable source identity and canonical URL.
- `printer_sources`: printer provenance with exact source URL, region, and verification status.
- `compatibility`: many-to-many printer/cartridge evidence. Each row stores source URL, source reference, verification status, region, and OEM status.

SQLite enables foreign keys. Compatibility rows cascade when a printer or cartridge is deleted, while referenced manufacturers and sources are protected.

## Collector integration

See [docs/collectors.md](docs/collectors.md). Collectors produce the neutral import shape; they do not write SQLite directly. This keeps manufacturer-specific scraping and access constraints outside the trusted persistence layer.

Official-source research is in [docs/data-sources.md](docs/data-sources.md). The first working collector reads public Kyocera Europe toner pages discovered through the official sitemap:

```bash
pnpm collect:kyocera -- --max-models 200 --delay-ms 500 --retries 3
pnpm db import data/official/kyocera-eu.json --dry-run
```

Collection is rate-limited, retried, capped at 200 unique models, and resumable through an ignored local checkpoint. It exports JSON and CSV without automatically writing the production database.

## Brother España sitemap importer

The offline Brother importer creates provisional printer records from the official Brother España sitemap. The source was downloaded manually from `https://store.brother.es/sitemap.xml` and committed unchanged as `data/sitemap.xml`. The importer never requests Brother's website and does not create cartridge compatibility records.

On Windows PowerShell, validate the sitemap without changing or creating the default database:

```powershell
pnpm.cmd db import:brother-sitemap data/sitemap.xml --dry-run
```

Import into the default `printcartridge.sqlite` database:

```powershell
pnpm.cmd db import:brother-sitemap data/sitemap.xml
pnpm.cmd db list printers
```

Use another database without risking an existing one:

```powershell
pnpm.cmd db --db .\tmp\brother-verification.sqlite import:brother-sitemap data/sitemap.xml
```

The committed sitemap currently contains 1,999 URLs: 662 Brother device pages, 439 unique accepted laser/inkjet/fax printer models, and 1,560 rejected URLs. Rejections include 1,337 unrelated non-device pages, 221 unsupported device categories, and two ambiguous bundle slugs. The full JSON command output includes every rejected URL and reason, duplicate counts, existing models, insert counts, errors, and the final Brother model count.

Model names come only from URL slugs—for example, `hl2070n` becomes `Brother HL-2070N`—so their `printer_sources.verification_status` is `unverified`. URL categories are used only to select likely printer product pages; they are not stored as authoritative printer technology. Existing printer rows and verified provenance are preserved. Label/mobile printers, scanners, stamp creators, bundles, malformed entries, and non-Brother domains are reported rather than silently accepted.

The additive `printer_sources` schema migration associates a printer with an exact source URL, region, and verification status without fabricating a cartridge relationship. Run `pnpm.cmd db init` on an existing database to apply this idempotent migration independently.

## Verified OEM compatibility import

The compatibility importer accepts a JSON array or CSV and writes only genuine OEM ink or toner relationships. Verified records require an official manufacturer source, explicit compatibility evidence, and a verification date. Drums, waste containers, maintenance kits, fusers, transfer belts, ink bottles/refills, third-party products, and unknown product types are rejected before any printer, cartridge, or relationship is written. CSV uses the same fields with `true`/`false` OEM flags and integer yields; evidence and verification metadata are preserved.

Example record:

```json
[
  {
    "printerManufacturer": "Brother",
    "printerModel": "Brother HL-2070N",
    "cartridgeManufacturer": "Brother",
    "cartridgePartNumber": "TN-2000",
    "productType": "toner",
    "isGenuineOem": true,
    "sourceName": "Brother España official printer page",
    "sourceUrl": "https://store.brother.es/devices/laser/hl/hl2070n",
    "sourceType": "official-manufacturer",
    "evidenceType": "explicit-compatibility",
    "evidence": "Official manufacturer page explicitly identifies this genuine toner for this printer.",
    "verificationStatus": "verified",
    "region": "ES",
    "verifiedAt": "2026-10-08T00:00:00.000Z"
  }
]
```

Optional fields are `cartridgeColor` and positive integer `yieldPages`. Use `verificationStatus: "unverified"` for otherwise valid OEM candidates that are not yet explicitly confirmed. Claims requesting `verified` without sufficient official evidence are quarantined in the command report and are not written.

Windows PowerShell commands:

```powershell
# Validate without changing or creating the default database
pnpm.cmd db import:compatibility .\compatibility.json --dry-run

# Import into an explicit database
pnpm.cmd db --db .\printcartridge.sqlite import:compatibility .\compatibility.json

# Query one printer and display database-wide quality statistics
pnpm.cmd db --db .\printcartridge.sqlite compatibility --printer "Brother HL-2070N"
pnpm.cmd db --db .\printcartridge.sqlite compatibility:stats
```

Import output reports accepted and inserted relationships, input duplicates, rejections grouped by reason, and manual-review records. Statistics include total printers, printers with/without verified compatibility, unique verified OEM cartridges, verified relationships, and stored unverified relationships requiring review.

The Task 003 sitemap alone is not compatibility evidence. The small `tests/fixtures/brother-hl2070n-compatibility.json` example records the manually verified relationship supplied for this task: Brother HL-2070N with genuine TN-2000 toner. DR-2000 is a drum and is deliberately absent. Brother's protected website is not requested by the importer or tests.

The importer trusts structured declarations such as `sourceType` only after applying the strict field rules; it cannot cryptographically prove that arbitrary offline JSON was authored by a manufacturer. Keep evidence text precise and preserve downloaded/licensed source artifacts where permitted. Existing Task 002 Kyocera output is supported through a narrowly scoped legacy profile for its exact official source name and domain.

## Epson Europe acquisition (Task 005, in progress)

`pnpm.cmd collect:epson -- --max-pages 20` starts the conservative Epson adapter. It checks robots rules, respects the declared 04:00–08:45 UTC window and at least ten seconds between attempts, and saves a resumable queue plus JSON/CSV and a failure/manual-review report. See [Epson notes](docs/epson.md) for reproduction and evidence limitations.

The initial live run was deferred by the visit window (zero collected products). Range-level compatibility is quarantined; automatic exact-SKU relationship mapping is not yet implemented. Synthetic tests do not establish real catalog coverage. Task 005 is not marked complete.

Printer-only imports may optionally provide all four of `sourceName`, `sourceUrl`, `region`, and `verificationStatus`; these are preserved in `printer_sources` without creating cartridges.

## Xerox European collector (Task 006)

`pnpm.cmd collect:xerox -- --max-pages 50` collects official Spanish Xerox supply pages with rate limiting, robots checks, retries, resume and strict product/compatibility filtering. [Collection details and commands](docs/xerox.md).

The committed ES snapshot contains **2 printer models, 12 genuine toner cartridges and 24 verified relationships**, with no request failures. Both JSON and CSV pass `pnpm.cmd db --db :memory: import:compatibility <file> --dry-run`. Use the strict `import:compatibility` command to preserve evidence. Coverage is a seed-derived VersaLink C400/C405 sample, not an exhaustive catalog. Existing databases are not modified automatically.

## Current limitations

- No frontend, HTTP API, authentication, or authorization.
- Kyocera and Xerox collection are implemented; Epson acquisition is in progress with documented access/evidence limitations.
- Normalization intentionally removes punctuation; exceptional aliases may need a future alias table.
- Verification is recorded but not performed automatically.
- Import upserts existing normalized entities; it does not delete data missing from an import.
- Manual CRUD uses low-level database column names and relies on SQLite constraints for validation.
