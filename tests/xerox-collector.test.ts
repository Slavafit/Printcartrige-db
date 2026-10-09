import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { afterEach, describe, expect, it } from 'vitest';
import { collectXerox, parseXeroxPage, xeroxSupplyUrl } from '../src/collectors/xerox.js';
import { CartridgeDatabase } from '../src/database.js';
import { importCompatibilityFile, importCompatibilityRecords } from '../src/compatibility-importer.js';

const url = 'https://www.xerox.es/es-es/supplies-and-accessories/SYNTHETIC001/synthetic-a';
const date = '2026-10-09T10:00:00.000Z';
const directories: string[] = [];
const fixture = () => readFile('tests/fixtures/xerox-synthetic.html', 'utf8');
const robots = 'User-agent: *\nDisallow: /es-es/search\n';
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('Xerox collector — synthetic non-production fixtures', () => {
  it('requires matching visible and structured SKU-level OEM evidence', async () => {
    const page = parseXeroxPage(await fixture(), url, date);
    expect(page.review).toEqual([]);
    expect(page.records).toHaveLength(2);
    expect(page.records[0]).toMatchObject({ printerModel: 'Impresora Xerox SYNTHETIC-A', cartridgePartNumber: 'SYNTHETIC001',
      cartridgeKind: 'toner', cartridgeColor: 'cyan', yieldPages: 4800, region: 'ES', verifiedAt: date, verificationStatus: 'verified' });
    expect(page.records[0].evidence).toContain('isConsumableFor');
    expect(page.links).toEqual(['https://www.xerox.es/es-es/supplies-and-accessories/SYNTHETIC002/synthetic-a']);
  });
  it('supports Ireland without claiming EU-wide compatibility and leaves absent attributes unknown', async () => {
    const html = (await fixture()).replaceAll('https://www.xerox.es/es-es', 'https://www.xerox.com/en-ie')
      .replaceAll('/oficina/impresoras-multifuncion/', '/office/multifunction-printers/')
      .replaceAll('/oficina/impresoras/', '/office/printers/')
      .replaceAll('Synthetic cartucho de tóner cian (4.800 páginas)', 'Synthetic Ink Cartridge')
      .replace('Los consumibles originales y los equipos Xerox se complementan entre sí.', 'Xerox Genuine Supplies and Xerox equipment are made for each other.');
    const page = parseXeroxPage(html, url.replace('www.xerox.es/es-es', 'www.xerox.com/en-ie'), date);
    expect(page.records).toHaveLength(2);
    expect(page.records[0]).toMatchObject({ region: 'IE', cartridgeKind: 'ink' });
    expect(page.records[0].cartridgeColor).toBeUndefined(); expect(page.records[0].yieldPages).toBeUndefined();
  });
  it.each(['Everyday toner cartridge for HP', 'cartucho de tóner para Brother', 'non-Xerox ink cartridge', 'remanufactured toner cartridge'])(
    'excludes third-party %s', async description => {
      const html = (await fixture()).replace(/Synthetic cartucho de tóner cian \(4.800 páginas\)/g, description);
      const page = parseXeroxPage(html, url, date);
      expect(page.records).toEqual([]); expect(page.excluded[0].reason).toBe('third-party-or-everyday');
    });
  it.each(['drum', 'tambor', 'waste toner bottle', 'maintenance kit', 'fusor', 'transfer belt', 'ink refill', 'grapas'])(
    'excludes %s even when linked to a printer', async description => {
      const page = parseXeroxPage((await fixture()).replace('<h3>Synthetic cartucho de tóner cian (4.800 páginas)</h3>', `<h3>${description}</h3>`), url, date);
      expect(page.records).toEqual([]); expect(page.excluded).toHaveLength(1);
    });
  it('quarantines mismatch, missing explicit list, malformed JSON and foreign printer URLs', async () => {
    const html = await fixture();
    for (const changed of [html.replace('<h1>SYNTHETIC001</h1>', '<h1>OTHER</h1>'),
      html.replace('"mpn":"SYNTHETIC001"', '"mpn":"OTHER"'),
      html.replace('class="xrx-fw-product-sku-hero__compatibility"', 'class="unknown"'),
      html.replace('"@context":', 'BROKEN "@context":'),
      html.replace('https://www.xerox.es/es-es/oficina/impresoras/synthetic-a', 'https://example.invalid/printer'),
      html.replace('Los consumibles originales y los equipos Xerox se complementan entre sí.', 'Unknown OEM origin')]) {
      const result = parseXeroxPage(changed, url, date);
      expect(result.records).toEqual([]); expect(result.review).toHaveLength(1);
    }
  });
  it('rejects unsupported hosts, markets, credentials and parameters', () => {
    for (const source of [url.replace('www.xerox.es', 'www.xerox.es.example.invalid'), url + '?x=1', url + '#id',
      url.replace('https://', 'https://user@'), url.replace('/es-es/', '/en-us/')]) expect(xeroxSupplyUrl(source)).toBeUndefined();
  });
  it('validates and imports many-to-many records idempotently through the strict shared importer', async () => {
    const records = parseXeroxPage(await fixture(), url, date).records;
    const db = new CartridgeDatabase(':memory:'); db.initialize();
    try {
      expect(importCompatibilityRecords(db, records, true)).toMatchObject({ acceptedRecords: 2, rejectedRecords: 0, recordsRequiringManualReview: 0 });
      expect(db.list('printers')).toEqual([]);
      const secondSku = records.map(record => ({ ...record, cartridgePartNumber: 'SYNTHETIC002', sourceUrl: record.sourceUrl!.replace('001', '002') }));
      expect(importCompatibilityRecords(db, [...records, ...secondSku], false).insertedRelationships).toBe(4);
      expect(importCompatibilityRecords(db, records, false)).toMatchObject({ insertedRelationships: 0, existingRelationships: 2 });
      expect(db.list('printers')).toHaveLength(2); expect(db.list('cartridges')).toHaveLength(2);
      expect(db.queryCompatibility()[0]).toMatchObject({ yield_pages: 4800, color: 'cyan', source_type: 'official-manufacturer', verified_at: date });
    } finally { db.close(); }
  });
  async function options() {
    const directory = await mkdtemp(join(tmpdir(), 'xerox-')); directories.push(directory);
    return { outputDirectory: directory, stateFile: join(directory, 'state.json'), seeds: [url], maxPages: 1, retries: 1 };
  }
  it('strict CSV import rejects invalid OEM booleans and yields instead of coercing them into valid claims', async () => {
    const opts = await options(); const records = parseXeroxPage(await fixture(), url, date).records;
    const path = join(opts.outputDirectory, 'invalid.csv');
    await writeFile(path, stringify([{ ...records[0], isGenuineOem: 'yes' }, { ...records[1], isGenuineOem: 'true', yieldPages: '4.8' }], { header: true }));
    const db = new CartridgeDatabase(':memory:'); db.initialize();
    try {
      expect(await importCompatibilityFile(db, path, false)).toMatchObject({ acceptedRecords: 0, rejectedRecords: 2, insertedRelationships: 0 });
      expect(db.list('printers')).toEqual([]);
    } finally { db.close(); }
  });
  it('retries transient errors, preserves evidence in both exports, hashes snapshots, and resumes without duplicate pages', async () => {
    const opts = await options(); const html = await fixture(); let productAttempts = 0;
    const waits: number[] = [];
    const fetcher: typeof fetch = async (target, init) => {
      expect(init?.redirect).toBe('manual');
      if (String(target).endsWith('/robots.txt')) return new Response(robots);
      productAttempts++;
      if (productAttempts === 1) return new Response('Temporary', { status: 503 });
      return new Response(String(target).includes('SYNTHETIC002') ? html.replaceAll('SYNTHETIC001', 'SYNTHETIC002') : html);
    };
    const runtime = { fetcher, now: () => new Date(date), sleep: async (ms: number) => { waits.push(ms); } };
    const first = await collectXerox(opts, runtime);
    expect(first).toMatchObject({ printers: 2, cartridges: 1, relationships: 2, pendingPages: 1, failures: [] });
    expect(productAttempts).toBe(2); expect(waits.every(ms => ms >= 10000)).toBe(true);
    expect(first.pages[0].sha256).toBe(createHash('sha256').update(html).digest('hex'));
    const rows = JSON.parse(await readFile(join(opts.outputDirectory, 'xerox.json'), 'utf8'));
    const csv = parse(await readFile(join(opts.outputDirectory, 'xerox.csv'), 'utf8'), { columns: true }) as Array<Record<string, string>>;
    expect(csv[0].evidence).toBe(rows[0].evidence); expect(csv[0].yieldPages).toBe('4800'); expect(csv[0].verifiedAt).toBe(date);
    const db = new CartridgeDatabase(':memory:'); db.initialize();
    try {
      expect((await importCompatibilityFile(db, join(opts.outputDirectory, 'xerox.csv'), true)).acceptedRecords).toBe(2);
      expect(db.list('compatibility')).toEqual([]);
      expect((await importCompatibilityFile(db, join(opts.outputDirectory, 'xerox.csv'), false)).insertedRelationships).toBe(2);
      expect(db.queryCompatibility()[0]).toMatchObject({ evidence: rows[0].evidence, yield_pages: 4800, verified_at: date });
    } finally { db.close(); }
    expect(await collectXerox(opts, runtime)).toMatchObject({ resumed: true, completedPages: 2, pendingPages: 0, relationships: 4 });
    const before = productAttempts;
    expect(await collectXerox(opts, runtime)).toMatchObject({ pagesVisited: 0, requestAttempts: 0, relationships: 4 });
    expect(productAttempts).toBe(before);
  });
  it.each([301, 401, 403, 429])('does not retry or follow HTTP %s, keeps failed pages resumable', async status => {
    const opts = await options(); let attempts = 0;
    const fetcher: typeof fetch = async target => {
      if (String(target).endsWith('/robots.txt')) return new Response(robots);
      attempts++; return new Response('Restricted', { status });
    };
    const report = await collectXerox(opts, { fetcher, now: () => new Date(date), sleep: async () => {} });
    expect(attempts).toBe(1); expect(report).toMatchObject({ pendingPages: 1, completedPages: 0, relationships: 0 });
    expect(report.failures[0].reason).toBe(`HTTP ${status}`);
    const retry = await collectXerox(opts, { fetcher: async target => new Response(String(target).endsWith('/robots.txt') ? robots : await fixture()), now: () => new Date(date), sleep: async () => {} });
    expect(retry.completedPages).toBe(1);
  });
  it('fails closed on disallowed paths, invalid robots and HTTP-200 challenges', async () => {
    for (const policy of ['User-agent: *\nDisallow: /es-es/supplies-and-accessories/', '<html>Blocked</html>']) {
      let requests = 0;
      const report = await collectXerox(await options(), { fetcher: async () => { requests++; return new Response(policy); }, sleep: async () => {} });
      expect(requests).toBe(1); expect(report.failures).toHaveLength(1); expect(report.relationships).toBe(0);
    }
    const report = await collectXerox(await options(), { fetcher: async target => new Response(String(target).endsWith('/robots.txt') ? robots : '<title>Access denied</title>'), sleep: async () => {} });
    expect(report.failures[0].reason).toBe('access-challenge'); expect(report.pendingPages).toBe(1);
  });
});

