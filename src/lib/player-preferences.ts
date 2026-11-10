export const PLAYER_PREFERENCES_KEY = "player-preferences";
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export interface PlayerPreferences {
  volume: number;
  muted: boolean;
  playbackRate: PlaybackRate;
}

export const DEFAULT_PLAYER_PREFERENCES: PlayerPreferences = {
  volume: 1,
  muted: false,
  playbackRate: 1,
};

interface StoredPlayerPreferences extends PlayerPreferences {
  version: 1;
}

function isPlaybackRate(value: unknown): value is PlaybackRate {
  return (
    typeof value === "number" &&
    (PLAYBACK_RATES as readonly number[]).includes(value)
  );
}

function normalizeVolume(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PLAYER_PREFERENCES.volume;
  }
  return Math.min(1, Math.max(0, value));
}

export function readPlayerPreferences(): PlayerPreferences {
  if (typeof window === "undefined") return { ...DEFAULT_PLAYER_PREFERENCES };

  try {
    const raw = localStorage.getItem(PLAYER_PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_PLAYER_PREFERENCES };

    const stored: unknown = JSON.parse(raw);
    if (!stored || typeof stored !== "object") {
      return { ...DEFAULT_PLAYER_PREFERENCES };
    }

    const values = stored as Partial<StoredPlayerPreferences>;
    if (values.version !== 1) return { ...DEFAULT_PLAYER_PREFERENCES };

    return {
      volume: normalizeVolume(values.volume),
      muted:
        typeof values.muted === "boolean"
          ? values.muted
          : DEFAULT_PLAYER_PREFERENCES.muted,
      playbackRate: isPlaybackRate(values.playbackRate)
        ? values.playbackRate
        : DEFAULT_PLAYER_PREFERENCES.playbackRate,
    };
  } catch {
    return { ...DEFAULT_PLAYER_PREFERENCES };
  }
}

export function savePlayerPreferences(preferences: PlayerPreferences) {
  if (typeof window === "undefined") return;

  const stored: StoredPlayerPreferences = {
    version: 1,
    volume: normalizeVolume(preferences.volume),
    muted: preferences.muted,
    playbackRate: preferences.playbackRate,
  };

  try {
    localStorage.setItem(PLAYER_PREFERENCES_KEY, JSON.stringify(stored));
  } catch {
    // Persistence is best-effort when storage is unavailable.
  }
}
