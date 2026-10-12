import { basename, extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import type { CartridgeDatabase } from './database.js';
import { normalizeCartridgePartNumber, normalizeManufacturerName, normalizePrinterModel } from './normalize.js';

export type SourceCategory = 'official' | 'third_party' | 'open_dataset' | 'manual' | 'unknown';
export type ReliabilityStatus = 'official_verified' | 'third_party_reported' | 'unverified' | 'conflicting';
export type SupplyOrigin = 'oem' | 'compatible' | 'remanufactured' | 'unknown';
export type SupplyType = 'ink' | 'toner' | 'drum' | 'waste_toner' | 'belt' | 'other' | 'unknown';

export interface MultiSourceRow {
  printerManufacturer: string;
  printerModel: string;
  supplyManufacturer?: string;
  supplyPartNumber?: string;
  supplyType?: SupplyType;
  supplyOrigin?: SupplyOrigin;
  description?: string;
  reliabilityStatus: ReliabilityStatus;
  region: string;
  note?: string;
  rawPrinterModel: string;
  rawSupplyPartNumber: string;
}

export interface MultiSourceOptions {
  sourceName: string;
  sourceCategory: SourceCategory;
  sourceReference: string;
  region?: string;
  reliabilityStatus?: ReliabilityStatus;
}

export interface ParsedMultiSource {
  format: 'generic' | 'printertonerdb-primary' | 'printertonerdb-reverse';
  rows: MultiSourceRow[];
  errors: Array<{ row: number; message: string }>;
  warnings: Array<{ row: number; message: string }>;
  mapping: Record<string, string>;
}

export interface MultiSourceReport {
  dryRun: boolean;
  processed: number;
  valid: number;
  rejected: number;
  warnings: number;
  createdPrinters: number;
  createdSupplies: number;
  createdRelationships: number;
  addedSources: number;
  duplicatePrinters: number;
  duplicateSupplies: number;
  duplicateRelationships: number;
  errors: ParsedMultiSource['errors'];
  review: ParsedMultiSource['warnings'];
}

export async function parseMultiSourceFile(path: string, database?: CartridgeDatabase): Promise<ParsedMultiSource> {
  return parseMultiSourceBytes(basename(path), await readFile(path), database);
}

export function parseMultiSourceBytes(fileName: string, bytes: Buffer, database?: CartridgeDatabase): ParsedMultiSource {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) return parseGenericJson(bytes);
  if (lower.includes('printers2toners')) return parsePrinterTonerPrimary(bytes);
  if (lower.includes('toner2printers')) return parsePrinterTonerReverse(bytes, database);
  const extension = extname(lower);
  if (['.xlsx', '.xls'].includes(extension)) return parseGenericRows(readWorkbook(bytes));
  return parseGenericRows(readDelimited(bytes));
}

export function parsePrinterTonerDbPair(primaryBytes:Buffer,reverseBytes:Buffer,database?:CartridgeDatabase):ParsedMultiSource{const primary=parsePrinterTonerPrimary(primaryBytes);const reverse=parsePrinterTonerReverse(reverseBytes,database,primary.rows);return{format:'printertonerdb-primary',rows:dedupeRows([...primary.rows,...reverse.rows]),errors:[...primary.errors,...reverse.errors],warnings:[...primary.warnings,...reverse.warnings],mapping:{...primary.mapping,...reverse.mapping}};}

