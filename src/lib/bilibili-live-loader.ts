import { BaseLoader, type LoaderResponse } from "hls.js";
import mpegts from "mpegts.js";

import { openLiveMediaStream, type LiveMediaStream } from "@/api/live";
import { createLogger } from "@/lib/logger";

const LIVE_ACCEPT = "*/*";
const REQUEST_TIMEOUT_MS = 20_000;
const FLV_READ_IDLE_TIMEOUT_MS = 10_000;
const liveLog = createLogger("Media/LiveStreamLoader");

interface SeekConfig {
  url: string;
  headers: Headers | object;
}

interface SeekHandler {
  getConfig(sourceURL: string, range: { from: number; to: number }): SeekConfig;
}

interface FlvLoaderConfig {
  reuseRedirectedURL?: boolean;
  headers?: Record<string, string>;
}

interface FlvDataSource {
  url?: string;
  redirectedURL?: string;
}

interface FlvRange {
  from: number;
  to: number;
}

function liveRequestHeaders(initial?: HeadersInit) {
  const headers = new Headers(initial);
  headers.set("Accept", LIVE_ACCEPT);
  return headers;
}

function appendHeaders(target: Headers, source?: Headers | object) {
  if (!source) return;
  if (source instanceof Headers) {
    source.forEach((value, key) => target.set(key, value));
    return;
  }
  Object.entries(source).forEach(([key, value]) => {
    if (typeof value === "string") target.set(key, value);
  });
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function streamErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Live media request failed";
}

function logLiveMediaStart(start: LiveMediaStream["start"]) {
  let host = "<invalid>";
  let queryKeys: string[] = [];
  try {
    const parsed = new URL(start.url);
    host = parsed.hostname;
    queryKeys = Array.from(new Set(parsed.searchParams.keys())).sort();
  } catch {
    // The diagnostic must not throw before the loader can handle the response.
  }
  liveLog.debug("live media response", {
    status: start.status,
    statusText: start.statusText,
    httpVersion: start.httpVersion,
    host,
    queryKeys,
    headerNames: Object.keys(start.headers).sort(),
    requestIdPresent: Boolean(start.requestId),
  });
}

function mergeChunks(chunks: Uint8Array[]): ArrayBuffer {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const merged = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return merged.buffer;
}

function decodeChunks(chunks: Uint8Array[]): string {
  const decoder = new TextDecoder();
  let text = "";
  chunks.forEach((chunk) => {
    text += decoder.decode(chunk, { stream: true });
  });
  return text + decoder.decode();
}

function responseData(
  responseType: string | undefined,
  chunks: Uint8Array[]
): LoaderResponse["data"] {
  return responseType === "arraybuffer"
    ? mergeChunks(chunks)
    : decodeChunks(chunks);
}

// The playback API is authenticated, while media is fetched anonymously with
// the signed URL and Bilibili live request headers, matching active recorders.
export class LiveHlsLoader extends BaseLoader {
  private stream: LiveMediaStream | null = null;
  private requestToken: object | null = null;
  private timedOut = false;
  private failed = false;
  private started = false;
  private chunks: Uint8Array[] = [];
  private byteLength = 0;
  private responseCode = 0;
  private responseUrl = "";
  private responseHeaders = new Headers();

