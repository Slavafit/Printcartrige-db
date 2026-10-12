import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CartridgeDatabase } from '../src/database.js';
import { backupDatabase, commitImport, createCartridge, createCompatibility, createPrinter, exportWorkbook, parseImportFile, previewImport } from '../src/desktop-data.js';

const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true})});
function setup(){const directory=mkdtempSync(join(tmpdir(),'printerdb-desktop-'));directories.push(directory);const path=join(directory,'catalog.sqlite');const database=new CartridgeDatabase(path);database.initialize();return{database,directory,path}}

describe('desktop data operations',()=>{
 it('previews and commits CSV while preserving a non-official source',()=>{const{database}=setup();const csv='printerManufacturer,printerModel,hasReplaceableCartridges,cartridgeManufacturer,cartridgePartNumber,cartridgeKind\nSynthetic,S-100,true,Synthetic,T-1,toner\nSynthetic,S-200,false,,,\n';const rows=parseImportFile('sample.csv',Buffer.from(csv));const preview=previewImport(database,rows);expect(preview).toMatchObject({valid:2,duplicates:0,errors:[]});expect(commitImport(database,preview,{name:'Synthetic test catalog',category:'third-party'})).toEqual({imported:2});expect(database.list('printers')).toHaveLength(2);expect(database.list('cartridges')).toHaveLength(1);expect(database.list('compatibility')).toMatchObject([{verification_status:'unverified'}]);expect(database.list('data_sources')).toMatchObject([{source_category:'third_party'}]);database.close()});
 it('rejects duplicates for manual records and supports many-to-many links',()=>{const{database}=setup();const printer1=createPrinter(database,{manufacturer:'Synthetic',model:'S-1'});const printer2=createPrinter(database,{manufacturer:'Synthetic',model:'S-2'});expect(()=>createPrinter(database,{manufacturer:'Synthetic',model:'S-1'})).toThrow(/ya existe/);const cartridge=createCartridge(database,{manufacturer:'Synthetic',partNumber:'T-1',kind:'toner'});createCompatibility(database,{printerId:printer1,cartridgeId:cartridge});createCompatibility(database,{printerId:printer2,cartridgeId:cartridge});expect(database.list('compatibility')).toHaveLength(2);expect(database.list('compatibility')).toMatchObject([{verification_status:'unverified'},{verification_status:'unverified'}]);database.close()});
 it('exports XLSX and creates a consistent backup',async()=>{const{database,directory}=setup();createPrinter(database,{manufacturer:'Synthetic',model:'S-1'});expect(exportWorkbook(database).subarray(0,2).toString()).toBe('PK');const target=join(directory,'backups','copy.sqlite');await backupDatabase(database,target);const copy=new CartridgeDatabase(target,{readonly:true,fileMustExist:true});expect(copy.list('printers')).toHaveLength(1);copy.close();database.close();expect(readFileSync(target).length).toBeGreaterThan(0)});
});
