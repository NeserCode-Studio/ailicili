import type {
  FavoriteEntry,
  FavoriteTarget,
  HistoryEntry,
  VideoCard,
} from "@/api/media";
import type { PlatformId } from "@/api/platforms";
import { historyResumeSeconds } from "@/lib/history";
import { liveRoomPath } from "@/lib/live-routes";

export function favoriteTargetForVideo(video: VideoCard): FavoriteTarget {
  return {
    platform: video.platform,
    kind: "video",
    targetId: video.videoId,
  };
}

export function favoriteTargetForLiveRoom(
  platform: PlatformId,
  roomId: string
): FavoriteTarget {
  return {
    platform,
    kind: "liveRoom",
    targetId: roomId,
  };
}

export function favoriteTargetKey(target: FavoriteTarget): string {
  return `${target.platform}:${target.kind}:${target.targetId}`;
}

export function favoriteMatches(
  entry: FavoriteEntry,
  target: FavoriteTarget
): boolean {
  return favoriteTargetKey(entry.target) === favoriteTargetKey(target);
}

export function favoriteVideoPath(entry: FavoriteEntry): string {
  return `/video/${encodeURIComponent(entry.target.targetId)}?from=favorites`;
}

export function favoriteLiveRoomPath(entry: FavoriteEntry): string {
  return `${liveRoomPath(entry.target.platform, entry.target.targetId)}?from=favorites`;
}

export function favoriteEntryPath(entry: FavoriteEntry): string {
  return entry.target.kind === "liveRoom"
    ? favoriteLiveRoomPath(entry)
    : favoriteVideoPath(entry);
}

export function historyResumePath(entry: HistoryEntry): string {
  const params = new URLSearchParams({
    cid: String(entry.pageCid),
    t: String(historyResumeSeconds(entry)),
    from: "history",
  });
  return `/video/${encodeURIComponent(entry.card.videoId)}?${params.toString()}`;
}
