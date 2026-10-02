# Claude Agent SDK behavioral contracts

Upstream behavior SuperOne depends on that `sdk.d.ts` does not state, or states
differently from what the runtime does. "Observed" names the version and method;
re-check an entry when an upgrade touches its area.

## Spawn and environment

### `Options.env` replaces the environment

- **Behavior:** When `env` is set, the child gets exactly that object;
  `process.env` is not merged in. Omitting `env` inherits `process.env`.
  (0.2.111–0.2.112 briefly merged; 0.2.113 reverted.)
- **Observed:** 0.2.113–0.2.118, `sdk.mjs` source.
- **Depends on it:** `apps/desktop/src/main/session/backends/claude-backend.ts`
  (`buildSafeEnv(custom)` lays custom provider env over the full process env, so
  the Bash tool keeps `PATH`).
- **Guard:** `apps/desktop/src/main/session/backends/claude-backend.test.ts`
  (third-party provider env keeps `PATH`).

### Settings-file `env` beats the spawn environment

- **Behavior:** Claude Code writes the `env` blocks of user/project/local
  settings into its own `process.env` at start, overriding what the parent
  passed. The flag-settings layer (`Options.settings`) sits above those files.
- **Observed:** Claude Code 2.1.272, loopback probe of request headers.
- **Depends on it:** `packages/claude/src/provider-settings-env.ts#providerSettingsEnv`,
  mirrored into `settings.env` by desktop `claude-query.ts#buildClaudeOptions`
  (`settingsEnv`) and by `packages/claude` run/live sessions.
- **Guard:** `packages/claude/src/provider-settings-env.test.ts`.

### Third-party endpoints count as first party

- **Behavior:** A custom `ANTHROPIC_BASE_URL` is still `firstParty`; unknown model
  ids get every capability, so mid-conversation tool changes send blocks that
  Anthropic-compatible third parties reject. `CLAUDE_CODE_MODEL_CAPABILITIES`
  negates one capability without dropping 1M context or thinking.
- **Observed:** Claude Code 2.1.269, binary strings.
- **Depends on it:** `packages/shared/src/platform-registry/claude-env.ts#claudeThirdPartyEnv`
  (`-mid_conv_tool_change`).
- **Guard:** unguarded against upstream change; a new rejected capability shows
  up as a 400 on third-party providers.

### Native binary path inside `app.asar`

- **Behavior:** The SDK resolves the platform binary through `require.resolve`,
  which returns an `app.asar/...` path in packaged Electron; spawning it fails with
  `ENOTDIR`. Electron's asar rewrite does not apply.
- **Observed:** 0.2.114+ (native binary packages), packaged 0.21.5-alpha.
- **Depends on it:** `apps/desktop/src/main/agent/claude-binary.ts`,
  `packages/claude/src/resolve-sdk-binary.ts` (rewrite to `app.asar.unpacked`,
  both separators).
- **Guard:** `apps/desktop/src/main/agent/claude-binary.test.ts`.

## Sessions, resume and fork

### Resume reports cumulative usage

- **Behavior:** Since 0.3.277 the first `result` after resume or fork carries the
  transcript's cumulative `total_cost_usd` and `modelUsage`, not a delta from zero.
- **Observed:** 0.3.277, changelog and usage-stats audit.
- **Depends on it:** `apps/desktop/src/main/agent/claude-query.ts`
  (`modelUsageBaseline` treats the first result as a baseline), fed from both
  `Session` start options and `ClaudeBackend` idle/interrupt revive.
- **Guard:** `apps/desktop/src/main/agent/claude-query-usage-baseline.test.ts`.

### Resume and fork are scoped to the cwd

- **Behavior:** Transcripts live in `~/.claude/projects/<slug>/<id>.jsonl`, slug =
  `realpath(cwd)` with non-alphanumerics replaced by `-`. `resume` only searches
  the current cwd's folder, so `forkSession: true` with a different cwd fails.
  The standalone `forkSession()` writes into the source session's folder; moving
  the file lets a plain `resume` in the target cwd find it. Forks do not carry
  file-history checkpoints.
