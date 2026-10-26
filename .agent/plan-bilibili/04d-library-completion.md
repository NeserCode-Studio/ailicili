---
goal: Complete watch-later workflows and add login-independent offline metadata browsing
version: 1.0
date_created: 2026-10-26
last_updated: 2026-10-26
owner: Root
status: 'Complete'
tags:
  - library
  - watch-later
  - offline
  - downloads
---

# 4D Library Completion and Offline Metadata

## Scope

Finish the Phase 4 personal-library surface without coupling local downloads to an account
session. Offline metadata is derived from completed SQLite download records and verified local
files. It exposes stable metadata and artifact availability, never arbitrary filesystem paths.

## Execution Order

| Node | Work | Verification |
|------|------|--------------|
| 4D-1 | Add a bounded offline-library DTO and Rust command derived from completed download records with sandboxed file checks | Rust model and repository tests |
| 4D-2 | Add `/library` offline tab with download metadata, artifact badges, reveal/remove actions, empty/error states, and guest access | Component and route tests |
| 4D-3 | Complete watch-later count, refresh, clear-all confirmation, and protected-tab login behavior | Component tests and command registration |
| 4D-4 | Update phase documentation, README, verify all quality gates, and commit 4D separately | Full frontend/Rust tests, lint, build, checks, Playwright |

## Data Contract

Offline entries contain only:

- download task ID, content identifiers, title, part title, cover URL, duration, quality,
  dimensions, byte size, and completion timestamp;
- booleans for available merged MP4, video stream, audio stream, cover, danmaku, subtitle,
  metadata manifest, and task directory.

Absolute paths stay in `DownloadTask` used by the download center. The offline library command
does not return paths and validates every candidate file under the canonical task directory.

## UI Contract

- The Library page always exposes the offline tab, including unauthenticated sessions.
- Offline entries are local metadata cards. They link to online detail pages when the network is
  available and expose "show in folder" and "remove record" actions.
- Removing an offline entry removes only its database record; downloaded files are retained.
- A completed task without FFmpeg is labelled as separate video/audio streams. The UI must not
  imply that split streams are a muxed playable MP4.
- Account-backed history, watch-later, and favorites show a login-required state when unauthenticated.
- Watch later shows its count, supports refresh, and supports a confirmed clear-all operation.

## Security and Limits

- Keep offline-library results capped at 500 and sorted by completion time.
- Canonicalize the task directory and each existing artifact before marking it available.
- Reject files that resolve outside the recorded task directory.
- Do not add batch file import, arbitrary path viewing, or automatic deletion of downloaded files.

## Completion

All four execution nodes are complete.

- The Rust command returns at most 500 completed records in descending completion order and
  exposes file availability booleans only after canonical path checks.
- The Library page keeps the offline tab available to guests while account tabs retain
  login-required states.
- Watch later now exposes its count, refresh, individual removal, and a confirmed clear-all action.
- Offline cards distinguish merged MP4s from split video/audio streams, show attachment
  availability, and keep reveal/remove actions explicit.
- Verification:
  - `pnpm test`: 31 files and 130 tests passed.
  - `cargo test --manifest-path src-tauri/Cargo.toml`: 65 passed and 9 opt-in live tests ignored.
  - `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`, `cargo fmt --check`, and `cargo check`
    passed.
  - Playwright offline-library checks passed at 1440x900 and 900x720, plus the guest default
    offline view at 900x720.
