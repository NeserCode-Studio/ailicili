import type {
  DanmakuEmote,
  DanmakuMode,
  DanmakuRenderStyle,
} from "@/lib/danmaku/types";

const DANMAKU_TRACK_LINE_HEIGHT = 1.2;
const DANMAKU_EMOTE_MAX_TRACK_RATIO = 1.15;
const DANMAKU_SUBTITLE_SAFE_AREA = 0.2;

export interface DanmakuMotionItem {
  id: string;
  mode: DanmakuMode;
  width: number;
  height: number;
  startMs: number;
  durationMs: number;
  lane: number;
}

export interface DanmakuLaneCandidate {
  mode: DanmakuMode;
  width: number;
  startMs: number;
  durationMs: number;
}

export interface DanmakuLaneRange {
  start: number;
  end: number;
  step: 1 | -1;
}

export function resolveDanmakuLaneHeight(style: DanmakuRenderStyle) {
  const fontSize = style.baseFontSize * style.scale;
  return Math.max(
    1,
    Math.ceil(fontSize * DANMAKU_TRACK_LINE_HEIGHT + style.trackGap)
  );
}

export function resolveDanmakuDisplayHeight(
  viewportHeight: number,
  style: DanmakuRenderStyle
) {
  const height = Math.max(
    0,
    Number.isFinite(viewportHeight) ? viewportHeight : 0
  );
  const subtitleReserve = style.avoidSubtitles ? DANMAKU_SUBTITLE_SAFE_AREA : 0;
  const visibleRatio = Math.max(
    0.1,
    Math.min(style.displayArea, 1 - subtitleReserve)
  );
  return Math.max(1, height * visibleRatio);
}

export function resolveDanmakuEmoteDisplaySize(
  emote: DanmakuEmote,
  fontSize: number,
  style: DanmakuRenderStyle
) {
  const laneHeight = resolveDanmakuLaneHeight(style);
  const maximumHeight = laneHeight * DANMAKU_EMOTE_MAX_TRACK_RATIO;
  const minimumHeight = Math.min(maximumHeight, fontSize * 0.8);
  const targetHeight = Math.min(emote.height * style.scale, laneHeight);
  const height = Math.min(maximumHeight, Math.max(minimumHeight, targetHeight));
  const aspectRatio = emote.width / emote.height;
  return {
    width: Math.max(1, height * aspectRatio),
    height: Math.max(1, height),
  };
}

export function resolveDanmakuLaneRange(
  mode: DanmakuMode,
  trackCount: number
): DanmakuLaneRange {
  const tracks = Math.max(0, Math.floor(trackCount));
  if (tracks === 0) return { start: 0, end: -1, step: 1 };
  if (mode === "bottom") return { start: tracks - 1, end: 0, step: -1 };
  return { start: 0, end: tracks - 1, step: 1 };
}

export function resolveDanmakuScrollDurationMs(
  viewportWidth: number,
  edgePadding: number,
  baseSpeedPxPerSecond: number
) {
  const travelWidth = Math.max(1, viewportWidth + edgePadding * 2);
  const speed = Math.max(1, baseSpeedPxPerSecond);
  return (travelWidth / speed) * 1_000;
}

export function resolveDanmakuScrollX(
  item: Pick<DanmakuMotionItem, "startMs" | "durationMs" | "width">,
  timeMs: number,
  viewportWidth: number,
  edgePadding: number
) {
  const startX = viewportWidth + edgePadding;
  const travelWidth = viewportWidth + item.width + edgePadding * 2;
  const durationMs = Math.max(1, item.durationMs);
  const progress = Math.max(
    0,
    Math.min(1, (timeMs - item.startMs) / durationMs)
  );
  return startX - travelWidth * progress;
}

function laneIsAvailable(
  active: readonly DanmakuMotionItem[],
  candidate: DanmakuLaneCandidate,
  lane: number,
  viewportWidth: number,
  edgePadding: number,
  trackGap: number
) {
  const candidateEnd = candidate.startMs + candidate.durationMs;
  const entryX = viewportWidth + edgePadding;

  for (const item of active) {
    // Modes share the display area but keep independent collision domains.
    if (item.mode !== candidate.mode || item.lane !== lane) continue;

    const itemDurationMs = Math.max(1, item.durationMs);
    const itemEnd = item.startMs + itemDurationMs;
    if (itemEnd <= candidate.startMs) continue;

    if (candidate.mode === "scroll" && item.mode === "scroll") {
      if (item.startMs > candidate.startMs) return false;

      const previousRight =
        resolveDanmakuScrollX(
          item,
          candidate.startMs,
          viewportWidth,
          edgePadding
        ) + item.width;
      if (previousRight + trackGap > entryX) return false;

      const candidateSpeed =
        (viewportWidth + candidate.width + edgePadding * 2) /
        Math.max(1, candidate.durationMs);
      const previousSpeed =
        (viewportWidth + item.width + edgePadding * 2) / itemDurationMs;
      if (candidateSpeed > previousSpeed) {
        const closingDistance = Math.max(0, entryX - previousRight - trackGap);
        const closingTimeMs =
          closingDistance / (candidateSpeed - previousSpeed);
        const previousRemainingMs = itemEnd - candidate.startMs;
        if (closingTimeMs < previousRemainingMs) return false;
      }
      continue;
    }

    if (item.startMs < candidateEnd && itemEnd > candidate.startMs) {
      return false;
    }
  }

  return true;
}

export function chooseDanmakuLane(
  active: readonly DanmakuMotionItem[],
  candidate: DanmakuLaneCandidate,
  viewportWidth: number,
  edgePadding: number,
  trackGap: number,
  trackCount: number
) {
  if (trackCount <= 0) return null;

  const range = resolveDanmakuLaneRange(candidate.mode, trackCount);
  for (
    let lane = range.start;
    range.step > 0 ? lane <= range.end : lane >= range.end;
    lane += range.step
  ) {
    if (
      laneIsAvailable(
        active,
        candidate,
        lane,
        viewportWidth,
        edgePadding,
        trackGap
      )
    ) {
      return lane;
    }
  }

  return null;
}

export function removeExpiredDanmaku(
  active: DanmakuMotionItem[],
  timeMs: number
) {
  for (let index = active.length - 1; index >= 0; index -= 1) {
    const item = active[index];
    if (item.startMs + item.durationMs <= timeMs) active.splice(index, 1);
  }
}
