import { describe, expect, it } from "vitest";

import {
  formatCompactCount,
  formatDuration,
  formatPublishedAt,
} from "@/lib/format";

describe("formatDuration", () => {
  it("formats minute and hour durations", () => {
    expect(formatDuration(125)).toBe("02:05");
    expect(formatDuration(3_661)).toBe("01:01:01");
  });

  it("clamps invalid negative values", () => {
    expect(formatDuration(-5)).toBe("00:00");
  });
});

describe("formatCompactCount", () => {
  it("uses Chinese compact units", () => {
    expect(formatCompactCount(12_345, "zh-CN")).toBe("1.2万");
    expect(formatCompactCount(125_000_000, "zh-CN")).toBe("1.3亿");
  });

  it("uses English compact units", () => {
    expect(formatCompactCount(1_500, "en-US")).toBe("1.5K");
    expect(formatCompactCount(2_400_000, "en-US")).toBe("2.4M");
  });
});

describe("formatPublishedAt", () => {
  it("uses a relative label for recent videos", () => {
    const now = new Date("2026-01-02T12:00:00Z").getTime();
    const published = new Date("2026-01-02T09:00:00Z").getTime() / 1000;

    expect(formatPublishedAt(published, "zh-CN", now)).toBe("3小时前");
    expect(formatPublishedAt(published, "en-US", now)).toBe("3 hours ago");
  });
});
