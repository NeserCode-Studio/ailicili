import { invoke } from "@tauri-apps/api/core";

export type DanmakuMode = "scroll" | "bottom" | "top";

export interface DanmakuItem {
  id: string;
  text: string;
  timeMs: number;
  mode: DanmakuMode;
  fontSize: number;
  color: number;
}

export interface DanmakuSegment {
  cid: number;
  segmentIndex: number;
  items: DanmakuItem[];
  ended: boolean;
  skippedCount: number;
}

export interface LiveDanmakuConnection {
  roomId: string;
  token: string;
  uid: number;
  buvid: string;
  websocketUrl: string;
  protocolVersion: number;
}

export interface LiveEmoticon {
  token: string;
  id: string;
  url: string;
  width: number;
  height: number;
  animated: boolean;
}

export interface LiveEmoticonCatalog {
  roomId: string;
  emoticons: LiveEmoticon[];
  skippedCount: number;
}

export async function getVideoDanmakuSegment(
  aid: number,
  cid: number,
  segmentIndex: number
): Promise<DanmakuSegment> {
  return invoke("get_video_danmaku_segment", {
    aid,
    cid,
    segmentIndex,
  });
}

export async function getLiveDanmakuConnection(
  roomId: string
): Promise<LiveDanmakuConnection> {
  return invoke("get_live_danmaku_connection", { roomId });
}

export async function getLiveEmoticonCatalog(
  roomId: string
): Promise<LiveEmoticonCatalog> {
  return invoke("get_live_emoticon_catalog", { roomId });
}
