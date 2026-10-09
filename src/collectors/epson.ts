import { parseRobots as parseEpsonRobots, accessReason as epsonAccessReason, type AccessPolicy as EpsonAccessPolicy } from './access-policy.js';
export { parseEpsonRobots, epsonAccessReason, type EpsonAccessPolicy };
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import { stringify } from 'csv-stringify/sync';
import type { ImportRecord } from '../types.js';
import { COLLECTOR_USER_AGENT } from './kyocera.js';

export const EPSON_ORIGIN = 'https://www.epson.eu';
export const EPSON_SEEDS = [
  `${EPSON_ORIGIN}/en_EU/products/ink-and-paper/ink-consumables/604xl-pineapple-single-black-ink/p/35499`,
];
export interface EpsonIssue { url: string; reason: string; evidence?: string }
export interface EpsonPage { records: ImportRecord[]; review: EpsonIssue[]; excluded: EpsonIssue[]; links: string[] }
const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();

export function isEpsonProductUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === EPSON_ORIGIN && !url.username && !url.password && !url.search && !url.hash
      && /^\/en_EU\/products\/.+\/p\/\d+$/.test(url.pathname);
  } catch { return false; }
}

/** Semantic headings/links only; missing or range-level evidence is quarantined. */
export function parseEpsonPage(html: string, url: string): EpsonPage {
  const result: EpsonPage = { records: [], review: [], excluded: [], links: [] };
  if (!isEpsonProductUrl(url)) {
    result.review.push({ url, reason: 'unsupported-source' });
    return result;
  }
  const $ = load(html);
  $('script, style, nav, footer, header').remove();
  $('h1,h2,h3,h4,p,div,li,br').append(' ');
  const title = clean($('h1').first().text());
  const body = clean($('body').text());
  $('a[href]').each((_i, element) => {
    try {
      const target = new URL($(element).attr('href')!, url).href;
      if (isEpsonProductUrl(target)) result.links.push(target);
    } catch { /* Invalid links are never fetched. */ }
  });
  result.links = [...new Set(result.links)].sort();
  const review = (reason: string, evidence = title): EpsonPage => {
    result.review.push({ url, reason, evidence }); return result;
  };
  if (/access denied|verify you are human|captcha/i.test(title)) return review('access-challenge');
  if (!title) return review('missing-product-heading');
  if (/\bEcoTank\b/i.test(title) && /\b(?:cartridge-free|cartridge free)\b/i.test(body)
      && !url.includes('/ink-and-paper/')) {
    result.records.push({ printerManufacturer: 'Epson', printerModel: title,
      hasReplaceableCartridges: false, sourceName: 'Epson Europe', sourceUrl: url,
      sourceType: 'official-manufacturer', evidenceType: 'product-page-only', evidence: title,
      verificationStatus: 'verified', region: 'EU' });
    return result;
  }
  if (/\b(?:bottles?|refills?|maintenance|cleaning|cleaner|waste|drums?|fuser|belt|printheads?|multipack)\b/i.test(title)) {
    result.excluded.push({ url, reason: 'excluded-or-multipack-product', evidence: title }); return result;
  }
  if (!url.includes('/ink-consumables/') || !/\b(?:ink|toner)\b/i.test(title)
      || !/\bcartridges?\b/i.test(body)) return review('uncertain-cartridge-type');
  // SKU nearest the product heading: never pick a SKU from Other Products in the Series.
  const prefix = body.split(/Other Products in the Series|Compatible Main Units/i)[0];
  const skus = [...new Set([...prefix.matchAll(/\bSKU:\s*(C13[A-Z0-9]+)\b/g)].map(match => match[1]))];
  if (skus.length !== 1) return review('missing-or-ambiguous-sku');
  const heading = $('h2,h3').filter((_i, element) => clean($(element).text()) === 'Compatible Main Units');
  if (heading.length !== 1) return review('missing-or-ambiguous-compatibility-section');
  const section = heading.nextUntil('h1,h2,h3');
  const sectionText = clean(section.text());
  // The current Epson wording does not establish an exact SKU edge.
  if (/one or more|in this range/i.test(sectionText)) return review('range-level-compatibility', sectionText);
  return review('exact-sku-evidence-needs-review', sectionText || title);
}

