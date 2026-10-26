import { expect, test } from "@playwright/test";

const authStatus = {
  authenticated: true,
  storageAvailable: true,
  profile: {
    mid: "42",
    name: "测试账号",
    avatarUrl: "",
    level: 6,
    vipStatus: false,
    vipLabel: null,
  },
};

const libraryVideo = {
  aid: 1001,
  bvid: "BV1xx411c7mD",
  cid: 2001,
  title: "从零实现一个稳定、可维护的桌面客户端",
  coverUrl: "https://i0.hdslb.com/bfs/archive/cover.jpg",
  durationSeconds: 1254,
  authorMid: 42,
  authorName: "测试 UP 主",
  authorAvatarUrl: "",
  views: 123_456,
  progressSeconds: 426,
  viewedAt: 1_700_000_000,
  addedAt: null,
};

const liveRoom = {
  roomId: 123,
  shortId: 456,
  uid: 42,
  title: "测试直播间：今晚一起写桌面播放器",
  coverUrl: "https://i0.hdslb.com/bfs/live/cover.jpg",
  keyframeUrl: "https://i0.hdslb.com/bfs/live/keyframe.jpg",
  anchorName: "测试主播",
  anchorAvatarUrl: "",
  areaId: "21",
  parentAreaId: "1",
  areaName: "虚拟主播",
  parentAreaName: "娱乐",
  online: 12_345,
  liveStatus: 1,
};

const liveRoomDetail = {
  room: liveRoom,
  description: "用于检查直播播放器、聊天和清晰度切换的本地测试数据。",
  tags: ["聊天", "开发"],
  followerCount: 20_000,
  anchorLevel: 30,
  liveTime: "2026-10-26 20:00:00",
  webUrl: "https://live.bilibili.com/123",
};

