import assert from "node:assert/strict";
import test from "node:test";

import { resolveDanmakuCanvasDpr } from "../src/lib/danmaku/canvas.ts";
import {
  chooseDanmakuLane,
  removeExpiredDanmaku,
  resolveDanmakuEmoteDisplaySize,
  resolveDanmakuLaneHeight,
  resolveDanmakuLaneRange,
  resolveDanmakuScrollDurationMs,
  resolveDanmakuScrollX,
} from "../src/lib/danmaku/layout.ts";
import { PixelLruCache } from "../src/lib/danmaku/pixel-cache.ts";
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
  canPreserveActiveDanmakuItems,
  lowerBoundByTime,
  upperBoundByTime,
} from "../src/lib/danmaku/timeline.ts";
import {
  DEFAULT_DANMAKU_STYLE,
  danmakuColorToCss,
  danmakuEmoteKind,
  normalizeDanmakuEmote,
  normalizeDanmakuEmoteUrl,
  normalizeDanmakuItems,
  sanitizeDanmakuText,
} from "../src/lib/danmaku/types.ts";
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
