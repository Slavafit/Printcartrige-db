import { readFile } from 'node:fs/promises';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { CartridgeDatabase } from './database.js';
import { normalizePrinterModel } from './normalize.js';

const OFFICIAL_HOST = 'store.brother.es';
const PRINTER_CATEGORIES = new Set(['laser', 'inkjet', 'fax']);

export interface BrotherPrinterCandidate {
  modelName: string;
  modelIdentifier: string;
  normalizedModel: string;
  sourceUrl: string;
}

export interface RejectedBrotherUrl { url: string; reason: string }
export interface DuplicateBrotherModel { normalizedModel: string; keptUrl: string; duplicateUrl: string }

export interface BrotherSitemapReport {
  totalSitemapUrls: number;
  matchingDevicePages: number;
  validPrinterCandidates: number;
  uniqueNormalizedModels: number;
  duplicateUrls: number;
  duplicateModelIdentifiers: number;
  rejectedUrls: RejectedBrotherUrl[];
  duplicateModels: DuplicateBrotherModel[];
  candidates: BrotherPrinterCandidate[];
}

export interface BrotherImportResult extends Omit<BrotherSitemapReport, 'candidates'> {
  dryRun: boolean;
  modelsAlreadyPresent: number;
  modelsWouldBeInserted: number;
  insertedModels: number;
  existingModels: number;
  errors: string[];
  totalBrotherModelsAfterImport: number;
}

export function parseBrotherSitemap(xml: string): BrotherSitemapReport {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    const details = typeof validation === 'object' && 'err' in validation ? validation.err.msg : 'unknown XML error';
    throw new Error(`Invalid sitemap XML: ${details}`);
  }
  const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true }).parse(xml) as {
    urlset?: { url?: Array<{ loc?: unknown }> | { loc?: unknown } };
  };
  const rawEntries = parsed.urlset?.url;
  const entries = rawEntries ? (Array.isArray(rawEntries) ? rawEntries : [rawEntries]) : [];
  const locations = entries.map((entry) => entry.loc).filter((loc): loc is string => typeof loc === 'string');
  if (entries.length > 0 && locations.length !== entries.length) throw new Error('Invalid sitemap XML: every url entry must contain one text loc element');
  const matchingDevicePages = locations.filter(isOfficialDeviceUrl).length;

  const seenUrls = new Set<string>();
  const uniqueUrls: string[] = [];
  let duplicateUrls = 0;
  for (const location of locations) {
    const url = location.trim();
    if (seenUrls.has(url)) duplicateUrls += 1;
    else { seenUrls.add(url); uniqueUrls.push(url); }
  }

  const rejectedUrls: RejectedBrotherUrl[] = [];
  const validCandidates: BrotherPrinterCandidate[] = [];
  for (const sourceUrl of uniqueUrls) {
    let url: URL;
    try { url = new URL(sourceUrl); }
    catch { rejectedUrls.push({ url: sourceUrl, reason: 'invalid-url' }); continue; }
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== OFFICIAL_HOST) {
      rejectedUrls.push({ url: sourceUrl, reason: 'non-brother-domain' });
      continue;
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] !== 'devices') {
      rejectedUrls.push({ url: sourceUrl, reason: 'not-device-path' });
      continue;
    }
    const category = segments[1]?.toLowerCase();
    if (!category || !PRINTER_CATEGORIES.has(category)) {
      rejectedUrls.push({ url: sourceUrl, reason: `unsupported-device-category:${category || 'missing'}` });
      continue;
    }
    if (segments.length < 3 || !segments.at(-1)) {
      rejectedUrls.push({ url: sourceUrl, reason: 'missing-model-slug' });
      continue;
    }
    let slug: string;
    try { slug = decodeURIComponent(segments.at(-1)!).toLowerCase(); }
    catch { rejectedUrls.push({ url: sourceUrl, reason: 'invalid-model-slug-encoding' }); continue; }
    if (slug.includes('bundle')) {
      rejectedUrls.push({ url: sourceUrl, reason: 'ambiguous-bundle-slug' });
      continue;
    }
    const modelIdentifier = modelIdentifierFromSlug(slug);
    if (!modelIdentifier) {
      rejectedUrls.push({ url: sourceUrl, reason: 'unrecognized-model-slug' });
      continue;
    }
    const modelName = `Brother ${modelIdentifier}`;
    validCandidates.push({ modelName, modelIdentifier, normalizedModel: normalizePrinterModel(modelName), sourceUrl });
  }

  const candidates: BrotherPrinterCandidate[] = [];
  const models = new Map<string, BrotherPrinterCandidate>();
  const duplicateModels: DuplicateBrotherModel[] = [];
  for (const candidate of validCandidates) {
    const existing = models.get(candidate.normalizedModel);
    if (existing) duplicateModels.push({ normalizedModel: candidate.normalizedModel, keptUrl: existing.sourceUrl, duplicateUrl: candidate.sourceUrl });
    else { models.set(candidate.normalizedModel, candidate); candidates.push(candidate); }
  }

  return {
    totalSitemapUrls: locations.length,
    matchingDevicePages,
    validPrinterCandidates: validCandidates.length,
    uniqueNormalizedModels: candidates.length,
    duplicateUrls,
    duplicateModelIdentifiers: duplicateModels.length,
    rejectedUrls,
    duplicateModels,
    candidates,
  };
}

export async function importBrotherSitemap(database: CartridgeDatabase, path: string, dryRun: boolean): Promise<BrotherImportResult> {
  const report = parseBrotherSitemap(await readFile(path, 'utf8'));
  const existing = report.candidates.filter((candidate) => database.findPrinter('Brother', candidate.modelName));
  const newCandidates = report.candidates.filter((candidate) => !database.findPrinter('Brother', candidate.modelName));
  const errors: string[] = [];
  let insertedModels = 0;

  if (!dryRun) {
    try {
      database.transaction(() => {
        for (const candidate of report.candidates) {
          const result = database.upsertPrinterSource({
            manufacturerName: 'Brother',
            modelName: candidate.modelName,
            sourceName: 'Brother España official product page',
            sourceUrl: candidate.sourceUrl,
            verificationStatus: 'unverified',
            region: 'ES',
          });
          if (result.inserted) insertedModels += 1;
        }
      });
    } catch (error) {
      insertedModels = 0;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    totalSitemapUrls: report.totalSitemapUrls,
    matchingDevicePages: report.matchingDevicePages,
    validPrinterCandidates: report.validPrinterCandidates,
    uniqueNormalizedModels: report.uniqueNormalizedModels,
    duplicateUrls: report.duplicateUrls,
    duplicateModelIdentifiers: report.duplicateModelIdentifiers,
    dryRun,
    modelsAlreadyPresent: existing.length,
    modelsWouldBeInserted: newCandidates.length,
    insertedModels,
    existingModels: dryRun ? existing.length : report.uniqueNormalizedModels - insertedModels,
    errors,
    totalBrotherModelsAfterImport: database.countPrintersByManufacturer('Brother'),
    rejectedUrls: report.rejectedUrls,
    duplicateModels: report.duplicateModels,
  };
}

function modelIdentifierFromSlug(slug: string): string | undefined {
  const match = /^(hl|dcp|mfc|fax)([a-z]?)(\d+[a-z0-9]*)$/.exec(slug);
  if (!match) return undefined;
  return `${match[1].toUpperCase()}-${match[2].toUpperCase()}${match[3].toUpperCase()}`;
}

function isOfficialDeviceUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname.toLowerCase() === OFFICIAL_HOST && url.pathname.startsWith('/devices/');
  } catch { return false; }
}
