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
  yieldPages?: number;
  sourceName?: string;
  sourceUrl?: string;
  verificationStatus?: VerificationStatus;
  region?: string;
  isGenuineOem?: boolean;
  evidence?: string;
  verifiedAt?: string;
  sourceType?: 'official-manufacturer' | 'other';
  evidenceType?: 'explicit-compatibility' | 'product-page-only' | 'other';
}

export interface ValidationIssue { row: number; field?: string; message: string }
export interface ImportResult { valid: boolean; dryRun: boolean; rows: number; written: number; issues: ValidationIssue[] }

export interface ExportRecord extends ImportRecord {}
