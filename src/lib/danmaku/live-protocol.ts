import {
  normalizeDanmakuEmote,
  sanitizeDanmakuText,
  type DanmakuEmote,
  type DanmakuMode,
  type DanmakuPart,
  type DanmakuRenderItem,
} from "./types.ts";

export const LIVE_OPERATION = {
  heartbeat: 2,
  message: 5,
  authenticate: 7,
  authenticateReply: 8,
} as const;

export const MAX_LIVE_PACKET_BYTES = 8 * 1024 * 1024;

const HEADER_BYTES = 16;
const MAX_HEADER_BYTES = 64;
const MAX_NESTING_DEPTH = 2;
const MAX_INLINE_EXTRA_CHARS = 32 * 1024;
const MAX_INLINE_EMOTES = 8;
const MAX_DM_V2_BASE64_CHARS = 32 * 1024;
const MAX_DM_V2_BYTES = 24 * 1024;
const MAX_DM_V2_STRING_BYTES = 4 * 1024;
const MAX_DM_V2_MAP_ENTRIES = 16;
const MAX_DM_V2_FIELDS = 64;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export type LiveProtocolErrorCode =
  | "invalidHeader"
  | "packetTooLarge"
  | "packetTruncated"
  | "decompressionUnsupported"
  | "decompressionFailed"
  | "brotliUnsupported"
  | "invalidAuthReply"
  | "nestingTooDeep";

export class LiveProtocolError extends Error {
  readonly code: LiveProtocolErrorCode;

  constructor(code: LiveProtocolErrorCode, message: string) {
    super(message);
    this.name = "LiveProtocolError";
    this.code = code;
  }
}

export interface LivePacket {
  version: number;
  operation: number;
  sequenceId: number;
  body: Uint8Array;
}

export interface LiveDecodeContext {
  receivedAtMs: number;
  nextId: () => string;
  emotes?: ReadonlyMap<string, DanmakuEmote>;
}

export interface LiveDecodedFrame {
  authCode: number | null;
  items: DanmakuRenderItem[];
  malformedPayloads: number;
  unknownCommands: number;
  skippedMessages: number;
}

interface LiveDmV2 {
  content: string | null;
  dmType: number | null;
  emoticons: ReadonlyMap<string, DanmakuEmote>;
}

export function encodeLivePacket(
  operation: number,
  body: Uint8Array = new Uint8Array(),
  version = 1,
  sequenceId = 1
) {
  const packet = new Uint8Array(HEADER_BYTES + body.byteLength);
  const view = new DataView(packet.buffer);
  view.setUint32(0, packet.byteLength, false);
  view.setUint16(4, HEADER_BYTES, false);
  view.setUint16(6, version, false);
  view.setUint32(8, operation, false);
  view.setUint32(12, sequenceId, false);
  packet.set(body, HEADER_BYTES);
  return packet;
}

export function encodeJsonPacket(
  operation: number,
  value: unknown,
  version = 1
) {
  return encodeLivePacket(
    operation,
    new TextEncoder().encode(JSON.stringify(value)),
    version
  );
}

