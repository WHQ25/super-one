# SuperBot

Status: planned · Updated: 2026-11-28
Goal: Ship Bots — Agent Profiles with a home workspace, a Home Thread, host-owned memory, routines, structured notifications and tiered isolation — on the desktop first, then mobile, container and remote nodes.
Proposal: [superbot.md](../proposals/superbot.md) (draft; phases 1 and later start once it is accepted, phase 0 can start now)
Long-term docs affected: new `docs/features/bots.md`; [agent-profile-preapproval.md](../features/agent-profile-preapproval.md); [worktree-space.md](../features/worktree-space.md); [remote-node-service.md](../architecture/remote-node-service.md); `apps/desktop/docs/agent-reference/architecture.md`; `apps/cli/CLAUDE.md`

Paths are relative to the repository root and were checked against `main` at
`f7f726bb8`. Section numbers (§) refer to the proposal.

## How to read this plan

- Each phase is shippable behind `experimentalBotsEnabled`, which requires
  `experimentalAgentProfilesEnabled`.
- Phases 1 to 4 keep a bot inside `BOT_HOME`. User repositories become
  reachable in phase 5.
- Verification lists the smallest affected checks. Shared and desktop tests
  run from `apps/desktop`; `packages/runtime` and `packages/chat-view` tests
  run from their own package; CLI tests from `apps/cli`.
- Every database change is additive and bumps `SCHEMA_VERSION` in
  `apps/desktop/src/main/database-migrations.ts` (22 today). Read the
  "Schema changes" section of `apps/desktop/docs/agent-reference/architecture.md`
  before editing migrations.

## Phase 0 — Spikes

No product code. Each spike ends with a short finding recorded in this plan
and, where it changes a decision, an edit to the proposal.

| # | Question | Method | Decides |
|---|---|---|---|
| S1 | Can each harness express the tier-1 sandbox: extra write roots, write denials inside a root, read denials? | Claude: check what the Agent SDK `sandbox` option accepts beyond `{ enabled, autoAllowBashIfSandboxed, failIfUnavailable }` (`apps/desktop/src/main/agent/claude-query.ts`). Codex and dsh: `packages/codex/src/sandbox-policy.ts` writable roots and `readOnlyAccess`. Cursor, ACP, OpenCode: capability only | The `bot.scopedSandbox` value per harness; proposal §10.1 and §10.3 |
| S2 | Does `git add` / `commit` / `stash` / `rebase` work in a linked worktree under the §4.2 path table, on macOS Seatbelt and Linux bubblewrap? Which paths does git touch that the table misses (`packed-refs`, `ORIG_HEAD`, `gc`)? | Script the table with the sandbox runtime against a scratch repository; record every denied path | Worktree vs clone on tier 1 (§10.1) |
| S3 | Which signal separates a full wake from a Dark Wake in Electron on macOS? | Log `powerMonitor` `suspend` / `resume`, poll-tick gaps and display state across lid-closed Power Nap cycles on a MacBook; compare with `pmset -g log` | The awake clock's inputs (phase 3) |
| S4 | Does a parked permission prompt survive for hours on each harness without the turn failing (provider stream timeouts, SDK keep-alives)? | Park a prompt for 2 h per harness on a dev build | `bot.deferredPermissions` per harness; whether the TTL needs a per-harness lower bound |
| S5 | Does host git run against a checkout the bot can write stay safe? | Review every host git call that takes a session cwd (`apps/desktop/src/main/git/`, `packages/runtime/src/git/run.ts`) for config-driven execution (`core.fsmonitor`, `core.hooksPath`, aliases) | Hardening list for phase 5 |

Exit: S1 and S2 findings written down; §10.1 settled or explicitly deferred to
phase 5 with a fallback.

## Phase 1 — Contract, state, home, Home Thread

A bot can be created through the confirm card, appears in a Bots group, and
has a persistent Home Thread in `BOT_HOME/work`. No memory, no schedule.

### Shared contract

- `packages/shared/src/agent-bot.ts` (new): `AgentBotSpec`, defaults
  (`BOT_MEMORY_INJECT_BUDGET_DEFAULT = 8000`), `parseAgentBotSpec`,
  `isBotProfile`, the tier permission cap (`capPermissionModeForTier`), and
  `agentBotProtocolPrompt` (the silence / memory / notification rules block).
