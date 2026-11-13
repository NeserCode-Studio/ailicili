import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";

import {
  LIVE_OPERATION,
  LiveProtocolError,
  decodeLivePackets,
  encodeJsonPacket,
  encodeLivePacket,
  liveDanmakuMode,
  parseLivePacketBatch,
} from "../src/lib/danmaku/live-protocol.ts";
import { BilibiliLiveDanmakuClient } from "../src/lib/danmaku/live-client.ts";
import { LiveDanmakuClock } from "../src/lib/danmaku/live-clock.ts";
import { normalizeDanmakuEmote } from "../src/lib/danmaku/types.ts";

function jsonPacket(value, operation = LIVE_OPERATION.message) {
  return encodeJsonPacket(operation, value, 1);
}

function compressedPacket(packets) {
  const body = Buffer.concat(packets.map((packet) => Buffer.from(packet)));
  return encodeLivePacket(
    LIVE_OPERATION.message,
    new Uint8Array(deflateSync(body)),
    2
  );
}

function context(emotes) {
  let id = 0;
  return {
    receivedAtMs: 1_234.5,
    nextId: () => `live-${++id}`,
    emotes,
  };
}

function decodeBatch(data, decodeContext = context()) {
  return decodeLivePackets(parseLivePacketBatch(data), decodeContext);
}

class FakeClock {
  nextId = 1;
  timeouts = new Map();
  intervals = new Map();

  setTimeout(handler, delay) {
    const id = this.nextId++;
    this.timeouts.set(id, { handler, delay });
    return id;
  }

  clearTimeout(id) {
    this.timeouts.delete(id);
  }

  setInterval(handler, delay) {
    const id = this.nextId++;
    this.intervals.set(id, { handler, delay });
    return id;
  }

  clearInterval(id) {
    this.intervals.delete(id);
  }

  runNextTimeout() {
    const entry = this.timeouts.entries().next().value;
    assert.ok(entry, "expected a pending timeout");
    const [id, timer] = entry;
    this.timeouts.delete(id);
    timer.handler();
    return timer.delay;
  }

  runNextInterval() {
    const entry = this.intervals.entries().next().value;
    assert.ok(entry, "expected a pending interval");
    entry[1].handler();
    return entry[1].delay;
  }
}

class FakeSocket {
  readyState = 0;
  binaryType = "blob";
  onopen = null;
  onerror = null;
  onclose = null;
  onmessage = null;
  sent = [];
  closeCall = null;
  sendFailures = 0;

  send(data) {
    assert.equal(this.readyState, 1);
    if (this.sendFailures > 0) {
      this.sendFailures -= 1;
      throw new Error("fixture send failure");
    }
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    if (this.readyState === 3) return;
    this.closeCall = { code, reason };
    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean: true });
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  message(data) {
    this.onmessage?.({ data });
  }

  serverClose(code = 1006, reason = "network") {
    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean: false });
  }
}

function socketPacket(socket, index = 0) {
  const data = socket.sent[index];
  return parseLivePacketBatch(
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  )[0];
}

function socketJsonBody(socket, index = 0) {
  return JSON.parse(new TextDecoder().decode(socketPacket(socket, index).body));
}

async function settleClient() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function danmakuPayload(overrides = {}) {
  return {
    cmd: "DANMU_MSG:4:0:2:2:2:0",
    info: [
      [0, 1, 25, 0x11_2233, 1_700_000_000_000, 0, 0, "", 0, 0],
      "直播 弹幕",
      [123, "fixture"],
    ],
    ...overrides,
  };
}

function liveEmotePayload({
  id = "official_147",
  url = "http://i0.hdslb.com/bfs/live/emote.png",
  width = 150,
  height = 60,
  text = "赞",
} = {}) {
  const payload = danmakuPayload();
  const metadata = Array(16).fill(0);
  metadata[1] = 1;
  metadata[2] = 25;
  metadata[3] = 0xffffff;
  metadata[4] = 1_700_000_000_000;
  metadata[12] = 1;
  metadata[13] = {
    bulge_display: 0,
    emoticon_unique: id,
    height,
    in_player_area: 1,
    is_dynamic: 0,
    url,
    width,
  };
  payload.info[0] = metadata;
  payload.info[1] = text;
  return payload;
}

function concatBytes(...parts) {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0)
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function encodeVarint(value) {
  let remaining = BigInt(value);
  const bytes = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0n);
  return new Uint8Array(bytes);
}

function protobufVarintField(field, value) {
  return concatBytes(encodeVarint((field << 3) | 0), encodeVarint(value));
}

function protobufBytesField(field, value) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return concatBytes(
    encodeVarint((field << 3) | 2),
    encodeVarint(bytes.byteLength),
    bytes
  );
}

