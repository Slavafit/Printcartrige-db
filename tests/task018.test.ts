import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { CartridgeDatabase } from '../src/database.js';
import { coverageDelta, coverageReport } from '../src/coverage.js';
import { importMultiSource, parseMultiSourceBytes, parsePrinterTonerDbPair } from '../src/multi-source-import.js';

const open:CartridgeDatabase[]=[];
const directories:string[]=[];
afterEach(()=>{for(const db of open.splice(0)) db.close(); for(const dir of directories.splice(0)) rmSync(dir,{recursive:true,force:true});});
function database(path=':memory:') { const db=new CartridgeDatabase(path);db.initialize();open.push(db);return db; }
function fixture() { return parseMultiSourceBytes('synthetic.json',readFileSync('tests/fixtures/task018-synthetic.json')); }
const options={sourceName:'Synthetic fixture only',sourceCategory:'open_dataset' as const,sourceReference:'https://example.invalid/synthetic-task018'};

it('normalizes HP/Canon/Epson spelling, keeps regional variants and source evidence, rejects ambiguous parts',()=>{
  const db=database(); const parsed=fixture();
  expect(parsed.errors).toEqual([expect.objectContaining({row:10,message:expect.stringContaining('Ambiguous')})]);
  const before=coverageReport(db);
  const dry=importMultiSource(db,parsed,options,true);
  expect(db.list('data_sources')).toHaveLength(0);
  expect(coverageReport(db)).toEqual(before);
  const first=importMultiSource(db,parsed,options);
  expect(first).toMatchObject({createdPrinters:4,createdSupplies:4,createdRelationships:5,addedSources:8});
  expect(dry.createdRelationships).toBe(first.createdRelationships);
  expect(db.db.prepare("SELECT kind,supply_form,color,origin_type FROM cartridges WHERE part_number='SYN-E18'").get()).toEqual({kind:'other',supply_form:'ink_bottle',color:'cyan',origin_type:'unknown'});
  expect(importMultiSource(db,parsed,options)).toMatchObject({createdPrinters:0,createdSupplies:0,createdRelationships:0,addedSources:0});
  const after=coverageReport(db);
  expect(after.total).toMatchObject({totalPrinters:4,printersWithSupplies:4,coveragePercent:100,totalRelationships:5,verifiedRelationships:0,thirdPartyRelationships:5});
  expect(after.manufacturers.CANON.totalPrinters).toBe(2);
  expect(coverageDelta(before,after).total.printersWithSupplies).toBe(4);
  expect(after.modelVariants).toHaveLength(3);
});

it('preserves official edges, source URLs and user notes when adding independent third-party evidence',()=>{
  const db=database();const parsed=fixture();parsed.rows=[parsed.rows[0]];
  importMultiSource(db,parsed,{...options,sourceCategory:'official',sourceReference:'https://oem.invalid/synthetic',reliabilityStatus:'official_verified'});
  db.db.exec("UPDATE compatibility SET is_genuine_oem=1,evidence_type='explicit-compatibility',evidence='Synthetic official fixture'; UPDATE cartridges SET notes='User note',origin_type='oem'");
  const original=db.list('compatibility');
  importMultiSource(db,parsed,options);
  expect(db.list('compatibility')).toEqual(original);
  expect(db.list('compatibility_sources')).toHaveLength(2);
  expect(db.db.prepare('SELECT notes,origin_type FROM cartridges').get()).toEqual({notes:'User note',origin_type:'oem'});
  expect(coverageReport(db).total).toMatchObject({totalRelationships:1,verifiedRelationships:1,thirdPartyRelationships:1});
});

it('never promotes a third-party payload to officially verified, even on dry-run',()=>{
  const db=database();const parsed=fixture();parsed.rows[0].reliabilityStatus='official_verified';
  expect(()=>importMultiSource(db,parsed,options,true)).toThrow('Third-party');
  expect(()=>importMultiSource(db,parsed,options)).toThrow('Third-party');
  expect(db.list('data_sources')).toHaveLength(0);
});

