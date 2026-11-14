import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveDanmakuCanvasDpr,
  resolveDanmakuResponsiveScale,
} from "../src/lib/danmaku/canvas.ts";
import {
  createVideoDanmakuClockSource,
  DANMAKU_MEDIA_SYNC_INTERVAL_MS,
  quantizeDanmakuMediaTimeMs,
  quantizeDanmakuMediaTimeSeconds,
  resolveDanmakuMediaTimeAction,
  resolveSyncedDanmakuClockMs,
} from "../src/lib/danmaku/media-clock.ts";
import {
  chooseDanmakuLane,
  removeExpiredDanmaku,
  resolveDanmakuDisplayHeight,
  resolveDanmakuEmoteDisplaySize,
  resolveDanmakuLaneHeight,
  resolveDanmakuLaneRange,
  resolveDanmakuScrollDurationMs,
  resolveDanmakuScrollX,
} from "../src/lib/danmaku/layout.ts";
import { PixelLruCache } from "../src/lib/danmaku/pixel-cache.ts";
import {
  DANMAKU_OPACITY_MAX,
  DANMAKU_OPACITY_MIN,
  DANMAKU_SCALE_MAX,
  DANMAKU_SCALE_MIN,
  DEFAULT_DANMAKU_PREFERENCES,
  normalizeDanmakuPreferences,
  resolveDanmakuPreferencesStyle,
} from "../src/lib/danmaku/preferences.ts";
import {
  DANMAKU_SEGMENT_CACHE_LIMIT,
  DanmakuSegmentLruCache,
  cachedDanmakuSegmentItems,
  danmakuSegmentIndex,
  danmakuSegmentOffset,
  mergeDanmakuSegmentItems,
  shouldLoadPreviousDanmakuSegment,
  shouldPrefetchNextDanmakuSegment,
} from "../src/lib/danmaku/segment-cache.ts";
import {
  buildVideoDanmakuShoutSnapshot,
  DANMAKU_SHOUT_HOLD_MS,
  filterDanmakuItemsBySuppressedTexts,
  LiveDanmakuShoutTracker,
  resolveDanmakuShoutCount,
  VideoDanmakuShoutIndex,
} from "../src/lib/danmaku/shout.ts";
import {
  canPreserveActiveDanmakuItems,
  lowerBoundByTime,
  upperBoundByTime,
} from "../src/lib/danmaku/timeline.ts";
import {
  DEFAULT_DANMAKU_STYLE,
  danmakuColorToCss,
  danmakuEmoteKind,
  filterDanmakuItems,
  normalizeDanmakuEmote,
  normalizeDanmakuEmoteUrl,
  normalizeDanmakuItems,
  sanitizeDanmakuText,
} from "../src/lib/danmaku/types.ts";
import {
  resolveDanmakuLayoutStyle,
  resolveDanmakuStyleChange,
} from "../src/lib/danmaku/style-change.ts";
import {
  createVideoDanmakuState,
  videoDanmakuReducer,
} from "../src/lib/danmaku/video-state.ts";

function renderItem(id, timeMs, overrides = {}) {
  return {
    id,
    text: id,
    timeMs,
    mode: "scroll",
    fontSize: 25,
    color: 0xffffff,
    ...overrides,
  };
}

function motionItem(id, mode, lane, startMs, overrides = {}) {
  return {
    id,
    mode,
    width: 160,
    height: 32,
    startMs,
    durationMs: 5_000,
    lane,
    ...overrides,
  };
}

function segment(cid, segmentIndex, items = []) {
  return {
    cid,
    segmentIndex,
    items,
    ended: false,
    skippedCount: 0,
  };
}

test("sanitizes untrusted text without splitting emoji or retaining controls", () => {
  const text = sanitizeDanmakuText("  hello\u0000\nworld 😀  ");

  assert.match(text, /^hello\s+world 😀$/u);
  assert.equal(Array.from(sanitizeDanmakuText("a".repeat(600))).length, 512);
  assert.equal(
    Array.from(sanitizeDanmakuText("😀".repeat(10_000) + "tail")).length,
    512
  );
});