export function importMultiSource(database: CartridgeDatabase, parsed: ParsedMultiSource, options: MultiSourceOptions, dryRun = false, batchSize = 500): MultiSourceReport {
  if (!['official','third_party','open_dataset','manual','unknown'].includes(options.sourceCategory)) throw new Error('Categoría de fuente no válida');
  if (options.reliabilityStatus && !['official_verified','third_party_reported','unverified','conflicting'].includes(options.reliabilityStatus)) throw new Error('Estado de fiabilidad no válido');
  const report: MultiSourceReport = {
    dryRun, processed: parsed.rows.length + parsed.errors.length, valid: parsed.rows.length,
    rejected: parsed.errors.length, warnings: parsed.warnings.length, createdPrinters: 0,
    createdSupplies: 0, createdRelationships: 0, addedSources: 0, duplicatePrinters: 0,
    duplicateSupplies: 0, duplicateRelationships: 0, errors: parsed.errors, review: parsed.warnings,
  };
  const sourceReference = options.sourceReference.trim() || 'unknown://import';
  const existingSource = database.db.prepare('SELECT id FROM data_sources WHERE url=?').get(sourceReference) as {id:number}|undefined;
  const sourceId = dryRun ? existingSource?.id : upsertSource(database, options.sourceName, sourceReference, options.sourceCategory);
  const seenPrinters=new Set<string>(); const seenSupplies=new Set<string>(); const seenRelationships=new Set<string>();

  const apply = (row: MultiSourceRow): void => {
    const printerKey=`${normalizeManufacturerName(row.printerManufacturer)}|${normalizePrinterModel(row.printerModel)}`;
    const manufacturerId = findManufacturer(database, row.printerManufacturer);
    const printer = findPrinter(database, row.printerManufacturer, row.printerModel);
    if (printer||seenPrinters.has(printerKey)) report.duplicatePrinters += 1; else report.createdPrinters += 1;
    seenPrinters.add(printerKey);
    const printerId = printer?.id ?? (dryRun ? -1 : upsertPrinter(database, manufacturerId ?? upsertManufacturer(database,row.printerManufacturer), row.printerModel));
    if (!row.supplyPartNumber) {
      if (!dryRun) addPrinterSource(database, printerId, sourceId!, sourceReference, options.region ?? row.region);
      return;
    }

    const supplyManufacturer = row.supplyManufacturer || row.printerManufacturer;
    const supplyKey=`${normalizeManufacturerName(supplyManufacturer)}|${normalizeCartridgePartNumber(row.supplyPartNumber)}`;
    const supply = findSupply(database, supplyManufacturer, row.supplyPartNumber);
    if (supply||seenSupplies.has(supplyKey)) report.duplicateSupplies += 1; else report.createdSupplies += 1;
    seenSupplies.add(supplyKey);
    const supplyId = supply?.id ?? (dryRun ? -1 : upsertSupply(database, upsertManufacturer(database,supplyManufacturer), row));
    const relationship = printerId > 0 && supplyId > 0 ? database.db.prepare('SELECT id FROM compatibility WHERE printer_id=? AND cartridge_id=?').get(printerId,supplyId) as {id:number}|undefined : undefined;
    const relationshipKey=`${printerKey}|${supplyKey}`;
    if (relationship||seenRelationships.has(relationshipKey)) report.duplicateRelationships += 1; else report.createdRelationships += 1;
    seenRelationships.add(relationshipKey);
    if (dryRun) return;
    const reliability = options.reliabilityStatus ?? row.reliabilityStatus;
    const compatibilityId = upsertRelationship(database, printerId, supplyId, sourceId!, sourceReference, reliability, options.region ?? row.region, row.supplyOrigin ?? 'unknown', row.description);
    const added = addCompatibilitySource(database, compatibilityId, sourceId!, sourceReference, row, reliability, options.region ?? row.region);
    if (added) report.addedSources += 1;
  };

  if (dryRun) parsed.rows.forEach(apply);
  else for (let offset=0; offset<parsed.rows.length; offset+=batchSize) database.transaction(()=>parsed.rows.slice(offset,offset+batchSize).forEach(apply));
  return report;
}

