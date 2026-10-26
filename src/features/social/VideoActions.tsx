import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock3,
  Coins,
  LoaderCircle,
  Play,
  Plus,
  Sparkles,
  Star,
  ThumbsUp,
} from "lucide-react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useI18n, useToast } from "@/composables";
import {
  addWatchLater,
  biliKeys,
  coinVideo,
  fetchAuthStatus,
  fetchFavoriteFolders,
  fetchVideoActions,
  followUser,
  likeVideo,
  setVideoFavorite,
  tripleVideo,
} from "@/lib/bili";
import { formatCompactCount } from "@/lib/format";
import type {
  FavoriteFolder,
  VideoActionState,
  VideoDetail,
} from "@/shared/bili.types";

interface VideoActionsProps {
  detail: VideoDetail;
  onPlay?: () => void;
}

interface ActionSnapshot {
  previous: VideoActionState | undefined;
}

export default function VideoActions({ detail, onPlay }: VideoActionsProps) {
  const { bvid, aid, author, stats } = detail.video;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { lang, t } = useI18n();
  const { error: toastError, success } = useToast();
  const [coinOpen, setCoinOpen] = useState(false);
  const [favoriteOpen, setFavoriteOpen] = useState(false);
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);

  const authQuery = useQuery({
    queryKey: biliKeys.auth(),
    queryFn: fetchAuthStatus,
    staleTime: 30_000,
  });
  const actionsQuery = useQuery({
    queryKey: biliKeys.actions(bvid),
    queryFn: () => fetchVideoActions(bvid, author.mid),
    staleTime: 30_000,
  });
  const foldersQuery = useQuery({
    queryKey: biliKeys.favoriteFolders(),
    queryFn: fetchFavoriteFolders,
    enabled: favoriteOpen && Boolean(authQuery.data?.authenticated) && aid > 0,
  });

  const requireAuthentication = () => {
    if (authQuery.data?.authenticated) return true;
    navigate("/login");
    return false;
  };

  const updateActions = (
    update: (current: VideoActionState) => VideoActionState
  ) => {
    queryClient.setQueryData<VideoActionState>(
      biliKeys.actions(bvid),
      (current) =>
        current
          ? update(current)
          : {
              liked: false,
              coined: 0,
              favorited: false,
              followed: false,
            }
    );
  };

  const snapshotActions = (): ActionSnapshot => ({
    previous: queryClient.getQueryData<VideoActionState>(
      biliKeys.actions(bvid)
    ),
  });

  const rollbackActions = (snapshot: ActionSnapshot | undefined) => {
    if (snapshot?.previous) {
      queryClient.setQueryData(biliKeys.actions(bvid), snapshot.previous);
    } else {
      queryClient.removeQueries({
        queryKey: biliKeys.actions(bvid),
        exact: true,
      });
    }
  };

  const likeMutation = useMutation({
    mutationFn: (liked: boolean) => likeVideo(bvid, liked),
    onMutate: (liked) => {
      const snapshot = snapshotActions();
      updateActions((current) => ({ ...current, liked }));
      return snapshot;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: biliKeys.actions(bvid),
      });
    },
    onError: (_error, _liked, snapshot) => {
      rollbackActions(snapshot);
      toastError("Actions.error");
    },
  });

  const followMutation = useMutation({
    mutationFn: (follow: boolean) => followUser(author.mid, follow),
    onMutate: (follow) => {
      const snapshot = snapshotActions();
      updateActions((current) => ({ ...current, followed: follow }));
      return snapshot;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: biliKeys.actions(bvid),
      });
    },
    onError: (_error, _follow, snapshot) => {
      rollbackActions(snapshot);
      toastError("Actions.error");
    },
  });

  const coinMutation = useMutation({
    mutationFn: ({
      multiply,
      withLike,
    }: {
      multiply: number;
      withLike: boolean;
    }) => coinVideo(bvid, multiply, withLike),
    onMutate: ({ multiply, withLike }) => {
      const snapshot = snapshotActions();
      updateActions((current) => ({
        ...current,
        coined: Math.max(current.coined, multiply),
        liked: current.liked || withLike,
      }));
      return snapshot;
    },
    onSuccess: (_data, variables) => {
      updateActions((current) => ({
        ...current,
        coined: Math.max(current.coined, variables.multiply),
        liked: current.liked || variables.withLike,
      }));
      setCoinOpen(false);
      success("Actions.coinSuccess");
      void queryClient.invalidateQueries({
        queryKey: biliKeys.actions(bvid),
      });
    },
    onError: (_error, _variables, snapshot) => {
      rollbackActions(snapshot);
      toastError("Actions.error");
    },
  });

  const tripleMutation = useMutation({
    mutationFn: () => tripleVideo(bvid),
    onMutate: () => {
      const snapshot = snapshotActions();
      updateActions((current) => ({
        ...current,
        liked: true,
        coined: Math.max(current.coined, 1),
        favorited: true,
      }));
      return snapshot;
    },
    onSuccess: (result) => {
      updateActions((current) => ({
        ...current,
        liked: current.liked || result.liked,
        coined: result.coined ? Math.max(1, current.coined) : current.coined,
        favorited: current.favorited || result.favorited,
      }));
      success("Actions.tripleSuccess");
      void queryClient.invalidateQueries({
        queryKey: biliKeys.actions(bvid),
      });
    },
    onError: (_error, _variables, snapshot) => {
      rollbackActions(snapshot);
      toastError("Actions.error");
    },
  });

  const favoriteMutation = useMutation({
    mutationFn: async (folderIds: string[]) => {
      const current = actionsQuery.data;
      const folders = foldersQuery.data ?? [];
      const removeMediaIds =
        current?.favorited && folderIds.length === 0
          ? folders.map((folder) => folder.id)
          : [];
      await setVideoFavorite({
        aid,
        addMediaIds: folderIds,
        removeMediaIds,
      });
      return folderIds.length > 0;
    },
    onMutate: (folderIds) => {
      const snapshot = snapshotActions();
      updateActions((current) => ({
        ...current,
        favorited: folderIds.length > 0,
      }));
      return snapshot;
    },
    onSuccess: (favorited) => {
      updateActions((current) => ({ ...current, favorited }));
      setFavoriteOpen(false);
      setSelectedFolders([]);
      success("Actions.favoriteSuccess");
      void queryClient.invalidateQueries({
        queryKey: biliKeys.actions(bvid),
      });
    },
    onError: (_error, _folderIds, snapshot) => {
      rollbackActions(snapshot);
      toastError("Actions.error");
    },
  });

  const watchLaterMutation = useMutation({
    mutationFn: () => addWatchLater(bvid),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: biliKeys.watchLater() });
      success("Actions.watchLaterSuccess");
    },
    onError: () => toastError("Actions.error"),
  });

  const actions = actionsQuery.data;
  const pending =
    likeMutation.isPending ||
    followMutation.isPending ||
    coinMutation.isPending ||
    tripleMutation.isPending ||
    favoriteMutation.isPending;

  const toggleFolder = (folder: FavoriteFolder) => {
    setSelectedFolders((current) =>
      current.includes(folder.id)
        ? current.filter((id) => id !== folder.id)
        : [...current, folder.id]
    );
  };

  return (
    <div className="border-border/80 flex flex-wrap items-center gap-2 border-y py-3">
      <Button
        type="button"
        variant={actions?.liked ? "default" : "outline"}
        size="sm"
        disabled={pending || actionsQuery.isPending}
        aria-pressed={Boolean(actions?.liked)}
        onClick={() => {
          if (!requireAuthentication()) return;
          likeMutation.mutate(!actions?.liked);
        }}
        title={t("Actions.like")}
      >
        <ThumbsUp className={actions?.liked ? "fill-current" : undefined} />
        {formatCompactCount(stats.likes + (actions?.liked ? 1 : 0), lang)}
      </Button>

      <Popover open={coinOpen} onOpenChange={setCoinOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={actions?.coined ? "default" : "outline"}
            size="sm"
            disabled={pending || actionsQuery.isPending}
            aria-pressed={Boolean(actions?.coined)}
            onClick={(event) => {
              if (!requireAuthentication()) event.preventDefault();
            }}
          >
            <Coins />
            {actions?.coined ? `×${actions.coined}` : t("Actions.coin")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56">
          <p className="mb-3 text-sm font-medium">{t("Actions.coinCount")}</p>
          <div className="grid grid-cols-2 gap-2">
            {[1, 2].map((count) => (
              <Button
                key={count}
                type="button"
                size="sm"
                variant="outline"
                disabled={coinMutation.isPending}
                onClick={() =>
                  coinMutation.mutate({ multiply: count, withLike: false })
                }
              >
                {count}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            className="mt-2 w-full"
            disabled={coinMutation.isPending}
            onClick={() => coinMutation.mutate({ multiply: 2, withLike: true })}
          >
            {coinMutation.isPending && (
              <LoaderCircle className="animate-spin" />
            )}
            {t("Actions.coinAndLike")}
          </Button>
        </PopoverContent>
      </Popover>

      <Popover
        open={favoriteOpen}
        onOpenChange={(open) => {
          if (open && !requireAuthentication()) return;
          setFavoriteOpen(open);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={actions?.favorited ? "default" : "outline"}
            size="sm"
            disabled={pending || actionsQuery.isPending}
            aria-pressed={Boolean(actions?.favorited)}
          >
            <Star className={actions?.favorited ? "fill-current" : undefined} />
            {t("Actions.favorite")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72">
          <p className="mb-3 text-sm font-medium">
            {t("Actions.chooseFolder")}
          </p>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {foldersQuery.isPending ? (
              <LoaderCircle className="text-muted-foreground mx-auto size-5 animate-spin" />
            ) : foldersQuery.data?.length ? (
              foldersQuery.data.map((folder) => (
                <label
                  key={folder.id}
                  className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm"
                >
                  <Checkbox
                    checked={selectedFolders.includes(folder.id)}
                    onCheckedChange={() => toggleFolder(folder)}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {folder.title}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {folder.mediaCount}
                  </span>
                </label>
              ))
            ) : (
              <p className="text-muted-foreground py-4 text-center text-xs">
                {t("Actions.noFolders")}
              </p>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            className="mt-3 w-full"
            disabled={favoriteMutation.isPending}
            onClick={() => favoriteMutation.mutate(selectedFolders)}
          >
            {favoriteMutation.isPending && (
              <LoaderCircle className="animate-spin" />
            )}
            {t("Actions.saveFolder")}
          </Button>
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant={actions?.followed ? "default" : "outline"}
        size="sm"
        disabled={pending || actionsQuery.isPending || author.mid === 0}
        aria-pressed={Boolean(actions?.followed)}
        onClick={() => {
          if (!requireAuthentication()) return;
          followMutation.mutate(!actions?.followed);
        }}
      >
        <Plus
          className={actions?.followed ? "rotate-45 transition-transform" : ""}
        />
        {actions?.followed ? t("Actions.following") : t("Actions.follow")}
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending || actionsQuery.isPending}
        onClick={() => {
          if (!requireAuthentication()) return;
          tripleMutation.mutate();
        }}
      >
        <Sparkles />
        {t("Actions.triple")}
      </Button>

      {onPlay && (
        <Button type="button" size="sm" className="min-w-24" onClick={onPlay}>
          <Play className="fill-current" />
          {t("Video.play")}
        </Button>
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto"
        disabled={watchLaterMutation.isPending}
        onClick={() => {
          if (!requireAuthentication()) return;
          watchLaterMutation.mutate();
        }}
      >
        <Clock3 />
        {t("Actions.watchLater")}
      </Button>
    </div>
  );
}
