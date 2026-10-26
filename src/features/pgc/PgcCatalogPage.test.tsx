import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PgcCatalogPage from "@/features/pgc/PgcCatalogPage";
import { fetchPgcIndex, fetchPgcTimeline } from "@/lib/bili";
import { createPgcIndexPage, createPgcTimeline } from "@/test/fixtures/bili";
import { renderWithProviders } from "@/test/render";

vi.mock("@/lib/bili", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/bili")>("@/lib/bili");
  return {
    ...actual,
    fetchPgcIndex: vi.fn(),
    fetchPgcTimeline: vi.fn(),
  };
});

const fetchPgcIndexMock = vi.mocked(fetchPgcIndex);
const fetchPgcTimelineMock = vi.mocked(fetchPgcTimeline);

describe("PgcCatalogPage", () => {
  beforeEach(() => {
    fetchPgcIndexMock.mockReset();
    fetchPgcTimelineMock.mockReset();
  });

  it("loads the release schedule and switches to the catalog", async () => {
    fetchPgcTimelineMock.mockResolvedValue(createPgcTimeline());
    fetchPgcIndexMock.mockResolvedValue(createPgcIndexPage());
    renderWithProviders(<PgcCatalogPage />, { route: "/pgc" });

    expect(await screen.findAllByText("鬼灭之刃 柱训练篇")).not.toHaveLength(0);
    expect(fetchPgcTimelineMock).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole("radio", { name: "Pgc.view.index" }));

    expect(await screen.findByText("1770.4万追番")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "鬼灭之刃 柱训练篇" })
    ).toBeVisible();
    expect(fetchPgcIndexMock).toHaveBeenCalledWith(1, 1, 18, null, null);
  });

  it("restores catalog filters and pagination from the URL", async () => {
    fetchPgcIndexMock.mockResolvedValue(createPgcIndexPage());
    renderWithProviders(<PgcCatalogPage />, {
      route: "/pgc?type=2&view=index&page=2&year=2024&status=finished",
    });

    expect(
      await screen.findByRole("link", { name: "鬼灭之刃 柱训练篇" })
    ).toBeVisible();
    expect(fetchPgcIndexMock).toHaveBeenCalledWith(2, 2, 18, 2024, true);
    expect(screen.getByText("Pgc.index.page:2")).toBeVisible();
  });

  it("uses the catalog directly for types without a release schedule", async () => {
    fetchPgcIndexMock.mockResolvedValue(createPgcIndexPage());
    renderWithProviders(<PgcCatalogPage />, { route: "/pgc?type=2" });

    expect(
      await screen.findByRole("link", { name: "鬼灭之刃 柱训练篇" })
    ).toBeVisible();
    expect(fetchPgcIndexMock).toHaveBeenCalledWith(2, 1, 18, null, null);
    expect(fetchPgcTimelineMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("radio", { name: "Pgc.view.timeline" })
    ).not.toBeInTheDocument();
  });

  it("renders an explicit empty state", async () => {
    fetchPgcTimelineMock.mockResolvedValue({ latest: [], days: [] });
    renderWithProviders(<PgcCatalogPage />, { route: "/pgc" });

    expect(await screen.findByText("Pgc.empty.title")).toBeVisible();
  });
});
