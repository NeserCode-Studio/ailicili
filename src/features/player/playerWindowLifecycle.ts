import type { UnlistenFn } from "@tauri-apps/api/event";
import type { Window } from "@tauri-apps/api/window";

export const PLAYER_WINDOW_REOPENED_EVENT = "ailicili:player-window-reopened";

type PlayerWindowLifecycleTarget = Pick<
  Window,
  "hide" | "onCloseRequested" | "onFocusChanged"
>;

export async function registerPlayerWindowLifecycle(
  playerWindow: PlayerWindowLifecycleTarget,
  videoHost: ParentNode = document,
  eventTarget: EventTarget = window
): Promise<UnlistenFn> {
  let resumeOnFocus = false;
  let reopenOnFocus = false;

  const stopListeningForClose = await playerWindow.onCloseRequested(
    async (event) => {
      event.preventDefault();
      resumeOnFocus = pausePlayerVideos(videoHost);
      reopenOnFocus = true;
      await playerWindow.hide();
    }
  );

  let stopListeningForFocus: UnlistenFn;
  try {
    stopListeningForFocus = await playerWindow.onFocusChanged(
      ({ payload: focused }) => {
        if (!focused || !reopenOnFocus) return;
        reopenOnFocus = false;
        eventTarget.dispatchEvent(new Event(PLAYER_WINDOW_REOPENED_EVENT));
        if (!resumeOnFocus) return;
        resumeOnFocus = false;
        void resumePlayerVideos(videoHost);
      }
    );
  } catch (error) {
    stopListeningForClose();
    throw error;
  }

  return () => {
    stopListeningForClose();
    stopListeningForFocus();
  };
}

function pausePlayerVideos(videoHost: ParentNode): boolean {
  let wasPlaying = false;

  videoHost.querySelectorAll<HTMLVideoElement>("video").forEach((video) => {
    wasPlaying ||= !video.paused;
    video.pause();
  });

  return wasPlaying;
}

async function resumePlayerVideos(videoHost: ParentNode): Promise<void> {
  const playAttempts = Array.from(
    videoHost.querySelectorAll<HTMLVideoElement>("video")
  ).map(async (video) => {
    if (!video.paused) return;
    await video.play().catch(() => undefined);
  });

  await Promise.all(playAttempts);
}
