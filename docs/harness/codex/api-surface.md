# Codex API surface

Ledger version: `0.159.0` · Check: `bun scripts/harness-api-inventory.ts codex`

Inventoried from the pinned npm binary, with and without `--experimental`. The
checker covers RPC method names; field-level changes and feature flags are
reviewed in [the upgrade record](upgrades/0.159.0.md). A notification appearing
in the stable generated schema does not make its underlying feature stable.

Statuses describe actual SuperOne integration, not every upstream field. `used`
means the method is called or its event is consumed; `partial` names runtime or
payload limits. Generic routing or safe rejection alone does not count as a
feature integration. Unlisted new optional fields are tolerated and unused.

## Stable client requests

| Name | Status | Usage | Code |
|---|---|---|---|
| `account/gatewayOAuth/cancel` | unused | No client call or dedicated handler. | — |
| `account/gatewayOAuth/login` | unused | No client call or dedicated handler. | — |
| `account/gatewayOAuth/read` | unused | No client call or dedicated handler. | — |
| `account/login/cancel` | used | Calls the app-server RPC. | `packages/codex/src/account-manager.ts`, `packages/codex/src/codex-admin.ts` |
| `account/login/start` | used | Calls the app-server RPC. | `packages/codex/src/account-manager.ts`, `packages/codex/src/codex-admin.ts` |
| `account/logout` | used | Calls the app-server RPC. | `packages/codex/src/account-manager.ts`, `packages/codex/src/codex-admin.ts` |
| `account/rateLimitResetCredit/consume` | used | Calls the app-server RPC. | `packages/codex/src/codex-admin.ts`, `apps/desktop/src/main/codex/codex-experiment-service.ts` |
| `account/rateLimits/read` | used | Calls the app-server RPC. | `packages/codex/src/codex-admin.ts` |
| `account/read` | used | Calls the app-server RPC. | `packages/codex/src/account-manager.ts`, `packages/codex/src/codex-admin.ts` |
| `account/sendAddCreditsNudgeEmail` | unused | No client call or dedicated handler. | — |
| `account/usage/read` | used | Calls the app-server RPC. | `packages/codex/src/codex-admin.ts`, `apps/desktop/src/main/codex/codex-experiment-service.ts` |
| `account/workspaceMessages/read` | unused | No client call or dedicated handler. | — |
| `app/installed` | used | Calls the app-server RPC. | `apps/desktop/src/main/session/backends/codex-backend.ts` |
| `app/list` | unused | No client call or dedicated handler. | — |
| `app/read` | unused | No client call or dedicated handler. | — |
| `command/exec` | unused | No client call or dedicated handler. | — |
| `command/exec/resize` | unused | No client call or dedicated handler. | — |
| `command/exec/terminate` | unused | No client call or dedicated handler. | — |
| `command/exec/write` | unused | No client call or dedicated handler. | — |
| `config/batchWrite` | unused | No client call or dedicated handler. | — |
| `config/mcpServer/reload` | used | Calls the app-server RPC. | `apps/desktop/src/main/session/backends/codex-backend.ts` |
| `config/read` | unused | No client call or dedicated handler. | — |
| `config/value/write` | unused | No client call or dedicated handler. | — |
| `configRequirements/read` | used | Calls the app-server RPC. | `packages/codex/src/protocol-v149.ts` |
| `experimentalFeature/enablement/set` | unused | No client call or dedicated handler. | — |
| `experimentalFeature/list` | unused | No client call or dedicated handler. | — |
| `externalAgentConfig/detect` | used | Calls the app-server RPC. | `packages/codex/src/codex-admin.ts`, `apps/desktop/src/main/codex/codex-experiment-service.ts` |
| `externalAgentConfig/import` | used | Calls the app-server RPC. | `packages/codex/src/codex-admin.ts`, `apps/desktop/src/main/codex/codex-experiment-service.ts` |
| `externalAgentConfig/import/readHistories` | unused | No client call or dedicated handler. | — |
| `externalAgentConfig/import/recordHistory` | unused | No client call or dedicated handler. | — |
| `feedback/upload` | unused | No client call or dedicated handler. | — |
| `fs/copy` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `fs/createDirectory` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `fs/getMetadata` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `fs/readDirectory` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `fs/readFile` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `fs/remove` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `fs/unwatch` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `fs/watch` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `fs/writeFile` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `fuzzyFileSearch` | unused | No client call or dedicated handler. | — |
| `hooks/list` | used | Calls the app-server RPC. | `apps/desktop/src/main/codex/codex-hooks-service.ts` |
| `initialize` | used | Advertises io.modelcontextprotocol/ui with text/html;profile=mcp-app in extensions. | `packages/codex/src/app-server-client.ts`, `apps/desktop/src/main/codex/app-server-connection.ts` |
| `marketplace/add` | used | Calls the app-server RPC. | `packages/codex/src/codex-admin.ts`, `apps/desktop/src/main/codex/codex-marketplace-service.ts` |
| `marketplace/remove` | used | Calls the app-server RPC. | `packages/codex/src/codex-admin.ts`, `apps/desktop/src/main/codex/codex-marketplace-service.ts` |
| `marketplace/upgrade` | used | Calls the app-server RPC. | `packages/codex/src/codex-admin.ts`, `apps/desktop/src/main/codex/codex-marketplace-service.ts` |
| `mcpServer/oauth/login` | used | Calls the app-server RPC. | `packages/codex/src/codex-admin.ts`, `apps/desktop/src/main/codex/codex-experiment-service.ts` |
| `mcpServer/resource/read` | partial | Public MCP Apps resource reads use the originating threadId through environment RPC. Hosted connector/link target stays deferred. | `packages/codex/src/mcp-apps.ts`, `apps/desktop/src/main/session/backends/codex-backend.ts` |
| `mcpServer/tool/call` | used | Bound-server App calls use the originating threadId through environment RPC; host gates visibility and approval. | `packages/codex/src/mcp-apps.ts`, `apps/desktop/src/main/session/backends/codex-backend.ts` |
| `mcpServerStatus/list` | partial | Status panels use full inventory. MCP Apps tool discovery uses toolsAndAuthOnly; full resource inventory is a lazy fallback for missing read-content UI metadata. httpOrigin/serverCapabilities remain unused. | `packages/codex/src/mcp-apps.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/session/backends/codex-backend.ts` |
| `model/list` | partial | Desktop catalog, efforts and speed tiers; availableAccessPrograms is not mapped. | `apps/desktop/src/main/codex/codex-experiment-service.ts` |
| `modelProvider/capabilities/read` | unused | No client call or dedicated handler. | — |
| `permissionProfile/list` | unused | No client call or dedicated handler. | — |
| `plugin/install` | used | Calls the app-server RPC. | `packages/codex/src/codex-admin.ts`, `apps/desktop/src/main/codex/codex-plugins-service.ts` |
| `plugin/installed` | unused | No client call or dedicated handler. | — |
| `plugin/list` | used | Calls the app-server RPC. | `packages/codex/src/codex-admin.ts`, `apps/desktop/src/main/codex/codex-plugins-service.ts` |
| `plugin/read` | partial | Desktop plugin detail; onboardingSkill is not exposed. | `apps/desktop/src/main/codex/codex-plugins-service.ts` |
| `plugin/reconcile` | used | Calls the app-server RPC. | `apps/desktop/src/main/session/backends/codex-backend.ts` |
| `plugin/share/checkout` | unused | No client call or dedicated handler. | — |
| `plugin/share/delete` | unused | No client call or dedicated handler. | — |
| `plugin/share/list` | unused | No client call or dedicated handler. | — |
| `plugin/share/save` | unused | No client call or dedicated handler. | — |
| `plugin/share/updateTargets` | unused | No client call or dedicated handler. | — |
| `plugin/skill/read` | unused | No client call or dedicated handler. | — |
| `plugin/uninstall` | used | Calls the app-server RPC. | `packages/codex/src/codex-admin.ts`, `apps/desktop/src/main/codex/codex-plugins-service.ts` |
| `review/start` | used | Calls the app-server RPC. | `packages/codex/src/app-server-client.ts`, `apps/desktop/src/main/codex/codex-turn.ts` |
| `skills/config/write` | used | Calls the app-server RPC. | `apps/desktop/src/main/codex/codex-skills-rpc-service.ts` |
| `skills/extraRoots/set` | unused | No client call or dedicated handler. | — |
| `skills/list` | used | Calls the app-server RPC. | `apps/desktop/src/main/codex/codex-skills-rpc-service.ts` |
| `thread/approveGuardianDeniedAction` | unused | No client call or dedicated handler. | — |
| `thread/archive` | unused | No client call or dedicated handler. | — |
| `thread/attachment/add` | unused | No client call or dedicated handler. | — |
| `thread/attachment/list` | unused | No client call or dedicated handler. | — |
| `thread/attachment/remove` | unused | No client call or dedicated handler. | — |
| `thread/compact/start` | used | Calls the app-server RPC. | `packages/codex/src/app-server-client.ts`, `apps/desktop/src/main/codex/codex-turn.ts` |
| `thread/delete` | unused | No client call or dedicated handler. | — |
| `thread/fork` | used | Calls the app-server RPC. | `packages/codex/src/fork-thread.ts`, `apps/desktop/src/main/session/backends/codex-backend.ts` |
| `thread/goal/clear` | used | Calls the app-server RPC. | `apps/desktop/src/main/codex/codex-goal-controller.ts`, `apps/desktop/src/main/codex/codex-goal-service.ts` |
| `thread/goal/get` | used | Calls the app-server RPC. | `apps/desktop/src/main/codex/codex-goal-controller.ts`, `apps/desktop/src/main/codex/codex-goal-service.ts` |
| `thread/goal/set` | used | Calls the app-server RPC. | `apps/desktop/src/main/codex/codex-goal-controller.ts`, `apps/desktop/src/main/codex/codex-goal-service.ts` |
| `thread/inject_items` | unused | No client call or dedicated handler. | — |
| `thread/items/list` | unused | No client call or dedicated handler. | — |
| `thread/list` | unused | No client call or dedicated handler. | — |
| `thread/loaded/list` | unused | No client call or dedicated handler. | — |
| `thread/metadata/update` | unused | No client call or dedicated handler. | — |
| `thread/name/set` | unused | No client call or dedicated handler. | — |
| `thread/read` | used | Calls the app-server RPC. | `apps/desktop/src/main/codex/codex-turn.ts` |
| `thread/resume` | partial | Resumes model/effort/tier; new collaborationMode and disabledPluginIds response fields are unused. | `packages/codex/src/app-server-client.ts`, `apps/desktop/src/main/codex/codex-turn.ts` |
| `thread/revert` | used | Calls the app-server RPC. | `apps/desktop/src/main/session/backends/codex-backend.ts` |
| `thread/section/move` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `thread/shellCommand` | unused | No client call or dedicated handler. | — |
| `thread/start` | used | Calls the app-server RPC. | `packages/codex/src/app-server-client.ts`, `apps/desktop/src/main/codex/codex-turn.ts` |
| `thread/turns/list` | partial | Legacy fork boundary lookup with itemsView:notLoaded; general native history paging remains unused. | `packages/codex/src/fork-thread.ts` |
| `thread/unarchive` | unused | No client call or dedicated handler. | — |
| `thread/unsubscribe` | used | Calls the app-server RPC. | `apps/desktop/src/main/codex/codex-turn.ts` |
| `threadSection/create` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `threadSection/delete` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `threadSection/list` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `threadSection/update` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `turn/interrupt` | used | Calls the app-server RPC. | `apps/desktop/src/main/codex/codex-turn.ts`, `apps/desktop/src/main/codex/connection-diagnostics.ts` |
| `turn/start` | used | Calls the app-server RPC. | `packages/codex/src/app-server-client.ts`, `apps/cli/src/session/codex-live-turn.ts` |
| `turn/steer` | used | Calls the app-server RPC. | `packages/codex/src/app-server-client.ts`, `apps/desktop/src/main/codex/codex-turn.ts` |
| `windowsSandbox/readiness` | unused | No client call or dedicated handler. | — |
| `windowsSandbox/setupStart` | unused | No client call or dedicated handler. | — |

