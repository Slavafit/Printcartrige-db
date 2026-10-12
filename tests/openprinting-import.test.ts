import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CartridgeDatabase } from '../src/database.js';
import { canonicalOpenPrintingManufacturer, importOpenPrinting } from '../src/openprinting-import.js';

const databases: CartridgeDatabase[] = [];
const directories: string[] = [];
function db(): CartridgeDatabase { const value = new CartridgeDatabase(':memory:'); value.initialize(); databases.push(value); return value; }
function fixtures(): string { return join(process.cwd(), 'tests', 'fixtures', 'openprinting'); }
afterEach(() => { databases.splice(0).forEach(value => value.close()); directories.splice(0).forEach(value => rmSync(value, { recursive: true, force: true })); });

describe('OpenPrinting adapter (synthetic non-production fixtures)', () => {
  it('canonicalizes priority manufacturer spelling variants', () => {
    expect(canonicalOpenPrintingManufacturer('Hewlett Packard')).toBe('HP');
    expect(canonicalOpenPrintingManufacturer('Seiko Epson Corporation')).toBe('Epson');
    expect(canonicalOpenPrintingManufacturer('Canon Inc.')).toBe('Canon');
  });

  it('previews priority manufacturers without changing the database', () => {
    const database = db();
    const report = importOpenPrinting(database, fixtures(), {}, true);
    expect(report).toMatchObject({ filesScanned: 5, targetedFiles: 4, validRecords: 4, uniqueModels: 3, duplicateInputModels: 1, insertedModels: 3 });
    expect(database.list('printers')).toHaveLength(0);
    expect(database.list('data_sources')).toHaveLength(0);
    expect(database.list('printer_characteristics')).toHaveLength(0);
  });

  it('imports characteristics and provenance idempotently without creating cartridge relationships', () => {
    const database = db();
    const first = importOpenPrinting(database, fixtures(), { sourceRevision: 'synthetic-test' });
    const second = importOpenPrinting(database, fixtures(), { sourceRevision: 'synthetic-test' });
    expect(first).toMatchObject({ insertedModels: 3, existingModels: 0, sourceLinksAdded: 3, characteristicsAdded: 3 });
    expect(second).toMatchObject({ insertedModels: 0, existingModels: 3, sourceLinksAdded: 0, characteristicsAdded: 0 });
    expect(database.list('printers')).toHaveLength(3);
    expect(database.list('printer_sources')).toHaveLength(3);
    expect(database.list('printer_characteristics')).toHaveLength(3);
    expect(database.list('cartridges')).toHaveLength(0);
    expect(database.list('compatibility')).toHaveLength(0);
    expect(database.db.prepare("SELECT mechanism,color_supported,max_resolution_x,max_resolution_y,origin_type FROM printer_characteristics WHERE raw_make='Hewlett-Packard'").get()).toEqual({ mechanism: 'laser', color_supported: 1, max_resolution_x: 1200, max_resolution_y: 600, origin_type: 'open_dataset' });
    expect(database.db.prepare('SELECT source_category FROM data_sources').get()).toEqual({ source_category: 'open_dataset' });
  });

  it('reuses an aliased existing model and preserves official compatibility unchanged', () => {
    const database = db();
    const manufacturer = database.create('manufacturers', { name: 'Hewlett Packard' });
    const printer = database.create('printers', { manufacturer_id: manufacturer, model_name: 'Synthetic Laser 100', has_replaceable_cartridges: 1 });
    const cartridge = database.create('cartridges', { manufacturer_id: manufacturer, part_number: 'TEST-1', kind: 'toner', origin_type: 'oem' });
    const source = database.create('data_sources', { name: 'Synthetic official evidence', url: 'https://example.invalid/official', source_category: 'official' });
    database.create('compatibility', { printer_id: printer, cartridge_id: cartridge, source_id: source, source_url: 'https://example.invalid/official', verification_status: 'verified', reliability_status: 'official_verified', region: 'ES', is_genuine_oem: 1 });
    const before = database.list('compatibility');
    const report = importOpenPrinting(database, fixtures(), { sourceRevision: 'synthetic-test' });
    expect(report).toMatchObject({ insertedModels: 2, existingModels: 1 });
    expect(database.list('compatibility')).toEqual(before);
    expect(database.list('manufacturers')).toHaveLength(3);
  });

  it('reports malformed XML and imports other manufacturers only when requested', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openprinting-fixture-')); directories.push(directory);
    cpSync(fixtures(), directory, { recursive: true });
    writeFileSync(join(directory, 'invalid.xml'), '<printer><make>HP</make>');
    const database = db();
    const report = importOpenPrinting(database, directory, { allManufacturers: true }, true);
    expect(report.uniqueModels).toBe(4);
    expect(report.rejected).toEqual([expect.objectContaining({ file: 'invalid.xml', reason: expect.stringContaining('invalid XML') })]);
  });
});