test("normalizes persisted danmaku preferences without invalid values leaking", () => {
  assert.deepEqual(normalizeDanmakuPreferences(null), {
    ...DEFAULT_DANMAKU_PREFERENCES,
  });
  assert.deepEqual(
    normalizeDanmakuPreferences({
      enabled: false,
      opacity: 0,
      scale: 4,
      displayArea: 0,
      speed: 9,
      showScroll: false,
      showFixed: false,
      showColor: false,
      syncPlaybackRate: false,
      scaleWithPlayer: true,
      avoidSubtitles: true,
      fontFamily: "song",
      bold: false,
      strokeType: "projection",
    }),
    {
      enabled: false,
      opacity: DANMAKU_OPACITY_MIN,
      scale: DANMAKU_SCALE_MAX,
      displayArea: 0.25,
      speed: 2,
      showScroll: false,
      showFixed: false,
      showColor: false,
      syncPlaybackRate: false,
      scaleWithPlayer: true,
      avoidSubtitles: true,
      fontFamily: "song",
      bold: false,
      strokeType: "projection",
    }
  );
  assert.deepEqual(
    normalizeDanmakuPreferences({
      enabled: "yes",
      opacity: Number.NaN,
      scale: 0.1,
    }),
    {
      ...DEFAULT_DANMAKU_PREFERENCES,
      opacity: DANMAKU_OPACITY_MAX,
      scale: DANMAKU_SCALE_MIN,
    }
  );
});

test("maps danmaku preferences to render style and playback compensation", () => {
  const synced = resolveDanmakuPreferencesStyle(DEFAULT_DANMAKU_PREFERENCES, 2);
  assert.equal(synced.scrollSpeedPxPerSecond, 220);
  assert.equal(synced.fixedDurationMs, 4_500);
  assert.equal(synced.fontWeight, 700);
  assert.equal(synced.strokeWidth, 1.5);

  const fixedWallClock = resolveDanmakuPreferencesStyle(
    {
      ...DEFAULT_DANMAKU_PREFERENCES,
      syncPlaybackRate: false,
      fontFamily: "song",
      bold: false,
      strokeType: "projection",
      avoidSubtitles: true,
      displayArea: 0.75,
    },
    2
  );
  assert.equal(fixedWallClock.scrollSpeedPxPerSecond, 110);
  assert.equal(fixedWallClock.fixedDurationMs, 9_000);
  assert.equal(fixedWallClock.fontWeight, 400);
  assert.match(fixedWallClock.fontFamily, /SimSun/u);
  assert.equal(fixedWallClock.strokeWidth, 0);
  assert.equal(fixedWallClock.shadowOffsetX, 2);
  assert.equal(fixedWallClock.avoidSubtitles, true);
});

test("filters scrolling, fixed, and colored items without mutating input", () => {
  const items = [
    renderItem("scroll-white", 100),
    renderItem("scroll-color", 200, { color: 0xff6699 }),
    renderItem("top-color", 300, { mode: "top", color: 0x66ccff }),
    renderItem("bottom-white", 400, { mode: "bottom" }),
  ];

  assert.strictEqual(
    filterDanmakuItems(items, {
      showScroll: true,
      showFixed: true,
      showColor: true,
    }),
    items
  );
  assert.deepEqual(
    filterDanmakuItems(items, {
      showScroll: true,
      showFixed: false,
      showColor: false,
    }).map((item) => item.id),
    ["scroll-white"]
  );
  assert.deepEqual(
    filterDanmakuItems(items, {
      showScroll: false,
      showFixed: true,
      showColor: true,
    }).map((item) => item.id),
    ["top-color", "bottom-white"]
  );
});

test("normalizes items, deduplicates by id, and clamps visual fields", () => {
  const items = normalizeDanmakuItems([
    renderItem("later", 200, { color: 0x123456 }),
    renderItem("first", 100, { fontSize: 2 }),
    renderItem("first", 300, { text: "duplicate" }),
    renderItem("invalid", -1),
    renderItem("empty", 400, { text: " \n " }),
  ]);

  assert.deepEqual(
    items.map((item) => item.id),
    ["first", "later"]
  );
  assert.equal(items[0].fontSize, 12);
  assert.equal(items[1].color, 0x123456);
  assert.equal(danmakuColorToCss(0x010203), "#010203");
});

