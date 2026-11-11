# Antigravity (ACP) API surface

Version: `1.5.3` (`@agentclientprotocol/sdk` `^1.4.0`)

## Connection & Lifecycle

| Name | Status | Usage | Code |
|---|---|---|---|
| `initialize` | `used` | Handshake with `protocolVersion: 1`; reads `authMethods` and infers Streamable HTTP MCP support (`mcp.http`) from `_meta.antigravity` / `agentInfo` | `apps/desktop/src/main/acp/acp-runtime.ts`, `apps/desktop/src/main/acp/acp-capabilities.ts` |
| `authenticate` | `used` | Authenticates using configured `methodId` (`oauth-personal`, `oauth-business`, `gemini-api-key`, `agent-platform`), reusing native `~/.gemini` and OS Keyring OAuth credentials while aborting interactive OAuth URL prompts during session startup | `apps/desktop/src/main/acp/antigravity-runtime-bridge.ts#authenticateAntigravityRuntime` |
| `session/new` | `used` | Starts an Antigravity session with workspace `cwd`, `additionalDirectories`, Streamable HTTP `superone` + user MCP servers, and `_meta.antigravity.systemPrompt.append`; extracts `models`, `modes`, and `configOptions` | `apps/desktop/src/main/acp/acp-runtime.ts`, `apps/desktop/src/main/acp/acp-mcp.ts`, `apps/desktop/src/main/acp/antigravity-protocol.ts` |
| `session/resume` / `session/load` | `used` | Resumes an existing session by `sessionId` when supported, preserving `_meta.antigravity.systemPrompt.append` | `apps/desktop/src/main/acp/antigravity-runtime-bridge.ts#resumeAntigravitySession` |
| `session/prompt` | `used` | Sends text, slash commands (`/plan`, `/usage`, `/logout`, `/compact`, skills), and image content blocks for a turn. `/compact` is this prompt, not `x.ai/compact_conversation`. Supports mid-turn steer-now (`sendNow`) by cancelling and settling the in-flight turn before dispatching the replacement prompt; extracts turn-end `PromptResponse.usage` (`inputTokens`, `outputTokens`, `thoughtTokens`, `cachedReadTokens`) | `apps/desktop/src/main/acp/acp-runtime.ts`, `apps/desktop/src/main/acp/antigravity-db-usage.ts`, `apps/desktop/src/main/acp/antigravity-compaction.ts` |
| `session/cancel` | `used` | Interrupts an active turn (Stop or mid-turn `sendNow` replacement) and suppresses the synthetic `"Trajectory was cancelled."` `agent_message_chunk` | `apps/desktop/src/main/acp/acp-runtime.ts`, `apps/desktop/src/main/acp/antigravity-site-customize-helpers.ts` |
| `_x.ai/interject` / `x.ai/interject` | `used` | Mid-turn steer-soon (`priority: 'next'`): injects `localharness_pb2.InputEvent(user_input=...)` over `LocalHarnessConnection._send_input_event` so `localharness_external` `MessageHub` queues the message for the next step boundary without interrupting the active step | `apps/desktop/src/main/acp/antigravity-site-customize.ts`, `apps/desktop/src/main/acp/antigravity-site-customize-helpers.ts`, `apps/desktop/src/main/acp/acp-runtime.ts` |
| `session/set_model` | `used` | Selects the active model on the session | `apps/desktop/src/main/acp/acp-runtime.ts` |
| `session/set_mode` | `used` | Selects the active session mode (`default`, `auto_edit`, `auto`, `plan`, `yolo`) | `apps/desktop/src/main/acp/antigravity-runtime-bridge.ts#applyAntigravityPermissionMode` |
| `session/set_config_option` | `used` | Applies reasoning effort / thinking level (`category === 'thought_level'`) | `apps/desktop/src/main/acp/acp-runtime.ts` |

## Session Updates & Permissions

| Name | Status | Usage | Code |
|---|---|---|---|
| `session/update` (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, `available_commands_update`, `current_mode_update`) | `used` | Mapped to `AgentEvent` stream (`acp_commands` preserves `_meta.isSkill` and merges workspace/user/plugin/builtin `SKILL.md` skills) | `apps/desktop/src/main/acp/acp-event-map.ts`, `apps/desktop/src/main/acp/antigravity-slash-commands.ts` |
| `session/update` (`usage_update`) | `used` | Real-time per-step context window (`used`, `size`) and cumulative per-turn token breakdown (`_meta.antigravityTurnUsage`) merged with conversation SQLite `.db` step metadata | `apps/desktop/src/main/acp/antigravity-site-customize.ts`, `apps/desktop/src/main/acp/antigravity-runtime-bridge.ts`, `apps/desktop/src/main/acp/antigravity-db-usage.ts` |
| `session/update` (`config_option_update`) | `used` | Updates cached models, modes, and reasoning effort options on the session | `apps/desktop/src/main/acp/acp-event-map.ts` |
| `session/request_permission` | `used` | Maps tool approval requests, `agy.security.warning` PolicyGuardian advisories, and `interaction_*` structured questions to SuperOne permission prompts | `apps/desktop/src/main/acp/acp-permission-map.ts`, `apps/desktop/src/main/acp/antigravity-protocol.ts` |