it('rolls back the entire import including sources after a failure beyond a batch boundary',()=>{
  const db=database();const parsed=fixture();parsed.rows[3].supplyOrigin='invalid' as never;
  expect(()=>importMultiSource(db,parsed,options,false,1)).toThrow();
  expect(db.list('printers')).toHaveLength(0);expect(db.list('data_sources')).toHaveLength(0);
  expect(()=>importMultiSource(db,fixture(),options,false,0)).toThrow('batch size');
});

it('excludes rejected/conflicting edges, does not multiply counts with multiple sources, includes uncovered printers',()=>{
  const db=database();const parsed=fixture();importMultiSource(db,parsed,options);
  importMultiSource(db,parsed,{...options,sourceReference:'https://second.invalid/synthetic'});
  db.db.exec("UPDATE compatibility SET verification_status='rejected' WHERE cartridge_id IN (SELECT id FROM cartridges WHERE part_number LIKE 'SYN-18%'); UPDATE compatibility SET reliability_status='conflicting' WHERE cartridge_id IN (SELECT id FROM cartridges WHERE supply_form='ink_bottle')");
  const report=coverageReport(db);
  importMultiSource(db,parsed,{...options,sourceReference:'https://third.invalid/synthetic'});
  expect(coverageReport(db)).toEqual(report);
  expect(report.total).toMatchObject({totalPrinters:4,printersWithSupplies:2,printersWithoutSupplies:2,coveragePercent:50,totalRelationships:2});
  expect(report.withoutSupplies).toHaveLength(2);
  db.initialize();
  expect(coverageReport(db)).toEqual(report);
});

it('diagnoses every unmatched reverse identifier and does not merge competing supply makers',()=>{
  const primary=Buffer.from('Brand\tSeries\tModel\tDescription\nHP\tSynthetic X-18\tSYN18\tHP Black Toner\nHP\tSynthetic X-18\tSYN18\tFuzion compatible toner\n');
  const reverse=Buffer.from('Model\tBrand\tSeries\tDescription\tPrinter Compatibility\nSYN19\tHP\tSynthetic X-18\tHP Black Toner\tsynthetic_x_18\tnot_known\n');
  const parsed=parsePrinterTonerDbPair(primary,reverse);
  expect(parsed.rows).toHaveLength(3);
  expect(parsed.warnings.some(w=>w.message.includes('not_known'))).toBe(true);
  expect(parsed.rows[0].supplyOrigin).toBe('unknown');
});

it('adds bottle metadata with a backup to an existing SQLite and keeps read-only dry runs byte-identical',()=>{
  const dir=mkdtempSync(join(tmpdir(),'task018-'));directories.push(dir);const path=join(dir,'existing.sqlite');
  const db=database(path);importMultiSource(db,fixture(),options);
  const saved=db.list('compatibility');
  db.db.exec('ALTER TABLE cartridges DROP COLUMN supply_form');db.close();open.splice(open.indexOf(db),1);
  const bytes=readFileSync(path);
  const readOnly=new CartridgeDatabase(path,{readonly:true,fileMustExist:true});
  importMultiSource(readOnly,fixture(),options,true);readOnly.close();
  expect(readFileSync(path)).toEqual(bytes);
  const migrated=database(path);
  expect(migrated.migrationBackupPath).toBe(`${path}.pre-supply-form.sqlite`);
  expect(migrated.list('compatibility')).toEqual(saved);
  importMultiSource(migrated,fixture(),options);
  expect(migrated.db.prepare("SELECT supply_form FROM cartridges WHERE part_number='SYN-E18'").get()).toEqual({supply_form:'ink_bottle'});
  const backup=new Database(`${path}.pre-supply-form.sqlite`,{readonly:true});
  expect(backup.prepare('SELECT count(*) n FROM compatibility').get()).toEqual({n:5});backup.close();
  expect(migrated.db.pragma('foreign_key_check')).toEqual([]);
  // Reimport may update third-party timestamps; initialization must preserve its resulting state.
  const afterReimport=migrated.list('compatibility');
  migrated.initialize();expect(migrated.list('compatibility')).toEqual(afterReimport);
});
