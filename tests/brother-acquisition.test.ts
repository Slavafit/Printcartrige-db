import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { collectBrother, isAllowedBrotherSupplyUrl } = require('../scripts/collect-brother.cjs') as {
  collectBrother(options: Record<string, unknown>): Promise<{ downloaded: Array<{ partNumber: string }>; failed: unknown[] }>;
  isAllowedBrotherSupplyUrl(value: string): boolean;
};
const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function workspace(partNumber = 'TN-TEST'): string {
  const root = mkdtempSync(resolve('.tmp-brother-acquisition-'));
  temporary.push(root);
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data', 'brother-candidates.json'), JSON.stringify([{
    manufacturer: 'Brother', partNumber, kind: 'toner',
    sourceUrl: `https://store.brother.es/supplies/laser/toner/tn/${partNumber.toLowerCase()}`,
  }]));
  return root;
}

function browser(status: number, html: string, relatedProducts: number) {
  const close = vi.fn(async () => undefined);
  return {
    close,
    newPage: async () => ({
      goto: vi.fn(async () => ({ status: () => status })),
      content: vi.fn(async () => html),
      locator: vi.fn(() => ({ count: vi.fn(async () => relatedProducts) })),
    }),
  };
}

describe('Brother official-page acquisition', () => {
  it('accepts only the fixed public Brother supply URL boundary', () => {
    expect(isAllowedBrotherSupplyUrl('https://store.brother.es/supplies/laser/toner/tn/tn1050')).toBe(true);
    expect(isAllowedBrotherSupplyUrl('https://store.brother.es/supplies/inkjet/inkcartridgessinglepack/lc/lc123bk')).toBe(true);
    expect(isAllowedBrotherSupplyUrl('https://evil.invalid/supplies/laser/toner/tn/tn1050')).toBe(false);
    expect(isAllowedBrotherSupplyUrl('http://store.brother.es/supplies/laser/toner/tn/tn1050')).toBe(false);
    expect(isAllowedBrotherSupplyUrl('https://store.brother.es/devices/laser/hl/hl1210w')).toBe(false);
    expect(isAllowedBrotherSupplyUrl('https://store.brother.es/supplies/laser/toner/tn/tn1050?tracking=1')).toBe(false);
  });

  it('saves an explicit compatibility page and resumable history without touching SQLite', async () => {
    const root = workspace();
    const fake = browser(200, '<section id="related-products">Synthetic fixture</section>', 1);
    const report = await collectBrother({ root, limit: 1, delayMs: 1000, launchBrowser: async () => fake });

    expect(report.downloaded).toEqual([expect.objectContaining({ partNumber: 'TN-TEST' })]);
    expect(report.failed).toEqual([]);
    expect(readFileSync(join(root, 'data', 'brother-html', 'tn-test.html'), 'utf8')).toContain('Synthetic fixture');
    expect(JSON.parse(readFileSync(join(root, 'data', 'brother-collection-history.json'), 'utf8')).downloaded).toHaveProperty(
      'https://store.brother.es/supplies/laser/toner/tn/tn-test',
    );
    expect(existsSync(join(root, '.collector-state', 'brother-processing.json'))).toBe(true);
    expect(fake.close).toHaveBeenCalledOnce();
    expect(existsSync(join(root, 'printcartridge.sqlite'))).toBe(false);
  });

  it('stops on an access block and does not publish blocked HTML', async () => {
    const root = workspace('TN-BLOCKED');
    const fake = browser(403, '<html>Forbidden</html>', 0);
    await expect(collectBrother({ root, limit: 1, delayMs: 1000, launchBrowser: async () => fake })).rejects.toThrow(/HTTP 403/);
    expect(existsSync(join(root, 'data', 'brother-html', 'tn-blocked.html'))).toBe(false);
    const report = JSON.parse(readFileSync(join(root, 'data', 'brother-collection-report.json'), 'utf8'));
    expect(report.failed).toEqual([expect.objectContaining({ partNumber: 'TN-BLOCKED', reason: 'access-blocked' })]);
    expect(fake.close).toHaveBeenCalledOnce();
  });
});
