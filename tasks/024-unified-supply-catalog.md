# Task 024 — Unified supply catalog and Brother import preparation

**Status:** implemented and validated on `feature/unified-supply-catalog`.

## Goal

Represent cartridges, toner, ink bottles, drums, waste containers, belts, and unknown supplies consistently across manufacturers without presenting non-cartridge supplies as verified OEM cartridges. Prepare the completed Brother collection for a safe, reviewable import without modifying the user's active SQLite database.

## Baseline

- Brother collection: 254 supplies, 293 printers, and 1,611 candidate relationships.
- Audit: 1,606 cross-referenced relationships, 4 candidates, and 1 relationship that could not be checked.
- Acquisition history: 248 downloaded supply pages and 6 failures.
- Brother output is a collector-specific aggregate, not an accepted shared import file.
- The schema already represents ink bottles as legacy `kind = other` plus `supply_form = ink_bottle`, but the web read model and UI still use cartridge-only language and counters.

## Deliverables

1. Manufacturer-independent supply type labels and statistics.
2. UI language and details that distinguish cartridges/toner, ink bottles, and other supplies.
3. Manual supply editing that preserves `supply_form` instead of coercing every record to ink/toner.
4. A deterministic Brother conversion and dry-run workflow using the existing multi-source import pipeline.
5. Only cross-referenced Brother relationships may request official verification; candidates and uncheckable rows remain outside the import.
6. Ink bottles must be retained as supplies and excluded from OEM cartridge counters.
7. Fixture-based tests for classification, counts, filtering, dry-run safety, and idempotency.
8. Documentation of counts, excluded records, evidence boundaries, and import commands.

## Safety and acceptance

- Do not write to the active SQLite database.
- Do not infer product type or compatibility from family names or similar part numbers.
- Official status requires explicit Brother evidence from both sides of the relationship.
- Dry-run must be byte-preserving for an existing SQLite file.
- Repeated import into a disposable database must create no duplicate supplies or relationships.
- Typecheck, build, and all tests must pass before completion.

## Result

- Generated 1,606 accepted relationships for 292 printers and 253 supplies from 1,611 audited relationships.
- Classified 1,598 cartridge relationships and 8 ink-bottle relationships.
- Kept four candidates and one uncheckable relationship outside the import; no conversion errors.
- The in-memory strict dry run accepted all 1,606 generated rows with zero errors or review warnings.
- No active or production SQLite database was modified.
