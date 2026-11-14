import {
  resolveDanmakuCanvasDpr,
  resolveDanmakuResponsiveScale,
} from "@/lib/danmaku/canvas";
import {
  chooseDanmakuLane,
  removeExpiredDanmaku,
  resolveDanmakuDisplayHeight,
  resolveDanmakuLaneHeight,
  resolveDanmakuLaneRange,
  resolveDanmakuScrollDurationMs,
  resolveDanmakuScrollX,
  type DanmakuMotionItem,
} from "@/lib/danmaku/layout";
import { danmakuEmoteImageCache } from "@/lib/danmaku/emote-image-cache";
import {
  DanmakuTextureFactory,
  type DanmakuTexture,
} from "@/lib/danmaku/texture-cache";
import {
  resolveDanmakuMediaTimeAction,
  resolveSyncedDanmakuClockMs,
} from "@/lib/danmaku/media-clock";
import {
  resolveDanmakuLayoutStyle,
  resolveDanmakuStyleChange,
} from "@/lib/danmaku/style-change";
import {
  danmakuShoutText,
  normalizeDanmakuShouts,
  normalizeSuppressedDanmakuTexts,
  resolveDanmakuShoutCount,
  type DanmakuShout,
} from "@/lib/danmaku/shout";
import {
  canPreserveActiveDanmakuItems,
  lowerBoundByTime,
  upperBoundByTime,
} from "@/lib/danmaku/timeline";
import {
  isDanmakuItemVisible,
  normalizeDanmakuItems,
  resolveDanmakuStyle,
  type DanmakuRenderItem,
  type DanmakuRenderStyle,
} from "@/lib/danmaku/types";

const MAX_FRAME_DELTA_MS = 1_000;
const MAX_SPAWNS_PER_FRAME = 12;
const MAX_VISIBLE_SHOUTS = 4;

interface ActiveDanmaku extends DanmakuMotionItem {
  item: DanmakuRenderItem;
  texture: DanmakuTexture;
  baseStyle: DanmakuRenderStyle;
  style: DanmakuRenderStyle;
}

export interface DanmakuEngineStats {
  visible: boolean;
  activeCount: number;
  cachedTextureCount: number;
  cachedTexturePixels: number;
  dpr: number;
  trackCount: number;
  renderCount: number;
  spawnAttemptCount: number;
  spawnActiveCount: number;
  shoutCount: number;
  textureGetCount: number;
  textureCacheMissCount: number;
  textureCreateTotalMs: number;
  textureCreateMaximumMs: number;
  tickWorkTotalMs: number;
  tickWorkMaximumMs: number;
  tickWorkOver8MsCount: number;
  clockRebuildCount: number;
  clockResyncCount: number;
  clockSyncCount: number;
  clockSeekCount: number;
}

