#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { CartridgeDatabase } from './database.js';
import { CollectorJobs } from './collector-jobs.js';
import { printerDetails, searchPrinterPage, webManufacturers, webStats } from './web-data.js';
import { backupDatabase, createCartridge, createCompatibility, createPrinter, exportWorkbook, restoreDatabase, updateCartridge, updatePrinter } from './desktop-data.js';
import { importMultiSource, parseMultiSourceBytes, type MultiSourceOptions, type ParsedMultiSource } from './multi-source-import.js';

const databasePath = process.env.WEB_DB_PATH || 'mvp.sqlite';
const port = Number(process.env.PORT || 4173);
let database = new CartridgeDatabase(databasePath);
database.initialize();
let collectorJobs = new CollectorJobs(database);
const staticRoot = process.env.WEB_STATIC_ROOT || resolve('web-dist');
const backupRoot = process.env.WEB_BACKUP_ROOT || resolve('backups');
const previews = new Map<string, { parsed: ParsedMultiSource; options: MultiSourceOptions }>();
let reusedExistingServer = false;
let reuseHeartbeat: NodeJS.Timeout | undefined;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname === '/api/stats') return json(response, 200, webStats(database));
    if (url.pathname === '/api/launcher/shutdown' && request.method === 'POST' && process.env.LAUNCHER_SHUTDOWN_TOKEN) {
      if (request.headers['x-printerdb-token'] !== process.env.LAUNCHER_SHUTDOWN_TOKEN) return json(response, 403, { error: 'Forbidden' });
      json(response, 200, { ok: true }); setImmediate(shutdown); return;
    }
    if (url.pathname === '/api/manufacturers') return json(response, 200, webManufacturers(database));
    if (url.pathname === '/api/printers' && request.method === 'POST') return json(response, 201, { id: createPrinter(database, await body(request)) });
    if (url.pathname === '/api/cartridges' && request.method === 'POST') return json(response, 201, { id: createCartridge(database, await body(request)) });
    if (url.pathname === '/api/cartridges' && request.method === 'GET') return json(response, 200, database.db.prepare(`SELECT c.id,m.name manufacturer,c.part_number,c.kind FROM cartridges c JOIN manufacturers m ON m.id=c.manufacturer_id WHERE lower(m.name||' '||c.part_number) LIKE '%'||lower(?)||'%' ORDER BY c.normalized_part_number LIMIT 50`).all(url.searchParams.get('q') || ''));
    if (url.pathname === '/api/compatibility' && request.method === 'POST') return json(response, 201, { id: createCompatibility(database, await body(request)) });
    if (url.pathname === '/api/import/preview' && request.method === 'POST') {
      const input = await body(request) as { fileName?: string; data?: string; sourceName?: string; sourceCategory?: MultiSourceOptions['sourceCategory']; sourceReference?: string; region?: string };
      if (!input.data) return json(response, 400, { error: 'No se ha proporcionado ningún archivo' });
      const parsed = parseMultiSourceBytes(input.fileName || 'import.xlsx', Buffer.from(input.data, 'base64'), database);
      const options: MultiSourceOptions = { sourceName: input.sourceName || 'Importación local', sourceCategory: input.sourceCategory || 'unknown', sourceReference: input.sourceReference || `unknown://import/${input.fileName || 'file'}`, region: input.region || 'unknown' };
      const report = importMultiSource(database, parsed, options, true);
      const id = crypto.randomUUID(); previews.set(id, { parsed, options }); return json(response, 200, { id, ...report, rows: parsed.rows.slice(0, 50), mapping: parsed.mapping });
    }
    if (url.pathname === '/api/import/commit' && request.method === 'POST') {
      const input = await body(request) as { id?: string }; const preview = input.id ? previews.get(input.id) : undefined;
      if (!preview) return json(response, 404, { error: 'La vista previa ha caducado' });
      const result = importMultiSource(database, preview.parsed, preview.options, false); previews.delete(input.id!); return json(response, 200, result);
    }
    if (url.pathname === '/api/export.xlsx' && request.method === 'GET') { const bytes=exportWorkbook(database); response.writeHead(200, {'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':'attachment; filename="printerdb-export.xlsx"'}); return response.end(bytes); }
    if (url.pathname === '/api/backup' && request.method === 'POST') { const name=`printerdb-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`; const target=join(backupRoot,name); await backupDatabase(database,target); return json(response,200,{file:name,path:target}); }
    if (url.pathname === '/api/restore' && request.method === 'POST') {
      if (collectorJobs.list().some(job => job.status === 'running')) return json(response, 409, { error: 'Espera a que termine el colector antes de restaurar una copia' });
      try {
        const result = await restoreDatabase(database, await binaryBody(request), backupRoot);
        database = result.database; collectorJobs = new CollectorJobs(database); previews.clear();
        if (!result.restored) return json(response, 500, { error: `No se pudo restaurar la copia. Se recuperó la base anterior: ${result.error}`, safetyBackupPath: result.safetyBackupPath });
        return json(response, 200, { ok: true, safetyBackupPath: result.safetyBackupPath });
      } catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : 'No se pudo validar la copia' }); }
    }
    if (url.pathname === '/api/collectors' && request.method === 'GET') return json(response, 200, collectorJobs.list());
    const collectorAction = url.pathname.match(/^\/api\/collectors\/([a-z]+)\/(run|import)$/);
    if (collectorAction && request.method === 'POST') {
      const result = collectorAction[2] === 'run' ? collectorJobs.start(collectorAction[1]) : await collectorJobs.import(collectorAction[1]);
      return json(response, 200, result);
    }
    if (url.pathname === '/api/printers' && request.method === 'GET') {
      const page = Math.max(Number(url.searchParams.get('page') || 1), 1);
      const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') || 10), 1), 100);
      return json(response, 200, searchPrinterPage(database, { query: url.searchParams.get('q') ?? undefined, manufacturer: url.searchParams.get('manufacturer') ?? undefined, limit: pageSize, offset: (page - 1) * pageSize }));
    }
    const detail = url.pathname.match(/^\/api\/printers\/(\d+)$/);
    if (detail && request.method === 'GET') { const result = printerDetails(database, Number(detail[1])); return json(response, result ? 200 : 404, result ?? { error: 'Printer not found' }); }
    if (detail && request.method === 'PUT') return json(response, updatePrinter(database, Number(detail[1]), await body(request)) ? 200 : 404, { ok: true });
    if (detail && request.method === 'DELETE') return json(response, database.delete('printers', Number(detail[1])) ? 200 : 404, { ok: true });
    const cartridge = url.pathname.match(/^\/api\/cartridges\/(\d+)$/);
    if (cartridge && request.method === 'PUT') return json(response, updateCartridge(database, Number(cartridge[1]), await body(request)) ? 200 : 404, { ok: true });
    if (cartridge && request.method === 'DELETE') return json(response, database.delete('cartridges', Number(cartridge[1])) ? 200 : 404, { ok: true });
    const compatibility = url.pathname.match(/^\/api\/compatibility\/(\d+)$/);
    if (compatibility && request.method === 'DELETE') return json(response, database.delete('compatibility', Number(compatibility[1])) ? 200 : 404, { ok: true });
    if (url.pathname.startsWith('/api/')) return json(response, 404, { error: 'Not found' });
    return serveStatic(response, staticRoot, url.pathname);
  } catch (error) { return json(response, 500, { error: error instanceof Error ? error.message : 'Unexpected error' }); }
});
server.on('error', async (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EADDRINUSE') throw error;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/stats`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('not our API');
    const stats = await response.json() as Record<string, unknown>;
    if (stats.apiVersion !== 2 || typeof stats.totalPrinters !== 'number') throw new Error('incompatible API');
    reusedExistingServer = true;
    reuseHeartbeat = setInterval(() => undefined, 60_000);
    console.log(`Printcartridge API already running at http://127.0.0.1:${port}; reusing it.`);
  } catch {
    console.error(`Port ${port} is occupied by another application. Stop it or set $env:PORT before pnpm.cmd dev.`);
    database.close();
    process.exit(1);
  }
});
server.listen(port, '127.0.0.1', () => { console.log(`Printcartridge web MVP: http://127.0.0.1:${port}`); console.log(`Database: ${resolve(databasePath)}`); });

