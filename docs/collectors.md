# Manufacturer-specific collectors

Collectors are adapters at the edge of the system. A future collector may read an authorized API, downloadable catalog, or manually curated manufacturer file, but it must output the neutral `ImportRecord` shape documented in the README. It must not open or mutate SQLite itself.

Recommended pipeline:

1. Fetch only from sources the runtime is authorized to access. Do not bypass access controls.
2. Parse manufacturer-specific pages or files into `ImportRecord[]`.
3. Attach the exact evidence URL, source name, region, verification status, and OEM flag to every compatibility row.
4. Write JSON or CSV, or call `importRecords` from `src/importer.ts`.
5. Run a dry import first. Persist only if the complete batch validates.

A collector should keep raw retrieval, parsing, and mapping in separate functions so saved fixtures can test parsing without network access. Collector fixtures must be licensed appropriately and must never invent compatibility claims. Unit tests should use clearly fictional products and `.invalid` source URLs.

Example adapter boundary:

```ts
import type { ImportRecord } from '../src/types.js';

export async function collectAuthorizedCatalog(): Promise<ImportRecord[]> {
  const vendorRows = await fetchAuthorizedInput();
  return vendorRows.map(mapVendorRowToImportRecord);
}
```

Keep retries, rate limits, cache policy, robots/access rules, and provenance handling inside the collector. The shared importer remains the only write path, so every collector receives the same validation, normalization, deduplication, dry-run, and transaction behavior.
