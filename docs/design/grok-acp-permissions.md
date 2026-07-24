# Design: SuperOne × Grok Build Permission System

| Field | Value |
|-------|--------|
| Status | Draft (implementation-ready) |
| Scope | ACP / Grok Build harness |
| Repo | `super-one` |
| Related source | `/Users/wuhangqi25/Developer/Projects/grok-build` (`xai-org/grok-build`) |
| Out of scope | terminal capability re-enable, session resume, hooks (`exit_plan_mode` shipped separately) |

---

## 1. Problem statement

Grok Build is SuperOne’s default experimental ACP agent (`grok agent stdio`). Two permission gaps make Grok sessions feel broken relative to Claude / Codex / OpenCode:

1. **Host MCP tools keep prompting.** SuperOne injects the built-in `superone` MCP server on every ACP session. On Claude, `createCanUseTool` auto-allows built-ins (`isBuiltInSuperoneTool`) and mini-app preapprovals (`isToolPreapproved`). On Grok, every MCP call becomes a `session/request_permission` reverse-request and `AcpBackend.handlePermissionRequest` **always** surfaces a UI prompt — including `session_rename`, `widget_show`, guides, etc.

2. **Permission mode switching is a no-op.** The composer still shows SuperOne’s permission mode control and calls `backend.setPermissionMode`. For ACP:

   ```ts
   // apps/desktop/src/main/session/backends/acp-backend.ts
   async setPermissionMode(_mode: PermissionMode): Promise<void> {}
   ```

   Grok never leaves its default **ask** baseline unless the process was spawned with `--always-approve`. Users cannot switch to always-approve / auto / accept-edits mid-session from SuperOne.

These are correctness and UX bugs, not polish: host tools should be silent infrastructure; mode toggles should change agent behavior.

---

## 2. Goals and non-goals

### Goals

| ID | Goal |
|----|------|
| G1 | Built-in SuperOne MCP tools never show an ACP permission dialog in Grok sessions (parity with Claude/OpenCode). |
| G2 | Mini-app tools still require explicit preapproval (`isToolPreapproved`); third-party MCP never auto-allows. |
| G3 | SuperOne `PermissionMode` drives Grok’s permission baseline on session create and mid-session where the wire protocol allows. |
| G4 | UI keeps a single permission-mode control for Grok; do not confuse it with ACP “modes” that are actually reasoning effort. |
| G5 | Minimal, testable changes; use Grok’s existing ACP/x.ai extensions — do not invent agent-side protocol. |

### Non-goals (this design)

- Full plan-mode approval UI (`x.ai/exit_plan_mode`) — separate track.
- Re-enabling client `terminal` capability for Grok.
- `session/load` resume, queue, hooks, hunkTracker.
- Changing Grok’s deny rules / sandbox semantics.
- Spoofing `clientType: grok_desktop` unless we fully implement Desktop option handling.

---

## 3. Current architecture

### 3.1 SuperOne permission surfaces by harness

```text
┌─────────────┐   canUseTool / rules        ┌──────────────────┐
│ Claude      │ ─ isBuiltInSuperoneTool ──► │ Auto-allow host  │
│             │ ─ isToolPreapproved ───────► │ MCP tools        │
└─────────────┘                             └──────────────────┘

┌─────────────┐   PermissionRuleset         ┌──────────────────┐
│ OpenCode    │ ─ allow each built-in ─────► │ Same effect      │
└─────────────┘                             └──────────────────┘

┌─────────────┐   session/request_permission ┌──────────────────┐
│ ACP / Grok  │ ─ handlePermissionRequest ─► │ ALWAYS UI prompt │  ← gap
│             │ ─ setPermissionMode ───────► │ no-op            │  ← gap
└─────────────┘                             └──────────────────┘
```

### 3.2 Key SuperOne files

