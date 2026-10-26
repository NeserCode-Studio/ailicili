import {
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
} from "@tauri-apps/api/window";

import { createLogger } from "@/lib/logger";
import type { VideoDimension } from "@/shared/bili.types";

const WINDOW_MARGIN = 32;
const TITLEBAR_HEIGHT = 32;

const log = createLogger("PlayerWindowSizing");

interface WindowSize {
  width: number;
  height: number;
}

export function calculatePlayerWindowSize(
  dimension: VideoDimension,
  workArea: { width: number; height: number },
  scaleFactor: number
): WindowSize | null {
  if (
    !Number.isFinite(dimension.width) ||
    !Number.isFinite(dimension.height) ||
    dimension.width <= 0 ||
    dimension.height <= 0 ||
    !Number.isFinite(workArea.width) ||
    !Number.isFinite(workArea.height) ||
    workArea.width <= 0 ||
    workArea.height <= 0 ||
    !Number.isFinite(scaleFactor) ||
    scaleFactor <= 0
  ) {
    return null;
  }

  const rotated = Math.abs(dimension.rotate) % 180 === 90;
  const videoWidth = rotated ? dimension.height : dimension.width;
  const videoHeight = rotated ? dimension.width : dimension.height;
  const maxWindowWidth = Math.max(
    1,
    Math.floor(workArea.width / scaleFactor - WINDOW_MARGIN)
  );
  const maxWindowHeight = Math.max(
    1,
    Math.floor(workArea.height / scaleFactor - WINDOW_MARGIN)
  );
  const maxContentHeight = Math.max(1, maxWindowHeight - TITLEBAR_HEIGHT);
  const nativeWidth = videoWidth / scaleFactor;
  const nativeHeight = videoHeight / scaleFactor;
  const fitScale = Math.min(
    1,
    maxWindowWidth / nativeWidth,
    maxContentHeight / nativeHeight
  );

  return {
    width: Math.max(1, Math.round(nativeWidth * fitScale)),
    height: Math.max(
      TITLEBAR_HEIGHT + 1,
      Math.round(nativeHeight * fitScale) + TITLEBAR_HEIGHT
    ),
  };
}

export async function fitPlayerWindowToVideo(
  dimension: VideoDimension
): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;

  try {
    const playerWindow = getCurrentWindow();
    const [monitor, fullscreen] = await Promise.all([
      currentMonitor(),
      playerWindow.isFullscreen().catch(() => false),
    ]);
    if (!monitor || fullscreen) return;

    const size = calculatePlayerWindowSize(
      dimension,
      monitor.workArea.size,
      monitor.scaleFactor
    );
    if (!size) return;

    if (await playerWindow.isMaximized().catch(() => false)) {
      await playerWindow.unmaximize();
    }
    await playerWindow.setSize(new LogicalSize(size.width, size.height));
  } catch (error) {
    log.warn("failed to fit player window", error);
  }
}
