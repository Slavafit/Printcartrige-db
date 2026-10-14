# Task 028 — Packaged Electron collector runtime

Status: implemented and validated on `feature/electron-collector-runtime`.

## Goal

Make every whitelisted collector runnable from the portable Electron application instead of resolving its executable and data paths relative to the directory used to launch the EXE.

## Implementation

- Electron passes the immutable packaged application root and a writable collector workspace to the local server.
- Collector executables are resolved from the packaged application, while outputs, checkpoints and offline input are resolved below `%APPDATA%\printcartridge-db\collector-workspace`.
- The Brother parser, rebuild helper, model resolver and saved verification seed are packaged as runtime resources.
- On every application start, bundled scripts are refreshed in the writable workspace; existing data and collection results are never overwritten.
- The built web client is refreshed into `%APPDATA%\printcartridge-db\runtime\web-dist` at startup, so reopening the catalog from the tray does not depend on temporary portable-package files.
- The collector UI reports the absolute Brother input path. Saved official HTML must be copied into its `data\brother-html` directory before **Procesar HTML** becomes available.
- Fixture-based tests cover extraction policy, workspace path resolution and the Electron packaging manifest.

## Data safety

No collector runs automatically, no result is imported automatically, and no SQLite database is modified by runtime extraction. Existing HTML, checkpoints and output files in the user workspace are preserved.
