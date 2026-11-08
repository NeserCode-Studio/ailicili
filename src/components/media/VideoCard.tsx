import { Play, User } from "lucide-react";

import type { VideoCard as VideoCardModel } from "@/api/media";
import { formatCount, formatDuration } from "@/lib/format";
import { useNavigatorContext } from "@/contexts/navigator";

interface VideoCardProps {
  video: VideoCardModel;
}

export default function VideoCard({ video }: VideoCardProps) {
  const { navigator } = useNavigatorContext();

  return (
    <button
      type="button"
      className="group stack-2 rounded-lg border border-border/60 bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/30"
      onClick={() => navigator(`/video/${video.videoId}`)}
    >
      <div className="video-card-cover">
        {video.coverUrl ? (
          <img
            src={video.coverUrl}
            alt={video.title}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            loading="lazy"
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
      <div className="stack-1">
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
