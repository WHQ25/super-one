# SuperBot

Status: draft · Updated: 2026-11-28
Plan: [superbot.md](../plans/superbot.md) (drafted alongside; execution starts once this is accepted)

Scope: a **Bot** is a persistent digital worker built on an Agent Profile:
`agent + role + memory + autonomy`. It owns a long-lived home workspace and one
pinned Home Thread, keeps continuity in files, runs scheduled and proactive
work, stays silent unless something matters, and collects approvals
asynchronously. This proposal covers the product boundary, the data model, the
home workspace and its three isolation tiers, the thread and scheduling model,
memory, notifications and permissions.

Builds on [agent-profile.md](agent-profile.md) (v1 shipped) and
[agent-profile-preapproval.md](../features/agent-profile-preapproval.md).

## 1. Positioning

A Bot is a worker, not a companion. It has a name, a role and an avatar so the
user can tell bots apart. It has no persona roleplay, affection, mood or avatar
animation, and nothing in the product asks the model to simulate a relationship.

| | Session (today) | Bot |
|---|---|---|
| Bound to | One project (`sessions.project_id`) | No user project. Its own home workspace |
| Lifetime | One task | Open-ended. One Home Thread, rotated by hand |
| Continuity | The transcript | `USER.md` / `MEMORY.md`, re-injected on every create and resume |
| Starts work | The user sends a message | The user, a schedule, or a heartbeat |
| Default output | Every turn is shown and may ring `completed` | Silent. Speaks through `notify_user` |
| Approvals | The user is present; prompts have no deadline | The user is elsewhere; prompts wait, notify, and expire after 24 h |
| Where it writes | The user's checkout or `~/.worktrees` | Its home, and bot-owned checkouts of allowlisted repositories |
| Sidebar | Under its project | **Bots** group, one row per bot |

Non-goals: emotional companionship; team or multi-user bots; a bot marketplace;
external chat channels and webhooks in the first release (§9); replacing
project sessions or collaboration.

### Principles

1. **A Bot is an Agent Profile.** No second identity system. Every profile
   edit, including the bot block, goes through the existing
   `agent_profile_apply` confirm card.
2. **The host owns what the model must not forge**: memory files, the
   schedule, notifications, the permission boundary, and the bot's state.
3. **Fewer prompts come from a smaller blast radius, not from skipping
   checks.** A bot never runs `bypassPermissions` on the user's primary host.
   Autonomy rises only as isolation does (§4).
4. **Silence is structural.** A bot reaches the user through a tool call, not
   through text conventions the model may get wrong.
5. **Shared contracts, no harness branches.** Bot features are described by
   `HarnessCapabilities`; a harness that cannot enforce something shows an
   explicit unsupported state.

## 2. Today

What already exists on `main` and what it lacks for a bot.

| Layer | Where | State |
|---|---|---|
| Agent Profile | `packages/shared/src/agent-profile.ts` (`AgentProfileSpec`, `parseAgentProfileSpec`, `agentProfilePrompt`, `providerSystemPromptAppend`) | Identity, instructions, runtime. The parser rejects unknown top-level keys. No avatar, scope, memory or isolation |
| Profile authoring | `apps/desktop/src/main/mcp/agent-profile-tools.ts`, `AgentProfileConfirmPrompt.tsx`, `packages/chat-view/src/presenters/AgentProfileToolBlock.tsx` | Desktop only; behind `experimentalAgentProfilesEnabled` |
| Prompt composition | `SessionManager` create and resume call `providerSystemPromptAppend(provider.config, …)` (`apps/desktop/src/main/session/session-manager.ts`) | Re-read on every create and resume. CLI turn runners do not read `systemPromptAppend` yet; remote spawn children do not receive instructions (agent-profile.md §0) |
| Automations | `apps/desktop/src/main/automation-service.ts`, `db-automations.ts`; node twin in `packages/runtime/src/automations/` | Project-scoped (`automations.project_id NOT NULL`), always a fresh session on the harness **base** row, 30 s wall-clock poll, no sleep awareness. Startup recomputes every `next_run_at` from now, so runs missed while the app was closed are dropped |
| Unattended runs | `SessionCreateOptions.unattended` → Claude `permissionPrompts: 'none'` (`apps/desktop/src/main/agent/claude-query.ts`); `runAutomationSession` defaults Claude and ACP to `bypassPermissions` | Whatever would prompt is denied at once. There is no "ask later" mode |
| Notifications | `packages/shared/src/notifications.ts`, `apps/desktop/src/main/notifications/` | Six kinds, all with a fixed status body. One channel (desktop). Suppressed while the app is focused or a phone holds a live transport. No mobile push channel (`notification-channel.ts` lists it as planned) |
| Worktrees | `packages/runtime/src/git/worktree-plan.ts` (`planNewWorktreePaths`), `worktree-ops.ts` (`activateWorktree`) | Root is fixed at `~/.worktrees/<repo>` |
| Sandbox | `packages/shared/src/harness/harness-sandbox.ts`, `packages/runtime/src/sandbox/probe.ts`, `packages/codex/src/sandbox-policy.ts` | Claude and Cursor have a toggle; Codex and dsh fold it into presets; ACP reports its own; OpenCode has none. SuperOne passes Claude only `{ enabled, autoAllowBashIfSandboxed }`: no custom write roots or read denials |
| Interaction memory | `packages/runtime/src/fs/memory-target.ts`, `okf-note.ts`, `interaction-memory.ts` | Per-target playbooks (browser domain, app). Not an agent's own memory |
| SuperOne home | `packages/runtime/src/fs/superone-home.ts` (`resolveSuperoneHome`) | `~/.superone[/<variant>]`, or `SUPERONE_HOME` |
| Remote and container nodes | `apps/cli`, `apps/cli/docker/` | The Docker lab is a development environment that mounts the monorepo and runs the CLI from source. `computer_*` has a macOS adapter only, and remote host actions execute on the controlling desktop's renderer |
| Sleep | `apps/desktop/src/main/power-management-service.ts`; `powerMonitor.on('resume')` in `index.ts` | Keep-awake policy and reconnect on resume. No awake-time clock, no Dark Wake detection |

