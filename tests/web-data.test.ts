import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CartridgeDatabase } from '../src/database.js';
import { printerDetails, searchPrinters, webManufacturers, webStats } from '../src/web-data.js';

describe('web MVP read model', () => {
  let database: CartridgeDatabase;
  beforeEach(() => { database = new CartridgeDatabase(':memory:'); database.initialize(); database.writeImportRecord({ printerManufacturer:'Example OEM',printerModel:'Model 1000',hasReplaceableCartridges:true,cartridgeManufacturer:'Example OEM',cartridgePartNumber:'TN-100',cartridgeKind:'toner',sourceName:'Synthetic official source',sourceUrl:'https://example.invalid/model-1000',verificationStatus:'verified',region:'TEST',isGenuineOem:true,sourceType:'official-manufacturer',evidenceType:'explicit-compatibility',evidence:'Synthetic test evidence.',verifiedAt:'2026-10-09T00:00:00.000Z' }); });
  afterEach(()=>database.close());
  it('searches and exposes coverage',()=>{expect(searchPrinters(database,{query:'1000',manufacturer:'Example OEM'})).toEqual([expect.objectContaining({model_name:'Model 1000',verified_cartridge_count:1})]);expect(webManufacturers(database)).toEqual([expect.objectContaining({name:'Example OEM',printer_count:1})]);expect(webStats(database)).toMatchObject({totalPrinters:1,totalCartridges:1,totalVerifiedRelationships:1})});
  it('returns evidence-rich details',()=>{const rows=searchPrinters(database) as Array<{id:number}>;expect(printerDetails(database,rows[0].id)).toEqual(expect.objectContaining({model_name:'Model 1000',cartridges:[expect.objectContaining({part_number:'TN-100',verification_status:'verified',region:'TEST'})]}));expect(printerDetails(database,999)).toBeUndefined()});
});
