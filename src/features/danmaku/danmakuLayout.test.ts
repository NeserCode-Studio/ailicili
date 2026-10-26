import { describe, expect, it } from "vitest";

import {
  danmakuLaneCount,
  findDanmakuLane,
  shouldDisplayDanmaku,
  type ActiveDanmaku,
} from "@/features/danmaku/danmakuLayout";
import type { DanmakuItem } from "@/shared/bili.types";

function activeItem(overrides: Partial<ActiveDanmaku> = {}): ActiveDanmaku {
  return {
    item: {
      progressMs: 0,
      mode: 1,
      size: 25,
      color: 0xffffff,
      text: "danmaku",
    } satisfies DanmakuItem,
    lane: 0,
    y: 0,
    width: 120,
    startedAt: 0,
    duration: 8,
    fontSize: 25,
    ...overrides,
  };
}

describe("danmaku layout", () => {
  it("keeps a rolling comment in its lane until it clears the entry edge", () => {
    const active = [activeItem()];

    expect(findDanmakuLane(active, 1, 2, 0.5, 1_000)).toBe(1);
    expect(findDanmakuLane(active, 1, 2, 7.7, 1_000)).toBe(0);
  });

  it("does not allocate a second fixed comment in an occupied lane", () => {
    const active = [
      activeItem({
        item: {
          progressMs: 0,
          mode: 5,
          size: 25,
          color: 0xffffff,
          text: "top",
        },
      }),
    ];

    expect(findDanmakuLane(active, 5, 2, 2, 1_000)).toBe(1);
    expect(findDanmakuLane(active, 5, 2, 9, 1_000)).toBe(0);
  });

  it("applies density sampling and mode filters", () => {
    expect(shouldDisplayDanmaku(9, 10, [1, 4, 5], 1)).toBe(true);
    expect(shouldDisplayDanmaku(10, 10, [1, 4, 5], 1)).toBe(false);
    expect(shouldDisplayDanmaku(1, 100, [1, 5], 4)).toBe(false);
  });

  it("bounds the display area to a useful lane count", () => {
    expect(danmakuLaneCount(720, 0.55)).toBe(13);
    expect(danmakuLaneCount(10, 0.2)).toBe(1);
    expect(danmakuLaneCount(2_000, 1)).toBe(16);
  });

  it("handles high-density bursts without exceeding the lane budget", () => {
    const active = Array.from({ length: 16 }, (_, lane) =>
      activeItem({
        lane,
        item: {
          progressMs: 0,
          mode: 5,
          size: 25,
          color: 0xffffff,
          text: `top-${lane}`,
        },
      })
    );

    let allocated = 0;
    for (let index = 0; index < 10_000; index += 1) {
      if (findDanmakuLane(active, 5, 16, 1, 1_000) >= 0) {
        allocated += 1;
      }
    }
    let visible = 0;
    for (let index = 0; index < 100_000; index += 1) {
      if (shouldDisplayDanmaku(index, 17, [1, 4, 5], 1)) visible += 1;
    }

    expect(allocated).toBe(0);
    expect(visible).toBe(17_000);
  });
});