## 3. Data model

### 3.1 Profile extension

A bot is a `session_providers` row whose `config.profile` carries a `bot` block.
A profile without it stays what it is today.

```ts
// packages/shared/src/agent-profile.ts
export interface AgentProfileSpec {
  version: 1
  identity: {
    name: string
    description: string
    /** Static. Shown in the sidebar, the Home Thread header and notifications. */
    avatar?: { emoji: string; color?: string }
  }
  instructions?: string
  runtime?: AgentProfileRuntime
  /** Present = this profile is a Bot. */
  bot?: AgentBotSpec
}

// packages/shared/src/agent-bot.ts
export interface AgentBotSpec {
  memory?: {
    /** Default true. */
    enabled: boolean
    /** Size of the frozen snapshot. Default 8000. */
    injectBudgetChars?: number
  }
  isolation: {
    /** `host` = tier 1, `container` = tier 2, `remote` = tier 3 (§4). */
    tier: 'host' | 'container' | 'remote'
    /** Execution environment. Absent on `host`; required otherwise. */
    environmentId?: string
    /** Canonical repository paths on the execution host the bot may work in. */
    projectPaths?: string[]
  }
}
```

Rules, enforced by `parseAgentProfileSpec` and `agent_profile_apply`:

- `isolation.tier` is explicit rather than derived from the environment, so the
  confirm card states the consent the user is giving, and an environment that
  changes kind invalidates the profile instead of silently changing its tier.
- On tier `host`, `runtime.permissionMode: 'bypassPermissions'` is rejected by
  name. Tiers `container` and `remote` may carry it.
- `projectPaths` entries must be existing git repositories on the execution
  host. Adding a path, raising the tier's autonomy or changing `environmentId`
  is a permission widening and is highlighted on the card, as
  agent-profile.md §6 describes for `bypassPermissions`.
- A bot profile is fingerprinted and approved like any saved profile. The
  approval covers the bot's own launches (Home Thread, routines) inside its
  declared isolation.
- Any harness can carry the bot block: all of them deliver
  `systemPromptAppend` (agent-profile.md §4). Sandbox support is not a
  precondition; it decides how many prompts the bot will raise (§4.2).

Downgrade behavior: shipped builds reject a profile with an unknown top-level
key, so an older build reads a bot row as a row with no profile. It cannot
rewrite it either: profile rows are written only through the store's
`profiles` writer, which parses first. The row survives a downgrade unchanged.
§10 keeps the alternative (a sibling `config.bot`) open.

### 3.2 Host-owned bot state

Operational state changes without user consent (the Home Thread rotates, a
heartbeat runs). It lives outside the spec so it never invalidates the
approval fingerprint or raises a confirm card.

