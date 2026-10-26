import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nContext } from "@/contexts/i18n";
import PlayerWindowPage from "@/features/player/PlayerWindowPage";
import {
  createPlaybackSession,
  fetchDanmaku,
  fetchResumePoint,
  fetchVideoDetail,
} from "@/lib/bili";
import { createVideoSummary } from "@/test/fixtures/bili";

vi.mock("@/lib/bili", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bili")>();
  return {
    ...actual,
    createPlaybackSession: vi.fn(),
    fetchDanmaku: vi.fn(),
    fetchResumePoint: vi.fn(),
    fetchVideoDetail: vi.fn(),
    reportHeartbeat: vi.fn(),
  };
});

vi.mock("dashjs", () => ({
  MediaPlayer: () => ({
    create: () => ({
      destroy: vi.fn(),
      getBitrateInfoListFor: () => [],
      initialize: vi.fn(),
      on: vi.fn(),
      setQualityFor: vi.fn(),
      updateSettings: vi.fn(),
    }),
  }),
}));

const fetchVideoDetailMock = vi.mocked(fetchVideoDetail);
const createPlaybackSessionMock = vi.mocked(createPlaybackSession);
const fetchDanmakuMock = vi.mocked(fetchDanmaku);
const fetchResumePointMock = vi.mocked(fetchResumePoint);

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
        <MemoryRouter initialEntries={["/player/BV1xx411c7mD/2001"]}>
          <Routes>
            <Route path="/player/:bvid/:cid" element={<PlayerWindowPage />} />
          </Routes>
        </MemoryRouter>
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
  });

  it("renders the player in its dedicated window route", async () => {
    renderPlayer();

    expect(await screen.findByTestId("video-player")).toBeVisible();
    expect(screen.getByTestId("player-window-page")).toHaveClass(
      "overflow-hidden"
    );
    expect(screen.getByText("测试视频")).toBeVisible();
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
    expect(screen.getByTestId("player-settings-dialog")).toBeVisible();

    expect(screen.getByTestId("player-window-page")).toHaveClass(
      "overflow-hidden"
    );
    expect(screen.getByTestId("video-player")).toBeVisible();
  });
});
