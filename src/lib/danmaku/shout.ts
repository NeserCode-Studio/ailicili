import { sanitizeDanmakuText, type DanmakuPart } from "./types.ts";

export const DANMAKU_SHOUT_THRESHOLD = 10;
export const DANMAKU_SHOUT_WINDOW_MS = 12_000;
export const DANMAKU_SHOUT_HOLD_MS = 5_000;

const MAX_SUPPRESSED_TEXTS = 2_048;

export interface DanmakuShoutSourceItem {
  id?: string;
  text: string;
  timeMs: number;
  parts?: readonly DanmakuPart[];
}

export interface DanmakuShout {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  count: number;
  updates?: readonly DanmakuShoutCountUpdate[];
}

export interface DanmakuShoutCountUpdate {
  timeMs: number;
  count: number;
}

export interface DanmakuShoutSnapshot {
  shouts: DanmakuShout[];
  suppressedTexts: string[];
}

interface LiveShoutState {
  text: string;
  recentTimes: number[];
  sessionStartMs: number | null;
  sessionEndMs: number;
  sessionCount: number;
}

interface VideoShoutState {
  text: string;
  count: number;
  sessions: VideoShoutSession[];
}

interface VideoShoutSession {
  startMs: number;
  endMs: number;
  initialCount: number;
  updates: DanmakuShoutCountUpdate[];
}

function finiteTime(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

export function danmakuShoutText(
  item: Pick<DanmakuShoutSourceItem, "text" | "parts">
) {
  if (item.parts?.some((part) => part.type === "emote")) return null;
  const text = sanitizeDanmakuText(item.text);
  return text || null;
}

export function resolveDanmakuShoutCount(
  shout: Pick<DanmakuShout, "count" | "updates">,
  clockMs: number
) {
  const updates = shout.updates;
  if (!updates?.length || !Number.isFinite(clockMs)) return shout.count;

  let low = 0;
  let high = updates.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (updates[middle].timeMs <= clockMs) low = middle + 1;
    else high = middle;
  }
  return low > 0 ? updates[low - 1].count : shout.count;
}

function normalizeDanmakuShoutUpdates(
  updates: readonly DanmakuShoutCountUpdate[] | undefined,
  startMs: number,
  endMs: number,
  initialCount: number
) {
  if (!updates?.length) return [];

  const unique = new Map<number, number>();
  for (const update of updates) {
    const timeMs = finiteTime(update.timeMs);
    const count = Math.floor(update.count);
    if (
      timeMs === null ||
      timeMs <= startMs ||
      timeMs >= endMs ||
      !Number.isFinite(count) ||
      count < initialCount
    ) {
      continue;
    }
    unique.set(timeMs, count);
  }

  let previousCount = initialCount;
  return Array.from(unique.entries())
    .sort(([left], [right]) => left - right)
    .flatMap(([timeMs, count]) => {
      if (count < previousCount) return [];
      previousCount = count;
      return [{ timeMs, count }];
    });
}

export function normalizeDanmakuShouts(
  shouts: readonly DanmakuShout[]
): DanmakuShout[] {
  const unique = new Map<string, DanmakuShout>();

  for (const shout of shouts) {
    const text = sanitizeDanmakuText(shout.text);
    const startMs = finiteTime(shout.startMs);
    const endMs = finiteTime(shout.endMs);
    const count = Math.floor(shout.count);
    if (
      !text ||
      startMs === null ||
      endMs === null ||
      endMs <= startMs ||
      !Number.isFinite(count) ||
      count < DANMAKU_SHOUT_THRESHOLD
    ) {
      continue;
    }

    const id = shout.id.trim() || `${startMs}:${text}`;
    const updates = normalizeDanmakuShoutUpdates(
      shout.updates,
      startMs,
      endMs,
      count
    );
    const normalized: DanmakuShout = {
      id,
      text,
      startMs,
      endMs,
      count,
    };
    if (updates.length > 0) normalized.updates = updates;
    unique.set(id, normalized);
  }

  return Array.from(unique.values()).sort(
    (left, right) =>
      left.startMs - right.startMs || left.id.localeCompare(right.id)
  );
}

