const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');

function readJSON(name) {
  return JSON.parse(
    fs.readFileSync(path.join(DATA, name), 'utf8')
      .replace(/^\uFEFF/, '')
  );
}

const source = readJSON('brother-compatibility.json');
const verification = readJSON('brother-verification.json');

const links = [];

for (const candidate of source.compatibility) {
  const model = candidate.printerModel.toUpperCase();
  const part = candidate.supplyPartNumber.toUpperCase();

  const printer = verification.printers[model];

  const reverse = printer?.results?.find(
    result =>
      result.supplyPartNumber.toUpperCase() === part
  );

  let status = 'candidate';

  if (reverse?.reverseMatch) {
    status = 'cross-referenced';
  } else if (printer && !printer.sectionFound) {
    status = 'not-checkable';
  }

  links.push({
    printerModel: model,
    supplyPartNumber: part,
    status,
    printerSourceUrl: printer?.printerUrl ?? null,
    supplySourceUrl: candidate.sourceUrl
  });
}

const summary = {
  printersTotal: source.printers.length,
  printersChecked: Object.keys(verification.printers)
    .filter(model =>
      source.printers.some(p => p.model === model)
    ).length,
  suppliesTotal: source.supplies.length,
  linksTotal: links.length,
  crossReferenced: links.filter(
    x => x.status === 'cross-referenced'
  ).length,
  candidates: links.filter(
    x => x.status === 'candidate'
  ).length,
  notCheckable: links.filter(
    x => x.status === 'not-checkable'
  ).length
};

const output = {
  manufacturer: 'Brother',
  generatedAt: new Date().toISOString(),
  summary,
  compatibility: links
};

const destination = path.join(DATA, 'brother-audit.json');
fs.writeFileSync(
  destination,
  JSON.stringify(output, null, 2),
  'utf8'
);

console.log('\n=== BROTHER AUDIT ===');
console.table(summary);

const unresolved = links.filter(
  x => x.status !== 'cross-referenced'
);

console.log('\nСвязи без обратного подтверждения:');
console.table(unresolved);
