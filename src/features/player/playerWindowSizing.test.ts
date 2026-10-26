import { describe, expect, it } from "vitest";

import { calculatePlayerWindowSize } from "@/features/player/playerWindowSizing";

describe("player window sizing", () => {
  it("uses the video's native logical dimensions when they fit", () => {
    expect(
      calculatePlayerWindowSize(
        { width: 1920, height: 1080, rotate: 0 },
        { width: 3840, height: 2160 },
        2
      )
    ).toEqual({ width: 960, height: 572 });
  });

  it("fits the video inside the monitor work area", () => {
    expect(
      calculatePlayerWindowSize(
        { width: 1920, height: 1080, rotate: 0 },
        { width: 1920, height: 1040 },
        1
      )
    ).toEqual({ width: 1735, height: 1008 });
  });

  it("accounts for rotated video", () => {
    expect(
      calculatePlayerWindowSize(
        { width: 1920, height: 1080, rotate: 90 },
        { width: 1920, height: 1040 },
        1
      )
    ).toEqual({ width: 549, height: 1008 });
  });

  it("ignores invalid video dimensions", () => {
    expect(
      calculatePlayerWindowSize(
        { width: 0, height: 1080, rotate: 0 },
        { width: 1920, height: 1040 },
        1
      )
    ).toBeNull();
  });
});