| Area | Path |
|------|------|
| Built-in tool names | `apps/desktop/src/main/mcp/superone-mcp-builtin-defs.ts` |
| Preapproval + `isBuiltInSuperoneTool` | `apps/desktop/src/main/mcp/superone-mcp-server.ts` |
| Claude auto-allow | `apps/desktop/src/main/agent/claude-permissions.ts` |
| OpenCode allow rules | `apps/desktop/src/main/opencode/opencode-runtime.ts` (`buildOpenCodePermissionRules`) |
| ACP runtime | `apps/desktop/src/main/acp/acp-runtime.ts` |
| ACP permission map | `apps/desktop/src/main/acp/acp-permission-map.ts` |
| ACP backend | `apps/desktop/src/main/session/backends/acp-backend.ts` |
| SuperOne MCP attach | `apps/desktop/src/main/acp/acp-mcp.ts` |
| use_tool → `mcp__…` | `apps/desktop/src/main/acp/acp-event-map.ts` |
| Agent launch | `apps/desktop/src/main/acp/agent-catalog.ts` (`grok agent stdio`) |
| PermissionMode type | `packages/shared/src/agent-types.ts` |
| UI mode selector | `apps/desktop/src/renderer/.../PermissionModeSelector.tsx` |
| Session `setPermissionMode` | `apps/desktop/src/main/session/session.ts` |

### 3.3 Grok wire facts (from `grok-build` source)

**MCP tool identity** is `server__tool` (single `__` delimiter), e.g. `superone__session_rename`.  
`AccessKind::MCPTool { name }` uses that string. SuperOne’s UI name is `mcp__superone__session_rename` (Claude-style). Both must be recognized when deciding preapproval.

**Session grants** (skip prompt if present):

- `allowed_mcp_tools` — exact tool name (`superone__widget_show`)
- `allowed_mcp_servers` — server prefix (`superone`) via `parse_mcp_qualified_name`

**Permission modes** (docs + permission manager):

| Product / config | Claude-compat id | Behavior |
|------------------|------------------|----------|
| ask (default) | `default` | Read-only free; mutating tools prompt |
| accept edits | `acceptEdits` | Synthetic allow for edits |
| plan | `plan` | Prefer real plan mode tools; Claude-compat |
| auto | `auto` | Classifier; escalate / block rest |
| don’t ask | `dontAsk` | Only pre-approved + built-in read-only |
| always-approve | `bypassPermissions` | Skip ordinary prompts; deny/hooks still apply |

**ACP session create** (`session/new` `_meta`):

```json
{ "yoloMode": true }   // always-approve
{ "autoMode": true }   // auto (ignored if yolo also true)
```

**Mid-session permission baseline** (ext **notification**, not `set_config_option`):

```json
// method: x.ai/yolo_mode_changed
{
  "yolo_mode": true,
  "auto_mode": false,
  "permission_mode": "always-approve",
  "clientIdentifier": "superone"
}
```

Handled in `mvp_agent/acp_agent.rs` → `SetYoloMode` / `SetAutoMode`.  
Supported strings for `permission_mode` in that handler: `auto`, `always-approve`, `ask`, `default`.

**Not mid-session via that notification:** `acceptEdits`, `dontAsk`, full Claude `defaultMode` synthesis (those come from config / Claude settings at permission policy load, not from the yolo ext).

**ACP `configOptions` category `"mode"`** in Grok is **reasoning effort**, not permission mode (`session_config.rs`). SuperOne’s `acpModes` / `setSessionMode` must stay separate from `permissionMode`.

**Client type** (`ClientType`): unknown identifiers → `Generic`. Only `GrokTUI` | `GrokPager` | `Desktop` get rich options (`enable-always-approve`, bash highlights, `allow-always-mcp`). SuperOne today sends `clientInfo.name = "superone"` → Generic.

**Plan mode** is a separate ACP `session/set_mode` / prompt `_meta.mode` path (`SessionMode::Plan`), not the same as permission `bypassPermissions`.

---

## 4. Proposed design

### 4.1 Overview

Two independent subsystems, one PR each (plus a small shared helper PR if needed):

