# Grok ACP permissions

SuperOne's desktop ACP backend translates permission requests into shared chat
interactions. Grok permission baseline, ACP session mode and reasoning effort
are separate controls. [Host integration](grok-build-parity.md) describes the
surrounding runtime; [backlog](backlog.md) records unsupported capabilities.

## Tool identity and admission

`apps/desktop/src/main/acp/acp-permission-preapprove.ts` normalizes Grok's
`server__tool` identities to `mcp__server__tool`. It inspects the normalized tool,
`use_tool` input, title and `x.ai/tool` metadata. Nested `tool_input` is preserved
for argument-aware mini-app preapproval.

`decideAcpPermission` has four outcomes:

| Outcome | Boundary |
|---|---|
| Deny | Main-thread-only host tools invoked by a child session |
| Auto-allow | Exact registered host built-ins or user-preapproved mini-app calls |
| Terminal gate | `terminal_tabs` uses the shared per-command gate |
| Prompt | All other requests retain the agent-provided options |

An `mcp__superone__` prefix alone is not authorization. Third-party MCP calls do
not become host-owned. Executor confirmation and feature gates still run after
admission. Main-thread-only calls from the parent use allow-once, preventing a
persistent grant from being inherited by children. Children share the parent's
SuperOne MCP connection and often skip `session/request_permission`, so while an
ACP task is live `main-thread-session-guard.ts` runs a main-thread-only tool only
against a single-use credit from that call's `tool_call` on the parent ACP
session stream (child calls stream under the child session id). Always-approve
parent calls therefore still pass. Ordinary built-ins can prefer
an offered always-allow option. Mini-app preapproval remains argument-specific.

`acp-permission-map.ts` preserves option IDs from the request. Always-allow
prefers Grok's `allow-always-mcp` when offered; otherwise it selects the matching
option kind. Denial selects a reject option, and cancellation/no usable option
returns a cancelled outcome. The host does not invent an option ID.

## Permission modes

`grokSessionPermissionMeta` writes **both** booleans on session create/load:

| Host permission mode | `autoMode` | `yoloMode` |
|---|---|---|
| `default` | false | false |
| `auto` | true | false |
| `bypassPermissions` | false | true |
| `plan` baseline | false | false |

Omission would let Grok inherit its own configuration. Keep the explicit false
values so Ask does not silently inherit Auto. Initialize/create identity is
`clientIdentifier: 'superone'`; SuperOne does not impersonate Grok Desktop.

Mid-session baseline changes use `x.ai/yolo_mode_changed`, with the wire keys
produced by `grokYoloModeNotificationParams`. Do not add an origin-client filter
to that notification: it can cause otherwise valid updates to be ignored.
`acceptEdits` and `dontAsk` have no distinct mapping in this control.

Grok's Generic-client Auto can deny a classifier-blocked request without asking
the host. A failed tool result shaped as `Tool \`name\` was not executed: Auto mode blocked this action`
is shown as a deny on that tool card. A successful result that only quotes the
sentence is left unchanged. `acp-auto-honesty.ts` supplies the one-time
explanation. The host must not promise Claude's Auto semantics or spoof client
identity to change it.

## Plan mode and reasoning effort

Entering Plan uses ACP `session/set_mode` with `modeId: 'plan'`. The desktop
runtime and `Session.setPermissionMode` both commit the mode only after
`session/set_mode` or `x.ai/yolo_mode_changed` succeeds. A failure leaves the
chip on the previous mode. Create-time plan is recorded before the runtime
exists; if that `set_mode` fails, the runtime reports `default` and the session
rolls the chip back. `yolo_mode_changed` is a JSON-RPC notification, so the
agent cannot reject it. Only a local send failure rolls a plan exit back, and
the runtime then tries to restore `session/set_mode` plan.
Leaving plan requires `session/set_mode` `default` to succeed before the
permission baseline is sent. A failure stays on plan and does not send
`yolo_mode_changed`. A switch that was not in plan may still ignore an
unsupported `set_mode`.

Prompt `_meta.mode` uses `plan` or `agent`. Reasoning effort is ACP config
option `reasoning_effort` (category `thought_level`), changed with
`session/set_config_option`, and stays on the model-selector slider. Older
agents that only advertise x.ai `sessionConfig` category `mode` still switch
with `session/set_model` and `_meta.reasoningEffort`. Effort must not be
inferred from the host permission selector. Agent `current_mode_update`
notifications synchronize the session-mode state.

`x.ai/ask_user_question`, `x.ai/exit_plan_mode` and `x.ai/mcp/elicit` have separate
reverse-request handlers. Plan review is a shared `plan_approval` interaction;
its response adapter owns the Grok wire shape. Review text can become a later
user message rather than an invented field on an approval response.

## Lifecycle and verification

`AcpBackend` owns pending requests, re-emits active interactions for restore and
settles them on interruption/disposal. Permission baseline changes do not
restart the agent process. Switching the ACP agent identity rebuilds the runtime.

Relevant checks are `acp-permission-preapprove.test.ts`,
`acp-permission-map.test.ts`, `acp-runtime.test.ts` and ACP backend tests. They
cover normalized identities, main-thread guards, offered options, explicit
create-time booleans and plan-mode failure. Live behavior still depends on the
user-installed Grok binary; mock tests do not certify every upstream version.
