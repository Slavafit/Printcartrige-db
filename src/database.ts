import Database from 'better-sqlite3';
import { normalizeCartridgePartNumber, normalizeManufacturerName, normalizePrinterModel } from './normalize.js';
import { SCHEMA_SQL } from './schema.js';
import type { ImportRecord } from './types.js';

export type EntityName = 'manufacturers' | 'printers' | 'cartridges' | 'data_sources' | 'compatibility' | 'printer_sources';

const TABLE_COLUMNS: Record<EntityName, readonly string[]> = {
  manufacturers: ['name'],
  printers: ['manufacturer_id', 'model_name', 'has_replaceable_cartridges'],
  cartridges: ['manufacturer_id', 'part_number', 'kind', 'color'],
  data_sources: ['name', 'url'],
  compatibility: ['printer_id', 'cartridge_id', 'source_id', 'source_url', 'verification_status', 'region', 'is_genuine_oem', 'verified_at'],
  printer_sources: ['printer_id', 'source_id', 'source_url', 'verification_status', 'region'],
};

export class CartridgeDatabase {
  readonly db: Database.Database;

  constructor(path = 'printcartridge.sqlite', options: { readonly?: boolean; fileMustExist?: boolean } = {}) {
    this.db = new Database(path, options);
    this.db.pragma('foreign_keys = ON');
  }

  initialize(): void { this.db.exec(SCHEMA_SQL); }
  close(): void { this.db.close(); }

  list(entity: EntityName): unknown[] {
    assertEntity(entity);
    return this.db.prepare(`SELECT * FROM ${entity} ORDER BY id`).all();
  }

  create(entity: EntityName, input: Record<string, unknown>): number {
    assertEntity(entity);
    const data = this.prepareEntityData(entity, input);
    const columns = Object.keys(data);
    if (!columns.length) throw new Error(`No writable fields supplied for ${entity}`);
    const placeholders = columns.map((column) => `@${column}`).join(', ');
    const result = this.db.prepare(`INSERT INTO ${entity} (${columns.join(', ')}) VALUES (${placeholders})`).run(data);
    return Number(result.lastInsertRowid);
  }

