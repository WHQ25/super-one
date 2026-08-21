# CLAUDE.md — `apps/mobile` (`@superone/mobile`)

Expo **dev-client** Remote Control app. Not Expo Go.

Repo-wide layout: root `CLAUDE.md`. Migration plan: `docs/design/flutter-to-expo-migration-plan.md`.

## Runtimes

| Runtime | Owns | Does not own |
|---------|------|----------------|
| **RN shell** | Pairing, nav, native `TextInput`, sheets, MMKV, chat-core reduce, host batching (≤1/33 ms) | Transcript paint |
| **Chat WebView** (`@superone/chat-view`) | DOM paint of reduction patches, scroll, expand | Re-reducing `AgentEvent`s |
| **Terminal WebView** | xterm frames | Event ACK / seq |

Never nest the chat WebView in an RN `ScrollView`. Input is native only.

## Metro / shared

Import **leaf** `@superone/shared/*` only (`agent-types`, `event-seq-utils`, `agent-event-batcher`, `content-delta`, `tool-ui`, …).

Do **not** import `@superone/shared/attachment-store` or `@superone/shared/git-clone` (Node). Metro `blockList` rejects them.

## Commands

```bash
bun run dev:mobile          # Expo dev-client Metro
bun --filter @superone/mobile typecheck
bun --filter @superone/mobile test
```

Needs a **dev client** (`expo run:ios` / `expo run:android`), not Expo Go.

Pairing: paste a `superone://pair?…` QR (shows a 6-digit code to confirm on desktop) or JSON `{ "relayUrl", "secret" }`. Then projects → sessions → chat WebView. Saved pairings persist via the `Kv` adapter (in-memory until a native store is injected).

mDNS is **not** required this cycle (QR / relay + optional manual host:port). Terminal frames use `RelayClient.send` / `onTerminal` and never ACK.
