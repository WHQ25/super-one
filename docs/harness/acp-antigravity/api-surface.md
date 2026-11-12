# Antigravity (ACP) API surface

Version: `1.5.3` (`@agentclientprotocol/sdk` `^1.4.0`)

## Connection & Lifecycle

| Name | Status | Usage | Code |
|---|---|---|---|
| `initialize` | `used` | Handshake with `protocolVersion: 1`; reads `authMethods` and infers Streamable HTTP MCP support (`mcp.http`) from `_meta.antigravity` / `agentInfo` | `apps/desktop/src/main/acp/acp-runtime.ts`, `apps/desktop/src/main/acp/acp-capabilities.ts` |
| `authenticate` | `used` | Authenticates using configured `methodId` (`oauth-personal`, `oauth-business`, `gemini-api-key`, `agent-platform`), reusing native `~/.gemini` and OS Keyring OAuth credentials while aborting interactive OAuth URL prompts during session startup | `apps/desktop/src/main/acp/antigravity-runtime-bridge.ts#authenticateAntigravityRuntime` |
| `session/new` | `used` | Starts an Antigravity session with workspace `cwd`, `additionalDirectories`, Streamable HTTP `superone` + user MCP servers, and `_meta.antigravity.systemPrompt.append`; extracts `models`, `modes`, and `configOptions` | `apps/desktop/src/main/acp/acp-runtime.ts`, `apps/desktop/src/main/acp/acp-mcp.ts`, `apps/desktop/src/main/acp/antigravity-protocol.ts` |
| `session/resume` / `session/load` | `used` | Resumes an existing session by `sessionId` when supported, preserving `_meta.antigravity.systemPrompt.append` | `apps/desktop/src/main/acp/antigravity-runtime-bridge.ts#resumeAntigravitySession` |
| `session/prompt` | `used` | Sends text, slash commands (`/plan`, `/usage`, `/logout`, `/compact`, skills), and image content blocks for a turn (`/compact` is this prompt, not `x.ai/compact_conversation`). Also backs mid-turn queued `Steer` via `agy` `1.5.3`'s native concurrent `session/prompt` (`acquireTurn` `isSteer` -> `SendUserMessage` -> `finishSteer` early wire resolution on the previous leg + per-leg `PromptResponse.usage` reset) without `session/cancel` | `apps/desktop/src/main/acp/acp-runtime.ts`, `apps/desktop/src/main/acp/antigravity-steer.ts`, `apps/desktop/src/main/acp/antigravity-db-usage.ts`, `apps/desktop/src/main/acp/antigravity-compaction.ts` |
| `session/cancel` | `used` | Interrupts an active turn on explicit Stop and suppresses the synthetic `"Trajectory was cancelled."` `agent_message_chunk` | `apps/desktop/src/main/acp/acp-runtime.ts` |
| `session/set_model` | `used` | Selects the active model on the session | `apps/desktop/src/main/acp/acp-runtime.ts` |
| `session/set_mode` | `used` | Selects the active ACP session mode (`default` or `plan` only; `agy` `1.5.3` rejects `auto`/`bypassPermissions` with `-32602`, so `auto` and `bypassPermissions` use CLI launch flags `--sandbox` / `--dangerously-skip-permissions` plus runtime restart + `session/resume`) | `apps/desktop/src/main/acp/antigravity-runtime-bridge.ts`, `apps/desktop/src/main/session/backends/acp-backend.ts` |
| `session/set_config_option` | `used` | Applies reasoning effort / thinking level (`category === 'thought_level'`) | `apps/desktop/src/main/acp/acp-runtime.ts` |
| `logout`, `session/list`, `session/close` | `backlog` | Present in `(*ACPServer).handleRequest` (`1.5.3`); SuperOne manages auth sign-out and session archive/teardown via `AntigravityAuthService` and process lifecycle | `docs/harness/acp-antigravity/backlog.md` |

## Session Updates & Permissions

`agy` `1.5.3` (`third_party/jetski/cli/acp/server.go`) emits **only** standard ACP client methods (`session/update`, `session/request_permission`, `elicitation/create`, `fs/read_text_file`, `fs/write_text_file`, `terminal/*`) and zero private `antigravity/*` or `_x.*` JSON-RPC extension notifications.

| Name | Status | Usage | Code |
|---|---|---|---|
| `session/update` (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, `available_commands_update`, `current_mode_update`) | `used` | Mapped to `AgentEvent` stream (`acp_commands` preserves `_meta.isSkill` and merges workspace/user/plugin/builtin `SKILL.md` skills) | `apps/desktop/src/main/acp/acp-event-map.ts`, `apps/desktop/src/main/acp/antigravity-slash-commands.ts` |
| `session/update` (`usage_update`) | `used` | Real-time per-step context window (`used`, `size`) and cumulative per-turn token breakdown (`_meta.antigravityTurnUsage`) merged with conversation SQLite `.db` step metadata | `apps/desktop/src/main/acp/antigravity-site-customize.ts`, `apps/desktop/src/main/acp/antigravity-runtime-bridge.ts`, `apps/desktop/src/main/acp/antigravity-db-usage.ts` |
| `session/update` (`config_option_update`) | `used` | Updates cached models, modes, and reasoning effort options on the session | `apps/desktop/src/main/acp/acp-event-map.ts` |
| `session/request_permission` | `used` | Maps tool approval requests, `agy.security.warning` PolicyGuardian advisories, and `interaction_*` structured questions to SuperOne permission prompts | `apps/desktop/src/main/acp/acp-permission-map.ts`, `apps/desktop/src/main/acp/antigravity-protocol.ts` |
| `elicitation/create` | `used` | Handles structured `ask_question` tool invocations when `clientCapabilities.elicitation.form` is advertised on `initialize` | `apps/desktop/src/main/acp/acp-runtime.ts`, `apps/desktop/src/main/acp/antigravity-runtime-bridge.ts` |