| Table / column | Purpose |
|---|---|
| `agent_bots (profile_id PK, home_project_id, home_session_id, paused_at, last_heartbeat_at, last_heartbeat_outcome, created_at, updated_at)` | One row per bot. `home_session_id` is the current Home Thread |
| `agent_bot_digests (id PK, profile_id, automation_id, run_session_id, status, summary, created_at, delivered_at)` | Routine results waiting to enter the Home Thread's next turn (§5.4) |
| `projects.owner_profile_id` | Marks the bot's home as a project row that no project list shows. `sessions.project_id` and `automations.project_id` are `NOT NULL`, so the home needs a row |
| `sessions.bot_profile_id` | Marks a bot-owned session: hidden from project lists, shown under the bot |
| `automations.profile_id`, `automations.run_target` | Routines (§5.2) |

All additive, per the desktop migration rules. An older build shows bot
sessions under their project and the home as an ordinary project; nothing it
reads is removed.

### 3.3 Capabilities

`HarnessCapabilities` (`packages/shared/src/harness/harness-capabilities.ts`)
gains a `bot` entry so UI and validation never branch on a harness id:

```ts
bot: {
  /** Can restrict writes to given roots and deny reads of given paths. */
  scopedSandbox: 'native' | 'preset' | 'none'
  /** Prompts can be parked and answered later without failing the turn. */
  deferredPermissions: boolean
}
```

## 4. Home workspace and isolation

### 4.1 Home workspace

```
$SUPERONE_HOME/agents/<profileId>/        BOT_HOME
  USER.md               who the user is, how they want to be worked for
  MEMORY.md             what the bot has learned about its job
  memory/.history/      one backup per write, for undo
  work/                 Home Thread cwd; scratch and artifacts
  projects/<project>/<checkout>/          bot-owned checkouts (§4.2)
```

- `BOT_HOME` comes from `resolveSuperoneHome()`, so it follows the build
  variant and the `SUPERONE_HOME` override.
- Memory files are never named `CLAUDE.md` or `AGENTS.md`, and no such file is
  created in `BOT_HOME`. Harnesses auto-load those from `cwd` and its parents,
  which would inject memory a second time, outside the budget and the scan.
- The Home Thread's `cwd` is `work/`, not `BOT_HOME`, so ordinary file tools
  have no reason to touch the memory files.
- `<project>` is `<slug>-<hash8>` of the canonical repository path, the scheme
  `deriveProjectMemoryKey` already uses, so two repositories with the same
  basename do not collide.
- Bot workspaces are never user projects: the home's `projects` row carries
  `owner_profile_id` and is filtered from every project list, picker and
  mention source.
- Deleting a bot moves `BOT_HOME` to `agents/.trash/<profileId>-<stamp>/` and
  purges it later, matching how removed projects are archived.

### 4.2 Three tiers

One model, three places to run. `isolation.tier` and `environmentId` select
the place; `projectPaths` is the repository allowlist in all three.

| | Tier 1 — host | Tier 2 — container | Tier 3 — remote |
|---|---|---|---|
| Runs on | This machine | A managed local Docker node | A paired CLI node (Mac mini, VM) |
| Boundary | OS process sandbox around tool subprocesses | The container | The machine |
| Bot can write | `BOT_HOME`, its active checkout | Mounted `BOT_HOME/work`, `BOT_HOME/projects` | That host's `BOT_HOME` and clones |
| Host credentials | Present, read-denied | Absent | Absent (the node has its own) |
| Highest permission mode | `acceptEdits` + sandbox auto-allow | `bypassPermissions` | `bypassPermissions` |
| Always-on | While the desktop is awake | While the desktop is awake | Yes, once the bot is node-resident (§4.6) |
| First release | Yes (default) | Later phase | Later phase |

#### Tier 1 — project allowlist, bot checkout, OS sandbox

**Allowlist.** The user authorizes repositories in the confirm card. A bot
session whose target is not in `projectPaths` is refused by the host before it
starts; the agent cannot widen the list except through a new confirm card.

**Bot checkout.** Project-bound work never runs in the user's main checkout
or in `~/.worktrees`. The host cuts a worktree at
`BOT_HOME/projects/<project>/<epoch>-<shortHash>` on a branch named
`bot/<slug>/<topic>`. `planNewWorktreePaths` gains a `rootDir` input and
`activateWorktree` passes it through; everything else (the repo lock,
`.superone/worktree.json` sparse and shared paths, rollback) is reused.
Bot checkouts are listed and removed under the bot, and Storage settings
counts them, but its "unused worktree" sweep of `~/.worktrees` does not own
them.

**Sandbox.** On a harness with `scopedSandbox !== 'none'` the host starts the
session sandboxed and sets:

- write roots: `BOT_HOME/work`, the active checkout, and the git paths below;
- write denials inside those roots: `USER.md`, `MEMORY.md`, `memory/`
  (memory changes go through `agent_memory` only);
