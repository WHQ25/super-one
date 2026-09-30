# Agent Profile

Status: draft · Updated: 2026-09-23

Scope: turn a `session_providers` row ("run configuration") into a
user-customizable **Agent Profile** — a named agent with its own identity,
instructions, runtime defaults, permissions and capabilities — authored by the
base agents through a confirm card, and usable first through collaboration
(`@mention`, `session_collab_request`).

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
2. Desktop `profileResources` ignores row config when computing
   `defaultConfig`; CLI `pushProfile` honors `model` / `effort`. Same row, two
   different defaults.
3. `SessionManager.createSession` never applies row defaults.
4. `apiKey` is stored in plaintext `config_json`; credentials already live in the
   credential store.
5. dsh drops `systemPromptAppend` entirely — the collaboration system prompt
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
| Instructions | W (preset append) | W (`developer_instructions`) | W (Grok `_meta.rules`, else first prompt) | W (per-prompt `system`) | W (first-turn prefix) | X (dropped — bug) |
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
