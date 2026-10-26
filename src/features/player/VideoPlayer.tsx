import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { MediaPlayerClass } from "dashjs";
import {
  LoaderCircle,
  Maximize,
  MessageSquareOff,
  MessageSquareText,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Settings2,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n, useToast } from "@/composables";
import DanmakuComposer from "@/features/danmaku/DanmakuComposer";
import DanmakuCanvas from "@/features/danmaku/DanmakuCanvas";
import PlayerQualityMenu from "@/features/player/PlayerQualityMenu";
import PlayerSettingsDialog from "@/features/player/PlayerSettingsDialog";
import PlayerSpeedMenu from "@/features/player/PlayerSpeedMenu";
import {
  createDefaultPlayerPreferences,
  readPlayerPreferences,
  savePlayerPreferences,
  type PlayerPreferences,
} from "@/features/player/playerPreferences";
import { formatDuration } from "@/lib/format";
import type {
  DanmakuItem,
  PlaybackQuality,
  PlaybackSession,
  VideoPart,
} from "@/shared/bili.types";
import { cn } from "@/lib/utils";

interface VideoPlayerProps {
  session: PlaybackSession;
  aid: number;
  bvid: string;
  cid: number;
  title: string;
  posterUrl: string;
  durationSeconds: number;
  startAt: number;
  danmaku: DanmakuItem[];
  theater: boolean;
  parts: VideoPart[];
  activeCid: number;
  onSelectPart: (part: VideoPart) => void;
  onToggleTheater: () => void;
  onProgress: (seconds: number) => void;
  onEnded: () => void;
  onDanmakuSent: (item: DanmakuItem) => void;
}

const PROGRESS_KEY_PREFIX = "ailicili:playback-progress:";
const CONTROL_HIDE_DELAY = 2200;
const QUALITY_SWITCH_SETTLE_DELAY = 320;
const QUALITY_SWITCH_TIMEOUT = 6500;

interface PendingQualitySwitch {
  previousQuality: string;
  expectedRepresentationId: string | null;
  waitForRepresentation: boolean;
  wasPlaying: boolean;
  timeoutId: number;
}

interface QualitySwitchingState {
  targetLabel: string;
  autoResume: boolean;
}

function isEditableElement(element: Element | null) {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  );
}

function isPlayerEditorElement(element: Element | null) {
  return (
    element instanceof HTMLElement &&
    Boolean(element.closest("[data-player-editor], [data-player-popover]"))
  );
}

