import { Clock3, ExternalLink, Play, Radio, Users } from "lucide-react";
import { Link } from "react-router";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useI18n, useToast } from "@/composables";
import CoverImage from "@/features/video/CoverImage";
import { openExternalUrl } from "@/lib/external";
import {
  formatCompactCount,
  formatDuration,
  formatPublishedAt,
} from "@/lib/format";
import type { SearchItem } from "@/shared/bili.types";

interface SearchResultItemProps {
  item: SearchItem;
}

function DurationBadge({ seconds }: { seconds: number }) {
  return (
    <span className="absolute right-1.5 bottom-1.5 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] leading-4 text-white tabular-nums">
      {formatDuration(seconds)}
    </span>
  );
}

function OpenAction({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground group-hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors">
      {label}
      <ExternalLink className="size-3" />
    </span>
  );
}

export default function SearchResultItem({ item }: SearchResultItemProps) {
  const { lang, t } = useI18n();
  const { error } = useToast();

  async function openTarget(url: string) {
    try {
      await openExternalUrl(url);
    } catch {
      error("Search.openError");
    }
  }

  if (item.kind === "video") {
    return (
      <Link
        to={`/video/${item.bvid}`}
        className="group hover:bg-muted/55 grid gap-4 rounded-md p-3 transition-colors sm:grid-cols-[11rem_1fr]"
      >
        <div className="relative aspect-video overflow-hidden rounded-md">
          <CoverImage
            src={item.coverUrl}
            alt=""
            className="size-full transition-transform duration-300 group-hover:scale-[1.02]"
          />
          <DurationBadge seconds={item.durationSeconds} />
        </div>
        <div className="flex min-w-0 flex-col justify-center">
          <h3 className="line-clamp-2 text-sm leading-6 font-semibold sm:text-base">
            {item.title}
          </h3>
          <p className="text-muted-foreground mt-2 text-xs">{item.author}</p>
          <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5">
              <Play className="size-3" />
              {formatCompactCount(item.views, lang)}
            </span>
            {item.publishedAt !== null && (
              <span className="flex items-center gap-1.5">
                <Clock3 className="size-3" />
                {formatPublishedAt(item.publishedAt, lang)}
              </span>
            )}
          </div>
        </div>
      </Link>
    );
  }

  if (item.kind === "user") {
    return (
      <Link
        to={`/space/${item.mid}`}
        className="group hover:bg-muted/55 grid w-full gap-4 rounded-md p-3 text-left transition-colors sm:grid-cols-[4.5rem_1fr_auto]"
      >
        <Avatar className="size-16 border sm:size-[4.5rem]">
          <AvatarImage
            src={item.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
          />
          <AvatarFallback className="text-xl">
            {item.name.trim().charAt(0) || "U"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 self-center">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold">{item.name}</h3>
            <span className="bg-secondary rounded px-1.5 py-0.5 text-[10px] font-medium">
              LV{item.level}
            </span>
          </div>
          <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-5">
            {item.bio || t("Search.userNoBio")}
          </p>
          <div className="text-muted-foreground mt-2 flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <Users className="size-3" />
              {formatCompactCount(item.followers, lang)}
            </span>
            <span>{t("Search.videoCount", { count: item.videos })}</span>
          </div>
        </div>
        <span className="self-center">
          <span className="text-muted-foreground group-hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors">
            {t("Search.openProfile")}
          </span>
        </span>
      </Link>
    );
  }

  if (item.kind === "pgc") {
    const target = (
      <>
        <div className="aspect-[3/4] overflow-hidden rounded-md">
          <CoverImage src={item.coverUrl} alt="" className="size-full" />
        </div>
        <div className="min-w-0 self-center">
          <h3 className="line-clamp-2 text-base font-semibold">{item.title}</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            {[item.subtitle, item.score ? `${item.score.toFixed(1)}` : ""]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="text-muted-foreground mt-3 line-clamp-2 text-xs leading-5">
            {item.description}
          </p>
        </div>
        <span className="self-center">
          {item.seasonId !== "0" ? (
            <span className="text-muted-foreground group-hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors">
              {t("Discover.details")}
            </span>
          ) : (
            <OpenAction label={t("Search.openOnBilibili")} />
          )}
        </span>
      </>
    );
    const className =
      "group hover:bg-muted/55 grid w-full gap-4 rounded-md p-3 text-left transition-colors sm:grid-cols-[7.5rem_1fr_auto]";

    if (item.seasonId !== "0") {
      return (
        <Link to={`/pgc/${item.seasonId}`} className={className}>
          {target}
        </Link>
      );
    }

    return (
      <button
        type="button"
        onClick={() => void openTarget(item.targetUrl)}
        className={className}
      >
        {target}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void openTarget(item.targetUrl)}
      className="group hover:bg-muted/55 grid w-full gap-4 rounded-md p-3 text-left transition-colors sm:grid-cols-[11rem_1fr_auto]"
    >
      <div className="relative aspect-video overflow-hidden rounded-md">
        <CoverImage src={item.coverUrl} alt="" className="size-full" />
        <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          <Radio className="size-2.5" />
          LIVE
        </span>
      </div>
      <div className="min-w-0 self-center">
        <h3 className="line-clamp-2 text-base font-semibold">{item.title}</h3>
        <p className="text-muted-foreground mt-2 text-xs">{item.anchorName}</p>
        <p className="text-muted-foreground mt-2 text-xs">
          {item.areaName}
          <span className="mx-2 opacity-50">/</span>
          {formatCompactCount(item.online, lang)}
        </p>
      </div>
      <span className="self-center">
        <OpenAction label={t("Search.openLive")} />
      </span>
    </button>
  );
}
