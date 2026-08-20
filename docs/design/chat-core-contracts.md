# chat-core contracts (WP-02 freeze)

Status: **frozen** — 2026-08-21  
Baseline: desktop **v0.55.2-alpha** (`feat/migrate-to-expo` merged that tag)  
Plan: `docs/design/flutter-to-expo-migration-plan.md`  
Scope: Remote Control client (Expo). Not a desktop IDE clone.

This freeze is the type + protocol contract for `@superone/chat-core` and the RN ↔ WebView host. Implementation still lives in `apps/desktop/.../event-reducer` until WP-11 / WP-12.

---

## 1. Product scope (Remote Control parity)

Expo must match Flutter 1.0.0+19 **plus** every **remote-visible** desktop surface as of v0.55.2.

**In scope** (chat transcript, composer, pairing, terminal, permission/plan/question sheets):

| Area | v0.53.3 → v0.55.2 delta Expo must paint / drive |
|------|--------------------------------------------------|
| Transcript | sandbox chip; model-fallback notice row; structured `errorInfo` badge; grouped `task_notification`; background-task wake row; unified tool status; native `@native/*` widget galleries; DeepSeek Task block + `diagnostic`; Cursor nested subagents; Codex Fast / Approve for Me presets |
| Composer | `@widget`, `@debug`; `@codex` / `@claude` / `@grok` instead of `@collab`; collab `handoff`; additional dirs persist (`provider` on add/remove RPC); IME from desktop ChatInput |
| Lifecycle | `messages_retracted`; drafts if the remote snapshot exposes them |
| Theme | `setTheme` from desktop light-mode inverted chrome tokens (no independent WebView palette) |

**Out of scope** (desktop-only; do not port):

- DeepSeek in-process runtime, trajectory panel, plugin host, MCP settings
- Computer Use workspace / helper PiP
- Agent browser PiP, CDP performance
- Liquid Glass, `.ipynb` file preview, custom-provider settings UI
- Sidebar add-project GitHub search, harness onboarding, auto-update

`dsh` sessions still stream over remote as ordinary `AgentEvent`s. Expo renders Task blocks; it does not run dsh.

---

## 2. Signature

```ts
applyEventToSession(
  session: ChatCoreSession,
  event: AgentEvent,
  ports?: ChatCorePorts,
): ChatCorePatch
```

- One function. No forked reducer. No half-package mobile cutover.
- Desktop `event-slice` continues to merge patches structurally (`{ ...session, ...patch }`).
- `ChatCorePatch` is the exhaustive write-set below, not `Partial<PerSessionState>` with composer junk.

```ts
export interface ChatCorePorts {
  now(): number
  id(prefix: string): string
  trace?(channel: string, name: string, payload: unknown): void
}
```

Default desktop adapter: `now: () => Date.now()`, `id: (p) => p + Date.now()`, `trace: window.app?.trace`. Injected in WP-11.

---

## 3. `ChatCoreSession` (read union)

Union of every `session.*` field family reducers **read** on `PerSessionState`, plus every field they **write** (merge needs the current value).

**In the reducer graph (must ship in chat-core):**

```
messages queuedMessages status awaitingAssistantReply lastEventAt
streamingTokens lastAssistantMessageId promptSuggestion
pendingPermissions pendingQuestion pendingPlanApproval planApprovalOutcome
permissionMode apiRetry
session _providerSessionId sessionProvider preferredProvider
todos showTodos _todosUserDismissed _nextTodoId
taskProgress subagentTokens _streamingToolInputPreviews
browserDownloads videoGenStatuses
totalCostUsd contextTokens contextWindow
codexUsageSnapshot codexTurnLastUsage
isCompacting isRecapping compactError
_pendingCompactUserId _pendingSlashCommand slashCommandOutput
rateLimitInfo
selectedModel modelUserChosen selectedEffort effortUserChosen
selectedCodexModel selectedCodexReasoningEffort selectedCodexServiceTier
selectedCodexPermissionPreset selectedCodexCollaborationMode
codexModelUserChosen codexReasoningEffortUserChosen codexPlanRejectHintActive
openCodeAgentId apiProviderId
acpAgentId acpModels acpModelConfigId acpModelsStatus acpModelsError
acpModes acpModeConfigId acpModesStatus selectedAcpModeId
acpSlashCommands acpSlashCommandsStatus
_latestCodexTodoList cwd _worktreeRemoved
```

**Composer / shell only — not in ChatCoreSession, never patched by `applyEventToSession`:**

