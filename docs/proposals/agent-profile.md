# Agent Profile

Status: v1 shipped (minimal cut, §0); later phases remain draft · Updated: 2026-10-15

Scope: turn a `session_providers` row ("run configuration") into a
user-customizable **Agent Profile** — a named agent with its own identity,
instructions, runtime defaults, permissions and capabilities — authored by the
base agents through a confirm card, and usable first through collaboration
(`@mention`, `session_collab_request`).

## 0. What v1 shipped

v1 is a minimal cut of this proposal. Everything below §0 that this section
does not list is still open.

| Area | Shipped in v1 | Where |
|---|---|---|
| Spec | `config.profile` = `{ version: 1, identity: { name, description }, instructions?, runtime?: { model?, effort?, permissionMode?, options? } }`; `permissionMode` must be one of the harness's `HARNESS_LAUNCH_OPTIONS.permissionModes` (none on OpenCode), parsed by the shared store on every write. Profile rows are written only through the store's `profiles` writer, which the desktop calls after the confirm card; `sessionProviders.*` RPC and IPC writes refuse them | `packages/shared/src/agent-profile.ts`, `packages/runtime/src/session/session-provider-store.ts`, `apps/desktop/src/main/session/agent-profile-store.ts` |
| Harness options | `runtime.options` holds each harness's own session settings, the ones its selector offers: Claude `ultracode`, Codex `fastMode`, ACP `contextWindow` / `mode`, OpenCode `agent`, Cursor `modelParams`, dsh `agentPreset` (`HARNESS_PROFILE_OPTIONS`). Allowed values come from the catalog per model (`supportedEffortLevels` xhigh, `serviceTiers`, `contextWindows`, `parameters`) or from harness-wide lists (ACP modes, OpenCode agents, dsh presets) | `packages/shared/src/agent-profile-options.ts` |
| Support checks | Model, effort and options are validated against the harness catalog; errors name the field and harness, and another harness's option is refused by name. A list the host cannot read yet is refused at write and left unchecked at launch | `validateAgentProfileRuntime`, `agentProfileModelSupport` |
| Resolver | `resolveAgentLaunchDefaults`: explicit launch fields > row runtime > global preference (a CLI node has no preferences, so its global layer is the catalog default). The model is settled first; inherited effort and options are re-checked against it, and an explicit value the catalogued model cannot carry is rejected. Row runtime is the profile's whole, or the legacy top-level `model` / `effort` / `reasoningEffort` / `fastMode` of a row without one (`providerLaunchRuntime`). Used by desktop `profileResources` and CLI `listCollaborationProfiles` (closes gap 2) | same module |
| Identity | Profile name and description flow to `session_collab_list_agents` and `@` mentions | `agent-profiles.ts`, `collaboration-profiles.ts` |
| Instructions | Composed ahead of the collaboration protocol into `systemPromptAppend`; desktop in `SessionManager` create/resume, CLI at collab start/reuse/rehydrate | `session-manager.ts`, `collaboration-start.ts` |
| dsh | `systemPromptAppend` delivered as an agent-scoped `superone:session` section (closes gap 5) | `packages/deepseek/src/runtime.ts` |
| Launch | Desktop applies options to the new session through the composer's settings path before its first turn (`applyDesktopSessionSettings`; Cursor parameters ride the first turn). Options have the same lifetime as a composer pick. A CLI node applies only the OpenCode agent; its other options resolve as unsupported there | `collaboration-start.ts` (desktop, CLI) |
| Tools | `agent_profile_list` / `agent_profile_apply` (`create` \| `update`) / `agent_profile_delete`, host-confirmed (`agent_profile_confirm`, no always-allow); base rows read-only. A write applies only while the row still matches the one confirmed. Delete moves stored and live sessions to the harness base row. Desktop sessions only: not in the remote Host Action catalog | `apps/desktop/src/main/mcp/agent-profile-tools.ts` |
| UI | Desktop confirm card: create is click-to-edit (name, description, instructions) with the composer's launch controls for model, effort, permission and harness options, the harness fixed and shown as the glyph before the name; the edited draft returns as `AGENT_PROFILE_DRAFT_FIELD` and is re-checked before the write. Update diff, destructive delete, shared chat-view tool rows, phone permission sheet with the same fields (instructions included) | `AgentProfileConfirmPrompt.tsx`, `chat-view/presenters/AgentProfileToolBlock.tsx` |

