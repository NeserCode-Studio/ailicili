import type {
  FavoriteEntry,
  FavoriteTarget,
  HistoryEntry,
  VideoCard,
} from "@/api/media";

export function favoriteTargetForVideo(video: VideoCard): FavoriteTarget {
  return {
    platform: video.platform,
    kind: "video",
    targetId: video.videoId,
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

export function historyResumePath(entry: HistoryEntry): string {
  const params = new URLSearchParams({
    cid: String(entry.pageCid),
    t: String(entry.progressSeconds),
    from: "history",
  });
  return `/video/${encodeURIComponent(entry.card.videoId)}?${params.toString()}`;
}
