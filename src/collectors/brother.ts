import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBrotherSupplyImport } from '../brother-supply-import.js';

const require = createRequire(import.meta.url);
const { parseBrotherHtml } = require(resolve('scripts/parse-brother.cjs')) as {
  parseBrotherHtml(html: string): ParsedPage;
};
const { rebuildBrotherData } = require(resolve('scripts/rebuild-brother-data.cjs')) as {
  rebuildBrotherData(collection: BrotherCollection, verification: BrotherVerification): RebuiltBrotherData;
};

interface Supply { partNumber: string; type: string; sourceUrl: string }
interface Printer { model: string; url: string }
interface Compatibility { printerModel: string; supplyPartNumber: string; sourceUrl: string; status: string }
interface ParsedPage { manufacturer: string; supply: Supply; printers: Printer[]; compatibility: Compatibility[] }
interface BrotherCollection { manufacturer: string; supplies: Supply[]; printers: Printer[]; compatibility: Compatibility[] }
interface VerificationResult { printerModel: string; supplyPartNumber: string; reverseMatch?: boolean; [key: string]: unknown }
interface VerificationPrinter { printerUrl: string; sectionFound: boolean; results?: VerificationResult[]; [key: string]: unknown }
interface BrotherVerification { manufacturer?: string; printers: Record<string, VerificationPrinter> }
interface RebuiltBrotherData { collection: BrotherCollection; verification: BrotherVerification; report: Record<string, unknown> }

export interface BrotherProcessingPaths {
  inputDirectory: string;
  verification: string;
  collection: string;
  repairReport: string;
  audit: string;
  importFile: string;
  importReport: string;
  checkpoint: string;
}

export interface BrotherProcessingSummary {
  htmlFiles: number;
  printers: number;
  supplies: number;
  relationships: number;
  crossReferenced: number;
  candidates: number;
  notCheckable: number;
  importableRelationships: number;
}

const DEFAULT_PATHS: BrotherProcessingPaths = {
  inputDirectory: resolve('data/brother-html'),
  verification: resolve('data/brother-verification.json'),
  collection: resolve('data/brother-compatibility.json'),
  repairReport: resolve('data/brother-model-repair-report.json'),
  audit: resolve('data/brother-audit.json'),
  importFile: resolve('data/official/brother/brother-supplies.json'),
  importReport: resolve('data/official/brother/brother-supplies-report.json'),
  checkpoint: resolve('.collector-state/brother-processing.json'),
};

export function processBrotherHtml(paths: BrotherProcessingPaths = DEFAULT_PATHS, now = () => new Date()): BrotherProcessingSummary {
  if (!existsSync(paths.inputDirectory)) throw new Error(`No existe la carpeta de páginas Brother: ${paths.inputDirectory}`);
  if (!existsSync(paths.verification)) throw new Error(`No existe la verificación Brother guardada: ${paths.verification}`);
  const files = readdirSync(paths.inputDirectory).filter(name => /\.html?$/i.test(name)).sort();
  if (!files.length) throw new Error(`No hay archivos HTML en ${paths.inputDirectory}`);

  const supplies = new Map<string, Supply>();
  const printers = new Map<string, Printer>();
  const compatibility = new Map<string, Compatibility>();
  const pages: string[] = [];
  const failures: Array<{ file: string; error: string }> = [];
  writeCheckpoint(paths.checkpoint, { total: files.length, pages, pending: files, records: [], failures });

  for (const name of files) {
    try {
      const page = parseBrotherHtml(readFileSync(resolve(paths.inputDirectory, name), 'utf8'));
      const part = page.supply.partNumber.toUpperCase();
      supplies.set(part, { ...page.supply, partNumber: part });
      for (const printer of page.printers) printers.set(printer.model.toUpperCase(), printer);
      for (const link of page.compatibility) {
        const normalized = { ...link, printerModel: link.printerModel.toUpperCase(), supplyPartNumber: part };
        compatibility.set(`${normalized.printerModel}|${part}`, normalized);
      }
      pages.push(name);
      writeCheckpoint(paths.checkpoint, { total: files.length, pages, pending: files.slice(pages.length), records: [...compatibility.values()], failures });
      console.log(`[Brother] ${pages.length}/${files.length}: ${name}`);
    } catch (error) {
      failures.push({ file: name, error: error instanceof Error ? error.message : String(error) });
      writeCheckpoint(paths.checkpoint, { total: files.length, pages, pending: files.slice(pages.length), records: [...compatibility.values()], failures });
      throw new Error(`No se pudo procesar ${name}: ${failures.at(-1)!.error}`);
    }
  }

  const collection: BrotherCollection = {
    manufacturer: 'Brother', supplies: [...supplies.values()], printers: [...printers.values()], compatibility: [...compatibility.values()],
  };
  const verification = readJson<BrotherVerification>(paths.verification);
  const rebuilt = rebuildBrotherData(collection, verification);
  const audit = buildAudit(rebuilt.collection, rebuilt.verification, now().toISOString());
  const prepared = prepareBrotherSupplyImport(rebuilt.collection, audit);
  if (prepared.parsed.errors.length) throw new Error(`La preparación Brother produjo ${prepared.parsed.errors.length} errores`);

  writeJsonAtomically(paths.collection, rebuilt.collection);
  writeJsonAtomically(paths.verification, rebuilt.verification);
  writeJsonAtomically(paths.repairReport, rebuilt.report);
  writeJsonAtomically(paths.audit, audit);
  writeJsonAtomically(paths.importFile, prepared.parsed.rows);
  writeJsonAtomically(paths.importReport, { ...prepared.summary, errors: prepared.parsed.errors, review: prepared.parsed.warnings });

  const summary: BrotherProcessingSummary = {
    htmlFiles: files.length,
    printers: rebuilt.collection.printers.length,
    supplies: rebuilt.collection.supplies.length,
    relationships: rebuilt.collection.compatibility.length,
    crossReferenced: audit.summary.crossReferenced,
    candidates: audit.summary.candidates,
    notCheckable: audit.summary.notCheckable,
    importableRelationships: prepared.summary.acceptedRelationships,
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

function buildAudit(collection: BrotherCollection, verification: BrotherVerification, generatedAt: string) {
  const links = collection.compatibility.map(candidate => {
    const model = candidate.printerModel.toUpperCase();
    const part = candidate.supplyPartNumber.toUpperCase();
    const printer = verification.printers[model];
    const reverse = printer?.results?.find(result => result.supplyPartNumber.toUpperCase() === part);
    const status = reverse?.reverseMatch ? 'cross-referenced' : printer && !printer.sectionFound ? 'not-checkable' : 'candidate';
    return { printerModel: model, supplyPartNumber: part, status, printerSourceUrl: printer?.printerUrl ?? '', supplySourceUrl: candidate.sourceUrl };
  });
  return {
    manufacturer: 'Brother', generatedAt,
    summary: {
      printersTotal: collection.printers.length,
      printersChecked: Object.keys(verification.printers).filter(model => collection.printers.some(printer => printer.model === model)).length,
      suppliesTotal: collection.supplies.length,
      linksTotal: links.length,
      crossReferenced: links.filter(link => link.status === 'cross-referenced').length,
      candidates: links.filter(link => link.status === 'candidate').length,
      notCheckable: links.filter(link => link.status === 'not-checkable').length,
    },
    compatibility: links,
  };
}

function readJson<T>(path: string): T { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as T; }
function writeCheckpoint(path: string, value: unknown): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value)}\n`, 'utf8'); }
function writeJsonAtomically(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try { processBrotherHtml(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
