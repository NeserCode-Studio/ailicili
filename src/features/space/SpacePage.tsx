import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Inbox,
  LoaderCircle,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";

import AsyncErrorState from "@/components/feedback/AsyncErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/composables";
import LibraryVideoCard from "@/features/library/LibraryVideoCard";
import {
  biliKeys,
  fetchSpaceProfile,
  fetchSpaceVideos,
  normalizeBiliError,
} from "@/lib/bili";
import { formatCompactCount } from "@/lib/format";

export default function SpacePage() {
  const { mid: midParam } = useParams<{ mid: string }>();
  const mid = Number(midParam);
  const validMid = Number.isSafeInteger(mid) && mid > 0;
  const { lang, t } = useI18n();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const profileQuery = useQuery({
    queryKey: biliKeys.space(String(mid)),
    queryFn: () => fetchSpaceProfile(mid),
    enabled: validMid,
  });
  const videosQuery = useQuery({
    queryKey: biliKeys.spaceVideos(String(mid), page),
    queryFn: () => fetchSpaceVideos(mid, page),
    enabled: validMid,
  });

  if (!validMid) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <AsyncErrorState
          title={t("Space.invalid.title")}
          description={t("Space.invalid.description")}
          retryLabel={t("Space.back")}
          onRetry={() => navigate("/")}
        />
      </div>
    );
  }

  if (profileQuery.isPending) {
    return (
      <div
        className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-7 lg:px-8"
        data-testid="space-loading"
      >
        <Skeleton className="h-36 w-full" />
        <div className="mt-4 flex items-end gap-4">
          <Skeleton className="-mt-12 size-24 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="aspect-video rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  if (profileQuery.error || !profileQuery.data) {
    const error = normalizeBiliError(profileQuery.error);
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <AsyncErrorState
          title={t("Space.error.title")}
          description={t("Space.error.description")}
          code={error.code}
          retryLabel={t("Space.retry")}
          onRetry={() => void profileQuery.refetch()}
        />
      </div>
    );
  }

  const profile = profileQuery.data;
  const videos = videosQuery.data?.videos ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-7 lg:px-8">
      <Link
        to="/search"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        {t("Space.back")}
      </Link>

      <section className="overflow-hidden rounded-lg border">
        <div className="bg-muted relative h-36 sm:h-44">
          {profile.bannerUrl && (
            <img
              src={profile.bannerUrl}
              alt=""
              className="size-full object-cover"
              referrerPolicy="no-referrer"
            />
          )}
        </div>
        <div className="relative px-4 pb-5 sm:px-6">
          <div className="-mt-10 flex items-end gap-4 sm:-mt-12">
            <span className="bg-background flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 text-xl font-semibold sm:size-24">
              {profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={profile.name}
                  className="size-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                profile.name.slice(0, 1)
              )}
            </span>
            <div className="min-w-0 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold">
                  {profile.name}
                </h1>
                <span className="bg-secondary rounded-sm px-1.5 py-0.5 text-[10px] font-medium">
                  LV{profile.level}
                </span>
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                UID {profile.mid}
              </p>
            </div>
          </div>

          <p className="text-muted-foreground mt-4 max-w-3xl text-sm leading-6 whitespace-pre-wrap">
            {profile.signature || t("Space.noBio")}
          </p>
          <div className="mt-4 flex flex-wrap gap-5 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <Users className="text-muted-foreground size-3.5" />
              <strong className="tabular-nums">
                {formatCompactCount(profile.followers, lang)}
              </strong>
              {t("Space.followers")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <UserRoundCheck className="text-muted-foreground size-3.5" />
              <strong className="tabular-nums">
                {formatCompactCount(profile.following, lang)}
              </strong>
              {t("Space.following")}
            </span>
          </div>
        </div>
      </section>

      <section className="mt-7" aria-labelledby="space-videos-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="space-videos-heading" className="text-base font-semibold">
            {t("Space.videos")}
          </h2>
          {videosQuery.data && (
            <span className="text-muted-foreground text-xs tabular-nums">
              {formatCompactCount(videosQuery.data.total, lang)}
            </span>
          )}
        </div>

        {videosQuery.isPending ? (
          <div
            className="flex min-h-48 items-center justify-center"
            data-testid="space-videos-loading"
          >
            <LoaderCircle className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : videosQuery.error ? (
          <AsyncErrorState
            title={t("Space.videosError.title")}
            description={t("Space.videosError.description")}
            code={normalizeBiliError(videosQuery.error).code}
            retryLabel={t("Space.retry")}
            onRetry={() => void videosQuery.refetch()}
          />
        ) : videos.length === 0 ? (
          <div className="border-border flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed">
            <Inbox className="text-muted-foreground size-6" />
            <div className="text-center">
              <h3 className="font-semibold">{t("Space.empty.title")}</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                {t("Space.empty.description")}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="divide-border/70 divide-y">
              {videos.map((video) => (
                <LibraryVideoCard
                  key={`${video.bvid}:${video.cid}`}
                  video={video}
                />
              ))}
            </div>
            <div className="mt-5 flex items-center justify-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1 || videosQuery.isFetching}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                <ChevronLeft />
                {t("Common.previous")}
              </Button>
              <span className="text-muted-foreground text-xs tabular-nums">
                {page}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!videosQuery.data?.hasMore || videosQuery.isFetching}
                onClick={() => setPage((value) => value + 1)}
              >
                {t("Common.next")}
                <ChevronRight />
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
