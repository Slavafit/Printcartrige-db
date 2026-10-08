export function normalizeManufacturerName(value: string): string {
  return normalizeText(value);
}

export function normalizePrinterModel(value: string): string {
  return normalizeText(value).replace(/[^A-Z0-9]+/g, '');
}

export function normalizeCartridgePartNumber(value: string): string {
  return normalizeText(value).replace(/[^A-Z0-9]+/g, '');
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
}
