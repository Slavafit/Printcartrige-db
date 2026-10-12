import { app, Menu, nativeImage, shell, Tray } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

let tray: Tray | undefined;
let server: ChildProcess | undefined;
let address = '';
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (address) void shell.openExternal(address); });

app.whenReady().then(async () => {
  app.setAppUserModelId('com.printerdb.desktop');
  const dataDir = app.getPath('userData');
  const databasePath = join(dataDir, 'printcartridge.sqlite');
  const seedPath = app.isPackaged ? join(process.resourcesPath, 'seed.sqlite') : join(process.cwd(), 'mvp.sqlite');
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(databasePath) && existsSync(seedPath)) copyFileSync(seedPath, databasePath);
  const port = await freePort(4173);
  address = `http://127.0.0.1:${port}`;
  const script = join(app.getAppPath(), 'dist', 'src', 'web-server.js');
  const nodeExecutable = app.isPackaged ? join(process.resourcesPath, 'node.exe') : 'node';
  server = spawn(nodeExecutable, [script], { env: { ...process.env, PORT: String(port), WEB_DB_PATH: databasePath, WEB_STATIC_ROOT: join(app.getAppPath(), 'web-dist'), WEB_BACKUP_ROOT: join(dataDir, 'backups') }, stdio: 'ignore', windowsHide: true });
  server.once('exit', () => { if (!quitting) app.quit(); });
  await waitForServer(address);
  tray = new Tray(trayIcon());
  tray.setToolTip('PrinterDB');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir catalogo', click: () => void shell.openExternal(address) },
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

async function freePort(start: number): Promise<number> { for (let port=start;port<start+20;port+=1) if(await available(port)) return port; throw new Error('Нет свободного локального порта'); }
function available(port:number):Promise<boolean>{return new Promise(resolve=>{const probe=createServer();probe.once('error',()=>resolve(false));probe.listen(port,'127.0.0.1',()=>probe.close(()=>resolve(true)));});}
async function waitForServer(url:string):Promise<void>{for(let attempt=0;attempt<50;attempt+=1){try{const response=await fetch(`${url}/api/stats`);if(response.ok)return;}catch{} await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Локальный сервер не запустился');}
function trayIcon(){const svg='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="7" fill="#111827"/><path d="M8 9h16v8H8zm3 9h10v6H11z" fill="#fff"/><circle cx="22" cy="13" r="1.5" fill="#34d399"/></svg>';return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({width:16,height:16});}
