const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const cheerio = require('cheerio');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CACHE = path.join(DATA, 'brother-printer-html');
const OUTPUT = path.join(DATA, 'brother-verification.json');

const LIMIT = 10;
const DELAY_MS = 5000;

fs.mkdirSync(CACHE, { recursive: true });

const readJSON = file => JSON.parse(
  fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
);

const source = readJSON(
  path.join(DATA, 'brother-compatibility.json')
);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function extractSupplies(html, printerUrl) {
  const $ = cheerio.load(html);
  const supplies = new Map();

  const selector =
    '#related-products ul.product-list li.item ' +
    '.product-card .card-title a[href*="/supplies/"]';

  $(selector).each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;

    const url = new URL(href, printerUrl);

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

  return {
    sectionFound: $('#related-products').length > 0,
    supplies: [...supplies.values()]
  };
}

function saveReport(report) {
  const tmp = OUTPUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(report, null, 2), 'utf8');
  fs.renameSync(tmp, OUTPUT);
}

(async () => {
  const report = fs.existsSync(OUTPUT)
    ? readJSON(OUTPUT)
    : { manufacturer: 'Brother', printers: {} };

  report.printers ??= {};

  let browser;
  let downloaded = 0;
  let cached = 0;
  let errors = 0;
  let stopped = false;

  try {
    for (const printer of source.printers) {
      const model = printer.model.toUpperCase();
      const cacheFile = path.join(
        CACHE,
        model.toLowerCase() + '.html'
      );

      let html;

      if (fs.existsSync(cacheFile)) {
        html = fs.readFileSync(cacheFile, 'utf8');
        cached++;
      } else {
        if (downloaded >= LIMIT) break;

        browser ??= await chromium.launch({
          headless: false
        });

        const page = await browser.newPage();

        try {
          const response = await page.goto(printer.url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
          });

          const status = response?.status();

          if (status === 403 || status === 429) {
            console.log(`[STOP] ${model}: HTTP ${status}`);
            stopped = true;
            break;
          }

          if (status !== 200) {
            throw new Error(`HTTP ${status}`);
          }

          html = await page.content();

          fs.writeFileSync(cacheFile, html, 'utf8');
          downloaded++;

          console.log(`[DOWNLOADED] ${model}`);
        } catch (error) {
          errors++;
          console.log(`[ERROR] ${model}: ${error.message}`);
          continue;
        } finally {
          await page.close();
          await sleep(DELAY_MS);
        }
      }

      const extracted = extractSupplies(html, printer.url);
      const found = new Set(
        extracted.supplies.map(s => s.partNumber)
      );

      const candidates = source.compatibility.filter(
        link => link.printerModel.toUpperCase() === model
      );

      const results = candidates.map(link => ({
        printerModel: model,
        supplyPartNumber: link.supplyPartNumber,
        status: found.has(link.supplyPartNumber.toUpperCase())
          ? 'cross-referenced'
          : 'candidate',
        reverseMatch: found.has(
          link.supplyPartNumber.toUpperCase()
        ),
        printerSourceUrl: printer.url,
        supplySourceUrl: link.sourceUrl
      }));

      report.printers[model] = {
        printerUrl: printer.url,
        checkedAt: new Date().toISOString(),
        sectionFound: extracted.sectionFound,
        suppliesFound: extracted.supplies,
        results
      };

      saveReport(report);

      const matches = results.filter(r => r.reverseMatch).length;

      console.log(
        `[CHECK] ${model}: ${matches}/${results.length} совпадений`
      );
    }
  } finally {
    if (browser) await browser.close();
  }

  const records = Object.values(report.printers);
  const results = records.flatMap(p => p.results);

  console.log('\n=== BROTHER VERIFICATION ===');
  console.log('Проверено принтеров:', records.length);
  console.log('Новых HTML:', downloaded);
  console.log('Использовано из кэша:', cached);
  console.log('Ошибок:', errors);
  console.log('Остановлено по ограничению доступа:', stopped);
  console.log(
    'Двусторонних совпадений:',
    results.filter(r => r.reverseMatch).length
  );
  console.log(
    'Без обратного совпадения:',
    results.filter(r => !r.reverseMatch).length
  );
  console.log('Результат:', OUTPUT);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
