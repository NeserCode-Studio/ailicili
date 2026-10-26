import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryPage from "@/features/library/LibraryPage";
import {
  clearWatchLater,
  fetchAuthStatus,
  fetchHistory,
  fetchOfflineLibrary,
  fetchWatchLater,
} from "@/lib/bili";
import type {
  AuthStatus,
  OfflineLibraryEntry,
  WatchLaterPage,
} from "@/shared/bili.types";
import { createHistoryPage, createLibraryVideo } from "@/test/fixtures/bili";
import { renderWithProviders } from "@/test/render";

vi.mock("@/lib/bili", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/bili")>("@/lib/bili");
  return {
    ...actual,
    fetchAuthStatus: vi.fn(),
    fetchHistory: vi.fn(),
    fetchOfflineLibrary: vi.fn(),
    fetchWatchLater: vi.fn(),
    clearWatchLater: vi.fn(),
  };
});

const fetchAuthStatusMock = vi.mocked(fetchAuthStatus);
const fetchHistoryMock = vi.mocked(fetchHistory);
const fetchOfflineLibraryMock = vi.mocked(fetchOfflineLibrary);
const fetchWatchLaterMock = vi.mocked(fetchWatchLater);
const clearWatchLaterMock = vi.mocked(clearWatchLater);

function offlineEntry(): OfflineLibraryEntry {
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
    totalBytes: 1024,
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
  };
}

function watchLaterPage(): WatchLaterPage {
  return {
    videos: [createLibraryVideo()],
    count: 3,
  };
}

function renderPage() {
  return renderWithProviders(<LibraryPage />, { route: "/library" });
}

async function selectTab(name: string) {
  const tab = await screen.findByRole("tab", { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
  await waitFor(() => expect(tab).toHaveAttribute("aria-selected", "true"));
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchAuthStatusMock.mockResolvedValue({
    authenticated: true,
  } as AuthStatus);
  fetchHistoryMock.mockResolvedValue(createHistoryPage([]));
  fetchOfflineLibraryMock.mockResolvedValue([]);
  fetchWatchLaterMock.mockResolvedValue(watchLaterPage());
  clearWatchLaterMock.mockResolvedValue();
});

describe("LibraryPage", () => {
  it("renders a loading state while history is pending", async () => {
    fetchHistoryMock.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(await screen.findByTestId("library-loading")).toBeInTheDocument();
  });

  it("renders an actionable error state", async () => {
    fetchHistoryMock.mockRejectedValue({
      code: "network_error",
      message: "offline",
    });

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Library.error.title"
    );
    expect(screen.getByText("network_error")).toBeVisible();
    expect(screen.getByRole("button", { name: "Library.retry" })).toBeVisible();
  });

  it("renders an empty history state", async () => {
    fetchHistoryMock.mockResolvedValue(createHistoryPage([]));

    renderPage();

    expect(await screen.findByText("Library.history.emptyTitle")).toBeVisible();
  });

  it("renders history videos with working links", async () => {
    fetchHistoryMock.mockResolvedValue(createHistoryPage());

    renderPage();

    expect(await screen.findByText("历史视频")).toBeVisible();
    expect(
      screen.getAllByRole("link", { name: "历史视频" })[0]
    ).toHaveAttribute("href", "/video/BV1xx411c7mD");
  });

  it("allows guests to open local offline videos without loading history", async () => {
    fetchAuthStatusMock.mockResolvedValue({
      authenticated: false,
      storageAvailable: true,
      profile: null,
    } satisfies AuthStatus);
    fetchOfflineLibraryMock.mockResolvedValue([offlineEntry()]);

    renderPage();

    expect(
      await screen.findByRole("tab", { name: "Library.offline" })
    ).toBeVisible();
    expect(await screen.findByText("离线测试视频")).toBeVisible();
    expect(fetchHistoryMock).not.toHaveBeenCalled();
  });

  it("shows watch-later count, refreshes, and clears the list", async () => {
    renderPage();

    await selectTab("Library.watchLater");
    expect(await screen.findByText("Library.watchLater.count:3")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Library.refresh" }));
    await waitFor(() => expect(fetchWatchLaterMock).toHaveBeenCalledTimes(2));

    fireEvent.click(
      screen.getByRole("button", { name: "Library.watchLater.clear" })
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Library.watchLater.clear",
      })
    );

    await waitFor(() => expect(clearWatchLaterMock).toHaveBeenCalledTimes(1));
  });
});