- **Observed:** 0.3.143, end-to-end fork to a worktree.
- **Depends on it:** `packages/claude/src/fork-session.ts`,
  `packages/claude/src/transcript-store.ts#claudeProjectSlug`.
- **Guard:** `packages/claude/src/fork-session.test.ts`.

### Truncating resume is refused, not retried

- **Behavior:** `resumeSessionAt` with `resumeDropsTurn` fails with a
  `Resume rejected by --resume-drops-turn:` result when the turn no longer
  matches. Retrying the same arguments fails again.
- **Observed:** 0.3.226+ (`resumeDropsTurn`).
- **Depends on it:** `RESUME_DROPS_TURN_REFUSAL_PREFIX` in
  `packages/claude/src/agent-event-mapper.ts` and desktop `claude-query.ts`; the
  caller clears the fork target and does a full resume. Both options are plumbed
  through desktop `buildClaudeOptions` and `packages/claude`, but no production
  path sets them today.
- **Guard:** `apps/desktop/src/main/agent/claude-query.test.ts`.

### System prompt snapshots are disabled

- **Behavior:** Since 0.3.267 the rendered system prompt is recorded on the first
  request and replayed verbatim on later launches until compaction, unless
  `systemPrompt.snapshot` is `false`.
- **Observed:** 0.3.267, changelog.
- **Depends on it:** every `systemPrompt` SuperOne builds sets `snapshot: false`
  so resumed sessions see the current SuperOne append.
- **Guard:** unguarded.

## Turn lifecycle

### Background work outlives `result`

- **Behavior:** `result` ends the model turn, but background tasks keep running.
  `task_started` / `task_updated` (`patch.status`) / `task_notification` track
  them; the session is idle only when `result` has arrived and no task is active.
  Since 0.3.274 queued background completions are merged into one model call but
  each still emits a `result`; the non-final ones are empty with `num_turns: 0`.
- **Observed:** 0.2.114 (task messages), 0.3.274 (merged completions).
- **Depends on it:** `activeBackgroundTasks` in desktop `claude-query.ts` and
  `packages/claude/src/agent-event-mapper.ts`.
- **Guard:** `apps/desktop/src/main/agent/claude-query.test.ts` (background task
  cases); the empty-`result` case is unguarded.

### `priority: 'now'` ends the turn as `aborted_tools`

- **Behavior:** A user message sent with `priority: 'now'` ends the running turn
  as `subtype: 'success'` with `terminal_reason: 'aborted_tools'`, and the
  steer's answer follows as its own turn. Since 0.3.286 a running shell command,
  agent or MCP call is no longer stopped: a foreground Bash call keeps running
  (reported as a `task_started` / `task_notification` pair), its `tool_result`
  arrives normally, and `permission_denials` stays empty. Before 0.3.286 the
  tools in flight were aborted and listed in `permission_denials`. A
  WebFetch/WebSearch that steps aside reports `tool_use_result:
  { detachedToolCall: true }` (0.3.287). A steer that lands while the reply is
  streaming ends that turn with `terminal_reason: 'aborted_streaming'`. A user
  Stop instead ends with `error_during_execution`.
- **Observed:** 0.3.x, trace; 0.3.287 live probe.
- **Depends on it:** `apps/desktop/src/main/session/backends/claude-backend.ts`
  (`steeredTurnMessageId` strips the terminal reason from a steered turn);
  desktop `claude-query.ts` backfills a denied result for calls still listed in
  `permission_denials`, a no-op since 0.3.286.
- **Guard:** `apps/desktop/src/main/session/backends/claude-backend.test.ts`.

### Interrupt leaves queued messages; cancelling them is untyped

- **Behavior:** `interrupt()` resolves with a receipt whose `still_queued` lists
  user messages the CLI still holds. The runtime `Query` has
  `cancelAsyncMessage(uuid)` (control request `cancel_async_message`), but
  `sdk.d.ts` does not declare it.
