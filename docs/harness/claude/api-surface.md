# Claude Agent SDK API surface

Ledger version: `0.3.289` · Check: `bun scripts/harness-api-inventory.ts claude`

Every upstream interface of `@anthropic-ai/claude-agent-sdk` and how SuperOne uses it. Runtimes: **desktop** (local sessions), **node** (remote node CLI through `packages/claude`), **probe** (catalog queries with `maxTurns: 0`). Status vocabulary and row format: [docs/harness/README.md](../README.md#ledger-api-surfacemd). Undeclared messages and methods SuperOne relies on are in [contracts.md](contracts.md#typed-messages-may-not-be-emitted-untyped-ones-may-be).

## Entry points

Subpath exports in the package manifest.

| Name | Status | Usage | Code |
|---|---|---|---|
| `.` | used | Every SDK import comes from the main entry: `query`, `startup`, `forkSession` and `getSubagentMessages` as values, plus types. Desktop keeps it external to the main bundle (vite `mainExternal`), and the node npm pack keeps it external so npm installs the platform binaries. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `apps/cli/scripts/pack-npm.ts` |
| `./bridge` | n/a | CCR remote-session bridge (`attachBridgeSession`, `createCodeSession`); SuperOne runs its own node RPC instead of Anthropic-hosted sessions. | — |
| `./browser` | n/a | Browser-side WebSocket/SSE client for CCR sessions; our renderer never talks to the SDK directly. | — |
| `./core` | unused | A slimmer re-export (`query`, `startup`, constants, `tool`) without the session-file helpers; the hot `query`/`startup` imports could load from it, but `forkSession`/`getSubagentMessages` still need `.`. | — |
| `./extract` | n/a | `extractFromBunfs` is for bun `--compile` executables; desktop is Electron and the node CLI is an esbuild/npm Node bundle. electron-builder.yml and afterPack.cjs only exclude or prune the `claude-agent-sdk-<platform>` packages and never mention extract. | — |
| `./sdk-tools` | unused | Types-only tool input/output schemas; we type tool inputs ourselves, and nothing (including build config) imports it. | — |
| `./sdk-tools.js` | unused | Alias of `./sdk-tools` (types only); not imported anywhere. | — |

## Exports

Runtime exports of `sdk.d.ts`: functions, classes and constants. Types are not ledgered.

| Name | Status | Usage | Code |
|---|---|---|---|
| `AbortError` | unused | No `instanceof AbortError` checks; interrupts are tracked by our own flags (`getInterrupted`, `signal.aborted`). | — |
| `EXIT_REASONS` | n/a | SessionEnd hook reason enum; we register only a PreToolUse hook. | — |
| `HOOK_EVENTS` | unused | Unused; we duplicate it in `packages/shared/src/agent-types.ts` (`HookEventName`) and `HookEditorDialog.tsx`, and both copies are already missing PreModelSwitch, PostModelSwitch, DirectoryAdded and MessageDisplay. | — |
| `InMemorySessionStore` | unused | Reference `SessionStore` for transcript mirroring; SuperOne keeps its own SQLite transcript. | — |
| `ORG_POLICY_LIMIT_PREFIXES` | unused | Unused; org-disabled errors fall through to the generic prose classifier in `packages/shared/src/agent-error.ts`. | — |
| `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` | unused | Only matters for custom string system prompts; we use the `claude_code` preset plus `append`. | — |
| `USAGE_LIMIT_ERROR_PREFIXES` | unused | Unused; we detect limits from `rate_limit_event` status `rejected`, the typed assistant error and the `/usage limit/` regex in `packages/shared/src/agent-error.ts`, not the SDK prefixes. | — |
| `USAGE_TRANSITION_PREFIXES` | unused | Would identify "now using usage credits" notices; we show overage state from `rate_limit_event.isUsingOverage` instead. | — |
| `USAGE_WARNING_PREFIXES` | unused | Would identify "You've used / You're close to" warnings; we show `rate_limit_event.utilization` instead. | — |
| `createSdkMcpServer` | unused | Unused; we build `{type:'sdk', name, instance: new McpServer()}` by hand in `superone-mcp-server.ts` (desktop) and `host-action-mcp-server.ts` (node). | — |
| `deleteSession` | unused | Unused; side-chat cleanup deletes the forked `.jsonl` directly with `rmSync` (`side-chat.ts`). | — |
| `filterEscalatingDefaultMode` | unused | Pairs with `resolveSettings` to trust-filter `defaultMode`; we don't resolve settings through the SDK. | — |
| `foldSessionSummary` | n/a | Only for writing custom `SessionStore` adapters, and we have none. | — |
| `forkSession` | used | Shared `forkClaudeTranscript` forks the transcript (desktop passes `upToMessageId` from `forkAnchorId`; node always does a full copy) and then moves the `.jsonl` under the target cwd's project slug. It serves desktop fork, side-chat and node `session.fork`. | `packages/claude/src/fork-session.ts`, `apps/desktop/src/main/session/backends/claude-fork.ts`, `apps/cli/src/session/harness-fork.ts` |
| `getSessionInfo` | unused | Unused; we check transcript health ourselves in `packages/claude/src/transcript-store.ts` (`inspectClaudeTranscript`). | — |
| `getSessionMessages` | unused | Unused; `SESSIONS_LOAD_MESSAGES` hand-parses the JSONL in `apps/desktop/src/main/session-history.ts`. | — |
| `getSubagentMessages` | used | Desktop reads a finished subagent's full transcript, with `sessionId`/`agentId` parsed from the task `output_file` path. | `apps/desktop/src/main/agent/subagent-transcript.ts` |
| `importSessionToStore` | unused | Would backfill a `SessionStore`; we don't use one. | — |
| `listSessions` | unused | Unused; `session-history.ts` has a hand-rolled `listSessions` that nothing calls. | — |
| `listSubagents` | unused | Unused; subagent ids come from `task_*` messages and output-file paths instead. | — |
| `prewarm` | unused | Alpha `SpareProcess` whose `claim()` can overlay cwd/model; it would allow a spare process shared across sessions, but we use `startup()` keyed on the full options. | — |
| `query` | used | The core entry: long-lived streaming sessions (desktop `createSessionQuery`, node `ClaudeLiveSession`), one-shot `runClaudeSdkTurn`, and the metadata probes (desktop `CONNECT_CLAUDE`, `claude-models.fetchModels`, `fetchClaudeModels`). | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `apps/desktop/src/main/index.ts` |
| `renameSession` | unused | Titles live in SuperOne SQLite (`session_rename` tool), not in the Claude transcript. | — |
| `resolveSettings` | unused | Unused; we read settings files ourselves (`packages/runtime/src/fs/hooks-config.ts`, `claude-preferences-service.ts`). | — |
| `startup` | used | Desktop `WarmupManager.prewarm` pre-spawns a `WarmQuery` slot (10 min TTL); `createSessionQuery` consumes it when the `keyOf` keys match. | `apps/desktop/src/main/agent/warmup-manager.ts`, `apps/desktop/src/main/agent/claude-query.ts` |
| `tagSession` | unused | Would tag transcripts; we tag SuperOne sessions in our own DB. | — |
| `tool` | unused | Unused; tools are registered through `McpServer.registerTool` on our own MCP servers. | — |

## Options

Fields of `Options` passed to `query()` / `startup()`. "(warmup key)" marks fields in `WarmupManager.keyOf`.

| Name | Status | Usage | Code |
|---|---|---|---|
| `abortController` | used | Desktop takes it from the backend start options, or `createSessionQuery`/warmup create one to kill the spawn; node chains it to the turn or live-session signal. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `apps/desktop/src/main/agent/warmup-manager.ts` |
| `additionalDirectories` | used | Workspace folders on desktop and node. Desktop changes them live via `applyFlagSettings({permissions:{additionalDirectories}})`; node restarts the live session when the set changes (warmup key). | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `agent` | unused | Would run the main thread as a named agent. | — |
| `agents` | unused | Would define subagents in code; subagents come from filesystem settings via `settingSources`. | — |
| `agentProgressSummaries` | used | `true` on desktop and node, which gives `task_progress.summary` for subagent rows. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `packages/claude/src/run-sdk-turn.ts` |
| `allowDangerouslySkipPermissions` | used | Always `true` on desktop; on node `applyRootPermissionGuard` sets it `false` under root without a sandbox opt-in (warmup key as `bypass`). | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `packages/claude/src/root-permission-guard.ts` |
| `allowedTools` | partial | Desktop only: lists the static host-owned SuperOne MCP tools so `auto` mode skips the classifier round-trip; node relies on the `canUseTool` short-circuit instead. | `apps/desktop/src/main/agent/claude-query.ts` |
| `betas` | unused | Would enable API betas; we only read `betas` from the init message. | — |
| `canUseTool` | used | Permission, AskUserQuestion and ExitPlanMode bridge. Desktop uses `createCanUseTool` wrapped with a pause timer; node uses `buildCanUseTool` / `buildLiveOptions`, which auto-allow host-owned SuperOne tools. | `apps/desktop/src/main/agent/claude-permissions.ts`, `packages/claude/src/claude-live-session.ts`, `packages/claude/src/run-sdk-turn.ts` |
| `continue` | unused | We always resume by explicit session id. | — |
| `cwd` | used | Session cwd (project or worktree) on every runtime; probes use the project or probe cwd (warmup key). | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `packages/claude/src/fetch-models.ts` |
| `debug` | unused | Unused; desktop forwards stderr through its custom spawn (which also honours `DEBUG_CLAUDE_AGENT_SDK`, `claude-spawn.ts`). | — |
| `debugFile` | unused | Would write CLI debug logs to a file. | — |
| `disallowedTools` | unused | Would hard-block built-in tools. | — |
| `effort` | used | Per-session effort (`low`…`max`) on desktop and node; node drops invalid values (warmup key). | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `packages/claude/src/run-sdk-turn.ts` |
| `enableFileCheckpointing` | used | `true` on desktop and node; desktop uses it for `rewindFiles` and checkpoint capture. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `env` | used | Desktop passes `buildSafeEnv(custom)` only when provider overrides exist; node merges `process.env` with provider/auth env; probes pass provider env (warmup key). Desktop adds `CLAUDE_CODE_PLUGIN_DIRS` and `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` for the Claude preference "Mod development folders". | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `apps/desktop/src/main/session/backends/claude-backend.ts`, `packages/claude/src/mod-surface/dev-folders.ts` |
| `executable` | n/a | We spawn the native platform binary via `pathToClaudeCodeExecutable`, not `cli.js` under node/bun. | — |
| `executableArgs` | n/a | Same reason: there is no JS runtime between us and the native binary. | — |
| `extraArgs` | used | `{'replay-user-messages': null}` on desktop and node, so user echoes and replay UUIDs arrive (checkpoints, queued-turn detection). | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `packages/claude/src/run-sdk-turn.ts` |
| `fallbackModel` | unused | Would auto-fall back on overload; we only render the SDK's model-fallback wire messages. | — |
| `forkSession` | unused | Plumbed through `buildClaudeOptions` (warmup key), but `ClaudeBackend` never sets it; forks use the `forkSession()` function instead. | — |
| `forwardSubagentText` | used | `true` on desktop and node, so nested subagent text and thinking render in the transcript. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `packages/claude/src/run-sdk-turn.ts` |
| `hooks` | partial | Desktop only: a PreToolUse `denySubagentSessionRename` hook denies main-thread-only SuperOne tools inside subagents; node registers none. | `apps/desktop/src/main/agent/claude-query.ts` |
| `includeHookEvents` | unused | Would stream hook lifecycle for all events; desktop already maps `hook_started`/`hook_response`, but without this flag it only receives SessionStart and Setup hooks. | — |
| `includePartialMessages` | used | `true` on desktop and node, for token streaming via `stream_event` (warmup: no). | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `packages/claude/src/run-sdk-turn.ts` |
| `loadTimeoutMs` | n/a | Only applies with `sessionStore`. | — |
| `managedSettings` | unused | Would let SuperOne enforce policy settings on the spawned CLI. | — |
| `maxBudgetUsd` | unused | Would cap a session's spend in USD. | — |
| `maxThinkingTokens` | deprecated | Deprecated upstream in favor of `thinking`, which we use. | — |
| `maxTurns` | partial | Set to `0` only in the metadata probes (`/help` prompt), never in chat sessions. | `packages/claude/src/fetch-models.ts`, `apps/desktop/src/main/agent/claude-models.ts`, `apps/desktop/src/main/index.ts` |
| `mcpServers` | used | Desktop passes `{superone: in-process sdk McpServer}`; node passes the merged disk MCP plus the host-action sdk server. | `apps/desktop/src/main/agent/claude-query.ts`, `apps/cli/src/session/claude-turn-runner.ts` |
| `model` | used | Desktop and the node live session map it via `resolveMappedClaudeModelId`; `runClaudeSdkTurn` passes the raw value (warmup key). | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `packages/claude/src/run-sdk-turn.ts` |
| `onElicitation` | partial | Desktop only: MCP elicitation goes to the UI through `createOnElicitation`; node doesn't pass it. | `apps/desktop/src/main/agent/claude-query.ts`, `apps/desktop/src/main/agent/claude-permissions.ts` |
| `onUserDialog` | unused | Would render CLI dialogs such as `refusal_fallback_prompt`. | — |
| `outputFormat` | unused | Would return structured JSON results. | — |
| `pathToClaudeCodeExecutable` | used | Desktop uses `resolveHarnessRuntime('claude')` as a hard gate; node uses a managed harness, then the SDK-bundled binary, then `SUPERONE_CLAUDE_BINARY` (warmup key as `cli`). | `apps/desktop/src/main/agent/claude-query.ts`, `apps/cli/src/session/claude-turn-runner.ts`, `packages/claude/src/claude-live-session.ts` |
| `perTaskStopAffordance` | partial | Desktop only (`true`): the status bar stops tasks individually, so Stop aborts only the current turn and spares background tasks; node doesn't declare it. | `apps/desktop/src/main/agent/claude-query.ts` |
| `permissionMode` | used | Desktop maps `agent` to `default`; node applies the root guard (`bypassPermissions` becomes `acceptEdits` under root); probes use `default` or `bypassPermissions` (warmup key). | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `apps/cli/src/session/claude-turn-runner.ts` |
| `permissionPromptToolName` | unused | We answer permissions through `canUseTool`. | — |
| `permissionPrompts` | partial | Desktop only: `'none'` when `unattended` (automation sessions from `runAutomationSession`); node never sets it. | `apps/desktop/src/main/agent/claude-query.ts`, `apps/desktop/src/main/agent/agent-service.ts` |
| `persistSession` | partial | Set to `false` only in the metadata probes, so they leave no transcript. | `packages/claude/src/fetch-models.ts`, `apps/desktop/src/main/agent/claude-models.ts`, `apps/desktop/src/main/index.ts` |
| `planModeInstructions` | unused | Would replace the plan-mode workflow text. | — |
| `pluginDelivery` | unused | Only matters with the `plugins` option; plugins currently load from settings. | — |
| `plugins` | unused | Would load local plugin dirs per session; we only read `plugins` from the init message. Mod development folders use `CLAUDE_CODE_PLUGIN_DIRS` instead, which also hot-reloads. | — |
| `projectConfigRoot` | unused | Would let worktree sessions take project config (hooks, `.mcp.json`, `.claude`) from the main checkout. | — |
| `promptSuggestions` | used | `true` on desktop and node; desktop emits `prompt_suggestion` events. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `packages/claude/src/run-sdk-turn.ts` |
| `resume` | used | Desktop resumes by `providerSessionId`; node parses the `claude-session:<id>` token (warmup key). | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `apps/cli/src/session/claude-turn-runner.ts` |
| `resumeDropsTurn` | unused | Plumbed in desktop `buildClaudeOptions` (warmup key) and in `ClaudeLiveSession`/`runClaudeSdkTurn`, and refusal detection exists, but no production caller sets it. | — |
| `resumeSessionAt` | unused | Plumbed like `resumeDropsTurn` (warmup key) and used as the truncating-resume target, but no production caller sets it. | — |
| `sandbox` | used | Desktop enables it from `sandboxInfo` when the platform supports it; the node live session enables it for `sandboxMode` on/auto (`runClaudeSdkTurn` omits it). Desktop changes it live via `applyFlagSettings` (warmup key). | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `sessionId` | unused | Plumbed through desktop `buildClaudeOptions` (warmup key), but `ClaudeBackend` never sets it; the SDK mints ids. | — |
| `sessionStore` | unused | Would mirror transcripts to an external store, for example to sync a node to desktop. | — |
| `sessionStoreFlush` | n/a | Only applies with `sessionStore`. | — |
| `settingSources` | used | `['user','project','local']` on desktop and node sessions; probes use the SDK default. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `packages/claude/src/run-sdk-turn.ts` |
| `settings` | used | Desktop and node pass `{env: providerSettingsEnv, bashEditDiffEnabled: true}`, so provider keys beat the settings-file env and Bash edits get file diffs. It is not in the warmup key (derived from `env`). | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `packages/claude/src/run-sdk-turn.ts` |
| `skills` | used | Enabled-skill allowlist, sent only when the user disabled some skills (desktop reads app prefs; node uses `resolveEnabledSkills`). | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `apps/cli/src/session/claude-turn-runner.ts` |
| `spawnClaudeCodeProcess` | partial | Desktop only (sessions plus the `fetchModels` probe): `makeClaudeSpawn` sets the argv0 process title and `windowsHide`, and pipes stderr to the log. | `apps/desktop/src/main/agent/claude-query.ts`, `apps/desktop/src/main/agent/claude-spawn.ts`, `apps/desktop/src/main/agent/claude-models.ts` |
| `stderr` | unused | Unused; desktop captures stderr inside its custom spawn, and node captures none. | — |
| `strictMcpConfig` | partial | Node only (`true`), with the merged disk plus host-action MCP allowlist; desktop leaves it off and lets the CLI load settings MCP. | `apps/cli/src/session/claude-turn-runner.ts` |
| `supportedDialogKinds` | unused | Needed together with `onUserDialog` to opt in to CLI dialogs. | — |
| `systemPrompt` | used | Preset `claude_code` plus `append` (`CLAUDE_SYSTEM_PROMPT_APPEND` and a per-session append) with `snapshot:false`, so a resumed session sees the current append. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `packages/claude/src/run-sdk-turn.ts` |
| `taskBudget` | unused | Plumbed in desktop `buildClaudeOptions` as `{total}`, but `ClaudeBackend` never supplies a value. | — |
| `thinking` | used | `{type:'adaptive', display:'summarized'}` on desktop and node. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `packages/claude/src/run-sdk-turn.ts` |
| `title` | unused | Titles are kept in SuperOne's DB. | — |
| `toolAliases` | unused | Would redirect built-in tool names (for example Bash) to our MCP tools on remote sandboxes. | — |
| `toolConfig` | used | `askUserQuestion.previewFormat` from the desktop app prefs or the node-local config (warmup key as `previewFormat`). | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/claude-live-session.ts`, `packages/claude/src/run-sdk-turn.ts` |
| `tools` | unused | Would restrict the built-in tool set. | — |
| `verbatimPrompts` | unused | Would skip `@path` and slash expansion for host-composed prompts; we don't set `client_composed` per message either. | — |

## Query methods

Methods of the `Query` returned by `query()`.

| Name | Status | Usage | Code |
|---|---|---|---|
| `accountInfo` | used | Reads the account's email, org, subscription and API provider during the desktop CONNECT_CLAUDE metadata probe. | `apps/desktop/src/main/index.ts` |
| `applyFlagSettings` | used | Changes a live desktop session's sandbox settings and `permissions.additionalDirectories` without restarting it. | `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `backgroundTasks` | unused | Would move foreground Bash or subagent tasks to the background (Ctrl+B). | — |
| `close` | used | Shuts down the desktop session query when it is released or rebuilt, and ends the desktop and node model probes. The node `ClaudeLiveSession` does not call it; it stops via `abortController`. | `apps/desktop/src/main/session/backends/claude-backend.ts`, `apps/desktop/src/main/agent/claude-models.ts`, `packages/claude/src/fetch-models.ts` |
| `getContextUsage` | used | Feeds the desktop context-usage meter (`ContextUsage.tsx`) with a per-category token breakdown, using the default `full` detail. | `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `initializationResult` | used | Waits for the init handshake in the model probes (desktop and node) and reads `available_output_styles` in the desktop CONNECT_CLAUDE probe. The mod surface reads `capabilities` for `ui_surface_v1` (see [contracts](contracts.md#mod-ui-rides-a-private-control-protocol)). | `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/agent/claude-models.ts`, `packages/claude/src/fetch-models.ts`, `packages/claude/src/mod-surface/mod-surface.ts` |
| `interrupt` | used | Desktop Stop button; waits for the ack with a deadline, reads `still_queued` from the receipt, and rebuilds the runtime if there is no ack. Node uses a per-turn AbortSignal instead. | `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `mcpServerStatus` | used | Lists MCP servers with their status and tools for the desktop MCP panel and the remote `getMcpServerStatus` command. Also feeds the MCP Apps catalog (tool `_meta.ui`, server status and runtime `serverInfo.title`/`icons`), refreshed lazily when a `mcp__` tool is not in it yet. | `packages/claude/src/mcp-apps.ts`, `apps/desktop/src/main/session/backends/claude-backend.ts`, `apps/cli/src/session/claude-turn-runner.ts` |
| `readFile` | unused | Would read a file through the CLI's Read permission gate. SuperOne reads files through its own workspace gateway. | — |
| `readMcpResource` | used | Fetches MCP Apps `ui://` View resources for the MCP Apps provider, desktop and node. `ui://` only. | `packages/claude/src/mcp-apps.ts`, `apps/desktop/src/main/session/backends/claude-backend.ts`, `apps/cli/src/session/claude-turn-runner.ts` |
| `reconnectMcpServer` | used | Reconnects an MCP server by name after its config is saved in the desktop MCP settings. | `apps/desktop/src/main/session/backends/claude-backend.ts`, `apps/desktop/src/main/agent/agent-service.ts` |
| `reinitialize` | unused | Would re-send `initialize` after a transport gap to get back pending `can_use_tool` and dialog requests. | — |
| `reloadOutputStyles` | unused | Would re-read the output-style directories in the middle of a session. | — |
| `reloadPlugins` | used | Reloads plugins from disk after a plugin install, toggle or option change (desktop Plugins page, node plugin RPCs), and on user request; the answer refreshes the slash list and a non-zero `error_count` shows a plugin notice. | `apps/desktop/src/main/session/backends/claude-backend.ts`, `apps/desktop/src/main/agent/agent-service.ts`, `apps/cli/src/session/claude-turn-runner.ts` |
| `reloadSkills` | unused | Would refresh the skill list without restarting. SuperOne passes `skills` at spawn instead. | — |
| `rewindFiles` | used | Desktop checkpoint restore and dry-run preview (`enableFileCheckpointing: true`), started from the renderer's rewind action. | `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `seedReadState` | unused | Would seed the Read cache so an Edit works after its Read was removed from context. | — |
| `setMaxThinkingTokens` | deprecated | Deprecated upstream in favor of the `thinking` option, set at spawn. | — |
| `setMcpPermissionModeOverride` | unused | Would pin a stricter per-MCP-server permission mode (`default`/`auto`). | — |
| `setMcpServers` | unused | Would replace the dynamic MCP server set live. SuperOne's `reloadMcpServers` is a no-op because the in-process SDK server reflects its tools on each turn. | — |
| `setModel` | used | Switches the model on a live desktop session, from the model picker and from each turn's `request.model`. | `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `setPermissionMode` | used | Changes permission mode on a live desktop session (plan toggle, mode picker, remote command); SuperOne's `agent` mode is sent as `default`. | `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `stopTask` | used | Stops a single background task from the desktop status bar (`ChatStatusBar` → `Session` stop-task command). | `apps/desktop/src/main/session/backends/claude-backend.ts`, `apps/desktop/src/main/session/session.ts` |
| `streamInput` | unused | Not called directly. Desktop and node pass a `MessageBridge` AsyncIterable as `prompt` instead (claude-query.ts, claude-live-session.ts). | — |
| `supportedAgents` | unused | Would list the session's subagents. SuperOne finds agents on disk instead. | — |
| `supportedCommands` | used | Gets the slash-command catalog in the desktop CONNECT_CLAUDE metadata probe. | `apps/desktop/src/main/index.ts` |
| `supportedModels` | used | Gets the model catalog in the desktop CONNECT_CLAUDE probe, the desktop `fetchModels`, and the node `fetchClaudeModels` (used by `claude-model-catalog`). | `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/agent/claude-models.ts`, `packages/claude/src/fetch-models.ts` |
| `toggleMcpServer` | used | Enables or disables an MCP server live when it is saved, deleted or toggled in the desktop MCP settings. | `apps/desktop/src/main/session/backends/claude-backend.ts`, `apps/desktop/src/main/agent/agent-service.ts` |
| `updateSettings` | unused | Would write `outputStyle` or `effortLevel` into the local or user settings files through the CLI's own writer. | — |
| `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` | unused | Would return structured `/usage` cost and plan rate-limit data. | — |

## Messages

Members of the `SDKMessage` union as `type` or `type/subtype`. Desktop maps them in `apps/desktop/src/main/agent/claude-query.ts`, the remote node in `packages/claude/src/agent-event-mapper.ts`.

| Name | Status | Usage | Code |
|---|---|---|---|
| `assistant` | used | Both mappers: top-level frame → `message_usage`, `message_timestamp`, `content_retracted` (via `supersedes`), tool_use `content_delta`. Subagent frames → text/thinking `content_delta` + `subagent_usage`. `<synthetic>` text is held as slash output. Also records error, request_id and model for the failure path. Legacy `map-sdk-message` emits only tool `started`. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts`, `packages/claude/src/map-sdk-message.ts` |
| `auth_status` | used | → `auth_status` event in both mappers. The chat-core reducer treats it as a no-op, so nothing renders. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts`, `packages/chat-core/src/reducer.ts` |
| `conversation_reset` | unused | Would let SuperOne mount a fresh transcript under `new_conversation_id` after /clear or plan exit, and reset the title. | — |
| `prompt_suggestion` | used | → `prompt_suggestion` event in both mappers, which fills the composer suggestions. Only sent when `promptSuggestions: true`, which is set on desktop and node. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts` |
| `rate_limit_event` | used | → `rate_limit` event in both mappers. `rejected` status plus `resetsAt` are stashed and attached to the next failing result (code `rate_limit`, `resetsAt`). | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts` |
| `result/error_during_execution` | used | Generic failure in both mappers → `message_error` with `errorInfo.subtype` (built by `buildClaudeResultFailure`). There is no subtype-specific UI kind, so it is classified by terminal reason, code or HTTP status. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts`, `packages/claude/src/result-failure.ts` |
| `result/error_max_budget_usd` | used | → `message_error` in both mappers. The chat-view presenter maps the subtype to the `budgetExhausted` kind. | `packages/claude/src/result-failure.ts`, `packages/chat-view/src/presenters/agent-error-presentation.ts` |
| `result/error_max_structured_output_retries` | used | Generic `message_error` in both mappers with `errorInfo.subtype`. It has no dedicated UI kind. | `packages/claude/src/result-failure.ts`, `packages/claude/src/agent-event-mapper.ts` |
| `result/error_max_turns` | used | → `message_error` in both mappers. The presenter maps the subtype to the `maxTurns` kind. | `packages/claude/src/result-failure.ts`, `packages/chat-view/src/presenters/agent-error-presentation.ts` |
| `result/success` | used | → `message_complete` with metadata (usage, modelUsage, cost, `queuedTurnCount`, permission denials, fork anchor), then `status_change` and a checkpoint flush. `is_error` or a rejected rate limit still routes it to `message_error`. Desktop also records usage deltas and resolves tool calls denied by a steer. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts`, `packages/claude/src/map-sdk-message.ts` |
| `stream_event` | used | Both mappers: → text/thinking/tool_use `content_delta`, `tool_input_delta`, `stream_message_start` / `stream_message_stop`, output `message_usage` / `subagent_usage`, and dead-stream retraction. Only sent with `includePartialMessages: true`, which is set on both. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts`, `packages/claude/src/map-sdk-message.ts` |
| `system/api_retry` | used | → `api_retry` event in both mappers. Also collects retry delays and the error code for the final `errorInfo.retries`. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts` |
| `system/background_tasks_changed` | used | Both mappers (plus the live session's tracker) replace the active background-task set, skipping `ambient` tasks, and may emit a deferred `idle`. No event of its own. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts`, `packages/claude/src/claude-live-session.ts` |
| `system/commands_changed` | used | Replaces the session's slash-command list (`session_commands`) when a mod registers or drops a command mid-session. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts` |
| `system/compact_boundary` | used | → `compact_boundary` event (trigger, pre/post tokens, duration) in both mappers. The desktop session stamps it into the transcript. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts`, `apps/desktop/src/main/session/session.ts` |
| `system/control_request_progress` | n/a | Only sent for client-originated `side_question` control requests, and SuperOne never sends one. | — |
| `system/elicitation_complete` | used | → `elicitation_complete` event in both mappers. The reducer clears `waitingElicitation`. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts`, `packages/chat-core/src/reducer.ts` |
| `system/files_persisted` | used | → `files_persisted` event in both mappers. The reducer treats it as a no-op. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts`, `packages/chat-core/src/reducer.ts` |
| `system/hook_progress` | used | → `hook_progress` event in both mappers, but the reducer ignores it. Needs `includeHookEvents`, which is not set, so only SessionStart/Setup hooks produce it. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts`, `packages/chat-core/src/reducer.ts` |
| `system/hook_response` | used | → `hook_complete` event (output, stdout/stderr, exit code, outcome) in both mappers, but the reducer ignores it. Without `includeHookEvents` it only arrives for SessionStart/Setup. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts`, `packages/chat-core/src/reducer.ts` |
| `system/hook_started` | used | → `hook_started` event in both mappers, but the reducer ignores it. Without `includeHookEvents` it only arrives for SessionStart/Setup. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts`, `packages/chat-core/src/reducer.ts` |
| `system/informational` | unused | Would show plaintext banners, e.g. a UserPromptSubmit hook's block reason, status lines, or command output. | — |
| `system/init` | used | → `session_init` event in both mappers (model, tools, MCP servers, slash commands, skills, agents, output styles, plugins, effort, fast mode) and a session-id callback. `plugin_errors` → `plugin_notice` error rows, once per error per runtime. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts` |
| `system/local_command_output` | used | → `slash_command_output` event in both mappers. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts` |
| `system/memory_recall` | unused | Would show an inline "Recalled from memory" row. | — |
| `system/mirror_error` | n/a | Only sent when a `SessionStore` transcript mirror is configured, and none is. | — |
| `system/model_refusal_fallback` | used | Via `mapModelFallbackWire` in both mappers → `model_fallback` event (outcome `swapped`), plus `content_retracted` for `retracted_message_uuids`. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts`, `packages/shared/src/model-fallback-wire.ts` |
| `system/model_refusal_no_fallback` | used | Via `mapModelFallbackWire` in both mappers → `model_fallback` event (outcome `declined`, no target model). | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts`, `packages/shared/src/model-fallback-wire.ts` |
| `system/notification` | unused | Would show loop-side toast notifications (key, priority, timeout). | — |
| `system/permission_denied` | unused | Would give a live advisory for auto-denied tool calls. Today only `result.permission_denials` is read. | — |
| `system/plugin_install` | n/a | Only sent for headless plugin installs with `CLAUDE_CODE_SYNC_PLUGIN_INSTALL`, which SuperOne does not set. | — |
| `system/session_state_changed` | used | Both mappers map `idle` → `status_change` idle, and `running` / `requires_action` → `status_change` streaming. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts` |
| `system/status` | used | → `status_indicator` event (compacting indicator, permissionMode, compact result/error) in both mappers. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts` |
| `system/task_notification` | used | → `task_notification` event (status, output file, summary, usage) in both mappers. Retires the background task and may emit a deferred `idle`. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts` |
| `system/task_progress` | used | → `task_progress` event (description, last tool, AI summary, usage) in both mappers. `summary` is filled because `agentProgressSummaries: true` is set on both. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts` |
| `system/task_updated` | used | Both mappers retire the task on `completed` / `failed` / `killed`. They emit `task_notification` for failed/killed only when a `tool_use_id` is present, and that field is not in the declared type. Desktop only: `patch.is_backgrounded` re-emits `task_started` with `isBackgrounded`. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts` |
| `system/task_started` | used | → `task_started` event in both mappers and registers non-ambient background tasks. Desktop also forwards `skipTranscript`, `isBackgrounded` and `spawnDepth`; node does not. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts` |
| `system/thinking_tokens` | unused | Would give a live thinking-token estimate for a spinner or pill during redacted thinking. | — |
| `system/worker_shutting_down` | n/a | Sent by the remote-control bridge worker on teardown, not by the local `query()` stream SuperOne consumes. | — |
| `tool_progress` | used | → `tool_progress` event (elapsed time, task id, subagent type, heartbeat, subagent retry) in both mappers. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts` |
| `tool_use_summary` | used | Both mappers treat `summary` as a `tool_result` `content_delta` for `preceding_tool_use_ids[0]`. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts` |
| `user` | used | Both mappers: tool_result blocks → `content_delta` tool_result; `<local-command-stdout>` → `slash_command_output`; uuid / replay → `checkpoint_captured`. Desktop only: string echoes open a new message for a queued turn. Legacy `map-sdk-message` emits tool completed/failed. | `apps/desktop/src/main/agent/claude-query.ts`, `packages/claude/src/agent-event-mapper.ts`, `packages/claude/src/map-sdk-message.ts` |

## Hook events

`HOOK_EVENTS`. Only in-process callbacks registered through `Options.hooks` count as use; hooks in users' settings files are theirs.

| Name | Status | Usage | Code |
|---|---|---|---|
| `ConfigChange` | unused | Would react to settings or config file changes. Listed only in the settings.json hook editor. | — |
| `CwdChanged` | unused | Would track working-directory changes. Listed only in the settings.json hook editor. | — |
| `DirectoryAdded` | unused | Would react to added working directories. Missing even from the shared `HookEventName` type. | — |
| `Elicitation` | unused | Would intercept MCP elicitations. SuperOne uses the `onElicitation` option instead. | — |
| `ElicitationResult` | unused | Would observe or override elicitation responses. | — |
| `FileChanged` | unused | Would watch file changes. Listed only in the settings.json hook editor. | — |
| `InstructionsLoaded` | unused | Would observe CLAUDE.md / instruction loading. | — |
| `MessageDisplay` | unused | Would transform displayed messages. Missing from the shared `HookEventName` type. | — |
| `Notification` | unused | Would capture CLI notifications for toasts. | — |
| `PermissionDenied` | unused | Would observe auto-denials. SuperOne reads `result.permission_denials` instead. | — |
| `PermissionRequest` | unused | Would decide permissions in a hook. SuperOne uses `canUseTool` instead. | — |
| `PostCompact` | unused | Would run after compaction. SuperOne uses `compact_boundary` / `status` messages instead. | — |
| `PostModelSwitch` | unused | Would observe model switches. Missing from the shared `HookEventName` type. | — |
| `PostToolBatch` | unused | Would run after a batch of parallel tool calls. | — |
| `PostToolUse` | unused | Would post-process tool results or inject context. | — |
| `PostToolUseFailure` | unused | Would handle failed tool calls. | — |
| `PreCompact` | unused | Would add custom instructions or veto before compaction. | — |
| `PreModelSwitch` | unused | Would gate model switches. Missing from the shared `HookEventName` type. | — |
| `PreToolUse` | used | The only registered SDK hook callback, desktop only: `denySubagentSessionRename` denies main-thread-only SuperOne tools when `agent_id` is set. The node CLI registers no hooks. | `apps/desktop/src/main/agent/claude-query.ts` |
| `SessionEnd` | unused | Would run cleanup at session end. | — |
| `SessionStart` | unused | No callback is registered. Its `hook_started` / `hook_response` messages (always emitted) are mapped but not keyed on the event name, and the reducer ignores them. | — |
| `Setup` | unused | No callback is registered. Its hook messages are always emitted but treated the same generic, ignored way. | — |
| `Stop` | unused | No SDK callback. The CLI's own `/goal` Stop hook reaches SuperOne through the undeclared `active_goal` message. | — |
| `StopFailure` | unused | Would react to turns that end in an error. | — |
| `SubagentStart` | unused | Would inject context into subagents. SuperOne uses `task_started` instead. | — |
| `SubagentStop` | unused | Would gate or observe subagent completion. | — |
| `TaskCompleted` | unused | Would observe task completion. SuperOne uses `task_notification` / `task_updated` instead. | — |
| `TaskCreated` | unused | Would observe task creation. SuperOne uses `task_started` instead. | — |
| `TeammateIdle` | unused | Would react to idle agent-team teammates. | — |
| `UserPromptExpansion` | unused | Would observe or modify slash-command or @-mention expansion. | — |
| `UserPromptSubmit` | unused | Would inject context or block prompts at submit time. | — |
| `WorktreeCreate` | unused | Would customize worktree creation. | — |
| `WorktreeRemove` | unused | Would clean up when a worktree is removed. | — |

## Control requests

Control-protocol request subtypes. Most are sent by a `Query` method or an `Options` callback; the row names the wrapper.

| Name | Status | Usage | Code |
|---|---|---|---|
| `apply_flag_settings` | used | via `applyFlagSettings`; live sandbox and additional-directories updates in desktop sessions. | `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `background_tasks` | unused | via `backgroundTasks` (never called); would background foreground tasks. | — |
| `can_use_tool` | used | via Options.canUseTool; the permission, AskUserQuestion and plan-approval bridge in desktop and node. The legacy print client handles the raw subtype too. | `apps/desktop/src/main/agent/claude-permissions.ts`, `packages/claude/src/claude-live-session.ts`, `apps/cli/src/session/claude-print-client.ts` |
| `cancel_async_message` | used | via `cancelAsyncMessage`, which is not in the public `Query` type and is reached through a cast; desktop interrupt cancels each `still_queued` uuid and rebuilds the runtime if the method is missing. | `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `elicitation` | partial | via Options.onElicitation; MCP elicitations become desktop permission-request forms. Desktop only; node sets no handler, so the SDK auto-declines there. | `apps/desktop/src/main/agent/claude-permissions.ts`, `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `file_suggestions` | unused | No Query wrapper; would give CLI @-mention file autocomplete. SuperOne uses its own `fuzzy-file-search.ts`. | — |
| `get_binary_version` | n/a | No Query wrapper; it serves `/version` for `--remote` thin clients, and SuperOne gets the version from its own binary resolution. | — |
| `get_context_usage` | used | via `getContextUsage`; desktop context meter. | `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `get_task_output` | unused | No Query wrapper; would read the last 8 KiB of a background shell or Monitor task's output. | — |
| `get_hooks_listing` | unused | No Query wrapper; would return the `/hooks` menu listing. | — |
| `get_session_cost` | n/a | No Query wrapper; it is the thin-client `/usage` cost text, and SuperOne reads cost from result messages. | — |
| `get_settings` | unused | No Query wrapper; would return the effective merged settings and each source's settings. | — |
| `get_usage` | unused | via `usage_EXPERIMENTAL_...` (never called); would return plan rate-limit usage. | — |
| `hook_callback` | partial | via Options.hooks; desktop only, with a PreToolUse `denySubagentSessionRename` that blocks main-thread-only SuperOne tools inside subagents. Node registers no hooks. | `apps/desktop/src/main/agent/claude-query.ts` |
| `initialize` | used | Sent implicitly by `query()`/`startup()` (desktop, warm spare, node live session, probes); the result is read with `initializationResult`. | `apps/desktop/src/main/agent/claude-query.ts`, `apps/desktop/src/main/agent/warmup-manager.ts`, `apps/desktop/src/main/index.ts` |
| `interrupt` | partial | via `interrupt`; desktop Stop only. Node cancels turns with an AbortSignal and never sends it. | `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `list_models` | n/a | No Query wrapper; it is the model catalog for remote thin clients. SuperOne uses `supportedModels`, which comes from `initialize`. | — |
| `list_permission_rules` | unused | No Query wrapper; would return live `/permissions` rules and workspace dirs. | — |
| `mcp_authenticate` | used | via `mcpAuthenticate`, which is not in the public `Query` type; starts MCP server OAuth for an MCP Apps sign-in. Without a redirect URI the CLI's own localhost listener takes the callback. | `packages/claude/src/mcp-apps.ts`, `apps/desktop/src/main/session/backends/claude-backend.ts`, `apps/cli/src/session/claude-turn-runner.ts` |
| `mcp_call` | used | No Query wrapper; sent through the internal `Query.request` for MCP Apps View tool calls. Runs no visibility or permission check, so the shared dispatch gate enforces visibility first; version-pinned by `CLAUDE_MCP_CALL_VERIFIED_SDK`. | `packages/claude/src/mcp-apps.ts`, `apps/desktop/src/main/session/backends/claude-backend.ts`, `apps/cli/src/session/claude-turn-runner.ts` |
| `mcp_message` | used | via SDK MCP servers (`type: 'sdk'`); the in-process `superone` server on desktop and the host-action server on node. | `apps/desktop/src/main/agent/claude-query.ts`, `apps/desktop/src/main/mcp/superone-mcp-server.ts`, `apps/cli/src/session/host-action-mcp-server.ts` |
| `mcp_oauth_callback_url` | used | via `mcpSubmitOAuthCallbackUrl` (untyped); hands a relayed OAuth callback to a remote node's CLI, followed by `mcp_reconnect`. | `packages/claude/src/mcp-apps.ts` |
| `mcp_read_resource` | used | via `readMcpResource`; MCP Apps View resources. | `packages/claude/src/mcp-apps.ts`, `apps/desktop/src/main/session/backends/claude-backend.ts`, `apps/cli/src/session/claude-turn-runner.ts` |
| `mcp_reconnect` | used | via `reconnectMcpServer`; desktop MCP settings save, and after a relayed MCP Apps OAuth callback. | `apps/desktop/src/main/session/backends/claude-backend.ts`, `packages/claude/src/mcp-apps.ts` |
| `mcp_set_servers` | unused | via `setMcpServers` (never called); would swap the dynamic MCP servers live. | — |
| `mcp_status` | used | via `mcpServerStatus`; desktop MCP status panel, remote command and the MCP Apps catalog. | `packages/claude/src/mcp-apps.ts`, `apps/desktop/src/main/session/backends/claude-backend.ts`, `apps/cli/src/session/claude-turn-runner.ts` |
| `mcp_toggle` | used | via `toggleMcpServer`; desktop MCP enable/disable/delete. | `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `read_file` | unused | via `readFile` (never called); would read files through the CLI's permission gate. | — |
| `register_repo_root` | unused | No Query wrapper; would add a working-directory root and reload CLAUDE.md/skills/plugins. SuperOne uses `applyFlagSettings` for additional directories instead. | — |
| `reload_output_styles` | unused | via `reloadOutputStyles` (never called). | — |
| `reload_plugins` | used | via `reloadPlugins`; desktop plugin install/toggle refresh. | `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `reload_skills` | unused | via `reloadSkills` (never called). | — |
| `rename_session` | unused | No Query wrapper; would set the CLI session title. SuperOne keeps titles in its own DB (`db-sessions.renameSession`). | — |
| `request_user_dialog` | unused | via Options.onUserDialog (not set, no `supportedDialogKinds`); would let the host draw tool-driven blocking dialogs. | — |
| `rewind_files` | used | via `rewindFiles`; desktop checkpoint restore and dry-run. | `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `seed_read_state` | unused | via `seedReadState` (never called). | — |
| `set_color` | n/a | No Query wrapper; it sets the CLI/TUI session accent color, which SuperOne's own UI does not use. | — |
| `set_max_thinking_tokens` | deprecated | via `setMaxThinkingTokens` (deprecated, never called); thinking is set at spawn. | — |
| `set_model` | used | via `setModel`; desktop model picker and per-turn model override. | `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `set_permission_mode` | used | via `setPermissionMode`; desktop mode switches (plan, default, bypass, etc.). | `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `stop_task` | used | via `stopTask`; desktop per-task stop for background tasks. | `apps/desktop/src/main/session/backends/claude-backend.ts` |
| `update_settings` | unused | via `updateSettings` (never called); would write settings files through the CLI's own writer. | — |


## Subscription account authentication

| Name | Status | Usage | Code |
|---|---|---|---|
| CLI `auth login --claudeai` / `auth logout` | used | Managed domains isolate both `CLAUDE_CONFIG_DIR` and `CLAUDE_SECURESTORAGE_CONFIG_DIR`; auth subprocesses are cancellable. The external CLI login is not logged out from the account panel. | `apps/desktop/src/main/agent/claude-account-service.ts` |
| CLI `auth status --json` | unused | Its email/org come from config, not proof of the selected credential's identity. SuperOne resolves each domain from its OAuth token. | `apps/desktop/src/main/agent/claude-account-profile.ts` |
| `GET /api/oauth/profile` | used | Bearer token profile establishes account UUID, email, organization UUID/name; a fingerprint-bound metadata cache preserves cards through outages. This is an internal CLI endpoint, not a public SDK method. | `apps/desktop/src/main/agent/claude-account-profile.ts` |
| `GET /api/oauth/usage` | used | Only the selected domain drives the sidebar meter; provider settings load each account independently. Cache, backoff and history are scoped to the domain and verified identity. | `apps/desktop/src/main/agent/claude-usage-service.ts` |
| `POST /v1/oauth/token` | used | Shared credential renewal for profile and usage writes back to the original keychain/file domain. | `apps/desktop/src/main/agent/claude-oauth.ts` |
