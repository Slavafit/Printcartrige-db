import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { importBrotherSitemap } from './brother-sitemap.js';
import { importCompatibilityFile } from './compatibility-importer.js';
import type { CartridgeDatabase } from './database.js';

export type CollectorId = 'brother' | 'kyocera' | 'epson' | 'xerox' | 'hp';
type JobStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'stopped';
interface Definition { id: CollectorId; name: string; description: string; script?: string; args?: string[]; output: string; importType: 'sitemap' | 'compatibility' }
export interface CollectorState extends Definition { status: JobStatus; startedAt?: string; finishedAt?: string; exitCode?: number; log: string; outputExists: boolean }

export const COLLECTOR_DEFINITIONS: readonly Definition[] = [
  { id: 'brother', name: 'Brother España', description: 'Offline import from the committed official sitemap; no website request.', output: 'data/sitemap.xml', importType: 'sitemap' },
  { id: 'kyocera', name: 'Kyocera Europe', description: 'Official sitemap and toner pages; conservative retries and rate limit.', script: 'dist/src/collectors/kyocera.js', args: ['--max-models', '200', '--delay-ms', '500', '--retries', '3'], output: 'data/official/kyocera-eu.json', importType: 'compatibility' },
  { id: 'epson', name: 'Epson Europe', description: 'Respects robots rules and the official access window; uncertain ranges stay in review.', script: 'dist/src/collectors/epson.js', args: ['--max-pages', '20', '--delay-ms', '10000', '--retries', '2'], output: 'data/official/epson/epson-eu.json', importType: 'compatibility' },
  { id: 'xerox', name: 'Xerox España', description: 'Official genuine-supplies pages with exact visible and structured compatibility.', script: 'dist/src/collectors/xerox.js', args: ['--max-pages', '50', '--delay-ms', '10000', '--retries', '2'], output: 'data/official/xerox/xerox.json', importType: 'compatibility' },
  { id: 'hp', name: 'HP España', description: 'Official supply pages; family-level or ambiguous printer matches remain unverified.', script: 'dist/src/collectors/hp.js', args: ['--max-pages', '25', '--delay-ms', '10000', '--retries', '2'], output: 'data/official/hp/hp.json', importType: 'compatibility' },
] as const;

export class CollectorJobs {
  private states = new Map<CollectorId, CollectorState>();
  private child?: ChildProcessWithoutNullStreams;
  private activeId?: CollectorId;

  constructor(private database: CartridgeDatabase) {
    for (const definition of COLLECTOR_DEFINITIONS) this.states.set(definition.id, this.initial(definition));
  }

  list(): CollectorState[] { return COLLECTOR_DEFINITIONS.map(item => ({ ...this.states.get(item.id)!, outputExists: existsSync(resolve(item.output)) })); }

  start(id: string): CollectorState {
    const definition = this.definition(id);
    if (!definition.script) throw new Error('This source is offline-only; use Import');
    if (this.child) throw new Error(`Collector ${this.activeId} is already running`);
    const state: CollectorState = { ...definition, status: 'running', startedAt: new Date().toISOString(), log: '', outputExists: existsSync(resolve(definition.output)) };
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

  stop(): boolean { if (!this.child) return false; return this.child.kill(); }

  private definition(id: string): Definition {
    const result = COLLECTOR_DEFINITIONS.find(item => item.id === id);
    if (!result) throw new Error(`Unknown collector: ${id}`);
    return result;
  }
  private initial(definition: Definition): CollectorState { return { ...definition, status: 'idle', log: '', outputExists: existsSync(resolve(definition.output)) }; }
  private finish(state: CollectorState, code: number): void {
    if (this.activeId !== state.id) return;
    state.status = code === 0 ? 'succeeded' : state.status === 'stopped' ? 'stopped' : 'failed'; state.exitCode = code; state.finishedAt = new Date().toISOString(); state.outputExists = existsSync(resolve(state.output)); this.child = undefined; this.activeId = undefined;
  }
}
