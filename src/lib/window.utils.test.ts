import { describe, expect, it, vi } from "vitest";

import { WindowUtils } from "@/lib/window.utils";

const windowApiMock = vi.hoisted(() => ({
  getAllWindows: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getAllWindows: windowApiMock.getAllWindows,
  getCurrentWindow: () => ({ label: "main" }),
  Window: class {},
}));

describe("WindowUtils", () => {
  it("destroys windows when quitting instead of requesting close", async () => {
    const close = vi.fn(async () => {});
    const destroy = vi.fn(async () => {});
    windowApiMock.getAllWindows.mockResolvedValueOnce([
      { close, destroy, label: "main" },
      { close, destroy, label: "player" },
    ]);

    await WindowUtils.windowsQuit();

    expect(destroy).toHaveBeenCalledTimes(2);
    expect(close).not.toHaveBeenCalled();
  });
});
