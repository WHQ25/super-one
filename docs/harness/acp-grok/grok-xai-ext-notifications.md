# Grok progressive notifications

A workflow launch tool can return only an acknowledgement while the work
continues. SuperOne consumes the xAI extension notification bus to show progress,
children, completion and usage. Ordinary ACP tool results alone cannot supply
that state.

## Ownership

| Layer | Source |
|---|---|
| Desktop method registration and active/wake scopes | `apps/desktop/src/main/acp/acp-runtime.ts` |
| Desktop notification mapping/correlation | `apps/desktop/src/main/acp/acp-xai-session-notify.ts` |
| Desktop interaction/settings/MCP callbacks | `apps/desktop/src/main/session/backends/acp-backend.ts` |
| Shared/node correlation and mapping | `packages/acp/src/xai-state.ts`, `xai-event-map.ts` |
| Transcript reduction and workflow card synthesis | `packages/chat-core/src/host-workflow-card.ts` and reducers |

Desktop and shared mappers are separate implementations. Update and test both
where a wire change applies; desktop-only driver callbacks do not automatically
become node behavior.

## Envelope and registered methods

`x.ai/session_notification` and `x.ai/session/update` carry a session ID, an
`update` object and optional `_meta` event sequence/ID. Registered underscore
aliases are normalized. The update tag is `sessionUpdate` (also accepting
`session_update`); variant names are snake_case.

```json
{
  "sessionId": "provider-session-id",
  "update": {
    "sessionUpdate": "workflow_updated",
    "run_id": "workflow-id",
    "revision": 3,
    "status": "active",
    "phases": []
  },
  "_meta": { "eventSeq": 42 }
}
```

`XAI_EXT_NOTIFICATION_METHODS` is the authoritative registration list. It also
covers standalone task/background, monitor, follow-up, scheduler, interjection,
MCP elicitation completion, settings, MCP status/progress/tools and model updates.
Unknown variants are ignored. An upstream method absent from that list is not
supported just because its name appears in an old design inventory.

## Event mapping

| Wire family | Host behavior |
|---|---|
| `workflow_updated` | Workflow snapshot, phases, agents and terminal result |
| `subagent_spawned`, `subagent_progress`, `subagent_finished` | Child/task identity, progress and completion |
| `task_backgrounded`, `task_completed`, `monitor_event` | Background task registration, output and completion |
| `goal_updated` | Shared goal state |
| `scheduled_task_created`, `scheduled_task_fired`, `scheduled_task_deleted` | Scheduled-task lifecycle |
| `response_started`, `response_completed`, `turn_completed` | Mid-turn usage and authoritative turn usage |
| `auto_compact_*` | Compaction indicator, boundary and failure state |
| `model_changed`, `model_auto_switched` | Agent-setting change |
| `retry_state`, `auto_recovery_*` | Retry/recovery presentation |
| `last_turn_summary`, `session_recap`, `session_recap_unavailable` | Session summary/recap state |
| `tool_call_delta_chunk` | Streaming tool identity/arguments before settled ACP output |

Settings, MCP catalog changes, scheduler prompt injection and interjection
handling can be driver callbacks instead of direct transcript events. Desktop
suppresses its own interjection echo; the shared mapper currently emits a user
message for it. This distinction is in [backlog](backlog.md).

## Correlation and ordering

Correlation state belongs to a session and tracks workflow run/tool IDs,
revisions, started sets, child output paths, tool argument deltas, background
tasks, usage and event sequence. Do not make it a global singleton.

Positive workflow revisions must increase. Revision zero is a full snapshot and
is accepted even after a numbered revision. Event-sequence filtering uses
`skipEventSeqDedup` for update kinds that do not share the durable sequence
stream; it is not a blanket rule to drop every lower sequence number. Parsed
event IDs are not a promise that every rail deduplicates by ID.

The launch tool acknowledgement and later workflow/child notifications must
refer to the same card rather than creating duplicate launch rows. Correlation
accepts notifications arriving before acknowledgements and handles deferred
child completion. Child output stays attached to its task identity rather than
being streamed into the parent's answer. Grok child transcript paths are derived
from cwd and child-session ID for later inspection.

`turn_completed` is authoritative for usage and resets interim accumulators.
For agent-initiated wakes it also supplies the durable completion signal; the
runtime owns starting/ending assistant scopes and must not infer completion
from a workflow launch acknowledgement.

## Verification and unsupported extensions

`acp-xai-session-notify.test.ts` and the shared `xai-event-map.test.ts` cover
mapping, revisions and correlation. ACP runtime tests cover active and idle
turn routing. Workflow reducers and ToolBlock stories cover rendering separately.

`x.ai/session/prompt_complete`, `x.ai/hooks/run`, `x.ai/queue/*` and
`x.ai/mcp/sdk_call` are not registered host controls. Durable `turn_completed`
already ends wakes; hook, agent queue and in-process MCP adoption need an explicit
integration decision. Generic-client limitations are described in
[permissions](grok-acp-permissions.md).
