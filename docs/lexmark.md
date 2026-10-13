# Lexmark España official compatibility collector

Assessment and pilot date: 2026-10-13.

## Why this source is usable

Lexmark publishes an official Spanish sitemap and public printer product pages. Each printer page identifies one exact model and contains separate tables for Return Program cartridges, standard cartridges, and other supplies. Cartridge rows expose an orderable part number and usually a colour and page yield. This is explicit printer-to-cartridge evidence, unlike a printer-only catalog or a cartridge family inferred from its name.

The collector creates relationships only from the printer page currently being parsed. It never expands comma-separated family names in a cartridge description into additional printer models. Return Program and standard cartridge SKUs remain separate. The `otherSupplies` table is reported as excluded and cannot create verified cartridge records.

The public `robots.txt` advertises the Spanish sitemap and, at the assessment date, does not disallow `/es_es/printers/printer/`. The collector retrieves `robots.txt` first on every run, applies the shared conservative ten-second minimum delay, follows no redirects, stops on access challenges, and uses no authenticated or undocumented endpoint. Terms and access policy must be reviewed again if the site changes.

## Baseline and live pilot

Before this task, the local catalog contained 903 Lexmark printers: 496 with any third-party supply relationship, 407 without one, and zero officially verified Lexmark relationships.

A separate, non-production pilot visited the sitemap and two printer pages:

- pages completed: 3;
- pending discovered printer pages: 629;
- exact printer models: 2 (`CS725de`, `CX725de`);
- unique OEM cartridge SKUs: 40;
- explicit relationships: 56;
- manual-review records: 0;
- request failures: 0.

The strict shared importer accepted all 56 records in dry-run and wrote zero rows. The pilot did not modify `mvp.sqlite`; its raw pages and output remain under ignored `.collector-state` paths and are not redistributed by the repository.

## Commands

```powershell
pnpm.cmd build:server
node dist/src/collectors/lexmark.js --output-dir data/official/lexmark --state .collector-state/lexmark.json --max-pages 50 --delay-ms 10000 --retries 2
node dist/src/cli.js import data/official/lexmark/lexmark.json --dry-run
```

The UI runs the same compiled collector in resumable 50-page batches. Completing a batch only prepares JSON/CSV and a report. `Importar resultado` is a separate action that validates and writes through the shared importer.

## Limitations

- The sitemap currently exposes 631 printer pages, so complete collection requires multiple batches and substantial time at the conservative request rate.
- Regional cartridge SKUs are stored as Spanish-market evidence and are not generalized to other countries.
- Product pages may change or disappear; raw local snapshots, URL, retrieval time, and SHA-256 are retained for reproducibility.
- Rows with uncertain type, conflicting part numbers, unsupported links, or missing cartridge tables are quarantined instead of promoted.
- Factual pilot output is not automatically imported into the user's active database.