test("accepts only HTTPS Bilibili emote images and classifies their source", () => {
  assert.equal(
    normalizeDanmakuEmoteUrl("http://i0.hdslb.com/bfs/live/example.png"),
    "https://i0.hdslb.com/bfs/live/example.png"
  );
  assert.equal(
    normalizeDanmakuEmoteUrl(
      "https://i0.hdslb.com/bfs/live/example.png?token=fixture"
    ),
    "https://i0.hdslb.com/bfs/live/example.png?token=fixture"
  );
  assert.equal(normalizeDanmakuEmoteUrl("https://example.com/emoji.png"), null);
  assert.equal(normalizeDanmakuEmoteUrl("javascript:alert(1)"), null);
  assert.equal(
    normalizeDanmakuEmoteUrl(
      "https://user:pass@i0.hdslb.com/bfs/live/example.png"
    ),
    null
  );
  assert.equal(danmakuEmoteKind("official_147"), "official");
  assert.equal(danmakuEmoteKind("room_21452505_191"), "room");
  assert.equal(danmakuEmoteKind("emoji_210"), "emoji");
  assert.equal(danmakuEmoteKind("custom_asset"), "other");
});

test("normalizes rich parts and falls back when emote metadata is unsafe", () => {
  const emote = normalizeDanmakuEmote({
    id: "room_21452505_191",
    url: "http://i0.hdslb.com/bfs/live/emote.png",
    width: 162,
    height: 162,
    label: "[哈哈]",
  });
  assert.ok(emote);
  assert.equal(emote.kind, "room");
  assert.equal(emote.url, "https://i0.hdslb.com/bfs/live/emote.png");

  const normalized = normalizeDanmakuItems([
    renderItem("rich", 100, {
      text: "你好[哈哈]",
      parts: [
        { type: "text", text: "你好" },
        { type: "emote", emote },
      ],
    }),
    renderItem("unsafe", 200, {
      text: "[坏表情]",
      parts: [
        {
          type: "emote",
          emote: {
            ...emote,
            url: "https://example.com/emoji.png",
          },
        },
      ],
    }),
  ]);

  assert.deepEqual(
    normalized[0].parts.map((part) => part.type),
    ["text", "emote"]
  );
  assert.deepEqual(normalized[1].parts, [{ type: "text", text: "[坏表情]" }]);
});

test("keeps lane spacing style-derived and caps emotes at 115 percent", () => {
  const style = { ...DEFAULT_DANMAKU_STYLE };
  const laneHeight = resolveDanmakuLaneHeight(style);
  const emote = normalizeDanmakuEmote({
    id: "room_21452505_191",
    url: "https://i0.hdslb.com/bfs/live/emote.png",
    width: 320,
    height: 162,
    label: "[哈哈]",
  });
  assert.ok(emote);

  const size = resolveDanmakuEmoteDisplaySize(emote, 25, style);
  assert.equal(laneHeight, 32);
  assert.ok(size.height <= laneHeight * 1.15 + Number.EPSILON);
  assert.ok(Math.abs(size.width / size.height - 320 / 162) < 1e-9);

  assert.equal(resolveDanmakuLaneHeight({ ...style, trackGap: 2 }), laneHeight);
  assert.ok(
    resolveDanmakuLaneHeight({ ...style, scale: style.scale * 1.5 }) >
      laneHeight
  );
});

test("preserves active items when appending emotes and rebuilds on changes", () => {
  const textItem = renderItem("text", 0);
  const emote = normalizeDanmakuEmote({
    id: "official_147",
    url: "https://i0.hdslb.com/bfs/live/emote.png",
    width: 162,
    height: 162,
    label: "[笑]",
  });
  assert.ok(emote);
  const emoteItem = renderItem("emote", 100, {
    text: "[笑]",
    parts: [{ type: "emote", emote }],
  });
  const normalized = normalizeDanmakuItems([textItem, emoteItem]);
  const activeText = normalized[0];

  assert.equal(canPreserveActiveDanmakuItems([activeText], normalized), true);
  assert.equal(
    canPreserveActiveDanmakuItems(normalized, [normalized[1]]),
    true
  );
  assert.equal(
    canPreserveActiveDanmakuItems(
      [{ ...activeText, text: "changed" }],
      normalized
    ),
    false
  );
  assert.equal(canPreserveActiveDanmakuItems([], normalized), false);
});

