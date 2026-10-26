import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderOpen,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Settings2,
  Trash2,
  X,
} from "lucide-react";

import AsyncErrorState from "@/components/feedback/AsyncErrorState";
import PageTitlebarActions from "@/components/framework/PageTitlebarActions";
import { Tooltip } from "@/components/framework/Tooltip";
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
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n, useToast } from "@/composables";
import { usePageTitlebarTitle } from "@/contexts/pageTitlebar";
import DownloadSettingsDialog from "@/features/downloads/DownloadSettingsDialog";
import {
  downloadDisplayName,
  useDownloadSnapshot,
} from "@/features/downloads/useDownloads";
import {
  biliKeys,
  cancelDownload,
  normalizeBiliError,
  pauseDownload,
  removeDownload,
  resumeDownload,
  retryDownload,
  revealDownload,
} from "@/lib/bili";
import { formatByteSize, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  DownloadPhase,
  DownloadStatus,
  DownloadTask,
} from "@/shared/bili.types";

type DownloadActionKind =
  | "pause"
  | "resume"
  | "retry"
  | "cancel"
  | "remove"
  | "reveal";

interface DownloadAction {
  id: string;
  kind: DownloadActionKind;
}

const ACTION_TOAST_KEY: Partial<Record<DownloadActionKind, string>> = {
  pause: "Download.toast.paused",
  resume: "Download.toast.resumed",
  retry: "Download.toast.retried",
  cancel: "Download.toast.cancelled",
  remove: "Download.toast.removed",
};

function DownloadCardSkeleton() {
  return (
    <div className="flex gap-4 py-4">
      <Skeleton className="aspect-video w-32 shrink-0" />
      <div className="flex-1 space-y-2 py-1">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-2 w-full" />
      </div>
    </div>
  );
}

function statusTone(status: DownloadStatus) {
  switch (status) {
    case "completed":
      return "text-emerald-700 bg-emerald-500/10 dark:text-emerald-400";
    case "failed":
      return "text-destructive bg-destructive/10";
    case "downloading":
    case "muxing":
      return "text-primary bg-primary/10";
    case "paused":
      return "text-amber-700 bg-amber-500/10 dark:text-amber-400";
    case "cancelled":
      return "text-muted-foreground bg-muted";
    default:
      return "text-brand-blue bg-brand-blue/10";
  }
}

function phaseKey(phase: DownloadPhase) {
  return `Download.phase.${phase}`;
}

function statusKey(status: DownloadStatus) {
  return `Download.status.${status}`;
}

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