- read denials: `~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.gnupg`, `~/.netrc`,
  cloud CLI config directories, browser profiles, the SuperOne database and
  credential store, and Keychain access.

Inside that boundary file edits and local commands auto-allow (Claude
`sandboxMode: 'auto'`; Codex and dsh the workspace-write preset with these
writable roots). Anything that needs to leave it still prompts: a command
retried outside the sandbox, a path outside the roots, network access the
sandbox blocks. `git push` and `gh pr create` fall in that set by
construction, because the credentials they need are read-denied. The prompt
is answered asynchronously (§7.3).

A harness with `scopedSandbox: 'none'` (OpenCode, most ACP agents) can still
be a tier-1 bot. It gets no auto-allow: every write prompts, and the confirm
card and the bot's settings say so. Tier 2 is the recommended place for it.

**The shared `.git` caveat.** A linked worktree's `.git` is a pointer file.
Its index and `HEAD` live in `<main>/.git/worktrees/<id>/`, and commits write
objects and refs into the main repository's common directory. That directory
is outside `BOT_HOME`, and it also holds `hooks/` and `config`, which execute
code on the user's next git command. So the sandbox cannot simply be "write
only under `BOT_HOME`", and it must not be "write anywhere under `.git`":

| Path under `<main>/.git` | Bot access | Why |
|---|---|---|
| `worktrees/<id>/` except `config.worktree` | write | index, `HEAD`, logs of this checkout |
| `objects/` | write | new commits; content-addressed |
| `refs/heads/bot/<slug>/`, `logs/refs/heads/bot/<slug>/` | write | the bot's own branches |
| `hooks/`, `config`, `info/`, `worktrees/<id>/config.worktree` | **deny** | code execution outside the sandbox, by the user or by the host's own git calls |
| `refs/` elsewhere, `packed-refs`, other worktrees' admin dirs | deny | the user's branches and checkouts |

The host creates the checkout, sets `gc.auto=0` for it and finishes any
sparse-checkout setup before the sandbox starts, so the bot never needs the
denied paths. Residual risk, stated plainly: write access to `objects/` allows
deleting loose objects, so a hostile process could damage the user's
repository (recoverable from the remote, not silently exploitable). Host git
calls against a bot checkout (status, diff, removal) must not trust files the
bot can write.

The stricter alternative is an **isolated clone**: `git clone --local` into
`BOT_HOME/projects/…`, with `origin` re-pointed at the real upstream. Its
`.git` is entirely inside `BOT_HOME`, the sandbox rule collapses to one root,
and nothing the bot does reaches the user's repository; the host fetches
`bot/…` branches back as an explicit delivery step. It costs the user
immediate visibility of bot branches and the `sharedPaths` links. Tier 1
starts with worktrees because they reuse the shipped worktree lifecycle and
keep bot branches reviewable in place; tier 2 uses clones (below). Whether
tier 1 should switch is open (§10.1).

**Host tools are outside the sandbox.** `terminal_*`, `computer_*`,
`browser_*`, `config_apply` and the other host-owned SuperOne tools run in the
host process and act on the user's real machine. In a tier-1 bot session they
keep their existing confirmations and are never auto-allowed; `terminal_*` in
particular would otherwise be an unsandboxed shell.

#### Tier 2 — local container node

A managed local container is an environment like any other node: it runs
`@superone/cli`, pairs with the desktop, and is addressed by `environmentId`.
SuperOne builds it from the published CLI package, not from the development
lab in `apps/cli/docker/`, which mounts the whole monorepo and enables a
password login.

- **Mounts**: `BOT_HOME/work` and `BOT_HOME/projects` read-write, nothing else
  from the host. Memory files are not mounted; `agent_memory` is a host action.
- **Repositories** are isolated clones. A linked worktree cannot be mounted
  alone, because its `.git` pointer names an absolute host path, and mounting
  the user's `.git` would hand the container the paths tier 1 denies.
- **Credentials** stay on the host (§4.4). The container has no host home, no
  SSH agent socket and no Docker socket.
- **Autonomy**: with host files and credentials absent and the container
  disposable, the user may opt into `bypassPermissions` or sandbox auto-allow
  inside it. Publishing (push, PR) remains a host-mediated, approved step,
  since the credential is not in the container.
- **Network** is the container's own; an egress allowlist is a setting of the
  managed environment.

**GUI variant.** An image with `Xvfb`, a light window manager (Openbox or
XFCE), `tigervnc` and `noVNC` gives the bot its own display, so `computer_*`
and `browser_*` work never takes the user's pointer, keyboard or browser. The
noVNC view is embeddable in the desktop for human takeover (login, CAPTCHA).
This needs work the base variant does not: a Linux adapter beside
`computer-use/platform/macos-adapter.ts`, a node-local browser backend, and
routing those host actions to the node instead of the controlling desktop's
renderer.