function liveDmV2Emoticon({ unique, url, width, height, isDynamic = false }) {
  return concatBytes(
    protobufBytesField(1, unique),
    protobufBytesField(2, url),
    protobufVarintField(3, isDynamic ? 1 : 0),
    protobufVarintField(6, height),
    protobufVarintField(7, width)
  );
}

function liveDmV2MapEntry(token, emote) {
  return concatBytes(
    protobufBytesField(1, token),
    protobufBytesField(2, liveDmV2Emoticon(emote))
  );
}

function liveDmV2({
  dmType = 0,
  content = "",
  emoticons = [],
  includeDmType = true,
}) {
  const fields = [protobufBytesField(6, content)];
  if (includeDmType) fields.push(protobufVarintField(13, dmType));
  for (const [token, emote] of emoticons) {
    fields.push(protobufBytesField(14, liveDmV2MapEntry(token, emote)));
  }
  return Buffer.from(concatBytes(...fields)).toString("base64");
}

function catalogEmote(token, id, url) {
  return normalizeDanmakuEmote({
    id,
    url,
    width: 40,
    height: 40,
    label: token,
  });
}

test("freezes and rebases the live clock across pauses", () => {
  let wallTime = 1_000;
  const clock = new LiveDanmakuClock(() => wallTime);

  assert.equal(clock.now(), 1_000);
  clock.pause();
  wallTime = 1_500;
  assert.equal(clock.now(), 1_000);
  assert.equal(clock.isPaused(), true);

  clock.resume();
  wallTime = 1_600;
  assert.equal(clock.now(), 1_100);
  assert.equal(clock.toPlaybackTime(1_600), 1_100);
});

test("encodes a big-endian authenticated WebSocket packet header", () => {
  const packet = jsonPacket({ code: 0 }, LIVE_OPERATION.authenticateReply);
  const view = new DataView(
    packet.buffer,
    packet.byteOffset,
    packet.byteLength
  );

  assert.equal(view.getUint32(0, false), packet.byteLength);
  assert.equal(view.getUint16(4, false), 16);
  assert.equal(view.getUint16(6, false), 1);
  assert.equal(view.getUint32(8, false), LIVE_OPERATION.authenticateReply);
  assert.equal(view.getUint32(12, false), 1);
});

test("splits concatenated packets and preserves their bodies", () => {
  const first = jsonPacket({ cmd: "ONLINE_RANK_V2" });
  const second = jsonPacket(danmakuPayload());
  const concatenated = new Uint8Array(first.byteLength + second.byteLength);
  concatenated.set(first);
  concatenated.set(second, first.byteLength);

  const packets = parseLivePacketBatch(concatenated);
  assert.equal(packets.length, 2);
  assert.equal(packets[0].operation, LIVE_OPERATION.message);
  assert.equal(
    new TextDecoder().decode(packets[1].body),
    new TextDecoder().decode(second.slice(16))
  );
});

test("rejects truncated packet headers and bodies", () => {
  assert.throws(
    () => parseLivePacketBatch(new Uint8Array(8)),
    (error) =>
      error instanceof LiveProtocolError && error.code === "packetTruncated"
  );

  const packet = jsonPacket({ cmd: "DANMU_MSG" });
  assert.throws(
    () => parseLivePacketBatch(packet.slice(0, -1)),
    (error) =>
      error instanceof LiveProtocolError && error.code === "packetTruncated"
  );
});

test("decompresses zlib packets and parses nested DANMU_MSG", async () => {
  const frame = await decodeBatch(
    compressedPacket([jsonPacket(danmakuPayload())])
  );

  assert.equal(frame.authCode, null);
  assert.equal(frame.malformedPayloads, 0);
  assert.equal(frame.items.length, 1);
  assert.equal(frame.items[0].text, "直播 弹幕");
  assert.equal(frame.items[0].mode, "scroll");
  assert.equal(frame.items[0].fontSize, 25);
  assert.equal(frame.items[0].color, 0x11_2233);
  assert.equal(frame.items[0].timeMs, 1_234.5);
});

test("parses official and room-specific live emotes as image parts", async () => {
  const official = jsonPacket(liveEmotePayload());
  const room = jsonPacket(
    liveEmotePayload({
      id: "room_21452505_191",
      url: "https://i0.hdslb.com/bfs/live/room-emote.png",
      width: 162,
      height: 162,
      text: "哈哈",
    })
  );
  const batch = new Uint8Array(official.byteLength + room.byteLength);
  batch.set(official);
  batch.set(room, official.byteLength);
  const frame = await decodeBatch(
    batch,
    context(
      new Map([
        [
          "赞",
          catalogEmote(
            "赞",
            "official_1470",
            "https://i0.hdslb.com/bfs/live/catalog-conflict.png"
          ),
        ],
        [
          "哈哈",
          catalogEmote(
            "哈哈",
            "room_21452505_190",
            "https://i0.hdslb.com/bfs/live/catalog-room-conflict.png"
          ),
        ],
      ])
    )
  );

  assert.equal(frame.items.length, 2);
  const officialEmote = frame.items[0].parts[0];
  assert.equal(officialEmote.type, "emote");
  assert.equal(officialEmote.emote.kind, "official");
  assert.equal(
    officialEmote.emote.url,
    "https://i0.hdslb.com/bfs/live/emote.png"
  );
  assert.equal(frame.items[0].text, "赞");

  const roomEmote = frame.items[1].parts[0];
  assert.equal(roomEmote.type, "emote");
  assert.equal(roomEmote.emote.kind, "room");
  assert.equal(roomEmote.emote.width, 162);
  assert.equal(frame.items[1].text, "哈哈");
});

