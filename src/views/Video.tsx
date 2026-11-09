import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";

import {
  getVideoDetail,
  getVideoPlayback,
  saveLocalHistory,
  type PlaybackInfo,
  type VideoDetail,
} from "@/api/media";
import { asCommandError, type CommandError } from "@/api/account";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "@/composables";
import { useAccount } from "@/contexts/account-context";
import { useNavigatorContext } from "@/contexts/navigator";
import { formatCount } from "@/lib/format";
import { createLogger } from "@/lib/logger";
import { commandErrorMessage } from "@/lib/command-error";

import { useParams } from "react-router";

const log = createLogger("Media/Video");
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const CONTROL_BUTTON_CLASS =
  "size-8 rounded-sm text-white hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/80";
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

export default function VideoView() {
  const { videoId = "" } = useParams();
  const { navigator } = useNavigatorContext();
  const { t } = useI18n();
  const { openLogin } = useAccount();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const [streamIndex, setStreamIndex] = useState(0);
  const [error, setError] = useState<CommandError | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPictureInPicture, setIsPictureInPicture] = useState(false);
  const [pictureInPictureSupported, setPictureInPictureSupported] =
    useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [volumePanelOpen, setVolumePanelOpen] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const surfaceClickTimer = useRef<number | null>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const loadedStreamKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setPlayback(null);
    try {
      const videoDetail = await getVideoDetail(videoId);
      log.info("detail loaded", {
        videoId,
        resolvedId: videoDetail.card.videoId,
        title: videoDetail.card.title,
        pageCount: videoDetail.pages.length,
        firstCid: videoDetail.pages[0]?.cid,
      });
      setDetail(videoDetail);
      const page = videoDetail.pages[0];
      if (!page) throw new Error("No playable page");
      const info = await getVideoPlayback(videoId, page.cid);
      log.info("playback loaded", {
        videoId,
        cid: info.cid,
        protocol: info.streams[0]?.protocol,
        quality: info.currentQuality.label,
        noticeKind: info.qualityNotice.kind,
        urlHost: info.streams[0] ? new URL(info.streams[0].url).host : null,
      });
      setDurationSeconds(Math.round(info.durationMs / 1000));
      if (!info.streams[0]) throw new Error("No playable stream");
      loadedStreamKey.current = null;
      setStreamIndex(0);
      setPlayback(info);
    } catch (err) {
      log.error("video load failed", { videoId, err });
      setError(asCommandError(err));
    }
  }, [videoId]);

  useEffect(() => {
    if (!detail || !playback || currentTime <= 5) return;
    const timer = window.setTimeout(() => {
      void saveLocalHistory(
        detail,
        playback.cid,
        detail.pages[0]?.title ?? detail.card.title,
        Math.floor(currentTime),
        durationSeconds
      )
        .then(() =>
          log.debug("history saved", {
            videoId: detail.card.videoId,
            cid: playback.cid,
          })
        )
        .catch((err) => log.warn("history save failed", err));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [currentTime, detail, durationSeconds, playback]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const video = videoRef.current;
    const stream = playback?.streams[streamIndex];
    if (!video || !stream) return;
    const streamKey = `${playback.videoId}:${playback.cid}:${stream.id}:${stream.url}`;
    if (loadedStreamKey.current === streamKey) return;
    loadedStreamKey.current = streamKey;
    setError(null);
    log.info("video source selected", {
      videoId: playback.videoId,
      streamId: stream.id,
      attempt: streamIndex + 1,
      total: playback.streams.length,
      urlHost: new URL(stream.url).host,
    });
    video.setAttribute("referrerpolicy", "no-referrer");
    video.src = stream.url;
    video.load();
  }, [playback, streamIndex]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = playbackRate;
      video.volume = volume;
      video.muted = muted;
    }
  }, [muted, playbackRate, volume]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreen = Boolean(document.fullscreenElement);
      setIsFullscreen(fullscreen);
      log.debug("fullscreen changed", { fullscreen });
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    setPictureInPictureSupported(
      Boolean(
        document.pictureInPictureEnabled &&
        video &&
        typeof video.requestPictureInPicture === "function"
      )
    );
    if (!video) return;

    const handleEnterPictureInPicture = () => {
      setIsPictureInPicture(true);
      log.debug("picture-in-picture entered");
    };
    const handleLeavePictureInPicture = () => {
      setIsPictureInPicture(false);
      log.debug("picture-in-picture left");
    };
    video.addEventListener(
      "enterpictureinpicture",
      handleEnterPictureInPicture
    );
    video.addEventListener(
      "leavepictureinpicture",
      handleLeavePictureInPicture
    );
    return () => {
      video.removeEventListener(
        "enterpictureinpicture",
        handleEnterPictureInPicture
      );
      video.removeEventListener(
        "leavepictureinpicture",
        handleLeavePictureInPicture
      );
    };
  }, []);

  const scheduleHideControls = useCallback(() => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    if (speedMenuOpen || volumePanelOpen) return;
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      setControlsVisible(false);
    }, 2400);
  }, [speedMenuOpen, volumePanelOpen]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHideControls();
  }, [scheduleHideControls]);

  useEffect(() => {
    if (!speedMenuOpen && !volumePanelOpen) return;
    setControlsVisible(true);
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSpeedMenuOpen(false);
      setVolumePanelOpen(false);
      revealControls();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [revealControls, speedMenuOpen, volumePanelOpen]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
      }
      if (surfaceClickTimer.current !== null) {
        window.clearTimeout(surfaceClickTimer.current);
      }
    };
  }, []);

  const duration = useMemo(() => {
    const fromResponse = playback?.durationMs ? playback.durationMs / 1000 : 0;
    const fromElement = videoRef.current?.duration ?? 0;
    return fromResponse || fromElement;
  }, [playback]);

  const qualityLabel = useMemo(() => {
    if (!playback) return "";
    return (
      QUALITY_LABELS[playback.currentQuality.id] ??
      playback.currentQuality.label
    );
  }, [playback]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch((err) => {
        log.error("play failed", { videoId: detail?.card.videoId, err });
        setError(asCommandError(err));
      });
    } else {
      video.pause();
    }
  };

  const toggleFullscreen = async () => {
    if (!playerRef.current) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await playerRef.current.requestFullscreen();
      }
    } catch (err) {
      log.warn("fullscreen toggle failed", { err });
    }
  };

  const togglePictureInPicture = async () => {
    const video = videoRef.current;
    if (
      !video ||
      !document.pictureInPictureEnabled ||
      typeof video.requestPictureInPicture !== "function"
    ) {
      log.warn("picture-in-picture unsupported");
      return;
    }
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      log.warn("picture-in-picture toggle failed", { err });
    }
  };

  const changePlaybackRate = (rate: number) => {
    setPlaybackRate(rate);
    setSpeedMenuOpen(false);
    log.info("playback rate changed", { rate });
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
      togglePlay();
    }, 280);
  };

  const handleSurfaceDoubleClick = () => {
    cancelPendingSurfaceClick();
    void toggleFullscreen();
  };

  const toggleMute = () => {
    setMuted((value) => !value);
  };

  const changeVolume = (value: number) => {
    setVolume(value);
    setMuted(value === 0);
  };

  return (
    <div className="stack-3 h-full p-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigator("/")}>
          <ArrowLeft />
        </Button>
        <span className="truncate text-sm font-medium">
          {detail?.card.title ?? "Bilibili UGC"}
        </span>
      </div>
      <div
        ref={playerRef}
        className="relative aspect-video w-full overflow-hidden rounded-lg bg-black [&:fullscreen]:aspect-auto [&:fullscreen]:h-screen [&:fullscreen]:w-screen [&:fullscreen]:rounded-none"
      >
        <video
          ref={videoRef}
          className="h-full w-full"
          controls={false}
          playsInline
          preload="auto"
          onPlay={() => {
            setError(null);
            setPlaying(true);
            log.debug("playback started", { videoId: detail?.card.videoId });
          }}
          onPause={() => {
            setPlaying(false);
            log.debug("playback paused", { videoId: detail?.card.videoId });
          }}
          onTimeUpdate={(event) =>
            setCurrentTime(event.currentTarget.currentTime)
          }
          onError={(event) => {
            const mediaError = event.currentTarget.error;
            const nextStream = playback?.streams[streamIndex + 1];
            log.error("video element failed", {
              videoId: detail?.card.videoId,
              streamId: playback?.streams[streamIndex]?.id,
              attempt: streamIndex + 1,
              total: playback?.streams.length,
              urlHost: playback?.streams[streamIndex]
                ? new URL(playback.streams[streamIndex].url).host
                : null,
              networkState: event.currentTarget.networkState,
              readyState: event.currentTarget.readyState,
              code: mediaError?.code,
              message: mediaError?.message,
            });
            if (nextStream) {
              log.warn("retrying fallback video source", {
                videoId: detail?.card.videoId,
                nextStreamId: nextStream.id,
                urlHost: new URL(nextStream.url).host,
              });
              setStreamIndex((index) => index + 1);
              return;
            }
            setError({
              code: "playbackError",
              message: mediaError?.message || "视频播放失败",
            });
          }}
        />

        {playback ? (
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

            {!playing ? (
              <button
                type="button"
                aria-label="播放"
                className="absolute top-1/2 left-1/2 z-10 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/45 text-white shadow-lg backdrop-blur-sm hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
                onClick={(event) => {
                  event.stopPropagation();
                  revealControls();
                  togglePlay();
                }}
              >
                <Play className="ml-0.5 size-7 fill-current" />
              </button>
            ) : null}

            <div
              className={`absolute inset-x-0 bottom-0 z-20 transition-[transform,opacity] duration-200 ${
                controlsVisible
                  ? "translate-y-0 opacity-100"
                  : "pointer-events-none translate-y-2 opacity-0"
              }`}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />
              <div className="relative">
                <Slider
                  aria-label="播放进度"
                  className="h-4 w-full [&_[data-slot=slider-range]]:bg-[var(--player-accent)] [&_[data-slot=slider-thumb]]:size-2 [&_[data-slot=slider-thumb]]:border-[var(--player-accent)] [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-track]]:h-[3px] [&_[data-slot=slider-track]]:rounded-none [&_[data-slot=slider-track]]:bg-white/25"
                  value={[Math.min(currentTime, duration)]}
                  max={duration || 1}
                  step={1}
                  onValueChange={([value]) => {
                    const video = videoRef.current;
                    if (video) video.currentTime = value;
                  }}
                />

                <div className="flex h-9 items-center gap-2 bg-black/20 px-3 sm:h-10 sm:gap-3 sm:px-4">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={`${CONTROL_BUTTON_CLASS} -ml-1`}
                    aria-label={playing ? "暂停" : "播放"}
                    title={playing ? "暂停" : "播放"}
                    onClick={togglePlay}
                  >
                    {playing ? (
                      <Pause className="fill-current" />
                    ) : (
                      <Play className="fill-current" />
                    )}
                  </Button>
                  <span className="text-xs font-medium whitespace-nowrap text-white/90 tabular-nums">
                    {formatPlayerTime(currentTime)} /{" "}
                    {formatPlayerTime(duration)}
                  </span>

                  <div className="ml-auto flex items-center gap-2 sm:gap-3">
                    {qualityLabel ? (
                      <span
                        className="hidden text-xs text-white/90 sm:inline"
                        title="当前清晰度"
                      >
                        {qualityLabel}
                      </span>
                    ) : null}

                    <div className="relative">
                      <button
                        type="button"
                        className="h-8 rounded-sm px-0.5 text-xs font-medium text-white/90 tabular-nums hover:text-white focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
                        aria-label={`播放速度 ${formatPlaybackRate(playbackRate)}`}
                        aria-haspopup="menu"
                        aria-expanded={speedMenuOpen}
                        title="播放速度"
                        onClick={() => setSpeedMenuOpen((open) => !open)}
                      >
                        {playbackRate === 1
                          ? "倍速"
                          : formatPlaybackRate(playbackRate)}
                      </button>
                      {speedMenuOpen ? (
                        <div
                          role="menu"
                          aria-label="播放速度"
                          className="absolute right-0 bottom-full z-30 mb-2 w-40 rounded-md border border-white/10 bg-black/95 p-1.5 text-white shadow-2xl backdrop-blur-md"
                        >
                          <div className="px-2 py-1 text-xs text-white/60">
                            播放速度
                          </div>
                          <div className="grid grid-cols-2 gap-1">
                            {PLAYBACK_RATES.map((rate) => (
                              <button
                                key={rate}
                                type="button"
                                role="menuitemradio"
                                aria-checked={rate === playbackRate}
                                className="flex h-8 items-center justify-between rounded-md px-2 text-xs text-white/85 tabular-nums hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
                                onClick={() => changePlaybackRate(rate)}
                              >
                                <span>{formatPlaybackRate(rate)}</span>
                                {rate === playbackRate ? (
                                  <Check className="size-3.5 text-[var(--player-accent)]" />
                                ) : null}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

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
                        aria-label={muted || volume === 0 ? "取消静音" : "静音"}
                        title={muted || volume === 0 ? "取消静音" : "静音"}
                        onClick={toggleMute}
                      >
                        {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
                      </Button>
                      {volumePanelOpen ? (
                        <div className="absolute right-0 bottom-full z-30 pb-2">
                          <div className="flex items-center rounded-md border border-white/10 bg-black/90 p-2 shadow-xl">
                            <Slider
                              aria-label="音量"
                              className="flex w-24 [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-white [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-track]]:bg-white/25"
                              value={[muted ? 0 : volume]}
                              max={1}
                              step={0.05}
                              onValueChange={([value]) => changeVolume(value)}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {pictureInPictureSupported ? (
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
        ) : null}
      </div>
      {playback && playback.qualityNotice.kind !== "none" ? (
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
          <span>
            {t(`Quality.notice.${playback.qualityNotice.messageCode}`)}
          </span>
          {playback.qualityNotice.kind === "loginRequired" ||
          playback.qualityNotice.kind === "accountExpired" ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => openLogin()}
            >
              {t("Account.titlebar.login")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div className="text-destructive flex flex-wrap items-center gap-2 text-sm">
          <span>{commandErrorMessage(error, t)}</span>
          {error.code === "authRequired" || error.code === "loginExpired" ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => openLogin()}
            >
              {t("Account.titlebar.login")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {detail ? (
        <div className="stack-2 border-border/60 bg-card rounded-lg border p-4">
          <div className="stack-1">
            <span className="text-muted-foreground text-xs">
              {detail.card.owner?.name ?? "Unknown"} ·{" "}
              {formatCount(detail.card.stats.view)}播放
            </span>
            <p className="text-muted-foreground line-clamp-3 text-xs whitespace-pre-line">
              {detail.description || "No description"}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