- `packages/shared/src/agent-profile.ts`: `identity.avatar`, `bot`. Extend
  `parseAgentProfileSpec` (allowed keys, avatar shape, delegate to
  `parseAgentBotSpec`, reject `bypassPermissions` on tier `host`). Extend
  `providerSystemPromptAppend` to accept extra host blocks so callers compose
  profile → bot protocol → memory snapshot → collaboration protocol in one
  place.
- `packages/shared/src/harness/harness-capabilities.ts`: the `bot` entry
  (`scopedSandbox`, `deferredPermissions`) with values from S1 and S4.
- `packages/shared/src/environment/host-action-agent-profile-descriptors.ts`
  and `packages/shared/src/superone-tool-descriptions.ts`: `avatar` and `bot`
  inputs on `agent_profile_apply`; `agent_profile_list` returns them.
- `packages/shared/src/agent-types.ts`: `experimentalBotsEnabled` on the
  settings types; `AgentBotSummary` (id, name, avatar, state, homeSessionId)
  and the `BOTS_*` IPC channel names in `AgentIpcChannels`.

### Runtime

- `packages/runtime/src/fs/agent-home.ts` (new): `resolveAgentHome(profileId)`
  on top of `resolveSuperoneHome`, `ensureAgentHome` (creates `work/`,
  `memory/.history/`, `projects/`), `trashAgentHome`. Refuses a `profileId`
  that is not a safe single path segment.
- `packages/runtime/src/session/session-provider-store.ts`: nothing new in the
  writer contract; the `profiles` writer already parses through
  `parseAgentProfileSpec`. Add tests for bot rows.

### Desktop main

- `apps/desktop/src/main/database-migrations.ts`: `agent_bots` table;
  `projects.owner_profile_id`; `sessions.bot_profile_id`; bump
  `SCHEMA_VERSION`.
- `apps/desktop/src/main/db-bots.ts` (new): CRUD for `agent_bots`.
- `apps/desktop/src/main/bots/bot-service.ts` (new): create / delete lifecycle
  hooked to the profile writer (`session/agent-profile-store.ts`): on a bot
  profile's first write ensure the home, the home `projects` row and the Home
  Thread; on delete trash the home and settle its sessions. `rotateHomeThread`
  for `/new`.
- `apps/desktop/src/main/recent-folders.ts`, `db-sessions.ts`: filter
  `owner_profile_id IS NULL` from project lists and `bot_profile_id IS NULL`
  from project, cross-project and settled session lists; add
  `listSessionsForBot`.
- `apps/desktop/src/main/session/session-manager.ts`: on create and resume of
  a session with `bot_profile_id`, compose the bot protocol block and apply
  the tier cap after `resolveAgentLaunchDefaults`. Default `sandboxMode:
  'auto'` where `harnessSupportsSandbox` allows it.
- `apps/desktop/src/main/mcp/agent-profile-tools.ts`,
  `agent-profile-tool-registration.ts`, `agent-profile-confirm.ts`: bot fields
  through validation, widening detection (tier, `environmentId`,
  `projectPaths` additions) and the draft round-trip.
- `apps/desktop/src/main/session/agent-profile-approval.ts`: include the bot
  block in the fingerprint; approval scope covers the bot's own launches.
- `apps/desktop/src/main/bots/bot-ipc.ts` (new) plus preload
  (`apps/desktop/src/preload/index.ts`, `index.d.ts`): `bots.list`,
  `bots.rotateHome`, `bots.setPaused`, change events.
- `apps/desktop/src/main/app-settings-service.ts`,
  `mcp/settings-registry.ts`: the experimental flag.
- `apps/desktop/src/main/mcp/guides/product/bots.md` (new), routed from
  `agent-profiles.md`: how an agent sets a bot up.

### UI

- `apps/desktop/src/renderer/src/components/sidebar/BotRow.tsx`,
  `BotsSection.tsx` (new), mounted in `AppSidebar.tsx`.
- `apps/desktop/src/renderer/src/components/chat/AgentProfileConfirmPrompt.tsx`
  and `packages/chat-view/src/presenters/AgentProfileToolBlock.tsx`: bot
  section (avatar, tier and consequence, allowlist, memory toggle).
- `apps/desktop/src/renderer/src/components/AgentProfilesPage.tsx`: a Bots
  list with pause, new thread and delete.
