# OpenPrinting Foomatic DB import

Task 017 adds an offline adapter for the XML printer records in [OpenPrinting/foomatic-db](https://github.com/OpenPrinting/foomatic-db). OpenPrinting is an open dataset, not an official manufacturer source. The repository's `COPYING` file applies GPL version 2 to most of the package and notes separate licences for some PPD files. PrinterDB reads only `db/source/printer/*.xml`; it does not copy PPDs.

Clone or update the source separately. The OpenPrinting checkout and its thousands of XML files are intentionally not committed to PrinterDB:

```powershell
git clone --depth 1 https://github.com/OpenPrinting/foomatic-db.git C:\data\foomatic-db
git -C C:\data\foomatic-db rev-parse HEAD
```

Preview the default priority manufacturers (HP, Epson and Canon):

```powershell
pnpm.cmd db --db .\printerdb.sqlite import:openprinting C:\data\foomatic-db --dry-run --source-revision <commit-sha>
```

Import after reviewing the report:

```powershell
pnpm.cmd db --db .\printerdb.sqlite import:openprinting C:\data\foomatic-db --source-revision <commit-sha>
```

The path may be either the repository root or its `db\source\printer` directory. Use `--manufacturers HP,Epson,Canon` to choose a subset, `--all-manufacturers` for every make, and `--region global` to override the default region label. Supplying the exact commit SHA creates immutable source links.

The report includes scanned and targeted XML files, valid and unique models, input duplicates, existing and inserted models, provenance and characteristic rows, per-manufacturer counts, and rejected records. Parsing and validation complete before the write transaction. Repeating the same command does not duplicate manufacturers, printers, source links, or characteristics.

## Stored data and trust boundary

Manufacturer aliases such as `Hewlett-Packard`/`HP`, `Seiko Epson`/`Epson`, and `Canon Inc.`/`Canon` are canonicalized for matching. The original make and model remain in `printer_characteristics`. Available mechanism, colour capability, maximum declared DPI, printer languages, Foomatic identifier, driver name, functionality grade, and manufacturer URL are retained with import time, origin `open_dataset`, and the exact XML source URL.

Every imported printer source is `unverified`. Driver support, a Foomatic entry, and its comments are not evidence of a cartridge part number or printer/cartridge compatibility. This importer never writes `cartridges`, `compatibility`, or `compatibility_sources`, and it never changes existing verified OEM evidence. The current `printers.has_replaceable_cartridges` field is required and has no unknown state; new OpenPrinting rows retain the legacy default while no cartridge relationship is created. A future schema task should make this state explicitly tri-valued.

## Verified snapshot

Against OpenPrinting commit `76dd1e31354c189b2edd9ae8201285d622c89395`, the adapter scanned 6,023 printer XML files. The priority subset contained 1,673 valid records and 1,668 unique normalized models: Canon 203, Epson 896, and HP 569. Five duplicate model records were consolidated by retaining the richer characteristic record. There were no rejected priority XML records. These are catalog records, not verified cartridge compatibility.
