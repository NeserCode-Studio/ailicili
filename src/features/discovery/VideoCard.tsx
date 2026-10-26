import { Link } from "react-router";
import { MessageSquareText, Play } from "lucide-react";

import CoverImage from "@/features/video/CoverImage";
import {
  formatCompactCount,
  formatDuration,
  formatPublishedAt,
} from "@/lib/format";
import type { VideoSummary } from "@/shared/bili.types";
import { useI18n } from "@/composables";

interface VideoCardProps {
  video: VideoSummary;
}

export default function VideoCard({ video }: VideoCardProps) {
  const { lang } = useI18n();

  return (
    <Link
      to={`/video/${video.bvid}`}
      className="group focus-visible:ring-ring flex min-w-0 flex-col rounded-md outline-none focus-visible:ring-2"
      aria-label={video.title}
    >
      <div className="relative">
        <CoverImage
          src={video.coverUrl}
          alt={video.title}
          className="aspect-video rounded-md"
        />
        <span className="absolute right-1.5 bottom-1.5 rounded-sm bg-black/75 px-1.5 py-0.5 font-mono text-[11px] leading-none text-white tabular-nums">
          {formatDuration(video.durationSeconds)}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-2.5">
        <h3 className="text-foreground group-hover:text-primary line-clamp-2 min-h-[2.6rem] text-sm leading-[1.3rem] font-semibold transition-colors">
          {video.title}
        </h3>

        <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
          <span className="truncate">{video.author.name}</span>
          {video.category && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{video.category}</span>
            </>
          )}
        </div>

        <div className="text-muted-foreground/80 flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1">
            <Play className="size-3" />
            {formatCompactCount(video.stats.views, lang)}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageSquareText className="size-3" />
            {formatCompactCount(video.stats.danmaku, lang)}
          </span>
          <span className="ml-auto shrink-0">
            {formatPublishedAt(video.publishedAt, lang)}
          </span>
        </div>
      </div>
    </Link>
  );
}
