export type DanmakuMode = "scroll" | "top" | "bottom";

export type DanmakuEmoteKind = "official" | "room" | "emoji" | "other";

export interface DanmakuEmote {
  id: string;
  url: string;
  width: number;
  height: number;
  label: string;
  kind: DanmakuEmoteKind;
  animated: boolean;
}

export type DanmakuPart =
  { type: "text"; text: string } | { type: "emote"; emote: DanmakuEmote };

export interface DanmakuRenderItem {
  id: string;
  text: string;
  parts?: readonly DanmakuPart[];
  timeMs: number;
  mode: DanmakuMode;
  fontSize: number;
  color: number;
}

export interface DanmakuRenderStyle {
  fontFamily: string;
  fontWeight: number | string;
  fontStyle: "normal" | "italic";
  baseFontSize: number;
  scale: number;
  scaleWithPlayer: boolean;
  displayArea: number;
  avoidSubtitles: boolean;
  opacity: number;
  scrollSpeedPxPerSecond: number;
  strokeColor: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  fixedDurationMs: number;
  trackGap: number;
  edgePadding: number;
  maxOnScreen: number;
  maxTracks: number;
  maxDpr: number;
  canvasPixelBudget: number;
  texturePixelBudget: number;
  maxTextWidthRatio: number;
  showScroll: boolean;
  showFixed: boolean;
  showColor: boolean;
}

export const DEFAULT_DANMAKU_FONT_SIZE = 25;

export const DEFAULT_DANMAKU_STYLE: DanmakuRenderStyle = {
  fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
  fontWeight: 700,
  fontStyle: "normal",
  baseFontSize: DEFAULT_DANMAKU_FONT_SIZE,
  scale: 1,
  scaleWithPlayer: false,
  displayArea: 1,
  avoidSubtitles: false,
  opacity: 1,
  scrollSpeedPxPerSecond: 220,
  strokeColor: "rgba(0, 0, 0, 0.82)",
  strokeWidth: 1.5,
  shadowColor: "rgba(0, 0, 0, 0.55)",
  shadowBlur: 2,
  shadowOffsetX: 0,
  shadowOffsetY: 1,
  fixedDurationMs: 4_500,
  trackGap: 2,
  edgePadding: 12,
  maxOnScreen: 80,
  maxTracks: 32,
  maxDpr: 2,
  canvasPixelBudget: 8_388_608,
  texturePixelBudget: 12_582_912,
  maxTextWidthRatio: 0.82,
  showScroll: true,
  showFixed: true,
  showColor: true,
};

const MAX_TEXT_CODE_POINTS = 512;
const MAX_TEXT_INPUT_CODE_UNITS = 4_096;
const MAX_EMOTE_LABEL_CODE_POINTS = 96;
const MAX_EMOTE_ID_CODE_POINTS = 128;
const MAX_EMOTE_URL_LENGTH = 2_048;
const MAX_EMOTE_DIMENSION = 512;
const MAX_ITEM_PARTS = 24;
const MAX_ITEM_EMOTES = 8;
const BILIBILI_IMAGE_HOST_SUFFIXES = [
  "bilibili.com",
  "biliimg.com",
  "bilivideo.com",
  "hdslb.com",
] as const;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function sanitizeText(value: string, maximumCodePoints: number, trim: boolean) {
  const bounded =
    value.length > MAX_TEXT_INPUT_CODE_UNITS
      ? value.slice(0, MAX_TEXT_INPUT_CODE_UNITS)
      : value;
  const normalized = bounded.normalize("NFC");
  let cleaned = "";
  let codePoints = 0;

  for (const character of normalized) {
    if (codePoints >= maximumCodePoints) break;
    const codePoint = character.codePointAt(0) ?? 0;
    cleaned +=
      codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
        ? " "
        : character;
    codePoints += 1;
  }

  return trim ? cleaned.trim() : cleaned;
}

export function sanitizeDanmakuText(value: string) {
  return sanitizeText(value, MAX_TEXT_CODE_POINTS, true);
}

export function danmakuEmoteKind(identity: string): DanmakuEmoteKind {
  if (/^official_\d+$/i.test(identity)) return "official";
  if (/^room_\d+_\d+$/i.test(identity)) return "room";
  if (/^emoji_\d+$/i.test(identity)) return "emoji";
  return "other";
}

export function normalizeDanmakuEmoteUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const source = value.trim();
  if (!source || source.length > MAX_EMOTE_URL_LENGTH) return null;

  try {
    const url = new URL(source);
    if (url.username || url.password) return null;
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol !== "https:") return null;
    if (url.port && url.port !== "443") return null;

    const host = url.hostname.toLowerCase();
    if (
      !BILIBILI_IMAGE_HOST_SUFFIXES.some(
        (suffix) => host === suffix || host.endsWith(`.${suffix}`)
      )
    ) {
      return null;
    }

    url.hash = "";
    const normalized = url.toString();
    return normalized.length <= MAX_EMOTE_URL_LENGTH ? normalized : null;
  } catch {
    return null;
  }
}

export interface DanmakuEmoteInput {
  id: unknown;
  url: unknown;
  width: unknown;
  height: unknown;
  label?: unknown;
  animated?: unknown;
}

export function normalizeDanmakuEmote(
  input: DanmakuEmoteInput
): DanmakuEmote | null {
  if (typeof input.id !== "string") return null;
  const id = input.id.trim();
  if (
    !id ||
    Array.from(id).length > MAX_EMOTE_ID_CODE_POINTS ||
    !/^[a-z0-9][a-z0-9_.:-]*$/i.test(id)
  ) {
    return null;
  }

  const url = normalizeDanmakuEmoteUrl(input.url);
  if (!url) return null;

  const rawWidth = Number(input.width);
  const rawHeight = Number(input.height);
  if (
    !Number.isFinite(rawWidth) ||
    !Number.isFinite(rawHeight) ||
    rawWidth <= 0 ||
    rawHeight <= 0
  ) {
    return null;
  }

  const label =
    typeof input.label === "string"
      ? sanitizeText(input.label, MAX_EMOTE_LABEL_CODE_POINTS, true)
      : "";
  const animated =
    input.animated === true ||
    (typeof input.animated === "number" && input.animated > 0);

  return {
    id,
    url,
    width: Math.round(clamp(rawWidth, 1, MAX_EMOTE_DIMENSION)),
    height: Math.round(clamp(rawHeight, 1, MAX_EMOTE_DIMENSION)),
    label: label || "Emote",
    kind: danmakuEmoteKind(id),
    animated,
  };
}

export function normalizeDanmakuParts(
  parts: readonly DanmakuPart[] | undefined,
  fallbackText: string
): DanmakuPart[] {
  const source =
    parts && parts.length > 0
      ? parts.slice(0, MAX_ITEM_PARTS)
      : [{ type: "text", text: fallbackText } as const];
  const normalized: DanmakuPart[] = [];
  let usedTextCodePoints = 0;
  let emoteCount = 0;

  const appendText = (rawText: string) => {
    const remaining = MAX_TEXT_CODE_POINTS - usedTextCodePoints;
    if (remaining <= 0) return;
    const text = sanitizeText(rawText, remaining, false);
    if (!text) return;
    usedTextCodePoints += Array.from(text).length;

    const previous = normalized.at(-1);
    if (previous?.type === "text") {
      previous.text += text;
    } else {
      normalized.push({ type: "text", text });
    }
  };

  for (const part of source) {
    if (part.type === "text") {
      appendText(part.text);
      continue;
    }
    if (part.type !== "emote") continue;

    const emote = normalizeDanmakuEmote(part.emote);
    if (!emote || emoteCount >= MAX_ITEM_EMOTES) {
      appendText(
        source.length === 1
          ? fallbackText || part.emote.label || "Emote"
          : part.emote.label || "Emote"
      );
      continue;
    }

    normalized.push({ type: "emote", emote });
    emoteCount += 1;
  }

  return normalized.filter(
    (part) => part.type === "emote" || part.text.length > 0
  );
}

export function normalizeDanmakuFontSize(fontSize: number) {
  return clamp(
    Math.round(finiteOr(fontSize, DEFAULT_DANMAKU_FONT_SIZE)),
    12,
    72
  );
}

export function danmakuColorToCss(color: number) {
  const rgb = Math.max(0, Math.floor(finiteOr(color, 0xffffff))) & 0xffffff;
  return `#${rgb.toString(16).padStart(6, "0")}`;
}

