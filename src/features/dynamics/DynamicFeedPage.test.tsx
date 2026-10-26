import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DynamicFeedPage from "@/features/dynamics/DynamicFeedPage";
import { fetchAuthStatus, fetchDynamicFeed } from "@/lib/bili";
import type { AuthStatus, DynamicPage } from "@/shared/bili.types";
import { createDynamicPage } from "@/test/fixtures/bili";
import { renderWithProviders } from "@/test/render";

vi.mock("@/lib/bili", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/bili")>("@/lib/bili");
  return {
    ...actual,
    fetchAuthStatus: vi.fn(),
    fetchDynamicFeed: vi.fn(),
  };
});

const fetchAuthStatusMock = vi.mocked(fetchAuthStatus);
const fetchDynamicFeedMock = vi.mocked(fetchDynamicFeed);

function renderPage() {
  return renderWithProviders(<DynamicFeedPage />, { route: "/dynamics" });
}

beforeEach(() => {
  fetchAuthStatusMock.mockResolvedValue({
    authenticated: true,
  } as AuthStatus);
});

describe("DynamicFeedPage", () => {
  it("renders a loading state while authentication is pending", () => {
    fetchAuthStatusMock.mockReturnValue(new Promise(() => {}));
    fetchDynamicFeedMock.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByTestId("dynamics-loading")).toBeInTheDocument();
  });

  it("renders an actionable feed error", async () => {
    fetchDynamicFeedMock.mockRejectedValue({
      code: "network_error",
      message: "offline",
    });

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Dynamics.error.title"
    );
    expect(screen.getByText("network_error")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Dynamics.retry" })
    ).toBeVisible();
  });

  it("renders the empty feed state", async () => {
    fetchDynamicFeedMock.mockResolvedValue({
      items: [],
      offset: "",
      updateBaseline: "",
      hasMore: false,
    } satisfies DynamicPage);

    renderPage();

    expect(await screen.findByText("Dynamics.empty.title")).toBeVisible();
  });

  it("renders dynamic content from followed creators", async () => {
    fetchDynamicFeedMock.mockResolvedValue(createDynamicPage());

    renderPage();

    expect(await screen.findByText("新的关注动态")).toBeVisible();
    expect(
      screen.getAllByRole("link", { name: "测试用户" })[0]
    ).toHaveAttribute("href", "/space/42");
  });
});
