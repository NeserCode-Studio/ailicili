import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { I18nContext } from "@/contexts/i18n";
import CommentSection from "@/features/comments/CommentSection";
import { fetchAuthStatus, fetchComments, postComment } from "@/lib/bili";
import type { AuthStatus, CommentPage } from "@/shared/bili.types";

vi.mock("@/lib/bili", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/bili")>("@/lib/bili");
  return {
    ...actual,
    fetchAuthStatus: vi.fn(),
    fetchComments: vi.fn(),
    postComment: vi.fn(),
  };
});

const fetchAuthStatusMock = vi.mocked(fetchAuthStatus);
const fetchCommentsMock = vi.mocked(fetchComments);
const postCommentMock = vi.mocked(postComment);

function createCommentsPage(): CommentPage {
  return {
    page: 1,
    pageSize: 20,
    total: 1,
    hasMore: false,
    comments: [
      {
        id: "100",
        author: { mid: "1", name: "根评论", avatarUrl: "" },
        message: "顶层评论 [汤圆]",
        emotes: [
          {
            key: "[汤圆]",
            url: "https://i0.hdslb.com/bfs/emote/93609633a9d194cf336687eb19c01dca95bde719.png@64w_64h_1c.webp",
            width: 1,
            height: 1,
          },
        ],
        likes: 3,
        createdAt: 1_700_000_000,
        replyCount: 1,
        replies: [
          {
            id: "101",
            author: { mid: "2", name: "回复用户", avatarUrl: "" },
            message: "已有回复",
            emotes: [],
            likes: 1,
            createdAt: 1_700_000_100,
            replyCount: 0,
            replies: [],
          },
        ],
      },
    ],
  };
}

function createLongCommentPage(): CommentPage {
  return {
    page: 1,
    pageSize: 20,
    total: 20,
    hasMore: false,
    comments: Array.from({ length: 20 }, (_, index) => ({
      id: String(1_000 + index),
      author: { mid: String(index + 1), name: `用户 ${index}`, avatarUrl: "" },
      message: `长评论 ${index} ${"内容".repeat(1_000)}`,
      emotes: [],
      likes: index,
      createdAt: 1_700_000_000 + index,
      replyCount: 3,
      replies: Array.from({ length: 3 }, (_, replyIndex) => ({
        id: String(2_000 + index * 10 + replyIndex),
        author: {
          mid: String(index + 100),
          name: `回复者 ${replyIndex}`,
          avatarUrl: "",
        },
        message: `回复 ${index}-${replyIndex} ${"内容".repeat(1_000)}`,
        emotes: [],
        likes: 0,
        createdAt: 1_700_000_100 + index,
        replyCount: 0,
        replies: [],
      })),
    })),
  };
}

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nContext.Provider
        value={{
          lang: "zh-CN",
          setLang: () => {},
          t: (key, variables) =>
            variables ? `${key}:${Object.values(variables).join(",")}` : key,
        }}
      >
        <MemoryRouter>
          <CommentSection aid={42} totalHint={1} />
        </MemoryRouter>
      </I18nContext.Provider>
    </QueryClientProvider>
  );
}

describe("CommentSection", () => {
  it("loads emotes without sending the app origin as a referrer", async () => {
    fetchAuthStatusMock.mockResolvedValue({
      authenticated: true,
    } as AuthStatus);
    fetchCommentsMock.mockResolvedValue(createCommentsPage());

    renderSection();

    const emote = await screen.findByRole("img", { name: "[汤圆]" });
    expect(emote).toHaveAttribute(
      "src",
      "https://i0.hdslb.com/bfs/emote/93609633a9d194cf336687eb19c01dca95bde719.png@64w_64h_1c.webp"
    );
    expect(emote).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(emote).toHaveAttribute("width", "24");
    expect(emote).toHaveAttribute("height", "24");
  });

  it("posts a nested reply with the top-level root and target parent", async () => {
    fetchAuthStatusMock.mockResolvedValue({
      authenticated: true,
    } as AuthStatus);
    fetchCommentsMock.mockResolvedValue(createCommentsPage());
    postCommentMock.mockResolvedValue("102");

    renderSection();

    const replyButtons = await screen.findAllByRole("button", {
      name: "Comments.reply",
    });
    fireEvent.click(replyButtons[1]);
    const replyInput = screen.getByPlaceholderText("Comments.replyPlaceholder");
    fireEvent.change(replyInput, {
      target: { value: "新回复" },
    });
    const replyForm = replyInput.closest("form");
    expect(replyForm).not.toBeNull();
    fireEvent.click(
      within(replyForm as HTMLFormElement).getByRole("button", {
        name: "Comments.reply",
      })
    );

    await waitFor(() =>
      expect(postCommentMock).toHaveBeenCalledWith({
        aid: 42,
        message: "新回复",
        root: 100,
        parent: 101,
      })
    );
  });

  it("renders an actionable error instead of an empty thread", async () => {
    fetchAuthStatusMock.mockResolvedValue({
      authenticated: true,
    } as AuthStatus);
    fetchCommentsMock.mockRejectedValue({
      code: "network_error",
      message: "offline",
    });

    renderSection();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Comments.loadError.title"
    );
    expect(screen.getByText("network_error")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Comments.retry" })
    ).toBeVisible();
  });

  it("renders a full page of long comments and nested replies", async () => {
    fetchAuthStatusMock.mockResolvedValue({
      authenticated: true,
    } as AuthStatus);
    fetchCommentsMock.mockResolvedValue(createLongCommentPage());

    renderSection();

    const articles = await screen.findAllByRole("article");
    expect(articles).toHaveLength(80);
  });
});
