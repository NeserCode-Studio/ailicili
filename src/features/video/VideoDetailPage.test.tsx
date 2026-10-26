import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PageTitlebarProvider from "@/components/framework/PageTitlebarProvider";
import { usePageTitlebar } from "@/contexts/pageTitlebar";
import VideoDetailPage from "@/features/video/VideoDetailPage";
import { fetchVideoDetail, openPlayerWindow } from "@/lib/bili";
import { openExternalUrl } from "@/lib/external";
import { createVideoSummary } from "@/test/fixtures/bili";
import { renderWithProviders } from "@/test/render";

vi.mock("@/lib/bili", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bili")>();
  return {
    ...actual,
    fetchVideoDetail: vi.fn(),
    openPlayerWindow: vi.fn(),
  };
});

vi.mock("@/lib/external", () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock("@/features/comments/CommentSection", () => ({
  default: () => <div data-testid="comment-section" />,
}));

vi.mock("@/features/social/VideoActions", () => ({
  default: ({ onPlay }: { onPlay?: () => void }) => (
    <button type="button" onClick={onPlay}>
      Video.play
    </button>
  ),
}));

const fetchVideoDetailMock = vi.mocked(fetchVideoDetail);
const openExternalUrlMock = vi.mocked(openExternalUrl);
const openPlayerWindowMock = vi.mocked(openPlayerWindow);

function DetailTestShell() {
  const { setActionsTarget } = usePageTitlebar();

  return (
    <>
      <div data-testid="titlebar-actions" ref={setActionsTarget} />
      <Routes>
        <Route path="/video/:bvid" element={<VideoDetailPage />} />
      </Routes>
    </>
  );
}

function renderPage() {
  return renderWithProviders(
    <PageTitlebarProvider>
      <DetailTestShell />
    </PageTitlebarProvider>,
    { route: "/video/BV1xx411c7mD" }
  );
}

describe("VideoDetailPage", () => {
  beforeEach(() => {
    fetchVideoDetailMock.mockResolvedValue({
      video: createVideoSummary(),
      description: "简介",
      parts: [
        {
          cid: 10,
          page: 1,
          title: "第一部分",
          durationSeconds: 125,
        },
        {
          cid: 11,
          page: 2,
          title: "第二部分",
          durationSeconds: 95,
        },
      ],
      dimension: { width: 1920, height: 1080, rotate: 0 },
    });
    openExternalUrlMock.mockResolvedValue();
    openPlayerWindowMock.mockResolvedValue();
  });

  it("uses the cover as a blurred background and moves the external action to the titlebar", async () => {
    renderPage();

    const background = await screen.findByTestId("video-detail-background");
    expect(background).toHaveAttribute("aria-hidden", "true");
    expect(background.firstElementChild).toHaveClass("blur-2xl");
    expect(background.querySelector("img")).toHaveAttribute(
      "src",
      "https://i0.hdslb.com/cover.jpg"
    );
    expect(
      screen.queryByRole("img", { name: "测试视频" })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Video.play" }));
    await waitFor(() =>
      expect(openPlayerWindowMock).toHaveBeenCalledWith("BV1xx411c7mD", 10)
    );

    const titlebarActions = screen.getByTestId("titlebar-actions");
    const titlebarAction = within(titlebarActions).getByRole("button", {
      name: "Video.openOnBilibili",
    });
    expect(titlebarAction).toBeVisible();
    expect(titlebarAction).toHaveTextContent("");
    expect(titlebarAction).toHaveClass("titlebar-op");
    fireEvent.click(titlebarAction);
    await waitFor(() =>
      expect(openExternalUrlMock).toHaveBeenCalledWith(
        "https://www.bilibili.com/video/BV1xx411c7mD"
      )
    );
    expect(
      screen.getAllByRole("button", { name: "Video.openOnBilibili" })
    ).toHaveLength(1);
    expect(titlebarActions).toContainElement(titlebarAction);
  });
});
