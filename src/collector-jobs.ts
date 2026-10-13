import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { importBrotherSitemap } from './brother-sitemap.js';
import { importCompatibilityFile } from './compatibility-importer.js';
import type { CartridgeDatabase } from './database.js';

export type CollectorId = 'brother' | 'kyocera' | 'epson' | 'xerox' | 'hp' | 'lexmark';
type JobStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'stopped';
interface Definition { id: CollectorId; name: string; description: string; script?: string; args?: string[]; output: string; stateFile?: string; batchSize?: number; importType: 'sitemap' | 'compatibility' }
export interface CollectorProgress { processed: number; total: number; percent: number; completed: number; pending?: number; printers: number; cartridges: number; relationships: number; errors: number; etaSeconds?: number }
export interface CollectorState extends Definition { status: JobStatus; startedAt?: string; finishedAt?: string; exitCode?: number; log: string; outputExists: boolean; progress?: CollectorProgress }

export const COLLECTOR_DEFINITIONS: readonly Definition[] = [
  { id: 'brother', name: 'Brother España', description: 'Offline import from the committed official sitemap; no website request.', output: 'data/sitemap.xml', importType: 'sitemap' },
  { id: 'kyocera', name: 'Kyocera Europe', description: 'Official sitemap and toner pages; conservative retries and rate limit.', script: 'dist/src/collectors/kyocera.js', args: ['--max-models', '200', '--delay-ms', '500', '--retries', '3'], output: 'data/official/kyocera-eu.json', stateFile: '.collector-state/kyocera-eu.json', batchSize: 200, importType: 'compatibility' },
  { id: 'epson', name: 'Epson Europe', description: 'Respects robots rules and the official access window; uncertain ranges stay in review.', script: 'dist/src/collectors/epson.js', args: ['--max-pages', '20', '--delay-ms', '10000', '--retries', '2'], output: 'data/official/epson/epson-eu.json', stateFile: '.collector-state/epson-eu.json', batchSize: 20, importType: 'compatibility' },
  { id: 'xerox', name: 'Xerox España', description: 'Official genuine-supplies pages with exact visible and structured compatibility.', script: 'dist/src/collectors/xerox.js', args: ['--max-pages', '50', '--delay-ms', '10000', '--retries', '2'], output: 'data/official/xerox/xerox.json', stateFile: '.collector-state/xerox.json', batchSize: 50, importType: 'compatibility' },
  { id: 'hp', name: 'HP España', description: 'Official supply pages; family-level or ambiguous printer matches remain unverified.', script: 'dist/src/collectors/hp.js', args: ['--max-pages', '25', '--delay-ms', '10000', '--retries', '2'], output: 'data/official/hp/hp.json', stateFile: '.collector-state/hp.json', batchSize: 25, importType: 'compatibility' },
  { id: 'lexmark', name: 'Lexmark España', description: 'Official printer pages with explicit cartridge part numbers, colour and yield; resumable batches.', script: 'dist/src/collectors/lexmark.js', args: ['--max-pages', '50', '--delay-ms', '10000', '--retries', '2'], output: 'data/official/lexmark/lexmark.json', stateFile: '.collector-state/lexmark.json', batchSize: 50, importType: 'compatibility' },
] as const;

export class CollectorJobs {
  private states = new Map<CollectorId, CollectorState>();
  private child?: ChildProcessWithoutNullStreams;
  private activeId?: CollectorId;
  private baselineCompleted = 0;

  constructor(private database: CartridgeDatabase) {
    for (const definition of COLLECTOR_DEFINITIONS) this.states.set(definition.id, this.initial(definition));
  }

  list(): CollectorState[] { if (this.activeId) this.refreshProgress(this.states.get(this.activeId)!); return COLLECTOR_DEFINITIONS.map(item => ({ ...this.states.get(item.id)!, outputExists: existsSync(resolve(item.output)) })); }

