# Grok (ACP) behavioral contracts

Upstream behavior SuperOne depends on that the published types do not state.

## Reasoning effort config option

- **Behavior:** Grok advertises reasoning effort as ACP config option id `reasoning_effort`, category `thought_level` (`SessionConfigOptionCategory::ThoughtLevel`). The select values are effort ids (`minimal`, `low`, `medium`, `high`, `xhigh`, and any model-specific list). Changing it is `session/set_config_option` with `configId: "reasoning_effort"`. That applies effort to the current model and does not switch models. The follow-up is `session/update` `config_option_update` with the full config option list, not a modes event. Older builds also put the same efforts in `_meta["x.ai/sessionConfig"].options` with category `mode`; those still switch through `session/set_model` plus `_meta.reasoningEffort`. Plan mode is `session/set_mode` `plan`, separate from this option.
- **Observed:** grok-build `build_acp_config_options` / `handlers/config_option.rs` (`CONFIG_ID_REASONING_EFFORT`). Installed grok 1.0.46 documents the same id, category, and `session/set_config_option` body.
- **Depends on it:** `apps/desktop/src/main/acp/acp-config.ts#extractReasoningEffortConfig`, `apps/desktop/src/main/session/backends/acp-backend.ts#setSessionMode`
- **Guard:** `apps/desktop/src/main/acp/acp-config.test.ts`, `apps/desktop/src/main/session/backends/acp-backend.test.ts`, `apps/desktop/src/main/acp/acp-runtime.test.ts`

## Workflow token accounting

- **Behavior:** A workflow agent's `tokens_used` is `UsageTotals::total_tokens()` (full prompt input + output; cache reads sit inside input and are not added again). Grok folds that usage into the spawning prompt's ledger only while `parent_prompt_id` is still the live prompt (`AttributedToPrompt`). `turn_completed` then carries it on `message_usage`. After the prompt returns, the same fold is `SessionOnly` and never becomes another `message_usage`. Background workflows return before their agents finish, so that spend shows up only as the cumulative sum on `workflow_updated` (`task_progress` / `task_notification` `usage.totalTokens`).
- **Observed:** grok-build `capture_and_fold_one_turn_usage` (`canonical_total_tokens`), `SessionActor::record_subagent_usage`, `UsageLedger::record_subagent`, `PromptUsage::project_from_ledger`. `host_service` emits `workflow_updated` after the fold ack. `xai-chat-state` `usage.rs`: `total_tokens()` is input + output, and a background child does not wait on the parent prompt.
- **Depends on it:** `apps/desktop/src/main/session/backends/acp-backend.ts` writes post-return growth to `usage_daily` through `recordGrokFromUsage`. Totals already seen when the spawning prompt ends are treated as included in that prompt's `message_usage`. The combined number is stored in `output_tokens` (input and cache columns stay 0) because the wire total has no split. It is not added to the context ring.
- **Guard:** `apps/desktop/src/main/session/backends/acp-backend.test.ts`

## session/load noReplay

- **Behavior:** `session/load` `_meta.noReplay: true` tells Grok to skip transcript replay. Desktop sets that boolean only when `launch.agentId` is `grok-build`. `session/new` does not send it. `drainLoadReplay` stays as a backstop and hands its still-pending `nextUpdate()` to the session pump, so the first live event is not dropped. SuperOne does not call `session/resume`.
- **Observed:** grok-build `parse_no_replay` reads `_meta.noReplay` as a boolean.
- **Depends on it:** `apps/desktop/src/main/acp/acp-runtime.ts` load params.
- **Guard:** `apps/desktop/src/main/acp/acp-runtime.test.ts`

## Context window on session/set_model

- **Behavior:** The model list can include `contextWindows`. Choosing one is `session/set_model` `_meta.contextWindow` (camelCase, `CONTEXT_WINDOW_META_KEY`). Omitting the key preserves the current window. `0` and other finite invalid numbers are sent once so the agent returns `invalid_params`; the host does not retry or swallow that error. `session/set_config_option` does not carry the window. Changing the model omits it. The picker is shown only when more than one positive finite window is listed. When `session/new` returns both `configOptions` and `models`, the window list from `models` is kept on the ready catalog and on the cached extra models.
- **Observed:** grok-build `resolve_switch_window` and sampling types `contextWindow` / `contextWindows`.
- **Depends on it:** `apps/desktop/src/main/acp/acp-config.ts#buildSetModelParams`, `Session.setSelectedSettings`, `AcpContextWindowSelect`. The usage-ring `contextWindow` field on session state is a different value and is not this wire key.
- **Guard:** `apps/desktop/src/main/acp/acp-config.test.ts`, `apps/desktop/src/main/session/session.test.ts`

