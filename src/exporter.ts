import { writeFile } from 'node:fs/promises';
import { stringify } from 'csv-stringify/sync';
import { CartridgeDatabase } from './database.js';
import type { ExportRecord } from './types.js';

export function exportRecords(database: CartridgeDatabase): ExportRecord[] {
  const rows = database.db.prepare(`
    SELECT pm.name AS printerManufacturer, p.model_name AS printerModel,
      p.has_replaceable_cartridges AS hasReplaceableCartridges,
      cm.name AS cartridgeManufacturer, c.part_number AS cartridgePartNumber,
      c.kind AS cartridgeKind, c.color AS cartridgeColor,
      c.yield_pages AS yieldPages,
      ds.name AS sourceName, cp.source_url AS sourceUrl,
      cp.verification_status AS verificationStatus, cp.region AS region,
      cp.is_genuine_oem AS isGenuineOem, cp.source_type AS sourceType,
      cp.evidence_type AS evidenceType, cp.evidence AS evidence, cp.verified_at AS verifiedAt
    FROM printers p
    JOIN manufacturers pm ON pm.id = p.manufacturer_id
    LEFT JOIN compatibility cp ON cp.printer_id = p.id
    LEFT JOIN cartridges c ON c.id = cp.cartridge_id
    LEFT JOIN manufacturers cm ON cm.id = c.manufacturer_id
    LEFT JOIN data_sources ds ON ds.id = cp.source_id
    ORDER BY pm.normalized_name, p.normalized_model_name, c.normalized_part_number
  `).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ...row,
    hasReplaceableCartridges: Boolean(row.hasReplaceableCartridges),
    isGenuineOem: row.isGenuineOem == null ? undefined : Boolean(row.isGenuineOem),
    yieldPages: row.yieldPages == null ? undefined : Number(row.yieldPages),
  } as unknown as ExportRecord));
}

export async function exportFile(database: CartridgeDatabase, path: string): Promise<number> {
  const records = exportRecords(database);
  const output = path.toLowerCase().endsWith('.json')
    ? `${JSON.stringify(records, null, 2)}\n`
    : stringify(records, { header: true });
  await writeFile(path, output, 'utf8');
  return records.length;
}
