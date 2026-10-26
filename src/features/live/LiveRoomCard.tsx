import { Radio, Users } from "lucide-react";

import { useI18n } from "@/composables";
import CoverImage from "@/features/video/CoverImage";
import { formatCompactCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LiveRoomSummary } from "@/shared/bili.types";

interface LiveRoomCardProps {
  room: LiveRoomSummary;
  onOpen: (roomId: number) => void;
}

export default function LiveRoomCard({ room, onOpen }: LiveRoomCardProps) {
  const { lang, t } = useI18n();
  const isLive = room.liveStatus === 1;

  return (
    <button
      type="button"
      aria-label={room.title}
      onClick={() => onOpen(room.roomId)}
      className="group focus-visible:ring-ring flex min-w-0 flex-col rounded-md text-left outline-none focus-visible:ring-2"
    >
      <div className="relative aspect-video overflow-hidden rounded-md bg-black">
        <CoverImage
          src={room.coverUrl || room.keyframeUrl}
          alt=""
          className="size-full transition-transform duration-300 group-hover:scale-[1.02]"
        />
        <span
          className={cn(
            "absolute top-2 left-2 inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-[10px] font-bold text-white shadow-sm",
            isLive ? "bg-red-600" : "bg-zinc-700"
          )}
        >
          <Radio className="size-2.5" />
          {isLive ? "LIVE" : t("Live.offline")}
        </span>
        <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-sm bg-black/75 px-1.5 py-1 text-[10px] font-medium text-white tabular-nums">
          <Users className="size-3" />
          {formatCompactCount(room.online, lang)}
        </span>
      </div>

      <h3 className="text-foreground group-hover:text-primary mt-2.5 line-clamp-2 min-h-10 text-sm leading-5 font-semibold transition-colors">
        {room.title}
      </h3>
      <div className="text-muted-foreground mt-1 flex min-w-0 items-center gap-2 text-xs">
        <span className="truncate">{room.anchorName}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate">
          {room.areaName || room.parentAreaName}
        </span>
      </div>
    </button>
  );
}