- `packages/shared/src/i18n/en.ts`, `zh.ts`: strings.

Stories: `BotRow.stories.tsx` (idle, working, waiting for approval, unread,
paused, long name, narrow), `BotsSection.stories.tsx` (empty, one, many),
`AgentProfileConfirmPrompt.stories.tsx` additions (bot create, widening diff
for tier and allowlist, harness without scoped sandbox, long allowlist,
rejected), light and dark, `zh` layout.

### Verification

```bash
# from apps/desktop
bunx vitest run ../../packages/shared/src/agent-profile.test.ts ../../packages/shared/src/agent-bot.test.ts
bunx vitest run src/main/database-migration.test.ts src/main/database-migrations-policy.test.ts
bunx vitest run src/main/db-bots.test.ts src/main/bots/bot-service.test.ts
bunx vitest run src/main/mcp/agent-profile-tools.test.ts src/main/session/agent-profile-approval.test.ts
bunx vitest run src/main/session/session-manager.test.ts src/main/db-sessions.test.ts
bunx vitest run src/renderer/src/components/AppSidebar.test.tsx src/renderer/src/components/chat/AgentProfileConfirmPrompt.test.tsx
# from packages/runtime
bunx vitest run src/fs/agent-home.test.ts src/session/session-provider-store.test.ts
# from the root
bun run typecheck:node && bun run typecheck:web
```

Exit: with the flag on, asking an agent for a bot raises the card; accepting
creates the home and a pinned Home Thread that resumes with the bot protocol;
the home never shows as a project; an older schema opens the migrated
database (policy test green).

## Phase 2 — Memory

### Runtime

- `packages/runtime/src/fs/agent-memory.ts` (new): entry model, per-target
  caps, `readAgentMemory`, `applyAgentMemoryWrite` (pipeline §6.3: shape →
  injection scan → redaction → duplicate → destructive-change guard → backup
  → atomic write), `listMemoryHistory`, `restoreMemoryVersion`,
  `buildMemorySnapshot` (scan at injection, budget, tagged block).
- `packages/runtime/src/fs/memory-guard.ts` (new): the injection scanner and
  the secret redactor as pure functions with their own corpus tests, reused by
  digests in phase 3.

### Shared

- `packages/shared/src/agent-memory.ts` (new): tool input and result types.
- `packages/shared/src/superone-tool-descriptions.ts`: `AGENT_MEMORY_DESCRIPTION`.
- `packages/shared/src/environment/host-action-agent-memory-descriptors.ts`
  (new), registered in `host-actions.ts`, so a node session reaches the same
  tool in phases 7 and 8.

### Desktop

- `apps/desktop/src/main/mcp/agent-memory-tools.ts` (new) and registration in
  `superone-mcp-builtins.ts`, only for sessions with `bot_profile_id`. Target
  resolved from the session, never from `cwd`. Add the tool to
  `superone-host-owned-tools.ts` so it raises no permission prompt.
  `replace` / `remove` refused outside the Home Thread (§4.5).
- `apps/desktop/src/main/session/session-manager.ts`: append
  `buildMemorySnapshot` on create and resume when `bot.memory.enabled`.
- `apps/desktop/src/main/bots/bot-ipc.ts`: memory read, edit, history and
  restore for Settings (human-only handlers, not exposed as tools).

### UI

- `packages/chat-view/src/presenters/AgentMemoryToolBlock.tsx` (new): compact
  audit row (added, replaced, removed, redacted, refused with reason).
- `apps/desktop/src/renderer/src/components/agent-profiles/BotMemoryPanel.tsx`
  (new): both files, edit, history list, restore.

Stories: `AgentMemoryToolBlock.stories.tsx` (each action, redacted, refused,
cap reached, long entry, narrow); `BotMemoryPanel.stories.tsx` (empty, filled,
history, restore confirm, flagged entry excluded from the snapshot).

### Verification

```bash
# from packages/runtime
bunx vitest run src/fs/agent-memory.test.ts src/fs/memory-guard.test.ts
# from apps/desktop
bunx vitest run src/main/mcp/agent-memory-tools.test.ts src/main/mcp/superone-host-owned-tools.test.ts
bunx vitest run src/main/session/session-manager.test.ts
# from packages/chat-view
bunx vitest run src/presenters
# from the root
bun run typecheck:node && bun run typecheck:web
```

