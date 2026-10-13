import type { CartridgeDatabase } from './database.js';

export interface CoverageMetrics {
  totalPrinters: number;
  printersWithSupplies: number;
  printersWithoutSupplies: number;
  coveragePercent: number;
  totalSupplies: number;
  totalRelationships: number;
  verifiedRelationships: number;
  thirdPartyRelationships: number;
  unknownOriginSupplies: number;
}
export interface CoverageReport {
  total: CoverageMetrics;
  manufacturers: Record<string, CoverageMetrics>;
  withoutSupplies: Array<{ manufacturer: string; model: string }>;
  modelVariants: Array<{ manufacturer: string; normalized: string; names: string[] }>;
}

// Rejected and conflicting edges do not establish usable coverage.
const eligible = `cp.verification_status <> 'rejected' AND cp.reliability_status <> 'conflicting'
  AND length(trim(c.normalized_part_number)) > 0`;

export function coverageReport(database: CartridgeDatabase): CoverageReport {
  const db = database.db;
  const metrics = (manufacturer?: string): CoverageMetrics => {
    const args = manufacturer === undefined ? [] : [manufacturer];
    const filter = manufacturer === undefined ? '' : ' AND m.normalized_name = ?';
    const count = (sql: string): number => (db.prepare(sql).get(...args) as { n: number }).n;
    const joins = `FROM compatibility cp JOIN printers p ON p.id=cp.printer_id
      JOIN manufacturers m ON m.id=p.manufacturer_id JOIN cartridges c ON c.id=cp.cartridge_id
      WHERE ${eligible}${filter}`;
    const totalPrinters = count(`SELECT count(*) n FROM printers p JOIN manufacturers m ON m.id=p.manufacturer_id WHERE 1=1${filter}`);
    const printersWithSupplies = count(`SELECT count(DISTINCT p.id) n ${joins}`);
    const supplies = manufacturer === undefined
      ? (condition: string) => count(`SELECT count(*) n FROM cartridges c WHERE ${condition}`)
      : (condition: string) => count(`SELECT count(DISTINCT c.id) n ${joins} AND ${condition}`);
    return {
      totalPrinters, printersWithSupplies, printersWithoutSupplies: totalPrinters-printersWithSupplies,
      coveragePercent: totalPrinters ? Number((printersWithSupplies/totalPrinters*100).toFixed(2)) : 0,
      totalSupplies: supplies('1=1'), totalRelationships: count(`SELECT count(*) n ${joins}`),
      verifiedRelationships: count(`SELECT count(*) n ${joins} AND cp.reliability_status='official_verified' AND cp.is_genuine_oem=1`),
      thirdPartyRelationships: count(`SELECT count(*) n ${joins} AND EXISTS (
        SELECT 1 FROM compatibility_sources cs JOIN data_sources ds ON ds.id=cs.source_id
        WHERE cs.compatibility_id=cp.id AND ds.source_category IN ('third_party','open_dataset')
        AND cs.verification_status <> 'conflicting')`),
      unknownOriginSupplies: supplies("c.origin_type='unknown'"),
    };
  };
  const names = db.prepare('SELECT DISTINCT m.normalized_name name FROM manufacturers m JOIN printers p ON p.manufacturer_id=m.id ORDER BY name').all() as Array<{ name: string }>;
  const manufacturers = Object.fromEntries([...new Set([...names.map(row=>row.name),'HP','EPSON','CANON'])].sort().map(name=>[name,metrics(name)]));
  const withoutSupplies = db.prepare(`SELECT m.name manufacturer,p.model_name model FROM printers p
    JOIN manufacturers m ON m.id=p.manufacturer_id WHERE NOT EXISTS (
      SELECT 1 FROM compatibility cp JOIN cartridges c ON c.id=cp.cartridge_id WHERE cp.printer_id=p.id AND ${eligible})
    ORDER BY m.normalized_name,p.normalized_model_name`).all() as CoverageReport['withoutSupplies'];
  const variants = new Map<string, { manufacturer: string; normalized: string; names: Set<string> }>();
  const models = db.prepare(`SELECT m.normalized_name manufacturer,p.normalized_model_name normalized,p.model_name name FROM printers p JOIN manufacturers m ON m.id=p.manufacturer_id
    UNION SELECT m.normalized_name,p.normalized_model_name,cs.raw_printer_model FROM compatibility_sources cs JOIN compatibility cp ON cp.id=cs.compatibility_id JOIN printers p ON p.id=cp.printer_id JOIN manufacturers m ON m.id=p.manufacturer_id WHERE cs.raw_printer_model IS NOT NULL`).all() as Array<{manufacturer:string;normalized:string;name:string}>;
  for (const model of models) {
    const key = `${model.manufacturer}|${model.normalized}`;
    const entry = variants.get(key) ?? { manufacturer:model.manufacturer,normalized:model.normalized,names:new Set<string>() };
    entry.names.add(model.name); variants.set(key,entry);
  }
  return { total:metrics(), manufacturers, withoutSupplies,
    modelVariants:[...variants.values()].filter(row=>row.names.size>1).map(row=>({...row,names:[...row.names].sort()})).sort((a,b)=>`${a.manufacturer}|${a.normalized}`.localeCompare(`${b.manufacturer}|${b.normalized}`)) };
}

export function coverageDelta(before: CoverageReport, after: CoverageReport): Pick<CoverageReport,'total'|'manufacturers'> {
  const subtract = (a:CoverageMetrics|undefined,b:CoverageMetrics|undefined):CoverageMetrics => Object.fromEntries(
    Object.keys(after.total).map(key=>[key,Number(((b?.[key as keyof CoverageMetrics]??0)-(a?.[key as keyof CoverageMetrics]??0)).toFixed(2))]),
  ) as unknown as CoverageMetrics;
  return { total:subtract(before.total,after.total), manufacturers:Object.fromEntries(
    [...new Set([...Object.keys(before.manufacturers),...Object.keys(after.manufacturers)])].sort().map(name=>[name,subtract(before.manufacturers[name],after.manufacturers[name])]),
  ) };
}