test("parses emote metadata when the protocol sends a JSON string", async () => {
  const payload = liveEmotePayload({
    id: "room_21452505_191",
    url: "https://i0.hdslb.com/bfs/live/room-emote-string.png",
    width: 162,
    height: 162,
    text: "睡醒了",
  });
  payload.info[0][13] = JSON.stringify(payload.info[0][13]);
  const frame = await decodeBatch(jsonPacket(payload));

  assert.equal(frame.items.length, 1);
  assert.equal(frame.items[0].parts[0].type, "emote");
  assert.equal(frame.items[0].parts[0].emote.kind, "room");
  assert.equal(frame.items[0].parts[0].emote.id, "room_21452505_191");
});

test("uses independent emote metadata even when dm_type is not set", async () => {
  const payload = liveEmotePayload({
    id: "official_identity_9001",
    url: "https://i0.hdslb.com/bfs/live/identity-fight.png",
    width: 180,
    height: 162,
    text: "[大会员专属身份表情包_战斗]",
  });
  payload.info[0][12] = 0;

  const frame = await decodeBatch(jsonPacket(payload));
  const part = frame.items[0].parts[0];

  assert.equal(part.type, "emote");
  assert.equal(part.emote.id, "official_identity_9001");
  assert.equal(
    part.emote.url,
    "https://i0.hdslb.com/bfs/live/identity-fight.png"
  );
});

test("splits inline live emotes in exact source order", async () => {
  const payload = danmakuPayload();
  payload.info[0] = [
    0,
    1,
    25,
    0xffffff,
    1_700_000_000_000,
    0,
    0,
    "",
    0,
    0,
    0,
    "",
    0,
    {},
    "{}",
    {
      extra: JSON.stringify({
        emots: {
          "[花]": {
            emoticon_unique: "emoji_209",
            url: "http://i0.hdslb.com/bfs/live/flower.png",
            width: 20,
            height: 20,
          },
          "[花火]": {
            emoticon_unique: "emoji_210",
            url: "https://i0.hdslb.com/bfs/live/firework.png",
            width: 24,
            height: 20,
          },
        },
      }),
    },
  ];
  payload.info[1] = "前[花火]中[花]后";
  const frame = await decodeBatch(jsonPacket(payload));
  const parts = frame.items[0].parts;

  assert.deepEqual(
    parts.map((part) => (part.type === "text" ? part.text : part.emote.id)),
    ["前", "emoji_210", "中", "emoji_209", "后"]
  );
  assert.equal(parts[1].type, "emote");
  assert.equal(parts[1].emote.kind, "emoji");
  assert.equal(parts[3].emote.url, "https://i0.hdslb.com/bfs/live/flower.png");
});

test("parses live emote mappings from dm_v2 protobuf", async () => {
  const token = "[鸣潮2周年同人绘画_那咋了]";
  const longerToken = "[鸣潮2周年同人绘画_那咋了_特别版]";
  const payload = danmakuPayload({
    dm_v2: liveDmV2({
      emoticons: [
        [
          token,
          {
            unique: "emoji_7001",
            url: "https://i0.hdslb.com/bfs/live/wuthering-waves.png",
            width: 162,
            height: 162,
          },
        ],
        [
          longerToken,
          {
            unique: "emoji_7002",
            url: "https://i0.hdslb.com/bfs/live/wuthering-waves-special.png",
            width: 180,
            height: 140,
            isDynamic: true,
          },
        ],
      ],
    }),
  });
  payload.info[1] = `前${longerToken}中${token}后`;

  const frame = await decodeBatch(jsonPacket(payload));
  const parts = frame.items[0].parts;

  assert.deepEqual(
    parts.map((part) => (part.type === "text" ? part.text : part.emote.id)),
    ["前", "emoji_7002", "中", "emoji_7001", "后"]
  );
  assert.equal(
    parts[1].emote.url,
    "https://i0.hdslb.com/bfs/live/wuthering-waves-special.png"
  );
  assert.equal(parts[1].emote.animated, true);
});

