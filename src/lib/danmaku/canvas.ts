import type { DanmakuRenderStyle } from "@/lib/danmaku/types";

const DANMAKU_REFERENCE_HEIGHT = 720;

export function resolveDanmakuResponsiveScale(
  viewportHeight: number,
  style: DanmakuRenderStyle
) {
  if (!style.scaleWithPlayer) return 1;
  const height = Math.max(
    1,
    Number.isFinite(viewportHeight) ? viewportHeight : 1
  );
  return Math.max(0.75, Math.min(1.5, height / DANMAKU_REFERENCE_HEIGHT));
}

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
