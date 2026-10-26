import { useRef } from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DanmakuCanvas, {
  type DanmakuSettings,
} from "@/features/danmaku/DanmakuCanvas";

const settings: DanmakuSettings = {
  enabled: true,
  opacity: 0.9,
  fontScale: 1,
  area: 0.55,
  speed: 1,
  modes: [1, 4, 5],
  density: 100,
  outlineWidth: 2,
  fontWeight: 600,
};

function Harness() {
  const videoRef = useRef<HTMLVideoElement>(null);
  return (
    <>
      <video ref={videoRef} />
      <DanmakuCanvas videoRef={videoRef} items={[]} settings={settings} />
    </>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DanmakuCanvas", () => {
  it("stops its animation loop and observer on teardown", async () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    class ResizeObserverMock {
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    const clearRect = vi.fn();
    const context = {
      clearRect,
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 100 })),
      restore: vi.fn(),
      save: vi.fn(),
      setTransform: vi.fn(),
      strokeText: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context
    );

    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 17)
    );
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

    const { unmount } = render(<Harness />);
    await waitFor(() => expect(observe).toHaveBeenCalledOnce());

    unmount();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(clearRect).toHaveBeenCalled();
  });
});
