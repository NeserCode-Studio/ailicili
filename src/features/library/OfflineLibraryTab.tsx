import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Captions,
  Download,
  FileJson,
  FileVideo2,
  FolderOpen,
  Image,
  MessageSquareText,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Link } from "react-router";

import AsyncErrorState from "@/components/feedback/AsyncErrorState";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n, useToast } from "@/composables";
import CoverImage from "@/features/video/CoverImage";
import {
  biliKeys,
  fetchOfflineLibrary,
  normalizeBiliError,
  removeDownload,
  revealDownload,
} from "@/lib/bili";
import {
  formatByteSize,
  formatDuration,
  formatPublishedAt,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OfflineLibraryEntry } from "@/shared/bili.types";

function OfflineSkeleton() {
  return (
    <div className="divide-border/70 divide-y" aria-busy="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex gap-3 py-4">
          <Skeleton className="aspect-video w-36 shrink-0 sm:w-48" />
          <div className="flex-1 space-y-2 py-1">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ArtifactBadge({
  icon: Icon,
  label,
}: {
  icon: typeof FileVideo2;
  label: string;
}) {
  return (
    <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px]">
      <Icon className="size-3" />
      {label}
    </span>
  );
}

function OfflineEntryRow({
  entry,
  removing,
  onRemove,
  onReveal,
  revealing,
}: {
  entry: OfflineLibraryEntry;
  removing: boolean;
  onRemove: () => void;
  onReveal: () => void;
  revealing: boolean;
}) {
  const { lang, t } = useI18n();
  const completedAt = entry.completedAt
    ? formatPublishedAt(entry.completedAt / 1000, lang)
    : null;
  const hasMedia =
    entry.hasMergedMp4 || (entry.hasVideoStream && entry.hasAudioStream);

  return (
    <article className="flex min-w-0 gap-3 py-4">
      <Link
        to={`/video/${entry.bvid}`}
        aria-label={entry.title}
        className="focus-visible:ring-ring relative w-36 shrink-0 self-start overflow-hidden rounded-md outline-none focus-visible:ring-2 sm:w-48"
      >
        <CoverImage
          src={entry.coverUrl}
          alt={entry.title}
          className="aspect-video"
        />
        <span className="absolute right-1.5 bottom-1.5 rounded-sm bg-black/75 px-1.5 py-0.5 font-mono text-[10px] leading-4 text-white tabular-nums">
          {formatDuration(entry.durationSeconds)}
        </span>
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <Link
              to={`/video/${entry.bvid}`}
              className="hover:text-primary line-clamp-2 text-sm leading-5 font-semibold transition-colors"
            >
              {entry.title}
            </Link>
            {entry.partTitle && entry.partTitle !== entry.title && (
              <p className="text-muted-foreground mt-1 truncate text-xs">
                {t("Library.offline.part", { title: entry.partTitle })}
              </p>
            )}
          </div>
          <span className="shrink-0 rounded-sm bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
            {t("Library.offline.saved")}
          </span>
        </div>

        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span>
            {entry.qualityLabel} · {entry.width}×{entry.height}
          </span>
          <span className="tabular-nums">
            {formatByteSize(entry.totalBytes, lang)}
          </span>
          {completedAt && <span>{completedAt}</span>}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {entry.hasMergedMp4 && (
            <ArtifactBadge icon={FileVideo2} label={t("Library.offline.mp4")} />
          )}
          {!entry.hasMergedMp4 && entry.hasVideoStream && (
            <ArtifactBadge
              icon={FileVideo2}
              label={t("Library.offline.videoStream")}
            />
          )}
          {!entry.hasMergedMp4 && entry.hasAudioStream && (
            <ArtifactBadge
              icon={FileVideo2}
              label={t("Library.offline.audioStream")}
            />
          )}
          {entry.hasCover && (
            <ArtifactBadge icon={Image} label={t("Library.offline.cover")} />
          )}
          {entry.hasDanmaku && (
            <ArtifactBadge
              icon={MessageSquareText}
              label={t("Library.offline.danmaku")}
            />
          )}
          {entry.hasSubtitle && (
            <ArtifactBadge
              icon={Captions}
              label={t("Library.offline.subtitle")}
            />
          )}
          {entry.hasMetadata && (
            <ArtifactBadge
              icon={FileJson}
              label={t("Library.offline.metadata")}
            />
          )}
        </div>

        {(!entry.hasDirectory || !hasMedia) && (
          <p className="text-destructive mt-2 text-[11px]">
            {t("Library.offline.missingFiles")}
          </p>
        )}
        {entry.warnings.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {entry.warnings.map((warning) => (
              <span
                key={warning}
                className="bg-muted text-muted-foreground rounded-sm px-1.5 py-0.5 text-[10px]"
              >
                {t(`Download.warning.${warning}`)}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!entry.hasDirectory || revealing}
            onClick={onReveal}
          >
            <FolderOpen className={cn(revealing && "animate-pulse")} />
            {t("Library.offline.reveal")}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                disabled={removing}
              >
                <Trash2 />
                {t("Library.offline.remove")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("Library.offline.removeTitle")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("Library.offline.removeDescription", {
                    title: entry.title,
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("Common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive hover:bg-destructive/90 text-white"
                  onClick={onRemove}
                >
                  {t("Library.offline.remove")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </article>
  );
}

export default function OfflineLibraryTab() {
  const { t } = useI18n();
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();
  const offlineQuery = useQuery({
    queryKey: biliKeys.offlineLibrary(),
    queryFn: fetchOfflineLibrary,
    staleTime: 15_000,
  });
  const revealMutation = useMutation({
    mutationFn: revealDownload,
    onError: (error) => toastError(normalizeBiliError(error).message),
  });
  const removeMutation = useMutation({
    mutationFn: removeDownload,
    onSuccess: () => {
      success("Library.offline.removed");
      void queryClient.invalidateQueries({
        queryKey: biliKeys.offlineLibrary(),
      });
      void queryClient.invalidateQueries({ queryKey: biliKeys.downloads() });
    },
    onError: (error) => toastError(normalizeBiliError(error).message),
  });

  if (offlineQuery.isPending) return <OfflineSkeleton />;
  if (offlineQuery.error) {
    return (
      <AsyncErrorState
        title={t("Library.offline.errorTitle")}
        description={t("Library.offline.errorDescription")}
        code={normalizeBiliError(offlineQuery.error).code}
        retryLabel={t("Library.retry")}
        onRetry={() => void offlineQuery.refetch()}
      />
    );
  }
  if (!offlineQuery.data?.length) {
    return (
      <div className="border-border flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 text-center">
        <Download className="text-muted-foreground size-6" />
        <div>
          <h2 className="text-base font-semibold">
            {t("Library.offline.emptyTitle")}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("Library.offline.emptyDescription")}
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/downloads">
            <Download />
            {t("Library.offline.openDownloads")}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
            {t("Library.offline.savedVideos")}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t("Library.offline.count", { count: offlineQuery.data.length })}
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label={t("Library.refresh")}
          disabled={offlineQuery.isFetching}
          onClick={() => void offlineQuery.refetch()}
        >
          <RefreshCw
            className={cn(offlineQuery.isFetching && "animate-spin")}
          />
        </Button>
      </div>
      <div className="divide-border/70 divide-y">
        {offlineQuery.data.map((entry) => (
          <OfflineEntryRow
            key={entry.id}
            entry={entry}
            removing={
              removeMutation.isPending && removeMutation.variables === entry.id
            }
            revealing={
              revealMutation.isPending && revealMutation.variables === entry.id
            }
            onRemove={() => removeMutation.mutate(entry.id)}
            onReveal={() => revealMutation.mutate(entry.id)}
          />
        ))}
      </div>
    </div>
  );
}
