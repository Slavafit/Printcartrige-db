# Task 021 — Database Restore UI and Modal Keyboard Handling

## Goal

Add a safe local UI workflow for restoring a PrinterDB SQLite backup, and allow the add-printer/add-cartridge dialog to close without saving when the user presses `Escape`.

## Scope

- Add a **Restaurar copia** action beside the existing backup action.
- Accept `.sqlite`, `.sqlite3`, and `.db` files up to 256 MB.
- Validate the SQLite header, `integrity_check`, foreign keys, and core PrinterDB tables before changing the active database.
- Create and validate a timestamped safety backup of the active database before replacement.
- Reconnect the local API and refresh UI statistics/results after a successful restore.
- Refuse restore while a collector is running.
- Keep the active database open and unchanged when upload validation fails.
- Close the add-record dialog on `Escape` without submitting the form.

## Data safety

The restore endpoint remains bound to the existing localhost-only server. It does not import into a production database automatically: the user must select a file and confirm the destructive state change in the UI. A failed replacement recovers the previous database from the safety backup. No schema migration is added; older valid backups pass through the existing additive initialization migrations on a temporary copy before replacement.

## Tests

- Restore from a synthetic fixture-backed SQLite and verify its catalog contents.
- Verify that the replaced database is preserved in the reported safety backup.
- Reject non-SQLite bytes without changing or closing the active database.
- Reject structurally valid SQLite files that do not contain the PrinterDB schema.
- Assert that the restore UI uses the local restore endpoint.
- Assert that the add dialog registers `Escape` handling.
- Run typecheck, production build, and the full Vitest suite.

## Result

Implemented on `codex/database-restore-ui`. The feature does not change catalog counts or import data. Final validation counts and commit hash are recorded at task completion.