test.beforeEach(async ({ page }, testInfo) => {
  const windowLabel = testInfo.title.includes("dedicated player window")
    ? "player"
    : "main";
  await page.addInitScript(() => localStorage.clear());
  await page.addInitScript(
    ({ auth, video, liveRoom, liveRoomDetail, windowLabel }) => {
      const callbacks: Record<number, (payload: unknown) => void> = {};
      let callbackId = 0;
      const invocations: string[] = [];
      const videoDetail = {
        video: {
          aid: video.aid,
          bvid: video.bvid,
          cid: video.cid,
          title: video.title,
          coverUrl: video.coverUrl,
          author: {
            mid: video.authorMid,
            name: video.authorName,
            avatarUrl: "",
          },
          stats: {
            views: video.views,
            danmaku: 2345,
            likes: 5678,
            comments: 90,
          },
          durationSeconds: video.durationSeconds,
          publishedAt: 1_700_000_000,
          category: "科技",
          recommendationReason: null,
        },
        description:
          "这是一个用于检查视频详情页、播放器入口、评论和个人库视觉布局的本地测试数据。",
        parts: [
          {
            cid: video.cid,
            page: 1,
            title: "完整实现",
            durationSeconds: video.durationSeconds,
          },
        ],
        dimension: { width: 1920, height: 1080, rotate: 0 },
      };
      const dynamicPage = {
        items: [
          {
            id: "dynamic-1",
            kind: "video",
            author: {
              mid: "42",
              name: "测试 UP 主",
              avatarUrl: "",
            },
            publishedAt: 1_700_000_000,
            text: "新视频已经发布，这次整理了桌面端播放与社交功能的实现过程。",
            images: [],
            video: {
              bvid: video.bvid,
              title: video.title,
              coverUrl: video.coverUrl,
              durationSeconds: video.durationSeconds,
              views: video.views,
              danmaku: 2345,
            },
            stats: { likes: 321, comments: 45, forwards: 12 },
            targetUrl: "https://t.bilibili.com/dynamic-1",
            onlyFans: false,
          },
        ],
        offset: "",
        updateBaseline: "baseline",
        hasMore: false,
      };
      const spaceProfile = {
        mid: "42",
        name: "测试 UP 主",
        avatarUrl: "",
        bannerUrl: "",
        signature: "记录桌面应用、视频技术与交互设计。",
        level: 6,
        following: 128,
        followers: 345_678,
      };
      const responses: Record<string, unknown> = {
        bili_auth_status: auth,
        bili_history: {
          videos: [video],
          cursorMax: 0,
          cursorViewAt: 0,
          hasMore: false,
        },
        bili_watch_later: { videos: [video], count: 1 },
        bili_favorite_folders: [
          { id: "7", title: "默认收藏夹", mediaCount: 12 },
        ],
        bili_favorite_resources: {
          mediaId: "7",
          page: 1,
          pageSize: 20,
          total: 1,
          hasMore: false,
          videos: [video],
        },
        bili_dynamic_feed: dynamicPage,
        bili_space_profile: spaceProfile,
        bili_space_videos: {
          videos: [video],
          page: 1,
          pageSize: 20,
          total: 1,
          hasMore: false,
        },
        bili_video_detail: videoDetail,
        bili_video_actions: {
          liked: false,
          coined: 0,
          favorited: false,
          followed: false,
        },
        bili_comments: {
          page: 1,
          pageSize: 20,
          total: 90,
          hasMore: false,
          comments: [
            {
              id: "3001",
              author: { mid: "9", name: "热心观众", avatarUrl: "" },
              message: "播放器与弹幕设置的布局很清晰，期待后续功能。",
              emotes: [],
              likes: 18,
              createdAt: 1_700_000_100,
              replyCount: 1,
              replies: [
                {
                  id: "3002",
                  author: { mid: "42", name: "测试 UP 主", avatarUrl: "" },
                  message: "感谢反馈，后续会继续补齐。",
                  emotes: [],
                  likes: 3,
                  createdAt: 1_700_000_200,
                  replyCount: 0,
                  replies: [],
                },
              ],
            },
          ],
        },
        bili_resume_point: { lastPlayTimeSeconds: 0, lastPlayCid: 0 },
        bili_playback_session: {
          sessionId: "visual-session",
          mpdUrl: "data:application/dash+xml;charset=utf-8,%3CMPD%3E%3C%2FMPD%3E",
          expiresInSeconds: 600,
          durationMs: 1_254_000,
          selectedQuality: 80,
          qualities: [
            { id: 64, label: "720P", width: 1280, height: 720, bandwidth: 1_000_000 },
            { id: 80, label: "1080P", width: 1920, height: 1080, bandwidth: 2_000_000 },
          ],
        },
        bili_danmaku: [
          {
            progressMs: 1000,
            mode: 1,
            size: 25,
            color: 16_744_959,
            text: "视觉效果检查",
          },
        ],
        bili_live_areas: [
          {
            id: "1",
            name: "娱乐",
            children: [
              {
                id: "21",
                parentId: "1",
                name: "虚拟主播",
                iconUrl: "",
              },
              {
                id: "22",
                parentId: "1",
                name: "唱见",
                iconUrl: "",
              },
            ],
          },
          {
            id: "2",
            name: "游戏",
            children: [
              {
                id: "86",
                parentId: "2",
                name: "英雄联盟",
                iconUrl: "",
              },
            ],
          },
        ],
        bili_live_rooms: {
          rooms: [
            liveRoom,
            {
              ...liveRoom,
              roomId: 124,
              title: "第二间直播测试房间",
              anchorName: "另一位主播",
              online: 8_765,
            },
          ],
          page: 1,
          pageSize: 24,
          hasMore: false,
          mode: "recommended",
          fallbackReason: null,
        },
        bili_live_room: liveRoomDetail,
        bili_live_playback_session: {
          sessionId: "visual-live-session",
          roomId: liveRoom.roomId,
          liveStatus: 1,
          playbackUrl:
            "https://bilistream.localhost/live/visual-live-session/index.m3u8",
          expiresInSeconds: 1200,
          selectedQuality: 10_000,
          qualities: [
            { id: 10_000, label: "原画" },
            { id: 400, label: "蓝光" },
            { id: 250, label: "超清" },
          ],
          streamFormat: "fmp4",
        },
        bili_live_chat_start: { sessionId: "visual-chat-session" },
        bili_live_chat_poll: {
          messages: [
            {
              sequence: 1,
              id: "visual-chat-1",
              uid: "9",
              username: "热心观众",
              text: "直播播放器和聊天布局看起来不错。",
              color: 16_777_215,
              timestamp: 1_792_944_000,
              guardLevel: 0,
              isAdmin: false,
              medal: null,
            },
            {
              sequence: 2,
              id: "visual-chat-2",
              uid: "10",
              username: "测试房管",
              text: "清晰度切换与重连入口也检查一下。",
              color: 16_711_680,
              timestamp: 1_792_944_030,
              guardLevel: 3,
              isAdmin: true,
              medal: {
                name: "测试主播",
                level: 12,
                anchorName: "测试主播",
              },
            },
          ],
          cursor: 2,
          connected: true,
          error: null,
        },
        bili_live_chat_stop: null,
        bili_heartbeat: null,
      };
      const internals = {
        metadata: {
          currentWindow: { label: windowLabel },
          currentWebview: {
            windowLabel,
            label: windowLabel,
          },
        },
        callbacks,
        transformCallback(callback: (payload: unknown) => void) {
          callbackId += 1;
          callbacks[callbackId] = callback;
          return callbackId;
        },
        unregisterCallback(id: number) {
          delete callbacks[id];
        },
        convertFileSrc(filePath: string) {
          return `http://asset.localhost/${encodeURIComponent(filePath)}`;
        },
        invoke(command: string, args?: Record<string, unknown>) {
          invocations.push(command);
          if (command === "bili_live_playback_session") {
            const quality = Number(args?.qn ?? 10_000);
            return Promise.resolve({
              sessionId: `visual-live-session-${quality}`,
              roomId: liveRoom.roomId,
              liveStatus: 1,
              playbackUrl: `https://bilistream.localhost/live/visual-live-session-${quality}/index.m3u8`,
              expiresInSeconds: 1200,
              selectedQuality: quality,
              qualities: [
                { id: 10_000, label: "原画" },
                { id: 400, label: "蓝光" },
                { id: 250, label: "超清" },
              ],
              streamFormat: "fmp4",
            });
          }
          if (command in responses) return Promise.resolve(responses[command]);
          if (command === "plugin:event|listen") return Promise.resolve(1);
          if (command === "plugin:event|unlisten") return Promise.resolve();
          if (command === "plugin:window|get_all_windows")
            return Promise.resolve([]);
          if (command === "plugin:window|current_monitor")
            return Promise.resolve({
              name: "Visual Test Monitor",
              scaleFactor: 1,
              position: { x: 0, y: 0 },
              size: { width: 1920, height: 1080 },
              workArea: {
                position: { x: 0, y: 0 },
                size: { width: 1920, height: 1040 },
              },
            });
          if (command === "plugin:window|is_minimized")
            return Promise.resolve(false);
          if (
            command === "plugin:window|is_fullscreen" ||
            command === "plugin:window|is_maximized"
          )
            return Promise.resolve(false);
          if (
            command === "plugin:window|show" ||
            command === "plugin:window|set_focus" ||
            command === "plugin:window|set_size" ||
            command === "plugin:window|unmaximize" ||
            command === "plugin:opener|open_url"
          ) {
            return Promise.resolve();
          }
          console.warn("Unhandled Tauri command", command);
          return Promise.resolve(null);
        },
      };
      (
        window as unknown as {
          __TAURI_INTERNALS__: typeof internals;
          __TAURI_TEST_INVOCATIONS__: string[];
        }
      ).__TAURI_INTERNALS__ = internals;
      (
        window as unknown as {
          __TAURI_EVENT_PLUGIN_INTERNALS__: {
            unregisterListener: () => void;
          };
        }
      ).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => {},
      };
      (
        window as unknown as { __TAURI_TEST_INVOCATIONS__: string[] }
      ).__TAURI_TEST_INVOCATIONS__ = invocations;
    },
    {
      auth: authStatus,
      video: libraryVideo,
      liveRoom,
      liveRoomDetail,
      windowLabel,
    }
  );
  await page.route(/dashjs|dash\.all/, async (route) => {
    await route.fulfill({
      contentType: "text/javascript",
      body: `
        export function MediaPlayer() {
          return {
            create() {
              const callbacks = {};
              return {
                updateSettings() {},
                on(name, callback) { callbacks[name] = callback; },
                initialize() {
                  setTimeout(() => callbacks.streamInitialized?.(), 0);
                },
                destroy() {},
                getCurrentRepresentationForType() { return { id: "video-64" }; },
                setRepresentationForTypeById(type, id) {
                  setTimeout(() => {
                    callbacks.qualityChangeRendered?.({
                      mediaType: type,
                      newRepresentation: { id },
                    });
                  }, 600);
                },
              };
            },
          };
        }
      `,
    });
  });
  await page.route(
    (url) => url.pathname.includes("/hls-") && url.pathname.endsWith(".js"),
    async (route) => {
      await route.fulfill({
        contentType: "text/javascript",
        body: `
          export default class Hls {
            static Events = {
              ERROR: "error",
              MANIFEST_PARSED: "manifestParsed",
            };
            static ErrorTypes = {
              MEDIA_ERROR: "mediaError",
              NETWORK_ERROR: "networkError",
            };
            static isSupported() { return true; }

            constructor() {
              this.handlers = {};
            }

            on(name, handler) {
              this.handlers[name] = handler;
            }

            loadSource(url) {
              this.url = url;
            }

            attachMedia(video) {
              this.video = video;
              setTimeout(() => {
                this.handlers.manifestParsed?.({
                  type: "manifestParsed",
                  data: {},
                });
                video.dispatchEvent(new Event("loadedmetadata"));
                video.dispatchEvent(new Event("playing"));
              }, 80);
            }

            startLoad() {}
            recoverMediaError() {
              setTimeout(() => {
                this.handlers.manifestParsed?.({
                  type: "manifestParsed",
                  data: {},
                });
              }, 80);
            }
            destroy() {}
          }
        `,
      });
    }
  );
  await page.route("https://i0.hdslb.com/**", async (route) => {
    await route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      ),
    });
  });
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "compact", width: 900, height: 900 },
] as const) {
  test(`renders populated Phase 3 surfaces at ${viewport.name} width`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    const routes = [
      ["/library", "观看历史"],
      ["/dynamics", "新视频已经发布"],
      ["/space/42", "测试 UP 主"],
      ["/video/BV1xx411c7mD", "从零实现一个稳定、可维护的桌面客户端"],
    ] as const;

    for (const [index, [route, text]] of routes.entries()) {
      await page.goto(route, { waitUntil: "networkidle" });
      await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
      const metrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyText: document.body.innerText.length,
      }));
      expect(metrics.bodyText).toBeGreaterThan(50);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
      await page.screenshot({
        path: `.agent/screenshots/phase3-${index}-${viewport.name}.png`,
        fullPage: true,
      });

      if (route.startsWith("/video/")) {
        await page.getByRole("button", { name: "播放视频" }).click();
        await expect
          .poll(() =>
            page.evaluate(() =>
              window.localStorage.getItem("ailicili:last-player-target")
            )
          )
          .toContain("BV1xx411c7mD");
        await expect(page.getByTestId("video-player")).toHaveCount(0);
        await page.getByRole("heading", { name: /评论/ }).scrollIntoViewIfNeeded();
        await page.getByRole("button", { name: "回复" }).first().click();
        await expect(page.getByPlaceholder("写下回复")).toBeVisible();
        await page.screenshot({
          path: `.agent/screenshots/phase3-comment-reply-${viewport.name}.png`,
        });
      }
    }

    expect(errors).toEqual([]);
  });
}

