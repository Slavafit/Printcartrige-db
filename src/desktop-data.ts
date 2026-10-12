import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as XLSX from 'xlsx';
import type { CartridgeDatabase } from './database.js';
import { normalizeCartridgePartNumber, normalizeManufacturerName, normalizePrinterModel } from './normalize.js';

export type SourceCategory = 'official' | 'third-party' | 'manual';
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
  if (!sheet) throw new Error('Файл не содержит листов');
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
    if (!row.printerManufacturer || !row.printerModel) errors.push({ row: index + 2, message: 'Не указан производитель или модель принтера' });
    if (row.hasReplaceableCartridges && row.cartridgePartNumber && !['ink', 'toner'].includes(row.cartridgeKind ?? '')) errors.push({ row: index + 2, message: 'Тип картриджа должен быть ink или toner' });
    if (row.hasReplaceableCartridges && !row.cartridgePartNumber && row.cartridgeKind) errors.push({ row: index + 2, message: 'Указан тип без артикула картриджа' });
    const key = `${normalizeManufacturerName(row.printerManufacturer)}|${normalizePrinterModel(row.printerModel)}|${normalizeCartridgePartNumber(row.cartridgePartNumber ?? '')}`;
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
    if (row.printerManufacturer && row.printerModel && database.findPrinter(row.printerManufacturer, row.printerModel)) duplicates += 1;
  });
  return { rows, valid: rows.length - new Set(errors.map(item => item.row)).size, duplicates, errors };
}

