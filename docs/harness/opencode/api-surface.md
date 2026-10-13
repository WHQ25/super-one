# OpenCode API surface

Ledger version: `@opencode/client` 2.0.27 (desktop and node V2)

The generated Promise client's 140 native methods are inventoried below.
Checked manually from the published `dist/promise/generated/client.d.ts`; the
shared inventory script has no OpenCode extractor. The raw HTTP API also has
WebSocket upgrade operations that are not generated Promise methods. This
ledger does not claim a complete inventory of the separate 1.x SDK used by
desktop and remote nodes.

## server

| API | Status | Usage | Code |
|---|---|---|---|
| `server.info` | unused | Not adopted in this migration | — |
| `server.pair` | unused | Not adopted in this migration | — |
| `server.connect` | unused | Not adopted in this migration | — |

## location

| API | Status | Usage | Code |
|---|---|---|---|
| `location.get` | unused | Not adopted in this migration | — |
| `location.reload` | used | Reload a managed private server's catalogs while idle and without pending interactions; preserve its native session | `packages/opencode/src/opencode-v2-client.ts#reloadLocation`, `packages/opencode/src/native-runtime.ts#refreshResources` |

## agent

| API | Status | Usage | Code |
|---|---|---|---|
| `agent.list` | used | Desktop and node V2 `agents` adapter | `packages/opencode/src/opencode-v2-client.ts#agents` |
| `agent.get` | unused | Not adopted in this migration | — |

## plugin

| API | Status | Usage | Code |
|---|---|---|---|
| `plugin.list` | unused | Not adopted in this migration | — |
| `plugin.check` | unused | Not adopted in this migration | — |
| `plugin.update` | unused | Not adopted in this migration | — |

## session

| API | Status | Usage | Code |
|---|---|---|---|
| `session.list` | unused | Not adopted in this migration | — |
| `session.stats` | unused | Not adopted in this migration | — |
| `session.create` | used | Desktop and node V2 `createSession` adapter | `packages/opencode/src/opencode-v2-client.ts#createSession` |
| `session.import` | unused | Not adopted in this migration | — |
| `session.export` | unused | Not adopted in this migration | — |
| `session.active` | unused | Not adopted in this migration | — |
| `session.get` | used | Desktop and node V2 `getSession` adapter | `packages/opencode/src/opencode-v2-client.ts#getSession` |
| `session.remove` | used | Desktop and node V2 `deleteSession` adapter | `packages/opencode/src/opencode-v2-client.ts#deleteSession` |
| `session.fork` | used | Desktop and node V2 `forkSession` adapter | `packages/opencode/src/opencode-v2-client.ts#forkSession` |
| `session.switchAgent` | used | Desktop and node V2 `switchAgent` adapter | `packages/opencode/src/opencode-v2-client.ts#switchAgent` |
| `session.switchModel` | used | Desktop and node V2 `switchModel` adapter | `packages/opencode/src/opencode-v2-client.ts#switchModel` |
| `session.update` | used | Desktop and node V2 `updateSession` adapter | `packages/opencode/src/opencode-v2-client.ts#updateSession` |
| `session.move` | used | Desktop and node V2 `moveSession` adapter | `packages/opencode/src/opencode-v2-client.ts#moveSession` |
| `session.prompt` | used | Desktop and node prompts/skill attachments and native queued `delivery: steer` | `packages/opencode/src/opencode-v2-client.ts#prompt`, `packages/opencode/src/native-runtime.ts#steer` |
| `session.command` | used | Desktop and node V2 `command` adapter | `packages/opencode/src/opencode-v2-client.ts#command` |
| `session.skill` | unused | Not adopted in this migration | — |
| `session.synthetic` | unused | Not adopted in this migration | — |
| `session.shell` | used | Desktop and node V2 `shell` adapter | `packages/opencode/src/opencode-v2-client.ts#shell` |
| `session.compact` | used | Desktop and node V2 `compact` adapter | `packages/opencode/src/opencode-v2-client.ts#compact` |
| `session.wait` | unused | Not adopted in this migration | — |
| `session.revert.stage` | used | Desktop and node V2 `revertStage` adapter | `packages/opencode/src/opencode-v2-client.ts#revertStage` |
| `session.revert.clear` | used | Desktop and node V2 `revertClear` adapter | `packages/opencode/src/opencode-v2-client.ts#revertClear` |
| `session.revert.commit` | unused | Not adopted in this migration | — |
| `session.context` | unused | Not adopted in this migration | — |
| `session.diff` | used | Desktop and node V2 `diff` adapter | `packages/opencode/src/opencode-v2-client.ts#diff` |
| `session.inbox.list` | used | Authoritative pending user input and recovery reconciliation | `packages/opencode/src/opencode-inbox.ts#refresh` |
| `session.inbox.cancel` | used | Withdraw a pending native user input with a captured control proof | `packages/opencode/src/opencode-inbox.ts#cancel` |
| `session.inbox.update` | used | Change Queue/Steer delivery without resending accepted input | `packages/opencode/src/opencode-inbox.ts#update` |
| `session.instructions.entry.list` | unused | Not adopted in this migration | — |
| `session.instructions.entry.put` | used | Desktop and node V2 `putInstruction` adapter | `packages/opencode/src/opencode-v2-client.ts#putInstruction` |
| `session.instructions.entry.remove` | unused | Not adopted in this migration | — |
| `session.generate` | unused | Not adopted in this migration | — |
| `session.log` | used | Exclusive aggregate cursor and finite synchronization watermark for bounded event recovery | `packages/opencode/src/opencode-v2-client.ts#sessionLog` |
| `session.interrupt` | used | Desktop and node V2 `interrupt` adapter | `packages/opencode/src/opencode-v2-client.ts#interrupt` |
| `session.background` | unused | Not adopted in this migration | — |
| `session.message.get` | unused | Not adopted in this migration | — |
| `session.form.list` | used | Desktop and node V2 `forms` adapter | `packages/opencode/src/opencode-v2-client.ts#forms` |
| `session.form.create` | unused | Not adopted in this migration | — |
| `session.form.get` | unused | Not adopted in this migration | — |
| `session.form.reply` | used | Desktop and node V2 `formReply` adapter | `packages/opencode/src/opencode-v2-client.ts#formReply` |
| `session.form.cancel` | used | Desktop and node V2 `formCancel` adapter | `packages/opencode/src/opencode-v2-client.ts#formCancel` |
| `session.environment` | unused | Not adopted in this migration | — |
| `session.view` | unused | Not adopted in this migration | — |

