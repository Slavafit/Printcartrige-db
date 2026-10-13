// Reproducible experiment: always creates a NEW directory and a separate SQLite.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { CartridgeDatabase } from './database.js';
import { importBrotherSitemap } from './brother-sitemap.js';
import { importCompatibilityFile } from './compatibility-importer.js';
import { coverageDelta, coverageReport } from './coverage.js';
import { importMultiSource, parsePrinterTonerDbPair } from './multi-source-import.js';

const args = process.argv.slice(2);
const directory = args[args.indexOf('--output-dir')+1];
if (!args.includes('--output-dir') || !directory) throw new Error('Supply --output-dir <new-directory>; an existing directory is never reused');
const files = {
  'data/Printers2Toners.txt':'b354e02f6be3e5904a3d15497f8030b2143c74c45ed2527f8fca3168e63847b8',
  'data/Toner2Printers.txt':'d5a1890fb3681b2f1a7eb30623adffcead9e1d8838ed65ff84bab4f1ff4cbb9e',
};
for (const [file,hash] of Object.entries(files)) {
  if (createHash('sha256').update(readFileSync(file)).digest('hex') !== hash) throw new Error(`Source hash mismatch: ${file}`);
}
mkdirSync(directory); // Fails if it already exists; cannot open a user's working DB.
const database = new CartridgeDatabase(join(directory,'experiment.sqlite'));
const save = (name:string,value:unknown) => writeFileSync(join(directory,`${name}.json`),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
try {
  database.initialize();
  const seed = [await importBrotherSitemap(database,'data/sitemap.xml',false)];
  const official = [];
  for (const file of ['data/official/kyocera-eu.json','data/official/xerox/xerox.json']) {
    const result = await importCompatibilityFile(database,file,false);
    if (result.errors.length) throw new Error(`Seed failed: ${file}`);
    official.push({file,result});
  }
  if (seed.some(result=>result.errors.length)) throw new Error('Sitemap seed failed');
  save('seed',{seed,official});
  const before = coverageReport(database);
  save('before',before);
  const verifiedBefore = database.db.prepare("SELECT * FROM compatibility WHERE reliability_status='official_verified' ORDER BY id").all();
  const parsed = parsePrinterTonerDbPair(readFileSync('data/Printers2Toners.txt'),readFileSync('data/Toner2Printers.txt'),database);
  // No new printers from an unrelated manufacturer in this experiment.
  const selected = { ...parsed, rows:parsed.rows.filter(row=>['HP','CANON','EPSON'].includes(row.printerManufacturer.toUpperCase())) };
  const options = { sourceName:'PrinterTonerDB (kurcz)',sourceCategory:'open_dataset' as const,
    sourceReference:'https://github.com/kurcz/PrinterTonerDB/tree/ded2df49109534569dabe7b6a39df7713ac44bfc',reliabilityStatus:'third_party_reported' as const };
  const preview = importMultiSource(database,selected,options,true);
  if (JSON.stringify(before)!==JSON.stringify(coverageReport(database))) throw new Error('Dry run changed coverage');
  save('dry-run',preview);
  const imported = importMultiSource(database,selected,options);
  save('import',imported);
  const after = coverageReport(database);
  save('after',after);
  save('delta',coverageDelta(before,after));
  const repeat = importMultiSource(database,selected,options);
  save('repeat',repeat);
  if (repeat.createdPrinters || repeat.createdSupplies || repeat.createdRelationships || repeat.addedSources) throw new Error('Import is not idempotent');
  const verifiedAfter = database.db.prepare("SELECT * FROM compatibility WHERE reliability_status='official_verified' ORDER BY id").all();
  if (JSON.stringify(verifiedBefore)!==JSON.stringify(verifiedAfter)) throw new Error('Official data changed');
  const forms = database.db.prepare('SELECT kind,supply_form,count(*) count FROM cartridges GROUP BY kind,supply_form').all();
  const familyCoverage = Object.fromEntries([
    ['HP','LaserJet'],['HP','Color LaserJet'],['HP','DeskJet'],['HP','OfficeJet'],
    ['CANON','PIXMA'],['CANON','i-SENSYS'],['CANON','MAXIFY'],
    ['EPSON','WorkForce'],['EPSON','Expression'],['EPSON','EcoTank'],
  ].map(([maker,family])=>[`${maker} ${family}`,database.db.prepare(`SELECT count(*) totalPrinters,
    COALESCE(sum(CASE WHEN EXISTS(SELECT 1 FROM compatibility cp WHERE cp.printer_id=p.id AND cp.verification_status<>'rejected' AND cp.reliability_status<>'conflicting') THEN 1 ELSE 0 END),0) printersWithSupplies
    FROM printers p JOIN manufacturers m ON m.id=p.manufacturer_id WHERE m.normalized_name=? AND lower(p.model_name) LIKE ?`).get(maker,`%${family.toLowerCase()}%`)]));
  const summary = { generatedAt:new Date().toISOString(),base:'Repository MVP seed; not a measurement of the user production database',
    source:{owner:'kurcz',license:'Apache-2.0',commit:'ded2df49109534569dabe7b6a39df7713ac44bfc',files},
    sourceRows:parsed.rows.length,selectedRows:selected.rows.length,diagnosticsScope:'Both complete source files (all manufacturers)',
    before:before.total,after:after.total,delta:coverageDelta(before,after),forms,familyCoverage,
    rejected:imported.rejected,review:imported.warnings,officialPreserved:true,
    integrity:database.db.pragma('integrity_check'),foreignKeys:database.db.pragma('foreign_key_check') };
  save('summary',summary);
  console.log(JSON.stringify({outputDirectory:resolve(directory),...summary},null,2));
} finally { database.close(); }
