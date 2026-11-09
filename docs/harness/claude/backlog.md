# Claude Agent SDK backlog

Unused upstream capabilities and gaps, and the decision on each. Decisions:
`open`, `adopt` (link the upgrade doc that lands it), `rejected` (keep the
reason). Ledger rows: [api-surface.md](api-surface.md).

## Capabilities

| # | Capability | Since | Benefit | Cost / risk | Decision |
|---|---|---|---|---|---|
| 1 | `system/informational` messages | 0.3.283 (sent during turns) | Shows warnings and notices the CLI raises, such as hook failures and block reasons | Shared plaintext system rows on desktop/mobile and both host mappers | adopt ([0.3.318](upgrades/0.3.318.md)) |
| 2 | `plugin_errors` on `system/init` | 0.3.283 | Explains why a plugin did not load instead of it silently missing | Small; needs a place in plugin settings or an init notice | adopt ([0.3.287](upgrades/0.3.287.md)): transcript error notice. A hooks module that fails to load is not reported there |
| 3 | `./core` entry point | 0.3.282 | Smaller SDK load in the main process | Must confirm it covers `startup`, `forkSession`, `getSubagentMessages`; uses our installed zod and MCP SDK | open |
| 4 | `prewarm()` / `SpareProcess.claim()` | 0.3.282 (alpha) | Warm a process before cwd is known; could replace `WarmupManager.keyOf`'s hand-kept list | Alpha API; `ClaimOptions` covers only some options, so the keyed pool stays for the rest | open, wait for stable |
| 5 | `canUseTool` `options.mcpServer.source === 'sdk'` | ≤0.3.278 | Trust SuperOne tools by origin instead of the `mcp__superone__` name prefix | `allowedTools` admission still matches by name | open |
| 6 | `result.startup_failure_reason` | ≤0.3.278 | Specific error UI for startup failures (19 reasons as of 0.3.293) instead of generic text | Mapping table in `result-failure.ts` | open |
| 7 | `conversation_reset` | 0.3.281 (fields) | Follow `/clear` and plan-exit resets to the new conversation id and reset the title | Needs a session-level transcript switch | open |
| 8 | `system/permission_denied` | — | Live notice when a tool is auto-denied, instead of reading `result.permission_denials` after the turn | Low value while denials already show at turn end | open |
| 9 | `system/memory_recall`, `system/thinking_tokens` | — | Recalled-memory row; live thinking-token estimate | Cosmetic | open |
| 10 | `thinking.display: 'highlights'` | ≤0.3.278 | Highlighted thinking | Only works on Anthropic-hosted models; third-party providers get nothing | rejected |
| 11 | `usage_EXPERIMENTAL_…()` | ≤0.3.278 | Structured `/usage` data | Marked experimental; `claude-usage-service` already covers plan usage | rejected |
| 12 | Draw mod UI (panes, the band above the prompt) | 0.3.287 (2.1.287) | Mods' panes, controls, transcript rewrites and `Client` parts in SuperOne, as Claude Desktop shows them | Rides an undeclared control protocol through `Query.request` / `setUiHost` (see [contracts](contracts.md#mod-ui-rides-a-private-control-protocol)); an SDK bump can break it silently, so each upgrade replays the recordings | adopt ([features/claude-mods.md](../../features/claude-mods.md)) |
| 14 | `ui_read_selection` mod host request | 0.3.289 (native schema observed) | Lets a mod read the selection on a remote surface | Needs host request mapping and selection capture on desktop and phone | open |
| 13 | `get_task_output` control request | 0.3.287 | Live tail of a background shell or Monitor task without reading its output file | No Query wrapper | open |
| 15 | Subagent ids: `agent_id` on messages, `parent_task_id` and `run_id` on task events, `subagent_type` on `background_tasks_changed` entries (0.3.293) | 0.3.292 | Attribute frames and tasks to a subagent without the inline block tree, and drop late frames of an earlier run | Inline subagent frames already carry the right `parent_tool_use_id`, and resume re-keying needs only `task_id` ([0.3.292](upgrades/0.3.292.md)); worth it for tasks whose launching block never reaches the transcript | open |
| 16 | `ui_prompt_autocomplete` mod host request | 0.3.292 (native schema observed) | A mod's completions in the SuperOne composer | Schema is `@internal`; a per-keystroke ask merged into the composer's menus, local sessions only (like G6) | open, wait for the protocol to become public |
| 17 | `SDKRateLimitInfo.overageEnabled` | 0.3.295 | Tell a usage-limit warning apart for accounts with extra usage on, before overage starts | `rate_limit_event` handling reads only `resetsAt` / `isUsingOverage` today | open |
| 18 | Settings hook `onFailure: 'block'` | 0.3.296 | Fail-closed hooks in the settings.json hook editor | Hook editor schema and shared hook types change | open |
| 19 | Elicitation `property_order` | 0.3.299 | Field order for transports without JSON key order | Desktop IPC and the relay carry JSON, which keeps the server's order already | rejected |
| 20 | sdk-server `tools[].permission_policy` (`always_ask` / `always_deny`) | 0.3.301 | Ask or deny individual SuperOne host tools natively, even under `bypassPermissions` | Claude-only; the CLI lowers it to the same ask/deny rules the MCP settings page writes for user servers, which cannot use it (they load through `settingSources`, and stdio has no policy) | open; user servers use settings rules ([0.3.302](upgrades/0.3.302.md)) |
| 21 | `BUILTIN_TOOL_NAMES` / `LEGACY_TOOL_NAME_ALIASES` | 0.3.301 (alpha) | Validate built-in tool names in permission rules and tool settings | Alpha and documented as incomplete; SuperOne edits only `mcp__` rules today | open |
| 22 | `reloadPlugins({ addPlugins })` | 0.3.301 | Load a plugin folder into a running session without restart | Plugin dev folders already load at spawn; refused on remote and sandboxed sessions | open |
| 23 | `get_usage` `recommendations` / `fix` | 0.3.305 | Show what drives usage and offer the CLI's one-tap fix in the usage meter | `fix` sends user messages (`/effort`, a prompt) into the session; needs a confirm step | open |
| 24 | `command_lifecycle` `wakeup_source` / `scheduled_for` | 0.3.307 | Label which scheduled wakeup or task started a turn | `command_lifecycle` is still undeclared in `sdk.d.ts` | open |
| 25 | `getContextUsage()` `mcpInstructions`, `pluginId`, `path` | 0.3.304 | Per-server MCP instruction cost and links to the agent/skill file in the context breakdown | Absent on remote/forwarded replies; stdio only | open |
| 26 | AskUserQuestion `unanswered` annotations | 0.3.312 | Distinguish skip, chat reply and dismiss | Shared question outcomes and init-capability gating on both runtimes; answers text still required | open, deferred from [0.3.318](upgrades/0.3.318.md) |
| 27 | ModelUsage cache-lifetime counters | 0.3.311 | Per-model 5-minute and 1-hour cache-write accounting | Optional, potentially partial counts; already included in the aggregate | open, deferred from [0.3.318](upgrades/0.3.318.md) |
| 28 | `result.credential_expires_at` | 0.3.318 | Stored login expiry reminder | Account-domain binding; can be estimated and is not an authentication verdict | open, deferred from [0.3.318](upgrades/0.3.318.md) |
| 29 | File-tool boundaries and auto-mode Settings | 0.3.312–0.3.318 | Host read exemptions and tighter file writes | Not a shell/MCP/Hook sandbox; write boundary disables worktree tools; keep defaults unchanged | open, deferred from [0.3.318](upgrades/0.3.318.md) |
| 30 | Private Mod UI `ui_attach.draws` and `ui_prompt_paint` | Native 2.1.318 observed | Backdrop/mobile input opt-ins and prompt decoration | Host does not advertise these; absent `draws` preserves existing behavior. Needs explicit shared UI support before enabling | open |
| 31 | `mcp_call.check_permissions` | 0.3.321 | Run MCP Apps View calls through the same permission rules and hooks as a model call | View calls are host-dispatched after the visibility gate. Turning this on asks `canUseTool` and can refuse the call before the server sees it. Needs `mcp_call_check_permissions_v1` | open, deferred from [0.3.321](upgrades/0.3.321.md) |
| 32 | `set_has_subscribers` | 0.3.321 | Shorten stream-event hold while nobody is watching the transcript | Only applies when `CLAUDE_CODE_STREAM_EVENT_HOLD_MS` is set, which SuperOne does not set. A process starts as watched | open, deferred from [0.3.321](upgrades/0.3.321.md) |
| 33 | `permissions.denyInsteadOfPrompting` | 0.3.321 | Deny tool prompts instead of asking, including `canUseTool` | Stops the permission, question and plan bridges. User/managed settings only | rejected: SuperOne answers prompts through `canUseTool` |
| 34 | `system/ui_notify` and `ui_notify_cancel` | Native 2.1.321 | Scheduled or keyed mod notifications, and withdrawing one | New plaintext notice shape (title, source, key, delay). Current mods still use `ui_log` / `ui_toast` | open |

