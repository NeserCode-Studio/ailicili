import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PageTitlebarProvider from "@/components/framework/PageTitlebarProvider";
import LivePlayerPage from "@/features/live/LivePlayerPage";
import {
  PLAYER_WINDOW_HIDDEN_EVENT,
  PLAYER_WINDOW_REOPENED_EVENT,
} from "@/features/player/playerWindowLifecycle";
import {
  createLivePlaybackSession,
  fetchLiveRoom,
} from "@/lib/bili";
import {
  createLivePlaybackSession as createLivePlaybackSessionFixture,
  createLiveRoomDetail,
  createLiveRoomSummary,
} from "@/test/fixtures/bili";
import { renderWithProviders } from "@/test/render";

vi.mock("@/lib/bili", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bili")>();
  return {
    ...actual,
    createLivePlaybackSession: vi.fn(),
    fetchLiveRoom: vi.fn(),
  };
});

vi.mock("@/features/live/LivePlayer", () => ({
  default: (props: {
    onRequestQuality: (
      quality: { id: number; label: string },
      wasPlaying: boolean
    ) => void;
  }) => (
    <div data-testid="mock-live-player">
      <button
        type="button"
        onClick={() =>
          props.onRequestQuality({ id: 400, label: "蓝光" }, true)
        }
      >
        switch-quality
      </button>
    </div>
  ),
}));

vi.mock("@/features/live/LiveChatPanel", () => ({
  default: () => <div data-testid="mock-live-chat" />,
}));

const fetchLiveRoomMock = vi.mocked(fetchLiveRoom);
const createLivePlaybackSessionMock = vi.mocked(createLivePlaybackSession);

function renderPage() {
  return renderWithProviders(
    <PageTitlebarProvider>
      <Routes>
        <Route path="/player/live/:roomId" element={<LivePlayerPage />} />
      </Routes>
    </PageTitlebarProvider>,
    { route: "/player/live/123" }
  );
}

describe("LivePlayerPage", () => {
  beforeEach(() => {
    fetchLiveRoomMock.mockReset();
    createLivePlaybackSessionMock.mockReset();
    fetchLiveRoomMock.mockResolvedValue(createLiveRoomDetail());
    createLivePlaybackSessionMock.mockResolvedValue(
      createLivePlaybackSessionFixture()
    );
  });

  it("requests a new Rust playback session when quality changes", async () => {
    createLivePlaybackSessionMock
      .mockResolvedValueOnce(createLivePlaybackSessionFixture())
      .mockResolvedValueOnce(
        createLivePlaybackSessionFixture({
          sessionId: "live-session-400",
          selectedQuality: 400,
          playbackUrl:
            "https://bilistream.localhost/live/live-session-400/index.m3u8",
        })
      );

    renderPage();

    expect(await screen.findByTestId("mock-live-player")).toBeVisible();
    expect(createLivePlaybackSessionMock).toHaveBeenCalledWith(123, 10_000);

    fireEvent.click(screen.getByRole("button", { name: "switch-quality" }));

    expect(await screen.findByTestId("live-quality-switching")).toBeVisible();
    await waitFor(() =>
      expect(createLivePlaybackSessionMock).toHaveBeenCalledWith(123, 400)
    );
  });

  it("removes the live player when hidden and reloads the session on reopen", async () => {
    renderPage();
    expect(await screen.findByTestId("mock-live-player")).toBeVisible();

    act(() => {
      window.dispatchEvent(new Event(PLAYER_WINDOW_HIDDEN_EVENT));
    });
    await waitFor(() =>
      expect(screen.queryByTestId("mock-live-player")).not.toBeInTheDocument()
    );

    act(() => {
      window.dispatchEvent(new Event(PLAYER_WINDOW_REOPENED_EVENT));
    });

    await waitFor(() =>
      expect(createLivePlaybackSessionMock).toHaveBeenCalledTimes(2)
    );
    expect(await screen.findByTestId("mock-live-player")).toBeVisible();
  });

  it("shows an explicit offline state without requesting a stream", async () => {
    fetchLiveRoomMock.mockResolvedValue(
      createLiveRoomDetail({
        room: createLiveRoomSummary({
          liveStatus: 4,
          title: "未开播直播间",
        }),
      })
    );

    renderPage();

    expect(await screen.findByText("Live.player.offline")).toBeVisible();
    expect(screen.getByText("未开播直播间")).toBeVisible();
    expect(createLivePlaybackSessionMock).not.toHaveBeenCalled();
  });
});