interface State { version: 1; pending: string[]; completed: string[]; records: ImportRecord[]; review: EpsonIssue[]; excluded: EpsonIssue[] }
export interface EpsonOptions { outputDirectory: string; stateFile: string; seeds?: string[]; maxPages?: number; delayMs?: number; retries?: number }
export interface EpsonRuntime { fetcher?: typeof fetch; now?: () => Date; sleep?: (ms: number) => Promise<void> }
export async function collectEpson(options: EpsonOptions, runtime: EpsonRuntime = {}) {
  const maxPages = options.maxPages ?? 20;
  const retries = options.retries ?? 2;
  if (!Number.isInteger(maxPages) || maxPages < 1 || !Number.isInteger(retries) || retries < 0 || retries > 5
      || !Number.isFinite(options.delayMs ?? 10_000) || (options.delayMs ?? 10_000) < 0) throw new Error('Invalid collector limits');
  const fetcher = runtime.fetcher ?? fetch;
  const now = runtime.now ?? (() => new Date());
  const sleep = runtime.sleep ?? (async ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms)));
  let state: State = { version: 1, pending: options.seeds ?? EPSON_SEEDS, completed: [], records: [], review: [], excluded: [] };
  let resumed = false;
  try {
    state = JSON.parse(await readFile(options.stateFile, 'utf8')) as State;
    if (state.version !== 1 || ![state.pending, state.completed, state.records, state.review, state.excluded].every(Array.isArray)) throw new Error('Invalid Epson checkpoint');
    resumed = true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  state.pending = [...new Set([...state.pending, ...(options.seeds ?? [])])].filter(url => !state.completed.includes(url));
  if (![...state.pending, ...state.completed].every(isEpsonProductUrl)) throw new Error('Checkpoint/seeds contain unsupported URLs');
  const failures: EpsonIssue[] = [];
  let policy: EpsonAccessPolicy;
  let lastRequest = 0;
  let pagesVisited = 0;
  let activeUrl = `${EPSON_ORIGIN}/robots.txt`;
  const fetchText = async (url: string) => {
    const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { 'user-agent': COLLECTOR_USER_AGENT } });
    if (!response.ok) throw new Error(`HTTP ${response.status}; redirects/access restrictions are not followed`);
    return response.text();
  };
  await mkdir(options.outputDirectory, { recursive: true });
  try {
    const robots = await fetchText(`${EPSON_ORIGIN}/robots.txt`);
    lastRequest = now().getTime();
    await writeFile(resolve(options.outputDirectory, 'epson-eu-robots.txt'), robots);
    policy = parseEpsonRobots(robots);
    const queue = [...state.pending];
    for (const url of queue) {
      activeUrl = url;
      if (pagesVisited >= maxPages) break;
      const restriction = epsonAccessReason(policy, url, now());
      if (restriction) { failures.push({ url, reason: restriction }); if (restriction.includes('window')) break; else continue; }
      let html: string | undefined;
      for (let attempt = 0; attempt <= retries; attempt++) {
        await sleep(Math.max(0, Math.max(policy.delayMs, options.delayMs ?? 0) - (now().getTime() - lastRequest)));
        const restrictionAfterWait = epsonAccessReason(policy, url, now());
        if (restrictionAfterWait) { failures.push({ url, reason: restrictionAfterWait }); break; }
        try { lastRequest = now().getTime(); html = await fetchText(url); break; }
        catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          // Never retry authentication, bot protection, rate limiting or redirects in this run.
          if (/HTTP (?:[234]\d\d)/.test(reason) || attempt === retries) { failures.push({ url, reason }); break; }
        }
      }
      pagesVisited++;
      if (html === undefined) continue; // Remains pending for a subsequent permitted run.
      const parsed = parseEpsonPage(html, url);
      const snapshot = resolve(options.outputDirectory, 'raw', `${new URL(url).pathname.split('/').at(-1)}.html`);
      await mkdir(dirname(snapshot), { recursive: true });
      await writeFile(snapshot, html);
      if (parsed.review.some(issue => issue.reason === 'access-challenge')) {
        failures.push({ url, reason: 'access-challenge' });
        break;
      }
      state.records.push(...parsed.records);
      state.review.push(...parsed.review);
      state.excluded.push(...parsed.excluded);
      state.completed.push(url);
      state.pending = [...new Set([...state.pending.filter(item => item !== url), ...parsed.links])].filter(item => !state.completed.includes(item));
      await save(options.stateFile, state);
    }
  } catch (error) { failures.push({ url: activeUrl, reason: error instanceof Error ? error.message : String(error) }); }
  await save(options.stateFile, state);
  await save(resolve(options.outputDirectory, 'epson-eu.json'), state.records);
  const columns = ['printerManufacturer', 'printerModel', 'hasReplaceableCartridges', 'cartridgeManufacturer', 'cartridgePartNumber', 'cartridgeKind', 'sourceName', 'sourceUrl', 'verificationStatus', 'region', 'isGenuineOem', 'sourceType', 'evidenceType', 'evidence', 'verifiedAt'];
  await writeFile(resolve(options.outputDirectory, 'epson-eu.csv'), stringify(state.records, { header: true, columns, cast: { boolean: value => String(value) } }));
  const report = { collectedAt: now().toISOString(), resumed, pagesVisited, completedPages: state.completed.length,
    pendingPages: state.pending.length, printers: new Set(state.records.map(record => record.printerModel)).size,
    relationships: state.records.filter(record => record.cartridgePartNumber).length,
    review: state.review, excluded: state.excluded, failures };
  await save(resolve(options.outputDirectory, 'epson-eu-report.json'), report);
  return report;
}

async function save(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  await rename(`${path}.tmp`, path);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  const allowed = new Set(['--output-dir', '--state', '--max-pages', '--delay-ms', '--retries', '--seed']);
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid option: ${args[i]}`);
    values.set(args[i], args[i + 1]);
  }
  const report = await collectEpson({ outputDirectory: values.get('--output-dir') ?? 'data/official/epson',
    stateFile: values.get('--state') ?? '.collector-state/epson-eu.json',
    maxPages: Number(values.get('--max-pages') ?? 20), delayMs: Number(values.get('--delay-ms') ?? 10_000),
    retries: Number(values.get('--retries') ?? 2), ...(values.has('--seed') ? { seeds: [values.get('--seed')!] } : {}) });
  console.log(JSON.stringify(report, null, 2));
  if (report.failures.length) process.exitCode = 1;
}