export function normalizeSuppressedDanmakuTexts(
  texts: readonly string[]
): string[] {
  const unique = new Set<string>();
  for (const value of texts) {
    const text = sanitizeDanmakuText(value);
    if (!text) continue;
    unique.add(text);
    if (unique.size >= MAX_SUPPRESSED_TEXTS) break;
  }
  return Array.from(unique).sort();
}

export function filterDanmakuItemsBySuppressedTexts<
  T extends Pick<DanmakuShoutSourceItem, "text" | "parts">,
>(items: readonly T[], suppressedTexts: readonly string[]): T[] {
  if (suppressedTexts.length === 0) return items.slice();
  const suppressed = new Set(suppressedTexts);
  return items.filter((item) => {
    const text = danmakuShoutText(item);
    return text === null || !suppressed.has(text);
  });
}

function appendTime(times: number[], timeMs: number) {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (times[middle] < timeMs) low = middle + 1;
    else high = middle;
  }
  times.splice(low, 0, timeMs);
}

function pruneTimes(times: number[], nowMs: number, windowMs: number) {
  const oldest = nowMs - windowMs;
  let removeCount = 0;
  while (removeCount < times.length && times[removeCount] < oldest) {
    removeCount += 1;
  }
  if (removeCount > 0) times.splice(0, removeCount);
}

export class LiveDanmakuShoutTracker {
  private readonly states = new Map<string, LiveShoutState>();

  observe(item: DanmakuShoutSourceItem) {
    const text = danmakuShoutText(item);
    const timeMs = finiteTime(item.timeMs);
    if (!text || timeMs === null) return false;

    let state = this.states.get(text);
    if (!state) {
      state = {
        text,
        recentTimes: [],
        sessionStartMs: null,
        sessionEndMs: 0,
        sessionCount: 0,
      };
      this.states.set(text, state);
    }

    appendTime(state.recentTimes, timeMs);
    pruneTimes(state.recentTimes, timeMs, DANMAKU_SHOUT_WINDOW_MS);

    if (state.sessionStartMs !== null && state.sessionEndMs > timeMs) {
      state.sessionCount += 1;
      state.sessionEndMs = timeMs + DANMAKU_SHOUT_HOLD_MS;
      return true;
    }

    if (state.recentTimes.length >= DANMAKU_SHOUT_THRESHOLD) {
      state.sessionStartMs = timeMs;
      state.sessionEndMs = timeMs + DANMAKU_SHOUT_HOLD_MS;
      state.sessionCount = state.recentTimes.length;
      return true;
    }

    state.sessionStartMs = null;
    state.sessionEndMs = 0;
    state.sessionCount = 0;
    return false;
  }

  snapshot(nowMs: number): DanmakuShoutSnapshot {
    const now = finiteTime(nowMs) ?? 0;
    const shouts: DanmakuShout[] = [];
    const suppressedTexts: string[] = [];

    for (const [text, state] of this.states) {
      pruneTimes(state.recentTimes, now, DANMAKU_SHOUT_WINDOW_MS);
      const active = state.sessionStartMs !== null && state.sessionEndMs > now;

      if (active) {
        shouts.push({
          id: `live-shout:${text}`,
          text,
          startMs: state.sessionStartMs ?? now,
          endMs: state.sessionEndMs,
          count: state.sessionCount,
        });
      }
      if (active || state.recentTimes.length >= DANMAKU_SHOUT_THRESHOLD) {
        suppressedTexts.push(text);
      }
      if (!active && state.recentTimes.length === 0) {
        this.states.delete(text);
      }
    }

    return {
      shouts: normalizeDanmakuShouts(shouts).sort(
        (left, right) =>
          right.startMs - left.startMs || left.id.localeCompare(right.id)
      ),
      suppressedTexts: normalizeSuppressedDanmakuTexts(suppressedTexts),
    };
  }

  reset() {
    this.states.clear();
  }
}

