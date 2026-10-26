import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LiveCatalogPage from "@/features/live/LiveCatalogPage";
import {
  fetchLiveAreas,
  fetchLiveRooms,
  openLiveRoomWindow,
} from "@/lib/bili";
import {
  createLiveArea,
  createLiveRoomPage,
  createLiveRoomSummary,
} from "@/test/fixtures/bili";
import { renderWithProviders } from "@/test/render";

vi.mock("@/lib/bili", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bili")>();
  return {
    ...actual,
    fetchLiveAreas: vi.fn(),
    fetchLiveRooms: vi.fn(),
    openLiveRoomWindow: vi.fn(),
  };
});

const fetchLiveAreasMock = vi.mocked(fetchLiveAreas);
const fetchLiveRoomsMock = vi.mocked(fetchLiveRooms);
const openLiveRoomWindowMock = vi.mocked(openLiveRoomWindow);

describe("LiveCatalogPage", () => {
  beforeEach(() => {
    fetchLiveAreasMock.mockReset();
    fetchLiveRoomsMock.mockReset();
    openLiveRoomWindowMock.mockReset();
    fetchLiveAreasMock.mockResolvedValue([createLiveArea()]);
    fetchLiveRoomsMock.mockResolvedValue(createLiveRoomPage());
    openLiveRoomWindowMock.mockResolvedValue();
  });

  it("renders live rooms and opens one in the dedicated player", async () => {
    renderWithProviders(<LiveCatalogPage />, { route: "/live" });

    expect(await screen.findByText("测试直播间")).toBeVisible();
    expect(fetchLiveRoomsMock).toHaveBeenCalledWith(null, null, 1, 24);

    fireEvent.click(screen.getByText("测试直播间"));
    await waitFor(() =>
      expect(openLiveRoomWindowMock).toHaveBeenCalledWith(123)
    );
  });

  it("updates the feed when changing main and child areas", async () => {
    renderWithProviders(<LiveCatalogPage />, { route: "/live" });
    await screen.findByText("测试直播间");

    const parentArea = await screen.findByText("娱乐");
    fireEvent.mouseDown(parentArea, { button: 0 });
    fireEvent.mouseUp(parentArea, { button: 0 });
    fireEvent.click(parentArea);

    await waitFor(() =>
      expect(fetchLiveRoomsMock).toHaveBeenCalledWith("1", null, 1, 24)
    );

    const childArea = await screen.findByText("虚拟主播");
    fireEvent.mouseDown(childArea, { button: 0 });
    fireEvent.mouseUp(childArea, { button: 0 });
    fireEvent.click(childArea);

    await waitFor(() =>
      expect(fetchLiveRoomsMock).toHaveBeenCalledWith("1", "21", 1, 24)
    );
  });

  it("discloses a global recommendation fallback without pretending it is filtered", async () => {
    fetchLiveRoomsMock.mockResolvedValue({
      ...createLiveRoomPage([
        createLiveRoomSummary({ title: "全站推荐直播间" }),
      ]),
      mode: "recommended",
      fallbackReason: "area_feed_unavailable",
    });

    renderWithProviders(<LiveCatalogPage />, {
      route: "/live?area=1&subarea=21",
    });

    expect(
      await screen.findByText("Live.areaFallback.title")
    ).toBeVisible();
    expect(screen.getByText("全站推荐直播间")).toBeVisible();
  });
});
