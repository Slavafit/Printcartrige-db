# Official printer cartridge data sources

Assessment date: 2026-10-08. Scope: public, official manufacturer sources suitable for genuine OEM ink/toner compatibility in Europe. No authenticated endpoints, access controls, bot protection, or network restrictions were bypassed. Search indexes are useful for discovery but are not treated as data feeds.

## Summary

| Manufacturer | Official source | Access | Format | Printer identifiers | OEM part numbers | Explicit compatibility | Geography | Automation feasibility | Limitations |
|---|---|---|---|---|---|---|---|---|---|
| Brother | [Brother UK supplies finder](https://www.brother.co.uk/supplies) | Search-visible, but direct collection was not selected because Brother España/current-environment access was known to be restricted | HTML product/device pages; some PDF brochures | Yes, exact device names on device supply pages | Yes | Yes, but pages mix toner/ink with drums, belts and waste units | UK and country-specific European sites | Medium if access is granted and a stable discovery feed is provided | No documented public API/feed found; pagination and mixed consumable types require careful filtering; regional sites differ |
| HP | [HP cartridge compatibility support article](https://support.hp.com/fr-fr/document/ish_2830196-2549374-16), [HP EU Dynamic Collateral PDF](https://pcb.inc.hp.com/dc/api/spec-sheet/eu-en/38347999/pdf/2Z628A.pdf) | Public | Large HTML tables, support pages, generated PDFs | Yes, often printer series rather than canonical individual models | Yes, family names and sometimes exact orderable SKUs | Yes | Explicit regional groupings including EMEA/Europe | Medium-low | Data is split across long support tables and per-product PDFs; family cartridge numbers are not always orderable part numbers; no documented public bulk API found |
| Canon | [Canon Europe ink and toner catalog](https://sfcc-service.canon-europe.com/ink-toner/), [example official specification PDF](https://www.canon-europe.com/media/PIXMA%20TR7550%20EUR_PR%20Spec%20Sheet_EM_tcm13-1602784.pdf) | Public catalog and PDFs | Salesforce Commerce HTML/structured facets; PDF specifications | Yes | Yes | Yes in catalog facets and printer specification sheets | Europe storefront with market-dependent variants | Medium | Storefront internals are not a documented public API; product codes/variant IDs differ from cartridge display codes; bulk relationship export not found |
| Epson | [Epson Europe ink finder](https://www.epson.eu/en_EU/inkfinder), [example 604 ink product](https://www.epson.eu/en_EU/products/ink-and-paper/ink-consumables/604xl-pineapple-single-black-ink/p/35499) | Public | HTML product pages with SKU and `Compatible Main Units`; PDFs/manuals | Yes, exact models | Yes, SKU and display family/code | Yes | Europe (`en_EU`), with some products/models sold only in subregions | High for page-level collection | Category includes bottles, cleaners, maintenance boxes and waste products; robust type exclusion is mandatory; no documented public bulk API/feed found |
| Kyocera | [Kyocera Europe sitemap](https://www.kyoceradocumentsolutions.eu/sitemap.xml), [example TK-4105](https://www.kyoceradocumentsolutions.eu/en/products/consumables/TK4105.html) | Public; `robots.txt` allows `/` and advertises the sitemap | XML sitemap plus server-rendered HTML | Yes, exact `Related products` titles on applicable toner pages | Yes, page heading (TK code) | Yes when related cards are explicitly printer products | Europe English site | High; implemented | Some toner pages have no related printer cards; `Related products` can also contain sibling toners, so collector accepts only cards explicitly marked as printers; colors are stored only when written on the page |
| Xerox | [Xerox Ireland genuine supplies example](https://www.xerox.com/en-ie/supplies-and-accessories/106R03530/versalink-c400) | Public | Server-rendered HTML; legacy PDFs | Yes | Yes | Yes, explicit `Compatible with` list | Country-specific European storefronts | High for page-level collection | Catalog also sells Xerox-branded third-party-compatible “Everyday” products; collector must distinguish those from genuine Xerox-for-Xerox supplies; region/SKU variants and legacy documents vary |

## Selected source: Kyocera Europe

The first collector uses the official XML sitemap only for discovery, then reads public server-rendered consumable pages at a conservative rate. It accepts a product only when:

- the exact page heading is a `TK` part number;
- official page text explicitly calls it toner;
- a related card is explicitly marked as a printer;
- the relationship comes from the same official consumable page.

This excludes drums, maintenance kits, waste toner bottles, staples, and sibling toner cards. Accepted relationships are marked `verified` because the official manufacturer page explicitly asserts them. `sourceUrl` is the exact consumable page and region is `EU`.

The 2026-10-08 reproducible snapshot checked 352 sitemap-listed `TK` pages and produced 28 unique printer models with 31 verified printer/toner relationships. No request failed. The small result relative to the number of pages is deliberate: most archived toner pages do not expose printer cards in the current server-rendered HTML, so they are not inferred. The snapshot is stored in `data/official/kyocera-eu.json` and `.csv`; it is real official-source data, not a synthetic fixture.

No manufacturer in this assessment exposed a documented, unauthenticated public bulk compatibility API. Kyocera's sitemap and rendered product pages are the first usable public source, not a contractual data feed; the HTML parser may require maintenance when the official site changes.

## Reproduction

```bash
pnpm install
pnpm collect:kyocera -- --max-models 200 --delay-ms 500 --retries 3
pnpm db import data/official/kyocera-eu.json --dry-run
```

Outputs are `data/official/kyocera-eu.json` and `.csv`. Progress is checkpointed in `.collector-state/kyocera-eu.json`; rerunning resumes completed pages. Delete only that state file to perform a fresh collection.

## Practical acquisition alternatives

For broader and more stable coverage, contact each manufacturer's channel/partner data team and request an authorized EU product-information feed containing canonical printer SKU, supply SKU, consumable type, color, market, validity dates, and compatibility edges. Other practical sources are official downloadable price books, product-catalog CSV/XML exports, GS1/GDSN feeds supplied by the manufacturer, and licensed manufacturer PDF catalogs. These are preferable to storefront parsing because they expose identifiers, lifecycle status, and regional validity explicitly.

Before adding another collector, confirm permission, discovery mechanism, update cadence, and schema ownership. Store raw source URLs and never promote inferred or retailer-supplied compatibility to `verified` OEM data.
