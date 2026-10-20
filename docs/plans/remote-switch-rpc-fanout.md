# Remote session switch: RPC fan-out

Status: implemented, measured · Updated: 2026-10-20
Related: [remote-session-switch-latency.md](../proposals/remote-session-switch-latency.md)

## Problem

On a desktop controlling another desktop (A → B), the transcript itself opens
fast, but every session switch makes A send about 40 extra RPCs to B. On a
real link (Wi-Fi to another Mac, B busy with its own sessions) those RPCs
share one connection and B's main thread with the transcript read, and the
composer, model list, `@` mentions and git chip wait on them.

## Baseline (2026-10-20, dev build, desktop-node lab on one Mac)

Seeded B with three real sessions (83–408 messages, 6–11 MB). Temporary probes
on `ipcMain.handle` and `NodeRpcClient.rpc`. Five switches:

| Measured | Result |
|---|---|
| `environment:openRemoteSession` in A main (round trip, B read, follow) | 4–30 ms |
| B window cut / cold state scans / first `prepare` (Shiki) | 0–25 ms / 33–57 ms / ~200 ms once |
| Renderer `switchToSession`, remote vs local | both 200–300 ms (React commit, style and layout) |
| A → B RPCs over five switches | ~300, of which 5 were `session.transcriptWindow` |

RPCs to B **per switch**:

| Calls | Method | Each | Renderer IPC behind it |
|---|---|---|---|
| ~22 | `environment.descriptor` | ~13 ms | `environment:listItems` → `EnvironmentHost.listEnvironments` awaits `gateway.getDescriptor()` for every remote, uncached |
| ~5 | `claude.listAccounts` | ~370 ms | `environment:claudeListAccounts` |
| ~4 each | `provider.listBindings`, `provider.listCredentials`, `provider.listCustomPlatforms` | ~23 ms | `environment:provider*` |
| ~2 | `git.mentionCapabilities` | ~1.4 s | `app:git-mention-capabilities` |
| ~3 | `git.worktrees` | ~58 ms | `app:git-worktree-info` |
| ~1 | `git.status` | ~110 ms | `app:git-info` |

Renderer callers of `window.environment.listItems()` include
`use-environment-serves`, `use-environment-label`, `use-project-harness-catalog`,
`use-host-projects`, `AppSidebar`, `ChatSuggestions`, `ProjectSelector`,
`stores/app.ts`, `bash-output-live`. Several mount per pane or per row.

## Goal

A switch between two already-opened sessions of the same remote project sends
B only what the transcript needs (`session.get`, `session.transcriptWindow`
when not cached) plus data that actually changed. Target: ≤ 5 RPCs per switch
after the first visit to the project, no regression on first open.

## Steps

1. **Descriptor.** `RemoteEnvironmentGateway` already stores
   `descriptorCache`. `listEnvironments` should use the descriptor fetched at
   connect (and refresh it on reconnect, on `environment.changed`-style
   notices, and on an explicit refresh), not dial `environment.descriptor` per
   call. Keep `includeDescriptors` semantics. Verify the identity checks in
   `NodeRpcClient.getDescriptor` still run at connect.
2. **Renderer `listItems` fan-out.** Find why a switch triggers ~22 calls
   (hooks re-running on `activeSession`/`activeProject` change, per-row hooks).
   Share one in-flight/cached list keyed on the environment status push the
   renderer already receives (`attachEnvironmentStatusBridge`), instead of each
   hook calling IPC on mount.
3. **Account and provider lists.** `claude.listAccounts` (~370 ms on B) and the
   three provider lists are host-level, not session-level. Cache them per
   connection in main (or a shared renderer store) and invalidate on the
   existing change notices; do not refetch on session switch.
4. **Git.** `git.mentionCapabilities` (~1.4 s) and `git.worktrees` depend on
   the project/worktree, not the session. Dedupe per (connection, path) with
   in-flight sharing and invalidate on the existing git/file-watch signals.
   Check whether the local path has the same fan-out; fix it where it lives if
   so.
5. Do not change transcript reads, leases, or the window protocol.

## Verification

- Re-run the baseline: `bun run dev:cdp` (A) and
  `bun scripts/desktop-node-lab.ts start` (B, unsandboxed, `unset SUPERONE_HOME`);
  seed B by `ATTACH`ing a `.backup` copy of a real profile DB and copying
  `projects`/`sessions`/`chat_messages` rows; time
  `useChatStore.getState().switchToSession(key, sid)` over CDP (the A window is
  in the background: wait with `setTimeout`, not rAF). Wrap `ipcMain.handle` and
  `NodeRpcClient.rpc` with temporary timing logs, count RPCs per switch, and
  record the before/after table here. Remove the probes and seeded rows.
- Composer models, `@` mentions, git chip, account switcher, provider
  bindings still show B's data on first open, and update after a change on B
  (add an account, change a binding, create a worktree).
- Scoped tests for the touched modules (`bunx vitest related <file>`), plus
  `bun run typecheck:node` / `typecheck:web` for the touched sides.

### After (2026-10-20, same lab, mounted chat)

A fresh dev profile had to leave onboarding and turn on experimental remote
nodes before the sidebar and composer were on screen. Switches are between two
already-open sessions of `/Users/wuhangqi25/Developer/Projects/super-one` on B,
2.5 s apart (`setTimeout`). A same-session switch sent 0 RPCs. A switch that
changes session:

| Calls | Method | Before |
|---|---|---|
| 0 | `environment.descriptor` | ~22 |
| 0 | `claude.listAccounts` | ~5 |
| 0 | `provider.listBindings`, `provider.listCredentials`, `provider.listCustomPlatforms` | ~4 each |
| 0 | `git.mentionCapabilities` | ~2 |
| 0 | `git.worktrees` | ~3 |
| 1 | `git.status` | ~1 |
| 1 | `session.get` | (transcript) |
| 1 | `session.transcriptWindow` | (transcript; still every switch) |
| 1 | `session.list` | not in the baseline table |
| 2 | `session.scheduledSend.get` | not in the baseline table |
| 0–1 | `session.hostActionsPoll` | background poll |

That is 6 RPCs on three of the four real switches and 7 on one (the poll).
The ≤5 target is missed by `session.list` and the two scheduled-send reads.
Steps 1–4 did not cache those. Descriptor, account, provider, mention, and
worktree reads stayed at 0.

First open of that project, called the way the composer does and checked
twice back to back:

| Read | RPCs | Result |
|---|---|---|
| provider bindings, credentials, platforms, models | 1 each, then 0 | fetched when the project was first selected |
| `claude.listAccounts` | 1, then 0 | 1 account, 1325 ms |
| `git.mentionCapabilities` | 1, then 0 | `repo: ready`, `github: true`, 1387 ms |
| `git.worktrees` | 1, then 0 | branch `main`, 10 entries |
| `git.status` | 1 | branch `main`, 73 ms |

The mounted composer showed B's session title and transcript. A later switch
did not dial accounts, mentions, worktrees, or the provider lists again.

Not measured: an account or binding changed only on B, and a worktree created
only on B. A worktree created from A's own git IPC invalidates the cache in
code; that path was not timed in this lab.