- **Observed:** 0.3.284, `sdk.mjs` and `sdk.d.ts`.
- **Depends on it:** `ClaudeBackend.interrupt` in
  `apps/desktop/src/main/session/backends/claude-backend.ts` reaches it through a
  cast and rebuilds the runtime when it is missing or fails.
- **Guard:** `apps/desktop/src/main/session/backends/claude-backend.test.ts`;
  re-check the method exists on every upgrade, since no type error will flag it.

### `/goal` state arrives late and only from the Stop hook

- **Behavior:** `/goal <condition>` first runs the condition as a normal turn;
  the CLI then replies `Goal set: …` as local command output. The active-goal
  message is only sent by the Stop hook evaluation; clear, met and impossible all
  arrive as `null`.
- **Observed:** Claude Code 2.1.272, trace and binary strings.
- **Depends on it:** `apps/desktop/src/main/session/backends/claude-goal-tracker.ts`.
- **Guard:** `apps/desktop/src/main/session/backends/claude-goal-tracker.test.ts`.

## Permissions and subagents

### In-place permission and directory changes

- **Behavior:** `allowDangerouslySkipPermissions: true` alone skips nothing; it
  only allows `bypassPermissions`. `setPermissionMode` applies both ways without a
  restart. `applyFlagSettings({ permissions: { additionalDirectories } })` adds
  directories mid-session, but directories given at spawn become `--add-dir`
  arguments that flag settings cannot remove. Each top-level key passed to
  `applyFlagSettings` replaces the previous value of that key.
- **Observed:** 0.3.x, controlled experiments (2026-06-12).
- **Depends on it:** `claude-backend.ts` (`_spawnedAdditionalDirs` forces a
  rebuild when a spawn-time directory is removed).
- **Guard:** unguarded at the backend; `apps/desktop/src/main/session/session.test.ts`
  only covers the session calling `setAdditionalDirectories`.

### `canUseTool` does not run in auto or bypass mode

- **Behavior:** `canUseTool` fires only when a permission prompt is needed.
  PreToolUse hook callbacks fire in every mode, and `agent_id` on the hook input is
  set only inside a subagent.
- **Observed:** 0.3.x, a subagent renamed the session under bypass.
- **Depends on it:** `denySubagentSessionRename` in desktop `claude-query.ts`
  (main-thread-only SuperOne tools).
- **Guard:** `apps/desktop/src/main/agent/claude-query.test.ts`.

### Subagents do not see the main system prompt append

- **Behavior:** `systemPrompt.append` reaches the main agent only; there is no
  public option for built-in subagents' prompts. Tool descriptions of always-loaded
  MCP tools are the only text every subagent sees.
- **Observed:** 0.3.181, source and runtime markers.
- **Depends on it:** placement of guidance in
  `apps/desktop/src/main/agent/superone-system-prompt.ts` versus SuperOne MCP tool
  descriptions.
- **Guard:** unguarded.

### SessionStart hook callbacks never run

- **Behavior:** An in-process `SessionStart` callback in `Options.hooks` is
  announced to the binary and `hook_started` / `hook_response` are emitted, but the
  `hook_callback` request never arrives; the callback body does not execute.
- **Observed:** 0.3.154.
- **Depends on it:** session naming goes through the SuperOne `session_rename`
  tool instead of a hook.
- **Guard:** unguarded; re-test before relying on in-process SessionStart hooks.

## Messages

### Typed messages may not be emitted, untyped ones may be

- **Behavior:** A message type in `sdk.d.ts` is not proof the runtime sends it
  (`session_state_changed` was typed long before it was sent), and the runtime
  sends messages and fields that are not declared: `system/model_fallback`,
  `active_goal`, `command_lifecycle`, `tool_use_id` on `system/task_updated`,
  and the mods messages `system/ui_log {plugin, text}`,
  `system/ui_toast {plugin, text, timeout_ms}` and
  `system/ui_status {plugin, text | null}`.
