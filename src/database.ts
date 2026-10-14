import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { normalizeCartridgePartNumber, normalizeManufacturerName, normalizePrinterModel } from './normalize.js';
import { SCHEMA_SQL } from './schema.js';
import type { ImportRecord } from './types.js';

export type EntityName = 'manufacturers' | 'printers' | 'cartridges' | 'data_sources' | 'compatibility' | 'compatibility_sources' | 'printer_sources';

const TABLE_COLUMNS: Record<EntityName, readonly string[]> = {
  manufacturers: ['name'],
  printers: ['manufacturer_id', 'model_name', 'has_replaceable_cartridges', 'notes'],
  cartridges: ['manufacturer_id', 'part_number', 'kind', 'origin_type', 'supply_form', 'color', 'yield_pages', 'notes'],
  data_sources: ['name', 'url', 'source_category'],
  compatibility: ['printer_id', 'cartridge_id', 'source_id', 'source_url', 'verification_status', 'region', 'is_genuine_oem', 'source_type', 'evidence_type', 'evidence', 'verified_at', 'reliability_status'],
  compatibility_sources: ['compatibility_id', 'source_id', 'source_reference', 'raw_printer_model', 'raw_supply_part_number', 'raw_description', 'verification_status', 'region', 'note', 'evidence_type', 'evidence', 'verified_at'],
  printer_sources: ['printer_id', 'source_id', 'source_url', 'verification_status', 'region'],
};

export class CartridgeDatabase {
  readonly db: Database.Database;
  readonly path: string;
  migrationBackupPath?: string;

  constructor(path = 'printcartridge.sqlite', options: { readonly?: boolean; fileMustExist?: boolean } = {}) {
    this.path = path;
    this.db = new Database(path, options);
    this.db.pragma('foreign_keys = ON');
  }

  initialize(): void {
    this.backupBeforeSupplyFormMigration();
    this.backupBeforeMultiSourceMigration();
    this.db.exec(SCHEMA_SQL);
    this.migrateMultiSourceSchema();
    this.addColumnIfMissing('cartridges', 'supply_form', "TEXT CHECK (supply_form IS NULL OR supply_form = 'ink_bottle')");
    this.addColumnIfMissing('cartridges', 'yield_pages', 'INTEGER CHECK (yield_pages IS NULL OR yield_pages > 0)');
    this.addColumnIfMissing('compatibility', 'source_type', "TEXT CHECK (source_type IS NULL OR source_type IN ('official-manufacturer', 'other'))");
    this.addColumnIfMissing('compatibility', 'evidence_type', "TEXT CHECK (evidence_type IS NULL OR evidence_type IN ('explicit-compatibility', 'product-page-only', 'other'))");
    this.addColumnIfMissing('compatibility', 'evidence', 'TEXT');
    this.addColumnIfMissing('printers', 'notes', 'TEXT');
    this.addColumnIfMissing('cartridges', 'notes', 'TEXT');
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_compatibility_pair ON compatibility(printer_id, cartridge_id)');
  }
  close(): void { this.db.close(); }

  private backupBeforeSupplyFormMigration(): void {
    if (this.path === ':memory:' || !existsSync(this.path)) return;
    const columns = this.db.prepare('PRAGMA table_info(cartridges)').all() as Array<{ name: string }>;
    if (!columns.some(column => column.name === 'origin_type') || columns.some(column => column.name === 'supply_form')) return;
    const target = `${this.path}.pre-supply-form.sqlite`;
    if (existsSync(target)) throw new Error(`Migration backup already exists: ${target}; archive it before retrying`);
    this.db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
    this.migrationBackupPath = target;
  }

  private backupBeforeMultiSourceMigration(): void {
    if (this.path === ':memory:' || !existsSync(this.path)) return;
    const cartridges = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cartridges'").get();
    const columns = this.db.prepare('PRAGMA table_info(cartridges)').all() as Array<{ name: string }>;
    if (!cartridges || columns.some(column => column.name === 'origin_type')) return;
    const target = `${this.path}.pre-multisource.sqlite`;
    if (existsSync(target)) return;
    this.db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
    this.migrationBackupPath = target;
  }

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

