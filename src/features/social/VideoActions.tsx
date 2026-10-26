import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { useVideoActionController } from "@/features/social/useVideoActionController";
import { addWatchLater, biliKeys } from "@/lib/bili";
import { formatCompactCount } from "@/lib/format";
import type { FavoriteFolder, VideoDetail } from "@/shared/bili.types";

interface VideoActionsProps {
  detail: VideoDetail;
  onPlay?: () => void;
}

export default function VideoActions({ detail, onPlay }: VideoActionsProps) {
  const { author, stats } = detail.video;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { lang, t } = useI18n();
  const { error: toastError, success } = useToast();
  const [coinOpen, setCoinOpen] = useState(false);
  const [favoriteOpen, setFavoriteOpen] = useState(false);
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const controller = useVideoActionController(detail, {
    onAuthenticationRequired: () => navigate("/login"),
  });
  const {
    actions,
    actionsPending,
    addCoin,
    coinPending,
    favoriteFolders,
    favoriteFoldersPending,
    favoritePending,
    pending,
    requestFavoriteFolders,
    requireAuthentication,
    saveFavorite,
    setFollowed,
    setLiked,
    triple,
    triplePending,
  } = controller;

  const watchLaterMutation = useMutation({
    mutationFn: () => addWatchLater(detail.video.bvid),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: biliKeys.watchLater() });
      success("Actions.watchLaterSuccess");
    },
    onError: () => toastError("Actions.error"),
  });

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
        disabled={pending || actionsPending}
        aria-pressed={Boolean(actions?.liked)}
        onClick={() => void setLiked(!actions?.liked)}
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
            disabled={pending || actionsPending}
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
                disabled={coinPending}
                onClick={() => {
                  void addCoin(count, false).then((completed) => {
                    if (completed) setCoinOpen(false);
                  });
                }}
              >
                {count}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            className="mt-2 w-full"
            disabled={coinPending}
            onClick={() => {
              void addCoin(2, true).then((completed) => {
                if (completed) setCoinOpen(false);
              });
            }}
          >
            {coinPending && <LoaderCircle className="animate-spin" />}
            {t("Actions.coinAndLike")}
          </Button>
        </PopoverContent>
      </Popover>

      <Popover
        open={favoriteOpen}
        onOpenChange={(open) => {
          if (open) {
            if (!requireAuthentication()) return;
            requestFavoriteFolders();
          }
          setFavoriteOpen(open);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={actions?.favorited ? "default" : "outline"}
            size="sm"
            disabled={pending || actionsPending}
            aria-pressed={Boolean(actions?.favorited)}
            onClick={(event) => {
              if (!requireAuthentication()) event.preventDefault();
            }}
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
            {favoriteFoldersPending ? (
              <LoaderCircle className="text-muted-foreground mx-auto size-5 animate-spin" />
            ) : favoriteFolders.length ? (
              favoriteFolders.map((folder) => (
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
            disabled={favoritePending}
            onClick={() => {
              void saveFavorite(selectedFolders).then((completed) => {
                if (!completed) return;
                setFavoriteOpen(false);
                setSelectedFolders([]);
              });
            }}
          >
            {favoritePending && <LoaderCircle className="animate-spin" />}
            {t("Actions.saveFolder")}
          </Button>
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant={actions?.followed ? "default" : "outline"}
        size="sm"
        disabled={pending || actionsPending || author.mid === 0}
        aria-pressed={Boolean(actions?.followed)}
        onClick={() => void setFollowed(!actions?.followed)}
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
        disabled={pending || actionsPending}
        onClick={() => void triple()}
      >
        {triplePending ? (
          <LoaderCircle className="animate-spin" />
        ) : (
          <Sparkles />
        )}
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
