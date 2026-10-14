# Task 025 — Brother model parsing repair

**Status:** implemented and validated on `feature/fix-brother-model-parsing`.

## Goal

Repair three confirmed Brother model-name parsing errors before any database import, prevent silent label/URL mismatches, regenerate the saved Brother aggregate and audit, and scan the complete set for related truncation, suffix, and normalization issues.

## Confirmed corrections

| Parsed value | Confirmed value | Official saved URL | Relationships |
|---|---|---|---:|
| MFC-3360CN | MFC-3360C | `https://store.brother.es/devices/laser/mfc/mfc3360c` | 4 |
| MFC-295C | MFC-295CN | `https://store.brother.es/devices/laser/mfc/mfc295cn` | 8 |
| MFC-7 | MFC-7440N | `https://store.brother.es/devices/laser/mfc/mfc7440n` | 2 |

The same URLs are present in the committed Brother España sitemap and the corrected models already exist in the preserved catalog/coverage snapshot.

## Deliverables

1. Parse visible Brother model labels only when they agree with the linked official device URL.
2. Keep the three confirmed corrections explicit and narrowly keyed by original parsed identity plus exact official path.
3. Reject any new unconfirmed label/URL mismatch instead of guessing.
4. Rebuild the compatibility and verification aggregates from the saved collected records, then rerun validation and audit.
5. Preserve all supply records, evidence URLs, timestamps, and audit status categories.
6. Add fixture-based parser regression tests and a full committed-data audit for URL mismatches and normalized duplicates.

## Safety

- Do not import into or modify any SQLite database.
- Do not modify `PrinterDB-transfer-20261014-001528`.
- Do not make network requests or bypass source protections.
- Report missing raw artifacts as a limitation; use only the saved aggregate, verification data, sitemap, and explicit confirmed corrections.

## Result

- Corrected 3 models across 14 relationships, with exact saved URL and sitemap confirmation.
- Retained 293 printers, 254 supplies, and 1,611 relationships.
- Retained all audit categories: 1,606 cross-referenced, 4 candidate, and 1 not-checkable.
- Found zero remaining unconfirmed URL/model mismatches and zero normalized model duplicates.
- Dry-run against the transfer candidate reports zero new printers and does not alter SQLite.
- Raw Brother HTML was not present in the repository or transfer package; the rebuild uses the saved aggregate, reverse-verification records, sitemap, and explicit corrections without network access.