Exit: a write in one session is in the next launch's snapshot and not in the
current prompt; a seeded secret is redacted; a seeded injection is refused at
write and excluded at injection; restore from `.history` works; no
`CLAUDE.md` / `AGENTS.md` exists under `BOT_HOME`.

## Phase 3 — Routines, heartbeat, results, awake clock

### Contracts and migration

- `packages/shared/src/agent-types.ts`: `Automation.profileId?`,
  `Automation.runTarget?: 'isolated' | 'home'`; `AutomationRunStatus` gains
  `'skipped'`; the create and update request types.
- `packages/shared/src/host-wake.ts` and `ChatMessageSource`: a bot host-turn
  source for heartbeats, hidden like other model-only wakes.
- `packages/shared/src/environment/host-action-automation-descriptors.ts`:
  `profileId`, `runTarget` on `automation_apply`.
- `apps/desktop/src/main/database-migrations.ts`: `automations.profile_id`,
  `automations.run_target`, table `agent_bot_digests`; bump `SCHEMA_VERSION`.
  Mirror the two columns in `packages/runtime/src/automations/store.ts`
  (`ensureAutomationsTable`) so the node schema does not drift.

### Desktop main

- `apps/desktop/src/main/db-automations.ts`: the new columns;
  `listAutomationsForBot`.
- `apps/desktop/src/main/automation-service.ts`:
  - bot routines launch through a new `AgentService.runBotSession` instead of
    `runAutomationSession`: profile provider row, resolved defaults,
    `bot_profile_id`, **no** `unattended`;
  - `run_target: 'home'`: apply the busy rule with the admission predicate
    from `session/collaboration-wakes.ts` (extract it to a shared helper);
    skipped runs record `'skipped'` and advance `next_run_at`;
  - gate `checkDueAutomations` on the awake clock; heartbeats due during
    sleep are dropped, isolated routines run once.
- `apps/desktop/src/main/awake-clock.ts` (new): injected clock and power
  signals (per S3), `isFullyAwake()`, `awakeElapsedSince(t)`,
  `onFullWake(cb)`. Constructed in `index.ts` next to the existing
  `powerMonitor.on('resume')` handler; no Electron import in the module, so it
  is unit-testable like `NotificationService`.
- `apps/desktop/src/main/bots/bot-results.ts` (new): on isolated run end,
  append the Result Card as a `providerId: 'system'` transcript row (the
  pattern in `session/plugin-notice-message.ts`) and insert the digest
  (bounded, scanned with `memory-guard`).
- `apps/desktop/src/main/session/session.ts` send path: a Home Thread turn
  takes pending digests from `db-bots.ts` and prepends them as a tagged
  block; mark delivered when the backend accepts the input.
- `apps/desktop/src/main/mcp/automation-tools.ts`: bot routines only from the
  Home Thread; `profileId` must be the calling bot.

### UI

- `packages/chat-view/src/presenters/BotResultCard.tsx`,
  `BotHeartbeatRow.tsx` (new): result card; folded quiet heartbeat and the
  collapsed run of them.
- `packages/chat-view/src/presenters/AutomationToolBlock.tsx` and
  `apps/desktop/src/renderer/src/components/chat/AutomationConfirmPrompt.tsx`:
  show the bot and the run target.
- Bot page: routines list with last outcome, including `skipped`.

Stories: `BotResultCard.stories.tsx` (completed, error, expired approval, long
summary, withheld digest, narrow); `BotHeartbeatRow.stories.tsx` (one quiet,
collapsed run, heartbeat that notified, expanded).

### Verification

```bash
# from apps/desktop
bunx vitest run src/main/awake-clock.test.ts src/main/automation-service.test.ts
bunx vitest run src/main/db-automations.test.ts src/main/bots/bot-results.test.ts
bunx vitest run src/main/mcp/automation-tools.test.ts src/main/database-migrations-policy.test.ts
bunx vitest run ../../packages/shared/src/host-wake.test.ts
# from packages/runtime
bunx vitest run src/automations
# from packages/chat-view
bunx vitest run src/presenters
# from the root
bun run typecheck:node && bun run typecheck:web
```

