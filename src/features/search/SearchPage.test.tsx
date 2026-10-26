import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  MemoryRouter,
  useLocation,
} from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nContext } from "@/contexts/i18n";
import SearchPage from "@/features/search/SearchPage";
import {
  fetchSearchSuggestions,
  searchBili,
} from "@/lib/bili";
import { createSearchPage } from "@/test/fixtures/bili";

vi.mock("@/lib/bili", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/bili")>("@/lib/bili");
  return {
    ...actual,
    fetchSearchSuggestions: vi.fn(),
    searchBili: vi.fn(),
  };
});

const searchBiliMock = vi.mocked(searchBili);
const fetchSearchSuggestionsMock = vi.mocked(fetchSearchSuggestions);

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderPage(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
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
        <MemoryRouter initialEntries={[path]}>
          <SearchPage />
          <LocationProbe />
        </MemoryRouter>
      </I18nContext.Provider>
    </QueryClientProvider>
  );
}

describe("SearchPage", () => {
  beforeEach(() => {
    localStorage.clear();
    searchBiliMock.mockReset();
    fetchSearchSuggestionsMock.mockReset();
  });

  it("restores query, type, and page from the URL", async () => {
    searchBiliMock.mockResolvedValue(createSearchPage());

    renderPage("/search?q=rust&type=video&page=2");

    expect(await screen.findByText("Rust 搜索视频")).toBeVisible();
    expect(searchBiliMock).toHaveBeenCalledWith("rust", "video", 2);
  });

  it("renders loading, empty, and risk-control states", async () => {
    searchBiliMock.mockReturnValueOnce(new Promise(() => {}));
    const loading = renderPage("/search?q=rust&type=video");
    expect(screen.getByTestId("search-loading")).toBeInTheDocument();
    loading.unmount();

    searchBiliMock.mockResolvedValueOnce(createSearchPage([]));
    const empty = renderPage("/search?q=missing&type=video");
    expect(await screen.findByText("Search.empty.title")).toBeVisible();
    empty.unmount();

    searchBiliMock.mockRejectedValueOnce({
      code: "risk_control",
      message: "HTTP 412",
    });
    renderPage("/search?q=blocked&type=video");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Search.error.title"
    );
    expect(screen.getByRole("link", { name: "Search.error.signIn" })).toHaveAttribute(
      "href",
      "/login"
    );
  });

  it("writes type changes back to the URL", async () => {
    searchBiliMock.mockResolvedValue(createSearchPage());
    renderPage("/search?q=rust&type=video&page=2");
    await screen.findByText("Rust 搜索视频");

    const userTab = screen.getByRole("tab", { name: "Search.type.user" });
    fireEvent.mouseDown(userTab, { button: 0 });
    fireEvent.mouseUp(userTab, { button: 0 });
    fireEvent.click(userTab);

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "?q=rust&type=user"
    );
    expect(searchBiliMock).toHaveBeenCalledWith("rust", "user", 1);
  });
});
