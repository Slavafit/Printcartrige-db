import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CartridgeDatabase } from '../src/database.js';
import { exportRecords } from '../src/exporter.js';
import { importRecords } from '../src/importer.js';

const base = {
  printerManufacturer: 'Example Printer Corp',
  printerModel: 'Demo Print-1000',
  hasReplaceableCartridges: true,
  cartridgeManufacturer: 'Example Printer Corp',
  cartridgePartNumber: 'SYN-INK-01-BK',
  cartridgeKind: 'ink',
  sourceName: 'Synthetic test source',
  sourceUrl: 'https://example.invalid/synthetic/demo',
  verificationStatus: 'unverified',
  region: 'TEST',
  isGenuineOem: true,
};

describe('database pipeline (synthetic non-production data)', () => {
  let database: CartridgeDatabase;
  beforeEach(() => { database = new CartridgeDatabase(':memory:'); database.initialize(); });
  afterEach(() => database.close());

  it('validates a dry run without writing', () => {
    const result = importRecords(database, [base], true);
    expect(result).toMatchObject({ valid: true, dryRun: true, written: 0 });
    expect(database.list('printers')).toHaveLength(0);
  });

  it('deduplicates normalized printers and cartridges', () => {
    const duplicate = { ...base, printerModel: 'demo print 1000', cartridgePartNumber: 'syn ink 01 bk' };
    expect(importRecords(database, [base, duplicate]).valid).toBe(true);
    expect(database.list('printers')).toHaveLength(1);
    expect(database.list('cartridges')).toHaveLength(1);
    expect(database.list('compatibility')).toHaveLength(1);
  });

  it('supports multiple genuine OEM cartridges per printer', () => {
    const second = { ...base, cartridgePartNumber: 'SYN-INK-01-C', cartridgeColor: 'cyan' };
    importRecords(database, [base, second]);
    expect(database.list('printers')).toHaveLength(1);
    expect(database.list('cartridges')).toHaveLength(2);
    expect(database.list('compatibility')).toHaveLength(2);
  });

  it('stores printers without replaceable cartridges and exports them', () => {
    const noCartridge = { printerManufacturer: 'Fictional Thermal Devices', printerModel: 'Label NC-1', hasReplaceableCartridges: false };
    expect(importRecords(database, [noCartridge]).valid).toBe(true);
    expect(database.list('cartridges')).toHaveLength(0);
    expect(exportRecords(database)[0]).toMatchObject({ hasReplaceableCartridges: false, printerModel: 'Label NC-1' });
  });

  it('rejects drums before any database writes', () => {
    const result = importRecords(database, [base, { ...base, cartridgeKind: 'drum' }]);
    expect(result.valid).toBe(false);
    expect(result.issues[0].message).toContain('drums');
    expect(database.list('printers')).toHaveLength(0);
  });

  it('supports manual create, edit, list, and delete', () => {
    const id = database.create('manufacturers', { name: 'Manual Example Inc' });
    expect(database.update('manufacturers', id, { name: 'Manual Example Company' })).toBe(true);
    expect(database.list('manufacturers')).toMatchObject([{ name: 'Manual Example Company', normalized_name: 'MANUAL EXAMPLE COMPANY' }]);
    expect(database.delete('manufacturers', id)).toBe(true);
  });

  it('applies compatibility evidence migrations idempotently', () => {
    database.initialize();
    const cartridgeColumns = database.db.prepare('PRAGMA table_info(cartridges)').all() as Array<{ name: string }>;
    const compatibilityColumns = database.db.prepare('PRAGMA table_info(compatibility)').all() as Array<{ name: string }>;
    expect(cartridgeColumns.map((column) => column.name)).toContain('yield_pages');
    expect(compatibilityColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'source_type', 'evidence_type', 'evidence', 'verified_at',
    ]));
  });
});
