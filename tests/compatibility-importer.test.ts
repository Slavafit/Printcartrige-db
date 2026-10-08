import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importCompatibilityRecords } from '../src/compatibility-importer.js';
import { CartridgeDatabase } from '../src/database.js';
import { exportRecords } from '../src/exporter.js';

const official = {
  printerManufacturer: 'Example OEM', printerModel: 'Example Print 1000',
  cartridgeManufacturer: 'Example OEM', cartridgePartNumber: 'OEM-TN-1000', productType: 'toner',
  cartridgeColor: 'black', yieldPages: 2500, isGenuineOem: true,
  sourceName: 'Example OEM official product page', sourceUrl: 'https://example.invalid/oem/printer-1000',
  sourceType: 'official-manufacturer', evidenceType: 'explicit-compatibility',
  evidence: 'Synthetic fixture: official page explicitly lists this cartridge for this printer.',
  verificationStatus: 'verified', region: 'TEST', verifiedAt: '2026-10-08T00:00:00.000Z',
};

describe('strict OEM compatibility import', () => {
  let database: CartridgeDatabase;
  beforeEach(() => { database = new CartridgeDatabase(':memory:'); database.initialize(); });
  afterEach(() => database.close());

  it('imports valid OEM toner and ink relationships with evidence', () => {
    const ink = { ...official, printerModel: 'Example Ink 2000', cartridgePartNumber: 'OEM-INK-2C', productType: 'ink', cartridgeColor: 'cyan' };
    const result = importCompatibilityRecords(database, [official, ink], false);
    expect(result).toMatchObject({ acceptedRecords: 2, insertedRelationships: 2, rejectedRecords: 0 });
    expect(database.list('cartridges')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'toner', yield_pages: 2500 }), expect.objectContaining({ kind: 'ink', color: 'cyan' }),
    ]));
  });

  it.each(['drum', 'ink-bottle'])('excludes %s before any cartridge is inserted', (productType) => {
    const result = importCompatibilityRecords(database, [{ ...official, productType }], false);
    expect(result.rejectedByReason[`excluded-product-type:${productType}`]).toBe(1);
    expect(database.list('cartridges')).toHaveLength(0);
  });

  it('excludes third-party cartridges', () => {
    const result = importCompatibilityRecords(database, [{ ...official, isGenuineOem: false }], false);
    expect(result.rejectedByReason['not-genuine-oem']).toBe(1);
    expect(database.list('compatibility')).toHaveLength(0);
  });

  it('quarantines a verified claim without explicit official evidence', () => {
    const result = importCompatibilityRecords(database, [{ ...official, sourceType: 'other', evidence: '' }], false);
    expect(result.recordsRequiringManualReview).toBe(1);
    expect(result.manualReview[0].reason).toBe('insufficient-official-evidence');
    expect(database.list('cartridges')).toHaveLength(0);
  });

  it('rejects an invalid printer model', () => {
    const result = importCompatibilityRecords(database, [{ ...official, printerModel: '' }], false);
    expect(result.rejectedByReason['invalid-printer-model']).toBe(1);
  });

  it('deduplicates input and supports multiple cartridges and printers', () => {
    const secondCartridge = { ...official, cartridgePartNumber: 'OEM-TN-1000XL', yieldPages: 5000 };
    const secondPrinter = { ...official, printerModel: 'Example Print 1001', sourceUrl: 'https://example.invalid/oem/printer-1001' };
    const result = importCompatibilityRecords(database, [official, official, secondCartridge, secondPrinter], false);
    expect(result).toMatchObject({ duplicateInputRecords: 1, insertedRelationships: 3 });
    expect(database.list('printers')).toHaveLength(2);
    expect(database.list('cartridges')).toHaveLength(2);
    expect(database.list('compatibility')).toHaveLength(3);
  });

  it('supports dry-run and repeated idempotent imports', () => {
    const dryRun = importCompatibilityRecords(database, [official], true);
    expect(dryRun).toMatchObject({ acceptedRecords: 1, insertedRelationships: 0 });
    expect(database.list('printers')).toHaveLength(0);
    expect(importCompatibilityRecords(database, [official], false).insertedRelationships).toBe(1);
    const repeated = importCompatibilityRecords(database, [official], false);
    expect(repeated).toMatchObject({ insertedRelationships: 0, existingRelationships: 1 });
  });

  it('preserves verification evidence and yield through common export records', () => {
    importCompatibilityRecords(database, [official], false);
    const exported = exportRecords(database);
    const restored = new CartridgeDatabase(':memory:');
    try {
      restored.initialize();
      expect(importCompatibilityRecords(restored, exported, false).insertedRelationships).toBe(1);
      expect(restored.queryCompatibility()).toEqual([
        expect.objectContaining({ yield_pages: 2500, source_type: 'official-manufacturer', evidence_type: 'explicit-compatibility' }),
      ]);
    } finally { restored.close(); }
  });

  it('imports and preserves the existing Kyocera official-source output', async () => {
    const records = JSON.parse(await readFile(resolve('data/official/kyocera-eu.json'), 'utf8')) as unknown[];
    const first = importCompatibilityRecords(database, records, false);
    const second = importCompatibilityRecords(database, records, false);
    expect(first).toMatchObject({ acceptedRecords: 31, insertedRelationships: 31, rejectedRecords: 0 });
    expect(second).toMatchObject({ insertedRelationships: 0, existingRelationships: 31 });
    expect(database.compatibilityStats()).toMatchObject({ totalVerifiedRelationships: 31, totalUniqueOemCartridges: 12 });
  });

  it('imports the task-provided Brother HL-2070N / TN-2000 example but not DR-2000', async () => {
    const records = JSON.parse(await readFile(resolve('tests/fixtures/brother-hl2070n-compatibility.json'), 'utf8')) as unknown[];
    const result = importCompatibilityRecords(database, records, false);
    expect(result.insertedRelationships).toBe(1);
    expect(database.queryCompatibility('Brother HL-2070N')).toEqual([
      expect.objectContaining({ model_name: 'Brother HL-2070N', part_number: 'TN-2000', verification_status: 'verified' }),
    ]);
    expect(database.list('cartridges')).not.toEqual(expect.arrayContaining([expect.objectContaining({ part_number: 'DR-2000' })]));
  });
});