  update(entity: EntityName, id: number, input: Record<string, unknown>): boolean {
    assertEntity(entity);
    const current = this.db.prepare(`SELECT * FROM ${entity} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!current) return false;
    const data = this.prepareEntityData(entity, { ...current, ...input });
    const columns = Object.keys(data);
    const assignments = columns.map((column) => `${column} = @${column}`).join(', ');
    const result = this.db.prepare(`UPDATE ${entity} SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ ...data, id });
    return result.changes === 1;
  }

  delete(entity: EntityName, id: number): boolean {
    assertEntity(entity);
    return this.db.prepare(`DELETE FROM ${entity} WHERE id = ?`).run(id).changes === 1;
  }

  writeImportRecord(record: ImportRecord): void {
    const printerManufacturerId = this.upsertManufacturer(record.printerManufacturer);
    const printerId = this.upsertPrinter(printerManufacturerId, record.printerModel, record.hasReplaceableCartridges);
    if (!record.hasReplaceableCartridges) return;

    const cartridgeManufacturerId = this.upsertManufacturer(record.cartridgeManufacturer!);
    const cartridgeId = this.upsertCartridge(
      cartridgeManufacturerId,
      record.cartridgePartNumber!,
      record.cartridgeKind!,
      record.cartridgeColor,
    );
    const sourceId = this.upsertSource(record.sourceName!, record.sourceUrl!);
    this.db.prepare(`
      INSERT INTO compatibility
        (printer_id, cartridge_id, source_id, source_url, verification_status, region, is_genuine_oem)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(printer_id, cartridge_id, source_url, region) DO UPDATE SET
        source_id = excluded.source_id,
        verification_status = excluded.verification_status,
        is_genuine_oem = excluded.is_genuine_oem,
        updated_at = CURRENT_TIMESTAMP
    `).run(printerId, cartridgeId, sourceId, record.sourceUrl, record.verificationStatus, record.region, record.isGenuineOem ? 1 : 0);
  }

  findPrinter(manufacturerName: string, modelName: string): { id: number; model_name: string } | undefined {
    return this.db.prepare(`
      SELECT p.id, p.model_name FROM printers p
      JOIN manufacturers m ON m.id = p.manufacturer_id
      WHERE m.normalized_name = ? AND p.normalized_model_name = ?
    `).get(normalizeManufacturerName(manufacturerName), normalizePrinterModel(modelName)) as { id: number; model_name: string } | undefined;
  }

  countPrintersByManufacturer(manufacturerName: string): number {
    return (this.db.prepare(`
      SELECT COUNT(*) AS count FROM printers p
      JOIN manufacturers m ON m.id = p.manufacturer_id
      WHERE m.normalized_name = ?
    `).get(normalizeManufacturerName(manufacturerName)) as { count: number }).count;
  }

  upsertPrinterSource(input: {
    manufacturerName: string;
    modelName: string;
    sourceName: string;
    sourceUrl: string;
    verificationStatus: 'unverified' | 'verified' | 'rejected';
    region: string;
  }): { printerId: number; inserted: boolean } {
    const manufacturerId = this.upsertManufacturer(input.manufacturerName);
    const existing = this.findPrinter(input.manufacturerName, input.modelName);
    const printerId = existing?.id ?? this.upsertPrinter(manufacturerId, input.modelName, true);
    const sourceId = this.upsertSource(input.sourceName, input.sourceUrl);
    this.db.prepare(`
      INSERT INTO printer_sources (printer_id, source_id, source_url, verification_status, region)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(printer_id, source_url, region) DO UPDATE SET
        source_id = excluded.source_id,
        verification_status = CASE
          WHEN printer_sources.verification_status = 'verified' THEN 'verified'
          ELSE excluded.verification_status
        END,
        updated_at = CURRENT_TIMESTAMP
    `).run(printerId, sourceId, input.sourceUrl, input.verificationStatus, input.region);
    return { printerId, inserted: !existing };
  }

  transaction<T>(fn: () => T): T { return this.db.transaction(fn)(); }

  private upsertManufacturer(name: string): number {
    const normalized = normalizeManufacturerName(name);
    this.db.prepare(`INSERT INTO manufacturers (name, normalized_name) VALUES (?, ?) ON CONFLICT(normalized_name) DO NOTHING`).run(name.trim(), normalized);
    return (this.db.prepare(`SELECT id FROM manufacturers WHERE normalized_name = ?`).get(normalized) as { id: number }).id;
  }

  private upsertPrinter(manufacturerId: number, model: string, replaceable: boolean): number {
    const normalized = normalizePrinterModel(model);
    this.db.prepare(`
      INSERT INTO printers (manufacturer_id, model_name, normalized_model_name, has_replaceable_cartridges)
      VALUES (?, ?, ?, ?) ON CONFLICT(manufacturer_id, normalized_model_name) DO UPDATE SET
        has_replaceable_cartridges = excluded.has_replaceable_cartridges, updated_at = CURRENT_TIMESTAMP
    `).run(manufacturerId, model.trim(), normalized, replaceable ? 1 : 0);
    return (this.db.prepare(`SELECT id FROM printers WHERE manufacturer_id = ? AND normalized_model_name = ?`).get(manufacturerId, normalized) as { id: number }).id;
  }

  private upsertCartridge(manufacturerId: number, partNumber: string, kind: string, color?: string): number {
    const normalized = normalizeCartridgePartNumber(partNumber);
    this.db.prepare(`
      INSERT INTO cartridges (manufacturer_id, part_number, normalized_part_number, kind, color)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(manufacturer_id, normalized_part_number) DO UPDATE SET
        kind = excluded.kind, color = COALESCE(excluded.color, cartridges.color), updated_at = CURRENT_TIMESTAMP
    `).run(manufacturerId, partNumber.trim(), normalized, kind, color?.trim() || null);
    return (this.db.prepare(`SELECT id FROM cartridges WHERE manufacturer_id = ? AND normalized_part_number = ?`).get(manufacturerId, normalized) as { id: number }).id;
  }

  private upsertSource(name: string, url: string): number {
    this.db.prepare(`INSERT INTO data_sources (name, url) VALUES (?, ?) ON CONFLICT(url) DO UPDATE SET name = excluded.name, updated_at = CURRENT_TIMESTAMP`).run(name.trim(), url.trim());
    return (this.db.prepare(`SELECT id FROM data_sources WHERE url = ?`).get(url.trim()) as { id: number }).id;
  }

  private prepareEntityData(entity: EntityName, input: Record<string, unknown>): Record<string, unknown> {
    const data = Object.fromEntries(TABLE_COLUMNS[entity].filter((key) => key in input).map((key) => [key, input[key]]));
    if (entity === 'manufacturers' && typeof data.name === 'string') data.normalized_name = normalizeManufacturerName(data.name);
    if (entity === 'printers' && typeof data.model_name === 'string') data.normalized_model_name = normalizePrinterModel(data.model_name);
    if (entity === 'cartridges' && typeof data.part_number === 'string') data.normalized_part_number = normalizeCartridgePartNumber(data.part_number);
    return data;
  }
}

function assertEntity(entity: string): asserts entity is EntityName {
  if (!(entity in TABLE_COLUMNS)) throw new Error(`Unknown entity: ${entity}`);
}
