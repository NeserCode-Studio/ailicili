import { resolveDanmakuEmoteDisplaySize } from "@/lib/danmaku/layout";
import { PixelLruCache } from "@/lib/danmaku/pixel-cache";
import {
  danmakuColorToCss,
  type DanmakuRenderItem,
  type DanmakuRenderStyle,
} from "@/lib/danmaku/types";

export interface DanmakuTexture {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  text: string;
}

type EmoteImages = ReadonlyMap<string, CanvasImageSource>;

type TexturePartKey =
  ["text", string] | ["emote", string, string, number, number, string];

interface TextureKey {
  parts: TexturePartKey[];
  fontFamily: string;
  fontWeight: number | string;
  fontStyle: string;
  fontSize: number;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  rasterScale: number;
  maxWidth: number;
}

type DisplayUnit =
  | { type: "text"; text: string; width: number }
  | {
      type: "image";
      image: CanvasImageSource | null;
      label: string;
      width: number;
      height: number;
    };

function textureCacheKey(key: TextureKey) {
  return JSON.stringify([
    key.parts,
    key.fontFamily,
    key.fontWeight,
    key.fontStyle,
    key.fontSize,
    key.fillColor,
    key.strokeColor,
    key.strokeWidth,
    key.shadowColor,
    key.shadowBlur,
    key.shadowOffsetX,
    key.shadowOffsetY,
    key.rasterScale,
    key.maxWidth,
  ]);
}

function itemParts(item: DanmakuRenderItem) {
  return item.parts?.length
    ? item.parts
    : [{ type: "text" as const, text: item.text }];
}