function readLocalProgress(bvid: string, cid: number) {
  try {
    const value = Number(
      window.localStorage.getItem(`${PROGRESS_KEY_PREFIX}${bvid}:${cid}`)
    );
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function saveLocalProgress(bvid: string, cid: number, seconds: number) {
  try {
    window.localStorage.setItem(
      `${PROGRESS_KEY_PREFIX}${bvid}:${cid}`,
      String(Math.max(0, Math.floor(seconds)))
    );
  } catch {
    // Progress persistence is optional when storage is unavailable.
  }
}

function getInitialProgress(bvid: string, cid: number, serverStart: number) {
  const local = readLocalProgress(bvid, cid);
  if (serverStart > 10 && Math.abs(serverStart - local) > 30)
    return serverStart;
  return local > 10 ? local : serverStart;
}

function applyDashPreferences(
  player: MediaPlayerClass,
  preferences: PlayerPreferences,
  qualities: PlaybackQuality[]
) {
  try {
    player.updateSettings({
      streaming: {
        abr: {
          autoSwitchBitrate: {
            video: preferences.quality === "auto",
            audio: true,
          },
        },
        buffer: {
          fastSwitchEnabled: preferences.fastSwitchEnabled,
          flushBufferAtTrackSwitch: true,
        },
      },
    });

    if (preferences.quality === "auto") return;
    const quality = qualities.find(
      (item) => String(item.id) === preferences.quality
    );
    if (!quality) return;
    player.setRepresentationForTypeById("video", `video-${quality.id}`, true);
  } catch {
    // dash.js can reject updates before stream initialization; retry later.
  }
}

export default function VideoPlayer({
  session,
  aid,
  bvid,
  cid,
  title,
  posterUrl,
  durationSeconds,
  startAt,
  danmaku,
  theater,
  parts,
  activeCid,
  onSelectPart,
  onToggleTheater,
  onProgress,
  onEnded,
  onDanmakuSent,
}: VideoPlayerProps) {
  const { t } = useI18n();
  const { error: toastError } = useToast();
  const toastErrorRef = useRef(toastError);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<MediaPlayerClass | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const pendingQualitySwitchRef = useRef<PendingQualitySwitch | null>(null);
  const resumeTimerRef = useRef<number | null>(null);
  const lastHeartbeatRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [qualitySwitching, setQualitySwitching] =
    useState<QualitySwitchingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<PlayerPreferences>(() => {
    const stored = readPlayerPreferences();
    const qualityAvailable =
      stored.quality === "auto" ||
      session.qualities.some((item) => String(item.id) === stored.quality);
    return qualityAvailable ? stored : { ...stored, quality: "auto" };
  });
  const preferencesRef = useRef(preferences);
  toastErrorRef.current = toastError;

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    if (!preferencesRef.current.autoHideControls) return;
    hideTimerRef.current = window.setTimeout(() => {
      const activeElement = document.activeElement;
      if (
        !videoRef.current?.paused &&
        !isEditableElement(activeElement) &&
        !isPlayerEditorElement(activeElement)
      ) {
        setControlsVisible(false);
      }
    }, CONTROL_HIDE_DELAY);
  }, []);

  const updatePreferences = useCallback(
    (update: (current: PlayerPreferences) => PlayerPreferences) => {
      setPreferences((current) => {
        const next = update(current);
        preferencesRef.current = next;
        return next;
      });
    },
    []
  );

  const finishQualitySwitch = useCallback(
    (outcome: "success" | "failure" | "cancel") => {
      const pending = pendingQualitySwitchRef.current;
      if (!pending) return;

      pendingQualitySwitchRef.current = null;
      window.clearTimeout(pending.timeoutId);
      setQualitySwitching(null);

      if (outcome === "failure") {
        updatePreferences((current) => ({
          ...current,
          quality: pending.previousQuality,
        }));
        toastErrorRef.current("Player.quality.switchFailed");
      }

      if (outcome !== "cancel" && pending.wasPlaying) {
        if (resumeTimerRef.current) {
          window.clearTimeout(resumeTimerRef.current);
        }
        resumeTimerRef.current = window.setTimeout(
          () => {
            resumeTimerRef.current = null;
            const video = videoRef.current;
            if (!video) return;
            void video.play().catch(() => setPlaying(false));
          },
          outcome === "success" ? 60 : 0
        );
      }
    },
    [updatePreferences]
  );

  const switchQuality = useCallback(
    (quality: string) => {
      if (
        quality === preferencesRef.current.quality ||
        pendingQualitySwitchRef.current
      ) {
        return;
      }

      const video = videoRef.current;
      const player = playerRef.current;
      if (!video) return;
      if (!player) {
        updatePreferences((current) => ({ ...current, quality }));
        return;
      }

      const selectedQuality = session.qualities.find(
        (item) => String(item.id) === quality
      );
      const targetLabel =
        quality === "auto"
          ? t("Player.auto")
          : (selectedQuality?.label ?? quality);
      const expectedRepresentationId =
        quality === "auto" ? null : `video-${quality}`;
      const wasPlaying = !video.paused && !video.ended;

      let waitForRepresentation = expectedRepresentationId !== null;
      if (expectedRepresentationId) {
        try {
          waitForRepresentation =
            player.getCurrentRepresentationForType("video")?.id !==
            expectedRepresentationId;
        } catch {
          waitForRepresentation = true;
        }
      }

      if (wasPlaying) video.pause();
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      setControlsVisible(true);
      setQualityMenuOpen(false);
      setSpeedMenuOpen(false);
      setSettingsOpen(false);
      setQualitySwitching({ targetLabel, autoResume: wasPlaying });

      const pending: PendingQualitySwitch = {
        previousQuality: preferencesRef.current.quality,
        expectedRepresentationId,
        waitForRepresentation,
        wasPlaying,
        timeoutId: 0,
      };
      pendingQualitySwitchRef.current = pending;
      pending.timeoutId = window.setTimeout(
        () =>
          finishQualitySwitch(waitForRepresentation ? "failure" : "success"),
        waitForRepresentation
          ? QUALITY_SWITCH_TIMEOUT
          : QUALITY_SWITCH_SETTLE_DELAY
      );

      updatePreferences((current) => ({ ...current, quality }));
    },
    [finishQualitySwitch, session.qualities, t, updatePreferences]
  );

  useEffect(() => {
    preferencesRef.current = preferences;
    savePlayerPreferences(preferences);
    if (videoRef.current) {
      videoRef.current.playbackRate = preferences.speed;
    }
    if (playerRef.current) {
      applyDashPreferences(playerRef.current, preferences, session.qualities);
    }
    if (!preferences.autoHideControls) {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      setControlsVisible(true);
    }
  }, [preferences, session.qualities]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    let player: MediaPlayerClass | null = null;

    const initialize = async () => {
      try {
        const { MediaPlayer } = await import("dashjs");
        if (disposed) return;
        player = MediaPlayer().create();
        playerRef.current = player;
        applyDashPreferences(player, preferencesRef.current, session.qualities);
        player.on("streamInitialized", () => {
          setBuffering(false);
          const videoElement = videoRef.current;
          if (!videoElement) return;
          if (!player) return;
          applyDashPreferences(
            player,
            preferencesRef.current,
            session.qualities
          );
          if (!preferencesRef.current.autoPlay) {
            videoElement.pause();
            setPlaying(false);
            return;
          }
          void videoElement.play().catch(() => setPlaying(false));
        });
        player.on("qualityChangeRendered", (event) => {
          const pending = pendingQualitySwitchRef.current;
          if (
            event.mediaType !== "video" ||
            !pending?.waitForRepresentation ||
            (pending.expectedRepresentationId &&
              event.newRepresentation.id !== pending.expectedRepresentationId)
          ) {
            return;
          }
          finishQualitySwitch("success");
        });
        player.on("bufferStateChanged", (event) => {
          const state = (event as { state?: string }).state;
          setBuffering(Boolean(state && state !== "bufferLoaded"));
        });
        player.on("error", () => {
          finishQualitySwitch("cancel");
          setBuffering(false);
          setError("Player.streamError");
        });

        const initial = preferencesRef.current.resumeProgress
          ? Math.min(
              Math.max(0, getInitialProgress(bvid, cid, startAt)),
              Math.max(0, durationSeconds - 3)
            )
          : 0;
        player.initialize(
          video,
          session.mpdUrl,
          false,
          initial > 10 ? initial : 0
        );
      } catch {
        setBuffering(false);
        setError("Player.initError");
      }
    };

    void initialize();
    return () => {
      disposed = true;
      playerRef.current = null;
      player?.destroy();
    };
  }, [
    bvid,
    cid,
    durationSeconds,
    finishQualitySwitch,
    session.mpdUrl,
    session.qualities,
    startAt,
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!preferencesRef.current.resumeProgress) {
      video.currentTime = 0;
      return;
    }
    const initial = Math.min(
      Math.max(0, getInitialProgress(bvid, cid, startAt)),
      Math.max(0, durationSeconds - 3)
    );
    if (initial > 10) video.currentTime = initial;
  }, [bvid, cid, durationSeconds, startAt]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTimeUpdate = () => {
      const time = video.currentTime;
      setCurrentTime(time);
      if (preferencesRef.current.syncProgress) {
        if (Math.floor(time) % 5 === 0) {
          saveLocalProgress(bvid, cid, time);
        }
        if (
          time - lastHeartbeatRef.current >= 15 ||
          time < lastHeartbeatRef.current
        ) {
          lastHeartbeatRef.current = time;
          onProgress(Math.floor(time));
        }
      }
    };
    const onLoadedMetadata = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration);
    };
    const onPlay = () => {
      setPlaying(true);
      showControls();
    };
    const onPause = () => {
      setPlaying(false);
      setControlsVisible(true);
    };
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onEndedEvent = () => {
      setPlaying(false);
      setControlsVisible(true);
      if (preferencesRef.current.syncProgress) {
        saveLocalProgress(bvid, cid, duration);
        onEnded();
      }
    };

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("ended", onEndedEvent);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("ended", onEndedEvent);
    };
  }, [bvid, cid, duration, onEnded, onProgress, showControls]);

  useEffect(() => {
    const onFullscreen = () =>
      setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  useEffect(
    () => () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
      if (pendingQualitySwitchRef.current) {
        window.clearTimeout(pendingQualitySwitchRef.current.timeoutId);
        pendingQualitySwitchRef.current = null;
      }
    },
    []
  );

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }, []);

  const seekBy = useCallback(
    (offset: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = Math.min(
        Math.max(0, video.currentTime + offset),
        Number.isFinite(video.duration) ? video.duration : duration
      );
      showControls();
    },
    [duration, showControls]
  );

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await containerRef.current?.requestFullscreen();
  }, []);

  const togglePictureInPicture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (qualitySwitching) return;
    if (settingsOpen || qualityMenuOpen || speedMenuOpen) return;
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLButtonElement
    ) {
      return;
    }
    if (event.key === " " || event.key.toLowerCase() === "k") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === "ArrowLeft" || event.key.toLowerCase() === "j") {
      event.preventDefault();
      seekBy(-5);
    } else if (event.key === "ArrowRight" || event.key.toLowerCase() === "l") {
      event.preventDefault();
      seekBy(5);
    } else if (event.key.toLowerCase() === "m") {
      const video = videoRef.current;
      if (video) video.muted = !video.muted;
    } else if (event.key.toLowerCase() === "f") {
      void toggleFullscreen();
    } else if (event.key.toLowerCase() === "t") {
      onToggleTheater();
    }
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseMove={showControls}
      onMouseLeave={() =>
        playing &&
        preferences.autoHideControls &&
        !isEditableElement(document.activeElement) &&
        !isPlayerEditorElement(document.activeElement) &&
        setControlsVisible(false)
      }
      className={cn(
        "group relative isolate size-full min-h-0 overflow-hidden bg-black text-white outline-none",
        fullscreen && "rounded-none",
        theater && "shadow-lg"
      )}
      aria-label={title}
      aria-busy={Boolean(qualitySwitching)}
    >
      <video
        ref={videoRef}
        data-testid="video-player"
        className="absolute inset-x-0 top-1/2 h-auto w-full -translate-y-1/2 bg-black"
        poster={posterUrl}
        playsInline
        preload="metadata"
        onClick={togglePlayback}
        onDoubleClick={() => void toggleFullscreen()}
        onVolumeChange={(event) => {
          setVolume(event.currentTarget.volume);
          setMuted(event.currentTarget.muted);
        }}
      />

      <DanmakuCanvas
        videoRef={videoRef}
        items={danmaku}
        settings={preferences.danmaku}
      />

      {buffering && !error && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/15">
          <LoaderCircle className="size-8 animate-spin text-white/85" />
        </div>
      )}

      {qualitySwitching && (
        <div
          data-testid="player-quality-switching"
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/65 px-6 backdrop-blur-sm"
        >
          <div className="flex max-w-sm min-w-64 items-center gap-3 rounded-md border border-white/10 bg-[#151515]/95 px-4 py-3 shadow-2xl">
            <span className="bg-primary/15 text-primary flex size-9 shrink-0 items-center justify-center rounded-md">
              <LoaderCircle className="size-4.5 animate-spin" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">
                {t("Player.quality.switching", {
                  quality: qualitySwitching.targetLabel,
                })}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-white/50">
                {t(
                  qualitySwitching.autoResume
                    ? "Player.quality.switchResume"
                    : "Player.quality.switchPaused"
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/75 px-8 text-center text-sm"
        >
          <p>{t("Player.playbackFailed")}</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => window.location.reload()}
          >
            <RotateCcw />
            {t("Player.retry")}
          </Button>
        </div>
      )}

      {!playing && !buffering && !error && !qualitySwitching && (
        <button
          type="button"
          onClick={togglePlayback}
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/10"
          aria-label={t("Player.play")}
        >
          <span className="flex size-16 items-center justify-center rounded-full bg-black/65 text-white shadow-xl backdrop-blur-sm">
            <Play className="ml-1 size-7 fill-current" />
          </span>
        </button>
      )}

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3 pt-12 pb-2 transition-opacity duration-200",
          controlsVisible ||
            !playing ||
            settingsOpen ||
            qualityMenuOpen ||
            speedMenuOpen ||
            qualitySwitching
            ? "opacity-100"
            : "pointer-events-none opacity-0"
        )}
      >
        <input
          type="range"
          min={0}
          max={Math.max(1, duration)}
          step={0.1}
          value={Math.min(currentTime, Math.max(1, duration))}
          onChange={(event) => {
            const value = Number(event.currentTarget.value);
            setCurrentTime(value);
            if (videoRef.current) videoRef.current.currentTime = value;
          }}
          aria-label={t("Player.progress")}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/30 accent-[var(--primary)]"
          style={{
            background: `linear-gradient(to right, var(--primary) ${progress}%, rgba(255,255,255,.3) ${progress}%)`,
          }}
        />

        <div
          data-testid="player-controls"
          className="mt-2 grid grid-cols-[auto_minmax(7rem,1fr)_auto] items-center gap-2"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={togglePlayback}
              title={playing ? t("Player.pause") : t("Player.play")}
              aria-label={playing ? t("Player.pause") : t("Player.play")}
              className="flex size-8 items-center justify-center rounded-md hover:bg-white/15"
            >
              {playing ? (
                <Pause className="size-4 fill-current" />
              ) : (
                <Play className="ml-0.5 size-4 fill-current" />
              )}
            </button>
            <div className="group/volume flex items-center">
              <button
                type="button"
                onClick={() => {
                  if (videoRef.current) videoRef.current.muted = !muted;
                }}
                title={muted ? t("Player.unmute") : t("Player.mute")}
                aria-label={muted ? t("Player.unmute") : t("Player.mute")}
                className="flex size-8 items-center justify-center rounded-md hover:bg-white/15"
              >
                {muted || volume === 0 ? (
                  <VolumeX className="size-4" />
                ) : volume < 0.5 ? (
                  <Volume1 className="size-4" />
                ) : (
                  <Volume2 className="size-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(event) => {
                  const video = videoRef.current;
                  if (!video) return;
                  video.muted = false;
                  video.volume = Number(event.currentTarget.value);
                }}
                aria-label={t("Player.volume")}
                className="w-0 cursor-pointer accent-white opacity-0 transition-all group-focus-within/volume:w-20 group-focus-within/volume:opacity-100 group-hover/volume:w-20 group-hover/volume:opacity-100"
              />
            </div>
            <span className="ml-1 hidden font-mono text-[11px] whitespace-nowrap text-white/90 tabular-nums md:inline">
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </span>
          </div>

          <div
            className="flex min-w-0 justify-center px-1"
            onFocusCapture={showControls}
            onPointerDown={showControls}
          >
            <DanmakuComposer
              aid={aid}
              cid={cid}
              bvid={bvid}
              currentTime={currentTime}
              portalContainer={containerRef.current}
              onSent={onDanmakuSent}
            />
          </div>

          <div className="flex min-w-0 items-center justify-end gap-1">
            {parts.length > 1 && (
              <div
                data-testid="player-parts"
                role="group"
                aria-label={t("Video.parts")}
                className="flex max-w-[min(24vw,14rem)] min-w-0 items-center gap-0.5 overflow-x-auto rounded-md bg-black/35 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {parts.map((part) => (
                  <button
                    key={part.cid}
                    type="button"
                    title={`P${part.page} · ${part.title}`}
                    aria-current={part.cid === activeCid ? "page" : undefined}
                    onClick={() => {
                      if (part.cid !== activeCid) onSelectPart(part);
                    }}
                    className={cn(
                      "flex h-6 shrink-0 items-center rounded-sm px-2 font-mono text-[11px] text-white/65 transition-colors hover:bg-white/15 hover:text-white",
                      part.cid === activeCid && "bg-white/15 text-white"
                    )}
                  >
                    P{part.page}
                  </button>
                ))}
              </div>
            )}
            <PlayerQualityMenu
              quality={preferences.quality}
              qualities={session.qualities}
              portalContainer={containerRef.current}
              open={qualityMenuOpen}
              onOpenChange={(open) => {
                setQualityMenuOpen(open);
                if (open) {
                  setSpeedMenuOpen(false);
                  setSettingsOpen(false);
                }
                showControls();
              }}
              onQualityChange={switchQuality}
            />
            <PlayerSpeedMenu
              speed={preferences.speed}
              portalContainer={containerRef.current}
              open={speedMenuOpen}
              onOpenChange={(open) => {
                setSpeedMenuOpen(open);
                if (open) {
                  setQualityMenuOpen(false);
                  setSettingsOpen(false);
                }
                showControls();
              }}
              onSpeedChange={(speed) => {
                updatePreferences((current) => ({ ...current, speed }));
                showControls();
              }}
            />
            <button
              type="button"
              onClick={() => {
                updatePreferences((current) => ({
                  ...current,
                  danmaku: {
                    ...current.danmaku,
                    enabled: !current.danmaku.enabled,
                  },
                }));
                showControls();
              }}
              title={
                preferences.danmaku.enabled
                  ? t("Player.danmaku.hide")
                  : t("Player.danmaku.show")
              }
              aria-label={
                preferences.danmaku.enabled
                  ? t("Player.danmaku.hide")
                  : t("Player.danmaku.show")
              }
              aria-pressed={preferences.danmaku.enabled}
              className={cn(
                "flex size-8 items-center justify-center rounded-md transition-colors hover:bg-white/15",
                preferences.danmaku.enabled
                  ? "bg-white/10 text-white"
                  : "text-white/65"
              )}
            >
              {preferences.danmaku.enabled ? (
                <MessageSquareText className="size-4" />
              ) : (
                <MessageSquareOff className="size-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setQualityMenuOpen(false);
                setSpeedMenuOpen(false);
                setSettingsOpen((value) => !value);
                showControls();
              }}
              title={t("Player.settings")}
              aria-label={t("Player.settings")}
              className="flex size-8 items-center justify-center rounded-md hover:bg-white/15"
            >
              <Settings2 className="size-4" />
            </button>
            <button
              type="button"
              onClick={onToggleTheater}
              title={t("Player.theater")}
              aria-label={t("Player.theater")}
              className={cn(
                "hidden size-8 items-center justify-center rounded-md hover:bg-white/15 sm:flex",
                theater && "bg-white/15"
              )}
            >
              <Maximize className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => void togglePictureInPicture()}
              title={t("Player.pictureInPicture")}
              aria-label={t("Player.pictureInPicture")}
              className="flex size-8 items-center justify-center rounded-md hover:bg-white/15"
            >
              <PictureInPicture2 className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              title={
                fullscreen ? t("Player.exitFullscreen") : t("Player.fullscreen")
              }
              aria-label={
                fullscreen ? t("Player.exitFullscreen") : t("Player.fullscreen")
              }
              className="flex size-8 items-center justify-center rounded-md hover:bg-white/15"
            >
              {fullscreen ? (
                <Minimize className="size-4" />
              ) : (
                <Maximize className="size-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      <PlayerSettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (open) {
            setQualityMenuOpen(false);
            setSpeedMenuOpen(false);
          }
        }}
        portalContainer={containerRef.current}
        preferences={preferences}
        qualities={session.qualities}
        onQualityChange={switchQuality}
        onPreferencesChange={updatePreferences}
        onReset={() =>
          updatePreferences(() => createDefaultPlayerPreferences())
        }
      />
    </div>
  );
}
