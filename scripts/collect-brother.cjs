const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CHANNELS = ['msedge', 'chrome'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function isAllowedBrotherSupplyUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'store.brother.es'
      && /^\/supplies\/(?:laser\/toner|inkjet\/inkcartridgessinglepack)\//.test(url.pathname)
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

async function launchInstalledBrowser(channels = DEFAULT_CHANNELS) {
  const { chromium } = require('playwright-core');
  const failures = [];
  for (const channel of channels) {
    try {
      console.log(`[Brother] Abriendo ${channel} en un perfil temporal...`);
      return await chromium.launch({ channel, headless: false });
    } catch (error) {
      failures.push(`${channel}: ${error.message}`);
    }
  }
  throw new Error(`No se pudo abrir Microsoft Edge ni Google Chrome. ${failures.join(' | ')}`);
}

async function collectBrother(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const input = path.join(root, 'data', 'brother-candidates.json');
  const output = path.join(root, 'data', 'brother-html');
  const review = path.join(root, 'data', 'brother-review');
  const reportPath = path.join(root, 'data', 'brother-collection-report.json');
  const historyPath = path.join(root, 'data', 'brother-collection-history.json');
  const checkpointPath = path.join(root, '.collector-state', 'brother-processing.json');
  const limit = Math.min(20, Math.max(1, Number(options.limit ?? process.env.BROTHER_LIMIT ?? 5)));
  const delayMs = Math.max(1000, Number(options.delayMs ?? 5000));
  const target = String(options.target ?? process.env.BROTHER_TARGET ?? '').trim().toUpperCase() || null;
  if (!fs.existsSync(input)) throw new Error(`No existe la lista Brother: ${input}`);
  const candidates = readJson(input);
  if (!Array.isArray(candidates)) throw new Error('Se esperaba un array en brother-candidates.json');
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(review, { recursive: true });
  const history = fs.existsSync(historyPath) ? readJson(historyPath) : { downloaded: {}, failed: {} };
  history.downloaded ||= {};
  history.failed ||= {};
  const report = { startedAt: new Date().toISOString(), downloaded: [], skipped: [], needsReview: [], failed: [] };
  const queue = [];

  for (const item of candidates) {
    const partNumber = String(item.partNumber || '').trim().toUpperCase();
    if (!partNumber || (target && partNumber !== target) || !isAllowedBrotherSupplyUrl(item.sourceUrl)) continue;
    const destination = path.join(output, `${partNumber.toLowerCase()}.html`);
    const previousFailure = history.failed[item.sourceUrl];
    if (fs.existsSync(destination)) { report.skipped.push(partNumber); continue; }
    if (previousFailure?.reason === 'related-products-not-found' && previousFailure.reviewFile && fs.existsSync(previousFailure.reviewFile)) {
      report.skipped.push(partNumber); continue;
    }
    queue.push({ ...item, partNumber, destination });
    if (queue.length >= limit) break;
  }

  if (!queue.length) {
    report.finishedAt = new Date().toISOString();
    writeJsonAtomically(reportPath, report);
    console.log('[Brother] No hay páginas nuevas en este lote; se procesará la caché existente.');
    return report;
  }

  writeCheckpoint(checkpointPath, queue, report, queue);
  const launchBrowser = options.launchBrowser || (() => launchInstalledBrowser(options.channels));
  const browser = await launchBrowser();
  let blockedError;
  try {
    const page = await browser.newPage();
    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index];
      console.log(`[Brother] Descarga ${index + 1}/${queue.length}: ${item.partNumber}`);
      try {
        const response = await page.goto(item.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const status = response?.status() ?? 0;
        console.log(`[Brother] HTTP ${status}: ${item.sourceUrl}`);
        if (status === 403 || status === 429) {
          const failure = { partNumber: item.partNumber, status, reason: 'access-blocked' };
          report.failed.push(failure); history.failed[item.sourceUrl] = { ...failure, failedAt: new Date().toISOString() };
          blockedError = new Error(`Brother devolvió HTTP ${status}; la recopilación se detuvo sin intentar eludir la restricción.`);
          writeCheckpoint(checkpointPath, queue, report, queue.slice(index + 1));
          break;
        }
        if (status !== 200) {
          const failure = { partNumber: item.partNumber, status, reason: 'unexpected-status' };
          report.failed.push(failure); history.failed[item.sourceUrl] = { ...failure, failedAt: new Date().toISOString() };
          writeCheckpoint(checkpointPath, queue, report, queue.slice(index + 1));
          continue;
        }
        const html = await page.content();
        if (/captcha|verify you are human|access denied|acceso denegado/i.test(html)) {
          const failure = { partNumber: item.partNumber, status, reason: 'access-challenge' };
          report.failed.push(failure); history.failed[item.sourceUrl] = { ...failure, failedAt: new Date().toISOString() };
          blockedError = new Error('Brother mostró una comprobación de acceso; la recopilación se detuvo sin intentar eludirla.');
          writeCheckpoint(checkpointPath, queue, report, queue.slice(index + 1));
          break;
        }
        if (await page.locator('#related-products').count() === 0) {
          const reviewFile = path.join(review, `${item.partNumber.toLowerCase()}.html`);
          fs.writeFileSync(reviewFile, html, 'utf8');
          const failure = { partNumber: item.partNumber, status, reason: 'related-products-not-found', reviewFile };
          report.needsReview.push(failure); history.failed[item.sourceUrl] = { ...failure, failedAt: new Date().toISOString() };
          writeCheckpoint(checkpointPath, queue, report, queue.slice(index + 1));
          continue;
        }
        fs.writeFileSync(item.destination, html, 'utf8');
        report.downloaded.push({ partNumber: item.partNumber, url: item.sourceUrl, file: path.basename(item.destination) });
        history.downloaded[item.sourceUrl] = { partNumber: item.partNumber, file: path.basename(item.destination), savedAt: new Date().toISOString() };
        delete history.failed[item.sourceUrl];
        saveHistory(historyPath, history);
        writeCheckpoint(checkpointPath, queue, report, queue.slice(index + 1));
        console.log(`[Brother] Guardado: ${path.basename(item.destination)}`);
      } catch (error) {
        if (blockedError) break;
        const failure = { partNumber: item.partNumber, error: error.message, reason: 'request-failed' };
        report.failed.push(failure); history.failed[item.sourceUrl] = { ...failure, failedAt: new Date().toISOString() };
        saveHistory(historyPath, history);
        writeCheckpoint(checkpointPath, queue, report, queue.slice(index + 1));
        console.error(`[Brother] Error: ${error.message}`);
      }
      if (index + 1 < queue.length) await sleep(delayMs);
    }
  } finally {
    await browser.close();
    report.finishedAt = new Date().toISOString();
    saveHistory(historyPath, history);
    writeJsonAtomically(reportPath, report);
    console.log(`[Brother] Descargadas: ${report.downloaded.length}; revisión: ${report.needsReview.length}; errores: ${report.failed.length}.`);
  }
  if (blockedError) throw blockedError;
  return report;
}

function writeCheckpoint(pathname, queue, report, pending) {
  const pages = [...report.downloaded, ...report.needsReview, ...report.failed];
  const records = report.downloaded.map(item => ({ cartridgePartNumber: item.partNumber }));
  writeJsonAtomically(pathname, { phase: 'download', total: queue.length, pages, pending: pending.map(item => item.partNumber), records, failures: report.failed });
}
function readJson(pathname) { return JSON.parse(fs.readFileSync(pathname, 'utf8').replace(/^\uFEFF/, '')); }
function saveHistory(pathname, history) { writeJsonAtomically(pathname, history); }
function writeJsonAtomically(pathname, value) {
  fs.mkdirSync(path.dirname(pathname), { recursive: true });
  const temporary = `${pathname}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, pathname);
}

module.exports = { collectBrother, isAllowedBrotherSupplyUrl, launchInstalledBrowser };

if (require.main === module) {
  collectBrother().catch(error => { console.error(error.message); process.exitCode = 1; });
}
