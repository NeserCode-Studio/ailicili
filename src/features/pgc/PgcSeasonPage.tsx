import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ExternalLink,
  Heart,
  MessageSquareText,
  Play,
  Star,
  ThumbsUp,
  Users,
} from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import AsyncErrorState from "@/components/feedback/AsyncErrorState";
import TitlebarExternalLink from "@/components/framework/TitlebarExternalLink";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n, useToast } from "@/composables";
import { usePageTitlebarTitle } from "@/contexts/pageTitlebar";
import CoverImage from "@/features/video/CoverImage";
import {
  biliKeys,
  fetchPgcSeason,
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
import type { PgcEpisode, PgcSeasonDetail } from "@/shared/bili.types";

const SEASON_ID_PATTERN = /^\d{1,18}$/;
const BVID_PATTERN = /^BV[0-9A-Za-z]{8,22}$/;

function SeasonSkeleton() {
  return (
    <div
      data-testid="pgc-season-loading"
      className="grid gap-6 md:grid-cols-[190px_1fr]"
      aria-busy="true"
    >
      <Skeleton className="aspect-[3/4] w-full rounded-md" />
      <div className="space-y-4">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-9 w-4/5" />
        <Skeleton className="h-5 w-3/5" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-9 w-48" />
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Play;
  label: string;
  value: string;
}) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
      <Icon className="size-3.5" />
      <span>{label}</span>
      <strong className="text-foreground font-semibold tabular-nums">
        {value}
      </strong>
    </span>
  );
}

function EpisodeButton({
  episode,
  selected,
  onSelect,
}: {
  episode: PgcEpisode;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "border-border/80 hover:bg-muted/65 flex min-h-20 min-w-0 flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left transition-colors",
        selected && "border-primary/55 bg-primary/8"
      )}
    >
      <span className="flex w-full min-w-0 items-start gap-2">
        <span className="line-clamp-2 min-w-0 flex-1 text-xs leading-5 font-semibold">
          {episode.title}
        </span>
        {episode.requiresMembership && (
          <span className="bg-primary/10 text-primary shrink-0 rounded-sm px-1 py-0.5 text-[9px] font-semibold">
            VIP
          </span>
        )}
      </span>
      <span className="text-muted-foreground mt-auto flex w-full items-center justify-between gap-2 text-[10px]">
        <span>{formatDuration(episode.durationSeconds)}</span>
        <span className="truncate">
          {selected ? t("Pgc.season.selected") : episode.badge}
        </span>
      </span>
    </button>
  );
}

function selectedEpisode(
  detail: PgcSeasonDetail,
  requestedEpisode: string | null
) {
  const episodes = [
    ...detail.episodes,
    ...detail.sections.flatMap((section) => section.episodes),
  ];
  return (
    episodes.find((episode) => episode.epId === requestedEpisode) ??
    detail.episodes[0] ??
    episodes[0]
  );
}

