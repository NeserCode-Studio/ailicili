import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ExternalLink,
  Forward,
  Heart,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  Play,
  RefreshCw,
  Repeat2,
} from "lucide-react";
import { Link } from "react-router";

import AsyncErrorState from "@/components/feedback/AsyncErrorState";
import ImagePreviewDialog from "@/components/media/ImagePreviewDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n, useToast } from "@/composables";
import { useAuthStatus } from "@/features/auth/useAuthStatus";
import CoverImage from "@/features/video/CoverImage";
import { biliKeys, fetchDynamicFeed, normalizeBiliError } from "@/lib/bili";
import { openExternalUrl } from "@/lib/external";
import {
  formatCompactCount,
  formatDuration,
  formatPublishedAt,
} from "@/lib/format";
import type { DynamicItem } from "@/shared/bili.types";
import { cn } from "@/lib/utils";

function DynamicSkeleton() {
  return (
    <div className="divide-border/70 divide-y" data-testid="dynamics-loading">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="space-y-3 py-6">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="aspect-video w-full max-w-xl" />
        </div>
      ))}
    </div>
  );
}

function DynamicCard({ item }: { item: DynamicItem }) {
  const { lang, t } = useI18n();
  const { error } = useToast();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  async function openTarget() {
    try {
      await openExternalUrl(item.targetUrl);
    } catch {
      error("Dynamics.openError");
    }
  }

  const media =
    item.video !== null ? (
      <Link
        to={`/video/${item.video.bvid}`}
        className="hover:bg-muted/40 mt-3 grid max-w-xl gap-3 rounded-md border p-2 transition-colors sm:grid-cols-[11rem_1fr]"
      >
        <div className="relative aspect-video overflow-hidden rounded-sm">
          <CoverImage
            src={item.video.coverUrl}
            alt={item.video.title}
            className="size-full"
          />
          <span className="absolute right-1.5 bottom-1.5 rounded-sm bg-black/75 px-1.5 py-0.5 font-mono text-[10px] leading-4 text-white tabular-nums">
            {formatDuration(item.video.durationSeconds)}
          </span>
        </div>
        <div className="flex min-w-0 flex-col justify-center">
          <h3 className="line-clamp-2 text-sm font-semibold">
            {item.video.title}
          </h3>
          <div className="text-muted-foreground mt-2 flex items-center gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1">
              <Play className="size-3" />
              {formatCompactCount(item.video.views, lang)}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="size-3" />
              {formatCompactCount(item.video.danmaku, lang)}
            </span>
          </div>
        </div>
      </Link>
    ) : item.images.length > 0 ? (
      <>
        <div
          className={cn(
            "mt-3 grid max-w-xl gap-1.5 overflow-hidden rounded-md",
            item.images.length === 1
              ? "grid-cols-1"
              : item.images.length === 2
                ? "grid-cols-2"
                : "grid-cols-3"
          )}
        >
          {item.images.map((image, index) => (
            <button
              key={image.url}
              type="button"
              aria-label={t("ImagePreview.open", {
                current: index + 1,
                total: item.images.length,
              })}
              onClick={() => setPreviewIndex(index)}
              className={cn(
                "group bg-muted focus-visible:ring-ring relative overflow-hidden text-left focus-visible:ring-2 focus-visible:outline-none",
                item.images.length === 1
                  ? "aspect-video max-h-96 w-full"
                  : "aspect-square"
              )}
            >
              <CoverImage
                src={image.url}
                alt={`${item.author.name} ${index + 1}`}
                className="size-full transition-transform duration-300 group-hover:scale-[1.02]"
              />
            </button>
          ))}
        </div>
        <ImagePreviewDialog
          images={item.images.map((image, index) => ({
            ...image,
            alt: `${item.author.name} ${index + 1}`,
          }))}
          activeIndex={previewIndex}
          onIndexChange={setPreviewIndex}
        />
      </>
    ) : null;

  return (
    <article className="border-border/70 flex gap-3 border-b py-6 last:border-b-0">
      <Link
        to={`/space/${item.author.mid}`}
        className="shrink-0"
        aria-label={item.author.name}
      >
        <span className="bg-muted flex size-10 items-center justify-center overflow-hidden rounded-full text-sm font-semibold">
          {item.author.avatarUrl ? (
            <img
              src={item.author.avatarUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            item.author.name.slice(0, 1)
          )}
        </span>
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to={`/space/${item.author.mid}`}
            className="hover:text-primary text-sm font-semibold"
          >
            {item.author.name}
          </Link>
          <span className="text-muted-foreground text-[11px]">
            {formatPublishedAt(item.publishedAt, lang)}
          </span>
          {item.onlyFans && (
            <span className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-medium">
              <LockKeyhole className="size-2.5" />
              {t("Dynamics.onlyFans")}
            </span>
          )}
          {item.kind === "forward" && (
            <Forward className="text-muted-foreground size-3.5" />
          )}
        </div>

        {item.text && (
          <p className="mt-2 text-sm leading-6 break-words whitespace-pre-wrap">
            {item.text}
          </p>
        )}
        {media}

        <div className="text-muted-foreground mt-3 flex items-center gap-5 text-[11px]">
          <span className="inline-flex items-center gap-1.5">
            <Heart className="size-3.5" />
            {formatCompactCount(item.stats.likes, lang)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MessageCircle className="size-3.5" />
            {formatCompactCount(item.stats.comments, lang)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Repeat2 className="size-3.5" />
            {formatCompactCount(item.stats.forwards, lang)}
          </span>
          {item.video === null && (
            <button
              type="button"
              onClick={() => void openTarget()}
              className="hover:text-foreground ml-auto inline-flex items-center gap-1 transition-colors"
            >
              {t("Dynamics.open")}
              <ExternalLink className="size-3" />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export default function DynamicFeedPage() {
  const { t } = useI18n();
  const authQuery = useAuthStatus();
  const feedQuery = useInfiniteQuery({
    queryKey: [...biliKeys.dynamicFeed(), "items"],
    queryFn: ({ pageParam }) => fetchDynamicFeed(pageParam),
    initialPageParam: "",
    getNextPageParam: (last) =>
      last.hasMore && last.offset ? last.offset : undefined,
    enabled: Boolean(authQuery.data?.authenticated),
  });
  const items = feedQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-7 lg:px-8">
      <header className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Dynamics.title")}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("Dynamics.description")}
          </p>
        </div>
        {feedQuery.data && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={feedQuery.isFetching}
            onClick={() => void feedQuery.refetch()}
          >
            <RefreshCw
              className={feedQuery.isFetching ? "animate-spin" : undefined}
            />
            {t("Dynamics.refresh")}
          </Button>
        )}
      </header>

      {authQuery.isPending ? (
        <DynamicSkeleton />
      ) : !authQuery.data?.authenticated ? (
        <div className="border-border flex min-h-80 flex-col items-center justify-center gap-4 rounded-lg border border-dashed px-6 text-center">
          <LockKeyhole className="text-muted-foreground size-6" />
          <div>
            <h2 className="font-semibold">{t("Dynamics.login.title")}</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("Dynamics.login.description")}
            </p>
          </div>
          <Button asChild>
            <Link to="/login">{t("Auth.signIn")}</Link>
          </Button>
        </div>
      ) : feedQuery.isPending ? (
        <DynamicSkeleton />
      ) : feedQuery.error ? (
        <AsyncErrorState
          title={t("Dynamics.error.title")}
          description={t("Dynamics.error.description")}
          code={normalizeBiliError(feedQuery.error).code}
          retryLabel={t("Dynamics.retry")}
          onRetry={() => void feedQuery.refetch()}
        />
      ) : items.length === 0 ? (
        <div className="border-border flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center">
          <Forward className="text-muted-foreground size-6" />
          <div>
            <h2 className="font-semibold">{t("Dynamics.empty.title")}</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("Dynamics.empty.description")}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div>
            {items.map((item) => (
              <DynamicCard key={item.id} item={item} />
            ))}
          </div>
          {feedQuery.hasNextPage && (
            <div className="mt-5 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={feedQuery.isFetchingNextPage}
                onClick={() => void feedQuery.fetchNextPage()}
              >
                {feedQuery.isFetchingNextPage ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                {t("Common.loadMore")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
