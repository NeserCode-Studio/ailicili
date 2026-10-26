import type { DanmakuItem } from "@/shared/bili.types";

export interface ActiveDanmaku {
  item: DanmakuItem;
  lane: number;
  y: number;
  width: number;
  startedAt: number;
  duration: number;
  fontSize: number;
}

export const DANMAKU_LANE_HEIGHT = 30;
export const DANMAKU_MAX_LANES = 16;

export function findDanmakuLane(
  active: ActiveDanmaku[],
  mode: DanmakuItem["mode"],
  laneCount: number,
  now: number,
  canvasWidth: number
) {
  for (let lane = 0; lane < laneCount; lane += 1) {
    const occupied = active.some((item) => {
      if (item.lane !== lane || item.item.mode !== mode) return false;
      if (mode !== 1) return now - item.startedAt < item.duration;
      const elapsed = now - item.startedAt;
      const right =
        canvasWidth - (elapsed / item.duration) * (canvasWidth + item.width);
      return right + item.width > canvasWidth - 16;
    });
    if (!occupied) return lane;
  }
  return -1;
}

export function danmakuLaneCount(height: number, area: number) {
  return Math.max(
    1,
    Math.min(
      DANMAKU_MAX_LANES,
      Math.floor((height * area) / DANMAKU_LANE_HEIGHT)
    )
  );
}

export function danmakuLaneY(
  mode: DanmakuItem["mode"],
  lane: number,
  laneCount: number,
  height: number,
  fontSize: number
) {
  return mode === 4
    ? height - 20 - (lane % laneCount) * DANMAKU_LANE_HEIGHT - fontSize / 2
    : 18 + lane * DANMAKU_LANE_HEIGHT + fontSize / 2;
}

export function shouldDisplayDanmaku(
  index: number,
  density: number,
  modes: DanmakuItem["mode"][],
  mode: DanmakuItem["mode"]
) {
  return index % 100 < density && modes.includes(mode);
}

export function danmakuColor(value: number) {
  return `#${value.toString(16).padStart(6, "0")}`;
}
