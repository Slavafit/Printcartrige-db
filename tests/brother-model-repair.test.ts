import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { normalizeModelIdentity, resolveBrotherModel } = require('../scripts/brother-model.cjs') as {
  normalizeModelIdentity(value: string): string;
  resolveBrotherModel(label: string, url: string): { model: string; corrected: boolean };
};
const { parseBrotherHtml } = require('../scripts/parse-brother.cjs') as {
  parseBrotherHtml(html: string): { printers: Array<{ model: string; url: string }>; compatibility: Array<{ printerModel: string }> };
};

const readJson = (path: string): any => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));

describe('Brother model repair', () => {
  it('applies only the three confirmed label corrections and accepts the saved bundle suffix', () => {
    const parsed = parseBrotherHtml(readFileSync('tests/fixtures/brother-model-labels-synthetic.html', 'utf8'));
    expect(parsed.printers.map(row => row.model)).toEqual(['MFC-3360C', 'MFC-295CN', 'MFC-7440N', 'HL-1210W', 'DCP-T580DW']);
    expect(parsed.compatibility.map(row => row.printerModel)).toEqual(parsed.printers.map(row => row.model));
  });

  it('fails closed for an unconfirmed label and URL mismatch', () => {
    expect(() => resolveBrotherModel('MFC-1234', 'https://store.brother.es/devices/laser/mfc/mfc5678')).toThrow(/Неподтверждённое расхождение/);
  });

  it('keeps the committed Brother set aligned with official URLs and free of normalized duplicates', () => {
    const collection = readJson('data/brother-compatibility.json');
    const identities = new Set<string>();
    const modelNames = new Set<string>();
    for (const printer of collection.printers) {
      expect(resolveBrotherModel(printer.model, printer.url)).toMatchObject({ model: printer.model, corrected: false });
      const identity = normalizeModelIdentity(printer.model);
      expect(identities.has(identity)).toBe(false);
      identities.add(identity);
      modelNames.add(printer.model);
    }
    const relationshipKeys = new Set<string>();
    for (const relationship of collection.compatibility) {
      expect(modelNames.has(relationship.printerModel)).toBe(true);
      const key = `${normalizeModelIdentity(relationship.printerModel)}|${String(relationship.supplyPartNumber).toUpperCase()}`;
      expect(relationshipKeys.has(key)).toBe(false);
      relationshipKeys.add(key);
    }
    expect(collection.printers).toHaveLength(293);
    expect(collection.supplies).toHaveLength(254);
    expect(collection.compatibility).toHaveLength(1611);
    expect(collection.printers.map((row: { model: string }) => row.model)).toEqual(expect.arrayContaining(['MFC-3360C', 'MFC-295CN', 'MFC-7440N']));
    expect(collection.printers.map((row: { model: string }) => row.model)).not.toEqual(expect.arrayContaining(['MFC-3360CN', 'MFC-295C', 'MFC-7']));
    const sitemap = readFileSync('data/sitemap.xml', 'utf8');
    for (const slug of ['mfc3360c', 'mfc295cn', 'mfc7440n']) expect(sitemap).toContain(`https://store.brother.es/devices/laser/mfc/${slug}`);
    expect(readJson('data/brother-model-repair-report.json')).toMatchObject({
      printers: 293, supplies: 254, relationships: 1611, normalizedDuplicates: 0, unconfirmedMismatches: 0,
      correctedModels: [
        { from: 'MFC-3360CN', to: 'MFC-3360C', relationships: 4 },
        { from: 'MFC-295C', to: 'MFC-295CN', relationships: 8 },
        { from: 'MFC-7', to: 'MFC-7440N', relationships: 2 },
      ],
    });
  });

  it('preserves every audit status category after regeneration', () => {
    const audit = readJson('data/brother-audit.json');
    const counts = Object.fromEntries(['cross-referenced', 'candidate', 'not-checkable'].map(status => [status, audit.compatibility.filter((row: { status: string }) => row.status === status).length]));
    expect(counts).toEqual({ 'cross-referenced': 1606, candidate: 4, 'not-checkable': 1 });
    expect(audit.summary).toMatchObject({ printersTotal: 293, printersChecked: 293, suppliesTotal: 254, linksTotal: 1611, crossReferenced: 1606, candidates: 4, notCheckable: 1 });
  });
});
