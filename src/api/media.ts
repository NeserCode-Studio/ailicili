import { invoke } from "@tauri-apps/api/core";

export type StreamProtocol = "hls" | "flv" | "dash" | "mp4";
export type PlatformId = string;
export type VideoSourceKind =
  | "popular"
  | "recommend"
  | "region"
  | "search"
  | "related"
  | "detail"
  | "history";

export interface OwnerInfo {
  id: number;
  name: string;
  avatarUrl?: string;
}

export interface VideoStats {
  view: number;
  like: number;
  danmaku: number;
}

export interface VideoCard {
  platform: PlatformId;
  videoId: string;
  title: string;
  coverUrl?: string;
  duration?: number;
  publishedAt?: number;
  owner?: OwnerInfo;
  stats: VideoStats;
  cid?: number;
  sourceKind: VideoSourceKind;
}

export interface PagedVideos {
  page: number;
  items: VideoCard[];
  hasMore: boolean;
  nextCursor?: string;
  fallback?: boolean;
}

export interface StreamSource {
  id: string;
  protocol: StreamProtocol;
  url: string;
  backupUrls?: string[];
  qualityId: number;
  qualityLabel: string;
  audioUrl?: string;
  audioBackupUrls?: string[];
  codec?: string;
  audioCodec?: string;
}

export interface QualityOption {
  id: number;
  label: string;
}

export type QualityNoticeKind =
  | "none"
  | "loginRequired"
  | "accountExpired"
  | "qualityUnavailable"
  | "riskControl";

export interface QualityNotice {
  kind: QualityNoticeKind;
  messageCode: string;
}

export interface PlaybackInfo {
  videoId: string;
  cid: number;
  durationMs: number;
  streams: StreamSource[];
  currentQuality: QualityOption;
  advertisedQualities: QualityOption[];
  qualityNotice: QualityNotice;
}

export interface VideoPage {
  pageIndex: number;
  cid: number;
  title: string;
  duration?: number;
}

export interface VideoDetail {
  card: VideoCard;
  aid: number;
  description: string;
  pages: VideoPage[];
}

export interface HistoryEntry {
  card: VideoCard;
  pageCid: number;
  pageTitle: string;
  progressSeconds: number;
  durationSeconds: number;
  updatedAt: number;
}

export type FavoriteKind = "video" | "liveRoom";

export interface FavoriteTarget {
  platform: PlatformId;
  kind: FavoriteKind;
  targetId: string;
}

export interface FavoriteDraft {
  target: FavoriteTarget;
  title: string;
  coverUrl?: string;
  ownerName?: string;
  ownerAvatarUrl?: string;
}

export interface FavoriteEntry extends FavoriteDraft {
  savedAt: number;
}

export async function getPopularVideos(page = 1): Promise<PagedVideos> {
  return invoke("get_popular_videos", { page });
}

export async function getRecommendedVideos(page = 1): Promise<PagedVideos> {
  return invoke("get_recommended_videos", { page });
}

export async function getRegionVideos(
  regionId: number,
  page = 1
): Promise<PagedVideos> {
  return invoke("get_region_videos", { regionId, page });
}

export async function getVideoPlayback(
  videoId: string,
  cid: number,
  quality = 127
): Promise<PlaybackInfo> {
  return invoke("get_video_playback", { videoId, cid, quality });
}

export async function getVideoDetail(videoId: string): Promise<VideoDetail> {
  return invoke("get_video_detail", { videoId });
}

export async function searchVideos(
  keyword: string,
  page = 1
): Promise<PagedVideos> {
  return invoke("get_search_videos", { keyword, page });
}

export async function listLocalHistory(): Promise<HistoryEntry[]> {
  return invoke("list_local_history");
}

export async function saveLocalHistory(
  detail: VideoDetail,
  pageCid: number,
  pageTitle: string,
  progressSeconds: number,
  durationSeconds: number
): Promise<HistoryEntry[]> {
  return invoke("save_local_history", {
    detail,
    pageCid,
    pageTitle,
    progressSeconds,
    durationSeconds,
  });
}

export async function clearLocalHistory(): Promise<HistoryEntry[]> {
  return invoke("clear_local_history");
}

export async function removeLocalHistory(
  platform: PlatformId,
  videoId: string
): Promise<HistoryEntry[]> {
  return invoke("remove_local_history", { platform, videoId });
}

export async function listLocalFavorites(): Promise<FavoriteEntry[]> {
  return invoke("list_local_favorites");
}

export async function addLocalFavorite(
  favorite: FavoriteDraft
): Promise<FavoriteEntry[]> {
  return invoke("add_local_favorite", { favorite });
}

export async function removeLocalFavorite(
  target: FavoriteTarget
): Promise<FavoriteEntry[]> {
  return invoke("remove_local_favorite", { target });
}
