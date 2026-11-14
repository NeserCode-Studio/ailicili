import { useState } from "react";
import { CalendarClock, Loader2, Play, Trash2, UserRound } from "lucide-react";

import type { HistoryEntry } from "@/api/media";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/composables";
import { formatDuration, formatTimestamp } from "@/lib/format";
import {
  historyDisplayProgressSeconds,
  resolveHistoryDurationSeconds,
} from "@/lib/history";

interface HistoryCardProps {
  entry: HistoryEntry;
  locale: string;
  removing: boolean;
  disabled: boolean;
  onResume: (entry: HistoryEntry) => void;
  onRemove: (entry: HistoryEntry) => void;
}

export default function HistoryCard({
  entry,
  locale,
  removing,
  disabled,
  onResume,
  onRemove,
}: HistoryCardProps) {
  const { t } = useI18n();
  const [coverFailed, setCoverFailed] = useState(false);
  const duration = resolveHistoryDurationSeconds(entry);
  const displayedProgress = historyDisplayProgressSeconds(entry);
  const progress =
    duration > 0
      ? Math.min(100, Math.max(0, (displayedProgress / duration) * 100))
      : 0;
  const updatedAt = formatTimestamp(entry.updatedAt, locale);

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
    <article className="video-card group min-w-0">
      <button
        type="button"
        className="video-card-cover focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
        aria-label={entry.card.title}
        onClick={() => onResume(entry)}
      >
        {coverContent}
        {updatedAt ? (
          <span className="absolute bottom-2.5 left-2 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] leading-4 font-medium text-white">
            <CalendarClock className="size-3" aria-hidden="true" />
            {updatedAt}
          </span>
        ) : null}
        {duration > 0 ? (
          <span className="absolute right-2 bottom-2.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] leading-4 font-medium text-white tabular-nums">
            {formatDuration(displayedProgress)} / {formatDuration(duration)}
          </span>
        ) : null}
        <div
          className="absolute inset-x-0 bottom-0 h-1 bg-black/45"
          role="progressbar"
          aria-label={t("Library.history.progress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <div
            className="h-full bg-[var(--player-accent)]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </button>

      <div className="video-card-info">
        <div className="min-w-0">
          <button
            type="button"
            className="text-card-foreground focus-visible:ring-ring line-clamp-2 min-w-0 text-left text-sm leading-5 font-medium [overflow-wrap:anywhere] hover:underline focus-visible:ring-2 focus-visible:outline-none"
            onClick={() => onResume(entry)}
          >
            {entry.card.title}
          </button>
        </div>

        <div className="text-muted-foreground mt-auto flex min-h-7 items-center gap-2 text-xs">
          {entry.card.owner?.name ? (
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <UserRound className="size-3 shrink-0" />
              <span className="truncate">{entry.card.owner.name}</span>
            </span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive ml-auto size-7"
            aria-label={t("Library.history.remove")}
            title={t("Library.history.remove")}
            disabled={disabled}
            onClick={() => onRemove(entry)}
          >
            {removing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
          </Button>
        </div>
      </div>
    </article>
  );
}
