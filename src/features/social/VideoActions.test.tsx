import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nContext } from "@/contexts/i18n";
import VideoActions from "@/features/social/VideoActions";
import {
  addWatchLater,
  coinVideo,
  fetchAuthStatus,
  fetchFavoriteFolders,
  fetchVideoActions,
  followUser,
  likeVideo,
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
    addWatchLater: vi.fn(),
    coinVideo: vi.fn(),
    fetchAuthStatus: vi.fn(),
    fetchFavoriteFolders: vi.fn(),
    fetchVideoActions: vi.fn(),
    followUser: vi.fn(),
    likeVideo: vi.fn(),
    setVideoFavorite: vi.fn(),
    tripleVideo: vi.fn(),
  };
});

const addWatchLaterMock = vi.mocked(addWatchLater);
const coinVideoMock = vi.mocked(coinVideo);
const fetchAuthStatusMock = vi.mocked(fetchAuthStatus);
const fetchFavoriteFoldersMock = vi.mocked(fetchFavoriteFolders);
const fetchVideoActionsMock = vi.mocked(fetchVideoActions);
const followUserMock = vi.mocked(followUser);
const likeVideoMock = vi.mocked(likeVideo);
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

function renderActions(onPlay?: () => void) {
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
          <VideoActions detail={detail} onPlay={onPlay} />
        </MemoryRouter>
      </I18nContext.Provider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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
  addWatchLaterMock.mockResolvedValue();
  followUserMock.mockResolvedValue();
  likeVideoMock.mockResolvedValue();
});

describe("VideoActions", () => {
  it("does not request account action state for guests", async () => {
    fetchAuthStatusMock.mockResolvedValue({
      authenticated: false,
    } as AuthStatus);
    renderActions();

    const likeButton = screen.getByTitle("Actions.like");
    await waitFor(() => expect(likeButton).toBeEnabled());
    expect(fetchVideoActionsMock).not.toHaveBeenCalled();
  });

  it("updates the like state immediately and ignores duplicate clicks while saving", async () => {
    const request = deferred<void>();
    fetchVideoActionsMock.mockRejectedValue(new Error("state unavailable"));
    likeVideoMock.mockReturnValue(request.promise);
    renderActions();

    const likeButton = await screen.findByTitle("Actions.like");
    await waitFor(() => expect(likeButton).toBeEnabled());
    fireEvent.click(likeButton);

    await waitFor(() =>
      expect(likeButton).toHaveAttribute("aria-pressed", "true")
    );
    expect(likeButton).toBeDisabled();
    fireEvent.click(likeButton);
    expect(likeVideoMock).toHaveBeenCalledOnce();
    expect(likeVideoMock).toHaveBeenCalledWith("BV1xx411c7mD", true);

    request.resolve();
    await waitFor(() => expect(likeButton).toBeEnabled());
  });

  it("serializes follow changes and updates state optimistically", async () => {
    const request = deferred<void>();
    followUserMock.mockReturnValue(request.promise);
    renderActions();

    const followButton = await screen.findByRole("button", {
      name: "Actions.follow",
    });
    await waitFor(() => expect(followButton).toBeEnabled());
    fireEvent.click(followButton);
    fireEvent.click(followButton);

    await waitFor(() =>
      expect(followButton).toHaveAttribute("aria-pressed", "true")
    );
    expect(followUserMock).toHaveBeenCalledOnce();
    expect(followUserMock).toHaveBeenCalledWith(2, true);

    request.resolve();
    await waitFor(() => expect(followButton).toBeEnabled());
  });

  it("disables the coin action when the video is already at the limit", async () => {
    fetchVideoActionsMock.mockResolvedValue({
      liked: false,
      coined: 2,
      favorited: false,
      followed: false,
    });
    renderActions();

    const coinButton = await screen.findByTitle("Actions.coinLimit");
    expect(coinButton).toBeDisabled();
  });

  it("limits the coin picker to the remaining allowance", async () => {
    fetchVideoActionsMock.mockResolvedValue({
      liked: false,
      coined: 1,
      favorited: false,
      followed: false,
    });
    renderActions();

    fireEvent.click(await screen.findByRole("button", { name: "×1" }));

    expect(screen.getByRole("button", { name: "2" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "1" })).toBeEnabled();
  });

  it("runs the primary play action from the action row", () => {
    const onPlay = vi.fn();
    renderActions(onPlay);

    fireEvent.click(screen.getByRole("button", { name: "Video.play" }));

    expect(onPlay).toHaveBeenCalledOnce();
  });

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
    fireEvent.click(screen.getByRole("button", { name: "1" }));

    await waitFor(() =>
      expect(coinButton).toHaveAttribute("aria-pressed", "true")
    );
    expect(coinVideoMock).toHaveBeenCalledOnce();
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
    fireEvent.click(tripleButton);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Actions.favorite" })
      ).toHaveAttribute("aria-pressed", "true")
    );
    expect(tripleVideoMock).toHaveBeenCalledOnce();
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
    const saveButton = screen.getByRole("button", {
      name: "Actions.saveFolder",
    });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(favoriteButton).toHaveAttribute("aria-pressed", "true")
    );
    expect(setVideoFavoriteMock).toHaveBeenCalledOnce();
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

  it("submits watch later only once for rapid clicks", async () => {
    const request = deferred<void>();
    addWatchLaterMock.mockReturnValue(request.promise);
    renderActions();

    const watchLaterButton = await screen.findByRole("button", {
      name: "Actions.watchLater",
    });
    await waitFor(() => expect(watchLaterButton).toBeEnabled());
    fireEvent.click(watchLaterButton);
    fireEvent.click(watchLaterButton);

    await waitFor(() => expect(addWatchLaterMock).toHaveBeenCalledOnce());
    request.resolve();
    await waitFor(() => expect(watchLaterButton).toBeEnabled());
  });
});
