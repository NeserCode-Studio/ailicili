<div align="center">

# ailicili

**面向 Bilibili 的多端视频观看应用**

浏览热门视频、搜索用户投稿内容、播放视频，并在 Windows 上使用 Bilibili 账号登录。

![Windows](https://img.shields.io/badge/Platform-Windows-0078D4)
![Android](https://img.shields.io/badge/Platform-Android-lightgrey)
![Bilibili](https://img.shields.io/badge/Content-Bilibili-00A1D6)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow)

> 本项目仅用于个人学习与研究，不用于商业分发，不提供内容源，不绕过付费或区域限制。

</div>

## 功能

- 视频优先首页，可浏览 Bilibili 热门视频。
- 支持用户投稿视频关键词搜索。
- 支持 `BV...` 与 `av...` 视频详情、分 P 信息和视频播放。
- 支持播放进度、倍速、音量、画中画、全屏和当前画质显示。
- 支持单击画面暂停或继续，双击切换全屏。
- 自动保存本地播放历史，便于继续观看。
- 支持亮色、暗色主题与中英文界面。
- Windows 支持系统托盘、无边框标题栏和命令面板。

## 账号与画质

Windows 版支持 Bilibili 二维码登录和手机短信验证码登录。

- 登录状态保存在 Windows 系统凭据库中。
- 登录后可使用账号相关的视频访问能力。
- 默认请求当前账号和视频可用的最高 MP4 画质。
- 未登录或登录失效时，应用会提示登录后可能解锁更高画质。
- 实际可播放画质由 Bilibili 根据账号、视频和平台策略返回。
- 应用不会绕过付费、账号权限或区域限制。

当前暂不提供 Cookie 粘贴、密码登录或网页登录。

## 平台支持

| 平台    | 状态   | 说明                                               |
| ------- | ------ | -------------------------------------------------- |
| Windows | 可用   | 支持浏览、搜索、播放、本地历史、账号登录和系统托盘 |
| Android | 计划中 | 播放与登录能力尚未开放                             |

## 当前限制

> [!NOTE]
> 当前版本以 Bilibili 用户投稿视频和 MP4 播放为主，部分能力仍在开发中。

- 仅支持 Bilibili 用户投稿视频，暂不支持番剧、影视和充电专属内容。
- 暂不支持更完整的高画质与清晰度切换。
- 暂不支持 Android 播放和 Android 账号登录。
- 暂不支持 Bilibili、Douyin、Huya 等平台直播。
- 暂不支持视频弹幕、直播弹幕、评论、点赞、投币、收藏和云端历史。
- 暂不支持视频下载与离线缓存。

## 本地运行

当前项目仍处于开发阶段，尚未提供正式安装包。

### 环境要求

- Node.js 18 或更高版本
- pnpm 9 或更高版本
- Rust stable
- Tauri 2 对应平台依赖
- Windows 需要 WebView2

### 启动应用

```bash
pnpm install
pnpm tauri dev
```

### 构建前端

```bash
pnpm build
```

## 后续计划

- 支持更完整的高画质、分离音视频播放和清晰度切换。
- 补齐分区、个性化推荐、收藏、云端历史、评论与互动。
- 支持 Bilibili 直播，并逐步适配 Douyin、Huya 等直播平台。
- 建设 Android 播放和 Android 登录能力。
- 统一视频弹幕与直播弹幕，再评估下载缓存和更多平台。

## 使用声明

本项目仅用于个人学习与研究，不用于商业分发，不提供内容源，不绕过付费或区域限制，也不承诺第三方接口持续可用。

项目代码采用 [MIT License](LICENSE) 发布。