test("resolves canvas DPR within device, style, and pixel-budget limits", () => {
  assert.equal(resolveDanmakuCanvasDpr(2, 640, 360, DEFAULT_DANMAKU_STYLE), 2);
  assert.equal(
    resolveDanmakuCanvasDpr(Number.NaN, 640, 360, DEFAULT_DANMAKU_STYLE),
    1
  );

  const fourK = resolveDanmakuCanvasDpr(2, 3_840, 2_160, {
    ...DEFAULT_DANMAKU_STYLE,
    canvasPixelBudget: 2_073_600,
  });
  assert.equal(fourK, 1);
});

test("limits the display area and keeps responsive scaling bounded", () => {
  const halfArea = {
    ...DEFAULT_DANMAKU_STYLE,
    displayArea: 0.5,
  };
  assert.equal(resolveDanmakuDisplayHeight(1_080, halfArea), 540);
  assert.equal(
    resolveDanmakuDisplayHeight(1_080, {
      ...halfArea,
      avoidSubtitles: true,
    }),
    540
  );
  assert.equal(
    resolveDanmakuDisplayHeight(1_080, {
      ...DEFAULT_DANMAKU_STYLE,
      avoidSubtitles: true,
    }),
    864
  );
  assert.equal(resolveDanmakuResponsiveScale(1_080, halfArea), 1);
  assert.equal(
    resolveDanmakuResponsiveScale(1_080, {
      ...halfArea,
      scaleWithPlayer: true,
    }),
    1.5
  );
  assert.equal(
    resolveDanmakuResponsiveScale(360, {
      ...halfArea,
      scaleWithPlayer: true,
    }),
    0.75
  );
});

test("evicts the least-recently-used texture pixels within budget", () => {
  const cache = new PixelLruCache(100);

  assert.equal(cache.set("a", "A", 40), true);
  assert.equal(cache.set("b", "B", 40), true);
  assert.equal(cache.get("a"), "A");
  assert.equal(cache.set("c", "C", 40), true);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), "A");
  assert.equal(cache.get("c"), "C");

  assert.equal(cache.set("oversized", "X", 101), false);
  cache.setBudget(30);
  assert.equal(cache.size, 0);
  assert.equal(cache.pixelCount, 0);
});

test("finds inclusive lower and upper bounds in sorted item time", () => {
  const items = [
    renderItem("a", 0),
    renderItem("b", 100),
    renderItem("c", 100),
    renderItem("d", 200),
  ];

  assert.equal(lowerBoundByTime(items, 100), 1);
  assert.equal(upperBoundByTime(items, 100), 3);
  assert.equal(lowerBoundByTime(items, 150), 3);
});

test("separates normal media sync, forward gaps, and real seeks", () => {
  assert.equal(
    resolveDanmakuMediaTimeAction({
      initialized: true,
      clockMs: 10_000,
      mediaTimeMs: 10_400,
    }),
    "sync"
  );
  assert.equal(
    resolveDanmakuMediaTimeAction({
      initialized: true,
      clockMs: 10_000,
      mediaTimeMs: 18_000,
    }),
    "resync"
  );
  assert.equal(
    resolveDanmakuMediaTimeAction({
      initialized: true,
      clockMs: 10_000,
      mediaTimeMs: 2_000,
    }),
    "resync"
  );
  assert.equal(
    resolveDanmakuMediaTimeAction({
      initialized: true,
      clockMs: 10_000,
      mediaTimeMs: 10_100,
      forceRebuild: true,
    }),
    "rebuild"
  );
  assert.equal(
    resolveDanmakuMediaTimeAction({
      initialized: false,
      clockMs: 0,
      mediaTimeMs: 10_000,
    }),
    "rebuild"
  );
});

test("quantizes player clock updates without changing renderer interpolation", () => {
  assert.equal(DANMAKU_MEDIA_SYNC_INTERVAL_MS, 100);
  assert.equal(quantizeDanmakuMediaTimeMs(10_099.9), 10_000);
  assert.equal(quantizeDanmakuMediaTimeMs(-10), 0);
  assert.equal(quantizeDanmakuMediaTimeMs(Number.NaN), 0);
  assert.equal(quantizeDanmakuMediaTimeSeconds(12.399), 12.3);
  assert.equal(quantizeDanmakuMediaTimeSeconds(Number.POSITIVE_INFINITY), 0);
});

