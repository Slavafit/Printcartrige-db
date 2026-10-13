const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const inputDir = path.resolve(process.argv[2] || 'data/brother-html');
const outputDir = path.resolve('data/brother-parsed');

if (!fs.existsSync(inputDir)) {
  console.error(`Папка не найдена: ${inputDir}`);
  process.exit(1);
}

const files = fs.readdirSync(inputDir)
  .filter(name => /\.html?$/i.test(name));

let success = 0;
let failed = 0;

for (const name of files) {
  const file = path.join(inputDir, name);

  const result = spawnSync(
    process.execPath,
    [path.resolve('scripts/parse-brother.cjs'), file],
    { encoding: 'utf8' }
  );

  if (result.status === 0) {
    success++;
    console.log(`[OK] ${name}`);
  } else {
    failed++;
    console.error(`[ERROR] ${name}: ${result.stderr.trim()}`);
  }
}

const compatibility = [];
const unique = new Set();

for (const name of files) {
  // Итоговые JSON собираем отдельно ниже.
}

if (failed > 0) {
  console.warn(`Ошибок: ${failed}`);
}

console.log(`Обработано: ${success} из ${files.length}`);
console.log(`Результаты: ${outputDir}`);