`automation-service.test.ts` is new: the service has no test today. Cover the
busy rule (streaming, pending interaction, error → skipped, not queued), no
self-overlap while parked, sleep gating with a fake awake clock, and one
catch-up run after wake.

Exit: an isolated routine leaves a Result Card and a digest and does not
start a Home Thread turn; the next Home Thread turn carries the digest once;
a heartbeat due during a streaming turn is skipped; no routine starts in a
simulated Dark Wake.

## Phase 4 — Silence, `notify_user`, attended-async approvals

### Shared

- `packages/shared/src/notifications.ts`: `'agent'` in `NotificationKind`,
  `NOTIFICATION_KINDS`, `DEFAULT_NOTIFICATION_SETTINGS`. `NotificationIntent`
  needs no new field: `sessionId` is the Home Thread.
- `packages/shared/src/superone-tool-descriptions.ts`: `NOTIFY_USER_DESCRIPTION`;
  descriptor file `host-action-bot-descriptors.ts` (new) in
  `packages/shared/src/environment/`.

### Desktop main

- `apps/desktop/src/main/mcp/bot-notify-tools.ts` (new): `notify_user`, bot
  sessions only, host-owned (no prompt).
- `apps/desktop/src/main/notifications/notification-service.ts`:
  `notifyAgent(intent)` beside `notifyStalled`: per-bot rate limiter (injected
  clock), and when the banner is suppressed (focused, phone online) mark the
  bot unread instead of dropping the intent.
- `apps/desktop/src/main/notifications/notification-intent.ts`: `'agent'`
  bypasses `BODY_KEY` (host-capped model text, bot name as title);
  `intentForEvent` returns no `completed` intent for a run the user did not
  start in a session with `bot_profile_id`.
- `apps/desktop/src/main/bots/bot-approval-deadline.ts` (new): per pending
  interaction in a bot session, an awake-time 24 h deadline that settles
  through the existing deny path (the session's permission response and
  `session/host-confirm-registry.ts`), then raises the failure notice and a
  digest. No polling: one timer per request, re-armed from the awake clock on
  full wake.
- `apps/desktop/src/main/bots/bot-service.ts`: bot state derivation (working,
  waiting for approval, unread, paused) from session activity and pending
  interactions, published on the bots change event.

### UI

- `apps/desktop/src/renderer/src/components/settings/NotificationSettingsSection.tsx`:
  the `'agent'` switch.
- `packages/chat-view/src/presenters/BotNotificationRow.tsx` (new): what was
  sent, urgency, pushed or rate-limited.
- Bot row and Home Thread: "waiting for approval" with a link to the asking
  session; expiry notice.

Stories: `BotNotificationRow.stories.tsx` (normal, high, rate-limited, long
body, narrow); `NotificationSettingsSection` story with the new kind;
`BotRow` waiting-for-approval and expired states.

### Verification

```bash
# from apps/desktop
bunx vitest run src/main/notifications
bunx vitest run src/main/mcp/bot-notify-tools.test.ts src/main/bots/bot-approval-deadline.test.ts
bunx vitest run src/main/session/host-confirm-registry.test.ts
bunx vitest run src/renderer/src/components/settings/NotificationSettingsSection.test.tsx
bunx vitest run ../../packages/shared/src
# from the root
bun run typecheck:node && bun run typecheck:web
```

Exit: a routine's prompt parks the run, rings `permission`, shows on the bot
row and auto-denies after 24 h of awake time (fake clock) with a notice;
sleeping does not advance the deadline; a quiet heartbeat rings nothing;
`notify_user` over the limit is recorded and not pushed; older settings JSON
normalizes with `'agent'` on.

## Phase 5 — Tier 1 isolation

Depends on S1, S2, S5.

### Runtime

- `packages/runtime/src/git/worktree-plan.ts`: `planNewWorktreePaths` takes
  `rootDir?` (default `~/.worktrees`) and `dirName?` (default the repository
  basename).
- `packages/runtime/src/git/worktree-ops.ts`: `ActivateWorktreeInput.root?`
  passed to the planner; unchanged behavior when absent.
- `packages/runtime/src/fs/agent-home.ts`: `botCheckoutRoot(profileId,
  projectPath)` using the `<slug>-<hash8>` key; move `deriveProjectMemoryKey`
  out of `memory-target.ts` into a shared path-key helper that both import.