function parsePrinterTonerPrimary(bytes: Buffer): ParsedMultiSource {
  const raw = readDelimited(bytes);
  const rows: MultiSourceRow[]=[]; const errors:ParsedMultiSource['errors']=[]; const warnings:ParsedMultiSource['warnings']=[];
  raw.forEach((value,index)=>{
    const brand=text(value.Brand), printer=text(value.Series), part=text(value.Model), description=text(value.Description);
    if(!brand||!printer){errors.push({row:index+2,message:'Falta Brand o Series'});return;}
    const classified=classifySupply(description,brand);
    if(part&&classified.type==='unknown') warnings.push({row:index+2,message:`Tipo de consumible no determinado: ${part}`});
    if(part&&classified.origin==='unknown') warnings.push({row:index+2,message:`Origen OEM/compatible no determinado: ${part}`});
    rows.push({printerManufacturer:brand,printerModel:printer,supplyManufacturer:part?classified.manufacturer:undefined,supplyPartNumber:part||undefined,supplyType:part?classified.type:undefined,supplyOrigin:part?classified.origin:undefined,description:description||undefined,reliabilityStatus:'third_party_reported',region:'unknown',rawPrinterModel:printer,rawSupplyPartNumber:part});
  });
  return {format:'printertonerdb-primary',rows,errors,warnings,mapping:{Brand:'printerManufacturer',Series:'printerModel',Model:'supplyPartNumber',Description:'description'}};
}

function parsePrinterTonerReverse(bytes: Buffer, database?: CartridgeDatabase, extraRows:MultiSourceRow[]=[]): ParsedMultiSource {
  const lines=parse(decode(bytes),{delimiter:'\t',skip_empty_lines:true,relax_column_count:true,relax_quotes:true,bom:true}) as string[][];
  const rows:MultiSourceRow[]=[]; const errors:ParsedMultiSource['errors']=[]; const warnings:ParsedMultiSource['warnings']=[];
  const aliases=new Map<string,{manufacturer:string;model:string}>();
  const ambiguous=new Set<string>();const register=(item:{manufacturer:string;model:string})=>{const key=sourceKey(item.model);const prior=aliases.get(key);if(prior&&(normalizeManufacturerName(prior.manufacturer)!==normalizeManufacturerName(item.manufacturer)||normalizePrinterModel(prior.model)!==normalizePrinterModel(item.model))){aliases.delete(key);ambiguous.add(key);return;}if(!ambiguous.has(key))aliases.set(key,item);};
  if(database){const known=database.db.prepare('SELECT m.name manufacturer,p.model_name model FROM printers p JOIN manufacturers m ON m.id=p.manufacturer_id').all() as Array<{manufacturer:string;model:string}>;for(const item of known)register(item);}
  for(const row of extraRows)register({manufacturer:row.printerManufacturer,model:row.printerModel});
  lines.slice(1).forEach((columns,index)=>{
    const [part,brand,series,description,...ids]=columns.map(text); if(!part||!brand){errors.push({row:index+2,message:'Falta Model o Brand'});return;}
    const classified=classifySupply(description,brand); let matched=0;
    for(const id of ids.filter(Boolean)){const printer=aliases.get(sourceKey(id));if(!printer)continue;matched+=1;rows.push({printerManufacturer:printer.manufacturer,printerModel:printer.model,supplyManufacturer:classified.manufacturer,supplyPartNumber:part,supplyType:classified.type,supplyOrigin:classified.origin,description:description||undefined,reliabilityStatus:'third_party_reported',region:'unknown',rawPrinterModel:id,rawSupplyPartNumber:part});}
    if(!matched)warnings.push({row:index+2,message:`No se pudo vincular de forma fiable ningún identificador para ${part}`});
    if(!ids.length&&series){const printer=aliases.get(sourceKey(series));if(printer)rows.push({printerManufacturer:printer.manufacturer,printerModel:printer.model,supplyManufacturer:classified.manufacturer,supplyPartNumber:part,supplyType:classified.type,supplyOrigin:classified.origin,description,reliabilityStatus:'third_party_reported',region:'unknown',rawPrinterModel:series,rawSupplyPartNumber:part});}
  });
  return {format:'printertonerdb-reverse',rows:dedupeRows(rows),errors,warnings,mapping:{Model:'supplyPartNumber',Brand:'supplyManufacturer','Printer Compatibility':'matched existing printer'}};
}

