import type { ParsedMultiSource, MultiSourceRow, SupplyType } from './multi-source-import.js';

interface BrotherSupply { partNumber: string; type: string; sourceUrl: string }
interface BrotherCollection { manufacturer: string; supplies: BrotherSupply[] }
interface BrotherAuditLink { printerModel: string; supplyPartNumber: string; status: string; printerSourceUrl: string; supplySourceUrl: string }
interface BrotherAudit { generatedAt: string; compatibility: BrotherAuditLink[] }

const BOTTLES: Record<string, { color: string; yieldPages: number }> = {
  BTD180BK: { color: 'black', yieldPages: 7500 },
  BTD180C: { color: 'cyan', yieldPages: 5000 },
  BTD180M: { color: 'magenta', yieldPages: 5000 },
  BTD180Y: { color: 'yellow', yieldPages: 5000 },
};

export interface BrotherSupplyPreparation {
  parsed: ParsedMultiSource;
  summary: {
    inputRelationships: number;
    acceptedRelationships: number;
    excludedRelationships: number;
    uniquePrinters: number;
    uniqueSupplies: number;
    cartridgeRelationships: number;
    bottleRelationships: number;
  };
}
export function prepareBrotherSupplyImport(collection: BrotherCollection, audit: BrotherAudit): BrotherSupplyPreparation {
  if (collection.manufacturer.trim().toLowerCase() !== 'brother') throw new Error('Expected a Brother collection');
  const supplyByPart = new Map<string, BrotherSupply>();
  for (const supply of collection.supplies) {
    const part = supply.partNumber.trim().toUpperCase();
    if (!part || supplyByPart.has(part)) throw new Error(`Invalid or duplicate Brother supply: ${part || '(missing)'}`);
    if (!supply.sourceUrl.startsWith('https://store.brother.es/')) throw new Error(`Unsupported Brother source URL: ${supply.sourceUrl}`);
    supplyByPart.set(part, supply);
  }

  const rows: MultiSourceRow[] = [];
  const warnings: ParsedMultiSource['warnings'] = [];
  const errors: ParsedMultiSource['errors'] = [];
  const seen = new Set<string>();
  audit.compatibility.forEach((link, index) => {
    if (link.status !== 'cross-referenced') {
      warnings.push({ row: index + 1, message: `Excluded Brother relationship with status ${link.status}: ${link.printerModel} / ${link.supplyPartNumber}` });
      return;
    }
    const part = link.supplyPartNumber.trim().toUpperCase();
    const supply = supplyByPart.get(part);
    if (!supply) { errors.push({ row: index + 1, message: `Unknown Brother supply: ${part}` }); return; }
    if (link.supplySourceUrl !== supply.sourceUrl || !link.printerSourceUrl.startsWith('https://store.brother.es/devices/')) {
      errors.push({ row: index + 1, message: `Conflicting Brother evidence URLs: ${link.printerModel} / ${part}` }); return;
    }
    const bottle = BOTTLES[part];
    const supplyType: SupplyType = bottle ? 'ink_bottle' : supply.type === 'ink' || supply.type === 'toner' ? supply.type : 'unknown';
    if (supplyType === 'unknown') { errors.push({ row: index + 1, message: `Unsupported Brother supply type for ${part}: ${supply.type}` }); return; }
    const key = `${link.printerModel.trim().toUpperCase()}|${part}`;
    if (seen.has(key)) { errors.push({ row: index + 1, message: `Duplicate Brother relationship: ${key}` }); return; }
    seen.add(key);
    const evidence = JSON.stringify({
      status: link.status,
      printerSourceUrl: link.printerSourceUrl,
      supplySourceUrl: link.supplySourceUrl,
      productType: supplyType,
    });
    rows.push({
      printerManufacturer: 'Brother', printerModel: link.printerModel,
      supplyManufacturer: 'Brother', supplyPartNumber: part, supplyType, supplyOrigin: 'oem',
      ...(bottle ? { color: bottle.color, yieldPages: bottle.yieldPages, description: `Brother original ink bottle; official yield ${bottle.yieldPages} pages.` } : {}),
      reliabilityStatus: 'official_verified', region: 'ES',
      sourceReference: link.supplySourceUrl, evidenceType: 'explicit-compatibility', evidence,
      verifiedAt: audit.generatedAt, note: `Printer evidence: ${link.printerSourceUrl}`,
      rawPrinterModel: link.printerModel, rawSupplyPartNumber: part,
    });
  });

  return {
    parsed: { format: 'generic', rows, errors, warnings, mapping: { brotherAudit: 'official cross-referenced supply relationship' } },
    summary: {
      inputRelationships: audit.compatibility.length,
      acceptedRelationships: rows.length,
      excludedRelationships: audit.compatibility.length - rows.length,
      uniquePrinters: new Set(rows.map(row => row.printerModel)).size,
      uniqueSupplies: new Set(rows.map(row => row.supplyPartNumber)).size,
      cartridgeRelationships: rows.filter(row => row.supplyType === 'ink' || row.supplyType === 'toner').length,
      bottleRelationships: rows.filter(row => row.supplyType === 'ink_bottle').length,
    },
  };
}
