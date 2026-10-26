import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SpacePage from "@/features/space/SpacePage";
import { fetchSpaceProfile, fetchSpaceVideos } from "@/lib/bili";
import { createSpaceProfile, createSpaceVideoPage } from "@/test/fixtures/bili";
import { renderWithProviders } from "@/test/render";

vi.mock("@/lib/bili", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/bili")>("@/lib/bili");
  return {
    ...actual,
    fetchSpaceProfile: vi.fn(),
    fetchSpaceVideos: vi.fn(),
  };
});

const fetchSpaceProfileMock = vi.mocked(fetchSpaceProfile);
const fetchSpaceVideosMock = vi.mocked(fetchSpaceVideos);

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/space/:mid" element={<SpacePage />} />
    </Routes>,
    { route: "/space/42" }
  );
}

beforeEach(() => {
  fetchSpaceProfileMock.mockResolvedValue(createSpaceProfile());
  fetchSpaceVideosMock.mockResolvedValue(createSpaceVideoPage());
});

describe("SpacePage", () => {
  it("renders a loading state while the profile is pending", () => {
    fetchSpaceProfileMock.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByTestId("space-loading")).toBeInTheDocument();
  });

  it("renders an actionable profile error", async () => {
    fetchSpaceProfileMock.mockRejectedValue({
      code: "network_error",
      message: "offline",
    });

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Space.error.title"
    );
    expect(screen.getByText("network_error")).toBeVisible();
    expect(screen.getByRole("button", { name: "Space.retry" })).toBeVisible();
  });

  it("renders an empty video state", async () => {
    fetchSpaceVideosMock.mockResolvedValue(createSpaceVideoPage([]));

    renderPage();

    expect(await screen.findByText("Space.empty.title")).toBeVisible();
  });

  it("renders profile details and public videos", async () => {
    renderPage();

    expect(await screen.findByText("测试签名")).toBeVisible();
    expect(screen.getByText("历史视频")).toBeVisible();
    expect(screen.getByText("UID 42")).toBeVisible();
  });
});
