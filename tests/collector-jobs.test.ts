import { describe, expect, it } from 'vitest';
import { COLLECTOR_DEFINITIONS } from '../src/collector-jobs.js';

describe('web collector command whitelist', () => {
  it('exposes only the supported fixed collectors and repository output paths', () => {
    expect(COLLECTOR_DEFINITIONS.map(item => item.id)).toEqual(['brother', 'kyocera', 'epson', 'xerox', 'hp']);
    expect(COLLECTOR_DEFINITIONS.filter(item => item.script).every(item => item.script!.startsWith('dist/src/collectors/'))).toBe(true);
    expect(COLLECTOR_DEFINITIONS.every(item => item.output.startsWith('data/'))).toBe(true);
    const brother = COLLECTOR_DEFINITIONS.find(item => item.id === 'brother');
    expect(brother).toMatchObject({ importType: 'sitemap' });
    expect(brother).not.toHaveProperty('script');
  });
});
