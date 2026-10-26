import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { I18nContext } from "@/contexts/i18n";
import DiscoveryPage from "@/features/discovery/DiscoveryPage";
import { fetchPopularVideos } from "@/lib/bili";
import { createPopularPage } from "@/test/fixtures/bili";

vi.mock("@/lib/bili", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/bili")>("@/lib/bili");
  return {
    ...actual,
    fetchPopularVideos: vi.fn(),
  };
});

const fetchPopularVideosMock = vi.mocked(fetchPopularVideos);

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
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
          <DiscoveryPage />
        </MemoryRouter>
      </I18nContext.Provider>
    </QueryClientProvider>
  );
}

describe("DiscoveryPage", () => {
  it("renders a loading state while the feed is pending", () => {
    fetchPopularVideosMock.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByTestId("discovery-loading")).toBeInTheDocument();
  });

  it("renders an actionable error state", async () => {
    fetchPopularVideosMock.mockRejectedValue({
      code: "network_error",
      message: "offline",
    });

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Discover.error.title"
    );
    expect(screen.getByText("network_error")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Discover.retry" })
    ).toBeVisible();
  });

  it("renders an empty state", async () => {
    fetchPopularVideosMock.mockResolvedValue(createPopularPage([]));

    renderPage();

    expect(await screen.findByText("Discover.empty.title")).toBeVisible();
  });

  it("renders real video summaries and links", async () => {
    const response = createPopularPage();
    fetchPopularVideosMock.mockResolvedValue(response);

    renderPage();

    expect(await screen.findByText("测试视频")).toBeVisible();
    expect(screen.getByText("第二个视频")).toBeVisible();
    expect(screen.getByRole("link", { name: "测试视频" })).toHaveAttribute(
      "href",
      `/video/${response.videos[0].bvid}`
    );
  });
});
