import type { DanmakuEmote, DanmakuRenderItem } from "./types.ts";
import {
  LIVE_OPERATION,
  LiveProtocolError,
  decodeLivePackets,
  encodeJsonPacket,
  encodeLivePacket,
  parseLivePacketBatch,
} from "./live-protocol.ts";

const HEARTBEAT_INTERVAL_MS = 30_000;
const AUTHENTICATION_TIMEOUT_MS = 10_000;
const EMOTICON_CATALOG_WAIT_MS = 3_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

export interface LiveDanmakuConnectionParameters {
  roomId: string;
  token: string;
  uid: number;
  buvid: string;
  websocketUrl: string;
  protocolVersion: number;
}

export type LiveDanmakuStatus =
  | "idle"
  | "connecting"
  | "authenticating"
  | "connected"
  | "reconnecting"
  | "stopped"
  | "incompatible";

export interface LiveDanmakuClientError {
  code: string;
  message: string;
  recoverable: boolean;
  closeCode?: number;
  closeReason?: string;
}

export interface LiveDanmakuStatusEvent {
  status: LiveDanmakuStatus;
  attempt: number;
  delayMs: number | null;
}

export interface LiveSocketLike {
  readyState: number;
  binaryType: string;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose:
    | ((event: { code: number; reason: string; wasClean: boolean }) => void)
    | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  send(data: ArrayBufferView | ArrayBuffer | string): void;
  close(code?: number, reason?: string): void;
}

export interface LiveDanmakuClientOptions {
  loadConnection: () => Promise<LiveDanmakuConnectionParameters>;
  loadEmoticons?: (
    roomId: string
  ) => Promise<ReadonlyMap<string, DanmakuEmote>>;
  onItems: (items: readonly DanmakuRenderItem[]) => void;
  onStatus?: (event: LiveDanmakuStatusEvent) => void;
  onError?: (error: LiveDanmakuClientError) => void;
}

interface LiveDanmakuClientDependencies {
  createSocket: (url: string) => LiveSocketLike;
  now: () => number;
  setTimeout: (handler: () => void, timeoutMs: number) => number;
  clearTimeout: (id: number) => void;
  setInterval: (handler: () => void, timeoutMs: number) => number;
  clearInterval: (id: number) => void;
}

export class BilibiliLiveDanmakuClient {
  private readonly options: LiveDanmakuClientOptions;
  private readonly dependencies: LiveDanmakuClientDependencies;
  private running = false;
  private generation = 0;
  private socket: LiveSocketLike | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private authenticationTimer: number | null = null;
  private messageChain = Promise.resolve();
  private nextItemId = 0;
  private emoticonCatalogRoomId: string | null = null;
  private emoticonCatalog: ReadonlyMap<string, DanmakuEmote> = new Map();
  private emoticonCatalogLoad: Promise<
    ReadonlyMap<string, DanmakuEmote>
  > | null = null;

  constructor(
    options: LiveDanmakuClientOptions,
    dependencies?: Partial<LiveDanmakuClientDependencies>
  ) {
    this.options = options;
    this.dependencies = {
      createSocket: (url) => new WebSocket(url) as LiveSocketLike,
      now: () => performance.now(),
      setTimeout: (handler, timeoutMs) =>
        globalThis.setTimeout(handler, timeoutMs) as unknown as number,
      clearTimeout: (id) => globalThis.clearTimeout(id),
      setInterval: (handler, timeoutMs) =>
        globalThis.setInterval(handler, timeoutMs) as unknown as number,
      clearInterval: (id) => globalThis.clearInterval(id),
      ...dependencies,
    };
  }

  async start() {
    if (this.running) return;
    if (typeof globalThis.DecompressionStream !== "function") {
      this.options.onError?.({
        code: "decompressionUnsupported",
        message: "当前 WebView2 不支持直播弹幕解压。",
        recoverable: false,
      });
      this.emitStatus("incompatible", 0, null);
      return;
    }

    this.running = true;
    this.reconnectAttempt = 0;
    this.nextItemId = 0;
    await this.connect();
  }

  stop() {
    if (!this.running && !this.socket) return;
    this.running = false;
    this.generation += 1;
    this.clearConnectionTimers();
    this.clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
    if (socket) this.closeSocket(socket, 1000, "client-stop");
    this.emitStatus("stopped", 0, null);
  }

  async whenIdle() {
    await this.messageChain;
  }

