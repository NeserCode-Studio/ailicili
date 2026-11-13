<div align="center">

# ailicili

**在 Windows 上观看 Bilibili 视频，发现并播放多平台直播。**

[![状态：Beta](https://img.shields.io/badge/status-beta-orange)](https://github.com/NeserCode-Studio/ailicili/releases)
![平台：Windows](https://img.shields.io/badge/platform-Windows-0078D4)
[![许可证：MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

[功能](#功能) · [下载与安装](#下载与安装) · [使用说明](#使用说明) ·
[支持情况](#支持情况) · [当前限制](#当前限制) · [本地开发](#本地开发) ·
[问题反馈](#问题反馈)

</div>

`ailicili` 是一个基于 Tauri 2、React 19 与 Rust 构建的 Windows 桌面观看应用。它以 Bilibili 用户投稿视频为主，同时支持发现和播放 Bilibili、抖音与虎牙直播。

> [!IMPORTANT]
> 当前版本为 `1.0.0-beta.1`，仍处于首轮内测阶段，暂不提供正式安装包。后续测试包与公开发行版请从 [GitHub Releases](https://github.com/NeserCode-Studio/ailicili/releases) 获取。

项目仅用于个人学习与研究，不托管视频或直播内容，也不绕过付费、区域限制或账号权限。

## 功能

### 视频

- 浏览 Bilibili 热门、推荐与分区内容，搜索用户投稿视频。
- 打开 `BV...`、`av...` 视频详情，查看分 P 信息并继续播放。
- 支持 DASH 分离音视频、MP4 回退和实际可用画质切换。
- 支持播放进度、倍速、音量、画中画、全屏与断点续播。
- 支持 Bilibili 只读弹幕，包含滚动、顶部和底部模式以及颜色与字号。
- 提供只读评论侧栏，支持热门/最新排序、分页、回复、图片和表情。

### 直播

- 支持 Bilibili 直播发现、关键词搜索和结果分页。
- 支持抖音与虎牙公开直播发现、房间号直达和直播间播放。
- 支持 HLS/FLV 播放、协议切换、清晰度切换与断流重连。
- 支持 Bilibili 直播只读弹幕，包含普通文字、通用表情、直播间专属表情、正文内嵌表情和登录态直播间表情目录。
- 支持收藏直播间，并从收藏页按原平台重新打开。

### 账号与本地数据

- 支持 Bilibili 二维码登录和手机短信验证码登录。
- 每个平台最多保存一个账号，同一平台重新登录会替换当前账号。
- 登录凭据保存在 Windows 系统凭据库中，不写入普通项目配置。
- 本地收藏与播放历史支持重启恢复、历史清空和分 P 续播。
- 支持亮色/暗色主题、中英文界面、系统托盘、无边框标题栏和命令面板。

> [!NOTE]
> 清晰度与直播协议由平台根据账号状态、内容和平台策略返回。登录不保证获得固定画质，应用不会请求超出账号权限的内容。

## 下载与安装

当前没有面向公众的正式安装包。开始内测后，构建产物将仅通过 [GitHub Releases](https://github.com/NeserCode-Studio/ailicili/releases) 发布。

| 项目           | 当前说明                                                                     |
| -------------- | ---------------------------------------------------------------------------- |
| 安装器         | 首版仅提供 NSIS 安装包                                                       |
| 操作系统       | Windows 10 22H2 x64（build 19045）或 Windows 11 x64                          |
| WebView2       | 系统缺少 WebView2 Runtime 时，安装器使用联网 `downloadBootstrapper` 自动安装 |
| 代码签名       | 首轮内测暂不签名；公开发行前补齐                                             |
| 其他系统与架构 | 不支持更旧 Windows、ARM64、Android、iOS 或其他移动端                         |

### 关于代码签名

代码签名是使用受信任的代码签名证书对安装器或可执行文件署名，用来标识发布者身份，并减少 Windows SmartScreen 与“未知发布者”警告。它不改变应用功能，也不是登录账号所需的签名。

> [!WARNING]
> 当前内测构建未进行 Authenticode 代码签名，Windows 可能显示“未知发布者”或 SmartScreen 提示。请只运行来自本仓库 Releases 的安装包，或自行从源码构建。

## 使用说明

- 视频首页用于浏览热门、推荐和分区内容；搜索入口支持 Bilibili 用户投稿视频。
- 账号中心可登录 Bilibili。扫码或短信登录完成后，应用会按当前账号可用的能力请求内容。
- 直播页可切换 Bilibili、抖音或虎牙。Bilibili 支持关键词搜索，抖音与虎牙目前提供公开直播发现和房间号直达。
- 视频与直播间可加入本地收藏；播放超过 5 秒后会生成历史记录，便于继续观看。
- 设置页可切换主题与界面语言，也可进入账号中心管理当前登录状态。

## 支持情况

| 平台                               | 状态     | 说明                                    |
| ---------------------------------- | -------- | --------------------------------------- |
| Windows 11 x64                     | 支持     | 当前在 Windows 11 24H2 x64 环境完成验收 |
| Windows 10 22H2 x64（build 19045） | 兼容目标 | 尚未执行独立系统验收                    |
| 更旧 Windows、ARM64、Android、iOS  | 不支持   | 不在当前产品或后续移动端路线图中        |

> [!NOTE]
> Windows 10 22H2 仅记录为最低兼容目标。当前没有对应的真机或虚拟机环境，因此不安排独立 Windows 10 验收，也不宣称该环境已经通过测试。

## 当前限制

- 视频内容仅支持 Bilibili 用户投稿，不包含番剧、影视、充电专属或其他视频平台。
- 抖音与虎牙当前仅支持匿名公开直播，暂不支持登录、关键词搜索、短视频、弹幕或互动。
- Bilibili 弹幕当前为只读；暂不支持发送弹幕、屏蔽词编辑、高级/动作弹幕和动态表情。
- 暂不支持评论发布、点赞、投币、平台收藏夹和云端历史。
- 暂不支持视频下载与离线缓存。
- 少数第三方直播间可能受平台接口、CDN 或网络波动影响，出现缓冲、重连或需要手动刷新。
- Windows 视频播放使用软件解码，以规避 WebView2 窗口拖动时的硬件解码冻结；高分辨率或高码率内容会有较高 CPU 占用。

## 本地开发

本地开发与构建需要在 Windows x64 环境进行。

### 环境要求

- Node.js 18 或更高版本
- pnpm 9 或更高版本
- Rust stable
- Tauri 2 的 Windows 构建依赖
- Windows 10 22H2 x64（build 19045）或 Windows 11 x64

### 启动开发环境

```bash
pnpm install
pnpm tauri dev
```

### 检查与构建

```bash
pnpm build
pnpm lint
cargo test --manifest-path src-tauri/Cargo.toml
```

生成 NSIS 安装包：

```bash
pnpm tauri build
```

## 问题反馈

请通过 [GitHub Issues](https://github.com/NeserCode-Studio/ailicili/issues) 提交问题，并尽量附上应用版本、Windows 版本、复现步骤和相关截图。请勿上传账号密码、登录二维码、Cookie 或其他敏感凭据。

---

项目代码以 [MIT License](LICENSE) 发布。Bilibili、抖音、虎牙等名称和内容归各自权利人所有，本项目与相关平台无隶属关系。
