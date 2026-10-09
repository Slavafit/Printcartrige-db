#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { CartridgeDatabase } from './database.js';
import { printerDetails, searchPrinterPage, webManufacturers, webStats } from './web-data.js';

const databasePath = process.env.WEB_DB_PATH || 'mvp.sqlite';
const port = Number(process.env.PORT || 4173);
const database = new CartridgeDatabase(databasePath);
database.initialize();
const staticRoot = resolve('web-dist');
let reusedExistingServer = false;
let reuseHeartbeat: NodeJS.Timeout | undefined;
const server = createServer((request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname === '/api/stats') return json(response, 200, webStats(database));
    if (url.pathname === '/api/manufacturers') return json(response, 200, webManufacturers(database));
    if (url.pathname === '/api/printers') {
      const page = Math.max(Number(url.searchParams.get('page') || 1), 1);
      const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') || 10), 1), 100);
      return json(response, 200, searchPrinterPage(database, { query: url.searchParams.get('q') ?? undefined, manufacturer: url.searchParams.get('manufacturer') ?? undefined, limit: pageSize, offset: (page - 1) * pageSize }));
    }
    const detail = url.pathname.match(/^\/api\/printers\/(\d+)$/);
    if (detail) { const result = printerDetails(database, Number(detail[1])); return json(response, result ? 200 : 404, result ?? { error: 'Printer not found' }); }
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
    if (typeof stats.totalPrinters !== 'number') throw new Error('not our API');
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
function serveStatic(response: ServerResponse, directory: string, pathname: string): void {
  const candidate = normalize(join(directory, pathname === '/' ? 'index.html' : pathname));
  const safePath = candidate.startsWith(directory) && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(directory, 'index.html');
  if (!existsSync(safePath)) return json(response, 503, { error: 'Web client is not built. Run pnpm build or pnpm dev.' });
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
  response.writeHead(200, { 'content-type': `${types[extname(safePath)] ?? 'application/octet-stream'}; charset=utf-8` }); createReadStream(safePath).pipe(response);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (reusedExistingServer) { if (reuseHeartbeat) clearInterval(reuseHeartbeat); database.close(); process.exit(0); }
  server.close(() => { database.close(); process.exit(0); });
});
