import type { Window } from "@tauri-apps/api/window";

type HideableWindow = Pick<Window, "hide">;
type CloseAwareWindow = Pick<Window, "hide" | "onCloseRequested">;

export function registerPlayerWindowCloseHandler(
  playerWindow: CloseAwareWindow,
  videoHost: ParentNode = document
) {
  return playerWindow.onCloseRequested(async (event) => {
    event.preventDefault();
    await hidePlayerWindow(playerWindow, videoHost);
  });
}

export async function hidePlayerWindow(
  playerWindow: HideableWindow,
  videoHost: ParentNode = document
): Promise<void> {
  videoHost
    .querySelectorAll<HTMLVideoElement>("video")
    .forEach((video) => video.pause());
  await playerWindow.hide();
}
