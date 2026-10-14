const CONFIRMED_MODEL_REPAIRS = [
  { pathname: '/devices/laser/mfc/mfc3360c', from: 'MFC-3360CN', to: 'MFC-3360C' },
  { pathname: '/devices/laser/mfc/mfc295cn', from: 'MFC-295C', to: 'MFC-295CN' },
  { pathname: '/devices/laser/mfc/mfc7440n', from: 'MFC-7', to: 'MFC-7440N' },
];
const CONFIRMED_CORRECTIONS = new Map(CONFIRMED_MODEL_REPAIRS.map(item => [`${item.pathname}|${normalizeModelIdentity(item.from)}`, item.to]));

function normalizeModelIdentity(value) {
  return String(value ?? '').normalize('NFKC').trim().toUpperCase().replace(/^BROTHER\s+/, '').replace(/[^A-Z0-9]+/g, '');
}

function extractLabelModel(label) {
  const match = String(label ?? '').match(/\b(?:HL|DCP|MFC|FAX)[-\s]?[A-Z0-9]+/i);
  if (!match) throw new Error(`Не найдена модель Brother в подписи: ${String(label ?? '').trim() || '(пусто)'}`);
  return match[0].toUpperCase().replace(/^(HL|DCP|MFC|FAX)[-\s]?/, '$1-');
}

function deviceIdentity(url) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parsed.hostname !== 'store.brother.es' || parts[0] !== 'devices' || parts.length < 4) {
    throw new Error(`Неподдерживаемый URL устройства Brother: ${url}`);
  }
  const slug = parts.at(-1).replace(/-bundle$/i, '');
  const identity = normalizeModelIdentity(slug);
  if (!/^(?:HL|DCP|MFC|FAX)[A-Z0-9]+$/.test(identity)) throw new Error(`Не распознана модель из URL Brother: ${url}`);
  return { identity, pathname: parsed.pathname.toLowerCase() };
}

function formatIdentity(identity) {
  const match = identity.match(/^(HL|DCP|MFC|FAX)([A-Z0-9]+)$/);
  if (!match) throw new Error(`Некорректная модель Brother: ${identity}`);
  return `${match[1]}-${match[2]}`;
}

function resolveBrotherModel(label, url) {
  const parsedModel = extractLabelModel(label);
  const labelIdentity = normalizeModelIdentity(parsedModel);
  const expected = deviceIdentity(url);
  if (labelIdentity === expected.identity) return { model: formatIdentity(expected.identity), corrected: false };
  const correction = CONFIRMED_CORRECTIONS.get(`${expected.pathname}|${labelIdentity}`);
  if (correction) return { model: correction, corrected: true, originalModel: parsedModel };
  throw new Error(`Неподтверждённое расхождение модели Brother: ${parsedModel} != ${formatIdentity(expected.identity)} (${url})`);
}

module.exports = { CONFIRMED_CORRECTIONS, CONFIRMED_MODEL_REPAIRS, deviceIdentity, extractLabelModel, normalizeModelIdentity, resolveBrotherModel };
