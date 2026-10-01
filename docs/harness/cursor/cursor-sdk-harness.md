# Cursor SDK harness

SuperOne integrates Cursor through the native SDK. `packages/cursor` contains
Electron-free runtime, store, mapping and API helpers; desktop's `main/cursor/`
provides credential/path adapters and `session/backends/cursor-backend.ts`
implements `SessionBackend`. Current pins and upgrade history belong to the
[integration index](README.md).

## Design decisions

The D labels remain stable for references from code and harness guidance.
Historical implementation ordering is in git history, not a second task tracker.

| ID | Current decision |
|---|---|
| D1 | Use the native SDK in the host's Node process; load it lazily. |
| D2 | Use a Cursor User API Key, pasted or minted by the SDK browser-login flow, and store it in SuperOne's vault. Do not scrape the IDE login. |
| D3 | Local sessions are the default; explicit cloud configuration or a `bc-` provider ID selects cloud behavior. |
| D4 | Map into shared Claude-family `AgentEvent`/reducers, with a package core and thin desktop adapters. |
| D5 | Explicit per-workspace `better-sqlite3` store on local create/resume; no process-global store switching. |
| D6 | Live content comes from `onDelta`; `onStep` supplements tool details; `Run.stream` is lifecycle-only during a live send. `Run.wait` owns terminal reconciliation. |
| D7 | Agent/Plan/Full Access reflect `mapPermissionToCursorLocal`; sandbox is a separate runtime fact. Rebuild when create-time options change. |
| D8 | Use measured context occupancy and the selected model's known window. Return null before occupancy exists; never invent a window size. |
| D9 | Implement and verify capabilities as coherent slices; the original PR sequence is complete planning history. |
| D10 | Distribution policy is independent of technical bundling. The old design's redistribution-review outcome is not documented here; retain it as an open evidence item in backlog. |
| D11 | No percentage-of-API-coverage claims until the versioned ledger is populated and checked. |

## Identity, lifecycle and storage

SuperOne's UUID is not the SDK's `agentId`. `onProviderSessionId` persists the
latter for resume. `createCursorRuntime` selects `Agent.create` or `Agent.resume`,
passes the API key explicitly and supplies local cwd/store/settings or cloud
repository/environment options as appropriate.

`BetterSqliteLocalAgentStore` owns agents, runs, checkpoints and run events under
`<userData>/cursor-sdk/<workspaceHash>/agent-store.db`. It uses WAL and the
existing better-sqlite3 stack. Local create and resume always pass this store;
a `storeKind` config field does not make JSONL an implemented product default.
A per-session `Cursor.configure({ local: { store } })` would race other sessions.

Closing/idle release disposes the runtime lease without deleting durable state.
Cancellation and generation checks prevent late preparation or `run.wait()`
results from resurrecting an interrupted send. `forceRecover` is local-only:
cloud recovery uses cancellation, because a forced local-send option could
otherwise become a billed ordinary cloud message.

## Auth

[Authentication](cursor-auth-local-login.md) owns the login/vault boundary.
`Cursor.auth.login` is wired through desktop IPC, opens a browser and returns a
minted User API Key. The desktop encrypts it into the base provider config and
marks Cursor sessions for rebuild. SDK login storage and SuperOne's vault are
separate; SDK logout alone does not delete the copied provider credential.

## Local configuration and permissions

`cursor-local-options.ts` builds the common create/prewarm plan. Defaults include
project and user setting sources and agent retries. The workspace prewarm must
match cwd, credentials, settings, sandbox, MCP and auto-review options or it
misses the executor cache.

`mapPermissionToCursorLocal` maps Plan to `mode: 'plan', autoReview: false`,
Agent/default/auto/acceptEdits to `agent` with auto-review, and high-automation
modes to `agent` without auto-review. This is not a Claude permission callback.
The session's sandbox choice is independent; effective support is resolved from
platform binaries rather than assumed from a requested flag. Cloud agents ignore
local sandbox options.

