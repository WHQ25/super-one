# Desktop as an execution node for agent orchestration

Status: planned · Updated: 2026-10-08
Goal: An agent on desktop A launches a child session on another desktop B (or a CLI node), talks to it, and is woken when the child finishes, needs a human, or stalls. The child works unattended and hands back a pushed branch or PR, and A verifies it locally.
Long-term docs affected: `docs/architecture/remote-node-service.md` (desktop as node, transports); collaboration tool docs.

## Direction

- The point of remote is to use more machines for agent work. Human remote control and screen streaming come later; existing remote-desktop tools cover that.
- Desktop B goes first. Later, the desktop's session implementation moves down into the shared runtime (it is a superset of the node TurnRunner). Target-side logic written only against the CLI node runtime would have to be rewritten.
- The initiator side is environment-agnostic. It goes through `SessionGateway` (`packages/shared/src/environment/gateway.ts:83`) and is verified on both desktop B and a CLI node.
- Launch is approved by a human on the confirmation card, which also sets the permission mode. After that the child runs unattended (auto or bypass).

## Current gaps (verified 2026-10-08)

- The extraction to the shared runtime is only half done. `dispatchRpc` and the CLI-specific `RpcContext` are still in `apps/cli/src/rpc/handlers.ts:66-153`. The `session.*` family depends on concrete runtime classes (`SessionRuntime`, `EventLog`, `ControlLeaseService`), not on ports.
- The desktop `LocalSessionPort` is a stub. `list` works; create, send and control throw, and events are empty (`apps/desktop/src/main/environment/environment-host.ts:251-272`, `local-environment-gateway.ts:216-233`).
- The node server has no TLS (`apps/cli/src/server/node-server.ts:391`). The architecture doc rejects plain `ws://` beyond loopback.
- The desktop has no durable event log. `session/event-seq.ts` is an in-memory counter.
- `session.create` does not accept `cwd` or `systemPromptAppend` (`handlers.ts:1901`). `git.clone` exists (`:1884`), and `ProjectSnapshot.repoIdentity` is `git:<origin url>`.
- Collaboration has no environment field. A parent is woken only when its child calls `session_collab_send` (`collaboration-messaging.ts:32`). Nothing fires when a child finishes, needs a human, or stalls, not even locally.
- Only the CLI node runtime serves Host Actions (`session-runtime.ts:1884`). The desktop is only a consumer.
- `environment_list` returns `{environmentId, label, isLocal, state, searchable}` (`environment-archive-tools.ts:16`). No hardware information is collected.

## Steps

### 1. Finish moving the node server into the shared runtime

- Move `dispatchRpc` and `RpcContext` into `packages/runtime/src/server`. The CLI keeps only its wiring.
- Put the `session.*` family behind a `SessionHostPort` covering create, get, list, send, events (`afterSequence`), snapshot, messages.list, interrupt, respond* and the hostAction* calls. The CLI implements it with `SessionRuntime`.
- A host advertises the method families it serves through descriptor capabilities. An unserved family returns the explicit unsupported error.
- Acceptance: no change in CLI behavior, and the existing CLI and runtime tests pass.

### 2. Minimal served surface on desktop B

- Serve `environment.*`, `harness.list`, `project.list/get/open`, `git.clone` and the `session.*` subset from step 1. Terminal, workspace, fs and the other git methods stay unsupported for now.
- Implement `SessionHostPort` with `SessionManager` (`session-manager.ts:184`, `SessionCreateOptions` already has cwd, permissionMode, systemPromptAppend and unattended).
- Add a durable event log for sessions served to remote controllers, using the runtime `EventLog` (SQLite, rowid sequence), so that a controller can resume with `afterSequence` after a disconnect or a restart of B.
- Ownership: the remote controller holds the session's control lease. B's own UI shows these sessions read-only with a "started from <A>" badge. Takeover belongs to the later ownership merge.

### 3. Embedded server, pairing and transport on B

