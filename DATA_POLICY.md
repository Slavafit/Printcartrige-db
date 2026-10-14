# Data quality policy

This policy governs all manual records, imports, and manufacturer collectors.

## Allowed product types

The verified OEM cartridge view contains only genuine OEM `ink` and `toner`. The broader supply catalog may retain `drum`, `waste_toner`, `belt`, `other`, and `unknown` records from identified third-party or open datasets so they can be reviewed and explicitly distinguished rather than misclassified. Supply origin is always stored as `oem`, `compatible`, `remanufactured`, or `unknown`.

Exclude drums, imaging units, waste toner containers, maintenance kits, fusers, transfer belts, ink bottles, refill kits, cleaners, printheads sold as service parts, paper, staples, accessories, compatible/remanufactured products, and other consumables from the **verified OEM cartridge view**. If type or OEM ownership is uncertain, store `unknown`; never classify it as an OEM cartridge or present it as verified.

## Evidence and verification

Use official manufacturer sources: product pages, compatibility tools, downloadable catalogs, specification sheets, documented APIs, or authorized manufacturer feeds. Retailers, aggregators, search snippets, model-number resemblance, and inferred printer families cannot establish verified compatibility.

- `verified`: an official source explicitly names the printer and compatible OEM cartridge; retain the exact URL, evidence, region, and verification date.
- `unverified`: a useful printer or relationship candidate exists, but evidence is incomplete or does not explicitly establish compatibility.
- `rejected`: the record is invalid or known to violate the data rules. Import reports may reject without persisting it.

Uncertain records must be rejected or routed to manual review. A reviewer must check the source, product type, OEM brand, exact identifiers, region, and relationship before promotion to `verified`. Never present unverified data as confirmed.

## Identity and duplicates

Normalize manufacturer names, printer model names, and cartridge part numbers for matching while preserving source display values. Database uniqueness constraints are the final duplicate guard. Multiple evidence sources may support the same printer/cartridge pair; identical relationship evidence must remain idempotent.

Do not resolve ambiguous aliases automatically when distinct regional or model variants may exist. Record the ambiguity for review instead.

## Evidence retention and regions

Every printer provenance or compatibility assertion must retain its exact source URL and region. Verified relationships additionally retain evidence text/type and verification date. Preserve permitted raw source artifacts or reproducible references when practical.

Treat regional compatibility and orderable SKUs independently. Evidence from one market must not silently become global. Use explicit regional labels such as `ES`, `EU`, or the source's documented market, and keep separate evidence where regional claims differ.

Historical and discontinued products are valid when official archived pages, catalogs, or documents establish them. Record what the evidence states; do not infer discontinuation from a missing current page.

## Access restrictions

Respect authentication, robots policies, rate limits, bot protection, network restrictions, licensing, and terms applicable to every source. Never bypass access controls. When a website is unavailable or blocked, use a manually obtained permitted artifact, an official downloadable catalog, or a manufacturer-provided feed. Document the limitation and do not invent missing data or create speculative parsers without an accessible source.

## Imports and updates

- Validate the complete import before opening a write transaction.
- Offer and use dry-run reporting before production imports.
- Make repeated imports idempotent and report duplicates, rejections, and manual-review candidates.
- Add new evidence without deleting records merely because they are absent from a later input.
- Preserve existing records and migrations.
- Never downgrade existing verified provenance or compatibility with an unverified re-import.
- Do not overwrite richer non-null attributes with missing values.
- Treat conflicting verified evidence as a review case; retain provenance instead of silently choosing one claim.
- Keep synthetic fixtures under test paths and never import them into a production database.
- Collection and verification history should be additive and auditable as the project gains dedicated history support.

## Task 018 supply metadata clarification

The broad supply catalog may store ink bottles as `supply_form = ink_bottle` with legacy `kind = other`, regardless of whether their evidence is official or third-party. Bottles are not cartridges and never increase the verified-OEM or compatible-cartridge counters. An official bottle relationship may be `official_verified` only when explicit manufacturer evidence supports the exact printer-to-bottle claim; it is reported in the separate all-supplies relationship total. This additive metadata does not broaden the strict official ink/toner validator or change Task 005's verified OEM cartridge requirements. Catalog manufacturer labels alone do not establish OEM origin; unknown origin remains `unknown`. Third-party/open-dataset imports cannot request `official_verified`. Source retrieval/import dates, original model/part spelling, region and source references are retained independently from official verification.
