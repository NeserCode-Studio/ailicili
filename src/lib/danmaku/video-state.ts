import type { DanmakuRenderItem } from "@/lib/danmaku/types";

export type VideoDanmakuStatus = "idle" | "loading" | "ready" | "error";

export interface VideoDanmakuState {
  items: DanmakuRenderItem[];
  loadedSegment: number | null;
  status: VideoDanmakuStatus;
  renderFailed: boolean;
}

export type VideoDanmakuAction =
  | { type: "reset"; active: boolean }
  | { type: "inactive" }
  | {
      type: "current-loaded";
      items: DanmakuRenderItem[];
      segmentIndex: number;
    }
  | { type: "items-refreshed"; items: DanmakuRenderItem[] }
  | { type: "segment-failed"; role: "current" | "supporting" }
  | { type: "render-failed" };

export function createVideoDanmakuState(active = false): VideoDanmakuState {
  return {
    items: [],
    loadedSegment: null,
    status: active ? "loading" : "idle",
    renderFailed: false,
  };
}

export function videoDanmakuReducer(
  state: VideoDanmakuState,
  action: VideoDanmakuAction
): VideoDanmakuState {
  switch (action.type) {
    case "reset":
      return createVideoDanmakuState(action.active);
    case "inactive":
      return {
        ...state,
        items: [],
        loadedSegment: null,
        status: "idle",
      };
    case "current-loaded":
      return {
        ...state,
        items: action.items,
        loadedSegment: action.segmentIndex,
        status: "ready",
      };
    case "items-refreshed":
      return { ...state, items: action.items };
    case "segment-failed":
      if (action.role === "supporting") return state;
      return {
        ...state,
        items: [],
        loadedSegment: null,
        status: "error",
      };
    case "render-failed":
      return { ...state, renderFailed: true };
  }
}
