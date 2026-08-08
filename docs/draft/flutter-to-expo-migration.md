# Flutter → Expo Mobile Migration (Draft)

Status: **draft** — approved direction; plan reviewed and revised, not yet executed
Last updated: 2026-08-08
Reviewed by: Codex (adversarial design review, 2026-08-08) — 5 blocking issues found and incorporated
Related: `apps/desktop/CLAUDE.md` → Remote Control (Mobile) Architecture; `apps/relay/`; `packages/shared`; external repo `super-one-flutter`

---

## 1. Decision

Replace the Flutter mobile client (`super-one-flutter`, 25,523 LOC Dart, shipping at
`1.0.0+19`) with an Expo / React Native app living inside this monorepo at `apps/mobile`.

The chat surface renders inside a **single persistent WebView** driven by a React DOM
bundle (`packages/chat-view`). Everything else — navigation, pairing, sheets, input,
camera, file pickers — is native React Native.

The Flutter build has **no production users** (internal testers only). No data migration,
no staged rollout, no rollback obligation.

### Why (in priority order)

1. **Eliminate schema double-writing.** `agent_event.dart` (1,329 LOC) is a hand-maintained
   Dart mirror of `packages/shared/src/agent-types.ts` (3,226 LOC), and
   `session_state.dart` (1,247 LOC) re-implements reduction logic that exists in TypeScript.
   Drift is currently caught only at runtime; after migration `tsc` catches it.
2. **Decouple mobile release cadence from App Store review.** Desktop auto-updates on the
   alpha channel while the relay protocol evolves; mobile is stuck behind review latency.
   EAS Update ships JS-layer protocol fixes in minutes.
3. **Web-shaped content deserves a web renderer.** Markdown, LaTeX, mermaid, syntax
   highlighting, HTML widgets and mini-apps are native to the browser. Flutter already
   leaks on this axis — `mermaid_block_view.dart` and `widget_block_view.dart` are WebViews.

"More components can be reused" is **not** a load-bearing reason. React DOM components do
not run in React Native; reuse materialises only because of the WebView decision.

### Measured baseline (verified 2026-08-08)

| Layer | Dart LOC | Post-migration |
|---|---:|---|
| Event model + reduction | 2,576 | `@superone/shared` + `@superone/chat-core` |
| Transport / crypto / RPC | 1,967 | `@superone/relay-client` (new) |
| Misc logic (LAN, caches, token utils) | ~850 | ported once |
| Chat rendering UI | ~12,000 | `@superone/chat-view`, shared with desktop |
| Native shell UI (nav, sheets, pickers, lists) | ~8,100 | **rewritten in RN, no reuse** |

The Flutter app has **zero** `MethodChannel`/`EventChannel`, one iOS target, no share
extension and no deep links — the lowest-risk shape a migration can start from.

---

## 2. Target architecture

```
apps/
  mobile/                  @superone/mobile — Expo app (RN shell)
  desktop/                 imports presenters back from packages/chat-view
packages/
  relay-client/            crypto, relay transport, remote RPC (pure TS)
  chat-core/               reduction logic + state contracts (pure TS)
  chat-view/               React DOM chat renderer + WebView host protocol
  shared/                  unchanged
```

### 2.1 State ownership — decide this before writing code

There is exactly **one** owner of chat state: the RN side runs `@superone/chat-core` and
pushes patches into the WebView. The WebView owns **view state only** (scroll anchor,
expand/collapse, selection). It never derives transcript state independently.

`chat-core` exposes **three** narrow contracts, not one giant state object:

| Contract | Contents | Consumer |
|---|---|---|
| `ChatReductionState` | transcript/render model: `messages`, `queuedMessages`, `status`, `streamingTokens`, `codexTurnLastUsage`, context/cost counters, `taskProgress`/`subagentTokens`, todos + bookkeeping, `_streamingToolInputPreviews`, `browserDownloads`, `videoGenStatuses`, compact/slash transcript bookkeeping | WebView |
| `ChatInteractionState` | `pendingPermissions`, `pendingQuestion`, `pendingPlanApproval`, `planApprovalOutcome` | **RN shell** (native sheets own these) |
| `SessionUiState` | provider/model/ACP catalog: `sessionProvider`, `preferredProvider`, `acpAgentId`, `acpModels`, `acpModes`, `*Status`, `selected*`, `modelUserChosen` | RN shell; WebView receives only derived labels |

