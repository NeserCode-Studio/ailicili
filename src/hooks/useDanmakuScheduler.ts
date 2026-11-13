import { useEffect, useRef, type RefObject } from "react";

import { DanmakuCanvasEngine } from "@/lib/danmaku/engine";
import type {
  DanmakuRenderItem,
  DanmakuRenderStyle,
} from "@/lib/danmaku/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("Danmaku/Canvas");
const STATS_PUBLISH_INTERVAL_MS = 1_000;

function publishDiagnostics(
  canvas: HTMLCanvasElement,
  engine: DanmakuCanvasEngine
) {
  const stats = engine.getStats();
  canvas.dataset.danmakuActiveCount = String(stats.activeCount);
  canvas.dataset.danmakuTextureCount = String(stats.cachedTextureCount);
  canvas.dataset.danmakuTexturePixels = String(stats.cachedTexturePixels);
  canvas.dataset.danmakuDpr = stats.dpr.toFixed(2);
  canvas.dataset.danmakuTrackCount = String(stats.trackCount);
  canvas.dataset.danmakuCanvasPixels = String(canvas.width * canvas.height);
  canvas.dataset.danmakuStatsUpdatedAt = performance.now().toFixed(0);
}

interface DanmakuSchedulerOptions {
  items: readonly DanmakuRenderItem[];
  mediaTimeMs: number;
  playing: boolean;
  playbackRate: number;
  visible: boolean;
  style: DanmakuRenderStyle;
  onError?: (error: unknown) => void;
}

export function useDanmakuScheduler(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: DanmakuSchedulerOptions
) {
  const engineRef = useRef<DanmakuCanvasEngine | null>(null);
  const errorHandlerRef = useRef(options.onError);
  const failedRef = useRef(false);
  errorHandlerRef.current = options.onError;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let engine: DanmakuCanvasEngine;
    try {
      engine = new DanmakuCanvasEngine(canvas);
    } catch (error) {
      failedRef.current = true;
      errorHandlerRef.current?.(error);
      log.error("failed to initialize canvas", error);
      return;
    }
    engineRef.current = engine;

    const resize = () => {
      if (failedRef.current) return;
      const bounds = canvas.getBoundingClientRect();
      try {
        engine.resize(bounds.width, bounds.height, window.devicePixelRatio);
      } catch (error) {
        failedRef.current = true;
        errorHandlerRef.current?.(error);
        log.error("failed to resize canvas", error);
      }
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    if (resizeObserver) resizeObserver.observe(canvas);
    else window.addEventListener("resize", resize);
    resize();

    let dprQuery: MediaQueryList | null = null;
    const handleDprChange = () => {
      resize();
      listenForDprChange();
    };
    const listenForDprChange = () => {
      dprQuery?.removeEventListener("change", handleDprChange);
      dprQuery = window.matchMedia(
        `(resolution: ${window.devicePixelRatio}dppx)`
      );
      dprQuery.addEventListener("change", handleDprChange, { once: true });
    };
    listenForDprChange();

    let animationFrame = 0;
    let lastStatsPublishAt = Number.NEGATIVE_INFINITY;
    const frame = (frameTime: number) => {
      if (failedRef.current) return;
      try {
        engine.tick(frameTime);
        if (frameTime - lastStatsPublishAt >= STATS_PUBLISH_INTERVAL_MS) {
          publishDiagnostics(canvas, engine);
          lastStatsPublishAt = frameTime;
        }
      } catch (error) {
        failedRef.current = true;
        errorHandlerRef.current?.(error);
        log.error("canvas frame failed", error);
        return;
      }
      animationFrame = window.requestAnimationFrame(frame);
    };
    animationFrame = window.requestAnimationFrame(frame);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resize);
      dprQuery?.removeEventListener("change", handleDprChange);
      engine.dispose();
      engineRef.current = null;
    };
  }, [canvasRef]);

  useEffect(() => {
    engineRef.current?.setItems(options.items);
  }, [options.items]);

  useEffect(() => {
    engineRef.current?.setStyle(options.style);
  }, [options.style]);

  useEffect(() => {
    engineRef.current?.setMediaTime(options.mediaTimeMs);
  }, [options.mediaTimeMs]);

  useEffect(() => {
    engineRef.current?.setPlaying(options.playing);
  }, [options.playing]);

  useEffect(() => {
    engineRef.current?.setPlaybackRate(options.playbackRate);
  }, [options.playbackRate]);

  useEffect(() => {
    engineRef.current?.setVisible(options.visible);
  }, [options.visible]);

  useEffect(() => {
    const fontSet = document.fonts;
    if (!fontSet) return;

    let cancelled = false;
    const refreshTextures = () => {
      if (!cancelled) engineRef.current?.invalidateTextures();
    };
    const font = `${options.style.fontStyle} ${options.style.fontWeight} 32px ${options.style.fontFamily}`;

    void fontSet
      .load(font, "ailicili danmaku 0123456789")
      .then(refreshTextures)
      .catch((error: unknown) => {
        log.debug("font load failed", error);
      });
    fontSet.addEventListener("loadingdone", refreshTextures);

    return () => {
      cancelled = true;
      fontSet.removeEventListener("loadingdone", refreshTextures);
    };
  }, [
    options.style.fontFamily,
    options.style.fontStyle,
    options.style.fontWeight,
  ]);
}
