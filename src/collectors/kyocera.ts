import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import { stringify } from 'csv-stringify/sync';
import { CartridgeDatabase } from '../database.js';
import { importRecords } from '../importer.js';
import { normalizeCartridgePartNumber, normalizePrinterModel } from '../normalize.js';
import type { ImportRecord } from '../types.js';

export const KYOCERA_SITEMAP = 'https://www.kyoceradocumentsolutions.eu/sitemap.xml';
export const COLLECTOR_USER_AGENT = 'PrintcartridgeDB/0.1 (+https://github.com/Slavafit/Printcartrige-db)';

export interface KyoceraCollectorOptions {
  sitemapUrl?: string;
  jsonOutput: string;
  csvOutput: string;
  stateFile: string;
  maxModels?: number;
  delayMs?: number;
  retries?: number;
}

interface CollectorFailure { url: string; error: string }
interface CollectorState { completedUrls: string[]; records: ImportRecord[]; failures?: CollectorFailure[] }
export interface CollectionSummary { models: number; relationships: number; pagesVisited: number; failedPages: number; resumed: boolean }

export function parseKyoceraConsumablePage(html: string, sourceUrl: string): ImportRecord[] {
  const $ = load(html);
  const partNumber = $('.l-product-information__title').first().text().trim();
  const description = $('.l-product-information__text').first().text().replace(/\s+/g, ' ').trim();
  if (!/^TK-?\d/i.test(partNumber) || !/\btoner(?:-kit| kit| cartridge|\b)/i.test(`${description} ${$('meta[name="description"]').attr('content') ?? ''}`)) return [];

  const color = extractColor(`${partNumber} ${description}`);
  const records: ImportRecord[] = [];
  $('.kdc-pitem').each((_index, element) => {
    const card = $(element);
    const printerModel = card.find('.cmp-teaser__title').first().text().replace(/\s+/g, ' ').trim();
    const imageAlt = card.find('img').first().attr('alt') ?? '';
    const href = card.find('a[href]').first().attr('href') ?? '';
    const isPrinter = /\bPrinter\b/i.test(imageAlt) || /\/products\/(?:printers|multifunctionals|mfp)\//i.test(href);
    if (!printerModel || !isPrinter || /^TK-?\d/i.test(printerModel)) return;
    records.push({
      printerManufacturer: 'Kyocera',
      printerModel,
      hasReplaceableCartridges: true,
      cartridgeManufacturer: 'Kyocera',
      cartridgePartNumber: partNumber,
      cartridgeKind: 'toner',
      ...(color ? { cartridgeColor: color } : {}),
      sourceName: 'Kyocera Document Solutions Europe',
      sourceUrl,
      verificationStatus: 'verified',
      region: 'EU',
      isGenuineOem: true,
      sourceType: 'official-manufacturer',
      evidenceType: 'explicit-compatibility',
      evidence: 'Official Kyocera Europe toner page explicitly lists this printer under Related products.',
      verifiedAt: new Date().toISOString(),
    });
  });
  return deduplicate(records);
}

export async function collectKyocera(
  options: KyoceraCollectorOptions,
  fetcher: typeof fetch = fetch,
): Promise<CollectionSummary> {
  const maxModels = Math.min(Math.max(options.maxModels ?? 200, 1), 200);
  const delayMs = Math.max(options.delayMs ?? 500, 0);
  const retries = Math.max(options.retries ?? 3, 0);
  const previous = await readState(options.stateFile);
  const state: CollectorState = previous ?? { completedUrls: [], records: [] };
  const completed = new Set(state.completedUrls);
  const failures = state.failures ?? [];
  let records = deduplicate(state.records);
  const initialCompleted = completed.size;
  let lastRequestAt = 0;

  const request = async (url: string): Promise<string> => {
    const wait = delayMs - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    const text = await fetchWithRetries(url, retries, fetcher);
    lastRequestAt = Date.now();
    return text;
  };

  const sitemap = await request(options.sitemapUrl ?? KYOCERA_SITEMAP);
  const urls = parseSitemap(sitemap);
  for (const url of urls) {
    if (uniqueModelCount(records) >= maxModels) break;
    if (completed.has(url)) continue;
    try {
      const pageRecords = parseKyoceraConsumablePage(await request(url), url);
      records = appendWithinModelLimit(records, pageRecords, maxModels);
    } catch (error) {
      failures.push({ url, error: error instanceof Error ? error.message : String(error) });
      console.warn(`Skipping ${url}: ${failures.at(-1)!.error}`);
    }
    completed.add(url);
    await writeState(options.stateFile, { completedUrls: [...completed], records, failures });
  }

  const database = new CartridgeDatabase(':memory:');
  try {
    database.initialize();
    const validation = importRecords(database, records, true);
    if (!validation.valid) throw new Error(`Collector produced invalid records: ${JSON.stringify(validation.issues)}`);
  } finally {
    database.close();
  }

  await writeOutputs(options.jsonOutput, options.csvOutput, records);
  return {
    models: uniqueModelCount(records),
    relationships: records.length,
    pagesVisited: completed.size,
    failedPages: failures.length,
    resumed: initialCompleted > 0,
  };
}

