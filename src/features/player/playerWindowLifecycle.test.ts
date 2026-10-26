import { describe, expect, it, vi } from "vitest";
import type { CloseRequestedEvent, Window } from "@tauri-apps/api/window";

import {
  hidePlayerWindow,
  registerPlayerWindowCloseHandler,
} from "@/features/player/playerWindowLifecycle";

describe("player window lifecycle", () => {
  it("pauses every video before hiding the player window", async () => {
    const videoHost = document.createElement("div");
    const videos = [
      document.createElement("video"),
      document.createElement("video"),
    ];
    videoHost.append(...videos);

    const pauses = videos.map((video) =>
      vi.spyOn(video, "pause").mockImplementation(() => {})
    );
    const hide = vi.fn(async () => {});

    await hidePlayerWindow({ hide }, videoHost);

    pauses.forEach((pause) => expect(pause).toHaveBeenCalledOnce());
    expect(hide).toHaveBeenCalledOnce();
  });

  it("prevents a close request and hides the window", async () => {
    const video = document.createElement("video");
    const videoHost = document.createElement("div");
    videoHost.append(video);
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {});
    const hide = vi.fn(async () => {});
    const stopListening = vi.fn();
    let closeHandler:
      ((event: CloseRequestedEvent) => void | Promise<void>) | undefined;
    const playerWindow = {
      hide,
      onCloseRequested: vi.fn(
        (handler: (event: CloseRequestedEvent) => void | Promise<void>) => {
          closeHandler = handler;
          return Promise.resolve(stopListening);
        }
      ),
    } as unknown as Pick<Window, "hide" | "onCloseRequested">;

    await registerPlayerWindowCloseHandler(playerWindow, videoHost);

    const preventDefault = vi.fn();
    await closeHandler?.({ preventDefault } as unknown as CloseRequestedEvent);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledOnce();
  });
});
