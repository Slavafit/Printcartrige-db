# Multi-source imports

Task 016 adds a conservative import path for CSV, TSV, XLS/XLSX and JSON. Imports are previewed with a dry run before writing, processed in transactions of 500 rows, and retain both the normalized relationship and every source assertion. A repeated import is idempotent.

Source categories are `official`, `third_party`, `open_dataset`, `manual`, and `unknown`. Relationship reliability is independent: `official_verified`, `third_party_reported`, `unverified`, or `conflicting`. A third-party dataset cannot create an officially verified assertion. Supply origin is stored as `oem`, `compatible`, `remanufactured`, or `unknown`; uncertain values remain unknown.

Supported supply types are `ink`, `toner`, `drum`, `waste_toner`, `belt`, `other`, and `unknown`. The broader catalog is intentional: non-cartridge supplies are visible and distinguishable, but are never silently presented as OEM ink or toner.

## Generic files

Recommended columns:

```text
printerManufacturer,printerModel,supplyManufacturer,supplyPartNumber,supplyType,supplyOrigin,reliabilityStatus,region,description,note
```

Only `printerManufacturer` and `printerModel` are required. An empty supply part number creates printer provenance without a compatibility relationship.

```powershell
pnpm.cmd db --db .\catalog.sqlite import:multi-source .\catalog.xlsx --dry-run --source-name "Supplier catalog" --source-category third_party --source-reference "https://example.invalid/catalog" --region ES
pnpm.cmd db --db .\catalog.sqlite import:multi-source .\catalog.xlsx --source-name "Supplier catalog" --source-category third_party --source-reference "https://example.invalid/catalog" --region ES
```

## PrinterTonerDB adapter

[PrinterTonerDB](https://github.com/kurcz/PrinterTonerDB) is an Apache-2.0 third-party dataset. It is not copied into this repository or imported automatically. Download or clone it separately, review its license and files, then run:

```powershell
pnpm.cmd db --db .\catalog.sqlite import:printertonerdb C:\data\PrinterTonerDB\Printers2Toners.csv C:\data\PrinterTonerDB\Toner2Printers.csv --dry-run --region EU
pnpm.cmd db --db .\catalog.sqlite import:printertonerdb C:\data\PrinterTonerDB\Printers2Toners.csv C:\data\PrinterTonerDB\Toner2Printers.csv --region EU
```

`Printers2Toners.csv` is primary. Rows with a blank toner model create only a printer. `Toner2Printers.csv` supplements relationships only when its identifiers match an exact, unambiguous normalized printer already known from the primary file or database. Ambiguous and unmatched identifiers are reported for review. All resulting claims are `third_party_reported`; descriptions are classified conservatively and unknown types/origins remain unknown.

Before the first multi-source schema migration, a one-time SQLite backup is created beside the database as `<database>.pre-multisource.sqlite`. Existing official verification is never downgraded.
