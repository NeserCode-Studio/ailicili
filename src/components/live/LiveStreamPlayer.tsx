import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Loader2,
  Lock,
  Maximize,
  Minimize,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Settings2,
  Star,
  UserRound,
  Volume2,
  VolumeX,
} from "lucide-react";
import Hls from "hls.js";
import mpegts from "mpegts.js";

import type { CommandError } from "@/api/account";
import type { LiveRoomInfo, LiveStatus } from "@/api/live";
import type { StreamSource } from "@/api/media";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "@/composables";
import { LiveFlvLoader, LiveHlsLoader } from "@/lib/bilibili-live-loader";
import { commandErrorMessage } from "@/lib/command-error";
import { createLogger } from "@/lib/logger";
import {
  readPlayerPreferences,
  savePlayerPreferences,
} from "@/lib/player-preferences";

const log = createLogger("Media/LiveStream");
const CONTROL_BUTTON_CLASS =
  "size-8 rounded-sm text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring";
const PAUSE_BLUR_MASK =
  "linear-gradient(to bottom, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 0.15) 10%, rgba(0, 0, 0, 0.28) 20%, rgba(0, 0, 0, 0.47) 30%, rgba(0, 0, 0, 0.7) 40%, rgba(0, 0, 0, 0.88) 50%, rgba(0, 0, 0, 0.96) 60%, rgba(0, 0, 0, 0.995) 70%, rgb(0, 0, 0) 75%)";
const SOURCE_TIMEOUT_MS = 12_000;
const STALL_TIMEOUT_MS = 12_000;
const PAUSE_RECOVERY_DELAY_MS = 1_200;
const AUTO_REFRESH_COOLDOWN_MS = 5_000;
const AUTO_REFRESH_LIMIT = 2;
const STABLE_PLAYBACK_MS = 15_000;

type LiveProtocol = "hls" | "flv";

interface LiveQualityOption {
  id: number;
  label: string;
}

interface LiveStreamPlayerProps {
  roomId: string;
  info: LiveRoomInfo | null;
  streams: StreamSource[];
  poster?: string;
  avatarSrc?: string;
  startedAt?: string;
  liveStatus: LiveStatus;
  roomLoading: boolean;
  refreshing: boolean;
  playbackError: CommandError | null;
  qualityOptions: LiveQualityOption[];
  currentQualityId?: number;
  currentQualityLabel?: string;
  qualityLocked: boolean;
  favorite: boolean;
  favoriteBusy: boolean;
  favoriteLoading: boolean;
  onBack: () => void;
  onRefresh: () => Promise<boolean>;
  onFavorite: () => void;
  onQualityChange: (quality: number) => void;
  onQualityLocked: () => void;
}

interface LivePausePanelProps {
  info: LiveRoomInfo | null;
  roomId: string;
  avatarSrc?: string;
  startedAt?: string;
  liveStatus: LiveStatus;
  active: boolean;
  loading: boolean;
  ready: boolean;
  playing: boolean;
  hasStreams: boolean;
  favorite: boolean;
  favoriteBusy: boolean;
  qualityLocked: boolean;
  errorText: string | null;
  onBack: () => void;
  onFavorite: () => void;
  onRefresh: () => void;
  onQualityLocked: () => void;
  onTogglePlay: () => void;
}

function isLiveProtocol(protocol: string): protocol is LiveProtocol {
  return protocol === "hls" || protocol === "flv";
}

function protocolName(protocol: LiveProtocol) {
  return protocol.toUpperCase();
}

function protocolStatusClass(status: LiveStatus) {
  if (status === "live") {
    return "border-destructive/45 bg-destructive/10 text-destructive";
  }
  if (status === "round") {
    return "border-primary/40 bg-primary/10 text-primary";
  }
  return "border-border bg-background/55 text-muted-foreground";
}

function sourceHost(sourceUrl: string) {
  try {
    return new URL(sourceUrl).host;
  } catch {
    return "invalid";
  }
}

function playbackErrorName(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string"
  ) {
    return error.name;
  }
  return "";
}

function playbackErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "msg" in error &&
    typeof error.msg === "string"
  ) {
    return error.msg;
  }
  return "unknown playback error";
}