```text
                    ┌─────────────────────────────────────┐
                    │ SuperOne PermissionMode (session)   │
                    └───────────────┬─────────────────────┘
                                    │
              session/new _meta     │    mid-session
         yoloMode / autoMode        │    x.ai/yolo_mode_changed
                                    ▼
                    ┌─────────────────────────────────────┐
                    │ Grok permission manager             │
                    │ (ask | auto | always-approve +      │
                    │  config rules for acceptEdits/…)    │
                    └───────────────┬─────────────────────┘
                                    │
                    request_permission (MCP / bash / edit)
                                    │
                                    ▼
                    ┌─────────────────────────────────────┐
                    │ AcpBackend.handlePermissionRequest  │
                    │  1. normalize tool id               │
                    │  2. built-in / preapproved? → allow │
                    │  3. else → UI prompt                │
                    └─────────────────────────────────────┘
```

### 4.2 SuperOne MCP pre-approval (G1, G2)

#### Decision: client-side short-circuit (chosen)

When Grok asks for permission, SuperOne answers **before** emitting `permission_request` if the tool is host infrastructure or user-preapproved.

**Why not only agent-side allowlists?**

| Approach | Pros | Cons |
|----------|------|------|
| A. Client short-circuit | Parity with Claude `canUseTool`; no Grok config write; works today | One round-trip still happens agent→client (cheap) |
| B. Seed `allowed_mcp_servers += superone` | Fewer reverse-requests after first grant | Need a write path into Grok session state; not exposed cleanly on session/new |
| C. Project `.grok/config.toml` allow rules | Persistent | Dirty user tree; multi-client side effects; hard to keep in sync with built-in list |

**Chosen:** A as the primary path. Optionally, when auto-allowing, respond with `allow_always` / `allow-always-mcp` **server scope** if Grok offered that option id — so subsequent calls skip the reverse-request entirely for the rest of the session (optimization, not correctness).

#### Normalize tool identity

Shared helper (new file recommended):

`apps/desktop/src/main/acp/acp-permission-preapprove.ts`

```ts
export function resolveAcpPermissionToolName(params: RequestPermissionRequest): {
  /** Claude-style: mcp__superone__session_rename */
  qualifiedClaudeName: string | null
  /** Grok-style: superone__session_rename */
  grokMcpName: string | null
  bareTool: string | null
  server: string | null
}

export function shouldAutoAllowAcpPermission(params: RequestPermissionRequest): boolean
```

Resolution order (first hit wins):

1. `normalizeAcpTool(params.toolCall)` → already unwraps `use_tool` to `mcp__server__tool` (`acp-event-map.ts`).
2. Else `rawInput.tool_name` / `rawInput.toolName` (Grok `use_tool` shape).
3. Else `toolCall.title` if it looks like `server__tool` or `mcp__…`.
4. Else `_meta['x.ai/tool'].name` if MCP-ish.

Canonical checks:

```ts
// Built-in host tools (always allow)
isBuiltInSuperoneTool(claudeName)           // mcp__superone__session_rename
// also accept grok form:
isBuiltInFromGrokName('superone__session_rename')
  → claudeName = `mcp__superone__${bare}` after split

// Mini-app preapproval (user-managed set)
isToolPreapproved(claudeName)
// implement isToolPreapproved to accept either form, or normalize first
```

**Never auto-allow:**

- Third-party MCP (`GitHub__…`, `linear__…`, …)
- Mini-app tools not in `preapprovedTools`
- Native Grok tools (bash, edit, …) — those follow Grok permission mode

#### Auto-allow response shape

Reuse `mapPermissionDecision(options, allow=true, alwaysAllow=?)`:

1. Prefer `allow_once` for built-ins (no persistent grant pollution).
2. If options include an always-MCP option (`allow-always-mcp` or `kind === allow_always` with MCP meta) **and** tool is built-in SuperOne, prefer selecting that with server-scope when response meta is supported — **phase 2** if meta wiring is missing; phase 1 only needs `allow_once`.
3. If no allow option exists, log + cancel (fail closed for the call, not hang).

#### Integration point

