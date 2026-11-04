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
  3. Upstream `PromptUsage.input_tokens` and `Step.metadata.inputTokens` reflect total prompt tokens (inclusive of cached tokens). SuperOne turn footer tokens (`streamingTokens.input`) track incremental upload tokens that actually grow the context (`max(0, input_tokens - cached_read_tokens)`), while `contextTokens` reflects total context window occupancy.
  4. Thinking steps are opened lazily upon receipt of actual non-empty `agent_thought_chunk` updates (never eagerly on prompt dispatch or tool-advance), and empty thinking frames are retracted so the UI never displays phantom "reasoning..." states.
- **SuperOne code**: `apps/desktop/src/main/acp/antigravity-db-usage.ts`, `apps/desktop/src/main/acp/antigravity-db-proto.ts`, `apps/desktop/src/main/acp/antigravity-site-customize.ts`, `apps/desktop/src/main/acp/antigravity-runtime-bridge.ts`, `apps/desktop/src/main/acp/acp-runtime.ts`
- **Guard**: `apps/desktop/src/main/acp/antigravity-slash-and-usage.test.ts`

## 6. Slash command advertisement timing, skills discovery, and `/workflows` exclusion (observed in 1.4.5)

- **Behavior**:
  1. `AgyAdapter.new_session` and `_restore_session` schedule `_send_available_commands_update` with `asyncio.sleep(0)`, which can flush in the same stdout chunk as `NewSessionResponse` before `@agentclientprotocol/sdk` attaches the session on the client side, and only advertises `plan`, `logout`, `usage` without `SKILL.md` skills.
  2. Antigravity disables `run_workflow` in `antigravitySessionMeta` and does not support Grok `/workflows`.
- **SuperOne code**: `apps/desktop/src/main/acp/antigravity-slash-commands.ts`, `apps/desktop/src/main/acp/antigravity-site-customize.ts`, `apps/desktop/src/main/acp/antigravity-profile.ts`, `apps/desktop/src/main/session/backends/acp-backend.ts`, `apps/desktop/src/renderer/src/components/chat/ChatInput.tsx`, `apps/desktop/src/renderer/src/stores/chat-store/helpers/send-message.ts`
- **Guard**: `apps/desktop/src/main/acp/antigravity-slash-and-usage.test.ts`

## 7. MCP tool `step.content` timestamp header, `.system_generated/steps/<N>/output.txt` spill files, and `rawInput` preservation (observed in 1.4.5 / 1.23.2)

- **Behavior**:
  1. `localharness_external` prepends `Created At: <ISO>\nCompleted At: <ISO>\n` to `step.content` (which `AgyAdapter._stream_live_step` emits as `rawOutput` and `content[0].content.text` on `tool_call_update(status="completed")`).
  2. When an MCP or built-in tool output exceeds `mcp_max_output_bytes` (~10 KB for MCP tools), `localharness_external` writes the body to `file:///.../.system_generated/steps/<N>/output.txt` and replaces `step.content` with `The output was large and was saved to: file:///.../.system_generated/steps/<N>/output.txt`.
  3. Applying `[Earlier output truncated]` tail-slicing (`boundText`) to `rawInput` or to timestamp-wrapped `widget_show` outputs corrupts inline `widget_code` HTML/CSS/JS and prevents `resolveWidgetCall` from parsing structured JSON results.
- **SuperOne code**: `apps/desktop/src/main/acp/antigravity-protocol.ts` (`sanitizeAntigravityToolInput`, `unwrapAntigravityToolOutputText`, `normalizeAntigravitySessionUpdate`)
- **Guard**: `apps/desktop/src/main/acp/antigravity-protocol.test.ts`

## 8. Mid-turn message queueing, SteerNow (`sendNow`), and SteerSoon (`_x.ai/interject`) (observed in 1.4.5)

- **Behavior**:
  1. `agy_acp_server.par` (`AgyAdapter.prompt`) blocks in `conversation.wait_for_idle()` and raises `Concurrent receive_steps() calls are not supported` if a second `session/prompt` arrives before the active turn finishes, and emits a synthetic `AgentMessageChunk("Trajectory was cancelled.")` on `AntigravityCancelledError`.
  2. However, the underlying `localharness_external` Go binary (`(*AgentExecutor).scheduleUserCascadeMessageRequest`) natively accepts `localharness_pb2.InputEvent(user_input=...)` over the active WebSocket while the trajectory executor is `RUNNING (2)` and queues the step into `MessageHub` (`MessageContinueCheck`) for injection at the next step boundary without interrupting the running tool/model call.
  3. Therefore, **SteerSoon (`priority: 'next'`)** uses `AgyAdapter.ext_method("_x.ai/interject")` to call `conn._send_input_event(InputEvent(user_input=...))` without resetting `_processor` and splits the live assistant bubble in SuperOne, while **SteerNow (`priority: 'now'`)** marks the active turn `superseded`, sends `session/cancel`, waits for `previousTurn.settledPromise`, and then dispatches the replacement `session/prompt`.
- **SuperOne code**: `apps/desktop/src/main/acp/antigravity-site-customize.ts`, `apps/desktop/src/main/acp/antigravity-site-customize-helpers.ts`, `apps/desktop/src/main/acp/acp-runtime.ts`, `apps/desktop/src/main/session/backends/acp-backend.ts`, `apps/desktop/src/renderer/src/components/chat/ChatContent.tsx`
- **Guard**: `apps/desktop/src/main/acp/antigravity-slash-and-usage.test.ts`, `apps/desktop/src/main/session/backends/acp-backend-queued-send.test.ts`

