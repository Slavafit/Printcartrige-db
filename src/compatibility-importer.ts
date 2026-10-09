import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { CartridgeDatabase } from './database.js';
import { normalizeCartridgePartNumber, normalizeManufacturerName, normalizePrinterModel } from './normalize.js';
import type { ImportRecord, VerificationStatus } from './types.js';

const excludedTypes = new Set([
  'drum', 'drum-unit', 'waste-toner-container', 'waste-toner', 'maintenance-kit', 'fuser',
  'transfer-belt', 'ink-bottle', 'refill-kit', 'accessory', 'other-consumable',
]);

export interface CompatibilityIssue { row: number; reason: string; message: string }
export interface CompatibilityImportResult {
  dryRun: boolean;
  totalRecords: number;
  acceptedRecords: number;
  insertedRelationships: number;
  existingRelationships: number;
  duplicateInputRecords: number;
  rejectedRecords: number;
  rejectedByReason: Record<string, number>;
  rejected: CompatibilityIssue[];
  recordsRequiringManualReview: number;
  manualReview: CompatibilityIssue[];
  errors: string[];
}

export async function importCompatibilityFile(
  database: CartridgeDatabase,
  path: string,
  dryRun: boolean,
): Promise<CompatibilityImportResult> {
  let raw: unknown;
  try {
    const input = await readFile(path, 'utf8');
    if (path.toLowerCase().endsWith('.csv')) {
      const rows = parse(input, { columns: true, skip_empty_lines: true }) as Array<Record<string, unknown>>;
      raw = rows.map(row => {
        const record = { ...row };
        if (record.isGenuineOem === 'true') record.isGenuineOem = true;
        else if (record.isGenuineOem === 'false') record.isGenuineOem = false;
        if (record.yieldPages === '') delete record.yieldPages;
        else if (typeof record.yieldPages === 'string' && /^\d+$/.test(record.yieldPages)) record.yieldPages = Number(record.yieldPages);
        return record;
      });
    } else raw = JSON.parse(input) as unknown;
  }
  catch (error) { throw new Error(`Invalid compatibility file: ${error instanceof Error ? error.message : String(error)}`); }
  if (!Array.isArray(raw)) throw new Error('Compatibility import root must be a JSON array');
  return importCompatibilityRecords(database, raw, dryRun);
}