test("publishes imperative video clock updates once per 100ms bucket", () => {
  const state = { currentTime: 10.01 };
  let notify = () => {};
  const source = createVideoDanmakuClockSource({
    get state() {
      return state;
    },
    subscribe(listener) {
      notify = listener;
      return () => {
        notify = () => {};
      };
    },
  });
  let updates = 0;
  const unsubscribe = source.subscribe(() => {
    updates += 1;
  });

  assert.equal(source.read(), 10_010);
  state.currentTime = 10.099;
  notify();
  assert.equal(updates, 0);

  state.currentTime = 10.1;
  notify();
  assert.equal(updates, 1);

  state.currentTime = 10.199;
  notify();
  assert.equal(updates, 1);

  state.currentTime = 2;
  notify();
  assert.equal(updates, 2);

  unsubscribe();
  state.currentTime = 3;
  notify();
  assert.equal(updates, 2);
});

test("keeps the canvas clock monotonic during ordinary media sync", () => {
  assert.equal(resolveSyncedDanmakuClockMs(10_080, 10_000), 10_080);
  assert.equal(resolveSyncedDanmakuClockMs(10_080, 10_120), 10_120);
  assert.equal(resolveSyncedDanmakuClockMs(Number.NaN, -5), 0);
});

test("classifies style changes by renderer impact", () => {
  const base = { ...DEFAULT_DANMAKU_STYLE };
  assert.deepEqual(resolveDanmakuStyleChange(base, base), {
    changed: false,
    reflow: false,
    visibility: false,
    motion: false,
  });
  assert.deepEqual(
    resolveDanmakuStyleChange(base, {
      ...base,
      fontFamily: '"SimHei", sans-serif',
    }),
    { changed: true, reflow: false, visibility: false, motion: false }
  );
  assert.deepEqual(
    resolveDanmakuStyleChange(base, {
      ...base,
      opacity: 0.5,
    }),
    { changed: true, reflow: false, visibility: false, motion: false }
  );
  assert.deepEqual(
    resolveDanmakuStyleChange(base, {
      ...base,
      displayArea: 0.5,
    }),
    { changed: true, reflow: true, visibility: false, motion: false }
  );
  assert.deepEqual(
    resolveDanmakuStyleChange(base, {
      ...base,
      edgePadding: 24,
    }),
    { changed: true, reflow: true, visibility: false, motion: true }
  );
  assert.deepEqual(
    resolveDanmakuStyleChange(base, {
      ...base,
      showScroll: false,
    }),
    { changed: true, reflow: false, visibility: true, motion: false }
  );
});

test("updates active layout geometry without replacing birth visual style", () => {
  const birthStyle = {
    ...DEFAULT_DANMAKU_STYLE,
    fontFamily: '"SimHei", sans-serif',
    edgePadding: 12,
    trackGap: 2,
  };
  const currentStyle = {
    ...DEFAULT_DANMAKU_STYLE,
    fontFamily: '"SimSun", serif',
    edgePadding: 24,
    trackGap: 8,
  };
  const merged = resolveDanmakuLayoutStyle(birthStyle, currentStyle);

  assert.notStrictEqual(merged, birthStyle);
  assert.equal(merged.fontFamily, birthStyle.fontFamily);
  assert.equal(merged.edgePadding, currentStyle.edgePadding);
  assert.equal(merged.trackGap, currentStyle.trackGap);
  assert.strictEqual(resolveDanmakuLayoutStyle(merged, currentStyle), merged);
});

test("keeps mode-specific collision domains while sharing display lanes", () => {
  assert.deepEqual(resolveDanmakuLaneRange("scroll", 3), {
    start: 0,
    end: 2,
    step: 1,
  });
  assert.deepEqual(resolveDanmakuLaneRange("top", 3), {
    start: 0,
    end: 2,
    step: 1,
  });
  assert.deepEqual(resolveDanmakuLaneRange("bottom", 3), {
    start: 2,
    end: 0,
    step: -1,
  });

  const scrolling = [motionItem("scroll", "scroll", 0, 0)];
  assert.equal(
    chooseDanmakuLane(
      scrolling,
      { mode: "top", width: 160, startMs: 1_000, durationMs: 4_500 },
      1_280,
      0,
      8,
      3
    ),
    0
  );

  const top = [motionItem("top", "top", 0, 0)];
  assert.equal(
    chooseDanmakuLane(
      top,
      { mode: "top", width: 160, startMs: 1_000, durationMs: 4_500 },
      1_280,
      0,
      8,
      3
    ),
    1
  );
});