  private async connect() {
    if (!this.running) return;
    const generation = ++this.generation;
    this.clearConnectionTimers();
    const previousSocket = this.socket;
    this.socket = null;
    if (previousSocket) this.closeSocket(previousSocket, 1000, "replace");
    this.emitStatus(
      this.reconnectAttempt === 0 ? "connecting" : "reconnecting",
      this.reconnectAttempt,
      null
    );

    let connection: LiveDanmakuConnectionParameters;
    try {
      connection = await this.options.loadConnection();
    } catch {
      this.reportRecoverableError(
        "connectionParameters",
        "直播弹幕连接参数获取失败。"
      );
      this.scheduleReconnect();
      return;
    }
    if (!this.isCurrent(generation)) return;

    const roomId = Number(connection.roomId);
    if (
      connection.protocolVersion !== 0 ||
      !connection.websocketUrl.startsWith("wss://") ||
      !Number.isSafeInteger(roomId) ||
      roomId <= 0
    ) {
      this.failTerminal("invalidConnection", "直播弹幕连接参数不兼容。");
      return;
    }

    const emoticonCatalog = this.ensureEmoticonCatalog(connection.roomId);

    let socket: LiveSocketLike;
    try {
      socket = this.dependencies.createSocket(connection.websocketUrl);
    } catch {
      this.reportRecoverableError("socketCreation", "直播弹幕连接创建失败。");
      this.scheduleReconnect();
      return;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    let authenticated = false;

    socket.onopen = () => {
      if (!this.isCurrent(generation, socket)) return;
      this.emitStatus("authenticating", this.reconnectAttempt, null);
      const sent = this.sendPacket(
        socket,
        generation,
        encodeJsonPacket(LIVE_OPERATION.authenticate, {
          uid: Math.max(0, Math.trunc(connection.uid)),
          roomid: roomId,
          protover: 0,
          buvid: connection.buvid,
          platform: "web",
          type: 2,
          key: connection.token,
        }),
        "socketAuthenticate",
        "authenticate-send"
      );
      if (!sent) return;
      this.authenticationTimer = this.dependencies.setTimeout(() => {
        if (!this.isCurrent(generation, socket) || authenticated) return;
        this.reconnectFromSocket(
          socket,
          generation,
          "authenticationTimeout",
          "直播弹幕认证超时。",
          4000,
          "authentication-timeout"
        );
      }, AUTHENTICATION_TIMEOUT_MS);
    };

    socket.onmessage = (event) => {
      if (!this.isCurrent(generation, socket)) return;
      this.messageChain = this.messageChain
        .then(() =>
          this.handleSocketMessage(
            event.data,
            socket,
            generation,
            () => authenticated,
            (value) => {
              authenticated = value;
            },
            emoticonCatalog
          )
        )
        .catch((error: unknown) => {
          if (!this.isCurrent(generation, socket)) return;
          const code =
            error instanceof LiveProtocolError
              ? error.code
              : "messageProcessing";
          this.reconnectFromSocket(
            socket,
            generation,
            code,
            code === "brotliUnsupported"
              ? "直播弹幕压缩格式暂不兼容。"
              : "直播弹幕消息处理失败。",
            4001,
            code
          );
        });
    };

    socket.onerror = () => {
      if (!this.isCurrent(generation, socket)) return;
      this.reconnectFromSocket(
        socket,
        generation,
        "socketError",
        "直播弹幕连接异常。",
        4005,
        "socket-error"
      );
    };

    socket.onclose = (event) => {
      if (!this.isCurrent(generation, socket)) return;
      this.clearConnectionTimers();
      this.socket = null;
      if (!this.running) return;
      this.options.onError?.({
        code: "socketClosed",
        message: "直播弹幕连接已关闭。",
        recoverable: true,
        closeCode: event.code,
        closeReason: event.reason.slice(0, 160),
      });
      this.scheduleReconnect();
    };
  }

  private async handleSocketMessage(
    data: unknown,
    socket: LiveSocketLike,
    generation: number,
    isAuthenticated: () => boolean,
    setAuthenticated: (value: boolean) => void,
    emoticonCatalog: Promise<ReadonlyMap<string, DanmakuEmote>>
  ) {
    if (!this.isCurrent(generation, socket)) return;
    const bytes = await liveMessageBytes(data);
    const packets = parseLivePacketBatch(bytes);
    const emotes = packets.some(
      (packet) => packet.operation === LIVE_OPERATION.message
    )
      ? await this.waitForEmoticonCatalog(emoticonCatalog)
      : this.emoticonCatalog;
    const decoded = await decodeLivePackets(packets, {
      receivedAtMs: Math.max(0, this.dependencies.now()),
      nextId: () => `live-${Date.now().toString(36)}-${++this.nextItemId}`,
      emotes,
    });
    if (!this.isCurrent(generation, socket)) return;

    if (decoded.authCode !== null) {
      if (decoded.authCode !== 0) {
        this.reconnectFromSocket(
          socket,
          generation,
          `authentication:${decoded.authCode}`,
          "直播弹幕认证失败。",
          4002,
          "authentication-rejected"
        );
        return;
      }
      if (!isAuthenticated()) {
        setAuthenticated(true);
        this.reconnectAttempt = 0;
        this.clearAuthenticationTimer();
        this.startHeartbeat(socket, generation);
        this.emitStatus("connected", 0, null);
      }
    }

    if (isAuthenticated() && decoded.items.length > 0) {
      this.options.onItems(decoded.items);
    }
  }

  private startHeartbeat(socket: LiveSocketLike, generation: number) {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = this.dependencies.setInterval(() => {
      if (!this.isCurrent(generation, socket)) return;
      this.sendPacket(
        socket,
        generation,
        encodeLivePacket(LIVE_OPERATION.heartbeat),
        "socketHeartbeat",
        "heartbeat-send"
      );
    }, HEARTBEAT_INTERVAL_MS);
  }

  private scheduleReconnect() {
    if (!this.running || this.reconnectTimer !== null) return;
    const index = Math.min(
      this.reconnectAttempt,
      RECONNECT_DELAYS_MS.length - 1
    );
    const delayMs = RECONNECT_DELAYS_MS[index];
    this.reconnectAttempt += 1;
    this.socket = null;
    this.emitStatus("reconnecting", this.reconnectAttempt, delayMs);
    this.reconnectTimer = this.dependencies.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delayMs);
  }

