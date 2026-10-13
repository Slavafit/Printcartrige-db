const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

const inputFile = process.argv[2];

if (!inputFile || !fs.existsSync(inputFile)) {
  console.error('Использование: node scripts/parse-brother.cjs <файл.html>');
  process.exit(1);
}

const html = fs.readFileSync(inputFile, 'utf8');
const $ = cheerio.load(html);

const canonical =
  $('link[rel="canonical"]').attr('href') ||
  $('meta[property="og:url"]').attr('content');

if (!canonical) {
  throw new Error('Не найден оригинальный URL страницы');
}

const sourceUrl = new URL(canonical);
const parts = sourceUrl.pathname.split('/').filter(Boolean);

if (sourceUrl.hostname !== 'store.brother.es' || parts[0] !== 'supplies') {
  throw new Error('Это не страница расходника Brother');
}

const partNumber = parts.at(-1).toUpperCase();

const type =
  parts[1] === 'laser' && parts[2] === 'toner'
    ? 'toner'
    : parts[1] === 'inkjet' && parts[2] === 'inkcartridgessinglepack'
      ? 'ink'
      : null;

if (!type) {
  throw new Error('Неподдерживаемый тип расходника');
}

const printers = new Map();

$('#related-products .product-list .card-title a[href*="/devices/"]')
  .each((_, element) => {
    const link = $(element);
    const label = link.text().trim();
    const href = link.attr('href');

    if (!href) return;

    const printerUrl = new URL(href, sourceUrl);
    const slug = printerUrl.pathname.split('/').filter(Boolean).at(-1);

    if (
      printerUrl.hostname !== 'store.brother.es' ||
      !printerUrl.pathname.startsWith('/devices/') ||
        !slug
    ) return;

    const modelMatch = label.match(/\b(?:HL|DCP|MFC|FAX)[-\s]?[A-Z0-9]+/i);

    if (!modelMatch) return;

    const rawModel = modelMatch[0].toUpperCase();

    const model = rawModel.replace(
    /^(HL|DCP|MFC|FAX)[-\s]?/,
    '$1-'
    );

    printers.set(model, {
          model,
      url: printerUrl.href
    });
  });

const result = {
  manufacturer: 'Brother',
  supply: {
    partNumber,
    type,
    sourceUrl: sourceUrl.href
  },
  printers: [...printers.values()],
  compatibility: [...printers.values()].map(printer => ({
    printerModel: printer.model,
    supplyPartNumber: partNumber,
    sourceUrl: sourceUrl.href,
    status: 'candidate'
  }))
};

const outputDirectory = path.join('data', 'brother-parsed');
fs.mkdirSync(outputDirectory, { recursive: true });

const outputFile = path.join(
  outputDirectory,
  `${partNumber.toLowerCase()}.json`
);

fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf8');

console.log(`Расходник: ${partNumber} (${type})`);
console.log(`Найдено моделей: ${printers.size}`);
console.log(`Сохранено: ${outputFile}`);