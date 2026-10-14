const fs = require('node:fs');
const path = require('node:path');
const { CONFIRMED_MODEL_REPAIRS, normalizeModelIdentity, resolveBrotherModel } = require('./brother-model.cjs');

function rebuildBrotherData(collection, verification) {
  const aliases = new Map();
  const corrections = new Map();
  const printers = collection.printers.map(printer => {
    const resolved = resolveBrotherModel(printer.model, printer.url);
    const originalIdentity = normalizeModelIdentity(printer.model);
    if (aliases.has(originalIdentity)) throw new Error(`Повторная исходная модель: ${printer.model}`);
    aliases.set(originalIdentity, resolved.model);
    if (resolved.corrected) corrections.set(originalIdentity, { from: printer.model, to: resolved.model, url: printer.url, relationships: 0 });
    return { ...printer, model: resolved.model };
  });

  const normalized = new Map();
  for (const printer of printers) {
    const identity = normalizeModelIdentity(printer.model);
    if (normalized.has(identity)) throw new Error(`Дубликат после нормализации: ${normalized.get(identity)} / ${printer.model}`);
    normalized.set(identity, printer.model);
  }

  const compatibility = collection.compatibility.map(link => {
    const identity = normalizeModelIdentity(link.printerModel);
    const model = aliases.get(identity);
    if (!model) throw new Error(`Связь с неизвестной моделью: ${link.printerModel}`);
    const correction = corrections.get(identity);
    if (correction) correction.relationships += 1;
    return { ...link, printerModel: model };
  });

  const verifiedPrinters = {};
  for (const [key, value] of Object.entries(verification.printers ?? {})) {
    const resolved = resolveBrotherModel(key, value.printerUrl);
    if (verifiedPrinters[resolved.model]) throw new Error(`Дубликат в проверке после нормализации: ${resolved.model}`);
    verifiedPrinters[resolved.model] = {
      ...value,
      results: (value.results ?? []).map(result => ({ ...result, printerModel: resolved.model })),
    };
  }

  return {
    collection: { ...collection, printers, compatibility },
    verification: { ...verification, printers: verifiedPrinters },
    report: {
      correctedModels: CONFIRMED_MODEL_REPAIRS.map(item => {
        const printer = printers.find(row => normalizeModelIdentity(row.model) === normalizeModelIdentity(item.to));
        if (!printer || new URL(printer.url).pathname.toLowerCase() !== item.pathname) throw new Error(`Нет подтверждённой исправленной модели: ${item.to}`);
        return {
          from: item.from,
          to: item.to,
          url: printer.url,
          relationships: compatibility.filter(row => normalizeModelIdentity(row.printerModel) === normalizeModelIdentity(item.to)).length,
        };
      }),
      printers: printers.length,
      supplies: collection.supplies.length,
      relationships: compatibility.length,
      normalizedDuplicates: 0,
      unconfirmedMismatches: 0,
    },
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function main() {
  const data = path.resolve(__dirname, '..', 'data');
  const collectionPath = path.join(data, 'brother-compatibility.json');
  const verificationPath = path.join(data, 'brother-verification.json');
  const rebuilt = rebuildBrotherData(readJson(collectionPath), readJson(verificationPath));
  fs.writeFileSync(collectionPath, `${JSON.stringify(rebuilt.collection, null, 2)}\n`, 'utf8');
  fs.writeFileSync(verificationPath, `${JSON.stringify(rebuilt.verification, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(data, 'brother-model-repair-report.json'), `${JSON.stringify(rebuilt.report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(rebuilt.report, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { rebuildBrotherData };