describe('committed official Xerox ES snapshot (read-only evidence, in-memory import)', () => {
  it('reproduces every record from hash-checked source pages and preserves existing Kyocera data', async () => {
    const root = 'data/official/xerox';
    const report = JSON.parse(await readFile(`${root}/xerox-report.json`, 'utf8'));
    const records = JSON.parse(await readFile(`${root}/xerox.json`, 'utf8'));
    const reproduced = [];
    for (const page of report.pages) {
      const html = await readFile(`${root}/${page.file}`, 'utf8');
      expect(createHash('sha256').update(html).digest('hex')).toBe(page.sha256);
      const parsed = parseXeroxPage(html, page.url, page.retrievedAt);
      expect(parsed.review).toEqual([]); expect(parsed.excluded).toEqual([]);
      reproduced.push(...parsed.records);
    }
    expect(reproduced).toEqual(records);
    expect(records).toHaveLength(24);
    const db = new CartridgeDatabase(':memory:'); db.initialize();
    try {
      const existing = JSON.parse(await readFile('data/official/kyocera-eu.json', 'utf8'));
      importCompatibilityRecords(db, existing, false);
      const before = db.queryCompatibility();
      const dry = importCompatibilityRecords(db, records, true);
      expect(dry).toMatchObject({ acceptedRecords: 24, rejectedRecords: 0, recordsRequiringManualReview: 0 });
      expect(db.queryCompatibility()).toEqual(before);
      expect(importCompatibilityRecords(db, records, false).insertedRelationships).toBe(24);
      expect((await importCompatibilityFile(db, `${root}/xerox.csv`, false))).toMatchObject({ insertedRelationships: 0, existingRelationships: 24, errors: [] });
      expect(db.countPrintersByManufacturer('Xerox')).toBe(2);
      expect(db.queryCompatibility().filter(row => (row as { printer_manufacturer: string }).printer_manufacturer === 'Kyocera')).toEqual(before);
    } finally { db.close(); }
  });
});