## Integration gaps

Places where SuperOne uses an interface in one runtime but not another, or
declares less than upstream offers.

| # | Gap | Effect | Decision |
|---|---|---|---|
| G1 | Remote node has no authorization `PreToolUse` hook (it does have a Stop hook) | `denySubagentSessionRename` does not run on remote nodes, so a subagent can call main-thread-only SuperOne tools there | open |
| G3 | Remote node does not forward `skipTranscript` / `isBackgrounded` / `spawnDepth` on `task_started` | Background and nested subagents render differently from desktop | open |
| G4 | Shared `HookEventName` lacks `DirectoryAdded`, `MessageDisplay`, `PreModelSwitch`, `PostModelSwitch` | The settings.json hook editor cannot offer those events | open |
| G5 | Mod commands registered `immediate: true` queue behind a running turn | The SDK command list carries no `immediate` flag, so SuperOne cannot tell them from other commands | open, wait for the flag in `initializationResult().commands` |
| G6 | Remote-node composers do not relay `prompt.edit` | A mod's live draft rewrite works only for local desktop sessions; a keystroke per network round trip was judged too costly | open |
| G7 | Mod review and plugin options are local only | The Plugins page shows the hooks review and the `userConfig` form only for this Mac's plugins | open |

SDK 0.3.289 adds an optional opaque `tag` to informational messages (item 1)
and per-model `autoCompactWindow` settings. Both retain their existing handling;
no host UI is added in this upgrade.
