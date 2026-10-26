---
goal: Implement persistent, resumable Bilibili downloads and the download center
version: 1.1
date_created: 2026-10-26
last_updated: 2026-10-26
owner: Root
status: 'Complete'
tags:
  - downloads
  - offline-cache
  - rust
  - tauri
---

# 4C Downloads and Offline Cache

![Status: Complete](https://img.shields.io/badge/status-Complete-brightgreen)

## Scope

Deliver UGC video downloads for content the current account is entitled to access. Signed media
URLs stay in Rust. The frontend submits only `bvid`, `cid`, and a quality ID, then receives stable
task snapshots and progress events.

## Execution Order

| Node | Work | Verification |
|------|------|--------------|
| 4C-1 | SQLite task repository, app-data database, configurable root, filename/path sandbox, FFmpeg setting | Rust round-trip, restart recovery, traversal and reserved-name tests |
| 4C-2 | Resolve download tracks, bounded two-task queue, Range resume, pause/resume/retry/cancel, byte integrity checks | Local HTTP resume/range test and queue state tests |
| 4C-3 | Cover, raw danmaku, optional subtitles, optional FFmpeg detection/muxing, stable metadata manifest | Attachment and FFmpeg argument tests |
| 4C-4 | `/downloads` center, video-detail queue dialog, progress events, command/nav/tray entry, notifications, i18n | Component, route, tray/lifecycle and Playwright viewport tests |
| 4C-5 | Full quality gate, public download smoke where non-destructive, documentation and separate commit | `pnpm test`, `pnpm lint`, `pnpm build`, `cargo test`, `cargo check` |

All five nodes are complete. Download records persist in app data, media and attachment files are
written only below the configured download root, and incomplete records intentionally block a root
folder change so resume and retry paths remain valid.

## Verified Behavior

- The frontend suite passed with 30 files and 123 tests.
- The Rust suite passed with 63 offline tests and 9 opt-in network tests ignored; the full suite was
  repeated five times after isolating per-test temporary directories.
- `live_download_source_smoke` passed against the public Bilibili playurl endpoints.
- `pnpm lint`, `pnpm build`, `cargo fmt`, and `cargo check` passed. Lint reported only the six
  pre-existing generated shadcn Fast Refresh warnings.
- Playwright checks at 1440x900 and 900x720 covered the populated download center, download settings,
  and video download dialog without console errors or horizontal overflow.

## Data Model

- `id`: UUID generated in Rust and validated before command use.
- Content identity: `bvid`, `cid`, `aid`, page title, video title, cover URL, duration.
- Selection: quality ID, label, width, height, bandwidth.
- State: status, phase, completed/total bytes, speed, ETA, timestamps, error code/message.
- Outputs: task directory plus merged/raw video, audio, cover, danmaku, subtitle and metadata paths.
- Signed CDN URLs, request cookies, CSRF values, and FFmpeg process output never enter SQLite or
  cross the frontend boundary.

## Runtime Rules

- Maximum two active download jobs; additional jobs stay queued.
- Start or resume re-resolves fresh play URLs from Bilibili.
- Interrupted tasks become paused after process restart. Only an explicit user action resumes them.
- Each media stream writes to a `.part` file and resumes with HTTP Range when the server returns
  `206`; a `200` response safely restarts that file.
- A completed file must match the server-reported total length before it is promoted from `.part`.
- Cover, danmaku, and subtitle failures are warning metadata and do not discard already downloaded
  media. Media or mux failures remain retryable.
- FFmpeg is optional. Without it, the task still completes with separate video/audio files.
- Task destinations are derived under the configured root. No frontend-provided destination path,
  filename, or shell command is accepted.

## UI Contract

- `/downloads` lists active, paused, failed, and completed tasks with byte progress and phase.
- Every control maps to a command: pause, resume, retry, cancel, remove record, reveal output.
- Video details expose a titlebar download action and a dialog with available quality choices.
- Native tray menu links to downloads; tray tooltip reflects active task count.
- Completion and failure notifications are emitted from Rust.
- Frontend listens to one typed `download-progress` event and refreshes the task query on terminal
  states.

## Security and Compliance

- Validate hosts against Bilibili media/image/comment/subtitle host suffixes before downloading.
- Sanitize Windows-invalid characters, control characters, reserved device names, and trailing
  dots/spaces; cap filename length.
- Canonicalize the configured root and every created task directory, and reject paths that escape
  the canonical root.
- Limit attachment sizes and do not expose filesystem paths outside download task DTOs.
- Do not offer batch URL scraping or DRM/paid-content bypass.
