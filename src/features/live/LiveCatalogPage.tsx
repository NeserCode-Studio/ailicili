import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Inbox,
  Info,
  RadioTower,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useSearchParams } from "react-router";

import AsyncErrorState from "@/components/feedback/AsyncErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n, useToast } from "@/composables";
import LiveRoomCard from "@/features/live/LiveRoomCard";
import {
  biliKeys,
  fetchLiveAreas,
  fetchLiveRooms,
  normalizeBiliError,
  openLiveRoomWindow,
} from "@/lib/bili";

const PAGE_SIZE = 24;

function parsePositiveInteger(value: string | null): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function CatalogSkeleton() {
  return (
    <div
      data-testid="live-catalog-loading"
      aria-busy="true"
      className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
    >
      {Array.from({ length: 10 }, (_, index) => (
        <div key={index} className="min-w-0 space-y-2.5">
          <Skeleton className="aspect-video w-full rounded-md" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}

export default function LiveCatalogPage() {
  const { t } = useI18n();
  const { error: toastError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const parentAreaId = searchParams.get("area");
  const subAreaId = searchParams.get("subarea");
  const page = parsePositiveInteger(searchParams.get("page"));

  const areasQuery = useQuery({
    queryKey: biliKeys.liveAreas(),
    queryFn: fetchLiveAreas,
    staleTime: 30 * 60_000,
  });
  const roomsQuery = useQuery({
    queryKey: biliKeys.liveRooms(
      parentAreaId ?? "all",
      subAreaId ?? "all",
      page
    ),
    queryFn: () =>
      fetchLiveRooms(
        parentAreaId,
        parentAreaId ? subAreaId : null,
        page,
        PAGE_SIZE
      ),
    staleTime: 60_000,
  });

  const selectedArea = areasQuery.data?.find(
    (area) => area.id === parentAreaId
  );
  const selectedSubArea = selectedArea?.children.find(
    (area) => area.id === subAreaId
  );
  const fallback = Boolean(roomsQuery.data?.fallbackReason);
  const recommended =
    roomsQuery.data?.mode === "recommended" && parentAreaId === null;
  const error = roomsQuery.error
    ? normalizeBiliError(roomsQuery.error)
    : undefined;

  const updateParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    setSearchParams(next);
  };

  const openRoom = async (roomId: number) => {
    try {
      await openLiveRoomWindow(roomId);
    } catch {
      toastError("Live.openError");
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1680px] px-5 py-6 sm:px-7 lg:px-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <RadioTower className="text-primary size-5" />
            {t("Live.title")}
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            {t("Live.description")}
          </p>
        </div>
        {roomsQuery.data && (
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
            {roomsQuery.data.mode === "recommended" ? (
              <Sparkles className="size-3.5" />
            ) : (
              <RadioTower className="size-3.5" />
            )}
            {t(
              roomsQuery.data.mode === "recommended"
                ? "Live.feed.recommended"
                : "Live.feed.area"
            )}
          </span>
        )}
      </header>

      <section
        aria-label={t("Live.areas")}
        className="border-border/80 mb-5 space-y-3 border-y py-3"
      >
        {areasQuery.isPending ? (
          <div className="flex gap-2" aria-busy="true">
            {Array.from({ length: 7 }, (_, index) => (
              <Skeleton key={index} className="h-8 w-20 shrink-0" />
            ))}
          </div>
        ) : areasQuery.data?.length ? (
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <ToggleGroup
              type="single"
              value={parentAreaId ?? "all"}
              onValueChange={(value) =>
                updateParams({
                  area: !value || value === "all" ? null : value,
                  subarea: null,
                })
              }
              variant="outline"
              size="sm"
              className="w-max min-w-full justify-start"
              aria-label={t("Live.parentAreas")}
            >
              <ToggleGroupItem value="all" className="min-w-20 px-3">
                {t("Live.allAreas")}
              </ToggleGroupItem>
              {areasQuery.data.map((area) => (
                <ToggleGroupItem
                  key={area.id}
                  value={area.id}
                  className="min-w-20 px-3"
                >
                  {area.name}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            {t("Live.areasUnavailable")}
          </p>
        )}

        {selectedArea && selectedArea.children.length > 0 && (
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <ToggleGroup
              type="single"
              value={selectedSubArea?.id ?? "all"}
              onValueChange={(value) =>
                updateParams({
                  subarea: !value || value === "all" ? null : value,
                })
              }
              size="sm"
              className="w-max min-w-full justify-start"
              aria-label={t("Live.subAreas")}
            >
              <ToggleGroupItem value="all" className="min-w-16 px-3">
                {t("Live.allSubAreas")}
              </ToggleGroupItem>
              {selectedArea.children.map((area) => (
                <ToggleGroupItem
                  key={area.id}
                  value={area.id}
                  className="min-w-16 px-3"
                >
                  {area.name}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}
      </section>

      {fallback && (
        <div
          role="status"
          className="border-amber-500/30 bg-amber-500/[0.06] mb-5 flex gap-3 rounded-md border px-4 py-3"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <div className="min-w-0 text-sm">
            <p className="font-medium">{t("Live.areaFallback.title")}</p>
            <p className="text-muted-foreground mt-0.5 text-xs leading-5">
              {t("Live.areaFallback.description")}
            </p>
          </div>
        </div>
      )}

      {recommended && (
        <div className="text-muted-foreground mb-4 flex items-center gap-2 text-xs">
          <Info className="size-3.5" />
          {t("Live.recommendedHint")}
        </div>
      )}

      {roomsQuery.isPending ? (
        <CatalogSkeleton />
      ) : error ? (
        <AsyncErrorState
          title={t("Live.error.title")}
          description={t("Live.error.description")}
          code={error.code}
          retryLabel={t("Live.retry")}
          onRetry={() => void roomsQuery.refetch()}
        />
      ) : roomsQuery.data?.rooms.length ? (
        <>
          <div
            className={
              roomsQuery.isFetching
                ? "grid grid-cols-1 gap-x-4 gap-y-8 opacity-60 transition-opacity sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
                : "grid grid-cols-1 gap-x-4 gap-y-8 transition-opacity sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
            }
          >
            {roomsQuery.data.rooms.map((room) => (
              <LiveRoomCard
                key={room.roomId}
                room={room}
                onOpen={(roomId) => void openRoom(roomId)}
              />
            ))}
          </div>

          <nav
            className="mt-9 flex items-center justify-center gap-3"
            aria-label={t("Live.pagination")}
          >
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1 || roomsQuery.isFetching}
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.set("page", String(Math.max(1, page - 1)));
                setSearchParams(next);
              }}
            >
              <ChevronLeft className="size-4" />
              {t("Common.previous")}
            </Button>
            <span className="text-muted-foreground min-w-20 text-center text-xs tabular-nums">
              {t("Live.page", { page })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!roomsQuery.data.hasMore || roomsQuery.isFetching}
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.set("page", String(page + 1));
                setSearchParams(next);
              }}
            >
              {t("Common.next")}
              <ChevronRight className="size-4" />
            </Button>
          </nav>
        </>
      ) : (
        <div className="border-border flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center">
          <Inbox className="text-muted-foreground size-6" />
          <div>
            <h2 className="text-base font-semibold">{t("Live.empty.title")}</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("Live.empty.description")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
