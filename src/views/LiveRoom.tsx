import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useParams, useSearchParams } from "react-router";
import { CircleAlert } from "lucide-react";

import { asCommandError, type CommandError } from "@/api/account";
import {
  getLiveRoomInfo,
  getLiveRoomPlayback,
  type LivePlaybackInfo,
  type LiveRoomInfo,
} from "@/api/live";
import {
  addLocalFavorite,
  listLocalFavorites,
  removeLocalFavorite,
  type FavoriteEntry,
} from "@/api/media";
import LiveStreamPlayer from "@/components/live/LiveStreamPlayer";
import { Button } from "@/components/ui/button";
import { useI18n, useToast } from "@/composables";
import { useAccount } from "@/contexts/account-context";
import { useNavigatorContext } from "@/contexts/navigator";
import { useBilibiliImage } from "@/hooks/useBilibiliImages";
import { formatTimestamp } from "@/lib/format";
import { favoriteMatches, favoriteTargetForLiveRoom } from "@/lib/library";
import { createLogger } from "@/lib/logger";

const log = createLogger("Media/LiveRoom");

const LIVE_QUALITY_LABELS: Record<number, string> = {
  0: "Live.quality.default",
  80: "Live.quality.smooth",
  150: "Live.quality.hd",
  250: "Live.quality.ultraHd",
  400: "Live.quality.bluRay",
  401: "Live.quality.dolby",
  10_000: "Live.quality.original",
  20_000: "Live.quality.uhd",
  30_000: "Live.quality.dolbyVision",
};
const EMPTY_LIVE_STREAMS: LivePlaybackInfo["streams"] = [];

interface LivePlayerErrorBoundaryProps {
  children: ReactNode;
  roomId: string;
  title: string;
  retryLabel: string;
  backLabel: string;
  onBack: () => void;
}

interface LivePlayerErrorBoundaryState {
  failed: boolean;
}

class LivePlayerErrorBoundary extends Component<
  LivePlayerErrorBoundaryProps,
  LivePlayerErrorBoundaryState
