# Epson Europe acquisition — Task 005

Status on 2026-10-09: **in progress, not a completed compatibility collector**.

The adapter reads public `www.epson.eu/en_EU/products/.../p/<id>` URLs and emits the existing neutral import shape. It never writes SQLite. Its initial discovery seed is the official [604XL black ink page](https://www.epson.eu/en_EU/products/ink-and-paper/ink-consumables/604xl-pineapple-single-black-ink/p/35499); product links discovered on retrieved pages become a persistent queue for the next invocation. This is bounded page-level discovery, not full sitemap coverage or an exhaustive catalog.

## Access and actual result

Both [EU robots.txt](https://www.epson.eu/robots.txt) and [Spanish robots.txt](https://www.epson.es/robots.txt) declare `Crawl-delay: 10`, `Request-rate: 1/10`, and `Visit-time: 0400-0845` for general crawlers. The collector conservatively treats that visit window as UTC, stops outside it, and does not impersonate the named search-engine exceptions. It reads robots on every run and refuses unknown directives or malformed policy. Redirects, HTTP 401/403/429 and other non-transient HTTP responses are not retried; network errors and 5xx responses have bounded retries. Every attempt is spaced by at least the declared delay, with a 30-second request timeout. Checkpoints retain failures as pending work for a later permitted run.

The actual 2026-10-09 attempt at 09:50 UTC fetched robots only: **0 product pages, 0 printers, 0 cartridges, 0 relationships, 1 deferred URL**. The committed `data/official/epson/epson-eu-report.json` explains the restriction; empty JSON/CSV files are honest outputs, not a collected dataset. The command exits nonzero when requests fail or are deferred. Existing production databases were not modified.

## Evidence limitations

The publicly rendered 604XL page has SKU `C13T10H14010`, an “Other Products in the Series” section and a “Compatible Main Units” section. Its qualification says models can match one or more items in the range. That is insufficient to assert each model against this exact SKU. The parser therefore retains range text in the manual-review report and creates no compatibility edge. Even an unqualified list remains for review until a real official exact-SKU evidence format is acquired and tested. **This implementation currently has no automatic verified-edge mapping.**

It excludes bottles, refills, cleaning/maintenance products, drums, waste, fusers, belts and printheads. Multipacks are deferred as excluded composite products rather than conflated with single cartridges. Unknown type, missing SKU, changed headings and access challenges are review cases. No yields or colors are inferred from sibling product listings.

EcoTank printer pages can produce printer-only records when their heading identifies EcoTank and body explicitly says cartridge-free. The shared importer now preserves their URL/region/status in the existing `printer_sources` table without creating cartridge rows. This path is tested with fictional models, but has not yet been validated on live raw HTML. No schema migration was needed.

## Reproduction (Windows PowerShell)

Run during the site's permitted window, then inspect the report:

```powershell
pnpm.cmd collect:epson -- --max-pages 20 --delay-ms 10000 --retries 2
Get-Content .\data\official\epson\epson-eu-report.json
pnpm.cmd db --db :memory: import .\data\official\epson\epson-eu.json --dry-run
```

Options: `--output-dir`, `--state`, `--max-pages`, `--delay-ms`, `--retries`, `--seed`. A seed must be an exact official EU product URL; other hosts, query strings, credentials and fragments are rejected. The current collector intentionally does not cross regional hosts. `--max-pages` is per invocation; reruns process the pending queue without repeating completed pages. Preserve checkpoints and outputs together. A separate state/output pair starts a fresh acquisition without deleting previous artifacts.

Raw pages are saved under the output directory's `raw/<product-id>.html`; the checkpoint defaults to ignored `.collector-state/epson-eu.json`. JSON and CSV contain the same printer records, including source metadata. Use the strict `import:compatibility` pipeline for future actual cartridge edges; the ordinary shared import accepts printer-only records. An empty successful dry run does not demonstrate real catalog coverage.

Fixtures under `tests/fixtures/epson-*` are clearly synthetic semantic reconstructions of observed headings/policy. They are not Epson HTML snapshots and must never be imported into production. Tests exercise conservative rejection, policy enforcement, failure/resume, JSON/CSV import, provenance preservation and idempotency. Real raw markup and exact-SKU evidence remain necessary to finish Task 005.
