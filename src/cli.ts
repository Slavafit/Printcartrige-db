#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { importBrotherSitemap } from './brother-sitemap.js';
import { importCompatibilityFile } from './compatibility-importer.js';
import { CartridgeDatabase, type EntityName } from './database.js';
import { exportFile } from './exporter.js';
import { importFile } from './importer.js';
import { importMultiSource, parseMultiSourceFile, parsePrinterTonerDbPair, type MultiSourceOptions, type ReliabilityStatus, type SourceCategory } from './multi-source-import.js';

const argv = process.argv.slice(2);
const dbFlag = argv.indexOf('--db');
const dbPath = dbFlag >= 0 ? argv.splice(dbFlag, 2)[1] : 'printcartridge.sqlite';
const command = argv.shift();
const dryRunCommand = ['import:brother-sitemap', 'import:compatibility', 'import:multi-source', 'import:printertonerdb'].includes(command ?? '') && argv.includes('--dry-run');
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
    case 'import:multi-source': {
      const path = required(argv.shift(), 'CSV, TSV, XLSX or JSON file');
      const parsed = await parseMultiSourceFile(path, database);
      const result = importMultiSource(database, parsed, importOptions(argv), dryRunCommand);
      console.log(JSON.stringify(result, null, 2));
      if (result.errors.length) process.exitCode = 1;
      break;
    }
    case 'import:printertonerdb': {
      const primary = required(argv.shift(), 'Printers2Toners.csv file');
      const reverse = required(argv.shift(), 'Toner2Printers.csv file');
      const parsed = parsePrinterTonerDbPair(readFileSync(primary), readFileSync(reverse), database);
      const result = importMultiSource(database, parsed, {
        sourceName: 'PrinterTonerDB', sourceCategory: 'open_dataset',
        sourceReference: 'https://github.com/kurcz/PrinterTonerDB',
        reliabilityStatus: 'third_party_reported', region: flag(argv, '--region') ?? 'unknown',
      }, dryRunCommand);
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
      console.log('Usage: pnpm db [--db file] <init|import|import:multi-source|import:printertonerdb|import:brother-sitemap|import:compatibility|compatibility|compatibility:stats|export|list|create|update|delete> ...');
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

function flag(values: string[], name: string): string | undefined {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}

function importOptions(values: string[]): MultiSourceOptions {
  return {
    sourceName: flag(values, '--source-name') ?? 'Importación local',
    sourceCategory: (flag(values, '--source-category') ?? 'unknown') as SourceCategory,
    sourceReference: flag(values, '--source-reference') ?? 'unknown://local-import',
    region: flag(values, '--region') ?? 'unknown',
    reliabilityStatus: flag(values, '--reliability') as ReliabilityStatus | undefined,
  };
}
