const { chromium } = require('playwright');
const cheerio = require('cheerio');

const printerUrl =
  'https://store.brother.es/devices/inkjet/dcpj/dcpt780dw';

(async () => {
  const browser = await chromium.launch({ headless: false });

  try {
    const page = await browser.newPage();

    const response = await page.goto(printerUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log('HTTP:', response?.status());

    if (response?.status() !== 200) {
      throw new Error('Страница принтера недоступна');
    }

    const html = await page.content();
    const $ = cheerio.load(html);
    const supplies = new Map();

    $('a[href*="/supplies/"]').each((_, element) => {
      const href = $(element).attr('href');
      const label = $(element).text().replace(/\s+/g, ' ').trim();

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
        label,
        sourceUrl: printerUrl,
        supplyUrl: url.href
      });
    });

    console.log('\nРасходники на странице принтера:');
    console.table([...supplies.values()]);

    console.log(
      '\nBTD180BK найден:',
      supplies.has('BTD180BK')
    );
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
