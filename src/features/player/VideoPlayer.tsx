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
  MessageSquarePlus,
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
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/composables";
import DanmakuComposer from "@/features/danmaku/DanmakuComposer";
import DanmakuCanvas, {
  type DanmakuSettings,
} from "@/features/danmaku/DanmakuCanvas";
import { formatDuration } from "@/lib/format";
import type { DanmakuItem, PlaybackSession } from "@/shared/bili.types";
import { cn } from "@/lib/utils";

interface DashPlayerApi extends MediaPlayerClass {
  getBitrateInfoListFor(type: "video"): Array<{
    qualityIndex: number;
    quality: number;
  }>;
  setQualityFor(type: "video", value: number): void;
}

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
  onToggleTheater: () => void;
  onProgress: (seconds: number) => void;
  onEnded: () => void;
  onDanmakuSent: (item: DanmakuItem) => void;
}

const PROGRESS_KEY_PREFIX = "ailicili:playback-progress:";
const CONTROL_HIDE_DELAY = 2200;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

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
  onToggleTheater,
  onProgress,
  onEnded,
  onDanmakuSent,
}: VideoPlayerProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<DashPlayerApi | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const lastHeartbeatRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [quality, setQuality] = useState("auto");
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [danmakuSettings, setDanmakuSettings] = useState<DanmakuSettings>({
    enabled: true,
    opacity: 0.9,
    fontScale: 1,
    area: 0.55,
    speed: 1,
    modes: [1, 4, 5],
    density: 100,
  });

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (!videoRef.current?.paused) setControlsVisible(false);
    }, CONTROL_HIDE_DELAY);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    let player: DashPlayerApi | null = null;

    const initialize = async () => {
      try {
        const { MediaPlayer } = await import("dashjs");
        if (disposed) return;
        player = MediaPlayer().create() as DashPlayerApi;
        playerRef.current = player;
        player.updateSettings({
          streaming: {
            abr: { autoSwitchBitrate: { video: true, audio: true } },
            buffer: { fastSwitchEnabled: true },
          },
        });
        player.on("streamInitialized", () => {
          setBuffering(false);
          const videoElement = videoRef.current;
          if (!videoElement) return;
          void videoElement.play().catch(() => setPlaying(false));
        });
        player.on("bufferStateChanged", (event) => {
          const state = (event as { state?: string }).state;
          setBuffering(Boolean(state && state !== "bufferLoaded"));
        });
        player.on("error", () => {
          setBuffering(false);
          setError("Player.streamError");
        });

        const initial = Math.min(
          Math.max(0, getInitialProgress(bvid, cid, startAt)),
          Math.max(0, durationSeconds - 3)
        );
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
  }, [bvid, cid, durationSeconds, session.mpdUrl, startAt]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const initial = Math.min(
      Math.max(10, startAt),
      Math.max(10, durationSeconds - 3)
    );
    if (initial > 10) video.currentTime = initial;
  }, [durationSeconds, startAt]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTimeUpdate = () => {
      const time = video.currentTime;
      setCurrentTime(time);
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
      saveLocalProgress(bvid, cid, duration);
      onEnded();
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
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLTextAreaElement
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

  const changeQuality = (value: string) => {
    setQuality(value);
    const player = playerRef.current;
    if (!player) return;
    if (value === "auto") {
      player.updateSettings({
        streaming: { abr: { autoSwitchBitrate: { video: true } } },
      });
      return;
    }
    const target = Number(value);
    const bitrate = player
      .getBitrateInfoListFor("video")
      .find((item) => item.quality === target);
    if (bitrate) {
      player.updateSettings({
        streaming: { abr: { autoSwitchBitrate: { video: false } } },
      });
      player.setQualityFor("video", bitrate.qualityIndex);
    }
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseMove={showControls}
      onMouseLeave={() => playing && setControlsVisible(false)}
      className={cn(
        "group relative isolate size-full min-h-0 overflow-hidden rounded-lg bg-black text-white outline-none",
        fullscreen && "rounded-none",
        theater && "shadow-lg"
      )}
      aria-label={title}
    >
      <video
        ref={videoRef}
        data-testid="video-player"
        className="size-full bg-black object-contain"
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
        settings={danmakuSettings}
      />

      {buffering && !error && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/15">
          <LoaderCircle className="size-8 animate-spin text-white/85" />
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

      {!playing && !buffering && !error && (
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
          controlsVisible || !playing || settingsOpen
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

        <div className="mt-2 flex items-center gap-1.5">
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
          <span className="ml-1 font-mono text-[11px] text-white/90 tabular-nums">
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setComposerOpen(false);
                setSettingsOpen((value) => !value);
              }}
              title={t("Player.settings")}
              aria-label={t("Player.settings")}
              className="flex size-8 items-center justify-center rounded-md hover:bg-white/15"
            >
              <Settings2 className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setSettingsOpen(false);
                setComposerOpen((value) => !value);
              }}
              title={t("Player.sendDanmaku")}
              aria-label={t("Player.sendDanmaku")}
              aria-pressed={composerOpen}
              className={cn(
                "flex size-8 items-center justify-center rounded-md hover:bg-white/15",
                composerOpen && "bg-white/15"
              )}
            >
              <MessageSquarePlus className="size-4" />
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

      {composerOpen && (
        <div className="absolute inset-x-3 bottom-14 z-40">
          <DanmakuComposer
            aid={aid}
            cid={cid}
            bvid={bvid}
            currentTime={currentTime}
            onSent={onDanmakuSent}
          />
        </div>
      )}

      {settingsOpen && (
        <div className="absolute right-3 bottom-14 z-40 max-h-[calc(100%-4.5rem)] w-[min(22rem,calc(100%-1.5rem))] overflow-y-auto rounded-md border border-white/15 bg-neutral-950/95 p-4 text-xs shadow-2xl backdrop-blur-md">
          <div className="grid grid-cols-[82px_1fr] items-center gap-x-3 gap-y-3">
            <label htmlFor="player-quality">{t("Player.quality")}</label>
            <select
              id="player-quality"
              value={quality}
              onChange={(event) => changeQuality(event.currentTarget.value)}
              className="h-8 rounded-sm border border-white/20 bg-neutral-900 px-2 text-xs outline-none focus:border-white/50"
            >
              <option value="auto">{t("Player.auto")}</option>
              {session.qualities.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <label htmlFor="player-speed">{t("Player.speed")}</label>
            <select
              id="player-speed"
              value={speed}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                setSpeed(value);
                if (videoRef.current) videoRef.current.playbackRate = value;
              }}
              className="h-8 rounded-sm border border-white/20 bg-neutral-900 px-2 text-xs outline-none focus:border-white/50"
            >
              {SPEEDS.map((item) => (
                <option key={item} value={item}>
                  {item}x
                </option>
              ))}
            </select>
            <label htmlFor="danmaku-opacity">
              {t("Player.danmakuOpacity")}
            </label>
            <div className="flex items-center gap-2">
              <Switch
                id="danmaku-opacity"
                checked={danmakuSettings.enabled}
                onCheckedChange={(checked) =>
                  setDanmakuSettings((value) => ({
                    ...value,
                    enabled: checked,
                  }))
                }
              />
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={danmakuSettings.opacity}
                onChange={(event) =>
                  setDanmakuSettings((value) => ({
                    ...value,
                    opacity: Number(event.currentTarget.value),
                  }))
                }
                aria-label={t("Player.danmakuOpacity")}
                className="min-w-0 flex-1 accent-[var(--primary)]"
              />
            </div>
            <label htmlFor="danmaku-font">{t("Player.danmakuFontSize")}</label>
            <input
              id="danmaku-font"
              type="range"
              min={0.7}
              max={1.5}
              step={0.1}
              value={danmakuSettings.fontScale}
              onChange={(event) =>
                setDanmakuSettings((value) => ({
                  ...value,
                  fontScale: Number(event.currentTarget.value),
                }))
              }
              className="accent-[var(--primary)]"
            />
            <label htmlFor="danmaku-speed">{t("Player.danmakuSpeed")}</label>
            <input
              id="danmaku-speed"
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={danmakuSettings.speed}
              onChange={(event) =>
                setDanmakuSettings((value) => ({
                  ...value,
                  speed: Number(event.currentTarget.value),
                }))
              }
              className="accent-[var(--primary)]"
            />
            <label htmlFor="danmaku-area">{t("Player.danmakuArea")}</label>
            <input
              id="danmaku-area"
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={danmakuSettings.area}
              onChange={(event) =>
                setDanmakuSettings((value) => ({
                  ...value,
                  area: Number(event.currentTarget.value),
                }))
              }
              className="accent-[var(--primary)]"
            />
            <label htmlFor="danmaku-density">
              {t("Player.danmakuDensity")}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="danmaku-density"
                type="range"
                min={10}
                max={100}
                step={10}
                value={danmakuSettings.density}
                onChange={(event) =>
                  setDanmakuSettings((value) => ({
                    ...value,
                    density: Number(event.currentTarget.value),
                  }))
                }
                className="min-w-0 flex-1 accent-[var(--primary)]"
              />
              <span className="w-8 text-right tabular-nums">
                {danmakuSettings.density}%
              </span>
            </div>
            <span>{t("Player.danmakuTypes")}</span>
            <div className="flex gap-3">
              {(
                [
                  [1, "Danmaku.rolling"],
                  [4, "Danmaku.bottom"],
                  [5, "Danmaku.top"],
                ] as const
              ).map(([type, label]) => (
                <label key={type} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={danmakuSettings.modes.includes(type)}
                    onChange={(event) =>
                      setDanmakuSettings((value) => ({
                        ...value,
                        modes: event.currentTarget.checked
                          ? ([...value.modes, type] as DanmakuItem["mode"][])
                          : value.modes.filter((mode) => mode !== type),
                      }))
                    }
                    className="accent-[var(--primary)]"
                  />
                  {t(label)}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