test("lets dm_v2 emote metadata override inline metadata", async () => {
  const token = "[花]";
  const payload = danmakuPayload({
    dm_v2: liveDmV2({
      emoticons: [
        [
          token,
          {
            unique: "emoji_8001",
            url: "https://i0.hdslb.com/bfs/live/override.png",
            width: 30,
            height: 30,
          },
        ],
      ],
    }),
  });
  payload.info[0] = [
    0,
    1,
    25,
    0xffffff,
    1_700_000_000_000,
    0,
    0,
    "",
    0,
    0,
    0,
    "",
    0,
    {},
    "{}",
    {
      extra: JSON.stringify({
        emots: {
          [token]: {
            emoticon_unique: "emoji_8000",
            url: "https://i0.hdslb.com/bfs/live/inline.png",
            width: 20,
            height: 20,
          },
        },
      }),
    },
  ];
  payload.info[1] = `前${token}后`;

  const frame = await decodeBatch(
    jsonPacket(payload),
    context(
      new Map([
        [
          token,
          catalogEmote(
            token,
            "official_7999",
            "https://i0.hdslb.com/bfs/live/catalog.png"
          ),
        ],
      ])
    )
  );
  const emote = frame.items[0].parts.find((part) => part.type === "emote");

  assert.equal(emote.emote.id, "emoji_8001");
  assert.equal(emote.emote.url, "https://i0.hdslb.com/bfs/live/override.png");
});

test("resolves live emote catalog tokens and keeps unmatched text", async () => {
  const target = "[大会员专属身份表情包_战斗]";
  const catalog = new Map();
  for (let index = 0; index < 1_000; index += 1) {
    const token = `[目录${index}]`;
    catalog.set(
      token,
      catalogEmote(
        token,
        `official_${10_000 + index}`,
        `https://i0.hdslb.com/bfs/live/catalog-${index}.png`
      )
    );
  }
  catalog.set(
    target,
    catalogEmote(
      target,
      "official_9001",
      "https://i0.hdslb.com/bfs/live/identity-fight.png"
    )
  );
  const payload = danmakuPayload();
  payload.info[1] = `前[未收录]中${target}后`;

  const frame = await decodeBatch(jsonPacket(payload), context(catalog));
  const parts = frame.items[0].parts;

  assert.deepEqual(
    parts.map((part) => (part.type === "text" ? part.text : part.emote.id)),
    ["前[未收录]中", "official_9001", "后"]
  );
  assert.equal(parts[1].emote.kind, "official");
});

test("uses dm_v2 emote type and the last duplicate map value", async () => {
  const token = "[赞]";
  const payload = danmakuPayload({
    dm_v2: liveDmV2({
      dmType: 1,
      emoticons: [
        [
          token,
          {
            unique: "emoji_8100",
            url: "https://i0.hdslb.com/bfs/live/first.png",
            width: 30,
            height: 30,
          },
        ],
        [
          token,
          {
            unique: "emoji_8101",
            url: "https://i0.hdslb.com/bfs/live/last.png",
            width: 40,
            height: 40,
          },
        ],
      ],
    }),
  });
  payload.info[1] = token;
  const frame = await decodeBatch(jsonPacket(payload));

  assert.equal(frame.items.length, 1);
  assert.equal(frame.items[0].parts.length, 1);
  assert.equal(frame.items[0].parts[0].type, "emote");
  assert.equal(frame.items[0].parts[0].emote.id, "emoji_8101");
});

test("falls back to text for invalid or oversized dm_v2 payloads", async () => {
  const unsafe = danmakuPayload({
    dm_v2: liveDmV2({
      emoticons: [
        [
          "[坏]",
          {
            unique: "emoji_8200",
            url: "https://example.com/not-bilibili.png",
            width: 20,
            height: 20,
          },
        ],
      ],
    }),
  });
  unsafe.info[1] = "[坏]";

  const invalidBase64 = danmakuPayload({ dm_v2: "not_base64!" });
  invalidBase64.info[1] = "[原文字]";

  const truncated = danmakuPayload({
    dm_v2: Buffer.from([0x72, 0x02, 0x0a]).toString("base64"),
  });
  truncated.info[1] = "[截断]";

  const oversized = danmakuPayload({
    dm_v2: "A".repeat(32 * 1024 + 1),
  });
  oversized.info[1] = "[超长]";

  const packets = [unsafe, invalidBase64, truncated, oversized].map((payload) =>
    jsonPacket(payload)
  );
  const batch = new Uint8Array(
    packets.reduce((total, packet) => total + packet.byteLength, 0)
  );
  let offset = 0;
  for (const packet of packets) {
    batch.set(packet, offset);
    offset += packet.byteLength;
  }

  const frame = await decodeBatch(batch);
  assert.equal(frame.items.length, 4);
  assert.deepEqual(
    frame.items.map((item) => item.parts),
    ["[坏]", "[原文字]", "[截断]", "[超长]"].map((text) => [
      { type: "text", text },
    ])
  );
});

