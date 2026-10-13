# Multi-source imports

Task 016 adds a conservative import path for CSV, TSV, XLS/XLSX and JSON. Task 018 makes each import atomic (including source creation), processing chunks of 500 rows within one transaction. Dry runs retain their read-only behavior. Imports retain the normalized relationship and source assertions; repeated imports are idempotent.

Source categories are `official`, `third_party`, `open_dataset`, `manual`, and `unknown`. Relationship reliability is independent: `official_verified`, `third_party_reported`, `unverified`, or `conflicting`. A third-party dataset cannot create an officially verified assertion. Supply origin is stored as `oem`, `compatible`, `remanufactured`, or `unknown`; uncertain values remain unknown.

Supported supply types are `ink`, `ink_bottle`, `toner`, `drum`, `waste_toner`, `belt`, `other`, and `unknown`. Bottles use additive `supply_form` metadata and legacy `kind=other`; see [Task 018 migration and coverage](task018-compatibility.md). Non-cartridge supplies are never silently presented as OEM ink or toner.

## Generic files

Recommended columns:

```text
printerManufacturer,printerModel,supplyManufacturer,supplyPartNumber,supplyType,supplyOrigin,color,reliabilityStatus,region,description,note
```

Only `printerManufacturer` and `printerModel` are required. An empty supply part number creates printer provenance without a compatibility relationship.

```powershell
pnpm.cmd db --db .\catalog.sqlite import:multi-source .\catalog.xlsx --dry-run --source-name "Supplier catalog" --source-category third_party --source-reference "https://example.invalid/catalog" --region ES
pnpm.cmd db --db .\catalog.sqlite import:multi-source .\catalog.xlsx --source-name "Supplier catalog" --source-category third_party --source-reference "https://example.invalid/catalog" --region ES
```

## PrinterTonerDB adapter

[PrinterTonerDB](https://github.com/kurcz/PrinterTonerDB) is an Apache-2.0 third-party dataset. Snapshots are included in this repository with [license and attribution](../THIRD_PARTY_NOTICES.md), but never imported automatically. For separately obtained files, review their provenance and license, then run (region stays unknown unless explicitly supplied by the source):

```powershell
pnpm.cmd db --db .\catalog.sqlite import:printertonerdb C:\data\PrinterTonerDB\Printers2Toners.csv C:\data\PrinterTonerDB\Toner2Printers.csv --dry-run
pnpm.cmd db --db .\catalog.sqlite import:printertonerdb C:\data\PrinterTonerDB\Printers2Toners.csv C:\data\PrinterTonerDB\Toner2Printers.csv
```

`Printers2Toners.csv` is primary. Rows with a blank toner model create only a printer. `Toner2Printers.csv` supplements relationships only when its identifiers match an exact, unambiguous normalized printer already known from the primary file or database. Ambiguous and unmatched identifiers are reported for review. All resulting claims are `third_party_reported`; descriptions are classified conservatively and unknown types/origins remain unknown.

The repository currently includes manually supplied snapshots as `data/Printers2Toners.txt` and `data/Toner2Printers.txt`. They are never imported automatically. Validate the pair without writing a database:

```powershell
pnpm.cmd db --db :memory: import:printertonerdb .\data\Printers2Toners.txt .\data\Toner2Printers.txt --dry-run
```

After reviewing the report, import the same files into an explicit database by removing `--dry-run` and replacing `:memory:` with its path.

Before the first multi-source schema migration, a one-time SQLite backup is created beside the database as `<database>.pre-multisource.sqlite`. Existing official verification is never downgraded.
