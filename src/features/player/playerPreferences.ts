import type {
  DanmakuFontWeight,
  DanmakuSettings,
} from "@/features/danmaku/DanmakuCanvas";
import type { DanmakuMode } from "@/shared/bili.types";

const PREFERENCES_KEY = "ailicili:player-preferences";
const DANMAKU_MODES: DanmakuMode[] = [1, 4, 5];
const FONT_WEIGHTS: DanmakuFontWeight[] = [400, 500, 600, 700];

export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export interface PlayerPreferences {
  speed: number;
  quality: string;
  autoPlay: boolean;
  autoLike: boolean;
  autoFitWindow: boolean;
  autoHideControls: boolean;
  syncProgress: boolean;
  resumeProgress: boolean;
  fastSwitchEnabled: boolean;
  danmaku: DanmakuSettings;
}

export function createDefaultPlayerPreferences(): PlayerPreferences {
  return {
    speed: 1,
    quality: "auto",
    autoPlay: true,
    autoLike: false,
    autoFitWindow: true,
    autoHideControls: true,
    syncProgress: true,
    resumeProgress: true,
    fastSwitchEnabled: true,
    danmaku: {
      enabled: true,
      opacity: 0.9,
      fontScale: 1,
      area: 0.55,
      speed: 1,
      modes: [...DANMAKU_MODES],
      density: 100,
      outlineWidth: 2,
      fontWeight: 600,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function booleanOr(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function numberInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number
) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function readPlayerPreferences(): PlayerPreferences {
  const defaults = createDefaultPlayerPreferences();

  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(PREFERENCES_KEY) ?? "null"
    );
    if (!isRecord(parsed)) return defaults;

    const danmaku = isRecord(parsed.danmaku) ? parsed.danmaku : {};
    const storedModes = danmaku.modes;
    const modes = Array.isArray(storedModes)
      ? DANMAKU_MODES.filter((mode) => storedModes.includes(mode))
      : defaults.danmaku.modes;
    const speed = PLAYBACK_SPEEDS.find((value) => value === parsed.speed);
    const fontWeight = FONT_WEIGHTS.find(
      (value) => value === danmaku.fontWeight
    );

    return {
      speed: speed ?? defaults.speed,
      quality:
        typeof parsed.quality === "string" && parsed.quality
          ? parsed.quality
          : defaults.quality,
      autoPlay: booleanOr(parsed.autoPlay, defaults.autoPlay),
      autoLike: booleanOr(parsed.autoLike, defaults.autoLike),
      autoFitWindow: booleanOr(parsed.autoFitWindow, defaults.autoFitWindow),
      autoHideControls: booleanOr(
        parsed.autoHideControls,
        defaults.autoHideControls
      ),
      syncProgress: booleanOr(parsed.syncProgress, defaults.syncProgress),
      resumeProgress: booleanOr(parsed.resumeProgress, defaults.resumeProgress),
      fastSwitchEnabled: booleanOr(
        parsed.fastSwitchEnabled,
        defaults.fastSwitchEnabled
      ),
      danmaku: {
        enabled: booleanOr(danmaku.enabled, defaults.danmaku.enabled),
        opacity: numberInRange(
          danmaku.opacity,
          defaults.danmaku.opacity,
          0.2,
          1
        ),
        fontScale: numberInRange(
          danmaku.fontScale,
          defaults.danmaku.fontScale,
          0.7,
          1.5
        ),
        area: numberInRange(danmaku.area, defaults.danmaku.area, 0.2, 1),
        speed: numberInRange(danmaku.speed, defaults.danmaku.speed, 0.5, 2),
        modes: modes.length > 0 ? modes : defaults.danmaku.modes,
        density: Math.round(
          numberInRange(danmaku.density, defaults.danmaku.density, 10, 100)
        ),
        outlineWidth: numberInRange(
          danmaku.outlineWidth,
          defaults.danmaku.outlineWidth,
          0,
          4
        ),
        fontWeight: fontWeight ?? defaults.danmaku.fontWeight,
      },
    };
  } catch {
    return defaults;
  }
}

export function savePlayerPreferences(preferences: PlayerPreferences) {
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Player preferences are optional when storage is unavailable.
  }
}
