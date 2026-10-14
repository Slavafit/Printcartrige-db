import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trayIconPath } from '../src/tray-icon.js';

describe('Electron tray icon', () => {
  it('uses the packaged ICO from the Electron resources directory', () => {
    expect(trayIconPath(true, 'C:\\Program Files\\PrinterDB\\resources', 'C:\\repo')).toBe(
      join('C:\\Program Files\\PrinterDB\\resources', 'printerdb.ico'),
    );
  });

  it('uses the repository ICO during development and packages the same asset', () => {
    expect(trayIconPath(false, 'C:\\resources', 'C:\\repo')).toBe(
      join('C:\\repo', 'launcher', 'PrinterDB.Launcher', 'printerdb.ico'),
    );
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      build: { extraResources: Array<{ from: string; to: string }> };
    };
    expect(packageJson.build.extraResources).toContainEqual({
      from: 'launcher/PrinterDB.Launcher/printerdb.ico',
      to: 'printerdb.ico',
    });
  });
});
