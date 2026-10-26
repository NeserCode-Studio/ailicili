import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PageTitlebarProvider from "@/components/framework/PageTitlebarProvider";
import { I18nContext } from "@/contexts/i18n";
import { usePageTitlebar } from "@/contexts/pageTitlebar";
import PlayerWindowPage from "@/features/player/PlayerWindowPage";
import {
  createPlaybackSession,
  fetchDanmaku,
  fetchResumePoint,
  fetchVideoDetail,
  openPlayerWindow,
} from "@/lib/bili";
import { createVideoSummary } from "@/test/fixtures/bili";

const dashPlayerMock = vi.hoisted(() => ({
  destroy: vi.fn(),
  initialize: vi.fn(),
  on: vi.fn(),
  setRepresentationForTypeById: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("@/lib/bili", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bili")>();
  return {
    ...actual,
    createPlaybackSession: vi.fn(),
    fetchDanmaku: vi.fn(),
    fetchResumePoint: vi.fn(),
    fetchVideoDetail: vi.fn(),
    openPlayerWindow: vi.fn(),
    reportHeartbeat: vi.fn(),
  };
});

vi.mock("dashjs", () => ({
  MediaPlayer: () => ({
    create: () => dashPlayerMock,
  }),
}));

const fetchVideoDetailMock = vi.mocked(fetchVideoDetail);
const createPlaybackSessionMock = vi.mocked(createPlaybackSession);
const fetchDanmakuMock = vi.mocked(fetchDanmaku);
const fetchResumePointMock = vi.mocked(fetchResumePoint);
const openPlayerWindowMock = vi.mocked(openPlayerWindow);

function PlayerTestShell() {
  const { pageTitle, setActionsTarget } = usePageTitlebar();

  return (
    <>
      <span data-testid="titlebar-title">{pageTitle}</span>
      <div data-testid="titlebar-actions" ref={setActionsTarget} />
      <MemoryRouter initialEntries={["/player/BV1xx411c7mD/2001"]}>
        <Routes>
          <Route path="/player/:bvid/:cid" element={<PlayerWindowPage />} />
        </Routes>
      </MemoryRouter>
    </>
  );
}

function renderPlayer() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nContext.Provider
        value={{
          lang: "zh-CN",
          setLang: () => {},
          t: (key) => key,
        }}
      >
        <PageTitlebarProvider>
          <PlayerTestShell />
        </PageTitlebarProvider>
      </I18nContext.Provider>
    </QueryClientProvider>
  );
}

describe("PlayerWindowPage", () => {
  beforeEach(() => {
    localStorage.clear();
    const video = createVideoSummary();
    fetchVideoDetailMock.mockResolvedValue({
      video,
      description: "简介",
      parts: [
        {
          cid: 2001,
          page: 1,
          title: "第一部分",
          durationSeconds: 125,
        },
        {
          cid: 2002,
          page: 2,
          title: "第二部分",
          durationSeconds: 95,
        },
      ],
      dimension: { width: 1920, height: 1080, rotate: 0 },
    });
    createPlaybackSessionMock.mockResolvedValue({
      sessionId: "test-session",
      mpdUrl: "http://bilistream.localhost/mpd/test-session",
      expiresInSeconds: 600,
      durationMs: 125_000,
      selectedQuality: 80,
      qualities: [
        {
          id: 64,
          label: "720P",
          width: 1280,
          height: 720,
          bandwidth: 1_000_000,
        },
        {
          id: 80,
          label: "1080P",
          width: 1920,
          height: 1080,
          bandwidth: 2_000_000,
        },
      ],
    });
    fetchDanmakuMock.mockResolvedValue([]);
    fetchResumePointMock.mockResolvedValue({
      lastPlayTimeSeconds: 0,
      lastPlayCid: 0,
    });
    openPlayerWindowMock.mockResolvedValue();
    dashPlayerMock.setRepresentationForTypeById.mockClear();
  });

  it("renders the player in its dedicated window route", async () => {
    renderPlayer();

    expect(await screen.findByTestId("video-player")).toBeVisible();
    expect(screen.getByTestId("player-window-page")).toHaveClass(
      "overflow-hidden"
    );
    expect(screen.getByTestId("player-stage")).toHaveClass("h-full", "w-full");
    expect(screen.getByTestId("video-player")).toHaveClass("h-auto", "w-full");
    await waitFor(() =>
      expect(screen.getByTestId("titlebar-title")).toHaveTextContent("测试视频")
    );
    expect(
      within(screen.getByTestId("titlebar-actions")).getByRole("button", {
        name: "Video.openOnBilibili",
      })
    ).toBeVisible();

    const controls = screen.getByTestId("player-controls");
    const parts = within(controls).getByTestId("player-parts");
    expect(within(parts).getByRole("button", { name: "P1" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    fireEvent.click(within(parts).getByRole("button", { name: "P2" }));
    await waitFor(() =>
      expect(openPlayerWindowMock).toHaveBeenCalledWith("BV1xx411c7mD", 2002)
    );
    expect(createPlaybackSessionMock).toHaveBeenCalledWith(
      "BV1xx411c7mD",
      2001,
      80
    );
  });

  it("opens grouped playback settings without replacing the player", async () => {
    renderPlayer();

    await screen.findByTestId("video-player");
    fireEvent.click(screen.getByRole("button", { name: "Player.settings" }));

    expect(await screen.findByTestId("player-settings-dialog")).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "Player.settings.group.playback",
      })
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "Player.settings.group.quality",
      })
    ).toBeVisible();
    expect(
      screen.getByText("Player.settings.quality.description")
    ).toBeVisible();

    const autoHide = screen.getByRole("switch", {
      name: "Player.settings.autoHideControls",
    });
    expect(autoHide).toBeChecked();
    fireEvent.click(autoHide);
    await waitFor(() => expect(autoHide).not.toBeChecked());

    const quality = screen.getByRole("combobox", {
      name: "Player.quality",
    });
    fireEvent.change(quality, { target: { value: "80" } });
    await waitFor(() => expect(quality).toHaveValue("80"));
    await waitFor(() =>
      expect(dashPlayerMock.setRepresentationForTypeById).toHaveBeenCalledWith(
        "video",
        "video-80",
        true
      )
    );
    expect(screen.getByTestId("player-settings-dialog")).toBeVisible();

    expect(screen.getByTestId("player-window-page")).toHaveClass(
      "overflow-hidden"
    );
    expect(screen.getByTestId("video-player")).toBeVisible();
  });

  it("changes quality from the player control bar", async () => {
    renderPlayer();

    await screen.findByTestId("video-player");
    fireEvent.click(
      screen.getByRole("button", { name: "Player.quality.current" })
    );
    fireEvent.click(await screen.findByRole("option", { name: "1080P" }));

    await waitFor(() =>
      expect(dashPlayerMock.setRepresentationForTypeById).toHaveBeenCalledWith(
        "video",
        "video-80",
        true
      )
    );
    expect(
      screen.getByRole("button", { name: "Player.quality.current" })
    ).toHaveTextContent("1080P");
  });
});
