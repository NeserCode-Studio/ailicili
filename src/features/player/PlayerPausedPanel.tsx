import {
  Coins,
  Eye,
  MessageSquareText,
  Play,
  Plus,
  Sparkles,
  Star,
  ThumbsUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/composables";
import type { VideoActionController } from "@/features/social/useVideoActionController";
import { formatCompactCount } from "@/lib/format";
import type { VideoDetail, VideoPart } from "@/shared/bili.types";
import { cn } from "@/lib/utils";

interface PlayerPausedPanelProps {
  detail: VideoDetail;
  activePart: VideoPart;
  actions: VideoActionController;
  autoLike: boolean;
  onAutoLikeChange: (enabled: boolean) => void;
  onResume: () => void;
}

const actionButtonClass =
  "border-white/10 bg-white/[0.045] text-white hover:border-white/20 hover:bg-white/10 hover:text-white";

export default function PlayerPausedPanel({
  detail,
  activePart,
  actions,
  autoLike,
  onAutoLikeChange,
  onResume,
}: PlayerPausedPanelProps) {
  const { lang, t } = useI18n();
  const { video, description } = detail;
  const {
    actions: relationships,
    actionsPending,
    pending,
    addCoin,
    setFollowed,
    setLiked,
    toggleFavoriteToDefaultFolder,
    triple,
  } = actions;
  const disabled = pending || actionsPending;
  const coinLimitReached = (relationships?.coined ?? 0) >= 2;

  return (
    <div
      data-testid="player-paused-panel"
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 p-4 pb-24 backdrop-blur-[2px]"
    >
      <section
        aria-label={t("Player.pausePanel")}
        className="max-h-full w-full max-w-3xl overflow-hidden rounded-lg border border-white/10 bg-[#111214]/95 text-white shadow-2xl"
      >
        <div className="grid md:grid-cols-[13rem_minmax(0,1fr)]">
          <div className="relative hidden min-h-56 overflow-hidden bg-black md:block">
            <img
              src={video.coverUrl}
              alt=""
              className="absolute inset-0 size-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
            <div className="absolute right-3 bottom-3 left-3 flex items-center justify-between gap-2 text-[11px] text-white/65">
              <span className="rounded-sm bg-black/55 px-1.5 py-0.5 backdrop-blur-sm">
                P{activePart.page}
              </span>
              <span className="truncate">{activePart.title}</span>
            </div>
          </div>

          <div className="min-w-0 p-5">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-white/45 uppercase">
                  {t("Player.paused")}
                </p>
                <h2 className="mt-1 line-clamp-2 text-lg leading-snug font-semibold">
                  {video.title}
                </h2>
                <p className="mt-1.5 truncate text-xs text-white/55">
                  {video.author.name}
                  {detail.parts.length > 1
                    ? ` · P${activePart.page} ${activePart.title}`
                    : ""}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                onClick={onResume}
              >
                <Play className="fill-current" />
                {t("Player.resume")}
              </Button>
            </div>

            <p className="mt-3 line-clamp-2 text-xs leading-5 text-white/55">
              {description || t("Video.noDescription")}
            </p>

            <div className="mt-3 flex items-center gap-5 border-y border-white/10 py-2.5 text-[11px] text-white/55">
              <span className="flex items-center gap-1.5">
                <Eye className="size-3.5" />
                {formatCompactCount(video.stats.views, lang)}
              </span>
              <span className="flex items-center gap-1.5">
                <MessageSquareText className="size-3.5" />
                {formatCompactCount(video.stats.danmaku, lang)}
              </span>
              <span className="flex items-center gap-1.5">
                <ThumbsUp className="size-3.5" />
                {formatCompactCount(
                  video.stats.likes + (relationships?.liked ? 1 : 0),
                  lang
                )}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={relationships?.liked ? "default" : "outline"}
                className={cn(
                  !relationships?.liked && actionButtonClass,
                  "h-8"
                )}
                disabled={disabled}
                aria-pressed={Boolean(relationships?.liked)}
                title={`${t("Actions.like")} (Q)`}
                onClick={() => void setLiked(!relationships?.liked)}
              >
                <ThumbsUp
                  className={relationships?.liked ? "fill-current" : undefined}
                />
                {t("Actions.like")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={relationships?.coined ? "default" : "outline"}
                className={cn(
                  !relationships?.coined && actionButtonClass,
                  "h-8"
                )}
                disabled={disabled || coinLimitReached}
                aria-pressed={Boolean(relationships?.coined)}
                title={
                  coinLimitReached
                    ? t("Actions.coinLimit")
                    : `${t("Actions.coin")} (W)`
                }
                onClick={() => void addCoin(1, false)}
              >
                <Coins />
                {relationships?.coined
                  ? `×${relationships.coined}`
                  : t("Actions.coin")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={relationships?.favorited ? "default" : "outline"}
                className={cn(
                  !relationships?.favorited && actionButtonClass,
                  "h-8"
                )}
                disabled={disabled}
                aria-pressed={Boolean(relationships?.favorited)}
                title={`${t("Actions.favorite")} (E)`}
                onClick={() => void toggleFavoriteToDefaultFolder()}
              >
                <Star
                  className={
                    relationships?.favorited ? "fill-current" : undefined
                  }
                />
                {relationships?.favorited
                  ? t("Actions.favorited")
                  : t("Actions.favorite")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={relationships?.followed ? "default" : "outline"}
                className={cn(
                  !relationships?.followed && actionButtonClass,
                  "h-8"
                )}
                disabled={disabled || video.author.mid === 0}
                aria-pressed={Boolean(relationships?.followed)}
                onClick={() => void setFollowed(!relationships?.followed)}
              >
                <Plus
                  className={
                    relationships?.followed
                      ? "rotate-45 transition-transform"
                      : undefined
                  }
                />
                {relationships?.followed
                  ? t("Actions.following")
                  : t("Actions.follow")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={cn(actionButtonClass, "h-8")}
                disabled={disabled}
                title={`${t("Actions.triple")} (A)`}
                onClick={() => void triple()}
              >
                <Sparkles />
                {t("Actions.triple")}
              </Button>
            </div>

            <label className="mt-3 flex items-center justify-between gap-4 border-t border-white/10 pt-3">
              <span className="min-w-0">
                <span className="block text-xs font-medium text-white/85">
                  {t("Player.settings.autoLike")}
                </span>
                <span className="mt-0.5 block text-[11px] leading-4 text-white/40">
                  {t("Player.settings.autoLike.description")}
                </span>
              </span>
              <Switch
                checked={autoLike}
                onCheckedChange={onAutoLikeChange}
                aria-label={t("Player.settings.autoLike")}
              />
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}
