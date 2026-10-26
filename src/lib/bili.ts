import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

import type {
  AuthStatus,
  BiliCommandError,
  CommentPage,
  DanmakuItem,
  DownloadOptions,
  DownloadSettings,
  DownloadSnapshot,
  DownloadTask,
  OfflineLibraryEntry,
  DynamicPage,
  FavoriteFolder,
  FavoriteResourcePage,
  HistoryPage,
  LibraryVideo,
  LiveArea,
  LiveChatPoll,
  LiveChatStart,
  LivePlaybackSession,
  LiveRoomDetail,
  LiveRoomPage,
  PopularPage,
  PlaybackSession,
  PgcIndexPage,
  PgcSeasonDetail,
  PgcSeasonType,
  PgcTimeline,
  QrLoginPoll,
  QrLoginStart,
  ResumePoint,
  SearchKind,
  SearchPage,
  SearchSuggestion,
  SpaceProfile,
  SpaceVideoPage,
  TripleResult,
  VideoDetail,
  VideoActionState,
  WatchLaterPage,
} from "@/shared/bili.types";

const DEFAULT_PAGE_SIZE = 20;
const LAST_PLAYER_TARGET_KEY = "ailicili:last-player-target";

interface VideoPlayerTarget {
  kind: "video";
  bvid: string;
  cid: number;
}

interface LivePlayerTarget {
  kind: "live";
  roomId: number;
}

type PlayerTarget = VideoPlayerTarget | LivePlayerTarget;
type StoredPlayerTarget = {
  kind?: "video" | "live";
  bvid?: string;
  cid?: number;
  roomId?: number;
};

function rememberPlayerTarget(target: PlayerTarget) {
  try {
    window.localStorage.setItem(
      LAST_PLAYER_TARGET_KEY,
      JSON.stringify(target)
    );
  } catch {
    // The launcher still works when storage is unavailable.
  }
}

function readLastPlayerTarget(): PlayerTarget | null {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(LAST_PLAYER_TARGET_KEY) ?? "null"
    ) as StoredPlayerTarget | null;
    if (
      value?.kind === "live" &&
      typeof value.roomId === "number" &&
      Number.isSafeInteger(value.roomId) &&
      value.roomId > 0
    ) {
      return { kind: "live", roomId: value.roomId };
    }
    if (
      typeof value?.bvid !== "string" ||
      typeof value.cid !== "number" ||
      !Number.isSafeInteger(value.cid) ||
      value.cid <= 0
    ) {
      return null;
    }
    return { kind: "video", bvid: value.bvid, cid: value.cid };
  } catch {
    return null;
  }
}

function playerTargetRoute(target: PlayerTarget) {
  if (target.kind === "live") {
    return `/player/live/${target.roomId}`;
  }
  return `/player/${encodeURIComponent(target.bvid)}/${target.cid}`;
}

async function openPlayerTarget(target: PlayerTarget): Promise<void> {
  rememberPlayerTarget(target);
  const route = playerTargetRoute(target);

  if ("__TAURI_INTERNALS__" in window) {
    const existing = (await WebviewWindow.getAll()).find(
      (window) => window.label === "player"
    );
    if (existing) {
      await existing.emitTo("player", "player-navigate", route);
      await existing.show();
      await existing.setFocus();
      return;
    }

    const player = new WebviewWindow("player", {
      url: route,
      title: "Ailicili Player",
      width: 1280,
      height: 820,
      minWidth: 800,
      minHeight: 500,
      decorations: false,
      shadow: true,
    });
    await new Promise<void>((resolve, reject) => {
      void player.once("tauri://created", () => resolve());
      void player.once<unknown>("tauri://error", (event) => {
        reject(
          new Error(
            typeof event.payload === "string"
              ? event.payload
              : "Player window creation failed"
          )
        );
      });
    });
    return;
  }

  const playerWindow = window.open(
    route,
    "ailicili-player",
    "popup,width=1280,height=820"
  );
  if (!playerWindow) {
    throw new Error("Player window was blocked");
  }
}