function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
) {
  if (maxWidth <= 0) return "";
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

export class DanmakuTextureFactory {
  private readonly scratchContext: CanvasRenderingContext2D;
  private readonly cache: PixelLruCache<string, DanmakuTexture>;
  private rasterScale = 1;

  constructor(pixelBudget: number) {
    const scratch = document.createElement("canvas");
    const context = scratch.getContext("2d");
    if (!context) throw new Error("Unable to create danmaku text context");

    this.scratchContext = context;
    this.cache = new PixelLruCache(pixelBudget);
  }

  get cachedTextureCount() {
    return this.cache.size;
  }

  get cachedTexturePixels() {
    return this.cache.pixelCount;
  }

  setPixelBudget(pixelBudget: number) {
    this.cache.setBudget(pixelBudget);
  }

  setRasterScale(scale: number) {
    const normalized = Math.max(1, scale);
    if (Math.abs(normalized - this.rasterScale) < 0.01) return;
    // Active textures remain valid until they expire; new textures use this scale.
    this.rasterScale = normalized;
  }

  invalidate() {
    this.cache.clear();
  }

  get(
    item: DanmakuRenderItem,
    style: DanmakuRenderStyle,
    maxWidth: number,
    emoteImages: EmoteImages
  ) {
    const fontSize = item.fontSize * style.scale;
    const fillColor = danmakuColorToCss(item.color);
    const key: TextureKey = {
      parts: itemParts(item).map((part): TexturePartKey => {
        if (part.type === "text") return ["text", part.text];
        return [
          "emote",
          part.emote.id,
          part.emote.url,
          part.emote.width,
          part.emote.height,
          part.emote.label,
        ];
      }),
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      fontSize,
      fillColor,
      strokeColor: style.strokeColor,
      strokeWidth: style.strokeWidth,
      shadowColor: style.shadowColor,
      shadowBlur: style.shadowBlur,
      shadowOffsetX: style.shadowOffsetX,
      shadowOffsetY: style.shadowOffsetY,
      rasterScale: this.rasterScale,
      maxWidth,
    };
    const serializedKey = textureCacheKey(key);
    const cached = this.cache.get(serializedKey);
    if (cached) return cached;

    const texture = this.createTexture(
      item,
      style,
      maxWidth,
      fontSize,
      fillColor,
      emoteImages
    );
    this.cache.set(
      serializedKey,
      texture,
      texture.canvas.width * texture.canvas.height
    );
    return texture;
  }

  private createTexture(
    item: DanmakuRenderItem,
    style: DanmakuRenderStyle,
    maxWidth: number,
    fontSize: number,
    fillColor: string,
    emoteImages: EmoteImages
  ): DanmakuTexture {
    const font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    this.scratchContext.font = font;
    const units = this.buildDisplayUnits(item, style, fontSize, emoteImages);
    const fittedUnits = this.fitDisplayUnits(units, Math.max(40, maxWidth));
    const typography = this.measureTypography(fittedUnits, font, fontSize);
    const hasVisualContent = fittedUnits.some(
      (unit) => unit.type === "text" || unit.type === "image"
    );
    const maximumImageHeight = fittedUnits.reduce(
      (maximum, unit) =>
        unit.type === "image" ? Math.max(maximum, unit.height) : maximum,
      0
    );
    const contentHeight = Math.max(1, typography.height, maximumImageHeight);
    const basePadding = hasVisualContent
      ? Math.ceil(style.strokeWidth / 2 + style.shadowBlur * 2 + 2)
      : 1;
    const leftPadding =
      basePadding + Math.ceil(Math.max(0, -style.shadowOffsetX));
    const rightPadding =
      basePadding + Math.ceil(Math.max(0, style.shadowOffsetX));
    const topPadding =
      basePadding + Math.ceil(Math.max(0, -style.shadowOffsetY));
    const bottomPadding =
      basePadding + Math.ceil(Math.max(0, style.shadowOffsetY));
    const contentWidth = fittedUnits.reduce(
      (width, unit) => width + unit.width,
      0
    );
    const logicalWidth = Math.ceil(contentWidth + leftPadding + rightPadding);
    const logicalHeight = Math.ceil(contentHeight + topPadding + bottomPadding);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(logicalWidth * this.rasterScale));
    canvas.height = Math.max(1, Math.ceil(logicalHeight * this.rasterScale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to create danmaku texture");

    context.scale(this.rasterScale, this.rasterScale);
    context.clearRect(0, 0, logicalWidth, logicalHeight);
    context.font = font;
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.lineJoin = "round";
    context.miterLimit = 2;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = fillColor;
    context.strokeStyle = style.strokeColor;
    context.lineWidth = style.strokeWidth;

    let x = leftPadding;
    const textBaseline =
      topPadding + (contentHeight - typography.height) / 2 + typography.ascent;

    for (const unit of fittedUnits) {
      if (unit.type === "image") {
        const y = topPadding + (contentHeight - unit.height) / 2;
        if (unit.image) {
          context.drawImage(unit.image, x, y, unit.width, unit.height);
        } else {
          drawEmotePlaceholder(context, unit, x, y, font, fillColor, style);
        }
      } else {
        context.font = font;
        context.textAlign = "left";
        context.textBaseline = "alphabetic";
        context.shadowColor = style.shadowColor;
        context.shadowBlur = style.shadowBlur;
        context.shadowOffsetX = style.shadowOffsetX;
        context.shadowOffsetY = style.shadowOffsetY;
        if (style.strokeWidth > 0) {
          context.strokeText(unit.text, x, textBaseline);
        }
        context.shadowColor = "transparent";
        context.shadowBlur = 0;
        context.shadowOffsetX = 0;
        context.shadowOffsetY = 0;
        context.fillText(unit.text, x, textBaseline);
      }
      x += unit.width;
    }

    return {
      canvas,
      width: logicalWidth,
      height: logicalHeight,
      text: item.text,
    };
  }

  private buildDisplayUnits(
    item: DanmakuRenderItem,
    style: DanmakuRenderStyle,
    fontSize: number,
    emoteImages: EmoteImages
  ) {
    const units: DisplayUnit[] = [];
    for (const part of itemParts(item)) {
      if (part.type === "text") {
        if (!part.text) continue;
        units.push({
          type: "text",
          text: part.text,
          width: this.scratchContext.measureText(part.text).width,
        });
        continue;
      }

      const size = resolveDanmakuEmoteDisplaySize(part.emote, fontSize, style);
      units.push({
        type: "image",
        image: emoteImages.get(part.emote.url) ?? null,
        label: part.emote.label || "Emote",
        ...size,
      });
    }

    if (units.length === 0) {
      units.push({
        type: "text",
        text: item.text,
        width: this.scratchContext.measureText(item.text).width,
      });
    }
    return units.slice(0, 24);
  }

  private fitDisplayUnits(units: DisplayUnit[], maxWidth: number) {
    const fitted: DisplayUnit[] = [];
    let usedWidth = 0;

    for (const unit of units) {
      const remaining = maxWidth - usedWidth;
      if (remaining <= 0) break;
      if (unit.width <= remaining) {
        fitted.push(unit);
        usedWidth += unit.width;
        continue;
      }

      if (unit.type === "text") {
        const text = fitText(this.scratchContext, unit.text, remaining);
        if (text) {
          fitted.push({
            ...unit,
            text,
            width: this.scratchContext.measureText(text).width,
          });
        }
      } else if (remaining >= 2) {
        const scale = remaining / unit.width;
        fitted.push({
          ...unit,
          width: remaining,
          height: Math.max(1, unit.height * scale),
        });
      }
      break;
    }

    if (fitted.length === 0) {
      const text = fitText(this.scratchContext, itemFallback(units), maxWidth);
      if (text) {
        fitted.push({
          type: "text",
          text,
          width: this.scratchContext.measureText(text).width,
        });
      }
    }
    return fitted;
  }

  private measureTypography(
    units: readonly DisplayUnit[],
    font: string,
    fontSize: number
  ) {
    this.scratchContext.font = font;
    const baseMetrics = this.scratchContext.measureText("Mg");
    let ascent = Math.max(
      fontSize * 0.82,
      baseMetrics.actualBoundingBoxAscent || 0
    );
    let descent = Math.max(
      fontSize * 0.22,
      baseMetrics.actualBoundingBoxDescent || 0
    );

    for (const unit of units) {
      if (unit.type !== "text") continue;
      const metrics = this.scratchContext.measureText(unit.text);
      ascent = Math.max(ascent, metrics.actualBoundingBoxAscent || 0);
      descent = Math.max(descent, metrics.actualBoundingBoxDescent || 0);
    }

    return {
      ascent,
      descent,
      height: ascent + descent,
    };
  }
}

function drawEmotePlaceholder(
  context: CanvasRenderingContext2D,
  unit: Extract<DisplayUnit, { type: "image" }>,
  x: number,
  y: number,
  font: string,
  fillColor: string,
  style: DanmakuRenderStyle
) {
  const label = fitText(context, unit.label, Math.max(1, unit.width - 4));
  if (!label) return;

  context.save();
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = fillColor;
  context.strokeStyle = style.strokeColor;
  context.lineWidth = style.strokeWidth;
  context.shadowColor = style.shadowColor;
  context.shadowBlur = style.shadowBlur;
  context.shadowOffsetX = style.shadowOffsetX;
  context.shadowOffsetY = style.shadowOffsetY;
  const centerX = x + unit.width / 2;
  const centerY = y + unit.height / 2;
  if (style.strokeWidth > 0) {
    context.strokeText(label, centerX, centerY);
  }
  context.shadowColor = "transparent";
  context.fillText(label, centerX, centerY);
  context.restore();
}

function itemFallback(units: readonly DisplayUnit[]) {
  const text = units
    .flatMap((unit) => (unit.type === "text" ? [unit.text] : []))
    .join("");
  return text || "Emote";
}
