# Task 031 — Evidence inspector and review workspace

Status: planned; next implementation task after Task 030.

## Goal

Make the existing provenance and reliability model understandable from the desktop interface. A user reviewing a relationship must be able to see its exact source, region, evidence, verification date and reason for requiring attention without opening SQLite or reading collector JSON.

## Scope

- Display all retained `compatibility_sources` entries for a printer-to-supply relationship.
- Show source name/category/reference, region, reliability status, evidence type/text, import date and official verification date.
- Add a read-only review workspace with counts and filters for unverified, third-party-reported, conflicting, candidate, not-checkable and verified-without-date records where those states exist in the stored data.
- Link review rows back to the existing printer detail view.
- Provide clear empty states and definitions for every status.
- Reuse the existing audit endpoint, read model and local-only server boundary.

## Safety boundaries

- The first version is read-only: it does not approve, merge, delete or reclassify records.
- No status is inferred from model similarity, age, source name or missing fields.
- Third-party evidence remains separate from official verification.
- Existing evidence strings, URLs, regions and dates are returned unchanged.
- Synthetic fixture records stay under `tests/fixtures/` and never enter a production database.

## Acceptance

- Fixture-based tests cover multiple sources on one relationship, conflicting evidence, missing verification dates and status filters.
- Counts in the review workspace match direct SQLite queries.
- Official, third-party and unresolved states have visibly distinct labels and explanations.
- Source URLs are rendered only from stored data and open explicitly; the application performs no background request.
- Typecheck, build and all tests pass.
- Documentation records counts, limitations, branch and commit before merge approval.
