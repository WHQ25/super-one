# SuperOne Terminal Architecture

## Overview

SuperOne ships an integrated terminal that works **on the desktop** and is **fully drivable from mobile** over the existing remote-control transport. A terminal is an **independent, long-lived resource keyed by effective working directory** — not a property of a chat session. It survives chat-session reset / park / project switch, supports multiple terminals per project, and reconnects on mobile via a server-side screen snapshot.

```
Terminal = node-pty process  +  server-side @xterm/headless (state source)
           keyed by effective cwd (worktree-aware)
           local: IPC → renderer xterm.js
           remote: non-buffered relay/LAN frame → Flutter xterm
```

## Design Principles

1. **Terminal lifecycle is bound to a working directory, not a conversation.** A `npm run dev` must outlive context resets and project switches. Both reference implementations (paseo, t3code) independently chose cwd-keyed independent terminal resources for the same reason.
2. **Server holds the source of truth.** A headless xterm instance per terminal absorbs the raw PTY byte stream and produces a correct screen snapshot — required for full-screen TUIs (vim, htop, lazygit) where naive raw-history replay corrupts the display.
3. **Asymmetric transport.** Only the high-frequency desktop→mobile **output** needs a dedicated **non-buffered** frame — riding the buffered `event` frame would overflow the relay replay buffer and drop real agent events. Low-frequency mobile→desktop **input / resize / claim** reuses the existing `command` frame (which is already non-buffered and has decrypt + source-deviceId injection). Reliability comes from snapshot resync, not relay replay.
4. **Terminal ownership is its own model, not Session's.** Session ownership is single-remote-exclusive (any existing owner *or* subscriber conflicts the next device). The terminal needs the opposite: **one exclusive writer + N non-conflicting read-only subscribers**. Terminals reuse only the *field names* and the `DeviceRegistry` / `MobileBroadcaster` disconnect plumbing — the semantics are defined fresh in `TerminalOwnership`.

## Comparative Analysis (why these choices)

| Dimension | paseo | t3code | SuperOne decision |
|---|---|---|---|
| PTY backend | node-pty | node-pty / Bun PTY | **node-pty** (Electron, no Bun) |
| Server state source | `@xterm/headless` (grid+scrollback+cursor) | raw history string, ANSI-sanitized, 5000-line cap | **`@xterm/headless`** — correct for full-screen TUIs |
| Transport | dedicated binary protocol (opcode+slot+payload) | generic JSON-RPC over WS | **JSON, but a new non-buffered frame** |
| Snapshot form | structured grid → client rebuild | clear + history string + filter by `createdAt` | **`SerializeAddon` → ANSI string** (Flutter-friendly) |
| Multiplexing | slot table (0–255) | 1 PTY : N subscribers | reuse SuperOne N-mobile broadcast |
| Multi-terminal | TerminalManager by cwd | threadId × terminalId | **TerminalManager by effective cwd** |
| Mobile | RN + xterm.js, snapshot reconnect | none (hosted web) | **Flutter `xterm` package, snapshot reconnect** |

**Why not paseo's binary protocol:** SuperOne already has a JSON+AES encrypted frame channel with N-mobile multiplexing. A parallel binary protocol would require rewriting the relay Durable Object framing, the LAN server, the encryption layer, and the Flutter client. t3code proves the JSON channel is sufficient for remote/mobile when paired with a server-side snapshot. The only SuperOne-specific addition required is a non-buffered frame lane.

## The Decisive Constraint: relay replay buffer

`apps/relay/src/relay-session.ts` routes the existing `event` frame through `enqueue()`:

- every `event` is pushed into `buffer` with `pendingAcks: Set<deviceId>`, capped at `MAX_BUFFER_SIZE = 500`
- overflow → `buffer.shift()`; if the dropped entry still had pending acks, `forcedDropSeq` advances and is persisted
- a device whose `replay fromSeq <= forcedDropSeq` is **reset** — meaning real agent events (message deltas, permission requests) are lost

A single noisy command (`npm install`, `cat bigfile`, a dev-server log) emits hundreds of chunks per second and would overflow 500 entries in under a second, forcing a reset for that device. **This is a correctness failure, not an efficiency concern.**

The same file already contains the precedent for the fix: `case 'response' / 'response_chunk'` are forwarded directly — **not enqueued, no seq, no ack** (`relay-session.ts:220-230`). Terminal frames take this path.