function parseGenericJson(bytes:Buffer):ParsedMultiSource { const value=JSON.parse(decode(bytes)) as unknown;if(!Array.isArray(value))throw new Error('La raíz JSON debe ser una lista');return parseGenericRows(value as Array<Record<string,unknown>>); }
function parseGenericRows(raw:Array<Record<string,unknown>>):ParsedMultiSource {
  const rows:MultiSourceRow[]=[];const errors:ParsedMultiSource['errors']=[];const warnings:ParsedMultiSource['warnings']=[];const mapping:Record<string,string>={};
  raw.forEach((value,index)=>{const get=(field:string,aliases:string[])=>{for(const [key,v] of Object.entries(value)){if(aliases.includes(headerKey(key))){mapping[key]=field;return text(v)}}return ''};
    const printerManufacturer=get('printerManufacturer',['printermanufacturer','manufacturer','brand','fabricante']);const printerModel=get('printerModel',['printermodel','model','series','modelo']);
    if(!printerManufacturer||!printerModel){errors.push({row:index+2,message:'Falta el fabricante o el modelo de impresora'});return;}
    const part=get('supplyPartNumber',['supplypartnumber','cartridgepartnumber','partnumber','toner','sku','referencia']);const description=get('description',['description','descripcion','notes','notas']);
    const explicitType=get('supplyType',['supplytype','cartridgekind','kind','producttype','tipo']) as SupplyType;const explicitOrigin=get('supplyOrigin',['supplyorigin','origintype','origin','origen']) as SupplyOrigin;const classified=classifySupply(description,printerManufacturer);
    const type=(['ink','toner','drum','waste_toner','belt','other','unknown'].includes(explicitType)?explicitType:classified.type);const origin=(['oem','compatible','remanufactured','unknown'].includes(explicitOrigin)?explicitOrigin:classified.origin);
    if(part&&type==='unknown')warnings.push({row:index+2,message:`Tipo de consumible no determinado: ${part}`});
    rows.push({printerManufacturer,printerModel,supplyManufacturer:get('supplyManufacturer',['supplymanufacturer','cartridgemanufacturer'])||classified.manufacturer,supplyPartNumber:part||undefined,supplyType:part?type:undefined,supplyOrigin:part?origin:undefined,description:description||undefined,reliabilityStatus:(get('reliabilityStatus',['reliabilitystatus','verificationstatus']) as ReliabilityStatus)||'unverified',region:get('region',['region'])||'unknown',note:get('note',['note','notes','notas'])||undefined,rawPrinterModel:printerModel,rawSupplyPartNumber:part});
  });return{format:'generic',rows,errors,warnings,mapping};
}

