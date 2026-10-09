import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { stringify } from 'csv-stringify/sync';
import { normalizePrinterModel } from '../normalize.js';
import type { ImportRecord } from '../types.js';
import { COLLECTOR_USER_AGENT } from './kyocera.js';
import { parseRobots, accessReason } from './access-policy.js';

export interface CollectionIssue { url: string; reason: string; detail?: string }
export interface ParsedPage { records: ImportRecord[]; links: string[]; review: CollectionIssue[]; excluded: CollectionIssue[] }
export interface PageAdapter {
  name: string;
  seeds: string[];
  source: (url: string) => { canonical: string } | undefined;
  parse: (html: string, url: string, retrievedAt: string) => ParsedPage;
}
export interface PageSnapshot { url: string; retrievedAt: string; sha256: string; file: string }
interface CollectorState { version: 1; pending: string[]; pages: PageSnapshot[]; records: ImportRecord[]; review: CollectionIssue[]; excluded: CollectionIssue[] }
export interface CollectorOptions { outputDirectory: string; stateFile: string; seeds?: string[]; maxPages?: number; delayMs?: number; retries?: number }
export interface CollectorRuntime { fetcher?: typeof fetch; now?: () => Date; sleep?: (ms: number) => Promise<void> }
class RequestFailure extends Error { constructor(message: string, readonly retryable = false, readonly stop = false) { super(message); } }

export async function collectPages(adapter: PageAdapter, options: CollectorOptions, runtime: CollectorRuntime = {}) {
  const maxPages = options.maxPages ?? 50, retries = options.retries ?? 2, delayMs = options.delayMs ?? 10000;
  if (!Number.isInteger(maxPages) || maxPages < 1 || !Number.isInteger(retries) || retries < 0 || retries > 5 || !Number.isFinite(delayMs) || delayMs < 1000) throw new Error('Invalid collection limits');
  const now = runtime.now ?? (() => new Date());
  const sleep = runtime.sleep ?? (async ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms)));
  const fetcher = runtime.fetcher ?? fetch;
  let state: CollectorState = { version: 1, pending: options.seeds ?? adapter.seeds, pages: [], records: [], review: [], excluded: [] };
  let resumed = false;
  try {
    state = JSON.parse(await readFile(options.stateFile, 'utf8')) as CollectorState;
    if (state.version !== 1 || ![state.pending, state.pages, state.records, state.review, state.excluded].every(Array.isArray)) throw new Error('Invalid collector checkpoint');
    resumed = true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (![...state.pending, ...state.pages.map(page => page.url), ...(options.seeds ?? [])].every(url => adapter.source(url))) throw new Error('Unsupported URL in seed/checkpoint');
  const completed = new Set(state.pages.map(page => adapter.source(page.url)!.canonical));
  const uniqueQueue = (urls: string[]) => {
    const seen = new Set(completed);
    return urls.filter(url => { const key = adapter.source(url)!.canonical; if (seen.has(key)) return false; seen.add(key); return true; });
  };
  state.pending = uniqueQueue([...state.pending, ...(options.seeds ?? [])]);
  const policies = new Map<string, ReturnType<typeof parseRobots>>();
  const failures: CollectionIssue[] = [];
  let pagesVisited = 0, attempts = 0, lastRequest: number | undefined;
  const request = async (url: string, policy?: ReturnType<typeof parseRobots>): Promise<string> => {
    for (let attempt = 0; ; attempt++) {
      if (lastRequest !== undefined) await sleep(Math.max(0, Math.max(delayMs, policy?.delayMs ?? 0) - (now().getTime() - lastRequest)));
      if (policy) { const reason = accessReason(policy, url, now()); if (reason) throw new RequestFailure(reason); }
      lastRequest = now().getTime(); attempts++;
      try {
        const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { 'user-agent': COLLECTOR_USER_AGENT, accept: 'text/html,text/plain' } });
        if (!response.ok) throw new RequestFailure(`HTTP ${response.status}`, response.status >= 500, [401, 403, 429].includes(response.status));
        return await response.text();
      } catch (error) {
        if (error instanceof RequestFailure && !error.retryable || attempt >= retries) throw error;
      }
    }
  };
  await mkdir(resolve(options.outputDirectory, 'raw'), { recursive: true });
  const attempted = new Set<string>();
  while (pagesVisited < maxPages) {
    const url = state.pending.find(item => !attempted.has(item));
    if (!url) break;
    attempted.add(url);
    const origin = new URL(url).origin;
    try {
      if (!policies.has(origin)) {
        const robots = await request(`${origin}/robots.txt`);
        policies.set(origin, parseRobots(robots));
        await writeFile(resolve(options.outputDirectory, `robots-${new URL(origin).hostname}.txt`), robots);
      }
    } catch (error) { failures.push({ url: `${origin}/robots.txt`, reason: String(error) }); break; }
    pagesVisited++;
    try {
      const html = await request(url, policies.get(origin));
      const retrievedAt = now().toISOString();
      const parsed = adapter.parse(html, url, retrievedAt);
      if (parsed.review.some(issue => issue.reason === 'access-challenge')) throw new RequestFailure('access-challenge', false, true);
      const sha256 = createHash('sha256').update(html).digest('hex');
      const file = `raw/${sha256}.html`;
      await writeFile(resolve(options.outputDirectory, file), html);
      state.pages.push({ url, retrievedAt, sha256, file });
      state.records.push(...parsed.records);
      state.review.push(...parsed.review); state.excluded.push(...parsed.excluded);
      completed.add(adapter.source(url)!.canonical);
      state.pending = uniqueQueue([...state.pending, ...parsed.links]);
      await save(options.stateFile, state);
    } catch (error) {
      failures.push({ url, reason: error instanceof Error ? error.message : String(error) });
      if (error instanceof RequestFailure && error.stop) break;
    }
  }
  await save(options.stateFile, state);
  await save(resolve(options.outputDirectory, `${adapter.name}.json`), state.records);
  const columns = ['printerManufacturer', 'printerModel', 'hasReplaceableCartridges', 'cartridgeManufacturer', 'cartridgePartNumber', 'cartridgeKind', 'cartridgeColor', 'yieldPages', 'sourceName', 'sourceUrl', 'verificationStatus', 'region', 'isGenuineOem', 'sourceType', 'evidenceType', 'evidence', 'verifiedAt'];
  await writeFile(resolve(options.outputDirectory, `${adapter.name}.csv`), stringify(state.records, { header: true, columns, cast: { boolean: value => String(value) } }));
  const report = { collectedAt: now().toISOString(), resumed, pagesVisited, requestAttempts: attempts,
    completedPages: state.pages.length, pendingPages: state.pending.length,
    printers: new Set(state.records.map(record => normalizePrinterModel(record.printerModel))).size,
    cartridges: new Set(state.records.map(record => record.cartridgePartNumber)).size,
    relationships: state.records.length, review: state.review, excluded: state.excluded, failures, pages: state.pages };
  await save(resolve(options.outputDirectory, `${adapter.name}-report.json`), report);
  return report;
}

async function save(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  await rename(`${path}.tmp`, path);
}