- `packages/runtime/src/sandbox/bot-policy.ts` (new): `buildBotSandboxPolicy`
  → neutral `{ writeRoots, writeDeny, readDeny }` for a session, including the
  git common-directory grants and denials from §4.2 (resolved with
  `resolveMainDirFromCommonDir`), plus the credential read-deny list.

### Harness application

- Claude: `apps/desktop/src/main/agent/claude-query.ts` and
  `session/backends/claude-backend.ts` map the neutral policy onto the SDK
  sandbox settings (per S1).
- Codex and dsh: `packages/codex/src/sandbox-policy.ts` writable roots and
  read access from the neutral policy.
- Harnesses with `scopedSandbox: 'none'`: no auto-allow; the session starts in
  the capped mode and the UI shows the explicit state.

### Desktop main

- `apps/desktop/src/main/bots/bot-checkouts.ts` (new): allowlist check against
  `bot.isolation.projectPaths` (canonical, realpath), create the checkout on
  `bot/<slug>/<topic>` via `activateWorktree` with the bot root, set
  `gc.auto=0`, record it, remove it. Refuses any target outside the allowlist
  before a session exists.
- `apps/desktop/src/main/agent/agent-service.ts` (`runBotSession`): a routine
  whose project is allowlisted runs in a bot checkout with the sandbox policy.
- Host git hardening from S5 for calls whose cwd is a bot checkout.
- `apps/desktop/src/main/storage-worktrees.ts`, `storage-ipc.ts`: count bot
  checkouts in Storage under their bot; the `~/.worktrees` sweep does not
  remove them.
- Host tools in bot sessions keep their confirms: assert in
  `mcp/superone-host-owned-tools.ts` tests that `terminal_*`, `computer_*`,
  `browser_*` are not auto-allowed for `bot_profile_id` sessions.

### UI

- Confirm card: repository allowlist editor state; per-harness sandbox line
  ("writes auto-allowed inside the bot checkout" / "every write asks").
- Bot page: checkouts list (repository, branch, size, remove).

Stories: confirm card with allowlist add and remove diffs; bot page checkouts
(empty, several, removal in progress, removal failed).

### Verification

```bash
# from packages/runtime
bunx vitest run src/git/worktree-plan.test.ts src/git/worktree-ops.test.ts src/sandbox
# from apps/desktop
bunx vitest run src/main/bots/bot-checkouts.test.ts src/main/storage-worktrees.test.ts
bunx vitest run src/main/mcp/superone-host-owned-tools.test.ts
bunx vitest run ../../packages/shared/src/agent-bot.test.ts
# from packages/codex
bunx vitest run src
# from the root
bun run typecheck:node && bun run typecheck:web
```

Manual, on macOS and Linux dev builds, recorded here: in a bot checkout a
sandboxed session can edit, test and commit on `bot/…`; it cannot write
`<main>/.git/hooks`, `<main>/.git/config`, another branch's ref, `~/.ssh` or
`MEMORY.md`; `git push` raises a prompt; a path outside the allowlist is
refused before launch.

Exit: the manual matrix passes on Claude and Codex; other harnesses show the
unsupported state; §10.1 is settled in the proposal.

## Phase 6 — Mobile parity

- Node RPC: `bots.list` and bot change events in
  `packages/runtime/src/server/rpc-dispatch.ts` and the desktop host ports;
  the phone gates the group on served methods.
- `apps/mobile/src/navigation/workspace-list.tsx`: Bots group and row;
  `apps/mobile/src/session-list-state.ts`: bot sessions out of project lists.
- Chat rows come from the shared presenters. Run `bun run build:chat-view`.
- Approvals reach the phone through the existing permission sheet while
  connected. A push channel (`NotificationChannel` for APNs/FCM through the
  relay) is tracked as its own piece of work (§10.5); this phase does not
  claim "approve from anywhere".

Verification: `bunx vitest run --config vitest.config.ts` for the touched
files and `bunx jest <file>` for components, from `apps/mobile`; Storybook
stories for the mobile bot row states.

## Phase 7 — Tier 2, local container node

Prerequisites, each a change of its own:

1. CLI turn runners read `systemPromptAppend` (`apps/cli/src/session/`,
   `createProductionTurnRunner`); remote spawn children receive profile
   instructions. Both are open gaps in agent-profile.md §0.
