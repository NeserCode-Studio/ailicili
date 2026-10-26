import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, RadioTower, TriangleAlert } from "lucide-react";
import { useParams } from "react-router";

import AsyncErrorState from "@/components/feedback/AsyncErrorState";
import TitlebarExternalLink from "@/components/framework/TitlebarExternalLink";
import { Button } from "@/components/ui/button";
import { useI18n, useToast } from "@/composables";
import { usePageTitlebarTitle } from "@/contexts/pageTitlebar";
import LiveChatPanel from "@/features/live/LiveChatPanel";
import LivePlayer from "@/features/live/LivePlayer";
import {
  PLAYER_WINDOW_HIDDEN_EVENT,
  PLAYER_WINDOW_REOPENED_EVENT,
} from "@/features/player/playerWindowLifecycle";
import CoverImage from "@/features/video/CoverImage";
import {
  biliKeys,
  createLivePlaybackSession,
  fetchLiveRoom,
  normalizeBiliError,
} from "@/lib/bili";
import { openExternalUrl } from "@/lib/external";
import type { LivePlaybackQuality } from "@/shared/bili.types";

interface PendingQualitySwitch {
  previousQuality: number;
  targetLabel: string;
  wasPlaying: boolean;
}

export default function LivePlayerPage() {
  const { roomId = "" } = useParams<{ roomId: string }>();
  const { t } = useI18n();
  const { error: toastError } = useToast();
  const parsedRoomId = Number(roomId);
  const validRoom =
    Number.isSafeInteger(parsedRoomId) && parsedRoomId > 0;
  const [requestedQuality, setRequestedQuality] = useState(10_000);
  const [pendingSwitch, setPendingSwitch] =
    useState<PendingQualitySwitch | null>(null);
  const [suspended, setSuspended] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);

  const roomQuery = useQuery({
    queryKey: biliKeys.liveRoom(parsedRoomId),
    queryFn: () => fetchLiveRoom(parsedRoomId),
    enabled: validRoom,
    staleTime: 60_000,
  });
  const room = roomQuery.data;
  usePageTitlebarTitle(
    room?.room.title ?? (validRoom ? t("Live.player.title") : undefined)
  );

  const playbackQuery = useQuery({
    queryKey: biliKeys.livePlayback(parsedRoomId, requestedQuality),
    queryFn: () =>
      createLivePlaybackSession(parsedRoomId, requestedQuality),
    enabled:
      validRoom && room?.room.liveStatus === 1 && !suspended,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });

  useEffect(() => {
    setRequestedQuality(10_000);
    setPendingSwitch(null);
    setSuspended(false);
    setReopening(false);
  }, [parsedRoomId]);

  const refetchPlayback = playbackQuery.refetch;
  useEffect(() => {
    const handleHidden = () => {
      setSuspended(true);
      setReopening(false);
    };
    const handleReopened = () => {
      setSuspended(false);
      setReopening(true);
      void refetchPlayback().finally(() => setReopening(false));
    };

    window.addEventListener(PLAYER_WINDOW_HIDDEN_EVENT, handleHidden);
    window.addEventListener(PLAYER_WINDOW_REOPENED_EVENT, handleReopened);
    return () => {
      window.removeEventListener(PLAYER_WINDOW_HIDDEN_EVENT, handleHidden);
      window.removeEventListener(
        PLAYER_WINDOW_REOPENED_EVENT,
        handleReopened
      );
    };
  }, [refetchPlayback]);

  useEffect(() => {
    if (!pendingSwitch || !playbackQuery.isError) return;
    toastError("Live.player.qualityFailed");
    setRequestedQuality(pendingSwitch.previousQuality);
    setPendingSwitch(null);
  }, [pendingSwitch, playbackQuery.isError, toastError]);

  const handleReady = useCallback(() => {
    setPendingSwitch(null);
  }, []);

  const handleQualityRequest = (
    quality: LivePlaybackQuality,
    wasPlaying: boolean
  ) => {
    const current = playbackQuery.data;
    if (!current || pendingSwitch || quality.id === current.selectedQuality) {
      return;
    }
    setPendingSwitch({
      previousQuality: current.selectedQuality,
      targetLabel: quality.label,
      wasPlaying,
    });
    setRequestedQuality(quality.id);
  };

  const reconnect = () => {
    void playbackQuery.refetch();
  };

  const openExternal = async () => {
    if (!room) return;
    try {
      await openExternalUrl(room.webUrl);
    } catch {
      toastError("Pgc.openError");
    }
  };

  if (!validRoom) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <AsyncErrorState
          title={t("Live.player.invalid.title")}
          description={t("Live.player.invalid.description")}
          retryLabel={t("Live.player.close")}
          onRetry={() => window.close()}
        />
      </div>
    );
  }

  if (roomQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center bg-black">
        <LoaderCircle
          className="size-8 animate-spin text-white/75"
          aria-label={t("Live.player.loading")}
        />
      </div>
    );
  }

  if (roomQuery.error || !room) {
    const error = roomQuery.error
      ? normalizeBiliError(roomQuery.error)
      : undefined;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <AsyncErrorState
          title={t("Live.player.error.title")}
          description={t("Live.player.error.description")}
          code={error?.code}
          retryLabel={t("Live.retry")}
          onRetry={() => void roomQuery.refetch()}
        />
      </div>
    );
  }

  const session = playbackQuery.data;
  const playbackError = playbackQuery.error
    ? normalizeBiliError(playbackQuery.error)
    : undefined;
  const streamUnavailable =
    session?.liveStatus === 1 && !session.playbackUrl;

  return (
    <div
      data-testid="live-player-window-page"
      className="flex min-h-0 flex-1 overflow-hidden bg-[#09090b] text-white"
    >
      <TitlebarExternalLink
        label={t("Live.player.openOnBilibili")}
        onOpen={() => void openExternal()}
      />

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <section className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-black">
          {room.room.liveStatus !== 1 ? (
            <div className="relative flex size-full min-h-0 items-center justify-center overflow-hidden p-6">
              <img
                src={room.room.keyframeUrl || room.room.coverUrl}
                alt=""
                className="absolute inset-0 size-full scale-110 object-cover opacity-20 blur-2xl"
              />
              <div className="relative w-full max-w-md rounded-lg border border-white/10 bg-black/55 p-5 text-center shadow-2xl backdrop-blur-md">
                <CoverImage
                  src={room.room.coverUrl}
                  alt=""
                  className="mx-auto aspect-video w-full max-w-xs rounded-md"
                />
                <h1 className="mt-4 line-clamp-2 text-base font-semibold">
                  {room.room.title}
                </h1>
                <p className="mt-1 text-xs text-white/55">
                  {room.room.anchorName} · {room.room.areaName}
                </p>
                <div className="mt-4 flex items-center justify-center gap-2 text-sm text-white/75">
                  <RadioTower className="size-4" />
                  {t("Live.player.offline")}
                </div>
              </div>
            </div>
          ) : playbackQuery.isPending || reopening ? (
            <div className="flex size-full items-center justify-center">
              <LoaderCircle
                className="size-8 animate-spin text-white/75"
                aria-label={t("Live.player.loading")}
              />
            </div>
          ) : playbackError || streamUnavailable ? (
            <div className="flex size-full flex-col items-center justify-center gap-3 px-6 text-center">
              <TriangleAlert className="size-6 text-amber-400" />
              <p className="text-sm text-white/75">
                {t("Live.player.unavailable")}
              </p>
              {playbackError && (
                <p className="font-mono text-[10px] text-white/35">
                  {playbackError.code}
                </p>
              )}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void playbackQuery.refetch()}
              >
                {t("Live.player.retry")}
              </Button>
            </div>
          ) : session?.playbackUrl && !suspended ? (
            <LivePlayer
              key={session.sessionId}
              session={session}
              room={room}
              autoPlay={pendingSwitch?.wasPlaying ?? true}
              chatOpen={chatOpen}
              onReady={handleReady}
              onReconnect={reconnect}
              onRequestQuality={handleQualityRequest}
              onToggleChat={() => setChatOpen((current) => !current)}
            />
          ) : null}

          {pendingSwitch && (
            <div
              data-testid="live-quality-switching"
              role="status"
              aria-live="polite"
              className="absolute inset-0 z-40 flex items-center justify-center bg-black/65 px-6 backdrop-blur-sm"
            >
              <div className="flex max-w-sm min-w-64 items-center gap-3 rounded-md border border-white/10 bg-[#151515]/95 px-4 py-3 shadow-2xl">
                <span className="bg-primary/15 text-primary flex size-9 shrink-0 items-center justify-center rounded-md">
                  <LoaderCircle className="size-4.5 animate-spin" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">
                    {t("Player.quality.switching", {
                      quality: pendingSwitch.targetLabel,
                    })}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/50">
                    {t(
                      pendingSwitch.wasPlaying
                        ? "Player.quality.switchResume"
                        : "Player.quality.switchPaused"
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        {chatOpen && (
          <aside className="border-border bg-background absolute inset-y-0 right-0 z-30 w-[min(86vw,20rem)] shrink-0 border-l shadow-2xl md:static md:w-80 md:shadow-none">
            <LiveChatPanel
              roomId={parsedRoomId}
              active={!suspended && !reopening && room.room.liveStatus === 1}
              onClose={() => setChatOpen(false)}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
