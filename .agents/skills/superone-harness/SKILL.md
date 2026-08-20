---
name: superone-harness
description: "Integrating a NEW coding-agent harness into SuperOne, or extending an EXISTING harness's integration (claude, codex, acp/grok, opencode, cursor, dsh/deepseek). Use only when the task is scoped to a harness as a whole: adding a harness or provider CLI/SDK, implementing or changing a SessionBackend, mapping provider events onto AgentEvent, registering a harness id across its layers, or closing a per-harness capability gap — 'give OpenCode a sandbox toggle', 'Grok shows no models', 'this works in Claude but not Codex', 'audit which experiences harness X is missing', 'what would it take to support harness Y'. Do NOT use for ordinary work on a file that merely happens to be per-harness (restyling ModelSelector, fixing a tooltip in the permission popover, renaming a token, a bug inside one existing backend that isn't about harness coverage), and do NOT use for adding an API provider / credential / model endpoint to an existing harness — that path never touches harness code."
---

# Integrating a Harness into SuperOne

A harness is not a backend class. It is **one identity that has to be re-declared on ~40 surfaces** —
main-process runtime, renderer store, chat bar, sidebar icon, settings catalog, usage page, remote
node, packaging. Most of those surfaces are `if (provider === 'claude')`-style enumerations that
TypeScript will never complain about. So the failure mode is never a crash: it's a harness that
launches fine but silently has no model picker, no sandbox toggle, no icon, and an empty usage row.

Cursor took **152 files across 7 commits** to go from skeleton to parity. DeepSeek later confirmed
the same pattern: the runtime can work while presentation and persistence still silently reject its
identity. Almost none of that work is the backend; most is re-declaring one id everywhere else.

The job, therefore, is not "write an adapter". It is **make the compiler enumerate everything it
can, then walk a checklist for everything it can't.**

## The one trick that makes this tractable

There are exactly two type-enforced seams. Land them **first** and the compiler hands you a free
worklist:

1. **`HarnessResourcesMap`** in `packages/shared/src/agent-types.ts` — `HarnessId` is literally
   `keyof HarnessResourcesMap`. Add your key and every `Record<HarnessId, …>` goes red immediately:
   `HARNESS_CAPABILITIES`, `HARNESS_DEFAULT_BRAND_HUE`, `HARNESS_DEFAULT_TOKENS`,
   `HarnessHandlerMap`, `useAppStore.{brandHues,tokenOverrides}`,
   `BrandColorPopover.HARNESS_LABEL`, plus `createHarnessRunner` (a `switch` with a `never`
   exhaustiveness guard).

   Note what does **not** break: `StartupData.cached` is a plain interface with optional per-harness
   fields, so it accepts your new harness silently by omitting it. Same for every
   `if (provider === …)` chain. The compiler's worklist is a floor, not a ceiling.
2. **`SessionBackend`** in `apps/desktop/src/main/session/types.ts` — the required members are the
   real contract. Optional members (`setTitle?`, `getRateLimits?`, `stopTask?`,
   `injectTaskNotification?`, `requestSessionRecap?`) are the honest "this harness can't do it"
   escape hatch — prefer leaving one out over stubbing it with a lie, because callers already
   feature-detect.

Everything *outside* those two seams is a silent enumeration. That's what
`references/experiences.md` exists for.

## Which route are you on?

| You are… | Read |
|---|---|
| Adding a brand-new harness | `references/new-harness.md` — phased roadmap P0→P5, each phase with its file list and a "you can stop here and ship" acceptance bar |
| Bringing one harness up to parity on a feature ("give OpenCode a sandbox toggle", "Grok has no usage row") | `references/experiences.md` — per-experience touchpoint tables; find your row, do every cell |
| Making the chat UI light up (nothing renders / renders wrong) | `references/event-contract.md` — which `AgentEvent` unlocks which UI, and what the store expects |
| Auditing a harness for gaps | `references/experiences.md` support matrix, then grep the harness id across the touchpoint columns |

## Reference implementations — copy from the right one

The integrations are not equally mature, and they solve *different* shapes of problem. Picking
the wrong model to copy costs more than starting from scratch.