- **Observed:** 0.2.114 (`session_state_changed`), 0.3.232–0.3.284
  (`model_fallback`), 0.3.284 (the others), 0.3.287 (`ui_*`).
- **Depends on it:** `packages/shared/src/model-fallback-wire.ts` reads fallback
  fields defensively; both mappers handle `active_goal` (→ `session_goal`);
  desktop `claude-query.ts` handles `command_lifecycle` and reads `tool_use_id`
  on `task_updated`; `packages/claude/src/plugin-notice-wire.ts` maps `ui_*`
  (→ `plugin_notice`).
- **Guard:** verify new subscriptions with a trace before relying on them.

### Task tools carry the real id only in the result

- **Behavior:** `TaskCreate` input has no id; the SDK-assigned id is only in the
  tool result's `tool_use_result.task.id`, and `TaskUpdate.taskId` refers to it.
- **Observed:** 0.3.142.
- **Depends on it:** `extractTaskCreateTodo` in desktop `claude-query.ts`.
- **Guard:** unguarded at extraction; `apps/desktop/src/main/remote-control-service.test.ts`
  covers the consumer side.

## Mods

Claude Code mods (2.1.287+) are plugins whose `hooks/hooks.json` names a hooks
module that runs inside the CLI process. Upstream docs:
<https://code.claude.com/docs/en/plugins/mods/overview>.

### Installed mods run in SDK sessions

- **Behavior:** Mods are on by default and load with the user's plugins, so
  `settingSources` with `user` runs them in every SuperOne session. Their hooks
  run; nothing they draw (panes, the band above the prompt, replaced rows)
  reaches an SDK host. What reaches it: `ui_log` / `ui_toast` / `ui_status`
  (raised in `session.start` they arrive before `system/init`), and the effects
  of their hooks. The CLI writes `.claude-plugin/types/` into the plugin
  directory when it loads one.
- **Observed:** 0.3.287 live probe.
- **Depends on it:** `plugin_notice` mapping in both mappers.
- **Guard:** `apps/desktop/src/main/agent/claude-query.test.ts`,
  `packages/claude/src/plugin-notice-wire.test.ts`.

### A mod can approve a tool call without `canUseTool`

- **Behavior:** A `tool.check` hook answering `{ decision: 'allow' }` runs the
  call with no `can_use_tool` request, under `permissionMode: 'default'`.
  SuperOne's approval prompt never appears for it.
- **Observed:** 0.3.287 live probe (`touch` ran; `canUseTool` was not called).
- **Depends on it:** nothing; the user installed the mod. Upstream documents it.
- **Guard:** unguarded.

### A mod can start a turn

- **Behavior:** `$.prompt.submit` after a `result` starts a turn with no host
  input: `command_lifecycle`, a second `system/init`, assistant frames, then its
  own `result`.
- **Observed:** 0.3.287 live probe.
- **Depends on it:** the self-started turn path in desktop `claude-query.ts`
  (`resultSeen || !turnMessageId` mints a message) and the ambient turn in
  `packages/claude/src/claude-live-session.ts`, the same paths a background
  task's wake takes.
- **Guard:** `apps/desktop/src/main/agent/claude-query.test.ts` (a turn a mod
  submits after the result).

### A hooks module that fails to load is not in `plugin_errors`

- **Behavior:** A hooks module the CLI refuses at load (for example a
  `turn.step` hook that is not an async generator) leaves the plugin in
  `plugins[]` with no `plugin_errors` entry. The reason is only in the debug log.
- **Observed:** 0.3.287 live probe.
- **Depends on it:** nothing; SuperOne can only show what `plugin_errors` reports.
- **Guard:** unguarded.

## MCP Apps

### The host flag works only in the spawn environment

- **Behavior:** The CLI advertises the MCP Apps extension to servers, returns
  tool `_meta.ui` from `mcpServerStatus` and hides app-only tools from the
  model only when `CLAUDE_CODE_MCP_APPS_HOST=true` is in the spawn env. The
  same key in `settings.env` has no effect. Tool annotations arrive as
  `readOnly` / `destructive` / `openWorld`, not the MCP `*Hint` names.
  Runtime `serverInfo` also preserves `title` and `icons` (Bits & Bolts,
  2026-10-01), although the SDK type declares only name/version.