test("applies scrolling spacing and removes expired active items", () => {
  const active = [
    motionItem("scroll", "scroll", 0, 0, {
      width: 500,
    }),
  ];
  const candidate = {
    mode: "scroll",
    width: 160,
    startMs: 1_000,
    durationMs: 5_000,
  };

  assert.equal(chooseDanmakuLane(active, candidate, 1_000, 0, 8, 2), 1);
  assert.equal(
    chooseDanmakuLane(active, { ...candidate, startMs: 3_000 }, 1_000, 0, 8, 2),
    0
  );

  removeExpiredDanmaku(active, 5_000);
  assert.equal(active.length, 0);
});

test("uses a shared scroll duration so wider items move faster", () => {
  const viewportWidth = 1_280;
  const edgePadding = 12;
  const durationMs = resolveDanmakuScrollDurationMs(
    viewportWidth,
    edgePadding,
    220
  );
  const shortItem = {
    startMs: 0,
    durationMs,
    width: 100,
  };
  const longItem = {
    startMs: 0,
    durationMs,
    width: 600,
  };
  const sampleTimeMs = 2_000;
  const shortStart = resolveDanmakuScrollX(
    shortItem,
    0,
    viewportWidth,
    edgePadding
  );
  const shortSample = resolveDanmakuScrollX(
    shortItem,
    sampleTimeMs,
    viewportWidth,
    edgePadding
  );
  const longStart = resolveDanmakuScrollX(
    longItem,
    0,
    viewportWidth,
    edgePadding
  );
  const longSample = resolveDanmakuScrollX(
    longItem,
    sampleTimeMs,
    viewportWidth,
    edgePadding
  );

  assert.equal(shortItem.durationMs, longItem.durationMs);
  assert.ok(
    (longStart - longSample) / (sampleTimeMs / 1_000) >
      (shortStart - shortSample) / (sampleTimeMs / 1_000)
  );
  assert.equal(
    resolveDanmakuScrollX(shortItem, durationMs, viewportWidth, edgePadding),
    -shortItem.width - edgePadding
  );
});

test("avoids a faster scrolling item catching its leader in the same lane", () => {
  const leader = motionItem("leader", "scroll", 0, 0, {
    width: 100,
    durationMs: 5_000,
  });
  const candidate = {
    mode: "scroll",
    width: 800,
    startMs: 1_000,
    durationMs: 5_000,
  };

  assert.equal(chooseDanmakuLane([leader], candidate, 1_000, 0, 50, 2), 1);
  assert.equal(
    chooseDanmakuLane([leader], { ...candidate, width: 50 }, 1_000, 0, 50, 2),
    0
  );
});

test("maps media time to six-minute segments and boundary loading windows", () => {
  assert.equal(danmakuSegmentIndex(-1), 1);
  assert.equal(danmakuSegmentIndex(359_999), 1);
  assert.equal(danmakuSegmentIndex(360_000), 2);
  assert.equal(danmakuSegmentOffset(420_500), 60_500);

  assert.equal(shouldPrefetchNextDanmakuSegment(299_999), false);
  assert.equal(shouldPrefetchNextDanmakuSegment(300_000), true);
  assert.equal(shouldLoadPreviousDanmakuSegment(0), false);
  assert.equal(shouldLoadPreviousDanmakuSegment(360_000), true);
  assert.equal(shouldLoadPreviousDanmakuSegment(389_999), true);
  assert.equal(shouldLoadPreviousDanmakuSegment(390_000), true);
  assert.equal(shouldLoadPreviousDanmakuSegment(390_001), false);
});