  start(id: string): CollectorState {
    const definition = this.definition(id);
    if (!definition.script) throw new Error('This source is offline-only; use Import');
    if (this.child) throw new Error(`Collector ${this.activeId} is already running`);
    const state: CollectorState = { ...definition, status: 'running', startedAt: new Date().toISOString(), log: '', outputExists: existsSync(resolve(definition.output)) };
    this.baselineCompleted = checkpointCompleted(this.readCheckpoint(definition));
    this.refreshProgress(state);
    this.states.set(definition.id, state); this.activeId = definition.id;
    const child = spawn(process.execPath, [resolve(definition.script), ...(definition.args ?? [])], { cwd: process.cwd(), env: process.env });
    this.child = child;
    const append = (chunk: Buffer) => { state.log = `${state.log}${chunk.toString('utf8')}`.slice(-30_000); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.on('error', error => { append(Buffer.from(error.message)); this.finish(state, 1); });
    child.on('close', code => this.finish(state, code ?? 1));
    return { ...state };
  }

  async import(id: string): Promise<unknown> {
    const definition = this.definition(id);
    if (this.child) throw new Error('Wait for the running collector to finish before importing');
    if (!existsSync(resolve(definition.output))) throw new Error(`Output file not found: ${definition.output}`);
    if (definition.importType === 'sitemap') {
      const result = await importBrotherSitemap(this.database, definition.output, false);
      return { insertedModels: result.insertedModels, existingModels: result.existingModels, rejectedUrls: result.rejectedUrls.length, errors: result.errors, totalModels: result.totalBrotherModelsAfterImport };
    }
    const result = await importCompatibilityFile(this.database, definition.output, false);
    return { acceptedRecords: result.acceptedRecords, insertedRelationships: result.insertedRelationships, existingRelationships: result.existingRelationships, rejectedRecords: result.rejectedRecords, manualReview: result.recordsRequiringManualReview, errors: result.errors };
  }

  stop(id: string): boolean {
    if (!this.child || this.activeId !== id) return false;
    const state = this.states.get(this.activeId)!; state.status = 'stopped'; state.log = `${state.log}\nDetención solicitada por el usuario.\n`.slice(-30_000);
    const stopped = this.child.kill(); if (!stopped) state.status = 'running'; return stopped;
  }

  private definition(id: string): Definition {
    const result = COLLECTOR_DEFINITIONS.find(item => item.id === id);
    if (!result) throw new Error(`Unknown collector: ${id}`);
    return result;
  }
  private initial(definition: Definition): CollectorState { return { ...definition, status: 'idle', log: '', outputExists: existsSync(resolve(definition.output)) }; }
  private readCheckpoint(definition: Definition): unknown {
    if (!definition.stateFile || !existsSync(resolve(definition.stateFile))) return undefined;
    try { return JSON.parse(readFileSync(resolve(definition.stateFile), 'utf8')); } catch { return undefined; }
  }
  private refreshProgress(state: CollectorState): void {
    if (!state.stateFile || !state.batchSize || !state.startedAt) return;
    const next = collectorProgressFromCheckpoint(this.readCheckpoint(state), this.baselineCompleted, state.batchSize, state.startedAt);
    if (!next) return;
    if (state.status === 'running' && next.processed !== state.progress?.processed) {
      state.log = `${state.log}[progreso] ${next.processed}/${next.total} páginas · ${next.printers} impresoras · ${next.cartridges} cartuchos · ${next.relationships} relaciones\n`.slice(-30_000);
    }
    state.progress = next;
  }
  private finish(state: CollectorState, code: number): void {
    if (this.activeId !== state.id) return;
    this.refreshProgress(state); state.status = state.status === 'stopped' ? 'stopped' : code === 0 ? 'succeeded' : 'failed';
    if (state.progress && state.status === 'succeeded') state.progress = { ...state.progress, total: state.progress.processed, percent: 100, etaSeconds: 0 };
    state.exitCode = code; state.finishedAt = new Date().toISOString(); state.outputExists = existsSync(resolve(state.output)); this.child = undefined; this.activeId = undefined;
  }
}

function checkpointCompleted(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const checkpoint = value as Record<string, unknown>;
  for (const key of ['pages', 'completed', 'completedUrls']) if (Array.isArray(checkpoint[key])) return checkpoint[key].length;
  return 0;
}

export function collectorProgressFromCheckpoint(value: unknown, baselineCompleted: number, batchSize: number, startedAt: string, now = Date.now()): CollectorProgress | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const checkpoint = value as Record<string, unknown>, records = Array.isArray(checkpoint.records) ? checkpoint.records as Array<Record<string, unknown>> : [];
  const completed = checkpointCompleted(checkpoint), processed = Math.max(0, completed - baselineCompleted), total = Math.max(1, batchSize);
  const elapsedSeconds = Math.max(0, (now - new Date(startedAt).getTime()) / 1000);
  const etaSeconds = processed > 0 && processed < total ? Math.round(elapsedSeconds / processed * (total - processed)) : undefined;
  return { processed, total, percent: Math.min(100, Math.round(processed / total * 100)), completed,
    ...(Array.isArray(checkpoint.pending) ? { pending: checkpoint.pending.length } : {}),
    printers: new Set(records.map(item => item.printerModel).filter(Boolean)).size,
    cartridges: new Set(records.map(item => item.cartridgePartNumber).filter(Boolean)).size,
    relationships: records.length, errors: Array.isArray(checkpoint.failures) ? checkpoint.failures.length : 0, ...(etaSeconds === undefined ? {} : { etaSeconds }) };
}