export function parseLivePacketBatch(data: Uint8Array): LivePacket[] {
  if (data.byteLength > MAX_LIVE_PACKET_BYTES) {
    throw new LiveProtocolError(
      "packetTooLarge",
      "live danmaku packet batch exceeds the size limit"
    );
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const packets: LivePacket[] = [];
  let offset = 0;

  while (offset < data.byteLength) {
    if (data.byteLength - offset < HEADER_BYTES) {
      throw new LiveProtocolError(
        "packetTruncated",
        "live danmaku packet header is truncated"
      );
    }

    const packetLength = view.getUint32(offset, false);
    const headerLength = view.getUint16(offset + 4, false);
    const version = view.getUint16(offset + 6, false);
    const operation = view.getUint32(offset + 8, false);
    const sequenceId = view.getUint32(offset + 12, false);

    if (
      packetLength < HEADER_BYTES ||
      packetLength > MAX_LIVE_PACKET_BYTES ||
      headerLength < HEADER_BYTES ||
      headerLength > MAX_HEADER_BYTES ||
      headerLength > packetLength
    ) {
      throw new LiveProtocolError(
        "invalidHeader",
        "live danmaku packet header is invalid"
      );
    }

    const end = offset + packetLength;
    if (end > data.byteLength) {
      throw new LiveProtocolError(
        "packetTruncated",
        "live danmaku packet body is truncated"
      );
    }

    packets.push({
      version,
      operation,
      sequenceId,
      body: data.slice(offset + headerLength, end),
    });
    offset = end;
  }

  return packets;
}

export async function decodeLivePackets(
  packets: readonly LivePacket[],
  context: LiveDecodeContext,
  depth = 0
): Promise<LiveDecodedFrame> {
  if (depth > MAX_NESTING_DEPTH) {
    throw new LiveProtocolError(
      "nestingTooDeep",
      "live danmaku compression nesting is too deep"
    );
  }

  const result = emptyDecodedFrame();
  for (const packet of packets) {
    if (packet.operation === LIVE_OPERATION.authenticateReply) {
      const payload = parseJsonPacket(packet.body);
      if (
        typeof payload !== "object" ||
        payload === null ||
        !Number.isFinite((payload as { code?: unknown }).code)
      ) {
        throw new LiveProtocolError(
          "invalidAuthReply",
          "live danmaku authentication reply is invalid"
        );
      }
      result.authCode = Number((payload as { code: number }).code);
      continue;
    }

    if (packet.operation !== LIVE_OPERATION.message) continue;

    if (packet.version === 2) {
      const inflated = await inflateZlib(packet.body);
      const nested = parseLivePacketBatch(inflated);
      mergeDecodedFrame(
        result,
        await decodeLivePackets(nested, context, depth + 1)
      );
      continue;
    }
    if (packet.version === 3) {
      throw new LiveProtocolError(
        "brotliUnsupported",
        "live danmaku Brotli frames are not supported"
      );
    }
    if (packet.version !== 0 && packet.version !== 1) {
      result.malformedPayloads += 1;
      continue;
    }

    const payload = parseJsonPacket(packet.body);
    if (payload === null) {
      result.malformedPayloads += 1;
      continue;
    }
    parseLiveCommand(payload, context, result);
  }
  return result;
}

export function liveDanmakuMode(value: number): DanmakuMode | null {
  if (value === 4) return "bottom";
  if (value === 5) return "top";
  if (value === 1 || value === 2 || value === 3 || value === 6) {
    return "scroll";
  }
  return null;
}

async function inflateZlib(data: Uint8Array) {
  const DecompressionStreamConstructor = globalThis.DecompressionStream;
  if (typeof DecompressionStreamConstructor !== "function") {
    throw new LiveProtocolError(
      "decompressionUnsupported",
      "DecompressionStream is unavailable"
    );
  }

  try {
    const buffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength
    ) as ArrayBuffer;
    const decompressed = new Blob([buffer])
      .stream()
      .pipeThrough(new DecompressionStreamConstructor("deflate"));
    return await readLimited(decompressed);
  } catch (error) {
    if (error instanceof LiveProtocolError) throw error;
    throw new LiveProtocolError(
      "decompressionFailed",
      "live danmaku zlib decompression failed"
    );
  }
}

async function readLimited(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_LIVE_PACKET_BYTES) {
        throw new LiveProtocolError(
          "packetTooLarge",
          "decompressed live danmaku data exceeds the size limit"
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function parseJsonPacket(data: Uint8Array): unknown {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function parseLiveCommand(
  payload: unknown,
  context: LiveDecodeContext,
  result: LiveDecodedFrame
) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as { cmd?: unknown }).cmd !== "string"
  ) {
    result.malformedPayloads += 1;
    return;
  }

  const command = (payload as { cmd: string }).cmd;
  if (!command.startsWith("DANMU_MSG")) {
    result.unknownCommands += 1;
    return;
  }

  const info = (payload as { info?: unknown }).info;
  if (!Array.isArray(info)) {
    result.skippedMessages += 1;
    return;
  }
  const metadata = Array.isArray(info[0]) ? info[0] : [];
  const mode = liveDanmakuMode(asNumber(metadata[1]));
  const dmV2 = parseLiveDmV2((payload as { dm_v2?: unknown }).dm_v2);
  const rawText = typeof info[1] === "string" ? info[1] : (dmV2?.content ?? "");
  const text = sanitizeDanmakuText(rawText);
  const parts = parseLiveDanmakuParts(metadata, text, dmV2, context.emotes);
  if (!mode || (!text && parts.length === 0)) {
    result.skippedMessages += 1;
    return;
  }

  result.items.push({
    id: context.nextId(),
    text,
    parts,
    timeMs: Math.max(0, context.receivedAtMs),
    mode,
    fontSize: clampInteger(asNumber(metadata[2]), 12, 72, 25),
    color: clampInteger(asNumber(metadata[3]), 0, 0xffffff, 0xffffff),
  });
}

