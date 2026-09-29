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
persistent grant from being inherited by children. Ordinary built-ins can prefer
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
the host. `acp-auto-honesty.ts` supplies the user-facing explanation. The host
must not promise Claude's Auto semantics or spoof client identity to change it.

## Plan mode and reasoning effort

Entering Plan uses ACP `session/set_mode` with `modeId: 'plan'`. The desktop
runtime commits its local plan state only after that request succeeds; failure
propagates rather than leaving the selector in a mode the agent never entered.
Leaving plan resets the local state, attempts the default session mode, then
sends the permission baseline. The latter calls are best-effort and logged.

Prompt `_meta.mode` uses `plan` or `agent`. Reasoning effort uses Grok model/config
resources and must not be inferred from the host permission selector. Agent
`current_mode_update` notifications synchronize the session-mode state.

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