test("renders the live catalog at desktop and compact widths", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "compact", width: 900, height: 720 },
  ] as const) {
    await page.setViewportSize(viewport);
    await page.goto("/live", { waitUntil: "networkidle" });
    await expect(
      page.getByText("测试直播间：今晚一起写桌面播放器").first()
    ).toBeVisible();
    const metrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    await page.screenshot({
      path: `.agent/screenshots/live-catalog-${viewport.name}.png`,
      fullPage: true,
    });
  }

  expect(errors).toEqual([]);
});

test("renders the dedicated player window for live streams", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  for (const viewport of [
    { name: "desktop", width: 1280, height: 820 },
    { name: "compact", width: 900, height: 700 },
  ] as const) {
    await page.setViewportSize(viewport);
    await page.goto("/player/live/123", { waitUntil: "networkidle" });
    await expect(page.getByTestId("live-video")).toBeVisible();
    await expect(page.getByTestId("live-chat-panel")).toBeVisible();
    await expect(
      page.getByText("直播播放器和聊天布局看起来不错。")
    ).toBeVisible();

    const metrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);

    await page.screenshot({
      path: `.agent/screenshots/live-player-${viewport.name}.png`,
      fullPage: true,
    });

    await page.getByRole("button", { name: "清晰度：原画" }).click();
    await page.getByRole("option", { name: "蓝光" }).click();
    await expect(page.getByTestId("live-quality-switching")).toBeVisible();
    await expect(page.getByTestId("live-quality-switching")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "清晰度：蓝光" })
    ).toBeVisible();
    await page.screenshot({
      path: `.agent/screenshots/live-player-quality-${viewport.name}.png`,
    });

    await page.getByRole("button", { name: "隐藏直播聊天" }).click();
    await expect(page.getByTestId("live-chat-panel")).toHaveCount(0);
    await page.getByRole("button", { name: "显示直播聊天" }).click();
    await expect(page.getByTestId("live-chat-panel")).toBeVisible();
  }

  expect(errors).toEqual([]);
});

