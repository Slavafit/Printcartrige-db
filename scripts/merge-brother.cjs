const fs = require('node:fs');
const path = require('node:path');

const inputDir = path.resolve('data/brother-parsed');
const outputFile = path.resolve('data/brother-compatibility.json');

const supplies = new Map();
const printers = new Map();
const compatibility = new Map();

const files = fs.readdirSync(inputDir)
  .filter(name => name.endsWith('.json'));

for (const name of files) {
  const file = path.join(inputDir, name);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  const partNumber = data.supply.partNumber.toUpperCase();

  supplies.set(partNumber, data.supply);

  for (const printer of data.printers) {
    const model = printer.model.toUpperCase();

    printers.set(model, printer);

    const key = `${model}|${partNumber}`;

    compatibility.set(key, {
      printerModel: model,
      supplyPartNumber: partNumber,
      sourceUrl: data.supply.sourceUrl,
      status: 'candidate'
    });
  }
}

const result = {
  manufacturer: 'Brother',
  supplies: [...supplies.values()],
  printers: [...printers.values()],
  compatibility: [...compatibility.values()]
};

fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf8');

console.log(`Расходников: ${result.supplies.length}`);
console.log(`Принтеров: ${result.printers.length}`);
console.log(`Связей: ${result.compatibility.length}`);
console.log(`Файл: ${outputFile}`);