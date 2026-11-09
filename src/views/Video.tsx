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
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Settings2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useParams } from "react-router";

import {
  getVideoDetail,
  getVideoPlayback,
  saveLocalHistory,
  type PlaybackInfo,
  type StreamSource,
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
import { Container } from "@videojs/react";
import { Video, VideoPlayer, usePlayer } from "@videojs/react/video";
import {
  Audio,
  AudioPlayer,
  usePlayer as useAudioPlayer,
} from "@videojs/react/audio";

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

  render() {
    if (this.state.failed) {
      return (
        <div className="grid aspect-video w-full place-items-center rounded-lg bg-black text-white">
          <div className="flex flex-col items-center gap-3">
            <span className="text-sm">播放器初始化失败</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
            >
              重新加载
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
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
  stream: StreamSource;
  onStore: (store: AudioStore | null) => void;
  onCanPlay: (canPlay: boolean) => void;
}

function AudioTrack({ stream, onStore, onCanPlay }: AudioTrackProps) {
  const store = useAudioPlayer();
  const canPlay = useAudioPlayer((state) => state.canPlay);
  const currentSrc = useAudioPlayer((state) => state.currentSrc);

  useEffect(() => {
    onStore(store);
    return () => onStore(null);
  }, [onStore, store]);

  useEffect(() => {
    onCanPlay(canPlay && currentSrc === stream.audioUrl);
  }, [canPlay, currentSrc, onCanPlay, stream.audioUrl]);

  return (
    <Audio
      src={stream.audioUrl}
      preload="auto"
      className="hidden"
      ref={(element) => {
        element?.setAttribute("referrerpolicy", "no-referrer");
      }}
    />
  );
}

interface VideoStageProps {
  playback: PlaybackInfo;
  streamIndex: number;
  availableStreams: StreamSource[];
  onStreamIndexChange: (index: number) => void;
  onCurrentTimeChange: (time: number) => void;
  onPlaybackError: (message: string) => void;
}

function VideoStage({
  playback,
  streamIndex,
  availableStreams,
  onStreamIndexChange,
  onCurrentTimeChange,
  onPlaybackError,
}: VideoStageProps) {
  const videoStore = usePlayer();
  const paused = usePlayer((state) => state.paused);
  const currentTime = usePlayer((state) => state.currentTime);
  const playerDuration = usePlayer((state) => state.duration);
  const isSeeking = usePlayer((state) => state.seeking);
  const currentSrc = usePlayer((state) => state.currentSrc);
  const isFullscreen = usePlayer((state) => state.isFullscreen);
  const isPictureInPicture = usePlayer((state) => state.isPictureInPicture);
  const pictureInPictureAvailability = usePlayer(
    (state) => state.pictureInPictureAvailability
  );
  const mediaError = usePlayer((state) => state.error);

  const selectedStream = playback.streams[streamIndex];
  const needsAudio =
    selectedStream?.protocol === "dash" && Boolean(selectedStream.audioUrl);
  const audioStoreRef = useRef<AudioStore | null>(null);
  const [audioCanPlay, setAudioCanPlay] = useState(!needsAudio);
  const [isSwitchingQuality, setIsSwitchingQuality] = useState(false);
  const [wasPlaying, setWasPlaying] = useState(false);
  const targetTimeRef = useRef(0);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [volumePanelOpen, setVolumePanelOpen] = useState(false);
  const [volume, setVolume] = useState(1);
  const [userMuted, setUserMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const hideTimer = useRef<number | null>(null);
  const surfaceClickTimer = useRef<number | null>(null);

  const handleAudioStore = useCallback((store: AudioStore | null) => {
    audioStoreRef.current = store;
  }, []);

  const handleAudioCanPlay = useCallback((canPlayAudio: boolean) => {
    setAudioCanPlay(canPlayAudio);
  }, []);

  const scheduleHideControls = useCallback(() => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    if (speedMenuOpen || qualityMenuOpen || volumePanelOpen) return;
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      setControlsVisible(false);
    }, 2400);
  }, [qualityMenuOpen, speedMenuOpen, volumePanelOpen]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHideControls();
  }, [scheduleHideControls]);

  useEffect(() => {
    if (isSwitchingQuality || isSeeking) return;
    onCurrentTimeChange(currentTime);
  }, [currentTime, isSeeking, isSwitchingQuality, onCurrentTimeChange]);

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

  useEffect(() => {
    if (!mediaError) return;
    log.error("video playback failed", {
      videoId: playback.videoId,
      streamId: selectedStream?.id,
      currentSrc,
      code: mediaError.code,
      message: mediaError.message,
    });

    const nextStream = playback.streams[streamIndex + 1];
    if (nextStream) {
      targetTimeRef.current = currentTime;
      setWasPlaying(!paused);
      setIsSwitchingQuality(true);
      onStreamIndexChange(streamIndex + 1);
      return;
    }
    onPlaybackError(mediaError.message || "视频播放失败");
  }, [
    currentSrc,
    currentTime,
    mediaError,
    onPlaybackError,
    onStreamIndexChange,
    paused,
    playback.streams,
    playback.videoId,
    selectedStream?.id,
    streamIndex,
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
    const audioStore = audioStoreRef.current;
    if (
      !audioStore ||
      !audioCanPlay ||
      !needsAudio ||
      paused ||
      isSeeking ||
      isSwitchingQuality
    ) {
      return;
    }
    const audioTime = audioStore.state.currentTime;
    if (Math.abs(audioTime - currentTime) > 0.18) {
      log.debug("audio drift corrected", {
        videoId: playback.videoId,
        videoTime: currentTime,
        audioTime,
        drift: audioTime - currentTime,
      });
      void audioStore.seek(currentTime).catch((err: unknown) => {
        log.warn("audio drift correction failed", {
          videoId: playback.videoId,
          err,
        });
      });
    }
  }, [
    audioCanPlay,
    currentTime,
    isSeeking,
    isSwitchingQuality,
    needsAudio,
    paused,
    playback.videoId,
  ]);

  useEffect(() => {
    if (
      !isSwitchingQuality ||
      !selectedStream ||
      currentSrc !== selectedStream.url ||
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
        log.info("quality switch ready", {
          videoId: playback.videoId,
          quality: selectedStream.qualityId,
          targetTime: restoredTime,
          willResume: wasPlaying,
        });
      } catch (err) {
        if (cancelled) return;
        log.error("quality switch failed", {
          videoId: playback.videoId,
          quality: selectedStream.qualityId,
          targetTime: targetTimeRef.current,
          err,
        });
        setIsSwitchingQuality(false);
        onPlaybackError("切换清晰度失败");
      }
    };

    void restorePlayback();
    return () => {
      cancelled = true;
    };
  }, [
    audioCanPlay,
    currentSrc,
    isSwitchingQuality,
    needsAudio,
    onPlaybackError,
    playerDuration,
    playback.videoId,
    selectedStream,
    videoStore,
    wasPlaying,
  ]);

  const changeQuality = (index: number) => {
    if (index === streamIndex || !playback.streams[index]) return;
    if (!currentSrc || !videoStore.target) return;
    targetTimeRef.current = currentTime;
    setWasPlaying(!paused);
    videoStore.pause();
    if (audioCanPlay) {
      audioStoreRef.current?.pause();
    }
    setIsSwitchingQuality(true);
    setQualityMenuOpen(false);
    onStreamIndexChange(index);
    log.info("quality switch started", {
      videoId: playback.videoId,
      fromQuality: selectedStream?.qualityId,
      toQuality: playback.streams[index].qualityId,
      targetTime: currentTime,
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
      onPlaybackError("切换进度失败");
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
      log.error("playback toggle failed", {
        videoId: playback.videoId,
        err,
      });
      onPlaybackError("播放控制失败");
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
  const displayedTime = seekPreview ?? currentTime;
  const qualityLabel = selectedStream
    ? (QUALITY_LABELS[selectedStream.qualityId] ?? selectedStream.qualityLabel)
    : "";
  const playing = !paused;

  return (
    <>
      {needsAudio && selectedStream?.audioUrl ? (
        <AudioPlayer>
          <AudioTrack
            stream={selectedStream}
            onStore={handleAudioStore}
            onCanPlay={handleAudioCanPlay}
          />
        </AudioPlayer>
      ) : null}

      <Container className="relative aspect-video w-full overflow-hidden rounded-lg bg-black [&:fullscreen]:aspect-auto [&:fullscreen]:h-screen [&:fullscreen]:w-screen [&:fullscreen]:rounded-none">
        {selectedStream ? (
          <Video
            src={selectedStream.url}
            preload="auto"
            playsInline
            className="absolute inset-0 h-full w-full object-contain"
            ref={(element) => {
              element?.setAttribute("referrerpolicy", "no-referrer");
            }}
          />
        ) : null}

        {isSwitchingQuality ? (
          <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
            <div className="flex flex-col items-center gap-2 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.75)]">
              <Pause className="size-8 fill-current" />
              <span className="text-sm font-medium">
                {`正在切换至${qualityLabel || playback.currentQuality.label}清晰度`}
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

          {!playing && !isSwitchingQuality ? (
            <button
              type="button"
              aria-label="播放"
              className="absolute top-1/2 left-1/2 z-10 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/45 text-white shadow-lg backdrop-blur-sm hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
              onClick={(event) => {
                event.stopPropagation();
                revealControls();
                void togglePlay();
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
                value={[Math.min(displayedTime, duration)]}
                max={duration || 1}
                step={1}
                onValueChange={([value]) => setSeekPreview(value)}
                onValueCommit={([value]) => void seekTo(value)}
              />

              <div className="flex h-9 items-center gap-2 bg-black/20 px-3 sm:h-10 sm:gap-3 sm:px-4">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className={`${CONTROL_BUTTON_CLASS} -ml-1`}
                  aria-label={playing ? "暂停" : "播放"}
                  title={playing ? "暂停" : "播放"}
                  onClick={() => void togglePlay()}
                >
                  {playing ? (
                    <Pause className="fill-current" />
                  ) : (
                    <Play className="fill-current" />
                  )}
                </Button>
                <span className="text-xs font-medium whitespace-nowrap text-white/90 tabular-nums">
                  {formatPlayerTime(displayedTime)} /{" "}
                  {formatPlayerTime(duration)}
                </span>

                <div className="ml-auto flex items-center gap-2 sm:gap-3">
                  <div className="relative">
                    <button
                      type="button"
                      className="flex h-8 items-center gap-1 rounded-sm px-1 text-xs font-medium text-white/90 hover:text-white focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
                      aria-label="清晰度"
                      aria-haspopup="menu"
                      aria-expanded={qualityMenuOpen}
                      title="清晰度"
                      onClick={() => setQualityMenuOpen((open) => !open)}
                    >
                      <Settings2 className="size-3.5" />
                      {qualityLabel ? <span>{qualityLabel}</span> : null}
                    </button>
                    {qualityMenuOpen ? (
                      <div
                        role="menu"
                        aria-label="清晰度"
                        className="absolute right-0 bottom-full z-30 mb-2 w-32 rounded-md border border-white/10 bg-black/95 p-1.5 text-white shadow-2xl backdrop-blur-md"
                      >
                        <div className="px-2 py-1 text-xs text-white/60">
                          清晰度
                        </div>
                        <div className="grid gap-1">
                          {availableStreams.map((stream) => (
                            <button
                              key={stream.id}
                              type="button"
                              role="menuitemradio"
                              aria-checked={
                                playback.streams.indexOf(stream) === streamIndex
                              }
                              className="flex h-8 items-center justify-between rounded-md px-2 text-xs text-white/85 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
                              onClick={() =>
                                changeQuality(playback.streams.indexOf(stream))
                              }
                            >
                              <span>
                                {QUALITY_LABELS[stream.qualityId] ??
                                  stream.qualityLabel}
                              </span>
                              {playback.streams.indexOf(stream) ===
                              streamIndex ? (
                                <Check className="size-3.5 text-[var(--player-accent)]" />
                              ) : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

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
                      aria-label={
                        userMuted || volume === 0 ? "取消静音" : "静音"
                      }
                      title={userMuted || volume === 0 ? "取消静音" : "静音"}
                      onClick={() => setUserMuted((muted) => !muted)}
                    >
                      {userMuted || volume === 0 ? <VolumeX /> : <Volume2 />}
                    </Button>
                    {volumePanelOpen ? (
                      <div className="absolute right-0 bottom-full z-30 pb-2">
                        <div className="flex items-center rounded-md border border-white/10 bg-black/90 p-2 shadow-xl">
                          <Slider
                            aria-label="音量"
                            className="flex w-24 [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-white [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-track]]:bg-white/25"
                            value={[userMuted ? 0 : volume]}
                            max={1}
                            step={0.05}
                            onValueChange={([value]) => {
                              setVolume(value);
                              setUserMuted(value === 0);
                            }}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {pictureInPictureAvailability === "available" ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className={`${CONTROL_BUTTON_CLASS} hidden sm:inline-flex`}
                      aria-label={isPictureInPicture ? "退出画中画" : "画中画"}
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
      </Container>
    </>
  );
}

export default function VideoView() {
  const { videoId = "" } = useParams();
  const { navigator } = useNavigatorContext();
  const { t } = useI18n();
  const { openLogin } = useAccount();
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const [streamIndex, setStreamIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<CommandError | null>(null);

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
      setCurrentTime(0);
      setStreamIndex(info.streams.indexOf(selectedStream));
      setPlayback(info);
    } catch (err) {
      log.error("video load failed", { videoId, err });
      setError(asCommandError(err));
    }
  }, [videoId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!detail || !playback || currentTime <= 5) return;
    const timer = window.setTimeout(() => {
      void saveLocalHistory(
        detail,
        playback.cid,
        detail.pages[0]?.title ?? detail.card.title,
        Math.floor(currentTime),
        Math.round(playback.durationMs / 1000)
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
  }, [currentTime, detail, playback]);

  const availableStreams = useMemo(() => {
    if (!playback) return [];
    const playable = playback.streams.filter(canPlayDashStream);
    return playable.length > 0 ? playable : playback.streams;
  }, [playback]);

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

      {playback ? (
        <PlayerErrorBoundary key={videoId}>
          <VideoPlayer defaultPlaybackRates={PLAYBACK_RATES}>
            <VideoStage
              playback={playback}
              streamIndex={streamIndex}
              availableStreams={availableStreams}
              onStreamIndexChange={setStreamIndex}
              onCurrentTimeChange={setCurrentTime}
              onPlaybackError={(message) =>
                setError({ code: "playbackError", message })
              }
            />
          </VideoPlayer>
        </PlayerErrorBoundary>
      ) : (
        <div className="aspect-video w-full overflow-hidden rounded-lg bg-black" />
      )}

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
