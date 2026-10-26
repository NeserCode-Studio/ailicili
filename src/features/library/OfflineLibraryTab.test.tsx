import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OfflineLibraryTab from "@/features/library/OfflineLibraryTab";
import {
  fetchOfflineLibrary,
  removeDownload,
  revealDownload,
} from "@/lib/bili";
import type { OfflineLibraryEntry } from "@/shared/bili.types";
import { renderWithProviders } from "@/test/render";

vi.mock("@/lib/bili", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bili")>();
  return {
    ...actual,
    fetchOfflineLibrary: vi.fn(),
    revealDownload: vi.fn(),
    removeDownload: vi.fn(),
  };
});

const fetchOfflineLibraryMock = vi.mocked(fetchOfflineLibrary);
const revealDownloadMock = vi.mocked(revealDownload);
const removeDownloadMock = vi.mocked(removeDownload);

function offlineEntry(
  overrides: Partial<OfflineLibraryEntry> = {}
): OfflineLibraryEntry {
  return {
    id: "offline-1",
    bvid: "BV1xx411c7mD",
    cid: 10,
    aid: 1,
    title: "离线测试视频",
    partTitle: "第一部分",
    coverUrl: "https://i0.hdslb.com/offline.jpg",
    durationSeconds: 125,
    qualityLabel: "1080P",
    width: 1920,
    height: 1080,
    totalBytes: 96_000_000,
    completedAt: 1_700_000_000_000,
    hasDirectory: true,
    hasMergedMp4: true,
    hasVideoStream: true,
    hasAudioStream: true,
    hasCover: true,
    hasDanmaku: true,
    hasSubtitle: false,
    hasMetadata: true,
    warnings: [],
    ...overrides,
  };
}

function renderTab() {
  return renderWithProviders(<OfflineLibraryTab />, { route: "/library" });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchOfflineLibraryMock.mockResolvedValue([offlineEntry()]);
  revealDownloadMock.mockResolvedValue();
  removeDownloadMock.mockResolvedValue();
});

describe("OfflineLibraryTab", () => {
  it("renders completed metadata and available artifacts", async () => {
    renderTab();

    expect(await screen.findByText("离线测试视频")).toBeVisible();
    expect(screen.getByText("Library.offline.count:1")).toBeVisible();
    expect(screen.getByText("Library.offline.mp4")).toBeVisible();
    expect(screen.getByText("Library.offline.cover")).toBeVisible();
    expect(screen.getByText("Library.offline.danmaku")).toBeVisible();
    expect(screen.getByText("Library.offline.metadata")).toBeVisible();
    expect(
      screen.queryByText("Library.offline.videoStream")
    ).not.toBeInTheDocument();
  });

  it("labels split media streams when FFmpeg did not create an MP4", async () => {
    fetchOfflineLibraryMock.mockResolvedValue([
      offlineEntry({
        hasMergedMp4: false,
        warnings: ["ffmpeg_missing"],
      }),
    ]);

    renderTab();

    expect(
      await screen.findByText("Library.offline.videoStream")
    ).toBeVisible();
    expect(screen.getByText("Library.offline.audioStream")).toBeVisible();
    expect(screen.getByText("Download.warning.ffmpeg_missing")).toBeVisible();
    expect(screen.queryByText("Library.offline.mp4")).not.toBeInTheDocument();
  });

  it("shows an empty state with a link to the download center", async () => {
    fetchOfflineLibraryMock.mockResolvedValue([]);

    renderTab();

    expect(await screen.findByText("Library.offline.emptyTitle")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Library.offline.openDownloads" })
    ).toHaveAttribute("href", "/downloads");
  });

  it("shows a retryable error when local metadata cannot be read", async () => {
    fetchOfflineLibraryMock.mockRejectedValue({
      code: "storage_unavailable",
      message: "download database unavailable",
    });

    renderTab();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Library.offline.errorTitle"
    );
    expect(screen.getByText("storage_unavailable")).toBeVisible();
    expect(screen.getByRole("button", { name: "Library.retry" })).toBeVisible();
  });

  it("reveals and removes download records", async () => {
    renderTab();

    expect(await screen.findByText("离线测试视频")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Library.offline.reveal" })
    );
    await waitFor(() =>
      expect(revealDownloadMock.mock.calls[0]?.[0]).toBe("offline-1")
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Library.offline.remove" })
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Library.offline.remove",
      })
    );
    await waitFor(() =>
      expect(removeDownloadMock.mock.calls[0]?.[0]).toBe("offline-1")
    );
  });
});
