import { memo, useRef } from "react";

import { useDanmakuScheduler } from "@/hooks/useDanmakuScheduler";
import {
  resolveDanmakuStyle,
  type DanmakuRenderItem,
  type DanmakuRenderStyle,
} from "@/lib/danmaku/types";
import { cn } from "@/lib/utils";

export interface DanmakuCanvasProps {
  items: readonly DanmakuRenderItem[];
  mediaTimeMs: number;
  playing: boolean;
  playbackRate?: number;
  visible?: boolean;
  settings?: Partial<DanmakuRenderStyle>;
  className?: string;
  onError?: (error: unknown) => void;
}

export const DanmakuCanvas = memo(function DanmakuCanvas({
  items,
  mediaTimeMs,
  playing,
  playbackRate = 1,
  visible = true,
  settings,
  className,
  onError,
}: DanmakuCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const style = resolveDanmakuStyle(settings);

  useDanmakuScheduler(canvasRef, {
    items,
    mediaTimeMs,
    playing,
    playbackRate,
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
