import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CartridgeDatabase } from '../src/database.js';
import { printerDetails, searchPrinterPage, searchPrinters, webManufacturers, webStats } from '../src/web-data.js';

describe('web MVP read model', () => {
  let database: CartridgeDatabase;
  beforeEach(() => { database = new CartridgeDatabase(':memory:'); database.initialize(); database.writeImportRecord({ printerManufacturer:'Example OEM',printerModel:'Model 1000',hasReplaceableCartridges:true,cartridgeManufacturer:'Example OEM',cartridgePartNumber:'TN-100',cartridgeKind:'toner',sourceName:'Synthetic official source',sourceUrl:'https://example.invalid/model-1000',verificationStatus:'verified',region:'TEST',isGenuineOem:true,sourceType:'official-manufacturer',evidenceType:'explicit-compatibility',evidence:'Synthetic test evidence.',verifiedAt:'2026-10-09T00:00:00.000Z' }); });
  afterEach(()=>database.close());
  it('searches and exposes coverage',()=>{expect(searchPrinters(database,{query:'1000',manufacturer:'Example OEM'})).toEqual([expect.objectContaining({model_name:'Model 1000',verified_cartridge_count:1})]);expect(webManufacturers(database)).toEqual([expect.objectContaining({name:'Example OEM',printer_count:1})]);expect(webStats(database)).toMatchObject({totalPrinters:1,totalCartridges:1,totalVerifiedRelationships:1})});
  it('returns evidence-rich details',()=>{const rows=searchPrinters(database) as Array<{id:number}>;expect(printerDetails(database,rows[0].id)).toEqual(expect.objectContaining({model_name:'Model 1000',cartridges:[expect.objectContaining({part_number:'TN-100',verification_status:'verified',region:'TEST'})]}));expect(printerDetails(database,999)).toBeUndefined()});
  it('paginates search results with stable totals',()=>{for(let index=2;index<=12;index+=1)database.create('printers',{manufacturer_id:1,model_name:`Model ${index}`,has_replaceable_cartridges:1});const first=searchPrinterPage(database,{limit:10,offset:0});const second=searchPrinterPage(database,{limit:10,offset:10});expect(first).toMatchObject({total:12,page:1,pageSize:10,totalPages:2});expect(first.items).toHaveLength(10);expect(second).toMatchObject({total:12,page:2,totalPages:2});expect(second.items).toHaveLength(2)});
});