  writeImportRecord(record: ImportRecord): boolean {
    const printerManufacturerId = this.upsertManufacturer(record.printerManufacturer);
    const printerId = this.upsertPrinter(printerManufacturerId, record.printerModel, record.hasReplaceableCartridges);
    if (!record.hasReplaceableCartridges) {
      if (record.sourceName && record.sourceUrl && record.region && record.verificationStatus) {
        this.upsertPrinterSource({ manufacturerName: record.printerManufacturer, modelName: record.printerModel,
          sourceName: record.sourceName, sourceUrl: record.sourceUrl, region: record.region,
          verificationStatus: record.verificationStatus });
      }
      return false;
    }

    const cartridgeManufacturerId = this.upsertManufacturer(record.cartridgeManufacturer!);
    const cartridgeId = this.upsertCartridge(
      cartridgeManufacturerId,
      record.cartridgePartNumber!,
      record.cartridgeKind!,
      record.cartridgeColor,
      record.yieldPages,
    );
    const sourceId = this.upsertSource(record.sourceName!, record.sourceUrl!, 'official');
    const existed = Boolean(this.db.prepare(`
      SELECT id FROM compatibility WHERE printer_id = ? AND cartridge_id = ?
    `).get(printerId, cartridgeId));
    this.db.prepare(`
      INSERT INTO compatibility
        (printer_id, cartridge_id, source_id, source_url, verification_status, region, is_genuine_oem,
         source_type, evidence_type, evidence, verified_at, reliability_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(printer_id, cartridge_id) DO UPDATE SET
        source_id = excluded.source_id,
        verification_status = CASE
          WHEN compatibility.verification_status = 'verified' THEN 'verified'
          ELSE excluded.verification_status
        END,
        is_genuine_oem = excluded.is_genuine_oem,
        source_type = COALESCE(excluded.source_type, compatibility.source_type),
        evidence_type = COALESCE(excluded.evidence_type, compatibility.evidence_type),
        evidence = COALESCE(excluded.evidence, compatibility.evidence),
        verified_at = COALESCE(excluded.verified_at, compatibility.verified_at),
        reliability_status = CASE WHEN compatibility.reliability_status='official_verified' THEN 'official_verified' ELSE excluded.reliability_status END,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      printerId, cartridgeId, sourceId, record.sourceUrl, record.verificationStatus, record.region,
      record.isGenuineOem ? 1 : 0, record.sourceType ?? null, record.evidenceType ?? null,
      record.evidence ?? null, record.verifiedAt ?? null, record.verificationStatus === 'verified' ? 'official_verified' : 'unverified',
    );
    const compatibilityId = (this.db.prepare('SELECT id FROM compatibility WHERE printer_id=? AND cartridge_id=?').get(printerId,cartridgeId) as {id:number}).id;
    this.db.prepare(`INSERT INTO compatibility_sources
      (compatibility_id,source_id,source_reference,raw_printer_model,raw_supply_part_number,raw_description,verification_status,region,evidence_type,evidence,verified_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(compatibility_id,source_id,source_reference,region,raw_printer_model,raw_supply_part_number) DO UPDATE SET
        verification_status=CASE WHEN compatibility_sources.verification_status='official_verified' THEN 'official_verified' ELSE excluded.verification_status END,
        raw_description=COALESCE(excluded.raw_description,compatibility_sources.raw_description),evidence=COALESCE(excluded.evidence,compatibility_sources.evidence),verified_at=COALESCE(excluded.verified_at,compatibility_sources.verified_at)
    `).run(compatibilityId,sourceId,record.sourceUrl,record.printerModel,record.cartridgePartNumber,record.evidence??null,record.verificationStatus==='verified'?'official_verified':'unverified',record.region,record.evidenceType??null,record.evidence??null,record.verifiedAt??null);
    return !existed;
  }

  queryCompatibility(printer?: string): unknown[] {
    const where = printer ? 'WHERE p.normalized_model_name = @normalizedModel' : '';
    return this.db.prepare(`
      SELECT pm.name AS printer_manufacturer, p.model_name,
        cm.name AS cartridge_manufacturer, c.part_number, c.kind, c.supply_form, COALESCE(c.supply_form,c.kind) AS supply_type, c.color, c.yield_pages,
        CASE cp.reliability_status WHEN 'official_verified' THEN 'verified' ELSE 'unverified' END AS verification_status,
        cp.reliability_status, cp.region, cp.source_url, cp.source_type, cp.evidence_type, cp.evidence, cp.verified_at
      FROM compatibility cp
      JOIN printers p ON p.id = cp.printer_id
      JOIN manufacturers pm ON pm.id = p.manufacturer_id
      JOIN cartridges c ON c.id = cp.cartridge_id
      JOIN manufacturers cm ON cm.id = c.manufacturer_id
      ${where}
      ORDER BY pm.normalized_name, p.normalized_model_name, c.normalized_part_number
    `).all(printer ? { normalizedModel: normalizePrinterModel(printer) } : {});
  }

  compatibilityStats(): {
    totalPrinters: number;
    printersWithVerifiedCompatibility: number;
    printersWithoutVerifiedCompatibility: number;
    totalUniqueOemCartridges: number;
    totalVerifiedRelationships: number;
    recordsRequiringManualReview: number;
  } {
    const value = (sql: string): number => (this.db.prepare(sql).get() as { count: number }).count;
    const totalPrinters = value('SELECT COUNT(*) AS count FROM printers');
    const cartridgeFilter = "c.kind IN ('ink','toner') AND c.supply_form IS NULL";
    const printersWithVerifiedCompatibility = value(`
      SELECT COUNT(DISTINCT cp.printer_id) AS count FROM compatibility cp
      JOIN cartridges c ON c.id = cp.cartridge_id
      WHERE cp.reliability_status = 'official_verified' AND cp.is_genuine_oem = 1 AND ${cartridgeFilter}
    `);
    return {
      totalPrinters,
      printersWithVerifiedCompatibility,
      printersWithoutVerifiedCompatibility: totalPrinters - printersWithVerifiedCompatibility,
      totalUniqueOemCartridges: value(`
        SELECT COUNT(DISTINCT cp.cartridge_id) AS count FROM compatibility cp
        JOIN cartridges c ON c.id = cp.cartridge_id
        WHERE cp.reliability_status = 'official_verified' AND cp.is_genuine_oem = 1 AND ${cartridgeFilter}
      `),
      totalVerifiedRelationships: value(`
        SELECT COUNT(*) AS count FROM compatibility cp
        JOIN cartridges c ON c.id = cp.cartridge_id
        WHERE cp.reliability_status = 'official_verified' AND cp.is_genuine_oem = 1 AND ${cartridgeFilter}
      `),
      recordsRequiringManualReview: value(`
        SELECT COUNT(*) AS count FROM compatibility WHERE reliability_status IN ('unverified','third_party_reported','conflicting')
      `),
    };
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

  private upsertCartridge(manufacturerId: number, partNumber: string, kind: string, color?: string, yieldPages?: number, originType = 'oem'): number {
    const normalized = normalizeCartridgePartNumber(partNumber);
    this.db.prepare(`
      INSERT INTO cartridges (manufacturer_id, part_number, normalized_part_number, kind, origin_type, color, yield_pages)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(manufacturer_id, normalized_part_number) DO UPDATE SET
        kind = excluded.kind,
        origin_type = CASE WHEN cartridges.origin_type='oem' THEN 'oem' ELSE excluded.origin_type END,
        color = COALESCE(excluded.color, cartridges.color),
        yield_pages = COALESCE(excluded.yield_pages, cartridges.yield_pages),
        updated_at = CURRENT_TIMESTAMP
    `).run(manufacturerId, partNumber.trim(), normalized, kind, originType, color?.trim() || null, yieldPages ?? null);
    return (this.db.prepare(`SELECT id FROM cartridges WHERE manufacturer_id = ? AND normalized_part_number = ?`).get(manufacturerId, normalized) as { id: number }).id;
  }

  private upsertSource(name: string, url: string, category = 'official'): number {
    this.db.prepare(`INSERT INTO data_sources (name, url, source_category) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET name = excluded.name, source_category=CASE WHEN data_sources.source_category='official' THEN 'official' ELSE excluded.source_category END, updated_at = CURRENT_TIMESTAMP`).run(name.trim(), url.trim(), category);
    return (this.db.prepare(`SELECT id FROM data_sources WHERE url = ?`).get(url.trim()) as { id: number }).id;
  }

  private prepareEntityData(entity: EntityName, input: Record<string, unknown>): Record<string, unknown> {
    const data = Object.fromEntries(TABLE_COLUMNS[entity].filter((key) => key in input).map((key) => [key, input[key]]));
    if (entity === 'manufacturers' && typeof data.name === 'string') data.normalized_name = normalizeManufacturerName(data.name);
    if (entity === 'printers' && typeof data.model_name === 'string') data.normalized_model_name = normalizePrinterModel(data.model_name);
    if (entity === 'cartridges' && typeof data.part_number === 'string') data.normalized_part_number = normalizeCartridgePartNumber(data.part_number);
    return data;
  }

  private migrateMultiSourceSchema(): void {
    const tableSql = (table: string): string => ((this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as { sql?: string } | undefined)?.sql ?? '');
    const cartridgeSql = tableSql('cartridges');
    const sourceSql = tableSql('data_sources');
    const needsCartridgeRebuild = !cartridgeSql.includes('origin_type');
    const needsSourceRebuild = !sourceSql.includes('open_dataset');

    if (needsCartridgeRebuild || needsSourceRebuild) {
      this.db.pragma('foreign_keys = OFF');
      try {
        this.db.transaction(() => {
          if (needsCartridgeRebuild) {
            this.db.exec(`
              CREATE TABLE cartridges_new (
                id INTEGER PRIMARY KEY,
                manufacturer_id INTEGER NOT NULL REFERENCES manufacturers(id) ON DELETE RESTRICT,
                part_number TEXT NOT NULL,
                normalized_part_number TEXT NOT NULL,
                kind TEXT NOT NULL CHECK (kind IN ('ink', 'toner', 'drum', 'waste_toner', 'belt', 'other', 'unknown')),
                origin_type TEXT NOT NULL DEFAULT 'unknown' CHECK (origin_type IN ('oem', 'compatible', 'remanufactured', 'unknown')),
                color TEXT,
                yield_pages INTEGER CHECK (yield_pages IS NULL OR yield_pages > 0),
                notes TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (manufacturer_id, normalized_part_number)
              );
              INSERT INTO cartridges_new (id,manufacturer_id,part_number,normalized_part_number,kind,origin_type,color,yield_pages,notes,created_at,updated_at)
              SELECT id,manufacturer_id,part_number,normalized_part_number,kind,'oem',color,yield_pages,notes,created_at,updated_at FROM cartridges;
              DROP TABLE cartridges;
              ALTER TABLE cartridges_new RENAME TO cartridges;
            `);
          }
          if (needsSourceRebuild) {
            this.db.exec(`
              CREATE TABLE data_sources_new (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                url TEXT NOT NULL UNIQUE,
                source_category TEXT NOT NULL DEFAULT 'unknown' CHECK (source_category IN ('official', 'third_party', 'open_dataset', 'manual', 'unknown')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
              );
              INSERT INTO data_sources_new (id,name,url,source_category,created_at,updated_at)
              SELECT id,name,url,CASE source_category WHEN 'third-party' THEN 'third_party' WHEN 'official' THEN 'official' WHEN 'manual' THEN 'manual' ELSE 'unknown' END,created_at,updated_at FROM data_sources;
              DROP TABLE data_sources;
              ALTER TABLE data_sources_new RENAME TO data_sources;
            `);
          }
        })();
      } finally {
        this.db.pragma('foreign_keys = ON');
      }
    }

    const needsCompatibilityMigration = !(this.db.prepare('PRAGMA table_info(compatibility)').all() as Array<{ name: string }>).some(column => column.name === 'reliability_status');
    this.addColumnIfMissing('compatibility', 'reliability_status', "TEXT NOT NULL DEFAULT 'unverified' CHECK (reliability_status IN ('official_verified', 'third_party_reported', 'unverified', 'conflicting'))");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS compatibility_sources (
        id INTEGER PRIMARY KEY,
        compatibility_id INTEGER NOT NULL REFERENCES compatibility(id) ON DELETE CASCADE,
        source_id INTEGER NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
        source_reference TEXT NOT NULL,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        raw_printer_model TEXT,
        raw_supply_part_number TEXT,
        raw_description TEXT,
        verification_status TEXT NOT NULL CHECK (verification_status IN ('official_verified', 'third_party_reported', 'unverified', 'conflicting')),
        region TEXT NOT NULL DEFAULT 'unknown',
        note TEXT,
        evidence_type TEXT,
        evidence TEXT,
        verified_at TEXT,
        UNIQUE (compatibility_id, source_id, source_reference, region, raw_printer_model, raw_supply_part_number)
      );
    `);
    if (needsCompatibilityMigration) this.db.transaction(() => {
      this.db.exec(`
        INSERT OR IGNORE INTO compatibility_sources
          (compatibility_id,source_id,source_reference,raw_printer_model,raw_supply_part_number,raw_description,verification_status,region,note,evidence_type,evidence,verified_at,imported_at)
        SELECT (SELECT MIN(c2.id) FROM compatibility c2 WHERE c2.printer_id=cp.printer_id AND c2.cartridge_id=cp.cartridge_id),
          cp.source_id,cp.source_url,p.model_name,c.part_number,cp.evidence,
          CASE cp.verification_status WHEN 'verified' THEN 'official_verified' ELSE 'unverified' END,
          cp.region,NULL,cp.evidence_type,cp.evidence,cp.verified_at,cp.created_at
        FROM compatibility cp JOIN printers p ON p.id=cp.printer_id JOIN cartridges c ON c.id=cp.cartridge_id;
        DELETE FROM compatibility_sources WHERE compatibility_id NOT IN (SELECT MIN(id) FROM compatibility GROUP BY printer_id,cartridge_id);
        DELETE FROM compatibility WHERE id NOT IN (SELECT MIN(id) FROM compatibility GROUP BY printer_id,cartridge_id);
        UPDATE compatibility SET reliability_status = CASE
          WHEN EXISTS (SELECT 1 FROM compatibility_sources cs WHERE cs.compatibility_id=compatibility.id AND cs.verification_status='official_verified') THEN 'official_verified'
          WHEN EXISTS (SELECT 1 FROM compatibility_sources cs JOIN data_sources ds ON ds.id=cs.source_id WHERE cs.compatibility_id=compatibility.id AND ds.source_category IN ('third_party','open_dataset')) THEN 'third_party_reported'
          ELSE 'unverified' END;
      `);
    })();
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cartridges_manufacturer ON cartridges(manufacturer_id);
      CREATE INDEX IF NOT EXISTS idx_compatibility_sources_compatibility ON compatibility_sources(compatibility_id);
    `);
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function assertEntity(entity: string): asserts entity is EntityName {
  if (!(entity in TABLE_COLUMNS)) throw new Error(`Unknown entity: ${entity}`);
}
