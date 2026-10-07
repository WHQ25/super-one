# OpenCode API surface

Ledger version: not started

No ledger yet. Start from [the template](../_template/api-surface.md) when the
next upgrade of this harness is planned; conventions are in
[docs/harness/README.md](../README.md#ledger-api-surfacemd).

## Agents and permissions (desktop)

Partial inventory for the native-agent integration (runtime 2.0.22 and the
existing 1.x adapter); this is not a complete upstream ledger.

| API | Status | Usage | Code |
|---|---|---|---|
| `GET /api/agent` | used | Visible primary/all agents populate the desktop/mobile agent picker; mobile discovers the catalog without a prior desktop session | `apps/desktop/src/main/opencode/opencode-v2-client.ts#parseOpenCodeV2Agents`, `apps/desktop/src/main/opencode/opencode-resources.ts#connectOpenCodeResources` |
| `GET /api/model` | used | Directory-scoped model/effort catalog shared by desktop and mobile cold discovery; checked against the current V2 schema and live 2.0.24 | `apps/desktop/src/main/opencode/opencode-v2-client.ts#resources`, `apps/desktop/src/main/opencode/opencode-resources.ts#connectOpenCodeResources` |
| `GET /api/model/default` | used | Mark OpenCode's configured default model in the shared catalog | `apps/desktop/src/main/opencode/opencode-v2-client.ts#resources` |
| `GET /api/provider` | used | Resolve provider names for the shared model catalog | `apps/desktop/src/main/opencode/opencode-v2-client.ts#resources` |
| `GET /api/command` | used | Directory-scoped command catalog for desktop/mobile before a session exists | `apps/desktop/src/main/opencode/opencode-v2-client.ts#resources` |
| `POST /api/session/{sessionID}/agent` | used | Apply explicit native agent selections, independently of model/effort | `apps/desktop/src/main/opencode/opencode-v2-runtime.ts#applyTurnSettings` |
| `Session.Info.permissions` | used | Preserve native session rules while removing legacy SuperOne preset overlays on resume | `apps/desktop/src/main/opencode/opencode-v2-runtime.ts#createOpenCodeV2Runtime` |
| `PATCH /api/session/{sessionID}` | used | Exact-name host-tool admission; no blanket permission-mode overrides | `apps/desktop/src/main/opencode/opencode-runtime.ts#reconcileOpenCodePermissions` |
| `POST /api/session/{sessionID}/permission/{requestID}/reply` | used | Native once/always/reject approvals through shared HITL; desktop/phone preview proposed project patterns before sending `always`, and cancelling the preview sends no reply | `apps/desktop/src/main/opencode/opencode-v2-client.ts#permissionReply` |
| `permission.asked` / `Permission.Request` | used | Preserve action, full resources, proposed saved patterns, metadata and upstream message; correlate source with cached tool name/input for desktop and phone review, including pending replay | `apps/desktop/src/main/opencode/opencode-v2-event-map.ts#OpenCodeV2TurnTranslator`, `apps/desktop/src/main/opencode/opencode-event-map.ts#mapOpenCodePermissionRequest` |

## Tool events (desktop)

Partial inventory for chat-tool presentation in 2.x; native permission inputs
remain upstream-shaped. See [the tool identity contract](contracts.md#tool-calls-need-chat-identity-and-input-aliases).

| API | Status | Usage | Code |
|---|---|---|---|
| `session.tool.input.started` | used | Canonical tool names from the first shell; exact host names route to existing UI/hide rules | `apps/desktop/src/main/opencode/opencode-v2-event-map.ts#OpenCodeV2TurnTranslator`, `apps/desktop/src/main/opencode/opencode-event-map.ts#openCodeToolName` |
| `session.tool.called` | used | Add file/skill/edit input aliases for chat while retaining original input for permissions | `apps/desktop/src/main/opencode/opencode-event-map.ts#openCodeToolInput` |
| `session.tool.success` | used | Complete the same canonical tool shell and emit its result | `apps/desktop/src/main/opencode/opencode-v2-event-map.ts#OpenCodeV2TurnTranslator` |
| `session.tool.failed` | used | Complete the same canonical tool shell and retain readable failure details | `apps/desktop/src/main/opencode/opencode-v2-event-map.ts#OpenCodeV2TurnTranslator` |

| Native tool | Status | Usage | Code |
|---|---|---|---|
| `patch` | used | V2 multi-file patch display, per-file chips/diffs and turn stats; historical V1 `apply_patch` uses the same row | `apps/desktop/src/main/opencode/opencode-event-map.ts#openCodeToolName`, `packages/shared/src/patch-tool.ts`, `packages/chat-view/src/presenters/NativeCodeToolRow.tsx#PatchToolRow` |
| `execute` | used | V2 Code Mode display, not Bash; JavaScript source and result live in expandable details | `apps/desktop/src/main/opencode/opencode-event-map.ts#openCodeToolName`, `packages/chat-view/src/presenters/NativeCodeToolRow.tsx#CodeExecutionToolRow` |
