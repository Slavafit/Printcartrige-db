# Printcartridge DB

A small, manufacturer-independent SQLite database and CLI for printer-to-cartridge compatibility. Only ink and toner cartridges are accepted. Drums, waste containers, maintenance kits, and other consumables are intentionally outside the data model.

The repository ships with no production compatibility data. Files under `tests/fixtures/` are synthetic, non-production test data and must not be imported into a production database.

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

Node.js 22 or newer is required.

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

Valid tables are `manufacturers`, `printers`, `cartridges`, `data_sources`, and `compatibility`. Foreign-key and uniqueness constraints still apply. On PowerShell, store complex JSON in a variable if shell quoting is inconvenient.

## Import fields

Every row needs `printerManufacturer`, `printerModel`, and `hasReplaceableCartridges`. When that boolean is `false`, cartridge and compatibility fields are omitted. Otherwise these fields are required: `cartridgeManufacturer`, `cartridgePartNumber`, `cartridgeKind` (`ink` or `toner`), `sourceName`, `sourceUrl`, `verificationStatus` (`unverified`, `verified`, or `rejected`), `region`, and `isGenuineOem`. `cartridgeColor` is optional.

Printer models and cartridge part numbers are normalized for matching while their original display values are retained. Duplicate manufacturers, printers, cartridges, and identical compatibility evidence are prevented by database constraints.

## Schema

- `manufacturers`: one normalized identity for printer and cartridge makers.
- `printers`: unique by manufacturer and normalized model; supports `has_replaceable_cartridges = 0`.
- `cartridges`: unique by manufacturer and normalized part number; kind is constrained to `ink` or `toner`.
- `data_sources`: reusable source identity and canonical URL.
- `compatibility`: many-to-many printer/cartridge evidence. Each row stores source URL, source reference, verification status, region, and OEM status.

SQLite enables foreign keys. Compatibility rows cascade when a printer or cartridge is deleted, while referenced manufacturers and sources are protected.

## Collector integration

See [docs/collectors.md](docs/collectors.md). Collectors produce the neutral import shape; they do not write SQLite directly. This keeps manufacturer-specific scraping and access constraints outside the trusted persistence layer.

## Current limitations

- No frontend, HTTP API, authentication, or authorization.
- No manufacturer-specific collectors are included.
- Normalization intentionally removes punctuation; exceptional aliases may need a future alias table.
- Verification is recorded but not performed automatically.
- Import upserts existing normalized entities; it does not delete data missing from an import.
- Manual CRUD uses low-level database column names and relies on SQLite constraints for validation.
