# External Integrations

## Core Sections (Required)

### 1) Integration Inventory

| System | Type (API/DB/Queue/etc) | Purpose | Auth model | Criticality | Evidence |
|--------|---------------------------|---------|------------|-------------|----------|
| Tauri host | Native bridge | Window, tray, plugin, and command access | Tauri capability allowlist | High | `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json` |
| External browser/shell | OS handoff | Open approved URLs or shell targets | User action and allowlist | Low | `package.json`, `src-tauri/capabilities/default.json` |
| Bilibili public API | Remote HTTP API | Discovery, search suggestions, PGC, live catalogs, danmaku, comments, user content, and playback metadata | Guest requests; some WBI-signed | High | `src-tauri/src/bili/client.rs`, `src-tauri/src/bili/commands.rs`, `src-tauri/src/bili/live.rs` |
| Bilibili user API | Remote authenticated API | Account identity, social actions, history, favorites, watch-later, progress | OS-keyring session cookies and CSRF | High | `src-tauri/src/bili/session.rs`, `src-tauri/src/bili/commands.rs` |
| Bilibili media/CDN | HTTP range and image transport | DASH/HLS playback segments and remote covers | Scoped session and CDN headers inside Rust | High | `src-tauri/src/bili/playurl.rs`, `src-tauri/src/bili/live.rs`, `src-tauri/src/bili/stream.rs` |
| Bilibili live chat | WebSocket feed | Text-only live room chat through a bounded Rust cache | WBI-signed room config; cookies remain in Rust | High | `src-tauri/src/bili/live_chat.rs`, `src-tauri/src/bili/commands.rs` |

### 2) Data Stores

| Store | Role | Access layer | Key risk | Evidence |
|-------|------|--------------|----------|----------|
| WebView `localStorage` | UI preferences and history labels | React hooks | Account data must not be stored here | `src/composables/useTheme.ts`, `src/composables/useI18n.ts` |
| Windows Credential Manager | Persisted Bilibili session cookies | Rust `SessionManager` | Credential leakage or incomplete logout cleanup | `src-tauri/src/bili/session.rs` |
| In-memory guest/session caches | Guest cookies, WBI keys, short-lived playback capabilities, HLS sessions, and live chat buffers | Rust `BiliClient`, `LiveMediaSessions`, and the live chat registry | Lifetime bugs or accidental DTO exposure | `src-tauri/src/bili/client.rs`, `src-tauri/src/bili/wbi.rs`, `src-tauri/src/bili/playurl.rs`, `src-tauri/src/bili/live.rs`, `src-tauri/src/bili/live_chat.rs` |

### 3) Secrets and Credentials Handling

- Credential source: the current Windows account's operating-system credential store.
- Persisted session fields are limited to the Bilibili cookies needed by authenticated commands.
- CSRF values and cookies stay in Rust; only typed account/profile DTOs cross the Tauri bridge.
- Signed HLS CDN URLs and segment capabilities stay in short-lived Rust sessions; the WebView
  receives only opaque `bilistream.localhost` playlist and asset URLs.
- Logout clears the managed session and authenticated React query state.

### 4) Reliability and Failure Behavior

- Timeout policy: eight-second connect timeout and fifteen-second request timeout in `BiliClient`.
- Retry behavior: TanStack Query controls UI retries; live network smoke tests are opt-in.
- Fallback behavior: capability-gated PGC episodes and unsupported interactions route to the
  corresponding Bilibili page with an explicit message. If live area filtering is risk-controlled,
  the UI labels globally recommended rooms as a fallback instead of presenting them as filtered results.
- Live playback: hls.js is preferred when supported, playlists are rewritten by Rust, network and
  media failures get bounded recovery attempts, and hidden player windows stop HLS and chat work.
- Live chat: WBI signs the room server configuration, Windows native TLS carries the WebSocket,
  and an authenticated session's numeric user ID must match the attached session cookies.
- Response handling: typed envelopes, upstream code checks, missing-data validation, and stable
  command error codes.

### 5) Observability for Integrations

- Logging around external calls: frontend uses the shared scoped logger; Rust transport failures
  intentionally omit request URLs and signed query details.
- Metrics/tracing coverage: none.
- Missing visibility gaps: request duration, retry count, and connection-level diagnostics.

### 6) Evidence

- `src-tauri/capabilities/default.json`
- `src-tauri/src/bili/client.rs`
- `src-tauri/src/bili/commands.rs`
- `src-tauri/src/bili/live.rs`
- `src-tauri/src/bili/live_chat.rs`
- `src-tauri/src/bili/playurl.rs`
- `src-tauri/src/bili/session.rs`
- `src-tauri/src/lib.rs`
- `src/lib/logger.ts`