- `startNodeServer` runs in Electron main with the runtime `AuthService` and identity, only while the app runs and B has a controller (or a pairing is in progress); there is no switch.
- Pairing goes through a phone paired with one of the two desktops, which scans a QR on the other and carries B's node code; the controlled side confirms a six-digit code. A then pairs through the existing `/v1/pair` flow. Contract: `docs/architecture/remote-node-service.md` §11.5.
- Transport: the node protocol runs inside the phone link's end-to-end encryption (`docs/architecture/relay-crypto.md`). The pairing secret is exchanged out of band (code or QR) and never sent over the network. Every frame is AES-256-GCM over plain `ws://` on the LAN. The node's own auth (device key, tokens, tickets) runs inside the encrypted channel. The relay transport (`EndpointKind 'relay'`) later carries the same frames unchanged.
- The encrypted layer also closes two gaps of the phone LAN link: the handshake proves key possession instead of trusting a bare `deviceId` (`apps/desktop/src/main/lan-server.ts:273`), and frames carry a sequence number against replay. Apply both to the phone link as well.
- The architecture rule "no plain `ws://` beyond loopback" becomes "the channel must be encrypted", either by the transport (loopback, SSH, Tailscale, TLS) or by this layer.
- Progress (2026-10-09): desktop-to-desktop links follow the phone link. B accepts only private-network peers (the phone LAN server too), advertises `_superone-node._tcp` over mDNS, and holds a relay room; A dials LAN (mDNS or the pairing code's hint), then Tailscale, then the relay, moves back to the LAN when it answers, and shows the live path. Pairing code v2 carries the routes, so pairing works over the relay alone. Open: relay room membership is unauthenticated (denial of service only).

### 4. Remote launch from collaboration tools

- `session_collab_request` launches get an optional `environment` (an environmentId; the default is local). Child references are `{environmentId, sessionId}`.
- Project resolution on the target: match `repoIdentity` with the normalized origin URL. If nothing matches, `git.clone` into a node-configured parent directory. Refuse projects without a remote. The confirmation card shows the target, any clone, and A's unpushed commits and uncommitted changes (`carryLocalChanges` is not supported remotely).
- `session.create` gains `cwd` and `systemPromptAppend` (the collaboration prompt).
- The mailbox belongs to the initiator. A remote child with `externalParent` forwards `session_collab_send/retrieve` to A through Host Actions, which desktop B must now also serve (step 1 port). Nested spawn is refused on such children.
- Delivery and wake are authorized as "the caller is the child's controller" and use `sendWithoutLease`.
- Progress (2026-10-08): done for desktop B and the CLI node. Delivery and wake use `session.send` under the lease the initiator holds rather than `sendWithoutLease`. The initiator keeps a hidden local session row per remote child as its mailbox endpoint (the mailbox tables reference `sessions`). The target fetches `origin` before cutting the worktree, a clone reuses an unregistered checkout of the same origin (or picks a free name), and remote children run on the target's own model and provider defaults.

### 5. Child lifecycle wakes the parent

- Waking the parent costs tokens and waiting does not, so a wake happens only when the parent would otherwise wait forever and can act on it. This is generic and is built for local children first.
- The normal path adds nothing: the child reports with `session_collab_send`, which already wakes the parent. The collaboration prompt tells children to ask questions through `session_collab_send` rather than AskUserQuestion.
- One fallback wake: the child stops (idle or error, after its background tasks finish) without having sent a message since its last input. The wake is a single line with the child and its status, for example an error with quota exhausted. The parent calls `retrieve` for details.
- Permission prompts and stalls (streaming with no events for N minutes, default 10; today `_lastRuntimeActivityAt` is private, `session.ts:243`) notify the human on desktop and phone and do not wake the parent. Sessions stopped by a human do not wake the parent either.
- `session_collab_retrieve` reports each child's state: running, awaiting approval, stalled, idle or error, plus last activity and the running tool.
- On completion the child hands back a structured result: branch, PR URL, summary and self-test result. The parent fetches the branch and verifies it locally.
- Progress (2026-10-08): local children done. A remote child's stop wake and stall notice run on the initiator from the session events it drains for that child (a Host Action needs a live turn, and the mailbox that decides "reported" is the initiator's), so the target runs no monitor. retrieve reads a remote child's state from its node. A child whose initial task never arrived wakes nobody. The initiator follows each remote child from the node event log with a persisted per-child cursor, so a restart or reconnect mid-run still sees the stop, once. Review fixes (2026-10-08): the cursor carries the open run's state; a stop wake is recorded with the cursor, re-sent while the parent is idle, and cleared when a parent retrieve reports the child stopped or the child runs again; a retrieve returns at most its limit, oldest grant first; node restarts log `session.reconciled` (desktop nodes too) and end the run; a remote child's retrieve is acknowledged only after its Host Action response reached the node.

### 6. Node context for scheduling

- Static, collected at pairing and refreshed on node upgrade: CPU model and cores, memory, GPU, OS, ready harnesses, detected toolchains (Xcode, Docker and so on), and a user-written node note. These are added to `ExecutionEnvironmentDescriptor`.
- Dynamic, read on query: online state, running and pending session counts, load, and whether GUI tools are usable (screen locked or not).
- Returned by `environment_list`, not injected into the system prompt.
- Progress (2026-10-09): done for the CLI node and desktop B (`packages/runtime/src/machine`, `environment.status`, `local-node-context.ts`); a desktop reports `locked` from `powerMonitor`. The desktop no longer has a note editor (dropped with the pairing redesign), so only a CLI node's `superone note` sets one.

### 7. Later

- Per-node accounts and remaining quota, API key weekly and monthly budgets, and agent-chosen account per launch. This is opt-in, the chosen account is always shown, and there is no detection evasion. Quota for gateway subscriptions is adapted provider by provider.
- B-side pairing UX beyond the code and QR.
- The ownership merge (lease as the single steering authority), and human viewing and control (CDP screencast or window frames first, WebRTC with input later).

## Open decisions

- Whether the stall threshold (default 10 minutes) can be set per launch.

## Verification

- Unit tests per step. Step 1 must keep the existing CLI and runtime tests green.
- Lab: dev desktop as A and alpha desktop as B on one Mac with separate `SUPERONE_HOME`. Check first that the home does not leak between them. Then two Macs on Tailscale. Scenario: A's agent launches a child on B for a repo that B does not have. The child clones it, works, pushes a branch and finishes. A's agent is woken, fetches the branch and runs the tests. Repeat with a child that hits a permission prompt (wake with reason, and a phone notification) and with a child that stalls.
