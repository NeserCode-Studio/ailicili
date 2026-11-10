import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, History } from "lucide-react";

import { listLocalHistory, type HistoryEntry } from "@/api/media";
import { asCommandError, type CommandError } from "@/api/account";
import HistoryCard from "@/components/library/HistoryCard";
import {
  LibraryEmptyState,
  LibraryErrorAlert,
  LibraryLoadingGrid,
} from "@/components/library/LibraryStates";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/composables";
import { useNavigatorContext } from "@/contexts/navigator";
import { historyResumePath } from "@/lib/library";
import { createLogger } from "@/lib/logger";

const log = createLogger("Library/History");

export default function HistoryView() {
  const { t, lang } = useI18n();
  const { navigator } = useNavigatorContext();
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CommandError | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const entries = await listLocalHistory();
      if (requestId !== requestIdRef.current) return;
      setItems(entries);
      log.info("history loaded", { count: entries.length });
    } catch (reason) {
      if (requestId !== requestIdRef.current) return;
      const normalized = asCommandError(reason);
      setError(normalized);
      log.error("history load failed", { code: normalized.code });
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  const resume = (entry: HistoryEntry) => {
    log.info("resume history", {
      videoId: entry.card.videoId,
      cid: entry.pageCid,
      progressSeconds: entry.progressSeconds,
    });
    navigator(historyResumePath(entry));
  };

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
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => navigator("/")}
          >
            <ArrowLeft />
            {t("Library.backHome")}
          </Button>
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
        <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-4 p-4 xl:grid-cols-2">
          {items.map((entry) => (
            <HistoryCard
              key={`${entry.card.platform}:${entry.card.videoId}:${entry.pageCid}`}
              entry={entry}
              locale={lang}
              onResume={resume}
            />
          ))}
        </div>
      )}
    </div>
  );
}
