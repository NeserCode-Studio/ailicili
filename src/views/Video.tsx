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

function mediaUrlsMatch(currentSrc: string, targetUrl?: string) {
  if (!currentSrc || !targetUrl) return false;
  try {
    return new URL(currentSrc).href === new URL(targetUrl).href;
  } catch {
    return currentSrc === targetUrl;
  }
}

function mediaSourceUrls(primaryUrl?: string, backupUrls?: string[]) {
  return [primaryUrl, ...(backupUrls ?? [])].filter(
    (url, index, urls): url is string =>
      Boolean(url) && urls.indexOf(url) === index
  );
}

interface PlaybackMediaError {
  code?: number;
  message?: string;
}

interface SourceSelection {
  streamId?: string;
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
        <div className="grid h-full w-full place-items-center bg-black text-white">
          <div className="flex flex-col items-center gap-3">
            <span className="text-sm">播放器初始化失败</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="border-white/30 bg-white text-black hover:bg-white/90"
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
  currentTime: number;
  onBack: () => void;
  onContinue?: () => void;
  onRetry: () => void;
  onLogin: () => void;
}

const PAUSE_BLUR_MASK =
  "linear-gradient(to bottom, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 0.15) 10%, rgba(0, 0, 0, 0.28) 20%, rgba(0, 0, 0, 0.47) 30%, rgba(0, 0, 0, 0.7) 40%, rgba(0, 0, 0, 0.88) 50%, rgba(0, 0, 0, 0.96) 60%, rgba(0, 0, 0, 0.995) 70%, rgb(0, 0, 0) 75%)";