function parseLiveDanmakuParts(
  metadata: readonly unknown[],
  text: string,
  dmV2: LiveDmV2 | null,
  catalogEmotes?: ReadonlyMap<string, DanmakuEmote>
): DanmakuPart[] {
  const dmType = dmV2?.dmType ?? asNumber(metadata[12]);
  const inlineEmotes = parseInlineEmotes(metadata[15]);
  if (dmV2) {
    for (const [token, emote] of dmV2.emoticons) {
      inlineEmotes.set(token, emote);
    }
  }
  const resolveEmote = (token: string) =>
    inlineEmotes.get(token) ?? catalogEmotes?.get(token);
  const rawEmote = asJsonRecord(metadata[13]);
  const hasIndependentEmote =
    dmType === 1 ||
    (typeof rawEmote?.emoticon_unique === "string" &&
      rawEmote.emoticon_unique.length > 0);

  if (hasIndependentEmote) {
    const dmV2Emote = dmV2?.emoticons.get(text);
    if (dmV2Emote) return [{ type: "emote", emote: dmV2Emote }];

    if (rawEmote) {
      const emote = normalizeDanmakuEmote({
        id: rawEmote.emoticon_unique,
        url: rawEmote.url,
        width: rawEmote.width,
        height: rawEmote.height,
        label: text,
        animated: rawEmote.is_dynamic,
      });
      if (emote) return [{ type: "emote", emote }];
    }

    const inlineEmote = inlineEmotes.get(text);
    if (inlineEmote) return [{ type: "emote", emote: inlineEmote }];

    const catalogEmote = catalogEmotes?.get(text);
    if (catalogEmote) return [{ type: "emote", emote: catalogEmote }];
  }

  if (!text) return [];
  if (inlineEmotes.size === 0 && !catalogEmotes?.size) {
    return [{ type: "text", text }];
  }
  return splitTextWithEmotes(text, resolveEmote);
}

function parseLiveDmV2(value: unknown): LiveDmV2 | null {
  if (typeof value !== "string") return null;
  const source = value.trim();
  if (!source || source.length > MAX_DM_V2_BASE64_CHARS) return null;

  const bytes = decodeDmV2Base64(source);
  if (!bytes) return null;

  try {
    return parseDmV2Message(bytes);
  } catch {
    return null;
  }
}