function ConfirmDownloadAction({
  task,
  kind,
  title,
  description,
  disabled,
  onConfirm,
}: {
  task: DownloadTask;
  kind: "cancel" | "remove";
  title: string;
  description: string;
  disabled: boolean;
  onConfirm: (action: DownloadAction) => void;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog>
      <Tooltip content={kind === "cancel" ? t("Download.action.cancel") : t("Download.action.remove")}>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={
              kind === "cancel"
                ? t("Download.action.cancel")
                : t("Download.action.remove")
            }
            disabled={disabled}
          >
            {kind === "cancel" ? (
              <X className="size-4" />
            ) : (
              <Trash2 className="size-4" />
            )}
          </Button>
        </AlertDialogTrigger>
      </Tooltip>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("Common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onConfirm({ id: task.id, kind })}
          >
            {t("Download.action.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DownloadTaskRow({
  task,
  onAction,
  pending,
}: {
  task: DownloadTask;
  onAction: (action: DownloadAction) => void;
  pending: boolean;
}) {
  const { lang, t } = useI18n();
  const running = task.status === "downloading" || task.status === "muxing";
  const queued = task.status === "queued";
  const paused = task.status === "paused";
  const retryable = task.status === "failed" || task.status === "cancelled";
  const terminal = task.status === "completed";

  return (
    <article className="flex gap-3 py-4 sm:gap-4">
      <img
        src={task.coverUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className="bg-muted aspect-video w-28 shrink-0 rounded-md object-cover sm:w-36"
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-medium" title={downloadDisplayName(task)}>
              {task.title}
            </h3>
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              {task.partTitle && task.partTitle !== task.title
                ? `${t("Download.meta.part")} · ${task.partTitle}`
                : t(`Download.meta.quality`, {
                    quality: task.qualityLabel,
                    width: task.width,
                    height: task.height,
                  })}
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-sm px-2 py-1 text-[11px] font-medium",
              statusTone(task.status)
            )}
          >
            {t(statusKey(task.status))}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span className="text-muted-foreground">
            {t(`Download.meta.quality`, {
              quality: task.qualityLabel,
              width: task.width,
              height: task.height,
            })}
          </span>
          {task.totalBytes > 0 && (
            <span className="text-muted-foreground tabular-nums">
              {t("Download.meta.size", {
                done: formatByteSize(task.downloadedBytes, lang),
                total: formatByteSize(task.totalBytes, lang),
              })}
            </span>
          )}
          {task.speedBytesPerSecond > 0 && (
            <span className="text-muted-foreground tabular-nums">
              {t("Download.meta.speed", {
                speed: formatByteSize(task.speedBytesPerSecond, lang),
              })}
            </span>
          )}
          {task.etaSeconds !== null && task.etaSeconds > 0 && (
            <span className="text-muted-foreground tabular-nums">
              {t("Download.meta.eta", {
                eta: formatDuration(task.etaSeconds),
              })}
            </span>
          )}
        </div>

        <Progress
          value={task.status === "completed" ? 100 : task.progressPercent}
          className="mt-2 h-1.5"
        />

        <div className="mt-2 flex min-w-0 items-center justify-between gap-3">
          <p className="text-muted-foreground min-w-0 truncate text-[11px]">
            {queued
              ? t("Download.meta.waiting")
              : t(phaseKey(task.phase))}
          </p>
          <div className="flex shrink-0 items-center">
            {(queued || running) && (
              <IconAction
                label={t("Download.action.pause")}
                disabled={pending || task.status === "muxing"}
                onClick={() => onAction({ id: task.id, kind: "pause" })}
              >
                <Pause className="size-4" />
              </IconAction>
            )}
            {paused && (
              <IconAction
                label={t("Download.action.resume")}
                disabled={pending}
                onClick={() => onAction({ id: task.id, kind: "resume" })}
              >
                <Play className="size-4" />
              </IconAction>
            )}
            {retryable && (
              <IconAction
                label={t("Download.action.retry")}
                disabled={pending}
                onClick={() => onAction({ id: task.id, kind: "retry" })}
              >
                <RotateCcw className="size-4" />
              </IconAction>
            )}
            {(terminal || paused || retryable) && (
              <IconAction
                label={t("Download.action.reveal")}
                disabled={pending}
                onClick={() => onAction({ id: task.id, kind: "reveal" })}
              >
                <FolderOpen className="size-4" />
              </IconAction>
            )}
            {(queued || running || paused) && (
              <ConfirmDownloadAction
                task={task}
                kind="cancel"
                title={t("Download.action.cancelTitle")}
                description={t("Download.action.cancelDescription")}
                disabled={pending}
                onConfirm={onAction}
              />
            )}
            {(terminal || retryable) && (
              <ConfirmDownloadAction
                task={task}
                kind="remove"
                title={t("Download.action.removeTitle")}
                description={t("Download.action.removeDescription")}
                disabled={pending}
                onConfirm={onAction}
              />
            )}
          </div>
        </div>

        {task.errorMessage && (
          <p className="text-destructive mt-1.5 line-clamp-2 text-[11px]">
            {task.errorMessage}
          </p>
        )}
        {task.warnings.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {task.warnings.map((warning) => (
              <span
                key={warning}
                className="bg-muted text-muted-foreground rounded-sm px-1.5 py-0.5 text-[10px]"
              >
                {t(`Download.warning.${warning}`)}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function TaskSection({
  title,
  tasks,
  onAction,
  pending,
}: {
  title: string;
  tasks: DownloadTask[];
  onAction: (action: DownloadAction) => void;
  pending: boolean;
}) {
  if (tasks.length === 0) return null;
  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-muted-foreground text-xs tabular-nums">
          {tasks.length}
        </span>
      </div>
      <div className="divide-border/70 divide-y">
        {tasks.map((task) => (
          <DownloadTaskRow
            key={task.id}
            task={task}
            onAction={onAction}
            pending={pending}
          />
        ))}
      </div>
    </section>
  );
}

export default function DownloadsPage() {
  const { t } = useI18n();
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();
  const snapshotQuery = useDownloadSnapshot();
  const [settingsOpen, setSettingsOpen] = useState(false);
  usePageTitlebarTitle(t("Download.title"));

  const actionMutation = useMutation({
    mutationFn: async (action: DownloadAction) => {
      switch (action.kind) {
        case "pause":
          return pauseDownload(action.id);
        case "resume":
          return resumeDownload(action.id);
        case "retry":
          return retryDownload(action.id);
        case "cancel":
          return cancelDownload(action.id);
        case "remove":
          return removeDownload(action.id);
        case "reveal":
          return revealDownload(action.id);
      }
    },
    onSuccess: (_, action) => {
      const key = ACTION_TOAST_KEY[action.kind];
      if (key) success(key);
      void queryClient.invalidateQueries({ queryKey: biliKeys.downloads() });
    },
    onError: (error) => toastError(normalizeBiliError(error).message),
  });

  const runAction = (action: DownloadAction) => actionMutation.mutate(action);
  const tasks = snapshotQuery.data?.tasks ?? [];
  const activeTasks = tasks.filter((task) =>
    ["queued", "downloading", "muxing"].includes(task.status)
  );
  const pausedTasks = tasks.filter((task) => task.status === "paused");
  const failedTasks = tasks.filter((task) =>
    ["failed", "cancelled"].includes(task.status)
  );
  const completedTasks = tasks.filter((task) => task.status === "completed");

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-7">
      <PageTitlebarActions>
        <Tooltip content={t("Download.settings")}>
          <button
            type="button"
            className="titlebar-op"
            aria-label={t("Download.settings")}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 className="titlebar-op-icon" />
          </button>
        </Tooltip>
      </PageTitlebarActions>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-md">
              <Download className="size-4" />
            </span>
            <h1 className="text-xl font-semibold">{t("Download.title")}</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            {t("Download.description")}
          </p>
        </div>
        <div className="flex gap-2">
          <Tooltip content={t("Download.refresh")}>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label={t("Download.refresh")}
              disabled={snapshotQuery.isFetching}
              onClick={() => void snapshotQuery.refetch()}
            >
              <RefreshCw
                className={cn(
                  "size-4",
                  snapshotQuery.isFetching && "animate-spin"
                )}
              />
            </Button>
          </Tooltip>
          <Button
            type="button"
            variant="outline"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 className="size-4" />
            {t("Download.settings")}
          </Button>
        </div>
      </header>

      {snapshotQuery.data && (
        <div className="border-border/80 mb-6 grid grid-cols-3 divide-x rounded-md border">
          {[
            {
              icon: LoaderCircle,
              label: t("Download.summary.active"),
              value: snapshotQuery.data.activeCount,
            },
            {
              icon: Download,
              label: t("Download.summary.queued"),
              value: snapshotQuery.data.queuedCount,
            },
            {
              icon: CheckCircle2,
              label: t("Download.summary.completed"),
              value: snapshotQuery.data.completedCount,
            },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2 px-4 py-3">
              <item.icon className="text-muted-foreground size-4" />
              <span className="text-muted-foreground text-xs">{item.label}</span>
              <span className="ml-auto text-base font-semibold tabular-nums">
                {item.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {snapshotQuery.isPending ? (
        <div className="divide-border/70 divide-y" aria-busy="true">
          <DownloadCardSkeleton />
          <DownloadCardSkeleton />
          <DownloadCardSkeleton />
        </div>
      ) : snapshotQuery.error ? (
        <AsyncErrorState
          title={t("Download.error.title")}
          description={t("Download.error.description")}
          code={normalizeBiliError(snapshotQuery.error).code}
          retryLabel={t("Download.retry")}
          onRetry={() => void snapshotQuery.refetch()}
        />
      ) : tasks.length === 0 ? (
        <div className="border-border flex min-h-80 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 text-center">
          <Download className="text-muted-foreground size-7" />
          <div>
            <h2 className="text-base font-semibold">
              {t("Download.empty.title")}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("Download.empty.description")}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-7">
          <TaskSection
            title={t("Download.summary.active")}
            tasks={activeTasks}
            onAction={runAction}
            pending={actionMutation.isPending}
          />
          <TaskSection
            title={t("Download.status.paused")}
            tasks={pausedTasks}
            onAction={runAction}
            pending={actionMutation.isPending}
          />
          <TaskSection
            title={t("Download.status.failed")}
            tasks={failedTasks}
            onAction={runAction}
            pending={actionMutation.isPending}
          />
          <TaskSection
            title={t("Download.summary.completed")}
            tasks={completedTasks}
            onAction={runAction}
            pending={actionMutation.isPending}
          />
        </div>
      )}

      {actionMutation.error && (
        <div
          role="alert"
          className="text-destructive mt-4 flex items-center gap-2 text-xs"
        >
          <AlertCircle className="size-4" />
          {normalizeBiliError(actionMutation.error).message}
        </div>
      )}

      <DownloadSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </div>
  );
}
