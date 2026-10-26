# Ailicili

Ailicili is an unofficial, non-commercial Bilibili desktop client for Windows, built
on the existing Tauri 2 and React 19 application shell. It is not affiliated with or
endorsed by Bilibili.

The project is being delivered in phases. Phases 1 through 4 currently provide:

- A branded desktop shell with discovery navigation, settings, tray, theme, and command palette.
- Live public Bilibili discovery data backed by a typed Rust command.
- Video detail pages with author, statistics, description, and multi-part metadata.
- QR authentication with locally rendered codes and live account status.
- Windows Credential Manager-backed sessions and an account identity menu.
- WBI-signed video, user, PGC, and live search with suggestions, history, and pagination.
- A dedicated player window with DASH playback, proxied media ranges, quality and speed
  controls, theater mode, fullscreen, picture-in-picture, local resume, and watch-progress
  synchronization.
- Canvas danmaku with mode, density, opacity, area, font-size, speed, and collision handling,
  plus authenticated danmaku sending.
- Comments with emote rendering, nested replies, and authenticated comment and reply posting.
- Optimistic like, coin, favorite, follow, and triple actions with rollback on failure.
- Personal history, favorites, watch-later, user-space, and dynamic-feed pages.
- PGC timelines and catalogs for anime, films, documentaries, and variety, plus season details,
  episode selection, related-season navigation, and dedicated-window playback with web fallback.
- Live area and global-recommendation catalogs, room details, dedicated-window HLS playback,
  quality switching, reconnect behavior, and text chat with an explicit risk-control fallback.
- A persistent two-job download queue with pause, resume, retry, cancel, HTTP Range continuation,
  optional FFmpeg muxing, cover/danmaku/subtitle attachments, progress events, tray status, and
  completion notifications.
- A guest-accessible offline library backed by completed download records, with explicit
  availability for merged MP4, split media streams, covers, danmaku, subtitles, and metadata.
- A complete watch-later view with item count, refresh, removal, and confirmed clear-all actions.
- Explicit loading, error, retry, empty, and pagination states.
- Unit, component, route, Rust mapping, and opt-in live network tests, with Playwright available
  for viewport and visual smoke checks.

## Stack

- Tauri 2 and Rust
- React 19, React Router 7, and TypeScript
- TanStack Query
- Tailwind CSS 4 and shadcn/Radix primitives
- Vitest, Testing Library, and Playwright

## Development

Prerequisites:

- Windows 10 or 11 with Microsoft Edge WebView2 Runtime
- Node.js 20 or newer
- pnpm 9 or newer
- A stable Rust toolchain
- Tauri Windows build dependencies and the Windows SDK
- Optional: FFmpeg on `PATH` or selected in download settings for automatic audio/video muxing

```bash
pnpm install
pnpm tauri dev
```

Useful checks:

```bash
pnpm lint
pnpm test
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## Architecture

- `src-tauri/src/bili/` owns HTTP transport, WBI signing, session persistence,
  response validation, stable DTO mapping, playback sessions, media proxying, and
  command registration.
- `src-tauri/src/downloads/` owns the SQLite queue, scoped download paths, resumable media
  transfer, optional FFmpeg muxing, attachments, and native download events.
- `src/app/` owns providers, query caching, the window shell, and route composition.
- `src/features/` owns discovery, PGC, live, playback, danmaku, comments, social actions,
  personal libraries, authentication, and search UI.
- `src/shared/` owns frontend contracts shared by features.
- `src/components/ui/` is generated shadcn code and is not edited manually.

React calls typed Tauri commands rather than Bilibili endpoints directly, keeping
cookies, CSRF values, WBI signatures, signed media URLs, CDN-specific headers, and
credential storage inside the Rust boundary.

## Account and Privacy

- QR login state is tracked by a short-lived opaque attempt ID. The Bilibili
  `qrcode_key` never leaves the Rust process.
- Only `SESSDATA`, `bili_jct`, `DedeUserID`, and `DedeUserID__ckMd5` are persisted,
  using Windows Credential Manager under the current Windows account.
- Session cookies and CSRF values are never written to frontend storage or exposed
  through Tauri command DTOs.
- Guest search identity cookies are held in process memory. Network failures return
  fixed error details so signed URLs are not reflected to the WebView.
- Short-lived media URLs and request cookies are not persisted in the download database
  or exported in offline manifests.

## Downloads and Offline Files

- Downloads are limited to individual UGC video parts selected from the current page; there
  is no batch URL import or bulk scraping.
- The queue runs at most two jobs at once. Paused and interrupted jobs resume from `.part`
  files only after the user explicitly resumes them.
- Without FFmpeg, completed tasks retain separate `video.m4s` and `audio.m4s` streams.
  With a configured FFmpeg executable, the app also writes a playable `video.mp4`.
- Each task folder may include the cover, raw danmaku, subtitles when available, and a
  metadata manifest. A failed optional attachment is reported as a warning without discarding
  successfully downloaded media.
- The offline library is available without signing in. It returns stable metadata and file
  availability only; absolute task paths stay behind the download-center commands.
- Completed files are marked available only after canonical path checks confirm they are regular
  files inside the recorded task directory. Removing an offline record does not delete its files.
- The download folder cannot be changed while incomplete task records exist, because those
  records retain paths needed for resume and retry.

## Delivery Phases

1. Complete: foundation, public discovery, and video detail.
2. Complete: QR authentication, secure sessions, WBI search, and account identity.
3. Complete: UGC playback, danmaku, comments, social actions, history, favorites,
   watch-later, user space, and dynamic feeds.
4. Complete: PGC catalogs, live streaming, resumable downloads, offline metadata, and
   watch-later workflows.
5. Next: security, accessibility, performance, packaging, updates, and release hardening.

## Compliance

Ailicili is non-commercial and currently targets Windows only. It does not implement
DRM circumvention, paid-content bypass, region unlocking, ad removal, bulk scraping,
or automated mass actions. Users are responsible for accessing only content they are
entitled to view.

The repository is MIT-licensed. Wiliwili and Bili.Copilot are GPL-3.0 projects and
are used only as high-level design references; their source is not copied into this
repository.

## License

[MIT](LICENSE)