## Experimental client requests

| Name | Status | Usage | Code |
|---|---|---|---|
| `account/bedrock/discover` | unused | No client call or dedicated handler. | — |
| `account/bedrock/setup` | unused | No client call or dedicated handler. | — |
| `collaborationMode/list` | unused | No client call or dedicated handler. | — |
| `environment/add` | unused | No client call or dedicated handler. | — |
| `environment/info` | unused | No client call or dedicated handler. | — |
| `environment/status` | unused | No client call or dedicated handler. | — |
| `fuzzyFileSearch/sessionStart` | unused | No client call or dedicated handler. | — |
| `fuzzyFileSearch/sessionStop` | unused | No client call or dedicated handler. | — |
| `fuzzyFileSearch/sessionUpdate` | unused | No client call or dedicated handler. | — |
| `mcpServer/event/stream/start` | unused | No client call or dedicated handler. | — |
| `mcpServer/event/stream/stop` | unused | No client call or dedicated handler. | — |
| `memory/reset` | unused | No client call or dedicated handler. | — |
| `memory/status` | unused | No client call or dedicated handler. | — |
| `mock/experimentalMethod` | unused | No client call or dedicated handler. | — |
| `plugin/search` | unused | No client call or dedicated handler. | — |
| `process/kill` | unused | No client call or dedicated handler. | — |
| `process/resizePty` | unused | No client call or dedicated handler. | — |
| `process/spawn` | unused | No client call or dedicated handler. | — |
| `process/writeStdin` | unused | No client call or dedicated handler. | — |
| `project/create` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `project/delete` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `project/import` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `project/list` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `project/move` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `project/read` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `project/update` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `remoteControl/client/list` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `remoteControl/client/revoke` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `remoteControl/disable` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `remoteControl/enable` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `remoteControl/pairing/start` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `remoteControl/pairing/status` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `remoteControl/status/read` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `rollout/compress` | unused | No client call or dedicated handler. | — |
| `server/diagnostics` | used | Calls the app-server RPC. | `packages/codex/src/protocol-v149.ts` |
| `thread/backgroundTerminals/clean` | unused | No client call or dedicated handler. | — |
| `thread/backgroundTerminals/list` | unused | No client call or dedicated handler. | — |
| `thread/backgroundTerminals/terminate` | unused | No client call or dedicated handler. | — |
| `thread/decrement_elicitation` | unused | No client call or dedicated handler. | — |
| `thread/increment_elicitation` | unused | No client call or dedicated handler. | — |
| `thread/memoryMode/set` | unused | No client call or dedicated handler. | — |
| `thread/queue/add` | used | Calls the app-server RPC. | `apps/desktop/src/main/session/backends/codex-backend.ts` |
| `thread/queue/delete` | used | Calls the app-server RPC. | `apps/desktop/src/main/session/backends/codex-backend.ts` |
| `thread/queue/list` | used | Calls the app-server RPC. | `apps/desktop/src/main/session/backends/codex-backend.ts` |
| `thread/queue/reorder` | unused | No client call or dedicated handler. | — |
| `thread/queue/start` | used | Calls the app-server RPC. | `apps/desktop/src/main/codex/codex-turn.ts` |
| `thread/queue/update` | unused | No client call or dedicated handler. | — |
| `thread/realtime/appendAudio` | unused | No client call or dedicated handler. | — |
| `thread/realtime/appendSpeech` | unused | No client call or dedicated handler. | — |
| `thread/realtime/appendText` | unused | No client call or dedicated handler. | — |
| `thread/realtime/listVoices` | partial | Desktop official-account voice catalog. | `apps/desktop/src/main/codex/codex-realtime.ts` |
| `thread/realtime/start` | partial | Desktop official-account WebRTC; backendReasoningStatus and custom-provider/mobile audio are unused. | `apps/desktop/src/main/codex/codex-realtime.ts` |
| `thread/realtime/stop` | partial | Desktop official-account voice lifecycle. | `apps/desktop/src/main/codex/codex-realtime.ts` |
| `thread/search` | unused | No client call or dedicated handler. | — |
| `thread/searchOccurrences` | unused | No client call or dedicated handler. | — |
| `thread/settings/update` | partial | Desktop realtime/model/effort/tier synchronization; disabledPluginIds is unused. | `packages/codex/src/app-server-client.ts`, `apps/desktop/src/main/codex/codex-thread-selection.ts` |
| `thread/timeline/list` | partial | Desktop voice transcript projection; item lifecycle timestamps are unused. | `apps/desktop/src/main/codex/codex-realtime.ts` |
| `turn/settings/update` | used | Calls the app-server RPC. | `apps/desktop/src/main/session/backends/codex-backend.ts` |
| `userVerification/cancel` | unused | No client call or dedicated handler. | — |
| `userVerification/delete` | unused | No client call or dedicated handler. | — |
| `userVerification/enroll` | unused | No client call or dedicated handler. | — |
| `userVerification/status` | unused | No client call or dedicated handler. | — |
| `userVerification/verify` | unused | No client call or dedicated handler. | — |