#### Tier 3 — dedicated remote host

The bot is bound to a paired CLI node through `environmentId`: a Mac mini, a
cloud VM, a Linux box. The machine is the boundary, so this tier carries the
highest autonomy, and it is the only one that is always on. Repositories are
that host's own clones; `projectPaths` are paths on that host.

### 4.3 Permission resolution

| Tier | Harness sandbox | Session starts with | Still prompts |
|---|---|---|---|
| host | scoped | profile mode capped at `acceptEdits`, sandbox on with auto-allow | leaving the sandbox, host tools, anything outside `projectPaths` |
| host | none | profile mode capped at `acceptEdits` (`default` where edits cannot be accepted) | every write and command the mode does not cover |
| container | any | profile mode, up to `bypassPermissions` | host-mediated actions (publish, credentials), host tools aimed at the desktop |
| remote | any | profile mode, up to `bypassPermissions` | host tools aimed at the desktop |

The cap is applied by the launch resolver, after `resolveAgentLaunchDefaults`,
so a stored or inherited mode can never exceed the tier.

### 4.4 Credential isolation

- **Model credentials.** API-key providers already sit behind a loopback proxy
  that holds the real key and hands the harness a placeholder
  (`packages/runtime/src/llm-proxy/manager.ts`, desktop
  `providers/llm-proxy-manager.ts`). For a container the same relay is exposed
  to that environment only, with a per-environment ephemeral token instead of
  the shared placeholder. Subscription logins are per environment: the user
  signs in inside the container once, and that login never leaves it.
- **Git and forge credentials** never enter a sandbox or container. Publishing
  is an approved action executed by the host.
- **MCP and other tool tokens** (later phase): a `127.0.0.1` relay on the host
  with an ephemeral, per-session token, so subprocesses and containers call
  the relay and never see the raw secret. The relay is also the audit point.

### 4.5 Tool surface in bot sessions

| Tool | Home Thread | Isolated routine |
|---|---|---|
| `agent_memory` read, add | yes | yes |
| `agent_memory` replace, remove | yes | no |
| `notify_user` | yes | yes |
| `automation_apply` for the bot's routines (existing confirm) | yes | no |
| `agent_profile_apply` on itself (existing confirm) | yes | no |
| Host tools acting on the user's machine | existing confirms | existing confirms |

Isolated routines read untrusted material (web pages, mail, issue text). They
cannot rewrite memory, change the schedule or raise a permission-widening
card. Those start only from the Home Thread.

### 4.6 Control plane and execution plane

The bot's **control plane** (profile, bot state, memory files, scheduler,
notifications) runs on the host that owns the profile: the desktop in the
first releases. The **execution plane** (harness process, `work/`, checkouts)
runs on `environmentId`. For tiers 2 and 3 the desktop creates sessions on the
node over the existing RPC, and `agent_memory` and `notify_user` come back as
host actions.

This keeps one implementation of memory governance and scheduling, at the cost
that a tier-3 bot only acts while the desktop is awake. Making a bot
**node-resident** (control plane on the node, using the runtime's own
automation service and store) is the later step that makes tier 3 always-on.
Two existing gaps block tiers 2 and 3 and are prerequisites: CLI turn runners
do not read `systemPromptAppend`, and profile authoring is desktop-only.

## 5. Threads and scheduling

### 5.1 Home Thread

- Exactly one per bot, referenced by `agent_bots.home_session_id`, created
  with the bot, with `cwd = BOT_HOME/work` and `sessions.bot_profile_id` set.
- The **Bots** sidebar group (desktop and mobile) shows one row per bot:
  avatar, name and one state (working, waiting for approval, unread, paused).
  Opening the row opens the Home Thread.
- `/new` rotates it: a new session becomes `home_session_id`; the old one
  stays readable in the bot's history. Rotation is manual in the first
  release.
- On every create **and** resume the host recomputes the append: profile
  block, bot protocol (silence, memory and notification rules), then the
  memory snapshot (§6.2). This extends what `SessionManager` already does with
  `providerSystemPromptAppend`.
- Bot-owned sessions are excluded from project session lists, settled lists
  and project mention sources. They are listed under the bot.

### 5.2 Routines

A routine is an automation that belongs to a bot. `automations` gains:

- `profile_id`: the bot. The run launches on that profile's provider row with
  its resolved defaults, instead of the harness base row. This is also the
  answer to agent-profile.md §9's question about `agentName`.
