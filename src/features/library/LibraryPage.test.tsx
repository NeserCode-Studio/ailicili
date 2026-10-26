import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryPage from "@/features/library/LibraryPage";
import { fetchAuthStatus, fetchHistory } from "@/lib/bili";
import type { AuthStatus } from "@/shared/bili.types";
import { createHistoryPage } from "@/test/fixtures/bili";
import { renderWithProviders } from "@/test/render";

vi.mock("@/lib/bili", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/bili")>("@/lib/bili");
  return {
    ...actual,
    fetchAuthStatus: vi.fn(),
    fetchHistory: vi.fn(),
  };
});

const fetchAuthStatusMock = vi.mocked(fetchAuthStatus);
const fetchHistoryMock = vi.mocked(fetchHistory);

function renderPage() {
  return renderWithProviders(<LibraryPage />, { route: "/library" });
}

beforeEach(() => {
  fetchAuthStatusMock.mockResolvedValue({
    authenticated: true,
  } as AuthStatus);
});

describe("LibraryPage", () => {
  it("renders a loading state while history is pending", () => {
    fetchHistoryMock.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByTestId("library-loading")).toBeInTheDocument();
  });

  it("renders an actionable error state", async () => {
    fetchHistoryMock.mockRejectedValue({
      code: "network_error",
      message: "offline",
    });

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Library.error.title"
    );
    expect(screen.getByText("network_error")).toBeVisible();
    expect(screen.getByRole("button", { name: "Library.retry" })).toBeVisible();
  });

  it("renders an empty history state", async () => {
    fetchHistoryMock.mockResolvedValue(createHistoryPage([]));

    renderPage();

    expect(await screen.findByText("Library.history.emptyTitle")).toBeVisible();
  });

  it("renders history videos with working links", async () => {
    fetchHistoryMock.mockResolvedValue(createHistoryPage());

    renderPage();

    expect(await screen.findByText("历史视频")).toBeVisible();
    expect(
      screen.getAllByRole("link", { name: "历史视频" })[0]
    ).toHaveAttribute("href", "/video/BV1xx411c7mD");
  });
});
