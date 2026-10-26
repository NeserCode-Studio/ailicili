---
goal: Build a non-commercial Windows Bilibili desktop client on the existing Tauri 2 and React 19 shell
version: 1.0
date_created: 2026-10-26
last_updated: 2026-10-26
owner: Root
status: 'In progress'
tags:
  - feature
  - architecture
  - tauri
  - bilibili
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

Turn the existing application template into Ailicili, an unofficial non-commercial Windows
Bilibili desktop client.
The implementation is split into independently testable modules. The Rust host owns network
sessions, signatures, credentials, filesystem access, and native capabilities. React owns
presentation, navigation, keyboard interaction, and feature-level state.

## 1. Requirements & Constraints

- **REQ-001**: Reuse the existing Tauri 2, React 19, TypeScript, Tailwind CSS 4, Radix/shadcn, and Rust stack.
- **REQ-002**: Deliver discovery, authentication, search, UGC playback, danmaku, comments, social actions, user content, PGC, live, downloads, history, favorites, and watch-later surfaces.
- **REQ-003**: Keep every shipped control functional; unavailable platform-gated operations must use an explicit capability state or open the corresponding Bilibili page.
- **REQ-004**: Preserve the existing tray window, lifecycle bus, settings center, theme system, command palette, and i18n contract.
- **REQ-005**: Verify each phase with `pnpm lint`, `pnpm build`, focused frontend tests, and `cargo check`.
- **SEC-001**: Never expose session cookies, CSRF tokens, signed media URLs, or credentials to the frontend or logs.
- **SEC-002**: Store account credentials in the operating-system credential store; do not persist them in `localStorage`.
- **SEC-003**: Do not implement DRM circumvention, paid-content bypass, region unlocking, ad removal, bulk scraping, or automated mass actions.
- **CON-001**: `src/components/ui/**` is generated shadcn code and must not be edited manually.
- **CON-002**: Tauri capabilities must be declared in `src-tauri/capabilities/default.json` before native calls are enabled.
- **CON-003**: The current project is MIT-licensed. Wiliwili and Bili.Copilot are GPL-3.0 references and their source must not be copied into this repository.
- **CON-004**: bilibili-API-collect has been permanently withdrawn after a legal notice; do not vendor or reproduce its documentation.
- **CON-005**: The current delivery targets Windows only and is non-commercial; macOS, Linux, and commercial distribution are out of scope.
- **GUD-001**: Use feature-oriented directories under `src/features/` for business UI and keep generated primitives under `src/components/ui/`.
- **GUD-002**: Use Rust commands for remote data access; React components must not call Bilibili APIs directly.
- **GUD-003**: Use TanStack Query for server state, local React state for transient UI, and a dedicated player store only when playback is introduced.
- **PAT-001**: Return typed DTOs from Rust and validate response envelopes before mapping them to frontend models.
- **PAT-002**: Proxy media and image URLs through scoped Tauri URI schemes when the WebView requires CDN-specific headers.

## 2. Implementation Steps

| Phase | Goal | Detailed plan | Status |
|------|------|---------------|--------|
| 1 | Establish project governance, brand shell, Rust API client, and real discovery surfaces | [01-foundation-discovery.md](plan-bilibili/01-foundation-discovery.md) | Complete |
| 2 | Add QR authentication, secure sessions, WBI-backed search, and account identity | [02-auth-search.md](plan-bilibili/02-auth-search.md) | Complete |
| 3 | Add UGC playback, danmaku, comments, social actions, history, and favorites | [03-playback-social.md](plan-bilibili/03-playback-social.md) | Complete |
| 4 | Add PGC, live, downloads, offline cache, and watch-later workflows | [04-pgc-live-downloads.md](plan-bilibili/04-pgc-live-downloads.md) | Complete |
| 5 | Harden security, accessibility, performance, packaging, updates, and release documentation | [05-release-hardening.md](plan-bilibili/05-release-hardening.md) | Planned |

Phase 4 progress:

- 4A PGC catalogs and season detail: complete.
- 4B live catalog, dedicated live player, and chat: complete.
- 4C persistent downloads, optional FFmpeg muxing, and download center: complete.
- 4D watch-later completion, guest offline metadata browsing, and final Phase 4 verification:
  complete.

## 3. Alternatives

