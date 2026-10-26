import { Link } from "react-router";
import { Star } from "lucide-react";

import { useI18n } from "@/composables";
import CoverImage from "@/features/video/CoverImage";
import type { PgcMediaSummary } from "@/shared/bili.types";

interface PgcMediaCardProps {
  item: PgcMediaSummary;
}

export default function PgcMediaCard({ item }: PgcMediaCardProps) {
  const { t } = useI18n();

  return (
    <Link
      to={`/pgc/${item.seasonId}`}
      aria-label={item.title}
      className="group focus-visible:ring-ring flex min-w-0 flex-col rounded-md outline-none focus-visible:ring-2"
    >
      <div className="relative">
        <CoverImage
          src={item.coverUrl}
          alt=""
          className="aspect-[3/4] rounded-md"
        />
        {item.score !== null && (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-sm bg-black/75 px-1.5 py-1 text-[11px] font-semibold text-white tabular-nums">
            <Star className="size-3 fill-amber-400 text-amber-400" />
            {item.score.toFixed(1)}
          </span>
        )}
        <span className="absolute bottom-2 left-2 rounded-sm bg-black/75 px-1.5 py-1 text-[10px] font-medium text-white">
          {item.finished ? t("Pgc.season.finished") : t("Pgc.season.airing")}
        </span>
        {item.badge && (
          <span className="bg-primary text-primary-foreground absolute right-2 bottom-2 rounded-sm px-1.5 py-1 text-[10px] font-semibold">
            {item.badge}
          </span>
        )}
      </div>

      <h3 className="text-foreground group-hover:text-primary mt-2.5 line-clamp-2 min-h-10 text-sm leading-5 font-semibold transition-colors">
        {item.title}
      </h3>
      <p className="text-muted-foreground mt-1 truncate text-xs">
        {[item.subtitle, item.indexShow].filter(Boolean).join(" · ")}
      </p>
      {item.orderLabel && (
        <p className="text-muted-foreground/75 mt-1 truncate text-[11px]">
          {item.orderLabel}
        </p>
      )}
    </Link>
  );
}
