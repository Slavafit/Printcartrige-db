import { closeSync, copyFileSync, mkdirSync, openSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { CartridgeDatabase } from './database.js';
import { normalizeCartridgePartNumber, normalizeManufacturerName, normalizePrinterModel } from './normalize.js';

export type SourceCategory = 'official' | 'third_party' | 'third-party' | 'open_dataset' | 'manual' | 'unknown';
export interface ImportRow {
  printerManufacturer: string;
  printerModel: string;
  hasReplaceableCartridges: boolean;
  cartridgeManufacturer?: string;
  cartridgePartNumber?: string;
  cartridgeKind?: 'ink' | 'toner';
  cartridgeColor?: string;
  yieldPages?: number;
  notes?: string;
}
export interface ImportPreview {
  rows: ImportRow[];
  valid: number;
  duplicates: number;
  errors: Array<{ row: number; message: string }>;
}

const text = (value: unknown) => String(value ?? '').trim();
const bool = (value: unknown) => ['true', '1', 'yes', 'да'].includes(text(value).toLowerCase());

export function parseImportFile(fileName: string, bytes: Buffer): ImportRow[] {
  const book = XLSX.read(bytes, { type: 'buffer' });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new Error('El archivo no contiene ninguna hoja');
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return raw.map(row => ({
    printerManufacturer: text(row.printerManufacturer || row.manufacturer || row['Производитель']),
    printerModel: text(row.printerModel || row.model || row['Модель принтера']),
    hasReplaceableCartridges: row.hasReplaceableCartridges === '' ? true : bool(row.hasReplaceableCartridges),
    cartridgeManufacturer: text(row.cartridgeManufacturer || row['Производитель картриджа']) || undefined,
    cartridgePartNumber: text(row.cartridgePartNumber || row.partNumber || row['Артикул картриджа']) || undefined,
    cartridgeKind: (text(row.cartridgeKind || row.kind || row['Тип картриджа']).toLowerCase() || undefined) as 'ink' | 'toner' | undefined,
    cartridgeColor: text(row.cartridgeColor || row.color || row['Цвет']) || undefined,
    yieldPages: Number(row.yieldPages || row['Ресурс страниц']) || undefined,
    notes: text(row.notes || row['Примечания']) || undefined,
  }));
}

export function previewImport(database: CartridgeDatabase, rows: ImportRow[]): ImportPreview {
  const errors: ImportPreview['errors'] = [];
  let duplicates = 0;
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (!row.printerManufacturer || !row.printerModel) errors.push({ row: index + 2, message: 'Falta el fabricante o el modelo de la impresora' });
    if (row.hasReplaceableCartridges && row.cartridgePartNumber && !['ink', 'toner'].includes(row.cartridgeKind ?? '')) errors.push({ row: index + 2, message: 'El tipo de cartucho debe ser ink o toner' });
    if (row.hasReplaceableCartridges && !row.cartridgePartNumber && row.cartridgeKind) errors.push({ row: index + 2, message: 'Se indicó un tipo sin referencia de cartucho' });
    const key = `${normalizeManufacturerName(row.printerManufacturer)}|${normalizePrinterModel(row.printerModel)}|${normalizeCartridgePartNumber(row.cartridgePartNumber ?? '')}`;
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
    if (row.printerManufacturer && row.printerModel && database.findPrinter(row.printerManufacturer, row.printerModel)) duplicates += 1;
  });
  return { rows, valid: rows.length - new Set(errors.map(item => item.row)).size, duplicates, errors };
}

export function commitImport(database: CartridgeDatabase, preview: ImportPreview, source: { name: string; category: SourceCategory }): { imported: number } {
  if (preview.errors.length) throw new Error('Corrige primero los errores de la vista previa');
  let imported = 0;
  database.transaction(() => {
    const sourceUrl = `${source.category}://desktop-import/${Date.now()}`;
    for (const row of preview.rows) {
      const manufacturerId = upsertManufacturer(database, row.printerManufacturer);
      const printerId = upsertPrinter(database, manufacturerId, row.printerModel, row.hasReplaceableCartridges, row.notes);
      addPrinterSource(database, printerId, source.name, sourceUrl, source.category);
      if (!row.cartridgePartNumber) { imported += 1; continue; }
      const cartridgeManufacturerId = upsertManufacturer(database, row.cartridgeManufacturer || row.printerManufacturer);
      const cartridgeId = upsertCartridge(database, cartridgeManufacturerId, row);
      addCompatibility(database, printerId, cartridgeId, source.name, sourceUrl, source.category);
      imported += 1;
    }
  });
  return { imported };
}

