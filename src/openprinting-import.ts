import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { CartridgeDatabase } from './database.js';
import { normalizeManufacturerName, normalizePrinterModel } from './normalize.js';

const SOURCE_NAME = 'OpenPrinting Foomatic DB';
const SOURCE_HOME = 'https://github.com/OpenPrinting/foomatic-db';
const DEFAULT_MANUFACTURERS = ['HP', 'Epson', 'Canon'];

export interface OpenPrintingOptions {
  manufacturers?: string[];
  allManufacturers?: boolean;
  sourceRevision?: string;
  region?: string;
}

export interface OpenPrintingRejection { file: string; reason: string; }
export interface OpenPrintingReport {
  dryRun: boolean;
  filesScanned: number;
  targetedFiles: number;
  validRecords: number;
  uniqueModels: number;
  duplicateInputModels: number;
  existingModels: number;
  insertedModels: number;
  sourceLinksAdded: number;
  characteristicsAdded: number;
  byManufacturer: Record<string, { valid: number; existing: number; inserted: number }>;
  rejected: OpenPrintingRejection[];
  warnings: string[];
}

interface Candidate {
  file: string;
  sourceUrl: string;
  make: string;
  manufacturer: string;
  model: string;
  sourceRecordId?: string;
  mechanism?: string;
  colorSupported?: boolean;
  maxResolutionX?: number;
  maxResolutionY?: number;
  languages: string[];
  characteristics: Record<string, unknown>;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: true, trimValues: true });

export function canonicalOpenPrintingManufacturer(value: string): string {
  const normalized = normalizeManufacturerName(value).replace(/[^A-Z0-9]/g, '');
  if (['HP', 'HEWLETTPACKARD', 'HEWLETTPACKARDCO', 'HEWLETTPACKARDCOMPANY'].includes(normalized)) return 'HP';
  if (['EPSON', 'SEIKOEPSON', 'SEIKOEPSONCORPORATION'].includes(normalized)) return 'Epson';
  if (['CANON', 'CANONINC', 'CANONINCORPORATED'].includes(normalized)) return 'Canon';
  return value.trim().replace(/\s+/g, ' ');
}

