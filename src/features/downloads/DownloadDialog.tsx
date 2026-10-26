import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n, useToast } from "@/composables";
import {
  biliKeys,
  createDownload,
  fetchDownloadOptions,
  fetchDownloadSettings,
  normalizeBiliError,
} from "@/lib/bili";
import { cn } from "@/lib/utils";

interface DownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bvid: string;
  cid: number;
  partTitle: string;
}

export default function DownloadDialog({
  open,
  onOpenChange,
  bvid,
  cid,
  partTitle,
}: DownloadDialogProps) {
  const { t } = useI18n();
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();
  const [selectedQuality, setSelectedQuality] = useState(0);

  const optionsQuery = useQuery({
    queryKey: biliKeys.downloadOptions(bvid, cid),
    queryFn: () => fetchDownloadOptions(bvid, cid),
    enabled: open && cid > 0,
    staleTime: 5 * 60_000,
  });
  const settingsQuery = useQuery({
    queryKey: biliKeys.downloadSettings(),
    queryFn: fetchDownloadSettings,
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!optionsQuery.data) return;
    const available = optionsQuery.data.qualities.some(
      (quality) => quality.id === selectedQuality
    );
    if (!available) {
      setSelectedQuality(
        optionsQuery.data.defaultQuality ||
          optionsQuery.data.qualities[0]?.id ||
          0
      );
    }
  }, [optionsQuery.data, selectedQuality]);

  const createMutation = useMutation({
    mutationFn: () => createDownload(bvid, cid, selectedQuality),
    onSuccess: () => {
      success("Download.dialog.created");
      void queryClient.invalidateQueries({ queryKey: biliKeys.downloads() });
      onOpenChange(false);
    },
    onError: (error) => toastError(normalizeBiliError(error).message),
  });

  const qualities = optionsQuery.data?.qualities ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Download.dialog.title")}</DialogTitle>
          <DialogDescription>
            {t("Download.dialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {partTitle && (
            <div className="bg-muted/45 rounded-md px-3 py-2">
              <span className="text-muted-foreground text-[11px] font-medium">
                {t("Download.dialog.currentPart")}
              </span>
              <p className="mt-0.5 truncate text-sm">{partTitle}</p>
            </div>
          )}

          <section aria-labelledby="download-quality-heading">
            <h3
              id="download-quality-heading"
              className="mb-2 text-xs font-medium"
            >
              {t("Download.dialog.quality")}
            </h3>
            {optionsQuery.isPending ? (
              <div className="text-muted-foreground flex min-h-28 items-center justify-center gap-2 text-sm">
                <LoaderCircle className="size-4 animate-spin" />
                {t("Download.dialog.loading")}
              </div>
            ) : optionsQuery.error ? (
              <div className="border-destructive/30 bg-destructive/5 flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border px-4 text-center">
                <p className="text-destructive text-sm">
                  {t("Download.dialog.error")}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void optionsQuery.refetch()}
                >
                  {t("Download.retry")}
                </Button>
              </div>
            ) : qualities.length === 0 ? (
              <p className="text-muted-foreground min-h-28 py-10 text-center text-sm">
                {t("Download.dialog.noQualities")}
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {qualities.map((quality) => {
                  const selected = selectedQuality === quality.id;
                  return (
                    <button
                      key={quality.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSelectedQuality(quality.id)}
                      className={cn(
                        "border-border hover:bg-muted/50 flex min-h-14 items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                        selected && "border-primary bg-primary/5"
                      )}
                    >
                      <span
                        className={cn(
                          "border-border flex size-5 shrink-0 items-center justify-center rounded-sm border",
                          selected && "border-primary bg-primary text-primary-foreground"
                        )}
                      >
                        {selected && <Check className="size-3.5" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {quality.label}
                        </span>
                        <span className="text-muted-foreground block text-[11px]">
                          {quality.width}×{quality.height}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <p className="text-muted-foreground border-border/70 border-t pt-3 text-xs leading-5">
            {settingsQuery.data?.ffmpegAvailable
              ? t("Download.dialog.ffmpegReady")
              : t("Download.dialog.ffmpegMissing")}
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("Common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={
              selectedQuality === 0 ||
              qualities.length === 0 ||
              createMutation.isPending
            }
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending && (
              <LoaderCircle className="size-4 animate-spin" />
            )}
            {t("Download.dialog.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