- `run_target: 'isolated' | 'home'`. `NULL` on existing rows keeps today's
  behavior.

`isolated` starts a fresh bot session per run, in `BOT_HOME/work` or, when the
routine names an allowlisted repository, in a bot checkout. `home` sends the
prompt into the Home Thread as a host-authored turn.

Bot routines are never `unattended` (§7.3), and a routine never overlaps
itself: a run parked on an approval keeps its slot, and its next due time is
skipped.

### 5.3 Heartbeat

A heartbeat is a `run_target: 'home'` routine with a checklist prompt. The
host wraps it with the time, pending digests and the instruction to end the
turn without a user-facing message when nothing needs attention.

**Busy rule: skip, do not queue.** If the Home Thread is streaming, has a
pending interaction or is in error at the due time, the heartbeat is skipped,
recorded as `skipped`, and the next due time is computed. The predicate is the
one collaboration wakes already use to decide admission
(`collaboration-wakes.ts` `canAdmit`). Queued heartbeats would pile up behind
a long turn and then fire back to back with stale context.

Heartbeat turns are tagged as host-authored (the `task-notification` source
family in `packages/shared/src/host-wake.ts` gains a bot source), so the
transcript can fold them (§7.1) and `completed` notifications ignore them.

### 5.4 Result delivery for isolated routines

When an isolated run ends, the host, not the model:

1. Appends a **Result Card** to the Home Thread: routine name, outcome,
   duration, a link to the run session. It is a host-authored transcript row
   (the `providerId: 'system'` pattern used by plugin notices and model
   fallback), visible to the user and absent from the model's context.
2. Queues a **digest** in `agent_bot_digests`: a short, bounded summary taken
   from the run's final assistant message.

The next Home Thread turn, whoever starts it, carries the pending digests in a
tagged block ahead of its input, and they are marked delivered. The Home Bot
is **not** woken to read a result. This is the deliberate difference from
collaboration wakes, which start a turn: a bot with twenty routines would
otherwise spend its day acknowledging itself.

Digests are data from a session that may have read untrusted content. They
are size-capped, wrapped as quoted data, and pass the same injection scan as
memory (§6.3); a flagged digest is replaced by a line telling the Home Bot to
open the run instead.

### 5.5 Awake time and the Dark Wake guard

macOS wakes briefly with the lid closed (Dark Wake, Power Nap). A 30-second
poll that fires in such a window starts a routine the machine then suspends
mid-turn, and wall-clock timeouts keep running while it sleeps.

A host **awake clock** fixes both:

- Routines and heartbeats start only when the system is fully awake. A tick
  that fires in a maintenance wake does nothing.
- Deadlines for bot work count **awake time**: the approval TTL (§7.3), turn
  timeouts and stall detection do not advance while the machine sleeps, so a
  closed laptop never times out a run or auto-denies an approval.
- After a full wake, a routine that came due while asleep runs **once**, not
  once per missed slot. A heartbeat that came due while asleep is dropped and
  waits for its next slot.

This guard does not override the user's sleep policy. With
`powerMode: 'prevent-idle-sleep'` or `'lid-closed-on-ac'` the machine is
genuinely awake, and routines run.

## 6. Memory

### 6.1 `agent_memory`

```ts
agent_memory({
  action: 'read' | 'add' | 'replace' | 'remove',
  target: 'user' | 'memory',
  content?: string,   // add, replace
  match?: string,     // replace, remove: unique substring of one entry
})
```

- **Host-owned.** Registered only for bot sessions and resolved from the
  session's `bot_profile_id`, never from `cwd`, so it works identically in the
  Home Thread, in a bot checkout and from a container.
- **No confirm card.** Memory writes are frequent and low-stakes one at a
  time; the safeguards are the governance pipeline and undo, not a prompt.
- `user` → `USER.md` (who the user is, preferences, standing instructions).
  `memory` → `MEMORY.md` (what the bot learned about its job and environment).
- Entries are delimited blocks. Each file has a hard cap, and the two caps sum
  to the injection budget, so the snapshot is always the whole memory. An
  `add` that would exceed the cap fails and tells the agent to consolidate.
  Nothing is truncated silently.

Separate from the existing interaction memory (`browser_memory_*` and
friends): that stores per-target playbooks in OKF topic bundles and remains
available to bot sessions. Bot memory is the bot's own identity and working
knowledge, two small files that are always in the prompt.

### 6.2 Frozen snapshot

At session create and resume the host reads both files, scans them (§6.3) and
appends them to `systemPromptAppend` in a tagged block, up to
`injectBudgetChars` (default 8,000). The snapshot is then **frozen** for that
launch: a write during the session changes the file and is reported in the
tool result, but does not rewrite the system prompt. A prompt that changed on
every memory write would invalidate the provider's prompt cache on every such
turn of a thread meant to live for weeks.

