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
| `GET /api/agent` | used | Visible primary/all agents populate the standalone agent picker | `apps/desktop/src/main/opencode/opencode-v2-client.ts#parseOpenCodeV2Agents` |
| `POST /api/session/{sessionID}/agent` | used | Apply explicit native agent selections, independently of model/effort | `apps/desktop/src/main/opencode/opencode-v2-runtime.ts#applyTurnSettings` |
| `Session.Info.permissions` | used | Preserve native session rules while removing legacy SuperOne preset overlays on resume | `apps/desktop/src/main/opencode/opencode-v2-runtime.ts#createOpenCodeV2Runtime` |
| `PATCH /api/session/{sessionID}` | used | Exact-name host-tool admission; no blanket permission-mode overrides | `apps/desktop/src/main/opencode/opencode-runtime.ts#reconcileOpenCodePermissions` |
| `POST /api/session/{sessionID}/permission/{requestID}/reply` | used | Native once/always/reject approvals through shared HITL | `apps/desktop/src/main/opencode/opencode-v2-client.ts#permissionReply` |
