import { invoke } from "@tauri-apps/api/core";

export type StreamProtocol = "hls" | "flv" | "dash" | "mp4";

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
  videoId: string;
  title: string;
  coverUrl?: string;
  duration?: number;
  publishedAt?: number;
  owner?: OwnerInfo;
  stats: VideoStats;
  cid?: number;
  sourceKind: string;
}

export interface PagedVideos {
  page: number;
  items: VideoCard[];
  hasMore: boolean;
}

export interface StreamSource {
  id: string;
  protocol: StreamProtocol;
  url: string;
  qualityId: number;
  qualityLabel: string;
  audioUrl?: string;
  codec?: string;
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

export async function getPopularVideos(page = 1): Promise<PagedVideos> {
  return invoke("get_popular_videos", { page });
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
