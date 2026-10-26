const SEARCH_HISTORY_KEY = "ailicili:search-history";
const MAX_HISTORY_ITEMS = 8;

export function readSearchHistory(): string[] {
  try {
    const value = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

export function addSearchHistory(query: string): string[] {
  const normalized = query.trim().slice(0, 100);
  const current = readSearchHistory();
  if (!normalized) return current;
  const next = [
    normalized,
    ...current.filter((item) => item !== normalized),
  ].slice(0, MAX_HISTORY_ITEMS);

  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
  } catch {
    return current;
  }
  return next;
}

export function clearSearchHistory(): void {
  try {
    localStorage.removeItem(SEARCH_HISTORY_KEY);
  } catch {
    // Storage is optional; an unavailable store should not block search.
  }
}
