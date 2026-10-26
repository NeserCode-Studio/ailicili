import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, LoaderCircle, SlidersHorizontal } from "lucide-react";

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
  fetchDownloadSettings,
  normalizeBiliError,
  setDownloadFfmpegPath,
  setDownloadRoot,
} from "@/lib/bili";

interface DownloadSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function DownloadSettingsDialog({
  open,
  onOpenChange,
}: DownloadSettingsDialogProps) {
  const { t } = useI18n();
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: biliKeys.downloadSettings(),
    queryFn: fetchDownloadSettings,
    enabled: open,
  });

  const updateSettings = (settings: Awaited<ReturnType<typeof setDownloadRoot>>) => {
    queryClient.setQueryData(biliKeys.downloadSettings(), settings);
    success("Download.settings.saved");
  };
  const rootMutation = useMutation({
    mutationFn: setDownloadRoot,
    onSuccess: updateSettings,
    onError: (error) => toastError(normalizeBiliError(error).message),
  });
  const ffmpegMutation = useMutation({
    mutationFn: setDownloadFfmpegPath,
    onSuccess: updateSettings,
    onError: (error) => toastError(normalizeBiliError(error).message),
  });

  const chooseRoot = async () => {
    try {
      const path = await openFileDialog({
        directory: true,
        multiple: false,
        title: t("Download.settings.root"),
      });
      if (typeof path === "string") rootMutation.mutate(path);
    } catch (error) {
      toastError(normalizeBiliError(error).message);
    }
  };

  const chooseFfmpeg = async () => {
    try {
      const path = await openFileDialog({
        directory: false,
        multiple: false,
        title: t("Download.settings.ffmpeg"),
        filters: [{ name: "FFmpeg", extensions: ["exe"] }],
      });
      if (typeof path === "string") ffmpegMutation.mutate(path);
    } catch (error) {
      toastError(normalizeBiliError(error).message);
    }
  };

  const settings = settingsQuery.data;
  const pending = rootMutation.isPending || ffmpegMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("Download.settings.title")}</DialogTitle>
          <DialogDescription>
            {t("Download.settings.description")}
          </DialogDescription>
        </DialogHeader>

        {settingsQuery.isPending ? (
          <div className="text-muted-foreground flex min-h-52 items-center justify-center gap-2 text-sm">
            <LoaderCircle className="size-4 animate-spin" />
            {t("Download.settings.loading")}
          </div>
        ) : settingsQuery.error || !settings ? (
          <div className="flex min-h-52 flex-col items-center justify-center gap-3">
            <p className="text-destructive text-sm">
              {t("Download.error.description")}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void settingsQuery.refetch()}
            >
              {t("Download.retry")}
            </Button>
          </div>
        ) : (
          <div className="divide-border/70 divide-y">
            <section className="pb-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">
                  {t("Download.settings.root")}
                </h3>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => void chooseRoot()}
                >
                  <FolderOpen className="size-3.5" />
                  {t("Download.settings.chooseRoot")}
                </Button>
              </div>
              <p className="bg-muted/50 text-foreground rounded-md px-3 py-2 font-mono text-xs break-all">
                {settings.rootPath}
              </p>
              <p className="text-muted-foreground mt-1.5 text-xs leading-5">
                {t("Download.settings.rootHelp")}
              </p>
            </section>

            <section className="py-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">
                  {t("Download.settings.ffmpeg")}
                </h3>
                <div className="flex gap-1.5">
                  {settings.ffmpegPath && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => ffmpegMutation.mutate(null)}
                    >
                      {t("Download.settings.clear")}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => void chooseFfmpeg()}
                  >
                    <SlidersHorizontal className="size-3.5" />
                    {t("Download.settings.chooseFfmpeg")}
                  </Button>
                </div>
              </div>
              <p className="text-muted-foreground text-xs break-all">
                {settings.ffmpegPath ?? t("Download.settings.missing")}
              </p>
              {settings.ffmpegVersion && (
                <p className="text-muted-foreground mt-1.5 text-xs">
                  {t("Download.settings.version", {
                    version: settings.ffmpegVersion,
                  })}
                </p>
              )}
              <p className="text-muted-foreground mt-1.5 text-xs leading-5">
                {t("Download.settings.ffmpegHelp")}
              </p>
            </section>

            <section className="pt-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">
                  {t("Download.settings.concurrency")}
                </h3>
                <span className="text-sm font-semibold tabular-nums">
                  {settings.maxConcurrent}
                </span>
              </div>
              <p className="text-muted-foreground mt-1.5 text-xs leading-5">
                {t("Download.settings.concurrencyHelp")}
              </p>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("Common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
