import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importBrotherSitemap, parseBrotherSitemap } from '../src/brother-sitemap.js';
import { CartridgeDatabase } from '../src/database.js';
import { normalizePrinterModel } from '../src/normalize.js';

const fixturePath = resolve('tests/fixtures/brother-sitemap-synthetic.xml');

describe('Brother España sitemap parser', () => {
  it('extracts, normalizes, deduplicates, and reports every excluded URL', async () => {
    const report = parseBrotherSitemap(await readFile(fixturePath, 'utf8'));
    expect(report).toMatchObject({
      totalSitemapUrls: 9,
      matchingDevicePages: 6,
      validPrinterCandidates: 3,
      uniqueNormalizedModels: 2,
      duplicateUrls: 1,
      duplicateModelIdentifiers: 1,
    });
    expect(report.candidates.map((candidate) => candidate.modelName)).toEqual(['Brother HL-2070N', 'Brother MFC-J1050DW']);
    expect(report.rejectedUrls.map((entry) => entry.reason)).toEqual(expect.arrayContaining([
      'ambiguous-bundle-slug', 'unsupported-device-category:label-printer', 'not-device-path', 'non-brother-domain', 'invalid-url',
    ]));
  });

  it('normalizes prefixed and unprefixed Brother model names consistently', () => {
    expect(normalizePrinterModel('Brother HL-2070N')).toBe('HL2070N');
    expect(normalizePrinterModel('HL 2070N')).toBe('HL2070N');
  });

  it('rejects invalid XML', () => {
    expect(() => parseBrotherSitemap('<urlset><url><loc>broken</urlset>')).toThrow('Invalid sitemap XML');
  });

  it('parses the committed real sitemap offline', async () => {
    const report = parseBrotherSitemap(await readFile(resolve('data/sitemap.xml'), 'utf8'));
    expect(report.totalSitemapUrls).toBe(1999);
    expect(report.matchingDevicePages).toBe(662);
    expect(report.candidates.some((candidate) => candidate.modelName === 'Brother HL-2070N')).toBe(true);
  });
});

describe('Brother sitemap database import', () => {
  let database: CartridgeDatabase;
  beforeEach(() => { database = new CartridgeDatabase(':memory:'); database.initialize(); });
  afterEach(() => database.close());

  it('dry-run does not modify any database table', async () => {
    const result = await importBrotherSitemap(database, fixturePath, true);
    expect(result.modelsWouldBeInserted).toBe(2);
    expect(database.list('manufacturers')).toHaveLength(0);
    expect(database.list('printers')).toHaveLength(0);
    expect(database.list('data_sources')).toHaveLength(0);
    expect(database.list('printer_sources')).toHaveLength(0);
  });

  it('is idempotent and creates no cartridge compatibility', async () => {
    const first = await importBrotherSitemap(database, fixturePath, false);
    const second = await importBrotherSitemap(database, fixturePath, false);
    expect(first).toMatchObject({ insertedModels: 2, existingModels: 0, totalBrotherModelsAfterImport: 2 });
    expect(second).toMatchObject({ insertedModels: 0, existingModels: 2, totalBrotherModelsAfterImport: 2 });
    expect(database.list('printers')).toHaveLength(2);
    expect(database.list('printer_sources')).toHaveLength(2);
    expect(database.list('cartridges')).toHaveLength(0);
    expect(database.list('compatibility')).toHaveLength(0);
  });

  it('preserves an existing printer display name and verified provenance', async () => {
    const manufacturerId = database.create('manufacturers', { name: 'Brother' });
    const printerId = database.create('printers', { manufacturer_id: manufacturerId, model_name: 'HL-2070N', has_replaceable_cartridges: 1 });
    const sourceUrl = 'https://store.brother.es/devices/laser/hl/hl2070n';
    const sourceId = database.create('data_sources', { name: 'Previously verified official source', url: sourceUrl });
    database.create('printer_sources', { printer_id: printerId, source_id: sourceId, source_url: sourceUrl, verification_status: 'verified', region: 'ES' });

    const result = await importBrotherSitemap(database, fixturePath, false);
    expect(result.insertedModels).toBe(1);
    expect(database.list('printers')).toEqual(expect.arrayContaining([expect.objectContaining({ id: printerId, model_name: 'HL-2070N' })]));
    expect(database.list('printer_sources')).toEqual(expect.arrayContaining([expect.objectContaining({ printer_id: printerId, verification_status: 'verified' })]));
  });
});
