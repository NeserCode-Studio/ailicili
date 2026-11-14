import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  Check,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Loader2,
  Maximize,
  MessageCircle,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Settings2,
  Share2,
  Star,
  ThumbsUp,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useParams, useSearchParams } from "react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  addLocalFavorite,
  getVideoDetail,
  getVideoPlayback,
  listLocalFavorites,
  listLocalHistory,
  removeLocalFavorite,
  saveLocalHistory,
  type FavoriteEntry,
  type HistoryEntry,
  type PlaybackInfo,
  type StreamSource,
  type VideoDetail,
} from "@/api/media";
import { asCommandError, type CommandError } from "@/api/account";
import { CommentsSidebar } from "@/components/comments/CommentsSidebar";
import { DanmakuControlButton } from "@/components/danmaku/DanmakuControl";
import { VideoDanmakuLayer } from "@/components/danmaku/VideoDanmakuLayer";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Slider } from "@/components/ui/slider";
import { useI18n, useToast } from "@/composables";
import { useAccount } from "@/contexts/account-context";
import { useNavigatorContext } from "@/contexts/navigator";
import {
  resolveDanmakuPreferencesStyle,
  useDanmakuPreferences,
} from "@/lib/danmaku/preferences";
import { formatCount } from "@/lib/format";
import { historyResumeSeconds, isHistoryProgressComplete } from "@/lib/history";
import { createLogger } from "@/lib/logger";
import { commandErrorMessage } from "@/lib/command-error";
import { favoriteMatches, favoriteTargetForVideo } from "@/lib/library";
import {
  PLAYBACK_RATES,
  readPlayerPreferences,
  savePlayerPreferences,
  type PlaybackRate,
} from "@/lib/player-preferences";
import { PLAYER_AUTO_HIDE_DELAY_MS } from "@/lib/player-idle";
import { PLAYER_CONTROL_SURFACE_CLASS } from "@/lib/player-surface";
import { Container } from "@videojs/react";
import { Video, VideoPlayer, usePlayer } from "@videojs/react/video";
import {
  Audio,
  AudioPlayer,
  usePlayer as useAudioPlayer,
} from "@videojs/react/audio";

const log = createLogger("Media/Video");
const HISTORY_SAVE_THROTTLE_MS = 5000;
const HISTORY_PROGRESS_PUBLISH_INTERVAL_SECONDS = 5;
const AUDIO_DRIFT_TOLERANCE_SECONDS = 0.18;
const AUDIO_DRIFT_CORRECTION_COOLDOWN_MS = 1_000;
const AUDIO_DRIFT_CHECK_INTERVAL_MS = 1_000;
const AUDIO_PLAYBACK_REFRESH_COOLDOWN_MS = 30_000;
const VIDEO_LOAD_AUTO_RETRY_DELAY_MS = 500;
const VIDEO_MEDIA_STALL_TIMEOUT_MS = 15_000;
const VIDEO_PLAYBACK_REFRESH_TIMEOUT_MS = 15_000;
const VIDEO_PLAYBACK_REFRESH_COOLDOWN_MS = 30_000;
const RETRYABLE_VIDEO_LOAD_ERROR_CODES = new Set([
  "networkError",
  "invalidResponse",
]);
const CONTROL_BUTTON_CLASS =
  "size-8 rounded-sm text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring";
const PLAYER_HOVER_OPEN_DELAY_MS = 180;
const PLAYER_HOVER_CLOSE_DELAY_MS = 120;
const SPEED_PAGER_BUTTON_CLASS =
  "inline-flex size-6 items-center justify-center rounded-sm text-popover-foreground/80 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30";
const QUALITY_LABELS: Record<number, string> = {
  16: "360P",
  32: "480P",
  64: "720P",
  74: "720P60",
  80: "1080P",
  112: "1080P+",
  116: "1080P60",
  120: "4K",
  125: "HDR",
  126: "杜比视界",
  127: "8K",
};

function mediaUrlsMatch(currentSrc: string, targetUrl?: string) {
  if (!currentSrc || !targetUrl) return false;
  try {
    return new URL(currentSrc).href === new URL(targetUrl).href;
  } catch {
    return currentSrc === targetUrl;
  }
}

