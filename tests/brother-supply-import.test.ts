import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareBrotherSupplyImport } from '../src/brother-supply-import.js';
import { CartridgeDatabase } from '../src/database.js';
import { importMultiSource } from '../src/multi-source-import.js';

const open: CartridgeDatabase[] = [];
afterEach(() => { for (const database of open.splice(0)) database.close(); });
const fixture = (name: string): unknown => JSON.parse(readFileSync(`tests/fixtures/${name}`, 'utf8'));

describe('Brother unified supply preparation (synthetic non-production fixtures)', () => {
  it('keeps bottles separate, excludes candidates, and imports official evidence idempotently', () => {
    const prepared = prepareBrotherSupplyImport(
      fixture('brother-supplies-synthetic.json') as Parameters<typeof prepareBrotherSupplyImport>[0],
      fixture('brother-audit-synthetic.json') as Parameters<typeof prepareBrotherSupplyImport>[1],
    );
    expect(prepared.summary).toEqual({ inputRelationships: 4, acceptedRelationships: 3, excludedRelationships: 1, uniquePrinters: 3, uniqueSupplies: 3, cartridgeRelationships: 2, bottleRelationships: 1 });
    expect(prepared.parsed.errors).toEqual([]);
    expect(prepared.parsed.warnings).toHaveLength(1);
    expect(prepared.parsed.rows).toContainEqual(expect.objectContaining({ supplyPartNumber: 'BTD180BK', supplyType: 'ink_bottle', color: 'black', yieldPages: 7500, reliabilityStatus: 'official_verified' }));

    const database = new CartridgeDatabase(':memory:'); database.initialize(); open.push(database);
    const options = { sourceName: 'Brother España official pages', sourceCategory: 'official' as const, sourceReference: 'https://store.brother.es/', region: 'ES' };
    const before = database.db.serialize();
    expect(importMultiSource(database, prepared.parsed, options, true)).toMatchObject({ createdPrinters: 3, createdSupplies: 3, createdRelationships: 3 });
    expect(database.db.serialize()).toEqual(before);
    expect(importMultiSource(database, prepared.parsed, options)).toMatchObject({ createdPrinters: 3, createdSupplies: 3, createdRelationships: 3 });
    expect(importMultiSource(database, prepared.parsed, options)).toMatchObject({ createdPrinters: 0, createdSupplies: 0, createdRelationships: 0 });
    expect(database.db.prepare("SELECT kind,supply_form,origin_type,yield_pages FROM cartridges WHERE part_number='BTD180BK'").get()).toEqual({ kind: 'other', supply_form: 'ink_bottle', origin_type: 'oem', yield_pages: 7500 });
    expect(database.db.prepare("SELECT COUNT(*) count FROM compatibility WHERE reliability_status='official_verified'").get()).toEqual({ count: 3 });
    expect(database.db.prepare("SELECT COUNT(*) count FROM compatibility_sources WHERE evidence_type='explicit-compatibility' AND evidence IS NOT NULL").get()).toEqual({ count: 3 });
  });
});
describe('committed Brother unified supply package (read-only)', () => {
  it('is reproducible from the completed audit and contains only accepted rows', () => {
    const prepared = prepareBrotherSupplyImport(
      JSON.parse(readFileSync('data/brother-compatibility.json', 'utf8')) as Parameters<typeof prepareBrotherSupplyImport>[0],
      JSON.parse(readFileSync('data/brother-audit.json', 'utf8')) as Parameters<typeof prepareBrotherSupplyImport>[1],
    );
    const committed = JSON.parse(readFileSync('data/official/brother/brother-supplies.json', 'utf8')) as unknown[];
    expect(prepared.summary).toEqual({ inputRelationships: 1611, acceptedRelationships: 1606, excludedRelationships: 5, uniquePrinters: 292, uniqueSupplies: 253, cartridgeRelationships: 1598, bottleRelationships: 8 });
    expect(prepared.parsed.errors).toEqual([]);
    expect(prepared.parsed.warnings).toHaveLength(5);
    expect(committed).toEqual(prepared.parsed.rows);
    const database = new CartridgeDatabase(':memory:'); database.initialize(); open.push(database);
    const options = { sourceName: 'Brother España official pages', sourceCategory: 'official' as const, sourceReference: 'https://store.brother.es/', region: 'ES' };
    expect(importMultiSource(database, prepared.parsed, options)).toMatchObject({ createdPrinters: 292, createdSupplies: 253, createdRelationships: 1606 });
    expect(importMultiSource(database, prepared.parsed, options)).toMatchObject({ createdPrinters: 0, createdSupplies: 0, createdRelationships: 0 });
  });
});