function LivePausePanel({
  info,
  roomId,
  avatarSrc,
  startedAt,
  liveStatus,
  active,
  loading,
  ready,
  playing,
  hasStreams,
  favorite,
  favoriteBusy,
  qualityLocked,
  errorText,
  onBack,
  onFavorite,
  onRefresh,
  onQualityLocked,
  onTogglePlay,
}: LivePausePanelProps) {
  const { t } = useI18n();
  const unavailable =
    Boolean(errorText) ||
    liveStatus === "offline" ||
    liveStatus === "round" ||
    (!hasStreams && !loading);
  const primaryDisabled = loading || (!ready && !unavailable);
  const primaryLabel = loading
    ? t("Live.player.loading")
    : errorText || !hasStreams
      ? t("Live.retry")
      : liveStatus === "offline" || liveStatus === "round"
        ? t("Live.room.refresh")
        : playing
          ? t("Live.player.pause")
          : t("Live.player.play");

  return (
    <section
      aria-label={t("Live.player.panelLabel")}
      aria-hidden={!active}
      inert={!active}
      className={`text-foreground absolute inset-0 z-20 overflow-hidden transition-[opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none ${
        active
          ? "visible translate-y-0 scale-100 opacity-100"
          : "pointer-events-none invisible translate-y-1 scale-[0.995] opacity-0"
      }`}
    >
      <div
        className="bg-background/55 pointer-events-none absolute inset-0 backdrop-blur-[28px]"
        style={{
          maskImage: PAUSE_BLUR_MASK,
          WebkitMaskImage: PAUSE_BLUR_MASK,
        }}
      />
      <div className="from-background/95 via-background/55 to-background/10 pointer-events-none absolute inset-0 bg-gradient-to-t" />

      <div className="relative mx-auto flex h-full w-full max-w-[1440px] flex-col overflow-y-auto px-5 pt-5 pb-28 sm:px-8 sm:pb-32 lg:px-12 lg:pt-8">
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            aria-label={t("Live.room.back")}
            title={t("Live.room.back")}
            className="border-border bg-background/60 text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex size-10 shrink-0 items-center justify-center rounded-full border transition-[background-color,color,transform] duration-150 focus-visible:ring-2 focus-visible:outline-none active:scale-95 motion-reduce:transition-none"
            onClick={onBack}
          >
            <ArrowLeft className="size-4" />
          </button>
        </div>

        <div className="mt-auto grid min-w-0 gap-6 pt-10 md:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] md:items-end lg:gap-10">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <div className="bg-muted relative size-12 shrink-0 overflow-hidden rounded-full">
                {avatarSrc ? (
                  <img
                    src={avatarSrc}
                    alt=""
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="text-muted-foreground grid h-full w-full place-items-center">
                    <UserRound className="size-5" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {info?.anchorName ?? t("Live.room.anchorUnknown")}
                </p>
                <span
                  className={`mt-1 inline-flex min-h-6 items-center gap-1.5 rounded-sm border px-2 text-xs font-medium ${protocolStatusClass(liveStatus)}`}
                >
                  <Radio className="size-3" />
                  {t(`Live.status.${liveStatus}`)}
                </span>
              </div>
            </div>

            <h1 className="mt-3 line-clamp-2 max-w-3xl text-2xl leading-tight font-semibold [overflow-wrap:anywhere] sm:text-3xl lg:text-4xl">
              {info?.title ??
                (loading ? t("Live.room.loading") : t("Live.room.unavailable"))}
            </h1>

            <div className="text-muted-foreground mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span>
                {t("Live.room.roomLabel")} {roomId}
              </span>
              {info?.areaName ? <span>{info.areaName}</span> : null}
              {startedAt ? (
                <span>
                  {t("Live.room.startedAt")} {startedAt}
                </span>
              ) : null}
            </div>

            {info?.tags?.length ? (
              <div className="mt-3 flex min-w-0 flex-wrap gap-1.5">
                {info.tags.map((tag, index) => (
                  <span
                    key={`${tag}-${index}`}
                    className="border-border bg-background/45 text-muted-foreground max-w-full truncate rounded-sm border px-2 py-1 text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}

            {qualityLocked ? (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mt-3 inline-flex items-center gap-1.5 text-xs underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                onClick={onQualityLocked}
              >
                <Lock className="size-3" />
                {t("Live.quality.locked")}
              </button>
            ) : null}

            {errorText ? (
              <p
                className="text-destructive mt-3 max-w-3xl text-sm leading-5"
                role="alert"
              >
                {errorText}
              </p>
            ) : liveStatus === "offline" || liveStatus === "round" ? (
              <p className="text-muted-foreground mt-3 text-sm">
                {t("Live.room.offlineDetail")}
              </p>
            ) : !hasStreams && !loading ? (
              <p className="text-muted-foreground mt-3 text-sm">
                {t("Live.room.noStream")}
              </p>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <Button
              type="button"
              size="lg"
              disabled={primaryDisabled}
              className="focus-visible:ring-ring h-11 w-full rounded-full px-5"
              onClick={() => {
                if (unavailable) {
                  onRefresh();
                } else {
                  onTogglePlay();
                }
              }}
            >
              {loading ? (
                <Loader2 className="animate-spin" />
              ) : unavailable ? (
                <CircleAlert />
              ) : (
                <Play className="fill-current" />
              )}
              {primaryLabel}
            </Button>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-label={
                  favorite ? t("Live.room.unfavorite") : t("Live.room.favorite")
                }
                title={
                  favorite ? t("Live.room.unfavorite") : t("Live.room.favorite")
                }
                aria-pressed={favorite}
                disabled={!info || favoriteBusy}
                className={`focus-visible:ring-ring inline-flex h-11 min-w-0 items-center justify-center rounded-full border transition-[background-color,color,transform] duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none ${
                  favorite
                    ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border-border bg-background/55 text-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
                onClick={onFavorite}
              >
                {favoriteBusy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Star
                    className={`size-4 ${favorite ? "fill-current" : ""}`}
                  />
                )}
              </button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="focus-visible:ring-ring h-11 w-full rounded-full"
                aria-label={t("Live.room.refresh")}
                title={t("Live.room.refresh")}
                disabled={loading}
                onClick={onRefresh}
              >
                {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function LiveStreamPlayer({
  roomId,
  info,
  streams,
  poster,
  avatarSrc,
  startedAt,
  liveStatus,
  roomLoading,
  refreshing,
  playbackError,
  qualityOptions,
  currentQualityId,
  currentQualityLabel,
  qualityLocked,
  favorite,
  favoriteBusy,
  favoriteLoading,
  onBack,
  onRefresh,
  onFavorite,
  onQualityChange,
  onQualityLocked,
}: LiveStreamPlayerProps) {
  const { t } = useI18n();
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const surfaceClickTimerRef = useRef<number | null>(null);
  const pauseRecoveryTimerRef = useRef<number | null>(null);
  const stallRecoveryTimerRef = useRef<number | null>(null);
  const stablePlaybackTimerRef = useRef<number | null>(null);
  const lastProgressAtRef = useRef(0);
  const playRequestedRef = useRef(true);
  const tearingDownRef = useRef(false);
  const sourceSwitchingRef = useRef(false);
  const manualProtocolRef = useRef<LiveProtocol | null>(null);
  const fallbackProtocolRef = useRef<LiveProtocol | null>(null);
  const autoRefreshAttemptsRef = useRef(0);
  const lastAutoRefreshAtRef = useRef(0);
  const consecutiveRecoveryRef = useRef(0);
  const lastRecoveryAtRef = useRef(0);
  const refreshHandlerRef = useRef(onRefresh);
  const [initialPreferences] = useState(readPlayerPreferences);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(initialPreferences.muted);
  const [volume, setVolume] = useState(initialPreferences.volume);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [ready, setReady] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [protocolMenuOpen, setProtocolMenuOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [volumePanelOpen, setVolumePanelOpen] = useState(false);
  const [activeProtocol, setActiveProtocol] = useState<LiveProtocol>("flv");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    refreshHandlerRef.current = onRefresh;
  }, [onRefresh]);

  const availableProtocols = useMemo(
    () =>
      [
        ...new Set(
          streams.map((stream) => stream.protocol).filter(isLiveProtocol)
        ),
      ] as LiveProtocol[],
    [streams]
  );

  const hasStreams = streams.length > 0;
  const currentQuality =
    qualityOptions.find((quality) => quality.id === currentQualityId) ??
    qualityOptions[0];
  const sourceErrorText = playbackError
    ? commandErrorMessage(playbackError, t)
    : playerError;
  const offline = liveStatus === "offline" || liveStatus === "round";
  const playerLoading = roomLoading || refreshing || loading;
  const panelActive =
    (!recovering && (playerLoading || !playing)) ||
    Boolean(sourceErrorText) ||
    offline;

  useEffect(() => {
    manualProtocolRef.current = null;
    fallbackProtocolRef.current = null;
    autoRefreshAttemptsRef.current = 0;
    lastAutoRefreshAtRef.current = 0;
    consecutiveRecoveryRef.current = 0;
    lastRecoveryAtRef.current = 0;
    playRequestedRef.current = true;
    setPlaying(false);
    setRecovering(false);
    setReady(false);
    setLoading(true);
    setPlayerError(null);
    setReloadKey(0);
  }, [roomId]);

  useEffect(() => {
    if (!playbackError) return;
    setRecovering(false);
    setLoading(false);
    setReady(false);
    setPlayerError(null);
  }, [playbackError]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [muted, volume]);

  useEffect(() => {
    savePlayerPreferences({
      volume,
      muted,
      playbackRate: initialPreferences.playbackRate,
    });
  }, [initialPreferences.playbackRate, muted, volume]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === stageRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current === null) return;
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const scheduleHideControls = useCallback(() => {
    clearHideTimer();
    if (
      !playing ||
      loading ||
      sourceErrorText ||
      protocolMenuOpen ||
      qualityMenuOpen ||
      volumePanelOpen
    ) {
      setControlsVisible(true);
      return;
    }
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setControlsVisible(false);
    }, 2400);
  }, [
    clearHideTimer,
    loading,
    playing,
    protocolMenuOpen,
    qualityMenuOpen,
    sourceErrorText,
    volumePanelOpen,
  ]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHideControls();
  }, [scheduleHideControls]);

  useEffect(() => {
    if (!playing || loading || sourceErrorText) {
      setControlsVisible(true);
      return;
    }
    scheduleHideControls();
  }, [loading, playing, scheduleHideControls, sourceErrorText]);

  useEffect(() => {
    return () => {
      clearHideTimer();
      if (surfaceClickTimerRef.current !== null) {
        window.clearTimeout(surfaceClickTimerRef.current);
      }
      if (pauseRecoveryTimerRef.current !== null) {
        window.clearTimeout(pauseRecoveryTimerRef.current);
      }
      if (stallRecoveryTimerRef.current !== null) {
        window.clearTimeout(stallRecoveryTimerRef.current);
      }
      if (stablePlaybackTimerRef.current !== null) {
        window.clearTimeout(stablePlaybackTimerRef.current);
      }
    };
  }, [clearHideTimer]);

  const reloadForRecovery = useCallback(
    (reason: string) => {
      if (offline || !playRequestedRef.current || tearingDownRef.current)
        return;
      if (sourceSwitchingRef.current) return;
      const now = Date.now();
      consecutiveRecoveryRef.current =
        now - lastRecoveryAtRef.current < 30_000
          ? consecutiveRecoveryRef.current + 1
          : 1;
      lastRecoveryAtRef.current = now;
      if (
        consecutiveRecoveryRef.current >= 2 &&
        activeProtocol === "hls" &&
        availableProtocols.includes("flv") &&
        manualProtocolRef.current === null
      ) {
        fallbackProtocolRef.current = "flv";
        setActiveProtocol("flv");
        log.warn("live playback switched to FLV after repeated recovery", {
          roomId,
        });
      }
      log.warn("live playback recovery started", { roomId, reason });
      setPlaying(false);
      setRecovering(true);
      setReady(false);
      setLoading(true);
      setPlayerError(null);
      setReloadKey((current) => current + 1);
    },
    [activeProtocol, availableProtocols, offline, roomId]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const clearPauseRecovery = () => {
      if (pauseRecoveryTimerRef.current === null) return;
      window.clearTimeout(pauseRecoveryTimerRef.current);
      pauseRecoveryTimerRef.current = null;
    };
    const clearStallRecovery = () => {
      if (stallRecoveryTimerRef.current === null) return;
      window.clearTimeout(stallRecoveryTimerRef.current);
      stallRecoveryTimerRef.current = null;
    };
    const schedulePauseRecovery = () => {
      if (
        !hasStreams ||
        offline ||
        !playRequestedRef.current ||
        tearingDownRef.current ||
        sourceSwitchingRef.current ||
        pauseRecoveryTimerRef.current !== null
      ) {
        return;
      }
      pauseRecoveryTimerRef.current = window.setTimeout(() => {
        pauseRecoveryTimerRef.current = null;
        if (!playRequestedRef.current || tearingDownRef.current) return;
        if (!video.paused) return;
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          lastProgressAtRef.current = performance.now();
          void video.play().catch((error: unknown) => {
            if (!playRequestedRef.current || tearingDownRef.current) return;
            if (playbackErrorName(error) === "NotAllowedError") {
              playRequestedRef.current = false;
              setPlaying(false);
              setRecovering(false);
              setLoading(false);
              setReady(video.readyState >= HTMLMediaElement.HAVE_METADATA);
              return;
            }
            setPlaying(false);
            reloadForRecovery("media-resume-failed");
          });
          return;
        }
        setPlaying(false);
        reloadForRecovery("media-paused");
      }, PAUSE_RECOVERY_DELAY_MS);
    };
    const scheduleStallRecovery = () => {
      if (
        !hasStreams ||
        offline ||
        !playRequestedRef.current ||
        tearingDownRef.current ||
        sourceSwitchingRef.current ||
        stallRecoveryTimerRef.current !== null
      ) {
        return;
      }
      stallRecoveryTimerRef.current = window.setTimeout(() => {
        stallRecoveryTimerRef.current = null;
        if (!playRequestedRef.current || tearingDownRef.current) return;
        reloadForRecovery("media-stalled");
      }, STALL_TIMEOUT_MS);
    };
    const handlePlaying = () => {
      clearPauseRecovery();
      clearStallRecovery();
      sourceSwitchingRef.current = false;
      lastProgressAtRef.current = performance.now();
      setPlaying(true);
      setRecovering(false);
      setLoading(false);
      setReady(true);
      setPlayerError(null);
      if (stablePlaybackTimerRef.current !== null) {
        window.clearTimeout(stablePlaybackTimerRef.current);
      }
      stablePlaybackTimerRef.current = window.setTimeout(() => {
        stablePlaybackTimerRef.current = null;
        autoRefreshAttemptsRef.current = 0;
        consecutiveRecoveryRef.current = 0;
      }, STABLE_PLAYBACK_MS);
    };
    const handlePause = () => {
      if (tearingDownRef.current || sourceSwitchingRef.current) return;
      if (playRequestedRef.current && !tearingDownRef.current) {
        schedulePauseRecovery();
        return;
      }
      setPlaying(false);
      setRecovering(false);
    };
    const handleTimeUpdate = () => {
      lastProgressAtRef.current = performance.now();
      clearStallRecovery();
    };
    const handleWaiting = () => {
      if (playRequestedRef.current) scheduleStallRecovery();
    };
    const handleError = () => {
      if (!video.error || tearingDownRef.current) return;
      log.warn("live video element errored", {
        roomId,
        code: video.error.code,
        message: video.error.message,
      });
      schedulePauseRecovery();
    };
    const handleLoadStart = () => {
      lastProgressAtRef.current = performance.now();
    };

    video.addEventListener("playing", handlePlaying);
    video.addEventListener("pause", handlePause);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("stalled", handleWaiting);
    video.addEventListener("error", handleError);
    video.addEventListener("loadstart", handleLoadStart);

    const watchdog = window.setInterval(() => {
      if (
        !playRequestedRef.current ||
        offline ||
        tearingDownRef.current ||
        sourceSwitchingRef.current
      ) {
        return;
      }
      if (video.paused) {
        if (
          video.readyState >= HTMLMediaElement.HAVE_METADATA &&
          performance.now() - lastProgressAtRef.current > STALL_TIMEOUT_MS
        ) {
          log.warn("live playback remained paused unexpectedly", {
            roomId,
            readyState: video.readyState,
            networkState: video.networkState,
            currentTime: video.currentTime,
          });
          setPlaying(false);
          reloadForRecovery("paused-watchdog");
        }
        return;
      }
      if (performance.now() - lastProgressAtRef.current > STALL_TIMEOUT_MS) {
        log.warn("live playback watchdog triggered", {
          roomId,
          readyState: video.readyState,
          networkState: video.networkState,
          currentTime: video.currentTime,
        });
        reloadForRecovery("watchdog");
      }
    }, 3000);

    return () => {
      clearPauseRecovery();
      clearStallRecovery();
      window.clearInterval(watchdog);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("stalled", handleWaiting);
      video.removeEventListener("error", handleError);
      video.removeEventListener("loadstart", handleLoadStart);
    };
  }, [hasStreams, offline, reloadForRecovery, roomId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (offline) {
      playRequestedRef.current = false;
      log.info("live playback stopped because room is offline", {
        roomId,
        liveStatus,
      });
    }

    if (offline || streams.length === 0) {
      sourceSwitchingRef.current = false;
      setPlaying(false);
      setRecovering(false);
      setReady(false);
      setLoading(false);
      setPlayerError(null);
      return;
    }

    const protocols = availableProtocols;
    if (protocols.length === 0) {
      setRecovering(false);
      setLoading(false);
      setPlayerError(t("Live.player.unsupportedProtocol"));
      return;
    }

    const initialProtocol =
      manualProtocolRef.current ?? fallbackProtocolRef.current ?? protocols[0];
    const orderedProtocols = [
      initialProtocol,
      ...protocols.filter((protocol) => protocol !== initialProtocol),
    ];
    const candidates = orderedProtocols.flatMap((protocol) =>
      streams
        .filter((stream) => stream.protocol === protocol)
        .flatMap((stream) =>
          [stream.url, ...(stream.backupUrls ?? [])]
            .filter(
              (url, index, urls) => Boolean(url) && urls.indexOf(url) === index
            )
            .map((url) => ({ protocol, stream, url }))
        )
    );

    let cancelled = false;
    let finalized = false;
    let attemptToken = 0;
    let sourceReachedReady = false;
    let attemptTimeout: number | null = null;
    let activeHls: Hls | null = null;
    let activeMpegts: ReturnType<typeof mpegts.createPlayer> | null = null;
    let removeSourceReadyListener: (() => void) | null = null;
    let removeNativeErrorListener: (() => void) | null = null;

    const clearAttemptTimeout = () => {
      if (attemptTimeout === null) return;
      window.clearTimeout(attemptTimeout);
      attemptTimeout = null;
    };

    const destroySource = () => {
      clearAttemptTimeout();
      tearingDownRef.current = true;
      removeSourceReadyListener?.();
      removeSourceReadyListener = null;
      removeNativeErrorListener?.();
      removeNativeErrorListener = null;
      if (activeHls) {
        activeHls.destroy();
        activeHls = null;
      }
      if (activeMpegts) {
        activeMpegts.destroy();
        activeMpegts = null;
      }
      video.pause();
      video.removeAttribute("src");
      video.load();
      tearingDownRef.current = false;
    };

    const refreshAfterFailure = async (message: string) => {
      if (cancelled || finalized) return;
      finalized = true;
      setPlaying(false);
      setReady(false);

      if (
        playRequestedRef.current &&
        autoRefreshAttemptsRef.current < AUTO_REFRESH_LIMIT &&
        Date.now() - lastAutoRefreshAtRef.current > AUTO_REFRESH_COOLDOWN_MS
      ) {
        autoRefreshAttemptsRef.current += 1;
        lastAutoRefreshAtRef.current = Date.now();
        setLoading(true);
        setPlayerError(null);
        log.info("live stream source refresh requested", {
          roomId,
          attempt: autoRefreshAttemptsRef.current,
        });
        const refreshed = await refreshHandlerRef.current();
        if (cancelled) return;
        if (refreshed) return;
      }

      setRecovering(false);
      setLoading(false);
      setPlayerError(message);
    };

    const playVideo = () => {
      if (cancelled || !playRequestedRef.current) return;
      void video.play().catch((error: unknown) => {
        if (cancelled) return;
        const name = playbackErrorName(error);
        if (name === "NotAllowedError") {
          playRequestedRef.current = false;
          setPlaying(false);
          setRecovering(false);
          setLoading(false);
          setReady(video.readyState >= HTMLMediaElement.HAVE_METADATA);
          return;
        }
        log.warn("live media play failed", {
          roomId,
          name,
          message: playbackErrorMessage(error),
          readyState: video.readyState,
        });
      });
    };

    const attempt = (index: number) => {
      if (cancelled) return;
      const candidate = candidates[index];
      if (!candidate) {
        void refreshAfterFailure(t("Live.player.streamError"));
        return;
      }

      attemptToken += 1;
      const token = attemptToken;
      sourceSwitchingRef.current = true;
      destroySource();
      setActiveProtocol(candidate.protocol);
      setPlaying(false);
      setReady(false);
      setLoading(true);
      setPlayerError(null);

      const sourceMetadata = () => {
        if (cancelled || token !== attemptToken) return;
        if (playRequestedRef.current && video.paused) {
          playVideo();
        }
      };
      const sourceReady = () => {
        if (cancelled || token !== attemptToken) return;
        clearAttemptTimeout();
        sourceSwitchingRef.current = false;
        sourceReachedReady = true;
        lastProgressAtRef.current = performance.now();
        setReady(true);
        if (playRequestedRef.current && video.paused) {
          playVideo();
        }
        if (candidate.protocol !== initialProtocol) {
          fallbackProtocolRef.current = candidate.protocol;
        }
      };
      video.addEventListener("loadedmetadata", sourceMetadata, { once: true });
      video.addEventListener("canplay", sourceReady, { once: true });
      video.addEventListener("playing", sourceReady, { once: true });
      removeSourceReadyListener = () => {
        video.removeEventListener("loadedmetadata", sourceMetadata);
        video.removeEventListener("canplay", sourceReady);
        video.removeEventListener("playing", sourceReady);
      };

      attemptTimeout = window.setTimeout(() => {
        if (cancelled || token !== attemptToken) return;
        log.warn("live source timed out", {
          roomId,
          protocol: candidate.protocol,
          sourceIndex: index,
          sourceHost: sourceHost(candidate.url),
          readyState: video.readyState,
          networkState: video.networkState,
          paused: video.paused,
          currentTime: video.currentTime,
        });
        attempt(index + 1);
      }, SOURCE_TIMEOUT_MS);

      const nextSource = (reason: string) => {
        if (cancelled || token !== attemptToken) return;
        if (sourceReachedReady && playRequestedRef.current) {
          setRecovering(true);
        }
        log.warn("live source failed", {
          roomId,
          protocol: candidate.protocol,
          sourceIndex: index,
          sourceHost: sourceHost(candidate.url),
          reason,
        });
        attempt(index + 1);
      };

      try {
        if (candidate.protocol === "hls") {
          if (Hls.isSupported()) {
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: true,
              backBufferLength: 30,
              loader: LiveHlsLoader,
            });
            activeHls = hls;
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, playVideo);
            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (!data.fatal || token !== attemptToken) return;
              log.warn("live HLS player error", {
                roomId,
                sourceHost: sourceHost(candidate.url),
                type: data.type,
                details: data.details,
                responseCode: data.response?.code,
                responseText: data.response?.text,
              });
              nextSource(data.type);
            });
            hls.loadSource(candidate.url);
            return;
          }

          if (video.canPlayType("application/vnd.apple.mpegurl") !== "") {
            const onNativeError = () => nextSource("native-hls-error");
            removeNativeErrorListener = () =>
              video.removeEventListener("error", onNativeError);
            video.addEventListener("error", onNativeError, { once: true });
            video.src = candidate.url;
            video.load();
            playVideo();
            return;
          }

          nextSource("hls-unsupported");
          return;
        }

        if (candidate.protocol === "flv") {
          if (!mpegts.isSupported()) {
            nextSource("flv-unsupported");
            return;
          }
          const player = mpegts.createPlayer(
            {
              type: "flv",
              isLive: true,
              url: candidate.url,
            },
            {
              enableWorker: false,
              customLoader: LiveFlvLoader,
              enableStashBuffer: true,
              stashInitialSize: 384 * 1024,
              liveSync: true,
              liveSyncMaxLatency: 2.5,
              liveSyncTargetLatency: 1.5,
              liveSyncPlaybackRate: 1.1,
            }
          );
          activeMpegts = player;
          const onNativeError = () => nextSource("native-flv-error");
          removeNativeErrorListener = () =>
            video.removeEventListener("error", onNativeError);
          video.addEventListener("error", onNativeError, { once: true });
          player.attachMediaElement(video);
          player.on(mpegts.Events.LOADING_COMPLETE, () =>
            nextSource("flv-complete")
          );
          player.on(
            mpegts.Events.ERROR,
            (type: string, detail: unknown, info: unknown) => {
              log.warn("live FLV player error", {
                roomId,
                sourceHost: sourceHost(candidate.url),
                type,
                detail,
                message: playbackErrorMessage(info),
              });
              nextSource("flv-error");
            }
          );
          player.load();
          playVideo();
          return;
        }

        nextSource("unsupported-protocol");
      } catch (error) {
        log.warn("live source initialization failed", {
          roomId,
          protocol: candidate.protocol,
          sourceHost: sourceHost(candidate.url),
          message: playbackErrorMessage(error),
        });
        nextSource("player-exception");
      }
    };

    attempt(0);

    return () => {
      cancelled = true;
      finalized = true;
      attemptToken += 1;
      sourceSwitchingRef.current = false;
      destroySource();
    };
  }, [availableProtocols, liveStatus, offline, reloadKey, roomId, streams, t]);

  useEffect(() => {
    if (protocolMenuOpen || qualityMenuOpen || volumePanelOpen) {
      clearHideTimer();
      setControlsVisible(true);
    }
  }, [clearHideTimer, protocolMenuOpen, qualityMenuOpen, volumePanelOpen]);

  useEffect(() => {
    if (!protocolMenuOpen && !qualityMenuOpen && !volumePanelOpen) return;
    const closeMenus = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setProtocolMenuOpen(false);
      setQualityMenuOpen(false);
      setVolumePanelOpen(false);
    };
    window.addEventListener("keydown", closeMenus);
    return () => window.removeEventListener("keydown", closeMenus);
  }, [protocolMenuOpen, qualityMenuOpen, volumePanelOpen]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video || recovering) return;
    revealControls();
    if (video.paused) {
      playRequestedRef.current = true;
      lastProgressAtRef.current = performance.now();
      if (video.readyState < HTMLMediaElement.HAVE_METADATA || playerError) {
        setLoading(true);
        setPlayerError(null);
        setReloadKey((current) => current + 1);
        return;
      }
      void video.play().catch(() => {
        playRequestedRef.current = false;
        setPlaying(false);
      });
    } else {
      playRequestedRef.current = false;
      video.pause();
    }
  };

  const refreshPlayback = useCallback(async () => {
    playRequestedRef.current = true;
    autoRefreshAttemptsRef.current = 0;
    lastAutoRefreshAtRef.current = 0;
    consecutiveRecoveryRef.current = 0;
    setRecovering(false);
    setLoading(true);
    setReady(false);
    setPlayerError(null);
    const refreshed = await refreshHandlerRef.current();
    if (!refreshed) {
      setLoading(false);
      setPlayerError(t("Live.player.streamError"));
    }
  }, [t]);

  const selectProtocol = (protocol: LiveProtocol) => {
    setProtocolMenuOpen(false);
    if (protocol === activeProtocol) return;
    manualProtocolRef.current = protocol;
    autoRefreshAttemptsRef.current = 0;
    lastAutoRefreshAtRef.current = 0;
    consecutiveRecoveryRef.current = 0;
    setActiveProtocol(protocol);
    setRecovering(false);
    setLoading(true);
    setPlayerError(null);
    setReloadKey((current) => current + 1);
  };

  const selectQuality = (quality: number) => {
    setQualityMenuOpen(false);
    if (quality === currentQuality?.id) return;
    autoRefreshAttemptsRef.current = 0;
    lastAutoRefreshAtRef.current = 0;
    consecutiveRecoveryRef.current = 0;
    setRecovering(false);
    setLoading(true);
    setReady(false);
    setPlayerError(null);
    onQualityChange(quality);
  };

  const toggleMuted = () => {
    if (!muted && volume > 0) {
      setMuted(true);
      return;
    }
    if (volume === 0) setVolume(0.5);
    setMuted(false);
  };

  const toggleFullscreen = async () => {
    const stage = stageRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await stage.requestFullscreen();
      }
    } catch {
      log.warn("live fullscreen failed", { roomId });
    }
  };

  const cancelPendingSurfaceClick = () => {
    if (surfaceClickTimerRef.current === null) return;
    window.clearTimeout(surfaceClickTimerRef.current);
    surfaceClickTimerRef.current = null;
  };

  const handleSurfaceClick = () => {
    revealControls();
    if (protocolMenuOpen) {
      setProtocolMenuOpen(false);
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
    if (surfaceClickTimerRef.current !== null) {
      cancelPendingSurfaceClick();
      return;
    }
    surfaceClickTimerRef.current = window.setTimeout(() => {
      surfaceClickTimerRef.current = null;
      togglePlay();
    }, 280);
  };

  const handleSurfaceDoubleClick = () => {
    cancelPendingSurfaceClick();
    void toggleFullscreen();
  };

  return (
    <div
      ref={stageRef}
      className="group relative h-full min-h-0 w-full overflow-hidden bg-black [&:fullscreen]:h-screen [&:fullscreen]:w-screen"
      onMouseMove={revealControls}
      onMouseLeave={scheduleHideControls}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full bg-black object-contain"
        poster={poster}
        playsInline
        aria-label={info?.title ?? t("Live.player.play")}
      />

      <LivePausePanel
        info={info}
        roomId={roomId}
        avatarSrc={avatarSrc}
        startedAt={startedAt}
        liveStatus={liveStatus}
        active={panelActive}
        loading={playerLoading}
        ready={ready}
        playing={playing}
        hasStreams={hasStreams}
        favorite={favorite}
        favoriteBusy={favoriteBusy || favoriteLoading}
        qualityLocked={qualityLocked}
        errorText={sourceErrorText}
        onBack={onBack}
        onFavorite={onFavorite}
        onRefresh={() => void refreshPlayback()}
        onQualityLocked={onQualityLocked}
        onTogglePlay={togglePlay}
      />

      {recovering ? (
        <div
          role="status"
          aria-live="polite"
          className="border-border bg-background/80 text-foreground pointer-events-none absolute top-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur-xl"
        >
          <Loader2 className="size-3.5 animate-spin" />
          {t("Live.player.reconnecting")}
        </div>
      ) : null}

      <div className="absolute inset-0">
        <div
          className="absolute inset-0 cursor-pointer"
          aria-hidden="true"
          onClick={handleSurfaceClick}
          onDoubleClick={handleSurfaceDoubleClick}
        />

        <div
          className={`absolute inset-x-0 bottom-0 z-30 transition-[transform,opacity] duration-200 motion-reduce:transition-none ${
            controlsVisible
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-2 opacity-0"
          }`}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onMouseEnter={revealControls}
        >
          <div className="from-background/95 via-background/55 pointer-events-none absolute inset-0 bg-gradient-to-t to-transparent" />
          <div className="relative px-3 pb-3 sm:px-4">
            <div className="border-border bg-background/80 text-foreground flex h-10 items-center gap-2 rounded-md border px-2 backdrop-blur-xl sm:gap-3">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={CONTROL_BUTTON_CLASS}
                aria-label={
                  playing ? t("Live.player.pause") : t("Live.player.play")
                }
                title={playing ? t("Live.player.pause") : t("Live.player.play")}
                disabled={!ready || loading}
                onClick={togglePlay}
              >
                {playing ? (
                  <Pause className="fill-current" />
                ) : (
                  <Play className="fill-current" />
                )}
              </Button>

              <div className="ml-auto flex items-center gap-2 sm:gap-3">
                <div className="relative">
                  <button
                    type="button"
                    className="text-foreground/90 hover:text-foreground focus-visible:ring-ring flex h-8 min-w-12 items-center justify-center gap-1 rounded-sm px-1 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
                    aria-label={t("Live.player.protocol")}
                    aria-haspopup={
                      availableProtocols.length > 1 ? "menu" : undefined
                    }
                    aria-expanded={
                      availableProtocols.length > 1
                        ? protocolMenuOpen
                        : undefined
                    }
                    title={t("Live.player.protocol")}
                    disabled={availableProtocols.length === 0}
                    onClick={() => {
                      if (availableProtocols.length <= 1) return;
                      setQualityMenuOpen(false);
                      setVolumePanelOpen(false);
                      setProtocolMenuOpen((open) => !open);
                    }}
                  >
                    <span>{protocolName(activeProtocol)}</span>
                    {availableProtocols.length > 1 ? (
                      <Check
                        className={`size-3 transition-opacity ${
                          protocolMenuOpen ? "opacity-100" : "opacity-0"
                        }`}
                      />
                    ) : null}
                  </button>
                  {protocolMenuOpen ? (
                    <div
                      role="menu"
                      aria-label={t("Live.player.protocol")}
                      className="border-border bg-popover/95 text-popover-foreground absolute right-0 bottom-full z-40 mb-2 w-28 rounded-md border p-1.5 shadow-2xl backdrop-blur-md"
                    >
                      <div className="text-muted-foreground px-2 py-1 text-xs">
                        {t("Live.player.protocol")}
                      </div>
                      <div className="grid gap-1">
                        {availableProtocols.map((protocol) => (
                          <button
                            key={protocol}
                            type="button"
                            role="menuitemradio"
                            aria-checked={activeProtocol === protocol}
                            className="text-popover-foreground/85 hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex h-8 items-center justify-between rounded-md px-2 text-xs focus-visible:ring-2 focus-visible:outline-none"
                            onClick={() => selectProtocol(protocol)}
                          >
                            <span>{protocolName(protocol)}</span>
                            {activeProtocol === protocol ? (
                              <Check className="size-3.5 text-[var(--player-accent)]" />
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                {qualityOptions.length > 0 ? (
                  <div className="relative">
                    <button
                      type="button"
                      className={`text-foreground/90 hover:text-foreground focus-visible:ring-ring flex h-8 items-center gap-1 rounded-sm px-1 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none ${
                        qualityLocked ? "cursor-not-allowed opacity-55" : ""
                      }`}
                      aria-label={
                        qualityLocked
                          ? t("Live.quality.locked")
                          : t("Live.player.quality")
                      }
                      aria-disabled={qualityLocked}
                      aria-haspopup={qualityLocked ? undefined : "menu"}
                      aria-expanded={
                        qualityLocked ? undefined : qualityMenuOpen
                      }
                      title={
                        qualityLocked
                          ? t("Live.quality.locked")
                          : t("Live.player.quality")
                      }
                      disabled={!qualityLocked && playerLoading}
                      onClick={() => {
                        if (qualityLocked) {
                          onQualityLocked();
                          return;
                        }
                        setProtocolMenuOpen(false);
                        setVolumePanelOpen(false);
                        setQualityMenuOpen((open) => !open);
                      }}
                    >
                      {qualityLocked ? (
                        <Lock className="size-3.5" />
                      ) : (
                        <Settings2 className="size-3.5" />
                      )}
                      <span>
                        {currentQuality?.label ??
                          currentQualityLabel ??
                          t("Live.quality.default")}
                      </span>
                    </button>
                    {!qualityLocked && qualityMenuOpen ? (
                      <div
                        role="menu"
                        aria-label={t("Live.player.quality")}
                        className="border-border bg-popover/95 text-popover-foreground absolute right-0 bottom-full z-40 mb-2 w-32 rounded-md border p-1.5 shadow-2xl backdrop-blur-md"
                      >
                        <div className="text-muted-foreground px-2 py-1 text-xs">
                          {t("Live.player.quality")}
                        </div>
                        <div className="grid gap-1">
                          {qualityOptions.map((quality) => (
                            <button
                              key={quality.id}
                              type="button"
                              role="menuitemradio"
                              aria-checked={quality.id === currentQuality?.id}
                              className="text-popover-foreground/85 hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex h-8 items-center justify-between rounded-md px-2 text-xs focus-visible:ring-2 focus-visible:outline-none"
                              onClick={() => selectQuality(quality.id)}
                            >
                              <span>{quality.label}</span>
                              {quality.id === currentQuality?.id ? (
                                <Check className="size-3.5 text-[var(--player-accent)]" />
                              ) : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div
                  className="relative flex h-8 items-center"
                  onMouseEnter={() => {
                    setProtocolMenuOpen(false);
                    setQualityMenuOpen(false);
                    setVolumePanelOpen(true);
                  }}
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
                      muted || volume === 0
                        ? t("Live.player.unmute")
                        : t("Live.player.mute")
                    }
                    title={
                      muted || volume === 0
                        ? t("Live.player.unmute")
                        : t("Live.player.mute")
                    }
                    onClick={toggleMuted}
                  >
                    {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
                  </Button>
                  {volumePanelOpen ? (
                    <div className="absolute bottom-full left-1/2 z-40 -translate-x-1/2 pb-2">
                      <div className="border-border bg-popover/95 flex w-10 flex-col items-center gap-2 rounded-md border px-1 py-2.5 shadow-xl backdrop-blur-xl">
                        <span className="text-foreground/80 text-[11px] font-medium tabular-nums">
                          {Math.round((muted ? 0 : volume) * 100)}
                        </span>
                        <Slider
                          aria-label={t("Live.player.volume")}
                          aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
                          orientation="vertical"
                          className="[&_[data-slot=slider-thumb]]:bg-background [&_[data-slot=slider-track]]:bg-foreground/20 data-[orientation=vertical]:h-28 data-[orientation=vertical]:min-h-28 data-[orientation=vertical]:w-6 [&_[data-slot=slider-range]]:bg-[var(--player-accent)] [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-[var(--player-accent)]"
                          value={[muted ? 0 : volume]}
                          max={1}
                          step={0.02}
                          onValueChange={([value]) => {
                            setVolume(value);
                            setMuted(value === 0);
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className={CONTROL_BUTTON_CLASS}
                  aria-label={t("Live.player.refresh")}
                  title={t("Live.player.refresh")}
                  onClick={() => void refreshPlayback()}
                  disabled={refreshing}
                >
                  {refreshing ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <RefreshCw />
                  )}
                </Button>

                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className={CONTROL_BUTTON_CLASS}
                  aria-label={
                    fullscreen
                      ? t("Live.player.exitFullscreen")
                      : t("Live.player.fullscreen")
                  }
                  title={
                    fullscreen
                      ? t("Live.player.exitFullscreen")
                      : t("Live.player.fullscreen")
                  }
                  onClick={() => void toggleFullscreen()}
                >
                  {fullscreen ? <Minimize /> : <Maximize />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
