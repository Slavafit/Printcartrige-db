import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CartridgeDatabase } from '../src/database.js';
import { exportFile } from '../src/exporter.js';
import { importFile } from '../src/importer.js';

describe('CSV and JSON file I/O with synthetic fixtures', () => {
  let database: CartridgeDatabase;
  let directory: string;
  beforeEach(async () => { database = new CartridgeDatabase(':memory:'); database.initialize(); directory = await mkdtemp(join(tmpdir(), 'printcartridge-')); });
  afterEach(async () => { database.close(); await rm(directory, { recursive: true, force: true }); });

  it.each(['json', 'csv'])('imports %s and exports JSON and CSV', async (extension) => {
    const fixture = resolve(`tests/fixtures/synthetic-import.${extension}`);
    expect((await importFile(database, fixture)).valid).toBe(true);
    const jsonPath = join(directory, 'export.json');
    const csvPath = join(directory, 'export.csv');
    expect(await exportFile(database, jsonPath)).toBeGreaterThan(0);
    expect(await exportFile(database, csvPath)).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(jsonPath, 'utf8'))).toBeInstanceOf(Array);
    expect(await readFile(csvPath, 'utf8')).toContain('printerManufacturer');
  });
});