```
draftText draftJson draftId attachments mentions browserAnnotations
miniAppContexts userSelections chatInputFocusNonce chatInputRestoreFocusNonce
cursorModelParams dshPreset _title additionalDirs additionalDirsDirty
_gitBranch _worktreePath _remoteTurnQueue _historyHydrated
```

`detailedUsage` is not written by the reducer (desktop IPC). Snapshot may still carry it; treat as SessionUi, not a patch key.

---

## 4. `ChatCorePatch` (exhaustive write-set)

Generated from family write-points on v0.55.2. Adding a key requires updating this table **and** the key→owner map.

| Key | Families | Notes |
|-----|----------|--------|
| `messages` | lifecycle, content, tool, slash, codex, usage, message-complete | Transcript SOT |
| `queuedMessages` | lifecycle | consume only; idle must not splice |
| `status` | lifecycle, message-complete | complete may settle `streaming` → `idle` |
| `awaitingAssistantReply` | lifecycle, message-complete | |
| `lastEventAt` | lifecycle, content, tool, codex, usage, message-complete | clock via `ports.now` (WP-11) |
| `streamingTokens` | lifecycle, usage, message-complete | |
| `lastAssistantMessageId` | lifecycle | `message_start` assistant |
| `promptSuggestion` | lifecycle, slash | cleared on `message_start` |
| `pendingPermissions` | lifecycle, permission | cleared on interrupt |
| `pendingQuestion` | lifecycle, permission, question-plan | |
| `pendingPlanApproval` | lifecycle, permission, question-plan | |
| `planApprovalOutcome` | permission | |
| `permissionMode` | lifecycle, content, permission | `init_ready`; ExitPlanMode → `'plan'` |
| `apiRetry` | lifecycle, content, usage | cleared on idle / new content |
| `session` | lifecycle | `session_init` |
| `_providerSessionId` | lifecycle | |
| `sessionProvider` | lifecycle | default `DEFAULT_PROVIDER` |
| `cwd` | lifecycle | `worktree_missing` only |
| `_worktreeRemoved` | lifecycle | |
| `todos` / `_nextTodoId` / `showTodos` | content, todos | |
| `taskProgress` | content, tool, message-complete | DeepSeek `diagnostic` lives on the entry |
| `subagentTokens` | tool | **remote-omitted event** `subagent_usage` — still written locally |
| `_streamingToolInputPreviews` | content, tool, message-complete | empty on remote (`tool_input_delta` skipped) |
| `browserDownloads` | tool | |
| `videoGenStatuses` | content | media tools |
| `totalCostUsd` | usage, message-complete | |
| `contextTokens` / `contextWindow` | usage, message-complete | |
| `codexUsageSnapshot` / `codexTurnLastUsage` | usage, message-complete | |
| `isCompacting` / `compactError` | slash, usage | |
| `isRecapping` | slash | |
| `_pendingCompactUserId` / `_pendingSlashCommand` | slash, usage | |
| `slashCommandOutput` | slash | **remote-omitted event** |
| `rateLimitInfo` | usage | |
| `selectedModel` / `modelUserChosen` | permission, ACP | |
| `selectedEffort` / `effortUserChosen` | permission | |
| `selectedCodexModel` / `codexModelUserChosen` | permission | |
| `selectedCodexReasoningEffort` / `codexReasoningEffortUserChosen` | permission | |
| `selectedCodexServiceTier` | permission | |
| `selectedCodexPermissionPreset` | permission | includes Fast / Approve for Me |
| `selectedCodexCollaborationMode` / `codexPlanRejectHintActive` | permission | |
| `openCodeAgentId` | permission | |
| `apiProviderId` | permission | |
| `selectedAcpModeId` | permission, ACP | |
| `acpModels` / `acpModelConfigId` / `acpModelsStatus` / `acpModelsError` | ACP | |
| `acpModes` / `acpModeConfigId` / `acpModesStatus` | ACP | |
| `acpSlashCommands` / `acpSlashCommandsStatus` | ACP | |
| `_latestCodexTodoList` | codex | |

**Reducer returns `{}` (no patch) on v0.55.2:**

`model_fallback`, `hook_*`, `auth_status`, `files_persisted`, `elicitation_complete`, `stream_message_start`, `stream_message_stop`.

`model_fallback` is painted from a **transcript row** the main process appends, not from a session field. WebView must render that row; there is no patch key.

New in v0.55.2: `messages_retracted` → `{ messages, lastEventAt }`.

