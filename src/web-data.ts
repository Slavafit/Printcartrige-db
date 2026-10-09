import type { CartridgeDatabase } from './database.js';

export interface PrinterSearchOptions { query?: string; manufacturer?: string; limit?: number; offset?: number }
export interface PrinterSearchPage { items: unknown[]; total: number; page: number; pageSize: number; totalPages: number }

export function webStats(database: CartridgeDatabase): Record<string, number> {
  const value = (sql: string): number => (database.db.prepare(sql).get() as { count: number }).count;
  return { ...database.compatibilityStats(), totalManufacturers: value('SELECT COUNT(*) AS count FROM manufacturers'), totalCartridges: value('SELECT COUNT(*) AS count FROM cartridges') };
}

export function webManufacturers(database: CartridgeDatabase): unknown[] {
  return database.db.prepare(`SELECT m.id, m.name, COUNT(p.id) AS printer_count FROM manufacturers m JOIN printers p ON p.manufacturer_id = m.id GROUP BY m.id, m.name ORDER BY m.normalized_name`).all();
}

export function searchPrinters(database: CartridgeDatabase, options: PrinterSearchOptions = {}): unknown[] {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const query = options.query?.trim().toLowerCase() ?? '';
  const manufacturer = options.manufacturer?.trim().toLowerCase() ?? '';
  return database.db.prepare(`
    SELECT p.id, m.name AS manufacturer, p.model_name, p.has_replaceable_cartridges,
      COUNT(DISTINCT CASE WHEN cp.verification_status = 'verified' AND cp.is_genuine_oem = 1 THEN cp.cartridge_id END) AS verified_cartridge_count,
      COUNT(DISTINCT cp.cartridge_id) AS cartridge_count
    FROM printers p JOIN manufacturers m ON m.id = p.manufacturer_id
    LEFT JOIN compatibility cp ON cp.printer_id = p.id
    WHERE (@query = '' OR lower(m.name || ' ' || p.model_name) LIKE '%' || @query || '%')
      AND (@manufacturer = '' OR lower(m.name) = @manufacturer)
    GROUP BY p.id, m.name, p.model_name, p.has_replaceable_cartridges
    ORDER BY m.normalized_name, p.normalized_model_name LIMIT @limit OFFSET @offset
  `).all({ query, manufacturer, limit, offset });
}

export function searchPrinterPage(database: CartridgeDatabase, options: PrinterSearchOptions = {}): PrinterSearchPage {
  const pageSize = Math.min(Math.max(options.limit ?? 10, 1), 100);
  const requestedOffset = Math.max(options.offset ?? 0, 0);
  const query = options.query?.trim().toLowerCase() ?? '';
  const manufacturer = options.manufacturer?.trim().toLowerCase() ?? '';
  const total = (database.db.prepare(`
    SELECT COUNT(*) AS count FROM printers p JOIN manufacturers m ON m.id = p.manufacturer_id
    WHERE (@query = '' OR lower(m.name || ' ' || p.model_name) LIKE '%' || @query || '%')
      AND (@manufacturer = '' OR lower(m.name) = @manufacturer)
  `).get({ query, manufacturer }) as { count: number }).count;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.floor(requestedOffset / pageSize) + 1, totalPages);
  const offset = (page - 1) * pageSize;
  return { items: searchPrinters(database, { ...options, limit: pageSize, offset }), total, page, pageSize, totalPages };
}

export function printerDetails(database: CartridgeDatabase, id: number): unknown | undefined {
  const printer = database.db.prepare(`SELECT p.id, m.name AS manufacturer, p.model_name, p.has_replaceable_cartridges FROM printers p JOIN manufacturers m ON m.id = p.manufacturer_id WHERE p.id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!printer) return undefined;
  const sources = database.db.prepare(`SELECT ds.name, ps.source_url, ps.verification_status, ps.region FROM printer_sources ps JOIN data_sources ds ON ds.id = ps.source_id WHERE ps.printer_id = ? ORDER BY ps.verification_status = 'verified' DESC, ps.region, ps.source_url`).all(id);
  const cartridges = database.db.prepare(`
    SELECT c.id, cm.name AS manufacturer, c.part_number, c.kind, c.color, c.yield_pages,
      cp.verification_status, cp.region, cp.source_url, cp.evidence, cp.verified_at
    FROM compatibility cp JOIN cartridges c ON c.id = cp.cartridge_id JOIN manufacturers cm ON cm.id = c.manufacturer_id
    WHERE cp.printer_id = ? AND cp.is_genuine_oem = 1
    ORDER BY cp.verification_status = 'verified' DESC, c.normalized_part_number, cp.region
  `).all(id);
  return { ...printer, sources, cartridges };
}
