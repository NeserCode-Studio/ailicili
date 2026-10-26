import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { ExternalLink, LoaderCircle, Play } from "lucide-react";

import AsyncErrorState from "@/components/feedback/AsyncErrorState";
import { Button } from "@/components/ui/button";
import { useI18n, useToast } from "@/composables";
import VideoPlayer from "@/features/player/VideoPlayer";
import {
  biliKeys,
  createPlaybackSession,
  fetchDanmaku,
  fetchResumePoint,
  fetchVideoDetail,
  normalizeBiliError,
  openPlayerWindow,
  reportHeartbeat,
} from "@/lib/bili";
import { openExternalUrl } from "@/lib/external";
import { formatCompactCount, formatDuration } from "@/lib/format";
import type { DanmakuItem, VideoPart } from "@/shared/bili.types";
import { cn } from "@/lib/utils";

const BVID_PATTERN = /^BV[0-9A-Za-z]{8,22}$/;

export default function PlayerWindowPage() {
  const { bvid = "", cid = "" } = useParams<{
    bvid: string;
    cid: string;
  }>();
  const { lang, t } = useI18n();
  const { error: toastError } = useToast();
  const queryClient = useQueryClient();
  const requestedCid = Number(cid);
  const validRoute =
    BVID_PATTERN.test(bvid) &&
    Number.isSafeInteger(requestedCid) &&
    requestedCid > 0;
  const [theater, setTheater] = useState(false);

  const detailQuery = useQuery({
    queryKey: biliKeys.video(bvid),
    queryFn: () => fetchVideoDetail(bvid),
    enabled: validRoute,
  });
  const video = detailQuery.data?.video;
  const activePart =
    detailQuery.data?.parts.find((part) => part.cid === requestedCid) ??
    detailQuery.data?.parts[0];
  const resolvedCid = activePart?.cid ?? requestedCid;

  const playbackQuery = useQuery({
    queryKey: biliKeys.playback(bvid, resolvedCid, 80),
    queryFn: () => createPlaybackSession(bvid, resolvedCid, 80),
    enabled: validRoute && resolvedCid > 0,
    staleTime: 10 * 60_000,
    gcTime: 20 * 60_000,
  });
  const danmakuQuery = useQuery({
    queryKey: biliKeys.danmaku(resolvedCid),
    queryFn: () => fetchDanmaku(resolvedCid),
    enabled: validRoute && resolvedCid > 0,
    staleTime: 5 * 60_000,
  });
  const resumeQuery = useQuery({
    queryKey: biliKeys.resume(bvid, resolvedCid),
    queryFn: () => fetchResumePoint(bvid, resolvedCid),
    enabled: validRoute && resolvedCid > 0,
    retry: false,
    staleTime: 60_000,
  });

  const onProgress = useCallback(
    (seconds: number) => {
      if (!video || resolvedCid <= 0) return;
      void reportHeartbeat({
        aid: video.aid,
        cid: resolvedCid,
        bvid: video.bvid,
        playedSeconds: seconds,
        durationSeconds: video.durationSeconds,
        playType: 0,
      }).catch(() => {
        // Playback must continue when an optional history write fails.
      });
    },
    [resolvedCid, video]
  );

  const onDanmakuSent = useCallback(
    (item: DanmakuItem) => {
      queryClient.setQueryData<DanmakuItem[]>(
        biliKeys.danmaku(resolvedCid),
        (items = []) =>
          [...items, item].sort(
            (left, right) => left.progressMs - right.progressMs
          )
      );
    },
    [queryClient, resolvedCid]
  );

  const openPart = async (part: VideoPart) => {
    try {
      await openPlayerWindow(bvid, part.cid);
    } catch {
      toastError("Player.openError");
    }
  };

  const openExternal = async () => {
    const url = new URL(`https://www.bilibili.com/video/${bvid}`);
    if (activePart && activePart.page > 1) {
      url.searchParams.set("p", String(activePart.page));
    }
    try {
      await openExternalUrl(url.toString());
    } catch {
      toastError("Video.openError");
    }
  };

  if (!validRoute) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <AsyncErrorState
          title={t("Player.invalid.title")}
          description={t("Player.invalid.description")}
          retryLabel={t("Video.back")}
          onRetry={() => window.close()}
        />
      </div>
    );
  }

  if (detailQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center bg-black">
        <LoaderCircle
          className="size-8 animate-spin text-white/75"
          aria-label={t("Player.loading")}
        />
      </div>
    );
  }

  if (detailQuery.error || !video) {
    const error = detailQuery.error
      ? normalizeBiliError(detailQuery.error)
      : undefined;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <AsyncErrorState
          title={t("Video.error.title")}
          description={t("Video.error.description")}
          code={error?.code}
          retryLabel={t("Video.retry")}
          onRetry={() => void detailQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="player-window-page"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#09090b] text-white"
    >
      <div
        className={cn(
          "flex w-full flex-1 flex-col justify-center p-3 sm:p-4",
          theater && "p-0"
        )}
      >
        <div className="mx-auto w-full max-w-[1440px]">
          {playbackQuery.isPending ? (
            <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-black">
              <LoaderCircle
                className="size-8 animate-spin text-white/75"
                aria-label={t("Player.loading")}
              />
            </div>
          ) : playbackQuery.error ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg bg-black px-6 text-center">
              <p className="text-sm text-white/80">{t("Player.unavailable")}</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void playbackQuery.refetch()}
                >
                  {t("Video.retry")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
                  onClick={() => void openExternal()}
                >
                  <ExternalLink />
                  Bilibili
                </Button>
              </div>
            </div>
          ) : playbackQuery.data ? (
            <VideoPlayer
              key={`${resolvedCid}-${playbackQuery.data.sessionId}`}
              session={playbackQuery.data}
              aid={video.aid}
              bvid={video.bvid}
              cid={resolvedCid}
              title={video.title}
              posterUrl={video.coverUrl}
              durationSeconds={video.durationSeconds}
              startAt={resumeQuery.data?.lastPlayTimeSeconds ?? 0}
              danmaku={danmakuQuery.data ?? []}
              theater={theater}
              onToggleTheater={() => setTheater((value) => !value)}
              onProgress={onProgress}
              onEnded={() => onProgress(video.durationSeconds)}
              onDanmakuSent={onDanmakuSent}
            />
          ) : null}
          {danmakuQuery.isError && (
            <p className="mt-2 text-[11px] text-white/55">
              {t("Danmaku.unavailable")}
            </p>
          )}
        </div>
      </div>

      <footer className="shrink-0 border-t border-white/10 bg-[#111114] px-4 py-3">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{video.title}</h1>
            <p className="mt-1 truncate text-[11px] text-white/55">
              {video.author.name} ·{" "}
              {formatCompactCount(video.stats.views, lang)} {t("Video.views")}
              {activePart && detailQuery.data.parts.length > 1
                ? ` · P${activePart.page} ${activePart.title} · ${formatDuration(activePart.durationSeconds)}`
                : ""}
            </p>
          </div>
          <div className="flex max-w-full items-center gap-1 overflow-x-auto">
            {detailQuery.data.parts.map((part) => (
              <button
                key={part.cid}
                type="button"
                onClick={() => void openPart(part)}
                className={cn(
                  "shrink-0 rounded-sm px-2.5 py-1 text-[11px] text-white/60 transition-colors hover:bg-white/10 hover:text-white",
                  part.cid === resolvedCid && "bg-white/12 text-white"
                )}
              >
                P{part.page}
              </button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
            onClick={() => void openExternal()}
          >
            <Play />
            Bilibili
          </Button>
        </div>
      </footer>
    </div>
  );
}
