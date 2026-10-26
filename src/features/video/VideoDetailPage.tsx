import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  Heart,
  ListVideo,
  MessageSquareText,
  Play,
} from "lucide-react";

import AsyncErrorState from "@/components/feedback/AsyncErrorState";
import TitlebarExternalLink from "@/components/framework/TitlebarExternalLink";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n, useToast } from "@/composables";
import CommentSection from "@/features/comments/CommentSection";
import VideoActions from "@/features/social/VideoActions";
import CoverImage from "@/features/video/CoverImage";
import {
  biliKeys,
  fetchVideoDetail,
  normalizeBiliError,
  openPlayerWindow,
} from "@/lib/bili";
import { openExternalUrl } from "@/lib/external";
import {
  formatCompactCount,
  formatDuration,
  formatPublishedAt,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { VideoPart } from "@/shared/bili.types";

const BVID_PATTERN = /^BV[0-9A-Za-z]{8,22}$/;

function DetailSkeleton() {
  return (
    <div
      data-testid="video-detail-loading"
      className="space-y-6"
      aria-busy="true"
    >
      <Skeleton className="h-5 w-24" />
      <div className="space-y-3">
        <Skeleton className="h-8 w-4/5" />
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-14 w-full" />
      </div>
    </div>
  );
}

function StatItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Play;
  label: string;
  value: string;
}) {
  return (
    <div className="border-border/70 flex min-w-0 flex-col gap-1 border-l pl-3 first:border-l-0 first:pl-0">
      <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[11px]">
        <Icon className="size-3" />
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export default function VideoDetailPage() {
  const { bvid } = useParams<{ bvid: string }>();
  const navigate = useNavigate();
  const { lang, t } = useI18n();
  const { error: toastError } = useToast();
  const validBvid = Boolean(bvid && BVID_PATTERN.test(bvid));
  const [activeCid, setActiveCid] = useState(0);

  const detailQuery = useQuery({
    queryKey: biliKeys.video(bvid ?? ""),
    queryFn: () => fetchVideoDetail(bvid as string),
    enabled: validBvid,
  });

  useEffect(() => {
    const video = detailQuery.data?.video;
    if (!video) return;
    setActiveCid(video.cid ?? 0);
  }, [detailQuery.data?.video, bvid]);

  const detail = detailQuery.data;
  const video = detail?.video;
  const openPlayer = async (part?: VideoPart) => {
    if (!bvid) return;
    const targetCid =
      part?.cid ??
      (activeCid > 0 ? activeCid : null) ??
      video?.cid ??
      detail?.parts[0]?.cid;
    if (!targetCid) return;
    setActiveCid(targetCid);
    try {
      await openPlayerWindow(bvid, targetCid);
    } catch {
      toastError("Player.openError");
    }
  };

  const openExternalVideo = async (part?: VideoPart) => {
    if (!bvid) return;
    const url = new URL(`https://www.bilibili.com/video/${bvid}`);
    if (part && part.page > 1) url.searchParams.set("p", String(part.page));
    try {
      await openExternalUrl(url.toString());
    } catch {
      toastError("Video.openError");
    }
  };

  if (!validBvid) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <AsyncErrorState
          title={t("Video.invalid.title")}
          description={t("Video.invalid.description")}
          retryLabel={t("Video.back")}
          onRetry={() => navigate("/")}
        />
      </div>
    );
  }

  if (detailQuery.isPending) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-7">
        <DetailSkeleton />
      </div>
    );
  }

  if (detailQuery.error) {
    const error = normalizeBiliError(detailQuery.error);
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <AsyncErrorState
          title={t("Video.error.title")}
          description={t("Video.error.description")}
          code={error.code}
          retryLabel={t("Video.retry")}
          onRetry={() => void detailQuery.refetch()}
        />
      </div>
    );
  }

  if (!detail || !video) return null;
  const activePart =
    detail.parts.find((part) => part.cid === activeCid) ?? detail.parts[0];

  return (
    <div className="relative isolate min-h-full overflow-hidden">
      <div
        data-testid="video-detail-background"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20 overflow-hidden"
      >
        <CoverImage
          src={video.coverUrl}
          alt=""
          className="size-full scale-110 opacity-60 blur-2xl saturate-125"
          eager
        />
      </div>
      <div
        aria-hidden="true"
        className="bg-background/50 from-background/5 via-background/25 to-background/85 pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b"
      />

      <article className="mx-auto w-full max-w-6xl px-5 py-5 sm:px-7 lg:px-8">
        <TitlebarExternalLink
          label={t("Video.openOnBilibili")}
          onOpen={() => void openExternalVideo(activePart)}
        />

        <div className="mb-4 flex items-center justify-between">
          <Link
            to="/"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            {t("Video.back")}
          </Link>
          {activePart && detail.parts.length > 1 && (
            <span className="text-muted-foreground max-w-[60%] truncate text-xs">
              P{activePart.page} · {activePart.title}
            </span>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {video.category && (
                <span className="bg-primary/10 text-primary rounded-sm px-2 py-0.5 text-[11px] font-medium">
                  {video.category}
                </span>
              )}
              <span className="text-muted-foreground text-[11px]">
                {formatPublishedAt(video.publishedAt, lang)}
              </span>
            </div>
            <h1 className="text-xl leading-tight font-semibold sm:text-2xl">
              {video.title}
            </h1>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Link
                to={`/space/${video.author.mid}`}
                className="group flex min-w-0 items-center gap-3"
              >
                <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold">
                  {video.author.avatarUrl ? (
                    <img
                      src={video.author.avatarUrl}
                      alt=""
                      className="size-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    video.author.name.slice(0, 1)
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium group-hover:underline">
                    {video.author.name}
                  </span>
                  <span className="text-muted-foreground block text-[11px]">
                    UP
                  </span>
                </span>
              </Link>
              <div className="border-border/80 bg-muted/30 ml-auto grid grid-cols-3 gap-3 rounded-md border px-4 py-2">
                <StatItem
                  icon={Play}
                  label={t("Video.views")}
                  value={formatCompactCount(video.stats.views, lang)}
                />
                <StatItem
                  icon={MessageSquareText}
                  label={t("Video.danmaku")}
                  value={formatCompactCount(video.stats.danmaku, lang)}
                />
                <StatItem
                  icon={Heart}
                  label={t("Video.likes")}
                  value={formatCompactCount(video.stats.likes, lang)}
                />
              </div>
            </div>

            <div className="mt-4">
              <VideoActions
                detail={detail}
                onPlay={() => void openPlayer(activePart)}
              />
            </div>

            <section
              aria-labelledby="video-description-heading"
              className="mt-5"
            >
              <h2
                id="video-description-heading"
                className="mb-2 text-sm font-semibold"
              >
                {t("Video.description")}
              </h2>
              <p className="text-muted-foreground text-sm leading-7 whitespace-pre-wrap">
                {detail.description || t("Video.noDescription")}
              </p>
            </section>
          </div>

          <aside className="min-w-0">
            {detail.parts.length > 1 && (
              <section aria-labelledby="video-parts-heading">
                <div className="mb-2 flex items-baseline justify-between">
                  <h2
                    id="video-parts-heading"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold"
                  >
                    <ListVideo className="size-4" />
                    {t("Video.parts")}
                  </h2>
                  <span className="text-muted-foreground text-xs">
                    {detail.parts.length}
                  </span>
                </div>
                <div className="border-border/80 max-h-96 overflow-y-auto rounded-md border">
                  {detail.parts.map((part) => (
                    <button
                      key={part.cid}
                      type="button"
                      onClick={() => void openPlayer(part)}
                      className={cn(
                        "group border-border/70 hover:bg-muted/60 flex w-full items-center gap-3 border-b px-3 py-2.5 text-left transition-colors last:border-b-0",
                        activeCid === part.cid && "bg-muted/70"
                      )}
                    >
                      <span className="text-muted-foreground w-5 shrink-0 text-center font-mono text-[11px]">
                        {part.page}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {part.title}
                      </span>
                      <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
                        {formatDuration(part.durationSeconds)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>

        <CommentSection aid={video.aid} totalHint={video.stats.comments} />
      </article>
    </div>
  );
}