function textHash(text: string) {
  let hash = 2_166_136_261;
  for (const character of text) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function createVideoShoutState(text: string): VideoShoutState {
  return {
    text,
    count: 0,
    sessions: [],
  };
}

function observeVideoShoutTime(state: VideoShoutState, timeMs: number) {
  state.count += 1;
  if (state.count < DANMAKU_SHOUT_THRESHOLD) return;

  const session = state.sessions.at(-1);
  if (!session || timeMs >= session.endMs) {
    state.sessions.push({
      startMs: timeMs,
      endMs: timeMs + DANMAKU_SHOUT_HOLD_MS,
      initialCount: state.count,
      updates: [],
    });
    return;
  }

  session.endMs = timeMs + DANMAKU_SHOUT_HOLD_MS;
  const previousUpdate = session.updates.at(-1);
  if (previousUpdate?.timeMs === timeMs) {
    previousUpdate.count = state.count;
  } else {
    session.updates.push({ timeMs, count: state.count });
  }
}

function videoShoutsFromState(state: VideoShoutState) {
  return state.sessions.map((session): DanmakuShout => {
    const shout: DanmakuShout = {
      id: `video-shout:${textHash(state.text)}:${session.startMs}`,
      text: state.text,
      startMs: session.startMs,
      endMs: session.endMs,
      count: session.initialCount,
    };
    if (session.updates.length > 0) {
      shout.updates = session.updates.map((update) => ({ ...update }));
    }
    return shout;
  });
}

export function buildVideoDanmakuShoutSnapshot(
  items: readonly DanmakuShoutSourceItem[]
): DanmakuShoutSnapshot {
  const occurrences: Array<{ text: string; timeMs: number }> = [];
  for (const item of items) {
    const text = danmakuShoutText(item);
    const timeMs = finiteTime(item.timeMs);
    if (text && timeMs !== null) occurrences.push({ text, timeMs });
  }
  occurrences.sort(
    (left, right) =>
      left.timeMs - right.timeMs || left.text.localeCompare(right.text)
  );

  const groups = new Map<string, VideoShoutState>();
  for (const occurrence of occurrences) {
    let state = groups.get(occurrence.text);
    if (!state) {
      state = createVideoShoutState(occurrence.text);
      groups.set(occurrence.text, state);
    }
    observeVideoShoutTime(state, occurrence.timeMs);
  }

  const shouts: DanmakuShout[] = [];
  const suppressedTexts: string[] = [];

  for (const [text, state] of groups) {
    if (state.count < DANMAKU_SHOUT_THRESHOLD) continue;
    suppressedTexts.push(text);
    shouts.push(...videoShoutsFromState(state));
  }

  return {
    shouts: normalizeDanmakuShouts(shouts).sort(
      (left, right) =>
        left.startMs - right.startMs || left.id.localeCompare(right.id)
    ),
    suppressedTexts: normalizeSuppressedDanmakuTexts(suppressedTexts),
  };
}

export class VideoDanmakuShoutIndex {
  private readonly segments = new Set<number>();
  private readonly states = new Map<string, VideoShoutState>();

  hasSegment(segmentIndex: number) {
    return this.segments.has(segmentIndex);
  }

  addSegment(segment: {
    segmentIndex: number;
    items: readonly DanmakuShoutSourceItem[];
  }) {
    if (this.segments.has(segment.segmentIndex)) return false;
    this.segments.add(segment.segmentIndex);

    let changed = false;
    for (const item of segment.items) {
      const text = danmakuShoutText(item);
      const timeMs = finiteTime(item.timeMs);
      if (!text || timeMs === null) continue;

      let state = this.states.get(text);
      if (!state) {
        state = createVideoShoutState(text);
        this.states.set(text, state);
      }

      observeVideoShoutTime(state, timeMs);
      if (state.count >= DANMAKU_SHOUT_THRESHOLD) changed = true;
    }
    return changed;
  }

  snapshot() {
    const shouts: DanmakuShout[] = [];
    const suppressedTexts: string[] = [];

    for (const [text, state] of this.states) {
      if (state.count < DANMAKU_SHOUT_THRESHOLD) continue;
      suppressedTexts.push(text);
      shouts.push(...videoShoutsFromState(state));
    }

    return {
      shouts: normalizeDanmakuShouts(shouts).sort(
        (left, right) =>
          left.startMs - right.startMs || left.id.localeCompare(right.id)
      ),
      suppressedTexts: normalizeSuppressedDanmakuTexts(suppressedTexts),
    };
  }

  clear() {
    this.segments.clear();
    this.states.clear();
  }
}