```ts
// AcpBackend.handlePermissionRequest
private handlePermissionRequest(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
  if (shouldAutoAllowAcpPermission(params)) {
    const { options } = mapPermissionRequest(params) // or extract options only
    return Promise.resolve(mapPermissionDecision(options, true, /* alwaysAllow */ false))
  }
  // existing emit + park path
}
```

Trace: `trace('permission.flow', 'acp_preapprove', { tool, source: 'builtin'|'preapproved' })`.

#### Media / config tools with host-side confirm

Some built-ins (e.g. `media_generate_video`, `config_apply`) may open SuperOne’s **own** confirmation UI inside the MCP tool handler. That is **not** ACP `request_permission`. Auto-allowing ACP permission still allows the tool to run; the tool remains free to block on host UI. Document this distinction so we do not “double-prompt” ACP + host for pure host tools that have no inner confirm.

---

### 4.3 Permission mode switching (G3, G4)

#### Mode mapping

| SuperOne `PermissionMode` | Session create (`session/new` `_meta`) | Mid-session (`x.ai/yolo_mode_changed`) | Notes |
|---------------------------|----------------------------------------|----------------------------------------|-------|
| `default` | omit / `{ yoloMode: false, autoMode: false }` | `{ yolo_mode: false, auto_mode: false, permission_mode: "ask" }` | Grok ask |
| `auto` | `{ autoMode: true }` | `{ yolo_mode: false, auto_mode: true, permission_mode: "auto" }` | Requires Grok auto feature enabled on disk |
| `bypassPermissions` | `{ yoloMode: true }` | `{ yolo_mode: true, permission_mode: "always-approve" }` | Always-approve; deny rules still apply |
| `acceptEdits` | **Not in yolo/auto meta** | **Not mid-session via yolo notification** | See strategy below |
| `dontAsk` | same | same | See strategy below |
| `plan` | Do **not** set yolo | Prefer ACP plan mode / SuperOne plan UX | Plan ≠ permission yolo |

#### Strategy for modes Grok ACP cannot toggle mid-session

**Phase 1 (ship first):** Map only the three live controls:

- `default` ↔ ask  
- `auto` ↔ auto  
- `bypassPermissions` ↔ always-approve  

UI for Grok sessions shows these three (like a reduced `PermissionModeSelector` / OpenCode-style subset). Hide or disable `acceptEdits` / `dontAsk` / Claude-only `plan` permission entry for `agentId === 'grok-build'` until phase 2.

**Phase 2 (optional follow-up):**

- `acceptEdits` / `dontAsk`: on **idle** session, rebuild ACP runtime with env or CLI flags if Grok supports `--permission-mode acceptEdits` on `agent stdio` (verify against installed CLI). Alternatively inject Claude-compat settings only if product accepts writing under project/home `.claude` / `.grok` (prefer not).
- `plan`: wire SuperOne plan toggle to Grok `session/set_mode` plan id when advertised, not to `setPermissionMode`.

#### Runtime plumbing

1. **`createAcpRuntime` / session/new**  
   Pass `permissionMode` from `AcpBackend` start opts into `buildSession` meta:

   ```ts
   // conceptual — exact SDK field: session builder meta or newSession params _meta
   _meta: {
     ...(mode === 'bypassPermissions' ? { yoloMode: true } : {}),
     ...(mode === 'auto' ? { autoMode: true } : {}),
   }
   ```

2. **`AcpBackend.setPermissionMode(mode)`**  
   Implement:

   ```ts
   async setPermissionMode(mode: PermissionMode): Promise<void> {
     this.permissionMode = mode
     if (!this.runtime) return
     await this.runtime.setGrokPermissionMode(mode)
   }
   ```

3. **`AcpRuntime.setGrokPermissionMode`**  
   Send ACP **ext notification** (fire-and-forget) via agent connection:

   ```ts
   // method name must match Grok
   connection.notify or agent.extNotification({
     method: 'x.ai/yolo_mode_changed',
     params: {
       yolo_mode: mode === 'bypassPermissions',
       auto_mode: mode === 'auto',
       permission_mode:
         mode === 'bypassPermissions' ? 'always-approve'
         : mode === 'auto' ? 'auto'
         : 'ask',
       clientIdentifier: 'superone',
     },
   })
   ```

   Exact SDK call depends on `@agentclientprotocol/sdk` client API for ext notifications — implement against installed package (mirror how custom requests already use 3-arg `onRequest`).