function json(response: ServerResponse, status: number, body: unknown): void { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); }
async function body(request: import('node:http').IncomingMessage): Promise<Record<string, unknown>> { const chunks:Buffer[]=[]; let size=0; for await(const chunk of request){const value=Buffer.from(chunk);size+=value.length;if(size>25_000_000)throw new Error('La solicitud es demasiado grande');chunks.push(value);} return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}') as Record<string,unknown>; }
async function binaryBody(request: import('node:http').IncomingMessage): Promise<Buffer> { const chunks:Buffer[]=[]; let size=0; for await(const chunk of request){const value=Buffer.from(chunk);size+=value.length;if(size>256*1024*1024)throw new Error('La copia supera el límite de 256 MB');chunks.push(value);} if(!size)throw new Error('No se ha proporcionado ninguna copia');return Buffer.concat(chunks); }
function serveStatic(response: ServerResponse, directory: string, pathname: string): void {
  const candidate = normalize(join(directory, pathname === '/' ? 'index.html' : pathname));
  const safePath = candidate.startsWith(directory) && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(directory, 'index.html');
  if (!existsSync(safePath)) return json(response, 503, { error: 'Web client is not built. Run pnpm build or pnpm dev.' });
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
  response.writeHead(200, { 'content-type': `${types[extname(safePath)] ?? 'application/octet-stream'}; charset=utf-8` }); createReadStream(safePath).pipe(response);
}
function shutdown(): void {
  if (reusedExistingServer) { if (reuseHeartbeat) clearInterval(reuseHeartbeat); database.close(); process.exit(0); }
  server.close(() => { database.close(); process.exit(0); });
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, shutdown);
