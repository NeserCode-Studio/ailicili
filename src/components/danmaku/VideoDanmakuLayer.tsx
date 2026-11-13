import { useMemo } from "react";

import { usePlayer } from "@videojs/react/video";

import { DanmakuCanvas } from "@/components/danmaku/DanmakuCanvas";
import { useVideoDanmaku } from "@/hooks/useVideoDanmaku";
import { createVideoDanmakuClockSource } from "@/lib/danmaku/media-clock";
import type { DanmakuRenderStyle } from "@/lib/danmaku/types";

interface VideoDanmakuLayerProps {
  aid: number | null;
  cid: number;
  videoId: string;
  accountRevision: number;
  enabled: boolean;
  playing: boolean;
  playbackRate: number;
  seeking: boolean;
  visible: boolean;
  settings: Partial<DanmakuRenderStyle>;
}

export function VideoDanmakuLayer({
  aid,
  cid,
  videoId,
  accountRevision,
  enabled,
  playing,
  playbackRate,
  seeking,
  visible,
  settings,
}: VideoDanmakuLayerProps) {
  const videoStore = usePlayer();
  const mediaTimeSeconds = usePlayer((state) =>
    Math.max(
      0,
      Math.floor(
        typeof state.currentTime === "number" &&
          Number.isFinite(state.currentTime)
          ? state.currentTime
          : 0
      )
    )
  );
  const mediaClock = useMemo(
    () => createVideoDanmakuClockSource(videoStore),
    [videoStore]
  );
  const danmaku = useVideoDanmaku({
    aid,
    cid,
    videoId,
    accountRevision,
    mediaTimeSeconds,
    enabled,
  });

  return (
    <DanmakuCanvas
      items={danmaku.items}
      mediaClock={mediaClock}
      playing={playing}
      playbackRate={playbackRate}
      seeking={seeking}
      visible={visible && danmaku.visible}
      settings={settings}
      onError={danmaku.onRenderError}
    />
  );
}