export const biliKeys = {
  all: ["bili"] as const,
  popular: (page: number, pageSize = DEFAULT_PAGE_SIZE) =>
    [...biliKeys.all, "popular", page, pageSize] as const,
  pgcIndex: (
    seasonType: PgcSeasonType,
    page: number,
    pageSize: number,
    year: number | null,
    finished: boolean | null
  ) =>
    [
      ...biliKeys.all,
      "pgc",
      "index",
      seasonType,
      page,
      pageSize,
      year,
      finished,
    ] as const,
  pgcTimeline: (seasonType: PgcSeasonType) =>
    [...biliKeys.all, "pgc", "timeline", seasonType] as const,
  pgcSeason: (seasonId: string) =>
    [...biliKeys.all, "pgc", "season", seasonId] as const,
  liveAreas: () => [...biliKeys.all, "live", "areas"] as const,
  liveRooms: (parentAreaId: string, areaId: string, page: number) =>
    [
      ...biliKeys.all,
      "live",
      "rooms",
      parentAreaId,
      areaId,
      page,
    ] as const,
  liveRoom: (roomId: number) =>
    [...biliKeys.all, "live", "room", roomId] as const,
  livePlayback: (roomId: number, qn: number) =>
    [...biliKeys.all, "live", "playback", roomId, qn] as const,
  video: (bvid: string) => [...biliKeys.all, "video", bvid] as const,
  auth: () => [...biliKeys.all, "auth", "status"] as const,
  qrLogin: (generation: number) =>
    [...biliKeys.all, "auth", "qr", generation] as const,
  qrLoginPoll: (attemptId: string) =>
    [...biliKeys.all, "auth", "qr-poll", attemptId] as const,
  search: (query: string, kind: SearchKind, page: number) =>
    [...biliKeys.all, "search", kind, query, page] as const,
  searchSuggestions: (term: string) =>
    [...biliKeys.all, "search", "suggestions", term] as const,
  playback: (bvid: string, cid: number, qn: number) =>
    [...biliKeys.all, "playback", bvid, cid, qn] as const,
  danmaku: (cid: number, durationSeconds: number) =>
    [...biliKeys.all, "danmaku", cid, durationSeconds] as const,
  comments: (aid: number, page: number, sort: string) =>
    [...biliKeys.all, "comments", aid, page, sort] as const,
  actions: (bvid: string) => [...biliKeys.all, "actions", bvid] as const,
  favoriteFolders: () => [...biliKeys.all, "favorites", "folders"] as const,
  history: () => [...biliKeys.all, "history"] as const,
  watchLater: () => [...biliKeys.all, "watch-later"] as const,
  offlineLibrary: () => [...biliKeys.all, "library", "offline"] as const,
  favoriteResources: (mediaId: string, page: number) =>
    [...biliKeys.all, "favorites", mediaId, page] as const,
  space: (mid: string) => [...biliKeys.all, "space", mid] as const,
  spaceVideos: (mid: string, page: number) =>
    [...biliKeys.all, "space", mid, "videos", page] as const,
  resume: (bvid: string, cid: number) =>
    [...biliKeys.all, "resume", bvid, cid] as const,
  dynamicFeed: () => [...biliKeys.all, "dynamic", "feed"] as const,
  downloads: () => [...biliKeys.all, "downloads"] as const,
  downloadSettings: () => [...biliKeys.all, "downloads", "settings"] as const,
  downloadOptions: (bvid: string, cid: number) =>
    [...biliKeys.all, "downloads", "options", bvid, cid] as const,
};

export function fetchPopularVideos(
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE
): Promise<PopularPage> {
  return invoke<PopularPage>("bili_popular_videos", { page, pageSize });
}

export function fetchPgcIndex(
  seasonType: PgcSeasonType,
  page = 1,
  pageSize = 18,
  year: number | null = null,
  finished: boolean | null = null
): Promise<PgcIndexPage> {
  return invoke<PgcIndexPage>("bili_pgc_index", {
    seasonType,
    page,
    pageSize,
    year,
    isFinished: finished,
  });
}

export function fetchPgcTimeline(
  seasonType: PgcSeasonType
): Promise<PgcTimeline> {
  return invoke<PgcTimeline>("bili_pgc_timeline", { seasonType });
}

export function fetchPgcSeason(seasonId: string): Promise<PgcSeasonDetail> {
  return invoke<PgcSeasonDetail>("bili_pgc_season", { seasonId });
}

export function fetchLiveAreas(): Promise<LiveArea[]> {
  return invoke<LiveArea[]>("bili_live_areas");
}

export function fetchLiveRooms(
  parentAreaId: string | null,
  areaId: string | null,
  page = 1,
  pageSize = 20
): Promise<LiveRoomPage> {
  return invoke<LiveRoomPage>("bili_live_rooms", {
    parentAreaId,
    areaId,
    page,
    pageSize,
  });
}

export function fetchLiveRoom(roomId: number): Promise<LiveRoomDetail> {
  return invoke<LiveRoomDetail>("bili_live_room", { roomId });
}

