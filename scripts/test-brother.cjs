const fs = require('node:fs');
const cheerio = require('cheerio');

const html = fs.readFileSync('brother-tn1050.html', 'utf8');
const $ = cheerio.load(html);

const printers = new Map();

$('#related-products .product-list .card-title a[href*="/devices/"]')
  .each((_, element) => {
    const link = $(element);
    const url = link.attr('href');

    if (!url) return;

    const parsedUrl = new URL(url);
    const slug = parsedUrl.pathname.split('/').filter(Boolean).pop();

    if (!slug || slug.endsWith('-bundle')) return;

    const label = link.text().trim();

    const model = label
      .replace(/\s+PACK ALL IN BOX.*$/i, '')
      .trim()
      .toUpperCase();

    // Один URL — одна модель.
    printers.set(parsedUrl.origin + parsedUrl.pathname, {
      model,
      url: parsedUrl.href
    });
  });

  const path = require('node:path');

const sourceUrl = 'https://store.brother.es/supplies/laser/toner/tn/tn1050';

const result = {
  manufacturer: 'Brother',
  supply: {
    partNumber: 'TN1050',
    type: 'toner',
    sourceUrl
  },
  printers: [...printers.values()],
  compatibility: [...printers.values()].map(printer => ({
    printerModel: printer.model,
    supplyPartNumber: 'TN1050',
    sourceUrl,
    status: 'candidate'
  }))
};

const output = path.join('data', 'brother-tn1050-compatibility.json');

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(output, JSON.stringify(result, null, 2), 'utf8');

console.log(`Экспортировано связей: ${result.compatibility.length}`);
console.log(`Файл: ${output}`);

console.log(`Уникальных моделей: ${printers.size}`);
console.table([...printers.values()]);