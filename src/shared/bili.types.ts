export interface VideoAuthor {
  mid: number;
  name: string;
  avatarUrl: string;
}

export interface VideoStats {
  views: number;
  danmaku: number;
  likes: number;
  comments: number;
}

export interface VideoSummary {
  aid: number;
  bvid: string;
  cid: number | null;
  title: string;
  coverUrl: string;
  author: VideoAuthor;
  stats: VideoStats;
  durationSeconds: number;
  publishedAt: number;
  category: string | null;
  recommendationReason: string | null;
}

export interface PopularPage {
  videos: VideoSummary[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface VideoPart {
  cid: number;
  page: number;
  title: string;
  durationSeconds: number;
}

export interface VideoDimension {
  width: number;
  height: number;
  rotate: number;
}

export interface VideoDetail {
  video: VideoSummary;
  description: string;
  parts: VideoPart[];
  dimension: VideoDimension | null;
}

export interface BiliCommandError {
  code: string;
  message: string;
}

export interface AccountProfile {
  mid: string;
  name: string;
  avatarUrl: string;
  level: number;
  vipStatus: boolean;
  vipLabel: string | null;
}

export interface AuthStatus {
  authenticated: boolean;
  storageAvailable: boolean;
  profile: AccountProfile | null;
}

export interface QrLoginStart {
  attemptId: string;
  qrSvg: string;
  expiresInSeconds: number;
}

export type QrLoginState = "waiting" | "scanned" | "confirmed" | "expired";

export interface QrLoginPoll {
  state: QrLoginState;
  profile: AccountProfile | null;
}

export type SearchKind = "video" | "user" | "pgc" | "live";

export interface SearchVideoItem {
  kind: "video";
  bvid: string;
  title: string;
  coverUrl: string;
  author: string;
  durationSeconds: number;
  views: number;
  publishedAt: number | null;
}

export interface SearchUserItem {
  kind: "user";
  mid: string;
  name: string;
  avatarUrl: string;
  bio: string;
  followers: number;
  videos: number;
  level: number;
  targetUrl: string;
}

export interface SearchPgcItem {
  kind: "pgc";
  seasonId: string;
  title: string;
  coverUrl: string;
  subtitle: string;
  description: string;
  score: number | null;
  targetUrl: string;
}

export interface SearchLiveItem {
  kind: "live";
  roomId: string;
  title: string;
  coverUrl: string;
  anchorName: string;
  anchorAvatarUrl: string;
  areaName: string;
  online: number;
  targetUrl: string;
}

export type SearchItem =
  SearchVideoItem | SearchUserItem | SearchPgcItem | SearchLiveItem;

export interface SearchPage {
  query: string;
  kind: SearchKind;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  items: SearchItem[];
}

export interface SearchSuggestion {
  value: string;
  label: string;
}

export interface PlaybackQuality {
  id: number;
  label: string;
  width: number;
  height: number;
  bandwidth: number;
}

export interface PlaybackSession {
  sessionId: string;
  mpdUrl: string;
  expiresInSeconds: number;
  durationMs: number;
  selectedQuality: number;
  qualities: PlaybackQuality[];
}

export type DanmakuMode = 1 | 4 | 5;

export interface DanmakuItem {
  progressMs: number;
  mode: DanmakuMode;
  size: number;
  color: number;
  text: string;
}

export interface CommentAuthor {
  mid: string;
  name: string;
  avatarUrl: string;
}

export interface CommentEmote {
  key: string;
  url: string;
  width: number;
  height: number;
}

export interface CommentItem {
  id: string;
  author: CommentAuthor;
  message: string;
  emotes: CommentEmote[];
  likes: number;
  createdAt: number;
  replyCount: number;
  replies: CommentItem[];
}

export interface CommentPage {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  comments: CommentItem[];
}

export interface VideoActionState {
  liked: boolean;
  coined: number;
  favorited: boolean;
  followed: boolean;
}

export interface TripleResult {
  liked: boolean;
  coined: boolean;
  favorited: boolean;
}

export interface FavoriteFolder {
  id: string;
  title: string;
  mediaCount: number;
}

export interface LibraryVideo {
  aid: number;
  bvid: string;
  cid: number;
  title: string;
  coverUrl: string;
  durationSeconds: number;
  authorMid: number;
  authorName: string;
  authorAvatarUrl: string;
  views: number;
  progressSeconds: number;
  viewedAt: number | null;
  addedAt: number | null;
}

export interface HistoryPage {
  videos: LibraryVideo[];
  cursorMax: number;
  cursorViewAt: number;
  hasMore: boolean;
}

export interface WatchLaterPage {
  videos: LibraryVideo[];
  count: number;
}

export interface FavoriteResourcePage {
  mediaId: string;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  videos: LibraryVideo[];
}

export interface SpaceProfile {
  mid: string;
  name: string;
  avatarUrl: string;
  bannerUrl: string;
  signature: string;
  level: number;
  following: number;
  followers: number;
}

export interface SpaceVideoPage {
  videos: LibraryVideo[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface ResumePoint {
  lastPlayTimeSeconds: number;
  lastPlayCid: number;
}

export interface DynamicAuthor {
  mid: string;
  name: string;
  avatarUrl: string;
}

export interface DynamicImage {
  url: string;
  width: number;
  height: number;
}

export interface DynamicVideo {
  bvid: string;
  title: string;
  coverUrl: string;
  durationSeconds: number;
  views: number;
  danmaku: number;
}

export interface DynamicStats {
  likes: number;
  comments: number;
  forwards: number;
}

export interface DynamicItem {
  id: string;
  kind: "video" | "image" | "article" | "forward" | "text";
  author: DynamicAuthor;
  publishedAt: number;
  text: string;
  images: DynamicImage[];
  video: DynamicVideo | null;
  stats: DynamicStats;
  targetUrl: string;
  onlyFans: boolean;
}

export interface DynamicPage {
  items: DynamicItem[];
  offset: string;
  updateBaseline: string;
  hasMore: boolean;
}
