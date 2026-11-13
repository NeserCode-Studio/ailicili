import { useSyncExternalStore } from "react";

import type { DanmakuRenderStyle } from "@/lib/danmaku/types";

export const DANMAKU_PREFERENCES_KEY = "danmaku-preferences";
export const DANMAKU_OPACITY_MIN = 0.2;
export const DANMAKU_OPACITY_MAX = 1;
export const DANMAKU_SCALE_MIN = 0.75;
export const DANMAKU_SCALE_MAX = 1.5;
export const DANMAKU_DISPLAY_AREA_MIN = 0.25;
export const DANMAKU_DISPLAY_AREA_MAX = 1;
export const DANMAKU_SPEED_MIN = 0.5;
export const DANMAKU_SPEED_MAX = 2;

export type DanmakuFontFamily = "default" | "hei" | "song";
export type DanmakuStrokeType = "heavy" | "outline" | "projection";

export interface DanmakuPreferences {
  enabled: boolean;
  opacity: number;
  scale: number;
  displayArea: number;
  speed: number;
  showScroll: boolean;
  showFixed: boolean;
  showColor: boolean;
  syncPlaybackRate: boolean;
  scaleWithPlayer: boolean;
  avoidSubtitles: boolean;
  fontFamily: DanmakuFontFamily;
  bold: boolean;
  strokeType: DanmakuStrokeType;
}

export const DEFAULT_DANMAKU_PREFERENCES: DanmakuPreferences = {
  enabled: true,
  opacity: 1,
  scale: 1,
  displayArea: 1,
  speed: 1,
  showScroll: true,
  showFixed: true,
  showColor: true,
  syncPlaybackRate: true,
  scaleWithPlayer: false,
  avoidSubtitles: false,
  fontFamily: "default",
  bold: true,
  strokeType: "heavy",
};

interface StoredDanmakuPreferences extends DanmakuPreferences {
  version: 1;
}

const listeners = new Set<() => void>();
let currentPreferences: DanmakuPreferences | null = null;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return clamp(value, minimum, maximum);
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeFontFamily(value: unknown): DanmakuFontFamily {
  return value === "hei" || value === "song" ? value : "default";
}

function normalizeStrokeType(value: unknown): DanmakuStrokeType {
  return value === "outline" || value === "projection" ? value : "heavy";
}

export function normalizeDanmakuPreferences(
  value: unknown
): DanmakuPreferences {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_DANMAKU_PREFERENCES };
  }

  const stored = value as Partial<StoredDanmakuPreferences>;
  return {
    enabled:
      typeof stored.enabled === "boolean"
        ? stored.enabled
        : DEFAULT_DANMAKU_PREFERENCES.enabled,
    opacity: normalizeNumber(
      stored.opacity,
      DEFAULT_DANMAKU_PREFERENCES.opacity,
      DANMAKU_OPACITY_MIN,
      DANMAKU_OPACITY_MAX
    ),
    scale: normalizeNumber(
      stored.scale,
      DEFAULT_DANMAKU_PREFERENCES.scale,
      DANMAKU_SCALE_MIN,
      DANMAKU_SCALE_MAX
    ),
    displayArea: normalizeNumber(
      stored.displayArea,
      DEFAULT_DANMAKU_PREFERENCES.displayArea,
      DANMAKU_DISPLAY_AREA_MIN,
      DANMAKU_DISPLAY_AREA_MAX
    ),
    speed: normalizeNumber(
      stored.speed,
      DEFAULT_DANMAKU_PREFERENCES.speed,
      DANMAKU_SPEED_MIN,
      DANMAKU_SPEED_MAX
    ),
    showScroll: normalizeBoolean(
      stored.showScroll,
      DEFAULT_DANMAKU_PREFERENCES.showScroll
    ),
    showFixed: normalizeBoolean(
      stored.showFixed,
      DEFAULT_DANMAKU_PREFERENCES.showFixed
    ),
    showColor: normalizeBoolean(
      stored.showColor,
      DEFAULT_DANMAKU_PREFERENCES.showColor
    ),
    syncPlaybackRate: normalizeBoolean(
      stored.syncPlaybackRate,
      DEFAULT_DANMAKU_PREFERENCES.syncPlaybackRate
    ),
    scaleWithPlayer: normalizeBoolean(
      stored.scaleWithPlayer,
      DEFAULT_DANMAKU_PREFERENCES.scaleWithPlayer
    ),
    avoidSubtitles: normalizeBoolean(
      stored.avoidSubtitles,
      DEFAULT_DANMAKU_PREFERENCES.avoidSubtitles
    ),
    fontFamily: normalizeFontFamily(stored.fontFamily),
    bold: normalizeBoolean(stored.bold, DEFAULT_DANMAKU_PREFERENCES.bold),
    strokeType: normalizeStrokeType(stored.strokeType),
  };
}