## Locked Decisions

| Item | Decision |
|---|---|
| Session model | Independent terminal resource, keyed by **effective cwd** (worktree-aware); not bound to chat Session lifecycle |
| Transport | Output: new non-buffered desktop→mobile frame. Input/resize/claim: existing `command` / `RemoteCommand` channel (already non-buffered) |
| Server state source | `@xterm/headless` per terminal; snapshot via `SerializeAddon` → ANSI string |
| Mobile v1 | Full interactive: input + resize + snapshot reconnect |

## Effective CWD & Worktree Rules

SuperOne already resolves worktree cwd; the terminal **reuses it, never re-derives it**.

- Effective cwd = `session.snapshot.worktreePath ?? projectPath`. This is the same `effectiveCwd` semantics used by the Codex backend (`startOpts.cwd || startOpts.projectPath`). `session-manager` already validates the worktree path (exists → use it; missing → falls back to `null`).
- `TerminalManager` keys terminals by **effective cwd**, read from the session snapshot — it does **not** reimplement worktree validation.
- **CWD is fixed at spawn.** `pty.spawn({ cwd: effectiveCwd })` binds the directory; a running terminal does not migrate when the session later switches branch/worktree (a running dev server cannot teleport). This matches paseo/t3code (terminal cwd fixed at spawn).
- **Switching worktree = different terminal group.** A project's `main` checkout and its `.worktrees/abc` are two distinct effective cwds → two independent terminal groups, never cross-contaminated. The UI shows the terminal group for the current session's effective cwd.
- **Explicit invalidation signal.** `session-manager` only falls `worktreePath` back to `projectPath` when *resuming a persisted session* — it does not actively notify long-lived resources. So `TerminalManager` exposes `invalidateCwd(path)`: PTYs under that cwd are killed, terminals marked `exited`, `terminal_exited` broadcast — **not** silently rewritten to the base path. Triggers, in order of what's landable today:
  - **Now:** path-missing detection — `TerminalManager` stats the cwd on each `create` and on a periodic sweep; a vanished cwd → `invalidateCwd`. `worktree-ops.ts` today only exposes `activate`/`list`/`switch` (no remove API), so this is the only currently-firing trigger.
  - **When added:** any future worktree-remove API/IPC **must** call `invalidateCwd(removedPath)` as part of its contract (documented here so it isn't missed).

## Architecture

```
┌───────────────────────────── Desktop (Electron Main) ─────────────────────────────┐
│                                                                                     │
│  TerminalManager  (keyed by effective cwd; reads cwd from session snapshot)         │
│   └─ TerminalSession (per terminal)                                                 │
│        ├─ node-pty process (cwd fixed at spawn)                                      │
│        ├─ @xterm/headless  ← raw PTY bytes (state source)                            │
│        ├─ history cap + SerializeAddon snapshot()                                    │
│        └─ TerminalOwnership (owner / subscribers / claim / release)                  │
│                                                                                     │
│   ├─ local  → IPC (window.terminal)         → renderer xterm.js + FitAddon          │
│   └─ remote → MobileBroadcaster (terminal lane, by ownership)                        │
│                 → RemoteControlService.sendTerminalFrame() (encrypt, bypass buffer) │
│                     ├─ Relay: non-buffered frame (response_chunk-style)              │
│                     └─ LAN:   peer frame forward                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                  output ▲ (non-buffered terminal frame)                              │
                         │                  input/resize/claim ▼ (command frame)
                         ▼
                         Flutter mobile: xterm widget
                         snapshot.ansi + snapshot.lastSeq → write, dedup by seq
                         input / resize / claim → RemoteCommand over command frame
```

### Output path (PTY → screen)

1. `pty.onData(chunk)` → write into `@xterm/headless` (always, this is the state source) → assign the next per-terminal monotonic `seq`.
2. Coalesce: accumulate chunks in a 16–32 ms flush window, concatenate, emit **one** `terminal_output` per window carrying the **highest `seq`** in that window. This reduces frame count by 1–2 orders of magnitude.
3. Local: IPC push to renderer; renderer `xterm.write(data)`.
4. Remote: `MobileBroadcaster` resolves targets from `TerminalOwnership` (subscribers ∪ remote owner) → `RemoteControlService.sendTerminalFrame()` → encrypted, **non-buffered** relay/LAN frame.

### Input path (mobile/renderer → PTY)

Mobile input does **not** use a bespoke inbound frame. It reuses the existing `command` frame / `RemoteCommand` union, which already has full inbound plumbing on **both** transports:

- Relay: `handleMobileMessage` `case 'command'` injects `mobileDeviceId`, forwards to desktop; `RemoteControlService` decrypts and calls `onCommand(cmd, respond, { deviceId, transport: 'relay' })`.
- LAN: `LanServer` decrypts the command, supplies `source.deviceId` from the per-socket `ClientState`.
- `AgentService.handleRemoteCommand` routes terminal-typed commands to `TerminalManager`, passing the real `source.deviceId`.

New `RemoteCommand` variants (no new relay frame needed): `terminal_input`, `terminal_resize`, `terminal_claim`, `terminal_release`, `terminal_subscribe`, `terminal_unsubscribe`, `terminal_create`, `terminal_kill`.

- Input and resize are **forwarded immediately, never coalesced** (coalescing input makes vim/interactive apps feel laggy). Resize is **de-duplicated** (skip if cols/rows unchanged) and applied to **both** the headless xterm and the PTY (two-layer resize, SIGWINCH).
- Every input/resize command is ownership-checked in `TerminalManager`: only the current `TerminalOwnership` writer (the device that `claim`ed) may write/resize; a non-owner input is rejected with a `terminal_error`. Subscribers without a claim are read-only.

### Snapshot / reconnect (seq-based dedup)

`createdAt`-based filtering is **unsafe** here: output is coalesced on a 16–32 ms window, so a window can straddle the snapshot boundary (bytes both folded into the snapshot *and* re-delivered), and timestamps are non-monotonic vs. snapshot inclusion. Dedup uses a **per-terminal monotonic `seq`** plus a server-side snapshot barrier:

- Every byte chunk written into the headless xterm increments the terminal's `seq`. A `terminal_output` carries `fromSeq`/`toSeq` (the seq range of bytes in that flush window), not just the max.
- **Snapshot barrier (mandatory invariant).** `snapshot()` must, *synchronously and atomically*: (a) flush + cut the pending coalesce buffer, emitting its accumulated `terminal_output` first; (b) `SerializeAddon` dump; (c) set `snapshot.lastSeq` = the seq at the cut. The next byte after the barrier opens a **fresh** coalesce window whose `fromSeq = lastSeq + 1`. This guarantees **no output window ever straddles the snapshot boundary** — a window is either entirely ≤ `lastSeq` or entirely > `lastSeq`. The straddling case (pending 10–12, snapshot at 11, flush emits 12 but replays 10–11) is structurally impossible, not patched on the client.
- Client rule: drop a `terminal_output` if `toSeq <= snapshot.lastSeq`; otherwise apply it whole (the barrier guarantees `fromSeq > lastSeq`). Client also tracks last-applied `toSeq` to drop relays/duplicates. `seq` is the single ordering authority; `createdAt` is informational only.
- Because correctness comes from the barrier + `seq`, terminal frames intentionally do **not** use the relay replay buffer.

### Write ownership (local ⇄ remote)

The writer is a single token; default holder is the **local desktop renderer** (`{ kind: 'local' }`). The renderer writes directly (IPC), no claim needed.

- A remote `terminal_claim` **takes** the writer from local: `ownerDeviceId` becomes that device, local renderer goes **read-only** and is notified via the local IPC equivalent of `terminal_owner_changed` (input box disabled, "controlled by <device>" banner).
- Local **reclaim** is always permitted and pre-emptive (desktop is the trust root): the renderer can take the writer back at any time, which `release`s the remote owner and pushes `terminal_owner_changed` (`ownerDeviceId: null`) to all subscribers (mobile goes read-only). This mirrors the existing desktop "kick" semantics for sessions.
- Remote→remote: a second device's `terminal_claim` while another remote owns it is rejected with `terminal_command_result{ ok:false, code:'already_claimed' }` (no silent steal between mobiles; the user must release or the desktop reclaims).
- On remote owner `release` / unsubscribe / device disconnect (`DeviceRegistry`), the writer falls back to `{ kind: 'local' }`.
- PTY input is never concurrent: exactly one writer token at all times; subscribers without it are read-only.

## Protocol

### Shared types — `packages/shared/src/agent-types.ts`

```ts
// New IPC channels
AgentIpcChannels.TERMINAL_CREATE   = 'terminal:create'
AgentIpcChannels.TERMINAL_WRITE    = 'terminal:write'
AgentIpcChannels.TERMINAL_RESIZE   = 'terminal:resize'
AgentIpcChannels.TERMINAL_KILL     = 'terminal:kill'
AgentIpcChannels.TERMINAL_LIST     = 'terminal:list'
AgentIpcChannels.TERMINAL_DATA     = 'terminal:data'      // main → renderer push

type TerminalSnapshot = {
  terminalId: string
  cwd: string
  status: 'running' | 'exited' | 'error'
  cols: number
  rows: number
  lastSeq: number       // seq at the snapshot barrier; client dedup authority
  ownerDeviceId: string | null   // current exclusive writer; null = local-only / unclaimed
  writableByMe: boolean          // server-evaluated for the receiving device — drives "input enabled"
  subscriberCount: number
  // `ansi` delivered via terminal_snapshot / terminal_snapshot_chunk (see chunking)
}

type TerminalEvent =
  | { type: 'terminal_snapshot'; terminalId: string; snapshot: TerminalSnapshot; ansi: string }   // small snapshot, single frame
  | { type: 'terminal_snapshot_chunk'; terminalId: string; snapshotId: string; index: number; total: number; ansi: string; snapshot?: TerminalSnapshot }  // index 0 carries `snapshot`
  | { type: 'terminal_output'; terminalId: string; data: string; fromSeq: number; toSeq: number; createdAt: string } // seq range of this flush window; createdAt informational
  | { type: 'terminal_owner_changed'; terminalId: string; ownerDeviceId: string | null; writableByMe: boolean }       // pushed to all subscribers on any claim/release
  | { type: 'terminal_command_result'; requestId: string; ok: boolean; terminalId?: string; code?: 'not_owner' | 'already_claimed' | 'no_terminal'; message?: string } // ack for create/claim/release/subscribe
  | { type: 'terminal_exited'; terminalId: string; exitCode: number | null; signal: number | null }
  | { type: 'terminal_error'; terminalId: string; code: 'not_owner' | 'no_terminal' | 'spawn_failed' | 'cwd_invalid'; message: string }
```

`writableByMe` / `terminal_owner_changed` are how the mobile UI knows to enable input — it never infers from a fire-and-forget claim. `claim`/`release`/`create`/`subscribe` are request/response (carry `requestId`, answered by `terminal_command_result`); `input`/`resize` stay fire-and-forget.

**Snapshot chunking.** The headless xterm scrollback is capped at a fixed byte budget (e.g. `SNAPSHOT_MAX_BYTES`, scrollback trimmed oldest-first beyond it). If the `SerializeAddon` dump still exceeds a single-frame comfort size (`FRAME_SOFT_LIMIT`, ~256 KB), it is split into `terminal_snapshot_chunk` frames (mirroring the existing `response_chunk` pattern): chunk `0` carries the `TerminalSnapshot` metadata; the client reassembles `ansi` by `snapshotId` + `index/total` before writing. A reassembly + ordering test is mandatory (see Testing).

### Frames & commands

Inbound (mobile → desktop) reuses the **existing `command` frame** — no new inbound relay/LAN frame. Add to `RemoteCommand` (`packages/shared/src/agent-types.ts`):

```ts
type RemoteCommand =
  | ...
  | { type: 'terminal_create'; requestId: string; projectPath: string; sessionId?: string }
  | { type: 'terminal_kill'; terminalId: string }
  | { type: 'terminal_subscribe'; requestId: string; terminalId: string }
  | { type: 'terminal_unsubscribe'; terminalId?: string }
  | { type: 'terminal_claim'; requestId: string; terminalId: string }     // request exclusive writer; answered by terminal_command_result
  | { type: 'terminal_release'; requestId: string; terminalId: string }
  | { type: 'terminal_input'; terminalId: string; data: string }          // fire-and-forget
  | { type: 'terminal_resize'; terminalId: string; cols: number; rows: number }
```

Outbound (desktop → mobile) high-frequency output is the **only** new relay/LAN frame — `apps/relay/src/relay-session.ts`:

```ts
type RelayFrame =
  | ...
  | { type: 'terminal'; data: string; targets?: string[] }   // desktop → mobile, encrypted TerminalEvent
```

- `case 'terminal'` in `handleDesktopMessage`: forward directly to recipients. **Do not call `enqueue()`** — no seq, no ack, no `forcedDropSeq` interaction (mirror `case 'response_chunk'`).
- No inbound terminal frame: `terminal_*` commands arrive on the existing `case 'command'` path (decrypt + `mobileDeviceId` injection + `onCommand` source already implemented on relay and LAN).

## File-Level Plan (phased)

### Phase 1 — Desktop local terminal

| File | Change |
|---|---|
| `apps/desktop/package.json` | add `node-pty`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/headless`, `@xterm/addon-serialize`. **Extend `postinstall`**: it currently runs `electron-rebuild -f -w better-sqlite3` only — change to `-w better-sqlite3,node-pty` so the native ABI is rebuilt for Electron. `electron-builder.yml` `asarUnpack: **/*.node` already covers node-pty, but **a packaged smoke test must spawn a PTY** (same class of issue as better-sqlite3 / the SDK native-binary asar footgun — dev install can pass while packaged ABI/path fails). |
| `apps/desktop/src/main/terminal/terminal-manager.ts` *(new)* | terminals grouped by effective cwd; `create / get / list / kill / restart`; `invalidateCwd(path)` + cwd-missing sweep. Reads effective cwd from the session snapshot; does not re-derive worktree. |
| `apps/desktop/src/main/terminal/terminal-session.ts` *(new)* | per-terminal: `pty.spawn({ cwd })`, `onData` → headless write + per-terminal `seq` + 16–32 ms coalesced broadcast, two-layer resize (headless + pty), `snapshot()` via `SerializeAddon` (with `lastSeq` + chunking), scrollback byte cap. |
| `apps/desktop/src/main/terminal/terminal-ownership.ts` *(new, ~50 lines)* | **new semantics, not Session's**: single exclusive writer (`claim`/`release`), N non-conflicting read-only subscribers (`subscribe`/`unsubscribe`). Reuses field names + the `DeviceRegistry`/`MobileBroadcaster` disconnect plumbing only. |
| `apps/desktop/src/main/git/worktree-ops.ts` | no remove API exists today — **no change now**; documented contract: a future worktree-remove must call `terminalManager.invalidateCwd(removedPath)`. |
| `packages/shared/src/agent-types.ts` | `AgentIpcChannels.TERMINAL_*`; `TerminalEvent` / `TerminalSnapshot` types. |
| `apps/desktop/src/preload/index.ts` | expose `window.terminal` (create / write / resize / kill / list / onData). |
| `apps/desktop/src/main/index.ts` | register ipcMain handlers; wire `TerminalManager` to `sessionManager` for effective cwd. |
| `apps/desktop/src/renderer/src/components/coding/TerminalPanel.tsx` | replace stub with xterm.js + `FitAddon` + multi-terminal tabs; select terminal group by the current session's effective cwd. |

### Phase 2 — Remote (non-buffered frame)

| File | Change |
|---|---|
| `apps/relay/src/relay-session.ts` | `RelayFrame` += `terminal` (desktop→mobile only); direct-forward, **no `enqueue`**. No inbound terminal frame (input rides existing `command`). |
| `apps/relay/src/relay-session.test.ts` | regression: terminal frames do **not** enter buffer / advance seq / trigger `forcedDropSeq`, while interleaved `event` frames still ack/replay correctly. |
| `apps/desktop/src/main/lan-server.ts` | symmetrical LAN-side `terminal` output frame forwarding (inbound `terminal_*` already handled via the existing command decrypt path). |
| `apps/desktop/src/main/remote-control-service.ts` | `sendTerminalFrame()` — encrypt + bypass the `sendAgentEvent` buffered path. |
| `apps/desktop/src/main/agent/agent-service.ts` | `handleRemoteCommand`: route `terminal_*` `RemoteCommand`s to `TerminalManager` with the real `source.deviceId`; enforce `TerminalOwnership` (non-owner input → `terminal_error{code:'not_owner'}`). |
| `apps/desktop/src/main/remote/mobile-broadcaster.ts` | terminal-frame lane: target by `TerminalOwnership` subscribers ∪ owner. |
| `apps/desktop/src/main/remote/device-registry.ts` | on device disconnect, also walk terminals → `release` / `unsubscribe`. |

### Phase 3 — Flutter mobile

| Change | Note |
|---|---|
| add `xterm` Dart package | pure-Dart terminal emulator + widget |
| `remote_client.dart` | receive `terminal` frame → decrypt → write snapshot string / incremental; send `terminal_input`, resize |
| terminal page | tab list of remote terminals; input enabled by `snapshot.writableByMe` / `terminal_owner_changed` (not inferred from claim send); on reconnect request snapshot, dedup subsequent `terminal_output` by `toSeq > snapshot.lastSeq` (never `updatedAt`) |

## Testing Strategy

Per the project's integration-first TDD approach (testing trophy):

- **Phase 1 (integration):** real `TerminalManager` + `TerminalSession` + a fake PTY backend (mirror `FakeBackend` for sessions). Scenarios: "terminal survives chat-session reset", "two worktrees of one project get isolated terminal groups", "cwd fixed at spawn does not migrate on branch switch", "snapshot reproduces full-screen TUI state after subscribe", "`invalidateCwd` on worktree removal kills PTYs and emits `terminal_exited`", "**seq dedup partial overlap**: with pending bytes seq 10–12 and a snapshot taken at seq 11, the barrier emits a 10–11 window *before* the dump and the post-barrier window starts at `fromSeq=12`; client applies neither twice (covers the straddle case, not just `toSeq <= lastSeq`)", "**snapshot chunk reassembly**: out-of-order chunks reassemble by snapshotId+index before write", "**local⇄remote writer**: remote claim flips local renderer read-only; local reclaim pre-empts remote and broadcasts `terminal_owner_changed`; second remote claim while owned → `already_claimed`".
- **Phase 2 (integration / relay):** extend `relay-session.test.ts`. Scenarios: "a flood of `terminal` frames does not advance seq / evict buffered agent events / trigger forcedDrop, while interleaved `event` frames still ack+replay correctly"; "`terminal_input` from a non-owner device is rejected with `terminal_error{not_owner}` and never reaches the PTY"; "N devices `terminal_subscribe` the same terminal read-only with no ownership conflict; only the `claim`ed device writes".
- **Phase 3:** mobile receive/render + claim/read-only behavior; reconnect via snapshot `lastSeq` + seq dedup; chunked snapshot reassembly on Flutter.
- **Packaging smoke (gates release):** a *packaged* build must spawn a PTY, echo a roundtrip, and resize — proving the node-pty native ABI + asar-unpacked path work outside dev.

Every bug fix gets a scenario test at the layer where the bug lived.

## Risks

1. **node-pty asar unpack + ABI** (Electron 41 + ESM): same class as better-sqlite3 / SDK native-binary asar rewrite. Mitigated by extending `postinstall` electron-rebuild to `node-pty` **and** a packaged spawn smoke test gating release — dev install passing is not sufficient evidence.
2. **Dedup correctness (straddle):** coalescing windows can span the snapshot boundary. Mitigated by the **server-side snapshot barrier** (flush+cut before dump) so no window straddles; client dedup is `toSeq > snapshot.lastSeq` on `fromSeq/toSeq` ranges. `createdAt` is never used for ordering. Tested with the partial-overlap scenario, not just fully-stale windows.
3. **Coalescing vs. interactivity:** output is coalesced; input is forwarded immediately and resize de-duplicated — otherwise vim/interactive apps feel laggy.
4. **Ownership model divergence:** terminal ownership is *not* Session ownership (Session is single-remote-exclusive incl. subscribers; terminal is 1 writer + N read-only). Implemented fresh in `TerminalOwnership`; only field names + disconnect plumbing are shared. Tested explicitly for N-subscriber non-conflict.
5. **Snapshot size:** large scrollback dumps exceed single-frame comfort. Mitigated by a scrollback byte cap + `terminal_snapshot_chunk` reassembly (mirrors `response_chunk`), with an ordering/reassembly test.
6. **Full-screen TUI snapshot:** the reason `@xterm/headless` + `SerializeAddon` is mandatory — raw-string replay corrupts vim/htop.
