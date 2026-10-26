# Testing Patterns

## Core Sections (Required)

### 1) Test Stack and Commands

- Primary frontend runner: Vitest 3 with a jsdom environment configured in `vite.config.ts`.
- Component assertions: Testing Library, `@testing-library/jest-dom`, and a shared provider renderer.
- Native tests: Rust unit and integration tests via Cargo; network smoke tests are marked `#[ignore]`.
- Browser tooling: Playwright 1.64 is installed for viewport and visual smoke checks.
- Commands:

```bash
pnpm test
pnpm test -- src/features/pgc
pnpm lint
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml bili::pgc::tests::live_pgc_smoke -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml bili::live::tests::live_catalog_and_stream_smoke -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml bili::live_chat::tests::live_chat_connection_smoke -- --ignored --nocapture
pnpm exec playwright test --config .agent/screenshots/playwright.config.ts --grep "live"
```

### 2) Test Layout

- Frontend tests are co-located with features or utilities using `*.test.ts` and `*.test.tsx`.
- Shared rendering lives in `src/test/render.tsx`; global browser shims and cleanup live in
  `src/test/setup.ts`.
- Typed frontend fixtures live in `src/test/fixtures/bili.ts`.
- Rust tests live beside mapping and validation code in `#[cfg(test)]` modules.
- Network smoke tests use explicit `#[ignore]` annotations and must opt in with `--ignored`.

### 3) Test Scope Matrix

| Scope | Covered? | Typical target | Notes |
|-------|----------|----------------|-------|
| Unit | Yes | Formatters, layouts, preferences, Rust DTO mapping | Fast deterministic checks |
| Component | Yes | Discovery, PGC, live catalog/player/chat, UGC player, comments, social actions, libraries | TanStack Query and command wrappers are isolated |
| Route | Yes | Main app and dedicated-player routes | Verifies route composition and lazy boundaries |
| Live network | Opt-in | Public discovery, search, comments, playback, PGC, live catalog, HLS session | Depends on upstream availability and risk controls |
| Visual/E2E | Partial | Responsive viewport and dedicated-window smoke | Covers major surfaces, but not native window/tray automation |

### 4) Mocking and Isolation Strategy

- Mock at the typed command wrapper boundary such as `@/lib/bili`, not inside presentation components.
- Mock external browser/shell calls at `@/lib/external`.
- Mock the dynamically imported hls.js module in component tests and use opaque live-session
  fixtures; Playwright also intercepts the dynamic HLS chunk and CDN images.
- Use `renderWithProviders` for a fresh TanStack Query client and `MemoryRouter`; route components
  that call `useParams` must be mounted through a matching `Routes` entry.
- Rust mapping tests deserialize realistic JSON fixtures with `serde_json`.
- Live tests are isolated from normal runs because Bilibili schemas, access controls, and risk
  responses can change without notice.

### 5) Coverage and Quality Signals

- Coverage provider and threshold: `[TODO]` No coverage command or threshold is configured.
- Current reported coverage: `[TODO]`
- Highest-risk gaps: native window/tray automation, download resume integrity, FFmpeg capability
  detection, and repository-level cross-window E2E coverage.
- Baseline checks should include `pnpm test`, `pnpm lint`, `pnpm build`, and Cargo tests before
  phase completion.

### 6) Evidence

- `package.json`
- `vite.config.ts`
- `src/test/render.tsx`
- `src/test/setup.ts`
- `src/test/fixtures/bili.ts`
- `src-tauri/src/bili/pgc.rs`
- `src-tauri/src/bili/live.rs`
- `src-tauri/src/bili/live_chat.rs`
- `src/features/live/*.test.tsx`
- `.agent/screenshots/visual.spec.ts`