- **Observed:** 0.3.285, live fixture server (`server/discover` precedes
  `initialize`).
- **Depends on it:** `packages/claude/src/mcp-apps.ts#withMcpAppsHostEnv`, used
  by desktop `claude-query.ts#buildClaudeOptions`, `run-sdk-turn.ts` and
  `claude-live-session.ts`; `toMcpToolDescriptor` maps the annotations.
- **Guard:** `packages/claude/src/mcp-apps.test.ts`;
  `apps/desktop/scripts/check-claude-mcp-apps.ts` (live).

### MCP results are post-processed, and subagents keep only `_meta`

- **Behavior:** A model-turn MCP result reaches the host as top-level
  `tool_use_result = { content, structuredContent, _meta }`, where `content` is
  a string (the JSON of `structuredContent` when present), so the server's
  text blocks are lost. Inside a subagent `tool_use_result` is only a
  size-capped `{ _meta }`; the `tool_result` block text is the only content.
- **Observed:** 0.3.285, recorded turn with a direct and an async subagent call.
- **Depends on it:** `claudeMcpToolResult` in `packages/claude/src/mcp-apps.ts`
  (falls back to the block content; no `structuredContent` for subagent rows).
- **Guard:** `apps/desktop/src/test/integration/claude-mcp-apps-backend.test.ts`
  (recording `claude-mcp-apps.sdk.json`).

### `mcp_call` has no visibility check and reports `isError` as a failure

- **Behavior:** The internal `mcp_call` control request runs any tool,
  including model-only ones, without `canUseTool`. A result with `isError`
  rejects the request with `control_request_failed`, indistinguishable from
  "could not run". An `AbortSignal` sends `control_cancel_request`, and the
  server gets `notifications/cancelled`.
- **Observed:** 0.3.285, live fixture server.
- **Depends on it:** the dispatch gate in
  `packages/runtime/src/mcp-apps/provider-rpc.ts` enforces app visibility
  before the provider; `createClaudeMcpAppsProvider` reports a rejected call
  and an abort after dispatch as `unknown_outcome`.
- **Guard:** `CLAUDE_MCP_CALL_VERIFIED_SDK` is pinned to the SDK dependency by
  `packages/claude/src/mcp-apps.test.ts`; rerun the live check on a bump.

### OAuth with a host redirect needs a reconnect

- **Behavior:** `mcpAuthenticate(server)` without a redirect URI runs the CLI's
  own localhost listener and reconnects after the callback. With a host
  redirect URI (`redirectScheme: 'custom'`), `mcpSubmitOAuthCallbackUrl` stores
  the token but the server stays `needs-auth` until `reconnectMcpServer`.
  Neither method is in the public `Query` type.
- **Observed:** 0.3.285, fixture OAuth server.
- **Depends on it:** `createClaudeMcpAppsProvider` `authenticate` /
  `submitAuthCallback`; desktop `apps/desktop/src/main/mcp-apps/auth.ts` relays
  the callback for remote nodes.
- **Guard:** `apps/desktop/src/main/mcp-apps/provider-auth.test.ts`;
  `apps/desktop/scripts/check-mcp-apps-oauth.ts` (live).

## Warm start

### Warmup reuse key

- **Behavior:** A pre-spawned process can take in-place changes (`setModel`,
  `setPermissionMode`, `applyFlagSettings`) but not spawn-time options (`cwd`,
  `env`, `toolConfig`, `resume`, `sessionId`, `forkSession`).
- **Observed:** 0.3.x; `toolConfig` drift hit on 2026-06-12.
- **Depends on it:** `apps/desktop/src/main/agent/warmup-manager.ts#keyOf`, a
  hand-kept list of spawn-time options. A new spawn-time option must be added.
- **Guard:** `apps/desktop/src/main/agent/warmup-manager.test.ts`.