function PlayerPausePanel({
  detail,
  error,
  qualityNotice,
  active,
  ready,
  currentTime,
  onBack,
  onContinue,
  onRetry,
  onLogin,
}: PlayerPausePanelProps) {
  const { t } = useI18n();
  const canContinue = ready && !error && Boolean(onContinue);
  const showResume = ready && currentTime > 0.5;
  const placeholderActions = [
    { label: t("Video.actions.like"), icon: ThumbsUp },
    { label: t("Video.actions.comment"), icon: MessageCircle },
    { label: t("Video.actions.favorite"), icon: Star },
    { label: t("Video.actions.share"), icon: Share2 },
  ];

  return (
    <section
      aria-label={t("Video.panelLabel")}
      aria-hidden={!active}
      inert={!active}
      className={`absolute inset-0 z-20 overflow-hidden text-white transition-[opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none ${
        active
          ? "visible translate-y-0 scale-100 opacity-100"
          : "pointer-events-none invisible translate-y-1 scale-[0.995] opacity-0"
      }`}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-black/45 backdrop-blur-[21.6px]"
        style={{
          maskImage: PAUSE_BLUR_MASK,
          WebkitMaskImage: PAUSE_BLUR_MASK,
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />

      <div className="relative mx-auto flex h-full w-full max-w-[1440px] flex-col px-5 pt-5 pb-28 sm:px-8 sm:pb-32 lg:px-12 lg:pt-8">
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            aria-label={t("Video.back")}
            title={t("Video.back")}
            className="inline-flex size-10 items-center justify-center rounded-full border border-white/15 bg-black/25 text-white/90 transition-[background-color,color,transform] duration-150 hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none active:scale-95"
            onClick={onBack}
          >
            <ArrowLeft className="size-4" />
          </button>
        </div>

        <div className="mt-auto grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] md:items-end lg:gap-10">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/70">
              <span className="max-w-full truncate font-medium text-white/90">
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
              <p className="mt-3 line-clamp-2 max-w-3xl text-sm leading-6 text-white/70">
                {detail.description}
              </p>
            ) : null}

            {qualityNotice && qualityNotice.kind !== "none" ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/65">
                <span>{t(`Quality.notice.${qualityNotice.messageCode}`)}</span>
                {qualityNotice.kind === "loginRequired" ||
                qualityNotice.kind === "accountExpired" ? (
                  <button
                    type="button"
                    className="font-medium text-white underline underline-offset-4 hover:text-white/80 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
                    onClick={onLogin}
                  >
                    {t("Account.titlebar.login")}
                  </button>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <div className="mt-4 max-w-3xl border-l-2 border-red-300/60 pl-3">
                <p className="text-sm leading-5 text-red-100">
                  {commandErrorMessage(error, t)}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-2 bg-white text-black hover:bg-white/90"
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
              className="h-11 w-full rounded-full bg-white px-5 text-black hover:bg-white/90 focus-visible:ring-white/80 disabled:bg-white/70"
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
                  ? showResume
                    ? t("Video.resume")
                    : t("Video.play")
                  : t("Video.loading")}
            </Button>

            <div className="grid grid-cols-4 gap-2">
              {placeholderActions.map(({ label, icon: Icon }) => (
                <button
                  key={label}
                  type="button"
                  disabled
                  aria-label={`${label} (${t("Video.actions.pending")})`}
                  title={`${label} (${t("Video.actions.pending")})`}
                  className="inline-flex h-11 min-w-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/85 transition-[background-color,color,transform] duration-150 hover:bg-white/20 hover:text-white focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Icon className="size-4" />
                </button>
              ))}
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
  onStreamIndexChange: (index: number) => void;
  onCurrentTimeChange: (time: number) => void;
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
  onStreamIndexChange,
  onCurrentTimeChange,
  onPlaybackError,
  onBack,
  onRetry,
  onLogin,
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
  const canPlay = usePlayer((state) => state.canPlay);

  const selectedStream = playback.streams[streamIndex];
  const selectedStreamId = selectedStream?.id;
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
    sourceSelection.streamId === selectedStreamId
      ? sourceSelection
      : { streamId: selectedStreamId, videoIndex: 0, audioIndex: 0 };
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
  const mediaReady = canPlay && !mediaError && (!needsAudio || audioCanPlay);
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
  const handledMediaErrorKeyRef = useRef<string | null>(null);
  const autoFallbackTriedRef = useRef(false);
  const initialPauseAppliedRef = useRef(false);

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

  const scheduleHideControls = useCallback(() => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    if (paused || speedMenuOpen || qualityMenuOpen || volumePanelOpen) return;
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      setControlsVisible(false);
    }, 2400);
  }, [paused, qualityMenuOpen, speedMenuOpen, volumePanelOpen]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHideControls();
  }, [scheduleHideControls]);

  useEffect(() => {
    if (isSwitchingQuality || isSeeking) return;
    onCurrentTimeChange(currentTime);
  }, [currentTime, isSeeking, isSwitchingQuality, onCurrentTimeChange]);

  useEffect(() => {
    if (!paused) return;
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setControlsVisible(true);
  }, [paused]);

  useEffect(() => {
    if (!mediaReady || initialPauseAppliedRef.current) return;
    initialPauseAppliedRef.current = true;
    videoStore.pause();
    audioStoreRef.current?.pause();
  }, [mediaReady, videoStore]);

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
      currentSrc,
      code: mediaError.code,
      message: mediaError.message,
    });

    const nextVideoSourceIndex = activeSourceSelection.videoIndex + 1;
    if (nextVideoSourceIndex < videoSourceUrls.length) {
      const nextAudioSourceIndex =
        activeSourceSelection.audioIndex + 1 < audioSourceUrls.length
          ? activeSourceSelection.audioIndex + 1
          : activeSourceSelection.audioIndex;
      targetTimeRef.current = currentTime;
      setWasPlaying(!paused);
      videoStore.pause();
      if (audioCanPlay) {
        audioStoreRef.current?.pause();
      }
      setIsSwitchingQuality(true);
      videoStore.dismissError();
      setSourceSelection({
        streamId: selectedStreamId,
        videoIndex: nextVideoSourceIndex,
        audioIndex: nextAudioSourceIndex,
      });
      log.info("video CDN fallback started", {
        videoId: playback.videoId,
        streamId: selectedStreamId,
        sourceIndex: nextVideoSourceIndex,
      });
      return;
    }

    const nextStreamIndex = playback.streams.findIndex(
      (stream, index) => index > streamIndex && canPlayDashStream(stream)
    );
    if (!autoFallbackTriedRef.current && nextStreamIndex >= 0) {
      autoFallbackTriedRef.current = true;
      targetTimeRef.current = currentTime;
      setWasPlaying(!paused);
      setIsSwitchingQuality(true);
      videoStore.dismissError();
      setSourceSelection({
        streamId: playback.streams[nextStreamIndex].id,
        videoIndex: 0,
        audioIndex: 0,
      });
      onStreamIndexChange(nextStreamIndex);
      return;
    }

    setIsSwitchingQuality(false);
    reportPlaybackError(mediaError.message || "视频播放失败");
  }, [
    activeSourceSelection.audioIndex,
    activeSourceSelection.videoIndex,
    audioCanPlay,
    audioSourceUrls,
    currentSrc,
    currentTime,
    currentVideoUrl,
    mediaError,
    onStreamIndexChange,
    paused,
    playback.streams,
    playback.videoId,
    selectedStream,
    selectedStreamId,
    streamIndex,
    videoSourceUrls,
    videoStore,
    reportPlaybackError,
  ]);

  const handleAudioPlaybackError = useCallback(
    (audioError: PlaybackMediaError) => {
      log.error("audio playback failed", {
        videoId: playback.videoId,
        streamId: selectedStreamId,
        code: audioError.code,
        message: audioError.message,
      });

      if (isSwitchingQuality) return;
      setIsSwitchingQuality(false);
      reportPlaybackError(audioError.message || "音频播放失败");
    },
    [
      isSwitchingQuality,
      playback.videoId,
      reportPlaybackError,
      selectedStreamId,
    ]
  );

  useEffect(() => {
    if (!isSwitchingQuality) return;
    const timer = window.setTimeout(() => {
      setIsSwitchingQuality(false);
      reportPlaybackError("切换播放线路超时，请重试");
    }, 20000);
    return () => window.clearTimeout(timer);
  }, [
    currentAudioUrl,
    currentVideoUrl,
    isSwitchingQuality,
    reportPlaybackError,
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
      !mediaUrlsMatch(currentSrc, currentVideoUrl) ||
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
        log.error("quality switch failed", {
          videoId: playback.videoId,
          quality: selectedStream.qualityId,
          targetTime: targetTimeRef.current,
          err,
        });
        setIsSwitchingQuality(false);
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
    targetTimeRef.current = currentTime;
    setWasPlaying(!paused);
    videoStore.pause();
    if (audioCanPlay) {
      audioStoreRef.current?.pause();
    }
    setIsSwitchingQuality(true);
    setQualityMenuOpen(false);
    setSourceSelection({
      streamId: nextStream.id,
      videoIndex: 0,
      audioIndex: 0,
    });
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
            src={currentAudioUrl ?? selectedStream.audioUrl}
            onStore={handleAudioStore}
            onCanPlay={handleAudioCanPlay}
            onPlaybackError={handleAudioPlaybackError}
          />
        </AudioPlayer>
      ) : null}

      <Container className="relative h-full min-h-0 w-full overflow-hidden bg-black [&:fullscreen]:h-screen [&:fullscreen]:w-screen">
        {selectedStream ? (
          <Video
            src={currentVideoUrl}
            preload="auto"
            playsInline
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : null}

        {!isSwitchingQuality ? (
          <PlayerPausePanel
            detail={detail}
            error={error}
            qualityNotice={playback.qualityNotice}
            active={!mediaReady || !playing}
            ready={mediaReady}
            currentTime={currentTime}
            onBack={onBack}
            onContinue={() => void togglePlay()}
            onRetry={onRetry}
            onLogin={onLogin}
          />
        ) : null}

        {isSwitchingQuality ? (
          <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-black/35 backdrop-blur-sm">
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

          <div
            className={`absolute inset-x-0 bottom-0 z-30 transition-[transform,opacity] duration-200 ${
              controlsVisible
                ? "translate-y-0 opacity-100"
                : "pointer-events-none translate-y-2 opacity-0"
            }`}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />
            <div className="relative flex flex-col gap-2 px-3 pb-3 sm:px-4">
              <Slider
                aria-label="播放进度"
                className="h-4 w-full [&_[data-slot=slider-range]]:bg-[var(--player-accent)] [&_[data-slot=slider-thumb]]:size-2 [&_[data-slot=slider-thumb]]:border-[var(--player-accent)] [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-track]]:h-[3px] [&_[data-slot=slider-track]]:rounded-none [&_[data-slot=slider-track]]:bg-white/25"
                value={[Math.min(displayedTime, duration)]}
                max={duration || 1}
                step={1}
                onValueChange={([value]) => setSeekPreview(value)}
                onValueCommit={([value]) => void seekTo(value)}
              />

              <div className="flex h-10 items-center gap-2 rounded-md border border-white/10 bg-black/60 px-2 backdrop-blur-md sm:gap-3">
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
                        className="absolute right-0 bottom-full z-40 mb-2 w-32 rounded-md border border-white/10 bg-black/95 p-1.5 text-white shadow-2xl backdrop-blur-md"
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
                        className="absolute right-0 bottom-full z-40 mb-2 w-40 rounded-md border border-white/10 bg-black/95 p-1.5 text-white shadow-2xl backdrop-blur-md"
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
                      <div className="absolute right-0 bottom-full z-40 pb-2">
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
  const { openLogin } = useAccount();
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const [streamIndex, setStreamIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<CommandError | null>(null);
  const loadRequestIdRef = useRef(0);

  const handlePlaybackError = useCallback((message: string) => {
    setError({ code: "playbackError", message });
  }, []);

  const load = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    setError(null);
    setPlayback(null);
    try {
      const videoDetail = await getVideoDetail(videoId);
      if (requestId !== loadRequestIdRef.current) return;
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
      if (requestId !== loadRequestIdRef.current) return;
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
      if (requestId !== loadRequestIdRef.current) return;
      log.error("video load failed", { videoId, err });
      setError(asCommandError(err));
    }
  }, [videoId]);

  useEffect(() => {
    void load();
    return () => {
      loadRequestIdRef.current += 1;
    };
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
    <div className="relative h-[calc(100vh-2rem)] min-h-0 w-full overflow-hidden bg-black">
      {playback ? (
        <PlayerErrorBoundary key={videoId}>
          <VideoPlayer defaultPlaybackRates={PLAYBACK_RATES}>
            <VideoStage
              playback={playback}
              detail={detail}
              error={error}
              streamIndex={streamIndex}
              availableStreams={availableStreams}
              onStreamIndexChange={setStreamIndex}
              onCurrentTimeChange={setCurrentTime}
              onPlaybackError={handlePlaybackError}
              onBack={() => navigator("/")}
              onRetry={() => void load()}
              onLogin={() => openLogin()}
            />
          </VideoPlayer>
        </PlayerErrorBoundary>
      ) : (
        <div className="relative h-full w-full overflow-hidden bg-black">
          <PlayerPausePanel
            detail={detail}
            error={error}
            active
            ready={false}
            currentTime={0}
            onBack={() => navigator("/")}
            onRetry={() => void load()}
            onLogin={() => openLogin()}
          />
        </div>
      )}
    </div>
  );
}