  protected loadInternal(): void {
    const { context, config, callbacks } = this;
    if (!context || !config) return;

    const token = {};
    this.requestToken = token;
    this.timedOut = false;
    this.failed = false;
    this.started = false;
    this.chunks = [];
    this.byteLength = 0;
    this.responseCode = 0;
    this.responseUrl = "";
    this.responseHeaders = new Headers();
    this.stats.loading.first = 0;
    this.stats.loaded = 0;
    this.stats.aborted = false;

    const headers = liveRequestHeaders(context.headers);
    if (context.rangeEnd) {
      headers.set(
        "Range",
        `bytes=${context.rangeStart ?? 0}-${context.rangeEnd - 1}`
      );
    }

    const timeoutMs = Number.isFinite(config.loadPolicy.maxLoadTimeMs)
      ? Math.max(config.loadPolicy.maxLoadTimeMs, 1)
      : REQUEST_TIMEOUT_MS;
    this.requestTimeout = window.setTimeout(() => {
      if (this.requestToken !== token) return;
      this.timedOut = true;
      this.requestToken = null;
      this.stream?.cancel();
      this.stream = null;
      callbacks?.onTimeout(this.stats, context, null);
    }, timeoutMs);

    const fail = (code: number, text: string) => {
      if (this.requestToken !== token || this.timedOut || this.failed) return;
      this.failed = true;
      this.clearRequestTimeout();
      this.requestToken = null;
      this.stream?.cancel();
      this.stream = null;
      callbacks?.onError({ code, text }, context, null, this.stats);
    };

    const succeed = () => {
      if (
        this.requestToken !== token ||
        this.timedOut ||
        this.failed ||
        !this.started
      ) {
        return;
      }
      this.clearRequestTimeout();
      const data = responseData(context.responseType, this.chunks);
      const size = this.byteLength;
      this.stats.loading.end = Math.max(
        performance.now(),
        this.stats.loading.first
      );
      this.stats.loaded = this.stats.total = size;
      this.stats.chunkCount = this.chunks.length;
      this.stats.bwEstimate =
        (size * 8000) /
        Math.max(this.stats.loading.end - this.stats.loading.first, 1);
      const responseUrl = this.responseUrl || context.url;
      this.requestToken = null;
      this.stream = null;
      callbacks?.onProgress?.(this.stats, context, data as never, null);
      callbacks?.onSuccess(
        {
          url: responseUrl,
          data,
          code: this.responseCode || 200,
        },
        this.stats,
        context,
        null
      );
    };

    const readStream = async () => {
      let stream: LiveMediaStream | null = null;
      try {
        stream = await openLiveMediaStream(
          context.url,
          headersToRecord(headers)
        );
        if (this.requestToken !== token || this.timedOut || this.failed) {
          stream.cancel();
          return;
        }
        this.stream = stream;
        const start = stream.start;
        logLiveMediaStart(start);
        this.responseHeaders = new Headers(start.headers);
        this.responseCode = start.status;
        this.responseUrl = start.url || context.url;
        if (start.status < 200 || start.status >= 300) {
          fail(start.status, start.statusText || "media request failed");
          return;
        }

        this.started = true;
        this.stats.loading.first = performance.now();
        while (this.requestToken === token && !this.timedOut && !this.failed) {
          const chunk = await stream.read();
          if (chunk === null) break;
          if (chunk.byteLength === 0) continue;
          this.chunks.push(new Uint8Array(chunk));
          this.byteLength += chunk.byteLength;
          this.stats.loaded = this.byteLength;
        }
        succeed();
      } catch (error) {
        fail(0, streamErrorMessage(error));
      }
    };
    void readStream();
  }

  protected abortInternal(): void {
    this.clearRequestTimeout();
    const stream = this.stream;
    const hadRequest = this.requestToken !== null;
    this.requestToken = null;
    this.stream = null;
    if (hadRequest) {
      this.stats.aborted = true;
      stream?.cancel();
    }
  }

  protected getNetworkDetails(): null {
    return null;
  }

  protected resetInternalLoader(): void {
    this.requestToken = null;
    this.stream = null;
    this.chunks = [];
    this.byteLength = 0;
    this.started = false;
    this.failed = false;
    this.timedOut = false;
    this.responseHeaders = new Headers();
  }

  getCacheAge(): number | null {
    const value = this.responseHeaders.get("age");
    if (!value) return null;
    const age = Number.parseFloat(value);
    return Number.isFinite(age) ? age : null;
  }

  getResponseHeader(name: string): string | null {
    return this.responseHeaders.get(name);
  }

  private clearRequestTimeout(): void {
    if (this.requestTimeout === undefined) return;
    window.clearTimeout(this.requestTimeout);
    this.requestTimeout = undefined;
  }
}

export class LiveFlvLoader extends mpegts.BaseLoader {
  private seekHandler: SeekHandler;
  private loaderConfig: FlvLoaderConfig;
  private stream: LiveMediaStream | null = null;
  private requestToken: object | null = null;
  private requestAbort = false;
  private failureReported = false;
  private readTimeout: number | null = null;
  private contentLength: number | null = null;
  private receivedLength = 0;

  constructor(seekHandler: SeekHandler, config: FlvLoaderConfig) {
    super("tauri-live-resource-loader");
    this.seekHandler = seekHandler;
    this.loaderConfig = config;
    this._needStash = true;
  }

  destroy(): void {
    this.abort();
    super.destroy();
  }

