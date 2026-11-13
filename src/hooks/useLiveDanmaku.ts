import { useCallback, useEffect, useRef, useState } from "react";

import { asCommandError } from "@/api/account";
import {
  getLiveDanmakuConnection,
  getLiveEmoticonCatalog,
} from "@/api/danmaku";
import {
  BilibiliLiveDanmakuClient,
  type LiveDanmakuClientError,
  type LiveDanmakuStatus,
} from "@/lib/danmaku/live-client";
import { LiveDanmakuClock } from "@/lib/danmaku/live-clock";
import {
  normalizeDanmakuEmote,
  type DanmakuEmote,
  type DanmakuRenderItem,
} from "@/lib/danmaku/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("Danmaku/Live");
const FLUSH_INTERVAL_MS = 100;
const PENDING_QUEUE_LIMIT = 2_000;
const ACTIVE_ITEM_LIMIT = 1_200;
const ACTIVE_RETENTION_MS = 10_000;

interface UseLiveDanmakuOptions {
  roomId: string;
  enabled: boolean;
  playing: boolean;
  accountRevision: number;
  emoticonCatalogEnabled: boolean;
}

interface LiveDanmakuState {
  items: DanmakuRenderItem[];
  clockMs: number;
  status: LiveDanmakuStatus;
  errorCode: string | null;
  renderFailed: boolean;
}

function initialState(): LiveDanmakuState {
  return {
    items: [],
    clockMs: typeof performance === "undefined" ? 0 : performance.now(),
    status: "idle",
    errorCode: null,
    renderFailed: false,
  };
}

function websocketHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid";
  }
}

export function useLiveDanmaku({
  roomId,
  enabled,
  playing,
  accountRevision,
  emoticonCatalogEnabled,
}: UseLiveDanmakuOptions) {
  const clientRef = useRef<BilibiliLiveDanmakuClient | null>(null);
  const clockRef = useRef<LiveDanmakuClock | null>(null);
  const pendingRef = useRef<DanmakuRenderItem[]>([]);
  const activeRef = useRef<DanmakuRenderItem[]>([]);
  const receivedBatchesRef = useRef(0);
  const receivedItemsRef = useRef(0);
  const [state, setState] = useState(initialState);

  const handleRenderError = useCallback(
    (error: unknown) => {
      clientRef.current?.stop();
      pendingRef.current = [];
      activeRef.current = [];
      setState((current) => ({
        ...current,
        items: [],
        status: "incompatible",
        renderFailed: true,
      }));
      log.error("canvas render failed", {
        roomId,
        message: error instanceof Error ? error.message : String(error),
      });
    },
    [roomId]
  );

  useEffect(() => {
    pendingRef.current = [];
    activeRef.current = [];
    if (!enabled) {
      clientRef.current?.stop();
      clientRef.current = null;
      clockRef.current = null;
      setState(initialState());
      return;
    }

    let cancelled = false;
    const clock = new LiveDanmakuClock();
    clockRef.current = clock;
    receivedBatchesRef.current = 0;
    receivedItemsRef.current = 0;
    const pending = pendingRef.current;
    setState({
      ...initialState(),
      clockMs: clock.now(),
      status: "connecting",
    });

    const client = new BilibiliLiveDanmakuClient({
      loadConnection: async () => {
        const connection = await getLiveDanmakuConnection(roomId);
        log.debug("live danmaku connection loaded", {
          roomId,
          host: websocketHost(connection.websocketUrl),
          uidPresent: connection.uid > 0,
          accountRevision,
        });
        return connection;
      },
      loadEmoticons: async (canonicalRoomId) => {
        const emotes = new Map<string, DanmakuEmote>();
        if (!emoticonCatalogEnabled) return emotes;

        try {
          const catalog = await getLiveEmoticonCatalog(canonicalRoomId);
          for (const item of catalog.emoticons) {
            if (!/^\[[^\]\r\n]{1,62}\]$/u.test(item.token)) continue;
            const emote = normalizeDanmakuEmote({
              id: item.id,
              url: item.url,
              width: item.width,
              height: item.height,
              label: item.token,
              animated: item.animated,
            });
            if (emote) emotes.set(item.token, emote);
          }
          log.debug("live emoticon catalog loaded", {
            roomId: canonicalRoomId,
            count: emotes.size,
            skippedCount: catalog.skippedCount,
            accountRevision,
          });
        } catch (error) {
          const commandError = asCommandError(error);
          log.warn("live emoticon catalog unavailable", {
            roomId: canonicalRoomId,
            code: commandError.code,
            accountRevision,
          });
          throw error;
        }
        return emotes;
      },
      onItems: (items) => {
        if (cancelled) return;
        receivedBatchesRef.current += 1;
        receivedItemsRef.current += items.length;
        if (receivedBatchesRef.current === 1) {
          log.info("live danmaku first batch received", {
            roomId,
            count: items.length,
            total: receivedItemsRef.current,
          });
        }
        if (clock.isPaused()) {
          log.debug("live danmaku paused; batch not queued", {
            roomId,
            count: items.length,
          });
          return;
        }
        pending.push(
          ...items.map((item) => ({
            ...item,
            timeMs: clock.toPlaybackTime(item.timeMs),
          }))
        );
        const overflow = pending.length - PENDING_QUEUE_LIMIT;
        if (overflow > 0) pending.splice(0, overflow);
      },
      onStatus: (event) => {
        if (cancelled) return;
        if (event.status === "reconnecting") pending.splice(0);
        log.debug("live danmaku status", {
          roomId,
          status: event.status,
          attempt: event.attempt,
          delayMs: event.delayMs,
          receivedItems: receivedItemsRef.current,
        });
        setState((current) => ({
          ...current,
          status: event.status,
          errorCode: event.status === "connected" ? null : current.errorCode,
        }));
      },
      onError: (error: LiveDanmakuClientError) => {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          errorCode: error.code,
        }));
        log.warn("live danmaku unavailable", {
          roomId,
          code: error.code,
          recoverable: error.recoverable,
          closeCode: error.closeCode,
          closeReason: error.closeReason,
        });
      },
    });
    clientRef.current = client;

    const flush = () => {
      if (cancelled || pending.length === 0) return;
      const now = clock.now();
      const merged = [...activeRef.current, ...pending].filter(
        (item) => item.timeMs >= now - ACTIVE_RETENTION_MS
      );
      pending.splice(0);
      const nextItems = merged.slice(-ACTIVE_ITEM_LIMIT);
      activeRef.current = nextItems;
      setState((current) => ({
        ...current,
        items: nextItems,
        clockMs: now,
      }));
    };
    const flushTimer = window.setInterval(flush, FLUSH_INTERVAL_MS);
    void client.start();

    return () => {
      cancelled = true;
      window.clearInterval(flushTimer);
      client.stop();
      if (clientRef.current === client) clientRef.current = null;
      if (clockRef.current === clock) clockRef.current = null;
      pendingRef.current = [];
      activeRef.current = [];
    };
  }, [accountRevision, emoticonCatalogEnabled, enabled, roomId]);

  useEffect(() => {
    const clock = clockRef.current;
    if (!clock) return;
    if (playing) {
      clock.resume();
    } else {
      clock.pause();
    }
  }, [playing]);

  return {
    items: state.items,
    clockMs: state.clockMs,
    status: state.status,
    errorCode: state.errorCode,
    visible:
      enabled &&
      !state.renderFailed &&
      state.status !== "incompatible" &&
      state.status !== "idle",
    onRenderError: handleRenderError,
  };
}
