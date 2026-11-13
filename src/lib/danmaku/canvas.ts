import type { DanmakuRenderStyle } from "@/lib/danmaku/types";

export function resolveDanmakuCanvasDpr(
  deviceDpr: number,
  width: number,
  height: number,
  style: DanmakuRenderStyle
) {
  const cssPixels = Math.max(1, width * height);
  const budgetDpr = Math.sqrt(style.canvasPixelBudget / cssPixels);
  return Math.max(
    1,
    Math.min(
      style.maxDpr,
      Number.isFinite(deviceDpr) ? deviceDpr : 1,
      budgetDpr
    )
  );
}
