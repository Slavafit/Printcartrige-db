#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { importBrotherSitemap } from './brother-sitemap.js';
import { importCompatibilityFile } from './compatibility-importer.js';
import { CartridgeDatabase } from './database.js';

const args = process.argv.slice(2);
const dbIndex = args.indexOf('--db');
const databasePath = dbIndex >= 0 ? args[dbIndex + 1] : 'mvp.sqlite';
if (!databasePath) throw new Error('Missing value after --db');
const database = new CartridgeDatabase(databasePath);
try {
  database.initialize();
  const brother = await importBrotherSitemap(database, 'data/sitemap.xml', false);
  const imports = [];
  for (const path of ['data/official/kyocera-eu.json', 'data/official/xerox/xerox.json']) {
    if (existsSync(path)) imports.push({ path, result: await importCompatibilityFile(database, path, false) });
  }
  console.log(JSON.stringify({ database: databasePath, brother: { inserted: brother.insertedModels, existing: brother.existingModels }, compatibilityImports: imports.map(({ path, result }) => ({ path, inserted: result.insertedRelationships, existing: result.existingRelationships, rejected: result.rejectedRecords, manualReview: result.recordsRequiringManualReview })), stats: database.compatibilityStats() }, null, 2));
} finally { database.close(); }