## Stable server requests

| Name | Status | Usage | Code |
|---|---|---|---|
| `account/chatgptAuthTokens/refresh` | unused | No client call or dedicated handler. | — |
| `applyPatchApproval` | partial | Legacy request routing on desktop; shared client does not implement the old approval shape. | `apps/desktop/src/main/codex/codex-notification-dispatcher.ts` |
| `attestation/generate` | unused | No client call or dedicated handler. | — |
| `execCommandApproval` | unused | No client call or dedicated handler. | — |
| `item/commandExecution/requestApproval` | partial | Desktop interactive approval; minimal shared client denies. | `packages/codex/src/server-request.ts`, `apps/desktop/src/main/codex/codex-turn.ts` |
| `item/fileChange/requestApproval` | partial | Desktop interactive approval; minimal shared client denies. | `packages/codex/src/server-request.ts`, `apps/desktop/src/main/codex/codex-turn.ts` |
| `item/permissions/requestApproval` | unused | No client call or dedicated handler. | — |
| `item/tool/call` | unused | No client call or dedicated handler. | — |
| `item/tool/requestUserInput` | partial | Desktop/production CLI question handling; minimal shared client denies. | `packages/codex/src/server-request.ts`, `apps/desktop/src/main/codex/codex-turn.ts` |
| `mcpServer/elicitation/request` | partial | Form/URL responses on desktop; user verification cancels without explicit opt-in; minimal client cancels. | `packages/codex/src/app-server-client.ts`, `packages/codex/src/server-request.ts` |

