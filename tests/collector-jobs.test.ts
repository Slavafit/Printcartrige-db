import { describe, expect, it } from 'vitest';
import { COLLECTOR_DEFINITIONS, collectorProgressFromCheckpoint } from '../src/collector-jobs.js';

describe('web collector command whitelist', () => {
  it('exposes only the supported fixed collectors and repository output paths', () => {
    expect(COLLECTOR_DEFINITIONS.map(item => item.id)).toEqual(['brother', 'kyocera', 'epson', 'xerox', 'hp', 'lexmark']);
    expect(COLLECTOR_DEFINITIONS.filter(item => item.script).every(item => item.script!.startsWith('dist/src/collectors/'))).toBe(true);
    expect(COLLECTOR_DEFINITIONS.every(item => item.output.startsWith('data/'))).toBe(true);
    const brother = COLLECTOR_DEFINITIONS.find(item => item.id === 'brother');
    expect(brother).toMatchObject({ importType: 'sitemap' });
    expect(brother).not.toHaveProperty('script');
  });
});

it('derives live batch progress and ETA from a synthetic checkpoint', () => {
  const progress = collectorProgressFromCheckpoint({ pages: [{}, {}, {}, {}], pending: ['a', 'b'], records: [
    { printerModel: 'Synthetic 1', cartridgePartNumber: 'SYN-1' },
    { printerModel: 'Synthetic 1', cartridgePartNumber: 'SYN-2' },
    { printerModel: 'Synthetic 2', cartridgePartNumber: 'SYN-1' },
  ], failures: [{}] }, 2, 10, '2026-01-01T00:00:00.000Z', Date.parse('2026-01-01T00:01:00.000Z'));
  expect(progress).toEqual({ processed: 2, total: 10, percent: 20, completed: 4, pending: 2, printers: 2, cartridges: 2, relationships: 3, errors: 1, etaSeconds: 240 });
});