function decodeDmV2Base64(source: string) {
  if (!/^[a-z0-9+/_-]+={0,2}$/iu.test(source)) return null;

  const unpadded = source.replace(/=+$/u, "");
  if (unpadded.length % 4 === 1) return null;
  const estimatedBytes = Math.floor((unpadded.length * 3) / 4);
  if (estimatedBytes > MAX_DM_V2_BYTES) return null;

  const normalized =
    unpadded.replace(/-/gu, "+").replace(/_/gu, "/") +
    "=".repeat((4 - (unpadded.length % 4)) % 4);

  try {
    const binary = atob(normalized);
    if (binary.length > MAX_DM_V2_BYTES) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function parseDmV2Message(data: Uint8Array): LiveDmV2 {
  const reader = new ProtoReader(data);
  const emoticons = new Map<string, DanmakuEmote>();
  let content: string | null = null;
  let dmType: number | null = null;
  let mapEntries = 0;

  for (let fieldCount = 0; !reader.done; fieldCount += 1) {
    if (fieldCount >= MAX_DM_V2_FIELDS) {
      throw new Error("dm_v2 field limit exceeded");
    }
    const tag = reader.readTag();
    if (tag.field === 6) {
      content = reader.expectWire(tag, 2).readString(MAX_DM_V2_STRING_BYTES);
    } else if (tag.field === 13) {
      dmType = Number(reader.expectWire(tag, 0).readVarint());
    } else if (tag.field === 14) {
      if (mapEntries >= MAX_DM_V2_MAP_ENTRIES) {
        reader.expectWire(tag, 2).readBytes(MAX_DM_V2_BYTES);
        mapEntries += 1;
        continue;
      }

      const entry = parseDmV2EmoticonEntry(
        reader.expectWire(tag, 2).readBytes(MAX_DM_V2_BYTES)
      );
      mapEntries += 1;
      if (!entry) continue;

      const [token, emote] = entry;
      if (emoticons.has(token) || emoticons.size < MAX_INLINE_EMOTES) {
        emoticons.set(token, emote);
      }
    } else {
      reader.skip(tag.wireType);
    }
  }

  return { content, dmType, emoticons };
}

function parseDmV2EmoticonEntry(
  data: Uint8Array
): readonly [string, DanmakuEmote] | null {
  const reader = new ProtoReader(data);
  let token: string | null = null;
  let emote: DanmakuEmote | null = null;

  for (let fieldCount = 0; !reader.done; fieldCount += 1) {
    if (fieldCount >= MAX_DM_V2_FIELDS) {
      throw new Error("dm_v2 map entry field limit exceeded");
    }
    const tag = reader.readTag();
    if (tag.field === 1) {
      token = reader.expectWire(tag, 2).readString(MAX_DM_V2_STRING_BYTES);
    } else if (tag.field === 2) {
      emote = parseDmV2Emoticon(
        reader.expectWire(tag, 2).readBytes(MAX_DM_V2_BYTES)
      );
    } else {
      reader.skip(tag.wireType);
    }
  }

  if (!token || !/^\[[^\]\r\n]{1,62}\]$/u.test(token) || !emote) {
    return null;
  }
  return [token, emote];
}

function parseDmV2Emoticon(data: Uint8Array): DanmakuEmote | null {
  const reader = new ProtoReader(data);
  let id = "";
  let url = "";
  let animated = false;
  let width: number | null = null;
  let height: number | null = null;

  for (let fieldCount = 0; !reader.done; fieldCount += 1) {
    if (fieldCount >= MAX_DM_V2_FIELDS) {
      throw new Error("dm_v2 emoticon field limit exceeded");
    }
    const tag = reader.readTag();
    if (tag.field === 1) {
      id = reader.expectWire(tag, 2).readString(MAX_DM_V2_STRING_BYTES);
    } else if (tag.field === 2) {
      url = reader.expectWire(tag, 2).readString(MAX_DM_V2_STRING_BYTES);
    } else if (tag.field === 3) {
      animated = reader.expectWire(tag, 0).readVarint() !== 0n;
    } else if (tag.field === 6) {
      height = Number(reader.expectWire(tag, 0).readVarint());
    } else if (tag.field === 7) {
      width = Number(reader.expectWire(tag, 0).readVarint());
    } else {
      reader.skip(tag.wireType);
    }
  }

  return normalizeDanmakuEmote({
    id,
    url,
    width,
    height,
    label: "Emote",
    animated,
  });
}

interface ProtoTag {
  field: number;
  wireType: number;
}

class ProtoReader {
  private readonly data: Uint8Array;
  private offset = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  get done() {
    return this.offset >= this.data.byteLength;
  }

  readTag(): ProtoTag {
    const raw = this.readVarint();
    if (raw <= 0n || raw > 0xffff_ffffn) {
      throw new Error("invalid protobuf tag");
    }

    const field = Number(raw >> 3n);
    if (field <= 0) throw new Error("invalid protobuf field");
    return { field, wireType: Number(raw & 7n) };
  }

  expectWire(tag: ProtoTag, wireType: number) {
    if (tag.wireType !== wireType) {
      throw new Error("unexpected protobuf wire type");
    }
    return this;
  }

  readString(maximumBytes: number) {
    const bytes = this.readBytes(maximumBytes);
    return UTF8_DECODER.decode(bytes);
  }

  readBytes(maximumBytes: number) {
    const length = this.readLength(maximumBytes);
    const end = this.offset + length;
    if (end > this.data.byteLength) {
      throw new Error("truncated protobuf bytes");
    }

    const bytes = this.data.subarray(this.offset, end);
    this.offset = end;
    return bytes;
  }

  readVarint() {
    let value = 0n;
    let shift = 0n;

    for (let index = 0; index < 10; index += 1) {
      if (this.done) throw new Error("truncated protobuf varint");
      const byte = this.data[this.offset];
      this.offset += 1;
      if (index === 9 && (byte & 0xfe) !== 0) {
        throw new Error("protobuf varint overflow");
      }

      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7n;
    }

    throw new Error("protobuf varint overflow");
  }

  skip(wireType: number) {
    if (wireType === 0) {
      this.readVarint();
    } else if (wireType === 1) {
      this.skipBytes(8);
    } else if (wireType === 2) {
      this.readBytes(MAX_DM_V2_BYTES);
    } else if (wireType === 5) {
      this.skipBytes(4);
    } else {
      throw new Error("unsupported protobuf wire type");
    }
  }

  private readLength(maximumBytes: number) {
    const raw = this.readVarint();
    if (raw > BigInt(Math.max(0, maximumBytes))) {
      throw new Error("protobuf length exceeds the limit");
    }
    return Number(raw);
  }

  private skipBytes(length: number) {
    const end = this.offset + length;
    if (end > this.data.byteLength) {
      throw new Error("truncated protobuf field");
    }
    this.offset = end;
  }
}

function parseInlineEmotes(modeInfoValue: unknown) {
  const emotes = new Map<string, DanmakuEmote>();
  const modeInfo = asJsonRecord(modeInfoValue);
  if (!modeInfo) return emotes;

  let extraValue = modeInfo.extra;
  if (typeof extraValue === "string") {
    if (extraValue.length > MAX_INLINE_EXTRA_CHARS) return emotes;
    try {
      extraValue = JSON.parse(extraValue) as unknown;
    } catch {
      return emotes;
    }
  }

  const extra = asRecord(extraValue);
  const rawEmotes = asRecord(extra?.emots);
  if (!rawEmotes) return emotes;

  for (const [token, rawValue] of Object.entries(rawEmotes)) {
    if (emotes.size >= MAX_INLINE_EMOTES) break;
    if (!/^\[[^\]\r\n]{1,62}\]$/u.test(token)) continue;

    const rawEmote = asRecord(rawValue);
    if (!rawEmote) continue;
    const emote = normalizeDanmakuEmote({
      id: rawEmote.emoticon_unique,
      url: rawEmote.url,
      width: rawEmote.width,
      height: rawEmote.height,
      label: token,
      animated: rawEmote.is_dynamic,
    });
    if (emote) emotes.set(token, emote);
  }
  return emotes;
}