## message

| API | Status | Usage | Code |
|---|---|---|---|
| `message.list` | used | Desktop and node V2 `messages` adapter | `packages/opencode/src/opencode-v2-client.ts#messages` |

## model

| API | Status | Usage | Code |
|---|---|---|---|
| `model.list` | used | Desktop and node V2 `models` adapter | `packages/opencode/src/opencode-v2-client.ts#models` |
| `model.default` | used | Desktop and node V2 `defaultModel` adapter | `packages/opencode/src/opencode-v2-client.ts#defaultModel` |

## generate

| API | Status | Usage | Code |
|---|---|---|---|
| `generate.text` | unused | Not adopted in this migration | — |

## provider

| API | Status | Usage | Code |
|---|---|---|---|
| `provider.list` | used | Desktop and node V2 `providers` adapter | `packages/opencode/src/opencode-v2-client.ts#providers` |
| `provider.get` | unused | Not adopted in this migration | — |

## integration

| API | Status | Usage | Code |
|---|---|---|---|
| `integration.list` | unused | Not adopted in this migration | — |
| `integration.get` | used | OAuth methods and optional typed input forms for the exact MCP integration | `packages/opencode/src/opencode-v2-client.ts#integration`, `apps/desktop/src/main/opencode/opencode-oauth.ts` |
| `integration.wellknown.add` | unused | Not adopted in this migration | — |
| `integration.connect.key` | unused | Not adopted in this migration | — |
| `integration.connect.external` | unused | Not adopted in this migration | — |
| `integration.oauth.connect` | used | Start one native attempt per MCP server; credentials stay upstream | `packages/opencode/src/opencode-v2-client.ts#startOAuth` |
| `integration.oauth.status` | used | Poll callback/code completion and expiry; reconnect the named MCP server | `packages/opencode/src/opencode-v2-client.ts#oauthStatus` |
| `integration.oauth.complete` | used | Complete a native code attempt through the shared question reply path | `packages/opencode/src/opencode-v2-client.ts#completeOAuth` |
| `integration.oauth.cancel` | used | Cancel the exact attempt on dismissal, failure, expiry or runtime close | `packages/opencode/src/opencode-v2-client.ts#cancelOAuth` |
| `integration.command.connect` | unused | Not adopted in this migration | — |
| `integration.command.status` | unused | Not adopted in this migration | — |
| `integration.command.cancel` | unused | Not adopted in this migration | — |

## mcp