export function resolveDanmakuStyle(
  style?: Partial<DanmakuRenderStyle>
): DanmakuRenderStyle {
  const merged = { ...DEFAULT_DANMAKU_STYLE, ...style };

  return {
    fontFamily: merged.fontFamily.trim() || DEFAULT_DANMAKU_STYLE.fontFamily,
    fontWeight: merged.fontWeight,
    fontStyle: merged.fontStyle === "italic" ? "italic" : "normal",
    baseFontSize: clamp(
      finiteOr(merged.baseFontSize, DEFAULT_DANMAKU_FONT_SIZE),
      12,
      72
    ),
    scale: clamp(finiteOr(merged.scale, 1), 0.25, 3),
    scaleWithPlayer: merged.scaleWithPlayer === true,
    displayArea: clamp(finiteOr(merged.displayArea, 1), 0.1, 1),
    avoidSubtitles: merged.avoidSubtitles === true,
    opacity: clamp(finiteOr(merged.opacity, 1), 0, 1),
    scrollSpeedPxPerSecond: clamp(
      finiteOr(merged.scrollSpeedPxPerSecond, 220),
      40,
      800
    ),
    strokeColor: merged.strokeColor,
    strokeWidth: clamp(finiteOr(merged.strokeWidth, 1.5), 0, 12),
    shadowColor: merged.shadowColor,
    shadowBlur: clamp(finiteOr(merged.shadowBlur, 2), 0, 24),
    shadowOffsetX: clamp(finiteOr(merged.shadowOffsetX, 0), -24, 24),
    shadowOffsetY: clamp(finiteOr(merged.shadowOffsetY, 1), -24, 24),
    fixedDurationMs: clamp(
      finiteOr(merged.fixedDurationMs, 4_500),
      1_000,
      15_000
    ),
    trackGap: clamp(finiteOr(merged.trackGap, 8), 0, 48),
    edgePadding: clamp(finiteOr(merged.edgePadding, 12), 0, 120),
    maxOnScreen: Math.round(clamp(finiteOr(merged.maxOnScreen, 80), 1, 200)),
    maxTracks: Math.round(clamp(finiteOr(merged.maxTracks, 32), 1, 64)),
    maxDpr: clamp(finiteOr(merged.maxDpr, 2), 1, 2),
    canvasPixelBudget: Math.round(
      clamp(
        finiteOr(merged.canvasPixelBudget, 8_388_608),
        1_000_000,
        64_000_000
      )
    ),
    texturePixelBudget: Math.round(
      clamp(
        finiteOr(merged.texturePixelBudget, 12_582_912),
        1_000_000,
        64_000_000
      )
    ),
    maxTextWidthRatio: clamp(finiteOr(merged.maxTextWidthRatio, 0.82), 0.2, 1),
    showScroll: merged.showScroll !== false,
    showFixed: merged.showFixed !== false,
    showColor: merged.showColor !== false,
  };
}

export function filterDanmakuItems(
  items: readonly DanmakuRenderItem[],
  filters: Pick<DanmakuRenderStyle, "showScroll" | "showFixed" | "showColor">
): readonly DanmakuRenderItem[] {
  if (filters.showScroll && filters.showFixed && filters.showColor) {
    return items;
  }

  return items.filter((item) => isDanmakuItemVisible(item, filters));
}

export function isDanmakuItemVisible(
  item: DanmakuRenderItem,
  filters: Pick<DanmakuRenderStyle, "showScroll" | "showFixed" | "showColor">
) {
  if (item.mode === "scroll" && !filters.showScroll) return false;
  if (item.mode !== "scroll" && !filters.showFixed) return false;
  if (!filters.showColor && item.color !== 0xffffff) return false;
  return true;
}

export function normalizeDanmakuItems(
  items: readonly DanmakuRenderItem[]
): DanmakuRenderItem[] {
  const unique = new Map<string, DanmakuRenderItem>();

  items.forEach((item, index) => {
    const text = sanitizeDanmakuText(item.text);
    const parts = normalizeDanmakuParts(item.parts, text);
    const visibleText =
      text ||
      parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("")
        .trim();
    const hasEmote = parts.some((part) => part.type === "emote");
    if (
      (!visibleText && !hasEmote) ||
      !Number.isFinite(item.timeMs) ||
      item.timeMs < 0 ||
      (item.mode !== "scroll" && item.mode !== "top" && item.mode !== "bottom")
    ) {
      return;
    }

    const id = item.id.trim() || `${item.timeMs}:${item.mode}:${index}`;
    if (unique.has(id)) return;

    unique.set(id, {
      id,
      text:
        visibleText ||
        parts.find((part) => part.type === "emote")?.emote.label ||
        "Emote",
      parts,
      timeMs: item.timeMs,
      mode: item.mode,
      fontSize: normalizeDanmakuFontSize(item.fontSize),
      color: Math.max(0, Math.floor(finiteOr(item.color, 0xffffff))) & 0xffffff,
    });
  });

  return Array.from(unique.values()).sort(
    (left, right) =>
      left.timeMs - right.timeMs || left.id.localeCompare(right.id)
  );
}
