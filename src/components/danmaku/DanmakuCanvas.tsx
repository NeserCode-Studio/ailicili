import { memo, useMemo, useRef } from "react";

import { useDanmakuScheduler } from "@/hooks/useDanmakuScheduler";
import type { DanmakuMediaClockSource } from "@/lib/danmaku/media-clock";
import {
  resolveDanmakuStyle,
  type DanmakuRenderItem,
  type DanmakuRenderStyle,
} from "@/lib/danmaku/types";
import { cn } from "@/lib/utils";

export interface DanmakuCanvasProps {
  items: readonly DanmakuRenderItem[];
  mediaTimeMs?: number;
  mediaClock?: DanmakuMediaClockSource;
  playing: boolean;
  playbackRate?: number;
  seeking?: boolean;
  visible?: boolean;
  settings?: Partial<DanmakuRenderStyle>;
  className?: string;
  onError?: (error: unknown) => void;
}

export const DanmakuCanvas = memo(function DanmakuCanvas({
  items,
  mediaTimeMs = 0,
  mediaClock,
  playing,
  playbackRate = 1,
  seeking = false,
  visible = true,
  settings,
  className,
  onError,
}: DanmakuCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const style = useMemo(() => resolveDanmakuStyle(settings), [settings]);

  useDanmakuScheduler(canvasRef, {
    items,
    mediaTimeMs,
    mediaClock,
    playing,
    playbackRate,
    seeking,
    visible,
    style,
    onError,
  });

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-danmaku-layer=""
      className={cn(
        "pointer-events-none absolute inset-0 block size-full select-none",
        className
      )}
    />
  );
});
