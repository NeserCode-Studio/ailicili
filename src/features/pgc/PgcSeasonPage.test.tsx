import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router";

import PgcSeasonPage from "@/features/pgc/PgcSeasonPage";
import { fetchPgcSeason, openPlayerWindow } from "@/lib/bili";
import { openExternalUrl } from "@/lib/external";
import { createPgcSeasonDetail } from "@/test/fixtures/bili";
import { renderWithProviders } from "@/test/render";

vi.mock("@/lib/bili", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/bili")>("@/lib/bili");
  return {
    ...actual,
    fetchPgcSeason: vi.fn(),
    openPlayerWindow: vi.fn(),
  };
});

vi.mock("@/lib/external", () => ({
  openExternalUrl: vi.fn(),
}));

const fetchPgcSeasonMock = vi.mocked(fetchPgcSeason);
const openPlayerWindowMock = vi.mocked(openPlayerWindow);
const openExternalUrlMock = vi.mocked(openExternalUrl);

function renderSeasonPage(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/pgc/:seasonId" element={<PgcSeasonPage />} />
    </Routes>,
    { route }
  );
}

describe("PgcSeasonPage", () => {
  beforeEach(() => {
    fetchPgcSeasonMock.mockReset();
    openPlayerWindowMock.mockReset();
    openExternalUrlMock.mockReset();
    fetchPgcSeasonMock.mockResolvedValue(createPgcSeasonDetail());
  });

  it("selects an episode from the URL and opens the dedicated player", async () => {
    renderSeasonPage("/pgc/47836?ep=826497");

    const playButton = await screen.findByRole("button", {
      name: "Pgc.season.playEpisode:第1话 为了消灭鬼舞辻无惨",
    });

    fireEvent.click(playButton);
    expect(openPlayerWindowMock).toHaveBeenCalledWith(
      "BV15i421v7FQ",
      1_602_741_036
    );
  });

  it("switches the selected episode without leaving the detail page", async () => {
    renderSeasonPage("/pgc/47836?ep=826498");

    await screen.findByText("第2话 水柱·富冈义勇的痛楚");
    fireEvent.click(
      screen.getByRole("button", { name: /第1话 为了消灭鬼舞辻无惨/ })
    );

    expect(
      await screen.findByRole("button", {
        name: "Pgc.season.playEpisode:第1话 为了消灭鬼舞辻无惨",
      })
    ).toBeVisible();
    expect(screen.queryByText("Pgc.season.membership")).not.toBeInTheDocument();
  });

  it("falls back to Bilibili for member episodes", async () => {
    renderSeasonPage("/pgc/47836?ep=826498");

    expect(await screen.findByText("Pgc.season.membership")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Pgc.season.playEpisode:第2话 水柱·富冈义勇的痛楚",
      })
    );

    expect(openPlayerWindowMock).not.toHaveBeenCalled();
    expect(openExternalUrlMock).toHaveBeenCalledWith(
      "https://www.bilibili.com/bangumi/play/ep826498"
    );
  });

  it("falls back to Bilibili for episodes unavailable in the app", async () => {
    const detail = createPgcSeasonDetail();
    detail.episodes[0] = {
      ...detail.episodes[0],
      playbackAvailable: false,
    };
    fetchPgcSeasonMock.mockResolvedValue(detail);
    renderSeasonPage("/pgc/47836?ep=826497");

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Pgc.season.playEpisode:第1话 为了消灭鬼舞辻无惨",
      })
    );

    expect(openPlayerWindowMock).not.toHaveBeenCalled();
    expect(openExternalUrlMock).toHaveBeenCalledWith(
      "https://www.bilibili.com/bangumi/play/ep826497"
    );
    expect(screen.getByText("Pgc.season.webOnly")).toBeVisible();
  });
});
