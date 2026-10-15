# Task 030 — Data freshness and audit history

Status: implemented and validated on `feature/data-audit-history`.

## Goal

Expose when the local catalog changed, when official compatibility evidence was last verified, and which database operations were performed through the desktop application. Collection behavior and production data are outside this task.

## Implementation

- An additive `audit_events` table records successful creates, edits, deletes, manual imports, official-result imports, backups and restores performed through the local application API.
- The audit report deliberately separates the last database modification from the last official verification date. Editing or reimporting a row never renews its evidence date.
- The report identifies verified relationships without a date, verifications older than one year, records requiring review, per-manufacturer coverage and recent operations.
- The main screen shows the database modification and official verification dates. A dedicated **Auditoría** dialog provides the complete report.
- Restored older databases receive the additive table during the existing validated migration and record the restoration only after the replacement succeeds.

## Data safety and limitations

- Existing rows and evidence dates are not rewritten.
- The operation history begins when this version is first used. Earlier activity is not fabricated; historical freshness is derived only from existing row timestamps.
- CLI changes are reflected by row timestamps but are not added to the desktop operation history.
- A backup event is recorded after the copy succeeds, so the newly created copy does not contain an event claiming that it created itself.
- The one-year indicator is an audit signal, not an automatic rejection or deletion rule.

## Acceptance

- Additive initialization works for new and existing databases.
- Modification and verification dates remain semantically separate.
- Successful application mutations produce readable audit events.
- Synthetic fixture tests cover event history, missing verification dates and history limits.
- Typecheck, build and the complete automated test suite pass.
