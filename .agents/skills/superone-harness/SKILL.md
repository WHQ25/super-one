---
name: superone-harness
description: "Integrating a NEW coding-agent harness into SuperOne, or extending an EXISTING harness's integration (claude, codex, acp/grok, opencode, cursor, dsh/deepseek). Use only when the task is scoped to a harness as a whole: adding a harness or provider CLI/SDK, implementing or changing a SessionBackend, mapping provider events onto AgentEvent, registering a harness id across its layers, or closing a per-harness capability gap — 'give OpenCode a sandbox toggle', 'Grok shows no models', 'this works in Claude but not Codex', 'audit which experiences harness X is missing', 'what would it take to support harness Y'. Do NOT use for ordinary work on a file that merely happens to be per-harness (restyling ModelSelector, fixing a tooltip in the permission popover, renaming a token, a bug inside one existing backend that isn't about harness coverage), and do NOT use for adding an API provider / credential / model endpoint to an existing harness — that path never touches harness code."
---

# Integrating a Harness into SuperOne

Do not write a UI per harness. Translate the provider protocol into `AgentEvent`, then inject
SuperOne's own tools into that runtime. A missing experience is first "which event did I not
emit?", then "which silent enumeration omitted this id?".

A harness is not a backend class. It is **one identity re-declared on ~40 surfaces** — runtime,
store, chat bar, icon, settings, usage, remote node, packaging. Most of those are
`if (provider === 'claude')` chains TypeScript will never see. The failure mode is not a crash:
the harness launches, and silently has no model picker, no MCP tools, no icon, and an empty
usage row.

The job is not "write an adapter". It is **make the compiler enumerate everything it can, then
walk the Claude / Codex / Grok bar for everything it can't.**

## Completeness standard

**Claude, Codex, and Grok (ACP `grok-build`) are the bar.** A harness is "integrated" when it
matches what those three share — not when it matches Claude's extras, and not when Cursor's
152-file landing is copied blindly.

Walk the chat bar left to right. Each control is either correct or **explicitly off**. Never
inherit Claude placeholder, slash catalog, or skills via a `default` branch.

### Required (all three have these)

1. One turn: streamed text → `message_complete` / `message_error` / `message_interrupted`; cold
   resume via persisted `provider_session_id`.
2. HITL: `permission_request` approve/deny; `getPendingInteractions()` replays unanswered prompts.
3. Permission-mode selector: map shared `PermissionMode` onto the provider's own words; wire
   **popover + status bar + mode list** together.
4. Plan mode: approve *and* reject both change what happens next. Claude is host-driven
   (`permissionMode: 'plan'`). Codex and Grok are agent-driven (`exit_plan_mode`).
5. **SuperOne host tools injected, admitted, and rendered as existing ToolBlocks** — not a grey
   `use tool` row. This is the product. A chat-only harness is not done.
