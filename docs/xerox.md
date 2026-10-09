# Xerox official European collection

Task 006 was implemented on `codex/xerox-europe-collector` on 2026-10-09. No automatic merge or production database import is performed.

## Sources and coverage

The default seed is the public [Xerox Spain 106R03530/C400 page](https://www.xerox.es/es-es/supplies-and-accessories/106R03530/versalink-c400). Spain is prioritized. [Xerox Ireland](https://www.xerox.com/en-ie/supplies-and-accessories/106R03530/versalink-c400) uses the same inspected product structure and is supported with explicit `IE` provenance; Irish claims are never relabeled `EU` or `ES`.

The committed `data/official/xerox/` snapshot contains **12 retrieved product pages, 2 printer models, 12 OEM toner cartridges and 24 verified relationships**. There were **0 request failures, 0 excluded pages, 0 manual-review pages and 0 pending discovered pages**.

Models retain the official Spanish display names for VersaLink C400 and C405. This is the connected supply-page sample discovered from the seed, not an exhaustive Xerox catalog. Historical products, other families and markets require additional official seeds. Missing products are never deleted or assumed discontinued.

## Evidence and filtering

An accepted page must have one observed `.xrx-fw-product-sku-hero__content` block, an exact SKU heading matching its URL, a cartridge description, and Xerox's genuine-supplies statement. Exactly one matching JSON-LD `ProductModel`/`Product` must agree on SKU, MPN, description, canonical URL, Xerox manufacturer and brand.

The explicit `isConsumableFor` array must match the visible compatibility list. Each model must be a named Xerox printer on a same-market official printer URL. The collector does not split a C400/C405 product title to guess models: it reads the two explicit printer entries. Missing, conflicting or malformed evidence produces a manual-review report.

Everyday/non-Xerox/remanufactured products, drums, waste containers, bottles/refills, maintenance products, fusers, belts, cleaning products, imaging products, kits and staples are excluded or held for review. Classification uses product-specific content, so generic navigation advertising Everyday supplies does not reject a genuine cartridge. Synthetic fixtures cover these exclusions; none occurred in the collected sample.

Color comes only from explicit English/Spanish product text. Yield comes only from the cartridge's page-count expression (including `4.800` and `8,000` thousands separators). Unknown attributes remain absent. Evidence retains the original model/SKU, description, genuine statement and matching structured compatibility entry. No aliases, variants or family relationships are inferred.

## Acquisition and resumption

The collector reads each origin's robots policy before products, reusing the conservative implementation extracted from Epson. It uses a descriptive User-Agent, at least ten seconds between requests/retries, 30-second request timeouts, a per-run page cap and bounded network/5xx retries. Redirects are not followed. HTTP 401/403/429 or recognized HTML access challenges stop the run and retain pending work. Malformed/unknown robots policy stops access; no access protections are bypassed.

Only observed same-market `supplies-and-accessories` links are discovered. Canonical market/SKU identity deduplicates model-specific URL suffixes. The first observed URL is fetched; the manifest retains that exact URL, while compatibility records use the confirmed canonical SKU URL. Exhausted transient failures remain pending for a subsequent run.

Checkpoints are written atomically after successful pages. Raw HTML is stored under `raw/<sha256>.html`. `xerox-report.json` records requested URLs, retrieval times, hashes and snapshot paths. JSON/CSV contain the common import fields. Keep checkpoint and output directories together; use a fresh pair for a fresh acquisition. Entity/page totals are cumulative, while request/page-attempt counts describe the current invocation. A page cap leaves an explicit pending count.

## Windows PowerShell reproduction

```powershell
pnpm.cmd collect:xerox -- --max-pages 50 --delay-ms 10000 --retries 2
Get-Content .\data\official\xerox\xerox-report.json

# Strict validation in memory, without opening a production database.
pnpm.cmd db --db :memory: import:compatibility .\data\official\xerox\xerox.json --dry-run
pnpm.cmd db --db :memory: import:compatibility .\data\official\xerox\xerox.csv --dry-run

# Optional explicit import after reviewing the dry run.
pnpm.cmd db --db .\xerox-verification.sqlite import:compatibility .\data\official\xerox\xerox.json
pnpm.cmd db --db .\xerox-verification.sqlite import:compatibility .\data\official\xerox\xerox.csv
pnpm.cmd db --db .\xerox-verification.sqlite compatibility:stats
```

Options: `--seed` (repeatable), `--max-pages`, `--delay-ms`, `--retries`, `--output-dir`, `--state`. The default checkpoint is `.collector-state/xerox.json`. Unsupported domains/markets, credentials, query strings and fragments are rejected. Runs with failures exit nonzero and retain a report.

Use **`import:compatibility` for both formats** to preserve evidence, dates, source classification, color and yield under shared OEM validation. The legacy `import` command is not the strict evidence import route. CSV accepts explicit `true`/`false` OEM flags and integer yields; invalid values are rejected.

## Validation and limitations

Offline tests cover filtering, HTML/JSON-LD agreement, ES/IE provenance, unknown attributes, robots denials, redirects/access restrictions, transient retries, failure resumption, JSON/CSV and idempotency. A real-file test verifies every saved HTML hash, reproduces all 24 records, dry-imports them, imports twice in memory and confirms that existing Kyocera evidence is unchanged. Synthetic products remain under tests and temporary test directories only.

The live sample passes strict JSON and CSV dry imports with all 24 records accepted. Actual in-memory imports create 24 relationships once and zero on repetition. No migration or production database writes are required. Parsing fails closed when the observed format changes. Only ES has a committed live snapshot; IE is fixture-tested against the independently inspected Ireland structure. Full manufacturer coverage is not claimed.