Deviations from the sections below:

- Harness options replace the proposed `runtime.fastMode`; there is no
  context field outside a harness's own options (Claude's 1M is a catalog model).
- An ACP context window or session mode picked before the agent starts is
  applied once it is up (it used to throw / be dropped).
- Instructions are read from the row on every create and resume, so editing a
  profile also changes the instructions of its resumed sessions (§5 proposed a
  launch-time snapshot). Model and effort still come from the session row.
- An ACP profile pins the ACP agent in use at creation (`config.agentId`).
- Remote spawn children (a desktop profile launched on another machine) do not
  receive the profile's instructions yet.
- On a CLI node the composed append is stored, and rebuilt for spawn and
  handoff sessions after a restart, but its turn runners do not read
  `systemPromptAppend` at all yet (pre-existing; collaboration prompt included).

Deferred: `slug`, `projectPaths`, `runtime.apiProviderId`, `permissions` beyond the permission mode (sandbox, tool rules),
`capabilities` (tools/MCP/skills/native agent), the `profile` capability entry,
plaintext `apiKey` migration (gap 4), `agentName` (gap 6), Settings page,
main-chat picker, remote-node/mobile authoring parity.

## 1. Decisions

| Question | Decision |
|---|---|
| First surface | Collaboration. Main-chat profile picker comes later (§8 phase 5). |
| Customizable in v1 | Identity, behavior, runtime, permissions, capabilities + native agent. |
| Scope | Global by default; optionally bound to one or more projects. |
| Who authors | Base agents, via `agent_profile_*` tools. Users do not fill a form. |
| Write gate | Every create/update/delete goes through a confirm card showing the diff. |

## 2. Current state

The storage and launch plumbing already exist; the customization layer does not.

| Layer | Where | State |
|---|---|---|
| Table | `session_providers (id, harness_id, name, is_base, config_json)` | One `<harness>-base` row per harness, seeded by migration |
| CRUD + validation | `apps/desktop/src/main/session/session-provider-repo.ts`; per-harness zod in `session/harness-registry.ts` | Works; base rows immutable except `updateBaseProviderConfig` |
| IPC / preload / remote RPC | `agent-service.ts` (`SESSION_PROVIDERS_*`), `window.app.sessionProviders.*`, `sessionProviders.*` node RPC | Wired; no renderer caller of create/update/delete |
| Profile derivation | desktop `session/agent-profiles.ts`, CLI `apps/cli/src/session/collaboration-profiles.ts` | `SessionAgentProfile.id === provider row id`, so custom rows are already listed and `@`-mentionable |
| Launch | `session/collaboration-start.ts` passes `providerId: grant.agent_id` | The only path that launches a non-base row |
| Main chat | `AgentService.baseProviderIdForHarness` | Always `<harness>-base`; renderer session identity is a `HarnessId` |

Known gaps this plan closes:

1. Config schemas describe *connection* (`apiKey`, `baseUrl`, `command`, `env`),
   not agent behavior. Codex `reasoningEffort` / `permissionPreset` are declared
   but never read by the backend.
2. *(Closed in v1.)* Desktop `profileResources` ignores row config when computing
   `defaultConfig`; CLI `pushProfile` honors `model` / `effort`. Same row, two
   different defaults.
3. `SessionManager.createSession` never applies row defaults.
4. `apiKey` is stored in plaintext `config_json`; credentials already live in the
   credential store.
5. *(Closed in v1.)* dsh drops `systemPromptAppend` entirely — the collaboration system prompt
   does not reach DeepSeek children today.
6. `ClaudeRunConfig.agentName` (automations) is persisted but never applied.

## 3. Data model

