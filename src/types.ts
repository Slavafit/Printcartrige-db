export type CartridgeKind = 'ink' | 'toner';
export type VerificationStatus = 'unverified' | 'verified' | 'rejected';

export interface ImportRecord {
  printerManufacturer: string;
  printerModel: string;
  hasReplaceableCartridges: boolean;
  cartridgeManufacturer?: string;
  cartridgePartNumber?: string;
  cartridgeKind?: CartridgeKind;
  cartridgeColor?: string;
  sourceName?: string;
  sourceUrl?: string;
  verificationStatus?: VerificationStatus;
  region?: string;
  isGenuineOem?: boolean;
}

export interface ValidationIssue { row: number; field?: string; message: string }
export interface ImportResult { valid: boolean; dryRun: boolean; rows: number; written: number; issues: ValidationIssue[] }

export interface ExportRecord extends ImportRecord {}
