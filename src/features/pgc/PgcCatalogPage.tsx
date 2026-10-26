import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Grid2X2,
  Inbox,
  LoaderCircle,
} from "lucide-react";
import { useSearchParams } from "react-router";

import AsyncErrorState from "@/components/feedback/AsyncErrorState";
import { Button } from "@/components/ui/button";
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
import {
  biliKeys,
  fetchPgcIndex,
  fetchPgcTimeline,
  normalizeBiliError,
} from "@/lib/bili";
import type { PgcSeasonType } from "@/shared/bili.types";
import PgcMediaCard from "@/features/pgc/PgcMediaCard";
import PgcTimelineView from "@/features/pgc/PgcTimelineView";

const PAGE_SIZE = 18;
const PGC_TYPES = [
  { value: 1, label: "Pgc.type.anime" },
  { value: 2, label: "Pgc.type.movie" },
  { value: 3, label: "Pgc.type.documentary" },
  { value: 4, label: "Pgc.type.variety" },
] as const;

type CatalogView = "timeline" | "index";
type StatusFilter = "finished" | "airing" | null;

function supportsTimeline(seasonType: PgcSeasonType) {
  return seasonType === 1 || seasonType === 4;
}

function parseSeasonType(value: string | null): PgcSeasonType {
  const parsed = Number(value);
  return parsed === 2 || parsed === 3 || parsed === 4 ? parsed : 1;
}

function parsePositiveInteger(value: string | null): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseYear(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1990 && parsed <= 2100
    ? parsed
    : null;
}

function parseStatus(value: string | null): StatusFilter {
  return value === "finished" || value === "airing" ? value : null;
}

function CatalogSkeleton() {
  return (
    <div
      data-testid="pgc-loading"
      className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6"
      aria-busy="true"
    >
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} className="space-y-2.5">
          <Skeleton className="aspect-[3/4] w-full rounded-md" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}

