import { useState } from "react";
import { Radio, UserRound } from "lucide-react";

import type { LiveRoomCard as LiveRoomCardModel } from "@/api/live";
import { useI18n } from "@/composables";
import { formatCount } from "@/lib/format";

interface LiveRoomCardProps {
  room: LiveRoomCardModel;
  onOpen: (room: LiveRoomCardModel) => void;
}

export default function LiveRoomCard({ room, onOpen }: LiveRoomCardProps) {
  const { t } = useI18n();
  const [coverFailed, setCoverFailed] = useState(false);
  const live = room.liveStatus === "live";

  return (
    <button
      type="button"
      className="video-card group"
      aria-label={room.title}
      onClick={() => onOpen(room)}
    >
      <div className="video-card-cover">
        {room.coverUrl && !coverFailed ? (
          <img
            src={room.coverUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <div className="text-muted-foreground grid h-full w-full place-items-center">
            <Radio className="size-6" />
          </div>
        )}

        <span
          className={`absolute top-2 left-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-white ${
            live ? "bg-red-600/90" : "bg-black/65"
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${
              live ? "bg-white" : "bg-white/60"
            }`}
          />
          {t(`Live.status.${room.liveStatus}`)}
        </span>

        <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white tabular-nums">
          {formatCount(room.online)}
        </span>
      </div>

      <div className="video-card-info">
        <span className="text-card-foreground line-clamp-2 min-h-10 text-sm leading-5 font-medium [overflow-wrap:anywhere]">
          {room.title}
        </span>
        <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
          <UserRound className="size-3 shrink-0" />
          <span className="truncate">{room.anchorName}</span>
        </span>
        {room.areaName || room.parentAreaName ? (
          <span className="text-muted-foreground truncate text-xs">
            {[room.parentAreaName, room.areaName].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </div>
    </button>
  );
}