6. Own model selector (effort picker only if the provider has effort).
7. Own slash catalog (explicit empty list if none — never Claude's).
8. Session cwd / worktree actually reaches the provider process (Grok binds cwd at `session/new`).
9. Icon, brand hue, settings page, Usage row (`HarnessKind`, not `HarnessId`), en+zh i18n.
10. Clean interrupt; queued-message behaviour matches the provider protocol.

File-level touchpoints for each row: `references/experiences.md`. Minimum event set:
`references/event-contract.md`.

### Allowed to differ (do not fake)

| | Claude | Codex | Grok |
|---|---|---|---|
| Todos | yes | no | plan entries → todo UI |
| Subagents | yes | no | no |
| Sandbox toggle | off/on/auto | folded into permission presets → selector returns `false` | none |
| Compact | yes | yes | no |
| Recap | no | no | Grok extension |
| Mid-turn steer | — | yes | queue only |

Flip `HARNESS_CAPABILITIES` only after the event is actually wired. Codex having no sandbox
control is a deliverable, not a gap.

### Copy from the matching one of the three

| | Shape | Copy when the provider… | Entry |
|---|---|---|---|
| **Claude** | In-process TS SDK, richest `SessionBackend` | is an SDK you `import` and drive with an async generator | `claude-backend.ts`, `packages/claude/` (event map is the spec) |
| **Codex** | Spawned binary, JSON-RPC app-server | ships a CLI speaking a line protocol | `codex-backend.ts`, `app-server-client.ts` |
| **Grok (ACP)** | One `HarnessId=acp`, many agents via `acpAgentId` | already speaks ACP | `acp-backend.ts`, `apps/desktop/src/main/acp/` |

If the provider already speaks ACP, add an agent id (`agent-catalog.ts` + `acp-brand.ts`) — do
not open `harness-registry.ts`. Grok was an ACP agent; Cursor was a harness.

OpenCode, Cursor, and DeepSeek are later / incomplete against this bar — see
[Appendix](#appendix) when auditing them, not when choosing what to copy.

## Which route are you on?

| You are… | Read |
|---|---|
| Adding a brand-new harness | `references/new-harness.md` — P0→P5 file lists. Host SuperOne tools are part of **P2**, not polish. |
| Closing one experience gap | `references/experiences.md` — do every cell in that row |
| Chat UI blank / wrong | `references/event-contract.md` |
| Auditing a harness | The required list above, then the support matrix in `experiences.md` |

## The two type-enforced seams

Land these **first**. The compiler's worklist is a floor, not a ceiling.

1. **`HarnessResourcesMap`** in `packages/shared/src/agent-types.ts` — `HarnessId` is
   `keyof HarnessResourcesMap`. Adding a key turns every `Record<HarnessId, …>` red:
   `HARNESS_CAPABILITIES`, brand maps, `HarnessHandlerMap`, `createHarnessRunner`, …
   `StartupData.cached` and every `if (provider === …)` do **not** go red.
2. **`SessionBackend`** in `apps/desktop/src/main/session/types.ts`. Optional members
   (`setTitle?`, `getRateLimits?`, `requestSessionRecap?`, …) are the honest "this harness
   cannot" hatch — leave them off rather than stubbing a lie.

Everything outside those two seams is a silent enumeration. That is `experiences.md`.

Silent catalogs that have each shipped a "works except it doesn't" bug: `<id>-base` in
`session-provider-definitions.ts`, `NODE_HARNESS_DEFINITIONS`, `harnessOrder` allowlists,
`agentPreference.<id>`, placeholder and slash `Record<ChatProvider, …>` with no `default`.

## Layers

Work top-down. `references/new-harness.md` is ordered so something is always runnable.

```
① contract   packages/shared/            id · resources · capabilities · brand · i18n · install
② runtime    apps/desktop/src/main/      SessionBackend · event mapper · auth · fork
③ store      renderer/stores/chat-store/ HarnessHandler · PerSessionState
④ chrome     renderer/components/        selectors · icon · slash · settings
⑤ periphery  cli · runtime · mobile · packaging · usage
```

⑤ is optional for a first ship — say so. Claude and Codex binaries update with the CLI;
Grok is user-installed under `NodeHarnessId` `acp-grok` (not `acp`).

## Host SuperOne tools

SuperOne's built-in tools are the product surface that must exist on every complete harness.
Injection, admission, and ToolBlock mapping are three separate jobs. Permission is **two
independent layers**, not one low/medium/high ladder: harness-allowed ≠ user-authorized.

### 1. Inject

The agent must actually see the `superone` server.

| | How it is attached | Files |
|---|---|---|
| **Claude** | SDK `mcpServers.superone = createSuperoneMcpServer(sessionId)` | `M/agent/claude-query.ts` |
| **Codex** | Thread config `mcp_servers.superone` (HTTP). Snapshot of `tools/list` is **once** — register the whole fixed surface before handshake. Never "solve" this with a server-wide approval default. | `packages/codex` thread config; HTTP helper in `M/mcp/` |
| **Grok** | `session/new` via `buildSuperoneAcpMcpServer` (HTTP if the agent advertises it, else stdio) | `M/acp/acp-mcp.ts` |

### 2. Admit (Layer A) — exact names, upstream of any classifier

| Class | Behavior | Source |
|---|---|---|
| Static host-owned | Pre-allow by **exact** qualified name | `STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES` |
| Feature-gated host-owned | Recognize always; pre-allow only while enabled | `computer_*` |
| Dynamic / third-party | Normal harness permission; never prefix-allow | mini-app `slug__tool`, third-party MCP |

Do not copy the name list into a backend. Do not approve the whole `superone` server or
`mcp__superone__*`. `miniapp_call` is a fixed dispatcher; the executor still authorizes
`appId + tool`.

| | Upstream admission |
|---|---|
| Claude | `allowedTools` with qualified names; keep `canUseTool` fallback |
| Codex | `mcp_servers.superone.tools.<bare>.approval_mode = "approve"`; keep elicitation fallback |
| Grok / ACP | `session/request_permission` through the shared preapprove decision |

### 3. Render as existing ToolBlocks

ACP tool-call kinds, Codex tool names, and Claude tool names must map onto the ToolBlocks
chat already has (edit diff, bash stdout, AskUserQuestion, widget, …). A successful MCP
call that paints `use tool` is not done. Mapping lives in the event mapper
(`packages/claude/src/agent-event-mapper.ts`, Codex mapper, `M/acp/acp-event-map.ts`) plus
`packages/shared/src/tool-ui.ts`. Per-file cells: `experiences.md` §7.

### 4. Authorize the effect (Layer B)

Destructive, paid, autonomous, or third-party effects still park in the **executor** via
`HostConfirmRegistry`, even when Layer A pre-allowed the tool. `Session.respondToPermission`
resolves host confirms before forwarding unknown ids to `backend.respondToPermission`.

See `superone-tool` Step 3. Pass the turn `AbortSignal`; `allowAlwaysAllow: false` for
delete/spend/spawn; decline/cancel/timeout perform no effect.

Main-thread-only tools (`session_rename`, `session_tag`) are denied to subagents **before**
any auto-allow. Remote node is a second implementation of the same contract — desktop parity
does not imply node parity.

### Permission tests before calling it integrated

1. Static host-owned sentinels are in the upstream allow list.
2. `computer_*` absent while disabled, allowed only while enabled.
3. A dynamic mini-app/third-party tool is not admitted by prefix or server default.
4. Downstream callback auto-allows a host-owned call without UI.
5. A child session cannot call a main-thread-only tool.
6. Decline / cancel / timeout / abort of an executor confirm: no effect, UI clears.
7. Same on remote node when remote is in scope.
8. A SuperOne tool paints its real ToolBlock, not a generic row.

## How to know you're done

Typecheck only covers seam #1.

1. Required list under [Completeness standard](#completeness-standard) — all ten, or an
   explicit "won't have X, like Codex/Grok".
2. `bun run typecheck`.
3. Grep audit: `rg "'claude'" --type ts apps/desktop/src/renderer apps/desktop/src/main | rg -v test`
   — does this harness belong at each hit? `experiences.md` groups by feature.
4. Manual: start a session, walk the chat bar, call one SuperOne tool, switch worktree, restart
   and resume.
5. Tests (see `apps/desktop/CLAUDE.md`): table-driven event-mapper tests over recorded
   provider payloads; store-routing tests; `app-settings-service.test.ts` `harnessOrder`
   round-trip. Unit-testing the backend class does not catch silent identity drift.

## Recurring traps

Ordered by how often they recur.

- **Capability flag lies.** `supportsTodos = true` renders the TODO panel whether or not
  `todos_updated` is emitted. Flip flags on only when the event is wired (see the `acp` entry).
- **Permission vocabulary is per-harness, `PermissionMode` is shared.** Wire popover, status
  bar, and mode list or they disagree.
- **Sandbox ≠ permission.** Codex folds sandbox into presets and must return `false` from
  `sandboxHarness.ts`.
- **Renderer defaults vs backend defaults.** `session-lifecycle.ts` and the backend must agree
  or the first turn uses one value while the UI shows the other.
- **ACP / spawned cwd.** Grok binds cwd at `session/new`. Switching worktree after start does
  nothing unless you rebuild with the new cwd.
- **Icons are three registries.** `resolveSessionIcon`, `resolveSessionIconFromBrandKey`, and
  brand hue/tokens. Prefer `@lobehub/icons`; wrap with `HarnessIconFallback`.
- **Every harness needs an `agentPreference` slot**, even `BrandOnlyAgentPreference`. Without
  it the hue slider snaps back on save. `app-settings-service.test.ts` `it.each` now fails.
- **Ordering has a main-process allowlist.** Renderer DnD that `readHarnessOrder` rejects
  looks like the row randomly reverted.
- **Chat input impersonates Claude.** Exhaustive `Record<ChatProvider, …>` for placeholder and
  slash; explicit empty catalog when unsupported.
- **Harness ≠ SessionProvider.** Missing `<id>-base` → `SessionProvider not found` with a
  working picker. Seed desktop and runtime catalogs; migrate aliases on rename.
- **`NodeHarnessId` (`acp-grok`) ≠ `HarnessId` (`acp`).** Convert with
  `normalizeSessionHarnessId` / `nodeHarnessIdToSessionHarnessId`.
- **Settings catalog and visibility fail closed.** Missing `CATALOG_HARNESS_META` /
  `NODE_HARNESS_DEFINITIONS` → invisible, no error.

<a id="appendix"></a>
## Appendix — not the bar

Use these only when the task *is* that harness, or when matching a similar shape after the
Claude / Codex / Grok path is chosen. Do not copy them as the completeness spec.

| | Shape | Typical gaps vs the bar |
|---|---|---|
| **OpenCode** | Own SDK + local server (`opencode-backend.ts`, `packages/opencode/`). First "experimental agent" after Claude/Codex. | Chat input originally impersonated Claude; host MCP landed later. |
| **Cursor** | Native SDK + local store (`cursor-backend.ts`, `packages/cursor/`). Custom tools, not MCP, for SuperOne. `docs/design/cursor-sdk-harness.md` (D1–D8) is a design-pack example. 152 files / 7 commits is a file-count warning, not a spec. | Host-tool UI incomplete; token accounting; write/edit without line-diff; subagent output leaking into the parent; duplicate bash rows. |
| **DeepSeek (`dsh`)** | In-process Cordis plugin tree (`deepseek-runtime-host.ts`, `packages/deepseek/`). Reuse the official package; the loader is the point. When official UI plugins conflict, SuperOne UI wins. | Not a "write another backend". Plan mode / several chrome rows still off the bar. |

Pi and Hermes were researched and not shipped. Do not add them.
