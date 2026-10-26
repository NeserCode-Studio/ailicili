import { Link } from "react-router";
import { CalendarDays, Clock3 } from "lucide-react";

import { useI18n } from "@/composables";
import CoverImage from "@/features/video/CoverImage";
import type { PgcTimeline, PgcTimelineEpisode } from "@/shared/bili.types";
import { cn } from "@/lib/utils";

interface PgcTimelineViewProps {
  timeline: PgcTimeline;
}

function episodePath(episode: PgcTimelineEpisode) {
  const query =
    episode.episodeId !== "0"
      ? `?ep=${encodeURIComponent(episode.episodeId)}`
      : "";
  return `/pgc/${episode.seasonId}${query}`;
}

function EpisodeStatus({ episode }: { episode: PgcTimelineEpisode }) {
  const { t } = useI18n();
  if (episode.isDelayed) {
    return (
      <span className="text-destructive bg-destructive/10 rounded-sm px-1.5 py-0.5 text-[10px] font-medium">
        {episode.delayReason || t("Pgc.timeline.delayed")}
      </span>
    );
  }
  if (!episode.isPublished) {
    return (
      <span className="bg-brand-blue/15 text-brand-blue rounded-sm px-1.5 py-0.5 text-[10px] font-medium">
        {t("Pgc.timeline.upcoming")}
      </span>
    );
  }
  return null;
}

function LatestEpisodeCard({ episode }: { episode: PgcTimelineEpisode }) {
  return (
    <Link
      to={episodePath(episode)}
      className="group hover:bg-muted/55 flex min-w-0 gap-3 rounded-md p-2 transition-colors"
    >
      <CoverImage
        src={episode.coverUrl}
        alt=""
        className="aspect-video w-28 shrink-0 rounded-md"
      />
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <h3 className="group-hover:text-primary line-clamp-2 text-sm leading-5 font-semibold transition-colors">
          {episode.title}
        </h3>
        <p className="text-muted-foreground mt-1 truncate text-xs">
          {episode.episodeTitle}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <time
            dateTime={new Date(episode.publishedAt * 1000).toISOString()}
            className="text-muted-foreground inline-flex items-center gap-1 text-[11px]"
          >
            <Clock3 className="size-3" />
            {new Intl.DateTimeFormat(undefined, {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(episode.publishedAt * 1000))}
          </time>
          <EpisodeStatus episode={episode} />
        </div>
      </div>
    </Link>
  );
}

export default function PgcTimelineView({ timeline }: PgcTimelineViewProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-8">
      {timeline.latest.length > 0 && (
        <section aria-labelledby="pgc-latest-heading">
          <div className="mb-3 flex items-center gap-2">
            <Clock3 className="text-primary size-4" />
            <h2 id="pgc-latest-heading" className="text-sm font-semibold">
              {t("Pgc.timeline.latest")}
            </h2>
          </div>
          <div className="grid gap-1 lg:grid-cols-2 2xl:grid-cols-3">
            {timeline.latest.slice(0, 12).map((episode, index) => (
              <LatestEpisodeCard
                key={`${episode.episodeId}-${episode.seasonId}-${index}`}
                episode={episode}
              />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="pgc-schedule-heading">
        <div className="mb-3 flex items-center gap-2">
          <CalendarDays className="text-primary size-4" />
          <h2 id="pgc-schedule-heading" className="text-sm font-semibold">
            {t("Pgc.timeline.schedule")}
          </h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {timeline.days.map((day) => (
            <div
              key={`${day.dateTimestamp}-${day.date}`}
              className={cn(
                "border-border/80 bg-background/55 min-w-0 rounded-md border p-3",
                day.isToday && "border-primary/35"
              )}
            >
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">
                    {new Intl.DateTimeFormat(undefined, {
                      month: "short",
                      day: "numeric",
                    }).format(new Date(day.dateTimestamp * 1000))}
                  </h3>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    {new Intl.DateTimeFormat(undefined, {
                      weekday: "long",
                    }).format(new Date(day.dateTimestamp * 1000))}
                  </p>
                </div>
                {day.isToday && (
                  <span className="bg-primary/10 text-primary rounded-sm px-1.5 py-0.5 text-[10px] font-medium">
                    {t("Pgc.timeline.today")}
                  </span>
                )}
              </div>

              {day.episodes.length === 0 ? (
                <p className="text-muted-foreground flex min-h-20 items-center justify-center text-xs">
                  {t("Pgc.timeline.noEpisodes")}
                </p>
              ) : (
                <div className="space-y-1">
                  {day.episodes.map((episode, index) => (
                    <Link
                      key={`${episode.episodeId}-${episode.seasonId}-${index}`}
                      to={episodePath(episode)}
                      className="group hover:bg-muted/70 flex min-w-0 items-start gap-2 rounded-sm px-2 py-2 transition-colors"
                    >
                      <time
                        dateTime={new Date(
                          episode.publishedAt * 1000
                        ).toISOString()}
                        className="text-muted-foreground w-11 shrink-0 pt-0.5 font-mono text-[10px] tabular-nums"
                      >
                        {new Intl.DateTimeFormat(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(episode.publishedAt * 1000))}
                      </time>
                      <div className="min-w-0 flex-1">
                        <p className="group-hover:text-primary line-clamp-2 text-xs leading-5 font-medium transition-colors">
                          {episode.title}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="text-muted-foreground text-[10px]">
                            {episode.episodeTitle}
                          </span>
                          <EpisodeStatus episode={episode} />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
