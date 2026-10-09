import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import type { ImportRecord } from '../types.js';
import { collectPages, type CollectorOptions, type CollectorRuntime } from './page-collector.js';

export const XEROX_SEEDS = ['https://www.xerox.es/es-es/supplies-and-accessories/106R03530/versalink-c400'];
const profiles = new Map([
  ['https://www.xerox.es/es-es', 'ES'],
  ['https://www.xerox.com/en-ie', 'IE'],
]);
const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const text = (value: unknown): string => typeof value === 'string' ? clean(value) : '';

export function xeroxSupplyUrl(value: string): { canonical: string; sku: string; region: string; base: string } | undefined {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return undefined;
    const match = /^\/(es-es|en-ie)\/supplies-and-accessories\/([A-Z0-9]+)(?:\/[a-z0-9-]+)?$/.exec(url.pathname);
    if (!match) return undefined;
    const base = `${url.origin}/${match[1]}`;
    const region = profiles.get(base);
    if (!region) return undefined;
    return { canonical: `${base}/supplies-and-accessories/${match[2]}`, sku: match[2], region, base };
  } catch { return undefined; }
}

export interface XeroxIssue { url: string; reason: string; detail?: string }
export interface XeroxPage { records: ImportRecord[]; links: string[]; review: XeroxIssue[]; excluded: XeroxIssue[] }
export function parseXeroxPage(html: string, sourceUrl: string, verifiedAt: string): XeroxPage {
  const result: XeroxPage = { records: [], links: [], review: [], excluded: [] };
  const review = (reason: string, detail?: string) => { result.review.push({ url: sourceUrl, reason, detail }); return result; };
  const source = xeroxSupplyUrl(sourceUrl);
  if (!source) return review('unsupported-source');
  if (Number.isNaN(Date.parse(verifiedAt))) return review('invalid-verification-date');
  const $ = load(html);
  if (/access denied|captcha|verify you are human/i.test($('title,h1').text())) return review('access-challenge');
  $('a[href]').each((_i, element) => {
    try {
      const url = new URL($(element).attr('href')!, sourceUrl).href;
      if (xeroxSupplyUrl(url)?.base === source.base) result.links.push(url);
    } catch { /* Not a usable discovery link. */ }
  });
  result.links = [...new Set(result.links)].sort();
  const hero = $('.xrx-fw-product-sku-hero__content');
  const sku = clean(hero.find('h1').text());
  const description = clean(hero.find('h3').text());
  const blurb = clean(hero.find('.xrx-fw-product-sku-hero__blurb').text());
  const productText = `${description} ${blurb}`;
  if (/everyday|non[- ]xerox|remanufactured|reconditioned|remanu?facturado|para (?:hp|brother|canon|epson|lexmark)|for (?:hp|brother|canon|epson|lexmark)/i.test(productText)) {
    result.excluded.push({ url: sourceUrl, reason: 'third-party-or-everyday', detail: description }); return result;
  }
  if (/\b(?:drum|tambor|waste|residuos|maintenance|mantenimiento|fuser|fusor|belt|correa|cleaning|limpieza|bottle|botella|refill|recarga|staples|grapas|imaging|printhead|kit)\b/i.test(description)) {
    result.excluded.push({ url: sourceUrl, reason: 'non-cartridge-product', detail: description }); return result;
  }
  const kind = /\b(?:toner|tóner)\b/i.test(description) ? 'toner' : /\b(?:ink|tinta)\b/i.test(description) ? 'ink' : undefined;
  if (hero.length !== 1 || sku !== source.sku || !kind || !/\b(?:cartridge|cartucho)\b/i.test(description)) return review('missing-or-uncertain-cartridge', description);
  if (!/Xerox Genuine Supplies|consumibles originales.*equipos Xerox/i.test(blurb)) return review('missing-genuine-xerox-evidence', blurb);
  const products: ObjectValue[] = [];
  let malformed = false;
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const item = object(value);
    if (item['@type'] === 'ProductModel' || item['@type'] === 'Product') products.push(item);
    if (item['@graph']) visit(item['@graph']);
  };
  $('script[type="application/ld+json"]').each((_i, element) => {
    try { visit(JSON.parse($(element).text())); } catch { malformed = true; }
  });
  if (malformed) return review('malformed-structured-data');
  const matches = products.filter(item => text(item.sku) === sku);
  if (matches.length !== 1) return review('missing-or-ambiguous-product-data');
  const product = matches[0];
  if (text(product.mpn) !== sku || text(object(product.manufacturer).name) !== 'Xerox'
      || text(object(product.brand).name) !== 'Xerox' || text(product.url) !== source.canonical
      || text(product.description) !== description) return review('conflicting-product-identity');
  const visible = new Set(hero.find('.xrx-fw-product-sku-hero__compatibility li').map((_i, item) => clean($(item).text())).get());
  if (!visible.size || !Array.isArray(product.isConsumableFor) || !product.isConsumableFor.length) return review('missing-explicit-compatibility');
  const compatible: string[] = [];
  for (const raw of product.isConsumableFor) {
    const printer = object(raw);
    const model = text(printer.name);
    let validUrl = false;
    try {
      const url = new URL(text(printer.url));
      validUrl = !url.search && !url.hash && !url.username && !url.password
        && (source.region === 'ES'
          ? /^https:\/\/www\.xerox\.es\/es-es\/oficina\/impresoras(?:-multifuncion)?\/[a-z0-9-]+$/.test(url.href)
          : /^https:\/\/www\.xerox\.com\/en-ie\/office\/(?:printers|multifunction-printers)\/[a-z0-9-]+$/.test(url.href));
    } catch { /* Quarantine ambiguous identities. */ }
    if (printer['@type'] !== 'Product' || !validUrl || !/\bXerox\b/.test(model) || !visible.has(model)) return review('conflicting-or-non-xerox-compatibility', model);
    compatible.push(model);
  }
  if (new Set(compatible).size !== visible.size) return review('incomplete-structured-compatibility');
  const colorWords: Record<string, string> = { black: 'black', negro: 'black', cyan: 'cyan', cian: 'cyan', magenta: 'magenta', yellow: 'yellow', amarillo: 'yellow' };
  const colors = [...new Set([...description.toLowerCase().matchAll(/\b(black|negro|cyan|cian|magenta|yellow|amarillo)\b/g)].map(match => colorWords[match[1]]))];
  const yieldMatch = /\(([\d., ]+)\s*(?:pages|páginas)\)/i.exec(description);
  const yieldPages = yieldMatch ? Number(yieldMatch[1].replace(/[., ]/g, '')) : undefined;
  for (const printerModel of [...new Set(compatible)]) {
    result.records.push({ printerManufacturer: 'Xerox', printerModel, hasReplaceableCartridges: true,
      cartridgeManufacturer: 'Xerox', cartridgePartNumber: sku, cartridgeKind: kind,
      ...(colors.length === 1 ? { cartridgeColor: colors[0] } : {}),
      ...(yieldPages && Number.isSafeInteger(yieldPages) ? { yieldPages } : {}),
      sourceName: `Xerox official supplies (${source.region})`, sourceUrl: source.canonical, region: source.region,
      isGenuineOem: true, verificationStatus: 'verified', sourceType: 'official-manufacturer',
      evidenceType: 'explicit-compatibility', verifiedAt,
      evidence: JSON.stringify({ sku, description, genuineStatement: blurb, compatibleWith: printerModel,
        isConsumableFor: product.isConsumableFor.filter(raw => text(object(raw).name) === printerModel) }),
    });
  }
  return result;
}

