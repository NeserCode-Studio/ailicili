import { Clock3, Play, Trash2, UserRound } from "lucide-react";
import { Link } from "react-router";

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
import { Button } from "@/components/ui/button";
import CoverImage from "@/features/video/CoverImage";
import { useI18n } from "@/composables";
import {
  formatCompactCount,
  formatDuration,
  formatPublishedAt,
} from "@/lib/format";
import type { LibraryVideo } from "@/shared/bili.types";

interface LibraryVideoCardProps {
  video: LibraryVideo;
  onRemove?: () => void;
  removing?: boolean;
}

export default function LibraryVideoCard({
  video,
  onRemove,
  removing = false,
}: LibraryVideoCardProps) {
  const { lang, t } = useI18n();
  const progress =
    video.durationSeconds > 0
      ? Math.min(100, (video.progressSeconds / video.durationSeconds) * 100)
      : 0;
  const timestamp = video.viewedAt ?? video.addedAt;

  return (
    <article className="group flex min-w-0 gap-3 py-4">
      <Link
        to={`/video/${video.bvid}`}
        aria-label={video.title}
        className="focus-visible:ring-ring relative w-36 shrink-0 overflow-hidden rounded-md outline-none focus-visible:ring-2 sm:w-48"
      >
        <CoverImage
          src={video.coverUrl}
          alt={video.title}
          className="aspect-video"
        />
        <span className="absolute right-1.5 bottom-1.5 rounded-sm bg-black/75 px-1.5 py-0.5 font-mono text-[10px] leading-4 text-white tabular-nums">
          {formatDuration(video.durationSeconds)}
        </span>
        {progress > 0 && (
          <span className="absolute inset-x-0 bottom-0 h-0.5 bg-black/40">
            <span
              className="bg-primary block h-full"
              style={{ width: `${progress}%` }}
            />
          </span>
        )}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          to={`/video/${video.bvid}`}
          className="hover:text-primary line-clamp-2 text-sm leading-5 font-semibold transition-colors"
        >
          {video.title}
        </Link>
        <Link
          to={`/space/${video.authorMid}`}
          className="text-muted-foreground hover:text-foreground mt-1.5 inline-flex min-w-0 items-center gap-1 text-xs"
        >
          <UserRound className="size-3 shrink-0" />
          <span className="truncate">{video.authorName}</span>
        </Link>
        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          {video.views > 0 && (
            <span className="inline-flex items-center gap-1">
              <Play className="size-3" />
              {formatCompactCount(video.views, lang)}
            </span>
          )}
          {video.progressSeconds > 0 && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Clock3 className="size-3" />
              {formatDuration(video.progressSeconds)}
            </span>
          )}
          {timestamp && <span>{formatPublishedAt(timestamp, lang)}</span>}
        </div>

        {onRemove && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={removing}
                className="text-muted-foreground hover:text-destructive mt-auto w-fit px-2"
              >
                <Trash2 />
                {t("Library.remove")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("Library.removeConfirm.title")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("Library.removeConfirm.description", {
                    title: video.title,
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("Common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive hover:bg-destructive/90 text-white"
                  onClick={onRemove}
                >
                  {t("Library.remove")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </article>
  );
}
