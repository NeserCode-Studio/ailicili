import { AlertCircle, RefreshCw, type LucideIcon } from "lucide-react";

import type { CommandError } from "@/api/account";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/composables";
import { commandErrorMessage } from "@/lib/command-error";

export function LibraryLoadingGrid() {
  return (
    <div className="video-grid" aria-busy="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          className="border-border/60 bg-card overflow-hidden rounded-lg border"
        >
          <Skeleton className="aspect-video w-full rounded-none" />
          <div className="stack-2 p-3">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface LibraryEmptyStateProps {
  icon: LucideIcon;
  title: string;
  actionLabel: string;
  onAction: () => void;
}

export function LibraryEmptyState({
  icon: Icon,
  title,
  actionLabel,
  onAction,
}: LibraryEmptyStateProps) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-6 py-16 text-center">
      <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <p className="text-foreground text-sm font-medium">{title}</p>
      <Button type="button" variant="outline" size="sm" onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}

interface LibraryErrorAlertProps {
  error: CommandError;
  onRetry: () => void;
}

export function LibraryErrorAlert({ error, onRetry }: LibraryErrorAlertProps) {
  const { t } = useI18n();

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pt-4">
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>{t("Library.error")}</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>{commandErrorMessage(error, t)}</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw />
            {t("Library.retry")}
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
