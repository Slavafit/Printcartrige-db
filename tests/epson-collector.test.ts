import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectEpson, EPSON_SEEDS, epsonAccessReason, isEpsonProductUrl, parseEpsonPage, parseEpsonRobots } from '../src/collectors/epson.js';
import { CartridgeDatabase } from '../src/database.js';
import { importFile, importRecords } from '../src/importer.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const fixture = (name: string) => readFile(`tests/fixtures/epson-${name}-synthetic.${name === 'robots' ? 'txt' : 'html'}`, 'utf8');
const source = EPSON_SEEDS[0];
const time = '2026-10-09T05:00:00.000Z';

describe('Epson synthetic fixtures (never production data)', () => {
  it('quarantines range claims instead of inventing exact SKU compatibility', async () => {
    const page = parseEpsonPage(await fixture('range'), source);
    expect(page.records).toEqual([]);
    expect(page.review[0].reason).toBe('range-level-compatibility');
    expect(page.review[0].evidence).toContain('SYNTHETIC Printer 1');
    expect(page.links).toEqual(['https://www.epson.eu/en_EU/products/printers/synthetic/p/900001']);
  });
  it.each(['Ink Bottle', 'Ink Refill', 'Maintenance Ink Cartridge', 'Cleaning Cartridge', 'Waste Ink Cartridge', 'Drum', 'Fuser', 'Transfer Belt', 'Ink Multipack'])(
    'excludes %s before any relationship creation', async title => {
      const html = (await fixture('range')).replace('SYNTHETIC Black Ink Cartridge', title);
      const page = parseEpsonPage(html, source);
      expect(page.excluded).toHaveLength(1);
      expect(page.records).toHaveLength(0);
    });
  it('fails closed for changed structure, missing SKU, challenges and unsupported URLs', async () => {
    const html = await fixture('range');
    expect(parseEpsonPage(html.replace('SKU: C13SYNTHETIC', ''), source).review[0].reason).toBe('missing-or-ambiguous-sku');
    expect(parseEpsonPage(html.replace('Compatible Main Units', 'Changed title'), source).review[0].reason).toBe('missing-or-ambiguous-compatibility-section');
    expect(parseEpsonPage('<h1>Access denied</h1>', source).records).toEqual([]);
    expect(parseEpsonPage(html, 'https://example.invalid/product').review[0].reason).toBe('unsupported-source');
    expect(isEpsonProductUrl(source + '?redirect=other')).toBe(false);
    expect(isEpsonProductUrl(source.replace('www.epson.eu', 'www.epson.eu.example.invalid'))).toBe(false);
  });
  it('retains EcoTank printer provenance through shared dry-run/import and repeat import', async () => {
    const url = 'https://www.epson.eu/en_EU/products/printers/synthetic/p/900001';
    const records = parseEpsonPage(await fixture('ecotank'), url).records;
    const db = new CartridgeDatabase(':memory:'); db.initialize();
    try {
      expect(importRecords(db, records, true).valid).toBe(true);
      expect(db.list('printers')).toEqual([]);
      expect(importRecords(db, records).valid).toBe(true);
      importRecords(db, records);
      expect(db.list('printers')).toMatchObject([{ has_replaceable_cartridges: 0 }]);
      expect(db.list('printer_sources')).toMatchObject([{ source_url: url, region: 'EU', verification_status: 'verified' }]);
      expect(db.list('printer_sources')).toHaveLength(1);
      expect(db.list('cartridges')).toEqual([]);
      expect(db.list('compatibility')).toEqual([]);
      importRecords(db, [{ ...records[0], verificationStatus: 'unverified' }]);
      expect(db.list('printer_sources')).toMatchObject([{ verification_status: 'verified' }]);
      expect(importRecords(db, [{ ...records[0], sourceUrl: 'bad-url' }]).valid).toBe(false);
    } finally { db.close(); }
  });
  it('enforces wildcard policy, UTC visit window, delay and disallowed paths', async () => {
    const policy = parseEpsonRobots(await fixture('robots'));
    expect(policy.delayMs).toBe(10000);
    expect(epsonAccessReason(policy, source, new Date(time))).toBeUndefined();
    expect(epsonAccessReason(policy, source, new Date('2026-10-09T08:45:00Z'))).toBe('outside-robots-visit-window');
    expect(epsonAccessReason(policy, 'https://www.epson.eu/search', new Date(time))).toBe('robots-disallow');
    expect(() => parseEpsonRobots('<html>Access denied</html>')).toThrow();
    expect(() => parseEpsonRobots('User-agent: *\nVisit-time: unknown')).toThrow();
  });
  async function setup() {
    const directory = await mkdtemp(join(tmpdir(), 'epson-')); directories.push(directory);
    return { outputDirectory: directory, stateFile: join(directory, 'state.json'), retries: 0 };
  }
  it('does not fetch products outside the visit window; exports a resumable failure report', async () => {
    const options = await setup(); const calls: string[] = [];
    const robots = await fixture('robots');
    const fetcher: typeof fetch = async url => { calls.push(String(url)); return new Response(robots); };
    const report = await collectEpson(options, { fetcher, now: () => new Date('2026-10-09T10:00:00Z') });
    expect(calls).toEqual(['https://www.epson.eu/robots.txt']);
    expect(report.failures[0].reason).toBe('outside-robots-visit-window');
    expect(report.pendingPages).toBe(1);
    expect(JSON.parse(await readFile(join(options.outputDirectory, 'epson-eu.json'), 'utf8'))).toEqual([]);
    expect(await readFile(join(options.outputDirectory, 'epson-eu.csv'), 'utf8')).toContain('sourceUrl');
  });
  it('resumes failed pages, discovers links, and imports CSV idempotently', async () => {
    const options = await setup(); const robots = await fixture('robots');
    const html = await fixture('range'); const eco = await fixture('ecotank');
    const calls: string[] = []; const waits: number[] = [];
    let fail = true;
    const fetcher: typeof fetch = async url => {
      calls.push(String(url));
      if (String(url).endsWith('robots.txt')) return new Response(robots);
      if (fail) return new Response('Unavailable', { status: 503 });
      return new Response(String(url) === source ? html : eco);
    };
    const runtime = { fetcher, now: () => new Date(time), sleep: async (ms: number) => { waits.push(ms); } };
    expect((await collectEpson(options, runtime)).failures).toHaveLength(1);
    fail = false;
    expect((await collectEpson(options, runtime)).completedPages).toBe(1);
    const third = await collectEpson(options, runtime);
    expect(third).toMatchObject({ resumed: true, completedPages: 2, printers: 1, relationships: 0, pendingPages: 0 });
    expect(third.failures).toEqual([]);
    expect(waits.every(ms => ms >= 10000)).toBe(true);
    const count = calls.length;
    await collectEpson(options, runtime);
    expect(calls.length).toBe(count + 1);
    const db = new CartridgeDatabase(':memory:'); db.initialize();
    try {
      expect((await importFile(db, join(options.outputDirectory, 'epson-eu.csv'), true)).valid).toBe(true);
      await importFile(db, join(options.outputDirectory, 'epson-eu.csv'));
      await importFile(db, join(options.outputDirectory, 'epson-eu.json'));
      expect(db.list('printers')).toHaveLength(1);
      expect(db.list('printer_sources')).toHaveLength(1);
    } finally { db.close(); }
  });
  it.each([302, 401, 403, 429])('does not retry or follow HTTP %s', async status => {
    const options = { ...await setup(), retries: 2 }; const robots = await fixture('robots'); let products = 0;
    const fetcher: typeof fetch = async url => {
      if (String(url).endsWith('robots.txt')) return new Response(robots);
      products++; return new Response('Blocked', { status });
    };
    const report = await collectEpson(options, { fetcher, now: () => new Date(time), sleep: async () => {} });
    expect(products).toBe(1); expect(report.pendingPages).toBe(1); expect(report.failures).toHaveLength(1);
  });
  it('retries 5xx within limits and preserves HTTP-200 challenge pages as pending', async () => {
    const options = { ...await setup(), retries: 1 }; const robots = await fixture('robots'); let products = 0;
    const fetcher: typeof fetch = async url => {
      if (String(url).endsWith('robots.txt')) return new Response(robots);
      products++;
      return products === 1 ? new Response('Transient', { status: 503 }) : new Response('<h1>Access denied</h1>');
    };
    const report = await collectEpson(options, { fetcher, now: () => new Date(time), sleep: async () => {} });
    expect(products).toBe(2);
    expect(report).toMatchObject({ completedPages: 0, pendingPages: 1, relationships: 0 });
    expect(report.failures[0].reason).toBe('access-challenge');
  });
});

