# Task 022 — Lexmark España Official Compatibility

## Goal

Increase officially verified OEM coverage from public Lexmark España printer pages that explicitly list replacement cartridge part numbers.

## Scope

- Discover Spanish printer product pages from the official Lexmark sitemap.
- Parse only the explicit Return Program and standard cartridge tables on each printer page.
- Preserve exact printer page URL, retrieval date, description, part number, colour, yield, market, and evidence.
- Exclude imaging units, drums, waste containers, fusers, belts, staples, developers, and uncertain product types.
- Use the shared strict compatibility importer; the collector never writes SQLite directly.
- Run in conservative resumable batches and retain raw source snapshots and hashes.
- Add Lexmark to the fixed local collector whitelist and expose collectors in the UI data/import dialog.
- Never import into the user's active SQLite automatically.

## Source validation

The public Lexmark España sitemap contains exact printer product pages. Those pages identify one printer model and separate Return Program, standard, and other-supply tables. Cartridge rows expose the exact orderable part number and usually colour and page yield. The collector creates an edge only between the current printer page and cartridge rows in the two cartridge tables; family names inside descriptions never create additional relationships.

The current `robots.txt` advertises the Spanish sitemap and does not disallow public printer product paths. Collection remains rate-limited, honors future policy changes, stops on access challenges, and does not use authenticated or undocumented endpoints.

## Acceptance

- Synthetic fixture tests cover discovery, parsing, exclusions, URL boundaries, strict import, and resume behavior.
- A small permitted live pilot proves the current source format before any larger collection.
- Typecheck, production build, and all tests pass.
- Documentation reports baseline, pilot counts, failures, limitations, branch, and commit.

## Result

Implemented on `feature/lexmark-official-compatibility`. The bounded live pilot discovered 631 printer pages and processed two of them, producing 2 printers, 40 OEM cartridges, and 56 explicit verified relationships. It reported zero request failures and zero manual-review items, and its JSON output passed strict dry import without changing the active database. Full-catalog collection remains intentionally pending and must be run in conservative resumable batches.

The collector UI also reports live checkpoint progress, accumulated record counts, errors and estimated time remaining, opens the process log while running, and provides an explicit stop action that preserves the checkpoint for a later resume.