const FONT_FAMILIES: Record<DanmakuFontFamily, string> = {
  default: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
  hei: '"SimHei", "Microsoft YaHei", "PingFang SC", sans-serif',
  song: '"SimSun", "Songti SC", "Noto Serif SC", serif',
};

const STROKE_STYLES: Record<
  DanmakuStrokeType,
  Pick<
    DanmakuRenderStyle,
    | "strokeColor"
    | "strokeWidth"
    | "shadowColor"
    | "shadowBlur"
    | "shadowOffsetX"
    | "shadowOffsetY"
  >
> = {
  heavy: {
    strokeColor: "rgba(0, 0, 0, 0.82)",
    strokeWidth: 1.5,
    shadowColor: "rgba(0, 0, 0, 0.55)",
    shadowBlur: 2,
    shadowOffsetX: 0,
    shadowOffsetY: 1,
  },
  outline: {
    strokeColor: "rgba(0, 0, 0, 0.9)",
    strokeWidth: 2,
    shadowColor: "transparent",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  },
  projection: {
    strokeColor: "transparent",
    strokeWidth: 0,
    shadowColor: "rgba(0, 0, 0, 0.72)",
    shadowBlur: 0,
    shadowOffsetX: 2,
    shadowOffsetY: 2,
  },
};

export function resolveDanmakuPreferencesStyle(
  preferences: DanmakuPreferences,
  playbackRate = 1
): Partial<DanmakuRenderStyle> {
  const rate = clamp(
    Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1,
    0.25,
    4
  );
  const speed = clamp(preferences.speed, DANMAKU_SPEED_MIN, DANMAKU_SPEED_MAX);
  const playbackCompensation = preferences.syncPlaybackRate ? 1 : rate;

  return {
    opacity: preferences.opacity,
    scale: preferences.scale,
    displayArea: preferences.displayArea,
    showScroll: preferences.showScroll,
    showFixed: preferences.showFixed,
    showColor: preferences.showColor,
    scaleWithPlayer: preferences.scaleWithPlayer,
    avoidSubtitles: preferences.avoidSubtitles,
    fontFamily: FONT_FAMILIES[preferences.fontFamily],
    fontWeight: preferences.bold ? 700 : 400,
    scrollSpeedPxPerSecond: (220 * speed) / playbackCompensation,
    fixedDurationMs: (4_500 / speed) * playbackCompensation,
    ...STROKE_STYLES[preferences.strokeType],
  };
}

export function getDanmakuPreferences(): DanmakuPreferences {
  if (currentPreferences) return currentPreferences;
  if (typeof window === "undefined") {
    return DEFAULT_DANMAKU_PREFERENCES;
  }

  try {
    const raw = localStorage.getItem(DANMAKU_PREFERENCES_KEY);
    if (!raw) {
      currentPreferences = DEFAULT_DANMAKU_PREFERENCES;
      return currentPreferences;
    }

    const stored: unknown = JSON.parse(raw);
    if (!stored || typeof stored !== "object") {
      currentPreferences = DEFAULT_DANMAKU_PREFERENCES;
      return currentPreferences;
    }

    const values = stored as Partial<StoredDanmakuPreferences>;
    currentPreferences =
      values.version === 1
        ? normalizeDanmakuPreferences(values)
        : { ...DEFAULT_DANMAKU_PREFERENCES };
  } catch {
    currentPreferences = DEFAULT_DANMAKU_PREFERENCES;
  }

  return currentPreferences;
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function saveDanmakuPreferences(preferences: DanmakuPreferences) {
  const normalized = normalizeDanmakuPreferences(preferences);
  currentPreferences = normalized;

  if (typeof window !== "undefined") {
    const stored: StoredDanmakuPreferences = {
      version: 1,
      ...normalized,
    };
    try {
      localStorage.setItem(DANMAKU_PREFERENCES_KEY, JSON.stringify(stored));
    } catch {
      // Keep the in-memory preference so the current session still updates.
    }
  }

  notify();
}

export function updateDanmakuPreferences(
  patch: Partial<DanmakuPreferences>
): DanmakuPreferences {
  const next = normalizeDanmakuPreferences({
    ...getDanmakuPreferences(),
    ...patch,
  });
  saveDanmakuPreferences(next);
  return next;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (typeof window === "undefined") {
    return () => listeners.delete(listener);
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== DANMAKU_PREFERENCES_KEY && event.key !== null) return;
    currentPreferences = null;
    listener();
  };
  window.addEventListener("storage", handleStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function useDanmakuPreferences(): DanmakuPreferences {
  return useSyncExternalStore(
    subscribe,
    getDanmakuPreferences,
    () => DEFAULT_DANMAKU_PREFERENCES
  );
}