### 6.3 Governance

Every write passes, in order:

1. **Shape and size**: target cap, entry length, plain text.
2. **Injection scan**: instruction-like and role-impersonating text, hidden or
   bidirectional characters, tag forgery of SuperOne's own prompt blocks,
   exfiltration-shaped URLs. A flagged write is refused with the reason.
3. **Secret redaction**: key and token shapes, private key blocks,
   high-entropy strings. Redacted in place and reported to the agent; a secret
   never reaches a file that is injected into every future prompt.
4. **Duplicate check**: an entry that already exists is a no-op.
5. **Destructive-change guard**: `replace` and `remove` must match exactly one
   entry, and one call cannot remove more than one entry or shrink a file past
   a bound. Clearing memory is a user action in Settings.
6. **Backup**: the previous file is copied to `memory/.history/` before the
   write, with bounded retention.
7. **Atomic write**, then an audit row in the transcript.

The scan also runs **at injection**, because the files can be edited by hand
or by a process outside the pipeline: a flagged entry is left out of the
snapshot and reported. On tier 1 the sandbox denies the agent direct writes to
the memory files, so the pipeline is the only path; where no sandbox exists,
the injection-time scan is the backstop.

Settings shows each bot's memory, lets the user edit it, and restores any
`.history` version. That is the undo.

Open point: a harness's own auto-memory (Claude Code keeps one per `cwd`)
would run beside this one in a bot session (§10.8).

## 7. Silence, notifications and permissions

### 7.1 Silent by default

- A bot turn the user did not start raises no `completed` notification.
- A heartbeat turn that neither notified nor changed anything folds into one
  compact row in the Home Thread, and consecutive quiet heartbeats collapse
  into a count.
- There are no `[SILENT]` or similar text tokens. Whether the user is
  interrupted is decided by a tool call, which the host can validate, rate
  limit and audit.

### 7.2 `notify_user` and `NotificationKind: 'agent'`

```ts
notify_user({ title?: string, body: string, urgency?: 'normal' | 'high' })
```

- Registered only in bot sessions.
- Becomes a `NotificationIntent` of the new kind `'agent'`, with its own
  opt-out next to the six existing kinds in `NotificationSettings`.
- The banner's title is the bot's name, set by the host; the agent's `title`
  becomes the first line of the body. A bot cannot produce a banner that
  claims to be SuperOne or another bot. Text is plain and length-capped.
- This is the one kind whose body is model-written. The existing kinds use a
  fixed status precisely so that request content never reaches an OS banner;
  `'agent'` departs from that on purpose and is why it has a separate switch
  (§10.9).
- **Deep link**: always the bot's Home Thread, also when an isolated routine
  called the tool. A matching row is appended to the Home Thread, so the user
  lands on what the banner said.
- **Focus and phone**: the service's "suppress while focused or a phone is
  online" rule would lose these, since unlike a permission prompt nothing is
  left pending on screen. An `'agent'` intent that is not shown as a banner
  marks the bot's sidebar row unread instead.
- **Rate limit** per bot, in the host: a small hourly allowance for `normal`,
  a separate daily one for `high`. Over the limit, the call still records the
  row in the Home Thread and returns a result telling the agent it was not
  pushed.

### 7.3 Attended-async permissions

Today a session is either attended (prompts wait forever) or `unattended`
(prompts are denied at once). A bot needs a third behavior: **someone will
answer, later.**

- Bot sessions are never created with `unattended`. A prompt parks the run in
  the existing permission waiter; there is no second permission path.
- The existing `permission`, `confirm`, `question` and `plan` notifications
  fire as they do now and deep-link to the session that asked. The bot's
  sidebar row shows "waiting for approval", and a Home Thread row links to
  the request.
- **24 h TTL, in awake time.** When it expires the host denies the request
  through the normal deny path, with a message the model can act on, and
  raises a failure notice (`'agent'` kind) plus a digest.
- The same applies to host confirmations raised inside a tool, which settle
  through `HostConfirmRegistry`.

Reach on mobile: there is no push channel yet. A phone sees a pending approval
only while it holds a live connection, through the existing permission sheet.
An APNs/FCM channel behind `NotificationChannel` is a dependency of the
"approve from anywhere" promise, not part of the first release (§10.5).

## 8. Surfaces

- **Create and edit**: by asking any agent, which calls `agent_profile_apply`.
  The confirm card gains the bot section: avatar, tier with its plain-language
  consequence, repository allowlist, memory toggle. Widenings are highlighted.
