import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";

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
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          className="h-full w-full"
          controls={false}
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        />
      </div>
      {playback ? (
        <div className="stack-3 rounded-lg border border-border/60 bg-card p-3">
          <div className="flex items-center gap-3">
            <Button size="icon" onClick={togglePlay}>
              {playing ? <Pause /> : <Play />}
            </Button>
            <Button size="icon" onClick={() => void load()}>
              <RotateCcw />
            </Button>
            <Button size="icon" onClick={() => setMuted((value) => !value)}>
              {muted ? <VolumeX /> : <Volume2 />}
            </Button>
            <span className="text-xs text-muted-foreground">
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </span>
          </div>
          <Slider
            value={[Math.min(currentTime, duration)]}
            max={duration || 1}
            step={1}
            onValueChange={([value]) => {
              const video = videoRef.current;
              if (video) video.currentTime = value;
            }}
          />
        </div>
      ) : null}
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