## MCP bearer token file

- **Behavior:** An HTTP or SSE MCP server may carry `_meta["x.ai/mcp/bearerTokenFile"]`. Grok re-reads that file per request. An absolute path or a `~/` path is valid. A relative path must be sent unchanged so Grok returns `BearerTokenPathError::NotAbsolute`. The host does not copy the secret into headers.
- **Observed:** grok-build `mcp_bearer_token_file.rs`.
- **Depends on it:** `apps/desktop/src/main/acp/acp-mcp.ts#toAcpMcpServer`, `apps/desktop/src/main/mcp-config-service.ts` (`McpServerConfig.bearerTokenFile`).
- **Guard:** `apps/desktop/src/main/acp/acp-mcp.test.ts`, `apps/desktop/src/main/mcp-config-service.test.ts`

## Folder trust

- **Behavior:** Project rules, MCP, hooks, and skills stay unloaded until the client advertises `clientCapabilities._meta["x.ai/folderTrust"].interactive` and answers `x.ai/folder_trust/request` (and the `_x.ai/folder_trust/request` alias) with `{ outcome: "trust" }`. Any other outcome, including timeout, is reject. The request body is camelCase `sessionId`, `cwd`, `workspace`, and `configKinds`. The host does not auto-trust and does not write `~/.grok/trusted_folders.toml`. Desktop advertises the capability only for `grok-build` when a dialog handler is wired. The node does not advertise it. A wire timeout rejects the agent while the dialog stays until the user answers or the turn is interrupted. For `grok-build`, host project-scope MCP (`scope: "project"`, including `.claude/settings.json`) is omitted from `session/new` and `session/load` until that outcome is `trust`, then sent with `_x.ai/session/update_mcp_servers`. Later reload, toggle, and reconnect use the same trust bit. `updateMcpServers` also drops project-scope names while the session is untrusted, matching the trimmed name `toAcpMcpServer` sends, so a refresh cannot reattach them. A reject, or a session that never advertises trust, never attaches those servers. Other agents still send every scope.
- **Observed:** grok-build `folder_trust_prompt.rs`. The agent timeout is 30 minutes. A grant hot-reloads MCP, plugins, and project hooks.
- **Depends on it:** `apps/desktop/src/main/acp/folder-trust.ts`, `apps/desktop/src/main/acp/acp-runtime.ts`, `apps/desktop/src/main/session/backends/acp-backend.ts`, `FolderTrustPrompt`.
- **Guard:** `apps/desktop/src/main/acp/folder-trust.test.ts`, `apps/desktop/src/main/acp/acp-runtime.test.ts`

## Node Grok initialize

- **Behavior:** A launch whose `agentId` is `grok-build`, or whose command basename is `grok` / `grok-`, initializes with `clientCapabilities.fs` read/write false and `terminal: false`. Production `clientInfo.version` is `resolveCliReleaseVersion()` (`SUPERONE_CLI_VERSION`, then the build inject, adjacent `MANIFEST.json`, then the monorepo root `package.json`). When the caller omits `clientVersion`, the node walks to the nearest `super-one` `package.json`, which is `0.0.0` in a published bundle that has no such file. It is not a hardcoded desktop version. `session/new` `_meta` sends `clientIdentifier: "superone"` plus both `yoloMode` and `autoMode` booleans (`bypassPermissions` sets yolo, `auto` sets auto, Ask sends both false). When initialize advertises a noninteractive auth method (`cached_token`, `xai.api_key`, `api_key`, or an id containing those tokens, excluding oidc / grok.com / login), the node calls `authenticate` before `session/new`. Interactive-only methods do not block the turn. Top-level initialize `_meta` stays `askUserQuestion`, `exitPlanMode`, and `clientIdentifier`. The node does not advertise folder trust.
- **Observed:** grok-build initialize capability `clientCapabilities.meta["x.ai/folderTrust"]` is separate from top-level initialize `_meta`. Generic `can_present_permission_prompt()` is false.
- **Depends on it:** `packages/acp/src/run-turn.ts`, `packages/acp/src/client-version.ts`, `apps/cli/src/cli-release-version.ts`, `packages/acp/src/grok-turn-meta.ts`, `packages/acp/src/auth-method.ts`. Production launch: `apps/cli/src/session/harness-runners.ts`. The production router resolves the harness grok binary on each ACP turn.
- **Guard:** `packages/acp/src/run-turn.test.ts`, `packages/acp/src/simulated-runner.test.ts`, `apps/cli/src/session/grok-production-launch.test.ts`, `apps/cli/src/session/acp-client-version.test.ts`
