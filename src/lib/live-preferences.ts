import type { PlatformId } from "@/api/platforms";

export const LIVE_SELECTED_PLATFORM_KEY = "live-selected-platform";

export function getSelectedLivePlatformId(): PlatformId | null {
  if (typeof window === "undefined") return null;
  try {
    const value = localStorage.getItem(LIVE_SELECTED_PLATFORM_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function setSelectedLivePlatformId(platformId: PlatformId | null) {
  if (typeof window === "undefined") return;
  try {
    if (platformId) {
      localStorage.setItem(LIVE_SELECTED_PLATFORM_KEY, platformId);
    } else {
      localStorage.removeItem(LIVE_SELECTED_PLATFORM_KEY);
    }
  } catch {
    // Persistence is best-effort when storage is unavailable.
  }
}