export function parseSitemap(xml: string): string[] {
  const urls = [...xml.matchAll(/<loc>\s*(https:\/\/www\.kyoceradocumentsolutions\.eu\/en\/products\/consumables\/[^<]+\.html)\s*<\/loc>/gi)]
    .map((match) => decodeXml(match[1]))
    .filter((url) => /^TK-?\d/i.test(url.split('/').at(-1) ?? ''));
  return [...new Set(urls)].sort();
}

async function fetchWithRetries(url: string, retries: number, fetcher: typeof fetch): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetcher(url, { headers: { 'user-agent': COLLECTOR_USER_AGENT, accept: 'text/html,application/xml' } });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(250 * (2 ** attempt));
    }
  }
  throw new Error(`Failed to fetch ${url} after ${retries + 1} attempt(s)`, { cause: lastError });
}

function extractColor(text: string): string | undefined {
  for (const color of ['black', 'cyan', 'magenta', 'yellow']) {
    if (new RegExp(`\\b${color}\\b`, 'i').test(text)) return color;
  }
  return undefined;
}

function deduplicate(records: ImportRecord[]): ImportRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = `${normalizePrinterModel(record.printerModel)}|${normalizeCartridgePartNumber(record.cartridgePartNumber ?? '')}|${record.sourceUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function appendWithinModelLimit(existing: ImportRecord[], additions: ImportRecord[], limit: number): ImportRecord[] {
  const result = [...existing];
  const models = new Set(existing.map((record) => normalizePrinterModel(record.printerModel)));
  for (const record of additions) {
    const model = normalizePrinterModel(record.printerModel);
    if (!models.has(model) && models.size >= limit) continue;
    models.add(model);
    result.push(record);
  }
  return deduplicate(result);
}

function uniqueModelCount(records: ImportRecord[]): number {
  return new Set(records.map((record) => normalizePrinterModel(record.printerModel))).size;
}

async function readState(path: string): Promise<CollectorState | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as CollectorState; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function writeState(path: string, state: CollectorState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

async function writeOutputs(jsonPath: string, csvPath: string, records: ImportRecord[]): Promise<void> {
  await mkdir(dirname(jsonPath), { recursive: true });
  await mkdir(dirname(csvPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  await writeFile(csvPath, stringify(records, { header: true }), 'utf8');
}

function decodeXml(value: string): string {
  return value.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
}

function sleep(ms: number): Promise<void> { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const outputDirectory = argument('--output-dir', 'data/official');
  const summary = await collectKyocera({
    sitemapUrl: argument('--sitemap', KYOCERA_SITEMAP),
    jsonOutput: resolve(outputDirectory, 'kyocera-eu.json'),
    csvOutput: resolve(outputDirectory, 'kyocera-eu.csv'),
    stateFile: resolve(argument('--state', '.collector-state/kyocera-eu.json')),
    maxModels: Number(argument('--max-models', '200')),
    delayMs: Number(argument('--delay-ms', '500')),
    retries: Number(argument('--retries', '3')),
  });
  console.log(JSON.stringify(summary, null, 2));
}