4. **Process-level always-approve (optional boost)**  
   Do **not** put `--always-approve` on the binary for interactive SuperOne sessions: that freezes the process baseline and fights mid-session ask. Prefer session meta + notification only.

5. **Session store**  
   Keep persisting `permissionMode` on the SuperOne session record (already present). ACP backend must read it on start/prewarm.

#### UI / state separation

| State field | Meaning for Grok |
|-------------|------------------|
| `permissionMode` | SuperOne permission baseline (this design) |
| `acpModes` / `selectedAcpModeId` | Grok **reasoning effort** (or agent config modes) — leave as-is |
| `setSessionMode` | Effort / agent definition — **not** permission |

Composer chrome for `sessionProvider === 'acp' && acpAgentId === 'grok-build'`:

- Show permission control with Grok-supported modes.
- Keep model / effort selectors separate (existing Acp model + mode UI).

`cyclePermissionMode` / Shift+Tab: cycle only modes in the Grok-supported set.

#### Optional: honor `enable-always-approve` from permission prompts

If a future clientType upgrade exposes option id `enable-always-approve`, map user selecting it to `setPermissionMode('bypassPermissions')` (same as Grok Desktop). Phase 1 can ignore if options never appear under Generic.

---

### 4.4 Client identity (related but minimal)

In `acp-runtime` initialize:

```ts
clientInfo: { name: 'superone', version: appVersion }  // not 0.0.0
_meta: {
  clientType: 'superone',       // honest Generic mapping
  clientVersion: appVersion,
  askUserQuestion: true,
}
```

Env when spawning: `GROK_CLIENT_VERSION=<appVersion>` (Grok logs this for auth diagnostics).

**Do not** spoof `grok_desktop` until SuperOne implements Desktop-compatible option ids and bash term UI. Generic is correct.

---

### 4.5 Lifecycle

```text
prewarm / start
  ├─ spawn grok agent stdio
  ├─ initialize (clientInfo + caps)
  ├─ session/new + mcpServers[superone] + _meta yolo/auto from permissionMode
  └─ pump updates

user switches mode
  ├─ Session.setPermissionMode → AcpBackend.setPermissionMode
  ├─ emit permission_mode_change
  └─ x.ai/yolo_mode_changed (if runtime live)

tool needs permission
  ├─ Grok manager: yolo / auto / grants / rules
  ├─ else request_permission → SuperOne
  │     ├─ preapprove? → allow immediately
  │     └─ else UI → respondToPermission
  └─ continue turn
```

**Rebuild rules:** Permission mode switch does **not** require process restart for ask/auto/yolo. Switching agent id still rebuilds runtime (existing).

---

## 5. Edge cases and security

| Case | Behavior |
|------|----------|
| Built-in tool under yolo | Grok may not ask; SuperOne short-circuit never runs — fine |
| Built-in tool under deny rule | Grok deny wins before client; SuperOne never sees request — fine |
| Mini-app not preapproved | Prompt as today |
| User denies built-in (if short-circuit broken) | Would break host features — tests must lock short-circuit |
| Third-party MCP | Never short-circuit |
| `session_rename` from subagent | Claude blocks by agentID; Grok may not pass agentID — accept host-side rename lock (`user_locked`) only |
| Mode switch during pending permission | Allow in-flight prompt to complete; new mode applies to later calls |
| Spoofed tool title | Prefer structured `rawInput` / use_tool unwrap over human title |
| OpenCode/other ACP agents | Preapprove helper is harness-agnostic (good for OpenCode ACP too); mode notification is Grok-specific — gate on `agentId === 'grok-build'` or capability probe |

---

## 6. Testing plan

### Unit