test("caps dm_v2 emote mappings without dropping the message", async () => {
  const tokens = Array.from({ length: 12 }, (_, index) => `[测试${index}]`);
  const payload = danmakuPayload({
    dm_v2: liveDmV2({
      emoticons: tokens.map((token, index) => [
        token,
        {
          unique: `emoji_${9000 + index}`,
          url: `https://i0.hdslb.com/bfs/live/cap-${index}.png`,
          width: 20,
          height: 20,
        },
      ]),
    }),
  });
  payload.info[1] = tokens.join("");

  const frame = await decodeBatch(jsonPacket(payload));

  assert.equal(frame.items.length, 1);
  assert.equal(
    frame.items[0].parts.filter((part) => part.type === "emote").length,
    8
  );
  assert.equal(frame.items[0].parts.at(-1).text, tokens.slice(8).join(""));
});

test("falls back to text for unsafe emote URLs and malformed mappings", async () => {
  const unsafe = jsonPacket(
    liveEmotePayload({
      url: "https://example.com/not-bilibili.png",
    })
  );
  const malformed = danmakuPayload();
  malformed.info[0] = [
    0,
    1,
    25,
    0xffffff,
    1_700_000_000_000,
    0,
    0,
    "",
    0,
    0,
    0,
    "",
    0,
    {},
    "{}",
    { extra: "{not-json" },
  ];
  malformed.info[1] = "[未知]";
  const malformedPacket = jsonPacket(malformed);
  const batch = new Uint8Array(unsafe.byteLength + malformedPacket.byteLength);
  batch.set(unsafe);
  batch.set(malformedPacket, unsafe.byteLength);
  const frame = await decodeBatch(batch);

  assert.deepEqual(frame.items[0].parts, [{ type: "text", text: "赞" }]);
  assert.deepEqual(frame.items[1].parts, [{ type: "text", text: "[未知]" }]);
});

test("parses authentication reply and fixed danmaku modes", async () => {
  const bottomPayload = danmakuPayload();
  bottomPayload.info[0] = [0, 4, 30, 0xabcdef];
  const auth = jsonPacket({ code: 0 }, LIVE_OPERATION.authenticateReply);
  const bottom = jsonPacket(bottomPayload);
  const batch = new Uint8Array(auth.byteLength + bottom.byteLength);
  batch.set(auth);
  batch.set(bottom, auth.byteLength);
  const frame = await decodeBatch(batch);

  assert.equal(frame.authCode, 0);
  assert.equal(frame.items[0].mode, "bottom");
  assert.equal(liveDanmakuMode(5), "top");
  assert.equal(liveDanmakuMode(7), null);
});

test("isolates malformed JSON while counting unknown commands", async () => {
  const malformed = encodeLivePacket(
    LIVE_OPERATION.message,
    new TextEncoder().encode("{bad json"),
    0
  );
  const unknown = jsonPacket({
    cmd: "ONLINE_RANK_V2",
    data: { online: 1 },
  });
  const skipped = jsonPacket({ cmd: "DANMU_MSG", info: [] });
  const batch = new Uint8Array(
    malformed.byteLength + unknown.byteLength + skipped.byteLength
  );
  batch.set(malformed);
  batch.set(unknown, malformed.byteLength);
  batch.set(skipped, malformed.byteLength + unknown.byteLength);
  const frame = await decodeBatch(batch);

  assert.equal(frame.malformedPayloads, 1);
  assert.equal(frame.unknownCommands, 1);
  assert.equal(frame.skippedMessages, 1);
  assert.equal(frame.items.length, 0);
});

test("rejects Brotli frames explicitly and invalid auth replies", async () => {
  const brotli = encodeLivePacket(
    LIVE_OPERATION.message,
    new Uint8Array([0]),
    3
  );
  await assert.rejects(
    () => decodeBatch(brotli),
    (error) =>
      error instanceof LiveProtocolError && error.code === "brotliUnsupported"
  );

  const invalidAuth = encodeLivePacket(
    LIVE_OPERATION.authenticateReply,
    new TextEncoder().encode("{}"),
    1
  );
  await assert.rejects(
    () => decodeBatch(invalidAuth),
    (error) =>
      error instanceof LiveProtocolError && error.code === "invalidAuthReply"
  );
});