  private failTerminal(code: string, message: string) {
    this.running = false;
    this.clearConnectionTimers();
    this.clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
    if (socket) this.closeSocket(socket, 4003, "incompatible");
    this.options.onError?.({
      code,
      message,
      recoverable: false,
    });
    this.emitStatus("incompatible", 0, null);
  }

  private sendPacket(
    socket: LiveSocketLike,
    generation: number,
    packet: ArrayBufferView | ArrayBuffer | string,
    errorCode: string,
    closeReason: string
  ) {
    if (!this.isCurrent(generation, socket)) return false;
    try {
      socket.send(packet);
      return true;
    } catch {
      this.reconnectFromSocket(
        socket,
        generation,
        errorCode,
        "直播弹幕连接发送失败。",
        4004,
        closeReason
      );
      return false;
    }
  }

  private reconnectFromSocket(
    socket: LiveSocketLike,
    generation: number,
    errorCode: string,
    message: string,
    closeCode: number,
    closeReason: string
  ) {
    if (!this.isCurrent(generation, socket)) return;
    this.reportRecoverableError(errorCode, message);
    this.clearConnectionTimers();
    this.socket = null;
    this.closeSocket(socket, closeCode, closeReason);
    this.scheduleReconnect();
  }

  private closeSocket(socket: LiveSocketLike, code: number, reason: string) {
    try {
      socket.close(code, reason);
    } catch {
      // The socket may already be closed or closing.
    }
  }

  private reportRecoverableError(code: string, message: string) {
    this.options.onError?.({
      code,
      message,
      recoverable: true,
    });
  }

  private emitStatus(
    status: LiveDanmakuStatus,
    attempt: number,
    delayMs: number | null
  ) {
    this.options.onStatus?.({ status, attempt, delayMs });
  }

  private isCurrent(generation: number, socket?: LiveSocketLike) {
    return (
      this.running &&
      this.generation === generation &&
      (socket === undefined || this.socket === socket)
    );
  }

  private clearConnectionTimers() {
    this.clearAuthenticationTimer();
    this.clearHeartbeatTimer();
  }

  private clearAuthenticationTimer() {
    if (this.authenticationTimer === null) return;
    this.dependencies.clearTimeout(this.authenticationTimer);
    this.authenticationTimer = null;
  }

  private clearHeartbeatTimer() {
    if (this.heartbeatTimer === null) return;
    this.dependencies.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer === null) return;
    this.dependencies.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private ensureEmoticonCatalog(roomId: string) {
    if (
      this.emoticonCatalogRoomId === roomId &&
      this.emoticonCatalogLoad !== null
    ) {
      return this.emoticonCatalogLoad;
    }

    this.emoticonCatalogRoomId = roomId;
    this.emoticonCatalog = new Map();
    const loader = this.options.loadEmoticons;
    if (!loader) {
      this.emoticonCatalogLoad = Promise.resolve(this.emoticonCatalog);
      return this.emoticonCatalogLoad;
    }

    this.emoticonCatalogLoad = Promise.resolve()
      .then(() => loader(roomId))
      .then(
        (catalog) => {
          if (this.emoticonCatalogRoomId === roomId) {
            this.emoticonCatalog = catalog;
          }
          return this.emoticonCatalog;
        },
        () => {
          if (this.emoticonCatalogRoomId === roomId) {
            this.emoticonCatalogRoomId = null;
            this.emoticonCatalogLoad = null;
          }
          return new Map<string, DanmakuEmote>();
        }
      );
    return this.emoticonCatalogLoad;
  }

  private async waitForEmoticonCatalog(
    load: Promise<ReadonlyMap<string, DanmakuEmote>>
  ) {
    let timeoutId: number | null = null;
    const timeout = new Promise<ReadonlyMap<string, DanmakuEmote>>(
      (resolve) => {
        timeoutId = this.dependencies.setTimeout(() => {
          resolve(this.emoticonCatalog);
        }, EMOTICON_CATALOG_WAIT_MS);
      }
    );

    try {
      return await Promise.race([load, timeout]);
    } finally {
      if (timeoutId !== null) {
        this.dependencies.clearTimeout(timeoutId);
      }
    }
  }
}

async function liveMessageBytes(data: unknown) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  throw new LiveProtocolError(
    "invalidHeader",
    "live danmaku WebSocket message is not binary"
  );
}