Side effects (`persistStreamingToolInput`, tracing, message-event-applied bookkeeping) are
**injected ports**, never state fields and never a package back-edge.

### 2.2 Host protocol (RN ↔ WebView)

Inbound (RN → WebView):

- `initialize(config)` / `hydrate(snapshot)` / `reset(reason)` / `prependHistory(page)`
- `applyEvents(batch)` — **the RN side owns batching**; one envelope per ~33 ms, never one
  message per reduced event
- `setConnection({ state, epoch })` — streaming must visibly degrade on disconnect
- `setTheme` / `setViewport({ safeArea, fontScale, locale })`
- `setWindow(range)` — DOM windowing
- `scrollToTurn(id)`
- `nativeActionResult(id, result)` / `nativeActionProgress(id, progress)`

Outbound (WebView → RN):

- `requestNative(action, payload)` — file browser, permission sheet, media picker, share
- `viewState(patch)` — scroll anchor + expand state, **persisted on the RN side** so it
  survives DOM-window unmount
- `ready` / `error(fatal)` — drives white-screen recovery (see R2)

Terminal uses a **separate channel and separate WebView** (memory isolation + independent
input routing).

**Reconnect ordering is a protocol requirement**, not an implementation detail. The Flutter
client does subscribe → history → snapshot → *then* release buffered events
(`super-one-flutter/lib/chat_page.dart:485-513`). Replicate exactly; releasing buffered
events before the snapshot lands produces duplicated or out-of-order turns.

### 2.3 Hard constraints

- **Input stays native.** No `<textarea>` in the WebView; mobile WebView IME behaviour is
  not acceptable and the existing `isComposing` guard needs a real RN `TextInput`.
- **WebView owns full-screen scroll.** Header and input are RN overlays. Never nest inside
  an RN `ScrollView`.
- **DOM windowing is mandatory**, not an optimisation (see R2).
- **Never write a relay envelope `seq` back into individual events.** One encrypted frame
  carries an **array** of events (`remote-control-service.ts:1470-1476`). The envelope seq
  is an ACK/replay number; `AgentEvent.seq` is a different thing. Conflating them changes
  reducer replay semantics and breaks the byte-identical port.

### 2.4 Extraction rule — adapterize before moving

Component extraction happens in two steps, never one. **No file moves package until its
store reads and IPC calls are behind an injected port.**

The original "leaf presentational components" framing was wrong. Verified:
`ToolBlock.tsx` has 19 platform touchpoints — it imports five Zustand stores (`chat`,
`settings`, `source-control`, `app`, `miniapp`) and calls `window.app.showInFolder`
(:1044), `readBashOutputFile` (:1644, :1695), `readBashOutputMore` (:1696) and
`window.agent.findLineNumber` (:1944-1948). `ChatMessage.tsx` has 8.

1. **Adapterize in place** (inside `apps/desktop`): split each component into a pure
   presenter + a host adapter that supplies data and actions through a port interface.
   Desktop keeps working; tests stay green.
2. **Move the presenter** into `packages/chat-view`; desktop imports it back and supplies
   the Electron adapter; mobile supplies the WebView adapter.

Still out of scope entirely: `ChatInput.tsx` (1,492), `ChatPanel.tsx`, `MentionPopup.tsx`,
`model-selector/`, `chat-status-bar/`. Mobile reimplements these natively.

---

## 3. Phases

### Phase 0 — De-risk (target: 1.5 weeks)