- **ALT-001**: Embed the Bilibili website in a single WebView. Rejected as the primary architecture because it cannot provide native navigation, a controlled player state machine, offline data, or consistent desktop behavior.
- **ALT-002**: Make MPV the mandatory player in phase 1. Rejected because it adds platform-specific binary distribution before the basic browsing path is stable; DASH in the WebView is the first playback target and MPV remains an optional enhancement.
- **ALT-003**: Port Wiliwili or Bili.Copilot code. Rejected because both are GPL-3.0 and the existing repository is MIT.
- **ALT-004**: Implement all network calls in the frontend with `tauri-plugin-http`. Rejected because cookies, WBI signatures, redaction, and CDN headers need one auditable Rust boundary.

## 4. Dependencies

- **DEP-001**: Existing Tauri 2 and Rust 1.95 toolchain.
- **DEP-002**: Existing React 19, React Router 7, Tailwind CSS 4, and shadcn/Radix primitives.
- **DEP-003**: `@tanstack/react-query` for remote data caching and request lifecycle management.
- **DEP-004**: `reqwest`, `tokio`, `serde`, `serde_json`, and `thiserror` for the Rust API layer.
- **DEP-005**: `dash.js`, `hls.js`, or `mpegts.js` when the corresponding playback protocols enter phase 3 or phase 4.
- **DEP-006**: An OS keyring implementation for encrypted account sessions in phase 2.
- **DEP-007**: SQLite through Rust for local history, download task persistence, and cached metadata in phase 3 or phase 4.

## 5. Files

- **FILE-001**: `src/App.tsx` becomes the provider and route composition root.
- **FILE-002**: `src/features/**` owns Bilibili feature UI and models.
- **FILE-003**: `src-tauri/src/bili/**` owns Bilibili transport, DTOs, authentication, signing, and media proxying.
- **FILE-004**: `src-tauri/src/lib.rs` registers plugins, commands, protocol handlers, and the existing tray behavior.
- **FILE-005**: `src/App.css` owns design tokens and reusable self-authored component classes.
- **FILE-006**: `.agent/plan-bilibili/**` owns executable phase plans.
- **FILE-007**: `.agent/docs/codebase/**` records verified architecture and conventions.

## 6. Testing

- **TEST-001**: Unit-test frontend formatters and Rust response mapping with fixtures.
- **TEST-002**: Component-test loading, empty, error, and populated discovery states.
- **TEST-003**: Contract-test every Tauri command shape with serialized fixtures.
- **TEST-004**: Add live, opt-in smoke tests for public discovery and authenticated endpoints.
- **TEST-005**: Add Playwright desktop viewport tests for navigation, keyboard controls, player teardown, and responsive layout.
- **TEST-006**: Run `pnpm lint`, `pnpm build`, `cargo check`, `pnpm test`, and `cargo test` before phase completion.

## 7. Risks & Assumptions

- **RISK-001**: Bilibili can change access controls, response schemas, or CDN behavior without notice.
- **RISK-002**: Any future public distribution of a third-party client can create trademark, contract, or unfair-competition exposure.
- **RISK-003**: WebView DASH support differs by platform and may not cover every DRM-protected PGC title.
- **RISK-004**: Aggressive request patterns can trigger risk control or account restrictions.
- **RISK-005**: Live chat, danmaku, and comments produce high-volume state that can degrade React performance if rendered naively.
- **ASSUMPTION-001**: Windows 10/11 is the only supported target for the current delivery; other platforms are not part of the active plan.
- **ASSUMPTION-002**: Users authenticate with their own accounts and may only access content their account is entitled to view.
- **ASSUMPTION-003**: The project remains non-commercial and includes a prominent unofficial-client disclaimer.

## 8. Related Specifications / Further Reading

- [Architecture baseline](plan-bilibili/00-architecture.md)
- [Tauri 2 documentation](https://v2.tauri.app/)
- [React 19 documentation](https://react.dev/)
- [TanStack Query documentation](https://tanstack.com/query/latest)
- [Wiliwili reference](https://github.com/xfangfang/wiliwili) (GPL-3.0, design reference only)
- [Bili.Copilot reference](https://github.com/Richasy/Bili.Copilot) (GPL-3.0, feature reference only)
- [bili-rust reference](https://github.com/chanmaoganda/bili-rust) (MIT, architecture reference)
- [BDL reference](https://github.com/Yuelioi/bdl) (MIT, download architecture reference)
