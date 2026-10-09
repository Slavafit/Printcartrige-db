#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { importBrotherSitemap } from './brother-sitemap.js';
import { importCompatibilityFile } from './compatibility-importer.js';
import { CartridgeDatabase, type EntityName } from './database.js';
import { exportFile } from './exporter.js';
import { importFile } from './importer.js';

const argv = process.argv.slice(2);
const dbFlag = argv.indexOf('--db');
const dbPath = dbFlag >= 0 ? argv.splice(dbFlag, 2)[1] : 'printcartridge.sqlite';
const command = argv.shift();
const dryRunCommand = (command === 'import:brother-sitemap' || command === 'import:compatibility') && argv.includes('--dry-run');
const useReadOnlyDatabase = dryRunCommand && dbPath !== ':memory:' && existsSync(dbPath);
const database = useReadOnlyDatabase
  ? new CartridgeDatabase(dbPath, { readonly: true, fileMustExist: true })
  : new CartridgeDatabase(dryRunCommand ? ':memory:' : dbPath);

try {
  if (!useReadOnlyDatabase) database.initialize();
  switch (command) {
    case 'init':
      console.log(`Initialized ${dbPath}`);
      break;
    case 'import': {
      const path = required(argv.shift(), 'import file');
      const result = await importFile(database, path, argv.includes('--dry-run'));
      console.log(JSON.stringify(result, null, 2));
      if (!result.valid) process.exitCode = 1;
      break;
    }
    case 'export': {
      const path = required(argv.shift(), 'export file');
      console.log(`Exported ${await exportFile(database, path)} record(s) to ${path}`);
      break;
    }
    case 'import:brother-sitemap': {
      const path = required(argv.shift(), 'Brother sitemap XML file');
      const result = await importBrotherSitemap(database, path, dryRunCommand);
      console.log(JSON.stringify(result, null, 2));
      if (result.errors.length) process.exitCode = 1;
      break;
    }
    case 'import:compatibility': {
      const path = required(argv.shift(), 'compatibility JSON/CSV file');
      const result = await importCompatibilityFile(database, path, dryRunCommand);
      console.log(JSON.stringify(result, null, 2));
      if (result.errors.length) process.exitCode = 1;
      break;
    }
    case 'compatibility': {
      const printerFlag = argv.indexOf('--printer');
      const printer = printerFlag >= 0 ? required(argv[printerFlag + 1], 'printer model') : undefined;
      console.log(JSON.stringify(database.queryCompatibility(printer), null, 2));
      break;
    }
    case 'compatibility:stats':
      console.log(JSON.stringify(database.compatibilityStats(), null, 2));
      break;
    case 'list':
      console.log(JSON.stringify(database.list(required(argv.shift(), 'entity') as EntityName), null, 2));
      break;
    case 'create': {
      const entity = required(argv.shift(), 'entity') as EntityName;
      console.log(JSON.stringify({ id: database.create(entity, parseJson(argv.join(' '))) }));
      break;
    }
    case 'update': {
      const entity = required(argv.shift(), 'entity') as EntityName;
      const id = Number(required(argv.shift(), 'id'));
      console.log(JSON.stringify({ updated: database.update(entity, id, parseJson(argv.join(' '))) }));
      break;
    }
    case 'delete': {
      const entity = required(argv.shift(), 'entity') as EntityName;
      const id = Number(required(argv.shift(), 'id'));
      console.log(JSON.stringify({ deleted: database.delete(entity, id) }));
      break;
    }
    default:
      console.log('Usage: pnpm db [--db file] <init|import|import:brother-sitemap|import:compatibility|compatibility|compatibility:stats|export|list|create|update|delete> ...');
      process.exitCode = command ? 1 : 0;
  }
} finally {
  database.close();
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function parseJson(value: string): Record<string, unknown> {
  const parsed = JSON.parse(required(value, 'JSON object')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object');
  return parsed as Record<string, unknown>;
}
