import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareCollectorWorkspace, prepareWebClient } from '../src/collector-runtime.js';
import { CollectorJobs } from '../src/collector-jobs.js';
import type { CartridgeDatabase } from '../src/database.js';

const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function temp(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), `printerdb-${name}-`));
  temporary.push(directory);
  return directory;
}

describe('packaged collector runtime', () => {
  it('refreshes bundled scripts without overwriting user data', () => {
    const seed = temp('seed');
    const workspace = temp('workspace');
    mkdirSync(join(seed, 'scripts'), { recursive: true });
    mkdirSync(join(seed, 'data'), { recursive: true });
    mkdirSync(join(workspace, 'scripts'), { recursive: true });
    mkdirSync(join(workspace, 'data'), { recursive: true });
    writeFileSync(join(seed, 'scripts', 'parser.cjs'), 'new parser');
    writeFileSync(join(workspace, 'scripts', 'parser.cjs'), 'old parser');
    writeFileSync(join(seed, 'data', 'verification.json'), 'bundled data');
    writeFileSync(join(workspace, 'data', 'verification.json'), 'user data');

    prepareCollectorWorkspace(seed, workspace);

    expect(readFileSync(join(workspace, 'scripts', 'parser.cjs'), 'utf8')).toBe('new parser');
    expect(readFileSync(join(workspace, 'data', 'verification.json'), 'utf8')).toBe('user data');
  });

  it('does not require a pre-existing Brother HTML folder before starting the full cycle', () => {
    const workspace = temp('jobs');
    const jobs = new CollectorJobs({} as CartridgeDatabase, { appRoot: 'C:\\packaged-app', workspaceRoot: workspace });
    const brother = jobs.list().find(job => job.id === 'brother');
    expect(brother?.input).toBeUndefined();
    expect(brother?.inputExists).toBe(true);
  });

  it('refreshes the web client in a persistent runtime directory', () => {
    const source = temp('web-source');
    const target = temp('web-target');
    mkdirSync(join(source, 'assets'));
    writeFileSync(join(source, 'index.html'), 'new index');
    writeFileSync(join(source, 'assets', 'app.js'), 'new asset');
    writeFileSync(join(target, 'index.html'), 'old index');

    prepareWebClient(source, target);

    expect(readFileSync(join(target, 'index.html'), 'utf8')).toBe('new index');
    expect(readFileSync(join(target, 'assets', 'app.js'), 'utf8')).toBe('new asset');
  });

  it('packages the Brother parser runtime and verification seed', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { build: { extraResources: Array<{ from: string; to: string }> } };
    expect(packageJson.build.extraResources).toEqual(expect.arrayContaining([
      { from: 'scripts/parse-brother.cjs', to: 'collector-runtime/scripts/parse-brother.cjs' },
      { from: 'scripts/rebuild-brother-data.cjs', to: 'collector-runtime/scripts/rebuild-brother-data.cjs' },
      { from: 'scripts/brother-model.cjs', to: 'collector-runtime/scripts/brother-model.cjs' },
      { from: 'scripts/collect-brother.cjs', to: 'collector-runtime/scripts/collect-brother.cjs' },
      { from: 'data/brother-verification.json', to: 'collector-runtime/data/brother-verification.json' },
      { from: 'data/brother-candidates.json', to: 'collector-runtime/data/brother-candidates.json' },
    ]));
  });
});
