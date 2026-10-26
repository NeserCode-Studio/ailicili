import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { LoaderCircle } from "lucide-react";

import AsyncErrorState from "@/components/feedback/AsyncErrorState";
import TitlebarExternalLink from "@/components/framework/TitlebarExternalLink";
import { Button } from "@/components/ui/button";
import { useI18n, useToast } from "@/composables";
import { usePageTitlebarTitle } from "@/contexts/pageTitlebar";
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
import type { DanmakuItem, VideoPart } from "@/shared/bili.types";

const BVID_PATTERN = /^BV[0-9A-Za-z]{8,22}$/;

export default function PlayerWindowPage() {
  const { bvid = "", cid = "" } = useParams<{
    bvid: string;
    cid: string;
  }>();
  const { t } = useI18n();
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
  usePageTitlebarTitle(video?.title);
  const activePart =
    detailQuery.data?.parts.find((part) => part.cid === requestedCid) ??
    detailQuery.data?.parts[0];
  const resolvedCid = activePart?.cid ?? requestedCid;
  const playbackDurationSeconds =
    activePart?.durationSeconds ?? video?.durationSeconds ?? 0;

  const playbackQuery = useQuery({
    queryKey: biliKeys.playback(bvid, resolvedCid, 80),
    queryFn: () => createPlaybackSession(bvid, resolvedCid, 80),
    enabled: validRoute && resolvedCid > 0,
    staleTime: 10 * 60_000,
    gcTime: 20 * 60_000,
  });
  const danmakuQuery = useQuery({
    queryKey: biliKeys.danmaku(resolvedCid, playbackDurationSeconds),
    queryFn: () => fetchDanmaku(resolvedCid, playbackDurationSeconds),
    enabled: validRoute && resolvedCid > 0 && playbackDurationSeconds > 0,
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
        durationSeconds: playbackDurationSeconds,
        playType: 0,
      }).catch(() => {
        // Playback must continue when an optional history write fails.
      });
    },
    [playbackDurationSeconds, resolvedCid, video]
  );

  const onDanmakuSent = useCallback(
    (item: DanmakuItem) => {
      queryClient.setQueryData<DanmakuItem[]>(
        biliKeys.danmaku(resolvedCid, playbackDurationSeconds),
        (items = []) =>
          [...items, item].sort(
            (left, right) => left.progressMs - right.progressMs
          )
      );
    },
    [playbackDurationSeconds, queryClient, resolvedCid]
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
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#09090b] text-white"
    >
      <TitlebarExternalLink
        label={t("Video.openOnBilibili")}
        onOpen={() => void openExternal()}
      />
      <div className="flex min-h-0 w-full flex-1 items-stretch justify-center">
        <div
          data-testid="player-stage"
          className="relative flex h-full min-h-0 w-full overflow-hidden bg-black"
        >
          {playbackQuery.isPending ? (
            <div className="flex size-full items-center justify-center bg-black">
              <LoaderCircle
                className="size-8 animate-spin text-white/75"
                aria-label={t("Player.loading")}
              />
            </div>
          ) : playbackQuery.error ? (
            <div className="flex size-full flex-col items-center justify-center gap-3 bg-black px-6 text-center">
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
              durationSeconds={playbackDurationSeconds}
              startAt={resumeQuery.data?.lastPlayTimeSeconds ?? 0}
              danmaku={danmakuQuery.data ?? []}
              theater={theater}
              onToggleTheater={() => setTheater((value) => !value)}
              onProgress={onProgress}
              onEnded={() => onProgress(playbackDurationSeconds)}
              onDanmakuSent={onDanmakuSent}
              parts={detailQuery.data.parts}
              activeCid={resolvedCid}
              onSelectPart={openPart}
            />
          ) : null}
          {danmakuQuery.isError && (
            <p className="pointer-events-none absolute top-2 left-2 z-40 rounded-sm bg-black/70 px-2 py-1 text-[11px] text-white/70">
              {t("Danmaku.unavailable")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
