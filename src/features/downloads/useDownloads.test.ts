import { describe, expect, it } from "vitest";

import { mergeDownloadProgress } from "@/features/downloads/useDownloads";
import type { DownloadSnapshot, DownloadTask } from "@/shared/bili.types";

function task(
  id: string,
  status: DownloadTask["status"]
): DownloadTask {
  return {
    id,
    bvid: "BV1xx411c7mD",
    cid: 10,
    aid: 7,
    title: "测试视频",
    partTitle: "",
    coverUrl: "https://i0.hdslb.com/cover.jpg",
    durationSeconds: 120,
    qualityId: 80,
    qualityLabel: "1080P",
    width: 1920,
    height: 1080,
    status,
    phase: "video",
    progressPercent: 20,
    downloadedBytes: 100,
    totalBytes: 500,
    speedBytesPerSecond: 10,
    etaSeconds: 40,
    directoryPath: "C:\\Downloads\\task",
    outputPath: null,
    videoPath: null,
    audioPath: null,
    coverPath: null,
    danmakuPath: null,
    subtitlePath: null,
    metadataPath: null,
    errorCode: null,
    errorMessage: null,
    warnings: [],
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
  };
}

describe("mergeDownloadProgress", () => {
  it("replaces a task and recomputes aggregate counts", () => {
    const snapshot: DownloadSnapshot = {
      tasks: [task("one", "downloading"), task("two", "queued")],
      activeCount: 1,
      queuedCount: 1,
      completedCount: 0,
    };

    const updated = mergeDownloadProgress(snapshot, task("two", "completed"));

    expect(updated.activeCount).toBe(1);
    expect(updated.queuedCount).toBe(0);
    expect(updated.completedCount).toBe(1);
    expect(updated.tasks[0].id).toBe("two");
    expect(updated.tasks).toHaveLength(2);
  });
});
