import type { PlatformId } from "@/api/media";

export function liveRoomPath(platformId: PlatformId, roomId: string) {
  return `/live/${encodeURIComponent(platformId)}/${encodeURIComponent(roomId)}`;
}
