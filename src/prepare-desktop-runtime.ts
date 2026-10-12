import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const target = resolve('desktop-runtime', 'node.exe');
mkdirSync(dirname(target), { recursive: true });
copyFileSync(process.execPath, target);
console.log(`Bundled Node runtime: ${target}`);
