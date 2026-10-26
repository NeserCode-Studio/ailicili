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

export type PgcSeasonType = 1 | 2 | 3 | 4;

export interface PgcMediaSummary {
  seasonId: string;
  mediaId: string;
  title: string;
  coverUrl: string;
  subtitle: string;
  indexShow: string;
  orderLabel: string;
  score: number | null;
  finished: boolean;
  seasonType: PgcSeasonType;
  badge: string | null;
}

export interface PgcIndexPage {
  seasonType: PgcSeasonType;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  items: PgcMediaSummary[];
}

export interface PgcTimelineEpisode {
  episodeId: string;
  seasonId: string;
  title: string;
  episodeTitle: string;
  coverUrl: string;
  publishedAt: number;
  isPublished: boolean;
  isDelayed: boolean;
  delayReason: string | null;
  targetUrl: string;
}

export interface PgcTimelineDay {
  date: string;
  dateTimestamp: number;
  dayOfWeek: number;
  isToday: boolean;
  episodes: PgcTimelineEpisode[];
}

export interface PgcTimeline {
  latest: PgcTimelineEpisode[];
  days: PgcTimelineDay[];
}

export interface PgcEpisode {
  epId: string;
  aid: number;
  bvid: string;
  cid: number;
  title: string;
  longTitle: string;
  coverUrl: string;
  durationSeconds: number;
  publishedAt: number;
  badge: string | null;
  sectionType: number;
  playbackAvailable: boolean;
  requiresMembership: boolean;
  targetUrl: string;
}

export interface PgcEpisodeSection {
  id: string;
  title: string;
  episodes: PgcEpisode[];
}

export interface PgcRating {
  score: number;
  count: number;
}

export interface PgcSeasonStats {
  views: number;
  favorites: number;
  likes: number;
  danmaku: number;
}

export interface PgcSeasonSummary {
  seasonId: string;
  title: string;
  coverUrl: string;
  badge: string | null;
}

export interface PgcSeasonDetail {
  seasonId: string;
  mediaId: string;
  title: string;
  originalTitle: string;
  coverUrl: string;
  description: string;
  subtitle: string;
  newEpisode: string;
  publishDate: string | null;
  finished: boolean;
  rating: PgcRating | null;
  stats: PgcSeasonStats;
  styles: string[];
  areas: string[];
  episodes: PgcEpisode[];
  sections: PgcEpisodeSection[];
  relatedSeasons: PgcSeasonSummary[];
  webUrl: string;
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

export interface LiveSubArea {
  id: string;
  parentId: string;
  name: string;
  iconUrl: string;
}

export interface LiveArea {
  id: string;
  name: string;
  children: LiveSubArea[];
}

export interface LiveRoomSummary {
  roomId: number;
  shortId: number;
  uid: number;
  title: string;
  coverUrl: string;
  keyframeUrl: string;
  anchorName: string;
  anchorAvatarUrl: string;
  areaId: string;
  parentAreaId: string;
  areaName: string;
  parentAreaName: string;
  online: number;
  liveStatus: number;
}

export type LiveFeedMode = "area" | "recommended";

export interface LiveRoomPage {
  rooms: LiveRoomSummary[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  mode: LiveFeedMode;
  fallbackReason: string | null;
}

export interface LiveRoomDetail {
  room: LiveRoomSummary;
  description: string;
  tags: string[];
  followerCount: number;
  anchorLevel: number;
  liveTime: string;
  webUrl: string;
}

export interface LivePlaybackQuality {
  id: number;
  label: string;
}

export interface LivePlaybackSession {
  sessionId: string;
  roomId: number;
  liveStatus: number;
  playbackUrl: string | null;
  expiresInSeconds: number;
  selectedQuality: number;
  qualities: LivePlaybackQuality[];
  streamFormat: string | null;
}

export interface LiveChatMedal {
  name: string;
  level: number;
  anchorName: string;
}

export interface LiveChatMessage {
  sequence: number;
  id: string;
  uid: string;
  username: string;
  text: string;
  color: number;
  timestamp: number;
  guardLevel: number;
  isAdmin: boolean;
  medal: LiveChatMedal | null;
}

export interface LiveChatStart {
  sessionId: string;
}

export interface LiveChatPoll {
  messages: LiveChatMessage[];
  cursor: number;
  connected: boolean;
  error: string | null;
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