test("keeps eight segments with LRU promotion and context clearing", () => {
  const cache = new DanmakuSegmentLruCache();

  for (let index = 1; index <= DANMAKU_SEGMENT_CACHE_LIMIT + 1; index += 1) {
    cache.set(10, index, segment(10, index));
  }

  assert.equal(cache.size, DANMAKU_SEGMENT_CACHE_LIMIT);
  assert.equal(cache.get(10, 1), undefined);
  assert.equal(cache.get(10, 2)?.segmentIndex, 2);

  cache.get(10, 2);
  cache.set(10, 10, segment(10, 10));
  assert.equal(cache.get(10, 3), undefined);
  assert.equal(cache.get(10, 2)?.segmentIndex, 2);

  cache.clear();
  assert.equal(cache.size, 0);
});

test("merges previous, current, and next segment items by time and id", () => {
  const duplicateOld = renderItem("duplicate", 100, { text: "old" });
  const duplicateCurrent = renderItem("duplicate", 100, {
    text: "current",
  });
  const merged = mergeDanmakuSegmentItems([
    segment(7, 1, [renderItem("late", 300), duplicateOld]),
    segment(7, 2, [duplicateCurrent, renderItem("early", 100)]),
  ]);

  assert.deepEqual(
    merged.map((item) => [item.id, item.text]),
    [
      ["duplicate", "old"],
      ["early", "early"],
      ["late", "late"],
    ]
  );

  const cache = new DanmakuSegmentLruCache();
  cache.set(7, 1, segment(7, 1, [renderItem("previous", 1)]));
  cache.set(7, 2, segment(7, 2, [renderItem("current", 2)]));
  cache.set(7, 3, segment(7, 3, [renderItem("next", 3)]));
  cache.set(7, 4, segment(7, 4, [renderItem("far", 4)]));

  assert.deepEqual(
    cachedDanmakuSegmentItems(cache, 7, 2).map((item) => item.id),
    ["previous", "current", "next"]
  );
});

test("isolates supporting failures while current and render failures hide the layer", () => {
  let state = createVideoDanmakuState(true);
  const items = [renderItem("current", 100)];

  state = videoDanmakuReducer(state, {
    type: "current-loaded",
    items,
    segmentIndex: 2,
  });
  assert.equal(state.status, "ready");
  assert.equal(state.loadedSegment, 2);

  const supportingFailure = videoDanmakuReducer(state, {
    type: "segment-failed",
    role: "supporting",
  });
  assert.strictEqual(supportingFailure, state);

  state = videoDanmakuReducer(state, { type: "render-failed" });
  assert.equal(state.renderFailed, true);
  assert.equal(state.loadedSegment, 2);

  state = videoDanmakuReducer(state, {
    type: "segment-failed",
    role: "current",
  });
  assert.equal(state.status, "error");
  assert.deepEqual(state.items, []);
  assert.equal(state.loadedSegment, null);
  assert.equal(state.renderFailed, true);

  state = videoDanmakuReducer(state, { type: "inactive" });
  assert.equal(state.status, "idle");
  assert.equal(state.renderFailed, true);

  state = videoDanmakuReducer(state, { type: "reset", active: true });
  assert.equal(state.status, "loading");
  assert.equal(state.renderFailed, false);
});

test("promotes ten repeated live messages and extends the active shout", () => {
  const tracker = new LiveDanmakuShoutTracker();

  for (let index = 0; index < 9; index += 1) {
    assert.equal(
      tracker.observe({
        id: `repeat-${index}`,
        text: "xxx",
        timeMs: index * 1_000,
      }),
      false
    );
  }

  assert.equal(
    tracker.observe({ id: "repeat-9", text: "xxx", timeMs: 9_000 }),
    true
  );
  let snapshot = tracker.snapshot(9_500);
  assert.deepEqual(snapshot.suppressedTexts, ["xxx"]);
  assert.equal(snapshot.shouts.length, 1);
  assert.equal(snapshot.shouts[0].count, 10);
  assert.equal(snapshot.shouts[0].endMs, 9_000 + DANMAKU_SHOUT_HOLD_MS);

  assert.equal(
    tracker.observe({ id: "repeat-10", text: "xxx", timeMs: 10_000 }),
    true
  );
  snapshot = tracker.snapshot(10_500);
  assert.equal(snapshot.shouts[0].count, 11);
  assert.equal(snapshot.shouts[0].endMs, 10_000 + DANMAKU_SHOUT_HOLD_MS);
});

