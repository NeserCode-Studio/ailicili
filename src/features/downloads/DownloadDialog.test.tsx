import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DownloadDialog from "@/features/downloads/DownloadDialog";
import {
  createDownload,
  fetchDownloadOptions,
  fetchDownloadSettings,
} from "@/lib/bili";
import type { DownloadOptions, DownloadSettings } from "@/shared/bili.types";
import { renderWithProviders } from "@/test/render";

vi.mock("@/lib/bili", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bili")>();
  return {
    ...actual,
    createDownload: vi.fn(),
    fetchDownloadOptions: vi.fn(),
    fetchDownloadSettings: vi.fn(),
  };
});

const createDownloadMock = vi.mocked(createDownload);
const fetchDownloadOptionsMock = vi.mocked(fetchDownloadOptions);
const fetchDownloadSettingsMock = vi.mocked(fetchDownloadSettings);

describe("DownloadDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchDownloadOptionsMock.mockResolvedValue({
      defaultQuality: 80,
      qualities: [
        { id: 80, label: "1080P", width: 1920, height: 1080, bandwidth: 1 },
        { id: 64, label: "720P", width: 1280, height: 720, bandwidth: 1 },
      ],
    } as DownloadOptions);
    fetchDownloadSettingsMock.mockResolvedValue({
      rootPath: "C:\\Downloads",
      ffmpegPath: null,
      ffmpegAvailable: false,
      ffmpegVersion: null,
      maxConcurrent: 2,
    } as DownloadSettings);
    createDownloadMock.mockResolvedValue({} as never);
  });

  it("selects a quality and queues a download", async () => {
    renderWithProviders(
      <DownloadDialog
        open
        onOpenChange={() => {}}
        bvid="BV1xx411c7mD"
        cid={10}
        partTitle="第一部分"
      />
    );

    expect(await screen.findByText("1080P")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /720P/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Download.dialog.create" })
    );

    await waitFor(() =>
      expect(createDownloadMock).toHaveBeenCalledWith(
        "BV1xx411c7mD",
        10,
        64
      )
    );
  });
});