export function importOpenPrinting(database: CartridgeDatabase, inputPath: string, options: OpenPrintingOptions = {}, dryRun = false): OpenPrintingReport {
  const directory = resolvePrinterDirectory(inputPath);
  const files = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.xml')).map(entry => join(directory, entry.name)).sort();
  const wanted = new Set((options.manufacturers?.length ? options.manufacturers : DEFAULT_MANUFACTURERS).map(value => normalizeManufacturerName(canonicalOpenPrintingManufacturer(value))));
  const revision = (options.sourceRevision ?? 'master').replace(/[^A-Za-z0-9._-]/g, '') || 'master';
  const report: OpenPrintingReport = { dryRun, filesScanned: files.length, targetedFiles: 0, validRecords: 0, uniqueModels: 0, duplicateInputModels: 0, existingModels: 0, insertedModels: 0, sourceLinksAdded: 0, characteristicsAdded: 0, byManufacturer: {}, rejected: [], warnings: [] };
  const candidates: Candidate[] = [];

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const validation = XMLValidator.validate(raw);
    if (validation !== true) { report.rejected.push({ file: basename(file), reason: `invalid XML: ${validation.err.msg}` }); continue; }
    let root: Record<string, unknown>;
    try { root = parser.parse(raw) as Record<string, unknown>; }
    catch (error) { report.rejected.push({ file: basename(file), reason: `XML parse failed: ${message(error)}` }); continue; }
    const printer = asObject(root.printer);
    if (!printer) { report.rejected.push({ file: basename(file), reason: 'missing <printer> root' }); continue; }
    const make = text(printer.make);
    const model = text(printer.model);
    if (!make || !model) { report.rejected.push({ file: basename(file), reason: 'missing make or model' }); continue; }
    const manufacturer = canonicalOpenPrintingManufacturer(make);
    if (!options.allManufacturers && !wanted.has(normalizeManufacturerName(manufacturer))) continue;
    report.targetedFiles += 1;
    if (normalizePrinterModel(stripManufacturer(model, manufacturer)).length < 2) { report.rejected.push({ file: basename(file), reason: 'invalid or ambiguous model identifier' }); continue; }
    const mechanism = asObject(printer.mechanism);
    const resolution = asObject(asObject(mechanism?.resolution)?.dpi);
    const languages = Object.keys(asObject(printer.lang) ?? {}).filter(key => !key.startsWith('@_')).sort();
    const mechanismKinds = mechanism ? Object.keys(mechanism).filter(key => !['color', 'resolution'].includes(key) && !key.startsWith('@_')) : [];
    const sourceUrl = `${SOURCE_HOME}/blob/${revision}/db/source/printer/${encodeURIComponent(basename(file))}`;
    candidates.push({
      file: basename(file), sourceUrl, make, manufacturer, model: model.trim(), sourceRecordId: text(printer['@_id']) || undefined,
      mechanism: mechanismKinds[0], colorSupported: mechanism ? Object.hasOwn(mechanism, 'color') : undefined,
      maxResolutionX: positiveInteger(resolution?.x), maxResolutionY: positiveInteger(resolution?.y), languages,
      characteristics: { functionality: text(printer.functionality) || null, driver: text(printer.driver) || null, manufacturerUrl: text(printer.url) || null },
    });
  }

  const unique = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = candidateKey(candidate.manufacturer, candidate.model);
    const prior = unique.get(key);
    if (prior) {
      report.duplicateInputModels += 1;
      if (candidateRichness(candidate) > candidateRichness(prior)) unique.set(key, candidate);
      continue;
    }
    unique.set(key, candidate);
  }
  report.validRecords = candidates.length;
  report.uniqueModels = unique.size;

  const compatibilityBefore = compatibilityFingerprint(database);
  const operations = [...unique.values()].flatMap(candidate => {
    const match = findAliasedPrinter(database, candidate.manufacturer, candidate.model);
    if (match.ambiguous) {
      report.rejected.push({ file: candidate.file, reason: 'ambiguous existing manufacturer/model alias; manual review required' });
      return [];
    }
    return [{ candidate, existing: match.existing }];
  });
  for (const { candidate, existing } of operations) {
    const bucket = report.byManufacturer[candidate.manufacturer] ??= { valid: 0, existing: 0, inserted: 0 };
    bucket.valid += 1;
    if (existing) { bucket.existing += 1; report.existingModels += 1; }
    else { bucket.inserted += 1; report.insertedModels += 1; }
  }
  if (dryRun) return report;

  database.transaction(() => {
    const sourceId = upsertSource(database);
    for (const operation of operations) {
      const { candidate } = operation;
      const printerId = operation.existing?.id ?? insertPrinter(database, candidate.manufacturer, candidate.model);
      const sourceChanges = database.db.prepare(`INSERT INTO printer_sources (printer_id,source_id,source_url,verification_status,region)
        VALUES (?,?,?,'unverified',?) ON CONFLICT(printer_id,source_url,region) DO NOTHING`).run(printerId, sourceId, candidate.sourceUrl, options.region ?? 'global').changes;
      report.sourceLinksAdded += sourceChanges;
      const hadCharacteristics = Boolean(database.db.prepare('SELECT id FROM printer_characteristics WHERE printer_id=? AND source_id=? AND source_reference=?').get(printerId, sourceId, candidate.sourceUrl));
      database.db.prepare(`INSERT INTO printer_characteristics
        (printer_id,source_id,source_reference,origin_type,raw_make,raw_model,source_record_id,mechanism,color_supported,max_resolution_x,max_resolution_y,languages_json,characteristics_json)
        VALUES (?,?,?,'open_dataset',?,?,?,?,?,?,?,?,?)
        ON CONFLICT(printer_id,source_id,source_reference) DO UPDATE SET
          imported_at=CURRENT_TIMESTAMP,raw_make=excluded.raw_make,raw_model=excluded.raw_model,source_record_id=excluded.source_record_id,
          mechanism=excluded.mechanism,color_supported=excluded.color_supported,max_resolution_x=excluded.max_resolution_x,
          max_resolution_y=excluded.max_resolution_y,languages_json=excluded.languages_json,characteristics_json=excluded.characteristics_json`).run(
          printerId, sourceId, candidate.sourceUrl, candidate.make, candidate.model, candidate.sourceRecordId ?? null,
          candidate.mechanism ?? null, candidate.colorSupported === undefined ? null : Number(candidate.colorSupported),
          candidate.maxResolutionX ?? null, candidate.maxResolutionY ?? null, JSON.stringify(candidate.languages), JSON.stringify(candidate.characteristics),
        );
      if (!hadCharacteristics) report.characteristicsAdded += 1;
    }
  });
  if (compatibilityFingerprint(database) !== compatibilityBefore) throw new Error('OpenPrinting import unexpectedly changed cartridge compatibility');
  return report;
}

function resolvePrinterDirectory(inputPath: string): string {
  const absolute = resolve(inputPath);
  const nested = join(absolute, 'db', 'source', 'printer');
  const directory = existsSync(nested) ? nested : absolute;
  if (!existsSync(directory)) throw new Error(`OpenPrinting path does not exist: ${inputPath}`);
  return directory;
}

