import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CartridgeDatabase } from '../src/database.js';
import { dataAuditReport, recordAuditEvent, type AuditEventType } from '../src/data-audit.js';

const events = JSON.parse(readFileSync('tests/fixtures/audit-events-synthetic.json', 'utf8')) as Array<{
  eventType: AuditEventType;
  summary: string;
  details: Record<string, unknown>;
}>;

describe('data audit', () => {
  let database: CartridgeDatabase;
  beforeEach(() => {
    database = new CartridgeDatabase(':memory:');
    database.initialize();
    database.writeImportRecord({
      printerManufacturer: 'Synthetic OEM', printerModel: 'Audit 100', hasReplaceableCartridges: true,
      cartridgeManufacturer: 'Synthetic OEM', cartridgePartNumber: 'AUD-1', cartridgeKind: 'toner',
      sourceName: 'Synthetic official source', sourceUrl: 'https://example.invalid/audit-100',
      verificationStatus: 'verified', region: 'TEST', isGenuineOem: true,
      sourceType: 'official-manufacturer', evidenceType: 'explicit-compatibility',
      evidence: 'Synthetic fixture evidence.', verifiedAt: '2025-01-15T00:00:00.000Z',
    });
  });
  afterEach(() => database.close());

  it('separates data modification from official verification freshness', () => {
    for (const event of events) recordAuditEvent(database, event.eventType, event.summary, event.details);
    const report = dataAuditReport(database);
    expect(report).toMatchObject({
      lastVerifiedAt: '2025-01-15T00:00:00.000Z',
      oldestVerifiedAt: '2025-01-15T00:00:00.000Z',
      verifiedRelationships: 1,
      verifiedWithoutDate: 0,
      recentEvents: [
        expect.objectContaining({ eventType: 'backup', summary: 'Synthetic fixture backup' }),
        expect.objectContaining({ eventType: 'manual_import', summary: 'Synthetic fixture import' }),
      ],
      manufacturers: [expect.objectContaining({ manufacturer: 'Synthetic OEM', printers: 1, supplies: 1, relationships: 1, verifiedRelationships: 1 })],
    });
    expect(report.lastDataChangeAt).not.toBe(report.lastVerifiedAt);
  });

  it('reports verified relationships without a verification date', () => {
    database.db.prepare('UPDATE compatibility SET verified_at = NULL').run();
    expect(dataAuditReport(database)).toMatchObject({ verifiedRelationships: 1, verifiedWithoutDate: 1, lastVerifiedAt: null });
  });

  it('caps the visible event history', () => {
    for (let index = 0; index < 5; index += 1) recordAuditEvent(database, 'manual_update', `Synthetic update ${index}`);
    expect(dataAuditReport(database, 2).recentEvents).toHaveLength(2);
  });
});
