import { useState } from "react";
import { CalendarClock, Play, UserRound } from "lucide-react";

import type { HistoryEntry } from "@/api/media";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/composables";
import { formatDuration, formatTimestamp } from "@/lib/format";

interface HistoryCardProps {
  entry: HistoryEntry;
  locale: string;
  onResume: (entry: HistoryEntry) => void;
}

export default function HistoryCard({
  entry,
  locale,
  onResume,
}: HistoryCardProps) {
  const { t } = useI18n();
  const [coverFailed, setCoverFailed] = useState(false);
  const duration = Math.max(entry.durationSeconds, entry.card.duration ?? 0);
  const progress =
    duration > 0
      ? Math.min(100, Math.max(0, (entry.progressSeconds / duration) * 100))
      : 0;
  const updatedAt = formatTimestamp(entry.updatedAt, locale);
  const showPageTitle = entry.pageTitle && entry.pageTitle !== entry.card.title;

  const coverContent =
    entry.card.coverUrl && !coverFailed ? (
      <img
        src={entry.card.coverUrl}
        alt=""
        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setCoverFailed(true)}
      />
    ) : (
      <div className="text-muted-foreground flex h-full w-full items-center justify-center">
        <Play className="size-5" />
      </div>
    );

  return (
    <article className="border-border/60 bg-card flex min-w-0 flex-col overflow-hidden rounded-lg border sm:flex-row">
      <button
        type="button"
        className="group bg-muted focus-visible:ring-ring relative aspect-video w-full shrink-0 overflow-hidden focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset sm:w-56"
        aria-label={entry.card.title}
        onClick={() => onResume(entry)}
      >
        {coverContent}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <button
            type="button"
            className="text-card-foreground focus-visible:ring-ring line-clamp-2 min-w-0 text-left text-sm leading-5 font-medium [overflow-wrap:anywhere] hover:underline focus-visible:ring-2 focus-visible:outline-none"
            onClick={() => onResume(entry)}
          >
            {entry.card.title}
          </button>
          {showPageTitle ? (
            <p className="text-muted-foreground mt-1 truncate text-xs">
              {entry.pageTitle}
            </p>
          ) : null}
        </div>

        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {entry.card.owner?.name ? (
            <span className="flex min-w-0 items-center gap-1">
              <UserRound className="size-3 shrink-0" />
              <span className="max-w-40 truncate">{entry.card.owner.name}</span>
            </span>
          ) : null}
          {updatedAt ? (
            <span className="flex items-center gap-1">
              <CalendarClock className="size-3 shrink-0" />
              {updatedAt}
            </span>
          ) : null}
        </div>

        <div className="stack-1 mt-auto">
          <Progress
            value={progress}
            className="h-1.5"
            aria-label={t("Library.history.progress")}
          />
          <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs">
            <span>
              {formatDuration(entry.progressSeconds)} /{" "}
              {formatDuration(duration)}
            </span>
            <Button type="button" size="sm" onClick={() => onResume(entry)}>
              <Play className="fill-current" />
              {t("Library.history.resume")}
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}