function splitTextWithEmotes(
  text: string,
  resolveEmote: (token: string) => DanmakuEmote | undefined
) {
  const parts: DanmakuPart[] = [];
  let textStart = 0;
  let scan = 0;
  let emoteCount = 0;

  while (scan < text.length && emoteCount < MAX_INLINE_EMOTES) {
    const open = text.indexOf("[", scan);
    if (open < 0) break;
    const close = text.indexOf("]", open + 1);
    if (close < 0) break;

    const token = text.slice(open, close + 1);
    const emote = resolveEmote(token);
    if (!emote) {
      scan = open + 1;
      continue;
    }

    if (open > textStart) {
      parts.push({
        type: "text",
        text: text.slice(textStart, open),
      });
    }
    parts.push({ type: "emote", emote });
    textStart = close + 1;
    scan = textStart;
    emoteCount += 1;
  }

  if (textStart < text.length) {
    parts.push({ type: "text", text: text.slice(textStart) });
  }
  return parts;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (record) return record;
  if (typeof value !== "string" || value.length > MAX_INLINE_EXTRA_CHARS) {
    return null;
  }

  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function emptyDecodedFrame(): LiveDecodedFrame {
  return {
    authCode: null,
    items: [],
    malformedPayloads: 0,
    unknownCommands: 0,
    skippedMessages: 0,
  };
}

function mergeDecodedFrame(target: LiveDecodedFrame, source: LiveDecodedFrame) {
  if (source.authCode !== null) target.authCode = source.authCode;
  target.items.push(...source.items);
  target.malformedPayloads += source.malformedPayloads;
  target.unknownCommands += source.unknownCommands;
  target.skippedMessages += source.skippedMessages;
}

function asNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return Number.NaN;
}

function clampInteger(
  value: number,
  minimum: number,
  maximum: number,
  fallback: number
) {
  const normalized = Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(maximum, Math.max(minimum, normalized));
}
