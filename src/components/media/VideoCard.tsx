import { Play, User } from "lucide-react";

import type { VideoCard as VideoCardModel } from "@/api/media";
import { formatCount, formatDuration } from "@/lib/format";
import { createLogger } from "@/lib/logger";
import { useNavigatorContext } from "@/contexts/navigator";

const log = createLogger("Media/VideoCard");

interface VideoCardProps {
  video: VideoCardModel;
}

export default function VideoCard({ video }: VideoCardProps) {
  const { navigator } = useNavigatorContext();

  return (
    <button
      type="button"
      className="video-card group"
      onClick={() => navigator(`/video/${video.videoId}`)}
    >
      <div className="video-card-cover">
        {video.coverUrl ? (
          <img
            src={video.coverUrl}
            alt={video.title}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            referrerPolicy="no-referrer"
            loading="lazy"
            crossOrigin="anonymous"
            onError={() =>
              log.warn("cover failed", {
                videoId: video.videoId,
                url: video.coverUrl,
              })
            }
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Play className="icon-md" />
          </div>
        )}
        <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
          {formatDuration(video.duration)}
        </span>
      </div>
      <div className="video-card-info">
        <span className="video-card-title">{video.title}</span>
        <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <User className="h-3 w-3" />
          {video.owner?.name ?? "Unknown"}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatCount(video.stats.view)} · {formatCount(video.stats.danmaku)}弹幕
        </span>
      </div>
    </button>
  );
}