## Experimental server requests

| Name | Status | Usage | Code |
|---|---|---|---|
| `currentTime/read` | unused | No client call or dedicated handler. | — |

## Stable server notifications

| Name | Status | Usage | Code |
|---|---|---|---|
| `account/gatewayOAuth/changed` | unused | No client call or dedicated handler. | — |
| `account/login/completed` | used | Consumes the notification. | `packages/codex/src/account-manager.ts` |
| `account/rateLimits/updated` | unused | No client call or dedicated handler. | — |
| `account/updated` | unused | No client call or dedicated handler. | — |
| `app/list/updated` | unused | No client call or dedicated handler. | — |
| `autoApprovalReview/strictReviewRequired` | used | Consumes the notification. | `packages/codex/src/agent-event-mapper.ts`, `apps/desktop/src/main/codex/codex-turn.ts` |
| `command/exec/outputDelta` | unused | No client call or dedicated handler. | — |
| `configWarning` | unused | No client call or dedicated handler. | — |
| `deprecationNotice` | unused | No client call or dedicated handler. | — |
| `error` | used | Consumes the notification. | `packages/codex/src/agent-event-mapper.ts`, `packages/codex/src/app-server-client.ts` |
| `externalAgentConfig/import/completed` | used | Consumes the notification. | `packages/codex/src/codex-admin.ts`, `apps/desktop/src/main/codex/codex-experiment-service.ts` |
| `externalAgentConfig/import/progress` | unused | No client call or dedicated handler. | — |
| `fs/changed` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `fuzzyFileSearch/sessionCompleted` | unused | No client call or dedicated handler. | — |
| `fuzzyFileSearch/sessionUpdated` | unused | No client call or dedicated handler. | — |
| `guardianWarning` | unused | No client call or dedicated handler. | — |
| `hook/completed` | unused | No client call or dedicated handler. | — |
| `hook/started` | unused | No client call or dedicated handler. | — |
| `item/agentMessage/delta` | used | Consumes the notification. | `packages/codex/src/agent-event-mapper.ts`, `packages/codex/src/app-server-client.ts` |
| `item/autoApprovalReview/completed` | unused | No client call or dedicated handler. | — |
| `item/autoApprovalReview/started` | unused | No client call or dedicated handler. | — |
| `item/commandExecution/outputDelta` | used | Consumes the notification. | `packages/codex/src/agent-event-mapper.ts`, `apps/desktop/src/main/codex/codex-fork-listener.ts` |
| `item/commandExecution/terminalInteraction` | unused | No client call or dedicated handler. | — |
| `item/completed` | partial | Maps native MCP Apps presentation and private View results alongside chat/tool items. Harness-neutral host updates persist snapshots/context on those items and node catalog rows. Desktop and paired-node View acceptance passes, including public Excalidraw, real next-turn context, native fullscreen/PiP lifecycle and restart activation gating. | `packages/codex/src/agent-event-mapper.ts`, `apps/desktop/src/main/codex/codex-fork-listener.ts`, `apps/desktop/src/main/mcp-apps/executor.ts` |
| `item/fileChange/outputDelta` | unused | No client call or dedicated handler. | — |
| `item/fileChange/patchUpdated` | unused | No client call or dedicated handler. | — |
| `item/mcpToolCall/progress` | unused | No client call or dedicated handler. | — |
| `item/plan/delta` | used | Consumes the notification. | `packages/codex/src/agent-event-mapper.ts`, `apps/desktop/src/main/codex/codex-turn.ts` |
| `item/reasoning/summaryPartAdded` | used | Consumes the notification. | `packages/codex/src/agent-event-mapper.ts`, `apps/desktop/src/main/codex/codex-fork-listener.ts` |
| `item/reasoning/summaryTextDelta` | used | Consumes the notification. | `packages/codex/src/agent-event-mapper.ts`, `apps/desktop/src/main/codex/codex-fork-listener.ts` |
| `item/reasoning/textDelta` | used | Consumes the notification. | `packages/codex/src/agent-event-mapper.ts`, `apps/desktop/src/main/codex/codex-fork-listener.ts` |
| `item/started` | partial | Maps MCP Apps presentation and full private result. Observed 0.159 fixture items use mcpAppResourceUri with mcpAppUi:null; modern mcpAppUi stays preferred. | `packages/codex/src/agent-event-mapper.ts`, `apps/desktop/src/main/codex/codex-fork-listener.ts` |
| `mcpServer/event/stream/notification` | unused | No client call or dedicated handler. | — |
| `mcpServer/oauthLogin/completed` | used | Consumes the notification. | `packages/codex/src/codex-admin.ts`, `apps/desktop/src/main/codex/codex-experiment-service.ts` |
| `mcpServer/startupStatus/updated` | used | Consumes the notification. | `packages/codex/src/agent-event-mapper.ts`, `apps/desktop/src/main/codex/codex-turn.ts` |
| `model/rerouted` | unused | No client call or dedicated handler. | — |
| `model/safetyBuffering/updated` | unused | No client call or dedicated handler. | — |
| `model/verification` | unused | No client call or dedicated handler. | — |
| `modelProvider/authRecoveryCompleted` | unused | No client call or dedicated handler. | — |
| `modelProvider/authRecoveryStarted` | unused | No client call or dedicated handler. | — |
| `process/exited` | unused | No client call or dedicated handler. | — |
| `process/outputDelta` | unused | No client call or dedicated handler. | — |
| `project/changed` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `remoteControl/status/changed` | n/a | SuperOne owns projects, remote hosts, sidebar sections and filesystem operations. | — |
| `serverRequest/resolved` | unused | No client call or dedicated handler. | — |
| `skills/changed` | used | Consumes the notification. | `apps/desktop/src/main/codex/codex-notification-dispatcher.ts` |
| `thread/archived` | unused | No client call or dedicated handler. | — |
| `thread/attachment/updated` | unused | No client call or dedicated handler. | — |
| `thread/closed` | unused | No client call or dedicated handler. | — |
| `thread/compacted` | used | Consumes the notification. | `packages/codex/src/agent-event-mapper.ts`, `apps/desktop/src/main/codex/codex-turn.ts` |
| `thread/deleted` | unused | No client call or dedicated handler. | — |
| `thread/environment/connected` | unused | No client call or dedicated handler. | — |
| `thread/environment/disconnected` | unused | No client call or dedicated handler. | — |
| `thread/goal/cleared` | unused | No client call or dedicated handler. | — |
| `thread/goal/updated` | unused | No client call or dedicated handler. | — |
| `thread/name/updated` | unused | No client call or dedicated handler. | — |
| `thread/project/updated` | unused | No client call or dedicated handler. | — |
| `thread/queue/changed` | used | Consumes the notification. | `apps/desktop/src/main/codex/codex-notification-dispatcher.ts` |
| `thread/realtime/closed` | used | Consumes the notification. | `apps/desktop/src/main/codex/codex-realtime.ts` |
| `thread/realtime/error` | used | Consumes the notification. | `apps/desktop/src/main/codex/codex-realtime.ts` |
| `thread/realtime/item/completed` | partial | Desktop transcriptSegment projection only. | `apps/desktop/src/main/codex/codex-realtime.ts` |
| `thread/realtime/item/started` | partial | Desktop transcriptSegment projection only. | `apps/desktop/src/main/codex/codex-realtime.ts` |
| `thread/realtime/item/transcript/delta` | used | Consumes the notification. | `apps/desktop/src/main/codex/codex-realtime.ts` |
| `thread/realtime/itemAdded` | unused | No client call or dedicated handler. | — |
| `thread/realtime/outputAudio/delta` | unused | No client call or dedicated handler. | — |
| `thread/realtime/sdp` | used | Consumes the notification. | `apps/desktop/src/main/codex/codex-realtime.ts` |
| `thread/realtime/started` | used | Consumes the notification. | `apps/desktop/src/main/codex/codex-realtime.ts` |
| `thread/realtime/transcript/delta` | used | Consumes the notification. | `apps/desktop/src/main/codex/codex-realtime.ts` |
| `thread/realtime/transcript/done` | used | Consumes the notification. | `apps/desktop/src/main/codex/codex-realtime.ts` |
| `thread/reverted` | unused | No client call or dedicated handler. | — |
| `thread/settings/updated` | partial | Diagnostic logging only; no complete settings reducer. | `apps/desktop/src/main/codex/codex-notification-dispatcher.ts` |
| `thread/started` | used | Consumes the notification. | `packages/codex/src/agent-event-mapper.ts`, `apps/desktop/src/main/codex/codex-turn.ts` |
| `thread/status/changed` | partial | Diagnostic logging/routing only; UI state follows session lifecycle. | `apps/desktop/src/main/codex/codex-notification-dispatcher.ts` |
| `thread/tokenUsage/updated` | used | Consumes the notification. | `packages/codex/src/agent-event-mapper.ts`, `apps/desktop/src/main/codex/codex-fork-listener.ts` |
| `thread/unarchived` | unused | No client call or dedicated handler. | — |
| `turn/completed` | used | Consumes the notification. | `packages/codex/src/agent-event-mapper.ts`, `packages/codex/src/app-server-client.ts` |
| `turn/diff/updated` | unused | No client call or dedicated handler. | — |
| `turn/moderationMetadata` | unused | No client call or dedicated handler. | — |
| `turn/plan/updated` | used | Consumes the notification. | `packages/codex/src/agent-event-mapper.ts`, `apps/desktop/src/main/codex/codex-turn.ts` |
| `turn/started` | used | Consumes the notification. | `apps/desktop/src/main/codex/codex-fork-listener.ts`, `apps/desktop/src/main/codex/codex-turn.ts` |
| `warning` | unused | No client call or dedicated handler. | — |
| `windows/worldWritableWarning` | unused | No client call or dedicated handler. | — |
| `windowsSandbox/setupCompleted` | unused | No client call or dedicated handler. | — |

## Experimental server notifications

None in the pinned schema.
