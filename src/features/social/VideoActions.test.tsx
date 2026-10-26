import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nContext } from "@/contexts/i18n";
import VideoActions from "@/features/social/VideoActions";
import {
  coinVideo,
  fetchAuthStatus,
  fetchFavoriteFolders,
  fetchVideoActions,
  setVideoFavorite,
  tripleVideo,
} from "@/lib/bili";
import type { AuthStatus, VideoDetail } from "@/shared/bili.types";
import { createVideoSummary } from "@/test/fixtures/bili";

vi.mock("@/lib/bili", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/bili")>("@/lib/bili");
  return {
    ...actual,
    coinVideo: vi.fn(),
    fetchAuthStatus: vi.fn(),
    fetchFavoriteFolders: vi.fn(),
    fetchVideoActions: vi.fn(),
    setVideoFavorite: vi.fn(),
    tripleVideo: vi.fn(),
  };
});

const coinVideoMock = vi.mocked(coinVideo);
const fetchAuthStatusMock = vi.mocked(fetchAuthStatus);
const fetchFavoriteFoldersMock = vi.mocked(fetchFavoriteFolders);
const fetchVideoActionsMock = vi.mocked(fetchVideoActions);
const setVideoFavoriteMock = vi.mocked(setVideoFavorite);
const tripleVideoMock = vi.mocked(tripleVideo);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const detail: VideoDetail = {
  video: createVideoSummary({
    stats: {
      views: 10,
      danmaku: 2,
      likes: 0,
      comments: 1,
    },
  }),
  description: "",
  parts: [],
  dimension: null,
};

function renderActions() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
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
        <MemoryRouter>
          <VideoActions detail={detail} />
        </MemoryRouter>
      </I18nContext.Provider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  fetchAuthStatusMock.mockResolvedValue({
    authenticated: true,
  } as AuthStatus);
  fetchVideoActionsMock.mockResolvedValue({
    liked: false,
    coined: 0,
    favorited: false,
    followed: false,
  });
  fetchFavoriteFoldersMock.mockResolvedValue([
    { id: "7", title: "默认收藏夹", mediaCount: 3 },
  ]);
});

describe("VideoActions", () => {
  it("rolls back a coin action when the request fails", async () => {
    const request = deferred<void>();
    coinVideoMock.mockReturnValue(request.promise);
    renderActions();

    const coinButton = await screen.findByRole("button", {
      name: "Actions.coin",
    });
    await waitFor(() => expect(coinButton).toBeEnabled());
    fireEvent.click(coinButton);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "1",
      })
    );

    await waitFor(() =>
      expect(coinButton).toHaveAttribute("aria-pressed", "true")
    );
    request.reject(new Error("offline"));
    expect(
      await screen.findByRole("button", { name: "Actions.coin" })
    ).toBeVisible();
  });

  it("rolls back all optimistic state when a triple action fails", async () => {
    const request = deferred<{
      liked: boolean;
      coined: boolean;
      favorited: boolean;
    }>();
    tripleVideoMock.mockReturnValue(request.promise);
    renderActions();

    const tripleButton = await screen.findByRole("button", {
      name: "Actions.triple",
    });
    await waitFor(() => expect(tripleButton).toBeEnabled());
    fireEvent.click(tripleButton);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Actions.favorite" })
      ).toHaveAttribute("aria-pressed", "true")
    );
    request.reject(new Error("offline"));
    expect(
      await screen.findByRole("button", { name: "Actions.coin" })
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Actions.favorite" })
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("rolls back an optimistic favorite when saving the folder fails", async () => {
    const request = deferred<void>();
    setVideoFavoriteMock.mockReturnValue(request.promise);
    renderActions();

    const favoriteButton = await screen.findByRole("button", {
      name: "Actions.favorite",
    });
    await waitFor(() => expect(favoriteButton).toBeEnabled());
    fireEvent.click(favoriteButton);
    const folderCheckbox = await screen.findByRole("checkbox");
    fireEvent.click(folderCheckbox);
    await waitFor(() =>
      expect(folderCheckbox).toHaveAttribute("aria-checked", "true")
    );

    expect(favoriteButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Actions.saveFolder" }));

    await waitFor(() =>
      expect(favoriteButton).toHaveAttribute("aria-pressed", "true")
    );
    request.reject(new Error("offline"));
    await waitFor(() =>
      expect(favoriteButton).toHaveAttribute("aria-pressed", "false")
    );
    expect(setVideoFavoriteMock).toHaveBeenCalledWith({
      aid: 1,
      addMediaIds: ["7"],
      removeMediaIds: [],
    });
  });
});