test("only counts live repeats inside the twelve-second observation window", () => {
  const tracker = new LiveDanmakuShoutTracker();

  for (let index = 0; index < 9; index += 1) {
    assert.equal(
      tracker.observe({
        text: "windowed",
        timeMs: index * 1_000,
      }),
      false
    );
  }

  assert.equal(tracker.observe({ text: "windowed", timeMs: 13_000 }), false);
  const snapshot = tracker.snapshot(13_000);
  assert.deepEqual(snapshot.shouts, []);
  assert.deepEqual(snapshot.suppressedTexts, []);
});

test("advances video shout counts over time and suppresses matching items", () => {
  const repeatedItems = Array.from({ length: 12 }, (_, index) =>
    renderItem(`whole-video-${index}`, index * 30_000, {
      text: "全片重复",
    })
  );
  const otherItem = renderItem("other", 15_000, { text: "普通弹幕" });
  const snapshot = buildVideoDanmakuShoutSnapshot([
    ...repeatedItems,
    otherItem,
  ]);

  assert.deepEqual(snapshot.suppressedTexts, ["全片重复"]);
  assert.deepEqual(
    snapshot.shouts.map((item) => [item.startMs, item.endMs, item.count]),
    [
      [270_000, 275_000, 10],
      [300_000, 305_000, 11],
      [330_000, 335_000, 12],
    ]
  );
  assert.equal(
    snapshot.shouts.some(
      (item) => item.startMs <= 280_000 && item.endMs > 280_000
    ),
    false
  );
  assert.deepEqual(
    filterDanmakuItemsBySuppressedTexts(
      [...repeatedItems, otherItem],
      snapshot.suppressedTexts
    ).map((item) => item.id),
    ["other"]
  );
});

test("updates one video shout count while consecutive repeats refresh it", () => {
  const items = Array.from({ length: 12 }, (_, index) =>
    renderItem(`consecutive-${index}`, index * 1_000, {
      text: "连续重复",
    })
  );
  const snapshot = buildVideoDanmakuShoutSnapshot(items);

  assert.equal(snapshot.shouts.length, 1);
  assert.equal(snapshot.shouts[0].startMs, 9_000);
  assert.equal(snapshot.shouts[0].endMs, 11_000 + DANMAKU_SHOUT_HOLD_MS);
  assert.equal(resolveDanmakuShoutCount(snapshot.shouts[0], 9_000), 10);
  assert.equal(resolveDanmakuShoutCount(snapshot.shouts[0], 9_999), 10);
  assert.equal(resolveDanmakuShoutCount(snapshot.shouts[0], 10_000), 11);
  assert.equal(resolveDanmakuShoutCount(snapshot.shouts[0], 11_000), 12);
});

test("keeps video repeats below the full-video threshold", () => {
  const items = Array.from({ length: 9 }, (_, index) =>
    renderItem(`below-threshold-${index}`, index * 60_000, {
      text: "还没到十次",
    })
  );
  const snapshot = buildVideoDanmakuShoutSnapshot(items);

  assert.deepEqual(snapshot.shouts, []);
  assert.deepEqual(snapshot.suppressedTexts, []);
});

test("builds the video shout index across segment boundaries", () => {
  const index = new VideoDanmakuShoutIndex();

  for (let segmentIndex = 1; segmentIndex <= 12; segmentIndex += 1) {
    index.addSegment({
      segmentIndex,
      items: [
        renderItem(`segment-repeat-${segmentIndex}`, segmentIndex * 360_000, {
          text: "跨段重复",
        }),
      ],
    });
  }

  const snapshot = index.snapshot();
  assert.deepEqual(snapshot.suppressedTexts, ["跨段重复"]);
  assert.deepEqual(
    snapshot.shouts.map((item) => [item.startMs, item.endMs, item.count]),
    [
      [3_600_000, 3_600_000 + DANMAKU_SHOUT_HOLD_MS, 10],
      [3_960_000, 3_960_000 + DANMAKU_SHOUT_HOLD_MS, 11],
      [4_320_000, 4_320_000 + DANMAKU_SHOUT_HOLD_MS, 12],
    ]
  );
});