export type XeroxOptions = CollectorOptions;
export type XeroxRuntime = CollectorRuntime;
export async function collectXerox(options: XeroxOptions, runtime: XeroxRuntime = {}) {
  return collectPages({ name: 'xerox', seeds: XEROX_SEEDS, source: xeroxSupplyUrl, parse: parseXeroxPage }, options, runtime);
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2).filter(value => value !== '--');
  const values = new Map<string, string>(); const seeds: string[] = [];
  for (let i = 0; i < args.length; i += 2) {
    if (!['--output-dir', '--state', '--max-pages', '--delay-ms', '--retries', '--seed'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid option ${args[i]}`);
    if (args[i] === '--seed') seeds.push(args[i + 1]); else values.set(args[i], args[i + 1]);
  }
  const report = await collectXerox({ outputDirectory: values.get('--output-dir') ?? 'data/official/xerox',
    stateFile: values.get('--state') ?? '.collector-state/xerox.json',
    maxPages: Number(values.get('--max-pages') ?? 50), delayMs: Number(values.get('--delay-ms') ?? 10000),
    retries: Number(values.get('--retries') ?? 2), ...(seeds.length ? { seeds } : {}) });
  console.log(JSON.stringify({ ...report, pages: undefined }, null, 2));
  if (report.failures.length) process.exitCode = 1;
}
