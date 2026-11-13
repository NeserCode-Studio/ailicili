import type { DanmakuPart, DanmakuRenderItem } from "@/lib/danmaku/types";

function partsEqual(
  left: readonly DanmakuPart[] | undefined,
  right: readonly DanmakuPart[] | undefined
) {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;

  return left.every((part, index) => {
    const other = right[index];
    if (part.type !== other.type) return false;
    if (part.type === "text") {
      return other.type === "text" && part.text === other.text;
    }
    if (other.type !== "emote") return false;

    return (
      part.emote.id === other.emote.id &&
      part.emote.url === other.emote.url &&
      part.emote.width === other.emote.width &&
      part.emote.height === other.emote.height &&
      part.emote.label === other.emote.label &&
      part.emote.kind === other.emote.kind &&
      part.emote.animated === other.emote.animated
    );
  });
}

function renderItemsEqual(left: DanmakuRenderItem, right: DanmakuRenderItem) {
  return (
    left.id === right.id &&
    left.text === right.text &&
    left.timeMs === right.timeMs &&
    left.mode === right.mode &&
    left.fontSize === right.fontSize &&
    left.color === right.color &&
    partsEqual(left.parts, right.parts)
  );
}

export function canPreserveActiveDanmakuItems(
  activeItems: readonly DanmakuRenderItem[],
  nextItems: readonly DanmakuRenderItem[]
) {
  if (activeItems.length === 0) return false;
  const nextById = new Map(nextItems.map((item) => [item.id, item]));
  let overlapCount = 0;

  for (const activeItem of activeItems) {
    const nextItem = nextById.get(activeItem.id);
    if (!nextItem) continue;
    if (!renderItemsEqual(activeItem, nextItem)) return false;
    overlapCount += 1;
  }

  return overlapCount > 0;
}

export function lowerBoundByTime(
  items: readonly DanmakuRenderItem[],
  timeMs: number
) {
  let low = 0;
  let high = items.length;

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (items[middle].timeMs < timeMs) low = middle + 1;
    else high = middle;
  }

  return low;
}

export function upperBoundByTime(
  items: readonly DanmakuRenderItem[],
  timeMs: number
) {
  let low = 0;
  let high = items.length;

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (items[middle].timeMs <= timeMs) low = middle + 1;
    else high = middle;
  }

  return low;
}
