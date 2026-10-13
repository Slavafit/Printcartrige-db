import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import type { ImportRecord } from '../types.js';
import { collectPages, type CollectorOptions, type CollectorRuntime, type ParsedPage } from './page-collector.js';

export const LEXMARK_SITEMAP = 'https://www.lexmark.com/es_es/sitemap.xml';
const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

export function lexmarkSource(value: string): { canonical: string; type: 'sitemap' | 'printer' } | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'www.lexmark.com' || url.username || url.password || url.search || url.hash) return undefined;
    if (url.pathname.toLowerCase() === '/es_es/sitemap.xml') return { canonical: LEXMARK_SITEMAP, type: 'sitemap' };
    const match = /^\/es_es\/printers\/printer\/(\d+)\/([A-Za-z0-9-]+)\/?$/.exec(url.pathname);
    if (!match) return undefined;
    return { canonical: `https://www.lexmark.com/es_es/printers/printer/${match[1]}/${match[2]}`, type: 'printer' };
  } catch { return undefined; }
}

export function parseLexmarkPage(content: string, sourceUrl: string, verifiedAt: string): ParsedPage {
  const result: ParsedPage = { records: [], links: [], review: [], excluded: [] };
  const source = lexmarkSource(sourceUrl);
  if (!source) { result.review.push({ url: sourceUrl, reason: 'unsupported-source' }); return result; }
  if (source.type === 'sitemap') {
    const $ = load(content, { xmlMode: true });
    result.links = [...new Set($('loc').map((_index, element) => clean($(element).text())).get()
      .map(value => lexmarkSource(value)).filter((value): value is NonNullable<typeof value> => value?.type === 'printer').map(value => value.canonical))].sort();
    if (!result.links.length) result.review.push({ url: sourceUrl, reason: 'sitemap-has-no-printer-pages' });
    return result;
  }
  if (Number.isNaN(Date.parse(verifiedAt))) { result.review.push({ url: sourceUrl, reason: 'invalid-verification-date' }); return result; }
  const $ = load(content);
  if (/access denied|captcha|verify you are human|acceso denegado/i.test($('title,h1').text())) {
    result.review.push({ url: sourceUrl, reason: 'access-challenge' }); return result;
  }
  const heading = clean($('h1.product-name').first().text());
  const printerModel = heading.replace(/^Lexmark\s+/i, '');
  if (!heading.toLowerCase().startsWith('lexmark ') || !printerModel) {
    result.review.push({ url: sourceUrl, reason: 'missing-or-invalid-printer-model', detail: heading }); return result;
  }
  const pageText = clean($.root().text());
  const seen = new Set<string>();
  $('#DataTables_Table_returnSupplies tbody tr, #DataTables_Table_standardSupplies tbody tr').each((_index, element) => {
    const row = $(element); const cells = row.find('td');
    const description = clean(cells.eq(0).text());
    const partNumber = clean(cells.eq(1).text()).toUpperCase();
    const attributePartNumber = clean(row.attr('data-pn') ?? '').toUpperCase();
    const href = cells.eq(0).find('a[href]').first().attr('href') ?? '';
    let officialSupplyLink = false;
    try { officialSupplyLink = /^https:\/\/www\.lexmark\.com\/es_es\/printers\/supply\/\d+\/[A-Za-z0-9-]+\/?$/.test(new URL(href, source.canonical).href); } catch { /* invalid link */ }
    if (!description || !/^[A-Z0-9-]{3,32}$/.test(partNumber) || partNumber !== attributePartNumber || !officialSupplyLink) {
      result.review.push({ url: source.canonical, reason: 'invalid-cartridge-row', detail: `${partNumber}: ${description}` }); return;
    }
    if (/\b(?:unidad de imagen|kit de imagen|tambor|contenedor de residuos|fusor|correa|grapas|revelador|mantenimiento|imaging|drum|waste|fuser|belt|staples|developer)\b/i.test(description)) {
      result.excluded.push({ url: source.canonical, reason: 'non-cartridge-product', detail: `${partNumber}: ${description}` }); return;
    }
    let kind: 'toner' | 'ink' | undefined;
    if (/\bt[oó]ner\b/i.test(description)) kind = 'toner';
    else if (/\b(?:tinta|inyecci[oó]n de tinta)\b/i.test(description)) kind = 'ink';
    else if (/\bcartucho de (?:impresi[oó]n|impresora)\b/i.test(description) && /Tecnolog[ií]a de impresi[oó]n\s+[^.]{0,30}L[aá]ser/i.test(pageText)) kind = 'toner';
    if (!kind || !/\bcartucho\b/i.test(description)) {
      result.review.push({ url: source.canonical, reason: 'uncertain-cartridge-type', detail: `${partNumber}: ${description}` }); return;
    }
    if (seen.has(partNumber)) return; seen.add(partNumber);
    const colorWords: Record<string, string> = { negro: 'black', black: 'black', cian: 'cyan', cyan: 'cyan', magenta: 'magenta', amarillo: 'yellow', yellow: 'yellow' };
    const colors = [...new Set([...description.toLowerCase().matchAll(/\b(negro|black|cian|cyan|magenta|amarillo|yellow)\b/g)].map(match => colorWords[match[1]]))];
    const rawYield = clean(cells.eq(2).attr('data-order') ?? cells.eq(2).text()).replace(/[^0-9]/g, '');
    const yieldPages = rawYield ? Number(rawYield) : undefined;
    const table = row.closest('table').attr('id')?.includes('return') ? 'return-program' : 'standard';
    const record: ImportRecord = { printerManufacturer: 'Lexmark', printerModel, hasReplaceableCartridges: true,
      cartridgeManufacturer: 'Lexmark', cartridgePartNumber: partNumber, cartridgeKind: kind,
      ...(colors.length === 1 ? { cartridgeColor: colors[0] } : {}),
      ...(yieldPages && Number.isSafeInteger(yieldPages) ? { yieldPages } : {}),
      sourceName: 'Lexmark España official printer supplies', sourceUrl: source.canonical, region: 'ES',
      isGenuineOem: true, verificationStatus: 'verified', sourceType: 'official-manufacturer',
      evidenceType: 'explicit-compatibility', verifiedAt,
      evidence: JSON.stringify({ printerModel: heading, partNumber, description, supplyTable: table }),
    };
    result.records.push(record);
  });
  $('#DataTables_Table_otherSupplies tbody tr').each((_index, element) => {
    const row=$(element),cells=row.find('td');
    const description=clean(cells.eq(0).text()),partNumber=clean(cells.eq(1).text()).toUpperCase();
    if(description||partNumber)result.excluded.push({url:source.canonical,reason:'non-cartridge-category',detail:`${partNumber}: ${description}`});
  });
  if (!result.records.length && !result.review.length) result.review.push({ url: source.canonical, reason: 'no-supported-cartridges' });
  return result;
}

export type LexmarkOptions = CollectorOptions;
export type LexmarkRuntime = CollectorRuntime;
export async function collectLexmark(options: LexmarkOptions, runtime: LexmarkRuntime = {}) {
  return collectPages({ name: 'lexmark', seeds: [LEXMARK_SITEMAP], source: lexmarkSource, parse: parseLexmarkPage }, options, runtime);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2).filter(value => value !== '--');
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    if (!['--output-dir', '--state', '--max-pages', '--delay-ms', '--retries'].includes(args[index]) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Invalid option ${args[index]}`);
    values.set(args[index], args[index + 1]);
  }
  const report = await collectLexmark({ outputDirectory: values.get('--output-dir') ?? 'data/official/lexmark',
    stateFile: values.get('--state') ?? '.collector-state/lexmark.json', maxPages: Number(values.get('--max-pages') ?? 50),
    delayMs: Number(values.get('--delay-ms') ?? 10000), retries: Number(values.get('--retries') ?? 2) });
  console.log(JSON.stringify({ ...report, pages: undefined }, null, 2));
  if (report.failures.length) process.exitCode = 1;
}