| # | Unknown | Verification | Fallback |
|---|---|---|---|
| 0.1 | mDNS (`nsd` → `react-native-zeroconf`) | Discover a running `dev:cli:lab` advert on iOS + Android hardware; needs config plugin + `NSBonjourServices` | Relay-only discovery + manual `host:port`. LAN transport still works once the address is known |
| 0.2 | AES-256-GCM + HKDF wire parity | `@noble/ciphers` + `@noble/hashes` decode frames from the **unmodified** desktop; golden vectors from the Dart client | `react-native-quick-crypto` |
| 0.3 | Metro resolves `@superone/shared` across bun workspaces | `resolver.unstable_enableSymlinks` + root `watchFolders` | Explicit per-package alias map |
| 0.4 | WebView streaming perf | Replay the longest recording; sample rAF intervals inside the WebView | Coarser DOM window; tighter RN-side envelope |
| **0.5** | **Dependency-boundary spike** | Can `chat-core` be cut at all? Prove the `../index` back-edge (3 value imports: `content.ts:6`, `lifecycle.ts:2`, `tool.ts:4`) can be inverted into ports without dragging the 10,874-LOC store | Narrow the first reducer event family; **never fork the reducer** |
| **0.6** | **Host-protocol contract spike** | Freeze the mobile-normalized event schema and the three state contracts from §2.1 before any renderer work | — |

**Exit:** all six resolved or on their fallback, recorded here.

### Phase 1 — Scaffolding

- `apps/mobile` (`@superone/mobile`), Expo with **dev client** (not Expo Go — zeroconf and
  the camera plugin require it).
- Metro config for the bun hoisted linker; `watchFolders` at repo root.
- `packages/tsconfig/react-native.json`; wire `bun run typecheck`; root scripts
  `dev:mobile`, `build:mobile`.
- Bundle identifier: free choice (no users). Recommend keeping
  `com.superone.superone_remote` to avoid re-provisioning certs, TestFlight and Android
  signing.
- EAS `development` / `preview` / `production` profiles.

**Exit:** empty app boots on iOS + Android hardware via dev client and imports a type from
`@superone/shared`.

### Phase 2 — `packages/relay-client` (parallel with 3a/4a)

Port `crypto.dart` (194) + `relay_client.dart` (517) + `remote_client.dart` (1,256) into
one dependency-free TS package (WS / fetch / device-info / discovery supplied as injected
adapters, so it is testable under vitest and reusable by `apps/cli`).

A byte-identical port needs **no desktop or relay changes**, but these invariants are
load-bearing and each has an existing relay test:

- **Offline devices are `pending`, never treated as ACKed.** Buffer entries survive
  `webSocketClose` and replay on reconnect
  (`apps/relay/src/relay-session.test.ts` — "broadcast entry is not GCed when the only
  un-ACKed mobile disconnects"). Treating offline as ACKed causes silent event loss on
  every WS flap.
- `_processedSeqs.add(seq)` **before** decrypt, or a dedup race double-dispatches.
- **ACK even when decrypt fails**, or that seq occupies the buffer until `forcedDropSeq`.
- `_processedSeqs` must be bounded (long-session memory).
- Reset only when `fromSeq <= forcedDropSeq`. An ACK-driven GC must never trigger reset.

**Exit:** `apps/mobile` pairs by QR and logs decrypted `AgentEvent`s. Crypto parity tests
green against Dart-captured vectors. Zero diff under `apps/desktop/src/main/remote/` and
`apps/relay/`.

### Phase 3 — `chat-core` (split into three)

**3a — State/helper decoupling** (inside `apps/desktop`, no new package yet)

Define `ChatReductionState` / `ChatInteractionState` / `SessionUiState` per §2.1. Invert the
`../index` back-edge into injected ports. Move pure helpers and constants. Extract the
provider/model/ACP dispatcher logic (`event-reducer/index.ts:95-171`) into a separate
settings reducer.

> The 34 statically-read `session.*` fields are a **lower bound, not the contract**. The
> reducer also writes fields outside that set — `awaitingAssistantReply`, `lastEventAt`,
> `promptSuggestion`, `session`, `permissionMode`, `modelFallback`
> (`event-reducer/lifecycle.ts:20-149`). Defining state from the read-set alone yields an
> incomplete patch API.

**3b — Reducer extraction** into `@superone/chat-core`. Desktop imports it back in the same
PR. Desktop suite green with **zero test edits** is the gate.

**3c — Parity oracle.** The existing recordings are *not* an oracle today: the barrel
references 4 of 5 directories and `integration_test/recorded_catalog_test.dart` contains
**zero** `expect(` calls — it is a visual replay harness. Build real snapshot assertions,
retarget `export_fixtures.sh` to emit TS, and fix the missing 5th recording.

**Compile-time boundary test (the proof 3a worked):** `chat-core` must not import
`../index`, Zustand, `@/components`, or `window`. Inputs come from exact fixture builders;
outputs are restricted to an explicit `ChatCorePatch` key set. Without this, 3a can
silently rename the 10,874-LOC store rather than shrink it.

### Phase 4 — `chat-view` (split into three)

- **4a — Adapterize desktop components in place** (§2.4 step 1). Parallel with 3a.
- **4b — WebView bundle against frozen fixtures.** Vite build → self-contained local asset,
  no runtime network. Parallel with 3b. Reuse desktop streaming conventions:
  `setTimeout`-based throttling (never rAF — it starves under paint pressure) and
  `useIsCodeFenceIncomplete()` for fence-close detection. Stamp `--brand-hue` explicitly at
  the bundle entry; it does not resolve outside the React hook that sets it.
  Port the 26 Flutter integration tests as **Playwright** tests against the bundle.
- **4c — Live integration**, gated on 3c passing.

### Phase 5 — RN shell

Rewrite, no reuse. Pairing/QR (`expo-camera`) → navigation + project/session lists → chat
input (IME guard, slash commands, `@` mentions, attachments) → sheets (permission, plan,
question, worktree, add-dir, provider; **iPad-aware presentation**, anchored popovers not
bottom sheets) → file browser, git indicators → settings, MMKV storage.

### Phase 6 — Terminal + transports (parallel with 5)

Terminal: xterm.js in its own WebView, reusing desktop's setup. **Re-verify the webgl
transparency patch** — desktop carries a `bun patch` because webgl hardcodes `g=1`; a
version bump silently reintroduces the black-block bug.
LAN discovery per 0.1. Attachments preserve the existing `source.transport` decision
(inline / LAN-PUT / relay-R2); PDFs route through the images path.

### Phase 7 — Parity sweep + iPad

Run the recorded catalog on device against Flutter screenshots. Re-derive the
`stripContentBlock` exemption list from scratch (it truncates tool results to 200 chars;
rich-data tools need explicit exemption). iPad: multi-pane at ≥`md`,
`ios.supportsTablet: true`, `requireFullScreen` **false**.

### Phase 8 — Release + cutover

EAS `production` → TestFlight + APK for internal testers; dogfood one week; archive
`super-one-flutter` read-only (it stays the behavioural reference through Phases 4–7).

---

## 4. Non-goals

- No desktop renderer changes beyond adapterization with green tests.
- No `apps/cli` or `apps/relay` changes — Phase 2 failing this is a design error, not a
  licence to edit them.
- No Expo Go compatibility (dev client required).
- No Android foldables/tablets this cycle.
- No extraction of `ChatInput` or other interactive containers.
- **No forked reducer.** If extraction over-runs, narrow the first event family instead.

---

## 5. Performance budget

Budgets are **measured thresholds, not derived numbers**. The original ≤30 msg/s figure was
wrong: `AGENT_EVENT_BATCH_MS = 33` only delays *deltas*; non-delta events flush and
dispatch immediately, and each flush dispatches per-event
(`packages/shared/src/agent-event-batcher.ts:138-156`). Reducer dispatch count ≠ bridge
message count — hence the RN-side envelope in §2.2.

Relevant upstream behaviour, verified: the desktop **already coalesces mobile text
server-side**, flushing on a paragraph boundary (`\n\n`) or ≥1000 chars rather than on a
timer (`remote-control-service.ts:1287-1290`), and rebuilds text/thinking deltas as fresh
objects carrying only `{ type, messageId, delta }` — so they arrive **without** internal
`seq`/`epoch` and remain foldable (`:1413-1450`). Non-text `content_delta` keeps its `seq`
via spread in `stripEventForRemote` (`:433-435`), and `codex_item_delta(todo_list)` is
rebuilt without one (`:450-452`). Mobile therefore receives chunky paragraph-level text,
not character-level streaming.

| Metric | Budget |
|---|---|
| Streaming frame interval inside WebView | p95 < 20 ms |
| Peak RSS after 200 turns (code blocks + mermaid) | < 250 MB |
| Cold start → first chat frame | < 500 ms |
| RN → WebView envelopes | ≤ 1 per 33 ms |
| Tool block expand/collapse | 0 bridge hops |

Required tests: mixed batches with and without internal `seq`; one relay envelope carrying
multiple events; the field contract of desktop-rebuilt text/thinking deltas.

If RSS is exceeded, DOM windowing is under-aggressive — tighten the window first.

---

## 6. Risk register

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | mDNS has no first-party RN solution | Medium | 0.1 fallback: relay discovery + manual address |
| R2 | WebView memory growth; iOS jetsam (WKWebView is out-of-process — OOM shows as a **white screen**, not a crash) | **High** | DOM windowing from day one; §5 budget; `error(fatal)` → auto-reload + `hydrate` |
| ~~R3~~ | ~~Existing users lose pairing~~ | — | Retired: no production users |
| R4 | iPad sheets/popovers misplace or crash without an anchor | Medium | iPad-aware presentation in Phase 5 |
| R5 | RN IME regressions | Medium | Native `TextInput` only; port the `isComposing` guard |
| R6 | Three runtimes (RN / WebView / mini-app iframe) | Medium | One documented protocol; runtime map in `apps/mobile/CLAUDE.md` |
| R7 | Dual maintenance during overlap | Medium | Freeze Flutter features at Phase 2; bug fixes only |
| R8 | Adapterization destabilises the busiest area of the codebase | **High** | Per block family; desktop suite green with zero test edits; dedicated branch |
| **R9** | **Reconnect mid-stream corrupts the transcript** | **High** | Encode the subscribe → history → snapshot → release ordering as a protocol requirement; `setConnection` epoch; test against a live flap |
| **R10** | **View state (scroll anchor, expand) lost on DOM-window unmount** | Medium | View state persists on the RN side, not in the WebView DOM |
| **R11** | **Theme / safe-area / font-scale / locale drift between runtimes** | Medium | `setViewport` in the protocol; no independent derivation inside the WebView |
| **R12** | **Attachment transports regress** (inline / LAN-PUT / relay-R2) | Medium | Port `source.transport` selection verbatim; cover all three in Phase 6 |
| **R13** | **`chat-core` extraction balloons into a chat-store refactor** | **High** | 0.5 spike first; compile-time boundary test; narrow the event family rather than fork |

---

## 7. Effort estimate

| Phase | Estimate |
|---|---|
| 0 — De-risk (6 items) | 1.5 weeks |
| 1 — Scaffolding | 3 days |
| 2 — relay-client | 1–1.5 weeks |
| 3a/3b/3c — chat-core + real oracle | 2–3 weeks |
| 4a/4b/4c — adapterize + bundle + integrate | 2.5–3 weeks |
| 5 — RN shell (~8,100 LOC, no reuse) | 2.5–3 weeks |
| 6 — Terminal + transports | 1 week (parallel) |
| 7 — Parity + iPad | 1 week |
| 8 — Release + cutover | 1 week |
| **Total** | **9–12 weeks single-implementer** |

7–9 weeks is only reachable with ≥2 parallel implementers **and** all Phase 0 spikes
passing. Runs on branch `feat/expo-mobile`.

Parallelism: after Phase 0 freezes the contracts, `2` ∥ `3a`+`4a` → `3b` ∥ `4b` → `3c`
gates `4c`. `5` starts once Phase 1 lands; `6` parallels `5`.

---

## 8. Resolved by review

- **`chat-core` stays on the critical path.** A mobile-local reducer would create a *third*
  semantics implementation (desktop TS, Flutter Dart, mobile TS) — exactly the tax this
  migration exists to remove. It is decoupled from Phase 4 *development* (fixtures), not
  from Phase 4 *integration*.
- **`ChatCoreState` is three narrow contracts, not one 34-field blob** (§2.1).
- **Envelope seq ≠ `AgentEvent.seq`** (§2.3).

## 9. Still open

1. Does `chat-view` eventually become desktop's chat renderer, or does desktop keep
   rendering natively and only share presenters? Plan assumes the latter; revisit after
   iPad.
2. Does `relay-client` replace the desktop-side relay code too? Built standalone so either
   is possible.
3. Should mobile keep receiving paragraph-chunked text (§5), or should Phase 4 introduce
   finer-grained streaming now that the renderer can handle it? Currently out of scope.
