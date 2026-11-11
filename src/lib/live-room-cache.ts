import type { LiveRoomCard, LiveRoomInfo } from "@/api/live";
import type { FavoriteEntry } from "@/api/media";
import type { PlatformId } from "@/api/platforms";

const MAX_CACHED_ROOMS = 64;
const metadataCache = new Map<string, LiveRoomInfo>();

function roomKey(platformId: PlatformId, roomId: string) {
  return `${platformId}:${roomId}`;
}

function normalizeTags(tags: unknown): string[] {
  return Array.isArray(tags)
    ? tags.filter((tag): tag is string => typeof tag === "string")
    : [];
}

function cloneRoomInfo(info: LiveRoomInfo): LiveRoomInfo {
  return { ...info, tags: normalizeTags(info.tags) };
}

function mergeRoomInfo(
  primary: LiveRoomInfo,
  fallback?: LiveRoomInfo
): LiveRoomInfo {
  if (!fallback) return primary;
  const primaryTags = normalizeTags(primary.tags);
  const fallbackTags = normalizeTags(fallback.tags);
  return {
    ...fallback,
    ...primary,
    title: primary.title || fallback.title,
    anchorName: primary.anchorName || fallback.anchorName,
    coverUrl: primary.coverUrl || fallback.coverUrl,
    avatarUrl: primary.avatarUrl || fallback.avatarUrl,
    areaName: primary.areaName || fallback.areaName,
    parentAreaName: primary.parentAreaName || fallback.parentAreaName,
    tags: primaryTags.length > 0 ? primaryTags : fallbackTags,
    liveStatus:
      primary.liveStatus === "unknown"
        ? fallback.liveStatus
        : primary.liveStatus,
    anchorId: primary.anchorId ?? fallback.anchorId,
    startedAt: primary.startedAt ?? fallback.startedAt,
  };
}

function storeRoomInfo(info: LiveRoomInfo) {
  const key = roomKey(info.platform, info.roomId);
  const merged = mergeRoomInfo(info, metadataCache.get(key));
  metadataCache.delete(key);
  metadataCache.set(key, cloneRoomInfo(merged));
  while (metadataCache.size > MAX_CACHED_ROOMS) {
    const oldest = metadataCache.keys().next().value;
    if (oldest === undefined) break;
    metadataCache.delete(oldest);
  }
}

export function cachedLiveRoomInfo(
  platformId: PlatformId,
  roomId: string
): LiveRoomInfo | null {
  const info = metadataCache.get(roomKey(platformId, roomId));
  return info ? cloneRoomInfo(info) : null;
}

export function rememberLiveRoomInfo(info: LiveRoomInfo) {
  storeRoomInfo(info);
}

export function rememberLiveRoomCard(card: LiveRoomCard) {
  const fallback: LiveRoomInfo = {
    platform: card.platform,
    roomId: card.roomId,
    title: card.title,
    anchorName: card.anchorName,
    coverUrl: card.coverUrl,
    avatarUrl: card.avatarUrl,
    areaName: card.areaName,
    parentAreaName: card.parentAreaName,
    tags: [],
    liveStatus: card.liveStatus,
  };
  storeRoomInfo(fallback);
}

export function rememberFavoriteLiveRoom(entry: FavoriteEntry) {
  if (entry.target.kind !== "liveRoom") return;
  const fallback: LiveRoomInfo = {
    platform: entry.target.platform,
    roomId: entry.target.targetId,
    title: entry.title,
    anchorName: entry.ownerName ?? "",
    coverUrl: entry.coverUrl,
    avatarUrl: entry.ownerAvatarUrl,
    tags: [],
    liveStatus: "unknown",
  };
  const existing = metadataCache.get(
    roomKey(entry.target.platform, entry.target.targetId)
  );
  storeRoomInfo(existing ? mergeRoomInfo(existing, fallback) : fallback);
}