| Harness | Shape | Copy it when your provider… | Entry point |
|---|---|---|---|
| **Claude** | In-process TS SDK, richest surface | is an SDK you `import` and drive with an async generator | `apps/desktop/src/main/session/backends/claude-backend.ts`, `packages/claude/` |
| **Codex** | Spawned binary, JSON-RPC app-server protocol | ships a CLI binary speaking a line protocol | `apps/desktop/src/main/session/backends/codex-backend.ts`, `apps/desktop/src/main/codex/app-server-client.ts` |
| **Grok (ACP)** | Standard protocol, N agents behind one harness id | speaks ACP, or you want *many* agents under one id | `apps/desktop/src/main/session/backends/acp-backend.ts` |
| **OpenCode** | External server/SDK with its own event stream | exposes an SDK plus a long-lived local server | `apps/desktop/src/main/session/backends/opencode-backend.ts`, `packages/opencode/` |
| **Cursor** | Native SDK + local store, newest and most complete-in-one-pass | is an SDK with its own session store/auth | `apps/desktop/src/main/session/backends/cursor-backend.ts`, `packages/cursor/` |
| **DeepSeek** | In-process Cordis service tree + official adapter | is a plugin graph whose agent loop, persistence, credentials, and adapter are mounted in-process | `apps/desktop/src/main/deepseek/deepseek-runtime-host.ts`, `packages/deepseek/` |

For **breadth of touchpoints**, read the Cursor integration's git history —
`git log --name-only c1242119^..0784584c` is the most complete single worked example in the repo,
and `docs/design/cursor-sdk-harness.md` is its design pack (decisions D1–D8).

For **depth of a single experience**, read Claude's backend — it is the only one that implements
every optional member, so it doubles as the spec.

Note on ACP: `acp` is *one* `HarnessId` hosting many agents (`grok-build`, `opencode`, …), keyed by
`acpAgentId`. That's why so many call sites take `(provider, acpAgentId)` as a pair, and why
`isGrokAcpAgent()` from `@superone/shared/acp-brand` appears in icon/ordering/visibility code. If
your provider already speaks ACP, adding an agent id is dramatically cheaper than a new harness id —
check that first before opening `harness-registry.ts`.

## The four layers

Work top-down. Each layer is useless without the one above it, and the checklist in
`references/new-harness.md` is ordered so you always have something runnable.

```
① 契约层  packages/shared/          HarnessId · resources · capabilities · brand · i18n · install catalog
② 运行层  apps/desktop/src/main/    SessionBackend · event mapper · auth · fork · runtime resolve
③ 状态层  renderer/stores/chat-store/  HarnessHandler · PerSessionState · routing switches
④ 表现层  renderer/components/      model/permission/sandbox selectors · icon · suggestions · settings
⑤ 外围    apps/cli · packages/runtime · mobile · electron-builder · usage
```

Layer ⑤ is genuinely optional for a first cut, and saying so out loud is part of the job: a harness
that works locally but not on a remote node is a legitimate shipping state (OpenCode and Cursor both
shipped that way). Don't let it block P3.

## SuperOne host-owned tool permissions

Treat permission as **two independent layers**, not one low/medium/high ladder. A tool such as
`config_apply` must be admitted automatically by the harness so its own executor can run, while the
executor must still park before the effect and ask the user. "Harness allowed the call" never means
"the product authorized the effect."

### Layer A — harness admission

Classify the tool identity before the harness's permission classifier:

| Class | Harness behavior | Source / examples |
|---|---|---|
| **Static host-owned** | Pre-allow by exact tool name | `STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES`: built-ins, `mobile_share_file`, `miniapp_list`, `miniapp_call` |
| **Feature-gated host-owned** | Recognize always; pre-allow only while enabled | `computer_*` |
| **Dynamic / third-party** | Use normal harness permission or an args-aware preapproval; never blanket-allow | mini-app `slug__tool`, third-party MCP |

The source of truth is `packages/shared/src/superone-host-owned-tools.ts`. Do not copy its names into
a backend. Do not approve the entire `superone` server or `mcp__superone__*`: dynamic third-party
tools may share that namespace. `miniapp_call` is safe to admit as a fixed host dispatcher because
the executor separately authorizes the requested `appId + tool` before dispatch.

Apply the exact static set **upstream of any auto-review/classifier**, then retain the shared
predicate as a downstream backstop. Current integration shapes are:

| Harness shape | Upstream admission |
|---|---|
| Claude Agent SDK | `allowedTools` with qualified names; keep `canUseTool` fallback |
| Codex app-server | `mcp_servers.superone.tools.<bare>.approval_mode = "approve"`; keep elicitation fallback |
| ACP / Grok | Resolve `session/request_permission` through the shared preapprove decision |
| OpenCode | Generate exact `permission: superone_<bare>, action: allow` rules |
| Other SDKs | Use their exact per-tool allow mechanism; if none exists, intercept their permission request before UI |