export function createLivePlaybackSession(
  roomId: number,
  qn = 10_000
): Promise<LivePlaybackSession> {
  return invoke<LivePlaybackSession>("bili_live_playback_session", {
    roomId,
    qn,
  });
}

export function startLiveChat(roomId: number): Promise<LiveChatStart> {
  return invoke<LiveChatStart>("bili_live_chat_start", { roomId });
}

export function pollLiveChat(
  sessionId: string,
  after: number
): Promise<LiveChatPoll> {
  return invoke<LiveChatPoll>("bili_live_chat_poll", {
    sessionId,
    after,
  });
}

export function stopLiveChat(sessionId: string): Promise<void> {
  return invoke<void>("bili_live_chat_stop", { sessionId });
}

export function fetchVideoDetail(bvid: string): Promise<VideoDetail> {
  return invoke<VideoDetail>("bili_video_detail", { bvid });
}

export function fetchAuthStatus(): Promise<AuthStatus> {
  return invoke<AuthStatus>("bili_auth_status");
}

export function startQrLogin(): Promise<QrLoginStart> {
  return invoke<QrLoginStart>("bili_login_start");
}

export function pollQrLogin(attemptId: string): Promise<QrLoginPoll> {
  return invoke<QrLoginPoll>("bili_login_poll", { attemptId });
}

export function logoutBili(): Promise<void> {
  return invoke<void>("bili_logout");
}

export function searchBili(
  query: string,
  searchType: SearchKind,
  page = 1
): Promise<SearchPage> {
  return invoke<SearchPage>("bili_search", { query, searchType, page });
}

export function fetchSearchSuggestions(
  term: string
): Promise<SearchSuggestion[]> {
  return invoke<SearchSuggestion[]>("bili_search_suggestions", { term });
}

export function createPlaybackSession(
  bvid: string,
  cid: number,
  qn = 80
): Promise<PlaybackSession> {
  return invoke<PlaybackSession>("bili_playback_session", { bvid, cid, qn });
}

export async function openPlayerWindow(
  bvid: string,
  cid: number
): Promise<void> {
  await openPlayerTarget({ kind: "video", bvid, cid });
}

export async function openLiveRoomWindow(roomId: number): Promise<void> {
  if (!Number.isSafeInteger(roomId) || roomId <= 0) {
    throw new Error("Invalid live room id");
  }
  await openPlayerTarget({ kind: "live", roomId });
}

export async function openLastPlayerWindow(): Promise<boolean> {
  if ("__TAURI_INTERNALS__" in window) {
    const existing = (await WebviewWindow.getAll()).find(
      (window) => window.label === "player"
    );
    if (existing) {
      await existing.show();
      await existing.setFocus();
      return true;
    }
  }

  const target = readLastPlayerTarget();
  if (!target) return false;
  await openPlayerTarget(target);
  return true;
}

export function fetchDanmaku(
  cid: number,
  durationSeconds: number
): Promise<DanmakuItem[]> {
  return invoke<DanmakuItem[]>("bili_danmaku", { cid, durationSeconds });
}

export interface SendDanmakuInput {
  aid: number;
  cid: number;
  bvid: string;
  message: string;
  progressMs: number;
  mode: number;
  color: number;
  fontSize: number;
}

export function sendDanmaku(input: SendDanmakuInput): Promise<string> {
  return invoke<string>("bili_send_danmaku", { ...input });
}

export function fetchComments(
  aid: number,
  page = 1,
  sort: "hot" | "time" = "hot"
): Promise<CommentPage> {
  return invoke<CommentPage>("bili_comments", { aid, page, sort });
}

export function postComment(input: {
  aid: number;
  message: string;
  root?: number;
  parent?: number;
}): Promise<string> {
  return invoke<string>("bili_post_comment", input);
}

export function fetchVideoActions(
  bvid: string,
  authorMid: number
): Promise<VideoActionState> {
  return invoke<VideoActionState>("bili_video_actions", { bvid, authorMid });
}

export function likeVideo(bvid: string, liked: boolean): Promise<void> {
  return invoke<void>("bili_like_video", { bvid, liked });
}

export function coinVideo(
  bvid: string,
  multiply: number,
  withLike: boolean
): Promise<void> {
  return invoke<void>("bili_coin_video", { bvid, multiply, withLike });
}

export function tripleVideo(bvid: string): Promise<TripleResult> {
  return invoke<TripleResult>("bili_triple_video", { bvid });
}

export function followUser(mid: number, follow: boolean): Promise<void> {
  return invoke<void>("bili_follow_user", { mid, follow });
}

export function fetchFavoriteFolders(): Promise<FavoriteFolder[]> {
  return invoke<FavoriteFolder[]>("bili_favorite_folders");
}

