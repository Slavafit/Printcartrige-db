export function readRecentSearches(value: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((entry): entry is string => typeof entry === 'string').map(entry => entry.trim()).filter(Boolean))].slice(0,10)
      : [];
  } catch { return []; }
}
