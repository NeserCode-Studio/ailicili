import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { asCommandError } from "@/api/account";
import { getVideoDanmakuSegment, type DanmakuSegment } from "@/api/danmaku";
import {
  DANMAKU_SEGMENT_CACHE_LIMIT,
  DanmakuSegmentLruCache,
  cachedDanmakuSegmentItems,
  danmakuSegmentIndex,
  shouldLoadPreviousDanmakuSegment,
  shouldPrefetchNextDanmakuSegment,
} from "@/lib/danmaku/segment-cache";
import {
  createVideoDanmakuState,
  videoDanmakuReducer,
} from "@/lib/danmaku/video-state";
import { createLogger } from "@/lib/logger";

const log = createLogger("Danmaku/Video");
const DATA_RETRY_DELAY_MS = 5_000;

interface UseVideoDanmakuOptions {
  aid: number | null;
  cid: number;
  videoId: string;
  accountRevision: number;
  mediaTimeSeconds: number;
  enabled: boolean;
}

export function useVideoDanmaku({
  aid,
  cid,
  videoId,
  accountRevision,
  mediaTimeSeconds,
  enabled,
}: UseVideoDanmakuOptions) {
  const cacheRef = useRef(
    new DanmakuSegmentLruCache(DANMAKU_SEGMENT_CACHE_LIMIT)
  );
  const inFlightRef = useRef(new Map<string, Promise<DanmakuSegment>>());
  const contextTokenRef = useRef(0);
  const [state, dispatch] = useReducer(videoDanmakuReducer, undefined, () =>
    createVideoDanmakuState()
  );
  const [retryToken, setRetryToken] = useState(0);
  const { items, loadedSegment, status, renderFailed } = state;

  const mediaTimeMs = Math.max(
    0,
    Number.isFinite(mediaTimeSeconds) ? mediaTimeSeconds * 1_000 : 0
  );
  const segmentIndex = danmakuSegmentIndex(mediaTimeMs);
  const active = enabled && !renderFailed && aid !== null && cid > 0;
  const contextKey = `${videoId}:${aid ?? "none"}:${cid}:${accountRevision}`;
  const prefetchNext = shouldPrefetchNextDanmakuSegment(mediaTimeMs);
  const loadPrevious = shouldLoadPreviousDanmakuSegment(mediaTimeMs);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  const handleRenderError = useCallback(
    (error: unknown) => {
      dispatch({ type: "render-failed" });
      log.error("canvas render failed", {
        videoId,
        cid,
        segmentIndex,
        message: error instanceof Error ? error.message : String(error),
      });
    },
    [cid, segmentIndex, videoId]
  );

  useEffect(() => {
    contextTokenRef.current += 1;
    cacheRef.current.clear();
    inFlightRef.current.clear();
    dispatch({
      type: "reset",
      active: aid !== null && cid > 0,
    });

    return () => {
      contextTokenRef.current += 1;
    };
  }, [accountRevision, aid, cid, contextKey]);

  useEffect(() => {
    if (!active || aid === null) {
      dispatch({ type: "inactive" });
      return;
    }

    const contextToken = contextTokenRef.current;
    const cache = cacheRef.current;
    const inFlight = inFlightRef.current;
    let cancelled = false;
    let retryTimer: number | null = null;

    const isCurrent = () =>
      !cancelled && contextTokenRef.current === contextToken;

    const loadSegment = (requestedIndex: number) => {
      const cached = cache.get(cid, requestedIndex);
      if (cached) return Promise.resolve(cached);

      const key = `${cid}:${requestedIndex}`;
      const pending = inFlight.get(key);
      if (pending) return pending;

      const request = getVideoDanmakuSegment(aid, cid, requestedIndex)
        .then((segment) => {
          if (segment.cid !== cid || segment.segmentIndex !== requestedIndex) {
            throw new Error("Danmaku segment contract mismatch");
          }
          if (contextTokenRef.current === contextToken) {
            cache.set(cid, requestedIndex, segment);
          }
          return segment;
        })
        .finally(() => {
          if (inFlight.get(key) === request) inFlight.delete(key);
        });

      inFlight.set(key, request);
      return request;
    };

    const refreshItems = () => {
      if (!isCurrent()) return;
      dispatch({
        type: "items-refreshed",
        items: cachedDanmakuSegmentItems(cache, cid, segmentIndex),
      });
    };

    const run = async () => {
      const cachedCurrent = cache.get(cid, segmentIndex);

      try {
        const current = cachedCurrent ?? (await loadSegment(segmentIndex));
        if (!isCurrent()) return;

        dispatch({
          type: "current-loaded",
          items: cachedDanmakuSegmentItems(cache, cid, segmentIndex),
          segmentIndex,
        });

        const supportingRequests: Promise<unknown>[] = [];
        if (loadPrevious && segmentIndex > 1) {
          supportingRequests.push(
            loadSegment(segmentIndex - 1)
              .then(() => {
                refreshItems();
              })
              .catch((error: unknown) => {
                dispatch({ type: "segment-failed", role: "supporting" });
                log.warn("previous segment load failed", {
                  videoId,
                  cid,
                  segmentIndex: segmentIndex - 1,
                  code: asCommandError(error).code,
                });
              })
          );
        }

        if (prefetchNext && !current.ended) {
          supportingRequests.push(
            loadSegment(segmentIndex + 1)
              .then(() => {
                refreshItems();
              })
              .catch((error: unknown) => {
                dispatch({ type: "segment-failed", role: "supporting" });
                log.warn("next segment prefetch failed", {
                  videoId,
                  cid,
                  segmentIndex: segmentIndex + 1,
                  code: asCommandError(error).code,
                });
              })
          );
        }

        await Promise.allSettled(supportingRequests);
      } catch (error) {
        if (!isCurrent()) return;
        const normalized = asCommandError(error);
        dispatch({ type: "segment-failed", role: "current" });
        log.error("current segment load failed", {
          videoId,
          cid,
          segmentIndex,
          code: normalized.code,
        });
        retryTimer = window.setTimeout(retry, DATA_RETRY_DELAY_MS);
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [
    accountRevision,
    active,
    aid,
    cid,
    loadPrevious,
    prefetchNext,
    retry,
    retryToken,
    segmentIndex,
    videoId,
  ]);

  return {
    items,
    status,
    segmentIndex,
    visible:
      active &&
      !renderFailed &&
      status === "ready" &&
      loadedSegment === segmentIndex,
    retry,
    onRenderError: handleRenderError,
  };
}