export class DanmakuCanvasEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly textureFactory: DanmakuTextureFactory;
  private readonly unsubscribeEmoteImages: () => void;
  private style: DanmakuRenderStyle;
  private items: readonly DanmakuRenderItem[] = [];
  private normalizedItems: DanmakuRenderItem[] = [];
  private active: ActiveDanmaku[] = [];
  private shouts: DanmakuShout[] = [];
  private suppressedTexts = new Set<string>();
  private width = 0;
  private height = 0;
  private dpr = 1;
  private trackCount = 1;
  private laneHeight = 32;
  private clockMs = 0;
  private nextIndex = 0;
  private initialized = false;
  private playing = false;
  private seeking = false;
  private rebuildOnNextMediaSync = false;
  private playbackRate = 1;
  private visible = true;
  private dirty = true;
  private emoteImagesChanged = false;
  private lastFrameTime: number | null = null;
  private renderCount = 0;
  private spawnAttemptCount = 0;
  private spawnActiveCount = 0;
  private tickWorkTotalMs = 0;
  private tickWorkMaximumMs = 0;
  private tickWorkOver8MsCount = 0;
  private clockRebuildCount = 0;
  private clockResyncCount = 0;
  private clockSyncCount = 0;
  private clockSeekCount = 0;
  private readonly reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(canvas: HTMLCanvasElement, style?: Partial<DanmakuRenderStyle>) {
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Unable to create danmaku canvas context");

    this.canvas = canvas;
    this.context = context;
    this.style = resolveDanmakuStyle(style);
    this.textureFactory = new DanmakuTextureFactory(
      this.style.texturePixelBudget
    );
    this.unsubscribeEmoteImages = danmakuEmoteImageCache.subscribe(() => {
      this.emoteImagesChanged = true;
      this.dirty = true;
    });
  }

  setItems(items: readonly DanmakuRenderItem[]) {
    if (items === this.items) return;
    const previousIds = new Set(this.normalizedItems.map((item) => item.id));
    this.items = items;
    this.normalizedItems = normalizeDanmakuItems(items).filter(
      (item) => !this.isSuppressedItem(item)
    );
    removeExpiredDanmaku(this.active, this.clockMs);
    if (
      this.initialized &&
      canPreserveActiveDanmakuItems(
        this.active.map((item) => item.item),
        this.normalizedItems
      )
    ) {
      const activeIds = new Set(this.active.map((item) => item.id));
      const firstIndex = lowerBoundByTime(
        this.normalizedItems,
        this.clockMs - this.maximumRuntimeDuration()
      );
      const lastIndex = upperBoundByTime(this.normalizedItems, this.clockMs);

      for (let index = firstIndex; index < lastIndex; index += 1) {
        const item = this.normalizedItems[index];
        if (previousIds.has(item.id) || activeIds.has(item.id)) continue;
        this.spawnItem(item, item.timeMs);
        activeIds.add(item.id);
      }

      this.nextIndex = lastIndex;
      this.dirty = true;
      return;
    }
    this.rebuildAt(this.clockMs);
  }

  setShouts(shouts: readonly DanmakuShout[]) {
    this.shouts = normalizeDanmakuShouts(shouts).sort(
      (left, right) =>
        right.startMs - left.startMs || left.id.localeCompare(right.id)
    );
    this.dirty = true;
  }

  setSuppressedTexts(texts: readonly string[]) {
    const normalized = normalizeSuppressedDanmakuTexts(texts);
    const previous = Array.from(this.suppressedTexts).sort();
    if (
      normalized.length === previous.length &&
      normalized.every((text, index) => text === previous[index])
    ) {
      return;
    }

    this.suppressedTexts = new Set(normalized);
    const activeCount = this.active.length;
    this.active = this.active.filter(
      (item) => !this.isSuppressedItem(item.item)
    );
    if (this.active.length !== activeCount) this.updateLaneMetrics();
    this.dirty = true;
  }

  setStyle(style: Partial<DanmakuRenderStyle>) {
    const resolved = resolveDanmakuStyle(style);
    const change = resolveDanmakuStyleChange(this.style, resolved);
    if (!change.changed) return;

    // Active items keep their birth visual style. Visibility filters and layout
    // geometry are independent settings and remain immediate.
    this.style = resolved;
    this.textureFactory.setPixelBudget(resolved.texturePixelBudget);
    if (change.visibility) this.removeFilteredActiveItems();
    this.updateLaneMetrics();
    if (change.reflow) {
      this.reflowActiveItems({
        layoutStyle: resolved,
        refreshMotion: change.motion,
      });
    }
    this.dirty = true;
  }

  setMediaTime(timeMs: number) {
    const nextTime = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0);
    if (this.seeking) {
      this.clockSeekCount += 1;
      this.clockMs = nextTime;
      this.dirty = true;
      return;
    }

    const action = resolveDanmakuMediaTimeAction({
      initialized: this.initialized,
      clockMs: this.clockMs,
      mediaTimeMs: nextTime,
      forceRebuild: this.rebuildOnNextMediaSync,
    });
    this.rebuildOnNextMediaSync = false;

    if (action === "rebuild") {
      this.clockRebuildCount += 1;
      this.rebuildAt(nextTime);
      return;
    }

    if (action === "resync") {
      this.clockResyncCount += 1;
      this.resyncAt(nextTime);
      return;
    }

    this.clockSyncCount += 1;
    this.syncAt(nextTime);
  }

  setPlaying(playing: boolean) {
    if (this.playing === playing) return;
    this.playing = playing;
    this.lastFrameTime = null;
    this.dirty = true;
  }

  setSeeking(seeking: boolean) {
    if (this.seeking === seeking) return;
    this.seeking = seeking;
    if (!seeking) this.rebuildOnNextMediaSync = true;
    this.lastFrameTime = null;
    this.dirty = true;
  }

  setPlaybackRate(playbackRate: number) {
    this.playbackRate = Math.max(
      0,
      Number.isFinite(playbackRate) ? playbackRate : 1
    );
    this.dirty = true;
  }

  setVisible(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible;
    this.dirty = true;
    if (!visible) this.clear();
  }

  resize(cssWidth: number, cssHeight: number, deviceDpr: number) {
    if (cssWidth <= 0 || cssHeight <= 0) {
      this.width = 0;
      this.height = 0;
      this.clear();
      return;
    }

    const nextDpr = resolveDanmakuCanvasDpr(
      deviceDpr,
      cssWidth,
      cssHeight,
      this.style
    );
    const pixelWidth = Math.max(1, Math.round(cssWidth * nextDpr));
    const pixelHeight = Math.max(1, Math.round(cssHeight * nextDpr));
    const sizeChanged =
      this.width !== cssWidth ||
      this.height !== cssHeight ||
      this.canvas.width !== pixelWidth ||
      this.canvas.height !== pixelHeight ||
      Math.abs(this.dpr - nextDpr) >= 0.01;

    if (!sizeChanged) return;

    const previousHeight = this.height;
    this.width = cssWidth;
    this.height = cssHeight;
    this.dpr = nextDpr;
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    this.textureFactory.setRasterScale(nextDpr);
    this.updateLaneMetrics();
    const responsiveHeightChanged =
      Math.abs(previousHeight - cssHeight) >= 0.5 &&
      this.active.some((item) => item.baseStyle.scaleWithPlayer);
    this.reflowActiveItems({
      refreshResponsiveStyles: Math.abs(previousHeight - cssHeight) >= 0.5,
      refreshTextures: responsiveHeightChanged,
      refreshMotion: true,
    });
    if (responsiveHeightChanged) this.updateLaneMetrics();
    this.dirty = true;
    // Backing-store changes clear pixels, so repaint before this resize callback ends.
    this.render();
  }

  invalidateTextures() {
    this.textureFactory.invalidate();
    this.dirty = true;
  }

  tick(frameTime: number) {
    if (this.emoteImagesChanged) {
      this.emoteImagesChanged = false;
      this.textureFactory.invalidate();
      this.refreshActiveEmoteTextures();
    }

    const deltaMs =
      this.lastFrameTime === null
        ? 0
        : Math.min(
            MAX_FRAME_DELTA_MS,
            Math.max(0, frameTime - this.lastFrameTime)
          );
    this.lastFrameTime = frameTime;

    if (!this.visible) return;

    if (this.playing && this.playbackRate > 0) {
      const workStartedAt = performance.now();
      this.clockMs += deltaMs * this.playbackRate;
      const activeCount = this.active.length;
      removeExpiredDanmaku(this.active, this.clockMs);
      if (this.active.length !== activeCount) this.updateLaneMetrics();
      this.spawnThrough(this.clockMs);
      this.render();
      this.recordTickWork(workStartedAt);
      return;
    }

    if (this.dirty) {
      const workStartedAt = performance.now();
      this.render();
      this.recordTickWork(workStartedAt);
    }
  }

  render() {
    if (!this.visible || this.width <= 0 || this.height <= 0) {
      this.dirty = false;
      return;
    }

    this.renderCount += 1;
    const context = this.context;
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    context.save();
    context.beginPath();
    context.rect(0, 0, this.width, this.height);
    context.clip();
    context.globalAlpha = this.style.opacity;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    for (const item of this.active) {
      const style = item.style;
      const x =
        item.mode === "scroll"
          ? resolveDanmakuScrollX(
              item,
              this.clockMs,
              this.width,
              style.edgePadding
            )
          : (this.width - item.width) / 2;
      const y =
        style.edgePadding +
        item.lane * this.laneHeight +
        (this.laneHeight - item.height) / 2;

      if (
        x + item.width < -style.edgePadding ||
        x > this.width + style.edgePadding
      ) {
        continue;
      }

      context.drawImage(item.texture.canvas, x, y, item.width, item.height);
    }

    this.renderShouts(context);
    context.restore();
    this.dirty = false;
  }

  getStats(): DanmakuEngineStats {
    const textureStats = this.textureFactory.getStats();
    return {
      visible: this.visible,
      activeCount: this.active.length,
      cachedTextureCount: this.textureFactory.cachedTextureCount,
      cachedTexturePixels: this.textureFactory.cachedTexturePixels,
      dpr: this.dpr,
      trackCount: this.trackCount,
      renderCount: this.renderCount,
      spawnAttemptCount: this.spawnAttemptCount,
      spawnActiveCount: this.spawnActiveCount,
      shoutCount: this.visibleShouts().length,
      textureGetCount: textureStats.getCount,
      textureCacheMissCount: textureStats.cacheMissCount,
      textureCreateTotalMs: textureStats.createTotalMs,
      textureCreateMaximumMs: textureStats.createMaximumMs,
      tickWorkTotalMs: this.tickWorkTotalMs,
      tickWorkMaximumMs: this.tickWorkMaximumMs,
      tickWorkOver8MsCount: this.tickWorkOver8MsCount,
      clockRebuildCount: this.clockRebuildCount,
      clockResyncCount: this.clockResyncCount,
      clockSyncCount: this.clockSyncCount,
      clockSeekCount: this.clockSeekCount,
    };
  }

  dispose() {
    this.unsubscribeEmoteImages();
    this.active = [];
    this.shouts = [];
    this.suppressedTexts.clear();
    this.textureFactory.invalidate();
    this.clear();
  }

  private clear() {
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private rebuildAt(timeMs: number) {
    this.clockMs = timeMs;
    this.active = [];
    this.initialized = true;
    this.updateLaneMetrics();

    if (this.width <= 0 || this.height <= 0) {
      this.nextIndex = upperBoundByTime(this.normalizedItems, timeMs);
      this.dirty = true;
      return;
    }

    const maximumAgeMs = this.maximumRuntimeDuration();
    const firstIndex = lowerBoundByTime(
      this.normalizedItems,
      timeMs - maximumAgeMs
    );
    const lastIndex = upperBoundByTime(this.normalizedItems, timeMs);

    for (let index = firstIndex; index < lastIndex; index += 1) {
      this.spawnItem(
        this.normalizedItems[index],
        this.normalizedItems[index].timeMs
      );
    }

    removeExpiredDanmaku(this.active, timeMs);
    this.nextIndex = lastIndex;
    this.dirty = true;
  }

  private resyncAt(timeMs: number) {
    if (timeMs < this.clockMs) this.active = [];
    this.clockMs = timeMs;
    removeExpiredDanmaku(this.active, timeMs);
    this.nextIndex = upperBoundByTime(this.normalizedItems, timeMs);
    this.dirty = true;
  }

  private syncAt(timeMs: number) {
    // The canvas clock is authoritative between media samples. Moving it
    // backward for a quantized sample creates visible stutter; real seeks and
    // large drift still take the resync/rebuild path.
    this.clockMs = resolveSyncedDanmakuClockMs(this.clockMs, timeMs);
    removeExpiredDanmaku(this.active, this.clockMs);
    if (this.playing) this.spawnThrough(this.clockMs);
    this.dirty = true;
  }

  private spawnThrough(timeMs: number) {
    let spawned = 0;
    while (
      spawned < MAX_SPAWNS_PER_FRAME &&
      this.nextIndex < this.normalizedItems.length &&
      this.normalizedItems[this.nextIndex].timeMs <= timeMs
    ) {
      const item = this.normalizedItems[this.nextIndex];
      this.spawnItem(item, item.timeMs);
      this.nextIndex += 1;
      spawned += 1;
    }
  }

  private spawnItem(item: DanmakuRenderItem, spawnTimeMs: number) {
    this.spawnAttemptCount += 1;
    if (!isDanmakuItemVisible(item, this.style)) return;
    if (this.isSuppressedItem(item)) return;
    const activeCount = this.active.length;
    removeExpiredDanmaku(this.active, spawnTimeMs);
    if (this.active.length !== activeCount) this.updateLaneMetrics();
    if (this.active.length >= this.style.maxOnScreen) return;

    const baseStyle = this.style;
    const style = this.effectiveStyle(baseStyle);
    const maxTextWidth = Math.max(40, this.width * style.maxTextWidthRatio);
    const emoteImages = this.resolveEmoteImages(item);
    const texture = this.textureFactory.get(
      item,
      style,
      maxTextWidth,
      emoteImages
    );
    const durationMs = this.motionDuration(item.mode, style);
    const motionCandidate = {
      id: item.id,
      mode: item.mode,
      width: texture.width,
      height: texture.height,
      startMs: spawnTimeMs,
      durationMs,
    };
    const lane = chooseDanmakuLane(
      this.active,
      motionCandidate,
      this.width,
      style.edgePadding,
      style.trackGap,
      this.trackCount
    );
    if (lane === null) return;

    this.active.push({
      ...motionCandidate,
      lane,
      item,
      texture,
      baseStyle,
      style,
    });
    this.spawnActiveCount += 1;
  }

  private recordTickWork(startedAt: number) {
    const durationMs = performance.now() - startedAt;
    this.tickWorkTotalMs += durationMs;
    this.tickWorkMaximumMs = Math.max(this.tickWorkMaximumMs, durationMs);
    if (durationMs > 8) this.tickWorkOver8MsCount += 1;
  }

  private resolveEmoteImages(item: DanmakuRenderItem) {
    const images = new Map<string, CanvasImageSource>();
    for (const part of item.parts ?? []) {
      if (part.type !== "emote") continue;
      const image = danmakuEmoteImageCache.get(part.emote.url);
      if (image) {
        images.set(part.emote.url, image);
      } else {
        danmakuEmoteImageCache.request(part.emote.url);
      }
    }
    return images;
  }

  private refreshActiveEmoteTextures() {
    if (this.active.length === 0) return;

    for (const activeItem of this.active) {
      if (!activeItem.item.parts?.some((part) => part.type === "emote")) {
        continue;
      }
      const style = activeItem.style;
      const maxTextWidth = Math.max(40, this.width * style.maxTextWidthRatio);
      const texture = this.textureFactory.get(
        activeItem.item,
        style,
        maxTextWidth,
        this.resolveEmoteImages(activeItem.item)
      );
      activeItem.texture = texture;
      activeItem.width = texture.width;
      activeItem.height = texture.height;
    }
    this.dirty = true;
  }

  private reflowActiveItems({
    refreshResponsiveStyles = false,
    refreshTextures = false,
    refreshMotion = false,
    layoutStyle = this.style,
  }: {
    refreshResponsiveStyles?: boolean;
    refreshTextures?: boolean;
    refreshMotion?: boolean;
    layoutStyle?: DanmakuRenderStyle;
  } = {}) {
    removeExpiredDanmaku(this.active, this.clockMs);
    const items = [...this.active].sort(
      (left, right) =>
        left.startMs - right.startMs || left.id.localeCompare(right.id)
    );
    const placed: DanmakuMotionItem[] = [];

    for (const item of items) {
      item.baseStyle = resolveDanmakuLayoutStyle(item.baseStyle, layoutStyle);
      item.style = resolveDanmakuLayoutStyle(item.style, layoutStyle);
      if (refreshResponsiveStyles) {
        item.style = this.effectiveStyle(item.baseStyle);
      }
      const style = item.style;
      if (refreshMotion)
        item.durationMs = this.motionDuration(item.mode, style);
      if (refreshTextures) {
        const maxTextWidth = Math.max(40, this.width * style.maxTextWidthRatio);
        const texture = this.textureFactory.get(
          item.item,
          style,
          maxTextWidth,
          this.resolveEmoteImages(item.item)
        );
        item.texture = texture;
        item.width = texture.width;
        item.height = texture.height;
      }
      const lane = chooseDanmakuLane(
        placed,
        item,
        this.width,
        style.edgePadding,
        style.trackGap,
        this.trackCount
      );
      item.lane =
        lane ?? resolveDanmakuLaneRange(item.mode, this.trackCount).start;
      placed.push(item);
    }

    this.active = items;
  }

  private removeFilteredActiveItems() {
    this.active = this.active.filter((item) =>
      isDanmakuItemVisible(item.item, this.style)
    );
  }

  private motionDuration(
    mode: DanmakuMotionItem["mode"],
    style = this.effectiveStyle()
  ) {
    if (mode !== "scroll") return style.fixedDurationMs;

    return resolveDanmakuScrollDurationMs(
      this.width,
      style.edgePadding,
      style.scrollSpeedPxPerSecond * style.scale
    );
  }

  private effectiveStyle(baseStyle = this.style) {
    const responsiveScale = resolveDanmakuResponsiveScale(
      this.height,
      baseStyle
    );
    if (responsiveScale === 1) return baseStyle;
    return {
      ...baseStyle,
      scale: baseStyle.scale * responsiveScale,
    };
  }

  private updateLaneMetrics() {
    const style = this.effectiveStyle();
    const activeLaneHeight = this.active.reduce(
      (height, item) => Math.max(height, resolveDanmakuLaneHeight(item.style)),
      0
    );
    this.laneHeight = Math.max(
      resolveDanmakuLaneHeight(style),
      activeLaneHeight
    );
    const displayHeight = resolveDanmakuDisplayHeight(this.height, style);
    const usableHeight = Math.max(1, displayHeight - style.edgePadding * 2);
    this.trackCount = Math.max(
      1,
      Math.min(style.maxTracks, Math.floor(usableHeight / this.laneHeight))
    );
  }

  private maximumRuntimeDuration() {
    return (
      Math.max(this.motionDuration("scroll"), this.style.fixedDurationMs) +
      1_000
    );
  }

  private isSuppressedItem(item: DanmakuRenderItem) {
    if (this.suppressedTexts.size === 0) return false;
    const text = danmakuShoutText(item);
    return text !== null && this.suppressedTexts.has(text);
  }

  private visibleShouts() {
    const visible: DanmakuShout[] = [];
    for (const shout of this.shouts) {
      if (shout.startMs > this.clockMs || shout.endMs <= this.clockMs) continue;
      visible.push(shout);
      if (visible.length >= MAX_VISIBLE_SHOUTS) break;
    }
    return visible;
  }

  private renderShouts(context: CanvasRenderingContext2D) {
    if (
      !this.style.showFixed ||
      !this.style.showColor ||
      this.width <= 0 ||
      this.height <= 0
    ) {
      return;
    }

    const shouts = this.visibleShouts();
    if (shouts.length === 0) return;

    const style = this.effectiveStyle();
    const fontSize = Math.max(12, style.baseFontSize * style.scale);
    const countFontSize = Math.max(9, fontSize * 0.56);
    const mainFont = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    const countFont = `${style.fontStyle} ${style.fontWeight} ${countFontSize}px ${style.fontFamily}`;
    const maxWidth = Math.max(
      40,
      this.width * Math.min(style.maxTextWidthRatio, 0.9)
    );
    const displayHeight = resolveDanmakuDisplayHeight(this.height, style);
    const lineHeight = Math.ceil(fontSize * 1.5);

    context.save();
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.lineJoin = "round";
    context.miterLimit = 2;
    context.shadowColor = style.shadowColor;
    context.shadowBlur = Math.max(3, style.shadowBlur);
    context.shadowOffsetX = style.shadowOffsetX;
    context.shadowOffsetY = style.shadowOffsetY;

    shouts.forEach((shout, index) => {
      const countText = `\u00d7${resolveDanmakuShoutCount(
        shout,
        this.clockMs
      )}`;
      context.font = countFont;
      const countWidth = context.measureText(countText).width;
      const countGap = Math.max(2, fontSize * 0.12);
      const textMaxWidth = Math.max(1, maxWidth - countWidth - countGap);
      context.font = mainFont;
      const text = fitShoutText(context, shout.text, textMaxWidth);
      if (!text) return;

      const textWidth = context.measureText(text).width;
      const totalWidth = textWidth + countGap + countWidth;
      const x = (this.width - totalWidth) / 2;
      const y = style.edgePadding + fontSize + index * lineHeight;
      if (y + countFontSize > displayHeight) return;

      const phase = this.reducedMotion ? 0 : this.clockMs / 25;
      const gradient = context.createLinearGradient(
        x,
        y - fontSize,
        x + totalWidth,
        y
      );
      gradient.addColorStop(0, `hsl(${(phase + 8) % 360} 96% 68%)`);
      gradient.addColorStop(0.34, `hsl(${(phase + 86) % 360} 94% 64%)`);
      gradient.addColorStop(0.68, `hsl(${(phase + 178) % 360} 92% 67%)`);
      gradient.addColorStop(1, `hsl(${(phase + 282) % 360} 96% 66%)`);

      context.font = mainFont;
      context.fillStyle = gradient;
      context.strokeStyle = "rgba(0, 0, 0, 0.9)";
      context.lineWidth = Math.max(2.5, style.strokeWidth + 1.5);
      context.strokeText(text, x, y);
      context.fillText(text, x, y);

      context.font = countFont;
      const countX = x + textWidth + countGap;
      context.strokeText(countText, countX, y);
      context.fillText(countText, countX, y);
    });

    context.restore();
  }
}

function fitShoutText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
) {
  if (context.measureText(text).width <= maxWidth) return text;

  const characters = Array.from(text);
  const suffix = "...";
  if (context.measureText(suffix).width > maxWidth) return "";

  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${characters.slice(0, middle).join("")}${suffix}`;
    if (context.measureText(candidate).width <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return `${characters.slice(0, low).join("")}${suffix}`;
}
