import { describe, expect, it } from 'vitest';
import { normalizeCartridgePartNumber, normalizePrinterModel } from '../src/normalize.js';

describe('normalization', () => {
  it('normalizes equivalent printer model spellings', () => {
    expect(normalizePrinterModel(' Demo-Print  1000 ')).toBe('DEMOPRINT1000');
    expect(normalizePrinterModel('demo print-1000')).toBe('DEMOPRINT1000');
  });

  it('normalizes cartridge punctuation and case', () => {
    expect(normalizeCartridgePartNumber(' syn-ink 01/bk ')).toBe('SYNINK01BK');
  });
});
