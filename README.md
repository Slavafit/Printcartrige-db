# Printcartridge DB

A small, manufacturer-independent SQLite database and CLI for printer-to-consumable compatibility. The broad catalog can distinguish ink and toner cartridges, ink bottles, drums, waste containers, belts, other supplies, and unknown types. The strict verified-OEM cartridge view remains limited to genuine ink and toner cartridges.

Official-source snapshots are stored under `data/official/`. Synthetic files under `tests/fixtures/` are non-production test data and must not be imported into a production database.

## Project documentation

- [Project specification](PROJECT.md)
- [Development roadmap](ROADMAP.md)
- [Data quality policy](DATA_POLICY.md)
- [Instructions for future Codex sessions](AGENTS.md)
- [Official data-source assessment](docs/data-sources.md)
- [Collector integration guide](docs/collectors.md)
- [Путеводитель по компонентам проекта](docs/project-guide-ru.md)
- [Multi-source import and PrinterTonerDB adapter](docs/multi-source-import.md)
- [Brother unified supply preparation](docs/brother-supplies.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

Node.js 22 or newer is required.

## Browser MVP

The browser interface searches and edits the existing SQLite catalog. Search runs automatically after text is entered and results are shown 10 models per page. Prepare a separate local MVP database from the committed Brother, Kyocera, and Xerox sources, then start the API and Vite client:

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

Then open `http://127.0.0.1:4173`. There is no authentication, hosting, or remote database; the API binds only to localhost. Set the `PORT` environment variable before starting if that port is already occupied.

## Windows Desktop MVP

Build the portable application from PowerShell:

```powershell
pnpm.cmd install
pnpm.cmd desktop:package
```

Start `release\PrinterDB-0.1.0.exe` by double-clicking it. The application opens the default browser and remains active in the Windows system tray after the browser tab is closed. Use **Abrir catálogo** to reopen it and **Salir** to stop the local server. If port 4173 is occupied, the launcher automatically selects the next available port. Collectors are never run automatically.

The first launch copies the committed 469-printer seed into `%APPDATA%\PrinterDB\printcartridge.sqlite`. Later launches retain and migrate that user copy; rebuilding or replacing the EXE does not overwrite it. Backups created in the interface are stored in `%APPDATA%\PrinterDB\backups`. The portable EXE includes its own Node runtime, so the target Windows 11 computer does not need Node.js or pnpm.

The compact Spanish-language interface matches printer models, manufacturers, and cartridge part numbers. Its header reports printer, verified OEM cartridge, compatible cartridge, and verified relationship counts. The shell uses the available viewport height without forcing an unnecessary vertical scrollbar, while still growing naturally when search results or dialogs need more space. Its `?` button opens an in-app usage guide; the search, primary actions and first results remain visible without a large promotional banner. An animated gradient is limited to the header divider, while a passive strip above the footer slowly lists the manufacturers actually present in the database. It supports printer/cartridge/relationship CRUD, notes, deletion confirmation, the latest ten searches, CSV/XLSX preview/import, XLSX export, SQLite backup and validated SQLite restore. Manual and third-party records are always stored as `unverified`. The import dialog includes a clearly marked synthetic CSV example with both cartridge and cartridge-free printer rows. The add-record dialog closes without saving when `Escape` is pressed.

To restore a backup, select **Restaurar copia**, choose a `.sqlite`, `.sqlite3` or `.db` file and confirm the warning. PrinterDB validates the SQLite header, integrity, foreign keys and required catalog tables before replacing the active database. It first writes the current database to the configured backup directory as `pre-restore-<timestamp>.sqlite`; the success message shows that recovery path. Restore is refused while a collector is running, invalid files leave the active database unchanged, and uploaded copies are limited to 256 MB.

### Lightweight launcher experiment

Task 015 adds a non-Electron, self-contained .NET tray launcher while preserving the Electron build. It is distributed as a folder and opens the same interface in the system browser:

```powershell
pnpm.cmd lightweight:package
.\release-lightweight\PrinterDB\PrinterDB.exe
```

The measured folder is 242.5 MiB versus 493.3 MiB for the Electron portable EXE. A .NET 8 SDK is needed only to build it; the published application includes its runtime. See [build instructions, measurements, and limitations](docs/lightweight-launcher.md).

### Running collectors from the browser

The **Fuentes oficiales** section inside **Importar** is available only through the locally bound server. It exposes a fixed whitelist of the existing Brother, Kyocera, Epson, Xerox, HP, and Lexmark workflows; it cannot execute arbitrary commands. Manual file import remains in a separate section of the same dialog.

While an online collector is running, its card refreshes every two seconds and shows completed pages for the current batch, accumulated printer/cartridge/relationship counts, checkpoint errors, pending pages, and an estimated time remaining. The live log opens automatically. **Detener** terminates only the active whitelisted child process and preserves its resumable checkpoint; it never imports partial output automatically.

1. Select **Collect** to start an online manufacturer adapter. For Brother, **Recopilar y procesar** opens installed Edge or Chrome with a temporary isolated profile, downloads at most 20 missing pages from the fixed official candidate list, and then processes the complete saved HTML cache.
2. Keep the local server running and inspect the displayed status and collector log. Only one collector runs at a time.
3. After a successful run and review, select **Import to MVP** to validate and import that collector's saved JSON into `mvp.sqlite`.

Brother acquisition accepts only HTTPS supply URLs on `store.brother.es`, waits at least five seconds between requests, keeps a resumable history, and stops on HTTP 403/429 or access challenges. Pages without an explicit related-products section remain in review. Processing reuses the parsers in `scripts/`, preserves saved verification states, validates the rebuilt audit, and publishes `data/official/brother/brother-supplies.json` only after the full run succeeds. In the packaged Electron application, runtime files live in `%APPDATA%\printcartridge-db\collector-workspace`; existing HTML and results are never replaced during extraction. Edge or Chrome must be installed. Import into SQLite remains a separate explicit action.
4. Search and statistics update from the imported database. Repeated imports remain idempotent.

Collectors retain their existing rate limits, retries, resumable state, robots/access rules, exclusions, and manual-review behavior. A successful process does not imply complete manufacturer coverage. Epson may defer work outside its permitted access window, and inaccessible or ambiguous evidence is never promoted to verified compatibility.

Lexmark España runs in resumable 50-page batches from the official sitemap. Build the server before a CLI run, then use `node dist/src/collectors/lexmark.js --output-dir data/official/lexmark --state .collector-state/lexmark.json --max-pages 50 --delay-ms 10000 --retries 2`. Review and dry-run `data/official/lexmark/lexmark.json` before choosing **Importar resultado**. See [the Lexmark source report](docs/lexmark.md).

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

Universal multi-source import accepts CSV, TSV, XLS/XLSX and JSON and always supports a dry run. See [the complete format and PrinterTonerDB commands](docs/multi-source-import.md).

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

## Task 018: reproducible compatibility expansion

Run `pnpm.cmd task:018 --output-dir .collector-state/task018-reproduction` to build a **new test SQLite**, measure the repository seed, dry-run/import HP/Canon/Epson from the pinned PrinterTonerDB files, check reimport and save JSON reports. The directory must not exist. No production database is imported automatically.

`pnpm.cmd db --db <existing.sqlite> coverage --output before.json` writes a read-only coverage report. Add `--baseline before.json --output after.json` after an explicitly requested import to measure deltas. Output files must be new. The existing `import:printertonerdb` command supports `--manufacturers HP,Canon,Epson` and `--dry-run`; omitting the manufacturer filter retains the all-manufacturer behavior.

Measured seed coverage rises from 30 to 2,785 printers with supplies (+12,650 third-party relationships); 55 official edges stay unchanged. **Coverage is identical to Task 016 with the same files**, not a newly discovered dataset. Bottle metadata, source diagnostics and coverage tooling are new. See [full results, source restrictions, backups and manual import commands](docs/task018-compatibility.md).

## Current limitations

- The local write API has no authentication and therefore binds only to `127.0.0.1`; the desktop MVP is single-user.
- The portable EXE is not code-signed and can trigger a Windows reputation warning. Bundling Electron and Node makes the artifact comparatively large.
- Spreadsheet preview accepts one worksheet and the documented flat columns; arbitrary vendor-specific layouts need a future mapping step.
- Kyocera and Xerox collection are implemented; Epson acquisition is in progress with documented access/evidence limitations.
- Normalization intentionally removes punctuation; exceptional aliases may need a future alias table.
- Verification is recorded but not performed automatically.
- Import upserts existing normalized entities; it does not delete data missing from an import.
- Manual CRUD uses low-level database column names and relies on SQLite constraints for validation.