export function createPrinter(database: CartridgeDatabase, input: Record<string, unknown>): number {
  const manufacturer = text(input.manufacturer); const model = text(input.model);
  if (!manufacturer || !model) throw new Error('El fabricante y el modelo son obligatorios');
  return database.transaction(() => {
    const id = upsertPrinter(database, upsertManufacturer(database, manufacturer), model, input.hasReplaceableCartridges !== false, text(input.notes) || undefined, true);
    addPrinterSource(database, id, text(input.sourceName) || 'Registro manual', text(input.sourceUrl) || `manual://printer/${id}`, category(input.sourceCategory));
    return id;
  });
}

export function updatePrinter(database: CartridgeDatabase, id: number, input: Record<string, unknown>): boolean {
  const current = database.db.prepare('SELECT * FROM printers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!current) return false;
  const manufacturerId = input.manufacturer ? upsertManufacturer(database, text(input.manufacturer)) : Number(current.manufacturer_id);
  return database.update('printers', id, { manufacturer_id: manufacturerId, model_name: text(input.model || current.model_name), has_replaceable_cartridges: input.hasReplaceableCartridges === undefined ? current.has_replaceable_cartridges : input.hasReplaceableCartridges ? 1 : 0, notes: text(input.notes) || null });
}

export function createCartridge(database: CartridgeDatabase, input: Record<string, unknown>): number {
  const manufacturer = text(input.manufacturer); const partNumber = text(input.partNumber); const kind = text(input.kind);
  if (!manufacturer || !partNumber || !['ink', 'toner'].includes(kind)) throw new Error('El fabricante, la referencia y el tipo ink/toner son obligatorios');
  return upsertCartridge(database, upsertManufacturer(database, manufacturer), { printerManufacturer: '', printerModel: '', hasReplaceableCartridges: true, cartridgePartNumber: partNumber, cartridgeKind: kind as 'ink' | 'toner', cartridgeColor: text(input.color) || undefined, yieldPages: Number(input.yieldPages) || undefined, notes: text(input.notes) || undefined }, true);
}

export function updateCartridge(database: CartridgeDatabase, id: number, input: Record<string, unknown>): boolean {
  const current = database.db.prepare('SELECT * FROM cartridges WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!current) return false;
  const kind = text(input.kind || current.kind); if (!['ink', 'toner'].includes(kind)) throw new Error('El tipo debe ser ink o toner');
  return database.update('cartridges', id, { manufacturer_id: input.manufacturer ? upsertManufacturer(database, text(input.manufacturer)) : current.manufacturer_id, part_number: text(input.partNumber || current.part_number), kind, color: text(input.color) || null, yield_pages: Number(input.yieldPages) || null, notes: text(input.notes) || null });
}

export function createCompatibility(database: CartridgeDatabase, input: Record<string, unknown>): number {
  const printerId = Number(input.printerId), cartridgeId = Number(input.cartridgeId);
  if (!printerId || !cartridgeId) throw new Error('Se necesitan printerId y cartridgeId');
  const sourceCategory = category(input.sourceCategory); const sourceUrl = text(input.sourceUrl) || `${sourceCategory}://compatibility/${printerId}/${cartridgeId}`;
  return addCompatibility(database, printerId, cartridgeId, text(input.sourceName) || 'Registro manual', sourceUrl, sourceCategory);
}

export function exportWorkbook(database: CartridgeDatabase): Buffer {
  const rows = database.db.prepare(`SELECT pm.name printerManufacturer,p.model_name printerModel,p.has_replaceable_cartridges hasReplaceableCartridges,cm.name supplyManufacturer,c.part_number supplyPartNumber,c.kind supplyType,c.origin_type supplyOrigin,c.color,c.yield_pages yieldPages,cp.reliability_status reliabilityStatus,cp.region,cp.source_url sourceReference,p.notes printerNotes,c.notes supplyNotes FROM printers p JOIN manufacturers pm ON pm.id=p.manufacturer_id LEFT JOIN compatibility cp ON cp.printer_id=p.id LEFT JOIN cartridges c ON c.id=cp.cartridge_id LEFT JOIN manufacturers cm ON cm.id=c.manufacturer_id ORDER BY pm.normalized_name,p.normalized_model_name,c.normalized_part_number`).all();
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Catalog');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export async function backupDatabase(database: CartridgeDatabase, target: string): Promise<void> { mkdirSync(dirname(target), { recursive: true }); await database.db.backup(target); }

export interface RestoreDatabaseResult {
  database: CartridgeDatabase;
  restored: boolean;
  safetyBackupPath: string;
  error?: string;
}

const REQUIRED_BACKUP_TABLES = ['manufacturers', 'printers', 'cartridges', 'data_sources', 'compatibility'] as const;

export function validateDatabaseBackup(path: string): void {
  const bytes = Buffer.alloc(16); const descriptor = openSync(path, 'r');
  try { readSync(descriptor, bytes, 0, bytes.length, 0); } finally { closeSync(descriptor); }
  const header = bytes.toString('binary');
  if (header !== 'SQLite format 3\0') throw new Error('El archivo seleccionado no es una base SQLite válida');
  const candidate = new CartridgeDatabase(path, { readonly: true, fileMustExist: true });
  try {
    const integrity = candidate.db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('La copia SQLite está dañada');
    const tables = new Set((candidate.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(row => row.name));
    const missing = REQUIRED_BACKUP_TABLES.filter(table => !tables.has(table));
    if (missing.length) throw new Error(`La copia no contiene las tablas de PrinterDB: ${missing.join(', ')}`);
    const foreignKeyErrors = candidate.db.pragma('foreign_key_check') as unknown[];
    if (foreignKeyErrors.length) throw new Error('La copia contiene relaciones inválidas');
  } finally { candidate.close(); }
}

export async function restoreDatabase(database: CartridgeDatabase, bytes: Buffer, backupDirectory: string): Promise<RestoreDatabaseResult> {
  if (database.path === ':memory:') throw new Error('No se puede restaurar una base en memoria');
  const databasePath = resolve(database.path);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const temporaryPath = join(dirname(databasePath), `.${basename(databasePath)}.restore-${timestamp}.sqlite`);
  const safetyBackupPath = join(resolve(backupDirectory), `pre-restore-${timestamp}.sqlite`);
  const cleanup = () => {
    for (const path of [temporaryPath, `${temporaryPath}-wal`, `${temporaryPath}-shm`, `${temporaryPath}.pre-supply-form.sqlite`, `${temporaryPath}.pre-multisource.sqlite`]) rmSync(path, { force: true });
  };
  writeFileSync(temporaryPath, bytes, { flag: 'wx' });
  try {
    validateDatabaseBackup(temporaryPath);
    const migrated = new CartridgeDatabase(temporaryPath);
    try { migrated.initialize(); } finally { migrated.close(); }
    validateDatabaseBackup(temporaryPath);
    await backupDatabase(database, safetyBackupPath);
    validateDatabaseBackup(safetyBackupPath);
    database.close();
    try {
      for (const suffix of ['-wal', '-shm']) rmSync(`${databasePath}${suffix}`, { force: true });
      copyFileSync(temporaryPath, databasePath);
      const restored = new CartridgeDatabase(databasePath);
      restored.initialize();
      return { database: restored, restored: true, safetyBackupPath };
    } catch (error) {
      for (const suffix of ['-wal', '-shm']) rmSync(`${databasePath}${suffix}`, { force: true });
      copyFileSync(safetyBackupPath, databasePath);
      const recovered = new CartridgeDatabase(databasePath);
      recovered.initialize();
      return { database: recovered, restored: false, safetyBackupPath, error: error instanceof Error ? error.message : 'No se pudo restaurar la copia' };
    }
  } finally { cleanup(); }
}

function category(value: unknown): SourceCategory { const normalized=text(value).replace('third-party','third_party'); return ['official','third_party','open_dataset','manual','unknown'].includes(normalized) ? normalized as SourceCategory : 'manual'; }
function upsertManufacturer(database: CartridgeDatabase, name: string): number { const normalized = normalizeManufacturerName(name); database.db.prepare('INSERT INTO manufacturers(name,normalized_name) VALUES(?,?) ON CONFLICT(normalized_name) DO NOTHING').run(name, normalized); return (database.db.prepare('SELECT id FROM manufacturers WHERE normalized_name=?').get(normalized) as {id:number}).id; }
function upsertPrinter(database: CartridgeDatabase, manufacturerId: number, model: string, replaceable: boolean, notes?: string, rejectDuplicate = false): number { const normalized = normalizePrinterModel(model); const found = database.db.prepare('SELECT id FROM printers WHERE manufacturer_id=? AND normalized_model_name=?').get(manufacturerId, normalized) as {id:number}|undefined; if (found && rejectDuplicate) throw new Error('Esta impresora ya existe'); database.db.prepare('INSERT INTO printers(manufacturer_id,model_name,normalized_model_name,has_replaceable_cartridges,notes) VALUES(?,?,?,?,?) ON CONFLICT(manufacturer_id,normalized_model_name) DO UPDATE SET notes=COALESCE(excluded.notes,printers.notes),updated_at=CURRENT_TIMESTAMP').run(manufacturerId,model,normalized,replaceable?1:0,notes??null); return found?.id ?? (database.db.prepare('SELECT last_insert_rowid() id').get() as {id:number}).id; }
function upsertCartridge(database: CartridgeDatabase, manufacturerId: number, row: ImportRow, rejectDuplicate = false): number { const normalized=normalizeCartridgePartNumber(row.cartridgePartNumber!); const found=database.db.prepare('SELECT id FROM cartridges WHERE manufacturer_id=? AND normalized_part_number=?').get(manufacturerId,normalized) as {id:number}|undefined; if(found&&rejectDuplicate) throw new Error('Este cartucho ya existe'); database.db.prepare('INSERT INTO cartridges(manufacturer_id,part_number,normalized_part_number,kind,origin_type,color,yield_pages,notes) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(manufacturer_id,normalized_part_number) DO UPDATE SET color=COALESCE(excluded.color,cartridges.color),yield_pages=COALESCE(excluded.yield_pages,cartridges.yield_pages),notes=COALESCE(excluded.notes,cartridges.notes),updated_at=CURRENT_TIMESTAMP').run(manufacturerId,row.cartridgePartNumber,normalized,row.cartridgeKind,'unknown',row.cartridgeColor??null,row.yieldPages??null,row.notes??null); return found?.id ?? Number((database.db.prepare('SELECT last_insert_rowid() id').get() as {id:number}).id); }
function source(database: CartridgeDatabase,name:string,url:string,sourceCategory:SourceCategory):number { const storedCategory=sourceCategory==='third-party'?'third_party':sourceCategory; database.db.prepare('INSERT INTO data_sources(name,url,source_category) VALUES(?,?,?) ON CONFLICT(url) DO UPDATE SET name=excluded.name,source_category=CASE WHEN data_sources.source_category=\'official\' THEN \'official\' ELSE excluded.source_category END').run(name,url,storedCategory); return (database.db.prepare('SELECT id FROM data_sources WHERE url=?').get(url) as {id:number}).id; }
function addPrinterSource(database:CartridgeDatabase,printerId:number,name:string,url:string,sourceCategory:SourceCategory):void { const sourceId=source(database,name,url,sourceCategory); database.db.prepare("INSERT INTO printer_sources(printer_id,source_id,source_url,verification_status,region) VALUES(?,?,?,'unverified','local') ON CONFLICT(printer_id,source_url,region) DO NOTHING").run(printerId,sourceId,url); }
function addCompatibility(database:CartridgeDatabase,printerId:number,cartridgeId:number,name:string,url:string,sourceCategory:SourceCategory):number { const sourceId=source(database,name,url,sourceCategory); database.db.prepare("INSERT INTO compatibility(printer_id,cartridge_id,source_id,source_url,verification_status,region,is_genuine_oem,source_type,evidence_type,evidence,reliability_status) VALUES(?,?,?,?,'unverified','local',0,'other','other','Added locally; not officially verified','unverified') ON CONFLICT(printer_id,cartridge_id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP").run(printerId,cartridgeId,sourceId,url); const compatibilityId=(database.db.prepare('SELECT id FROM compatibility WHERE printer_id=? AND cartridge_id=?').get(printerId,cartridgeId) as {id:number}).id; database.db.prepare(`INSERT INTO compatibility_sources(compatibility_id,source_id,source_reference,raw_printer_model,raw_supply_part_number,raw_description,verification_status,region,note) VALUES(?,?,?,?,?,?,?,'local',?) ON CONFLICT(compatibility_id,source_id,source_reference,region,raw_printer_model,raw_supply_part_number) DO NOTHING`).run(compatibilityId,sourceId,url,'manual',String(cartridgeId),'Added locally','unverified','Manual relation'); return compatibilityId; }