The backend rebuilds when relevant mode/auto-review options or local sandbox
change. On failure it restores prior options and attempts to revive the previous
runtime. Explicit local tool allow/deny lists and the readonly/no-shell presets
are built by `resolveCursorToolRestrictions`.

## Host tools, MCP and interactions

`main/cursor/cursor-mcp.ts` injects enabled user MCP servers and the SuperOne HTTP
MCP endpoint. HTTP avoids the stdio bridge's initialization wait on the first
turn. The full SuperOne tool catalog is therefore **MCP**, not a copied custom
SDK tool catalog.

For local stdio MCP App servers, desktop performs bounded discovery before
prewarm/create and reroutes connected App servers through `miniapp_list` /
`miniapp_call` for that session. The source config stays untouched. Ordinary
servers stay native and their discovery is cached. The compatibility provider
supplies resource reads and View calls through the shared MCP Apps executor;
agent calls use the existing mini-app approval gate. Cloud and remote-node
sessions keep their existing paths. See [MCP Apps](../../features/mcp-apps.md).

Local custom tools provide session metadata and the awaiting question bridge
(`superone_ask_user_question`). They are not exposed to cloud agents. A completed
`createPlan` call triggers host plan review; the backend owns the follow-up
decision. Executor-owned tool gates still apply, including terminal command
confirmation: the SDK does not provide a host approval hook for custom tools.

MCP reconnect/toggle refreshes the runtime configuration through reload; it is
not a per-server reconnect implementation. Keep names and unsupported outcomes
consistent across host tools and UI.

## Events and usage

`cursor-event-map.ts` turns interaction deltas into text, thinking, tool-input,
tool-result, todo and child-task events. Nested tool updates retain the launching
`parentToolUseId`. `onStep` details are correlated to real call IDs observed from
deltas. The live `Run.stream()` consumer uses `includeContent: false` to prevent
duplicate assistant content. Result usage reconciles interim counters.

The backend retains the latest context occupancy separately from cumulative
billed usage. `cursor-model-selection.ts` resolves the model window;
`mapCursorContextUsageInfo` computes a percentage only when a positive window is
known (otherwise maxTokens/percentage remain zero). `getContextUsage` returns
null only before a positive occupancy sample, not permanently as the old design
claimed.

## Cloud and host APIs

`cursor-cloud.ts` provides local/cloud listing, agent lookup, message/run paging,
run cancellation, archive/unarchive/delete, repositories, artifacts and usage.
Desktop IPC wrappers supply credentials and local store context. Local and cloud
operations have different support constraints; keep their routing explicit.
A host API is not proof of a complete dedicated cloud-management UI.

True provider transcript fork is unsupported. `cursor-fork.ts` can create a new
agent with matching settings while SuperOne copies visible history, but the
provider conversation starts blank. `supportsFork` stays false. `rewindFiles`
returns an explicit unsupported result; there is no host file-restoration API.

## Packaging and runtime loading

`loadCursorSdk()` is a lazy boundary. Importing SDK values directly into desktop
startup would load an optional harness for every user. Platform packages supply
cursorsandbox, ripgrep and tree-sitter assets. `cursor-platform-binaries.ts`
resolves the matching package, maps app.asar paths to app.asar.unpacked and
adapts SDK lookup around Electron's argv/execPath shape.

Exercise actual platform lookup and packaged dependencies when changing this
boundary; a TypeScript check does not prove executables are present or runnable.
Do not use package presence as proof that sandbox confinement succeeded.

## Verification and limitations

Runtime, mapper, model selection, store, network retry, platform binary and custom
tool tests live in `packages/cursor/src`; desktop backend/interactions and IPC
have colocated checks. UI changes require the matching production stories.

`HARNESS_CAPABILITIES.cursor` remains the feature contract: MCP, plan, todos,
subagents and streaming tool input are enabled; manual compact, queued steering,
additional directories, true transcript fork and goal controls are not. Further
work is in [backlog](backlog.md), not an obsolete 15-PR implementation plan.
