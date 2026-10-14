import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { processBrotherHtml, type BrotherProcessingPaths } from '../src/collectors/brother.js';

const temporaryDirectories: string[] = [];
afterEach(() => { for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('Brother offline UI processor', () => {
  it('parses saved HTML, preserves verification states and replaces validated outputs safely', async () => {
    const root = await mkdtemp(resolve('.tmp-brother-ui-'));
    temporaryDirectories.push(root);
    const inputDirectory = join(root, 'html');
    mkdirSync(inputDirectory);
    copyFileSync('tests/fixtures/brother-model-labels-synthetic.html', join(inputDirectory, 'tn-test.html'));
    const verification = join(root, 'brother-verification.json');
    writeFileSync(verification, JSON.stringify({ manufacturer: 'Brother', printers: {
      'MFC-3360C': checked('MFC-3360C', 'mfc3360c', true, true),
      'MFC-295CN': checked('MFC-295CN', 'mfc295cn', true, false),
      'MFC-7440N': checked('MFC-7440N', 'mfc7440n', false, false),
      'HL-1210W': checked('HL-1210W', 'hl1210w-bundle', true, true),
      'DCP-T580DW': checked('DCP-T580DW', 'dcpt580dw', true, true),
    } }), 'utf8');
    const paths: BrotherProcessingPaths = {
      inputDirectory, verification,
      collection: join(root, 'brother-compatibility.json'), repairReport: join(root, 'brother-model-repair-report.json'),
      audit: join(root, 'brother-audit.json'), importFile: join(root, 'official', 'brother-supplies.json'),
      importReport: join(root, 'official', 'brother-supplies-report.json'), checkpoint: join(root, 'state', 'brother.json'),
    };

    const first = processBrotherHtml(paths, () => new Date('2026-10-14T12:00:00.000Z'));
    const second = processBrotherHtml(paths, () => new Date('2026-10-14T13:00:00.000Z'));

    expect(first).toEqual({ htmlFiles: 1, printers: 5, supplies: 1, relationships: 5, crossReferenced: 3, candidates: 1, notCheckable: 1, importableRelationships: 3 });
    expect(second).toEqual(first);
    const audit = JSON.parse(readFileSync(paths.audit, 'utf8')) as { compatibility: Array<{ status: string }> };
    expect(audit.compatibility.map(item => item.status).sort()).toEqual(['candidate', 'cross-referenced', 'cross-referenced', 'cross-referenced', 'not-checkable']);
    const rows = JSON.parse(readFileSync(paths.importFile, 'utf8')) as Array<{ reliabilityStatus: string }>;
    expect(rows).toHaveLength(3);
    expect(rows.every(row => row.reliabilityStatus === 'official_verified')).toBe(true);
  });
});

function checked(model: string, slug: string, sectionFound: boolean, reverseMatch: boolean) {
  return {
    printerUrl: `https://store.brother.es/devices/laser/mfc/${slug}`,
    sectionFound,
    results: [{ printerModel: model, supplyPartNumber: 'TN-TEST', reverseMatch }],
  };
}
