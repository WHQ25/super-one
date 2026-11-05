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

- **Behavior**: When the agent asks the user clarifying questions, it sends a `session/request_permission` request with `toolCallId` prefixed by `interaction_` (or `toolCall.rawInput.tool_name === 'agent_ask_user'`) without a corresponding `tool_call` / `tool_call_update` session update. `AcpBackend.handleAskUserQuestion` emits streaming and completed `AskUserQuestion` `tool_use` + `tool_result` `content_delta` events so the question and user response render in the chat transcript, while `acp-runtime.ts` closes and advances the Antigravity thinking step around the interaction.
- **SuperOne code**: `apps/desktop/src/main/acp/antigravity-protocol.ts`, `apps/desktop/src/main/acp/acp-runtime.ts`, `apps/desktop/src/main/session/backends/acp-backend.ts`, `apps/desktop/src/main/acp/acp-permission-map.ts`, `apps/desktop/src/main/acp/acp-permission-preapprove.ts`
- **Guard**: `apps/desktop/src/main/acp/antigravity-protocol.test.ts`, `apps/desktop/src/main/session/backends/acp-backend.test.ts`

## 5. Per-turn real-time token usage and SQLite `steps` schema evolution (observed in 1.4.5 / 1.4.8)

- **Behavior**:
  1. Conversation `.db` files use either `steps(idx INTEGER PRIMARY KEY, step_type, metadata, step_payload, ...)` (`1.4.8`), `steps(idx INTEGER PRIMARY KEY, step_payload BLOB)` (`1.4.5`), or `steps(step_index, step_type, step_payload, metadata)` (`1.3.0`).
  2. During a turn, `localharness_external` emits `StepUpdate` (WebSocket frame 1) followed by `UsageUpdate` (WebSocket frame 2). Unpatched `AgyAdapter._maybe_send_usage_update` only yields `asyncio.sleep(0)` and `_send_usage_update` sends only `used`/`size` (and drops the update when `model_selection.get_context_window_size` returns `None`). At turn end, `AgyAdapter.prompt` returns `PromptResponse(stop_reason, usage=turn_usage)`.
  3. On the ACP wire, `PromptUsage.input_tokens` reflects total prompt tokens (inclusive of `cached_read_tokens`), so `_patched_send_usage_update` and `extractAntigravityPromptResponseUsage` subtract `cached_read_tokens` (`max(0, input_tokens - cached_read_tokens)`). By contrast, in SQLite `StepMetadata.ModelUsageStats` (protobuf field 9), field 2 (`input_tokens`) is already the uncached incremental input, field 5 (`cache_read_tokens`) is the cached read count, and field 3 (`output_tokens`) in `1.4.8+` already includes `thoughts_tokens` (field 9) + `candidates_tokens` (field 10).
  4. Thinking steps are opened lazily upon receipt of actual non-empty `agent_thought_chunk` updates (never eagerly on prompt dispatch or tool-advance), and empty thinking frames are retracted so the UI never displays phantom "reasoning..." states.
- **SuperOne code**: `apps/desktop/src/main/acp/antigravity-db-usage.ts`, `apps/desktop/src/main/acp/antigravity-db-proto.ts`, `apps/desktop/src/main/acp/antigravity-site-customize.ts`, `apps/desktop/src/main/acp/antigravity-runtime-bridge.ts`, `apps/desktop/src/main/acp/acp-runtime.ts`, `apps/desktop/src/main/usage-stats-backfill.ts`
- **Guard**: `apps/desktop/src/main/acp/antigravity-slash-and-usage.test.ts`, `apps/desktop/src/main/usage-stats-service.test.ts`

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

## 9. `write_to_file` / `multi_replace_file_content` permission frame vs. `code_action` execution step reconciliation (observed in 1.4.5 / 1.23.2)

- **Behavior**:
  1. During the permission hook (`AgyAdapter._permission_handler` / `_announce_tool_call_pending_and_in_progress`), Antigravity passes the model's true tool name (`write_to_file`, `replace_file_content`, or `multi_replace_file_content`) and full arguments (`TargetFile`, `CodeContent`, `TargetContent`, `ReplacementContent`, `ReplacementChunks`, `toolSummary`) and queues the generated `tool_call_id` under `session_info.pending_permission_frames[tool_name]`.
  2. However, when `localharness_external` executes any file mutation (`write_to_file`, `replace_file_content`, or `multi_replace_file_content`), it emits a `step.code_action` protobuf payload. `google.antigravity.connections.local.event_processor.PROTO_FIELD_TO_SDK_NAME["code_action"]` hardcodes `"code_action" -> "replace_file_content"`, and `LocalConnectionStep.from_dict` constructs `ToolCall(id="<trajectory_id>:<step_index>", name="replace_file_content", args={"file_path": "<path>"}, canonical_path="<path>")` with `step.content = toolSummary` and without `CodeContent`, `TargetContent`, or `ReplacementContent`.
  3. Unpatched `AgyAdapter._resolve_permission_frame` only checks `pending_permission_frames.get(str(call.name))` (`"replace_file_content"`), so `write_to_file` and `multi_replace_file_content` permission frames never reconcile: the `Write` card remains stuck in `in_progress` (`Writing...`) until turn end (when `AgyAdapter.prompt` marks leftover frames `failed` with `"Tool call was approved but never executed."`), while the `code_action` step opens a duplicate `Edit` card (`<trajectory_id>:<step_index>`) whose `rawInput` lacks diff fields and therefore renders only `step.content` (`toolSummary`, e.g. `"Write scratch/..."`) as its body.
  4. `_patched_resolve_permission_frame` and `_patched_stream_live_step` reconcile file-mutation execution calls across `_FILE_MUTATION_TOOLS` by normalized target path (falling back to earliest pending file-mutation frame) and restore the permission hook's original `call.name` and full `call.args` before streaming updates.
- **SuperOne code**: `apps/desktop/src/main/acp/antigravity-site-customize.ts`, `packages/shared/src/content-delta.ts`
- **Guard**: `apps/desktop/src/main/acp/antigravity-slash-and-usage.test.ts`, `packages/shared/src/content-delta.test.ts`

