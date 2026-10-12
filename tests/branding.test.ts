import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('desktop and browser branding', () => {
  it('ships a Windows icon and browser favicon', () => {
    const icon = readFileSync('launcher/PrinterDB.Launcher/printerdb.ico');
    expect([...icon.subarray(0, 6)]).toEqual([0, 0, 1, 0, 1, 0]);
    expect(readFileSync('web/index.html', 'utf8')).toContain('href="/favicon.svg"');
    expect(readFileSync('web/public/favicon.svg', 'utf8')).toContain('viewBox="0 0 64 64"');
  });

  it('keeps tray-facing launcher text in Spanish', () => {
    const launcher = readFileSync('launcher/PrinterDB.Launcher/Program.cs', 'utf8');
    expect(launcher).toContain('Abrir catálogo');
    expect(launcher).toContain('Salir');
    expect(launcher).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('keeps the catalog header compact and provides Spanish in-app help', () => {
    const app = readFileSync('web/src/App.tsx', 'utf8');
    const styles = readFileSync('web/src/styles.css', 'utf8');
    expect(app).toContain('Cómo utilizar PrinterDB');
    expect(app).toContain('aria-label="Abrir ayuda"');
    expect(app).toContain('Buscar por modelo, fabricante o referencia de cartucho');
    expect(styles).toContain('.hero{min-height:76px');
    expect(styles).toContain('.printer-title strong{color:#0f1f35');
  });
});