- `acp-permission-preapprove.test.ts`
  - `superone__session_rename`, `mcp__superone__widget_show` → allow  
  - `superone__myapp__foo` without preapproval → deny short-circuit  
  - preapproved mini-app → allow  
  - `GitHub__list_issues` → no auto-allow  
  - use_tool envelope shapes from existing event-trace fixtures  
- `acp-backend` tests: handlePermissionRequest auto-resolves without emit  
- Mode mapping pure function tests  
- `setPermissionMode` sends expected ext notification params (mock connection)

### Integration / vitest with mock runtime

- Start with `permissionMode: 'bypassPermissions'` → session/new meta includes `yoloMode: true`  
- Switch default → bypass mid-session → notification fired  
- Auto mode meta / notification  

### Manual (Grok CLI installed)

1. Grok session, ask mode: agent calls `session_rename` → no permission card.  
2. Agent calls GitHub MCP → permission card still shows.  
3. Toggle Bypass → bash/edit proceeds without prompts (deny rules still block).  
4. Toggle back to Default → prompts return.  
5. Mini-app tool without preapproval → still prompts; with preapproval → silent.

---

## 7. Alternatives considered

| Alternative | Why rejected / deferred |
|-------------|-------------------------|
| Spawn always with `--always-approve` | Breaks interactive ask; mid-session demotion hard |
| Write `.grok/config.toml` allow MCPTool rules | Pollutes project; multi-client side effects |
| Spoof `clientType: grok_desktop` | Richer options but wrong semantics without Desktop UI |
| Map permission to ACP `set_config_option` “mode” | Those options are effort levels in Grok |
| Auto-allow entire `mcp__superone__*` prefix | Would preapprove all mini-app tools — security regression |
| Full Claude mode set mid-session without rebuild | Wire protocol only supports yolo/auto toggles cleanly |

---

## 8. Key decisions

1. **Client-side preapproval short-circuit** for built-ins + mini-app preapprovals — mirrors Claude, no Grok config dependency.  
2. **Do not auto-allow all `superone__*` tools** — only `BUILT_IN_SUPERONE_TOOL_NAMES` (+ mobile share) and explicit preapprovals.  
3. **Phase 1 mode set = `{ default, auto, bypassPermissions }`** for Grok; acceptEdits/dontAsk deferred.  
4. **Mid-session via `x.ai/yolo_mode_changed`**, create-time via `session/new` `_meta.yoloMode` / `autoMode`.  
5. **Keep `permissionMode` orthogonal to `acpModes` (effort).**  
6. **Honest `clientType: superone` (Generic)** until Desktop option parity exists.  
7. **Prefer `allow_once` for built-in preapprove responses** in phase 1; optional always-mcp server grant later for fewer round-trips.

---

## 9. Open questions

| # | Question | Default if unanswered |
|---|----------|------------------------|
| Q1 | Exact ACP SDK API for sending ext **notifications** from the client (method name / wrapper)? | Probe `@agentclientprotocol/sdk` during PR1; fallback raw JSON-RPC if needed |
| Q2 | Does installed `grok agent stdio` honor `--permission-mode acceptEdits` for phase 2? | Measure with `grok --help`; defer acceptEdits until confirmed |
| Q3 | Should auto-allow respond with `allow-always-mcp` + server `superone` when option present (fewer reverse-requests)? | Phase 1: allow_once only; phase 1.1 optimization |
| Q4 | Gate mode UI on `agentId === 'grok-build'` only, or any agent that advertises yolo meta? | Start with grok-build only |
| Q5 | Does Grok auto mode require a remote/feature flag (`auto_permission_mode_enabled_from_disk`)? | If auto fails closed, UI should show toast and stay on default |

---

## 10. PR Plan

### PR1 — Shared preapprove helper + wire into AcpBackend

**Title:** `fix(acp): auto-allow SuperOne built-in MCP tools on Grok permissions`

**Changes:**

- Add `apps/desktop/src/main/acp/acp-permission-preapprove.ts` (+ tests)
- Extend `isBuiltInSuperoneTool` / `isToolPreapproved` normalization if needed (`superone-mcp-server.ts`)
- `AcpBackend.handlePermissionRequest` short-circuit
- Tests with use_tool fixtures from `acp-event-map.test.ts`

