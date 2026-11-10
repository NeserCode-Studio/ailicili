import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Flame,
  History,
  LayoutGrid,
  Loader2,
  LogIn,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Star,
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/composables";
import { useAccount } from "@/contexts/account-context";
import { useNavigatorContext } from "@/contexts/navigator";
import { useSettingsDialog } from "@/contexts/settings";
import {
  BILIBILI_REGIONS,
  DEFAULT_REGION_ID,
  regionName,
} from "@/lib/bilibili-regions";
import { commandErrorKey } from "@/lib/command-error";
import { createLogger } from "@/lib/logger";
import {
  getRecommendationPriority,
  useRecommendationPriority,
} from "@/lib/preferences";

const log = createLogger("Media/Home");

type BrowseMode = "popular" | "recommend" | "region";
type FeedMode = BrowseMode | "search";
type FallbackReason = "login" | "preference" | "request";

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

export default function Home() {
  const { t, lang } = useI18n();
  const { account, loading: accountLoading, openLogin } = useAccount();
  const { navigator } = useNavigatorContext();
  const { openSettings } = useSettingsDialog();
  const recommendationPriority = useRecommendationPriority();

  const [mode, setMode] = useState<FeedMode>(() =>
    getRecommendationPriority() === "personalized" ? "recommend" : "popular"
  );
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
  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);

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
        if (requestId !== requestIdRef.current) return;
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
        if (requestId !== requestIdRef.current) return;
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
      if (requestId !== requestIdRef.current) return;

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
      if (requestId !== requestIdRef.current) return;
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

  const clearSearch = () => {
    setKeyword("");
    setSearchQuery("");
    setMode("popular");
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

  const changeBrowseMode = (value: string) => {
    if (value === "popular" || value === "recommend" || value === "region") {
      setMode(value);
    }
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
    <div className="view-home">
      <header className="border-border/60 border-b">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">
              {t("Home.title")}
            </h1>
            <p className="text-muted-xs mt-0.5 truncate">
              {t(`Home.feed.${mode}`)}
            </p>
          </div>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => navigator("/favorites")}
            >
              <Star />
              {t("Library.favorites.title")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => navigator("/history")}
            >
              <History />
              {t("Library.history.title")}
            </Button>
          </div>

          <form
            className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <div className="relative min-w-40 flex-1 sm:max-w-80">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={t("Home.search.placeholder")}
                className="w-full pl-9"
              />
            </div>
            <Button type="submit" variant="outline" size="sm">
              <Search />
              {t("Home.search")}
            </Button>
            {mode === "search" || keyword ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearSearch}
              >
                <X />
                {t("Home.clearSearch")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={refresh}
              disabled={loading}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} />
              {t("Home.refresh")}
            </Button>
          </form>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={mode === "search" ? "" : mode}
            onValueChange={changeBrowseMode}
            className="w-full max-w-full overflow-x-auto [scrollbar-width:none] sm:w-auto [&::-webkit-scrollbar]:hidden"
            aria-label={t("Home.feed.label")}
          >
            <ToggleGroupItem
              value="popular"
              className="min-w-fit flex-none gap-1.5 px-2"
            >
              <Flame className="h-3.5 w-3.5" />
              {t("Home.feed.popular")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="recommend"
              className="min-w-fit flex-none gap-1.5 px-2"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t("Home.feed.recommend")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="region"
              className="min-w-fit flex-none gap-1.5 px-2"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              {t("Home.feed.region")}
            </ToggleGroupItem>
          </ToggleGroup>

          {mode === "region" ? (
            <Select
              value={String(selectedRegionId)}
              onValueChange={(value) => setSelectedRegionId(Number(value))}
            >
              <SelectTrigger size="sm" className="w-full sm:w-52">
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

          {mode === "search" ? (
            <div className="text-muted-sm flex min-w-0 items-center gap-2">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="shrink-0">{t("Home.search.results")}</span>
              <span className="text-foreground max-w-48 truncate font-medium">
                {searchQuery}
              </span>
            </div>
          ) : null}
        </div>
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
    </div>
  );
}
