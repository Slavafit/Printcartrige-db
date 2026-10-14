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
    expect(app).toContain('Buscar por modelo, fabricante o referencia de consumible');
    expect(app).toContain('label="botellas de tinta"');
    expect(styles).toContain('.hero{min-height:76px');
    expect(styles).toContain('#root>main{display:flex;min-height:100vh;min-height:100dvh;flex-direction:column}');
    expect(styles).toContain('.workspace{width:100%;margin:0 auto;min-height:0;flex:1 0 auto}');
    expect(styles).toContain('.printer-title strong{color:#0f1f35');
  });

  it('uses catalog manufacturers in a passive footer marquee and limits gradient motion to the divider', () => {
    const app = readFileSync('web/src/App.tsx', 'utf8');
    const effects = readFileSync('web/src/effects.css', 'utf8');
    expect(app).toContain("get<Manufacturer[]>('/api/manufacturers')");
    expect(app).toContain('ManufacturerMarquee');
    expect(effects).toContain('@keyframes header-divider-flow');
    expect(effects).toContain('@keyframes manufacturer-scroll');
    expect(effects).toContain('pointer-events: none');
    expect(effects).toContain('prefers-reduced-motion');
  });
});