function mediaUrlHost(url?: string) {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function mediaSourceUrls(primaryUrl?: string, backupUrls?: string[]) {
  return [primaryUrl, ...(backupUrls ?? [])].filter(
    (url, index, urls): url is string =>
      Boolean(url) && urls.indexOf(url) === index
  );
}

function streamSourceKey(stream?: StreamSource) {
  if (!stream) return undefined;
  return `${stream.id}\n${stream.url}\n${stream.audioUrl ?? ""}`;
}

function shouldRetryVideoLoad(error: CommandError) {
  return RETRYABLE_VIDEO_LOAD_ERROR_CODES.has(error.code);
}

function isPlaybackAbort(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

interface PlaybackMediaError {
  code?: number;
  message?: string;
}

interface SourceSelection {
  streamId?: string;
  streamKey?: string;
  videoIndex: number;
  audioIndex: number;
}

interface PlayerErrorBoundaryState {
  failed: boolean;
}

class PlayerErrorBoundary extends Component<
  { children: ReactNode },
  PlayerErrorBoundaryState
> {
  state: PlayerErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): PlayerErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error("player render failed", {
      error,
      componentStack: info.componentStack,
    });
  }

  retry = () => {
    this.setState({ failed: false });
  };

  render() {
    if (this.state.failed) {
      return (
        <div className="bg-background text-foreground grid h-full w-full place-items-center">
          <div className="flex flex-col items-center gap-3">
            <span className="text-sm">播放器初始化失败</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={this.retry}
            >
              重新尝试
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface PlayerPausePanelProps {
  detail: VideoDetail | null;
  error: CommandError | null;
  qualityNotice?: PlaybackInfo["qualityNotice"];
  active: boolean;
  ready: boolean;
  hasStarted: boolean;
  isFavorite: boolean;
  favoriteBusy: boolean;
  onBack: () => void;
  onContinue?: () => void;
  onFavorite: () => void;
  onFavoriteHint: () => void;
  onRetry: () => void;
  onLogin: () => void;
  onComments: () => void;
  commentsEnabled: boolean;
}

const PAUSE_BLUR_MASK =
  "linear-gradient(to bottom, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 0.15) 10%, rgba(0, 0, 0, 0.28) 20%, rgba(0, 0, 0, 0.47) 30%, rgba(0, 0, 0, 0.7) 40%, rgba(0, 0, 0, 0.88) 50%, rgba(0, 0, 0, 0.96) 60%, rgba(0, 0, 0, 0.995) 70%, rgb(0, 0, 0) 75%)";

function PlayerPausePanel({
  detail,
  error,
  qualityNotice,
  active,
  ready,
  hasStarted,
  isFavorite,
  favoriteBusy,
  onBack,
  onContinue,
  onFavorite,
  onFavoriteHint,
  onRetry,
  onLogin,
  onComments,
  commentsEnabled,
}: PlayerPausePanelProps) {
  const { t } = useI18n();
  const sectionRef = useRef<HTMLElement>(null);
  const canContinue = ready && !error && Boolean(onContinue);
  const showPausedStatus = ready && hasStarted;
  const secondaryActions = [
    {
      id: "like",
      label: t("Video.actions.like"),
      icon: ThumbsUp,
      disabled: true,
      onClick: undefined,
    },
    {
      id: "comment",
      label: t("Comments.open"),
      icon: MessageCircle,
      disabled: !commentsEnabled,
      onClick: onComments,
    },
    {
      id: "share",
      label: t("Video.actions.share"),
      icon: Share2,
      disabled: true,
      onClick: undefined,
    },
  ];

  useEffect(() => {
    if (active) return;
    const focused = document.activeElement;
    if (
      focused instanceof HTMLElement &&
      sectionRef.current?.contains(focused)
    ) {
      focused.blur();
    }
  }, [active]);

  return (
    <section
      ref={sectionRef}
      aria-label={t("Video.panelLabel")}
      inert={!active}
      onClick={(event) => {
        if (!canContinue || event.detail > 1) return;
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest("[data-player-pause-info]")
        ) {
          return;
        }
        event.stopPropagation();
        onContinue?.();
      }}
      className={`text-foreground absolute inset-0 z-20 cursor-pointer overflow-hidden transition-[opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none ${
        active
          ? "visible translate-y-0 scale-100 opacity-100"
          : "pointer-events-none invisible translate-y-1 scale-[0.995] opacity-0"
      }`}
    >
      {active ? (
        <div
          className="bg-background/55 pointer-events-none absolute inset-0 backdrop-blur-[28px]"
          style={{
            maskImage: PAUSE_BLUR_MASK,
            WebkitMaskImage: PAUSE_BLUR_MASK,
          }}
        />
      ) : null}
      <div className="from-background/95 via-background/55 to-background/10 pointer-events-none absolute inset-0 bg-gradient-to-t" />

      <div className="relative mx-auto flex h-full w-full max-w-[1440px] flex-col px-5 pt-5 pb-28 sm:px-8 sm:pb-32 lg:px-12 lg:pt-8">
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            data-player-pause-info=""
            aria-label={t("Video.back")}
            title={t("Video.back")}
            className="border-border bg-background/60 text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex size-10 items-center justify-center rounded-full border transition-[background-color,color,transform] duration-150 focus-visible:ring-2 focus-visible:outline-none active:scale-95"
            onClick={onBack}
          >
            <ArrowLeft className="size-4" />
          </button>
        </div>

        <div
          className="mt-auto grid min-w-0 cursor-default gap-6 md:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] md:items-end lg:gap-10"
          data-player-pause-info=""
        >
          <div className="min-w-0">
            <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="text-foreground/90 max-w-full truncate font-medium">
                {detail?.card.owner?.name ?? "Bilibili UGC"}
              </span>
              {detail ? (
                <span>
                  {formatCount(detail.card.stats.view)} {t("Video.views")}
                </span>
              ) : null}
              {detail ? (
                <span>
                  {formatCount(detail.card.stats.like)}{" "}
                  {t("Video.actions.like")}
                </span>
              ) : null}
            </div>

            <h1 className="mt-2 line-clamp-2 max-w-3xl text-2xl leading-tight font-semibold [overflow-wrap:anywhere] sm:text-3xl lg:text-4xl">
              {detail?.card.title ?? "Bilibili UGC"}
            </h1>

            {detail?.description ? (
              <p className="text-muted-foreground mt-3 line-clamp-2 max-w-3xl text-sm leading-6">
                {detail.description}
              </p>
            ) : null}

            {qualityNotice && qualityNotice.kind !== "none" ? (
              <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span>{t(`Quality.notice.${qualityNotice.messageCode}`)}</span>
                {qualityNotice.kind === "loginRequired" ||
                qualityNotice.kind === "accountExpired" ? (
                  <button
                    type="button"
                    className="text-foreground hover:text-foreground/75 focus-visible:ring-ring font-medium underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
                    onClick={onLogin}
                  >
                    {t("Account.titlebar.center")}
                  </button>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <div className="border-destructive/60 mt-4 max-w-3xl border-l-2 pl-3">
                <p className="text-destructive text-sm leading-5">
                  {commandErrorMessage(error, t)}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={
                    error.code === "authRequired" ||
                    error.code === "loginExpired"
                      ? onLogin
                      : onRetry
                  }
                >
                  {error.code === "authRequired" ||
                  error.code === "loginExpired"
                    ? t("Account.titlebar.login")
                    : t("Video.retry")}
                </Button>
              </div>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <Button
              type="button"
              size="lg"
              disabled={!canContinue}
              className="focus-visible:ring-ring disabled:bg-primary/60 h-11 w-full rounded-full px-5"
              onClick={() => onContinue?.()}
            >
              {error ? (
                <CircleAlert />
              ) : ready ? (
                <Play className="fill-current" />
              ) : (
                <Loader2 className="animate-spin" />
              )}
              {error
                ? t("Video.unavailable")
                : ready
                  ? showPausedStatus
                    ? t("Video.paused")
                    : t("Video.play")
                  : t("Video.loading")}
            </Button>

            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                disabled={!detail || favoriteBusy}
                aria-label={
                  isFavorite
                    ? t("Video.actions.unfavoriteHint")
                    : t("Video.actions.favorite")
                }
                aria-pressed={isFavorite}
                title={
                  isFavorite
                    ? t("Video.actions.unfavoriteHint")
                    : t("Video.actions.favorite")
                }
                className={`focus-visible:ring-ring inline-flex h-11 min-w-0 items-center justify-center rounded-full border transition-[background-color,color,transform] duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                  isFavorite
                    ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border-border bg-background/55 text-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (isFavorite) {
                    onFavoriteHint();
                  } else {
                    onFavorite();
                  }
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (isFavorite) onFavorite();
                }}
                onKeyDown={(event) => {
                  if (
                    isFavorite &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    onFavorite();
                  }
                }}
              >
                {favoriteBusy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Star
                    className={`size-4 ${isFavorite ? "fill-current" : ""}`}
                  />
                )}
              </button>
              {secondaryActions.map(
                ({ id, label, icon: Icon, disabled, onClick }) => (
                  <button
                    key={id}
                    type="button"
                    disabled={disabled}
                    aria-label={
                      disabled
                        ? `${label} (${t("Video.actions.pending")})`
                        : label
                    }
                    title={
                      disabled
                        ? `${label} (${t("Video.actions.pending")})`
                        : label
                    }
                    className="border-border bg-background/55 text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex h-11 min-w-0 items-center justify-center rounded-full border transition-[background-color,color,transform] duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={(event) => {
                      event.stopPropagation();
                      onClick?.();
                    }}
                  >
                    <Icon className="size-4" />
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function canPlayDashStream(stream: StreamSource) {
  if (stream.protocol !== "dash") return true;
  const video = document.createElement("video");
  const audio = document.createElement("audio");
  const videoType = stream.codec
    ? `video/mp4; codecs="${stream.codec}"`
    : "video/mp4";
  const audioType = stream.audioCodec
    ? `audio/mp4; codecs="${stream.audioCodec}"`
    : "audio/mp4";
  return (
    video.canPlayType(videoType) !== "" &&
    (!stream.audioUrl || audio.canPlayType(audioType) !== "")
  );
}

function formatPlaybackRate(rate: number) {
  return `${Number.isInteger(rate) ? rate.toFixed(1) : rate}X`;
}

function formatPlayerTime(seconds?: number) {
  if (!Number.isFinite(seconds) || (seconds ?? 0) < 0) return "--:--";
  const total = Math.floor(seconds ?? 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  const clock = `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${clock}` : clock;
}

function readPlayerTimeSeconds(store: {
  state: Readonly<Record<string, unknown>>;
}) {
  const value = store.state.currentTime;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

interface AudioStore {
  state: { currentTime: number };
  pause: () => void;
  play: () => Promise<void>;
  seek: (time: number) => Promise<number>;
  setMuted: (muted: boolean) => boolean;
  setPlaybackRate: (rate: number) => void;
  setVolume: (volume: number) => number;
}

interface AudioTrackProps {
  src: string;
  onStore: (store: AudioStore | null) => void;
  onCanPlay: (canPlay: boolean) => void;
  onPlaybackError: (error: PlaybackMediaError) => void;
}

function AudioTrack({
  src,
  onStore,
  onCanPlay,
  onPlaybackError,
}: AudioTrackProps) {
  const store = useAudioPlayer();
  const canPlay = useAudioPlayer((state) => state.canPlay);
  const currentSrc = useAudioPlayer((state) => state.currentSrc);
  const mediaError = useAudioPlayer((state) => state.error);
  const handledErrorKeyRef = useRef<string | null>(null);

  useEffect(() => {
    onStore(store);
    return () => onStore(null);
  }, [onStore, store]);

  useEffect(() => {
    onCanPlay(canPlay && mediaUrlsMatch(currentSrc, src));
  }, [canPlay, currentSrc, onCanPlay, src]);

  useEffect(() => {
    if (!mediaError) {
      handledErrorKeyRef.current = null;
      return;
    }
    if (!mediaUrlsMatch(currentSrc, src)) {
      return;
    }
    const errorKey = `${src}:${mediaError.code}:${mediaError.message}`;
    if (handledErrorKeyRef.current === errorKey) return;
    handledErrorKeyRef.current = errorKey;
    onPlaybackError(mediaError);
  }, [currentSrc, mediaError, onPlaybackError, src]);

  return <Audio src={src} preload="auto" className="hidden" />;
}

interface VideoStageProps {
  playback: PlaybackInfo;
  detail: VideoDetail | null;
  error: CommandError | null;
  streamIndex: number;
  availableStreams: StreamSource[];
  initialTime: number;
  accountRevision: number;
  isFavorite: boolean;
  favoriteBusy: boolean;
  commentsOpen: boolean;
  onStreamIndexChange: (index: number) => void;
  onCurrentTimeChange: (time: number) => void;
  onRefreshPlayback: () => Promise<void>;
  onFavorite: () => void;
  onFavoriteHint: () => void;
  onCommentsOpenChange: (open: boolean) => void;
  onPlaybackError: (message: string) => void;
  onBack: () => void;
  onRetry: () => void;
  onLogin: () => void;
}

function VideoStage({
  playback,
  detail,
  error,
  streamIndex,
  availableStreams,
  initialTime,
  accountRevision,
  isFavorite,
  favoriteBusy,
  commentsOpen,
  onStreamIndexChange,
  onCurrentTimeChange,
  onRefreshPlayback,
  onFavorite,
  onFavoriteHint,
  onCommentsOpenChange,
  onPlaybackError,
  onBack,
  onRetry,
  onLogin,
}: VideoStageProps) {
  const videoStore = usePlayer();
  const paused = usePlayer((state) => state.paused);
  const mediaStarted = usePlayer((state) => Boolean(state.started));
  const mediaEnded = usePlayer((state) => Boolean(state.ended));
  const currentTime = usePlayer((state) =>
    Math.max(
      0,
      Math.floor(
        typeof state.currentTime === "number" &&
          Number.isFinite(state.currentTime)
          ? state.currentTime
          : 0
      )
    )
  );
  const playerDuration = usePlayer((state) => state.duration);
  const durationSeconds = Math.max(
    0,
    Math.round(playback.durationMs / 1000),
    Number.isFinite(playerDuration) ? Math.floor(playerDuration) : 0
  );
  const isSeeking = usePlayer((state) => state.seeking);
  const currentSrc = usePlayer((state) => state.currentSrc);
  const isFullscreen = usePlayer((state) => state.isFullscreen);
  const isPictureInPicture = usePlayer((state) => state.isPictureInPicture);
  const pictureInPictureAvailability = usePlayer(
    (state) => state.pictureInPictureAvailability
  );
  const mediaError = usePlayer((state) => state.error);
  const canPlay = usePlayer((state) => state.canPlay);
  const danmakuPreferences = useDanmakuPreferences();
  const stageRef = useRef<HTMLDivElement>(null);

  const selectedStream = playback.streams[streamIndex];
  const selectedStreamId = selectedStream?.id;
  const selectedStreamKey = streamSourceKey(selectedStream);
  const videoSourceUrls = useMemo(
    () => mediaSourceUrls(selectedStream?.url, selectedStream?.backupUrls),
    [selectedStream?.backupUrls, selectedStream?.url]
  );
  const audioSourceUrls = useMemo(
    () =>
      mediaSourceUrls(
        selectedStream?.audioUrl,
        selectedStream?.audioBackupUrls
      ),
    [selectedStream?.audioBackupUrls, selectedStream?.audioUrl]
  );
  const [sourceSelection, setSourceSelection] = useState<SourceSelection>({
    videoIndex: 0,
    audioIndex: 0,
  });
  const activeSourceSelection =
    sourceSelection.streamId === selectedStreamId &&
    sourceSelection.streamKey === selectedStreamKey
      ? sourceSelection
      : {
          streamId: selectedStreamId,
          streamKey: selectedStreamKey,
          videoIndex: 0,
          audioIndex: 0,
        };
  const currentVideoUrl =
    videoSourceUrls[activeSourceSelection.videoIndex] ?? selectedStream?.url;
  const currentAudioUrl =
    audioSourceUrls[activeSourceSelection.audioIndex] ??
    selectedStream?.audioUrl;
  const needsAudio =
    selectedStream?.protocol === "dash" && Boolean(currentAudioUrl);
  const audioStoreRef = useRef<AudioStore | null>(null);
  const [readyAudioUrl, setReadyAudioUrl] = useState<string | null>(
    needsAudio ? null : (currentAudioUrl ?? null)
  );
  const audioCanPlay =
    !needsAudio ||
    (Boolean(currentAudioUrl) && readyAudioUrl === currentAudioUrl);
  const [mediaAttempt, setMediaAttempt] = useState(0);
  const [readyMediaAttempt, setReadyMediaAttempt] = useState(0);
  const [videoReloadKey, setVideoReloadKey] = useState(0);
  const mediaAttemptReady = readyMediaAttempt === mediaAttempt;
  const mediaReady =
    canPlay &&
    mediaAttemptReady &&
    !mediaError &&
    (!needsAudio || audioCanPlay);
  const [isSwitchingQuality, setIsSwitchingQuality] = useState(false);
  const [switchingReason, setSwitchingReason] = useState<"quality" | "source">(
    "source"
  );
  const [wasPlaying, setWasPlaying] = useState(false);
  const [mediaWaiting, setMediaWaiting] = useState(false);
  const audioCorrectionRef = useRef({
    inFlight: false,
    lastStartedAt: Number.NEGATIVE_INFINITY,
  });
  const targetTimeRef = useRef(0);
  const cursorHideTimer = useRef<number | null>(null);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [progressSliderOpen, setProgressSliderOpen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [volumePanelOpen, setVolumePanelOpen] = useState(false);
  const [danmakuSettingsOpen, setDanmakuSettingsOpen] = useState(false);
  const [initialPlayerPreferences] = useState(readPlayerPreferences);
  const [volume, setVolume] = useState(initialPlayerPreferences.volume);
  const [userMuted, setUserMuted] = useState(initialPlayerPreferences.muted);
  const [playbackRate, setPlaybackRate] = useState(
    initialPlayerPreferences.playbackRate
  );
  const danmakuStyle = useMemo(
    () => resolveDanmakuPreferencesStyle(danmakuPreferences, playbackRate),
    [danmakuPreferences, playbackRate]
  );
  const hideTimer = useRef<number | null>(null);
  const surfaceClickTimer = useRef<number | null>(null);
  const handledMediaErrorKeyRef = useRef<string | null>(null);
  const handledAudioErrorKeyRef = useRef<string | null>(null);
  const lastAudioPlaybackRefreshAtRef = useRef(Number.NEGATIVE_INFINITY);
  const lastVideoPlaybackRefreshAtRef = useRef(Number.NEGATIVE_INFINITY);
  const lastMediaRecoveryKeyRef = useRef<string | null>(null);
  const autoFallbackTriedRef = useRef(false);
  const initialSetupAppliedRef = useRef(false);
  const lastHistoryProgressRef = useRef(0);
  const [audioReloadKey, setAudioReloadKey] = useState(0);

  const handleAudioStore = useCallback((store: AudioStore | null) => {
    audioStoreRef.current = store;
  }, []);

  const handleAudioCanPlay = useCallback(
    (canPlayAudio: boolean) => {
      setReadyAudioUrl(canPlayAudio ? (currentAudioUrl ?? null) : null);
    },
    [currentAudioUrl]
  );

  const reportPlaybackError = useCallback(
    (message: string) => {
      videoStore.pause();
      audioStoreRef.current?.pause();
      onPlaybackError(message);
    },
    [onPlaybackError, videoStore]
  );

  const markVideoAttemptReady = useCallback(() => {
    setMediaWaiting(false);
    setReadyMediaAttempt(mediaAttempt);
  }, [mediaAttempt]);

  const prepareMediaRecovery = useCallback(() => {
    if (!isSwitchingQuality) {
      if (!initialSetupAppliedRef.current) {
        initialSetupAppliedRef.current = true;
        const duration = playback.durationMs / 1000;
        targetTimeRef.current =
          duration > 0
            ? Math.min(initialTime, Math.max(0, duration - 1))
            : initialTime;
        setWasPlaying(false);
      } else {
        targetTimeRef.current = readPlayerTimeSeconds(videoStore);
        setWasPlaying(!paused);
      }
    }

    videoStore.pause();
    audioStoreRef.current?.pause();
    videoStore.dismissError();
    setMediaWaiting(true);
    setSwitchingReason("source");
    setIsSwitchingQuality(true);
  }, [
    initialTime,
    isSwitchingQuality,
    paused,
    playback.durationMs,
    videoStore,
  ]);

  const beginNextStreamFallback = useCallback(() => {
    if (autoFallbackTriedRef.current) return false;
    const nextStreamIndex = playback.streams.findIndex(
      (stream, index) => index > streamIndex && canPlayDashStream(stream)
    );
    if (nextStreamIndex < 0) return false;

    const nextStream = playback.streams[nextStreamIndex];
    autoFallbackTriedRef.current = true;
    handledMediaErrorKeyRef.current = null;
    handledAudioErrorKeyRef.current = null;
    setReadyAudioUrl(null);
    setSourceSelection({
      streamId: nextStream.id,
      streamKey: streamSourceKey(nextStream),
      videoIndex: 0,
      audioIndex: 0,
    });
    setMediaAttempt((value) => value + 1);
    onStreamIndexChange(nextStreamIndex);
    log.warn("video stream fallback started", {
      videoId: playback.videoId,
      fromQuality: selectedStream?.qualityId,
      toQuality: nextStream.qualityId,
      targetTime: targetTimeRef.current,
      willResume: wasPlaying,
    });
    return true;
  }, [
    onStreamIndexChange,
    playback.streams,
    playback.videoId,
    selectedStream?.qualityId,
    streamIndex,
    wasPlaying,
  ]);

  const recoverFromMediaIssue = useCallback(
    (reason: "mediaError" | "stalled" | "progressStalled") => {
      if (
        !selectedStream ||
        !currentVideoUrl ||
        error ||
        mediaEnded ||
        (reason === "mediaError" && !mediaError)
      ) {
        return;
      }

      const recoveryKey = `${selectedStreamKey}:${activeSourceSelection.videoIndex}:${activeSourceSelection.audioIndex}:${videoReloadKey}:${mediaAttempt}`;
      if (lastMediaRecoveryKeyRef.current === recoveryKey) return;
      lastMediaRecoveryKeyRef.current = recoveryKey;

      const videoNeedsRecovery = !canPlay || !mediaAttemptReady;
      const audioNeedsRecovery = needsAudio && !audioCanPlay;
      const nextAudioSourceIndex = activeSourceSelection.audioIndex + 1;
      if (
        audioNeedsRecovery &&
        !videoNeedsRecovery &&
        nextAudioSourceIndex < audioSourceUrls.length
      ) {
        prepareMediaRecovery();
        handledAudioErrorKeyRef.current = null;
        setReadyAudioUrl(null);
        setSourceSelection({
          streamId: selectedStreamId,
          streamKey: selectedStreamKey,
          videoIndex: activeSourceSelection.videoIndex,
          audioIndex: nextAudioSourceIndex,
        });
        log.warn("audio source stall fallback started", {
          videoId: playback.videoId,
          streamId: selectedStreamId,
          sourceIndex: nextAudioSourceIndex,
          reason,
        });
        return;
      }

      const nextVideoSourceIndex = activeSourceSelection.videoIndex + 1;
      if (nextVideoSourceIndex < videoSourceUrls.length) {
        prepareMediaRecovery();
        handledMediaErrorKeyRef.current = null;
        setSourceSelection({
          streamId: selectedStreamId,
          streamKey: selectedStreamKey,
          videoIndex: nextVideoSourceIndex,
          audioIndex: activeSourceSelection.audioIndex,
        });
        setMediaAttempt((value) => value + 1);
        log.warn("video source stall fallback started", {
          videoId: playback.videoId,
          streamId: selectedStreamId,
          sourceIndex: nextVideoSourceIndex,
          reason,
        });
        return;
      }

      const now = performance.now();
      if (
        now - lastVideoPlaybackRefreshAtRef.current >=
        VIDEO_PLAYBACK_REFRESH_COOLDOWN_MS
      ) {
        lastVideoPlaybackRefreshAtRef.current = now;
        prepareMediaRecovery();
        log.warn("video playback refresh recovery started", {
          videoId: playback.videoId,
          streamId: selectedStreamId,
          urlHost: mediaUrlHost(currentVideoUrl),
          reason,
        });

        let refreshTimeout: number | null = null;
        void Promise.race([
          onRefreshPlayback(),
          new Promise<never>((_, reject) => {
            refreshTimeout = window.setTimeout(
              () => reject(new Error("Playback refresh timed out")),
              VIDEO_PLAYBACK_REFRESH_TIMEOUT_MS
            );
          }),
        ])
          .then(() => {
            handledMediaErrorKeyRef.current = null;
            handledAudioErrorKeyRef.current = null;
            setSourceSelection({
              streamId: selectedStreamId,
              streamKey: selectedStreamKey,
              videoIndex: 0,
              audioIndex: 0,
            });
            setMediaAttempt((value) => value + 1);
            setVideoReloadKey((value) => value + 1);
            setAudioReloadKey((value) => value + 1);
            log.info("video playback refresh recovery ready", {
              videoId: playback.videoId,
              streamId: selectedStreamId,
            });
          })
          .catch((err: unknown) => {
            log.error("video playback refresh recovery failed", {
              videoId: playback.videoId,
              streamId: selectedStreamId,
              code: asCommandError(err).code,
            });
            if (!beginNextStreamFallback()) {
              setIsSwitchingQuality(false);
              reportPlaybackError("视频线路恢复失败，请重试");
            }
          })
          .finally(() => {
            if (refreshTimeout !== null) {
              window.clearTimeout(refreshTimeout);
            }
          });
        return;
      }

      prepareMediaRecovery();
      if (beginNextStreamFallback()) return;

      setIsSwitchingQuality(false);
      log.error("video media recovery exhausted", {
        videoId: playback.videoId,
        streamId: selectedStreamId,
        urlHost: mediaUrlHost(currentVideoUrl),
        reason,
      });
      reportPlaybackError("视频加载超时，请重试");
    },
    [
      activeSourceSelection.audioIndex,
      activeSourceSelection.videoIndex,
      audioCanPlay,
      audioSourceUrls.length,
      beginNextStreamFallback,
      canPlay,
      currentVideoUrl,
      error,
      mediaAttempt,
      mediaAttemptReady,
      mediaEnded,
      mediaError,
      needsAudio,
      onRefreshPlayback,
      playback.videoId,
      prepareMediaRecovery,
      reportPlaybackError,
      selectedStream,
      selectedStreamId,
      selectedStreamKey,
      videoReloadKey,
      videoSourceUrls.length,
    ]
  );

  const scheduleHideControls = useCallback(() => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    if (
      paused ||
      commentsOpen ||
      danmakuSettingsOpen ||
      speedMenuOpen ||
      qualityMenuOpen ||
      volumePanelOpen
    ) {
      return;
    }
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      setControlsVisible(false);
    }, PLAYER_AUTO_HIDE_DELAY_MS);
  }, [
    commentsOpen,
    danmakuSettingsOpen,
    paused,
    qualityMenuOpen,
    speedMenuOpen,
    volumePanelOpen,
  ]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHideControls();
  }, [scheduleHideControls]);

  useEffect(() => {
    const floatingPanelOpen =
      danmakuSettingsOpen ||
      speedMenuOpen ||
      qualityMenuOpen ||
      volumePanelOpen;
    if (!floatingPanelOpen) {
      scheduleHideControls();
      return;
    }
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setControlsVisible(true);
  }, [
    danmakuSettingsOpen,
    qualityMenuOpen,
    scheduleHideControls,
    speedMenuOpen,
    volumePanelOpen,
  ]);

  const openComments = useCallback(() => {
    onCommentsOpenChange(true);
  }, [onCommentsOpenChange]);

  const closeComments = useCallback(() => {
    onCommentsOpenChange(false);
  }, [onCommentsOpenChange]);

  useEffect(() => {
    if (isSwitchingQuality || isSeeking) return;
    if (mediaEnded) {
      const completedTime = Math.max(currentTime, durationSeconds);
      if (lastHistoryProgressRef.current === completedTime) return;
      lastHistoryProgressRef.current = completedTime;
      onCurrentTimeChange(completedTime);
      return;
    }
    const previous = lastHistoryProgressRef.current;
    if (
      currentTime >= previous &&
      currentTime - previous < HISTORY_PROGRESS_PUBLISH_INTERVAL_SECONDS
    ) {
      return;
    }
    lastHistoryProgressRef.current = currentTime;
    onCurrentTimeChange(currentTime);
  }, [
    currentTime,
    durationSeconds,
    isSeeking,
    isSwitchingQuality,
    mediaEnded,
    onCurrentTimeChange,
  ]);

  useEffect(() => {
    if (!paused && !commentsOpen) return;
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setControlsVisible(true);
  }, [commentsOpen, paused]);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let cancelled = false;

    const syncMaximized = async () => {
      const maximized = await currentWindow.isMaximized().catch(() => false);
      if (!cancelled) setWindowMaximized(maximized);
    };

    void syncMaximized();
    const unlisten = currentWindow.onResized(() => {
      void syncMaximized();
    });

    return () => {
      cancelled = true;
      void unlisten.then((stop) => stop());
    };
  }, []);

  const clearCursorHideTimer = useCallback(() => {
    if (cursorHideTimer.current === null) return;
    window.clearTimeout(cursorHideTimer.current);
    cursorHideTimer.current = null;
  }, []);

  const showCursor = useCallback(() => {
    setCursorVisible(true);
    clearCursorHideTimer();
    if (!isFullscreen && !windowMaximized) return;
    cursorHideTimer.current = window.setTimeout(() => {
      cursorHideTimer.current = null;
      setCursorVisible(false);
    }, PLAYER_AUTO_HIDE_DELAY_MS);
  }, [clearCursorHideTimer, isFullscreen, windowMaximized]);

  useEffect(() => {
    showCursor();
    return clearCursorHideTimer;
  }, [clearCursorHideTimer, showCursor]);

  useEffect(() => {
    if (controlsVisible) return;
    setProgressSliderOpen(false);
    setSeekPreview(null);
  }, [controlsVisible]);

  useEffect(() => {
    if (!mediaReady || initialSetupAppliedRef.current) return;
    initialSetupAppliedRef.current = true;
    videoStore.pause();
    audioStoreRef.current?.pause();
    if (initialTime <= 0) return;

    let cancelled = false;
    const restoreInitialTime = async () => {
      try {
        const duration = playback.durationMs / 1000;
        const targetTime =
          duration > 0
            ? Math.min(initialTime, Math.max(0, duration - 1))
            : initialTime;
        videoStore.pause();
        const restoredTime = await videoStore.seek(targetTime);
        if (cancelled) return;
        if (needsAudio && audioCanPlay) {
          await audioStoreRef.current?.seek(restoredTime);
        }
        if (cancelled) return;
        videoStore.pause();
        audioStoreRef.current?.pause();
        onCurrentTimeChange(restoredTime);
        log.info("history resume applied", {
          videoId: playback.videoId,
          targetTime,
          restoredTime,
        });
      } catch (err) {
        if (cancelled) return;
        log.error("history resume failed", {
          videoId: playback.videoId,
          targetTime: initialTime,
          err,
        });
        onPlaybackError("恢复播放进度失败");
      }
    };

    void restoreInitialTime();
    return () => {
      cancelled = true;
    };
  }, [
    audioCanPlay,
    initialTime,
    mediaReady,
    needsAudio,
    onCurrentTimeChange,
    onPlaybackError,
    playback.durationMs,
    playback.videoId,
    videoStore,
  ]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
      }
      if (surfaceClickTimer.current !== null) {
        window.clearTimeout(surfaceClickTimer.current);
      }
      clearCursorHideTimer();
    };
  }, [clearCursorHideTimer]);

  useEffect(() => {
    if (canPlay && !mediaError && mediaUrlsMatch(currentSrc, currentVideoUrl)) {
      autoFallbackTriedRef.current = false;
      handledMediaErrorKeyRef.current = null;
    }
  }, [canPlay, currentSrc, currentVideoUrl, mediaError]);

  useEffect(() => {
    if (!mediaError) {
      handledMediaErrorKeyRef.current = null;
      return;
    }
    if (
      !selectedStream ||
      !selectedStreamId ||
      !currentVideoUrl ||
      (currentSrc && !mediaUrlsMatch(currentSrc, currentVideoUrl))
    ) {
      return;
    }
    const errorKey = `${selectedStreamId}:${currentVideoUrl}:${mediaError.code}:${mediaError.message}`;
    if (handledMediaErrorKeyRef.current === errorKey) return;
    handledMediaErrorKeyRef.current = errorKey;

    log.error("video playback failed", {
      videoId: playback.videoId,
      streamId: selectedStreamId,
      urlHost: mediaUrlHost(currentSrc),
      code: mediaError.code,
      message: mediaError.message,
    });
    recoverFromMediaIssue("mediaError");
  }, [
    currentSrc,
    currentVideoUrl,
    mediaError,
    playback.videoId,
    recoverFromMediaIssue,
    selectedStream,
    selectedStreamId,
  ]);

  const handleAudioPlaybackError = useCallback(
    (audioError: PlaybackMediaError) => {
      const errorKey = `${selectedStreamId}:${currentAudioUrl}:${audioError.code}:${audioError.message}`;
      if (handledAudioErrorKeyRef.current === errorKey) return;
      handledAudioErrorKeyRef.current = errorKey;

      log.error("audio playback failed", {
        videoId: playback.videoId,
        streamId: selectedStreamId,
        urlHost: mediaUrlHost(currentAudioUrl),
        code: audioError.code,
        message: audioError.message,
      });

      const restoreBeforeSourceChange = () => {
        const setupPending = !initialSetupAppliedRef.current;
        if (setupPending) {
          initialSetupAppliedRef.current = true;
          const duration = playback.durationMs / 1000;
          targetTimeRef.current =
            duration > 0
              ? Math.min(initialTime, Math.max(0, duration - 1))
              : initialTime;
          setWasPlaying(false);
        } else {
          targetTimeRef.current = readPlayerTimeSeconds(videoStore);
          setWasPlaying(!paused);
        }
        videoStore.pause();
        audioStoreRef.current?.pause();
        setReadyAudioUrl(null);
        setSwitchingReason("source");
        setIsSwitchingQuality(true);
      };

      const nextAudioSourceIndex = activeSourceSelection.audioIndex + 1;
      if (selectedStreamKey && nextAudioSourceIndex < audioSourceUrls.length) {
        restoreBeforeSourceChange();
        setSourceSelection({
          streamId: selectedStreamId,
          streamKey: selectedStreamKey,
          videoIndex: activeSourceSelection.videoIndex,
          audioIndex: nextAudioSourceIndex,
        });
        log.info("audio CDN fallback started", {
          videoId: playback.videoId,
          streamId: selectedStreamId,
          sourceIndex: nextAudioSourceIndex,
        });
        return;
      }

      const now = performance.now();
      if (
        now - lastAudioPlaybackRefreshAtRef.current >=
        AUDIO_PLAYBACK_REFRESH_COOLDOWN_MS
      ) {
        lastAudioPlaybackRefreshAtRef.current = now;
        restoreBeforeSourceChange();
        log.info("audio playback refresh started", {
          videoId: playback.videoId,
          streamId: selectedStreamId,
        });
        void onRefreshPlayback()
          .then(() => {
            handledAudioErrorKeyRef.current = null;
            setSourceSelection({
              streamId: selectedStreamId,
              streamKey: selectedStreamKey,
              videoIndex: 0,
              audioIndex: 0,
            });
            setAudioReloadKey((value) => value + 1);
          })
          .catch((err: unknown) => {
            log.error("audio playback refresh failed", {
              videoId: playback.videoId,
              streamId: selectedStreamId,
              err,
            });
            setIsSwitchingQuality(false);
            reportPlaybackError("音频播放失败，请重试");
          });
        return;
      }

      setIsSwitchingQuality(false);
      reportPlaybackError("音频播放失败，请重试");
    },
    [
      activeSourceSelection.audioIndex,
      activeSourceSelection.videoIndex,
      audioSourceUrls.length,
      currentAudioUrl,
      initialTime,
      onRefreshPlayback,
      paused,
      playback.durationMs,
      playback.videoId,
      reportPlaybackError,
      selectedStreamId,
      selectedStreamKey,
      videoStore,
    ]
  );

  useEffect(() => {
    if (!audioCanPlay) return;
    handledAudioErrorKeyRef.current = null;
  }, [audioCanPlay, currentAudioUrl]);

  useEffect(() => {
    const mediaPending =
      !mediaReady || isSwitchingQuality || (!paused && mediaWaiting);
    if (!mediaPending || error || mediaError || mediaEnded || isSeeking) {
      return;
    }
    const timer = window.setTimeout(() => {
      recoverFromMediaIssue("stalled");
    }, VIDEO_MEDIA_STALL_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [
    currentAudioUrl,
    currentVideoUrl,
    error,
    isSeeking,
    isSwitchingQuality,
    mediaEnded,
    mediaError,
    mediaReady,
    mediaWaiting,
    paused,
    recoverFromMediaIssue,
  ]);

  useEffect(() => {
    if (
      paused ||
      !mediaReady ||
      mediaWaiting ||
      isSeeking ||
      isSwitchingQuality ||
      mediaEnded ||
      mediaError ||
      error
    ) {
      return;
    }

    let lastTime = readPlayerTimeSeconds(videoStore);
    let lastProgressAt = performance.now();
    const timer = window.setInterval(() => {
      const nextTime = readPlayerTimeSeconds(videoStore);
      const now = performance.now();
      if (nextTime > lastTime + 0.1) {
        lastTime = nextTime;
        lastProgressAt = now;
        return;
      }
      if (now - lastProgressAt >= VIDEO_MEDIA_STALL_TIMEOUT_MS) {
        recoverFromMediaIssue("progressStalled");
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [
    currentSrc,
    currentVideoUrl,
    error,
    isSeeking,
    isSwitchingQuality,
    mediaEnded,
    mediaError,
    mediaReady,
    mediaWaiting,
    paused,
    recoverFromMediaIssue,
    videoStore,
  ]);

  useEffect(() => {
    if (!currentSrc || !videoStore.target) return;

    videoStore.setPlaybackRate(playbackRate);
    videoStore.setVolume(needsAudio ? 0 : volume);
    videoStore.setMuted(userMuted || needsAudio);

    const audioStore = audioStoreRef.current;
    if (audioStore && audioCanPlay) {
      audioStore.setPlaybackRate(playbackRate);
      audioStore.setVolume(volume);
      audioStore.setMuted(userMuted);
    }
  }, [
    audioCanPlay,
    currentSrc,
    needsAudio,
    playbackRate,
    userMuted,
    videoStore,
    volume,
  ]);

  useEffect(() => {
    savePlayerPreferences({
      volume,
      muted: userMuted,
      playbackRate,
    });
  }, [playbackRate, userMuted, volume]);

  useEffect(() => {
    const audioStore = audioStoreRef.current;
    if (
      !audioStore ||
      !audioCanPlay ||
      !needsAudio ||
      paused ||
      isSeeking ||
      isSwitchingQuality ||
      mediaWaiting
    ) {
      return;
    }

    const correctDrift = () => {
      const correction = audioCorrectionRef.current;
      const now = performance.now();
      if (
        correction.inFlight ||
        now - correction.lastStartedAt < AUDIO_DRIFT_CORRECTION_COOLDOWN_MS
      ) {
        return;
      }
      const videoTime = readPlayerTimeSeconds(videoStore);
      const audioTime = audioStore.state.currentTime;
      if (Math.abs(audioTime - videoTime) <= AUDIO_DRIFT_TOLERANCE_SECONDS) {
        return;
      }

      correction.inFlight = true;
      correction.lastStartedAt = now;
      log.debug("audio drift corrected", {
        videoId: playback.videoId,
        videoTime,
        audioTime,
        drift: audioTime - videoTime,
      });
      void audioStore
        .seek(videoTime)
        .catch((err: unknown) => {
          log.warn("audio drift correction failed", {
            videoId: playback.videoId,
            err,
          });
        })
        .finally(() => {
          correction.inFlight = false;
        });
    };

    correctDrift();
    const timer = window.setInterval(
      correctDrift,
      AUDIO_DRIFT_CHECK_INTERVAL_MS
    );
    return () => window.clearInterval(timer);
  }, [
    audioCanPlay,
    isSeeking,
    isSwitchingQuality,
    mediaWaiting,
    needsAudio,
    paused,
    playback.videoId,
    videoStore,
  ]);

  useEffect(() => {
    if (
      !isSwitchingQuality ||
      !selectedStream ||
      !mediaAttemptReady ||
      !mediaUrlsMatch(currentSrc, currentVideoUrl) ||
      !Number.isFinite(playerDuration) ||
      playerDuration <= 0 ||
      (needsAudio && !audioCanPlay)
    ) {
      return;
    }

    let cancelled = false;
    const restorePlayback = async () => {
      try {
        const restoredTime = await videoStore.seek(targetTimeRef.current);
        if (cancelled) return;
        if (needsAudio) {
          await audioStoreRef.current?.seek(restoredTime);
        }
        if (cancelled) return;
        setIsSwitchingQuality(false);
        if (wasPlaying) {
          await videoStore.play();
          if (needsAudio) {
            await audioStoreRef.current?.play();
          }
        }
        log.info("playback source ready", {
          videoId: playback.videoId,
          quality: selectedStream.qualityId,
          targetTime: restoredTime,
          willResume: wasPlaying,
        });
      } catch (err) {
        if (cancelled) return;
        setIsSwitchingQuality(false);
        if (isPlaybackAbort(err)) {
          log.debug("quality switch playback interrupted", {
            videoId: playback.videoId,
            quality: selectedStream.qualityId,
            targetTime: targetTimeRef.current,
          });
          return;
        }
        log.error("quality switch failed", {
          videoId: playback.videoId,
          quality: selectedStream.qualityId,
          targetTime: targetTimeRef.current,
          err,
        });
        reportPlaybackError("切换播放线路失败，请重试");
      }
    };

    void restorePlayback();
    return () => {
      cancelled = true;
    };
  }, [
    audioCanPlay,
    currentVideoUrl,
    currentSrc,
    isSwitchingQuality,
    mediaAttemptReady,
    needsAudio,
    playerDuration,
    playback.videoId,
    reportPlaybackError,
    selectedStream,
    videoStore,
    wasPlaying,
  ]);

  const changeQuality = (index: number) => {
    const nextStream = playback.streams[index];
    if (index === streamIndex || !nextStream) return;
    if (!currentSrc || !videoStore.target) return;
    const targetTime = readPlayerTimeSeconds(videoStore);
    targetTimeRef.current = targetTime;
    setWasPlaying(!paused);
    videoStore.pause();
    if (audioCanPlay) {
      audioStoreRef.current?.pause();
    }
    setSwitchingReason("quality");
    setIsSwitchingQuality(true);
    setQualityMenuOpen(false);
    handledMediaErrorKeyRef.current = null;
    handledAudioErrorKeyRef.current = null;
    setMediaAttempt((value) => value + 1);
    setSourceSelection({
      streamId: nextStream.id,
      streamKey: streamSourceKey(nextStream),
      videoIndex: 0,
      audioIndex: 0,
    });
    onStreamIndexChange(index);
    log.info("quality switch started", {
      videoId: playback.videoId,
      fromQuality: selectedStream?.qualityId,
      toQuality: playback.streams[index].qualityId,
      targetTime,
      wasPlaying: !paused,
      audioUnchanged:
        playback.streams[index].audioUrl === selectedStream?.audioUrl,
    });
  };

  const seekTo = async (time: number) => {
    setSeekPreview(null);
    if (!currentSrc || !videoStore.target) return;
    try {
      const restoredTime = await videoStore.seek(time);
      if (needsAudio && audioCanPlay) {
        await audioStoreRef.current?.seek(restoredTime);
      }
      log.debug("seek committed", {
        videoId: playback.videoId,
        targetTime: time,
        restoredTime,
      });
    } catch (err) {
      log.error("seek failed", {
        videoId: playback.videoId,
        targetTime: time,
        err,
      });
      reportPlaybackError("切换进度失败");
    }
  };

  const togglePlay = async () => {
    if (!currentSrc || !videoStore.target) return;
    try {
      if (paused) {
        await videoStore.play();
        if (needsAudio && audioCanPlay) {
          await audioStoreRef.current?.play();
        }
      } else {
        videoStore.pause();
        if (audioCanPlay) {
          audioStoreRef.current?.pause();
        }
      }
    } catch (err) {
      if (isPlaybackAbort(err)) {
        log.debug("playback toggle interrupted", {
          videoId: playback.videoId,
        });
        return;
      }
      log.error("playback toggle failed", {
        videoId: playback.videoId,
        err,
      });
      reportPlaybackError("播放控制失败");
    }
  };

  const togglePictureInPicture = async () => {
    try {
      if (isPictureInPicture) {
        await videoStore.exitPictureInPicture();
      } else {
        await videoStore.requestPictureInPicture();
      }
    } catch (err) {
      log.warn("picture-in-picture toggle failed", {
        videoId: playback.videoId,
        err,
      });
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (isFullscreen) {
        await videoStore.exitFullscreen();
      } else {
        await videoStore.requestFullscreen();
      }
    } catch (err) {
      log.warn("fullscreen toggle failed", {
        videoId: playback.videoId,
        err,
      });
    }
  };

  const changePlaybackRate = (rate: PlaybackRate) => {
    setPlaybackRate(rate);
    log.info("playback rate changed", { rate });
  };

  const toggleMuted = () => {
    if (!userMuted && volume > 0) {
      setUserMuted(true);
      return;
    }
    if (volume === 0) {
      setVolume(0.5);
    }
    setUserMuted(false);
  };

  const cancelPendingSurfaceClick = () => {
    if (surfaceClickTimer.current === null) return;
    window.clearTimeout(surfaceClickTimer.current);
    surfaceClickTimer.current = null;
  };

  const handleSurfaceClick = () => {
    revealControls();
    if (speedMenuOpen) {
      setSpeedMenuOpen(false);
      return;
    }
    if (qualityMenuOpen) {
      setQualityMenuOpen(false);
      return;
    }
    if (volumePanelOpen) {
      setVolumePanelOpen(false);
      return;
    }
    if (surfaceClickTimer.current !== null) {
      cancelPendingSurfaceClick();
      return;
    }
    surfaceClickTimer.current = window.setTimeout(() => {
      surfaceClickTimer.current = null;
      void togglePlay();
    }, 280);
  };

  const handleSurfaceDoubleClick = () => {
    cancelPendingSurfaceClick();
    void toggleFullscreen();
  };

  const duration = Math.max(
    playback.durationMs / 1000,
    Number.isFinite(playerDuration) ? playerDuration : 0
  );
  const displayedTime = seekPreview ?? (mediaEnded ? duration : currentTime);
  const playbackProgress =
    duration > 0 ? Math.min(1, Math.max(0, displayedTime / duration)) : 0;
  const qualityLabel = selectedStream
    ? (QUALITY_LABELS[selectedStream.qualityId] ?? selectedStream.qualityLabel)
    : "";
  const playing = !paused;

  return (
    <>
      {needsAudio && selectedStream?.audioUrl ? (
        <AudioPlayer key={`${currentAudioUrl}:${audioReloadKey}`}>
          <AudioTrack
            src={currentAudioUrl ?? selectedStream.audioUrl}
            onStore={handleAudioStore}
            onCanPlay={handleAudioCanPlay}
            onPlaybackError={handleAudioPlaybackError}
          />
        </AudioPlayer>
      ) : null}

      <Container
        ref={stageRef}
        className={`relative h-full min-h-0 w-full overflow-hidden bg-black [&:fullscreen]:h-screen [&:fullscreen]:w-screen ${
          cursorVisible ? "cursor-default" : "cursor-none [&_*]:cursor-none!"
        }`}
        onPointerEnter={showCursor}
        onPointerMove={showCursor}
        onPointerDown={showCursor}
      >
        {selectedStream ? (
          <Video
            key={`${currentVideoUrl}:${videoReloadKey}`}
            src={currentVideoUrl}
            preload="auto"
            playsInline
            onLoadStart={() => setMediaWaiting(true)}
            onWaiting={() => setMediaWaiting(true)}
            onStalled={() => setMediaWaiting(true)}
            onPlaying={markVideoAttemptReady}
            onCanPlay={markVideoAttemptReady}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : null}

        {detail?.aid ? (
          <VideoDanmakuLayer
            key={`${playback.cid}:${accountRevision}`}
            aid={detail.aid}
            cid={playback.cid}
            videoId={playback.videoId}
            accountRevision={accountRevision}
            enabled={
              danmakuPreferences.enabled &&
              Boolean(detail.aid) &&
              !mediaError &&
              !error
            }
            playing={
              !paused &&
              mediaReady &&
              !isSeeking &&
              !isSwitchingQuality &&
              !mediaWaiting &&
              !mediaError &&
              !error
            }
            playbackRate={playbackRate}
            seeking={isSeeking}
            visible={danmakuPreferences.enabled}
            settings={danmakuStyle}
          />
        ) : null}

        {detail?.aid ? (
          <CommentsSidebar
            key={detail.card.videoId}
            aid={detail.aid}
            open={commentsOpen}
            onClose={closeComments}
            onLogin={onLogin}
          />
        ) : null}

        {!isSwitchingQuality ? (
          <PlayerPausePanel
            detail={detail}
            error={error}
            qualityNotice={playback.qualityNotice}
            active={!mediaReady || !playing}
            ready={mediaReady}
            hasStarted={mediaStarted}
            isFavorite={isFavorite}
            favoriteBusy={favoriteBusy}
            onBack={onBack}
            onContinue={() => void togglePlay()}
            onFavorite={onFavorite}
            onFavoriteHint={onFavoriteHint}
            onRetry={onRetry}
            onLogin={onLogin}
            onComments={openComments}
            commentsEnabled={Boolean(detail?.aid)}
          />
        ) : null}

        {isSwitchingQuality ? (
          <div className="bg-background/55 pointer-events-none absolute inset-0 z-20 grid place-items-center backdrop-blur-sm">
            <div className="text-foreground flex flex-col items-center gap-2">
              <Pause className="size-8 fill-current" />
              <span className="text-sm font-medium">
                {switchingReason === "quality"
                  ? `正在切换至${qualityLabel || playback.currentQuality.label}清晰度`
                  : "正在切换播放线路"}
              </span>
            </div>
          </div>
        ) : null}

        <div
          className="absolute inset-0"
          onMouseMove={revealControls}
          onMouseLeave={scheduleHideControls}
        >
          <div
            className="absolute inset-0 cursor-pointer"
            aria-hidden="true"
            onClick={handleSurfaceClick}
            onDoubleClick={handleSurfaceDoubleClick}
          />

          <div
            className={`absolute inset-x-0 bottom-0 z-30 transition-[transform,opacity] duration-200 ${
              controlsVisible
                ? "translate-y-0 opacity-100"
                : "pointer-events-none translate-y-2 opacity-0"
            }`}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <div
              className={`relative flex flex-col px-3 pb-3 sm:px-4 ${
                progressSliderOpen ? "gap-2" : ""
              }`}
            >
              {progressSliderOpen ? (
                <Slider
                  id="video-progress-slider"
                  aria-label="播放进度"
                  className="[&_[data-slot=slider-thumb]]:bg-background [&_[data-slot=slider-track]]:bg-foreground/20 h-4 w-full [&_[data-slot=slider-range]]:bg-[var(--player-accent)] [&_[data-slot=slider-thumb]]:size-2 [&_[data-slot=slider-thumb]]:border-[var(--player-accent)] [&_[data-slot=slider-track]]:h-[3px] [&_[data-slot=slider-track]]:rounded-none"
                  value={[Math.min(displayedTime, duration)]}
                  max={duration || 1}
                  step={1}
                  onValueChange={([value]) => setSeekPreview(value)}
                  onValueCommit={([value]) => void seekTo(value)}
                />
              ) : null}

              <div className="relative">
                <div
                  aria-hidden="true"
                  className="bg-background/80 text-foreground pointer-events-none absolute inset-0 rounded-md backdrop-blur-xl"
                />
                <div
                  aria-hidden="true"
                  className="player-progress-border bg-border pointer-events-none absolute inset-0 rounded-md"
                />
                <div
                  aria-hidden="true"
                  className="player-progress-border pointer-events-none absolute inset-0 rounded-md bg-[var(--player-accent)] transition-[clip-path] duration-150 ease-linear motion-reduce:transition-none"
                  style={{
                    clipPath: `inset(0 ${Math.max(
                      0,
                      100 - playbackProgress * 100
                    )}% 0 0)`,
                  }}
                />
                <div className="relative z-10 flex h-10 items-center gap-2 px-2 sm:gap-3">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={CONTROL_BUTTON_CLASS}
                    aria-label={playing ? "暂停" : "播放"}
                    title={playing ? "暂停" : "播放"}
                    disabled={!mediaReady}
                    onClick={() => void togglePlay()}
                  >
                    {playing ? (
                      <Pause className="fill-current" />
                    ) : (
                      <Play className="fill-current" />
                    )}
                  </Button>
                  <button
                    type="button"
                    className="text-foreground/90 hover:text-foreground focus-visible:ring-ring flex h-8 items-center rounded-sm px-1 text-xs font-medium whitespace-nowrap tabular-nums focus-visible:ring-2 focus-visible:outline-none"
                    aria-label={
                      progressSliderOpen ? "隐藏播放进度" : "显示播放进度"
                    }
                    aria-controls="video-progress-slider"
                    aria-expanded={progressSliderOpen}
                    onClick={() => {
                      revealControls();
                      setSeekPreview(null);
                      setProgressSliderOpen((open) => !open);
                    }}
                  >
                    {formatPlayerTime(displayedTime)} /{" "}
                    {formatPlayerTime(duration)}
                  </button>

                  <div className="ml-auto flex items-center gap-2 sm:gap-3">
                    <HoverCard
                      open={qualityMenuOpen}
                      openDelay={PLAYER_HOVER_OPEN_DELAY_MS}
                      closeDelay={PLAYER_HOVER_CLOSE_DELAY_MS}
                      onOpenChange={setQualityMenuOpen}
                    >
                      <HoverCardTrigger asChild>
                        <button
                          type="button"
                          className="text-foreground/90 hover:text-foreground focus-visible:ring-ring flex h-8 items-center gap-1 rounded-sm px-1 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
                          aria-label="清晰度"
                          aria-expanded={qualityMenuOpen}
                          aria-controls="player-quality-panel"
                          title="清晰度"
                          onClick={() => setQualityMenuOpen((open) => !open)}
                        >
                          <Settings2 className="size-3.5" />
                          {qualityLabel ? <span>{qualityLabel}</span> : null}
                        </button>
                      </HoverCardTrigger>
                      <HoverCardContent
                        id="player-quality-panel"
                        portalContainer={stageRef.current}
                        side="top"
                        align="end"
                        sideOffset={8}
                        collisionPadding={12}
                        className={`${PLAYER_CONTROL_SURFACE_CLASS} w-28 border p-1 shadow-2xl`}
                      >
                        <div role="group" aria-label="清晰度">
                          <div className="text-muted-foreground flex h-5 items-center px-2 text-[10px]">
                            清晰度
                          </div>
                          <div className="grid gap-0.5">
                            {availableStreams.map((stream) => {
                              const streamAvailableIndex =
                                playback.streams.indexOf(stream);
                              const selected =
                                streamAvailableIndex === streamIndex;
                              return (
                                <button
                                  key={stream.id}
                                  type="button"
                                  aria-pressed={selected}
                                  className="text-popover-foreground/85 hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex h-6 w-full items-center justify-between rounded-sm px-2 text-[11px] focus-visible:ring-2 focus-visible:outline-none"
                                  onClick={() =>
                                    changeQuality(streamAvailableIndex)
                                  }
                                >
                                  <span>
                                    {QUALITY_LABELS[stream.qualityId] ??
                                      stream.qualityLabel}
                                  </span>
                                  {selected ? (
                                    <Check className="size-3 text-[var(--player-accent)]" />
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </HoverCardContent>
                    </HoverCard>

                    <HoverCard
                      open={speedMenuOpen}
                      openDelay={PLAYER_HOVER_OPEN_DELAY_MS}
                      closeDelay={PLAYER_HOVER_CLOSE_DELAY_MS}
                      onOpenChange={setSpeedMenuOpen}
                    >
                      <HoverCardTrigger asChild>
                        <button
                          type="button"
                          className="text-foreground/90 hover:text-foreground focus-visible:ring-ring h-8 rounded-sm px-1 text-xs font-medium tabular-nums focus-visible:ring-2 focus-visible:outline-none"
                          aria-label={`播放速度 ${formatPlaybackRate(playbackRate)}`}
                          aria-expanded={speedMenuOpen}
                          aria-controls="player-speed-pager"
                          title="播放速度"
                          onClick={() => setSpeedMenuOpen((open) => !open)}
                        >
                          {playbackRate === 1
                            ? "倍速"
                            : formatPlaybackRate(playbackRate)}
                        </button>
                      </HoverCardTrigger>
                      <HoverCardContent
                        id="player-speed-pager"
                        role="group"
                        aria-label="播放速度"
                        portalContainer={stageRef.current}
                        side="top"
                        align="end"
                        sideOffset={8}
                        collisionPadding={12}
                        className={`${PLAYER_CONTROL_SURFACE_CLASS} flex w-max items-center gap-0 border p-0.5 shadow-2xl`}
                      >
                        <button
                          type="button"
                          className={SPEED_PAGER_BUTTON_CLASS}
                          aria-label="最低速度"
                          title="最低速度"
                          disabled={playbackRate === PLAYBACK_RATES[0]}
                          onClick={() => changePlaybackRate(PLAYBACK_RATES[0])}
                        >
                          <ChevronFirst className="size-3" />
                        </button>
                        <button
                          type="button"
                          className={SPEED_PAGER_BUTTON_CLASS}
                          aria-label="降低播放速度"
                          title="降低播放速度"
                          disabled={playbackRate === PLAYBACK_RATES[0]}
                          onClick={() => {
                            const index = PLAYBACK_RATES.indexOf(playbackRate);
                            changePlaybackRate(
                              PLAYBACK_RATES[Math.max(0, index - 1)]
                            );
                          }}
                        >
                          <ChevronLeft className="size-3" />
                        </button>
                        <output
                          aria-live="polite"
                          className="text-foreground min-w-10 px-0.5 text-center text-[11px] font-medium tabular-nums"
                        >
                          {formatPlaybackRate(playbackRate)}
                        </output>
                        <button
                          type="button"
                          className={SPEED_PAGER_BUTTON_CLASS}
                          aria-label="提高播放速度"
                          title="提高播放速度"
                          disabled={
                            playbackRate ===
                            PLAYBACK_RATES[PLAYBACK_RATES.length - 1]
                          }
                          onClick={() => {
                            const index = PLAYBACK_RATES.indexOf(playbackRate);
                            changePlaybackRate(
                              PLAYBACK_RATES[
                                Math.min(PLAYBACK_RATES.length - 1, index + 1)
                              ]
                            );
                          }}
                        >
                          <ChevronRight className="size-3" />
                        </button>
                        <button
                          type="button"
                          className={SPEED_PAGER_BUTTON_CLASS}
                          aria-label="最高速度"
                          title="最高速度"
                          disabled={
                            playbackRate ===
                            PLAYBACK_RATES[PLAYBACK_RATES.length - 1]
                          }
                          onClick={() =>
                            changePlaybackRate(
                              PLAYBACK_RATES[PLAYBACK_RATES.length - 1]
                            )
                          }
                        >
                          <ChevronLast className="size-3" />
                        </button>
                      </HoverCardContent>
                    </HoverCard>

                    <div
                      className="relative flex h-8 items-center"
                      onMouseEnter={() => setVolumePanelOpen(true)}
                      onMouseLeave={() => setVolumePanelOpen(false)}
                      onFocus={() => setVolumePanelOpen(true)}
                      onBlur={(event) => {
                        if (
                          !event.currentTarget.contains(
                            event.relatedTarget as Node | null
                          )
                        ) {
                          setVolumePanelOpen(false);
                        }
                      }}
                    >
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className={`${CONTROL_BUTTON_CLASS} -mr-1`}
                        aria-label={
                          userMuted || volume === 0 ? "取消静音" : "静音"
                        }
                        title={userMuted || volume === 0 ? "取消静音" : "静音"}
                        onClick={toggleMuted}
                      >
                        {userMuted || volume === 0 ? <VolumeX /> : <Volume2 />}
                      </Button>
                      {volumePanelOpen ? (
                        <div className="absolute bottom-full left-1/2 z-40 -ml-5 pb-2">
                          <div className="border-border bg-popover/95 flex w-10 flex-col items-center gap-2 rounded-md border px-1 py-2.5 shadow-xl backdrop-blur-xl">
                            <span className="text-foreground/80 text-[11px] font-medium tabular-nums">
                              {Math.round((userMuted ? 0 : volume) * 100)}
                            </span>
                            <Slider
                              aria-label="音量"
                              aria-valuetext={`${Math.round((userMuted ? 0 : volume) * 100)}%`}
                              orientation="vertical"
                              className="[&_[data-slot=slider-thumb]]:bg-background [&_[data-slot=slider-track]]:bg-foreground/20 data-[orientation=vertical]:h-28 data-[orientation=vertical]:min-h-28 data-[orientation=vertical]:w-6 [&_[data-slot=slider-range]]:bg-[var(--player-accent)] [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-[var(--player-accent)]"
                              value={[userMuted ? 0 : volume]}
                              max={1}
                              step={0.02}
                              onValueChange={([value]) => {
                                setVolume(value);
                                setUserMuted(value === 0);
                              }}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {detail?.aid ? (
                      <DanmakuControlButton
                        portalContainerRef={stageRef}
                        triggerClassName={CONTROL_BUTTON_CLASS}
                        onOpenChange={setDanmakuSettingsOpen}
                      />
                    ) : null}

                    {pictureInPictureAvailability === "available" ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className={`${CONTROL_BUTTON_CLASS} hidden sm:inline-flex`}
                        aria-label={
                          isPictureInPicture ? "退出画中画" : "画中画"
                        }
                        title={isPictureInPicture ? "退出画中画" : "画中画"}
                        onClick={() => void togglePictureInPicture()}
                      >
                        <PictureInPicture2 />
                      </Button>
                    ) : null}

                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className={CONTROL_BUTTON_CLASS}
                      aria-label={isFullscreen ? "退出全屏" : "全屏"}
                      title={isFullscreen ? "退出全屏" : "全屏"}
                      onClick={() => void toggleFullscreen()}
                    >
                      {isFullscreen ? <Minimize /> : <Maximize />}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div
            aria-hidden="true"
            className={`bg-foreground/15 pointer-events-none absolute inset-x-0 bottom-0 z-20 h-0.5 overflow-hidden transition-opacity duration-200 motion-reduce:transition-none ${
              controlsVisible ? "opacity-0" : "opacity-100"
            }`}
          >
            <div
              className="h-full origin-left bg-[var(--player-accent)] transition-transform duration-150 ease-linear motion-reduce:transition-none"
              style={{ transform: `scaleX(${playbackProgress})` }}
            />
          </div>
        </div>
      </Container>
    </>
  );
}

export default function VideoView() {
  const { videoId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const { navigator } = useNavigatorContext();
  const {
    accountRevisions,
    openLogin,
    openAccountCenter,
    snapshot: accountSnapshot,
  } = useAccount();
  const {
    info: toastInfo,
    success: toastSuccess,
    error: toastError,
  } = useToast();
  const requestedCidValue = Number(searchParams.get("cid"));
  const requestedPageCid =
    Number.isSafeInteger(requestedCidValue) && requestedCidValue > 0
      ? requestedCidValue
      : null;
  const requestedTimeValue = Number(searchParams.get("t"));
  const requestedResumeTime =
    Number.isFinite(requestedTimeValue) && requestedTimeValue > 0
      ? requestedTimeValue
      : 0;
  const source = searchParams.get("from");
  const backPath =
    source === "history"
      ? "/history"
      : source === "favorites"
        ? "/favorites"
        : "/";
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const [streamIndex, setStreamIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [initialPlaybackTime, setInitialPlaybackTime] = useState(0);
  const [favorite, setFavorite] = useState<FavoriteEntry | null>(null);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [error, setError] = useState<CommandError | null>(null);
  const loadRequestIdRef = useRef(0);
  const loadRef = useRef<((automaticRetry?: boolean) => Promise<void>) | null>(
    null
  );
  const accountRevisionRef = useRef(0);
  const favoriteRequestIdRef = useRef(0);
  const historySaveKeyRef = useRef<string | null>(null);
  const lastHistorySaveAtRef = useRef(0);
  const videoPlatformId = accountSnapshot?.platforms.find(
    (entry) =>
      entry.platform.contentKinds.includes("video") &&
      entry.platform.accountCapability.mode !== "none"
  )?.platform.id;
  const accountRevision = videoPlatformId
    ? (accountRevisions[videoPlatformId] ?? 0)
    : 0;
  accountRevisionRef.current = accountRevision;

  const handlePlaybackError = useCallback((message: string) => {
    setError({ code: "playbackError", message });
  }, []);

  const load = useCallback(
    async (automaticRetry = false) => {
      const requestId = ++loadRequestIdRef.current;
      const revision = accountRevision;
      setError(null);
      setDetail(null);
      setPlayback(null);
      setInitialPlaybackTime(0);
      setCurrentTime(0);
      try {
        const historyRequest = listLocalHistory().catch(
          (reason): HistoryEntry[] => {
            log.warn("local history load failed", {
              videoId,
              code: asCommandError(reason).code,
            });
            return [];
          }
        );
        const [videoDetail, historyEntries] = await Promise.all([
          getVideoDetail(videoId),
          historyRequest,
        ]);
        if (
          requestId !== loadRequestIdRef.current ||
          revision !== accountRevisionRef.current
        ) {
          return;
        }
        log.info("detail loaded", {
          videoId,
          resolvedId: videoDetail.card.videoId,
          title: videoDetail.card.title,
          pageCount: videoDetail.pages.length,
          firstCid: videoDetail.pages[0]?.cid,
        });
        setDetail(videoDetail);
        const historyEntry =
          historyEntries.find(
            (entry) =>
              entry.card.platform === videoDetail.card.platform &&
              entry.card.videoId === videoDetail.card.videoId
          ) ?? null;
        const preferredPageCid =
          requestedPageCid ?? historyEntry?.pageCid ?? null;
        const page =
          videoDetail.pages.find((item) => item.cid === preferredPageCid) ??
          videoDetail.pages[0];
        if (!page) throw new Error("No playable page");
        const info = await getVideoPlayback(videoId, page.cid);
        if (
          requestId !== loadRequestIdRef.current ||
          revision !== accountRevisionRef.current
        ) {
          return;
        }
        const playableStreams = info.streams.filter(canPlayDashStream);
        const selectedStream = playableStreams[0] ?? info.streams[0];
        log.info("playback loaded", {
          videoId,
          cid: info.cid,
          protocol: selectedStream?.protocol,
          quality: selectedStream?.qualityLabel ?? info.currentQuality.label,
          noticeKind: info.qualityNotice.kind,
          urlHost: selectedStream ? new URL(selectedStream.url).host : null,
        });
        if (!selectedStream) throw new Error("No playable stream");
        const explicitResume =
          requestedPageCid !== null && info.cid === requestedPageCid;
        const historyResume =
          historyEntry !== null && info.cid === historyEntry.pageCid;
        const resumeTime = explicitResume
          ? requestedResumeTime
          : historyResume
            ? historyResumeSeconds(historyEntry)
            : 0;
        if (requestedResumeTime > 0 && resumeTime === 0) {
          log.warn("requested history page unavailable", {
            videoId,
            requestedPageCid,
            playbackCid: info.cid,
          });
        }
        if (!explicitResume && resumeTime > 0) {
          log.info("local history resume resolved", {
            videoId,
            cid: info.cid,
            resumeTime,
          });
        }
        setInitialPlaybackTime(resumeTime);
        setCurrentTime(resumeTime);
        setStreamIndex(info.streams.indexOf(selectedStream));
        setPlayback(info);
      } catch (err) {
        if (
          requestId !== loadRequestIdRef.current ||
          revision !== accountRevisionRef.current
        ) {
          return;
        }
        const commandError = asCommandError(err);
        if (!automaticRetry && shouldRetryVideoLoad(commandError)) {
          log.warn("video load failed, retrying automatically", {
            videoId,
            code: commandError.code,
          });
          await new Promise((resolve) =>
            window.setTimeout(resolve, VIDEO_LOAD_AUTO_RETRY_DELAY_MS)
          );
          if (
            requestId !== loadRequestIdRef.current ||
            revision !== accountRevisionRef.current
          ) {
            return;
          }
          await loadRef.current?.(true);
          return;
        }
        log.error("video load failed", { videoId, err: commandError });
        setError(commandError);
      }
    },
    [accountRevision, requestedPageCid, requestedResumeTime, videoId]
  );

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    void load();
    return () => {
      loadRequestIdRef.current += 1;
    };
  }, [load]);

  useEffect(() => {
    setCommentsOpen(false);
  }, [videoId]);

  useEffect(() => {
    if (!detail) {
      favoriteRequestIdRef.current += 1;
      setFavorite(null);
      setFavoriteLoading(false);
      return;
    }

    const requestId = ++favoriteRequestIdRef.current;
    const target = favoriteTargetForVideo(detail.card);
    setFavorite(null);
    setFavoriteLoading(true);
    void listLocalFavorites()
      .then((entries) => {
        if (requestId !== favoriteRequestIdRef.current) return;
        setFavorite(
          entries.find((entry) => favoriteMatches(entry, target)) ?? null
        );
      })
      .catch((reason) => {
        if (requestId !== favoriteRequestIdRef.current) return;
        log.warn("favorite state load failed", {
          videoId: detail.card.videoId,
          code: asCommandError(reason).code,
        });
      })
      .finally(() => {
        if (requestId === favoriteRequestIdRef.current) {
          setFavoriteLoading(false);
        }
      });

    return () => {
      if (requestId === favoriteRequestIdRef.current) {
        favoriteRequestIdRef.current += 1;
      }
    };
  }, [detail]);

  const toggleFavorite = useCallback(async () => {
    if (!detail || favoriteBusy || favoriteLoading) return;

    const target = favoriteTargetForVideo(detail.card);
    favoriteRequestIdRef.current += 1;
    setFavoriteBusy(true);
    try {
      const entries = favorite
        ? await removeLocalFavorite(target)
        : await addLocalFavorite({
            target,
            title: detail.card.title,
            coverUrl: detail.card.coverUrl,
            ownerName: detail.card.owner?.name,
            ownerAvatarUrl: detail.card.owner?.avatarUrl,
          });
      setFavorite(
        entries.find((entry) => favoriteMatches(entry, target)) ?? null
      );
      if (favorite) {
        toastSuccess("Library.favorites.removed");
      } else {
        toastSuccess("Library.favorites.added");
      }
      log.info("favorite toggled", {
        videoId: detail.card.videoId,
        favorite: !favorite,
      });
    } catch (reason) {
      toastError("Library.favorites.updateFailed");
      log.error("favorite toggle failed", {
        videoId: detail.card.videoId,
        code: asCommandError(reason).code,
      });
    } finally {
      setFavoriteBusy(false);
    }
  }, [
    detail,
    favorite,
    favoriteBusy,
    favoriteLoading,
    toastError,
    toastSuccess,
  ]);

  useEffect(() => {
    if (!detail || !playback || currentTime <= 5) return;
    const historyKey = `${detail.card.platform}:${detail.card.videoId}:${playback.cid}`;
    if (historySaveKeyRef.current !== historyKey) {
      historySaveKeyRef.current = historyKey;
      lastHistorySaveAtRef.current = 0;
    }

    const durationSeconds = Math.max(
      0,
      Math.round(playback.durationMs / 1000),
      Math.floor(currentTime)
    );
    const completed = isHistoryProgressComplete(currentTime, durationSeconds);
    const now = Date.now();
    if (
      !completed &&
      now - lastHistorySaveAtRef.current < HISTORY_SAVE_THROTTLE_MS
    ) {
      return;
    }
    lastHistorySaveAtRef.current = now;

    const progressSeconds = completed
      ? durationSeconds
      : Math.min(durationSeconds, Math.floor(currentTime));
    const pageTitle =
      detail.pages.find((page) => page.cid === playback.cid)?.title ??
      detail.card.title;
    void saveLocalHistory(
      detail,
      playback.cid,
      pageTitle,
      progressSeconds,
      durationSeconds
    )
      .then(() =>
        log.debug("history saved", {
          videoId: detail.card.videoId,
          cid: playback.cid,
          progressSeconds,
        })
      )
      .catch((err) => {
        lastHistorySaveAtRef.current = 0;
        log.warn("history save failed", err);
      });
  }, [currentTime, detail, playback]);

  const availableStreams = useMemo(() => {
    if (!playback) return [];
    const playable = playback.streams.filter(canPlayDashStream);
    return playable.length > 0 ? playable : playback.streams;
  }, [playback]);

  const refreshPlayback = useCallback(async () => {
    if (!playback) throw new Error("Playback is not loaded");
    const revision = accountRevision;
    const selectedQuality = playback.streams[streamIndex]?.qualityId;
    const refreshed = await getVideoPlayback(playback.videoId, playback.cid);
    if (revision !== accountRevisionRef.current) return;
    const playableStreams = refreshed.streams.filter(canPlayDashStream);
    const selectedStream =
      refreshed.streams.find(
        (stream) =>
          stream.qualityId === selectedQuality && canPlayDashStream(stream)
      ) ??
      playableStreams[0] ??
      refreshed.streams[0];
    if (!selectedStream) {
      throw new Error("No playable stream after playback refresh");
    }
    setPlayback(refreshed);
    setStreamIndex(refreshed.streams.indexOf(selectedStream));
    log.info("playback refreshed", {
      videoId: refreshed.videoId,
      cid: refreshed.cid,
      quality: selectedStream.qualityLabel,
      urlHost: new URL(selectedStream.url).host,
    });
  }, [accountRevision, playback, streamIndex]);

  return (
    <div className="bg-background text-foreground relative h-[calc(100vh-2rem)] min-h-0 w-full overflow-hidden">
      {playback ? (
        <PlayerErrorBoundary key={videoId}>
          <VideoPlayer defaultPlaybackRates={PLAYBACK_RATES}>
            <VideoStage
              playback={playback}
              detail={detail}
              error={error}
              streamIndex={streamIndex}
              availableStreams={availableStreams}
              initialTime={initialPlaybackTime}
              accountRevision={accountRevision}
              isFavorite={Boolean(favorite)}
              favoriteBusy={favoriteBusy || favoriteLoading}
              commentsOpen={commentsOpen}
              onStreamIndexChange={setStreamIndex}
              onCurrentTimeChange={setCurrentTime}
              onRefreshPlayback={refreshPlayback}
              onFavorite={() => void toggleFavorite()}
              onFavoriteHint={() =>
                toastInfo("Video.actions.unfavoriteHint", {
                  id: "video-favorite-unfavorite-hint",
                  duration: 2200,
                })
              }
              onPlaybackError={handlePlaybackError}
              onBack={() => navigator(backPath)}
              onRetry={() => void load()}
              onLogin={openAccountCenter}
              onCommentsOpenChange={setCommentsOpen}
            />
          </VideoPlayer>
        </PlayerErrorBoundary>
      ) : (
        <div className="bg-background relative h-full w-full overflow-hidden">
          <PlayerPausePanel
            detail={detail}
            error={error}
            active
            ready={false}
            hasStarted={false}
            isFavorite={Boolean(favorite)}
            favoriteBusy={favoriteBusy || favoriteLoading}
            onBack={() => navigator(backPath)}
            onFavorite={() => void toggleFavorite()}
            onFavoriteHint={() =>
              toastInfo("Video.actions.unfavoriteHint", {
                id: "video-favorite-unfavorite-hint",
                duration: 2200,
              })
            }
            onRetry={() => void load()}
            onLogin={openAccountCenter}
            onComments={() => setCommentsOpen(true)}
            commentsEnabled={Boolean(detail?.aid)}
          />
          {detail?.aid ? (
            <CommentsSidebar
              key={detail.card.videoId}
              aid={detail.aid}
              open={commentsOpen}
              onClose={() => setCommentsOpen(false)}
              onLogin={() => openLogin()}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
