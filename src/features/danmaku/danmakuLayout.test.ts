import { describe, expect, it } from "vitest";

import {
  danmakuLaneCount,
  findDanmakuLane,
  pruneDanmakuRepeats,
  registerDanmakuRepeat,
  shouldDisplayDanmaku,
  visibleDanmakuRepeats,
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

  it("groups repeated comments and expires the count label", () => {
    const item = {
      progressMs: 10_000,
      mode: 1,
      size: 25,
      color: 0xffffff,
      text: "前方高能",
    } satisfies DanmakuItem;
    const first = registerDanmakuRepeat([], item, 10);
    const second = registerDanmakuRepeat(first.groups, item, 11.5);
    const third = registerDanmakuRepeat(second.groups, item, 13);

    expect(first.repeated).toBe(false);
    expect(second.repeated).toBe(true);
    expect(third.groups[0]).toMatchObject({
      count: 3,
      lastSeenAt: 13,
      expiresAt: 16,
    });
    expect(visibleDanmakuRepeats(third.groups, 15.9)).toHaveLength(1);
    expect(visibleDanmakuRepeats(third.groups, 16.1)).toHaveLength(0);
    expect(pruneDanmakuRepeats(third.groups, 16.1)).toHaveLength(0);
  });

  it("starts a new group when the repeat window has elapsed", () => {
    const item = {
      progressMs: 0,
      mode: 1,
      size: 25,
      color: 0xffffff,
      text: "2333",
    } satisfies DanmakuItem;
    const first = registerDanmakuRepeat([], item, 1);
    const later = registerDanmakuRepeat(first.groups, item, 4.1);

    expect(later.repeated).toBe(false);
    expect(later.groups).toHaveLength(2);
    expect(later.groups.map((group) => group.count)).toEqual([1, 1]);
  });
});
