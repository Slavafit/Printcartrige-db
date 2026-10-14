# Task 026 — Brother offline processor UI and unified database

Status: implemented and validated on `feature/brother-ui-import`.

## Goal

Expose the existing Brother HTML parser through the local official-source UI without adding arbitrary command execution or website access, then prepare one recoverable SQLite copy containing every currently validated official dataset.

## Implementation

- `src/collectors/brother.ts` reads only `data/brother-html`, calls the existing parser and model-repair modules from `scripts/`, preserves the saved reverse-verification states, rebuilds the audit, validates the multi-source package, and replaces outputs only after successful preparation.
- The collector whitelist gives Brother a dedicated **Procesar HTML** action, input availability, checkpoint progress and a fixed output path.
- Brother import uses the shared transactional multi-source importer with fixed official provenance. It performs a dry-run before writing and imports only the prepared `cross-referenced` rows.
- Synthetic fixture coverage proves confirmed model repair, preservation of `cross-referenced`, `candidate`, and `not-checkable`, repeat output replacement, progress totals and the missing-input UI state.

## Local unified database result

The original transfer database was not overwritten. A new ignored local artifact, `PrinterDB-transfer-20261014-001528/printerdb-unified-2026-10-14.sqlite`, was copied from the specified candidate and then received the validated Brother, Lexmark, Kyocera and Xerox packages. Empty HP and Epson outputs contained no rows.

- Brother: 1,606 official relationships added.
- Lexmark: 525 relationships added; 50 already existed.
- Kyocera: all 31 relationships already existed.
- Xerox: all 24 relationships already existed.
- Final catalog: 6,488 printers, 3,211 supplies, 21,038 relationships, 2,236 officially verified relationships.
- SQLite integrity: `ok`; foreign-key violations: 0.
- Original candidate SHA-256 remained `A493995FBB64F24EE2C45E91ADBF37949B5341CC6D9DB7762772685F7579E7CB`.
- Final unified database SHA-256: `4E08E059EA5F3165F758B6FD2537106C7856E96843B9B2E92819395370E290CC`.
- Repeating the Brother and Lexmark imports created zero printers, supplies, relationships or evidence rows.

The SQLite artifact and its coverage report remain outside Git.