- **Sidebar**: the Bots group above projects, desktop and mobile.
- **Bot page** (Settings → Agent → Bots): routines, activity (routine runs,
  earlier Home Threads), memory with history, checkouts, pause, delete.
- **Chat**: Result Card, folded heartbeat row, notification row, memory audit
  row, in the shared `packages/chat-view` presenters so desktop and mobile
  render them alike.
- Everything is behind an experimental setting that requires
  `experimentalAgentProfilesEnabled`.

## 9. Phases

1. **Foundations**: spikes (sandbox scoping per harness, full-wake signal);
   contract and state; home workspace; Home Thread; desktop Bots group.
2. **Memory**: `agent_memory`, governance, snapshot, Settings undo.
3. **Routines**: `profile_id` / `run_target`, heartbeat with the busy rule,
   Result Card and digest, awake clock.
4. **Silence and async approvals**: `notify_user`, `'agent'` kind, folded
   heartbeats, 24 h TTL.
5. **Tier 1 isolation**: allowlist, bot checkouts, scoped sandbox, the
   permission cap.
6. **Mobile parity**: Bots group, bot rows, approvals.
7. **Tier 2**: managed container environment, clones, model-credential relay;
   then the GUI variant.
8. **Tier 3**: remote binding; node-resident bots for always-on.
9. **Later**, each with its own proposal:
   - a credential and MCP loopback relay with ephemeral tokens (§4.4);
   - **channel lanes**: Slack, Telegram or Discord conversations routed into
     per-channel side threads, never into the Home Thread, each lane with its
     own trust level;
   - **webhook triggers** with JSON Pointer pre-filtering, so the host drops
     irrelevant events before a model sees them;
   - a **policy and audit gateway**: one place every outbound side effect
     passes, with rules and a log.

Until phase 5 a bot works only in `BOT_HOME`, with no access to user
repositories.

## 10. Open questions

1. **Worktree or clone on tier 1.** Worktrees reuse the shipped lifecycle and
   keep bot branches visible in the user's repository, but need the sandbox to
   reach into the user's `.git` and leave `objects/` writable. Clones give a
   one-root boundary and make all three tiers identical, at the cost of an
   explicit fetch-back step. Proposed: ship worktrees, settle after the
   phase-0 sandbox spike shows whether each harness can express the path
   table in §4.2. If one cannot, clones become the default.
2. **Network egress on tier 1.** The sandbox can restrict domains on some
   harnesses. Proposed: inherit the harness default first, add a per-bot
   allowlist with tier 2.
3. **Bots on harnesses without a scoped sandbox.** Proposed: allowed on tier 1
   with an explicit "every write prompts" state, rather than refused.
4. **`config.profile.bot` or a sibling `config.bot`.** The sibling keeps the
   profile readable on older builds; the nested form keeps one spec, one card
   and one fingerprint. Proposed: nested, given the row survives a downgrade
   unchanged.
5. **Mobile push.** Async approval is weak without it. Does the relay hold
   push tokens, and is it scheduled with phase 4 or phase 6?
6. **Home Thread growth.** Manual `/new` only, or host-suggested rotation at a
   context threshold, reusing [session continuation](../features/session-continuation.md)?
7. **Memory writes from isolated routines.** Proposed: read and add only.
   Is add still too much for routines that read mail or the web?
8. **Harness-native memory.** Disable it in bot sessions where the harness
   allows, or let both run and instruct the bot to use `agent_memory`?
9. **Model-written notification bodies.** Lock-screen privacy and prompt
   injection reaching a banner. Is a per-bot "titles only" mode needed?
10. **Missed routines.** Run once after wake regardless of age, or drop a run
    older than a per-routine window?
11. **Budget.** A heartbeat every 30 minutes is a standing cost. Minimum
    interval, a per-bot daily spend cap that pauses the bot, or both?
12. **Bots as collaborators.** A bot profile is `@`-mentionable like any
    profile. Proposed for the first release: bot profiles are left out of
    `session_collab_list_agents`, since a collaboration child has no Home
    Thread and its memory semantics are undefined.
13. **Publishing.** Is "retry outside the sandbox, approved" enough for push
    and PR creation, or should the first release ship a structured host
    action that shows the branch, the diff summary and the destination?

## 11. Prior art

The design draws on two families of existing bots, without depending on either:
auditable memory governance, the awake-time guard and the loopback credential
relay follow Orca Bot's approach; channel lanes, webhook pre-filtering and the
policy gateway follow OpenBot (`nightly-labs/openbot`, `CopilotKit/OpenBot`).