function findAliasedPrinter(database: CartridgeDatabase, manufacturer: string, model: string): { existing?: { id: number }; ambiguous: boolean } {
  const aliases = manufacturerAliases(manufacturer);
  const modelKeys = new Set([normalizePrinterModel(model), normalizePrinterModel(stripManufacturer(model, manufacturer))]);
  const rows = database.db.prepare(`SELECT p.id,m.name AS manufacturer,p.model_name FROM printers p JOIN manufacturers m ON m.id=p.manufacturer_id`).all() as Array<{ id: number; manufacturer: string; model_name: string }>;
  const matches = rows.filter(row => aliases.has(normalizeManufacturerName(canonicalOpenPrintingManufacturer(row.manufacturer))) && modelKeys.has(normalizePrinterModel(stripManufacturer(row.model_name, manufacturer))));
  if (matches.length <= 1) return { existing: matches[0] ? { id: matches[0].id } : undefined, ambiguous: false };
  const canonical = matches.filter(row => normalizeManufacturerName(row.manufacturer) === normalizeManufacturerName(manufacturer));
  if (canonical.length === 1) return { existing: { id: canonical[0].id }, ambiguous: false };
  return { ambiguous: true };
}

function insertPrinter(database: CartridgeDatabase, manufacturer: string, model: string): number {
  const normalizedManufacturer = normalizeManufacturerName(manufacturer);
  database.db.prepare('INSERT INTO manufacturers(name,normalized_name) VALUES(?,?) ON CONFLICT(normalized_name) DO NOTHING').run(manufacturer, normalizedManufacturer);
  const manufacturerId = (database.db.prepare('SELECT id FROM manufacturers WHERE normalized_name=?').get(normalizedManufacturer) as { id: number }).id;
  const cleanModel = stripManufacturer(model, manufacturer);
  database.db.prepare(`INSERT INTO printers(manufacturer_id,model_name,normalized_model_name,has_replaceable_cartridges)
    VALUES(?,?,?,1) ON CONFLICT(manufacturer_id,normalized_model_name) DO NOTHING`).run(manufacturerId, cleanModel, normalizePrinterModel(cleanModel));
  return (database.db.prepare('SELECT id FROM printers WHERE manufacturer_id=? AND normalized_model_name=?').get(manufacturerId, normalizePrinterModel(cleanModel)) as { id: number }).id;
}

function upsertSource(database: CartridgeDatabase): number {
  database.db.prepare(`INSERT INTO data_sources(name,url,source_category) VALUES(?,?,'open_dataset')
    ON CONFLICT(url) DO UPDATE SET name=excluded.name,source_category=CASE WHEN data_sources.source_category='official' THEN 'official' ELSE 'open_dataset' END,updated_at=CURRENT_TIMESTAMP`).run(SOURCE_NAME, SOURCE_HOME);
  return (database.db.prepare('SELECT id FROM data_sources WHERE url=?').get(SOURCE_HOME) as { id: number }).id;
}

function stripManufacturer(model: string, manufacturer: string): string {
  const prefixes = manufacturer === 'HP' ? ['Hewlett-Packard', 'Hewlett Packard', 'HP'] : manufacturer === 'Epson' ? ['Seiko Epson', 'Epson'] : [manufacturer];
  let value = model.trim();
  for (const prefix of prefixes) value = value.replace(new RegExp(`^${escapeRegExp(prefix)}[\\s_-]+`, 'i'), '');
  return value.trim();
}
function manufacturerAliases(manufacturer: string): Set<string> { return new Set([manufacturer, canonicalOpenPrintingManufacturer(manufacturer)].map(normalizeManufacturerName)); }
function candidateKey(manufacturer: string, model: string): string { return `${normalizeManufacturerName(canonicalOpenPrintingManufacturer(manufacturer))}|${normalizePrinterModel(stripManufacturer(model, manufacturer))}`; }
function compatibilityFingerprint(database: CartridgeDatabase): string { const row = database.db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(id),0) AS ids,COALESCE(SUM(CASE WHEN reliability_status='official_verified' THEN 1 ELSE 0 END),0) AS verified FROM compatibility`).get() as Record<string, number>; return JSON.stringify(row); }
function asObject(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function text(value: unknown): string { return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''; }
function positiveInteger(value: unknown): number | undefined { const parsed = Number(text(value)); return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined; }
function candidateRichness(candidate: Candidate): number { return Number(Boolean(candidate.mechanism)) + Number(candidate.colorSupported !== undefined) + Number(Boolean(candidate.maxResolutionX)) + Number(Boolean(candidate.maxResolutionY)) + candidate.languages.length + Object.values(candidate.characteristics).filter(Boolean).length; }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export const OPENPRINTING_SOURCE_URL = SOURCE_HOME;
