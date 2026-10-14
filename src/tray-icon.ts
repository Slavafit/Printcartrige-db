import { join } from 'node:path';

export function trayIconPath(packaged: boolean, resourcesPath: string, workingDirectory = process.cwd()): string {
  return packaged
    ? join(resourcesPath, 'printerdb.ico')
    : join(workingDirectory, 'launcher', 'PrinterDB.Launcher', 'printerdb.ico');
}