test("authenticates before emitting live danmaku and sends heartbeats", async () => {
  const clock = new FakeClock();
  const sockets = [];
  const items = [];
  const statuses = [];
  const client = new BilibiliLiveDanmakuClient(
    {
      loadConnection: async () => ({
        roomId: "1001",
        token: "token-1",
        uid: 42,
        buvid: "fixture-buvid",
        websocketUrl: "wss://broadcastlv.chat.bilibili.com:443/sub",
        protocolVersion: 0,
      }),
      onItems: (next) => items.push(...next),
      onStatus: (event) => statuses.push(event.status),
    },
    {
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      now: () => 5_000,
      setTimeout: clock.setTimeout.bind(clock),
      clearTimeout: clock.clearTimeout.bind(clock),
      setInterval: clock.setInterval.bind(clock),
      clearInterval: clock.clearInterval.bind(clock),
    }
  );

  await client.start();
  assert.equal(sockets.length, 1);
  const socket = sockets[0];
  socket.open();
  const authentication = socketJsonBody(socket);
  assert.equal(authentication.roomid, 1001);
  assert.equal(authentication.protover, 0);
  assert.equal(authentication.uid, 42);
  assert.equal(authentication.key, "token-1");
  assert.equal(authentication.buvid, "fixture-buvid");

  socket.message(jsonPacket(danmakuPayload()));
  await client.whenIdle();
  assert.equal(items.length, 0);

  socket.message(jsonPacket({ code: 0 }, LIVE_OPERATION.authenticateReply));
  await client.whenIdle();
  assert.equal(statuses.at(-1), "connected");

  socket.message(jsonPacket(danmakuPayload()));
  await client.whenIdle();
  assert.equal(items.length, 1);
  assert.equal(items[0].text, "直播 弹幕");

  assert.equal(clock.runNextInterval(), 30_000);
  assert.equal(socketPacket(socket, 1).operation, LIVE_OPERATION.heartbeat);
  client.stop();
});

test("loads the live emote catalog once across reconnects", async () => {
  const target = "[大会员专属身份表情包_战斗]";
  const clock = new FakeClock();
  const sockets = [];
  const items = [];
  let catalogLoads = 0;
  const client = new BilibiliLiveDanmakuClient(
    {
      loadConnection: async () => ({
        roomId: "1001",
        token: "token-1",
        uid: 42,
        buvid: "fixture-buvid",
        websocketUrl: "wss://broadcastlv.chat.bilibili.com:443/sub",
        protocolVersion: 0,
      }),
      loadEmoticons: async () => {
        catalogLoads += 1;
        return new Map([
          [
            target,
            catalogEmote(
              target,
              "official_9001",
              "https://i0.hdslb.com/bfs/live/identity-fight.png"
            ),
          ],
        ]);
      },
      onItems: (next) => items.push(...next),
    },
    {
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      now: () => 5_000,
      setTimeout: clock.setTimeout.bind(clock),
      clearTimeout: clock.clearTimeout.bind(clock),
      setInterval: clock.setInterval.bind(clock),
      clearInterval: clock.clearInterval.bind(clock),
    }
  );

  await client.start();
  await settleClient();
  const first = sockets[0];
  first.open();
  first.message(jsonPacket({ code: 0 }, LIVE_OPERATION.authenticateReply));
  await client.whenIdle();

  const payload = danmakuPayload();
  payload.info[1] = `前${target}后`;
  first.message(jsonPacket(payload));
  await client.whenIdle();
  assert.equal(catalogLoads, 1);
  assert.equal(items[0].parts[1].type, "emote");
  assert.equal(items[0].parts[1].emote.id, "official_9001");

  first.serverClose(1006, "network");
  assert.equal(clock.runNextTimeout(), 1_000);
  await settleClient();
  assert.equal(sockets.length, 2);
  assert.equal(catalogLoads, 1);
  client.stop();
});

test("keeps live danmaku connected when the emote catalog fails", async () => {
  const clock = new FakeClock();
  let socket;
  const items = [];
  const errors = [];
  const statuses = [];
  const client = new BilibiliLiveDanmakuClient(
    {
      loadConnection: async () => ({
        roomId: "1001",
        token: "token-1",
        uid: 42,
        buvid: "fixture-buvid",
        websocketUrl: "wss://broadcastlv.chat.bilibili.com:443/sub",
        protocolVersion: 0,
      }),
      loadEmoticons: async () => {
        throw new Error("catalog unavailable");
      },
      onItems: (next) => items.push(...next),
      onStatus: (event) => statuses.push(event.status),
      onError: (error) => errors.push(error),
    },
    {
      createSocket: () => {
        socket = new FakeSocket();
        return socket;
      },
      now: () => 5_000,
      setTimeout: clock.setTimeout.bind(clock),
      clearTimeout: clock.clearTimeout.bind(clock),
      setInterval: clock.setInterval.bind(clock),
      clearInterval: clock.clearInterval.bind(clock),
    }
  );

  await client.start();
  await settleClient();
  socket.open();
  socket.message(jsonPacket({ code: 0 }, LIVE_OPERATION.authenticateReply));
  await client.whenIdle();
  socket.message(jsonPacket(danmakuPayload()));
  await client.whenIdle();

  assert.equal(statuses.at(-1), "connected");
  assert.equal(errors.length, 0);
  assert.equal(items.length, 1);
  client.stop();
});

