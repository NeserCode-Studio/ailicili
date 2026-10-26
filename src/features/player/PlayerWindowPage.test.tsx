import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PageTitlebarProvider from "@/components/framework/PageTitlebarProvider";
import { I18nContext } from "@/contexts/i18n";
import { usePageTitlebar } from "@/contexts/pageTitlebar";
import PlayerWindowPage from "@/features/player/PlayerWindowPage";
import {
  createDefaultPlayerPreferences,
  readPlayerPreferences,
  savePlayerPreferences,
} from "@/features/player/playerPreferences";
import { PLAYER_WINDOW_REOPENED_EVENT } from "@/features/player/playerWindowLifecycle";
import { fitPlayerWindowToVideo } from "@/features/player/playerWindowSizing";
import {
  coinVideo,
  createPlaybackSession,
  fetchAuthStatus,
  fetchDanmaku,
  fetchFavoriteFolders,
  fetchResumePoint,
  fetchVideoDetail,
  fetchVideoActions,
  likeVideo,
  openPlayerWindow,
  setVideoFavorite,
  tripleVideo,
} from "@/lib/bili";
import { createVideoSummary } from "@/test/fixtures/bili";

const dashPlayerMock = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown) => void>();
  return {
    destroy: vi.fn(),
    emit(type: string, event: unknown) {
      handlers.get(type)?.(event);
    },
    getCurrentRepresentationForType: vi.fn(),
    handlers,
    initialize: vi.fn(),
    on: vi.fn((type: string, handler: (event: unknown) => void) => {
      handlers.set(type, handler);
    }),
    setRepresentationForTypeById: vi.fn(),
    updateSettings: vi.fn(),
  };
});

vi.mock("@/lib/bili", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bili")>();
  return {
    ...actual,
    coinVideo: vi.fn(),
    createPlaybackSession: vi.fn(),
    fetchAuthStatus: vi.fn(),
    fetchDanmaku: vi.fn(),
    fetchFavoriteFolders: vi.fn(),
    fetchResumePoint: vi.fn(),
    fetchVideoDetail: vi.fn(),
    fetchVideoActions: vi.fn(),
    likeVideo: vi.fn(),
    openPlayerWindow: vi.fn(),
    reportHeartbeat: vi.fn(),
    setVideoFavorite: vi.fn(),
    tripleVideo: vi.fn(),
  };
});

vi.mock("dashjs", () => ({
  MediaPlayer: () => ({
    create: () => dashPlayerMock,
  }),
}));

vi.mock("@/features/player/playerWindowSizing", () => ({
  fitPlayerWindowToVideo: vi.fn(),
}));

