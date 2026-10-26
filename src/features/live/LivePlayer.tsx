import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type HlsType from "hls.js";
import {
  LoaderCircle,
  Maximize,
  MessageSquare,
  MessageSquareOff,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/composables";
import LiveQualityMenu from "@/features/live/LiveQualityMenu";
import { formatCompactCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  LivePlaybackQuality,
  LivePlaybackSession,
  LiveRoomDetail,
} from "@/shared/bili.types";

interface LivePlayerProps {
  session: LivePlaybackSession;
  room: LiveRoomDetail;
  autoPlay: boolean;
  chatOpen: boolean;
  onReady: () => void;
  onReconnect: () => void;
  onRequestQuality: (
    quality: LivePlaybackQuality,
    wasPlaying: boolean
  ) => void;
  onToggleChat: () => void;
}

function isEditableElement(element: EventTarget | null) {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

export default function LivePlayer({
  session,
  room,
  autoPlay,
  chatOpen,
  onReady,
  onReconnect,
  onRequestQuality,
  onToggleChat,
}: LivePlayerProps) {
  const { lang, t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const readyRef = useRef(false);
  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [streamFailed, setStreamFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    const playbackUrl = session.playbackUrl;
    if (!video || !playbackUrl) return;

    let disposed = false;
    let hls: HlsType | null = null;
    let usingNativeHls = false;
    let networkRetries = 0;
    let mediaRetries = 0;
    readyRef.current = false;
    setBuffering(true);
    setStreamFailed(false);

    const markReady = () => {
      if (disposed || readyRef.current) return;
      readyRef.current = true;
      setBuffering(false);
      if (autoPlayRef.current) {
        void video.play().catch(() => setPlaying(false));
      } else {
        video.pause();
      }
      onReady();
    };

    const failStream = () => {
      if (disposed) return;
      setBuffering(false);
      setStreamFailed(true);
    };

    const onLoadedMetadata = () => {
      if (usingNativeHls) markReady();
    };
    const onPlaying = () => {
      setPlaying(true);
      setBuffering(false);
    };
    const onPause = () => setPlaying(false);
    const onWaiting = () => setBuffering(true);
    const onVolumeChange = () => {
      setVolume(video.volume);
      setMuted(video.muted);
    };
    const onVideoError = () => {
      if (!hls || usingNativeHls) failStream();
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("volumechange", onVolumeChange);
    video.addEventListener("error", onVideoError);

    const initialize = async () => {
      const { default: Hls } = await import("hls.js");
      if (disposed) return;
      if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 30,
          liveSyncDurationCount: 3,
        });
        hls.on(Hls.Events.MANIFEST_PARSED, markReady);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (import.meta.env.DEV) {
            console.warn("[live-hls] fatal error", {
              type: data.type,
              details: data.details,
              reason: data.reason,
              responseCode: data.response?.code,
            });
          }
          if (
            data.type === Hls.ErrorTypes.NETWORK_ERROR &&
            networkRetries < 2
          ) {
            networkRetries += 1;
            hls?.startLoad();
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 1) {
            mediaRetries += 1;
            hls?.recoverMediaError();
            return;
          }
          failStream();
        });
        hls.loadSource(playbackUrl);
        hls.attachMedia(video);
        return;
      }

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        usingNativeHls = true;
        video.src = playbackUrl;
        video.load();
        return;
      }

      failStream();
    };

    void initialize().catch(failStream);

    return () => {
      disposed = true;
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("volumechange", onVolumeChange);
      video.removeEventListener("error", onVideoError);
      hls?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [onReady, session.playbackUrl]);

  useEffect(() => {
    const onFullscreen = () =>
      setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video || streamFailed) return;
    if (video.paused) void video.play().catch(() => setPlaying(false));
    else video.pause();
  };

  const changeVolume = (amount: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.min(1, Math.max(0, video.volume + amount));
    video.muted = false;
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await containerRef.current?.requestFullscreen();
  };

  const togglePictureInPicture = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (
      isEditableElement(event.target) ||
      event.target instanceof HTMLButtonElement ||
      event.target instanceof HTMLAnchorElement
    ) {
      return;
    }

    const key = event.key.toLowerCase();
    if (event.key === " " || key === "k") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      changeVolume(0.1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      changeVolume(-0.1);
    } else if (key === "m") {
      const video = videoRef.current;
      if (video) video.muted = !video.muted;
    } else if (key === "c") {
      event.preventDefault();
      onToggleChat();
    } else if (key === "f") {
      event.preventDefault();
      void toggleFullscreen();
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="group relative isolate size-full min-h-0 overflow-hidden bg-black text-white outline-none"
      aria-label={room.room.title}
      aria-busy={buffering}
    >
      <video
        ref={videoRef}
        data-testid="live-video"
        className="absolute inset-0 size-full bg-black object-contain"
        poster={room.room.keyframeUrl || room.room.coverUrl}
        playsInline
        preload="metadata"
        onClick={togglePlayback}
        onDoubleClick={() => void toggleFullscreen()}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/75 to-transparent px-3 pt-3 pb-10">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-red-600 px-1.5 py-1 text-[10px] font-bold text-white">
            <span className="size-1.5 animate-pulse rounded-full bg-white" />
            LIVE
          </span>
          <span className="min-w-0 truncate text-xs font-medium text-white/90">
            {room.room.anchorName}
          </span>
          <span className="shrink-0 text-[10px] text-white/55">
            {room.room.areaName}
          </span>
          <span className="shrink-0 text-[10px] text-white/55 tabular-nums">
            {formatCompactCount(room.room.online, lang)}
          </span>
        </div>
      </div>

      {buffering && !streamFailed && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/20">
          <LoaderCircle className="size-8 animate-spin text-white/80" />
        </div>
      )}

      {streamFailed && (
        <div
          role="alert"
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/80 px-8 text-center"
        >
          <p className="text-sm text-white/80">{t("Live.player.streamError")}</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onReconnect}
          >
            <RotateCcw className="size-3.5" />
            {t("Live.player.reconnect")}
          </Button>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pt-14 pb-2">
        <div
          data-testid="live-player-controls"
          className="flex min-w-0 items-center gap-1"
        >
          <button
            type="button"
            onClick={togglePlayback}
            title={playing ? t("Player.pause") : t("Player.play")}
            aria-label={playing ? t("Player.pause") : t("Player.play")}
            className="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-white/15"
          >
            {playing ? (
              <Pause className="size-4 fill-current" />
            ) : (
              <Play className="ml-0.5 size-4 fill-current" />
            )}
          </button>

          <div className="group/volume flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.muted = !muted;
                }
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

          <span className="text-[10px] font-medium tracking-wide text-white/55">
            {t("Live.player.latency")}
          </span>

          <div className="ml-auto flex min-w-0 items-center justify-end gap-1">
            <LiveQualityMenu
              current={session.selectedQuality}
              qualities={session.qualities}
              open={qualityOpen}
              onOpenChange={setQualityOpen}
              onSelect={(quality) => {
                const video = videoRef.current;
                const wasPlaying = Boolean(video && !video.paused);
                video?.pause();
                onRequestQuality(quality, wasPlaying);
              }}
            />
            <button
              type="button"
              onClick={onToggleChat}
              title={
                chatOpen ? t("Live.chat.hide") : t("Live.chat.show")
              }
              aria-label={
                chatOpen ? t("Live.chat.hide") : t("Live.chat.show")
              }
              aria-pressed={chatOpen}
              className={cn(
                "flex size-8 items-center justify-center rounded-md transition-colors hover:bg-white/15",
                chatOpen ? "bg-white/10 text-white" : "text-white/65"
              )}
            >
              {chatOpen ? (
                <MessageSquare className="size-4" />
              ) : (
                <MessageSquareOff className="size-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => void togglePictureInPicture()}
              title={t("Player.pictureInPicture")}
              aria-label={t("Player.pictureInPicture")}
              className="hidden size-8 items-center justify-center rounded-md hover:bg-white/15 sm:flex"
            >
              <PictureInPicture2 className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              title={
                fullscreen
                  ? t("Player.exitFullscreen")
                  : t("Player.fullscreen")
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
    </div>
  );
}