> {
  state: LivePlayerErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): LivePlayerErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error("live player render failed", {
      roomId: this.props.roomId,
      error,
      componentStack: info.componentStack,
    });
  }

  retry = () => {
    this.setState({ failed: false });
  };

  render() {
    if (this.state.failed) {
      return (
        <div className="bg-background text-foreground grid h-full w-full place-items-center px-6">
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <div className="border-border bg-muted/45 text-muted-foreground grid size-11 place-items-center rounded-full border">
              <CircleAlert className="size-5" />
            </div>
            <p className="text-sm">{this.props.title}</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button type="button" size="sm" onClick={this.retry}>
                {this.props.retryLabel}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={this.props.onBack}
              >
                {this.props.backLabel}
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function LiveRoom() {
  const { roomId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const { t, lang } = useI18n();
  const { navigator } = useNavigatorContext();
  const { account, openLogin } = useAccount();
  const {
    info: toastInfo,
    success: toastSuccess,
    error: toastError,
  } = useToast();
  const backPath =
    searchParams.get("from") === "favorites" ? "/favorites" : "/live";

  const [info, setInfo] = useState<LiveRoomInfo | null>(null);
  const [playback, setPlayback] = useState<LivePlaybackInfo | null>(null);
  const [loadedRoomId, setLoadedRoomId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [roomError, setRoomError] = useState<CommandError | null>(null);
  const [playbackError, setPlaybackError] = useState<CommandError | null>(null);
  const [selectedQuality, setSelectedQuality] = useState(10_000);
  const [favorite, setFavorite] = useState<FavoriteEntry | null>(null);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(true);
  const requestIdRef = useRef(0);
  const favoriteRequestIdRef = useRef(0);
  const currentInfo = loadedRoomId === roomId ? info : null;
  const currentPlayback = loadedRoomId === roomId ? playback : null;
  const cover = useBilibiliImage(currentInfo?.coverUrl);
  const avatar = useBilibiliImage(currentInfo?.avatarUrl);
  const target = useMemo(
    () => favoriteTargetForLiveRoom(currentInfo?.roomId ?? roomId),
    [currentInfo?.roomId, roomId]
  );

  const loadRoom = useCallback(async () => {
    if (!roomId) {
      setLoading(false);
      setRoomError({ code: "invalidResponse", message: "Missing room id" });
      return false;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setRoomError(null);
    setPlaybackError(null);

    const [infoResult, playbackResult] = await Promise.allSettled([
      getLiveRoomInfo(roomId),
      getLiveRoomPlayback(roomId),
    ]);
    if (requestId !== requestIdRef.current) return false;
    setLoadedRoomId(roomId);

    let succeeded = true;
    if (infoResult.status === "fulfilled") {
      const playbackStatus =
        playbackResult.status === "fulfilled"
          ? playbackResult.value.liveStatus
          : "unknown";
      const nextInfo =
        playbackStatus === "unknown"
          ? infoResult.value
          : { ...infoResult.value, liveStatus: playbackStatus };
      setInfo(nextInfo);
      log.info("live room info loaded", {
        roomId,
        status: nextInfo.liveStatus,
        infoStatus: infoResult.value.liveStatus,
        hasCover: Boolean(nextInfo.coverUrl),
      });
    } else {
      const normalized = asCommandError(infoResult.reason);
      setRoomError(normalized);
      succeeded = false;
      log.error("live room info failed", {
        roomId,
        code: normalized.code,
      });
    }

    if (playbackResult.status === "fulfilled") {
      const nextPlayback = playbackResult.value;
      setPlayback(nextPlayback);
      setSelectedQuality(
        nextPlayback.currentQuality?.id ??
          nextPlayback.advertisedQualities[0]?.id ??
          10_000
      );
      log.info("live room playback loaded", {
        roomId,
        status: nextPlayback.liveStatus,
        protocols: nextPlayback.streams.map((stream) => stream.protocol),
      });
    } else {
      const normalized = asCommandError(playbackResult.reason);
      setPlaybackError(normalized);
      succeeded = false;
      log.error("live room playback failed", {
        roomId,
        code: normalized.code,
      });
    }

    setLoading(false);
    return succeeded;
  }, [roomId]);

  useEffect(() => {
    setInfo(null);
    setPlayback(null);
    setLoadedRoomId(null);
    setRoomError(null);
    setPlaybackError(null);
    setSelectedQuality(10_000);
    setFavorite(null);
  }, [roomId]);

  useEffect(() => {
    void loadRoom();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadRoom]);

  useEffect(() => {
    const requestId = ++favoriteRequestIdRef.current;
    setFavorite(null);
    setFavoriteLoading(true);
    void listLocalFavorites()
      .then((entries) => {
        if (requestId !== favoriteRequestIdRef.current) return;
        setFavorite(
          entries.find((entry) => favoriteMatches(entry, target)) ?? null
        );
      })
      .catch((reason) => {
        if (requestId !== favoriteRequestIdRef.current) return;
        log.warn("live favorite state load failed", {
          roomId,
          code: asCommandError(reason).code,
        });
      })
      .finally(() => {
        if (requestId === favoriteRequestIdRef.current) {
          setFavoriteLoading(false);
        }
      });

    return () => {
      if (requestId === favoriteRequestIdRef.current) {
        favoriteRequestIdRef.current += 1;
      }
    };
  }, [roomId, target]);

  const loadPlayback = useCallback(
    async (quality: number) => {
      if (!roomId) return false;
      const requestId = ++requestIdRef.current;
      setSwitching(true);
      setPlaybackError(null);
      try {
        const nextPlayback = await getLiveRoomPlayback(roomId, quality);
        if (requestId !== requestIdRef.current) return false;
        setLoadedRoomId(roomId);
        setPlayback(nextPlayback);
        if (nextPlayback.liveStatus !== "unknown") {
          setInfo((current) =>
            current && current.liveStatus !== nextPlayback.liveStatus
              ? { ...current, liveStatus: nextPlayback.liveStatus }
              : current
          );
        }
        setSelectedQuality(
          nextPlayback.currentQuality?.id ??
            nextPlayback.advertisedQualities[0]?.id ??
            quality
        );
        log.info("live playback refreshed", {
          roomId,
          quality: nextPlayback.currentQuality?.id ?? quality,
          status: nextPlayback.liveStatus,
          protocols: nextPlayback.streams.map((stream) => stream.protocol),
        });
        return true;
      } catch (reason) {
        if (requestId !== requestIdRef.current) return false;
        const normalized = asCommandError(reason);
        setPlaybackError(normalized);
        log.error("live playback refresh failed", {
          roomId,
          quality,
          code: normalized.code,
        });
        return false;
      } finally {
        if (requestId === requestIdRef.current) setSwitching(false);
      }
    },
    [roomId]
  );

  const qualityOptions = useMemo(() => {
    if (!currentPlayback) return [];
    const options = new Map<number, string>();
    for (const quality of currentPlayback.advertisedQualities) {
      const labelKey = LIVE_QUALITY_LABELS[quality.id];
      options.set(quality.id, labelKey ? t(labelKey) : quality.label);
    }
    if (currentPlayback.currentQuality) {
      const labelKey = LIVE_QUALITY_LABELS[currentPlayback.currentQuality.id];
      options.set(
        currentPlayback.currentQuality.id,
        labelKey ? t(labelKey) : currentPlayback.currentQuality.label
      );
    }
    return [...options.entries()].map(([id, label]) => ({ id, label }));
  }, [currentPlayback, t]);

  const currentQuality =
    qualityOptions.find((quality) => quality.id === selectedQuality) ??
    currentPlayback?.currentQuality;
  const liveStatus =
    currentPlayback && currentPlayback.liveStatus !== "unknown"
      ? currentPlayback.liveStatus
      : (currentInfo?.liveStatus ?? "unknown");
  const startedAt = formatTimestamp(currentInfo?.startedAt, lang);
  const qualityLocked = account?.status !== "authenticated";
  const stageError = playbackError ?? roomError;

  const refreshPlayback = useCallback(async () => {
    if (!currentPlayback || roomError) {
      return loadRoom();
    }
    return loadPlayback(selectedQuality);
  }, [currentPlayback, loadPlayback, loadRoom, roomError, selectedQuality]);

  const toggleFavorite = useCallback(async () => {
    if (!currentInfo || favoriteBusy || favoriteLoading) return;
    setFavoriteBusy(true);
    favoriteRequestIdRef.current += 1;
    try {
      const entries = favorite
        ? await removeLocalFavorite(target)
        : await addLocalFavorite({
            target,
            title: currentInfo.title,
            coverUrl: currentInfo.coverUrl,
            ownerName: currentInfo.anchorName,
          });
      setFavorite(
        entries.find((entry) => favoriteMatches(entry, target)) ?? null
      );
      if (favorite) {
        toastSuccess("Library.favorites.removed");
      } else {
        toastSuccess("Library.favorites.added");
      }
    } catch (reason) {
      toastError("Library.favorites.updateFailed");
      log.error("live favorite toggle failed", {
        roomId,
        code: asCommandError(reason).code,
      });
    } finally {
      setFavoriteBusy(false);
    }
  }, [
    favorite,
    favoriteBusy,
    favoriteLoading,
    currentInfo,
    roomId,
    target,
    toastError,
    toastSuccess,
  ]);

  const showQualityLoginHint = useCallback(() => {
    toastInfo("Live.quality.loginRequired", {
      id: "live-quality-login-required",
      duration: 2400,
      action: {
        label: t("Account.titlebar.login"),
        onClick: () => openLogin(),
      },
    });
  }, [openLogin, t, toastInfo]);

  return (
    <div className="bg-background text-foreground relative h-[calc(100vh-2rem)] min-h-0 w-full overflow-hidden">
      <LivePlayerErrorBoundary
        key={roomId}
        roomId={roomId}
        title={t("Live.player.renderError")}
        retryLabel={t("Live.retry")}
        backLabel={t("Live.room.back")}
        onBack={() => navigator(backPath)}
      >
        <LiveStreamPlayer
          roomId={roomId}
          info={currentInfo}
          streams={currentPlayback?.streams ?? EMPTY_LIVE_STREAMS}
          poster={cover.src}
          avatarSrc={avatar.src}
          startedAt={startedAt}
          liveStatus={liveStatus}
          roomLoading={loading}
          refreshing={switching}
          playbackError={stageError}
          qualityOptions={qualityOptions}
          currentQualityId={currentQuality?.id}
          currentQualityLabel={currentQuality?.label}
          qualityLocked={qualityLocked}
          favorite={Boolean(favorite)}
          favoriteBusy={favoriteBusy}
          favoriteLoading={favoriteLoading}
          onBack={() => navigator(backPath)}
          onRefresh={refreshPlayback}
          onFavorite={() => void toggleFavorite()}
          onQualityChange={(quality) => void loadPlayback(quality)}
          onQualityLocked={showQualityLoginHint}
        />
      </LivePlayerErrorBoundary>
    </div>
  );
}