2. `agent_memory` and `notify_user` reachable from a node session as host
   actions (descriptors exist from phases 2 and 4; wire the desktop executor
   through the environment gateway).

Then:

- A production image built from the published CLI package
  (`apps/cli/scripts/pack-npm.ts`), separate from the lab in
  `apps/cli/docker/`: no source mount, no password login, node port published
  to host loopback only.
- `apps/desktop/src/main/environment/`: a managed-container environment kind
  (create, start, stop, pair, health), mounts limited to `BOT_HOME/work` and
  `BOT_HOME/projects`.
- `apps/desktop/src/main/bots/bot-checkouts.ts`: clone mode
  (`git clone --local`, `origin` re-pointed) for tier `container`; host
  fetch-back of `bot/…` branches as an approved action.
- Model credentials: expose the LLM relay to the container with a
  per-environment ephemeral token (`packages/runtime/src/llm-proxy/`, desktop
  `providers/llm-proxy-manager.ts`); the static placeholder key is not
  acceptable across a container boundary.
- Tier cap lifted for tier `container` in `capPermissionModeForTier`; the
  confirm card states that autonomy applies inside the container only.
- GUI variant, after the base works: image with `Xvfb`, Openbox, `tigervnc`,
  `noVNC`; a Linux adapter beside
  `apps/desktop/src/main/computer-use/platform/macos-adapter.ts`; node-local
  execution for `browser_*` / `computer_*`; an embedded noVNC takeover view.
  This gets its own plan when started.

Verification: targeted Vitest from `apps/cli` for the runner change; a
container smoke modeled on `bun run dev:cli:docker:smoke`; a manual check that
the container sees no host home, SSH agent or Docker socket.

## Phase 8 — Tier 3, remote host

- Bind a bot to a paired node (`environmentId`); the desktop stays the control
  plane (§4.6). `projectPaths` are validated on that host over RPC.
- Node-resident bots: move scheduling to
  `packages/runtime/src/automations/service.ts` (it has the columns from
  phase 3), bot state and memory to the node store, profile authoring parity
  on the node. Gets its own plan; update
  [remote-node-service.md](../architecture/remote-node-service.md).

## Phase 9 — Later

Each starts with its own proposal: credential and MCP loopback relay, channel
lanes, webhook triggers with JSON Pointer pre-filtering, policy and audit
gateway.

## Migration summary

| Phase | Change | Kind |
|---|---|---|
| 1 | `agent_bots`; `projects.owner_profile_id`; `sessions.bot_profile_id` | new table, two nullable columns |
| 3 | `automations.profile_id`, `automations.run_target`; `agent_bot_digests` | two nullable columns, new table |

No drops, renames or rebuilds. `automations.project_id` stays `NOT NULL`: a
routine with no repository uses the bot's home `projects` row.

## When the work is done

In the commit that completes each shipped phase:

1. Write `docs/features/bots.md` (behavior and the decisions behind it:
   tiers, the `.git` path table, the busy rule, frozen snapshot, awake time,
   notification policy) and link it from `docs/README.md`.
2. Update `agent-profile-preapproval.md` (bot fingerprint and scope),
   `worktree-space.md` (bot checkout root), desktop `architecture.md` (new
   tables), `apps/cli/CLAUDE.md` (permission deadline for bot sessions, which
   changes its "no deadline" statement).
3. Point code comments at those docs. Delete this plan and the accepted
   proposal once the last planned phase lands or is dropped.

## Risks

| Risk | Mitigation |
|---|---|
| A harness cannot express the §4.2 path table | S1 / S2 first; fall back to clones on tier 1 |
| Parked prompts fail the turn on some harness | S4; `deferredPermissions: false` runs that harness's routines with an explicit "denied when unanswered" state instead of pretending to wait |
| Dark Wake is not distinguishable with Electron signals alone | S3; fall back to a tick-gap heuristic plus display state, or a small native probe beside the existing lid helper |
| Bot sessions leak into project lists through an unfiltered query | One `bot_profile_id IS NULL` predicate helper in `db-sessions.ts`, with a test enumerating the list functions |
| Memory scanner false positives block useful writes | Refusals name the reason; the user can always edit memory in Settings; corpus tests in `memory-guard.test.ts` |
| Standing cost of heartbeats | Minimum interval and per-bot pause in phase 3; budget cap decided in §10.11 |
