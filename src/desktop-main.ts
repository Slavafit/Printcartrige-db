import { app, Menu, nativeImage, shell, Tray } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { trayIconPath } from './tray-icon.js';
import { prepareCollectorWorkspace, prepareWebClient } from './collector-runtime.js';

let tray: Tray | undefined;
let server: ChildProcess | undefined;
let address = '';
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (address) void shell.openExternal(address); });

app.whenReady().then(async () => {
  app.setAppUserModelId('com.printerdb.desktop');
  const dataDir = app.getPath('userData');
  const appRoot = app.getAppPath();
  const collectorWorkspace = app.isPackaged ? join(dataDir, 'collector-workspace') : process.cwd();
  const webRoot = app.isPackaged ? join(dataDir, 'runtime', 'web-dist') : join(appRoot, 'web-dist');
  const databasePath = join(dataDir, 'printcartridge.sqlite');
  const seedPath = app.isPackaged ? join(process.resourcesPath, 'seed.sqlite') : join(process.cwd(), 'mvp.sqlite');
  mkdirSync(dataDir, { recursive: true });
  if (app.isPackaged) {
    prepareCollectorWorkspace(join(process.resourcesPath, 'collector-runtime'), collectorWorkspace);
    prepareWebClient(join(appRoot, 'web-dist'), webRoot);
  }
  if (!existsSync(databasePath) && existsSync(seedPath)) copyFileSync(seedPath, databasePath);
  const port = await freePort(4173);
  address = `http://127.0.0.1:${port}`;
  const script = join(appRoot, 'dist', 'src', 'web-server.js');
  const nodeExecutable = app.isPackaged ? join(process.resourcesPath, 'node.exe') : 'node';
  server = spawn(nodeExecutable, [script], { env: { ...process.env, PORT: String(port), WEB_DB_PATH: databasePath, WEB_STATIC_ROOT: webRoot, WEB_BACKUP_ROOT: join(dataDir, 'backups'), WEB_APP_ROOT: appRoot, WEB_COLLECTOR_WORKSPACE: collectorWorkspace }, stdio: 'ignore', windowsHide: true });
  server.once('exit', () => { if (!quitting) app.quit(); });
  await waitForServer(address);
  tray = new Tray(trayIcon());
  tray.setToolTip('PrinterDB');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir catálogo', click: () => void shell.openExternal(address) },
    { type: 'separator' },
    { label: 'Salir', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => void shell.openExternal(address));
  void shell.openExternal(address);
});

app.on('before-quit', event => {
  if (server && !server.killed) {
    event.preventDefault(); quitting = true; const child = server; server = undefined;
    child.once('exit', () => app.quit()); child.kill('SIGTERM');
    setTimeout(() => { if (!child.killed) child.kill(); app.quit(); }, 3000).unref();
  }
});
app.on('window-all-closed', () => undefined);

async function freePort(start: number): Promise<number> { for (let port=start;port<start+20;port+=1) if(await available(port)) return port; throw new Error('No hay ningún puerto local disponible'); }
function available(port:number):Promise<boolean>{return new Promise(resolve=>{const probe=createServer();probe.once('error',()=>resolve(false));probe.listen(port,'127.0.0.1',()=>probe.close(()=>resolve(true)));});}
async function waitForServer(url:string):Promise<void>{for(let attempt=0;attempt<50;attempt+=1){try{const response=await fetch(`${url}/api/stats`);if(response.ok)return;}catch{} await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('El servidor local no pudo iniciarse');}
function trayIcon(){
  const icon = nativeImage.createFromPath(trayIconPath(app.isPackaged, process.resourcesPath));
  if (!icon.isEmpty()) return icon.resize({ width: 16, height: 16 });
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#173f2e"/><path d="M19 8h26v15H19z" fill="#fbfcf7"/><path d="M15 21h34a7 7 0 0 1 7 7v17H45v11H19V45H8V28a7 7 0 0 1 7-7Z" fill="#dff065"/><path d="M16 28h32v17h-3v-7H19v7h-3z" fill="#fbfcf7"/><path d="M23 42h18v10H23z" fill="#173f2e"/><circle cx="47" cy="30" r="3" fill="#173f2e"/></svg>';
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({width:16,height:16});
}
