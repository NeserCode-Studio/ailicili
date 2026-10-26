import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import AppRoutes from "@/app/AppRoutes";
import { I18nContext } from "@/contexts/i18n";

vi.mock("@/features/discovery/DiscoveryPage", () => ({
  default: () => <div>discover-route</div>,
}));
vi.mock("@/features/video/VideoDetailPage", () => ({
  default: () => <div>video-route</div>,
}));
vi.mock("@/features/pgc/PgcCatalogPage", () => ({
  default: () => <div>pgc-catalog-route</div>,
}));
vi.mock("@/features/pgc/PgcSeasonPage", () => ({
  default: () => <div>pgc-season-route</div>,
}));
vi.mock("@/features/player/PlayerWindowPage", () => ({
  default: () => <div>player-route</div>,
}));
vi.mock("@/features/auth/LoginPage", () => ({
  default: () => <div>login-route</div>,
}));
vi.mock("@/features/search/SearchPage", () => ({
  default: () => <div>search-route</div>,
}));
vi.mock("@/features/library/LibraryPage", () => ({
  default: () => <div>library-route</div>,
}));
vi.mock("@/features/dynamics/DynamicFeedPage", () => ({
  default: () => <div>dynamics-route</div>,
}));
vi.mock("@/features/space/SpacePage", () => ({
  default: () => <div>space-route</div>,
}));
vi.mock("@/views/Framework", () => ({
  default: () => <div>framework-route</div>,
}));

function renderRoute(path: string) {
  return render(
    <I18nContext.Provider
      value={{
        lang: "zh-CN",
        setLang: () => {},
        t: (key) => key,
      }}
    >
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </I18nContext.Provider>
  );
}

describe("AppRoutes", () => {
  it.each([
    ["/", "discover-route"],
    ["/video/BV1xx411c7mD", "video-route"],
    ["/pgc", "pgc-catalog-route"],
    ["/pgc/47836?ep=826497", "pgc-season-route"],
    ["/player/BV1xx411c7mD/2001", "player-route"],
    ["/search?q=rust&type=video", "search-route"],
    ["/library", "library-route"],
    ["/dynamics", "dynamics-route"],
    ["/space/42", "space-route"],
    ["/login", "login-route"],
    ["/framework", "framework-route"],
  ])("renders %s", async (path, text) => {
    renderRoute(path);
    expect(await screen.findByText(text)).toBeVisible();
  });

  it("renders a not-found route", async () => {
    renderRoute("/missing");
    expect(await screen.findByText("Route.notFound.title")).toBeVisible();
  });
});
