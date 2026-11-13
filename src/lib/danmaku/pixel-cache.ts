interface PixelCacheEntry<Value> {
  value: Value;
  pixels: number;
}

export class PixelLruCache<Key, Value> {
  private readonly entries = new Map<Key, PixelCacheEntry<Value>>();
  private cachedPixels = 0;
  private budgetPixels: number;

  constructor(budgetPixels: number) {
    this.budgetPixels = Math.max(0, Math.floor(budgetPixels));
  }

  get size() {
    return this.entries.size;
  }

  get pixelCount() {
    return this.cachedPixels;
  }

  setBudget(budgetPixels: number) {
    this.budgetPixels = Math.max(0, Math.floor(budgetPixels));
    while (this.cachedPixels > this.budgetPixels) {
      const oldestKey = this.entries.keys().next().value as Key | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (oldest) this.cachedPixels -= oldest.pixels;
    }
  }

  get(key: Key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: Key, value: Value, pixels: number) {
    const normalizedPixels = Math.max(1, Math.ceil(pixels));
    if (normalizedPixels > this.budgetPixels) return false;

    const existing = this.entries.get(key);
    if (existing) {
      this.cachedPixels -= existing.pixels;
      this.entries.delete(key);
    }

    while (
      this.entries.size > 0 &&
      this.cachedPixels + normalizedPixels > this.budgetPixels
    ) {
      const oldestKey = this.entries.keys().next().value as Key | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (oldest) this.cachedPixels -= oldest.pixels;
    }

    this.entries.set(key, { value, pixels: normalizedPixels });
    this.cachedPixels += normalizedPixels;
    return true;
  }

  clear() {
    this.entries.clear();
    this.cachedPixels = 0;
  }
}