| API | Status | Usage | Code |
|---|---|---|---|
| `mcp.list` | used | MCP panel status and exact server-to-integration OAuth identity | `packages/opencode/src/opencode-v2-client.ts#mcpStatus`, `packages/opencode/src/opencode-v2-client.ts#nativeMcpServers` |
| `mcp.add` | used | Desktop and node V2 `putMcp` adapter | `packages/opencode/src/opencode-v2-client.ts#putMcp` |
| `mcp.remove` | unused | Not adopted in this migration | — |
| `mcp.connect` | used | Desktop and node V2 `connectMcp` adapter | `packages/opencode/src/opencode-v2-client.ts#connectMcp` |
| `mcp.disconnect` | used | Desktop and node V2 `disconnectMcp` adapter | `packages/opencode/src/opencode-v2-client.ts#disconnectMcp` |
| `mcp.resource.catalog` | unused | Not adopted in this migration | — |

## credential

| API | Status | Usage | Code |
|---|---|---|---|
| `credential.list` | unused | Not adopted in this migration | — |
| `credential.create` | unused | Not adopted in this migration | — |
| `credential.update` | unused | Not adopted in this migration | — |
| `credential.activate` | unused | Not adopted in this migration | — |
| `credential.remove` | unused | Not adopted in this migration | — |

## project

| API | Status | Usage | Code |
|---|---|---|---|
| `project.list` | unused | Not adopted in this migration | — |
| `project.update` | unused | Not adopted in this migration | — |

## form

| API | Status | Usage | Code |
|---|---|---|---|
| `form.list` | unused | Not adopted in this migration | — |

## permission

| API | Status | Usage | Code |
|---|---|---|---|
| `permission.request.list` | unused | Not adopted in this migration | — |
| `permission.saved.list` | unused | Not adopted in this migration | — |
| `permission.saved.remove` | unused | Not adopted in this migration | — |
| `permission.create` | unused | Not adopted in this migration | — |
| `permission.list` | used | Desktop and node V2 `permissions` adapter | `packages/opencode/src/opencode-v2-client.ts#permissions` |
| `permission.get` | unused | Not adopted in this migration | — |
| `permission.reply` | used | Desktop and node V2 `permissionReply` adapter | `packages/opencode/src/opencode-v2-client.ts#permissionReply` |

## file

| API | Status | Usage | Code |
|---|---|---|---|
| `file.read` | unused | Not adopted in this migration | — |
| `file.list` | unused | Not adopted in this migration | — |
| `file.find` | unused | Not adopted in this migration | — |
| `file.write` | unused | Not adopted in this migration | — |

## command

| API | Status | Usage | Code |
|---|---|---|---|
| `command.list` | used | Desktop and node V2 `commands` adapter | `packages/opencode/src/opencode-v2-client.ts#commands` |

## skill

| API | Status | Usage | Code |
|---|---|---|---|
| `skill.list` | used | Location-scoped native skills in desktop/mobile slash catalogs; expose names/descriptions/IDs only | `packages/opencode/src/opencode-v2-client.ts#skills`, `packages/opencode/src/opencode-v2-client.ts#parseOpenCodeV2Commands` |

## rpc

| API | Status | Usage | Code |
|---|---|---|---|
| `rpc.call` | unused | Not adopted in this migration | — |

## event

| API | Status | Usage | Code |
|---|---|---|---|
| `event.subscribe` | used | Desktop and node V2 `eventStream` adapter | `packages/opencode/src/opencode-v2-client.ts#eventStream` |

