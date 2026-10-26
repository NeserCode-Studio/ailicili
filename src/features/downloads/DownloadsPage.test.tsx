import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DownloadsPage from "@/features/downloads/DownloadsPage";
import { pauseDownload } from "@/lib/bili";
import type { DownloadSnapshot, DownloadTask } from "@/shared/bili.types";
import { renderWithProviders } from "@/test/render";

vi.mock("@/features/downloads/useDownloads", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/downloads/useDownloads")>();
  return {
    ...actual,
    useDownloadSnapshot: vi.fn(),
  };
});

vi.mock("@/lib/bili", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bili")>();
  return {
    ...actual,
    pauseDownload: vi.fn(),
    resumeDownload: vi.fn(),
    retryDownload: vi.fn(),
    cancelDownload: vi.fn(),
    removeDownload: vi.fn(),
    revealDownload: vi.fn(),
  };
});

import { useDownloadSnapshot } from "@/features/downloads/useDownloads";

const useDownloadSnapshotMock = vi.mocked(useDownloadSnapshot);
const pauseDownloadMock = vi.mocked(pauseDownload);

function task(
  overrides: Partial<DownloadTask> = {}
): DownloadTask {
  return {
    id: "123e4567-e89b-12d3-a456-426614174000",
    bvid: "BV1xx411c7mD",
    cid: 10,
    aid: 7,
    title: "测试视频",
    partTitle: "第一部分",
    coverUrl: "https://i0.hdslb.com/cover.jpg",
    durationSeconds: 120,
    qualityId: 80,
    qualityLabel: "1080P",
    width: 1920,
    height: 1080,
    status: "downloading",
    phase: "video",
    progressPercent: 35,
    downloadedBytes: 1024,
    totalBytes: 4096,
    speedBytesPerSecond: 512,
    etaSeconds: 8,
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
    ...overrides,
  };
}

function snapshot(tasks: DownloadTask[]): DownloadSnapshot {
  return {
    tasks,
    activeCount: tasks.filter(
      (value) =>
        value.status === "downloading" || value.status === "muxing"
    ).length,
    queuedCount: tasks.filter((value) => value.status === "queued").length,
    completedCount: tasks.filter((value) => value.status === "completed")
      .length,
  };
}

function mockSnapshot(data: DownloadSnapshot) {
  useDownloadSnapshotMock.mockReturnValue({
    data,
    error: null,
    isPending: false,
    isFetching: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useDownloadSnapshot>);
}

describe("DownloadsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pauseDownloadMock.mockResolvedValue(task({ status: "paused" }));
  });

  it("renders grouped tasks and pauses an active download", async () => {
    mockSnapshot(
      snapshot([
        task(),
        task({
          id: "223e4567-e89b-12d3-a456-426614174000",
          title: "已完成视频",
          status: "completed",
          phase: "complete",
          progressPercent: 100,
        }),
      ])
    );

    renderWithProviders(<DownloadsPage />, { route: "/downloads" });

    expect(await screen.findByText("测试视频")).toBeVisible();
    expect(screen.getByText("已完成视频")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Download.action.pause" })
    );
    await waitFor(() =>
      expect(pauseDownloadMock).toHaveBeenCalledWith(
        "123e4567-e89b-12d3-a456-426614174000"
      )
    );
  });

  it("shows an empty state when no records exist", () => {
    mockSnapshot(snapshot([]));
    renderWithProviders(<DownloadsPage />, { route: "/downloads" });

    expect(screen.getByText("Download.empty.title")).toBeVisible();
  });
});
