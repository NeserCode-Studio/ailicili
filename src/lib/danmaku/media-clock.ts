export const DANMAKU_MEDIA_TIME_TOLERANCE_MS = 650;
export const DANMAKU_MEDIA_SYNC_INTERVAL_MS = 100;

export type DanmakuMediaTimeAction = "rebuild" | "resync" | "sync";

export interface DanmakuMediaClockSource {
  read: () => number;
  subscribe: (listener: () => void) => () => void;
}

interface VideoClockStore {
  state: Readonly<Record<string, unknown>>;
  subscribe: (listener: () => void) => () => void;
}

export function quantizeDanmakuMediaTimeMs(timeMs: number) {
  const normalized = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
  return (
    Math.floor(normalized / DANMAKU_MEDIA_SYNC_INTERVAL_MS) *
    DANMAKU_MEDIA_SYNC_INTERVAL_MS
  );
}

export function quantizeDanmakuMediaTimeSeconds(timeSeconds: number) {
  const timeMs = Number.isFinite(timeSeconds) ? timeSeconds * 1_000 : 0;
  return quantizeDanmakuMediaTimeMs(timeMs) / 1_000;
}

export function createVideoDanmakuClockSource(
  store: VideoClockStore
): DanmakuMediaClockSource {
  const read = () => {
    const timeSeconds = store.state.currentTime;
    return typeof timeSeconds === "number" && Number.isFinite(timeSeconds)
      ? Math.max(0, timeSeconds * 1_000)
      : 0;
  };

  return {
    read,
    subscribe: (listener) => {
      let lastPublishedBucket = Math.floor(
        read() / DANMAKU_MEDIA_SYNC_INTERVAL_MS
      );
      return store.subscribe(() => {
        const bucket = Math.floor(read() / DANMAKU_MEDIA_SYNC_INTERVAL_MS);
        if (bucket === lastPublishedBucket) return;
        lastPublishedBucket = bucket;
        listener();
      });
    },
  };
}

export function resolveDanmakuMediaTimeAction({
  initialized,
  clockMs,
  mediaTimeMs,
  forceRebuild = false,
}: {
  initialized: boolean;
  clockMs: number;
  mediaTimeMs: number;
  forceRebuild?: boolean;
}): DanmakuMediaTimeAction {
  if (!initialized || forceRebuild) return "rebuild";

  const normalizedClock = Number.isFinite(clockMs) ? Math.max(0, clockMs) : 0;
  const normalizedMediaTime = Number.isFinite(mediaTimeMs)
    ? Math.max(0, mediaTimeMs)
    : 0;
  const deltaMs = normalizedMediaTime - normalizedClock;

  if (Math.abs(deltaMs) > DANMAKU_MEDIA_TIME_TOLERANCE_MS) return "resync";
  return "sync";
}

export function resolveSyncedDanmakuClockMs(
  clockMs: number,
  mediaTimeMs: number
) {
  const normalizedClock = Number.isFinite(clockMs) ? Math.max(0, clockMs) : 0;
  const normalizedMediaTime = Number.isFinite(mediaTimeMs)
    ? Math.max(0, mediaTimeMs)
    : 0;
  return Math.max(normalizedClock, normalizedMediaTime);
}
