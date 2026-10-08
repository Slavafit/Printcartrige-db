import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectKyocera, parseKyoceraConsumablePage, parseSitemap } from '../src/collectors/kyocera.js';

const sourceUrl = 'https://www.kyoceradocumentsolutions.eu/en/products/consumables/TK9999K.html';
const fixturePath = resolve('tests/fixtures/kyocera-consumable-synthetic.html');
const directories: string[] = [];

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('Kyocera collector with synthetic non-production fixtures', () => {
  it('extracts toner compatibility and excludes non-printer related products', async () => {
    const records = parseKyoceraConsumablePage(await readFile(fixturePath, 'utf8'), sourceUrl);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      printerModel: 'ECOSYS TEST-1', cartridgePartNumber: 'TK-9999K', cartridgeKind: 'toner',
      cartridgeColor: 'black', sourceUrl, verificationStatus: 'verified', region: 'EU', isGenuineOem: true,
    });
  });

  it('parses and deduplicates only official Kyocera consumable URLs', () => {
    const xml = `<urlset><url><loc>${sourceUrl}</loc></url><url><loc>${sourceUrl}</loc></url><url><loc>https://example.invalid/TK1.html</loc></url></urlset>`;
    expect(parseSitemap(xml)).toEqual([sourceUrl]);
  });

  it('retries failures, writes both formats, and resumes completed pages', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kyocera-collector-'));
    directories.push(directory);
    const html = await readFile(fixturePath, 'utf8');
    const sitemap = `<urlset><url><loc>${sourceUrl}</loc></url></urlset>`;
    let calls = 0;
    const fetcher = (async (url: string | URL | Request) => {
      calls += 1;
      if (calls === 1) throw new Error('Synthetic transient failure');
      return new Response(String(url).includes('sitemap') ? sitemap : html, { status: 200 });
    }) as typeof fetch;
    const options = {
      sitemapUrl: 'https://www.kyoceradocumentsolutions.eu/sitemap.xml',
      jsonOutput: join(directory, 'result.json'), csvOutput: join(directory, 'result.csv'),
      stateFile: join(directory, 'state.json'), maxModels: 10, delayMs: 0, retries: 1,
    };

    expect(await collectKyocera(options, fetcher)).toMatchObject({ models: 1, relationships: 1, failedPages: 0, resumed: false });
    expect(await readFile(options.csvOutput, 'utf8')).toContain('ECOSYS TEST-1');
    const callsBeforeResume = calls;
    expect(await collectKyocera(options, fetcher)).toMatchObject({ models: 1, relationships: 1, resumed: true });
    expect(calls).toBe(callsBeforeResume + 1); // sitemap only; completed product page is skipped
  });
});