test("retries the live emote catalog after a failed load", async () => {
  const target = "[大会员专属身份表情包_战斗]";
  const clock = new FakeClock();
  const sockets = [];
  const items = [];
  let catalogLoads = 0;
  const client = new BilibiliLiveDanmakuClient(
    {
      loadConnection: async () => ({
        roomId: "1001",
        token: "token-1",
        uid: 42,
        buvid: "fixture-buvid",
        websocketUrl: "wss://broadcastlv.chat.bilibili.com:443/sub",
        protocolVersion: 0,
      }),
      loadEmoticons: async () => {
        catalogLoads += 1;
        if (catalogLoads === 1) throw new Error("catalog unavailable");
        return new Map([
          [
            target,
            catalogEmote(
              target,
              "official_9001",
              "https://i0.hdslb.com/bfs/live/identity-fight.png"
            ),
          ],
        ]);
      },
      onItems: (next) => items.push(...next),
    },
    {
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      now: () => 5_000,
      setTimeout: clock.setTimeout.bind(clock),
      clearTimeout: clock.clearTimeout.bind(clock),
      setInterval: clock.setInterval.bind(clock),
      clearInterval: clock.clearInterval.bind(clock),
    }
  );

  await client.start();
  await settleClient();
  sockets[0].open();
  sockets[0].message(jsonPacket({ code: 0 }, LIVE_OPERATION.authenticateReply));
  await client.whenIdle();
  assert.equal(catalogLoads, 1);

  sockets[0].serverClose(1006, "network");
  assert.equal(clock.runNextTimeout(), 1_000);
  await settleClient();
  assert.equal(sockets.length, 2);
  assert.equal(catalogLoads, 2);

  sockets[1].open();
  sockets[1].message(jsonPacket({ code: 0 }, LIVE_OPERATION.authenticateReply));
  await client.whenIdle();
  const payload = danmakuPayload();
  payload.info[1] = target;
  sockets[1].message(jsonPacket(payload));
  await client.whenIdle();

  assert.equal(items[0].parts[0].type, "emote");
  assert.equal(items[0].parts[0].emote.id, "official_9001");
  client.stop();
});

test("waits for the live emote catalog before decoding early messages", async () => {
  const clock = new FakeClock();
  let socket;
  let resolveCatalog;
  const items = [];
  const client = new BilibiliLiveDanmakuClient(
    {
      loadConnection: async () => ({
        roomId: "1001",
        token: "token-1",
        uid: 42,
        buvid: "fixture-buvid",
        websocketUrl: "wss://broadcastlv.chat.bilibili.com:443/sub",
        protocolVersion: 0,
      }),
      loadEmoticons: () =>
        new Promise((resolve) => {
          resolveCatalog = resolve;
        }),
      onItems: (next) => items.push(...next),
    },
    {
      createSocket: () => {
        socket = new FakeSocket();
        return socket;
      },
      now: () => 5_000,
      setTimeout: clock.setTimeout.bind(clock),
      clearTimeout: clock.clearTimeout.bind(clock),
      setInterval: clock.setInterval.bind(clock),
      clearInterval: clock.clearInterval.bind(clock),
    }
  );

  const target = "[大会员专属身份表情包_战斗]";
  await client.start();
  await settleClient();
  socket.open();
  socket.message(jsonPacket({ code: 0 }, LIVE_OPERATION.authenticateReply));
  await client.whenIdle();

  const payload = danmakuPayload();
  payload.info[1] = target;
  socket.message(jsonPacket(payload));
  await settleClient();
  assert.equal(items.length, 0);

  resolveCatalog(
    new Map([
      [
        target,
        catalogEmote(
          target,
          "official_9001",
          "https://i0.hdslb.com/bfs/live/identity-fight.png"
        ),
      ],
    ])
  );
  await client.whenIdle();

  assert.equal(items.length, 1);
  assert.equal(items[0].parts[0].type, "emote");
  client.stop();
});

test("reports the server close frame before reconnecting", async () => {
  const clock = new FakeClock();
  const errors = [];
  const statuses = [];
  let socket;
  const client = new BilibiliLiveDanmakuClient(
    {
      loadConnection: async () => ({
        roomId: "1001",
        token: "token-1",
        uid: 42,
        buvid: "fixture-buvid",
        websocketUrl: "wss://broadcastlv.chat.bilibili.com:443/sub",
        protocolVersion: 0,
      }),
      onItems: () => {},
      onStatus: (event) => statuses.push(event.status),
      onError: (error) => errors.push(error),
    },
    {
      createSocket: () => {
        socket = new FakeSocket();
        return socket;
      },
      now: () => 1_000,
      setTimeout: clock.setTimeout.bind(clock),
      clearTimeout: clock.clearTimeout.bind(clock),
      setInterval: clock.setInterval.bind(clock),
      clearInterval: clock.clearInterval.bind(clock),
    }
  );

  await client.start();
  socket.open();
  socket.serverClose(1006, "network");

  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "socketClosed");
  assert.equal(errors[0].closeCode, 1006);
  assert.equal(errors[0].closeReason, "network");
  assert.equal(statuses.at(-1), "reconnecting");
  client.stop();
});