export default function PgcSeasonPage() {
  const { seasonId = "" } = useParams<{ seasonId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { lang, t } = useI18n();
  const { error: toastError } = useToast();
  const validSeasonId = SEASON_ID_PATTERN.test(seasonId);
  const seasonQuery = useQuery({
    queryKey: biliKeys.pgcSeason(seasonId),
    queryFn: () => fetchPgcSeason(seasonId),
    enabled: validSeasonId,
  });
  const detail = seasonQuery.data;
  const episode = detail
    ? selectedEpisode(detail, searchParams.get("ep"))
    : undefined;
  usePageTitlebarTitle(detail?.title);

  const selectEpisode = (next: PgcEpisode) => {
    const params = new URLSearchParams(searchParams);
    params.set("ep", next.epId);
    setSearchParams(params, { replace: true });
  };

  const openOnBilibili = async () => {
    const url = episode?.targetUrl || detail?.webUrl;
    if (!url) return;
    try {
      await openExternalUrl(url);
    } catch {
      toastError("Pgc.openError");
    }
  };

  const playEpisode = async () => {
    if (!episode) return;
    if (
      episode.requiresMembership ||
      !episode.playbackAvailable ||
      !BVID_PATTERN.test(episode.bvid) ||
      episode.cid <= 0
    ) {
      await openOnBilibili();
      return;
    }
    try {
      await openPlayerWindow(episode.bvid, episode.cid);
    } catch {
      toastError("Player.openError");
    }
  };

  if (!validSeasonId) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <AsyncErrorState
          title={t("Pgc.season.invalid.title")}
          description={t("Pgc.season.invalid.description")}
          retryLabel={t("Pgc.season.back")}
          onRetry={() => navigate("/pgc")}
        />
      </div>
    );
  }

  if (seasonQuery.isPending) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-7 sm:px-7 lg:px-8">
        <SeasonSkeleton />
      </div>
    );
  }

  if (seasonQuery.error) {
    const error = normalizeBiliError(seasonQuery.error);
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <AsyncErrorState
          title={t("Pgc.season.error.title")}
          description={t("Pgc.season.error.description")}
          code={error.code}
          retryLabel={t("Pgc.season.retry")}
          onRetry={() => void seasonQuery.refetch()}
        />
      </div>
    );
  }

  if (!detail) return null;
  const mainEpisodes = detail.episodes;
  const allEpisodes = [
    ...mainEpisodes,
    ...detail.sections.flatMap((section) => section.episodes),
  ];

  return (
    <div className="relative isolate min-h-full overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20 overflow-hidden"
      >
        <CoverImage
          src={detail.coverUrl}
          alt=""
          className="size-full scale-110 opacity-55 blur-3xl saturate-125"
          eager
        />
      </div>
      <div
        aria-hidden="true"
        className="bg-background/55 from-background/5 via-background/30 to-background/90 pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b"
      />

      <article className="mx-auto w-full max-w-6xl px-5 py-5 sm:px-7 lg:px-8">
        <TitlebarExternalLink
          label={t("Pgc.openOnBilibili")}
          onOpen={() => void openOnBilibili()}
        />

        <Link
          to="/pgc"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          {t("Pgc.season.back")}
        </Link>

        <div className="mt-4 grid gap-6 md:grid-cols-[190px_minmax(0,1fr)] md:items-start">
          <CoverImage
            src={detail.coverUrl}
            alt={detail.title}
            className="aspect-[3/4] w-full max-w-[190px] rounded-md shadow-lg"
            eager
          />

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-sm px-2 py-1 text-[10px] font-semibold",
                  detail.finished
                    ? "bg-muted text-muted-foreground"
                    : "bg-brand-blue/15 text-brand-blue"
                )}
              >
                {detail.finished
                  ? t("Pgc.season.finished")
                  : t("Pgc.season.airing")}
              </span>
              {detail.newEpisode && (
                <span className="text-muted-foreground text-xs">
                  {detail.newEpisode}
                </span>
              )}
            </div>

            <h1 className="mt-2 text-2xl leading-tight font-semibold sm:text-3xl">
              {detail.title}
            </h1>
            {detail.originalTitle && detail.originalTitle !== detail.title && (
              <p className="text-muted-foreground mt-1 text-sm">
                {detail.originalTitle}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              {detail.rating && (
                <span className="inline-flex items-baseline gap-2">
                  <span className="inline-flex items-center gap-1 text-xl font-bold text-amber-500">
                    <Star className="size-4 fill-current" />
                    {detail.rating.score.toFixed(1)}
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    {t("Pgc.season.ratingCount", {
                      count: formatCompactCount(detail.rating.count, lang),
                    })}
                  </span>
                </span>
              )}
              <Stat
                icon={Play}
                label={t("Pgc.season.views")}
                value={formatCompactCount(detail.stats.views, lang)}
              />
              <Stat
                icon={Heart}
                label={t("Pgc.season.favorites")}
                value={formatCompactCount(detail.stats.favorites, lang)}
              />
              <Stat
                icon={ThumbsUp}
                label={t("Pgc.season.likes")}
                value={formatCompactCount(detail.stats.likes, lang)}
              />
              <Stat
                icon={MessageSquareText}
                label={t("Pgc.season.danmaku")}
                value={formatCompactCount(detail.stats.danmaku, lang)}
              />
            </div>

            <p className="text-muted-foreground mt-4 line-clamp-3 max-w-3xl text-sm leading-6">
              {detail.description || t("Pgc.season.noDescription")}
            </p>

            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
              {detail.publishDate && (
                <span className="text-muted-foreground">
                  {t("Pgc.season.publishDate")} {detail.publishDate}
                </span>
              )}
              {detail.areas.length > 0 && (
                <span className="text-muted-foreground">
                  {detail.areas.join(" / ")}
                </span>
              )}
              {detail.styles.length > 0 && (
                <span className="text-muted-foreground">
                  {detail.styles.join(" / ")}
                </span>
              )}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={() => void playEpisode()}
                disabled={!episode}
              >
                <Play className="size-4 fill-current" />
                {episode
                  ? t("Pgc.season.playEpisode", { title: episode.title })
                  : t("Pgc.season.play")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void openOnBilibili()}
              >
                <ExternalLink className="size-4" />
                {t("Pgc.openOnBilibili")}
              </Button>
              {episode && (
                <span className="text-muted-foreground text-xs">
                  {formatPublishedAt(episode.publishedAt, lang)}
                </span>
              )}
            </div>

            {episode && !episode.playbackAvailable && (
              <p className="text-destructive mt-3 text-xs leading-5">
                {t("Pgc.season.webOnly")}
              </p>
            )}
            {episode?.requiresMembership && episode.playbackAvailable && (
              <p className="text-muted-foreground mt-3 text-xs leading-5">
                {t("Pgc.season.membership")}
              </p>
            )}
          </div>
        </div>

        <section className="mt-8" aria-labelledby="pgc-episodes-heading">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="pgc-episodes-heading" className="text-base font-semibold">
              {t("Pgc.season.episodes")}
            </h2>
            <span className="text-muted-foreground text-xs tabular-nums">
              {t("Pgc.season.episodeCount", { count: allEpisodes.length })}
            </span>
          </div>
          {mainEpisodes.length === 0 ? (
            <p className="text-muted-foreground border-border rounded-md border border-dashed p-6 text-center text-sm">
              {t("Pgc.season.noEpisodes")}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {mainEpisodes.map((item) => (
                <EpisodeButton
                  key={item.epId}
                  episode={item}
                  selected={item.epId === episode?.epId}
                  onSelect={() => selectEpisode(item)}
                />
              ))}
            </div>
          )}
        </section>

        {detail.sections.map((section) => (
          <section
            key={section.id}
            className="mt-7"
            aria-labelledby={`pgc-section-${section.id}`}
          >
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2
                id={`pgc-section-${section.id}`}
                className="text-base font-semibold"
              >
                {section.title || t("Pgc.season.extras")}
              </h2>
              <span className="text-muted-foreground text-xs">
                {section.episodes.length}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {section.episodes.map((item) => (
                <EpisodeButton
                  key={item.epId}
                  episode={item}
                  selected={item.epId === episode?.epId}
                  onSelect={() => selectEpisode(item)}
                />
              ))}
            </div>
          </section>
        ))}

        <section className="mt-8" aria-labelledby="pgc-overview-heading">
          <h2
            id="pgc-overview-heading"
            className="mb-2 text-base font-semibold"
          >
            {t("Pgc.season.overview")}
          </h2>
          <p className="text-muted-foreground text-sm leading-7 whitespace-pre-wrap">
            {detail.description || t("Pgc.season.noDescription")}
          </p>
        </section>

        {detail.relatedSeasons.length > 0 && (
          <section className="mt-8" aria-labelledby="pgc-related-heading">
            <h2
              id="pgc-related-heading"
              className="mb-3 inline-flex items-center gap-1.5 text-base font-semibold"
            >
              <Users className="size-4" />
              {t("Pgc.season.related")}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {detail.relatedSeasons.map((related) => (
                <Link
                  key={related.seasonId}
                  to={`/pgc/${related.seasonId}`}
                  className="group min-w-0"
                >
                  <CoverImage
                    src={related.coverUrl}
                    alt=""
                    className="aspect-[3/4] rounded-md"
                  />
                  <p className="group-hover:text-primary mt-2 line-clamp-2 text-xs leading-5 font-medium transition-colors">
                    {related.title}
                  </p>
                  {related.badge && (
                    <p className="text-muted-foreground mt-0.5 text-[10px]">
                      {related.badge}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}
      </article>
    </div>
  );
}