Codex snapshots `tools/list` once and ignores `list_changed`, so register the whole fixed surface
before its first handshake. Never solve this by changing to a server-wide approval default.

### Layer B — product authorization inside the executor

The executor, not the harness, owns authorization for destructive, paid, autonomous, or
third-party effects. These tools may still be Layer-A host-owned and pre-allowed. They must emit a
host `permission_request` through `HostConfirmRegistry`, wait for the answer, and perform no effect
before approval. `Session.respondToPermission` must resolve these host confirms before forwarding an
unknown request to `backend.respondToPermission`, which makes the path harness-independent.

See the `superone-tool` skill, **Step 3 — Permission**, for the executor-side rules. In particular:

- pass the turn `AbortSignal` so cancel/timeout removes the prompt;
- set `allowAlwaysAllow: false` for delete, spend, and spawn operations;
- return a neutral rejected/cancelled result and tell the model not to retry;
- allow scoped persistence only when the grant key is precise, such as mini-app `appId + tool`.

### Main-thread and remote-node invariants

Check main-thread-only tools (`session_rename`, `session_tag`) **before** any auto-allow. A subagent
must receive a direct denial even if it inherits the parent's MCP connection or allow rules.

Remote-node wiring is a separate implementation of the same contract: inject the host-action MCP,
apply the same exact static admission set in every node harness, preserve args-aware preapproval,
and route host confirmation events and responses through the session runtime. Desktop parity does
not imply node parity.

### Permission acceptance tests for every harness

Before calling a harness integrated, prove all of these:

1. Static host-owned sentinels are present in its upstream allow configuration.
2. `computer_*` is absent while disabled and allowed only while enabled.
3. A dynamic mini-app/third-party tool is not admitted by prefix or server default.
4. The downstream permission callback still auto-allows a host-owned call without UI.
5. A child session cannot call a main-thread-only tool.
6. Decline, cancel, timeout, and abort of an executor-owned confirm perform no effect and clear UI.
7. The same behavior works on desktop and remote node when remote support is in scope.

## How to know you're done

Type-checking passing means almost nothing here — it only covers seam #1. Use behaviour instead:

1. **`bun run typecheck`** — clears the enforced seams.
2. **Grep audit** — `rg "'claude'" --type ts apps/desktop/src/renderer apps/desktop/src/main | rg -v test`
   then check each hit for whether your harness belongs there. Tedious, but it is the only reliable
   sweep, and `references/experiences.md` pre-groups the hits so you can do it by feature instead of
   by file.
3. **Manual pass** — start a session on the new harness and walk the chat bar left to right: model
   picker, effort/mode, permission popover, sandbox, context gauge, slash popup, `@` mentions. Each
   control that is missing or inert maps to exactly one row in `references/experiences.md`.
4. **Tests** — follow `apps/desktop/CLAUDE.md` (integration-first). The highest-value harness tests
   are backend event-mapper tests (`*-event-map.test.ts` / `agent-event-mapper.test.ts`, table-driven
   over recorded provider payloads) and store-routing tests
   (`chat-store/harness/*-handler.test.ts`, `helpers/session-lifecycle.test.ts`). Both catch the
   silent-drift class; unit-testing the backend class does not. Also extend
   `app-settings-service.test.ts` with the new id in `harnessOrder`: read, save, default/secondary
   derivation, and round-trip persistence. That is the test that catches a drag order snapping back.

## Recurring traps

These have each cost a real debugging session. They are ordered by how often they recur.

- **Capability flag lies.** `HARNESS_CAPABILITIES[x].supportsTodos = true` renders the TODO panel
  whether or not your backend ever emits `todos_updated`. Flip a flag on only when the event is
  actually wired, and leave the comment explaining what's still missing (see the `acp` entry — it
  documents its own gaps).
- **Permission mode names are per-harness, but `PermissionMode` is shared.** Each harness maps the
  shared enum onto its own vocabulary (Codex → presets, Cursor → its own modes, OpenCode → its list).
  Wire `HarnessPermissionPopover` *and* `StatusBarPermission` *and* the mode list module, or the bar
  and the popover will disagree with each other.
- **Sandbox is a separate axis from permission.** `sandboxHarness.ts` decides whether the control
  exists at all and which modes are offered. A harness that folds sandbox into permission (Codex)
  must return `false` there, not offer a dead toggle.
