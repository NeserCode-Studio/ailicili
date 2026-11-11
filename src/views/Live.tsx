import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Hash,
  Lock,
  Loader2,
  Radio,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { asCommandError, type CommandError } from "@/api/account";
import {
  getLiveDiscovery,
  searchLiveRooms,
  type LiveDiscovery,
  type LiveRoomCard as LiveRoomCardModel,
} from "@/api/live";
import type { PlatformId } from "@/api/platforms";
import LiveRoomCard from "@/components/live/LiveRoomCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/composables";
import { useAccount } from "@/contexts/account-context";
import { useNavigatorContext } from "@/contexts/navigator";
import { commandErrorKey } from "@/lib/command-error";
import {
  getSelectedLivePlatformId,
  setSelectedLivePlatformId,
} from "@/lib/live-preferences";
import { rememberLiveRoomCard } from "@/lib/live-room-cache";
import { liveRoomPath } from "@/lib/live-routes";
import { createLogger } from "@/lib/logger";

const log = createLogger("Media/Live");

type BrowseMode = "discovery" | "search";

function roomKey(room: LiveRoomCardModel) {
  return `${room.platform}:${room.roomId}`;
}

function mergeRooms(
  current: LiveRoomCardModel[],
  incoming: LiveRoomCardModel[]
) {
  const seen = new Set(current.map(roomKey));
  return [
    ...current,
    ...incoming.filter((room) => {
      const key = roomKey(room);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
}

function LiveGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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

export default function Live() {
  const { t } = useI18n();
  const { navigator } = useNavigatorContext();
  const {
    accountRevisions,
    platformCatalog,
    loading: accountLoading,
  } = useAccount();
  const [mode, setMode] = useState<BrowseMode>("discovery");
  const [selectedPlatformId, setSelectedPlatformId] =
    useState<PlatformId | null>(getSelectedLivePlatformId);
  const [keyword, setKeyword] = useState("");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [query, setQuery] = useState("");
  const [discovery, setDiscovery] = useState<LiveDiscovery | null>(null);
  const [items, setItems] = useState<LiveRoomCardModel[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<CommandError | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const requestIdRef = useRef(0);
  const accountRevisionRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const livePlatforms = useMemo(
    () =>
      platformCatalog.filter(
        (platform) =>
          platform.availability === "available" &&
          Boolean(platform.liveCapability)
      ),
    [platformCatalog]
  );
  const selectedPlatform = useMemo(
    () =>
      livePlatforms.find((platform) => platform.id === selectedPlatformId) ??
      null,
    [livePlatforms, selectedPlatformId]
  );
  const searchSupported = Boolean(
    selectedPlatform?.liveCapability?.supportsSearch
  );
  const accountRevision = selectedPlatformId
    ? (accountRevisions[selectedPlatformId] ?? 0)
    : 0;
  accountRevisionRef.current = accountRevision;

  useEffect(() => {
    if (
      livePlatforms.length > 0 &&
      !livePlatforms.some((platform) => platform.id === selectedPlatformId)
    ) {
      const fallbackPlatformId = livePlatforms[0].id;
      setSelectedPlatformId(fallbackPlatformId);
      setSelectedLivePlatformId(fallbackPlatformId);
      setKeyword("");
      setRoomIdInput("");
      setQuery("");
      setMode("discovery");
    }
  }, [livePlatforms, selectedPlatformId]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const revision = accountRevisionRef.current;
    if (!selectedPlatformId) {
      setLoading(!accountLoading);
      setLoadingMore(false);
      setError(null);
      setDiscovery(null);
      setItems([]);
      setPage(1);
      setTotal(0);
      setHasMore(false);
      return () => {
        requestIdRef.current += 1;
      };
    }

    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setDiscovery(null);
    setItems([]);
    setPage(1);
    setTotal(0);
    setHasMore(false);

    if (mode === "discovery") {
      void getLiveDiscovery(selectedPlatformId)
        .then((result) => {
          if (
            requestId !== requestIdRef.current ||
            revision !== accountRevisionRef.current
          ) {
            return;
          }
          setDiscovery(result);
          log.info("live discovery loaded", {
            sections: result.sections.length,
            rooms: result.sections.reduce(
              (count, section) => count + section.rooms.length,
              0
            ),
          });
        })
        .catch((reason) => {
          if (
            requestId !== requestIdRef.current ||
            revision !== accountRevisionRef.current
          ) {
            return;
          }
          const normalized = asCommandError(reason);
          setError(normalized);
          log.error("live discovery failed", { code: normalized.code });
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
      return () => {
        requestIdRef.current += 1;
      };
    }

    void searchLiveRooms(selectedPlatformId, query, 1)
      .then((result) => {
        if (
          requestId !== requestIdRef.current ||
          revision !== accountRevisionRef.current
        ) {
          return;
        }
        setItems(mergeRooms([], result.items));
        setPage(result.page || 1);
        setHasMore(result.hasMore);
        setTotal(result.total);
        log.info("live search loaded", {
          page: result.page,
          count: result.items.length,
          total: result.total,
        });
      })
      .catch((reason) => {
        if (
          requestId !== requestIdRef.current ||
          revision !== accountRevisionRef.current
        ) {
          return;
        }
        const normalized = asCommandError(reason);
        setError(normalized);
        log.error("live search failed", { code: normalized.code });
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });

    return () => {
      requestIdRef.current += 1;
    };
  }, [
    accountLoading,
    accountRevision,
    mode,
    query,
    reloadToken,
    selectedPlatformId,
  ]);

  const loadMore = useCallback(async () => {
    if (
      !selectedPlatformId ||
      mode !== "search" ||
      loading ||
      loadingMoreRef.current ||
      !hasMore
    ) {
      return;
    }

    loadingMoreRef.current = true;
    const requestId = ++requestIdRef.current;
    const revision = accountRevisionRef.current;
    const requestedPage = page + 1;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await searchLiveRooms(
        selectedPlatformId,
        query,
        requestedPage
      );
      if (
        requestId !== requestIdRef.current ||
        revision !== accountRevisionRef.current
      ) {
        return;
      }
      setItems((current) => mergeRooms(current, result.items));
      setPage(result.page || requestedPage);
      setHasMore(result.hasMore);
      setTotal(result.total);
      log.info("live search page loaded", {
        page: result.page,
        count: result.items.length,
      });
    } catch (reason) {
      if (
        requestId !== requestIdRef.current ||
        revision !== accountRevisionRef.current
      ) {
        return;
      }
      const normalized = asCommandError(reason);
      setError(normalized);
      log.error("live search page failed", { code: normalized.code });
    } finally {
      loadingMoreRef.current = false;
      if (requestId === requestIdRef.current) setLoadingMore(false);
    }
  }, [hasMore, loading, mode, page, query, selectedPlatformId]);

  const submitSearch = () => {
    if (!searchSupported) return;
    const nextQuery = keyword.trim();
    if (!nextQuery) {
      clearSearch();
      return;
    }
    setQuery(nextQuery);
    setMode("search");
    setReloadToken((value) => value + 1);
  };

  const openDirectRoom = () => {
    const roomId = roomIdInput.trim();
    if (!selectedPlatformId || !roomId) return;
    navigator(liveRoomPath(selectedPlatformId, roomId));
  };

  const clearSearch = () => {
    setKeyword("");
    setQuery("");
    setMode("discovery");
    setReloadToken((value) => value + 1);
  };

  const refresh = () => setReloadToken((value) => value + 1);
  const openRoom = (room: LiveRoomCardModel) => {
    rememberLiveRoomCard(room);
    navigator(liveRoomPath(room.platform, room.roomId));
  };
  const changePlatform = (platformId: PlatformId) => {
    if (platformId === selectedPlatformId) return;
    setSelectedLivePlatformId(platformId);
    setSelectedPlatformId(platformId);
    setKeyword("");
    setRoomIdInput("");
    setQuery("");
    setMode("discovery");
  };

  return (
    <div className="view-home">
      <header className="border-border/60 border-b">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">
              {t("Live.title")}
            </h1>
            <p className="text-muted-xs mt-0.5 truncate">
              {mode === "search"
                ? t("Live.search.results")
                : t("Live.discovery.subtitle")}
            </p>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => navigator("/")}
          >
            <ArrowLeft />
            {t("Live.backHome")}
          </Button>

          {livePlatforms.length > 1 ? (
            <Select
              value={selectedPlatformId ?? undefined}
              onValueChange={changePlatform}
            >
              <SelectTrigger
                size="sm"
                className="min-w-32"
                aria-label={t("Live.platform.label")}
              >
                <SelectValue placeholder={t("Live.platform.label")} />
              </SelectTrigger>
              <SelectContent>
                {livePlatforms.map((platform) => (
                  <SelectItem key={platform.id} value={platform.id}>
                    {platform.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <form
            className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (searchSupported) {
                submitSearch();
              } else {
                openDirectRoom();
              }
            }}
          >
            {searchSupported ? (
              <>
                <div className="relative min-w-40 flex-1 sm:max-w-80">
                  <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <Input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder={t("Live.search.placeholder")}
                    className="w-full pl-9"
                  />
                </div>
                <Button type="submit" variant="outline" size="sm">
                  <Search />
                  {t("Live.search")}
                </Button>
                {mode === "search" || keyword ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearSearch}
                  >
                    <X />
                    {t("Live.clearSearch")}
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <div className="relative min-w-40 flex-1 sm:max-w-80">
                  <Hash className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <Input
                    value={roomIdInput}
                    onChange={(event) => setRoomIdInput(event.target.value)}
                    placeholder={t("Live.direct.placeholder")}
                    className="w-full pl-9"
                    autoComplete="off"
                  />
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={!selectedPlatformId || !roomIdInput.trim()}
                >
                  <Hash />
                  {t("Live.direct")}
                </Button>
                {selectedPlatformId ? (
                  <span className="text-muted-xs inline-flex items-center gap-1.5">
                    <Lock className="size-3.5" />
                    {t("Live.search.unavailable")}
                  </span>
                ) : null}
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={refresh}
              disabled={loading}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} />
              {t("Live.refresh")}
            </Button>
          </form>
        </div>

        {mode === "search" ? (
          <div className="text-muted-sm flex min-w-0 items-center gap-2 px-4 pb-3">
            <Search className="size-3.5 shrink-0" />
            <span className="shrink-0">{t("Live.search.keyword")}</span>
            <span className="text-foreground max-w-56 truncate font-medium">
              {query}
            </span>
            {!loading && !error ? (
              <span className="ml-auto tabular-nums">
                {total} {t("Live.search.total")}
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      {error && (items.length > 0 || discovery) ? (
        <div className="mx-auto w-full max-w-[1440px] px-4 pt-4">
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>{t("Live.error")}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{t(commandErrorKey(error))}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  mode === "search" && items.length > 0
                    ? void loadMore()
                    : refresh()
                }
              >
                <RefreshCw />
                {t("Live.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {accountLoading || loading ? (
        <div className="mx-auto w-full max-w-[1440px] p-4">
          <LiveGridSkeleton />
        </div>
      ) : !selectedPlatformId ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8">
          <div className="stack-3 max-w-xl items-center text-center">
            <Radio className="text-muted-foreground size-6" />
            <p className="text-muted-sm">{t("Live.platform.empty")}</p>
          </div>
        </div>
      ) : error && items.length === 0 && !discovery ? (
        <div className="stack-3 max-w-xl items-start p-8">
          <div className="text-destructive flex items-center gap-2 text-sm">
            <AlertCircle className="size-4" />
            {t("Live.error")}
          </div>
          <p className="text-muted-xs">{t(commandErrorKey(error))}</p>
          <Button type="button" variant="outline" size="sm" onClick={refresh}>
            <RefreshCw />
            {t("Live.retry")}
          </Button>
        </div>
      ) : mode === "discovery" && discovery ? (
        <div className="flex flex-col gap-2 pb-8">
          {discovery.sections.map((section) => (
            <section
              key={section.id}
              className="mx-auto w-full max-w-[1440px] px-4 pt-3"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">{section.title}</h2>
                <span className="text-muted-xs tabular-nums">
                  {section.rooms.length} {t("Live.rooms")}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {section.rooms.map((room) => (
                  <LiveRoomCard
                    key={roomKey(room)}
                    room={room}
                    onOpen={openRoom}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : items.length > 0 ? (
        <>
          <div className="video-grid">
            {items.map((room) => (
              <LiveRoomCard key={roomKey(room)} room={room} onOpen={openRoom} />
            ))}
          </div>
          <div className="flex min-h-16 items-center justify-center px-4 pb-6">
            {hasMore ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                {loadingMore ? t("Live.loadingMore") : t("Live.loadMore")}
              </Button>
            ) : (
              <span className="text-muted-xs">{t("Live.end")}</span>
            )}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8">
          <div className="stack-3 max-w-xl items-center text-center">
            <Radio className="text-muted-foreground size-6" />
            <p className="text-muted-sm">
              {mode === "search" ? t("Live.search.empty") : t("Live.empty")}
            </p>
            {mode === "search" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearSearch}
              >
                <X />
                {t("Live.clearSearch")}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