  open(dataSource: FlvDataSource, range: FlvRange): void {
    if (this.requestToken) {
      this.abort();
    }
    const sourceUrl =
      this.loaderConfig.reuseRedirectedURL && dataSource.redirectedURL
        ? dataSource.redirectedURL
        : dataSource.url;
    if (!sourceUrl) {
      this.fail(mpegts.LoaderErrors.EXCEPTION, -1, "Missing FLV source URL");
      return;
    }

    const seekConfig = this.seekHandler.getConfig(sourceUrl, range);
    const headers = liveRequestHeaders();
    appendHeaders(headers, seekConfig.headers);
    appendHeaders(headers, this.loaderConfig.headers);

    const token = {};
    this.requestToken = token;
    this.requestAbort = false;
    this.failureReported = false;
    this.contentLength = null;
    this.receivedLength = 0;
    this._status = mpegts.LoaderStatus.kConnecting;

    const readStream = async () => {
      let stream: LiveMediaStream | null = null;
      try {
        stream = await openLiveMediaStream(
          seekConfig.url,
          headersToRecord(headers)
        );
        if (
          this.requestToken !== token ||
          this.requestAbort ||
          this.failureReported
        ) {
          stream.cancel();
          return;
        }
        this.stream = stream;
        const start = stream.start;
        logLiveMediaStart(start);
        this._status = mpegts.LoaderStatus.kBuffering;
        if (start.url && start.url !== seekConfig.url) {
          this.onURLRedirect?.(start.url);
        }
        const contentLength = start.headers["content-length"];
        if (contentLength) {
          const parsed = Number.parseInt(contentLength, 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            this.contentLength = parsed;
            this.onContentLengthKnown?.(parsed);
          }
        }
        if (start.status < 200 || start.status >= 300) {
          this.fail(
            mpegts.LoaderErrors.HTTP_STATUS_CODE_INVALID,
            start.status,
            start.statusText || "media request failed"
          );
          return;
        }

        this.armReadTimeout(token);
        while (
          this.requestToken === token &&
          !this.requestAbort &&
          !this.failureReported
        ) {
          const message = await stream.read();
          if (
            this.requestToken !== token ||
            this.requestAbort ||
            this.failureReported
          ) {
            return;
          }
          if (message === null) {
            this.fail(
              mpegts.LoaderErrors.EARLY_EOF,
              -1,
              this.contentLength !== null
                ? "Live FLV stream ended before Content-Length"
                : "Live FLV stream ended",
              false
            );
            return;
          }
          if (message.byteLength === 0) continue;
          this.clearReadTimeout();
          this._status = mpegts.LoaderStatus.kBuffering;
          const byteStart = range.from + this.receivedLength;
          this.receivedLength += message.byteLength;
          this.onDataArrival?.(message, byteStart, this.receivedLength);
          this.armReadTimeout(token);
        }
      } catch (error) {
        this.fail(mpegts.LoaderErrors.EXCEPTION, -1, streamErrorMessage(error));
      }
    };
    void readStream();
    this.armReadTimeout(token);
  }

  abort(): void {
    this.clearReadTimeout();
    this.requestAbort = true;
    this.failureReported = true;
    this.requestToken = null;
    const stream = this.stream;
    this.stream = null;
    stream?.cancel();
    this._status = mpegts.LoaderStatus.kIdle;
  }

  private armReadTimeout(token: object): void {
    this.clearReadTimeout();
    this.readTimeout = window.setTimeout(() => {
      this.readTimeout = null;
      if (
        this.requestToken !== token ||
        this.requestAbort ||
        this.failureReported
      ) {
        return;
      }
      this.fail(
        mpegts.LoaderErrors.EARLY_EOF,
        -1,
        "Live FLV stream received no data"
      );
    }, FLV_READ_IDLE_TIMEOUT_MS);
  }

  private fail(
    type: (typeof mpegts.LoaderErrors)[keyof typeof mpegts.LoaderErrors],
    code: number,
    message: string,
    cancelRequest = true
  ) {
    if (this.requestAbort || this.failureReported) return;
    this.failureReported = true;
    this.clearReadTimeout();
    const stream = this.stream;
    this.stream = null;
    this.requestToken = null;
    if (cancelRequest) {
      stream?.cancel();
    }
    this._status = mpegts.LoaderStatus.kError;
    // mpegts.js models error values as the constants object in its callbacks.
    this.onError?.(type as unknown as typeof mpegts.LoaderErrors, {
      code,
      msg: message,
    });
  }

  private clearReadTimeout() {
    if (this.readTimeout === null) return;
    window.clearTimeout(this.readTimeout);
    this.readTimeout = null;
  }
}