Location-scoped `agent.updated`, `skill.updated` and `command.updated` trigger
debounced read-only catalog updates for the current session. Explicit reload
waits for the native agent initialization notification before replacing the
catalog or falling back from a removed selected agent. See [contracts](contracts.md#live-catalogs-have-location-and-control-ownership).

## pty

| API | Status | Usage | Code |
|---|---|---|---|
| `pty.list` | unused | Not adopted in this migration | — |
| `pty.create` | unused | Not adopted in this migration | — |
| `pty.get` | unused | Not adopted in this migration | — |
| `pty.update` | unused | Not adopted in this migration | — |
| `pty.remove` | unused | Not adopted in this migration | — |
| `pty.connect.token` | unused | Not adopted in this migration | — |

## experimental

| API | Status | Usage | Code |
|---|---|---|---|
| `experimental.persistentPty.read` | unused | Not adopted in this migration | — |
| `experimental.persistentPty.list` | unused | Not adopted in this migration | — |
| `experimental.persistentPty.create` | unused | Not adopted in this migration | — |
| `experimental.persistentPty.shutdown` | unused | Not adopted in this migration | — |
| `experimental.persistentPty.handoff` | unused | Not adopted in this migration | — |
| `experimental.persistentPty.get` | unused | Not adopted in this migration | — |
| `experimental.persistentPty.update` | unused | Not adopted in this migration | — |
| `experimental.persistentPty.snapshot` | unused | Not adopted in this migration | — |
| `experimental.persistentPty.remove` | unused | Not adopted in this migration | — |
| `experimental.persistentPty.connectToken` | unused | Not adopted in this migration | — |

## shell

| API | Status | Usage | Code |
|---|---|---|---|
| `shell.list` | unused | Not adopted in this migration | — |
| `shell.create` | unused | Not adopted in this migration | — |
| `shell.get` | unused | Not adopted in this migration | — |
| `shell.output` | unused | Not adopted in this migration | — |
| `shell.remove` | unused | Not adopted in this migration | — |

## reference

| API | Status | Usage | Code |
|---|---|---|---|
| `reference.list` | unused | Not adopted in this migration | — |

## worktree

| API | Status | Usage | Code |
|---|---|---|---|
| `worktree.list` | unused | Not adopted in this migration | — |
| `worktree.create` | unused | Not adopted in this migration | — |
| `worktree.remove` | unused | Not adopted in this migration | — |
| `worktree.refresh` | unused | Not adopted in this migration | — |

## vcs

| API | Status | Usage | Code |
|---|---|---|---|
| `vcs.init` | unused | Not adopted in this migration | — |
| `vcs.get` | unused | Not adopted in this migration | — |
| `vcs.base` | unused | Not adopted in this migration | — |
| `vcs.status` | unused | Not adopted in this migration | — |
| `vcs.branch.list` | unused | Not adopted in this migration | — |
| `vcs.diff` | unused | Not adopted in this migration | — |

## debug

| API | Status | Usage | Code |
|---|---|---|---|
| `debug.location.list` | unused | Not adopted in this migration | — |
| `debug.location.evict` | unused | Not adopted in this migration | — |

## migration

| API | Status | Usage | Code |
|---|---|---|---|
| `migration.v1.status` | unused | Not adopted in this migration | — |

## websearch

| API | Status | Usage | Code |
|---|---|---|---|
| `websearch.providers` | unused | Not adopted in this migration | — |
| `websearch.query` | unused | Not adopted in this migration | — |

## config

| API | Status | Usage | Code |
|---|---|---|---|
| `config.get` | unused | Not adopted in this migration | — |
| `config.shells` | unused | Not adopted in this migration | — |
| `config.update` | unused | Not adopted in this migration | — |

## Client lifecycle and plugin RPC

| API | Status | Usage | Code |
|---|---|---|---|
| `OpenCode.make` | used | Lazy Promise client; base Basic authentication and canonical per-call locations | `packages/opencode/src/opencode-v2-client.ts#OpenCodeV2Client` |
| `client.rpc(definition)` | unused | No host plugin RPC contract is installed | — |
| `Service.discover` | used | Reuse a healthy owned V2 registration, never replace the user default | `packages/opencode/src/owned-service.ts` |
| `Service.ensure` | used | Start/recover an owned compatible V2 instance with private configuration and database | `packages/opencode/src/owned-service.ts` |
| `Service.stop` | used | Reference-counted cleanup of owned registrations only | `packages/opencode/src/owned-service.ts` |
| `Service.headers` | unused | Private spawned servers and explicit attached endpoints retain existing ownership/authentication | — |

## Agents and permissions (desktop and node)

Additional event and behavior contracts for the native-agent integration. The
SDK method inventory above describes V2; the existing 1.x adapter remains separate.
The shared client/runtime is consumed by desktop and `packages/opencode/src/managed-runner.ts`.
Nodes expose leased OAuth, Steer/inbox, idle reload, native rewind/fork and manual
Retry. Node permission waiters offer once/reject; native saved patterns remain
separate. Cold discovery uses a temporary database through `packages/opencode/src/launch.ts`
and `apps/cli/src/rpc/harness-resources-handlers.ts`.

| API | Status | Usage | Code |
|---|---|---|---|
| `GET /api/agent` | used | Visible primary/all agents populate the desktop/mobile agent picker and node native catalogs; mobile discovers the catalog without a prior desktop session | `packages/opencode/src/opencode-v2-client.ts#parseOpenCodeV2Agents`, `apps/desktop/src/main/opencode/opencode-resources.ts#connectOpenCodeResources` |
| `GET /api/model` | used | Directory-scoped model/effort catalog shared by desktop and mobile cold discovery; checked against the current V2 schema and live 2.0.24 | `packages/opencode/src/opencode-v2-client.ts#resources`, `apps/desktop/src/main/opencode/opencode-resources.ts#connectOpenCodeResources` |
| `GET /api/model/default` | used | Mark OpenCode's configured default model in the shared catalog | `packages/opencode/src/opencode-v2-client.ts#resources` |
| `GET /api/provider` | used | Resolve provider names for the shared model catalog | `packages/opencode/src/opencode-v2-client.ts#resources` |
| `GET /api/command` | used | Directory-scoped command catalog for desktop/mobile before a session exists | `packages/opencode/src/opencode-v2-client.ts#resources` |
| `POST /api/session/{sessionID}/agent` | used | Apply explicit native agent selections, independently of model/effort | `apps/desktop/src/main/opencode/opencode-v2-runtime.ts#applyTurnSettings` |
| `Session.Info.permissions` | used | Preserve native session rules while removing legacy SuperOne preset overlays on resume | `apps/desktop/src/main/opencode/opencode-v2-runtime.ts#createOpenCodeV2Runtime` |
| `PATCH /api/session/{sessionID}` | used | Exact-name host-tool admission; no blanket permission-mode overrides | `apps/desktop/src/main/opencode/opencode-runtime.ts#reconcileOpenCodePermissions` |
| `POST /api/session/{sessionID}/permission/{requestID}/reply` | used | Native once/reject on node and once/always/reject on desktop through shared HITL; desktop/phone preview proposed project patterns before sending `always`, and cancelling the preview sends no reply | `packages/opencode/src/opencode-v2-client.ts#permissionReply` |
| `permission.asked` / `Permission.Request` | used | Preserve action, full resources, proposed saved patterns, metadata and upstream message; correlate source with cached tool name/input for desktop, phone and node review, including pending replay | `packages/opencode/src/opencode-v2-event-map.ts#OpenCodeV2TurnTranslator`, `packages/opencode/src/event-helpers.ts#mapOpenCodePermissionRequest` |

## Tool events (desktop and node)

Partial inventory for chat-tool presentation in 2.x; native permission inputs
remain upstream-shaped. See [the tool identity contract](contracts.md#tool-calls-need-chat-identity-and-input-aliases).

| API | Status | Usage | Code |
|---|---|---|---|
| `session.tool.input.started` | used | Canonical tool names from the first shell; exact host names route to existing UI/hide rules | `packages/opencode/src/opencode-v2-event-map.ts#OpenCodeV2TurnTranslator`, `packages/opencode/src/event-helpers.ts#openCodeToolName` |
| `session.tool.input.delta` | used | Shared throttled input previews, including native camel-case aliases; desktop and paired mobile WebView | `packages/opencode/src/opencode-v2-event-map.ts#OpenCodeV2TurnTranslator`, `packages/chat-core/src/partial-tool-input.ts` |
| `session.tool.progress` | used | Elapsed-time progress on the existing tool row; ignore unknown/completed calls | `packages/opencode/src/opencode-v2-event-map.ts#OpenCodeV2TurnTranslator` |
| `session.tool.called` | used | Add file/skill/edit input aliases for chat while retaining original input for permissions | `packages/opencode/src/event-helpers.ts#openCodeToolInput` |
| `session.tool.success` | used | Complete the same canonical tool shell and emit its result | `packages/opencode/src/opencode-v2-event-map.ts#OpenCodeV2TurnTranslator` |
| `session.tool.failed` | used | Complete the same canonical tool shell and retain readable failure details | `packages/opencode/src/opencode-v2-event-map.ts#OpenCodeV2TurnTranslator` |

| Native tool | Status | Usage | Code |
|---|---|---|---|
| `patch` | used | V2 multi-file patch display, per-file chips/diffs and turn stats; historical V1 `apply_patch` uses the same row | `packages/opencode/src/event-helpers.ts#openCodeToolName`, `packages/shared/src/patch-tool.ts`, `packages/chat-view/src/presenters/NativeCodeToolRow.tsx#PatchToolRow` |
| `execute` | used | V2 Code Mode display, not Bash; JavaScript source and result live in expandable details | `packages/opencode/src/event-helpers.ts#openCodeToolName`, `packages/chat-view/src/presenters/NativeCodeToolRow.tsx#CodeExecutionToolRow` |
