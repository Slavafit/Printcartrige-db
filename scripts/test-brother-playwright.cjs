const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });

  try {
    const page = await browser.newPage();

    const url =
      'https://store.brother.es/supplies/laser/toner/tn/tn1050';

    console.log('Открываем Brother...');

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log('HTTP:', response?.status());
    console.log('URL:', page.url());

    if (response?.status() !== 200) {
      console.log('Доступ не получен. Проверку прекращаем.');
      return;
    }

    const printers = await page
      .locator('#related-products .product-list .card-title a[href*="/devices/"]')
      .allTextContents();

    console.log('Найдено записей:', printers.length);
    console.log(printers.map(s => s.trim()));

    const fs = require('node:fs');
const path = require('node:path');

const outputDir = path.resolve('data/brother-html');
fs.mkdirSync(outputDir, { recursive: true });

const htmlFile = path.join(outputDir, 'tn1050.html');

fs.writeFileSync(
  htmlFile,
  await page.content(),
  'utf8'
);

console.log('HTML сохранён:', htmlFile);

  } catch (error) {
    console.error('Ошибка:', error.message);
  } finally {
    await browser.close();
  }
})();