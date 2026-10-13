const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'data', 'brother-compatibility.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

const errors = [];
const warnings = [];

const supplies = new Set();
const printers = new Set();
const links = new Set();

for (const supply of data.supplies ?? []) {
  const part = supply.partNumber?.trim().toUpperCase();

  if (!part) {
    errors.push('Расходник без артикула');
    continue;
  }

  if (supplies.has(part)) {
    errors.push(`Дубликат расходника: ${part}`);
  }

  supplies.add(part);

  if (!['ink', 'toner'].includes(supply.type)) {
    warnings.push(`Неизвестный тип расходника: ${part}`);
  }

  if (!supply.sourceUrl?.startsWith('https://store.brother.es/')) {
    warnings.push(`Нет корректного URL расходника: ${part}`);
  }
}

for (const printer of data.printers ?? []) {
  const model = printer.model?.trim().toUpperCase();

  if (!model) {
    errors.push('Принтер без модели');
    continue;
  }

  if (printers.has(model)) {
    errors.push(`Дубликат принтера: ${model}`);
  }

  printers.add(model);

  if (!printer.url?.startsWith('https://store.brother.es/devices/')) {
    warnings.push(`Неожиданный URL принтера: ${model}`);
  }
}

for (const link of data.compatibility ?? []) {
  const model = link.printerModel?.trim().toUpperCase();
  const part = link.supplyPartNumber?.trim().toUpperCase();

  if (!printers.has(model)) {
    errors.push(`Неизвестный принтер в связи: ${model}`);
  }

  if (!supplies.has(part)) {
    errors.push(`Неизвестный расходник в связи: ${part}`);
  }

  const key = `${model}|${part}`;

  if (links.has(key)) {
    errors.push(`Дубликат связи: ${key}`);
  }

  links.add(key);

  if (link.status !== 'candidate') {
    warnings.push(`Неожиданный статус: ${key} = ${link.status}`);
  }

  if (!link.sourceUrl?.startsWith('https://store.brother.es/')) {
    errors.push(`Нет корректного источника связи: ${key}`);
  }
}

console.log('\n=== BROTHER DATA VALIDATION ===');
console.log('Расходников:', supplies.size);
console.log('Принтеров:', printers.size);
console.log('Уникальных связей:', links.size);

console.log('\nОшибок:', errors.length);
errors.forEach(e => console.log('[ERROR]', e));

console.log('\nПредупреждений:', warnings.length);
warnings.forEach(w => console.log('[WARN]', w));

if (errors.length) {
  process.exitCode = 1;
} else {
  console.log('\nСтруктурная проверка пройдена.');
}
