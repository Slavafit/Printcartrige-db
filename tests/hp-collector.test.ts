import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectHp, hpSupplyUrl, parseHpPage } from '../src/collectors/hp.js';
import { CartridgeDatabase } from '../src/database.js';
import { importCompatibilityFile, importCompatibilityRecords } from '../src/compatibility-importer.js';

const url = 'https://www.hp.com/es-es/shop/products/supplies/synthetic-ink-syn001ae-tst';
const date = '2026-10-09T11:00:00.000Z';
const fixture = () => readFile('tests/fixtures/hp-synthetic.html', 'utf8');
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('HP synthetic non-production fixtures', () => {
  it('keeps exact orderable SKU and packaging suffix separate from cartridge family', async () => {
    const result = parseHpPage(await fixture(), url, date);
    expect(result.review).toEqual([]); expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({ printerModel: 'Impresora HP SYNTHETIC-101 SYN101', cartridgePartNumber: 'SYN001AE#TST',
      cartridgeKind: 'ink', cartridgeColor: 'black', yieldPages: 1000, verificationStatus: 'verified', region: 'ES', verifiedAt: date });
    expect(JSON.parse(result.records[0].evidence!)).toMatchObject({ family: '999', orderableSku: 'SYN001AE#TST', printerProductNumber: 'SYN101' });
    expect(result.links).toEqual(['https://www.hp.com/es-es/shop/products/supplies/synthetic-ink-syn002ae-tst']);
  });
  it('does not promote family names, ranges, yield-test printers or recommendation cards', async () => {
    const html = (await fixture()).replace('Impresora HP SYNTHETIC-101 SYN101', 'HP SYNTHETIC series 100 SYN101')
      .replace('Impresora HP SYNTHETIC-102 SYN102', 'HP SYNTHETIC 100/200 SYN102');
    const result = parseHpPage(html, url, date);
    expect(result.records).toEqual([]); expect(result.review.map(row => row.reason)).toEqual(['family-or-ambiguous-printer', 'family-or-ambiguous-printer']);
  });
  it.each(['Botella de tinta original HP', 'Kit de recarga HP', 'Cabezal de impresión HP', 'Tambor HP', 'Cartucho de mantenimiento HP', 'Pack de cartuchos HP', 'Cartucho compatible HP'])(
    'excludes %s without creating printer records', async title => {
      const result = parseHpPage((await fixture()).replace('Cartucho de tinta original HP 999 Negro', title), url, date);
      expect(result.records).toEqual([]); expect(result.excluded).toHaveLength(1);
    });
  it('rejects missing SKU, family-only SKU, suffix mismatch, malformed dates and unknown page structure', async () => {
    const html = await fixture();
    for (const changed of [html.replace('SYN001AE#TST', '999'), html.replace('SYN001AE#TST', 'SYN001AE#OTH'),
      html.replace('@hpstellar/pdp/compatible-products__container', 'unknown'), html.replace('<h1>', '<h2>').replace('</h1>', '</h2>')]) {
      const result = parseHpPage(changed, url, date); expect(result.records).toEqual([]); expect(result.review).toHaveLength(1);
    }
    expect(parseHpPage(html, url, 'invalid').review[0].reason).toBe('invalid-verification-date');
  });
  it('supports toner part numbers without packaging suffix and does not guess missing attributes', async () => {
    const html = (await fixture()).replace('SYN001AE#TST', 'SYN001').replace('Cartucho de tinta original', 'Cartucho de tóner original')
      .replace('1.000 páginas', 'unknown').replace('<span>Negro</span>', '<span>unknown</span>');
    const result = parseHpPage(html, url.replace('syn001ae-tst', 'syn001'), date);
    expect(result.records).toHaveLength(2); expect(result.records[0]).toMatchObject({ cartridgeKind: 'toner', cartridgePartNumber: 'SYN001' });
    expect(result.records[0].yieldPages).toBeUndefined(); expect(result.records[0].cartridgeColor).toBeUndefined();
  });
  it('rejects non-ES, foreign, query and fragment sources', () => {
    for (const source of [url.replace('/es-es/', '/us-en/'), url.replace('www.hp.com', 'example.invalid'), url + '?id=1', url + '#id', url.replace('https://', 'https://user@')]) expect(hpSupplyUrl(source)).toBeUndefined();
  });
  it('reuses collection retry/resume and strict JSON/CSV import without duplicates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hp-')); directories.push(directory);
    const opts = { outputDirectory: directory, stateFile: join(directory, 'state.json'), seeds: [url], maxPages: 1, retries: 1 };
    const html = await fixture(); let productRequests = 0;
    const runtime = { now: () => new Date(date), sleep: async () => {}, fetcher: (async target => {
      if (String(target).endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /*api/');
      productRequests++; if (productRequests === 1) return new Response('Transient', { status: 503 });
      return new Response(String(target).includes('syn002ae') ? html.replaceAll('SYN001AE', 'SYN002AE') : html);
    }) as typeof fetch };
    expect(await collectHp(opts, runtime)).toMatchObject({ relationships: 2, pendingPages: 1, failures: [] });
    expect(productRequests).toBe(2);
    expect(await collectHp(opts, runtime)).toMatchObject({ relationships: 4, completedPages: 2, pendingPages: 0, resumed: true });
    expect(await collectHp(opts, runtime)).toMatchObject({ requestAttempts: 0, relationships: 4 });
    const db = new CartridgeDatabase(':memory:'); db.initialize();
    try {
      expect(await importCompatibilityFile(db, join(directory, 'hp.json'), true)).toMatchObject({ acceptedRecords: 4, errors: [], rejectedRecords: 0 });
      expect(db.list('printers')).toEqual([]);
      expect((await importCompatibilityFile(db, join(directory, 'hp.json'), false)).insertedRelationships).toBe(4);
      expect(await importCompatibilityFile(db, join(directory, 'hp.csv'), false)).toMatchObject({ insertedRelationships: 0, existingRelationships: 4 });
      expect(db.queryCompatibility()[0]).toMatchObject({ yield_pages: 1000, region: 'ES', verified_at: date });
    } finally { db.close(); }
  });
  it('keeps family-only records out of the shared database', async () => {
    const rows = parseHpPage((await fixture()).replace('SYN001AE#TST', '999'), url, date).records;
    const db = new CartridgeDatabase(':memory:'); db.initialize();
    try { expect(importCompatibilityRecords(db, rows, false).insertedRelationships).toBe(0); expect(db.list('cartridges')).toEqual([]); }
    finally { db.close(); }
  });
});
