# Expo P0 spikes (0.1 / 0.3 / 0.4)

Status: **recorded** — 2026-08-21
Plan: `docs/design/flutter-to-expo-migration-plan.md`
Baseline: desktop v0.55.2-alpha

0.2 (crypto) and 0.5 / 0.6 (chat-core) live in their own notes. This file closes the remaining P0 gates.

---

## 0.1 mDNS — fallback accepted

**Verdict:** relay-only + manual `host:port`. Do **not** block P2 pairing on mDNS.

| | |
|--|--|
| Flutter | `nsd` browse `_superone._tcp.` (`lib/lan_discovery.dart`) |
| Desktop | `LanAdvertiser` publishes `_superone._tcp` (`lan-advertiser.ts`) |
| RN | no first-party zeroconf that matches iOS + Android + Expo CNG without a config plugin |

Hardware discovery is not in this worktree. P2 QR pairing talks to the relay; LAN is an optional later path (WP-22) via typed address.

**Plist / Android notes (when WP-22 retries mDNS):**

- iOS `NSBonjourServices`: `_superone._tcp.`
- iOS `NSLocalNetworkUsageDescription`: discover the desktop on the LAN
- iOS `NSBonjourServices` already stamped on `apps/mobile` `app.json` so a future plugin does not fight Info.plist
- Android: `CHANGE_WIFI_MULTICAST_STATE` + local-network permission when a discovery library lands

Until then the client must accept:

1. QR / paste relay pairing (required)
2. Manual LAN `host:port` (optional)
3. No auto-discovery

---

## 0.3 Metro + bun hoisted workspaces

**Verdict:** explicit Metro config at `apps/mobile/metro.config.js`. Do not rely on Expo autodetection alone under bun's hoisted linker.

Rules:

- `watchFolders` includes the monorepo root
- `resolver.nodeModulesPaths` is `[apps/mobile/node_modules, <root>/node_modules]`
- `unstable_enableSymlinks: true`
- `unstable_enablePackageExports: true` so `@superone/shared/*` follows `packages/shared/package.json` `exports`
- **Leaf subpaths only.** Allowed first imports: `agent-types`, `event-seq-utils`, `agent-event-batcher`, `content-delta`, `tool-ui`, `agent-error`, `harness-brand`.
  **Forbidden:** `attachment-store`, `git-clone` (Node `fs` / `child_process`). Alias fallback if Metro ever fails exports: map `@superone/shared/*` → `packages/shared/src/*.ts`.

Proof: `apps/mobile/scripts/assert-shared-resolution.ts` (workspace import + export-map lint). `bun run dev:mobile` is the Metro boot.

---

## 0.4 WebView window + RSS budget

Device RSS cannot be sampled until a WebView bundle exists (WP-18). Fail-closed sizes are locked now so WP-18 cannot “optimise later”.

### Stress corpus (owned)

| Recording | Size | Why |
|-----------|------|-----|
| `apps/desktop/scripts/recordings/show-widget.db` | 2.8 MB / 8128 events | longest; widgets + scroll |
| `apps/desktop/scripts/recordings/claude-todos.db` | 1.8 MB / 4586 events | 183 `remote.out` frames (most mobile-like) |
| `apps/desktop/scripts/recordings/mermaid-latex.db` | 160 KB / 303 events | mermaid + LaTeX paint |

`remote.out` on these traces is already coalesced (paragraph / 33 ms upstream). Mobile still must not exceed **1 RN→WebView envelope / 33 ms**.

### Fail-closed budgets (plan §9)

| Metric | Gate |
|--------|------|
| Streaming paint inside WebView | p95 **&lt; 20 ms** (`setTimeout` 33 ms throttle, never rAF) |
| Peak RSS after 200 turns (code + mermaid) | **&lt; 250 MB** |
| Cold start → first chat frame | **&lt; 500 ms** |
| RN → WebView envelopes | **≤ 1 / 33 ms** |
| Tool expand/collapse | **0 bridge hops** |

If RSS exceeds 250 MB: **tighten the DOM window first**, do not ship WP-19.

### Initial DOM window (mandatory day one)

| Constant | Value | Why |
|----------|-------|-----|
| `initialTurns` | **24** | 2× desktop `INITIAL_RENDER_COUNT` (12) so mermaid/widgets have room |
| `loadMoreTurns` | **8** | 2× desktop `LOAD_MORE_COUNT` (4) |
| `maxMountedTurns` | **40** | hard cap; returning to bottom shrinks to `initialTurns` |
| `streamingThrottleMs` | **33** | match `CopyableMarkdown` / `AGENT_EVENT_BATCH_MS` |
| `envelopeMs` | **33** | RN host batch |

Constants live in `apps/mobile/src/chat-window.ts` until `@superone/chat-view` exists (WP-18 copies them).

### `error(fatal)` recovery

WebView posts `error(fatal)` → RN reloads the WebView and re-sends `hydrate` from RN-owned `ChatCoreSession` + persisted `viewState`. Do not try to repair a dirty DOM.

Device RSS/frame p95 is measured on first hardware boot (WP-07/WP-18) against this corpus. Until then these numbers are the gate, not a target to relax.
