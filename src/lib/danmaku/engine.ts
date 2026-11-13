import { resolveDanmakuCanvasDpr } from "@/lib/danmaku/canvas";
import {
  chooseDanmakuLane,
  removeExpiredDanmaku,
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
  canPreserveActiveDanmakuItems,
  lowerBoundByTime,
  upperBoundByTime,
} from "@/lib/danmaku/timeline";
import {
  normalizeDanmakuItems,
  resolveDanmakuStyle,
  type DanmakuRenderItem,
  type DanmakuRenderStyle,
} from "@/lib/danmaku/types";

const SEEK_THRESHOLD_MS = 650;
const MAX_FRAME_DELTA_MS = 1_000;

interface ActiveDanmaku extends DanmakuMotionItem {
  item: DanmakuRenderItem;
  texture: DanmakuTexture;
}

export interface DanmakuEngineStats {
  activeCount: number;
  cachedTextureCount: number;
  cachedTexturePixels: number;
  dpr: number;
  trackCount: number;
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
  private width = 0;
  private height = 0;
  private dpr = 1;
  private trackCount = 1;
  private laneHeight = 32;
  private clockMs = 0;
  private nextIndex = 0;
  private initialized = false;
  private playing = false;
  private playbackRate = 1;
  private visible = true;
  private dirty = true;
  private emoteImagesChanged = false;
  private lastFrameTime: number | null = null;

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
    this.normalizedItems = normalizeDanmakuItems(items);
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

  setStyle(style: Partial<DanmakuRenderStyle>) {
    const resolved = resolveDanmakuStyle(style);
    if (JSON.stringify(resolved) === JSON.stringify(this.style)) return;

    this.style = resolved;
    this.textureFactory.setPixelBudget(resolved.texturePixelBudget);
    this.textureFactory.invalidate();
    this.updateLaneMetrics();
    this.rebuildAt(this.clockMs);
  }

  setMediaTime(timeMs: number) {
    const nextTime = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0);
    const shouldRebuild =
      !this.initialized ||
      Math.abs(nextTime - this.clockMs) > SEEK_THRESHOLD_MS;

    if (shouldRebuild) {
      this.rebuildAt(nextTime);
      return;
    }

    this.clockMs = nextTime;
    removeExpiredDanmaku(this.active, nextTime);
    if (this.playing) this.spawnThrough(nextTime);
    this.dirty = true;
  }

  setPlaying(playing: boolean) {
    if (this.playing === playing) return;
    this.playing = playing;
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

    this.width = cssWidth;
    this.height = cssHeight;
    this.dpr = nextDpr;
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    this.textureFactory.setRasterScale(nextDpr);
    this.updateLaneMetrics();
    this.reflowActiveItems();
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
      this.clockMs += deltaMs * this.playbackRate;
      removeExpiredDanmaku(this.active, this.clockMs);
      this.spawnThrough(this.clockMs);
      this.render();
      return;
    }

    if (this.dirty) this.render();
  }

  render() {
    if (!this.visible || this.width <= 0 || this.height <= 0) {
      this.dirty = false;
      return;
    }

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
      const x =
        item.mode === "scroll"
          ? resolveDanmakuScrollX(
              item,
              this.clockMs,
              this.width,
              this.style.edgePadding
            )
          : (this.width - item.width) / 2;
      const y =
        this.style.edgePadding +
        item.lane * this.laneHeight +
        (this.laneHeight - item.height) / 2;

      if (
        x + item.width < -this.style.edgePadding ||
        x > this.width + this.style.edgePadding
      ) {
        continue;
      }

      context.drawImage(item.texture.canvas, x, y, item.width, item.height);
    }

    context.restore();
    this.dirty = false;
  }

  getStats(): DanmakuEngineStats {
    return {
      activeCount: this.active.length,
      cachedTextureCount: this.textureFactory.cachedTextureCount,
      cachedTexturePixels: this.textureFactory.cachedTexturePixels,
      dpr: this.dpr,
      trackCount: this.trackCount,
    };
  }

  dispose() {
    this.unsubscribeEmoteImages();
    this.active = [];
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

  private spawnThrough(timeMs: number) {
    while (
      this.nextIndex < this.normalizedItems.length &&
      this.normalizedItems[this.nextIndex].timeMs <= timeMs
    ) {
      const item = this.normalizedItems[this.nextIndex];
      this.spawnItem(item, item.timeMs);
      this.nextIndex += 1;
    }
  }

  private spawnItem(item: DanmakuRenderItem, spawnTimeMs: number) {
    removeExpiredDanmaku(this.active, spawnTimeMs);
    if (this.active.length >= this.style.maxOnScreen) return;

    const maxTextWidth = Math.max(
      40,
      this.width * this.style.maxTextWidthRatio
    );
    const emoteImages = this.resolveEmoteImages(item);
    const texture = this.textureFactory.get(
      item,
      this.style,
      maxTextWidth,
      emoteImages
    );
    const durationMs = this.motionDuration(item.mode);
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
      this.style.edgePadding,
      this.style.trackGap,
      this.trackCount
    );
    if (lane === null) return;

    this.active.push({
      ...motionCandidate,
      lane,
      item,
      texture,
    });
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
    const maxTextWidth = Math.max(
      40,
      this.width * this.style.maxTextWidthRatio
    );

    for (const activeItem of this.active) {
      if (!activeItem.item.parts?.some((part) => part.type === "emote")) {
        continue;
      }
      activeItem.texture = this.textureFactory.get(
        activeItem.item,
        this.style,
        maxTextWidth,
        this.resolveEmoteImages(activeItem.item)
      );
    }
    this.dirty = true;
  }

  private reflowActiveItems() {
    removeExpiredDanmaku(this.active, this.clockMs);
    const items = [...this.active].sort(
      (left, right) =>
        left.startMs - right.startMs || left.id.localeCompare(right.id)
    );
    const placed: DanmakuMotionItem[] = [];

    for (const item of items) {
      item.durationMs = this.motionDuration(item.mode);
      const lane = chooseDanmakuLane(
        placed,
        item,
        this.width,
        this.style.edgePadding,
        this.style.trackGap,
        this.trackCount
      );
      item.lane =
        lane ?? resolveDanmakuLaneRange(item.mode, this.trackCount).start;
      placed.push(item);
    }

    this.active = items;
  }

  private motionDuration(mode: DanmakuMotionItem["mode"]) {
    if (mode !== "scroll") return this.style.fixedDurationMs;

    return resolveDanmakuScrollDurationMs(
      this.width,
      this.style.edgePadding,
      this.style.scrollSpeedPxPerSecond * this.style.scale
    );
  }

  private updateLaneMetrics() {
    this.laneHeight = resolveDanmakuLaneHeight(this.style);
    const usableHeight = Math.max(1, this.height - this.style.edgePadding * 2);
    this.trackCount = Math.max(
      1,
      Math.min(this.style.maxTracks, Math.floor(usableHeight / this.laneHeight))
    );
  }

  private maximumRuntimeDuration() {
    return (
      Math.max(this.motionDuration("scroll"), this.style.fixedDurationMs) +
      1_000
    );
  }
}