function readWorkbook(bytes:Buffer):Array<Record<string,unknown>>{const book=XLSX.read(bytes,{type:'buffer'});const sheet=book.Sheets[book.SheetNames[0]];if(!sheet)throw new Error('El archivo no contiene hojas');return XLSX.utils.sheet_to_json(sheet,{defval:''});}
function readDelimited(bytes:Buffer):Array<Record<string,unknown>>{const content=decode(bytes);const first=content.split(/\r?\n/,1)[0]??'';const delimiters=['\t',',',';','|'];const delimiter=delimiters.sort((a,b)=>first.split(b).length-first.split(a).length)[0];return parse(content,{columns:true,delimiter,skip_empty_lines:true,trim:true,bom:true,relax_column_count:true,relax_quotes:true}) as Array<Record<string,unknown>>;}
function decode(bytes:Buffer):string{if(bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder('utf-16le').decode(bytes.subarray(2));const utf8=new TextDecoder('utf-8').decode(bytes);const replacements=(utf8.match(/�/g)??[]).length;return replacements>2?new TextDecoder('windows-1252').decode(bytes):utf8.replace(/^\uFEFF/,'');}
function classifySupply(description:string,brand:string):{type:SupplyType;origin:SupplyOrigin;manufacturer:string}{const lower=description.toLowerCase();let type:SupplyType='unknown';if(/waste toner|waste container/.test(lower))type='waste_toner';else if(/drum|imaging unit|photoconductor/.test(lower))type='drum';else if(/transfer belt|belt unit/.test(lower))type='belt';else if(/ink cartridge|inkjet cartridge/.test(lower))type='ink';else if(/toner|laser cartridge/.test(lower))type='toner';else if(/cartridge|ribbon/.test(lower))type='other';let origin:SupplyOrigin='unknown';if(/remanufactured|reman\b|reconditioned/.test(lower))origin='remanufactured';else if(/compatible|replacement|fuzion/.test(lower))origin='compatible';else if(/\bgenuine\b|\boem\b|\boriginal\b/.test(lower))origin='oem';const first=text(description).split(/\s+/)[0];const manufacturer=first&&/^[\p{L}\d.-]+$/u.test(first)?first:brand;return{type,origin,manufacturer};}
function dedupeRows(rows:MultiSourceRow[]):MultiSourceRow[]{const seen=new Set<string>();return rows.filter(row=>{const key=`${normalizeManufacturerName(row.printerManufacturer)}|${normalizePrinterModel(row.printerModel)}|${normalizeCartridgePartNumber(row.supplyPartNumber??'')}`;if(seen.has(key))return false;seen.add(key);return true;});}
function sourceKey(value:string):string{return text(value).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');}
function headerKey(value:string):string{return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');}
function text(value:unknown):string{return String(value??'').trim();}

function findManufacturer(db:CartridgeDatabase,name:string):number|undefined{return(db.db.prepare('SELECT id FROM manufacturers WHERE normalized_name=?').get(normalizeManufacturerName(name))as{id:number}|undefined)?.id;}
function upsertManufacturer(db:CartridgeDatabase,name:string):number{db.db.prepare('INSERT INTO manufacturers(name,normalized_name) VALUES(?,?) ON CONFLICT(normalized_name) DO NOTHING').run(name,normalizeManufacturerName(name));return findManufacturer(db,name)!;}
function findPrinter(db:CartridgeDatabase,manufacturer:string,model:string):{id:number}|undefined{return db.db.prepare('SELECT p.id FROM printers p JOIN manufacturers m ON m.id=p.manufacturer_id WHERE m.normalized_name=? AND p.normalized_model_name=?').get(normalizeManufacturerName(manufacturer),normalizePrinterModel(model))as{id:number}|undefined;}
function upsertPrinter(db:CartridgeDatabase,manufacturerId:number,model:string):number{db.db.prepare('INSERT INTO printers(manufacturer_id,model_name,normalized_model_name,has_replaceable_cartridges) VALUES(?,?,?,1) ON CONFLICT(manufacturer_id,normalized_model_name) DO NOTHING').run(manufacturerId,model,normalizePrinterModel(model));return(db.db.prepare('SELECT id FROM printers WHERE manufacturer_id=? AND normalized_model_name=?').get(manufacturerId,normalizePrinterModel(model))as{id:number}).id;}
function findSupply(db:CartridgeDatabase,manufacturer:string,part:string):{id:number}|undefined{return db.db.prepare('SELECT c.id FROM cartridges c JOIN manufacturers m ON m.id=c.manufacturer_id WHERE m.normalized_name=? AND c.normalized_part_number=?').get(normalizeManufacturerName(manufacturer),normalizeCartridgePartNumber(part))as{id:number}|undefined;}
function upsertSupply(db:CartridgeDatabase,manufacturerId:number,row:MultiSourceRow):number{db.db.prepare(`INSERT INTO cartridges(manufacturer_id,part_number,normalized_part_number,kind,origin_type,notes) VALUES(?,?,?,?,?,?) ON CONFLICT(manufacturer_id,normalized_part_number) DO UPDATE SET kind=CASE WHEN cartridges.kind='unknown' THEN excluded.kind ELSE cartridges.kind END,origin_type=CASE WHEN cartridges.origin_type='oem' THEN 'oem' WHEN cartridges.origin_type='unknown' THEN excluded.origin_type ELSE cartridges.origin_type END,notes=COALESCE(cartridges.notes,excluded.notes),updated_at=CURRENT_TIMESTAMP`).run(manufacturerId,row.supplyPartNumber,normalizeCartridgePartNumber(row.supplyPartNumber!),row.supplyType??'unknown',row.supplyOrigin??'unknown',row.description??null);return(db.db.prepare('SELECT id FROM cartridges WHERE manufacturer_id=? AND normalized_part_number=?').get(manufacturerId,normalizeCartridgePartNumber(row.supplyPartNumber!))as{id:number}).id;}
function upsertSource(db:CartridgeDatabase,name:string,reference:string,category:SourceCategory):number{db.db.prepare(`INSERT INTO data_sources(name,url,source_category) VALUES(?,?,?) ON CONFLICT(url) DO UPDATE SET name=excluded.name,source_category=CASE WHEN data_sources.source_category='official' THEN 'official' ELSE excluded.source_category END,updated_at=CURRENT_TIMESTAMP`).run(name,reference,category);return(db.db.prepare('SELECT id FROM data_sources WHERE url=?').get(reference)as{id:number}).id;}
function addPrinterSource(db:CartridgeDatabase,printerId:number,sourceId:number,reference:string,region:string):void{db.db.prepare(`INSERT INTO printer_sources(printer_id,source_id,source_url,verification_status,region) VALUES(?,?,?,'unverified',?) ON CONFLICT(printer_id,source_url,region) DO NOTHING`).run(printerId,sourceId,reference,region);}
function upsertRelationship(db:CartridgeDatabase,printerId:number,supplyId:number,sourceId:number,reference:string,reliability:ReliabilityStatus,region:string,origin:SupplyOrigin,description?:string):number{const legacyStatus=reliability==='official_verified'?'verified':'unverified';db.db.prepare(`INSERT INTO compatibility(printer_id,cartridge_id,source_id,source_url,verification_status,region,is_genuine_oem,source_type,evidence_type,evidence,reliability_status) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(printer_id,cartridge_id) DO UPDATE SET reliability_status=CASE WHEN compatibility.reliability_status='official_verified' THEN 'official_verified' WHEN excluded.reliability_status='official_verified' THEN 'official_verified' WHEN compatibility.reliability_status='conflicting' OR excluded.reliability_status='conflicting' THEN 'conflicting' WHEN compatibility.reliability_status='third_party_reported' OR excluded.reliability_status='third_party_reported' THEN 'third_party_reported' ELSE 'unverified' END,verification_status=CASE WHEN compatibility.verification_status='verified' THEN 'verified' ELSE excluded.verification_status END,updated_at=CURRENT_TIMESTAMP`).run(printerId,supplyId,sourceId,reference,legacyStatus,region,origin==='oem'?1:0,reliability==='official_verified'?'official-manufacturer':'other','other',description??null,reliability);return(db.db.prepare('SELECT id FROM compatibility WHERE printer_id=? AND cartridge_id=?').get(printerId,supplyId)as{id:number}).id;}
function addCompatibilitySource(db:CartridgeDatabase,compatibilityId:number,sourceId:number,reference:string,row:MultiSourceRow,reliability:ReliabilityStatus,region:string):boolean{const existed=Boolean(db.db.prepare(`SELECT id FROM compatibility_sources WHERE compatibility_id=? AND source_id=? AND source_reference=? AND region=? AND raw_printer_model=? AND raw_supply_part_number=?`).get(compatibilityId,sourceId,reference,region,row.rawPrinterModel,row.rawSupplyPartNumber));db.db.prepare(`INSERT INTO compatibility_sources(compatibility_id,source_id,source_reference,raw_printer_model,raw_supply_part_number,raw_description,verification_status,region,note) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(compatibility_id,source_id,source_reference,region,raw_printer_model,raw_supply_part_number) DO UPDATE SET raw_description=COALESCE(excluded.raw_description,compatibility_sources.raw_description),note=COALESCE(excluded.note,compatibility_sources.note),verification_status=CASE WHEN compatibility_sources.verification_status='official_verified' THEN 'official_verified' ELSE excluded.verification_status END`).run(compatibilityId,sourceId,reference,row.rawPrinterModel,row.rawSupplyPartNumber,row.description??'',reliability,region,row.note??null);return !existed;}
