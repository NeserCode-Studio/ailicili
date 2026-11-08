import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Gauge,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
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
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useNavigatorContext } from "@/contexts/navigator";
import { formatCount, formatDuration } from "@/lib/format";
import { createLogger } from "@/lib/logger";

import { useParams } from "react-router";

const log = createLogger("Media/Video");

export default function VideoView() {
  const { videoId = "" } = useParams();
  const { navigator } = useNavigatorContext();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<number | null>(null);
  const playerRef = useRef<HTMLDivElement>(null);

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
        quality: info.streams[0]?.qualityLabel,
        urlHost: info.streams[0] ? new URL(info.streams[0].url).host : null,
      });
      setDurationSeconds(Math.round(info.durationMs / 1000));
      const stream = info.streams[0];
      const video = videoRef.current;
      if (!stream || !video) throw new Error("No playable stream");
      video.src = stream.url;
      setPlayback(info);
    } catch (err) {
      log.error("video load failed", { videoId, err });
      setError(err instanceof Error ? err.message : String(err));
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
        durationSeconds,
      )
        .then(() => log.debug("history saved", { videoId: detail.card.videoId, cid: playback.cid }))
        .catch((err) => log.warn("history save failed", err));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [currentTime, detail, durationSeconds, playback]);

  useEffect(() => {
    void load();
  }, [load]);

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
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const scheduleHideControls = useCallback(() => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
    }
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2400);
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHideControls();
  }, [scheduleHideControls]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
      }
    };
  }, []);

  const duration = useMemo(() => {
    const fromResponse = playback?.durationMs ? playback.durationMs / 1000 : 0;
    const fromElement = videoRef.current?.duration ?? 0;
    return fromResponse || fromElement;
  }, [playback]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  const toggleFullscreen = async () => {
    if (!playerRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    } else {
      await playerRef.current.requestFullscreen().catch(() => {});
    }
  };

  const step = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + seconds));
  };

  const cycleRate = () => {
    const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const index = rates.indexOf(playbackRate);
    setPlaybackRate(rates[(index + 1) % rates.length]);
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
        className="relative aspect-video w-full overflow-hidden rounded-lg bg-black"
      >
        <video
          ref={videoRef}
          className="h-full w-full"
          controls={false}
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        />

        {playback ? (
          <div
            className="absolute inset-0"
            onMouseMove={revealControls}
            onDoubleClick={toggleFullscreen}
            onClick={togglePlay}
          >
            <div
              className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 transition-opacity duration-150 ${
                controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <Slider
                className="mb-2"
                value={[Math.min(currentTime, duration)]}
                max={duration || 1}
                step={1}
                onValueChange={([value]) => {
                  const video = videoRef.current;
                  if (video) video.currentTime = value;
                }}
              />
              <div className="flex items-center gap-3">
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-white hover:bg-white/20"
                  onClick={togglePlay}
                >
                  {playing ? <Pause /> : <Play />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-white hover:bg-white/20"
                  onClick={() => step(-10)}
                >
                  <RotateCcw />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-white hover:bg-white/20"
                  onClick={toggleMute}
                >
                  {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
                </Button>
                <Slider
                  className="w-24"
                  value={[muted ? 0 : volume]}
                  max={1}
                  step={0.05}
                  onValueChange={([value]) => changeVolume(value)}
                />
                <span className="text-xs text-white">
                  {formatDuration(currentTime)} / {formatDuration(duration)}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-white hover:bg-white/20"
                    onClick={cycleRate}
                  >
                    <Gauge className="icon-md" />
                    {playbackRate}x
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-white hover:bg-white/20"
                    onClick={() => void toggleFullscreen()}
                  >
                    {isFullscreen ? <Minimize /> : <Maximize />}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {detail ? (
        <div className="stack-2 rounded-lg border border-border/60 bg-card p-4">
          <div className="stack-1">
            <span className="text-xs text-muted-foreground">
              {detail.card.owner?.name ?? "Unknown"} · {formatCount(detail.card.stats.view)}播放
            </span>
            <p className="line-clamp-3 text-xs whitespace-pre-line text-muted-foreground">
              {detail.description || "No description"}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
