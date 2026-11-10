import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Star } from "lucide-react";

import {
  listLocalFavorites,
  removeLocalFavorite,
  type FavoriteEntry,
} from "@/api/media";
import { asCommandError, type CommandError } from "@/api/account";
import FavoriteCard from "@/components/library/FavoriteCard";
import {
  LibraryEmptyState,
  LibraryErrorAlert,
  LibraryLoadingGrid,
} from "@/components/library/LibraryStates";
import { Button } from "@/components/ui/button";
import { useI18n, useToast } from "@/composables";
import { useNavigatorContext } from "@/contexts/navigator";
import { favoriteTargetKey, favoriteVideoPath } from "@/lib/library";
import { createLogger } from "@/lib/logger";

const log = createLogger("Library/Favorites");

export default function Favorites() {
  const { t, lang } = useI18n();
  const { navigator } = useNavigatorContext();
  const { success: toastSuccess, error: toastError } = useToast();
  const [items, setItems] = useState<FavoriteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CommandError | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const entries = await listLocalFavorites();
      if (requestId !== requestIdRef.current) return;
      setItems(entries);
      log.info("favorites loaded", { count: entries.length });
    } catch (reason) {
      if (requestId !== requestIdRef.current) return;
      const normalized = asCommandError(reason);
      setError(normalized);
      log.error("favorites load failed", { code: normalized.code });
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

  const remove = useCallback(
    async (entry: FavoriteEntry) => {
      if (removingKey) return;
      const targetKey = favoriteTargetKey(entry.target);
      setRemovingKey(targetKey);
      try {
        const entries = await removeLocalFavorite(entry.target);
        setItems(entries);
        toastSuccess("Library.favorites.removed");
        log.info("favorite removed", {
          platform: entry.target.platform,
          kind: entry.target.kind,
          targetId: entry.target.targetId,
        });
      } catch (reason) {
        toastError("Library.favorites.updateFailed");
        log.error("favorite remove failed", {
          code: asCommandError(reason).code,
        });
      } finally {
        setRemovingKey(null);
      }
    },
    [removingKey, toastError, toastSuccess]
  );

  const open = (entry: FavoriteEntry) => {
    if (entry.target.kind !== "video") return;
    navigator(favoriteVideoPath(entry));
  };

  return (
    <div className="flex h-full w-full flex-col">
      <header className="border-border/60 border-b">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">
              {t("Library.favorites.title")}
            </h1>
            {!loading && !error ? (
              <p className="text-muted-xs mt-0.5">
                {items.length} {t("Library.favorites.unit")}
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
          icon={Star}
          title={t("Library.favorites.empty")}
          actionLabel={t("Library.backHome")}
          onAction={() => navigator("/")}
        />
      ) : (
        <div className="video-grid">
          {items.map((entry) => {
            const targetKey = favoriteTargetKey(entry.target);
            return (
              <FavoriteCard
                key={targetKey}
                entry={entry}
                locale={lang}
                removing={removingKey === targetKey}
                disabled={Boolean(removingKey)}
                onOpen={open}
                onRemove={(item) => void remove(item)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
