# Antigravity (ACP) runtime contracts

Non-obvious upstream behaviors that SuperOne depends on.

## 1. Sibling `localharness_external` binary requirement (observed in 1.3.0)

- **Behavior**: `agy_acp_server.par` (`agy_acp_server.exe` on Windows) spawns a sibling `localharness_external` (`localharness_external.exe` on Windows) executable from the same directory.
- **SuperOne code**: `packages/runtime/src/harness/antigravity-runtime.ts`, `packages/runtime/src/harness/antigravity-zip.ts`
- **Guard**: `packages/runtime/src/harness/antigravity-runtime.test.ts`

## 2. Plaintext OAuth prompt lines on stdout (observed in 1.3.0)

- **Behavior**: During Google OAuth (`oauth-personal` / `oauth-business`), `agy_acp_server.par` may write human-readable OAuth instructions and the `https://accounts.google.com/...` URL directly to `stdout`, which is otherwise the NDJSON ACP transport stream.
- **SuperOne code**: `apps/desktop/src/main/acp/acp-process.ts` (`onStdoutLine` filter), `apps/desktop/src/main/acp/antigravity-runtime-bridge.ts`, `apps/desktop/src/main/acp/antigravity-auth-service.ts`
- **Guard**: `apps/desktop/src/main/acp/antigravity-protocol.test.ts`, `apps/desktop/src/main/acp/antigravity-auth-service.test.ts`

## 3. Isolated `GEMINI_HOME` and per-process `TMPDIR` (observed in 1.3.0)

- **Behavior**: `agy_acp_server.par` unpacks its self-extracting Python archive into `TMPDIR` and reads `GEMINI_HOME/.gemini/settings.json` plus `GEMINI_HOME/antigravity-acp/acp_token.json`. Ambient `GEMINI_*` / `GOOGLE_*` / `CLOUD_SHELL` variables can override the configured authentication method if not stripped.
- **SuperOne code**: `apps/desktop/src/main/acp/antigravity-profile.ts`
- **Guard**: `apps/desktop/src/main/acp/antigravity-auth-service.test.ts`

## 4. `interaction_*` and `agent_ask_user` permission request payload (observed in 1.3.0 / 1.4.5)

- **Behavior**: When the agent asks the user clarifying questions, it sends a `session/request_permission` request with `toolCallId` prefixed by `interaction_` (or `toolCall.rawInput.tool_name === 'agent_ask_user'`).
- **SuperOne code**: `apps/desktop/src/main/acp/antigravity-protocol.ts`, `apps/desktop/src/main/acp/acp-permission-map.ts`, `apps/desktop/src/main/acp/acp-permission-preapprove.ts`
- **Guard**: `apps/desktop/src/main/acp/antigravity-protocol.test.ts`

## 5. Per-turn real-time token usage and SQLite `steps` schema evolution (observed in 1.4.5)

- **Behavior**:
  1. In `1.4.5`, conversation `.db` files use `steps(idx INTEGER PRIMARY KEY, step_payload BLOB)` where `step_payload` is a serialized `trajectory_pb2.Step` (field 1 `metadata`, field 14 `user_input`, field 20 `planner_response`), whereas `1.3.0` used `steps(step_index, step_type, step_payload, metadata)`.
  2. During a turn, `localharness_external` emits `StepUpdate` (WebSocket frame 1) followed by `UsageUpdate` (WebSocket frame 2). Unpatched `AgyAdapter._maybe_send_usage_update` only yields `asyncio.sleep(0)` and `_send_usage_update` sends only `used`/`size` (and drops the update when `model_selection.get_context_window_size` returns `None`). At turn end, `AgyAdapter.prompt` returns `PromptResponse(stop_reason, usage=turn_usage)`.
- **SuperOne code**: `apps/desktop/src/main/acp/antigravity-db-usage.ts`, `apps/desktop/src/main/acp/antigravity-db-proto.ts`, `apps/desktop/src/main/acp/antigravity-site-customize.ts`, `apps/desktop/src/main/acp/antigravity-runtime-bridge.ts`, `apps/desktop/src/main/acp/acp-runtime.ts`
- **Guard**: `apps/desktop/src/main/acp/antigravity-slash-and-usage.test.ts`

## 6. Slash command advertisement timing, skills discovery, and `/workflows` exclusion (observed in 1.4.5)

- **Behavior**:
  1. `AgyAdapter.new_session` and `_restore_session` schedule `_send_available_commands_update` with `asyncio.sleep(0)`, which can flush in the same stdout chunk as `NewSessionResponse` before `@agentclientprotocol/sdk` attaches the session on the client side, and only advertises `plan`, `logout`, `usage` without `SKILL.md` skills.
  2. Antigravity disables `run_workflow` in `antigravitySessionMeta` and does not support Grok `/workflows`.
- **SuperOne code**: `apps/desktop/src/main/acp/antigravity-slash-commands.ts`, `apps/desktop/src/main/acp/antigravity-site-customize.ts`, `apps/desktop/src/main/acp/antigravity-profile.ts`, `apps/desktop/src/main/session/backends/acp-backend.ts`, `apps/desktop/src/renderer/src/components/chat/ChatInput.tsx`, `apps/desktop/src/renderer/src/stores/chat-store/helpers/send-message.ts`
- **Guard**: `apps/desktop/src/main/acp/antigravity-slash-and-usage.test.ts`