---

## 5. key → owner

RN always applies the **full** patch to its `ChatCoreSession`. WebView receives only the Reduction projection + derived labels.

| Owner | Keys |
|-------|------|
| **WebView · ChatReductionState** | `messages` `queuedMessages` `status` `awaitingAssistantReply` `lastEventAt` `streamingTokens` `lastAssistantMessageId` `promptSuggestion` `todos` `showTodos` `_nextTodoId` `taskProgress` `subagentTokens` `_streamingToolInputPreviews` `browserDownloads` `videoGenStatuses` `totalCostUsd` `contextTokens` `contextWindow` `codexUsageSnapshot` `codexTurnLastUsage` `isCompacting` `isRecapping` `compactError` `slashCommandOutput` `_pendingCompactUserId` `_pendingSlashCommand` `rateLimitInfo` `apiRetry` `_latestCodexTodoList` `session` (labels) |
| **RN · ChatInteractionState** | `pendingPermissions` `pendingQuestion` `pendingPlanApproval` `planApprovalOutcome` `permissionMode` |
| **RN · SessionUiState** | `sessionProvider` `_providerSessionId` `cwd` `_worktreeRemoved` `selectedModel` `modelUserChosen` `selectedEffort` `effortUserChosen` `selectedCodex*` `codex*UserChosen` `codexPlanRejectHintActive` `openCodeAgentId` `apiProviderId` `acp*` `selectedAcpModeId` |

WebView gets SessionUi as **derived labels only** (model name, harness icon, sandbox chip copy). It must not own model pickers.

`permissionMode` is Interaction (composer cycle + sheets). A derived label may be forwarded to WebView; the cycle itself is RN.

---

## 6. Remote-omitted events

Copied from `SKIPPED_EVENTS` in `remote-control-service.ts` (v0.55.2, unchanged vs 0.53.3):

```
files_persisted
elicitation_complete
tool_input_delta
subagent_usage
checkpoint_captured
hook_started
hook_complete
hook_progress
slash_command_output
stream_message_start
stream_message_stop
```

Also throttled: `tool_progress`. Drain-before: `message_complete`, `status_change`, `task_notification`.

Consequences for mobile:

- `_streamingToolInputPreviews` stays empty on the remote path. Desktop oracle must not require previews when scoring mobile.
- `subagentTokens` will not increment from `subagent_usage`; Task chips still update via `task_progress` / `task_notification`.
- `slash_command_output` never arrives; compact/recap use `compact_boundary` / `session_recap`.
- `checkpoint_captured` never arrives — rewind UI is desktop.

---

## 7. Host protocol (RN ↔ chat-view)

WebView **never** re-reduces. Payload is pre-reduced patches.

**Inbound (RN → WebView)**

| Message | Role |
|---------|------|
| `initialize` / `hydrate` / `reset` / `prependHistory` | Lifecycle |
| `applyReductionPatch(batch)` | ≤1 envelope / ~33 ms; `ChatReductionState` patches only |
| `setConnection({ state, epoch })` | Degrade stream; **epoch bumps at buffer release** |
| `setTheme` / `setViewport({ safeArea, fontScale, locale })` | No independent derivation |
| `setWindow(range)` | Mandatory DOM windowing |
| `scrollToTurn` | Jump |
| `nativeActionResult` / `nativeActionProgress` | Async host replies |

**Outbound (WebView → RN)**

| Message | Role |
|---------|------|
| `requestNative` | openFile, showInFolder, openLink, sheets, share, progressive bash read, `@native/*` gallery |
| `viewState(patch)` | Scroll anchor + expand keys — persisted on RN |
| `ready` / `error(fatal)` | White-screen recovery: reload + hydrate |

Chrome: WebView owns full-screen scroll; header + native `TextInput` are RN overlays. Never nest WebView in RN ScrollView.

Terminal: **separate WebView + separate channel**. Terminal frames never enter event ACK/dedup.

---

## 8. Buffer-first + dual-transport

### Open and reconnect (client-owned)

```
startBuffering
  → (on transport reconnect / type=reset: clear local seq as required)
  → subscribe_session
  → load_session_messages (history)
  → get_session_state (snapshot)
  → ordered release of buffered type=event frames
  → bump setConnection.epoch at release boundary
```

All `type=event` frames (including relay replay) enqueue until history+snapshot complete.

### Dual transport (hard)

