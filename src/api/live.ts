import { invoke } from "@tauri-apps/api/core";

import type { Platform, StreamSource } from "@/api/media";

export type LiveStatus = "live" | "offline" | "round" | "unknown";

export interface LiveRoomCard {
  platform: Platform;
  roomId: string;
  title: string;
  anchorName: string;
  coverUrl?: string;
  avatarUrl?: string;
  areaName?: string;
  parentAreaName?: string;
  online: number;
  liveStatus: LiveStatus;
}

export interface LiveSection {
  id: string;
  title: string;
  rooms: LiveRoomCard[];
}

export interface LiveDiscovery {
  sections: LiveSection[];
}

export interface PagedLiveRooms {
  page: number;
  items: LiveRoomCard[];
  hasMore: boolean;
  total: number;
}

export interface LiveRoomInfo {
  platform: Platform;
  roomId: string;
  title: string;
  anchorName: string;
  anchorId?: number;
  coverUrl?: string;
  avatarUrl?: string;
  areaName?: string;
  parentAreaName?: string;
  tags: string[];
  liveStatus: LiveStatus;
  startedAt?: number;
}

export interface LivePlaybackInfo {
  roomId: string;
  liveStatus: LiveStatus;
  streams: StreamSource[];
  currentQuality?: {
    id: number;
    label: string;
  };
  advertisedQualities: Array<{
    id: number;
    label: string;
  }>;
}

export interface LiveMediaStartEvent {
  requestId: string | null;
  status: number;
  statusText: string;
  url: string;
  httpVersion: string;
  headers: Record<string, string>;
}

export interface LiveMediaStream {
  start: LiveMediaStartEvent;
  read(): Promise<ArrayBuffer | null>;
  cancel(): void;
}

export async function getLiveDiscovery(): Promise<LiveDiscovery> {
  return invoke("get_live_discovery");
}

export async function searchLiveRooms(
  keyword: string,
  page = 1
): Promise<PagedLiveRooms> {
  return invoke("search_live_rooms", { keyword, page });
}

export async function getLiveRoomInfo(roomId: string): Promise<LiveRoomInfo> {
  return invoke("get_live_room_info", { roomId });
}

export async function getLiveRoomPlayback(
  roomId: string,
  quality = 10_000
): Promise<LivePlaybackInfo> {
  return invoke("get_live_room_playback", { roomId, quality });
}

export async function openLiveMediaStream(
  url: string,
  headers: Record<string, string>
): Promise<LiveMediaStream> {
  const start = await invoke<LiveMediaStartEvent>("open_live_media_stream", {
    url,
    headers,
  });
  const requestId = start.requestId;
  let closed = false;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
  };

  const closeBackend = () => {
    if (!requestId) return;
    void invoke("close_live_media_stream", { requestId }).catch(() => {});
  };

  return {
    start,
    async read() {
      if (closed || finished) return null;
      if (!requestId) {
        finish();
        return null;
      }
      try {
        const raw = await invoke<ArrayBuffer>("read_live_media_stream", {
          requestId,
        });
        const packet = new Uint8Array(raw);
        if (packet.byteLength === 0) {
          throw new Error("直播媒体分块为空。");
        }
        const marker = packet[packet.byteLength - 1];
        if (marker === 0) {
          finish();
          return null;
        }
        if (marker !== 1) {
          throw new Error("直播媒体分块标识无效。");
        }
        return packet.slice(0, -1).buffer as ArrayBuffer;
      } catch (error) {
        finish();
        throw error;
      }
    },
    cancel() {
      if (closed) return;
      closed = true;
      finish();
      closeBackend();
    },
  };
}
