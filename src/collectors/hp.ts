import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import { collectPages, type CollectorOptions, type CollectorRuntime, type ParsedPage } from './page-collector.js';

export const HP_SEEDS = [
  'https://www.hp.com/es-es/shop/products/supplies/cartucho-de-tinta-original-hp-963-negro-3ja26ae-bgy',
  'https://www.hp.com/es-es/shop/products/supplies/cartucho-de-t-ner-original-hp-149x-negro-w1490x',
];
const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
export function hpSupplyUrl(value: string): { canonical: string } | undefined {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://www.hp.com' || url.username || url.password || url.search || url.hash
      || !/^\/es-es\/shop\/products\/supplies\/[a-z0-9-]+$/.test(url.pathname)) return undefined;
    return { canonical: url.href };
  } catch { return undefined; }
}

export function parseHpPage(html: string, sourceUrl: string, retrievedAt: string): ParsedPage {
  const result: ParsedPage = { records: [], links: [], review: [], excluded: [] };
  const review = (reason: string, detail?: string) => { result.review.push({ url: sourceUrl, reason, detail }); return result; };
  if (!hpSupplyUrl(sourceUrl)) return review('unsupported-source');
  if (Number.isNaN(Date.parse(retrievedAt))) return review('invalid-verification-date');
  const $ = load(html);
  if (/access denied|captcha|verify you are human/i.test($('title,h1').text())) return review('access-challenge');
  // Read only rendered HTML. Do not execute hydration scripts or call private shop APIs.
  $('script,style,nav,header,footer').remove();
  $('a[href]').each((_i, element) => {
    try { const url = new URL($(element).attr('href')!, sourceUrl).href; if (hpSupplyUrl(url)) result.links.push(url); } catch { /* Ignore non-product links. */ }
  });
  result.links = [...new Set(result.links)].sort();
  const titles = $('[data-test-hook="@hpstellar/storefront-ui-product-title-block"] h1');
  const title = clean(titles.text());
  if (titles.length !== 1) return review('missing-or-ambiguous-product-title');
  if (/\b(?:tambor|imagen|residuos|mantenimiento|fusor|correa|limpieza|botella|recarga|cabezal|grapas|kit|paquete|pack|remanufacturado|reacondicionado|compatible)\b/i.test(title)) {
    result.excluded.push({ url: sourceUrl, reason: 'non-cartridge-composite-or-third-party', detail: title }); return result;
  }
  const kind = /\btinta\b/i.test(title) ? 'ink' : /\btóner\b/i.test(title) ? 'toner' : undefined;
  if (!kind || !/^Cartucho de (?:tinta|tóner) (?:original HP|Original HP)\b/i.test(title)) return review('uncertain-original-cartridge-type', title);
  const skus = [...new Set($('p').map((_i, element) => clean($(element).text())).get()
    .filter(value => /^(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{6,8}(?:#[A-Z0-9]{3})?$/.test(value)))]
    .filter(value => sourceUrl.endsWith(`-${value.toLowerCase().replace('#', '-')}`));
  if (skus.length !== 1) return review('missing-exact-orderable-sku');
  const sku = skus[0];
  const compatible = $('[data-test-hook="@hpstellar/pdp/compatible-products__container"]');
  if (compatible.length !== 1) return review('missing-or-ambiguous-compatibility-list');
  const displayModels = [...new Set(compatible.find('[role="region"] p').map((_i, element) => clean($(element).text())).get())];
  if (!displayModels.length) return review('empty-compatibility-list');
  const printers: Array<{ display: string; model: string; productNumber: string }> = [];
  for (const display of displayModels) {
    // A family/series/range cannot establish an individual printer relationship.
    const match = /^(.*\bHP\b.*)\s+((?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{6,8}(?:#[A-Z0-9]{3})?)$/.exec(display);
    if (!match || !/\d/.test(match[1]) || /\b(?:serie|series|familia|family|range)\b|\d\s*[-–/]\s*\d|\d[xX]{2}/i.test(display)) {
      result.review.push({ url: sourceUrl, reason: 'family-or-ambiguous-printer', detail: display }); continue;
    }
    printers.push({ display, model: match[1], productNumber: match[2] });
  }
  const specs = $('[data-test-hook="@hpstellar/pdp/tech-specs-detailed-specs"]');
  const specification = (label: RegExp): string[] => [...new Set(specs.find('p').filter((_i, element) => label.test(clean($(element).text())))
    .map((_i, element) => clean($(element).parent().next().text())).get().filter(Boolean))];
  const families = specification(/^Selectividad$/i);
  const colors = specification(/^Botella\/cartucho de impresión, color\(es\)$/i);
  const colorNames: Record<string, string> = { negro: 'black', cian: 'cyan', magenta: 'magenta', amarillo: 'yellow', tricolor: 'tri-color' };
  const color = colors.length === 1 ? colorNames[colors[0].toLowerCase()] : undefined;
  const yields = specification(/^Rendimiento en páginas \((?:blanco y negro|color|negro)\)$/i);
  const pageCounts = [...new Set(yields.map(value => {
    const match = /^(?:El rendimiento medio del cartucho es de )?(\d{1,3}(?:\.\d{3})+|\d+)\s+páginas(?: estándar\..*)?$/i.exec(value)
      ?? /^1 negro \(aproximadamente (\d+)\) páginas$/i.exec(value);
    return match ? Number(match[1].replaceAll('.', '')) : undefined;
  }).filter((value): value is number => value !== undefined && Number.isSafeInteger(value) && value > 0))];
  for (const printer of printers) {
    result.records.push({ printerManufacturer: 'HP',
      // Retain the product code in display identity to avoid silently conflating regional hardware variants.
      printerModel: printer.display, hasReplaceableCartridges: true, cartridgeManufacturer: 'HP',
      cartridgePartNumber: sku, cartridgeKind: kind,
      ...(color ? { cartridgeColor: color } : {}), ...(pageCounts.length === 1 ? { yieldPages: pageCounts[0] } : {}),
      sourceName: 'HP Store España', sourceUrl, region: 'ES', isGenuineOem: true,
      sourceType: 'official-manufacturer', evidenceType: 'explicit-compatibility', verificationStatus: 'verified', verifiedAt: retrievedAt,
      evidence: JSON.stringify({ cartridgeTitle: title, orderableSku: sku, family: families.length === 1 ? families[0] : null,
        compatibilitySection: '@hpstellar/pdp/compatible-products__container', printerDisplay: printer.display,
        printerModel: printer.model, printerProductNumber: printer.productNumber, colorText: colors, yieldText: yields }),
    });
  }
  return result;
}

export async function collectHp(options: CollectorOptions, runtime: CollectorRuntime = {}) {
  return collectPages({ name: 'hp', seeds: HP_SEEDS, source: hpSupplyUrl, parse: parseHpPage }, options, runtime);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  const values = new Map<string, string>(); const seeds: string[] = [];
  for (let i = 0; i < args.length; i += 2) {
    if (!['--output-dir', '--state', '--max-pages', '--delay-ms', '--retries', '--seed'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid option ${args[i]}`);
    if (args[i] === '--seed') seeds.push(args[i + 1]); else values.set(args[i], args[i + 1]);
  }
  const report = await collectHp({ outputDirectory: values.get('--output-dir') ?? 'data/official/hp', stateFile: values.get('--state') ?? '.collector-state/hp.json',
    maxPages: Number(values.get('--max-pages') ?? 25), delayMs: Number(values.get('--delay-ms') ?? 10000), retries: Number(values.get('--retries') ?? 2),
    ...(seeds.length ? { seeds } : {}) });
  console.log(JSON.stringify({ ...report, pages: undefined }, null, 2));
  if (report.failures.length) process.exitCode = 1;
}
