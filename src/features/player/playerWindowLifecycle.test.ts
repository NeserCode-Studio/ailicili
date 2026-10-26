import type { CloseRequestedEvent, Window } from "@tauri-apps/api/window";
import { describe, expect, it, vi } from "vitest";

import { registerPlayerWindowLifecycle } from "@/features/player/playerWindowLifecycle";

type CloseHandler = (event: CloseRequestedEvent) => void | Promise<void>;
type FocusHandler = Parameters<Window["onFocusChanged"]>[0];
type FocusEvent = Parameters<FocusHandler>[0];

describe("player window lifecycle", () => {
  it("pauses and resumes playback around hiding and refocusing", async () => {
    const videoHost = document.createElement("div");
    const video = document.createElement("video");
    videoHost.append(video);
    let paused = false;
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => paused,
    });
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {
      paused = true;
    });
    const play = vi.spyOn(video, "play").mockImplementation(async () => {
      paused = false;
    });
    const hide = vi.fn(async () => {});
    const stopListening = vi.fn();
    let closeHandler: CloseHandler | undefined;
    let focusHandler: FocusHandler | undefined;
    const playerWindow = {
      hide,
      onCloseRequested: vi.fn((handler: CloseHandler) => {
        closeHandler = handler;
        return Promise.resolve(stopListening);
      }),
      onFocusChanged: vi.fn((handler: FocusHandler) => {
        focusHandler = handler;
        return Promise.resolve(stopListening);
      }),
    } as unknown as Pick<
      Window,
      "hide" | "onCloseRequested" | "onFocusChanged"
    >;

    const unlisten = await registerPlayerWindowLifecycle(
      playerWindow,
      videoHost
    );

    const preventDefault = vi.fn();
    await closeHandler?.({ preventDefault } as unknown as CloseRequestedEvent);
    focusHandler?.({ payload: true } as FocusEvent);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();

    unlisten();
    expect(stopListening).toHaveBeenCalledTimes(2);
  });

  it("does not resume a video that was already paused", async () => {
    const videoHost = document.createElement("div");
    const video = document.createElement("video");
    videoHost.append(video);
    Object.defineProperty(video, "paused", {
      configurable: true,
      value: true,
    });
    vi.spyOn(video, "pause").mockImplementation(() => {});
    const play = vi.spyOn(video, "play");
    let closeHandler: CloseHandler | undefined;
    let focusHandler: FocusHandler | undefined;
    const playerWindow = {
      hide: vi.fn(async () => {}),
      onCloseRequested: vi.fn((handler: CloseHandler) => {
        closeHandler = handler;
        return Promise.resolve(vi.fn());
      }),
      onFocusChanged: vi.fn((handler: FocusHandler) => {
        focusHandler = handler;
        return Promise.resolve(vi.fn());
      }),
    } as unknown as Pick<
      Window,
      "hide" | "onCloseRequested" | "onFocusChanged"
    >;

    await registerPlayerWindowLifecycle(playerWindow, videoHost);
    await closeHandler?.({
      preventDefault: vi.fn(),
    } as unknown as CloseRequestedEvent);
    focusHandler?.({ payload: true } as FocusEvent);

    expect(play).not.toHaveBeenCalled();
  });
});
