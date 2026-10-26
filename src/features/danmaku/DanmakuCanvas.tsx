import { useEffect, useRef, type RefObject } from "react";

import {
  danmakuColor,
  danmakuLaneCount,
  danmakuLaneY,
  findDanmakuLane,
  shouldDisplayDanmaku,
  type ActiveDanmaku,
} from "@/features/danmaku/danmakuLayout";
import type { DanmakuItem } from "@/shared/bili.types";

export type DanmakuFontWeight = 400 | 500 | 600 | 700;

export interface DanmakuSettings {
  enabled: boolean;
  opacity: number;
  fontScale: number;
  area: number;
  speed: number;
  modes: DanmakuItem["mode"][];
  density: number;
  outlineWidth: number;
  fontWeight: DanmakuFontWeight;
}

interface DanmakuCanvasProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  items: DanmakuItem[];
  settings: DanmakuSettings;
}

export default function DanmakuCanvas({
  videoRef,
  items,
  settings,
}: DanmakuCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    let animationFrame = 0;
    let active: ActiveDanmaku[] = [];
    let itemIndex = 0;
    let previousVideoTime = video.currentTime;
    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      active = [];
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const seekIndex = (time: number) => {
      let low = 0;
      let high = items.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (items[middle].progressMs / 1000 < time) low = middle + 1;
        else high = middle;
      }
      itemIndex = low;
      active = [];
    };

    const frame = () => {
      animationFrame = requestAnimationFrame(frame);
      const current = settingsRef.current;
      const now = video.currentTime;
      context.clearRect(0, 0, width, height);
      if (!current.enabled || !Number.isFinite(now)) return;

      if (Math.abs(now - previousVideoTime) > 1.5) {
        seekIndex(now);
      } else if (!video.paused) {
        while (
          itemIndex < items.length &&
          items[itemIndex].progressMs / 1000 <= now + 0.03
        ) {
          const index = itemIndex;
          const item = items[itemIndex++];
          if (
            !shouldDisplayDanmaku(
              index,
              current.density,
              current.modes,
              item.mode
            )
          ) {
            continue;
          }
          const fontSize = Math.max(
            12,
            Math.min(44, item.size * current.fontScale)
          );
          context.font = `${current.fontWeight} ${fontSize}px "Noto Sans SC Variable", "Segoe UI", sans-serif`;
          const textWidth = context.measureText(item.text).width;
          const laneCount = danmakuLaneCount(height, current.area);
          const lane = findDanmakuLane(
            active,
            item.mode,
            laneCount,
            now,
            width
          );
          if (lane < 0) continue;
          const y = danmakuLaneY(item.mode, lane, laneCount, height, fontSize);
          active.push({
            item,
            lane,
            y,
            width: textWidth,
            startedAt: now,
            duration:
              (item.mode === 1 ? 8 : 4.5) / Math.max(0.5, current.speed),
            fontSize,
          });
        }
      }

      if (!video.paused) {
        active = active.filter((item) => now - item.startedAt < item.duration);
      }
      previousVideoTime = now;

      for (const item of active) {
        const elapsed = Math.max(0, now - item.startedAt);
        const progress = Math.min(1, elapsed / item.duration);
        const fade = Math.min(1, (1 - progress) * 5);
        const x =
          item.item.mode === 1
            ? width - progress * (width + item.width + 24)
            : (width - item.width) / 2;
        context.save();
        context.globalAlpha = current.opacity * fade;
        context.font = `${current.fontWeight} ${item.fontSize}px "Noto Sans SC Variable", "Segoe UI", sans-serif`;
        context.textBaseline = "middle";
        context.lineJoin = "round";
        if (current.outlineWidth > 0) {
          context.lineWidth = current.outlineWidth;
          context.strokeStyle = "rgba(0, 0, 0, 0.72)";
          context.strokeText(item.item.text, x, item.y);
        }
        context.fillStyle = danmakuColor(item.item.color);
        context.fillText(item.item.text, x, item.y);
        context.restore();
      }
    };

    seekIndex(video.currentTime);
    animationFrame = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      context.clearRect(0, 0, width, height);
    };
  }, [items, videoRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="danmaku-canvas"
      className="pointer-events-none absolute inset-0 z-10 size-full"
    />
  );
}
