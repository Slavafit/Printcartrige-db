# Repository instructions for Codex

1. Read `PROJECT.md`, `ROADMAP.md`, `DATA_POLICY.md`, and `README.md` before starting.
2. Inspect the existing implementation, schema, tests, and Git history before changing anything.
3. Work on a feature branch created from an updated `main`.
4. Focus only on the requested task.
5. Reuse the existing database, shared import pipeline, collectors, and verification infrastructure.
6. Never fabricate printer models, cartridges, or compatibility relationships.
7. Never bypass authentication, bot protection, network restrictions, or other website protections.
8. Preserve existing data, verified evidence, and migrations; use additive migrations only when required.
9. Add fixture-based automated tests for new behavior. Keep synthetic data clearly marked and outside production data.
10. Run typecheck, build, and all tests before completion.
11. Update `ROADMAP.md` and relevant documentation after completing a task; mark work complete only when the repository proves it.
12. Report counts, failures, limitations, branch name, and commit hash.
13. Push feature branches, but never merge without explicit approval.
14. Use Windows PowerShell-compatible commands with `pnpm.cmd` when documenting local execution.

Data collection is the current priority. Do not add UI, authentication, hosting, or deployment work unless explicitly requested.

## Task execution workflow

1. Read `AGENTS.md` and the current task specification in `TASKS/` before starting implementation.
2. Use `ROADMAP.md` to determine task dependencies and current status.
3. Do not begin another task unless explicitly requested.
4. For data collection tasks, validate that the source contains actual printer-to-consumable compatibility information before developing an importer.
5. Reject driver-only catalogs and printer-only catalogs when the task requires consumable compatibility.
6. Prioritize measurable growth in printers with linked consumables over raw printer counts.
7. Keep third-party compatibility separate from officially verified OEM compatibility.
8. Never infer compatibility solely from cartridge families, similar model names, or generated assumptions.
9. Before importing, measure existing coverage; after importing, report the change.
10. Document source URLs, usage restrictions, rejected records, and limitations.
11. Never import data into the user's production SQLite automatically.
12. At completion, update the relevant task specification and `ROADMAP.md`, then report results and wait for approval before merging.