- **Renderer defaults vs main-process defaults drift.** Default model/permission/effort are chosen in
  `chat-store/helpers/session-lifecycle.ts` (per-provider branches) *and* defended in the backend.
  If they disagree, the first turn silently uses one and the UI shows the other.
- **Icons and brand hue are three separate registries.** `resolveSessionIcon`,
  `resolveSessionIconFromBrandKey` (profile/brandKey path), and `HARNESS_DEFAULT_BRAND_HUE` +
  `HARNESS_DEFAULT_TOKENS`. Missing the brandKey variant is the classic "icon works in the sidebar
  but not in the session profile" bug. Before drawing a placeholder, check `@lobehub/icons` for the
  official mono/color/text assets. If `packages/ui` imports it, declare the dependency in that
  package; wrap the official static mark with `HarnessIconFallback` for session status chrome.
- **Every harness needs an `agentPreference` slot, even with nothing to store.** The palette
  popover writes `brandHue` / `tokenOverrides` per harness, but `AppSettings['agentPreference']`
  used to list only the harnesses that had *other* settings. For the rest the failure was silent
  and looked like the feature was broken rather than missing: the store updated and the theme
  visibly changed, the sanitizer then dropped the unknown key on write, and the
  `APP_SETTINGS_CHANGED` broadcast rebuilt `brandHues` with a hard-coded `null` — so the slider
  snapped back a moment after you moved it. Add a `BrandOnlyAgentPreference` slot in
  `agent-types.ts` (plus the optional key on `SaveAppSettings`), defaults + both assembly sites +
  the save-merge branch in `app-settings-service.ts`, and read it in **both** `loadBrandHues` and
  the `onAppSettingsChange` handler in `stores/app.ts`. DeepSeek, Cursor and OpenCode all shipped
  without one. The `it.each` invariant in `app-settings-service.test.ts` now fails loudly instead.

- **Ordering has a second, main-process allowlist.** The renderer can display and drag a new harness
  while `app-settings-service.ts` still rejects its key in `HARNESS_IDS`,
  `parseSuggestionHarnessKey`, `isHarnessOrderKey`, or `readHarnessOrder`. The save result and
  `APP_SETTINGS_CHANGED` event then overwrite the optimistic UI with the filtered order, which looks
  like DnD randomly reverted. Add every new harness to the parser and test a full read/save round
  trip; Cursor and DeepSeek both exposed this drift.
- **Chat input defaults can impersonate Claude.** A final `default` branch in placeholder or slash
  command dispatch makes every newly added `HarnessId` silently inherit Claude copy, commands, and
  skills. Define both dispatches as exhaustive `Record<ChatProvider, ...>` maps, give the new harness
  its own localized ask/plan keys, and use an explicit empty slash catalog when the harness supports
  none. Add regression tests for both modes and catalog identity; the absence of a compiler error is
  otherwise exactly how this ships repeatedly.
- **A Harness is not automatically a SessionProvider.** Creating a session selects a persisted
  `provider_id`, and `sendMessage()` resolves that row before it ever reaches the backend. A missing
  base row produces `SessionProvider not found: <harness>-base` even when the registry, picker, and
  backend are correct. Add the harness to the exhaustive
  `packages/shared/src/session-provider-definitions.ts` catalog; use that catalog for desktop and
  runtime/CLI seeds and for legacy provider-to-harness derivation. If an id changes, migrate both
  `session_providers` and existing `sessions`, and preserve a read alias for old persisted values.
- **The install catalog uses different ids than sessions.** `NodeHarnessId` (`acp-grok`) ≠ `HarnessId`
  (`acp`). Always convert via `normalizeSessionHarnessId` / `nodeHarnessIdToSessionHarnessId` in
  `packages/shared/src/environment/harness-installation.ts` — never string-compare across the two.
- **The settings list is another silent catalog.** `HarnessesSettingsPage.tsx` must map every
  `NodeHarnessId` to provider, label, description, experimental state, and optional config provider.
  Prefer an exhaustive `Record<NodeHarnessId, CatalogHarnessMeta>` generated over
  `NODE_HARNESS_IDS`; a hand-written array let new harnesses disappear without a type error.
- **Visibility fails closed.** `harness-visibility.ts` treats a null catalog as "not enabled" on
  purpose, so a harness missing from `NODE_HARNESS_DEFINITIONS` is invisible everywhere with no
  error. If your new harness never appears in any picker, check the catalog before the store.
