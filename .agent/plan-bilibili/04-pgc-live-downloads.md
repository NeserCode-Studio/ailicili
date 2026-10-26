---
goal: Add PGC catalogs, live streaming, downloads, offline cache, and watch-later workflows
version: 1.3
date_created: 2026-10-26
last_updated: 2026-10-26
owner: Root
status: 'Complete'
tags:
  - feature
  - pgc
  - live
  - download
---

# Introduction

![Status: Complete](https://img.shields.io/badge/status-Complete-brightgreen)

This phase extends the media client beyond UGC while retaining explicit capability and legal
boundaries for paid, regional, and live-interaction features. Work proceeds in four ordered
sub-phases so each one can be verified and committed before the next begins.

## 1. Requirements & Constraints

- **REQ-001**: Add anime, cinema, documentary, variety, timeline, filters, and episode navigation.
- **REQ-002**: Add live categories, followed rooms, recommended rooms, live playback, chat, and danmaku.
- **REQ-003**: Add a resumable download queue with pause, resume, retry, cancel, and optional FFmpeg muxing.
- **REQ-004**: Add watch-later and offline metadata access.
- **REQ-005**: Offer a web fallback for gated purchases, gifts, DRM playback, and unsupported interactions.
- **SEC-001**: Validate every download path inside the user-selected directory and reject traversal.
- **SEC-002**: Limit download concurrency and never provide bulk scraping controls.
- **CON-001**: Do not bundle FFmpeg by default on every platform; detect or configure it explicitly.
- **CON-002**: Keep live gift/payment interactions out of scope.

## 2. Implementation Steps

### 4A: PGC catalog and season detail

| Task | Description | Status | Date |
|------|-------------|--------|------|
| PGC-001 | Add typed Rust timeline, index, and season-detail commands with response-envelope validation | Complete | 2026-10-26 |
| PGC-002 | Add anime, cinema, documentary, and variety catalog views with timeline, filters, and pagination | Complete | 2026-10-26 |
| PGC-003 | Add season details, episode and extras selection, related-season navigation, and titlebar actions | Complete | 2026-10-26 |
| PGC-004 | Reuse the dedicated player for accessible episodes and fall back to Bilibili for gated or unavailable episodes | Complete | 2026-10-26 |
| PGC-005 | Route PGC search results into the app and cover mapping, UI, routes, and live smoke with tests | Complete | 2026-10-26 |

Verification for 4A:

- `pnpm test`: 23 files and 99 tests passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 40 passed and 6 opt-in live tests ignored.
- Live `live_pgc_smoke`: passed against the public index, timeline, and season endpoints.
- Playwright visual smoke at 1440x900 and 900x720: no console errors or horizontal overflow.
- `pnpm lint` and `pnpm build`: passed with only pre-existing warnings.

### 4B: Live

| Task | Description | Status | Date |
|------|-------------|--------|------|
| LIVE-001 | Add live-area, recommendation, room-detail, and quality DTOs behind typed Rust commands; preserve an explicit global-recommendation fallback when area filtering is risk-controlled | Complete | 2026-10-26 |
| LIVE-002 | Add a short-lived Rust HLS session that proxies rewritten playlists and opaque segment URLs without exposing signed CDN addresses | Complete | 2026-10-26 |
| LIVE-003 | Build the `/live` catalog and titlebar/navigation entry with area selection, pagination, loading, empty, error, and fallback states | Complete | 2026-10-26 |
| LIVE-004 | Build `/player/live/:roomId` in the fixed dedicated player window with HLS quality switching, reconnect, volume, fullscreen, and teardown on hide | Complete | 2026-10-26 |
| LIVE-005 | Add bounded live chat ingestion through Rust, polling/cursor delivery, room chat UI, and optional danmaku presentation | Complete | 2026-10-26 |
| LIVE-006 | Route live search results into the app, remember the last live player target, and provide explicit Bilibili web fallbacks | Complete | 2026-10-26 |
| LIVE-007 | Add Rust mapping and HLS rewrite tests, frontend component/route/lifecycle tests, an ignored live smoke test, and desktop/mobile visual checks | Complete | 2026-10-26 |
| LIVE-008 | Update README and codebase integration/testing notes, run the complete quality gate, and commit 4B separately | Complete | 2026-10-26 |

Verified 4B interface decisions:

- Area catalog: `xlive/web-interface/v1/index/getWebAreaList?source_id=2`; IDs must
  deserialize from both strings and numbers.
- Global recommendations: `xlive/web-interface/v1/index/getList?platform=web` and
  `room/v1/room/get_user_recommend`; both are public and work with the guest identity.
- Area-filtered web/app feeds currently return upstream `-352` even with guest identity and
  WBI. The UI must disclose when it falls back to global recommendations instead of showing
  unrelated rooms as if they matched the selected area.
- Room detail: `room/v1/Room/get_info` plus `live_user/v1/Master/info`.
- Playback: `xlive/web-room/v2/index/getRoomPlayInfo`; prefer HLS fMP4/AVC, then HLS TS/AVC,
  and refetch when the requested quality changes.
- Chat configuration: WBI-signed `xlive/web-room/v1/index/getDanmuInfo`. The WebSocket
  ingestion task stays in Rust; React receives only bounded, text-only chat events.
- `bilistream` responds with buffered bodies, so HLS is proxied as a rewritten media playlist
  plus opaque segment/key tokens. Signed CDN URLs and cookies never cross the Tauri boundary.
- The WebView prefers hls.js even if `canPlayType` reports native HLS support, because Chromium
  can accept the MIME type but still fail to fetch the opaque localhost playlist.

Verification for 4B:

- `pnpm test`: 27 files and 117 tests passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 49 passed and 8 opt-in live tests ignored.
- `live_catalog_and_stream_smoke`: passed against public area, recommendation, room, and HLS data.
- `live_chat_connection_smoke`: passed against a public live room, including WebSocket
  authentication and the initial connected acknowledgement.
- Playwright live catalog and player checks passed at 1440x900, 900x720, 1280x820, and 900x700
  with no console errors or document overflow.
- `pnpm lint`, `pnpm build`, and `cargo check --manifest-path src-tauri/Cargo.toml`: passed with
  only pre-existing shadcn Fast Refresh warnings and bundle-size warnings.

### 4C: Downloads and offline cache

Detailed execution plan: [04c-downloads.md](04c-downloads.md)

| Task | Description | Status | Date |
|------|-------------|--------|------|
| DL-001 | Define the persistent download task schema and scoped path validation | Complete | 2026-10-26 |
| DL-002 | Implement a bounded, resumable HTTP downloader with pause, retry, cancel, and integrity checks | Complete | 2026-10-26 |
| DL-003 | Add optional user-provided FFmpeg detection, muxing, subtitle, cover, and danmaku outputs | Complete | 2026-10-26 |
| DL-004 | Add the download center, progress events, tray integration, notifications, and offline metadata | Complete | 2026-10-26 |

Verification for 4C:

- `pnpm test`: 30 files and 123 tests passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 63 passed and 9 opt-in live tests ignored;
  the full Rust suite passed five consecutive runs after test-directory isolation was fixed.
- `live_download_source_smoke`: passed against public playurl and DASH source resolution.
- Playwright download, settings, and download-dialog checks passed at 1440x900 and 900x720 with no
  console errors or horizontal overflow.
- `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`, `cargo fmt`, and `cargo check` passed.

### 4D: Watch later and completion

Detailed execution plan: [04d-library-completion.md](04d-library-completion.md)

| Task | Description | Status | Date |
|------|-------------|--------|------|
| FIN-001 | Complete watch-later and offline metadata browsing across existing library surfaces | Complete | 2026-10-26 |
| FIN-002 | Reconcile all capability fallbacks, README, architecture docs, and phase test coverage | Complete | 2026-10-26 |
| FIN-003 | Run the complete Phase 4 quality gate and commit the final sub-phase separately | Complete | 2026-10-26 |

Verification for 4D:

- The offline library is login-independent, capped at 500 completed records, and exposes file
  availability only after canonical containment checks.
- Guest, account protection, artifact badges, split-media labeling, empty, error, reveal, and
  remove flows have component coverage.
- Watch later now includes count, refresh, individual removal, and confirmed clear-all behavior.
- Playwright checks cover desktop and compact offline layouts plus the guest default tab.
- The full frontend, Rust, typecheck, lint, build, and formatting gates pass.

## 3. Alternatives

- **ALT-001**: Bundle BBDown. Rejected because it adds a third-party GPL/compliance and update burden; a native Rust queue provides tighter control.
- **ALT-002**: Implement live interaction with gifts and payments. Rejected because those flows are legally sensitive and outside the viewer scope.

## 4. Dependencies

- **DEP-001**: `hls.js` and `mpegts.js` for live playback.
- **DEP-002**: Optional user-provided FFmpeg binary.
- **DEP-003**: SQLite task persistence and Tauri progress events.

## 5. Files

- **FILE-001**: `src/features/pgc/**`
- **FILE-002**: `src/features/live/**`
- **FILE-003**: `src/features/downloads/**`
- **FILE-004**: `src-tauri/src/bili/pgc.rs`
- **FILE-005**: `src-tauri/src/bili/live.rs`
- **FILE-006**: `src-tauri/src/downloads/**`

## 6. Testing

- **TEST-001**: Test PGC and live DTO mapping with fixtures.
- **TEST-002**: Test path sanitization, segmented resume, cancellation, and manifest verification.
- **TEST-003**: Test live playback teardown and reconnect behavior.
- **TEST-004**: Test tray progress and completion/cancellation events.

## 7. Risks & Assumptions

- **RISK-001**: Some PGC content cannot be played in the WebView because of DRM or codec limitations.
- **RISK-002**: Live protocols and authentication can change.
- **RISK-003**: Download support can be misused for redistribution.
- **ASSUMPTION-001**: Downloads are limited to content the user is authorized to save.

## 8. Related Specifications / Further Reading

- [Playback and social](03-playback-social.md)
- [Release hardening](05-release-hardening.md)