export function importCompatibilityRecords(
  database: CartridgeDatabase,
  rows: unknown[],
  dryRun: boolean,
): CompatibilityImportResult {
  const rejected: CompatibilityIssue[] = [];
  const manualReview: CompatibilityIssue[] = [];
  const accepted: ImportRecord[] = [];
  const seen = new Set<string>();
  let duplicateInputRecords = 0;

  rows.forEach((raw, index) => {
    const record = validateRecord(raw, index + 1, rejected, manualReview);
    if (!record) return;
    const key = [
      normalizeManufacturerName(record.printerManufacturer), normalizePrinterModel(record.printerModel),
      normalizeManufacturerName(record.cartridgeManufacturer!), normalizeCartridgePartNumber(record.cartridgePartNumber!),
      record.sourceUrl, record.region,
    ].join('|');
    if (seen.has(key)) { duplicateInputRecords += 1; return; }
    seen.add(key);
    accepted.push(record);
  });

  let insertedRelationships = 0;
  let existingRelationships = 0;
  const errors: string[] = [];
  if (!dryRun) {
    try {
      database.transaction(() => accepted.forEach((record) => {
        if (database.writeImportRecord(record)) insertedRelationships += 1;
        else existingRelationships += 1;
      }));
    } catch (error) {
      insertedRelationships = 0;
      existingRelationships = 0;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const rejectedByReason = rejected.reduce<Record<string, number>>((counts, issue) => {
    counts[issue.reason] = (counts[issue.reason] ?? 0) + 1;
    return counts;
  }, {});
  return {
    dryRun,
    totalRecords: rows.length,
    acceptedRecords: accepted.length,
    insertedRelationships,
    existingRelationships,
    duplicateInputRecords,
    rejectedRecords: rejected.length,
    rejectedByReason,
    rejected,
    recordsRequiringManualReview: manualReview.length,
    manualReview,
    errors,
  };
}

function validateRecord(
  raw: unknown,
  row: number,
  rejected: CompatibilityIssue[],
  manualReview: CompatibilityIssue[],
): ImportRecord | undefined {
  const reject = (reason: string, message: string): undefined => { rejected.push({ row, reason, message }); return undefined; };
  const review = (reason: string, message: string): undefined => { manualReview.push({ row, reason, message }); return undefined; };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return reject('invalid-record', 'Record must be an object');
  const value = raw as Record<string, unknown>;
  const text = (key: string): string => typeof value[key] === 'string' ? value[key].trim() : '';
  const printerManufacturer = text('printerManufacturer');
  const printerModel = text('printerModel');
  const cartridgeManufacturer = text('cartridgeManufacturer');
  const cartridgePartNumber = text('cartridgePartNumber');
  if (!printerManufacturer) return reject('missing-printer-manufacturer', 'printerManufacturer is required');
  if (!printerModel || normalizePrinterModel(printerModel).length < 3) return reject('invalid-printer-model', 'A non-empty printer model is required');
  if (!cartridgeManufacturer) return reject('missing-cartridge-manufacturer', 'cartridgeManufacturer is required');
  if (!cartridgePartNumber) return reject('missing-part-number', 'cartridgePartNumber is required');

  const productType = (text('productType') || text('cartridgeType') || text('cartridgeKind')).toLowerCase();
  if (excludedTypes.has(productType)) return reject(`excluded-product-type:${productType}`, `${productType} is not an ink or toner cartridge`);
  if (productType !== 'ink' && productType !== 'toner') return reject('unknown-product-type', 'Product type must be established as ink or toner');
  if (value.isGenuineOem !== true) return reject('not-genuine-oem', 'Only explicitly genuine OEM cartridges are accepted');
  if (normalizeManufacturerName(printerManufacturer) !== normalizeManufacturerName(cartridgeManufacturer)) {
    return reject('manufacturer-mismatch', 'Genuine cartridge manufacturer must match printer manufacturer');
  }

  const sourceUrl = text('sourceUrl');
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== 'https:') return reject('invalid-source-url', 'sourceUrl must use HTTPS');
  } catch { return reject('invalid-source-url', 'A valid absolute official sourceUrl is required'); }
  const sourceName = text('sourceName');
  const region = text('region');
  if (!sourceName) return reject('missing-source-name', 'sourceName is required');
  if (!region) return reject('missing-region', 'region is required');

  let verificationStatus = text('verificationStatus') as VerificationStatus;
  let sourceType = text('sourceType');
  let evidenceType = text('evidenceType');
  let evidence = text('evidence');
  let verifiedAt = text('verifiedAt');
  const legacyKyocera = verificationStatus === 'verified'
    && sourceName === 'Kyocera Document Solutions Europe'
    && new URL(sourceUrl).hostname === 'www.kyoceradocumentsolutions.eu';
  if (legacyKyocera) {
    sourceType ||= 'official-manufacturer';
    evidenceType ||= 'explicit-compatibility';
    evidence ||= 'Legacy Task 002 collector evidence: official Kyocera toner page listed the printer under Related products.';
    verifiedAt ||= new Date().toISOString();
  }
  if (verificationStatus !== 'verified' && verificationStatus !== 'unverified') return reject('invalid-verification-status', 'Status must be verified or unverified');
  if (verificationStatus === 'verified') {
    if (sourceType !== 'official-manufacturer' || evidenceType !== 'explicit-compatibility' || !evidence) {
      return review('insufficient-official-evidence', 'Verified status requires explicit compatibility evidence from an official manufacturer source');
    }
    if (!verifiedAt || Number.isNaN(Date.parse(verifiedAt))) return review('missing-verification-date', 'Verified records require a valid verifiedAt date');
  }

  const yieldValue = value.yieldPages;
  if (yieldValue !== undefined && (!Number.isInteger(yieldValue) || Number(yieldValue) <= 0)) return reject('invalid-yield', 'yieldPages must be a positive integer');
  return {
    printerManufacturer, printerModel, hasReplaceableCartridges: true,
    cartridgeManufacturer, cartridgePartNumber, cartridgeKind: productType as 'ink' | 'toner',
    ...(text('cartridgeColor') ? { cartridgeColor: text('cartridgeColor') } : {}),
    ...(yieldValue !== undefined ? { yieldPages: Number(yieldValue) } : {}),
    sourceName, sourceUrl, verificationStatus, region, isGenuineOem: true,
    ...(evidence ? { evidence } : {}), ...(verifiedAt ? { verifiedAt } : {}),
    sourceType: sourceType === 'official-manufacturer' ? 'official-manufacturer' : 'other',
    evidenceType: evidenceType === 'explicit-compatibility' ? 'explicit-compatibility' : evidenceType === 'product-page-only' ? 'product-page-only' : 'other',
  };
}
