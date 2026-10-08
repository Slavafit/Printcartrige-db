import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { CartridgeDatabase } from './database.js';
import type { ImportRecord, ImportResult, ValidationIssue } from './types.js';

const cartridgeKinds = new Set(['ink', 'toner']);
const statuses = new Set(['unverified', 'verified', 'rejected']);

export async function importFile(database: CartridgeDatabase, path: string, dryRun = false): Promise<ImportResult> {
  const text = await readFile(path, 'utf8');
  const raw = path.toLowerCase().endsWith('.json')
    ? JSON.parse(text) as unknown
    : parse(text, { columns: true, skip_empty_lines: true, trim: true }) as unknown;
  if (!Array.isArray(raw)) throw new Error('Import root must be an array of records');
  return importRecords(database, raw, dryRun);
}

export function importRecords(database: CartridgeDatabase, rawRows: unknown[], dryRun = false): ImportResult {
  const issues: ValidationIssue[] = [];
  const records = rawRows.map((raw, index) => coerceAndValidate(raw, index + 1, issues));
  if (issues.length) return { valid: false, dryRun, rows: rawRows.length, written: 0, issues };
  if (dryRun) return { valid: true, dryRun: true, rows: records.length, written: 0, issues: [] };
  database.transaction(() => records.forEach((record) => database.writeImportRecord(record!)));
  return { valid: true, dryRun: false, rows: records.length, written: records.length, issues: [] };
}

function coerceAndValidate(raw: unknown, row: number, issues: ValidationIssue[]): ImportRecord | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({ row, message: 'Record must be an object' });
    return undefined;
  }
  const value = raw as Record<string, unknown>;
  const requiredText = (field: string): string => {
    const result = value[field];
    if (typeof result !== 'string' || !result.trim()) issues.push({ row, field, message: 'Required non-empty string' });
    return typeof result === 'string' ? result.trim() : '';
  };
  const printerManufacturer = requiredText('printerManufacturer');
  const printerModel = requiredText('printerModel');
  const hasReplaceableCartridges = toBoolean(value.hasReplaceableCartridges, true, row, 'hasReplaceableCartridges', issues);
  const record: ImportRecord = { printerManufacturer, printerModel, hasReplaceableCartridges };
  if (!hasReplaceableCartridges) return record;

  record.cartridgeManufacturer = requiredText('cartridgeManufacturer');
  record.cartridgePartNumber = requiredText('cartridgePartNumber');
  record.cartridgeKind = requiredText('cartridgeKind') as ImportRecord['cartridgeKind'];
  record.sourceName = requiredText('sourceName');
  record.sourceUrl = requiredText('sourceUrl');
  record.verificationStatus = requiredText('verificationStatus') as ImportRecord['verificationStatus'];
  record.region = requiredText('region');
  record.isGenuineOem = toBoolean(value.isGenuineOem, true, row, 'isGenuineOem', issues);
  if (typeof value.cartridgeColor === 'string' && value.cartridgeColor.trim()) record.cartridgeColor = value.cartridgeColor.trim();
  if (!cartridgeKinds.has(record.cartridgeKind!)) issues.push({ row, field: 'cartridgeKind', message: 'Must be ink or toner; drums and other consumables are not supported' });
  if (!statuses.has(record.verificationStatus!)) issues.push({ row, field: 'verificationStatus', message: 'Must be unverified, verified, or rejected' });
  if (record.sourceUrl) {
    try { new URL(record.sourceUrl); } catch { issues.push({ row, field: 'sourceUrl', message: 'Must be a valid absolute URL' }); }
  }
  return record;
}

function toBoolean(value: unknown, defaultValue: boolean, row: number, field: string, issues: ValidationIssue[]): boolean {
  if (value === undefined || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true' || value === 'TRUE') return true;
  if (value === 0 || value === '0' || value === 'false' || value === 'FALSE') return false;
  issues.push({ row, field, message: 'Must be a boolean' });
  return defaultValue;
}