**Deps:** none  
**Risk:** low  
**User-visible:** no more permission spam for host tools

---

### PR2 — Permission mode create + mid-session for Grok

**Title:** `feat(acp): map SuperOne permission modes to Grok yolo/auto`

**Changes:**

- Pass `permissionMode` into ACP session/new `_meta`
- Implement `AcpBackend.setPermissionMode` + runtime ext notification
- Mode mapping module + tests
- Gate unsupported modes for grok-build in renderer (`PermissionModeSelector` / cycle set)
- Fix `clientInfo.version` + `GROK_CLIENT_VERSION` env (small related fix)

**Deps:** none (can land parallel to PR1)  
**Risk:** medium (wire format / SDK notify)  
**User-visible:** Bypass / Auto / Default work on Grok

---

### PR3 — UI polish + docs

**Title:** `feat(acp): Grok permission mode selector subset and i18n`

**Changes:**

- Composer: Grok-supported modes only; clarify effort vs permission labels if confusing
- i18n strings (en/zh) if new labels needed
- Short note in experimental agents description

**Deps:** PR2  
**Risk:** low

---

### PR4 (optional follow-up) — acceptEdits / dontAsk / always-mcp grant

**Title:** `feat(acp): extend Grok permission modes and MCP session grants`

**Changes:**

- Probe CLI for full `--permission-mode` set; idle rebuild if required  
- Optional: auto-respond `allow-always-mcp` for server `superone` on first built-in  
- Telemetry / event-trace coverage  

**Deps:** PR1 + PR2  
**Risk:** medium

---

## 11. Implementation sketch (for implementers)

### Preapprove (core)

```ts
// acp-permission-preapprove.ts (sketch)
import { isBuiltInSuperoneTool, isToolPreapproved } from '../mcp/superone-mcp-server'
import { normalizeAcpTool } from './acp-event-map'

export function shouldAutoAllowAcpPermission(params: RequestPermissionRequest): boolean {
  const names = collectCandidateNames(params) // claude + grok forms
  for (const n of names) {
    if (isBuiltInSuperoneTool(n)) return true
    if (isToolPreapproved(n)) return true
    // also try mcp__ prefix fold
    if (!n.startsWith('mcp__') && isBuiltInSuperoneTool(`mcp__${n.replace(/^/, '')}`)) { /* ... */ }
  }
  return false
}
```

Normalize carefully:

- `superone__session_rename` → `mcp__superone__session_rename`  
- `mcp__superone__session_rename` unchanged  
- Mini-app: `mcp__superone__myapp__tool` matches existing preapproval set format

### Mode notify (core)

```ts
function grokPermissionMeta(mode: PermissionMode): Record<string, unknown> {
  switch (mode) {
    case 'bypassPermissions':
      return { yoloMode: true }
    case 'auto':
      return { autoMode: true }
    default:
      return {}
  }
}

function grokYoloNotification(mode: PermissionMode) {
  return {
    yolo_mode: mode === 'bypassPermissions',
    auto_mode: mode === 'auto',
    permission_mode:
      mode === 'bypassPermissions' ? 'always-approve'
      : mode === 'auto' ? 'auto'
      : 'ask',
    clientIdentifier: 'superone',
  }
}
```

---

## 12. Success criteria

- [ ] Grok session: consecutive built-in MCP calls produce **zero** `permission_request` UI events (unit + manual).  
- [ ] Third-party MCP still prompts in ask mode.  
- [ ] Preapproved mini-app tools silent; non-preapproved prompt.  
- [ ] Setting Bypass updates Grok behavior without restart; Default restores prompts.  
- [ ] Auto maps correctly or fails with user-visible feedback if feature-disabled.  
- [ ] `acpModes` effort selector still independent of permission mode.  
- [ ] No regression on Claude/Codex/OpenCode permission paths.

---

## Document history

| Date | Note |
|------|------|
| 2026-07-25 | Initial design from SuperOne + `xai-org/grok-build` source review |
