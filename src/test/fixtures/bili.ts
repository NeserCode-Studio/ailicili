import type {
  DynamicPage,
  HistoryPage,
  LibraryVideo,
  PopularPage,
  SearchItem,
  SearchPage,
  SpaceProfile,
  SpaceVideoPage,
  VideoSummary,
} from "@/shared/bili.types";

export function createVideoSummary(
  overrides: Partial<VideoSummary> = {}
): VideoSummary {
  return {
    aid: 1,
    bvid: "BV1xx411c7mD",
    cid: 10,
    title: "测试视频",
    coverUrl: "https://i0.hdslb.com/cover.jpg",
    author: {
      mid: 2,
      name: "测试 UP 主",
      avatarUrl: "https://i0.hdslb.com/avatar.jpg",
    },
    stats: {
      views: 12_345,
      danmaku: 234,
      likes: 567,
      comments: 89,
    },
    durationSeconds: 125,
    publishedAt: 1_700_000_000,
    category: "科技",
    recommendationReason: "热门",
    ...overrides,
  };
}

export function createPopularPage(
  videos = [
    createVideoSummary(),
    createVideoSummary({
      aid: 3,
      bvid: "BV1yy411c7mE",
      title: "第二个视频",
      author: {
        mid: 4,
        name: "另一位 UP 主",
        avatarUrl: "",
      },
    }),
  ]
): PopularPage {
  return {
    videos,
    page: 1,
    pageSize: 20,
    hasMore: false,
  };
}

export function createSearchPage(
  items: SearchItem[] = [
    {
      kind: "video",
      bvid: "BV1xx411c7mD",
      title: "Rust 搜索视频",
      coverUrl: "https://i0.hdslb.com/search-video.jpg",
      author: "测试 UP 主",
      durationSeconds: 187,
      views: 12_345,
      publishedAt: 1_700_000_000,
    },
    {
      kind: "user",
      mid: "42",
      name: "测试用户",
      avatarUrl: "https://i0.hdslb.com/search-avatar.jpg",
      bio: "用户签名",
      followers: 20_000,
      videos: 12,
      level: 6,
      targetUrl: "https://space.bilibili.com/42",
    },
    {
      kind: "pgc",
      seasonId: "456",
      title: "测试番剧",
      coverUrl: "https://i0.hdslb.com/search-pgc.jpg",
      subtitle: "全 12 话",
      description: "番剧简介",
      score: 9.1,
      targetUrl: "https://www.bilibili.com/bangumi/play/ss456",
    },
    {
      kind: "live",
      roomId: "123",
      title: "测试直播间",
      coverUrl: "https://i0.hdslb.com/search-live.jpg",
      anchorName: "测试主播",
      anchorAvatarUrl: "",
      areaName: "游戏",
      online: 500,
      targetUrl: "https://live.bilibili.com/123",
    },
  ]
): SearchPage {
  return {
    query: "rust",
    kind: "video",
    page: 2,
    pageSize: 20,
    total: 42,
    hasMore: true,
    items,
  };
}

export function createLibraryVideo(
  overrides: Partial<LibraryVideo> = {}
): LibraryVideo {
  return {
    aid: 1,
    bvid: "BV1xx411c7mD",
    cid: 10,
    title: "历史视频",
    coverUrl: "https://i0.hdslb.com/history.jpg",
    durationSeconds: 125,
    authorMid: 2,
    authorName: "测试 UP 主",
    authorAvatarUrl: "",
    views: 12_345,
    progressSeconds: 42,
    viewedAt: 1_700_000_000,
    addedAt: null,
    ...overrides,
  };
}

export function createHistoryPage(
  videos: LibraryVideo[] = [createLibraryVideo()]
): HistoryPage {
  return {
    videos,
    cursorMax: 0,
    cursorViewAt: 0,
    hasMore: false,
  };
}

export function createSpaceProfile(
  overrides: Partial<SpaceProfile> = {}
): SpaceProfile {
  return {
    mid: "42",
    name: "测试用户",
    avatarUrl: "",
    bannerUrl: "",
    signature: "测试签名",
    level: 6,
    following: 12,
    followers: 345,
    ...overrides,
  };
}

export function createSpaceVideoPage(
  videos: LibraryVideo[] = [createLibraryVideo()]
): SpaceVideoPage {
  return {
    videos,
    page: 1,
    pageSize: 20,
    total: videos.length,
    hasMore: false,
  };
}

export function createDynamicPage(): DynamicPage {
  return {
    items: [
      {
        id: "dynamic-1",
        kind: "text",
        author: {
          mid: "42",
          name: "测试用户",
          avatarUrl: "",
        },
        publishedAt: 1_700_000_000,
        text: "新的关注动态",
        images: [],
        video: null,
        stats: {
          likes: 3,
          comments: 2,
          forwards: 1,
        },
        targetUrl: "https://t.bilibili.com/dynamic-1",
        onlyFans: false,
      },
    ],
    offset: "",
    updateBaseline: "baseline",
    hasMore: false,
  };
}
