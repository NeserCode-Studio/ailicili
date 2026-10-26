import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Inbox, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import AsyncErrorState from "@/components/feedback/AsyncErrorState";
import { useI18n } from "@/composables";
import { biliKeys, fetchPopularVideos, normalizeBiliError } from "@/lib/bili";
import { formatClock } from "@/lib/format";
import DiscoverySkeleton from "@/features/discovery/DiscoverySkeleton";
import FeaturedVideo from "@/features/discovery/FeaturedVideo";
import VideoCard from "@/features/discovery/VideoCard";

const PAGE_SIZE = 20;

export default function DiscoveryPage() {
  const { lang, t } = useI18n();
  const [page, setPage] = useState(1);
  const popularQuery = useQuery({
    queryKey: biliKeys.popular(page, PAGE_SIZE),
    queryFn: () => fetchPopularVideos(page, PAGE_SIZE),
  });

  const videos = popularQuery.data?.videos ?? [];
  const featuredVideo = page === 1 ? videos[0] : undefined;
  const gridVideos = featuredVideo ? videos.slice(1) : videos;
  const error = popularQuery.error
    ? normalizeBiliError(popularQuery.error)
    : undefined;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-5 py-6 sm:px-7 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Discover.title")}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("Discover.description")}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {popularQuery.dataUpdatedAt > 0 && (
            <span className="text-muted-foreground hidden text-xs sm:inline">
              {t("Discover.updated")}{" "}
              {formatClock(popularQuery.dataUpdatedAt, lang)}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void popularQuery.refetch()}
            disabled={popularQuery.isFetching}
          >
            <RefreshCw
              className={
                popularQuery.isFetching ? "size-3.5 animate-spin" : "size-3.5"
              }
            />
            {t("Discover.refresh")}
          </Button>
        </div>
      </header>

      {popularQuery.isPending ? (
        <DiscoverySkeleton />
      ) : error ? (
        <AsyncErrorState
          title={t("Discover.error.title")}
          description={t("Discover.error.description")}
          code={error.code}
          retryLabel={t("Discover.retry")}
          onRetry={() => void popularQuery.refetch()}
        />
      ) : videos.length === 0 ? (
        <div className="border-border flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center">
          <Inbox className="text-muted-foreground size-6" />
          <div>
            <h2 className="text-base font-semibold">
              {t("Discover.empty.title")}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("Discover.empty.description")}
            </p>
          </div>
        </div>
      ) : (
        <div
          className={
            popularQuery.isFetching
              ? "opacity-60 transition-opacity"
              : "transition-opacity"
          }
        >
          {featuredVideo && <FeaturedVideo video={featuredVideo} />}

          {gridVideos.length > 0 && (
            <section className="mt-8" aria-labelledby="popular-feed-heading">
              <div className="mb-4 flex items-center justify-between">
                <h2
                  id="popular-feed-heading"
                  className="text-base font-semibold"
                >
                  {t("Discover.popular")}
                </h2>
                <span className="text-muted-foreground text-xs">
                  {t("Discover.page")} {page}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
                {gridVideos.map((video) => (
                  <VideoCard key={video.bvid} video={video} />
                ))}
              </div>
            </section>
          )}

          <nav
            className="mt-9 flex items-center justify-center gap-3"
            aria-label={t("Discover.pagination")}
          >
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1 || popularQuery.isFetching}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft className="size-4" />
              {t("Discover.previous")}
            </Button>
            <span className="text-muted-foreground min-w-16 text-center text-xs tabular-nums">
              {page}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!popularQuery.data?.hasMore || popularQuery.isFetching}
              onClick={() => setPage((current) => current + 1)}
            >
              {t("Discover.next")}
              <ChevronRight className="size-4" />
            </Button>
          </nav>
        </div>
      )}
    </div>
  );
}