export function commitImport(database: CartridgeDatabase, preview: ImportPreview, source: { name: string; category: SourceCategory }): { imported: number } {
  if (preview.errors.length) throw new Error('Сначала исправьте ошибки предварительного просмотра');
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
  if (!manufacturer || !model) throw new Error('Производитель и модель обязательны');
  return database.transaction(() => {
    const id = upsertPrinter(database, upsertManufacturer(database, manufacturer), model, input.hasReplaceableCartridges !== false, text(input.notes) || undefined, true);
    addPrinterSource(database, id, text(input.sourceName) || 'Ручное добавление', text(input.sourceUrl) || `manual://printer/${id}`, category(input.sourceCategory));
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
  if (!manufacturer || !partNumber || !['ink', 'toner'].includes(kind)) throw new Error('Производитель, артикул и тип ink/toner обязательны');
  return upsertCartridge(database, upsertManufacturer(database, manufacturer), { printerManufacturer: '', printerModel: '', hasReplaceableCartridges: true, cartridgePartNumber: partNumber, cartridgeKind: kind as 'ink' | 'toner', cartridgeColor: text(input.color) || undefined, yieldPages: Number(input.yieldPages) || undefined, notes: text(input.notes) || undefined }, true);
}

export function updateCartridge(database: CartridgeDatabase, id: number, input: Record<string, unknown>): boolean {
  const current = database.db.prepare('SELECT * FROM cartridges WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!current) return false;
  const kind = text(input.kind || current.kind); if (!['ink', 'toner'].includes(kind)) throw new Error('Тип должен быть ink или toner');
  return database.update('cartridges', id, { manufacturer_id: input.manufacturer ? upsertManufacturer(database, text(input.manufacturer)) : current.manufacturer_id, part_number: text(input.partNumber || current.part_number), kind, color: text(input.color) || null, yield_pages: Number(input.yieldPages) || null, notes: text(input.notes) || null });
}

export function createCompatibility(database: CartridgeDatabase, input: Record<string, unknown>): number {
  const printerId = Number(input.printerId), cartridgeId = Number(input.cartridgeId);
  if (!printerId || !cartridgeId) throw new Error('Нужны printerId и cartridgeId');
  const sourceCategory = category(input.sourceCategory); const sourceUrl = text(input.sourceUrl) || `${sourceCategory}://compatibility/${printerId}/${cartridgeId}`;
  return addCompatibility(database, printerId, cartridgeId, text(input.sourceName) || 'Ручное добавление', sourceUrl, sourceCategory);
}

export function exportWorkbook(database: CartridgeDatabase): Buffer {
  const rows = database.db.prepare(`SELECT pm.name printerManufacturer,p.model_name printerModel,p.has_replaceable_cartridges hasReplaceableCartridges,cm.name cartridgeManufacturer,c.part_number cartridgePartNumber,c.kind cartridgeKind,c.color cartridgeColor,c.yield_pages yieldPages,cp.verification_status verificationStatus,cp.region,cp.source_url sourceUrl,p.notes printerNotes,c.notes cartridgeNotes FROM printers p JOIN manufacturers pm ON pm.id=p.manufacturer_id LEFT JOIN compatibility cp ON cp.printer_id=p.id LEFT JOIN cartridges c ON c.id=cp.cartridge_id LEFT JOIN manufacturers cm ON cm.id=c.manufacturer_id ORDER BY pm.normalized_name,p.normalized_model_name,c.normalized_part_number`).all();
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Catalog');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export async function backupDatabase(database: CartridgeDatabase, target: string): Promise<void> { mkdirSync(dirname(target), { recursive: true }); await database.db.backup(target); }

function category(value: unknown): SourceCategory { return ['official', 'third-party'].includes(text(value)) ? text(value) as SourceCategory : 'manual'; }
function upsertManufacturer(database: CartridgeDatabase, name: string): number { const normalized = normalizeManufacturerName(name); database.db.prepare('INSERT INTO manufacturers(name,normalized_name) VALUES(?,?) ON CONFLICT(normalized_name) DO NOTHING').run(name, normalized); return (database.db.prepare('SELECT id FROM manufacturers WHERE normalized_name=?').get(normalized) as {id:number}).id; }
function upsertPrinter(database: CartridgeDatabase, manufacturerId: number, model: string, replaceable: boolean, notes?: string, rejectDuplicate = false): number { const normalized = normalizePrinterModel(model); const found = database.db.prepare('SELECT id FROM printers WHERE manufacturer_id=? AND normalized_model_name=?').get(manufacturerId, normalized) as {id:number}|undefined; if (found && rejectDuplicate) throw new Error('Такой принтер уже существует'); database.db.prepare('INSERT INTO printers(manufacturer_id,model_name,normalized_model_name,has_replaceable_cartridges,notes) VALUES(?,?,?,?,?) ON CONFLICT(manufacturer_id,normalized_model_name) DO UPDATE SET notes=COALESCE(excluded.notes,printers.notes),updated_at=CURRENT_TIMESTAMP').run(manufacturerId,model,normalized,replaceable?1:0,notes??null); return found?.id ?? (database.db.prepare('SELECT last_insert_rowid() id').get() as {id:number}).id; }
function upsertCartridge(database: CartridgeDatabase, manufacturerId: number, row: ImportRow, rejectDuplicate = false): number { const normalized=normalizeCartridgePartNumber(row.cartridgePartNumber!); const found=database.db.prepare('SELECT id FROM cartridges WHERE manufacturer_id=? AND normalized_part_number=?').get(manufacturerId,normalized) as {id:number}|undefined; if(found&&rejectDuplicate) throw new Error('Такой картридж уже существует'); database.db.prepare('INSERT INTO cartridges(manufacturer_id,part_number,normalized_part_number,kind,color,yield_pages,notes) VALUES(?,?,?,?,?,?,?) ON CONFLICT(manufacturer_id,normalized_part_number) DO UPDATE SET color=COALESCE(excluded.color,cartridges.color),yield_pages=COALESCE(excluded.yield_pages,cartridges.yield_pages),notes=COALESCE(excluded.notes,cartridges.notes),updated_at=CURRENT_TIMESTAMP').run(manufacturerId,row.cartridgePartNumber,normalized,row.cartridgeKind,row.cartridgeColor??null,row.yieldPages??null,row.notes??null); return found?.id ?? Number((database.db.prepare('SELECT last_insert_rowid() id').get() as {id:number}).id); }
function source(database: CartridgeDatabase,name:string,url:string,sourceCategory:SourceCategory):number { database.db.prepare('INSERT INTO data_sources(name,url,source_category) VALUES(?,?,?) ON CONFLICT(url) DO UPDATE SET name=excluded.name,source_category=excluded.source_category').run(name,url,sourceCategory); return (database.db.prepare('SELECT id FROM data_sources WHERE url=?').get(url) as {id:number}).id; }
function addPrinterSource(database:CartridgeDatabase,printerId:number,name:string,url:string,sourceCategory:SourceCategory):void { const sourceId=source(database,name,url,sourceCategory); database.db.prepare("INSERT INTO printer_sources(printer_id,source_id,source_url,verification_status,region) VALUES(?,?,?,'unverified','local') ON CONFLICT(printer_id,source_url,region) DO NOTHING").run(printerId,sourceId,url); }
function addCompatibility(database:CartridgeDatabase,printerId:number,cartridgeId:number,name:string,url:string,sourceCategory:SourceCategory):number { const sourceId=source(database,name,url,sourceCategory); const result=database.db.prepare("INSERT INTO compatibility(printer_id,cartridge_id,source_id,source_url,verification_status,region,is_genuine_oem,source_type,evidence_type,evidence) VALUES(?,?,?,?,'unverified','local',1,'other','other','Added locally; not officially verified') ON CONFLICT(printer_id,cartridge_id,source_url,region) DO NOTHING").run(printerId,cartridgeId,sourceId,url); return Number(result.lastInsertRowid || (database.db.prepare('SELECT id FROM compatibility WHERE printer_id=? AND cartridge_id=? AND source_url=?').get(printerId,cartridgeId,url) as {id:number}).id); }
