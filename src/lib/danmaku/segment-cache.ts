import type { DanmakuItem, DanmakuSegment } from "@/api/danmaku";

export const DANMAKU_SEGMENT_DURATION_MS = 360_000;
export const DANMAKU_PREFETCH_WINDOW_MS = 60_000;
export const DANMAKU_PREVIOUS_SEGMENT_WINDOW_MS = 30_000;
export const DANMAKU_SEGMENT_CACHE_LIMIT = 8;

export function danmakuSegmentIndex(timeMs: number) {
  return Math.floor(Math.max(0, timeMs) / DANMAKU_SEGMENT_DURATION_MS) + 1;
}

export function danmakuSegmentOffset(timeMs: number) {
  return Math.max(0, timeMs) % DANMAKU_SEGMENT_DURATION_MS;
}

export function shouldPrefetchNextDanmakuSegment(timeMs: number) {
  return (
    DANMAKU_SEGMENT_DURATION_MS - danmakuSegmentOffset(timeMs) <=
    DANMAKU_PREFETCH_WINDOW_MS
  );
}

export function shouldLoadPreviousDanmakuSegment(timeMs: number) {
  return (
    danmakuSegmentIndex(timeMs) > 1 &&
    danmakuSegmentOffset(timeMs) <= DANMAKU_PREVIOUS_SEGMENT_WINDOW_MS
  );
}

function segmentKey(cid: number, segmentIndex: number) {
  return `${cid}:${segmentIndex}`;
}

export class DanmakuSegmentLruCache {
  private readonly entries = new Map<string, DanmakuSegment>();
  private readonly limit: number;

  constructor(limit = DANMAKU_SEGMENT_CACHE_LIMIT) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  get size() {
    return this.entries.size;
  }

  get(cid: number, segmentIndex: number) {
    const key = segmentKey(cid, segmentIndex);
    const segment = this.entries.get(key);
    if (!segment) return undefined;

    this.entries.delete(key);
    this.entries.set(key, segment);
    return segment;
  }

  set(cid: number, segmentIndex: number, segment: DanmakuSegment) {
    const key = segmentKey(cid, segmentIndex);
    this.entries.delete(key);
    this.entries.set(key, segment);

    while (this.entries.size > this.limit) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  clear() {
    this.entries.clear();
  }
}

export function mergeDanmakuSegmentItems(
  segments: readonly (DanmakuSegment | undefined)[]
) {
  const unique = new Map<string, DanmakuItem>();

  for (const segment of segments) {
    if (!segment) continue;
    for (const item of segment.items) {
      if (!unique.has(item.id)) unique.set(item.id, item);
    }
  }

  return Array.from(unique.values()).sort(
    (left, right) =>
      left.timeMs - right.timeMs || left.id.localeCompare(right.id)
  );
}

export function cachedDanmakuSegmentItems(
  cache: DanmakuSegmentLruCache,
  cid: number,
  segmentIndex: number
) {
  return mergeDanmakuSegmentItems([
    cache.get(cid, segmentIndex - 1),
    cache.get(cid, segmentIndex),
    cache.get(cid, segmentIndex + 1),
  ]);
}