1. Exactly one active event transport (race-winner or prefer-LAN).
2. Isolate `_processedSeqs` / `lastAckedSeq` **per transport**.
3. Never send a relay ACK with a LAN seq (or vice versa).
4. LAN has no DO replay — LAN reconnect = full rehydrate, not `fromSeq`.
5. Dual-socket delivery of the same ciphertext must not double-apply.

### ACK (port from Flutter `relay_client.dart`)

- `_processedSeqs.add(seq)` **before** decrypt; ACK even on decrypt fail.
- Bound the set (~2048). Cumulative ACK of max contiguous seq.
- Envelope `seq` is ACK/replay only — **never** write onto `AgentEvent.seq`.
- Server `forcedDropSeq`: client reacts to frame `type: 'reset'` only.
- `desktop_shutdown` clears local seq; does not invent forcedDropSeq.
- Terminal frames: no seq ACK path.

### RemoteCommand delta @ v0.55.2

RPC union is otherwise identical to 0.53.3. Additive fields Expo must send when talking to a 0.55.2 desktop:

- `add_project_additional_dir.provider?: HarnessId`
- `remove_project_additional_dir.provider?: HarnessId`

---

## 9. Types sketch (not compiled)

```ts
import type { AgentEvent } from '@superone/shared/agent-types'
import type { PerSessionState } from '../../apps/desktop/src/renderer/src/stores/chat-store/types'

/** Read union — see §3. */
export type ChatCoreSession = Pick<PerSessionState,
  | 'messages' | 'queuedMessages' | 'status' | 'awaitingAssistantReply' | 'lastEventAt'
  | 'streamingTokens' | 'lastAssistantMessageId' | 'promptSuggestion'
  | 'pendingPermissions' | 'pendingQuestion' | 'pendingPlanApproval' | 'planApprovalOutcome'
  | 'permissionMode' | 'apiRetry'
  | 'session' | '_providerSessionId' | 'sessionProvider' | 'preferredProvider'
  | 'todos' | 'showTodos' | '_todosUserDismissed' | '_nextTodoId'
  | 'taskProgress' | 'subagentTokens' | '_streamingToolInputPreviews'
  | 'browserDownloads' | 'videoGenStatuses'
  | 'totalCostUsd' | 'contextTokens' | 'contextWindow'
  | 'codexUsageSnapshot' | 'codexTurnLastUsage'
  | 'isCompacting' | 'isRecapping' | 'compactError'
  | '_pendingCompactUserId' | '_pendingSlashCommand' | 'slashCommandOutput'
  | 'rateLimitInfo'
  | 'selectedModel' | 'modelUserChosen' | 'selectedEffort' | 'effortUserChosen'
  | 'selectedCodexModel' | 'selectedCodexReasoningEffort' | 'selectedCodexServiceTier'
  | 'selectedCodexPermissionPreset' | 'selectedCodexCollaborationMode'
  | 'codexModelUserChosen' | 'codexReasoningEffortUserChosen' | 'codexPlanRejectHintActive'
  | 'openCodeAgentId' | 'apiProviderId'
  | 'acpAgentId' | 'acpModels' | 'acpModelConfigId' | 'acpModelsStatus' | 'acpModelsError'
  | 'acpModes' | 'acpModeConfigId' | 'acpModesStatus' | 'selectedAcpModeId'
  | 'acpSlashCommands' | 'acpSlashCommandsStatus'
  | '_latestCodexTodoList' | 'cwd' | '_worktreeRemoved'
>

/** Exhaustive write-set — see §4. */
export type ChatCorePatch = Partial<ChatCoreSession>

export interface ChatCorePorts {
  now(): number
  id(prefix: string): string
  trace?(channel: string, name: string, payload: unknown): void
}

export type ApplyEventToSession = (
  session: ChatCoreSession,
  event: AgentEvent,
  ports?: ChatCorePorts,
) => ChatCorePatch
```

WP-12 copies this into `packages/chat-core` and typechecks `applyEventToSession` against it. Do not introduce a second reducer.

---

## 10. Open questions closed by this freeze

| # | Resolution |
|---|------------|
| Plan §11.5 remote-relevant families | **All families in `applyEventToSession` except skipped-event no-ops.** Includes ACP inline cases and `messages_retracted`. |
| `model_fallback` | Transcript row, not a patch key. |
| DeepSeek trajectory | Out of scope (desktop). Task `diagnostic` is in `taskProgress`. |
| Mini-app iframe-in-WebView | Still deferred (plan R6). `@native/*` galleries go through `requestNative`. |