test("renders the dedicated player window at desktop and compact sizes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  for (const viewport of [
    { name: "desktop", width: 1280, height: 820 },
    { name: "compact", width: 900, height: 700 },
  ] as const) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/player/BV1xx411c7mD/2001", {
      waitUntil: "networkidle",
    });
    await expect(page.getByTestId("player-window-page")).toBeVisible();
    await expect(page.getByTestId("video-player")).toBeVisible();
    await page.evaluate(() => {
      document
        .querySelector<HTMLVideoElement>("[data-testid='video-player']")
        ?.dispatchEvent(new Event("pause"));
    });
    await expect(page.getByTestId("player-paused-panel")).toBeVisible();
    const metrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    await page.screenshot({
      path: `.agent/screenshots/phase3-player-window-${viewport.name}.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `.agent/screenshots/phase3-player-paused-${viewport.name}.png`,
    });

    await page.evaluate(() => {
      document
        .querySelector<HTMLVideoElement>("[data-testid='video-player']")
        ?.dispatchEvent(new Event("play"));
    });
    await expect(page.getByTestId("player-paused-panel")).toBeHidden();

    await page.getByRole("button", { name: /^清晰度：/ }).click();
    await page.getByRole("option", { name: "1080P" }).click();
    await expect(page.getByTestId("player-quality-switching")).toBeVisible();
    await page.screenshot({
      path: `.agent/screenshots/phase3-player-quality-switching-${viewport.name}.png`,
    });
    await expect(page.getByTestId("player-quality-switching")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "清晰度：1080P" })
    ).toBeVisible();
    await page.screenshot({
      path: `.agent/screenshots/phase3-player-quality-${viewport.name}.png`,
    });

    await page.getByRole("button", { name: /^倍速：/ }).click();
    await page.screenshot({
      path: `.agent/screenshots/phase3-player-speed-menu-${viewport.name}.png`,
    });
    await page.getByRole("option", { name: "1.5x" }).click();
    await expect(
      page.getByRole("button", { name: "倍速：1.5x" })
    ).toBeVisible();
    await page.screenshot({
      path: `.agent/screenshots/phase3-player-speed-${viewport.name}.png`,
    });

    await page.getByRole("button", { name: "隐藏弹幕" }).click();
    await expect(
      page.getByRole("button", { name: "显示弹幕" })
    ).toBeVisible();
    await page.screenshot({
      path: `.agent/screenshots/phase3-player-danmaku-off-${viewport.name}.png`,
    });
    await page.getByRole("button", { name: "显示弹幕" }).click();

    await page.getByRole("button", { name: "播放设置" }).click();
    await expect(page.getByText("清晰度", { exact: true })).toBeVisible();
    await page.screenshot({
      path: `.agent/screenshots/phase3-player-settings-${viewport.name}.png`,
    });
    await page.getByRole("button", { name: "关闭播放设置" }).click();

    await expect(page.getByPlaceholder("在当前进度发送弹幕")).toBeVisible();
    await page.getByRole("button", { name: "弹幕样式" }).click();
    await expect(page.getByText("发送前设置弹幕的位置、颜色和字号。")).toBeVisible();
    await page.screenshot({
      path: `.agent/screenshots/phase3-danmaku-composer-${viewport.name}.png`,
    });
  }

  expect(errors).toEqual([]);
});
