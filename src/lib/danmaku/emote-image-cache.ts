import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const BILIBILI_ORIGIN = "https://www.bilibili.com";
const BILIBILI_REFERER = `${BILIBILI_ORIGIN}/`;
const IMAGE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1_024;
const MAX_SOURCE_PIXELS = 8_388_608;
const MAX_CACHED_IMAGES = 64;
const MAX_PENDING_IMAGES = 256;
const MAX_CONCURRENT_DOWNLOADS = 4;
const MAX_FAILED_IMAGES = 256;

interface CachedImage {
  image: ImageBitmap;
  pixels: number;
}

type CacheListener = () => void;

export class DanmakuEmoteImageCache {
  private readonly entries = new Map<string, CachedImage>();
  private readonly pending = new Set<string>();
  private readonly queue: string[] = [];
  private readonly failed = new Set<string>();
  private readonly listeners = new Set<CacheListener>();
  private activeDownloads = 0;
  private cachedPixels = 0;

  get(source: string) {
    const entry = this.entries.get(source);
    if (!entry) return undefined;

    this.entries.delete(source);
    this.entries.set(source, entry);
    return entry.image;
  }

  request(source: string) {
    if (
      this.entries.has(source) ||
      this.pending.has(source) ||
      this.failed.has(source)
    ) {
      return;
    }
    if (this.pending.size >= MAX_PENDING_IMAGES) {
      this.rememberFailure(source);
      return;
    }

    this.pending.add(source);
    this.queue.push(source);
    this.pump();
  }

  subscribe(listener: CacheListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear() {
    for (const entry of this.entries.values()) entry.image.close();
    this.entries.clear();
    this.pending.clear();
    this.queue.length = 0;
    this.failed.clear();
    this.cachedPixels = 0;
    this.emit();
  }

  private pump() {
    while (
      this.activeDownloads < MAX_CONCURRENT_DOWNLOADS &&
      this.queue.length > 0
    ) {
      const source = this.queue.shift();
      if (!source || !this.pending.has(source)) continue;
      this.activeDownloads += 1;
      void this.load(source).finally(() => {
        this.activeDownloads -= 1;
        this.pump();
      });
    }
  }

  private async load(source: string) {
    try {
      const response = isTauri()
        ? await tauriFetch(source, {
            method: "GET",
            headers: {
              Accept: IMAGE_ACCEPT,
              "User-Agent": IMAGE_USER_AGENT,
              Origin: BILIBILI_ORIGIN,
              Referer: BILIBILI_REFERER,
            },
          })
        : await fetch(source, {
            method: "GET",
            headers: { Accept: IMAGE_ACCEPT },
          });
      if (!response.ok) throw new Error("emote image request failed");

      const contentType = response.headers.get("content-type");
      if (contentType && !contentType.toLowerCase().startsWith("image/")) {
        throw new Error("unexpected emote image content type");
      }

      const buffer = await readImageResponse(response);
      const blob = new Blob([buffer], {
        type: contentType || "application/octet-stream",
      });
      const image = await createImageBitmap(blob);
      const pixels = image.width * image.height;
      if (
        image.width <= 0 ||
        image.height <= 0 ||
        image.width > MAX_IMAGE_DIMENSION ||
        image.height > MAX_IMAGE_DIMENSION ||
        pixels > MAX_SOURCE_PIXELS
      ) {
        image.close();
        throw new Error("emote image dimensions are invalid");
      }

      this.pending.delete(source);
      this.failed.delete(source);
      this.entries.set(source, { image, pixels });
      this.cachedPixels += pixels;
      this.evict();
      this.emit();
    } catch {
      this.pending.delete(source);
      this.rememberFailure(source);
    }
  }

  private evict() {
    while (
      this.entries.size > MAX_CACHED_IMAGES ||
      this.cachedPixels > MAX_SOURCE_PIXELS
    ) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (oldest) {
        this.cachedPixels -= oldest.pixels;
        oldest.image.close();
      }
    }
  }

  private rememberFailure(source: string) {
    this.failed.add(source);
    if (this.failed.size > MAX_FAILED_IMAGES) {
      const oldest = this.failed.values().next().value as string | undefined;
      if (oldest) this.failed.delete(oldest);
    }
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}

async function readImageResponse(response: Response) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) {
      throw new Error("emote image size is invalid");
    }
  }

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength <= 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("emote image size is invalid");
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;

      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error("emote image size is invalid");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (total <= 0) throw new Error("emote image size is invalid");
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

export const danmakuEmoteImageCache = new DanmakuEmoteImageCache();