A profile is a `session_providers` row whose `config.profile` is set. Harness
connection fields stay at the top level of `config`, untouched. Keeping one
table preserves the existing contract that *every provider row is a launchable
agent*: mentions, collab, remote RPC and `sessions.provider_id` need no change.

The profile schema lives in `packages/shared` (harness-agnostic, versioned) and
is validated in addition to the harness `configSchema`:

```ts
// packages/shared/src/agent-profile.ts
export interface AgentProfileSpec {
  version: 1
  identity: {
    /** Mirrors session_providers.name. */
    name: string
    /** Preferred `@` keyword; de-duplicated by buildAgentMentionTargets. */
    slug?: string
    /** What this agent is for. Returned by session_collab_list_agents. */
    description: string
  }
  /** Empty or absent = global. Canonical project paths. */
  projectPaths?: string[]
  runtime?: {
    model?: string
    effort?: string
    fastMode?: boolean
    /** Credential id reference, never a raw key. */
    apiProviderId?: string | null
  }
  /** Appended to the harness system/developer prompt. */
  instructions?: string
  permissions?: {
    permissionMode?: PermissionMode
    sandboxMode?: SandboxMode
    /** Default for collab launches; the launch may still override. */
    worktree?: boolean
  }
  capabilities?: {
    tools?: { allow?: string[]; deny?: string[] }
    /** Names from the user MCP library. SuperOne's own server is always attached. */
    mcpServers?: string[]
    /** Skill ids enabled for this agent. Absent = inherit app setting. */
    skills?: string[]
    /** Harness-native agent: Claude `agent`, dsh preset, OpenCode agent. */
    nativeAgent?: string
  }
}
```

Validation rules:

- Values are checked against the harness vocabulary (`HARNESS_LAUNCH_OPTIONS`,
  model catalog) and against capability support (§4). Unsupported fields are
  rejected by `agent_profile_apply` with a message naming the field and harness,
  not silently dropped.
- `apiKey` is removed from new profile writes; a migration moves existing
  plaintext keys on non-base rows into the credential store and replaces them
  with `runtime.apiProviderId`.

## 4. Capability support

Verified against the backends on 2026-09-23. W = wired today, S = SDK/protocol
supports it but SuperOne does not wire it, X = no hook.

| Dimension | claude | codex | acp | opencode | cursor | dsh |
|---|---|---|---|---|---|---|
| Tool allow/deny | S (`tools` / `disallowedTools`) | S (thread `config`) | X (Grok: S via config overlay) | S (permission ruleset `deny`) | W (`tools` / `disallowedTools`) | X (preset decides) |
| MCP subset | S (explicit `mcpServers` map) | S (`mcp_servers.X.enabled=false`) | S (per-session list, filter) | S (`syncMcpServers` filter) | S (`buildCursorMcpServers` filter) | X (process-tree wide) |
| Skills | S (per-session `skills` list; global today) | S (unverified per thread) | S Grok only, additive | S (`skill` permission) | coarse (`settingSources`) | X |
| Native agent | S (SDK `agent`) | X | X (agentId picks a binary) | S (per-turn `agent` → default) | X | W (`agentPreset`) |
| Instructions | W (preset append) | W (`developer_instructions`) | W (Grok `_meta.rules`, else first prompt) | W (per-prompt `system`) | W (first-turn prefix) | W (agent-scoped section, v1) |
| Permission / sandbox | W / W | W / preset | W / none | W / none | W / W (local) | W / preset |

The support matrix becomes shared data, not UI branches. Add to
`HarnessCapabilities` (`packages/shared/src/harness/harness-capabilities.ts`):

```ts
profile: {
  toolFilter: boolean
  mcpSubset: boolean
  skills: boolean
  nativeAgent: 'claude-agent' | 'dsh-preset' | 'opencode-agent' | null
  instructions: boolean
}
```

Grok-specific exceptions go through an ACP-aware resolver in the style of
`resolveGoalCapability(harnessId, acpAgentId)`. The confirm card and Settings
render unsupported fields as explicit "not supported by <harness>" states.