export function setVideoFavorite(input: {
  aid: number;
  addMediaIds: string[];
  removeMediaIds: string[];
}): Promise<void> {
  return invoke<void>("bili_set_video_favorite", input);
}

export function fetchHistory(max = 0, viewAt = 0): Promise<HistoryPage> {
  return invoke<HistoryPage>("bili_history", { max, viewAt });
}

export function deleteHistory(aid: number): Promise<void> {
  return invoke<void>("bili_delete_history", { aid });
}

export function clearHistory(): Promise<void> {
  return invoke<void>("bili_clear_history");
}

export function fetchWatchLater(): Promise<WatchLaterPage> {
  return invoke<WatchLaterPage>("bili_watch_later");
}

export function addWatchLater(bvid: string): Promise<void> {
  return invoke<void>("bili_add_watch_later", { bvid });
}

export function removeWatchLater(aid: number): Promise<void> {
  return invoke<void>("bili_remove_watch_later", { aid });
}

export function clearWatchLater(): Promise<void> {
  return invoke<void>("bili_clear_watch_later");
}

export function fetchFavoriteResources(
  mediaId: string,
  page = 1
): Promise<FavoriteResourcePage> {
  return invoke<FavoriteResourcePage>("bili_favorite_resources", {
    mediaId,
    page,
  });
}

export function fetchResumePoint(
  bvid: string,
  cid: number
): Promise<ResumePoint> {
  return invoke<ResumePoint>("bili_resume_point", { bvid, cid });
}

export function reportHeartbeat(input: {
  aid: number;
  cid: number;
  bvid: string;
  playedSeconds: number;
  durationSeconds: number;
  playType?: number;
}): Promise<void> {
  return invoke<void>("bili_heartbeat", input);
}

export function fetchSpaceProfile(mid: number): Promise<SpaceProfile> {
  return invoke<SpaceProfile>("bili_space_profile", { mid });
}

export function fetchSpaceVideos(
  mid: number,
  page = 1
): Promise<SpaceVideoPage> {
  return invoke<SpaceVideoPage>("bili_space_videos", { mid, page });
}

export function fetchDynamicFeed(offset = ""): Promise<DynamicPage> {
  return invoke<DynamicPage>("bili_dynamic_feed", { offset });
}

export function fetchDownloadOptions(
  bvid: string,
  cid: number
): Promise<DownloadOptions> {
  return invoke<DownloadOptions>("download_options", { bvid, cid });
}

export function createDownload(
  bvid: string,
  cid: number,
  qualityId: number
): Promise<DownloadTask> {
  return invoke<DownloadTask>("download_create", {
    bvid,
    cid,
    qualityId,
  });
}

export function fetchDownloadSnapshot(): Promise<DownloadSnapshot> {
  return invoke<DownloadSnapshot>("download_snapshot");
}

export function fetchOfflineLibrary(): Promise<OfflineLibraryEntry[]> {
  return invoke<OfflineLibraryEntry[]>("download_offline_library");
}

export function fetchDownloadSettings(): Promise<DownloadSettings> {
  return invoke<DownloadSettings>("download_settings");
}

export function setDownloadRoot(path: string): Promise<DownloadSettings> {
  return invoke<DownloadSettings>("download_set_root", { path });
}

export function setDownloadFfmpegPath(
  path: string | null
): Promise<DownloadSettings> {
  return invoke<DownloadSettings>("download_set_ffmpeg_path", { path });
}

export function pauseDownload(id: string): Promise<DownloadTask> {
  return invoke<DownloadTask>("download_pause", { id });
}

export function resumeDownload(id: string): Promise<DownloadTask> {
  return invoke<DownloadTask>("download_resume", { id });
}

export function retryDownload(id: string): Promise<DownloadTask> {
  return invoke<DownloadTask>("download_retry", { id });
}

export function cancelDownload(id: string): Promise<DownloadTask> {
  return invoke<DownloadTask>("download_cancel", { id });
}

export function removeDownload(id: string): Promise<void> {
  return invoke<void>("download_remove", { id });
}

export function revealDownload(id: string): Promise<void> {
  return invoke<void>("download_reveal", { id });
}

export type { LibraryVideo };

export function normalizeBiliError(error: unknown): BiliCommandError {
  if (isBiliCommandError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return { code: "unexpected_error", message: error.message };
  }

  return {
    code: "unexpected_error",
    message: typeof error === "string" ? error : "Unknown error",
  };
}

export function isBiliCommandError(error: unknown): error is BiliCommandError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  );
}
