# Third-party notices

The repository contains data from [kurcz/PrinterTonerDB](https://github.com/kurcz/PrinterTonerDB), published by kurcz under the [Apache License 2.0](licenses/PrinterTonerDB-Apache-2.0.txt). Retain this attribution and the license when redistributing the files or derivatives.

`data/Printers2Toners.txt` and `data/Toner2Printers.txt` are byte-identical copies of upstream `Printers2Toners.csv` and `Toner2Printers.csv` at commit `ded2df49109534569dabe7b6a39df7713ac44bfc`, verified on 2026-10-13. Only the file extensions differ; their content is tab-separated. The existing `PrinterTonerDB_import_candidates.csv` and `PrinterTonerDB_printers.csv` are derived local files, not used by the Task 018 experiment. Task 018 reports are derived analyses of the original files.

Upstream describes the data as scraped from an unnamed printer website. Its publication license does not establish official manufacturer verification or resolve the unidentified original site's provenance. All imported relationships remain third-party reports; regions and origin remain unknown unless explicitly supported. No data is automatically imported into the user's working SQLite. See [source assessment and limitations](docs/task018-compatibility.md).
