# DeepSeek harness (dsh) API surface

Ledger version: `0.2.2-rc.1` · Cordis `4.1.0`, Loader/Include `1.1.0`

Manual inventory checked against the installed published declarations/runtime and
[upstream tag](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.1).
The shared inventory script has no dsh extractor. This ledger covers the embedded
host's service, event, configuration and relevant optional-capability boundaries;
it does not enumerate the separate upstream browser UI, SDK, SSH or application
APIs. Plugin pins/composition coverage are also checked by `manifest.test.ts` and
`bundled-plugins.test.ts`.

Status vocabulary: [harness documentation](../README.md#ledger-api-surfacemd).
Service/handle prefixes disambiguate upstream methods with the same name.
`partial` includes upstream plugins that consume the interface on SuperOne's
behalf without a separate host control.


## Agent lifecycle and input

| Name | Status | Usage | Code |
|---|---|---|---|
| `agents.create` | used | Create an agent with host-owned setup/preset composition | `packages/deepseek/src/runtime.ts#createAgent` |
| `agents.resume` | used | Restore persisted sessions under the recorded preset | `packages/deepseek/src/runtime.ts#createAgent` |
| `agents.get` | used | Resolve in-process children at lifecycle publication | `packages/deepseek/src/runtime.ts` |
| `agents.list` | unused | SuperOne retains the agents it owns | — |
| `agents.roots` | unused | SuperOne owns its top-level session catalog | — |
| `AgentHandle.dispose` | used | Await agent/session teardown | `packages/deepseek/src/runtime.ts#createAgent` |
| `Agent.followup` | used | Submit an ordinary user turn | `packages/deepseek/src/runtime.ts#createAgent` |
| `Agent.steer` | used | Deliver input at the nearest step boundary | `packages/deepseek/src/runtime.ts#createAgent` |
| `Agent.cancel` | used | Stop activity with an explicit cause | `packages/deepseek/src/runtime.ts` |
| `Agent.whenIdle` | used | Wait for agent quiescence | `packages/deepseek/src/runtime.ts` |
| `Agent.runMaintenance` | unused | Host compaction uses the preset-scoped compaction service | — |
| `Agent.send` | unused | Host uses followup/steer convenience methods | — |
| `Agent.inject` | partial | Upstream background plugins inject context; no public host injection control | `packages/deepseek/src/tree.ts` |
| `Agent.model.current` | used | Read the effective model/effort choice | `packages/deepseek/src/runtime.ts` |
| `Agent.model.select` | used | Durably select the complete route for future steps | `packages/deepseek/src/runtime.ts` |
| `Agent.inbox` | partial | Upstream queues accepted input; host owns the visible pre-delivery queue | `packages/deepseek/src/runtime.ts` |
| `CreateAgentOptions.setup` | used | Compose preset, host tools and prompt sections before publication | `packages/deepseek/src/runtime.ts#createAgent` |
| `AgentOptions.maxTokens` | used | Optional output-token limit | `packages/deepseek/src/runtime.ts#createAgent` |

## Live events

| Name | Status | Usage | Code |
|---|---|---|---|
| `session/event` | used | Feed committed log facts to mapper and trajectory | `packages/deepseek/src/runtime.ts` |
| `session/created` | partial | Mounted domains initialize session state; host uses awaited agent creation | `packages/deepseek/src/tree.ts` |
| `session/disposed` | partial | Mounted domains release session state | `packages/deepseek/src/tree.ts` |
| `session/flush` | partial | Agent/persistence lifecycle owns the durability barrier | `packages/deepseek/src/tree.ts` |
| `agent/created` | partial | Mounted services initialize policies before create/resume resolves | `packages/deepseek/src/tree.ts` |
| `agent/disposed` | partial | Mounted services own scoped cleanup | `packages/deepseek/src/tree.ts` |
| `agent/status` | used | Notify the host when activity settles | `packages/deepseek/src/runtime.ts` |
| `agent/assistant-stream` | used | Map start/chunk/end frames with attempt identity and retraction | `packages/deepseek/src/event-map.ts#handleStreamFrame` |
| `agent/pre-step` | partial | Upstream owns prompt, tool-admission and compaction preparation | `packages/deepseek/src/tree.ts` |
| `agent/request` | partial | Upstream request controls; model routing belongs to Agent.model | `packages/deepseek/src/tree.ts` |
| `agent/request-error` | partial | Mounted retry and image-offload recovery | `packages/deepseek/src/tree.ts` |
| `agent/turn-stopping` | used | Emit shell-origin edit rows before turn completion | `packages/deepseek/src/runtime.ts` |
| `agent/error` | unused | Host errors derive from durable turn/step settlement | — |
| `agent/inbox/inserted` | unused | No independent host inbox subscription | — |
| `agent/inbox/claimed` | unused | No independent host inbox subscription | — |
| `agent/inbox/discarded` | unused | No independent host inbox subscription | — |
| `tools/execute` | used | Correlate calls with child/job activity and host ownership | `packages/deepseek/src/runtime.ts` |
| `tools/pre-execute` | used | Host permission admission | `packages/deepseek/src/tool-plane.ts` |
| `tools/post-execute` | partial | Upstream execution policy owns result settlement | `packages/deepseek/src/tree.ts` |
| `tools/result` | partial | Upstream result publication | `packages/deepseek/src/tree.ts` |
| `tools/change` | partial | Upstream refreshes model-facing definitions after registration changes | `packages/deepseek/src/tool-surface.ts` |
| `approval/request` | used | Route operation approval into the host | `packages/deepseek/src/runtime.ts` |
| `user-questions/request` | used | Present native questions and plan-review intent | `packages/deepseek/src/user-questions.ts` |
| `subagent/start` | used | Associate the published child with its launching call | `packages/deepseek/src/runtime.ts` |
| `subagent/end` | used | Finish child task/usage reporting | `packages/deepseek/src/runtime.ts` |

## Session and persistence services

| Name | Status | Usage | Code |
|---|---|---|---|
| `SESSION_FORMAT_VERSION` | used | Current durable session format remains v4 | `packages/deepseek/src/runtime.ts` |
| `SessionId` | used | Brand identities at upstream boundaries | `packages/deepseek/src/runtime.ts` |
| `SessionLogOffset` | used | Brand exact inherited-prefix length | `packages/deepseek/src/runtime.ts#forkSession` |
| `Session.snapshotEvents` | used | Read immutable log snapshots through the current public API | `packages/deepseek/src/runtime.ts` |
| `Session.eventAt` | unused | Host reads its bounded trajectory projection | — |
| `Session.ownEvents` | unused | Host read/fork paths retain complete lineage | — |
| `Session.append` | partial | Mounted domains append facts; host forks through persistence | `packages/deepseek/src/tree.ts` |
| `Session.requestHeader` | partial | Upstream prepares requests; host trajectory folds headers independently | `packages/deepseek/src/trajectory/header.ts` |
| `Session.deriveMessages` | partial | Upstream owns model-history projection | `packages/deepseek/src/tree.ts` |
| `sessions.get` | used | Resolve live sessions and their ancestry | `packages/deepseek/src/runtime.ts` |
| `sessions.create` | partial | Agent factory owns session creation | `packages/deepseek/src/runtime.ts#createAgent` |
| `sessions.fork` | unused | Host supports cold forks using persistence/buildForkSeed | `packages/deepseek/src/runtime.ts#forkSession` |
| `sessions.flush` | partial | Agent/persistence lifecycle supplies flushes | `packages/deepseek/src/tree.ts` |
| `buildForkSeed` | used | Build fork seed at a completed-turn boundary | `packages/deepseek/src/runtime.ts#forkSession` |
| `sessionPersistence.stat` | used | Distinguish missing sessions from read failures | `packages/deepseek/src/stored-session.ts#readStoredSession` |
| `sessionPersistence.open` | used | Read without contending with the active writer | `packages/deepseek/src/stored-session.ts#readStoredSession` |
| `sessionPersistence.create` | used | Create independent forks with exact inherited-prefix metadata | `packages/deepseek/src/runtime.ts#forkSession` |
| `sessionPersistence.list` | unused | SuperOne owns the visible session catalog | — |
| `sessionPersistence.flush` | partial | Upstream owns active-write durability | `packages/deepseek/src/tree.ts` |
| `session-persistence-jsonl.compression` | used | Explicit zstd preserves the existing published-backend encoding; opposite-encoding roots are refused | `packages/deepseek/src/tree.ts#createDeepseekTree` |
| `SessionHandle.read` | used | Read validated log and immutable header | `packages/deepseek/src/stored-session.ts#readStoredSession` |
| `SessionHandle.append` | used | Append a fork seed | `packages/deepseek/src/runtime.ts#forkSession` |
| `SessionHandle.close` | used | Always release persistence handles | `packages/deepseek/src/stored-session.ts` |
| `SessionHandle.inheritedEventCount` | unused | Host creates its own exact fork prefix and reads full source logs | — |
| `sessionProjections.register` | partial | Mounted domains await registration and retain handles | `packages/deepseek/src/tree.ts` |
| `sessionProjections.snapshot` | unused | Host serves its own trajectory projection | — |
| `ProjectionDefinition.init` | used | Fold preset selection with header and inherited-prefix inputs | `packages/deepseek/src/presets.ts#storedSessionPreset` |

## Durable event vocabulary

| Name | Status | Usage | Code |
|---|---|---|---|
| `turn/start` | used | Turn boundaries and blank-session preset lock | `packages/deepseek/src/event-map.ts` |
| `turn/end` | used | Turn completion, errors and cancellation | `packages/deepseek/src/event-map.ts` |
| `step/start` | used | Step identity and trajectory | `packages/deepseek/src/event-map.ts` |
| `step/end` | used | Usage and step finish state | `packages/deepseek/src/event-map.ts` |
| `request/header` | used | Route, capacity and prompt-header trajectory | `packages/deepseek/src/trajectory/header.ts` |
| `request/context` | used | Context-window tracking and trajectory | `packages/deepseek/src/event-map.ts`, `packages/deepseek/src/trajectory/fold.ts` |
| `user/message` | used | Committed user transcript | `packages/deepseek/src/trajectory/fold.ts` |
| `assistant/message` | used | Durable assistant text/tool calls and embedded stream | `packages/deepseek/src/event-map.ts` |
| `assistant/attempt` | partial | Live end-frame settlement retracts attempts; durable raw log remains available | `packages/deepseek/src/event-map.ts` |
| `tool/call` | used | Native/nested tool identity and input | `packages/deepseek/src/event-map.ts` |
| `tool/result` | used | Tool output/error mapping | `packages/deepseek/src/event-map.ts` |
| `system/message` | used | System-prompt trajectory | `packages/deepseek/src/trajectory/fold.ts` |
| `developer/message` | used | Developer-prompt trajectory | `packages/deepseek/src/trajectory/fold.ts` |
| `model/selection` | partial | Upstream restores route changes selected through host controls | `packages/deepseek/src/runtime.ts` |
| `agent/inbox/spliced` | partial | Upstream restores accepted pending input; no host inbox editor | `packages/deepseek/src/runtime.ts` |
| `agent-preset/selected` | used | Preserve the newest recorded preset on resume | `packages/deepseek/src/presets.ts#storedSessionPreset` |
| `approval/asked` | used | Approval trajectory | `packages/deepseek/src/trajectory/fold.ts` |
| `approval/decided` | used | Approval trajectory | `packages/deepseek/src/trajectory/fold.ts` |
| `llm/retry` | used | Shared API retry event | `packages/deepseek/src/event-map.ts` |
| `todo/write` | used | Map whole-list todos with stable positional host IDs | `packages/deepseek/src/event-map.ts` |
| `compaction/start` | used | Start compaction progress and trajectory | `packages/deepseek/src/event-map.ts` |
| `compaction/summary` | used | Summary and pre/post token accounting | `packages/deepseek/src/event-map.ts`, `packages/deepseek/src/trajectory/fold.ts` |
| `compaction/end` | used | Compaction completion or error | `packages/deepseek/src/event-map.ts` |
| `workspace/changes` | used | Project shell-origin edits into ordinary file rows | `packages/deepseek/src/workspace-changes.ts` |

## Model, tool and prompt services

| Name | Status | Usage | Code |
|---|---|---|---|
| `LlmAdapter` | used | Scripted adapter verifies integration without service credentials | `packages/deepseek/src/test-adapters.ts` |
| `llm.registerAdapter` | used | Register scripted test adapters; official adapter registers itself | `packages/deepseek/src/test-adapters.ts`, `packages/deepseek/src/tree.ts` |
| `@deepseek-ai/dsh-llm-deepseek-api-key` | used | Mount the API-key provider for the deepseek-official route; protocol-only llm-deepseek is not a plugin | `packages/deepseek/src/tree.ts#deepseekAdapterPlugin` |
| `llm-deepseek-api-key.apiKeyEnv` | used | Resolve DEEPSEEK_API_KEY through the read-only host credential seam | `packages/deepseek/src/tree.ts#deepseekAdapterPlugin` |
| `llm-deepseek.DEFAULT_CONTEXT_WINDOW` | unused | Generic custom-model fallback is decimal 1,000,000; official host catalog sets its exact capacity | `apps/desktop/src/main/deepseek/deepseek-runtime-host.ts` |
| `llm-deepseek.DEFAULT_MAX_TOKENS` | partial | Adapter default output cap is 256,000 unless model/request overrides it | `packages/deepseek/src/tree.ts#deepseekAdapterPlugin` |
| `llm.listProviders` | used | Host model catalog | `packages/deepseek/src/runtime.ts` |
| `llm.listModels` | used | Advisory provider model catalog | `packages/deepseek/src/runtime.ts` |
| `llm.resolveModelInfo` | used | Exact route capabilities, reasoning efforts and image admission | `packages/deepseek/src/runtime.ts` |
| `llm.discoverModels` | unused | Host uses the configured adapter catalog | — |
| `DeepSeekCatalogModel` | used | Explicit desktop models/modalities and official 1,048,576-token context capacities | `apps/desktop/src/main/deepseek/deepseek-runtime-host.ts` |
| `createUserMessage` | used | Identified text/image user input | `packages/deepseek/src/runtime.ts` |
| `admitEncodedImages` | used | Validate and store encoded images before delivery | `packages/deepseek/src/images.ts` |
| `tools.register` | used | Register exact canonical host tool names in agent scope | `packages/deepseek/src/tool-surface.ts#mountSuperoneTools` |
| `tools.resolve` | partial | Upstream captures step-specific activation before model dispatch | `packages/deepseek/src/tree.ts` |
| `tools.executable` | partial | Upstream enforces the captured step admission set | `packages/deepseek/src/tool-plane.ts` |
| `tools.restrict` | partial | Upstream presets inherit tool restrictions; host admission uses executor permission checks | `packages/deepseek/src/tool-plane.ts` |
| `ToolDefinition.output` | used | JSON result envelope and model text renderer | `packages/deepseek/src/tool-surface.ts` |
| `ToolDefinition.execute` | used | Direct in-process dispatch to host executors | `packages/deepseek/src/tool-surface.ts` |
| `systemPrompt.section` | used | Literal host/session instructions survive preset persona overrides | `packages/deepseek/src/tree.ts` |
| `systemPrompt.context` | partial | Upstream working-directory and policy contributions | `packages/deepseek/src/tree.ts` |
| `systemPrompt.assemble` | partial | Agent-loop owns prompt/tool preparation | `packages/deepseek/src/tree.ts` |
| `@deepseek-ai/dsh-tool-executor-native` | used | Native executor required by preset compositions | `packages/deepseek/src/tree.ts` |
| `@deepseek-ai/dsh-tool-executor-ptc` | used | PTC executor required by PTC composition | `packages/deepseek/src/tree.ts` |
| `@deepseek-ai/dsh-ptc-runtime-node` | used | Host-supplied Electron-compatible Node launcher | `packages/deepseek/src/tool-plane.ts` |
| `@deepseek-ai/dsh-tool-apply-patch` | unused | Optional upstream multi-file patch tool; not added to shipped roster | `docs/harness/dsh/backlog.md` |

## Presets, permissions and background work

| Name | Status | Usage | Code |
|---|---|---|---|
| `agentPresets.list` | used | Host preset picker | `packages/deepseek/src/presets.ts#listDeepseekPresets` |
| `agentPresets.resolve` | used | Resolve canonical identity before freezing a new session header | `packages/deepseek/src/runtime.ts#createAgent` |
| `agentPresets.mount` | used | Compose preset inside unpublished agent setup | `packages/deepseek/src/runtime.ts#createAgent` |
| `agentPresets.composedPreset` | used | Read composition identity | `packages/deepseek/src/runtime.ts` |
| `agentPresets.select` | used | Switch a blank session and persist the selection | `packages/deepseek/src/runtime.ts` |
| `agentPresets.serviceFor` | used | Resolve services owned by the selected preset realm | `packages/deepseek/src/runtime.ts` |
| `agentPresets.readDocument` | unused | No host preset-source editor | — |
| `agentPresetProjectionDefinition` | used | Fold stored selection with upstream semantics | `packages/deepseek/src/presets.ts#storedSessionPreset` |
| `entryListProblem` | used | Reject invalid vendored compositions | `packages/deepseek/src/presets.ts#readPresetDeclarations` |
| `permissionPresets.set` | used | Apply permission mode to one session | `packages/deepseek/src/runtime.ts` |
| `planMode.set` | used | Toggle durable plan mode through the preset realm | `packages/deepseek/src/runtime.ts#setPlanMode` |
| `commands.execute` | used | Execute /compact inside the composition that owns its engine | `packages/deepseek/src/runtime.ts#compactSession` |
| `compaction.compactNow` | partial | Upstream command-compact owns direct engine access | `packages/deepseek/src/runtime.ts#compactSession` |
| `workingDirectory.get` | partial | Mounted executors resolve each session effective directory | `packages/deepseek/src/tool-plane.ts` |
| `workingDirectory.ensure` | partial | Validate the current/original project before prompt assembly; fake or deleted cwd can fail before model dispatch | `packages/deepseek/src/tool-plane.ts` |
| `workingDirectory.set` | unused | No separate host control for changing a running session directory | — |
| `userQuestions.ask` | partial | Native/PTC questions reach the shared host waterfall | `packages/deepseek/src/user-questions.ts` |
| `AskUserQuestionItem.intent` | used | Route plan-review to the plan approval card | `packages/deepseek/src/user-questions.ts#presentQuestions` |
| `UserQuestionError` | used | Encode host question dismissal | `packages/deepseek/src/runtime.ts` |
| `subagents.interrupt` | used | Stop a selected child under ancestor authority | `packages/deepseek/src/runtime.ts` |
| `subagents.drainDescendants` | used | Await child-tree cleanup during disposal | `packages/deepseek/src/runtime.ts` |
| `subagents.waitForChildren` | partial | Mounted controls provide child wait/notification policy | `packages/deepseek/src/tree.ts` |
| `subagents.startActivation` | partial | Mounted tools create immediately identified children | `packages/deepseek/src/tree.ts` |
| `subagents.listChildren` | partial | Upstream child discovery; host tasks use lifecycle events | `packages/deepseek/src/tree.ts` |
| `subagents.listDescendants` | unused | Host retains its observed children | — |
| `subagents.prompt` | partial | Mounted controls provide child follow-ups | `packages/deepseek/src/tree.ts` |
| `subagents.sendMessage` | partial | Mounted controls provide child messaging | `packages/deepseek/src/tree.ts` |
| `SubagentModelSelectionSettings` | used | Exact allowed routes, snapshotted per session | `packages/deepseek/src/tree.ts` |
| `jobs.events.subscribe` | used | Observe background registration/settlement | `packages/deepseek/src/background-work.ts#subscribe` |
| `jobs.list` | used | Promote jobs still running after their tool returned | `packages/deepseek/src/background-work.ts#settleCall` |
| `jobs.kill` | used | Stop one task or all session jobs | `packages/deepseek/src/background-work.ts` |
| `workspaceChanges.summary` | used | Read changed-file summaries | `packages/deepseek/src/workspace-changes.ts#workspaceChangeRows` |
| `workspaceChanges.diff` | used | Read bounded file comparisons for chat rows | `packages/deepseek/src/workspace-changes.ts#workspaceChangeRows` |

## Credentials and confinement providers

| Name | Status | Usage | Code |
|---|---|---|---|
| `CredentialProvider.resolve` | used | Resolve current SuperOne credentials per operation without exporting secrets into process.env | `packages/deepseek/src/credentials.ts#SuperoneCredentialProvider` |
| `CredentialProvider.describe` | used | Report readiness and read-only ownership | `packages/deepseek/src/credentials.ts#SuperoneCredentialProvider` |
| `CredentialProvider.set` | used | Explicitly refuse harness-side credential writes | `packages/deepseek/src/credentials.ts#SuperoneCredentialProvider` |
| `CredentialProvider.unset` | used | Explicitly refuse harness-side credential deletion | `packages/deepseek/src/credentials.ts#SuperoneCredentialProvider` |
| `CredentialProvider.readRecord` | partial | Report an empty grant-record space; shipped adapter only resolves references | `packages/deepseek/src/credentials.ts#SuperoneCredentialProvider` |
| `CredentialProvider.describeRecord` | partial | Report records unconfigured and unwritable | `packages/deepseek/src/credentials.ts#SuperoneCredentialProvider` |
| `CredentialProvider.listRecords` | partial | Return no independently stored grants | `packages/deepseek/src/credentials.ts#SuperoneCredentialProvider` |
| `CredentialProvider.modifyRecord` | partial | Refuse third-party grant persistence through the host credential provider | `packages/deepseek/src/credentials.ts#SuperoneCredentialProvider` |
| `CredentialProvider.deleteRecord` | partial | Refuse grant mutation | `packages/deepseek/src/credentials.ts#SuperoneCredentialProvider` |
| `@deepseek-ai/dsh-subprocess-local` | used | Local runner, with the versioned Electron runner-environment patch | `packages/deepseek/src/tool-plane.ts` |
| `@deepseek-ai/dsh-sandbox-local` | used | Platform confinement provider, failing closed when unavailable | `packages/deepseek/src/tool-plane.ts` |
| `@deepseek-ai/dsh-sandbox-policy` | used | Resolve per-session sandbox mode and workspace boundary | `packages/deepseek/src/tool-plane.ts` |
| `@deepseek-ai/dsh-fs-sandbox` | used | Confine file operations under the same policy as shell execution | `packages/deepseek/src/tool-plane.ts` |
| `@deepseek-ai/dsh-bash-sandbox` | used | Confine shell execution | `packages/deepseek/src/tool-plane.ts` |
| `@deepseek-ai/dsh-attachment-local` | used | Content-addressed image storage under an explicit host-owned directory | `packages/deepseek/src/tree.ts` |
| `ptc-runtime-node.launch` | used | Override the Node executable with the host Electron-compatible launcher | `packages/deepseek/src/tool-plane.ts` |
| `ptc-runtime-node.executionMode` | unused | Keep upstream per-call default; VM Script/state retention are deferred | `docs/harness/dsh/backlog.md` |
| `ptc-runtime-node.scriptPersistence` | unused | Cross-call VM memory remains disabled | `docs/harness/dsh/backlog.md` |

## Cordis, dynamic plugins and optional application features

| Name | Status | Usage | Code |
|---|---|---|---|
| `Context.plugin` | used | Mount the embedded host tree | `packages/deepseek/src/tree.ts` |
| `Context.get` | used | Optional service access without undeclared injection-property reads | `packages/deepseek/src/runtime.ts` |
| `Context.effect` | used | Tie registrations/subscriptions to owner teardown | `packages/deepseek/src/tool-surface.ts` |
| `Fiber.dispose` | used | Await root-tree disposal | `packages/deepseek/src/runtime.ts#dispose` |
| `Fiber.await` | used | Inspect startup failures represented as entry state | `packages/deepseek/src/cordis-loader.ts#entryFailure` |
| `loader.builtins` | used | Register group before preset activation | `packages/deepseek/src/tree.ts` |
| `loader.create` | used | Stable IDs for preset/plugin/MCP/settings rows | `packages/deepseek/src/cordis-loader.ts` |
| `loader.update` | used | Reconcile MCP/plugins and live model-selection preference | `packages/deepseek/src/tree.ts` |
| `loader.remove` | used | Remove obsolete plugin/MCP rows | `packages/deepseek/src/mcp-servers.ts` |
| `loader.await` | used | Wait for dependent entries before activation inspection | `packages/deepseek/src/cordis-loader.ts` |
| `loader.resolve` | used | Inspect row/fiber activation state | `packages/deepseek/src/cordis-loader.ts#entryFailure` |
| `loader.import` | used | Surface module evaluation failures for rows without fibers | `packages/deepseek/src/cordis-loader.ts#entryFailure` |
| `entryListSchema` | used | Parse vendored upstream !!js declarations | `packages/deepseek/src/presets.ts#readPresetDeclarations` |
| `applyEntryPatches` | used | Apply declarations with upstream patch semantics | `packages/deepseek/src/presets.ts#readPresetDeclarations` |
| `writeFileAtomic` | used | Persist the host plugin registry | `packages/deepseek/src/plugin-host/registry.ts` |
| `withFileLock` | used | Serialize plugin registry updates | `packages/deepseek/src/plugin-host/registry.ts` |
| `@deepseek-ai/dsh-mcp-client` | used | Third-party stdio and Streamable HTTP servers | `packages/deepseek/src/mcp-servers.ts` |
| `@deepseek-ai/dsh-mcp-resources` | used | Resource/template/read tools for configured servers | `packages/deepseek/src/tree.ts` |
| `@deepseek-ai/dsh-official-bundles` | unused | Host composes its own embedded tree | — |
| `@deepseek-ai/dsh-experimental-tool-subagent-oar` | unused | Host already owns cross-engine delegation | `docs/harness/dsh/backlog.md` |
