import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  Loader2,
  LogIn,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";

import {
  getPopularVideos,
  getRecommendedVideos,
  getRegionVideos,
  searchVideos,
  type PagedVideos,
  type VideoCard as VideoCardModel,
} from "@/api/media";
import { asCommandError, type CommandError } from "@/api/account";
import VideoCard from "@/components/media/VideoCard";
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
import { useSettingsDialog } from "@/contexts/settings";
import {
  BILIBILI_REGIONS,
  DEFAULT_REGION_ID,
  regionName,
} from "@/lib/bilibili-regions";
import { commandErrorKey } from "@/lib/command-error";
import { createLogger } from "@/lib/logger";
import { useRecommendationPriority } from "@/lib/preferences";
import { PLAYER_CONTROL_SURFACE_CLASS } from "@/lib/player-surface";
import { cn } from "@/lib/utils";

const log = createLogger("Media/Home");

type BrowseMode = "popular" | "recommend" | "region";
type FeedMode = BrowseMode | "search";
type FallbackReason = "login" | "preference" | "request";

const BROWSE_TABS = [
  { value: "recommend", labelKey: "Home.feed.recommend" },
  { value: "popular", labelKey: "Home.feed.popular" },
  { value: "region", labelKey: "Home.feed.region" },
] as const satisfies readonly {
  value: BrowseMode;
  labelKey: string;
}[];

interface FeedRequestResult {
  result: PagedVideos;
  fallbackReason: FallbackReason | null;
}

function videoKey(video: VideoCardModel) {
  return `${video.platform}:${video.videoId}`;
}

