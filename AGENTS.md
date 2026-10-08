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
