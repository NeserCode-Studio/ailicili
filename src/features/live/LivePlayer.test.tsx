import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nContext } from "@/contexts/i18n";
import LivePlayer from "@/features/live/LivePlayer";
import {
  createLivePlaybackSession,
  createLiveRoomDetail,
} from "@/test/fixtures/bili";
import type { LivePlaybackSession } from "@/shared/bili.types";

const hlsMock = vi.hoisted(() => {
  class MockHls {
    static Events = {
      ERROR: "error",
      MANIFEST_PARSED: "manifestParsed",
    };

    static ErrorTypes = {
      MEDIA_ERROR: "mediaError",
      NETWORK_ERROR: "networkError",
    };

    static isSupported = () => true;

    handlers = new Map<string, (event: string, data: unknown) => void>();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    startLoad = vi.fn();
    recoverMediaError = vi.fn();
    destroy = vi.fn();

    constructor() {
      instances.push(this);
    }

    on(type: string, handler: (event: string, data: unknown) => void) {
      this.handlers.set(type, handler);
    }

    emit(type: string, data: unknown) {
      this.handlers.get(type)?.(type, data);
    }
  }

  let instances: MockHls[] = [];
  return {
    MockHls,
    get instances() {
      return instances;
    },
    reset() {
      instances = [];
    },
  };
});

vi.mock("hls.js", () => ({
  default: hlsMock.MockHls,
}));

const i18nValue = {
  lang: "zh-CN",
  setLang: () => {},
  t: (key: string) => key,
};

function PlayerHarness({
  session,
  onReady,
  onToggleChat = () => {},
}: {
  session: LivePlaybackSession;
  onReady: () => void;
  onToggleChat?: () => void;
}) {
  return (
    <I18nContext.Provider value={i18nValue}>
      <LivePlayer
        session={session}
        room={createLiveRoomDetail()}
        autoPlay
        chatOpen
        onReady={onReady}
        onReconnect={() => {}}
        onRequestQuality={() => {}}
        onToggleChat={onToggleChat}
      />
    </I18nContext.Provider>
  );
}

describe("LivePlayer", () => {
  beforeEach(() => {
    hlsMock.reset();
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("mounts HLS, retries a network error, and destroys on unmount", async () => {
    const onReady = vi.fn();
    const view = render(
      <PlayerHarness
        session={createLivePlaybackSession()}
        onReady={onReady}
      />
    );

    expect(await screen.findByTestId("live-video")).toBeVisible();
    await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
    const hls = hlsMock.instances[0];
    expect(hls.loadSource).toHaveBeenCalledWith(
      "https://bilistream.localhost/live/live-session/index.m3u8"
    );
    expect(hls.attachMedia).toHaveBeenCalledWith(
      screen.getByTestId("live-video")
    );

    act(() => {
      hls.emit("error", { fatal: true, type: "networkError" });
    });
    expect(hls.startLoad).toHaveBeenCalledOnce();

    act(() => {
      hls.emit("manifestParsed", {});
    });
    expect(onReady).toHaveBeenCalledOnce();

    view.unmount();
    expect(hls.destroy).toHaveBeenCalledOnce();
  });

  it("prefers HLS.js even when the browser reports native HLS support", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("maybe");
    const onReady = vi.fn();
    render(
      <PlayerHarness
        session={createLivePlaybackSession()}
        onReady={onReady}
      />
    );

    const video = (await screen.findByTestId("live-video")) as HTMLVideoElement;
    await waitFor(() => expect(hlsMock.instances).toHaveLength(1));

    expect(video.getAttribute("src")).toBeNull();
    expect(hlsMock.instances[0].loadSource).toHaveBeenCalledOnce();
  });

  it("replaces the HLS instance when the Rust session changes", async () => {
    const first = createLivePlaybackSession();
    const onReady = vi.fn();
    const view = render(<PlayerHarness session={first} onReady={onReady} />);
    await screen.findByTestId("live-video");

    view.rerender(
      <PlayerHarness
        session={createLivePlaybackSession({
          sessionId: "live-session-next",
          selectedQuality: 400,
          playbackUrl:
            "https://bilistream.localhost/live/live-session-next/index.m3u8",
        })}
        onReady={onReady}
      />
    );

    await waitFor(() => expect(hlsMock.instances).toHaveLength(2));
    expect(hlsMock.instances[0].destroy).toHaveBeenCalledOnce();
    expect(hlsMock.instances[1].loadSource).toHaveBeenCalledWith(
      "https://bilistream.localhost/live/live-session-next/index.m3u8"
    );
  });

  it("exposes playback, volume, chat, and fullscreen controls", async () => {
    const onToggleChat = vi.fn();
    render(
      <PlayerHarness
        session={createLivePlaybackSession()}
        onReady={vi.fn()}
        onToggleChat={onToggleChat}
      />
    );

    const video = (await screen.findByTestId("live-video")) as HTMLVideoElement;
    const play = vi
      .spyOn(video, "play")
      .mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Player.play" }));
    expect(play).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Player.mute" }));
    expect((video as HTMLVideoElement).muted).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Live.chat.hide" }));
    expect(onToggleChat).toHaveBeenCalledOnce();

    const root = screen.getByTestId("live-video").parentElement as HTMLElement;
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(root, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    fireEvent.click(screen.getByRole("button", { name: "Player.fullscreen" }));
    expect(requestFullscreen).toHaveBeenCalledOnce();
  });
});
