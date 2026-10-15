import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { readRecentSearches } from '../web/src/ui-state.js';

const fixtures=JSON.parse(readFileSync('tests/fixtures/recent-searches-synthetic.json','utf8')) as Array<{name:string;value:string|null;expected:string[]}>;
for(const fixture of fixtures) it(`recovers recent searches: ${fixture.name}`,()=>{
  expect(readRecentSearches(fixture.value)).toEqual(fixture.expected);
});
it('keeps at most ten distinct recent searches',()=>{
  expect(readRecentSearches(JSON.stringify(Array.from({length:15},(_,i)=>`Synthetic ${i}`)))).toHaveLength(10);
});
it('gives pagination explicit contrast and accessible previous/next controls',()=>{
  const css=readFileSync('web/src/pagination.css','utf8');
  const app=readFileSync('web/src/App.tsx','utf8');
  expect(css).toContain('color: #18365f');
  expect(css).not.toContain('var(--green)');
  expect(css).toContain('.pagination .page-arrow { color: inherit;');
  expect(app).toContain('aria-label="Página anterior"');
  expect(app).toContain('aria-label="Página siguiente"');
});
it('offers validated database restore and closes the add dialog with Escape',()=>{
  const app=readFileSync('web/src/App.tsx','utf8');
  expect(app).toContain('Restaurar copia');
  expect(app).toContain("fetch('/api/restore'");
  expect(app).toContain("if(event.key==='Escape')close()");
  expect(app).toContain('useCloseOnEscape(close)');
});
it('shows official collectors separately from manual file import',()=>{
  const app=readFileSync('web/src/App.tsx','utf8');
  expect(app).toContain('Fuentes oficiales');
  expect(app).toContain("get<CollectorState[]>('/api/collectors')");
  expect(app).toContain('Recopilar lote');
  expect(app).toContain("item.actionLabel??'Recopilar lote'");
  expect(app).toContain('Carpeta de entrada no encontrada');
  expect(app).toContain('Importar resultado');
  expect(app).toContain('Importar un archivo');
  expect(app).toContain('/stop`');
  expect(app).toContain('collector-progress');
  expect(app).toContain('Esperando el primer punto de control');
});
it('shows database freshness and opens the audit history',()=>{
  const app=readFileSync('web/src/App.tsx','utf8');
  expect(app).toContain('Base modificada:');
  expect(app).toContain('Última verificación oficial:');
  expect(app).toContain("get<AuditReport>('/api/audit')");
  expect(app).toContain('Auditoría de datos');
  expect(app).toContain('Verificadas sin fecha');
});
