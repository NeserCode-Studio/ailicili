import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLivePlaybackSession,
  fetchLiveAreas,
  fetchLiveRoom,
  fetchLiveRooms,
  fetchPopularVideos,
  fetchVideoDetail,
  normalizeBiliError,
  openLiveRoomWindow,
  openLastPlayerWindow,
  openPlayerWindow,
  pollLiveChat,
  startLiveChat,
  stopLiveChat,
} from "@/lib/bili";
import {
  createLiveArea,
  createLivePlaybackSession as createLivePlaybackSessionFixture,
  createLiveRoomDetail,
  createLiveRoomPage,
  createPopularPage,
  createVideoSummary,
} from "@/test/fixtures/bili";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const webviewWindowMock = vi.hoisted(() => ({
  getAll: vi.fn(),
  create: vi.fn(),
  once: vi.fn(),
  emitTo: vi.fn(),
  show: vi.fn(),
  setFocus: vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => {
  class WebviewWindow {
    label: string;

    constructor(label: string, options: Record<string, unknown>) {
      this.label = label;
      webviewWindowMock.create(label, options);
    }

    static getAll = webviewWindowMock.getAll;

    once(...args: unknown[]) {
      return webviewWindowMock.once(...args);
    }

    emitTo(...args: unknown[]) {
      return webviewWindowMock.emitTo(...args);
    }

    show(...args: unknown[]) {
      return webviewWindowMock.show(...args);
    }

    setFocus(...args: unknown[]) {
      return webviewWindowMock.setFocus(...args);
    }
  }

  return { WebviewWindow };
});

const invokeMock = vi.mocked(invoke);

describe("Bilibili command contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("passes discovery pagination to the Rust command", async () => {
    const response = createPopularPage();
    invokeMock.mockResolvedValueOnce(response);

    await expect(fetchPopularVideos(2, 12)).resolves.toEqual(response);
    expect(invokeMock).toHaveBeenCalledWith("bili_popular_videos", {
      page: 2,
      pageSize: 12,
    });
  });

  it("passes a BV identifier to the video detail command", async () => {
    const video = createVideoSummary();
    invokeMock.mockResolvedValueOnce({
      video,
      description: "简介",
      parts: [],
      dimension: null,
    });

    await fetchVideoDetail(video.bvid);
    expect(invokeMock).toHaveBeenCalledWith("bili_video_detail", {
      bvid: video.bvid,
    });
  });

  it("passes live filters and playback parameters to Rust commands", async () => {
    const area = createLiveArea();
    const rooms = createLiveRoomPage();
    const room = createLiveRoomDetail();
    const session = createLivePlaybackSessionFixture();
    invokeMock
      .mockResolvedValueOnce([area])
      .mockResolvedValueOnce(rooms)
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(session);

    await expect(fetchLiveAreas()).resolves.toEqual([area]);
    await expect(fetchLiveRooms("1", "21", 3, 12)).resolves.toEqual(rooms);
    await expect(fetchLiveRoom(123)).resolves.toEqual(room);
    await expect(createLivePlaybackSession(123, 400)).resolves.toEqual(
      session
    );

    expect(invokeMock).toHaveBeenNthCalledWith(1, "bili_live_areas");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "bili_live_rooms", {
      parentAreaId: "1",
      areaId: "21",
      page: 3,
      pageSize: 12,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "bili_live_room", {
      roomId: 123,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(
      4,
      "bili_live_playback_session",
      {
        roomId: 123,
        qn: 400,
      }
    );
  });

  it("starts, polls, and stops a live chat session", async () => {
    invokeMock
      .mockResolvedValueOnce({ sessionId: "chat-session" })
      .mockResolvedValueOnce({
        messages: [],
        cursor: 7,
        connected: true,
        error: null,
      })
      .mockResolvedValueOnce(undefined);

    await expect(startLiveChat(123)).resolves.toEqual({
      sessionId: "chat-session",
    });
    await expect(pollLiveChat("chat-session", 4)).resolves.toEqual({
      messages: [],
      cursor: 7,
      connected: true,
      error: null,
    });
    await expect(stopLiveChat("chat-session")).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenNthCalledWith(1, "bili_live_chat_start", {
      roomId: 123,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "bili_live_chat_poll", {
      sessionId: "chat-session",
      after: 4,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "bili_live_chat_stop", {
      sessionId: "chat-session",
    });
  });

  it("creates a dedicated Tauri player window", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    webviewWindowMock.getAll.mockResolvedValueOnce([]);
    webviewWindowMock.once.mockImplementation(
      (event: string, handler: () => void) => {
        if (event === "tauri://created") queueMicrotask(handler);
        return Promise.resolve(() => undefined);
      }
    );

    await openPlayerWindow("BV1xx411c7mD", 2001);

    expect(webviewWindowMock.create).toHaveBeenCalledWith(
      "player",
      expect.objectContaining({
        url: "/player/BV1xx411c7mD/2001",
        title: "Ailicili Player",
      })
    );
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("opens a live room in the fixed dedicated player window", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    webviewWindowMock.getAll.mockResolvedValueOnce([]);
    webviewWindowMock.once.mockImplementation(
      (event: string, handler: () => void) => {
        if (event === "tauri://created") queueMicrotask(handler);
        return Promise.resolve(() => undefined);
      }
    );

    await openLiveRoomWindow(123);

    expect(webviewWindowMock.create).toHaveBeenCalledWith(
      "player",
      expect.objectContaining({
        url: "/player/live/123",
        title: "Ailicili Player",
      })
    );
    expect(
      JSON.parse(
        window.localStorage.getItem("ailicili:last-player-target") ?? "null"
      )
    ).toEqual({ kind: "live", roomId: 123 });
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("navigates and focuses an existing player window", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    const player = {
      label: "player",
      emitTo: webviewWindowMock.emitTo,
      show: webviewWindowMock.show,
      setFocus: webviewWindowMock.setFocus,
    };
    webviewWindowMock.getAll.mockResolvedValueOnce([player]);

    await openPlayerWindow("BV1xx411c7mD", 2002);

    expect(webviewWindowMock.emitTo).toHaveBeenCalledWith(
      "player",
      "player-navigate",
      "/player/BV1xx411c7mD/2002"
    );
    expect(webviewWindowMock.show).toHaveBeenCalledOnce();
    expect(webviewWindowMock.setFocus).toHaveBeenCalledOnce();
    expect(webviewWindowMock.create).not.toHaveBeenCalled();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("focuses an existing player window from the launcher", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    const player = {
      label: "player",
      show: webviewWindowMock.show,
      setFocus: webviewWindowMock.setFocus,
    };
    webviewWindowMock.getAll.mockResolvedValueOnce([player]);

    await expect(openLastPlayerWindow()).resolves.toBe(true);

    expect(webviewWindowMock.show).toHaveBeenCalledOnce();
    expect(webviewWindowMock.setFocus).toHaveBeenCalledOnce();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("restores the most recent player target from the launcher", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    window.localStorage.setItem(
      "ailicili:last-player-target",
      JSON.stringify({ bvid: "BV1xx411c7mD", cid: 2002 })
    );
    webviewWindowMock.getAll.mockResolvedValue([]);
    webviewWindowMock.once.mockImplementation(
      (event: string, handler: () => void) => {
        if (event === "tauri://created") queueMicrotask(handler);
        return Promise.resolve(() => undefined);
      }
    );

    await expect(openLastPlayerWindow()).resolves.toBe(true);

    expect(webviewWindowMock.create).toHaveBeenCalledWith(
      "player",
      expect.objectContaining({
        url: "/player/BV1xx411c7mD/2002",
      })
    );
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("restores a recent live room from the launcher", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    window.localStorage.setItem(
      "ailicili:last-player-target",
      JSON.stringify({ kind: "live", roomId: 456 })
    );
    webviewWindowMock.getAll.mockResolvedValue([]);
    webviewWindowMock.once.mockImplementation(
      (event: string, handler: () => void) => {
        if (event === "tauri://created") queueMicrotask(handler);
        return Promise.resolve(() => undefined);
      }
    );

    await expect(openLastPlayerWindow()).resolves.toBe(true);

    expect(webviewWindowMock.create).toHaveBeenCalledWith(
      "player",
      expect.objectContaining({
        url: "/player/live/456",
      })
    );
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });
});

describe("normalizeBiliError", () => {
  it("preserves typed command errors", () => {
    expect(
      normalizeBiliError({ code: "risk_control", message: "HTTP 412" })
    ).toEqual({ code: "risk_control", message: "HTTP 412" });
  });

  it("normalizes unexpected errors", () => {
    expect(normalizeBiliError(new Error("offline"))).toEqual({
      code: "unexpected_error",
      message: "offline",
    });
  });
});
