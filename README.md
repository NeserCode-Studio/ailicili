<div align="center">

# ailicili

**Tauri 2 + React 19 多端视频与直播观看应用**

以 Bilibili UGC 视频为主的个人学习与研究项目，逐步扩展登录态、高画质、直播源与 Android 播放能力。

[![Tauri](https://img.shields.io/badge/Tauri-2-blue?style=flat-round&logo=tauri&logoColor=white)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-round&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-round&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-stable-000000?style=flat-round&logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat-round&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-round)](LICENSE)

> 本项目仅用于个人学习与研究：不用于商业分发，不提供内容源，不绕过付费或区域限制。使用公开接口时可能遇到平台风控或接口变更，本项目不承诺内容可用性。

</div>

---

## 当前进度

| 模块 | 状态 |
| --- | --- |
| Bilibili 匿名热门视频 | 可用 |
| Bilibili UGC 视频搜索 | 可用 |
| 视频详情与分 P 元数据 | 可用 |
| MP4 播放 | 可用 |
| 播放进度、倍速、音量、画中画、全屏 | 可用 |
| 本地播放历史 | 可用 |
| 二维码登录与高画质 | 计划中 |
| Bilibili DASH 播放 | 计划中 |
| 视频与直播弹幕 | 计划中 |
| Bilibili 直播与 Douyin/Huya 适配 | 计划中 |
| Android 工程与原生播放后端 | 计划中 |

当前只支持 Bilibili 匿名 UGC 视频与 MP4 播放。番剧、影视、充电专属、直播、弹幕、评论互动、云端历史与下载缓存尚未实现。

## 功能

### 媒体功能

- 视频优先首页，支持热门流与 UGC 关键词搜索。
- 支持 `BV...` 与 `av...` 视频 ID、视频详情、分 P 信息与播放地址解析。
- 封面请求使用 `no-referrer`，避免第三方 CDN 的 Referer 校验导致 403。
- 播放器控制栏参考 Bilibili 网页版，包含进度、播放、时间、清晰度、倍速、音量、画中画与全屏。
- 单击画面切换播放状态，双击只切换全屏，两者不会重复消费同一组点击。
- 播放进度定期写入 Tauri 应用数据目录中的 `history.json`。

### 模板能力

- Windows 无边框标题栏、系统托盘与独立托盘弹窗。
- 命令面板、设置中心、亮暗主题与中英双语。
- 分阶段生命周期钩子，以及 Rust 与前端之间的跨窗口事件通道。
- 统一日志工具，按模块与级别输出关键路径信息。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面与移动容器 | Tauri 2 |
| 前端 | React 19、TypeScript、Vite |
| 样式与组件 | Tailwind CSS 4、shadcn/ui、Radix UI |
| 后端 | Rust、Reqwest |
| 视频协议 | HTMLVideoElement、hls.js、mpegts.js |

Tauri npm 包与 Rust crate 使用相同 minor 版本。修改 `@tauri-apps/*` 或 `Cargo.toml` 中的 Tauri 依赖时，必须同步检查 `pnpm tauri info` 与 `cargo check`。

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 9
- Rust stable
- Tauri 平台依赖，Windows 需要 WebView2

### 开发

```bash
# 安装前端依赖
pnpm install

# 启动 Tauri 开发环境
pnpm tauri dev
```

开发服务器固定使用 `8888` 端口。如果端口已被其他实例占用，应先停止旧实例或按 Tauri 配置调整端口，不应让多个开发实例共享同一端口。

### 检查与构建

```bash
pnpm lint
pnpm build

cd src-tauri
cargo check
```

`pnpm tauri build` 只在最终发布阶段执行。日常开发与验收使用 `pnpm build`、`cargo check` 和 `pnpm tauri dev`。

## 媒体架构

```text
React views
  -> src/api/media.ts
  -> Tauri invoke
  -> src-tauri/src/lib.rs
  -> Bilibili adapter / local storage
  -> unified camelCase domain models
  -> React player
```

核心边界：

1. 平台请求、签名和响应映射位于 Rust，前端不直接解析平台 API。
2. 前端只消费统一的视频、分 P、播放流与历史记录模型。
3. 播放器只理解 `mp4`、`dash`、`hls`、`flv` 等协议，不理解具体平台。
4. 新增直播平台时应扩展平台适配层，而不是修改播放器核心。
5. Cookie、登录凭据和平台风控状态必须留在受控存储中，不写入普通日志。

## 项目结构

```text
src/
├── api/
│   └── media.ts             # 前端媒体调用层
├── components/
│   ├── framework/           # 标题栏、设置、命令面板、托盘组件
│   ├── media/               # 视频卡片等媒体组件
│   └── ui/                  # shadcn/ui 组件
├── views/
│   ├── Home.tsx             # 热门与搜索
│   ├── Video.tsx            # 视频详情与播放器
│   └── Settings.tsx         # 设置中心
├── lib/
│   ├── format.ts            # 数字与时间格式化
│   └── logger.ts            # 分级日志
└── contexts/                # 导航、设置、主题、国际化

src-tauri/
├── src/
│   ├── bilibili.rs          # Bilibili 请求与响应映射
│   ├── domain.rs            # 统一媒体领域模型
│   ├── storage.rs           # 本地历史
│   └── lib.rs               # Tauri command 与窗口生命周期
├── capabilities/            # Tauri 权限白名单
└── tauri.conf.json          # 窗口与打包配置
```

## API 证据

平台接口来源、请求类型、响应字段、错误码和风险说明统一记录在 `docs/api-evidence.md`。该目录已从 Git 排除，避免将后端调查记录作为公开内容发布。

修改平台适配器前应先核对证据文档；接口行为变化后也必须先更新证据，再修改代码。

## 验证

每个里程碑至少执行：

```bash
pnpm lint
pnpm build

cd src-tauri
cargo check
```

交互功能由用户在实际 Tauri 窗口中验收。Agent 不应自动抢占鼠标、窗口或长期占用开发端口。

## 后续路线

1. 持续维护当前基线，保持 Tauri 版本、README 与功能状态一致。
2. 实现 Bilibili 二维码登录、WBI、高画质与个性化推荐。
3. 实现 DASH 分离音视频播放并提炼播放器核心。
4. 补齐内容、收藏、云端历史、评论与互动。
5. 接入 Bilibili 直播，再扩展 Douyin 与 Huya。
6. 建设 Android 播放链路与 FFmpeg 内置运行环境。
7. 统一视频与直播弹幕，再评估下载缓存与更多平台。

## 开发约定

- shadcn 组件样式通过调用处 `className` 覆盖，由 `cn()` 和 `twMerge` 合并。
- `@layer components` 只收录纯自有元素的可复用样式。
- 新增原生能力时，同步修改 `src-tauri/capabilities/default.json`。
- 平台 API 证据、临时调查文件与本地计划统一保存在 Git 排除目录。
- 每个里程碑完成后由用户验收，再更新文档并提交。

## 许可

[MIT](LICENSE)
