import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, History, Loader2, Trash2 } from "lucide-react";

import {
  clearLocalHistory,
  listLocalHistory,
  removeLocalHistory,
  type HistoryEntry,
} from "@/api/media";
import { asCommandError, type CommandError } from "@/api/account";
import HistoryCard from "@/components/library/HistoryCard";
import {
  LibraryEmptyState,
  LibraryErrorAlert,
  LibraryLoadingGrid,
} from "@/components/library/LibraryStates";
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
import { useI18n, useToast } from "@/composables";
import { useNavigatorContext } from "@/contexts/navigator";
import { isHistoryEntryComplete } from "@/lib/history";
import { historyResumePath } from "@/lib/library";
import { createLogger } from "@/lib/logger";

const log = createLogger("Library/History");

function historyEntryKey(entry: HistoryEntry) {
  return `${entry.card.platform}:${entry.card.videoId}:${entry.pageCid}`;
}

interface HistoryViewProps {
  active?: boolean;
}

export default function HistoryView({ active = true }: HistoryViewProps) {
  const { t, lang } = useI18n();
  const { navigator } = useNavigatorContext();
  const { success: toastSuccess, error: toastError } = useToast();
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [error, setError] = useState<CommandError | null>(null);
  const requestIdRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const wasActiveRef = useRef(false);

  const load = useCallback(async (background = false) => {
    const requestId = ++requestIdRef.current;
    if (!background) {
      setLoading(true);
      setError(null);
    }
    try {
      const entries = await listLocalHistory();
      if (requestId !== requestIdRef.current) return;
      setError(null);
      setItems(entries);
      log.info("history loaded", { count: entries.length });
    } catch (reason) {
      if (requestId !== requestIdRef.current) return;
      const normalized = asCommandError(reason);
      if (background) {
        log.warn("history background refresh failed", {
          code: normalized.code,
        });
        return;
      }
      setError(normalized);
      log.error("history load failed", { code: normalized.code });
    } finally {
      if (!background && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!active) {
      wasActiveRef.current = false;
      return;
    }
    const background = hasLoadedRef.current && !wasActiveRef.current;
    hasLoadedRef.current = true;
    wasActiveRef.current = true;
    void load(background);
  }, [active, load]);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
    };
  }, []);

  const resume = (entry: HistoryEntry) => {
    log.info("resume history", {
      videoId: entry.card.videoId,
      cid: entry.pageCid,
      progressSeconds: entry.progressSeconds,
      completed: isHistoryEntryComplete(entry),
    });
    navigator(historyResumePath(entry));
  };

  const clear = useCallback(async () => {
    if (clearing || removingKey || items.length === 0) return;

    setClearing(true);
    try {
      const entries = await clearLocalHistory();
      setItems(entries);
      toastSuccess("Library.history.cleared");
      log.info("history cleared");
    } catch (reason) {
      toastError("Library.history.clearFailed");
      log.error("history clear failed", {
        code: asCommandError(reason).code,
      });
    } finally {
      setClearing(false);
    }
  }, [clearing, items.length, removingKey, toastError, toastSuccess]);

  const remove = useCallback(
    async (entry: HistoryEntry) => {
      const key = historyEntryKey(entry);
      if (clearing || removingKey) return;

      setRemovingKey(key);
      try {
        const entries = await removeLocalHistory(
          entry.card.platform,
          entry.card.videoId
        );
        setItems(entries);
        toastSuccess("Library.history.removed");
        log.info("history entry removed", {
          videoId: entry.card.videoId,
          cid: entry.pageCid,
        });
      } catch (reason) {
        toastError("Library.history.removeFailed");
        log.error("history entry remove failed", {
          videoId: entry.card.videoId,
          code: asCommandError(reason).code,
        });
      } finally {
        setRemovingKey(null);
      }
    },
    [clearing, removingKey, toastError, toastSuccess]
  );

  return (
    <div className="flex h-full w-full flex-col">
      <header className="border-border/60 border-b">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">
              {t("Library.history.title")}
            </h1>
            {!loading && !error ? (
              <p className="text-muted-xs mt-0.5">
                {items.length} {t("Library.history.unit")}
              </p>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {!loading && !error && items.length > 0 ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={clearing || removingKey !== null}
                  >
                    {clearing ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Trash2 />
                    )}
                    {t("Library.history.clear")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("Library.history.clearTitle")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("Library.history.clearDescription")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("Library.cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive hover:bg-destructive/90 text-white"
                      onClick={() => void clear()}
                    >
                      {t("Library.history.clearConfirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigator("/")}
            >
              <ArrowLeft />
              {t("Library.backHome")}
            </Button>
          </div>
        </div>
      </header>

      {error ? (
        <LibraryErrorAlert error={error} onRetry={() => void load()} />
      ) : null}

      {loading ? (
        <LibraryLoadingGrid />
      ) : error ? null : items.length === 0 ? (
        <LibraryEmptyState
          icon={History}
          title={t("Library.history.empty")}
          actionLabel={t("Library.backHome")}
          onAction={() => navigator("/")}
        />
      ) : (
        <div className="video-grid">
          {items.map((entry) => (
            <HistoryCard
              key={historyEntryKey(entry)}
              entry={entry}
              locale={lang}
              removing={removingKey === historyEntryKey(entry)}
              disabled={removingKey !== null || clearing}
              onResume={resume}
              onRemove={(item) => void remove(item)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