## 5. Resolution

One shared resolver, used by desktop `agent-profiles.ts`, CLI
`collaboration-profiles.ts` and `SessionManager.createSession`:

```
effective = launch override  >  profile  >  global harness preference  >  catalog default
```

- `SessionAgentProfile.defaultConfig` is computed by the resolver, so the
  collab list shows the profile's real defaults (fixes gap 2).
- `instructions` are concatenated with `collaborationSystemPrompt(...)` into
  `systemPromptAppend`; profile text comes first, collaboration protocol last.
- Capability fields travel on `SessionCreateOptions` → `BackendStartOptions`
  as one `profileCapabilities` object; each backend applies what its
  capability entry declares and ignores nothing silently.
- `projectPaths` filters `usableProviders()`, so a project-bound profile is
  neither listed nor mentionable elsewhere, and `session_collab_request`
  rejects it with a scope error.
- A resumed session keeps the values it was created with; editing a profile
  affects new launches only.

## 6. Authoring tools

Three SuperOne tools, following the `automation_apply` / `config_apply`
pattern (register on both surfaces — MCP builtins and host-action descriptors):

| Tool | Behavior |
|---|---|
| `agent_profile_list` | Profiles visible in the current project, with harness, scope and capability support per field |
| `agent_profile_apply` | Create (`harnessId` + spec) or update (`id` + partial spec). Validates, then raises a confirm card |
| `agent_profile_delete` | Raises a confirm card; base rows cannot be deleted |

Confirm card (desktop ToolBlock + mobile chat-view):

- Shows the full spec on create and a field diff on update.
- Highlights permission widening: `bypassPermissions`, sandbox `off`,
  removing a tool deny entry, adding an MCP server.
- Shows unsupported fields for the chosen harness as disabled rows.
- Accept writes the row; reject returns a structured refusal to the agent.

Authoring flows the tool guidance should teach:

1. "Create a read-only reviewer" — the agent reads project conventions, drafts
   identity, instructions, permissions and model, then calls apply.
2. "Save this collaborator as a profile" — the agent distills the current or a
   referenced collab session's launch config and task framing into a spec.
3. "Change the reviewer to use Opus" — `list` then partial `apply`.

## 7. Security

- Profiles are a permission boundary: every write is user-confirmed; there is
  no auto-accept path, including unattended automation sessions.
- A profile cannot grant more than the harness allows; values outside
  `HARNESS_LAUNCH_OPTIONS` are rejected.
- No secrets in `config_json`; credentials are references only.
- Launching a profile through `session_collab_request` still goes through the
  existing collab confirm, which displays the profile's effective permissions.

## 8. Phases

1. **Contract** — `AgentProfileSpec` + zod schema in shared; `profile`
   capability entry; repo validation; shared resolver used by desktop and CLI;
   plaintext `apiKey` migration. Unit tests for the resolver and validation.
2. **Runtime application** — resolver in `createSession`; instructions for all
   harnesses including the dsh fix; permissions and worktree default; wire the
   S cells worth doing in v1 (Claude tools/MCP/skills/agent, ACP and Cursor MCP
   subset, OpenCode ruleset). Remaining cells stay explicitly unsupported.
3. **Authoring** — `agent_profile_*` tools, confirm card on desktop and mobile
   with Storybook stories (create, diff, widening warning, unsupported fields,
   rejected, long instructions, narrow), system-prompt guidance.
4. **Settings** — Agents page: list, inspect, delete, project binding,
   "ask an agent to edit" entry point. No full editor form.
5. **Later** — new-chat profile picker (renderer carries provider row id instead
   of `HarnessId`), mobile Settings parity, remote node authoring.

## 9. Open questions

- Should a profile be able to pin a harness-native agent *and* instructions at
  once when the native agent already carries its own prompt (dsh presets,
  Claude agents)? Proposed: allowed, instructions append after the native one.
- Should the automation `agentName` field be replaced by a profile id, since
  both describe "which agent runs this"? Proposed: yes, in phase 2.