function mergeUnique(
  current: VideoCardModel[],
  incoming: VideoCardModel[]
): VideoCardModel[] {
  const seen = new Set(current.map(videoKey));
  return [
    ...current,
    ...incoming.filter((video) => {
      const key = videoKey(video);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
}

function FeedSkeleton() {
  return (
    <div className="video-grid" aria-busy="true">
      {Array.from({ length: 10 }, (_, index) => (
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

export default function Home() {
  const { t, lang } = useI18n();
  const {
    account,
    accountRevisions,
    loading: accountLoading,
    openLogin,
    snapshot: accountSnapshot,
  } = useAccount();
  const { openSettings } = useSettingsDialog();
  const recommendationPriority = useRecommendationPriority();

  const [mode, setMode] = useState<FeedMode>("recommend");
  const [selectedRegionId, setSelectedRegionId] = useState(DEFAULT_REGION_ID);
  const [items, setItems] = useState<VideoCardModel[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<CommandError | null>(null);
  const [keyword, setKeyword] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [fallbackReason, setFallbackReason] = useState<FallbackReason | null>(
    null
  );
  const [reloadToken, setReloadToken] = useState(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLElement | null>(null);
  const requestIdRef = useRef(0);
  const accountRevisionRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const videoPlatformId = accountSnapshot?.platforms.find(
    (entry) =>
      entry.platform.contentKinds.includes("video") &&
      entry.platform.accountCapability.mode !== "none"
  )?.platform.id;
  const accountRevision = videoPlatformId
    ? (accountRevisions[videoPlatformId] ?? 0)
    : 0;
  accountRevisionRef.current = accountRevision;

  useEffect(() => {
    const viewport =
      rootRef.current?.closest<HTMLElement>(
        '[data-slot="scroll-area-viewport"]'
      ) ?? null;
    if (!viewport) return;

    scrollViewportRef.current = viewport;
    const syncBackToTop = () => setShowBackToTop(viewport.scrollTop > 280);
    syncBackToTop();
    viewport.addEventListener("scroll", syncBackToTop, { passive: true });

    return () => {
      viewport.removeEventListener("scroll", syncBackToTop);
      scrollViewportRef.current = null;
    };
  }, []);

  const recommendationEligibility: FallbackReason | null =
    recommendationPriority !== "personalized"
      ? "preference"
      : account?.status !== "authenticated"
        ? "login"
        : null;
  const recommendationGate =
    mode !== "recommend"
      ? "irrelevant"
      : accountLoading
        ? "loading"
        : (recommendationEligibility ?? "ready");

  const requestFeedPage = useCallback(
    async (
      targetMode: FeedMode,
      targetPage: number,
      regionId: number,
      query: string,
      popularFallback: FallbackReason | null
    ): Promise<FeedRequestResult> => {
      if (targetMode === "recommend") {
        if (popularFallback) {
          const result = await getPopularVideos(targetPage);
          return { result, fallbackReason: popularFallback };
        }
        const result = await getRecommendedVideos(targetPage);
        return {
          result,
          fallbackReason: result.fallback ? "request" : null,
        };
      }

      if (targetMode === "region") {
        return {
          result: await getRegionVideos(regionId, targetPage),
          fallbackReason: null,
        };
      }

      if (targetMode === "search") {
        return {
          result: await searchVideos(query, targetPage),
          fallbackReason: null,
        };
      }

      return {
        result: await getPopularVideos(targetPage),
        fallbackReason: null,
      };
    },
    []
  );

  useEffect(() => {
    if (recommendationGate === "loading") {
      setLoading(true);
      setLoadingMore(false);
      setError(null);
      setItems([]);
      setHasMore(false);
      setPage(1);
      setFallbackReason(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    const revision = accountRevisionRef.current;
    const popularFallback =
      recommendationGate === "preference"
        ? "preference"
        : recommendationGate === "login"
          ? "login"
          : null;

    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setItems([]);
    setHasMore(false);
    setPage(1);
    setFallbackReason(null);

    void requestFeedPage(
      mode,
      1,
      selectedRegionId,
      searchQuery,
      popularFallback
    )
      .then(({ result, fallbackReason: nextFallback }) => {
        if (
          requestId !== requestIdRef.current ||
          revision !== accountRevisionRef.current
        ) {
          return;
        }
        setItems(mergeUnique([], result.items));
        setPage(result.page || 1);
        setHasMore(result.hasMore);
        setFallbackReason(nextFallback);
        log.info("feed loaded", {
          mode,
          page: result.page,
          count: result.items.length,
          fallback: nextFallback,
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
        log.error("feed failed", { mode, code: normalized.code });
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });

    return () => {
      requestIdRef.current += 1;
    };
  }, [
    accountRevision,
    mode,
    recommendationGate,
    reloadToken,
    requestFeedPage,
    searchQuery,
    selectedRegionId,
  ]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMoreRef.current || !hasMore) return;

    loadingMoreRef.current = true;
    const requestId = ++requestIdRef.current;
    const revision = accountRevisionRef.current;
    const requestedPage = page + 1;
    const popularFallback =
      mode === "recommend"
        ? (fallbackReason ?? recommendationEligibility)
        : null;

    setLoadingMore(true);
    setError(null);
    try {
      const { result, fallbackReason: nextFallback } = await requestFeedPage(
        mode,
        requestedPage,
        selectedRegionId,
        searchQuery,
        popularFallback
      );
      if (
        requestId !== requestIdRef.current ||
        revision !== accountRevisionRef.current
      ) {
        return;
      }

      setItems((current) => mergeUnique(current, result.items));
      setPage(result.page || requestedPage);
      setHasMore(result.hasMore);
      if (mode === "recommend") setFallbackReason(nextFallback);
      log.info("feed page loaded", {
        mode,
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
      log.error("feed page failed", { mode, code: normalized.code });
    } finally {
      loadingMoreRef.current = false;
      if (requestId === requestIdRef.current) setLoadingMore(false);
    }
  }, [
    fallbackReason,
    hasMore,
    loading,
    mode,
    page,
    recommendationEligibility,
    requestFeedPage,
    searchQuery,
    selectedRegionId,
  ]);

  const refresh = () => setReloadToken((value) => value + 1);

  const scrollToTop = () => {
    scrollViewportRef.current?.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  };

  const clearSearch = () => {
    setKeyword("");
    setSearchQuery("");
    setMode("recommend");
    setReloadToken((value) => value + 1);
  };

  const submitSearch = () => {
    const query = keyword.trim();
    if (!query) {
      clearSearch();
      return;
    }
    setSearchQuery(query);
    setMode("search");
    setReloadToken((value) => value + 1);
  };

  const changeBrowseMode = (value: BrowseMode) => {
    setKeyword("");
    setSearchQuery("");
    setMode(value);
  };

  const emptyMessage =
    mode === "search"
      ? t("Home.search.empty")
      : mode === "region"
        ? `${t("Home.region.empty")} ${regionName(
            BILIBILI_REGIONS.find((region) => region.id === selectedRegionId) ??
              BILIBILI_REGIONS[0],
            lang
          )}`
        : mode === "recommend"
          ? fallbackReason
            ? t("Home.empty")
            : t("Home.recommend.empty")
          : t("Home.empty");

  const fallbackMessage =
    fallbackReason === "login"
      ? t("Home.recommend.loginRequired")
      : fallbackReason === "preference"
        ? t("Home.recommend.preference")
        : t("Home.recommend.fallback");

  return (
    <div ref={rootRef} className="view-home">
      <header
        className={`border-border/60 sticky top-0 z-30 border-b ${PLAYER_CONTROL_SURFACE_CLASS}`}
      >
        <div className="mx-auto flex w-full max-w-[1440px] items-center gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <nav
              className="flex min-w-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-label={t("Home.feed.label")}
            >
              {BROWSE_TABS.map((tab) => {
                const active = mode === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    className={cn(
                      "focus-visible:ring-ring relative flex h-9 shrink-0 items-center rounded-sm px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                      active
                        ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--player-accent)]"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    aria-pressed={active}
                    onClick={() => changeBrowseMode(tab.value)}
                  >
                    {t(tab.labelKey)}
                  </button>
                );
              })}
            </nav>

            {mode === "region" ? (
              <Select
                value={String(selectedRegionId)}
                onValueChange={(value) => setSelectedRegionId(Number(value))}
              >
                <SelectTrigger
                  size="sm"
                  className="h-8 w-32 shrink-0 border-0 bg-transparent px-2 text-xs shadow-none"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILIBILI_REGIONS.map((region) => (
                    <SelectItem key={region.id} value={String(region.id)}>
                      {regionName(region, lang)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>

          <form
            className="ml-auto max-w-sm min-w-32 flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <div className="relative w-full">
              <Input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={t("Home.search.placeholder")}
                className="h-9 w-full pr-10"
              />
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 size-7 -translate-y-1/2"
                aria-label={t("Home.search")}
                title={t("Home.search")}
              >
                <Search className="size-3.5" />
              </Button>
            </div>
          </form>
        </div>

        {mode === "search" ? (
          <div className="text-muted-xs mx-auto flex w-full max-w-[1440px] min-w-0 items-center gap-2 px-4 pb-2">
            <span className="shrink-0">{t("Home.search.results")}</span>
            <span className="text-foreground truncate font-medium">
              {searchQuery}
            </span>
          </div>
        ) : null}
      </header>

      {fallbackReason ? (
        <div className="mx-auto w-full max-w-[1440px] px-4 pt-4">
          <Alert>
            <Sparkles />
            <AlertTitle>{t("Home.recommend.fallbackTitle")}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{fallbackMessage}</span>
              {fallbackReason === "login" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => openLogin()}
                >
                  <LogIn />
                  {t("Home.recommend.signIn")}
                </Button>
              ) : fallbackReason === "preference" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => openSettings("general")}
                >
                  <Settings2 />
                  {t("Home.recommend.openSettings")}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={refresh}
                >
                  <RefreshCw />
                  {t("Home.retry")}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {error && items.length > 0 ? (
        <div className="mx-auto w-full max-w-[1440px] px-4 pt-4">
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>{t("Home.error")}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{t(commandErrorKey(error))}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadMore()}
              >
                <RefreshCw />
                {t("Home.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <FeedSkeleton />
      ) : !loading && items.length === 0 ? (
        error ? (
          <div className="stack-3 max-w-xl items-start p-8">
            <div className="text-destructive flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4" />
              {t("Home.error")}
            </div>
            <p className="text-muted-xs">{t(commandErrorKey(error))}</p>
            <Button type="button" variant="outline" size="sm" onClick={refresh}>
              <RefreshCw />
              {t("Home.retry")}
            </Button>
          </div>
        ) : (
          <div className="stack-3 max-w-xl items-start p-8">
            <p className="text-muted-sm">{emptyMessage}</p>
            {mode === "search" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearSearch}
              >
                <X />
                {t("Home.clearSearch")}
              </Button>
            ) : null}
          </div>
        )
      ) : (
        <>
          <div className="video-grid">
            {items.map((video) => (
              <VideoCard key={videoKey(video)} video={video} />
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
                {loadingMore ? t("Home.loadingMore") : t("Home.loadMore")}
              </Button>
            ) : (
              <span className="text-muted-xs">{t("Home.end")}</span>
            )}
          </div>
        </>
      )}

      <div className="fixed right-4 bottom-4 z-40 flex flex-col gap-2 sm:right-6 sm:bottom-6">
        {showBackToTop ? (
          <button
            type="button"
            className={`${PLAYER_CONTROL_SURFACE_CLASS} hover:bg-accent/80 focus-visible:ring-ring inline-flex size-9 items-center justify-center rounded-full border shadow-lg transition-colors focus-visible:ring-2 focus-visible:outline-none`}
            aria-label={t("Home.backToTop")}
            title={t("Home.backToTop")}
            onClick={scrollToTop}
          >
            <ArrowUp className="size-4" />
          </button>
        ) : null}
        <button
          type="button"
          className={`${PLAYER_CONTROL_SURFACE_CLASS} hover:bg-accent/80 focus-visible:ring-ring inline-flex size-9 items-center justify-center rounded-full border shadow-lg transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-default disabled:opacity-60`}
          aria-label={t("Home.refresh")}
          title={t("Home.refresh")}
          disabled={loading}
          onClick={refresh}
        >
          <RefreshCw
            className={cn(
              "size-4",
              loading && "animate-spin motion-reduce:animate-none"
            )}
          />
        </button>
      </div>
    </div>
  );
}
