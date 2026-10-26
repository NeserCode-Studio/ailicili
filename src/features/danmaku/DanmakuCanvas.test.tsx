import { useRef } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DanmakuCanvas, {
  type DanmakuSettings,
} from "@/features/danmaku/DanmakuCanvas";
import type { DanmakuItem } from "@/shared/bili.types";

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

function Harness({ items = [] }: { items?: DanmakuItem[] }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  return (
    <>
      <video ref={videoRef} />
      <DanmakuCanvas videoRef={videoRef} items={items} settings={settings} />
    </>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  it("shows a count label instead of drawing duplicate comments repeatedly", async () => {
    class ResizeObserverMock {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    const context = {
      clearRect: vi.fn(),
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
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getBoundingClientRect"
    ).mockReturnValue({
      width: 800,
      height: 450,
      top: 0,
      right: 800,
      bottom: 450,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    let frameCallback: FrameRequestCallback | null = null;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frameCallback = callback;
        return 31;
      })
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const items: DanmakuItem[] = [
      {
        progressMs: 1_000,
        mode: 5,
        size: 25,
        color: 0xffffff,
        text: "前方高能",
      },
      {
        progressMs: 1_200,
        mode: 5,
        size: 25,
        color: 0xffffff,
        text: "前方高能",
      },
    ];
    const { container } = render(<Harness items={items} />);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();

    let currentTime = 0;
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
      },
    });
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => false,
    });

    await waitFor(() => expect(frameCallback).not.toBeNull());
    act(() => {
      currentTime = 1.01;
      frameCallback?.(0);
    });
    act(() => {
      currentTime = 1.21;
      frameCallback?.(0);
    });

    expect(await screen.findByText("×2")).toBeVisible();
    expect(screen.getByText("前方高能")).toBeVisible();
    expect(context.fillText).toHaveBeenCalledTimes(2);
  });
});
