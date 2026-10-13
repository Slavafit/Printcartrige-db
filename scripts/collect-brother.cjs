
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = process.cwd();
const INPUT = path.join(ROOT, 'data', 'brother-candidates.json');
const OUTPUT = path.join(ROOT, 'data', 'brother-html');
const REVIEW = path.join(ROOT, 'data', 'brother-review');
const REPORT = path.join(ROOT, 'data', 'brother-collection-report.json');
const HISTORY = path.join(ROOT, 'data', 'brother-collection-history.json');

function loadHistory() {
  if (!fs.existsSync(HISTORY)) {
    return { downloaded: {}, failed: {} };
  }

  return JSON.parse(
    fs.readFileSync(HISTORY, 'utf8').replace(/^\uFEFF/, '')
  );
}

function saveHistory(history) {
  const temporary = `${HISTORY}.tmp`;

  fs.writeFileSync(
    temporary,
    JSON.stringify(history, null, 2),
    'utf8'
  );

  fs.renameSync(temporary, HISTORY);
}

const LIMIT = Math.min(
  20,
  Math.max(1, Number(process.env.BROTHER_LIMIT || 5))
);
const DELAY_MS = 5000;
const TARGET = process.argv[2]?.trim().toUpperCase() || null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const candidates = JSON.parse(
  fs.readFileSync(INPUT, 'utf8').replace(/^\uFEFF/, '')
);

  if (!Array.isArray(candidates)) {
    throw new Error('Ожидается массив в brother-candidates.json');
  }

  fs.mkdirSync(OUTPUT, { recursive: true });
    fs.mkdirSync(REVIEW, { recursive: true });

  const history = loadHistory();

  const report = {
    startedAt: new Date().toISOString(),
    downloaded: [],
    skipped: [],
    needsReview: [],
    failed: []
  };

  const browser = await chromium.launch({ headless: false });

  try {
    const page = await browser.newPage();

    let attempted = 0;

    for (const item of candidates) {
        if (TARGET && item.partNumber.toUpperCase() !== TARGET) {
  continue;
}
      if (attempted >= LIMIT) break;

      const url = new URL(item.sourceUrl);

      if (
        url.hostname !== 'store.brother.es' ||
        !/^\/supplies\/(?:laser\/toner|inkjet\/inkcartridgessinglepack)\//.test(url.pathname)
      ) {
        console.log(`[SKIP] Недопустимый URL: ${url.href}`);
        continue;
      }

      const partNumber = item.partNumber.toLowerCase();
      const filename = `${partNumber}.html`;
      const destination = path.join(OUTPUT, filename);
      const previousFailure = history.failed[url.href];

        if (
        previousFailure?.reason === 'related-products-not-found' &&
        previousFailure.reviewFile &&
        fs.existsSync(previousFailure.reviewFile)
        ) {
        console.log(`[REVIEW SKIP] ${partNumber} уже ожидает проверки`);
        report.skipped.push(partNumber);
        continue;
        }
      if (fs.existsSync(destination)) {
        console.log(`[SKIP] ${partNumber} уже сохранён`);
        report.skipped.push(partNumber);
        continue;
      }

      attempted++;

      console.log(`[${attempted}/${LIMIT}] ${partNumber}`);

      try {
        const response = await page.goto(url.href, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

        const status = response?.status() ?? 0;

        console.log(`HTTP: ${status}`);

        if (status === 403 || status === 429) {
          report.failed.push({ partNumber, status });
          console.log('Сайт ограничил доступ. Останавливаем сбор.');
          break;
        }

        if (status !== 200) {
          report.failed.push({ partNumber, status });
          continue;
        }

const html = await page.content();

const hasRelatedProducts =
  await page.locator('#related-products').count() > 0;

if (!hasRelatedProducts) {
  const reviewFile = path.join(REVIEW, filename);

  fs.writeFileSync(reviewFile, html, 'utf8');

  report.needsReview.push({
    partNumber,
    status,
    reason: 'related-products-not-found',
    reviewFile
  });

  history.failed[url.href] = {
    partNumber,
    reason: 'related-products-not-found',
    reviewFile,
    failedAt: new Date().toISOString()
  };

  saveHistory(history);

  console.log(`[REVIEW] ${partNumber}: блок связанных товаров отсутствует`);
  continue;
}

fs.writeFileSync(destination, html, 'utf8');

        report.downloaded.push({
          partNumber,
          url: url.href,
          file: filename
        });

        history.downloaded[url.href] = {
            partNumber,
            file: filename,
            savedAt: new Date().toISOString()
            };

delete history.failed[url.href];
saveHistory(history);

        console.log(`[OK] ${filename}`);

      } catch (error) {
        report.failed.push({
          partNumber,
          error: error.message
        });
        history.failed[url.href] = {
            partNumber,
            error: error.message,
            failedAt: new Date().toISOString()
            };

saveHistory(history);

        console.error(`[ERROR] ${error.message}`);
      }

      if (attempted < LIMIT) {
        await sleep(DELAY_MS);
      }
    }

  } finally {
    await browser.close();

    report.finishedAt = new Date().toISOString();

    fs.writeFileSync(
      REPORT,
      JSON.stringify(report, null, 2),
      'utf8'
    );

    console.log('Отчёт:', REPORT);
    console.log('Загружено:', report.downloaded.length);
    console.log('Пропущено:', report.skipped.length);
    console.log('Ошибок:', report.failed.length);
    console.log(`Требуют проверки: ${report.needsReview.length}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
