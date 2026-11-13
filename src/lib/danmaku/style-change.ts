import type { DanmakuRenderStyle } from "@/lib/danmaku/types";

export interface DanmakuStyleChange {
  changed: boolean;
  reflow: boolean;
  visibility: boolean;
  motion: boolean;
}

const STYLE_KEYS = [
  "fontFamily",
  "fontWeight",
  "fontStyle",
  "baseFontSize",
  "scale",
  "scaleWithPlayer",
  "displayArea",
  "avoidSubtitles",
  "opacity",
  "scrollSpeedPxPerSecond",
  "strokeColor",
  "strokeWidth",
  "shadowColor",
  "shadowBlur",
  "shadowOffsetX",
  "shadowOffsetY",
  "fixedDurationMs",
  "trackGap",
  "edgePadding",
  "maxOnScreen",
  "maxTracks",
  "maxDpr",
  "canvasPixelBudget",
  "texturePixelBudget",
  "maxTextWidthRatio",
  "showScroll",
  "showFixed",
  "showColor",
] as const satisfies readonly (keyof DanmakuRenderStyle)[];

const REFLOW_KEYS = [
  "baseFontSize",
  "scale",
  "displayArea",
  "avoidSubtitles",
  "trackGap",
  "edgePadding",
  "maxTracks",
] as const satisfies readonly (keyof DanmakuRenderStyle)[];

const VISIBILITY_KEYS = [
  "showScroll",
  "showFixed",
  "showColor",
] as const satisfies readonly (keyof DanmakuRenderStyle)[];

const MOTION_KEYS = [
  "edgePadding",
] as const satisfies readonly (keyof DanmakuRenderStyle)[];

function styleKeysChanged(
  previous: DanmakuRenderStyle,
  next: DanmakuRenderStyle,
  keys: readonly (keyof DanmakuRenderStyle)[]
) {
  return keys.some((key) => previous[key] !== next[key]);
}

export function resolveDanmakuStyleChange(
  previous: DanmakuRenderStyle,
  next: DanmakuRenderStyle
): DanmakuStyleChange {
  return {
    changed: styleKeysChanged(previous, next, STYLE_KEYS),
    reflow: styleKeysChanged(previous, next, REFLOW_KEYS),
    visibility: styleKeysChanged(previous, next, VISIBILITY_KEYS),
    motion: styleKeysChanged(previous, next, MOTION_KEYS),
  };
}

export function resolveDanmakuLayoutStyle(
  snapshot: DanmakuRenderStyle,
  current: DanmakuRenderStyle
) {
  if (
    snapshot.edgePadding === current.edgePadding &&
    snapshot.trackGap === current.trackGap
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    edgePadding: current.edgePadding,
    trackGap: current.trackGap,
  };
}
