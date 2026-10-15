import type { CartridgeDatabase } from './database.js';

export type AuditEventType = 'manual_create' | 'manual_update' | 'manual_delete' | 'manual_import' | 'official_import' | 'backup' | 'restore';

export interface AuditEvent {
  id: number;
  eventType: AuditEventType;
  summary: string;
  details: Record<string, unknown> | null;
  occurredAt: string;
}

export interface ManufacturerAudit {
  manufacturer: string;
  printers: number;
  supplies: number;
  relationships: number;
  verifiedRelationships: number;
  lastVerifiedAt: string | null;
  lastChangedAt: string | null;
}

export interface DataAuditReport {
  generatedAt: string;
  lastDataChangeAt: string | null;
  lastVerifiedAt: string | null;
  oldestVerifiedAt: string | null;
  verifiedRelationships: number;
  verifiedWithoutDate: number;
  verificationOlderThanOneYear: number;
  recordsRequiringReview: number;
  recentEvents: AuditEvent[];
  manufacturers: ManufacturerAudit[];
}

export function recordAuditEvent(database: CartridgeDatabase, eventType: AuditEventType, summary: string, details?: Record<string, unknown>): number {
  const result = database.db.prepare(`
    INSERT INTO audit_events (event_type, summary, details_json)
    VALUES (?, ?, ?)
  `).run(eventType, summary.trim(), details ? JSON.stringify(details) : null);
  return Number(result.lastInsertRowid);
}

export function dataAuditReport(database: CartridgeDatabase, limit = 30): DataAuditReport {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const scalar = <T>(sql: string): T => (database.db.prepare(sql).get() as { value: T }).value;
  const latest = (queries: string[]): string | null => scalar<string | null>(`
    SELECT MAX(value) AS value FROM (${queries.map(query => `SELECT (${query}) AS value`).join(' UNION ALL ')})
  `);
  const lastDataChangeAt = latest([
    'SELECT MAX(updated_at) FROM manufacturers',
    'SELECT MAX(updated_at) FROM printers',
    'SELECT MAX(updated_at) FROM cartridges',
    'SELECT MAX(updated_at) FROM data_sources',
    'SELECT MAX(updated_at) FROM compatibility',
    'SELECT MAX(imported_at) FROM compatibility_sources',
    'SELECT MAX(updated_at) FROM printer_sources',
    "SELECT MAX(occurred_at) FROM audit_events WHERE event_type <> 'backup'",
  ]);
  const rows = database.db.prepare(`
    SELECT id, event_type, summary, details_json, occurred_at
    FROM audit_events ORDER BY occurred_at DESC, id DESC LIMIT ?
  `).all(safeLimit) as Array<{ id: number; event_type: AuditEventType; summary: string; details_json: string | null; occurred_at: string }>;
  const manufacturers = database.db.prepare(`
    SELECT m.name AS manufacturer,
      COUNT(DISTINCT p.id) AS printers,
      COUNT(DISTINCT c.id) AS supplies,
      COUNT(DISTINCT cp.id) AS relationships,
      COUNT(DISTINCT CASE WHEN cp.reliability_status = 'official_verified' THEN cp.id END) AS verified_relationships,
      MAX(CASE WHEN cp.reliability_status = 'official_verified' THEN cp.verified_at END) AS last_verified_at,
      MAX(CASE WHEN p.updated_at >= COALESCE(c.updated_at, '') THEN p.updated_at ELSE c.updated_at END) AS last_changed_at
    FROM manufacturers m
    LEFT JOIN printers p ON p.manufacturer_id = m.id
    LEFT JOIN compatibility cp ON cp.printer_id = p.id
    LEFT JOIN cartridges c ON c.id = cp.cartridge_id
    GROUP BY m.id, m.name
    ORDER BY m.normalized_name
  `).all() as Array<{ manufacturer: string; printers: number; supplies: number; relationships: number; verified_relationships: number; last_verified_at: string | null; last_changed_at: string | null }>;
  return {
    generatedAt: new Date().toISOString(),
    lastDataChangeAt,
    lastVerifiedAt: scalar<string | null>("SELECT MAX(verified_at) AS value FROM compatibility WHERE reliability_status = 'official_verified'"),
    oldestVerifiedAt: scalar<string | null>("SELECT MIN(verified_at) AS value FROM compatibility WHERE reliability_status = 'official_verified'"),
    verifiedRelationships: scalar<number>("SELECT COUNT(*) AS value FROM compatibility WHERE reliability_status = 'official_verified'"),
    verifiedWithoutDate: scalar<number>("SELECT COUNT(*) AS value FROM compatibility WHERE reliability_status = 'official_verified' AND (verified_at IS NULL OR trim(verified_at) = '')"),
    verificationOlderThanOneYear: scalar<number>("SELECT COUNT(*) AS value FROM compatibility WHERE reliability_status = 'official_verified' AND verified_at IS NOT NULL AND datetime(verified_at) < datetime('now', '-1 year')"),
    recordsRequiringReview: scalar<number>("SELECT COUNT(*) AS value FROM compatibility WHERE reliability_status IN ('unverified', 'third_party_reported', 'conflicting')"),
    recentEvents: rows.map(row => ({ id: row.id, eventType: row.event_type, summary: row.summary, details: parseDetails(row.details_json), occurredAt: row.occurred_at })),
    manufacturers: manufacturers.map(row => ({
      manufacturer: row.manufacturer,
      printers: row.printers,
      supplies: row.supplies,
      relationships: row.relationships,
      verifiedRelationships: row.verified_relationships,
      lastVerifiedAt: row.last_verified_at,
      lastChangedAt: row.last_changed_at,
    })),
  };
}

function parseDetails(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
