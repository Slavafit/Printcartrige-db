const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const cheerio = require('cheerio');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CACHE = path.join(DATA, 'brother-printer-html');

fs.mkdirSync(CACHE, { recursive: true });

const data = JSON.parse(
  fs.readFileSync(path.join(DATA, 'brother-compatibility.json'), 'utf8')
    .replace(/^\uFEFF/, '')
);

const TARGET = process.argv[2]?.toUpperCase() || 'DCP-T780DW';

const printer = data.printers.find(p => p.model === TARGET);

if (!printer) {
  console.error('Принтер не найден:', TARGET);
  process.exit(1);
}

(async () => {
  const filename = TARGET.toLowerCase() + '.html';
  const cacheFile = path.join(CACHE, filename);

  let html;

  if (fs.existsSync(cacheFile)) {
    html = fs.readFileSync(cacheFile, 'utf8');
    console.log('[CACHE]', TARGET);
  } else {
    const browser = await chromium.launch({ headless: false });

    try {
      const page = await browser.newPage();

      const response = await page.goto(printer.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      if (response?.status() !== 200) {
        throw new Error(`HTTP ${response?.status()}`);
      }

      html = await page.content();

      fs.writeFileSync(cacheFile, html, 'utf8');

      console.log('[DOWNLOADED]', TARGET);
    } finally {
      await browser.close();
    }
  }

  const $ = cheerio.load(html);
  const supplies = new Map();

  $('#related-products ul.product-list li.item .product-card .card-title a[href*="/supplies/"]')
    .each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;

      const url = new URL(href, printer.url);

      if (url.hostname !== 'store.brother.es') return;

      const match = url.pathname.match(
        /\/supplies\/(?:inkjet\/inkcartridgessinglepack|laser\/toner)\/[^/]+\/([^/]+)\/?$/i
      );

      if (!match) return;

      const partNumber = match[1].toUpperCase();

      supplies.set(partNumber, {
        partNumber,
        supplyUrl: url.href
      });
    });

  const candidates = data.compatibility.filter(
    link => link.printerModel === TARGET
  );

  const results = candidates.map(link => ({
    printerModel: TARGET,
    supplyPartNumber: link.supplyPartNumber,
    reverseMatch: supplies.has(link.supplyPartNumber),
    printerSourceUrl: printer.url,
    supplySourceUrl: link.sourceUrl
  }));

  const output = {
    printer: TARGET,
    checkedAt: new Date().toISOString(),
    suppliesFound: [...supplies.values()],
    results
  };

  const outputFile = path.join(
    DATA,
    `brother-verification-${TARGET.toLowerCase()}.json`
  );

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

  console.log('\n=== REVERSE VERIFICATION ===');
  console.log('Принтер:', TARGET);
  console.log('Расходников на странице:', supplies.size);
  console.log('Кандидатов в базе:', candidates.length);
  console.log('Совпадений:', results.filter(r => r.reverseMatch).length);
  console.log('Без обратного совпадения:', results.filter(r => !r.reverseMatch).length);
  console.log('Результат:', outputFile);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
