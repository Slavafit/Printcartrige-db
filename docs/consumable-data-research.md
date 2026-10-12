# Open consumable data research

Research date: 2026-10-12. The goal was to find reusable, openly licensed structured data containing cartridge part numbers and explicit compatible printer models for HP, Epson, and Canon. Search results and manufacturer pages were not treated as datasets, and no mass scraping was performed.

## Usable dataset found

| Source | Licence | Format | HP | Epson | Canon | Automation | Limitations |
|---|---|---|---:|---:|---:|---|---|
| [PrinterTonerDB](https://github.com/kurcz/PrinterTonerDB) | Apache-2.0 | Tab-separated `Printers2Toners` and `Toner2Printers` files | 2,065 models / 713 supplies / 9,006 relationships | 307 / 303 / 1,228 | 796 / 391 / 2,416 | Existing `import:printertonerdb` adapter; dry-run and idempotent import | Third-party catalog; many descriptions do not reliably establish OEM ownership or product type; 10,684 supplied rows/identifiers require review in the current snapshot. Claims remain `third_party_reported`, never officially verified. |

Counts above are the unique normalized results produced by the existing adapter from the manually supplied repository snapshots `data/Printers2Toners.txt` and `data/Toner2Printers.txt`: printer models / unique manufacturer-part-number supplies / unique model-part-number edges. They describe source coverage, not approved OEM compatibility. Unknown, compatible, remanufactured, drum, bottle, and other records must stay distinguishable and outside the verified OEM view.

## Evaluated but not cartridge compatibility datasets

| Source | Licence/terms | Format and coverage | Decision |
|---|---|---|---|
| [OpenPrinting Foomatic DB](https://github.com/OpenPrinting/foomatic-db) | GPL-2.0 for most of the package; per-file exceptions for PPDs | XML printer catalog; verified snapshot has 1,668 unique priority models, 0 structured cartridge SKUs, 0 cartridge relationships | Implemented for printer expansion only. Driver fields and comments cannot verify consumables. |
| [HPLIP](https://github.com/zdohnal/hplip) | Mixed GPL-2.0, GPL-3.0, MIT and BSD by file; some binary plug-ins proprietary | HP device/driver capability files | Not a structured cartridge compatibility dataset; no cartridge import planned from driver metadata. Licence must be assessed per file before reuse. |
| [Gutenprint printer XML](https://github.com/echiu64/gutenprint/blob/master/src/xml/printers.xml) | GPL-2.0-or-later in the XML header | XML driver-supported printer definitions | Useful only as another model/driver catalog. It does not provide a dependable structured set of orderable cartridge SKUs and explicit compatibility edges. |
| Manufacturer product/support pages | Manufacturer copyright and site terms; no general open-data licence identified | HTML/PDF pages, region-specific and often access-controlled | May supply official evidence through a small permitted collector or manually downloaded catalog, but not an openly licensed bulk dataset. Request official EU product-information feeds, price books, or GS1/GDSN data instead of mass scraping. |

No additional openly licensed, structured dataset with sufficiently clear HP/Epson/Canon cartridge identifiers and model edges was found. PrinterTonerDB is therefore the only immediately automatable open candidate identified, and its data-quality limitations require review. Future sources can plug into the existing multi-source row representation and `compatibility_sources` evidence history without changing or downgrading official relationships.