test("refreshes parameters after auth failure and ignores the old socket", async () => {
  const clock = new FakeClock();
  const sockets = [];
  const items = [];
  const statuses = [];
  let connectionLoads = 0;
  const client = new BilibiliLiveDanmakuClient(
    {
      loadConnection: async () => {
        connectionLoads += 1;
        return {
          roomId: "1001",
          token: `token-${connectionLoads}`,
          uid: 0,
          buvid: "fixture-buvid",
          websocketUrl: "wss://broadcastlv.chat.bilibili.com:443/sub",
          protocolVersion: 0,
        };
      },
      onItems: (next) => items.push(...next),
      onStatus: (event) => statuses.push(event.status),
    },
    {
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      now: () => 8_000,
      setTimeout: clock.setTimeout.bind(clock),
      clearTimeout: clock.clearTimeout.bind(clock),
      setInterval: clock.setInterval.bind(clock),
      clearInterval: clock.clearInterval.bind(clock),
    }
  );

  await client.start();
  const first = sockets[0];
  first.open();
  first.message(jsonPacket({ code: -101 }, LIVE_OPERATION.authenticateReply));
  await client.whenIdle();
  assert.equal(first.closeCall.code, 4002);
  assert.equal(clock.timeouts.size, 1);

  assert.equal(clock.runNextTimeout(), 1_000);
  await settleClient();
  assert.equal(connectionLoads, 2);
  assert.equal(sockets.length, 2);
  const second = sockets[1];
  second.open();
  assert.equal(socketJsonBody(second).key, "token-2");

  first.message(jsonPacket(danmakuPayload()));
  await client.whenIdle();
  assert.equal(items.length, 0);

  second.message(jsonPacket({ code: 0 }, LIVE_OPERATION.authenticateReply));
  await client.whenIdle();
  second.message(jsonPacket(danmakuPayload()));
  await client.whenIdle();
  assert.equal(items.length, 1);
  assert.equal(statuses.at(-1), "connected");

  client.stop();
  assert.equal(second.closeCall.code, 1000);
  assert.equal(statuses.at(-1), "stopped");
  assert.equal(clock.timeouts.size, 0);
  assert.equal(clock.intervals.size, 0);
});

test("reconnects when authentication send throws", async () => {
  const clock = new FakeClock();
  const sockets = [];
  const errors = [];
  const client = new BilibiliLiveDanmakuClient(
    {
      loadConnection: async () => ({
        roomId: "1001",
        token: "token-1",
        uid: 0,
        buvid: "fixture-buvid",
        websocketUrl: "wss://broadcastlv.chat.bilibili.com:443/sub",
        protocolVersion: 0,
      }),
      onItems: () => {},
      onError: (error) => errors.push(error),
    },
    {
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      now: () => 5_000,
      setTimeout: clock.setTimeout.bind(clock),
      clearTimeout: clock.clearTimeout.bind(clock),
      setInterval: clock.setInterval.bind(clock),
      clearInterval: clock.clearInterval.bind(clock),
    }
  );

  await client.start();
  const socket = sockets[0];
  socket.sendFailures = 1;
  socket.open();

  assert.equal(socket.closeCall.code, 4004);
  assert.equal(errors.at(-1).code, "socketAuthenticate");
  assert.equal(clock.timeouts.size, 1);
  assert.equal(clock.runNextTimeout(), 1_000);
  await settleClient();
  assert.equal(sockets.length, 2);

  client.stop();
});

test("reconnects when a heartbeat send throws", async () => {
  const clock = new FakeClock();
  const sockets = [];
  const errors = [];
  const client = new BilibiliLiveDanmakuClient(
    {
      loadConnection: async () => ({
        roomId: "1001",
        token: "token-1",
        uid: 0,
        buvid: "fixture-buvid",
        websocketUrl: "wss://broadcastlv.chat.bilibili.com:443/sub",
        protocolVersion: 0,
      }),
      onItems: () => {},
      onError: (error) => errors.push(error),
    },
    {
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      now: () => 5_000,
      setTimeout: clock.setTimeout.bind(clock),
      clearTimeout: clock.clearTimeout.bind(clock),
      setInterval: clock.setInterval.bind(clock),
      clearInterval: clock.clearInterval.bind(clock),
    }
  );

  await client.start();
  const socket = sockets[0];
  socket.open();
  socket.message(jsonPacket({ code: 0 }, LIVE_OPERATION.authenticateReply));
  await client.whenIdle();

  socket.sendFailures = 1;
  assert.equal(clock.runNextInterval(), 30_000);
  assert.equal(socket.closeCall.code, 4004);
  assert.equal(errors.at(-1).code, "socketHeartbeat");
  assert.equal(clock.timeouts.size, 1);
  assert.equal(clock.runNextTimeout(), 1_000);
  await settleClient();
  assert.equal(sockets.length, 2);

  client.stop();
});
