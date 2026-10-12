import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { CartridgeDatabase } from '../src/database.js';
import { importMultiSource, parseMultiSourceBytes, parsePrinterTonerDbPair } from '../src/multi-source-import.js';

const open: CartridgeDatabase[] = [];
afterEach(() => { for (const database of open.splice(0)) database.close(); });
function database(path = ':memory:'): CartridgeDatabase { const value = new CartridgeDatabase(path); value.initialize(); open.push(value); return value; }
const options = { sourceName: 'Synthetic test dataset', sourceCategory: 'open_dataset' as const, sourceReference: 'https://example.invalid/synthetic', region: 'ES' };

describe('multi-source imports (synthetic non-production fixtures)', () => {
  it('previews CSV without writes and imports printers, non-OEM supplies, relationships and evidence idempotently', () => {
    const db = database();
    const parsed = parseMultiSourceBytes('synthetic.csv', Buffer.from('printerManufacturer,printerModel,supplyManufacturer,supplyPartNumber,supplyType,supplyOrigin,region\nExample,Printer 1,Aftermarket Co,TN-X,toner,compatible,ES\nExample,Printer 2,,,,,ES'));
    const dry = importMultiSource(db, parsed, options, true);
    expect(dry).toMatchObject({ dryRun: true, createdPrinters: 2, createdSupplies: 1, createdRelationships: 1 });
    expect(db.list('printers')).toHaveLength(0);
    const first = importMultiSource(db, parsed, options);
    const second = importMultiSource(db, parsed, options);
    expect(first).toMatchObject({ createdPrinters: 2, createdSupplies: 1, createdRelationships: 1, addedSources: 1 });
    expect(second).toMatchObject({ createdPrinters: 0, createdSupplies: 0, createdRelationships: 0, addedSources: 0 });
    expect(db.list('compatibility')).toHaveLength(1);
    expect(db.list('compatibility_sources')).toHaveLength(1);
    expect(db.db.prepare('SELECT origin_type FROM cartridges').get()).toEqual({ origin_type: 'compatible' });
  });

  it('keeps one relationship while retaining multiple independent sources and preserves official verification', () => {
    const db = database();
    const parsed = parseMultiSourceBytes('synthetic.json', Buffer.from(JSON.stringify([{ printerManufacturer:'Example', printerModel:'P1', supplyManufacturer:'Example', supplyPartNumber:'T1', supplyType:'toner', supplyOrigin:'oem', reliabilityStatus:'official_verified', region:'ES' }])));
    importMultiSource(db, parsed, { ...options, sourceCategory:'official', sourceReference:'https://manufacturer.invalid/evidence', reliabilityStatus:'official_verified' });
    importMultiSource(db, parsed, { ...options, sourceReference:'https://catalog.invalid/evidence', reliabilityStatus:'third_party_reported' });
    expect(db.list('compatibility')).toHaveLength(1);
    expect(db.list('compatibility_sources')).toHaveLength(2);
    expect(db.db.prepare('SELECT reliability_status FROM compatibility').get()).toEqual({ reliability_status:'official_verified' });
  });

  it('parses PrinterTonerDB primary rows and only reliable reverse identifiers', () => {
    const primary = Buffer.from('Brand\tSeries\tModel\tDescription\nBrother\tHL-TEST\tABC-1\tFuzion compatible laser toner\nBrother\tEMPTY\t\tPrinter only\n');
    const reverse = Buffer.from('Model\tBrand\tSeries\tDescription\tPrinter Compatibility\nABC-2\tFuzion\tLaser\tCompatible toner\tHL_TEST\tUNKNOWN\n');
    const parsed = parsePrinterTonerDbPair(primary, reverse);
    expect(parsed.rows.some(row => row.printerModel === 'EMPTY' && !row.supplyPartNumber)).toBe(true);
    expect(parsed.rows.some(row => row.supplyPartNumber === 'ABC-2' && row.printerModel === 'HL-TEST')).toBe(true);
    expect(parsed.rows.every(row => row.reliabilityStatus === 'third_party_reported')).toBe(true);
  });

  it('creates a one-time backup before migrating a legacy database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'printerdb-migration-'));
    const path = join(directory, 'legacy.sqlite');
    const legacy = new Database(path);
    legacy.exec("CREATE TABLE cartridges(id INTEGER PRIMARY KEY, manufacturer_id INTEGER, part_number TEXT, normalized_part_number TEXT, kind TEXT CHECK(kind IN ('ink','toner')),color TEXT,yield_pages INTEGER,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE manufacturers(id INTEGER PRIMARY KEY,name TEXT,normalized_name TEXT); CREATE TABLE printers(id INTEGER PRIMARY KEY,manufacturer_id INTEGER,model_name TEXT,normalized_model_name TEXT,has_replaceable_cartridges INTEGER,notes TEXT); CREATE TABLE data_sources(id INTEGER PRIMARY KEY,name TEXT,url TEXT UNIQUE,source_category TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE compatibility(id INTEGER PRIMARY KEY,printer_id INTEGER,cartridge_id INTEGER,source_id INTEGER,source_url TEXT,verification_status TEXT,region TEXT,is_genuine_oem INTEGER,source_type TEXT,evidence_type TEXT,evidence TEXT,verified_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE printer_sources(id INTEGER PRIMARY KEY,printer_id INTEGER,source_id INTEGER,source_url TEXT,verification_status TEXT,region TEXT);");
    legacy.close();
    const db = database(path);
    expect(db.migrationBackupPath).toBe(`${path}.pre-multisource.sqlite`);
    expect(db.db.prepare('PRAGMA table_info(cartridges)').all()).toEqual(expect.arrayContaining([expect.objectContaining({ name:'origin_type' })]));
    db.close(); open.splice(open.indexOf(db),1); rmSync(directory,{recursive:true,force:true});
  });
});
