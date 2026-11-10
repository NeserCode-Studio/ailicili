import { useState } from "react";
import {
  CalendarDays,
  Loader2,
  Play,
  Star,
  Trash2,
  UserRound,
} from "lucide-react";

import type { FavoriteEntry } from "@/api/media";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/composables";
import { formatTimestamp } from "@/lib/format";

interface FavoriteCardProps {
  entry: FavoriteEntry;
  locale: string;
  removing: boolean;
  disabled: boolean;
  onOpen: (entry: FavoriteEntry) => void;
  onRemove: (entry: FavoriteEntry) => void;
}

export default function FavoriteCard({
  entry,
  locale,
  removing,
  disabled,
  onOpen,
  onRemove,
}: FavoriteCardProps) {
  const { t } = useI18n();
  const [coverFailed, setCoverFailed] = useState(false);
  const canOpen = entry.target.kind === "video";
  const savedAt = formatTimestamp(entry.savedAt, locale);

  const cover = coverFailed ? null : (
    <img
      src={entry.coverUrl}
      alt=""
      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setCoverFailed(true)}
    />
  );
  const fallback = (
    <div className="text-muted-foreground flex h-full w-full items-center justify-center">
      {entry.target.kind === "video" ? (
        <Play className="size-5" />
      ) : (
        <Star className="size-5" />
      )}
    </div>
  );
  const coverContent = entry.coverUrl && cover ? cover : fallback;

  return (
    <article className="group border-border/60 bg-card flex min-w-0 flex-col overflow-hidden rounded-lg border">
      <div className="bg-muted relative aspect-video w-full shrink-0 overflow-hidden">
        {canOpen ? (
          <button
            type="button"
            className="focus-visible:ring-ring absolute inset-0 h-full w-full focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
            aria-label={entry.title}
            onClick={() => onOpen(entry)}
          >
            {coverContent}
          </button>
        ) : (
          <div className="absolute inset-0">{coverContent}</div>
        )}

        <div className="absolute top-2 right-2 z-10">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="size-8 border border-white/20 bg-black/55 text-white shadow-sm hover:bg-black/75 hover:text-white"
                aria-label={t("Library.favorites.remove")}
                title={t("Library.favorites.remove")}
                disabled={disabled}
              >
                {removing ? <Loader2 className="animate-spin" /> : <Trash2 />}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("Library.favorites.removeTitle")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("Library.favorites.removeDescription")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("Library.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive hover:bg-destructive/90 text-white"
                  onClick={() => onRemove(entry)}
                >
                  {t("Library.favorites.removeConfirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="stack-2 min-w-0 p-3">
        <div className="flex min-w-0 items-start gap-2">
          <Badge variant="outline" className="shrink-0">
            {t(`Library.kind.${entry.target.kind}`)}
          </Badge>
          {savedAt ? (
            <span className="text-muted-foreground ml-auto flex shrink-0 items-center gap-1 text-xs">
              <CalendarDays className="size-3" />
              {savedAt}
            </span>
          ) : null}
        </div>

        {canOpen ? (
          <button
            type="button"
            className="text-card-foreground focus-visible:ring-ring line-clamp-2 min-w-0 text-left text-sm leading-5 font-medium [overflow-wrap:anywhere] hover:underline focus-visible:ring-2 focus-visible:outline-none"
            onClick={() => onOpen(entry)}
          >
            {entry.title}
          </button>
        ) : (
          <p className="text-card-foreground line-clamp-2 min-w-0 text-sm leading-5 font-medium [overflow-wrap:anywhere]">
            {entry.title}
          </p>
        )}

        {entry.ownerName ? (
          <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
            <UserRound className="size-3 shrink-0" />
            <span className="truncate">{entry.ownerName}</span>
          </span>
        ) : null}
      </div>
    </article>
  );
}
