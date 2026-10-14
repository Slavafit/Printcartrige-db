export const SUPPLY_TYPES = ['ink', 'toner', 'ink_bottle', 'drum', 'waste_toner', 'belt', 'other', 'unknown'] as const;
export type SupplyType = typeof SUPPLY_TYPES[number];

export function isSupplyType(value: string): value is SupplyType {
  return (SUPPLY_TYPES as readonly string[]).includes(value);
}

export function supplyStorage(type: SupplyType): { kind: Exclude<SupplyType, 'ink_bottle'>; supplyForm: 'ink_bottle' | null } {
  return type === 'ink_bottle' ? { kind: 'other', supplyForm: 'ink_bottle' } : { kind: type, supplyForm: null };
}

export function supplyTypeFromStorage(kind: string, supplyForm?: string | null): SupplyType {
  if (supplyForm === 'ink_bottle') return 'ink_bottle';
  return isSupplyType(kind) && kind !== 'ink_bottle' ? kind : 'unknown';
}

export function isCartridgeType(type: SupplyType): boolean {
  return type === 'ink' || type === 'toner';
}
