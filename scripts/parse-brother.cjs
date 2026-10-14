const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const { resolveBrotherModel } = require('./brother-model.cjs');

function parseBrotherHtml(html) {
  const $ = cheerio.load(html);
  const canonical = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content');
  if (!canonical) throw new Error('Не найден оригинальный URL страницы');

  const sourceUrl = new URL(canonical);
  const parts = sourceUrl.pathname.split('/').filter(Boolean);
  if (sourceUrl.hostname !== 'store.brother.es' || parts[0] !== 'supplies') throw new Error('Это не страница расходника Brother');

  const partNumber = parts.at(-1).toUpperCase();
  const type = parts[1] === 'laser' && parts[2] === 'toner'
    ? 'toner'
    : parts[1] === 'inkjet' && parts[2] === 'inkcartridgessinglepack'
      ? 'ink'
      : null;
  if (!type) throw new Error('Неподдерживаемый тип расходника');

  const printers = new Map();
  $('#related-products .product-list .card-title a[href*="/devices/"]').each((_, element) => {
    const link = $(element);
    const href = link.attr('href');
    if (!href) return;
    const printerUrl = new URL(href, sourceUrl);
    if (printerUrl.hostname !== 'store.brother.es' || !printerUrl.pathname.startsWith('/devices/')) return;
    const { model } = resolveBrotherModel(link.text().trim(), printerUrl.href);
    printers.set(model, { model, url: printerUrl.href });
  });

  return {
    manufacturer: 'Brother',
    supply: { partNumber, type, sourceUrl: sourceUrl.href },
    printers: [...printers.values()],
    compatibility: [...printers.values()].map(printer => ({
      printerModel: printer.model,
      supplyPartNumber: partNumber,
      sourceUrl: sourceUrl.href,
      status: 'candidate',
    })),
  };
}

function main(inputFile) {
  if (!inputFile || !fs.existsSync(inputFile)) throw new Error('Использование: node scripts/parse-brother.cjs <файл.html>');
  const result = parseBrotherHtml(fs.readFileSync(inputFile, 'utf8'));
  const outputDirectory = path.join('data', 'brother-parsed');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputFile = path.join(outputDirectory, `${result.supply.partNumber.toLowerCase()}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf8');
  console.log(`Расходник: ${result.supply.partNumber} (${result.supply.type})`);
  console.log(`Найдено моделей: ${result.printers.length}`);
  console.log(`Сохранено: ${outputFile}`);
}

if (require.main === module) {
  try { main(process.argv[2]); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { main, parseBrotherHtml };
