import { Link } from "react-router";
import { ChevronRight, MessageSquareText, Play, Sparkles } from "lucide-react";

import CoverImage from "@/features/video/CoverImage";
import {
  formatCompactCount,
  formatDuration,
  formatPublishedAt,
} from "@/lib/format";
import type { VideoSummary } from "@/shared/bili.types";
import { useI18n } from "@/composables";

interface FeaturedVideoProps {
  video: VideoSummary;
}

export default function FeaturedVideo({ video }: FeaturedVideoProps) {
  const { lang, t } = useI18n();

  return (
    <Link
      to={`/video/${video.bvid}`}
      aria-label={video.title}
      className="group border-border/80 bg-card hover:border-primary/40 focus-visible:ring-ring grid overflow-hidden rounded-lg border transition-colors outline-none focus-visible:ring-2 md:grid-cols-[minmax(0,1.45fr)_minmax(260px,1fr)]"
    >
      <div className="relative min-w-0 self-center">
        <CoverImage
          src={video.coverUrl}
          alt={video.title}
          className="aspect-video w-full md:rounded-none"
          eager
        />
        <span className="absolute right-3 bottom-3 rounded-sm bg-black/80 px-2 py-1 font-mono text-xs leading-none text-white tabular-nums">
          {formatDuration(video.durationSeconds)}
        </span>
        <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-sm bg-black/70 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
          <Sparkles className="size-3" />
          {t("Discover.spotlight")}
        </div>
      </div>

      <div className="flex min-w-0 flex-col justify-center gap-4 p-5 lg:p-6">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {video.category && (
            <span className="bg-primary/10 text-primary rounded-sm px-2 py-0.5 font-medium">
              {video.category}
            </span>
          )}
          {video.recommendationReason && (
            <span className="text-muted-foreground">
              {video.recommendationReason}
            </span>
          )}
        </div>

        <h2 className="text-card-foreground group-hover:text-primary line-clamp-3 text-2xl leading-tight font-semibold tracking-tight transition-colors">
          {video.title}
        </h2>

        <p className="text-muted-foreground truncate text-sm font-medium">
          {video.author.name}
        </p>

        <div className="border-border/70 text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <Play className="size-3.5" />
            {formatCompactCount(video.stats.views, lang)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MessageSquareText className="size-3.5" />
            {formatCompactCount(video.stats.danmaku, lang)}
          </span>
          <span>{formatPublishedAt(video.publishedAt, lang)}</span>
        </div>

        <span className="text-primary inline-flex items-center gap-1 text-sm font-medium">
          {t("Discover.details")}
          <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