export default function PgcCatalogPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const seasonType = parseSeasonType(searchParams.get("type"));
  const supportsSchedule = supportsTimeline(seasonType);
  const requestedView: CatalogView =
    searchParams.get("view") === "index" ? "index" : "timeline";
  const view: CatalogView = supportsSchedule ? requestedView : "index";
  const page = parsePositiveInteger(searchParams.get("page"));
  const year = parseYear(searchParams.get("year"));
  const status = parseStatus(searchParams.get("status"));
  const finished = status === null ? null : status === "finished";

  const timelineQuery = useQuery({
    queryKey: biliKeys.pgcTimeline(seasonType),
    queryFn: () => fetchPgcTimeline(seasonType),
    enabled: view === "timeline",
    staleTime: 5 * 60_000,
  });
  const indexQuery = useQuery({
    queryKey: biliKeys.pgcIndex(seasonType, page, PAGE_SIZE, year, finished),
    queryFn: () => fetchPgcIndex(seasonType, page, PAGE_SIZE, year, finished),
    enabled: view === "index",
    staleTime: 5 * 60_000,
  });
  const activeQuery = view === "timeline" ? timelineQuery : indexQuery;
  const error = activeQuery.error
    ? normalizeBiliError(activeQuery.error)
    : undefined;

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: currentYear - 2009 }, (_, index) =>
      String(currentYear - index)
    );
  }, []);

  const updateParams = (
    changes: Record<string, string | null>,
    resetPage = false
  ) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    if (resetPage) next.delete("page");
    setSearchParams(next);
  };

  const activeLabel = PGC_TYPES.find(
    (type) => type.value === seasonType
  )?.label;
  const hasContent =
    view === "timeline"
      ? Boolean(
          timelineQuery.data?.days.length || timelineQuery.data?.latest.length
        )
      : Boolean(indexQuery.data?.items.length);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-5 py-6 sm:px-7 lg:px-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Pgc.title")}
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            {t("Pgc.description")}
          </p>
        </div>
        {view === "index" && indexQuery.data && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {t("Pgc.index.total", {
              count: indexQuery.data.total,
            })}
          </span>
        )}
        {view === "timeline" && timelineQuery.data && (
          <span className="text-muted-foreground text-xs">
            {t(activeLabel ?? "Pgc.type.anime")}
          </span>
        )}
      </header>

      <div className="border-border/80 mb-6 flex flex-wrap items-center justify-between gap-3 border-y py-3">
        <ToggleGroup
          type="single"
          value={String(seasonType)}
          onValueChange={(value) => {
            if (!value) return;
            const nextType = parseSeasonType(value);
            updateParams(
              {
                type: value,
                page: null,
                view: supportsTimeline(nextType) ? view : "index",
              },
              true
            );
          }}
          variant="outline"
          size="sm"
          aria-label={t("Pgc.title")}
          className="max-w-full overflow-x-auto"
        >
          {PGC_TYPES.map((type) => (
            <ToggleGroupItem
              key={type.value}
              value={String(type.value)}
              className="min-w-16 px-3"
            >
              {t(type.label)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {supportsSchedule && (
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(value) => {
              if (!value) return;
              updateParams({ view: value, page: null }, true);
            }}
            variant="outline"
            size="sm"
            aria-label={t("Pgc.view.index")}
            className="shrink-0"
          >
            <ToggleGroupItem value="timeline" className="gap-1.5 px-3">
              <CalendarDays className="size-3.5" />
              {t("Pgc.view.timeline")}
            </ToggleGroupItem>
            <ToggleGroupItem value="index" className="gap-1.5 px-3">
              <Grid2X2 className="size-3.5" />
              {t("Pgc.view.index")}
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      {view === "index" && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Select
            value={year === null ? "all" : String(year)}
            onValueChange={(value) =>
              updateParams(
                { year: value === "all" ? null : value, page: null },
                true
              )
            }
          >
            <SelectTrigger size="sm" aria-label={t("Pgc.index.year")}>
              <SelectValue placeholder={t("Pgc.index.allYears")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Pgc.index.allYears")}</SelectItem>
              {years.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={status ?? "all"}
            onValueChange={(value) =>
              updateParams(
                {
                  status: value === "all" ? null : value,
                  page: null,
                },
                true
              )
            }
          >
            <SelectTrigger size="sm" aria-label={t("Pgc.index.status")}>
              <SelectValue placeholder={t("Pgc.index.allStatus")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Pgc.index.allStatus")}</SelectItem>
              <SelectItem value="finished">
                {t("Pgc.index.finished")}
              </SelectItem>
              <SelectItem value="airing">{t("Pgc.index.airing")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {activeQuery.isPending ? (
        <div className="space-y-4">
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <LoaderCircle className="size-3.5 animate-spin" />
            {t("Pgc.loading")}
          </div>
          <CatalogSkeleton />
        </div>
      ) : error ? (
        <AsyncErrorState
          title={t("Pgc.error.title")}
          description={t("Pgc.error.description")}
          code={error.code}
          retryLabel={t("Pgc.retry")}
          onRetry={() => void activeQuery.refetch()}
        />
      ) : !hasContent ? (
        <div className="border-border flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center">
          <Inbox className="text-muted-foreground size-6" />
          <div>
            <h2 className="text-base font-semibold">{t("Pgc.empty.title")}</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("Pgc.empty.description")}
            </p>
          </div>
        </div>
      ) : view === "timeline" && timelineQuery.data ? (
        <PgcTimelineView timeline={timelineQuery.data} />
      ) : indexQuery.data ? (
        <div
          className={
            indexQuery.isFetching
              ? "opacity-60 transition-opacity"
              : "transition-opacity"
          }
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
            {indexQuery.data.items.map((item) => (
              <PgcMediaCard key={item.seasonId} item={item} />
            ))}
          </div>

          <nav
            className="mt-9 flex items-center justify-center gap-3"
            aria-label={t("Pgc.index.page", { page })}
          >
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1 || indexQuery.isFetching}
              onClick={() =>
                updateParams({ page: String(Math.max(1, page - 1)) })
              }
            >
              <ChevronLeft className="size-4" />
              {t("Pgc.index.previous")}
            </Button>
            <span className="text-muted-foreground min-w-20 text-center text-xs tabular-nums">
              {t("Pgc.index.page", { page })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!indexQuery.data.hasMore || indexQuery.isFetching}
              onClick={() => updateParams({ page: String(page + 1) })}
            >
              {t("Pgc.index.next")}
              <ChevronRight className="size-4" />
            </Button>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