const fetchVideoDetailMock = vi.mocked(fetchVideoDetail);
const createPlaybackSessionMock = vi.mocked(createPlaybackSession);
const coinVideoMock = vi.mocked(coinVideo);
const fetchAuthStatusMock = vi.mocked(fetchAuthStatus);
const fetchDanmakuMock = vi.mocked(fetchDanmaku);
const fetchFavoriteFoldersMock = vi.mocked(fetchFavoriteFolders);
const fetchResumePointMock = vi.mocked(fetchResumePoint);
const fetchVideoActionsMock = vi.mocked(fetchVideoActions);
const likeVideoMock = vi.mocked(likeVideo);
const openPlayerWindowMock = vi.mocked(openPlayerWindow);
const setVideoFavoriteMock = vi.mocked(setVideoFavorite);
const tripleVideoMock = vi.mocked(tripleVideo);
const fitPlayerWindowToVideoMock = vi.mocked(fitPlayerWindowToVideo);

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
    fetchAuthStatusMock.mockResolvedValue({
      authenticated: true,
      storageAvailable: true,
      profile: {
        mid: "42",
        name: "测试用户",
        avatarUrl: "",
        level: 6,
        vipStatus: false,
        vipLabel: null,
      },
    });
    fetchVideoActionsMock.mockResolvedValue({
      liked: false,
      coined: 0,
      favorited: false,
      followed: false,
    });
    fetchFavoriteFoldersMock.mockResolvedValue([
      { id: "7", title: "默认收藏夹", mediaCount: 3 },
    ]);
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
    coinVideoMock.mockResolvedValue();
    likeVideoMock.mockResolvedValue();
    setVideoFavoriteMock.mockResolvedValue();
    tripleVideoMock.mockResolvedValue({
      liked: true,
      coined: true,
      favorited: true,
    });
    vi.clearAllMocks();
    fitPlayerWindowToVideoMock.mockResolvedValue();
    openPlayerWindowMock.mockResolvedValue();
    dashPlayerMock.handlers.clear();
    dashPlayerMock.getCurrentRepresentationForType.mockReturnValue({
      id: "video-64",
    });
    dashPlayerMock.setRepresentationForTypeById.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function showPausedPlayer() {
    const view = renderPlayer();
    const video = (await screen.findByTestId(
      "video-player"
    )) as HTMLVideoElement;
    const play = vi.spyOn(video, "play").mockResolvedValue();
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => true,
    });
    await waitFor(() =>
      expect(dashPlayerMock.handlers.has("streamInitialized")).toBe(true)
    );
    dashPlayerMock.emit("streamInitialized", {});
    fireEvent.pause(video);
    const panel = await screen.findByTestId("player-paused-panel");
    return {
      ...view,
      panel,
      play,
      root: video.parentElement as HTMLElement,
      video,
    };
  }

  it("renders the player in its dedicated window route", async () => {
    renderPlayer();

    expect(await screen.findByTestId("video-player")).toBeVisible();
    expect(screen.getByTestId("player-window-page")).toHaveClass(
      "overflow-hidden"
    );
    expect(screen.getByTestId("player-stage")).toHaveClass("h-full", "w-full");
    expect(screen.getByTestId("video-player")).toHaveClass("h-auto", "w-full");
    await waitFor(() =>
      expect(fitPlayerWindowToVideoMock).toHaveBeenCalledWith({
        width: 1920,
        height: 1080,
        rotate: 0,
      })
    );
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
    expect(fetchDanmakuMock).toHaveBeenCalledWith(2001, 125);
  });

  it("replaces the paused overlay with video details and social actions", async () => {
    const { panel } = await showPausedPlayer();

    expect(
      within(panel).getByRole("heading", { name: "测试视频" })
    ).toBeVisible();
    expect(within(panel).getByText(/测试 UP 主/)).toBeVisible();
    expect(within(panel).getByText("简介")).toBeVisible();
    expect(
      within(panel).getByRole("button", { name: "Player.resume" })
    ).toBeVisible();
    expect(
      within(panel).getByRole("button", { name: "Actions.like" })
    ).toBeVisible();
    expect(
      within(panel).getByRole("button", { name: "Actions.triple" })
    ).toBeVisible();

    const autoLike = within(panel).getByRole("switch", {
      name: "Player.settings.autoLike",
    });
    expect(autoLike).not.toBeChecked();
    fireEvent.click(autoLike);
    await waitFor(() => expect(readPlayerPreferences().autoLike).toBe(true));
  });

  it("maps Q, W, E, R, and F to player actions", async () => {
    const { root, video } = await showPausedPlayer();
    const controls = screen.getByTestId("player-controls");
    const composer = within(controls).getByPlaceholderText(
      "Danmaku.placeholder"
    );

    fireEvent.keyDown(composer, { key: "q" });
    expect(likeVideoMock).not.toHaveBeenCalled();

    fireEvent.keyDown(root, { key: "q" });
    await waitFor(() =>
      expect(likeVideoMock).toHaveBeenCalledWith("BV1xx411c7mD", true)
    );

    await waitFor(() =>
      expect(
        within(screen.getByTestId("player-paused-panel")).getByRole("button", {
          name: "Actions.coin",
        })
      ).toBeEnabled()
    );
    fireEvent.keyDown(root, { key: "w" });
    await waitFor(() =>
      expect(coinVideoMock).toHaveBeenCalledWith("BV1xx411c7mD", 1, false)
    );

    fireEvent.keyDown(root, { key: "e" });
    await waitFor(() =>
      expect(setVideoFavoriteMock).toHaveBeenCalledWith({
        aid: 1,
        addMediaIds: ["7"],
        removeMediaIds: [],
      })
    );

    const openWindow = vi.spyOn(window, "open").mockReturnValue(null);
    fireEvent.keyDown(root, { key: "r" });
    expect(openWindow).toHaveBeenCalledWith(
      "https://www.bilibili.com/video/BV1xx411c7mD",
      "_blank",
      "noopener,noreferrer"
    );

    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(root, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    fireEvent.keyDown(root, { key: "f" });
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(video).toBeVisible();
  });

  it("auto-likes only after more than 20 seconds of active playback", async () => {
    const preferences = createDefaultPlayerPreferences();
    preferences.autoLike = true;
    savePlayerPreferences(preferences);

    let autoLikeSample: (() => void) | null = null;
    const originalSetInterval = window.setInterval.bind(window);
    vi.stubGlobal(
      "setInterval",
      (handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (timeout === 500 && typeof handler === "function") {
          autoLikeSample = () => handler();
          return 999;
        }
        return originalSetInterval(handler, timeout, ...args);
      }
    );
    renderPlayer();
    const video = (await screen.findByTestId(
      "video-player"
    )) as HTMLVideoElement;
    const play = vi.spyOn(video, "play").mockResolvedValue();
    let paused = false;
    let seeking = false;
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => paused,
    });
    Object.defineProperty(video, "ended", {
      configurable: true,
      get: () => false,
    });
    Object.defineProperty(video, "seeking", {
      configurable: true,
      get: () => seeking,
    });
    Object.defineProperty(video, "readyState", {
      configurable: true,
      get: () => 2,
    });

    await waitFor(() =>
      expect(dashPlayerMock.handlers.has("streamInitialized")).toBe(true)
    );
    dashPlayerMock.emit("streamInitialized", {});
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Actions.like" })).toBeEnabled()
    );

    let playbackNow = 0;
    const performanceNow = vi
      .spyOn(window.performance, "now")
      .mockImplementation(() => playbackNow);
    const runSample = () => {
      act(() => autoLikeSample?.());
    };
    const advanceActivePlayback = (milliseconds: number) => {
      for (let elapsed = 500; elapsed <= milliseconds; elapsed += 500) {
        playbackNow += 500;
        runSample();
      }
    };

    advanceActivePlayback(10_000);
    expect(likeVideoMock).not.toHaveBeenCalled();

    paused = true;
    advanceActivePlayback(10_000);
    paused = false;
    seeking = true;
    advanceActivePlayback(10_000);
    expect(likeVideoMock).not.toHaveBeenCalled();

    seeking = false;
    advanceActivePlayback(12_000);

    await waitFor(() =>
      expect(likeVideoMock).toHaveBeenCalledWith("BV1xx411c7mD", true)
    );
    expect(await screen.findByTestId("auto-like-feedback")).toBeVisible();
    expect(play).toHaveBeenCalled();
    advanceActivePlayback(5_000);
    expect(likeVideoMock).toHaveBeenCalledOnce();

    performanceNow.mockRestore();
  });

  it("refits the window when the hidden player is reopened", async () => {
    renderPlayer();

    await screen.findByTestId("video-player");
    await waitFor(() =>
      expect(fitPlayerWindowToVideoMock).toHaveBeenCalledOnce()
    );
    fitPlayerWindowToVideoMock.mockClear();

    window.dispatchEvent(new Event(PLAYER_WINDOW_REOPENED_EVENT));

    expect(fitPlayerWindowToVideoMock).toHaveBeenCalledOnce();
    expect(fitPlayerWindowToVideoMock).toHaveBeenCalledWith({
      width: 1920,
      height: 1080,
      rotate: 0,
    });
  });

  it("does not resize when automatic window sizing is disabled", async () => {
    const preferences = createDefaultPlayerPreferences();
    preferences.autoFitWindow = false;
    savePlayerPreferences(preferences);

    renderPlayer();

    await screen.findByTestId("video-player");
    window.dispatchEvent(new Event(PLAYER_WINDOW_REOPENED_EVENT));

    expect(fitPlayerWindowToVideoMock).not.toHaveBeenCalled();
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

    const autoFit = screen.getByRole("switch", {
      name: "Player.settings.autoFitWindow",
    });
    expect(autoFit).toBeChecked();
    fireEvent.click(autoFit);
    await waitFor(() =>
      expect(readPlayerPreferences().autoFitWindow).toBe(false)
    );

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
    await waitFor(() =>
      expect(dashPlayerMock.setRepresentationForTypeById).toHaveBeenCalledWith(
        "video",
        "video-80",
        true
      )
    );
    expect(screen.getByTestId("player-quality-switching")).toBeVisible();
    await waitFor(() =>
      expect(
        screen.queryByTestId("player-settings-dialog")
      ).not.toBeInTheDocument()
    );

    dashPlayerMock.emit("qualityChangeRendered", {
      mediaType: "video",
      newRepresentation: { id: "video-80" },
    });
    await waitFor(() =>
      expect(
        screen.queryByTestId("player-quality-switching")
      ).not.toBeInTheDocument()
    );

    expect(screen.getByTestId("player-window-page")).toHaveClass(
      "overflow-hidden"
    );
    expect(screen.getByTestId("video-player")).toBeVisible();
  });

  it("pauses and resumes around a control-bar quality switch", async () => {
    renderPlayer();

    const video = (await screen.findByTestId(
      "video-player"
    )) as HTMLVideoElement;
    let paused = false;
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => paused,
    });
    Object.defineProperty(video, "ended", {
      configurable: true,
      value: false,
    });
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {
      paused = true;
    });
    const play = vi.spyOn(video, "play").mockImplementation(async () => {
      paused = false;
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Player.quality.current" })
    );
    fireEvent.click(await screen.findByRole("option", { name: "1080P" }));

    expect(pause).toHaveBeenCalledOnce();
    expect(screen.getByTestId("player-quality-switching")).toBeVisible();

    await waitFor(() =>
      expect(dashPlayerMock.setRepresentationForTypeById).toHaveBeenCalledWith(
        "video",
        "video-80",
        true
      )
    );

    dashPlayerMock.emit("qualityChangeRendered", {
      mediaType: "video",
      newRepresentation: { id: "video-80" },
    });

    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        screen.queryByTestId("player-quality-switching")
      ).not.toBeInTheDocument()
    );
    expect(
      screen.getByRole("button", { name: "Player.quality.current" })
    ).toHaveTextContent("1080P");
  });

  it("changes speed and toggles danmaku from the control bar", async () => {
    renderPlayer();

    const controls = await screen.findByTestId("player-controls");
    const video = screen.getByTestId("video-player") as HTMLVideoElement;

    fireEvent.click(
      within(controls).getByRole("button", { name: "Player.speed.current" })
    );
    fireEvent.click(await screen.findByRole("option", { name: "1.5x" }));

    await waitFor(() => expect(video.playbackRate).toBe(1.5));
    expect(
      within(controls).getByRole("button", { name: "Player.speed.current" })
    ).toHaveTextContent("1.5x");

    const danmakuToggle = within(controls).getByRole("button", {
      name: "Player.danmaku.hide",
    });
    expect(danmakuToggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(danmakuToggle);

    const showDanmaku = await within(controls).findByRole("button", {
      name: "Player.danmaku.show",
    });
    expect(showDanmaku).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Player.settings" }));
    expect(
      await screen.findByRole("switch", {
        name: "Player.settings.danmakuEnabled",
      })
    ).not.toBeChecked();
  });

  it("places the danmaku input directly in the player controls", async () => {
    renderPlayer();

    const controls = await screen.findByTestId("player-controls");
    expect(
      await within(controls).findByPlaceholderText("Danmaku.placeholder")
    ).toBeVisible();
    expect(
      within(controls).getByRole("button", { name: "Danmaku.style" })
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Player.sendDanmaku" })
    ).not.toBeInTheDocument();
  });
});
