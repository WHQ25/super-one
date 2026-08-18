// Unified message format used across IPC. Zero SDK imports.

import type { TokenOverrides } from './harness-brand'

// --- Image attachments ---

export interface ImageAttachment {
  mimeType: string
  base64: string
  name: string
  /** Stable id linking an editor attachment chip node and its inline content block to this attachment. */
  id?: string
}

export interface ShareFileEncryption {
  version: number
  format: string
  key: string
}

export interface ShareFilePayload {
  name: string
  mimeType: string
  size: number
  caption?: string
  inlineBase64?: string
  downloadUrl?: string
  expiresAt?: number
  encryption?: ShareFileEncryption
}

// --- Content blocks ---

type RemoteToolType = 'read' | 'edit' | 'write' | 'notebook_edit' | 'file_change' | 'bash' | 'grep' | 'glob' | 'web_search' | 'web_fetch' | 'agent' | 'skill' | 'workflow'

type DiffTokenLine = [string, string | null][]

export interface TodoToolItem {
  content: string
  status: string
  taskId?: string
  subject?: string
  description?: string
  activeForm?: string
  owner?: string
  addBlockedBy?: string[]
  addBlocks?: string[]
}

interface ToolMeta {
  toolSummary?: string
  toolFilePath?: string
  toolLineDelta?: { added: number; removed: number }
  toolDiff?: string
  toolDiffTokens?: { added?: DiffTokenLine[]; removed?: DiffTokenLine[] }
  toolTodos?: TodoToolItem[]
}

interface AgentTaskData {
  runInBackground?: boolean
  taskUsage?: { totalTokens: number; toolUses: number; durationMs: number }
  taskToolHistory?: Array<{ toolName: string; description: string }>
  taskSummary?: string
  taskResultText?: string
  /**
   * Persisted path to child transcript (Grok chat_history.jsonl / Claude agent-*.jsonl).
   * Survives history reload when live taskProgress is empty.
   */
  taskOutputFile?: string
}

/** Live or persisted agent row on a Workflow tool_use (Grok snapshot or Claude). */
export interface WorkflowAgentRow {
  agentId?: string
  label: string
  toolCount: number
  tokens?: number
  state?: string
  phase?: string
}

export interface WorkflowPhaseRow {
  title: string
  detail?: string
  /** Live state from Grok workflow_updated: done | active | pending */
  state?: string
}

interface WorkflowData {
  workflowName?: string
  workflowDescription?: string
  workflowPhases?: WorkflowPhaseRow[]
  workflowCurrentPhase?: string
  workflowAgents?: WorkflowAgentRow[]
}

interface ToolUseBase {
  toolName: string
  toolUseId: string
  input: string
  status?: 'streaming' | 'complete'
  elapsedSeconds?: number
  startedAt?: number
  parentToolUseId?: string | null
}

export type ContentBlock =
  | { type: 'text'; text: string; parentToolUseId?: string | null; codeBlockTokens?: Array<{ language: string; tokens: DiffTokenLine[] | null }>; isPaste?: boolean }
  | { type: 'thinking'; thinking: string; parentToolUseId?: string | null; startedAt?: number; endedAt?: number }
  | { type: 'tool_use' } & ToolUseBase & ToolMeta & AgentTaskData & WorkflowData
  | { type: RemoteToolType } & ToolUseBase & ToolMeta & AgentTaskData & WorkflowData
  | { type: 'tool_result'; toolUseId: string; summary: string; outputPath?: string; isTimedOut?: boolean; isError?: boolean; parentToolUseId?: string | null; outputTokens?: DiffTokenLine[]; todoToolName?: string; toolTodos?: TodoToolItem[] }
  | { type: 'bash_result'; toolUseId: string; summary: string; parentToolUseId?: string | null; outputTokens?: DiffTokenLine[] }
  | { type: 'todo_result'; toolUseId: string; summary: string; parentToolUseId?: string | null; todoToolName?: string; toolTodos?: TodoToolItem[] }
  | { type: 'codex_plan'; text: string; itemId: string }
  | { type: 'codex_image_generation'; itemId: string; status: string; savedPath?: string; revisedPrompt?: string; startedAt?: number; completedAt?: number }
  | { type: 'codex_collab'; items: CodexCollabToolCallItem[]; parentToolUseId?: string | null }
  | { type: 'image'; name: string; id?: string }
  | { type: 'document'; name: string; id?: string }

// --- Session info (from system init) ---

/** Why Claude fast mode is unavailable (SDK `fast_mode_disabled_reason`). */
export type FastModeDisabledReason =
  | 'free'
  | 'preference'
  | 'extra_usage_disabled'
  | 'network_error'
  | 'unknown'
  | 'not_first_party'
  | 'disabled_by_env'
  | 'model_not_allowed'
  | 'sdk_opt_in_required'
  | 'pending'

export interface SessionInfo {
  sessionId: string
  model: string
  tools: string[]
  mcpServers: { name: string; status: string }[]
  permissionMode: PermissionMode
  slashCommands: string[]
  /**
   * Subset of `slashCommands` whose UX is bound to a local terminal
   * (`/exit`, `/statusline`, …). Host menus should hide these; the engine
   * still knows the commands. Absent when the CLI omitted the tag.
   */
  terminalSlashCommands?: string[]
  skills: string[]
  claudeCodeVersion: string
  cwd: string
  agents?: string[]
  apiKeySource?: string
  betas?: string[]
  outputStyle?: string
  availableOutputStyles?: string[]
  plugins?: { name: string; path: string }[]
  fastModeState?: 'off' | 'cooldown' | 'on'
  /** Present when fast mode is not active; mirrors SDK system/init + result. */
  fastModeDisabledReason?: FastModeDisabledReason
}

export interface ClaudePreferences {
  outputStyle: string
}

// --- Usage / cost tracking ---

export interface UsageInfo {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
}

export interface ModelUsageInfo {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUSD: number
  webSearchRequests?: number
  contextWindow?: number
  maxOutputTokens?: number
  /** Canonical model id used for pricing (may differ from the map key). */
  canonicalModel?: string
  /** API provider that served this model (e.g. firstParty, bedrock, vertex). */
  provider?: string
}

export type CodexReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
export type CodexCollaborationMode = 'default' | 'plan'

export interface ReasoningEffortOption {
  value: CodexReasoningEffort
  description: string
}

// --- Codex turn items (for Codex-native UI) ---

export type CodexCommandExecutionStatus = 'in_progress' | 'completed' | 'failed'
export type CodexPatchApplyStatus = 'completed' | 'failed'
export type CodexMcpToolCallStatus = 'in_progress' | 'completed' | 'failed'
export type CodexPatchChangeKind = 'add' | 'delete' | 'update'

export interface CodexUsageInfo {
  totalInputTokens: number
  totalCachedInputTokens: number
  totalCacheWriteInputTokens?: number
  totalOutputTokens: number
  lastInputTokens: number
  lastCachedInputTokens: number
  lastCacheWriteInputTokens?: number
  lastOutputTokens: number
  reasoningOutputTokens: number
  contextWindow: number
}

export interface CodexAgentMessageItem {
  id: string
  type: 'agent_message'
  text: string
}

export interface CodexReasoningItem {
  id: string
  type: 'reasoning'
  text: string
  startedAt?: number
  endedAt?: number
}

export interface CodexPlanItem {
  id: string
  type: 'plan'
  text: string
}

export interface CodexCommandAction {
  type: string
  command?: string
  name?: string
  path?: string
  query?: string
}

export interface CodexCommandExecutionItem {
  id: string
  type: 'command_execution'
  command: string
  aggregatedOutput: string
  exitCode?: number
  status: CodexCommandExecutionStatus
  commandActions?: CodexCommandAction[]
}

export interface CodexFileUpdateChange {
  path: string
  kind: CodexPatchChangeKind
  diff?: string
}

export interface CodexFileChangeItem {
  id: string
  type: 'file_change'
  changes: CodexFileUpdateChange[]
  status: CodexPatchApplyStatus
}

export interface CodexMcpToolCallItem {
  id: string
  type: 'mcp_tool_call'
  server: string
  tool: string
  arguments: unknown
  result?: { content: unknown[]; structuredContent: unknown }
  error?: { message: string }
  status: CodexMcpToolCallStatus
}

export interface CodexWebSearchItem {
  id: string
  type: 'web_search'
  query: string
  status: CodexMcpToolCallStatus
}

export interface CodexTodoListItem {
  id: string
  type: 'todo_list'
  items: Array<{ text: string; completed: boolean }>
}

export interface CodexErrorItem {
  id: string
  type: 'error'
  message: string
}

export interface CodexReviewItem {
  id: string
  type: 'review'
  phase: 'entered' | 'exited'
  text: string
}

export interface CodexCompactionItem {
  id: string
  type: 'compaction'
}

export interface ImageGenerationItem {
  id: string
  type: 'image_generation'
  status: 'in_progress' | 'completed' | 'failed' | string
  revisedPrompt?: string
  /** Full-resolution original path (viewer / download / drag). */
  savedPath?: string
  /**
   * Downscaled preview path for gallery thumbs.
   * Falls back to `savedPath` when absent (older tool results / small images).
   */
  previewPath?: string
  referenceImagePaths?: string[]
  generationMs?: number
  params?: { key: string; value: string }[]
  warnings?: string[]
}

/**
 * A video produced by `media_generate_video`. Unlike an image it is rendered from disk rather than
 * inlined, and it stays `in_progress` across two tool calls — the submit and the status poll — so
 * the placeholder card is visible for the minutes the render takes.
 */
export interface VideoGenerationItem {
  id: string
  type: 'video_generation'
  status: 'in_progress' | 'completed' | 'failed' | string
  prompt?: string
  savedPath?: string
  frameImagePaths?: string[]
  params?: { key: string; value: string }[]
  warnings?: string[]
}

export interface CodexPlanApprovalState {
  status: 'approved' | 'rejected'
  feedback?: string
}

export type CodexCollabTool = 'spawnAgent' | 'sendInput' | 'wait' | 'closeAgent' | 'resumeAgent'
export type CodexCollabAgentStatus = 'pendingInit' | 'running' | 'completed' | 'errored' | 'shutdown' | 'notFound'

export interface CodexCollabAgentState {
  status: CodexCollabAgentStatus
  nickname?: string
  role?: string
  message?: string
  forkedFromId?: string
  tokens?: { input: number; output: number }
}

export interface CodexCollabToolCallItem {
  id: string
  type: 'collab_tool_call'
  tool: CodexCollabTool
  status: 'in_progress' | 'completed' | 'failed'
  senderThreadId?: string
  receiverThreadIds: string[]
  prompt?: string
  agentsStates: Record<string, CodexCollabAgentState>
  childItems?: Record<string, CodexThreadItem[]>
}

export type CodexThreadItem =
  | CodexAgentMessageItem
  | CodexReasoningItem
  | CodexPlanItem
  | CodexCommandExecutionItem
  | CodexFileChangeItem
  | CodexMcpToolCallItem
  | CodexWebSearchItem
  | CodexTodoListItem
  | CodexErrorItem
  | CodexReviewItem
  | CodexCompactionItem
  | CodexCollabToolCallItem
  | ImageGenerationItem
  | VideoGenerationItem

export type CodexItemPatch =
  | { type: 'agent_message' | 'plan' | 'review'; textDelta: string }
  | { type: 'reasoning'; textDelta: string; startedAt?: number; endedAt?: number }
  | { type: 'command_execution'; aggregatedOutputDelta: string }

export interface CodexMcpServerStartup {
  name: string
  status: 'starting' | 'ready' | 'failed' | 'cancelled'
  failureReason?: 'reauthenticationRequired'
}

export interface CodexTurnInfo {
  /** Final assistant text derived from the last agent_message item. */
  finalResponse?: string
  durationMs?: number
  threadId: string | null
  turnId?: string
  usage: CodexUsageInfo | null
  items: CodexThreadItem[]
  planApproval?: CodexPlanApprovalState
  model?: string
  mcpStartup?: CodexMcpServerStartup[]
}

export interface PermissionDenialInfo {
  toolName: string
  toolUseId: string
  toolInput: Record<string, unknown>
}

/** How a user-role transcript bubble entered the session (omitted = human composer). */
export type ChatMessageSource = 'user' | 'collaboration' | 'task-notification'

export interface CollaborationMessageMeta {
  /** initial_task = parent-approved launch task; mailbox = session_send content shown in UI. */
  kind: 'initial_task' | 'mailbox'
  fromSessionId?: string
  /** inbound = received from peer; outbound = this session sent it. */
  direction?: 'inbound' | 'outbound'
  messageId?: string
}

export interface MessageMetadata {
  model?: string
  /** Harness-native agent used for the turn (for example an OpenCode primary agent). */
  agent?: string
  costUsd?: number
  durationMs?: number
  durationApiMs?: number
  numTurns?: number
  usage?: UsageInfo
  modelUsage?: Record<string, ModelUsageInfo>
  stopReason?: string | null
  terminalReason?: string
  consumedTokens?: { input: number; output: number }
  codex?: CodexTurnInfo
  resultText?: string
  permissionDenials?: PermissionDenialInfo[]
  fastModeState?: 'off' | 'cooldown' | 'on'
  /** Why fast mode is off for this result (SDK `fast_mode_disabled_reason`). */
  fastModeDisabledReason?: FastModeDisabledReason
  errorSubtype?: string
  structuredOutput?: unknown
  isError?: boolean
  apiErrorStatus?: number | null
  /** SDK assistant message UUID of this turn — anchor for forking at this message. */
  forkAnchorId?: string
  /**
   * Transcript provenance. Omitted / `'user'` = human composer.
   * `'collaboration'` = multi-agent collab (task or mailbox).
   * `'task-notification'` = synthetic host wake (not human).
   */
  source?: ChatMessageSource
  collaboration?: CollaborationMessageMeta
  /**
   * Grok `last_turn_summary` — one-line dashboard fragment for this assistant turn.
   * Rendered above the turn footer (not as a standalone system marker).
   */
  turnSummary?: string
  /**
   * Background-task wake whose launching tool block is gone or not in the
   * current turn. Present only on the synthetic transcript row minted for it
   * (see `buildOrphanTaskNotificationMessage`).
   */
  taskNotification?: TaskNotificationMeta
}

/** Structured payload behind the compact "agent was notified" transcript row. */
export interface TaskNotificationMeta {
  status: 'completed' | 'failed' | 'stopped'
  /** Task description captured at `task_started`, when it survived the runtime. */
  description?: string
  summary?: string
  outputFile?: string
  usage?: { totalTokens: number; toolUses: number; durationMs: number }
}

// --- Todo items (derived from TaskCreate/TaskUpdate tool calls) ---

export interface TodoItem {
  id: string
  subject: string
  description: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
  owner?: string
  blockedBy?: string[]
  blocks?: string[]
}

// --- Chat message ---

export interface ChatMessageContext {
  appId: string
  appName: string
  summary: string
  content: string
  color?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'complete' | 'interrupted' | 'error'
  content: ContentBlock[]
  attachments?: ImageAttachment[]
  contexts?: ChatMessageContext[]
  userSelections?: string[]
  createdAt: string
  providerId: string
  metadata?: MessageMetadata
  checkpointId?: string
  resumePointId?: string
  rewound?: 'code' | 'conversation' | 'code_and_chat'
  _lastAppliedSeq?: number
  _lastAppliedEpoch?: number
}

// --- Video generation confirmation (MCP elicitation) ---

export interface VideoGenParams {
  prompt: string
  provider: string
  model: string
  aspectRatio: string
  resolution: string
  duration: number
  fps?: number
  seed?: number
  generateAudio: boolean
  watermark: boolean
  cameraFixed: boolean
}

export interface VideoGenReferenceImage {
  path: string
  dataUri: string
  role: 'first_frame' | 'last_frame' | 'reference'
}

export interface VideoGenProviderOption {
  id: string
  label: string
  models: { id: string; label: string }[]
  aspectRatios: string[]
  resolutions: string[]
}

/** Main-process-side reference image descriptor — path only, no bytes (renderer loads dataUri via IPC). */
export interface VideoGenReferenceImageRef {
  path: string
  role: 'first_frame' | 'last_frame' | 'reference'
}

export interface VideoGenConfirmPayload {
  params: VideoGenParams
  providers: VideoGenProviderOption[]
  referenceImages: VideoGenReferenceImageRef[]
}

/**
 * formAnswers key carrying the user-edited VideoGenParams back from a video_gen_confirm
 * response: `formAnswers[VIDEO_GEN_PARAMS_FIELD] = JSON.stringify(editedParams)`. The
 * request direction needs no such channel — the payload rides on the permission_request
 * event's `videoGenConfirm` field directly.
 */
export const VIDEO_GEN_PARAMS_FIELD = 'paramsJson'

// --- App settings (config) apply confirmation ---

export type ConfigScalarFieldType = 'boolean' | 'enum' | 'number' | 'string'

/**
 * Structured field types. Each names a domain concept the settings UI already has a real editor for
 * (env table, model-mapping slots, enabled-model list, format/capability checkboxes) so the confirm
 * dialog can render that same editor instead of a JSON textarea. Values are plain JSON objects, not
 * strings — `json` remains the untyped escape hatch and is the only one edited as raw text.
 */
export type ConfigStructuredFieldType = 'json' | 'env' | 'model-mapping' | 'models' | 'capabilities'

export type ConfigFieldType = ConfigScalarFieldType | ConfigStructuredFieldType

/** Where a structured field lives, so the renderer can resolve the real Platform/Plan to edit against. */
export interface ConfigFieldContext {
  platformId?: string
  planId?: string
  endpointId?: string
  credentialId?: string
}

export interface ConfigConfirmField {
  key: string
  domain: string
  label: string
  type: ConfigFieldType
  enumValues?: string[]
  min?: number
  max?: number
  /** True when the field can be reset to its default (empty) value. */
  clearable?: boolean
  /** Carries a credential. Rendered masked, the same way the settings form renders an API key input. */
  secret?: boolean
  note?: string
  context?: ConfigFieldContext
  currentValue: unknown
  proposedValue: unknown
}

export interface ConfigConfirmResourceOp {
  resource: string
  operation: 'create' | 'update' | 'delete'
  recordId?: string
  /** Record identity, shown for delete (and as a heading for create/update). */
  title: string
  subtitle?: string
  /** Shared context for the whole proposal (e.g. the platform/plan a credential override targets). */
  context?: ConfigFieldContext
  /** The record's editable fields for create/update; empty for delete. */
  fields: ConfigConfirmField[]
}

export interface ConfigConfirmPayload {
  /** Scalar AppSettings field changes. */
  fields?: ConfigConfirmField[]
  /** A resource create/update/delete proposal. */
  resource?: ConfigConfirmResourceOp
}

/**
 * The renderer packs the user's final (possibly edited) config values into
 * `content[CONFIG_APPLY_FIELD] = JSON.stringify({ [key]: value })` when accepting a
 * `config_confirm` request, mirroring the video-gen confirm flow's response shape.
 */
export const CONFIG_APPLY_FIELD = 'configJson'
export const SESSION_AGENT_LAUNCHES_FIELD = 'sessionAgentLaunchesJson'

export interface SessionAgentProfile {
  id: string
  name: string
  harnessId: HarnessId
  /**
   * ACP protocol agent id (e.g. `grok-build`). Only set when harnessId is `acp`.
   * UI brand key is derived as `acp-<short>` (e.g. `acp-grok`).
   */
  acpAgentId?: string
  /** Stable UI brand identity, e.g. `claude` / `codex` / `acp-grok` / `acp`. */
  brandKey?: string
  description?: string
  /** Effective defaults inherited when a launch omits the corresponding fields. */
  defaultConfig: SessionAgentLaunchConfig
  models: Array<{ id: string; name: string; description?: string }>
  efforts: string[]
  /**
   * Third-party AI keys usable for this harness. `name` is the platform label
   * shown elsewhere in the app; `keyName` is the user-defined credential entry
   * name (secondary), and `brand` drives the provider glyph.
   */
  apiProviders: Array<{ id: string; name: string; brand?: string; keyName?: string }>
}

export interface SessionAgentWorktreeConfig {
  enabled: boolean
  baseBranch: string
  mode: WorktreeMode
  branchName?: string
  carryLocalChanges?: boolean
}

export interface SessionAgentLaunchConfig {
  model?: string
  effort?: string
  apiProviderId?: string | null
  permissionMode?: PermissionMode
  sandboxMode?: SandboxMode
  cwd?: string
  worktree?: SessionAgentWorktreeConfig
  harnessConfig?: Record<string, unknown>
  /**
   * Agent-chosen human display name (not harness brand). Combined with role for
   * titles: `Name - Role`. Not user-editable in the confirm UI.
   */
  name?: string
  /**
   * Temporary collaboration role for sidebar title (`Name - Role`).
   * Set by the requesting agent; not user-editable in the confirm UI.
   */
  role?: string
}

/** Max length for the full task delivered to a collab child session. */
export const SESSION_AGENT_TASK_MAX = 100_000

/**
 * Collaboration launch mode:
 * - `spawn` — create a new child session (system-prompt credential injection)
 * - `link` — mailbox with an already-existing session (turn/wake injection only)
 */
export type SessionCollabLaunchMode = 'spawn' | 'link'

/**
 * Resolve the user-facing summary for a collab launch.
 * Prefer an explicit summary; otherwise take the first line of the task.
 * Soft guidance (not enforced): keep to a short 2–3 sentence task summary.
 */
export function resolveLaunchSummary(task: string, summary?: string | null): string {
  const explicit = typeof summary === 'string' ? summary.trim() : ''
  if (explicit) return explicit
  return task.split(/\n/, 1)[0]?.trim() || task.trim()
}

export interface SessionAgentLaunchProposal {
  launchId: string
  /** Defaults to `spawn` when omitted (back-compat). */
  mode?: SessionCollabLaunchMode
  /**
   * Agent profile id for `spawn`. Empty string for `link` (no new agent).
   */
  agentId: string
  /**
   * Existing SuperOne session id to link with (`mode: "link"` only).
   * Required for link launches; ignored for spawn.
   */
  sessionId?: string
  /** Host-resolved peer title for confirm UI (`link` only). */
  peerTitle?: string
  /** Host-resolved peer project path for confirm UI (`link` only). */
  peerProjectPath?: string
  /** Host-resolved peer harness id for confirm tab label/icon (`link` only). */
  peerHarnessId?: string
  /** Host-resolved peer ACP agent id for brand icon (`link` only). */
  peerAcpAgentId?: string
  /** Host-resolved peer harness display name for confirm tabs (`link` only). */
  peerHarnessName?: string
  /** Host-resolved peer brand key for confirm tab icon (`link` only). */
  peerBrandKey?: string
  /**
   * Short task summary shown collapsed in the confirm UI (soft guidance: 2–3 sentences).
   * Full brief belongs in `task`.
   */
  summary: string
  /**
   * Full task brief (Markdown).
   * `spawn`: delivered to the child on session_collab_start.
   * `link`: optional opening for the peer (mailbox + turn wake — not system prompt).
   * Shown when the user expands the summary in the confirm UI.
   */
  task: string
  /**
   * Agent-chosen human label (e.g. "Alice", "Diff Reviewer") — not the harness
   * name. Used for session title and tool summaries: `Name - Role`.
   * For `link`, defaults to the peer session title when omitted.
   */
  name: string
  /**
   * Temporary role label used for child session title: `Name - Role`.
   * For `link`, defaults to `"Peer"` when omitted.
   */
  role: string
  config: SessionAgentLaunchConfig
}

export interface SessionAgentRequestPayload {
  launches: SessionAgentLaunchProposal[]
  profiles: SessionAgentProfile[]
}

// --- Permission request ---

export type ElicitationFormFieldType = 'string' | 'number' | 'boolean' | 'enum'

export interface ElicitationFormField {
  name: string
  type: ElicitationFormFieldType
  label: string
  description?: string
  required: boolean
  enumOptions?: string[]
  defaultValue?: string | number | boolean
}

export interface PermissionRequest {
  requestId: string
  toolName: string
  toolUseId?: string
  input: Record<string, unknown>
  decisionReason?: string
  blockedPath?: string
  allowAlwaysAllow: boolean
  suggestions?: Array<Record<string, unknown>>
  toolDiff?: string
  toolDiffTokens?: { added?: DiffTokenLine[]; removed?: DiffTokenLine[] }
  toolLineDelta?: { added: number; removed: number }
  requestKind?:
    | 'mcp_elicitation'
    | 'video_gen_confirm'
    | 'config_confirm'
    | 'session_agents_confirm'
    | 'computer_use_grant'
    | 'session_cleanup_confirm'
    | 'automation_confirm'
  serverName?: string
  message?: string
  subtitle?: string
  riskLevel?: 'low' | 'medium' | 'high'
  supportsAlwaysPersist?: boolean
  elicitationForm?: ElicitationFormField[]
  /** Present only when requestKind === 'video_gen_confirm'. */
  videoGenConfirm?: VideoGenConfirmPayload
  /** Present only when requestKind === 'config_confirm'. */
  configConfirm?: ConfigConfirmPayload
  /** Present only when requestKind === 'session_agents_confirm'. */
  sessionAgentsConfirm?: SessionAgentRequestPayload
  /** Present only when requestKind === 'computer_use_grant'. */
  computerUseGrant?: ComputerUseGrantPayload
  /** Present only when requestKind === 'session_cleanup_confirm'. */
  sessionCleanupConfirm?: SessionCleanupConfirmPayload
  /** Present only when requestKind === 'automation_confirm'. */
  automationConfirm?: AutomationConfirmPayload
}

/** HITL payload for automation create / update / delete (structured confirm UI). */
export type AutomationConfirmOperation = 'create' | 'update' | 'delete'

/**
 * Structured agent snapshot for confirm UI — same vocabulary as collab launch
 * config (model / effort / permissionMode / sandbox). Renderer uses
 * GroupedModelEffortSelector + HarnessPermissionPopover + SandboxModePopover.
 */
export interface AutomationConfirmAgentView {
  type: AgentType
  model?: string
  effort?: string
  permissionMode?: PermissionMode
  sandboxMode?: SandboxMode
  /** Codex storage alias; UI prefers permissionMode via HarnessPermissionPopover. */
  permissionPreset?: CodexPermissionPreset
  apiProviderId?: string | null
  acpAgentId?: string | null
}

/** One automation shown in the confirm body (create target, update subject, or delete row). */
export interface AutomationConfirmItem {
  id?: string
  name: string
  scheduleSummary?: string
  /** @deprecated Prefer `agent` structured view. */
  agentType?: string
  /** @deprecated Prefer `agent` structured view. */
  agentSummary?: string
  /** Structured agent config for familiar UI chips (permission mode, model, sandbox). */
  agent?: AutomationConfirmAgentView
  enabled?: boolean
  /**
   * Short one-line preview (truncated). Prefer `prompt` for Markdown expand UI.
   * @deprecated Prefer `prompt` when full body is available.
   */
  promptPreview?: string
  /** Full prompt body for Markdown expand in create/update confirm. */
  prompt?: string
}

/** Field-level change for update confirms (human-readable from/to). */
export interface AutomationConfirmChange {
  field: 'name' | 'enabled' | 'schedule' | 'agent' | 'prompt'
  from?: string
  to?: string
  /** Structured agent sides when field === 'agent' (renderer uses familiar labels). */
  agentFrom?: AutomationConfirmAgentView
  agentTo?: AutomationConfirmAgentView
}

export interface AutomationConfirmPayload {
  operation: AutomationConfirmOperation
  items: AutomationConfirmItem[]
  /** Present for update — what will change if the user approves. */
  changes?: AutomationConfirmChange[]
}

/** One row in the permanent-delete confirm dialog (mirrors session_list metadata). */
export interface SessionCleanupConfirmSession {
  id: string
  title: string
  harness?: string
  acpAgentId?: string | null
  messageCount?: number
  createdAt?: string
  /** Host UI resolves path via projectId → recentFolders. */
  projectId?: string
}

export interface SessionCleanupConfirmPayload {
  sessions: SessionCleanupConfirmSession[]
}

/** HITL payload when Computer Use needs permission to touch a desktop app. */
export interface ComputerUseGrantPayload {
  app: string
  bundleId: string
  /** Tool that triggered the request (e.g. computer_snapshot). */
  toolName: string
  /** Best-effort app icon as a data: URI PNG; absent when lookup failed. */
  iconDataUri?: string
}

/** Persistent always-allow entry for Computer Use (Settings + AppSettings). */
export interface ComputerUseAlwaysAllowApp {
  app: string
  bundleId: string
}

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto' | 'agent'

export type AccountApiProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry' | 'anthropicAws' | 'anthropicGoogleCloud' | 'mantle' | 'gateway'

// --- AskUserQuestion ---

export interface UserQuestionOption {
  label: string
  description: string
  preview?: string
}

export interface UserQuestion {
  question: string
  header: string
  options: UserQuestionOption[]
  multiSelect: boolean
}

export type QuestionPreviewFormat = 'markdown' | 'html'

export interface QuestionAnnotation {
  preview?: string
  notes?: string
}

export type QuestionAnnotations = Record<string, QuestionAnnotation>

export interface AskUserQuestionRequest {
  requestId: string
  questions: UserQuestion[]
  previewFormat?: QuestionPreviewFormat
}

// --- Plan approval ---

export interface PlanApprovalRequest {
  requestId: string
  planContent: string
  planFilePath: string
  allowedPrompts: Array<{ tool: string; prompt: string }>
}

// --- MCP server status ---

export interface McpToolInfo {
  name: string
  description?: string
}

export interface McpServerInfo {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  error?: string
  scope?: string
  toolCount?: number
  tools?: McpToolInfo[]
  resources?: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>
  authStatus?: 'authenticated' | 'needs-auth' | 'unknown'
  stale?: boolean
  fetchedAt?: number
}

export interface ContextUsageCategory {
  name: string
  tokens: number
  color: string
}

export interface ContextUsageInfo {
  categories: ContextUsageCategory[]
  totalTokens: number
  maxTokens: number
  percentage: number
  model: string
}

// --- Account info ---

export interface AccountInfo {
  email?: string
  organization?: string
  subscriptionType?: string
  apiKeySource?: string
  apiProvider?: AccountApiProvider
}

// --- Slash commands ---

export interface SlashCommandInfo {
  name: string
  description: string
  argumentHint: string
  isSkill: boolean
  /**
   * Claude SDK `terminal_slash_commands`: the command's UX is bound to a
   * local terminal. SuperOne (desktop + remote) hides these from `/` menus.
   */
  terminalBound?: boolean
  /**
   * Grok advertises registered workflows as available_commands with
   * `_meta.workflowSource` (builtin | project | user). Used by `/workflow` name
   * autocomplete in the host.
   */
  isWorkflow?: boolean
  workflowSource?: string
  /** Absolute or project-relative path to the `.rhai` source when known. */
  workflowPath?: string
  /** Host-expanded prompt template (Cursor `.cursor/commands`). */
  promptBody?: string
}

// --- @ mention: agents & directory listing ---

export interface AgentInfo {
  name: string
  description: string
  model?: string
  source: 'user' | 'project' | 'plugin'
}

export interface ListDirEntry {
  name: string
  isDirectory: boolean
}

// --- Hook events ---

export interface HookEvent {
  hookId: string
  hookName: string
  hookEvent: string
  output?: string
  stdout?: string
  stderr?: string
  exitCode?: number
  outcome?: 'success' | 'error' | 'cancelled'
}

// --- Hooks config (settings.json#hooks) ---

export type HookScope = 'user' | 'project' | 'local'

export type HookEventName =
  | 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure' | 'PostToolBatch'
  | 'Notification' | 'UserPromptSubmit' | 'UserPromptExpansion'
  | 'SessionStart' | 'SessionEnd'
  | 'Stop' | 'StopFailure'
  | 'SubagentStart' | 'SubagentStop'
  | 'PreCompact' | 'PostCompact'
  | 'PermissionRequest' | 'PermissionDenied'
  | 'Setup' | 'TeammateIdle'
  | 'TaskCreated' | 'TaskCompleted'
  | 'Elicitation' | 'ElicitationResult'
  | 'ConfigChange'
  | 'WorktreeCreate' | 'WorktreeRemove'
  | 'InstructionsLoaded' | 'CwdChanged' | 'FileChanged'

export type HookEntryType = 'command' | 'prompt' | 'agent' | 'http' | 'mcp_tool'

interface BaseHookFields {
  if?: string
  timeout?: number
  statusMessage?: string
  once?: boolean
}

export interface CommandHookEntry extends BaseHookFields {
  type: 'command'
  command: string
  shell?: 'bash' | 'powershell'
  async?: boolean
  asyncRewake?: boolean
}

export interface PromptHookEntry extends BaseHookFields {
  type: 'prompt'
  prompt: string
  model?: string
}

export interface AgentHookEntry extends BaseHookFields {
  type: 'agent'
  prompt: string
  model?: string
}

export interface HttpHookEntry extends BaseHookFields {
  type: 'http'
  url: string
  headers?: Record<string, string>
  allowedEnvVars?: string[]
}

export interface McpToolHookEntry extends BaseHookFields {
  type: 'mcp_tool'
  server: string
  tool: string
  input?: Record<string, unknown>
}

export type HookEntry =
  | CommandHookEntry
  | PromptHookEntry
  | AgentHookEntry
  | HttpHookEntry
  | McpToolHookEntry

export interface HookConfig {
  id: string
  scope: HookScope
  event: HookEventName
  matcher?: string
  entry: HookEntry
}

export interface HookSavePayload {
  scope: HookScope
  event: HookEventName
  matcher?: string
  entry: HookEntry
}

// --- Sandbox info ---

export type SandboxMode = 'off' | 'on' | 'auto'

export interface SandboxInfo {
  enabled: boolean
  autoAllowBash: boolean
}

export type SandboxSupportLevel = 'always' | 'conditional' | 'unsupported'

export interface SandboxCapability {
  supportLevel: SandboxSupportLevel
  platform: NodeJS.Platform
  defaultMode: SandboxMode
  unsupportedReason?: string
}

export type SandboxProbeResult =
  | { ok: true }
  | { ok: false; missing: string[]; installHint: string }

export interface GitDirtyStatus {
  files: number
  insertions: number
  deletions: number
}

export interface GitInfo {
  branch: string
  dirty?: GitDirtyStatus
}

export interface GitLogEntry {
  sha: string
  parents: string[]
  message: string
  author: string
  date: string
}

export type GitResult = { ok: true } | { ok: false; error: string }

export type FileOpResult = { ok: true } | { ok: false; error: string }

export type GitFileStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | 'T' | '?' | '!'

export interface FileTreeEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FileTreeEntry[]
  gitIndex?: GitFileStatus | null
  gitWorktree?: GitFileStatus | null
}

export interface GitStatusFile {
  path: string
  status: GitFileStatus
  staged: boolean
}

export interface GitFileDiff {
  path: string
  diff: string
}

export interface GitFileContent {
  path: string
  content: string
  language: string
}

export interface WorktreeEntry {
  path: string
  branch: string
  head: string
  isMain: boolean
  isCurrent: boolean
}

export interface WorktreeInfo {
  isWorktree: boolean
  currentBranch: string
  entries: WorktreeEntry[]
}

export type WorktreeMode = 'branch' | 'attach' | 'detach'

export interface WorktreeActivateRequest {
  baseBranch: string
  mode: WorktreeMode
  branchName?: string
  carryLocalChanges?: boolean
}

export type WorktreeHandoffResult =
  | { ok: true }
  | { ok: false; reason: 'not-worktree' | 'no-changes' | 'local-dirty' | 'conflict' | 'error'; error?: string }

export type WorktreeAssignResult =
  | { ok: true; branch: string }
  | { ok: false; reason: 'name-required' | 'not-detached' | 'exists' | 'checked-out' | 'error'; error?: string }

/**
 * Fork target. `worktree` branches into a fresh detached git worktree;
 * `local` branches in place, sharing the source session's working directory.
 */
export type SessionForkMode = 'worktree' | 'local'

/** Fork a session's conversation into a new independent session. */
export interface SessionForkRequest {
  /** SuperOne session id of the source session to fork. */
  sessionId: string
  /** Fork target. Defaults to `worktree`. */
  mode?: SessionForkMode
  /**
   * Fork the conversation up to and including this message (a `ChatMessage.id`).
   * Omit for a full copy. The source harness resolves it to a transcript
   * truncation point.
   */
  forkFromMessageId?: string
}

export type SessionForkResult =
  | { ok: true; sessionId: string; worktreePath?: string }
  | { ok: false; error: string }

// --- Main → Renderer push events ---

/** Subagent API-retry status carried on tool_progress while a sub-agent waits out a rate-limit/backoff. */
export interface SubagentRetryInfo {
  agentId: string
  attempt: number
  maxRetries: number
  retryDelayMs: number
  errorStatus: number | null
  errorCategory: string
}

export type AgentEventBase =
  | { type: 'message_start'; message: ChatMessage }
  | { type: 'user_message_appended'; message: ChatMessage }
  | { type: 'content_delta'; messageId: string; delta: ContentBlock; isSynthetic?: boolean; isReplay?: boolean }
  | { type: 'tool_input_delta'; messageId: string; toolUseId: string; partialJson: string; parentToolUseId?: string | null }
  | { type: 'tool_progress'; messageId: string; toolUseId: string; toolName: string; elapsedSeconds: number; parentToolUseId?: string | null; taskId?: string; subagentType?: string; subagentRetry?: SubagentRetryInfo }
  | { type: 'message_timestamp'; messageId: string; timestamp: string }
  | { type: 'message_complete'; messageId: string; metadata?: MessageMetadata }
  | { type: 'message_interrupted'; messageId: string; metadata?: MessageMetadata }
  | { type: 'message_error'; messageId: string; error: string }
  | { type: 'status_change'; status: AgentStatus }
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'permission_mode_change'; mode: PermissionMode }
  | { type: 'agent_setting_change'; selectedModel?: string | null; selectedEffort?: EffortLevel | null; patch?: SessionSettingsPatch }
  | { type: 'provider_changed'; harnessId: HarnessId; provider: RemoteActiveProvider | null }
  | { type: 'session_init'; session: SessionInfo }
  /** Provider-side session id for harnesses that have no SessionInfo to report (ACP). */
  | { type: 'provider_session_id'; providerSessionId: string }
  | { type: 'ask_user_question'; request: AskUserQuestionRequest }
  | { type: 'plan_approval'; request: PlanApprovalRequest }
  | { type: 'hook_started'; hook: HookEvent }
  | { type: 'hook_complete'; hook: HookEvent }
  | { type: 'compact_boundary'; trigger: 'manual' | 'auto'; preTokens: number; postTokens?: number; durationMs?: number; messageId?: string }
  | { type: 'status_indicator'; indicator: 'compacting' | null; permissionMode?: PermissionMode; compactResult?: 'success' | 'failed'; compactError?: string }
  | { type: 'task_started'; taskId: string; toolUseId?: string; description: string; taskType?: string; outputFile?: string }
  | {
    type: 'task_progress'
    taskId: string
    toolUseId?: string
    description: string
    lastToolName?: string
    summary?: string
    usage: { totalTokens: number; toolUses: number; durationMs: number }
    activityText?: string
    /** Chronological tool rows (Claude JSONL / Grok chat_history). Not Grok tools_used (distinct names). */
    toolEntries?: Array<{ toolName: string; description: string }>
    /** Transcript path for live/full activity (e.g. Grok child chat_history.jsonl). */
    outputFile?: string
    workflowAgents?: WorkflowAgentRow[]
    workflowPhases?: WorkflowPhaseRow[]
    currentPhase?: string
  }
  | {
    type: 'task_notification'
    taskId: string
    toolUseId?: string
    taskStatus: 'completed' | 'failed' | 'stopped'
    outputFile: string
    summary?: string
    usage?: { totalTokens: number; toolUses: number; durationMs: number }
    resultText?: string
    toolEntries?: Array<{ toolName: string; description: string }>
    workflowAgents?: WorkflowAgentRow[]
    workflowPhases?: WorkflowPhaseRow[]
    currentPhase?: string
  }
  /** Host browser_download task progress / completion for chat tool UI (taskId is bdl_*). */
  | { type: 'browser_download_update'; taskId: string; status: 'progressing' | 'completed' | 'failed'; path?: string; filename?: string; bytes?: number; totalBytes?: number; mimeType?: string; url?: string; error?: string }
  | { type: 'auth_status'; isAuthenticating: boolean; output: string[]; error?: string }
  | { type: 'slash_command_output'; messageId: string; content: string }
  | { type: 'subagent_usage'; messageId: string; parentToolUseId: string; inputTokens: number; outputTokens: number }
  | { type: 'message_usage'; messageId: string; inputTokens: number; outputTokens: number; cacheReadTokens?: number; model?: string; codexUsage?: CodexUsageInfo; contextTokens?: number; contextWindow?: number; costUsd?: number }
  | { type: 'todos_updated'; todos: TodoItem[] }
  | { type: 'codex_thread_started'; messageId: string; threadId: string }
  | { type: 'codex_item_delta'; messageId: string; phase: 'started' | 'updated' | 'completed'; item: CodexThreadItem }
  | { type: 'codex_item_patch'; messageId: string; phase: 'updated'; itemId: string; patch: CodexItemPatch }
  | { type: 'codex_mcp_startup'; messageId: string; servers: CodexMcpServerStartup[] }
  | { type: 'checkpoint_captured'; messageId: string; checkpointId: string; resumePointId: string }
  | { type: 'init_ready'; skills: SlashCommandInfo[]; projectCommands: SlashCommandInfo[]; projectAgents: AgentInfo[]; additionalDirectories: string[]; additionalDirsScoped: { user: string[]; projectShared: string[]; projectLocal: string[] }; cwd: string; homedir: string; sandboxInfo: SandboxInfo; permissionMode: PermissionMode; selectedModel?: string | null; selectedEffort?: EffortLevel | null; activeProvider?: RemoteActiveProvider | null }
  | { type: 'additional_dirs_changed'; additionalDirectories: string[]; additionalDirsScoped: { user: string[]; projectShared: string[]; projectLocal: string[] }; sessionAdditionalDirs: string[] }
  | { type: 'prompt_suggestion'; suggestion: string }
  | { type: 'rate_limit'; status: 'allowed' | 'allowed_warning' | 'rejected'; resetsAt?: number; rateLimitType?: string; utilization?: number; overageStatus?: string; overageResetsAt?: number; overageDisabledReason?: string; isUsingOverage?: boolean; surpassedThreshold?: number; errorCode?: 'credits_required'; canUserPurchaseCredits?: boolean; hasChargeableSavedPaymentMethod?: boolean }
  | { type: 'hook_progress'; hook: HookEvent }
  | { type: 'files_persisted'; files: Array<{ filename: string; fileId: string }>; failed: Array<{ filename: string; error: string }>; processedAt: string }
  | { type: 'elicitation_complete'; mcpServerName: string; elicitationId: string }
  | { type: 'stream_message_start'; messageId: string; apiMessageId: string; model: string; parentToolUseId?: string | null }
  | { type: 'stream_message_stop'; messageId: string; parentToolUseId?: string | null }
  | { type: 'remote_session_start'; remoteProjectPath: string; remoteSessionId: string; isSubscribe?: boolean; harnessId?: HarnessId }
  | { type: 'remote_session_end'; remoteProjectPath: string; remoteSessionId: string; isSubscribe?: boolean }
  | { type: 'interaction_resolved'; interactionType: 'permission' | 'question' | 'plan_approval'; requestId: string; approved?: boolean; feedback?: string }
  | { type: 'codex_collaboration_mode_change'; mode: string }
  | { type: 'codex_plan_approval'; messageId: string; status: 'approved' | 'rejected'; feedback?: string }
  | { type: 'api_retry'; attempt: number; maxRetries?: number; delayMs: number; message?: string }
  | { type: 'model_fallback'; trigger: string; fromModel?: string; toModel?: string }
  | { type: 'queued_message_consumed'; clientMessageId: string }
  | { type: 'worktree_missing'; worktreePath: string; fallbackCwd: string }
  | { type: 'session_title_changed'; sessionId: string; title: string; source: 'user' | 'agent' }
  /**
   * Ultra-short one-line summary of the just-finished turn (Grok `last_turn_summary`).
   * Display-only meta — not part of the agent reply.
   */
  | { type: 'turn_summary'; summary: string; promptId?: string; messageId?: string }
  /**
   * One-sentence session recap (Grok `session_recap` / `/recap` / return-from-away).
   * Display-only meta — not part of the agent reply.
   */
  | { type: 'session_recap'; summary: string; auto?: boolean }
  /** Grok could not produce a recap (manual `/recap` spinner clear). */
  | { type: 'session_recap_unavailable' }
  | { type: 'shared_file'; shareId: string; file: ShareFilePayload; sentAt: number }
  | { type: 'shared_file_progress'; path: string; loaded: number; total: number }
  /** ACP session/new or set_config_option model catalog for the active session. */
  | {
      type: 'acp_models'
      models: ModelOption[]
      selectedModelId: string | null
      configId: string | null
      status?: 'loading' | 'ready' | 'error'
      error?: string
      /** Which ACP agent produced this catalog — drop events that don't match session.acpAgentId. */
      agentId?: string | null
    }
  /** ACP configOptions with category/id "mode" for the active session. */
  | {
      type: 'acp_modes'
      modes: ModelOption[]
      selectedModeId: string | null
      configId: string | null
      status?: 'loading' | 'ready' | 'error'
      error?: string
      agentId?: string | null
    }
  /** ACP available_commands_update for slash-command popup. */
  | {
      type: 'acp_commands'
      commands: SlashCommandInfo[]
      agentId?: string | null
    }

export type AgentEvent = AgentEventBase & { projectPath?: string; sessionId?: string; draftSessionId?: string; seq?: number; epoch?: number }

export type AgentStatus = 'idle' | 'streaming' | 'background' | 'error'

// --- Renderer → Main requests ---

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * Harness-agnostic per-session settings patch broadcast across all renderer windows
 * via the `agent_setting_change` event. Each key is optional; missing keys are not touched.
 *
 * Reducer applies it as `set({ ...session, ...patch })`. To add a new harness setting,
 * extend this interface with the new field — no event-type change required, no router code,
 * the broadcast bus is generic.
 */
export interface SessionSettingsPatch {
  // Claude
  selectedModel?: string | null
  selectedEffort?: EffortLevel | null
  // Codex
  selectedCodexModel?: string | null
  selectedCodexReasoningEffort?: CodexReasoningEffort | null
  selectedCodexServiceTier?: string | null
  selectedCodexPermissionPreset?: CodexPermissionPreset | null
  selectedCodexCollaborationMode?: CodexCollaborationMode | null
  // OpenCode
  openCodeAgentId?: string | null
  // ACP session mode / Grok effort selection (replayed for mini-window)
  selectedAcpModeId?: string | null
  // Shared
  permissionMode?: PermissionMode
  sandboxInfo?: SandboxInfo
  /** null = follow global default. */
  apiProviderId?: string | null
  apiProvider?: RemoteActiveProvider | null
}

export interface SendMessageRequest {
  content: string
  model?: string
  effort?: EffortLevel
  /** Harness-native primary agent selection. */
  agent?: string
  images?: ImageAttachment[]
  additionalDirs?: string[]
  clientMessageId?: string
  assistantMessageId?: string
  sessionId?: string
  gitBranch?: string
  worktreePath?: string
  priority?: 'now' | 'next' | 'later'
  taskBudget?: number
  codex?: CodexSendExtras
  /** Body of the user message as it should appear in the bubble (overrides content blocks built from `content`). */
  userMessageContent?: ContentBlock[]
  /** Mini-app context chips attached to this user message, displayed in the bubble and persisted. */
  contexts?: ChatMessageContext[]
  /** User-selected quote chips attached to this user message, displayed in the bubble and persisted. */
  userSelections?: string[]
  /** null/undefined = follow global default. */
  apiProviderId?: string | null
  /** Harness used when creating a new session for this send. */
  provider?: HarnessId
  /** Transcript provenance for non-human or collab-originated user bubbles. */
  source?: ChatMessageSource
  collaboration?: CollaborationMessageMeta
  /** Cursor local: expire wedged run before this send (LocalSendOptions.force). */
  force?: boolean
  /** Cursor-specific send extras. */
  cursor?: {
    force?: boolean
    /** Full `model.params` selection map (param id → catalog value). */
    params?: Record<string, string>
    /** @deprecated Prefer `params.fast`. */
    fast?: boolean
  }
}

export interface CodexSendExtras {
  mode?: 'run' | 'review' | 'compact'
  reviewTarget?: CodexReviewTarget
  permissionPreset?: CodexPermissionPreset
  reasoningEffort?: CodexReasoningEffort
  serviceTier?: string | null
  collaborationMode?: CodexCollaborationMode
  threadId?: string
  cwd?: string
  prompt?: string
}

export interface AgentPrewarmHint {
  effort?: SendMessageRequest['effort']
  model?: string
  additionalDirs?: string[]
  sessionId?: string
  provider?: HarnessId
  worktreePath?: string
  /** ACP agent id override for prewarm (avoids racing app-settings persistence). */
  acpAgentId?: string
}

// --- Model selection ---

export interface ModelOption {
  id: string
  name: string
  description: string
  /** Provider-reported maximum context tokens when the harness exposes it. */
  contextWindow?: number
  resolvedModel?: string
  isDefault?: boolean
  supportsEffort?: boolean
  supportedEffortLevels?: ('low' | 'medium' | 'high' | 'xhigh' | 'max')[]
  supportsAdaptiveThinking?: boolean
  supportsFastMode?: boolean
  supportsAutoMode?: boolean
  supportedReasoningEfforts?: ReasoningEffortOption[]
  defaultReasoningEffort?: CodexReasoningEffort
  /** App-server service tiers available for this model (for example `fast`). */
  serviceTiers?: Array<{ id: string; name: string; description: string }>
  defaultServiceTier?: string | null
  /**
   * Harness-native parameter catalog (e.g. Cursor SDK `ModelParameterDefinition`).
   * Used to rebuild provider-specific model selections (fast / effort / optimize_for).
   */
  parameters?: Array<{
    id: string
    displayName?: string
    values: Array<{ value: string; displayName?: string }>
  }>
}

export const DEFAULT_CONTEXT_WINDOW = 200_000
export const EXTENDED_CONTEXT_WINDOW = 1_000_000
export const CODEX_GPT_5_6_CONTEXT_WINDOW = 272_000

const EXTENDED_CONTEXT_RE = /\[1m\]/i
const CODEX_GPT_5_6_RE = /^gpt-5\.6(?:$|-)/i

export function modelHasExtendedContext(model: { id?: string | null; resolvedModel?: string | null } | null | undefined): boolean {
  if (!model) return false
  return EXTENDED_CONTEXT_RE.test(model.id ?? '') || EXTENDED_CONTEXT_RE.test(model.resolvedModel ?? '')
}

export function resolveModelContextWindow(model: { id?: string | null; resolvedModel?: string | null } | null | undefined): number {
  return modelHasExtendedContext(model) ? EXTENDED_CONTEXT_WINDOW : DEFAULT_CONTEXT_WINDOW
}

function positiveContextWindow(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}

function modelUsesCodexGpt56Window(model: { id?: string | null; resolvedModel?: string | null }): boolean {
  return [model.id, model.resolvedModel].some((id) => {
    const bareId = id?.split('/').at(-1)
    return bareId ? CODEX_GPT_5_6_RE.test(bareId) : false
  })
}

/**
 * Context ring denominator. Prefer models.dev catalog window over agent/session
 * maxTokens (those are often wrong or include non-window padding).
 *
 * Priority:
 * 1. Codex GPT-5.6 managed window
 * 2. models.dev `contextWindow` (when `[1m]` is set, at least {@link EXTENDED_CONTEXT_WINDOW})
 * 3. `[1m]` → 1M when catalog missing
 * 4. harness-reported model option window
 * 5. Claude hardcoded 200k/1M fallback (when `claudeFallback`)
 * 6. session / detailed-usage maxTokens as last resorts
 */
export function resolveRingContextWindow(input: {
  harnessId?: HarnessId | null
  modelId?: string | null
  resolvedModel?: string | null
  catalogContextWindow?: number | null
  harnessContextWindow?: number | null
  sessionContextWindow?: number | null
  detailedMaxTokens?: number | null
  claudeFallback?: boolean
  /**
   * User-selected window that outranks every catalog lookup
   * (e.g. Cursor's `context` model parameter: 300k / 1m).
   */
  selectedContextWindow?: number | null
}): number | null {
  const selected = positiveContextWindow(input.selectedContextWindow)
  if (selected != null) return selected
  const model = { id: input.modelId, resolvedModel: input.resolvedModel }
  if (input.harnessId === 'codex' && modelUsesCodexGpt56Window(model)) {
    return CODEX_GPT_5_6_CONTEXT_WINDOW
  }
  const extended = modelHasExtendedContext(model)
  const catalog = positiveContextWindow(input.catalogContextWindow)
  if (catalog != null) {
    return extended ? Math.max(catalog, EXTENDED_CONTEXT_WINDOW) : catalog
  }
  if (extended) return EXTENDED_CONTEXT_WINDOW
  const harness = positiveContextWindow(input.harnessContextWindow)
  if (harness != null) return harness
  if (input.claudeFallback) return resolveModelContextWindow(model)
  return (
    positiveContextWindow(input.sessionContextWindow)
    ?? positiveContextWindow(input.detailedMaxTokens)
  )
}

// --- File rewind ---

export interface RewindFilesResult {
  canRewind: boolean
  /** False when the provider can only rewind code together with its conversation. */
  supportsCodeOnly?: boolean
  error?: string
  filesChanged?: string[]
  insertions?: number
  deletions?: number
  forkedSessionId?: string
}

// --- Setup events ---

export type SetupEvent =
  | { type: 'install_output'; data: string }
  | { type: 'install_complete'; code: number }
  | { type: 'install_error'; error: string }

// --- Recent folder ---

export interface RecentFolder {
  id: string          // UUID primary key
  path: string
  name: string        // basename
  lastOpened: string   // ISO timestamp — last user message time or added time
  addedAt: string      // ISO timestamp — set once on first add
  missing?: boolean   // true when the folder path no longer exists on disk
}

// --- Resource scope ---

export type ResourceScope = 'user' | 'project' | 'claudeai'

// --- Settings provider ---

export type SettingsProvider = 'claude' | 'codex' | 'cursor'

// ─── Agent Run Config (automation / unattended runs — all harnesses) ───
//
// Prefer unified field names shared with collab launch config:
//   model, effort, permissionMode, sandboxMode, apiProviderId, acpAgentId
// Codex legacy JSON may still store reasoningEffort / permissionPreset;
// normalize on read (see toAgentView / turnOptions helpers).

export interface ClaudeRunConfig {
  type: 'claude'
  agentName?: string
  model?: string
  effort?: EffortLevel
  permissionMode?: PermissionMode
  sandboxMode?: SandboxMode
  apiProviderId?: string | null
}

export interface CodexRunConfig {
  type: 'codex'
  model?: string
  /** Preferred unified effort field (same as collab). */
  effort?: string
  /** @deprecated Prefer `effort` — kept for stored automations. */
  reasoningEffort?: CodexReasoningEffort
  /** Preferred unified permission (maps from/to permissionPreset in UI). */
  permissionMode?: PermissionMode
  /** @deprecated Prefer `permissionMode` — kept for stored automations. */
  permissionPreset?: CodexPermissionPreset
  apiProviderId?: string | null
}

export interface AcpRunConfig {
  type: 'acp'
  /** ACP agent id (e.g. grok-build). When omitted, session provider default is used. */
  acpAgentId?: string
  model?: string
  effort?: string
  permissionMode?: PermissionMode
  apiProviderId?: string | null
}

export interface OpenCodeRunConfig {
  type: 'opencode'
  model?: string
  effort?: string
  permissionMode?: PermissionMode
  apiProviderId?: string | null
}

export type AgentRunConfig = ClaudeRunConfig | CodexRunConfig | AcpRunConfig | OpenCodeRunConfig

// ─── Automation ───

export type AutomationScheduleType = 'one-time' | 'recurring'
export type AutomationRunStatus = 'idle' | 'running' | 'completed' | 'error'

export interface AutomationSchedule {
  type: AutomationScheduleType
  cron?: string
  runAt?: string
  preset?: 'hourly' | 'daily' | 'weekly' | 'custom'
  timeOfDay?: string
  dayOfWeek?: number[]
  minuteOfHour?: number
  /**
   * Agent-written natural-language schedule for UI (list + confirm).
   * Prefer the user's language, e.g. "Every weekday at 9:00 AM" / "每天上午 9 点".
   * Machine fields (cron/runAt) still drive the scheduler.
   */
  summary?: string
}

export interface Automation {
  id: string
  name: string
  prompt: string
  agentConfig: AgentRunConfig
  schedule: AutomationSchedule
  projectPath: string
  enabled: boolean
  lastRunAt?: string
  lastRunStatus?: AutomationRunStatus
  lastRunSessionId?: string
  nextRunAt?: string
  createdAt: string
  updatedAt: string
}

export interface CreateAutomationRequest {
  name: string
  prompt: string
  agentConfig: AgentRunConfig
  schedule: AutomationSchedule
}

export interface UpdateAutomationRequest extends Partial<CreateAutomationRequest> {
  enabled?: boolean
}

export type AgentType = AgentRunConfig['type']
export type ApiFormat = 'anthropic' | 'openai_chat' | 'openai_responses'

// --- Plugins ---

export interface PluginManifest {
  name: string
  version?: string
  description: string
  author?: { name: string; email?: string }
}

export type PluginInstallPolicy = 'NOT_AVAILABLE' | 'AVAILABLE' | 'INSTALLED_BY_DEFAULT'
export type PluginAuthPolicy = 'ON_INSTALL' | 'ON_USE'

export interface PluginAppSummary {
  id: string
  name: string
  description?: string
  installUrl?: string
  needsAuth: boolean
}

export interface PluginSkillSummary {
  name: string
  displayName?: string
  description: string
  shortDescription?: string
  path: string
  enabled: boolean
}

export interface PluginInfo {
  name: string            // e.g., "code-review"
  marketplace: string     // e.g., "claude-plugins-official"
  key: string             // e.g., "code-review@claude-plugins-official"
  scope: ResourceScope
  description: string
  displayName?: string
  longDescription?: string
  author?: string
  category?: string
  capabilities?: string[]
  websiteUrl?: string
  privacyPolicyUrl?: string
  termsOfServiceUrl?: string
  defaultPrompts?: string[]
  brandColor?: string
  iconPath?: string
  logoPath?: string
  screenshots?: string[]
  enabled?: boolean
  installPolicy?: PluginInstallPolicy
  authPolicy?: PluginAuthPolicy
  version?: string
  installPath: string
  installedAt?: string
  hasCommands: boolean
  hasAgents: boolean
  hasSkills: boolean
  hasHooks: boolean
  hasMcpServers: boolean
  latestVersion?: string
  hasUpdate: boolean
}

export interface PluginDetail extends PluginInfo {
  apps?: PluginAppSummary[]
  skills?: PluginSkillSummary[]
  mcpServers?: string[]
  mcpServerConfigs?: Record<string, unknown>
  hookEvents?: Record<string, unknown>
  files: SkillFileEntry[]
}

/** Scope of a marketplace declaration in settings.json (per Claude Code docs). */
export type MarketplaceScope = 'user' | 'project' | 'local' | 'official'

export interface MarketplacePlugin {
  name: string
  marketplace: string
  key: string              // "name@marketplace"
  description: string
  displayName?: string
  longDescription?: string
  author?: string
  category?: string
  capabilities?: string[]
  websiteUrl?: string
  privacyPolicyUrl?: string
  termsOfServiceUrl?: string
  defaultPrompts?: string[]
  brandColor?: string
  iconPath?: string
  logoPath?: string
  screenshots?: string[]
  enabled?: boolean
  installPolicy?: PluginInstallPolicy
  authPolicy?: PluginAuthPolicy
  installCount?: number
  installed: boolean
  installedScope?: ResourceScope
  marketplaceLastUpdated?: string
  marketplaceSource?: string   // e.g. "github:anthropics/claude-plugins-official" or "directory:/path"
  marketplaceScope?: MarketplaceScope
  version?: string
  hasCommands?: boolean
  hasAgents?: boolean
  hasSkills?: boolean
  hasHooks?: boolean
  hasMcpServers?: boolean
}

export interface MarketplacePluginDetail extends MarketplacePlugin {
  sourcePath: string
  files: SkillFileEntry[]
  mcpServers?: string[]
  mcpServerConfigs?: Record<string, unknown>
  hookEvents?: Record<string, unknown>
}

export interface MarketplaceSourceInfo {
  name: string
  source: 'github' | 'directory' | 'url'
  repo?: string
  path?: string
  url?: string
  installLocation: string
  lastUpdated?: string
}

// --- Skills ---

export interface SkillInfo {
  name: string
  displayName: string
  scope: ResourceScope
  description: string
  argumentHint?: string
  hasConfig: boolean
  builtin?: boolean
  sourcePath: string
  /** Codex runtime enablement; absent for legacy/Claude discovery. */
  enabled?: boolean
}

export interface SkillFileEntry {
  name: string
  isDirectory: boolean
  children?: SkillFileEntry[]
}

export interface SkillDetail extends SkillInfo {
  files: SkillFileEntry[]
}

// --- MCP config ---

export interface McpServerConfig {
  name: string
  type: 'stdio' | 'http' | 'sse'
  scope: ResourceScope
  disabled?: boolean
  // stdio fields
  command?: string
  args?: string[]
  env?: Record<string, string>
  // http fields
  url?: string
  headers?: Record<string, string>
}

// --- MCP server metadata (from initialize) ---

export interface McpIconInfo {
  src: string
  mimeType?: string
  sizes?: string[]
  theme?: 'light' | 'dark'
}

export interface McpServerMeta {
  name: string
  version?: string
  description?: string
  websiteUrl?: string
  icons?: McpIconInfo[]
  tools?: McpToolInfo[]
}

export interface McpCheckResult {
  status: McpServerInfo[]
  meta: Record<string, McpServerMeta>
}

// --- MCP library ---

export interface McpLibraryEntry {
  name: string
  type: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  description?: string
  icons?: McpIconInfo[]
  savedAt: string
  bundleId?: string
  bundleVersion?: string
}

// --- Session history ---

export interface SessionHistoryEntry {
  sessionId: string
  title: string        // First user message, truncated
  lastActiveAt: string // File modification time
  provider?: HarnessId
  /** ACP agent id when provider is `acp` (e.g. `grok-build`) — drives brand icon. */
  acpAgentId?: string | null
  providerSessionId?: string // Claude Code SDK session UUID / Codex thread id
  gitBranch?: string
  messageCount: number // Total user + assistant messages
  isWorktree?: boolean // true if session was created in a git worktree
  worktreePath?: string // filesystem path to the worktree directory
  isPinned?: boolean   // true if session is pinned by user
  isHidden?: boolean   // true if session is hidden by user
  /** Agent-set labels for archive list/search. Omitted when empty. */
  tags?: string[]
  isAutomation?: boolean
  automationId?: string
  /** Parent SuperOne session when this entry was created through session_start. */
  parentSessionId?: string
}

export interface PinnedSessionEntry extends SessionHistoryEntry {
  folderPath: string
  folderName: string
}

export interface LoadSessionMessagesResult {
  messages: ChatMessage[]
  cursor: number | null  // Index of earliest loaded message, null if no more
  hasMore: boolean
}

// --- Per-harness global resources ---

export interface ClaudeResources {
  models: ModelOption[]
  account: AccountInfo
  slashCommands: SlashCommandInfo[]
  skills: SlashCommandInfo[]
  commands: SlashCommandInfo[]
  agents: AgentInfo[]
  outputStyles: string[]
}

export interface CodexResources {
  models: ModelOption[]
  prompts: SlashCommandInfo[]
}

export interface OpenCodeAgentOption {
  id: string
  name: string
  description?: string
  /** Optional default model slug (`provider/model`) configured on the agent. */
  modelId?: string | null
}

export interface OpenCodeResources {
  models: ModelOption[]
  agents: OpenCodeAgentOption[]
  commands: SlashCommandInfo[]
}

/** Cached CONNECT payload for the Cursor harness (`@cursor/sdk`). */
export interface CursorResources {
  models: ModelOption[]
  /** From `Cursor.me` when probe succeeds. */
  user?: {
    apiKeyName?: string
    userEmail?: string | null
    userId?: number | null
  } | null
  /** Optional `Cursor.repositories.list` for cloud create. */
  repositories?: Array<{ url: string }>
  /** True while a background re-probe is in flight. */
  probing?: boolean
  /**
   * Model ids hidden from the picker (from cursor-base harness config).
   * Empty = all catalog models enabled.
   */
  disabledModelIds?: string[]
}

/**
 * Cached resources for the DeepSeek Harness (`@deepseek-ai/dsh-*`, in-process
 * Cordis tree). Models are read live from the tree's `ctx.llm` registries and
 * cached here for pickers; permission presets come from `dsh-permission-presets`
 * and are the displayed mode vocabulary for this harness.
 */
export interface DeepseekResources {
  models: ModelOption[]
  /** dsh permission preset vocabulary shown by the mode selector. */
  permissionPresets?: Array<{ id: string; name: string; description?: string | null }>
  /** True while a background re-probe is in flight. */
  probing?: boolean
}

export interface AcpAgentDescriptor {
  id: string
  name: string
  installed: boolean
  commandPreview: string
}

/** Per-agent model catalog (persisted in harness_resource_cache, refreshed once per app open). */
export interface AcpAgentModelCatalog {
  models: ModelOption[]
  selectedModelId: string | null
  configId: string | null
  updatedAt: string
}

/** Serializable ACP session config option value (select). Nested `options` = option groups. */
export interface AcpConfigSelectValue {
  value?: string
  name?: string
  description?: string | null
  options?: AcpConfigSelectValue[]
}

/** Serializable subset of ACP SessionConfigOption for harness_resource_cache. */
export interface AcpConfigOption {
  id: string
  name: string
  description?: string | null
  category?: string | null
  type: 'select' | 'boolean' | string
  currentValue?: string | boolean | null
  options?: AcpConfigSelectValue[]
}

/**
 * Full per-agent ACP session config snapshot.
 * Prefer this over modelsByAgentId — models/modes are derived from configOptions
 * (with extraModels for agents that expose models outside configOptions, e.g. Grok).
 */
export interface AcpAgentConfigCatalog {
  configOptions: AcpConfigOption[]
  /** Non-standard model list when not present in configOptions. */
  extraModels?: ModelOption[]
  selectedModelId?: string | null
  modelConfigId?: string | null
  /**
   * Non-standard mode list when modes live outside configOptions
   * (Grok x.ai sessionConfig effort options).
   */
  extraModes?: ModelOption[]
  selectedModeId?: string | null
  /**
   * Session-mode config option id when modes use setConfigOption.
   * Explicit `null` = Grok-style effort via session/set_model + `_meta.reasoningEffort`.
   */
  modeConfigId?: string | null
  /** Last known available_commands_update list for this agent. */
  slashCommands?: SlashCommandInfo[]
  updatedAt: string
}

/** Unified session-facing catalog derived from cache (models + modes). */
export interface AcpSessionCatalog {
  configOptions: AcpConfigOption[]
  models: ModelOption[]
  selectedModelId: string | null
  modelConfigId: string | null
  modes: ModelOption[]
  selectedModeId: string | null
  modeConfigId: string | null
  slashCommands: SlashCommandInfo[]
  updatedAt: string
}

export interface AcpResources {
  agents: AcpAgentDescriptor[]
  selectedAgentId: string | null
  /** True while a background re-detect is in flight. */
  detecting?: boolean
  /**
   * @deprecated Prefer configByAgentId. Still written as a derived view for
   * older cache readers; readers should use derive helpers / getCachedAcpCatalog.
   */
  modelsByAgentId?: Record<string, AcpAgentModelCatalog>
  /** Full session configOptions keyed by agent id (grok-build, opencode, …). */
  configByAgentId?: Record<string, AcpAgentConfigCatalog>
}

export interface HarnessResourcesMap {
  claude: ClaudeResources
  codex: CodexResources
  acp: AcpResources
  opencode: OpenCodeResources
  cursor: CursorResources
  deepseek: DeepseekResources
}

export type HarnessId = keyof HarnessResourcesMap

// --- Startup data (cached per-harness resources) ---

export interface StartupData {
  cached: {
    claude: ClaudeResources | null
    codex: CodexResources | null
    acp: AcpResources | null
    opencode?: OpenCodeResources | null
    cursor?: CursorResources | null
    deepseek?: DeepseekResources | null
  }
  sandboxCapability: SandboxCapability
  appVersion: string
}

// --- Codex experimental integration ---

export type CodexAuthMode = 'auto' | 'chatgpt' | 'apiKey'
export type CodexApprovalMode = 'never' | 'on-request' | 'on-failure' | 'untrusted'
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export type CodexPermissionPreset = 'read-only' | 'default' | 'auto-review' | 'full-access'
export type CodexApprovalsReviewer = 'user' | 'auto_review'

export interface CodexPermissionProfile {
  approvalPolicy: CodexApprovalMode
  approvalsReviewer: CodexApprovalsReviewer
  sandboxMode: CodexSandboxMode
  networkAccessEnabled: boolean
}

export const CODEX_PERMISSION_PRESETS: Record<CodexPermissionPreset, CodexPermissionProfile> = {
  'read-only': {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxMode: 'read-only',
    networkAccessEnabled: false,
  },
  default: {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxMode: 'workspace-write',
    networkAccessEnabled: false,
  },
  'auto-review': {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
    sandboxMode: 'workspace-write',
    networkAccessEnabled: false,
  },
  'full-access': {
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandboxMode: 'danger-full-access',
    networkAccessEnabled: true,
  },
}

export const CODEX_PERMISSION_PROFILE_IDS: Record<CodexPermissionPreset, string> = {
  'read-only': ':read-only',
  default: ':workspace',
  'auto-review': ':workspace',
  'full-access': ':danger-full-access',
}
export const DEFAULT_CODEX_PERMISSION_PRESET: CodexPermissionPreset = 'auto-review'
export const DEFAULT_CODEX_PERMISSION_PROFILE: CodexPermissionProfile =
  CODEX_PERMISSION_PRESETS[DEFAULT_CODEX_PERMISSION_PRESET]

export interface CodexAuthStatus {
  mode: CodexAuthMode
  resolvedMode: 'chatgpt' | 'apiKey'
  hasEnvApiKey: boolean
  hasSessionApiKey: boolean
  isRunning: boolean
}

export interface CodexRateLimitWindow {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

export interface CodexMcpOauthLoginResult {
  success: boolean
  error?: string
  /** Present when login returned an authorize URL (headless clients surface this). */
  authorizationUrl?: string
}

export interface CodexExternalAgentItem {
  itemType: string
  description: string
  cwd: string | null
  details?: unknown
}

export interface CodexExternalAgentImportResult {
  successCount: number
  failureCount: number
}

export interface CodexRateLimitResetCredit {
  id: string
  status: 'available' | 'redeeming' | 'redeemed' | 'unknown'
  title: string | null
  description: string | null
  expiresAt: number | null
}

export interface CodexRateLimits {
  primary: CodexRateLimitWindow | null
  secondary: CodexRateLimitWindow | null
  planType: string | null
  resetCredits: number | null
  resetCreditList?: CodexRateLimitResetCredit[]
}

export type CodexRateLimitResetOutcome = 'reset' | 'nothingToReset' | 'noCredit' | 'alreadyRedeemed' | 'unknown'

export interface CodexAccountUsage {
  lifetimeTokens: number | null
  peakDailyTokens: number | null
  longestRunningTurnSec: number | null
  currentStreakDays: number | null
  longestStreakDays: number | null
}

export interface ClaudeRateLimitWindow {
  label: string
  usedPercent: number
  resetsAt: number | null
}

export interface ClaudeExtraUsage {
  usedDollars: number
  limitDollars: number | null
}

export interface ClaudeRateLimits {
  windows: ClaudeRateLimitWindow[]
  extraUsage: ClaudeExtraUsage | null
  planType: string | null
  fetchedAt?: number | null
}

export interface ProviderRateLimits extends ClaudeRateLimits {
  title: string
  /** Remaining prepaid ("bought") credit balance in USD, when the provider reports one. */
  creditBalanceDollars?: number
}

export type CodexHookEventName =
  | 'preToolUse'
  | 'postToolUse'
  | 'permissionRequest'
  | 'preCompact'
  | 'postCompact'
  | 'sessionStart'
  | 'sessionEnd'
  | 'userPromptSubmit'
  | 'stop'

export type CodexHookHandlerType = 'command' | 'prompt' | 'agent'

export type CodexHookSource = 'user' | 'project' | 'managed' | 'plugin' | 'unknown'

export type CodexHookTrustStatus = 'trusted' | 'untrusted' | 'unknown'

export interface CodexHookInfo {
  key: string
  eventName: CodexHookEventName
  handlerType: CodexHookHandlerType
  matcher: string | null
  command: string | null
  timeoutSec: number
  statusMessage: string | null
  sourcePath: string
  source: CodexHookSource
  pluginId: string | null
  displayOrder: number
  enabled: boolean
  isManaged: boolean
  trustStatus: CodexHookTrustStatus
}

export interface CodexHookGroup {
  cwd: string
  hooks: CodexHookInfo[]
  warnings: string[]
  errors: string[]
}

export interface CodexMarketplaceAddRequest {
  source: string
  refName?: string
  sparsePaths?: string[]
}

export interface CodexMarketplaceAddResult {
  marketplaceName: string
  installedRoot: string
  alreadyAdded: boolean
}

export interface CodexMarketplaceUpgradeError {
  marketplaceName: string
  message: string
}

export interface CodexMarketplaceUpgradeResult {
  selectedMarketplaces: string[]
  upgradedRoots: string[]
  errors: CodexMarketplaceUpgradeError[]
}

export type CodexGoalStatus = 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete'

export interface CodexGoal {
  threadId: string
  objective: string
  status: CodexGoalStatus
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: number
  updatedAt: number
}

export interface CodexSetAuthRequest {
  mode: CodexAuthMode
  apiKey?: string
}

export interface EndpointTestResult {
  endpointId: string
  success: boolean
  status?: number
  error?: string
}

export interface ProviderEndpointTestResponse {
  success: boolean
  results: EndpointTestResult[]
}

/** Protocol families a discovered relay model can be reached over (mirrors platform-registry ProtocolFamily). */
export type DiscoveredProtocolFamily = 'anthropic' | 'openai' | 'google' | 'newapi'

/** Opt-in extra wires the discover pass can turn on (Codex Responses, etc.). */
export type DiscoveredExtraProtocol = 'openai-responses'

/**
 * Identified relay/aggregator lineage for a custom provider's site root.
 * `openai-compatible` is the fallback when nothing distinctive matched.
 */
export type RelayKind = 'new-api' | 'one-api' | 'sub2api' | 'openai-compatible'

export interface RelayFingerprint {
  kind: RelayKind
  name?: string
}

/**
 * A model discovered on a relay/aggregator (e.g. NewAPI OpenAI-format `/v1/models` + optional `/api/pricing`).
 * `byFamily` is the source of truth for which wire to enable on; `tasks` is the flattened union for UI filters.
 */
export interface DiscoveredOpenAiModel {
  id: string
  name?: string
  tasks: CapabilityTask[]
  byFamily: Partial<Record<DiscoveredProtocolFamily, CapabilityTask[]>>
}

export interface DiscoverModelsResult {
  models: DiscoveredOpenAiModel[]
  truncated: boolean
  sources: { pricing: 'ok' | 'unavailable'; modelsList: 'ok' | 'unavailable' }
  extras?: DiscoveredExtraProtocol[]
  relay?: RelayFingerprint
}

export interface CodexRunRequest {
  prompt: string
  model?: string
  reasoningEffort?: CodexReasoningEffort
  permissionPreset?: CodexPermissionPreset
  serviceTier?: string | null
  collaborationMode?: CodexCollaborationMode
  images?: ImageAttachment[]
  threadId?: string
  messageId?: string
  cwd?: string
}

export interface CodexRunResult {
  threadId: string | null
  turnId?: string
  finalResponse: string
  usage: CodexUsageInfo | null
  items: CodexThreadItem[]
}

export type CodexReviewTarget =
  | { type: 'uncommittedChanges' }
  | { type: 'baseBranch'; branch: string }
  | { type: 'commit'; sha: string; title?: string }

export interface CodexReviewRequest {
  target: CodexReviewTarget
  model?: string
  reasoningEffort?: CodexReasoningEffort
  permissionPreset?: CodexPermissionPreset
  serviceTier?: string | null
  threadId?: string
  messageId?: string
  cwd?: string
}

export interface CodexCompactRequest {
  model?: string
  permissionPreset?: CodexPermissionPreset
  serviceTier?: string | null
  threadId?: string
  messageId?: string
  cwd?: string
}

// --- Update events ---

export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string; releaseNotes?: string }
  | { type: 'not-available' }
  /** App binary and/or post-app harness pre-fetch progress. */
  | {
      type: 'download-progress'
      percent: number
      phase?: 'app' | 'harness'
      harnessId?: string
    }
  /** App + enabled harness pins ready — safe to Restart. */
  | { type: 'downloaded'; version: string }
  /** App binary ready but harness pre-fetch failed — Restart blocked. */
  | { type: 'harness-error'; version: string; message: string }
  | { type: 'error'; message: string }

// --- Bash output events ---

export interface BashOutputEvent {
  toolUseId: string
  content: string
  finished: boolean
}

// --- API Provider types ---

export type ProviderCategory = 'model_provider' | 'cloud_platform' | 'aggregator' | 'proxy_service' | 'custom'

export type ModelBucket = 'default' | 'opus' | 'sonnet' | 'haiku' | 'subagent'

export const MODEL_BUCKETS: ModelBucket[] = ['default', 'opus', 'sonnet', 'haiku', 'subagent']

export interface ProviderModelSlot {
  id: string
  name?: string
  description?: string
}

export type ProviderModelEnv = Partial<Record<ModelBucket, ProviderModelSlot>>

export interface RemoteActiveProvider {
  id: string
  name: string
  presetKey: string | null
  modelEnv: ProviderModelEnv
  forcedEffort: EffortLevel | 'auto' | null
}

export const BUCKET_ENV_KEYS: Record<ModelBucket, { id: string; name?: string; desc?: string }> = {
  default: { id: 'ANTHROPIC_MODEL' },
  opus: {
    id: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    name: 'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
    desc: 'ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION',
  },
  sonnet: {
    id: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    name: 'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
    desc: 'ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION',
  },
  haiku: {
    id: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    name: 'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
    desc: 'ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION',
  },
  subagent: { id: 'CLAUDE_CODE_SUBAGENT_MODEL' },
}

export function parseProviderModelEnv(raw: string | undefined): ProviderModelEnv {
  try {
    const obj = JSON.parse(raw || '{}') as Record<string, unknown>
    const result: ProviderModelEnv = {}
    for (const bucket of MODEL_BUCKETS) {
      const slot = obj[bucket]
      if (slot && typeof slot === 'object' && 'id' in slot && typeof (slot as { id: unknown }).id === 'string') {
        result[bucket] = slot as ProviderModelSlot
      }
    }
    return result
  } catch {
    return {}
  }
}

export function expandProviderModelEnv(modelEnv: ProviderModelEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const bucket of MODEL_BUCKETS) {
    const slot = modelEnv[bucket]
    if (!slot?.id) continue
    const keys = BUCKET_ENV_KEYS[bucket]
    env[keys.id] = slot.id
    if (keys.name && slot.name) env[keys.name] = slot.name
    if (keys.desc && slot.description) env[keys.desc] = slot.description
  }
  return env
}

// Consumer-facing capability, orthogonal to wire protocol. See @superone/shared/platform-registry.
export type CapabilityTask = 'chat' | 'image' | 'video' | 'tts' | 'asr'

export interface MediaProviderStatus {
  id: string
  label: string
  providerLabel?: string
  kind: string
  categories: string[]
  defaultModel: string
  models: { id: string; label: string }[]
  apiKeyEnv?: string
  baseURL?: string
  custom: boolean
  hasKey: boolean
  hasEnvKey: boolean
}

export interface UpsertMediaProviderRequest {
  id?: string
  label: string
  baseURL: string
  models: string[]
  kind?: 'openai-compatible' | 'google'
}

export interface ProcessMetricLite {
  pid: number
  type: string
  name?: string
  serviceName?: string
  cpu: { percentCPUUsage: number; idleWakeupsPerSecond: number }
  memory: { workingSetSize: number; peakWorkingSetSize: number }
}

export interface AppMetricsSnapshot {
  selfPid: number
  logicalCpuCount: number
  metrics: ProcessMetricLite[]
}

// --- IPC channel constants ---

export interface SaveWidgetTemplateRequest {
  id: string
  title: string
  code: string
  description?: string
  inputSchema?: Record<string, unknown>
  scope: 'project' | 'user'
}

export interface SavedWidgetTemplate {
  id: string
  scope: 'project' | 'user'
  version: number
}

export const AgentIpcChannels = {
  // App-level channels
  CONNECT_CLAUDE: 'app:connect-claude',
  CONNECT_CODEX: 'app:connect-codex',
  CONNECT_OPENCODE: 'app:connect-opencode',
  CONNECT_CURSOR: 'app:connect-cursor',
  SET_CURSOR_API_KEY: 'app:set-cursor-api-key',
  GET_CURSOR_AUTH_STATUS: 'app:get-cursor-auth-status',
  CURSOR_LIST_AGENTS: 'app:cursor-list-agents',
  CURSOR_LIST_RUNS: 'app:cursor-list-runs',
  CURSOR_ARCHIVE_AGENT: 'app:cursor-archive-agent',
  CURSOR_UNARCHIVE_AGENT: 'app:cursor-unarchive-agent',
  CURSOR_DELETE_AGENT: 'app:cursor-delete-agent',
  CURSOR_LIST_ARTIFACTS: 'app:cursor-list-artifacts',
  CURSOR_DOWNLOAD_ARTIFACT: 'app:cursor-download-artifact',
  CURSOR_LIST_REPOSITORIES: 'app:cursor-list-repositories',
  CURSOR_UPDATE_BASE_CONFIG: 'app:cursor-update-base-config',
  GET_CURSOR_BASE_CONFIG: 'app:get-cursor-base-config',
  CURSOR_GET_AGENT: 'app:cursor-get-agent',
  CURSOR_LIST_MESSAGES: 'app:cursor-list-messages',
  CURSOR_GET_RUN: 'app:cursor-get-run',
  CURSOR_CANCEL_RUN: 'app:cursor-cancel-run',
  CURSOR_FORCE_RECOVER: 'app:cursor-force-recover',
  CURSOR_SDK_LOGIN: 'app:cursor-sdk-login',
  CURSOR_SDK_LOGOUT: 'app:cursor-sdk-logout',
  CURSOR_SDK_AUTH_STATUS: 'app:cursor-sdk-auth-status',
  CURSOR_GET_USAGE: 'app:cursor-get-usage',
  CURSOR_LIST_SLASH_ITEMS: 'app:cursor-list-slash-items',
  GET_STARTUP_DATA: 'app:get-startup-data',
  GET_APP_METRICS: 'app:get-app-metrics',
  SELECT_FOLDER: 'app:select-folder',
  GET_RECENT_FOLDERS: 'app:get-recent-folders',
  ADD_RECENT_FOLDER: 'app:add-recent-folder',
  REMOVE_RECENT_FOLDER: 'app:remove-recent-folder',
  GET_PROJECT_ID: 'app:get-project-id',
  OPEN_FOLDER: 'app:open-folder',
  OPEN_TMP_FOLDER: 'app:open-tmp-folder',
  CACHE_IMAGE: 'app:cache-image',
  RESOLVE_FAVICON: 'app:resolve-favicon',
  RESOLVE_SITE_IDENTITY: 'app:resolve-site-identity',
  CACHE_FAVICON: 'app:cache-favicon',
  CLOSE_PROJECT: 'app:close-project',
  SETUP_CHECK_CLAUDE: 'app:setup-check-claude',
  SETUP_INSTALL_CLAUDE: 'app:setup-install-claude',
  SETUP_EVENT: 'app:setup-event',
  CODEX_RUN: 'codex:run',
  CODEX_LIST_MODELS: 'codex:list-models',
  CODEX_STEER: 'codex:steer',
  CODEX_REVIEW: 'codex:review',
  CODEX_COMPACT: 'codex:compact',
  CODEX_PLAN_APPROVAL: 'codex:plan-approval',
  CODEX_COLLABORATION_MODE_CHANGE: 'codex:collaboration-mode-change',
  CODEX_GET_AUTH_STATUS: 'codex:get-auth-status',
  CODEX_SET_AUTH: 'codex:set-auth',
  CODEX_GET_RATE_LIMITS: 'codex:get-rate-limits',
  CODEX_GET_ACCOUNT_USAGE: 'codex:get-account-usage',
  CODEX_CONSUME_RATE_LIMIT_RESET: 'codex:consume-rate-limit-reset',
  CODEX_MCP_OAUTH_LOGIN: 'codex:mcp-oauth-login',
  CODEX_EXTERNAL_AGENT_DETECT: 'codex:external-agent-detect',
  CODEX_EXTERNAL_AGENT_IMPORT: 'codex:external-agent-import',

  // Claude channels
  CLAUDE_GET_RATE_LIMITS: 'claude:get-rate-limits',

  // Third-party provider usage channels
  PROVIDER_GET_RATE_LIMITS: 'provider:get-rate-limits',
  ACP_GET_RATE_LIMITS: 'acp:get-rate-limits',

  // Agent channels
  SEND_MESSAGE: 'agent:send-message',
  DEQUEUE_MESSAGE: 'agent:dequeue-message',
  PREWARM: 'agent:prewarm',
  INTERRUPT: 'agent:interrupt',
  STOP_TASK: 'agent:stop-task',
  EVENT: 'agent:event',
  PERMISSION_RESPONSE: 'agent:permission-response',
  SET_PERMISSION_MODE: 'agent:set-permission-mode',
  SET_SANDBOX_MODE: 'agent:set-sandbox-mode',
  SANDBOX_PROBE: 'sandbox:probe',
  SET_SESSION_SETTINGS: 'agent:set-session-settings',
  SET_SESSION_API_PROVIDER: 'agent:set-session-api-provider',
  ANSWER_QUESTION: 'agent:answer-question',
  DISMISS_QUESTION: 'agent:dismiss-question',
  RESPOND_PLAN_APPROVAL: 'agent:respond-plan-approval',
  RESET_SESSION: 'agent:reset-session',
  /** Grok ACP manual `/recap` → `x.ai/recap` (auto=false). */
  REQUEST_SESSION_RECAP: 'agent:request-session-recap',
  CREATE_SESSION: 'agent:create-session',
  TRUNCATE_AT_CHECKPOINT: 'agent:truncate-at-checkpoint',
  REWIND_FILES: 'agent:rewind-files',
  REWIND_FILES_PREVIEW: 'agent:rewind-files-preview',
  REWIND_CODE_AND_CHAT: 'agent:rewind-code-and-chat',
  REWIND_CONVERSATION: 'agent:rewind-conversation',
  GET_SESSION_ID: 'agent:get-session-id',
  MCP_SERVER_STATUS: 'agent:mcp-server-status',
  MCP_SERVER_AUTHENTICATE: 'agent:mcp-server-authenticate',
  GET_CONTEXT_USAGE: 'agent:get-context-usage',
  LIST_DIRECTORY: 'agent:list-directory',
  LIST_DIRECTORY_FOR_ADD_DIR: 'agent:list-directory-for-add-dir',
  VALIDATE_ADD_DIR: 'agent:validate-add-dir',
  FIND_LINE_NUMBER: 'agent:find-line-number',
  SEARCH_FILES: 'agent:search-files',
  SEARCH_MENTIONS: 'agent:search-mentions',
  DISCONNECT_REMOTE_SESSION: 'agent:disconnect-remote-session',

  PLUGINS_RELOAD: 'plugins:reload',

  // Plugins
  PLUGINS_LIST: 'plugins:list',
  PLUGINS_READ: 'plugins:read',
  PLUGINS_READ_FILE: 'plugins:read-file',
  PLUGINS_DELETE: 'plugins:delete',
  PLUGINS_LIST_MARKETPLACE: 'plugins:list-marketplace',
  PLUGINS_INSTALL: 'plugins:install',
  PLUGINS_UPDATE: 'plugins:update',
  PLUGINS_UPDATE_MARKETPLACE: 'plugins:update-marketplace',
  PLUGINS_ADD_MARKETPLACE: 'plugins:add-marketplace',
  PLUGINS_REMOVE_MARKETPLACE: 'plugins:remove-marketplace',
  PLUGINS_READ_MARKETPLACE: 'plugins:read-marketplace',
  PLUGINS_READ_MARKETPLACE_FILE: 'plugins:read-marketplace-file',
  PLUGINS_GITHUB_STARS: 'plugins:github-stars',
  /** List/search public (or authenticated) GitHub repos under an owner. */
  PLUGINS_GITHUB_SEARCH_REPOS: 'plugins:github-search-repos',
  /** Free-text GitHub repository search (add-project name query). */
  PLUGINS_GITHUB_QUERY_REPOS: 'plugins:github-query-repos',
  /** Authenticated viewer's repos via `gh` (add-project default GitHub list). */
  PLUGINS_GITHUB_LIST_MY_REPOS: 'plugins:github-list-my-repos',

  // Skills
  SKILLS_LIST: 'skills:list',
  /** Project slash skills + commands (remote node or local discovery). */
  SLASH_RESOURCES_LIST: 'skills:slash-resources',
  SKILLS_READ: 'skills:read',
  SKILLS_READ_FILE: 'skills:read-file',
  SKILLS_INSTALL: 'skills:install',
  SKILLS_DELETE: 'skills:delete',
  SKILLS_TOGGLE: 'skills:toggle',

  // Codex skills
  CODEX_SKILLS_LIST: 'codex:skills-list',
  CODEX_SKILLS_READ: 'codex:skills-read',
  CODEX_SKILLS_READ_FILE: 'codex:skills-read-file',
  CODEX_SKILLS_DELETE: 'codex:skills-delete',
  CODEX_SKILLS_TOGGLE: 'codex:skills-toggle',

  // Codex hooks (read-only)
  CODEX_HOOKS_LIST: 'codex:hooks-list',
  CODEX_MCP_STATUS: 'codex:mcp-status',
  CODEX_MCP_RESOURCE_READ: 'codex:mcp-resource-read',
  CODEX_MCP_TOOL_CALL: 'codex:mcp-tool-call',

  // Codex skills change notification (push to renderer)
  CODEX_SKILLS_CHANGED: 'codex:skills-changed',

  // Codex goal
  CODEX_GOAL_GET: 'codex:goal-get',
  CODEX_GOAL_SET: 'codex:goal-set',
  CODEX_GOAL_CLEAR: 'codex:goal-clear',

  // Codex marketplace
  CODEX_MARKETPLACE_ADD: 'codex:marketplace-add',
  CODEX_MARKETPLACE_REMOVE: 'codex:marketplace-remove',
  CODEX_MARKETPLACE_UPGRADE: 'codex:marketplace-upgrade',

  // Codex plugins
  CODEX_PLUGINS_LIST: 'codex:plugins-list',
  CODEX_PLUGINS_READ: 'codex:plugins-read',
  CODEX_PLUGINS_READ_FILE: 'codex:plugins-read-file',
  CODEX_PLUGINS_DELETE: 'codex:plugins-delete',
  CODEX_PLUGINS_LIST_MARKETPLACE: 'codex:plugins-list-marketplace',
  CODEX_PLUGINS_INSTALL: 'codex:plugins-install',

  // Codex MCP config
  CODEX_MCP_LIST_CONFIG: 'codex:mcp-list-config',
  CODEX_MCP_SAVE_CONFIG: 'codex:mcp-save-config',
  CODEX_MCP_DELETE_CONFIG: 'codex:mcp-delete-config',
  CODEX_MCP_TOGGLE_CONFIG: 'codex:mcp-toggle-config',

  // MCP config
  MCP_LIST_CONFIG: 'mcp:list-config',
  MCP_SAVE_CONFIG: 'mcp:save-config',
  MCP_DELETE_CONFIG: 'mcp:delete-config',
  MCP_TOGGLE_CONFIG: 'mcp:toggle-config',
  MCP_CHECK_SERVERS: 'mcp:check-servers',
  MCP_META_CACHE: 'mcp:meta-cache',
  MCP_OAUTH_AUTHORIZE: 'mcp:oauth-authorize',

  // MCP library
  MCP_LIST_LIBRARY: 'mcp:list-library',
  MCP_DELETE_LIBRARY_ENTRY: 'mcp:delete-library-entry',

  // MCP bundles (.mcpb)
  MCPB_PREVIEW: 'mcpb:preview',
  MCPB_INSTALL: 'mcpb:install',
  MCPB_UNINSTALL: 'mcpb:uninstall',
  MCPB_LIST: 'mcpb:list',
  MCPB_REVEAL: 'mcpb:reveal',

  // Hooks config (settings.json#hooks)
  HOOKS_LIST: 'hooks:list',
  HOOKS_SAVE: 'hooks:save',
  HOOKS_DELETE: 'hooks:delete',

  CLAUDE_PROJECT_PREFERENCES_GET: 'claude:project-preferences-get',
  CLAUDE_PROJECT_PREFERENCES_SAVE: 'claude:project-preferences-save',

  // Agents
  AGENTS_LIST: 'agents:list',
  AGENTS_READ_FILE: 'agents:read-file',

  // Git
  GIT_INFO: 'app:git-info',
  GIT_IS_REPO: 'app:git-is-repo',
  GIT_INIT: 'app:git-init',
  GIT_LIST_BRANCHES: 'app:git-list-branches',
  GIT_SWITCH_BRANCH: 'app:git-switch-branch',
  GIT_CREATE_BRANCH: 'app:git-create-branch',
  PATH_EXISTS: 'app:path-exists',
  GIT_WORKTREE_INFO: 'app:git-worktree-info',
  GIT_ACTIVATE_WORKTREE: 'app:git-activate-worktree',
  GIT_SWITCH_WORKTREE: 'app:git-switch-worktree',
  GIT_CHECKED_OUT_BRANCHES: 'app:git-checked-out-branches',
  GIT_HANDOFF_TO_LOCAL: 'app:git-handoff-to-local',
  GIT_HANDOFF_PREVIEW: 'app:git-handoff-preview',
  GIT_ASSIGN_BRANCH: 'app:git-assign-branch',
  GIT_STATUS_FILES: 'app:git-status-files',
  GIT_LOG: 'app:git-log',
  GIT_FILE_TREE: 'app:git-file-tree',
  GIT_LIST_DIR: 'app:git-list-dir',
  FILE_MOVE: 'app:file-move',
  FILE_COPY_IN: 'app:file-copy-in',
  FILE_MOVE_IN: 'app:file-move-in',
  FILE_DELETE: 'app:file-delete',
  FILE_RENAME: 'app:file-rename',
  FILE_SHOW_IN_FOLDER: 'app:file-show-in-folder',
  SHOW_CONTEXT_MENU: 'app:show-context-menu',
  START_DRAG: 'app:start-drag',
  PATH_STAT: 'app:path-stat',
  MEDIA_SERVER_PORT: 'app:media-server-port',
  CONTENT_ZOOM: 'app:content-zoom',
  BROWSER_ANNOTATE_SHORTCUT: 'app:browser-annotate-shortcut',
  BROWSER_BOOKMARK_SHORTCUT: 'app:browser-bookmark-shortcut',
  BROWSER_NEW_TAB_SHORTCUT: 'app:browser-new-tab-shortcut',
  BROWSER_OPEN_TAB: 'app:browser-open-tab',
  CLOSE_TAB_SHORTCUT: 'app:close-tab-shortcut',
  CLOSE_WINDOW: 'app:close-window',
  GET_FULLSCREEN: 'app:get-fullscreen',
  FULLSCREEN_CHANGED: 'app:fullscreen-changed',
  SET_MIN_WINDOW_SIZE: 'app:set-min-window-size',
  OPEN_SESSION_WINDOW: 'app:open-session-window',
  DRAG_PREVIEW_START: 'app:drag-preview-start',
  DRAG_PREVIEW_END: 'app:drag-preview-end',
  DRAG_PREVIEW_UPDATE: 'app:drag-preview-update',
  DRAG_PREVIEW_ZONE: 'app:drag-preview-zone',
  SET_WINDOW_ALWAYS_ON_TOP: 'app:set-window-always-on-top',
  GET_THEME: 'app:get-theme',
  SET_THEME: 'app:set-theme',
  THEME_CHANGED: 'app:theme-changed',
  BROADCAST_SESSION_SETTING: 'agent:broadcast-session-setting',
  RECENT_FOLDERS_CHANGED: 'app:recent-folders-changed',
  OPEN_EXTERNAL_LINK: 'app:open-external-link',
  CLIPBOARD_READ: 'app:clipboard-read',
  CLIPBOARD_WRITE: 'app:clipboard-write',
  GIT_DIFF_FILE: 'app:git-diff-file',
  READ_PROJECT_FILE: 'app:read-project-file',
  SAVE_FILE: 'app:save-file',
  READ_FILE_AS_DATA_URI: 'app:read-file-as-data-uri',
  SAVE_FILE_AS: 'app:save-file-as',
  CLIPBOARD_WRITE_IMAGE: 'app:clipboard-write-image',
  BROWSER_FETCH_IMAGE: 'app:browser-fetch-image',
  BROWSER_SAVE_IMAGE: 'app:browser-save-image',
  BROWSER_COPY_IMAGE_AT: 'app:browser-copy-image-at',
  REVEAL_FILE: 'app:reveal-file',

  // Concurrent session management
  PARK_SESSION: 'agent:park-session',
  ACTIVATE_SESSION: 'agent:activate-session',
  SET_SESSION_FOREGROUND: 'agent:set-session-foreground',

  // Live session snapshots for renderer resync
  GET_LIVE_SNAPSHOTS: 'agent:get-live-snapshots',

  // Session history
  SESSIONS_LIST: 'sessions:list',
  SESSIONS_LIST_FOR_FOLDER: 'sessions:list-for-folder',
  SESSIONS_LIST_FOR_FOLDER_PAGE: 'sessions:list-for-folder-page',
  SESSIONS_RESUME: 'sessions:resume',
  SESSIONS_LOAD_MESSAGES: 'sessions:load-messages',
  SESSIONS_RENAME: 'sessions:rename',
  SESSIONS_CREATE: 'sessions:create',
  SESSIONS_FORK: 'sessions:fork',
  SESSIONS_SAVE_STATE: 'sessions:save-state',
  SESSIONS_LOAD_STATE: 'sessions:load-state',
  SESSIONS_DELETE: 'sessions:delete',
  SESSIONS_DELETE_OLDER: 'sessions:delete-older',
  SESSIONS_PIN: 'sessions:pin',
  SESSIONS_HIDE: 'sessions:hide',
  SESSIONS_LIST_PINNED: 'sessions:list-pinned',
  SESSIONS_CHANGED: 'sessions:changed',

  // Additional directories
  READ_PROJECT_ADDITIONAL_DIRS: 'agent:read-project-additional-dirs',
  ADD_PROJECT_ADDITIONAL_DIR: 'agent:add-project-additional-dir',
  REMOVE_PROJECT_ADDITIONAL_DIR: 'agent:remove-project-additional-dir',

  // Settings
  SET_FAST_MODE: 'app:set-fast-mode',
  APP_SETTINGS_GET: 'app:settings-get',
  APP_SETTINGS_SAVE: 'app:settings-save',
  APP_SETTINGS_CHANGED: 'app:settings-changed',
  /** Stable per-installation id used as the analytics distinct id. */
  APP_INSTALL_ID_GET: 'app:install-id-get',
  /**
   * Read Computer Use TCC status / open permission float.
   * false — status only
   * true | 'guided' — two-step onboarding float
   * 'accessibility' | 'screenRecording' — single-pane float
   */
  COMPUTER_USE_OPEN_PERMISSIONS: 'computer-use:open-permissions',
  /** Restart helper once and re-read TCC / runtime permission status. */
  COMPUTER_USE_RECHECK_PERMISSIONS: 'computer-use:recheck-permissions',
  /** Dismiss the Computer Use permission drag float. */
  COMPUTER_USE_CLOSE_PERMISSION_FLOAT: 'computer-use:close-permission-float',
  /** Resize the permission float to match measured content size. */
  COMPUTER_USE_RESIZE_PERMISSION_FLOAT: 'computer-use:resize-permission-float',
  /** Push live permission status into the drag float. */
  COMPUTER_USE_PERMISSION_STATUS: 'computer-use:permission-status',
  /** Guided float: continue from Accessibility to Screen Recording. */
  COMPUTER_USE_CONTINUE_PERMISSION_STEP: 'computer-use:continue-permission-step',
  /** List currently running apps (for Computer Use always-allow picker). */
  COMPUTER_USE_LIST_RUNNING_APPS: 'computer-use:list-running-apps',
  /** Installed desktop apps catalog (mention popup / search). */
  COMPUTER_USE_LIST_INSTALLED_APPS: 'computer-use:list-installed-apps',
  /** Session-scoped temporary grants from @ desktop-app mentions. */
  COMPUTER_USE_GRANT_SESSION_APPS: 'computer-use:grant-session-apps',
  /** Best-effort app icon data URI for a bundle id (UI only; cached in main). */
  COMPUTER_USE_RESOLVE_APP_ICON: 'computer-use:resolve-app-icon',
  BROWSER_HISTORY_RECORD: 'app:browser-history-record',
  BROWSER_HISTORY_SUGGEST: 'app:browser-history-suggest',
  BROWSER_HISTORY_DELETE: 'app:browser-history-delete',
  BROWSER_CERT_ERROR: 'app:browser-cert-error',
  BROWSER_CERT_PROCEED: 'app:browser-cert-proceed',
  APP_SYSTEM_LOCALE: 'app:system-locale',
  APP_LOCALE_CHANGED: 'app:locale-changed',
  APP_ICON_PICK_FILE: 'app:icon-pick-file',
  APP_ICON_SET: 'app:icon-set',
  APP_ICON_RESET: 'app:icon-reset',

  // Usage statistics
  USAGE_QUERY: 'app:usage:query',
  USAGE_COUNTS_QUERY: 'app:usage:counts',
  USAGE_HARNESS_SESSION_RANKS: 'app:usage:harness-session-ranks',
  USAGE_BACKFILL_STATUS: 'app:usage:backfill-status',
  USAGE_BACKFILL_DONE: 'app:usage:backfill-done',

  // Logging
  GET_LOG_PATH: 'app:get-log-path',
  TRACE: 'app:trace',

  // Updater
  UPDATER_EVENT: 'updater:event',
  UPDATER_INSTALL: 'updater:install',
  UPDATER_CHECK: 'updater:check',
  UPDATER_DOWNLOAD: 'updater:download',
  UPDATER_SIMULATE: 'updater:simulate',

  // File watcher
  FILE_WATCH_START: 'app:file-watch-start',
  FILE_WATCH_STOP: 'app:file-watch-stop',
  FILE_CHANGE_EVENT: 'app:file-change-event',
  GIT_HEAD_CHANGE: 'app:git-head-change',

  // Unified AI provider platform (registry + credentials + bindings)
  PLATFORMS_LIST: 'platforms:list',
  PLATFORMS_CREATE_CUSTOM: 'platforms:create-custom',
  PLATFORMS_UPDATE_CUSTOM: 'platforms:update-custom',
  PLATFORMS_DELETE_CUSTOM: 'platforms:delete-custom',
  CREDENTIALS_LIST: 'credentials:list',
  CREDENTIALS_CREATE: 'credentials:create',
  CREDENTIALS_UPDATE: 'credentials:update',
  CREDENTIALS_DELETE: 'credentials:delete',
  BINDINGS_GET: 'bindings:get',
  BINDINGS_SET: 'bindings:set',
  BINDINGS_CLEAR: 'bindings:clear',
  PROVIDERS_TEST_ENDPOINT: 'providers:test-endpoint',
  PROVIDERS_DISCOVER_MODELS: 'providers:discover-models',
  ACP_LIST_AGENTS: 'acp:list-agents',
  /** Refresh ACP agent model catalogs once per app open (uses cache thereafter). */
  ACP_REFRESH_MODELS: 'acp:refresh-models',
  /** Report unsaved editor buffer content for ACP fs/read_text_file. */
  ACP_SET_UNSAVED_BUFFER: 'acp:set-unsaved-buffer',

  // Media generation providers (read-only status derived from image-serving credentials)
  MEDIA_GEN_PROVIDERS: 'mediaGen:providers',

  // Model catalog (models.dev, local-cached)
  MODEL_CATALOG_GET: 'modelCatalog:get',
  MODEL_CATALOG_REFRESH: 'modelCatalog:refresh',

  // Session Providers (new session_providers table)
  SESSION_PROVIDERS_LIST: 'sessionProviders:list',
  SESSION_PROVIDERS_LIST_BY_HARNESS: 'sessionProviders:list-by-harness',
  SESSION_PROVIDERS_GET: 'sessionProviders:get',
  SESSION_PROVIDERS_GET_BASE: 'sessionProviders:get-base',
  SESSION_PROVIDERS_CREATE: 'sessionProviders:create',
  SESSION_PROVIDERS_UPDATE: 'sessionProviders:update',
  SESSION_PROVIDERS_DELETE: 'sessionProviders:delete',

  // Bash output watcher
  BASH_OUTPUT_WATCH: 'app:bash-output-watch',
  BASH_OUTPUT_UNWATCH: 'app:bash-output-unwatch',
  BASH_OUTPUT_EVENT: 'app:bash-output-event',
  BASH_OUTPUT_READ_MORE: 'app:bash-output-read-more',
  BASH_OUTPUT_READ_FILE: 'app:bash-output-read-file',

  // Workflow subagent transcripts
  LIST_WORKFLOW_AGENTS: 'app:list-workflow-agents',
  READ_WORKFLOW_OUTPUT: 'app:read-workflow-output',
  READ_WORKFLOW_SCRIPT: 'app:read-workflow-script',
  /** Scan project + user `.grok/workflows/*.rhai` with parsed args. */
  DISCOVER_GROK_WORKFLOWS: 'app:discover-grok-workflows',
  READ_SUBAGENT_TRANSCRIPT: 'app:read-subagent-transcript',

  // Remote control
  REMOTE_COMMAND: 'remote:command',
  REMOTE_CLIENT_REGISTERED: 'remote:client-registered',
  REMOTE_LIST_PAIRED: 'remote:list-paired',
  REMOTE_REMOVE_PAIRED: 'remote:remove-paired',
  REMOTE_DEVICE_STATUS_CHANGED: 'remote:device-status-changed',
  REMOTE_UPLOAD_PROGRESS: 'remote:upload-progress',
  REMOTE_START_PAIRING: 'remote:start-pairing',
  REMOTE_CONFIRM_PAIRING: 'remote:confirm-pairing',
  REMOTE_CANCEL_PAIRING: 'remote:cancel-pairing',
  REMOTE_PAIRING_CODE_RECEIVED: 'remote:pairing-code-received',
  REMOTE_PAIRING_EXPIRED: 'remote:pairing-expired',
  REMOTE_PAIRING_ALREADY_PAIRED: 'remote:pairing-already-paired',
  REMOTE_GET_RELAY_STATUS: 'remote:get-relay-status',
  REMOTE_GET_LAN_STATUS: 'remote:get-lan-status',
  REMOTE_GET_HOSTNAME: 'remote:get-hostname',
  REMOTE_GET_CONFIG: 'remote:get-config',
  REMOTE_SAVE_CONFIG: 'remote:save-config',
  REMOTE_RELAY_STATUS: 'remote:relay-status',
  REMOTE_LAN_STATUS: 'remote:lan-status',

  WIDGET_IFRAME_READY: 'widget:iframe-ready',
  WIDGET_SAVE_TEMPLATE: 'widget:save-template',

  // Mini-App
  MINIAPP_LIST: 'miniapp:list',
  MINIAPP_OPEN: 'miniapp:open',
  MINIAPP_CLOSE: 'miniapp:close',
  MINIAPP_AUTHORIZE: 'miniapp:authorize',
  MINIAPP_UNAUTHORIZE: 'miniapp:unauthorize',
  MINIAPP_LAZY_OPEN_REQUEST: 'miniapp:lazy-open-request',
  MINIAPP_TOOL_CALL: 'miniapp:tool-call',
  MINIAPP_TOOL_RESULT: 'miniapp:tool-result',
  BROWSER_AUTOMATION_CALL: 'browser:automation-call',
  BROWSER_AUTOMATION_RESULT: 'browser:automation-result',
  MINIAPP_TOOL_INTERCEPT_OPEN: 'miniapp:tool-intercept-open',
  MINIAPP_TOOL_INTERCEPT_SUBMIT: 'miniapp:tool-intercept-submit',
  MINIAPP_TOOL_INTERCEPT_CANCEL: 'miniapp:tool-intercept-cancel',
  MINIAPP_TOOL_INTERCEPT_CLEAR: 'miniapp:tool-intercept-clear',
  MINIAPP_FS_REQUEST: 'miniapp:fs-request',
  MINIAPP_FS_WATCH: 'miniapp:fs-watch',
  MINIAPP_FS_UNWATCH: 'miniapp:fs-unwatch',
  MINIAPP_FS_WATCH_EVENT: 'miniapp:fs-watch-event',
  MINIAPP_GIT_REQUEST: 'miniapp:git-request',
  MINIAPP_GIT_HEAD_CHANGE: 'miniapp:git-head-change',
  MINIAPP_DB_REQUEST: 'miniapp:db-request',
  MINIAPP_KV_REQUEST: 'miniapp:kv-request',
  MINIAPP_PEER_EMIT: 'miniapp:peer-emit',
  MINIAPP_START_DRAG: 'miniapp:start-drag',
  MINIAPP_IFRAME_READY: 'miniapp:iframe-ready',
  MINIAPP_GET_PRELOAD_PATH: 'miniapp:get-preload-path',
  MINIAPP_DETECT_DEV: 'miniapp:detect-dev',
  MINIAPP_PREVIEW: 'miniapp:preview',
  MINIAPP_CONFIRM_INSTALL: 'miniapp:confirm-install',
  MINIAPP_CANCEL_INSTALL: 'miniapp:cancel-install',
  MINIAPP_UNINSTALL: 'miniapp:uninstall',
  MINIAPP_PACK: 'miniapp:pack',
  MINIAPP_GET_INSTALL_META: 'miniapp:get-install-meta',
  MINIAPP_GET_PREAPPROVED: 'miniapp:get-preapproved',
  MINIAPP_SET_PREAPPROVED: 'miniapp:set-preapproved',
  MINIAPP_DEV_APP_READY: 'miniapp:dev-app-ready',
  MINIAPP_DEV_REGISTRY_LIST: 'miniapp:dev-registry:list',
  MINIAPP_DEV_REGISTRY_ADD: 'miniapp:dev-registry:add',
  MINIAPP_DEV_REGISTRY_REMOVE: 'miniapp:dev-registry:remove',
  MINIAPP_DEV_REGISTRY_INSTALL: 'miniapp:dev-registry:install',
  MINIAPP_DEV_REGISTRY_UNINSTALL: 'miniapp:dev-registry:uninstall',
  MINIAPP_DEV_REGISTRY_SET_ENABLED: 'miniapp:dev-registry:set-enabled',
  MINIAPP_DEV_REGISTRY_REVEAL_SOURCE: 'miniapp:dev-registry:reveal-source',
  MINIAPP_WORKER_START: 'miniapp:worker-start',
  MINIAPP_WORKER_STOP: 'miniapp:worker-stop',
  MINIAPP_WORKER_STATUS: 'miniapp:worker-status',
  MINIAPP_WORKER_SEND: 'miniapp:worker-send',
  MINIAPP_WORKER_EVENT: 'miniapp:worker-event',
  MINIAPP_WORKER_LIST: 'miniapp:worker-list',
  MINIAPP_WORKER_STATE: 'miniapp:worker-state',

  // Automations
  AUTOMATIONS_LIST: 'automations:list',
  AUTOMATIONS_CREATE: 'automations:create',
  AUTOMATIONS_UPDATE: 'automations:update',
  AUTOMATIONS_DELETE: 'automations:delete',
  AUTOMATIONS_RUN_NOW: 'automations:run-now',
  /** Run lifecycle (running/completed/error) for a single automation. */
  AUTOMATIONS_EVENT: 'automations:event',
  /** List mutation (create/update/delete) — renderer should re-list. Optional projectPath scopes refresh. */
  AUTOMATIONS_CHANGED: 'automations:changed',

  // Terminal
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_LIST: 'terminal:list',
  TERMINAL_SNAPSHOT: 'terminal:snapshot',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_KILL: 'terminal:kill',
  TERMINAL_CLAIM: 'terminal:claim',
  TERMINAL_RELEASE: 'terminal:release',
  TERMINAL_EVENT: 'terminal:event',

  // Multi-environment / remote node (Main environment host)
  ENVIRONMENT_LIST: 'environment:list',
  ENVIRONMENT_GET_LOCAL_ID: 'environment:getLocalId',
  ENVIRONMENT_WORKSPACE_LIST_DIR: 'environment:workspaceListDir',
  ENVIRONMENT_WORKSPACE_READ_FILE: 'environment:workspaceReadFile',
  /** Remote tool-output / agent-transcript byte-offset tail watch. */
  ENVIRONMENT_WORKSPACE_TAIL_WATCH_START: 'environment:workspaceTailWatchStart',
  ENVIRONMENT_WORKSPACE_TAIL_WATCH_POLL: 'environment:workspaceTailWatchPoll',
  ENVIRONMENT_WORKSPACE_TAIL_WATCH_STOP: 'environment:workspaceTailWatchStop',
  ENVIRONMENT_PAIR_REMOTE: 'environment:pairRemote',
  ENVIRONMENT_CONNECT_FAILOVER: 'environment:connectWithFailover',
  /** Dev-only: probe local remote-node lab (`bun run dev:cli:lab`). */
  ENVIRONMENT_LOCAL_LAB_STATUS: 'environment:localLabStatus',
  /** Dev-only: mint pairing token + pair/connect to local lab. */
  ENVIRONMENT_PAIR_LOCAL_LAB: 'environment:pairLocalLab',
  // Environment management UI (Settings → Environments)
  ENVIRONMENT_LIST_ITEMS: 'environment:listItems',
  ENVIRONMENT_ADD_OVER_SSH: 'environment:addOverSsh',
  /** Install this desktop's CLI on an already-paired node and restart it. */
  ENVIRONMENT_UPGRADE_NODE: 'environment:upgradeNode',
  /** Read local ~/.ssh/config Host aliases for the add-device picker. */
  ENVIRONMENT_LIST_SSH_CONFIG_HOSTS: 'environment:listSshConfigHosts',
  /** Projects for a host (`local` or remote connectionId) — sidebar project list. */
  ENVIRONMENT_LIST_PROJECTS: 'environment:listProjects',
  /** Open/register a project path on a host (local disk or remote project.open). */
  ENVIRONMENT_OPEN_PROJECT: 'environment:openProject',
  /** Unregister a project from a host list (local recents or remote project.remove). */
  ENVIRONMENT_REMOVE_PROJECT: 'environment:removeProject',
  /** List sessions for a remote project (local uses sessions:* DB IPC). */
  ENVIRONMENT_LIST_SESSIONS: 'environment:listSessions',
  /** Unsent composer drafts, stored in the environment that owns the project. */
  ENVIRONMENT_LIST_DRAFTS: 'environment:listDrafts',
  ENVIRONMENT_UPSERT_DRAFT: 'environment:upsertDraft',
  ENVIRONMENT_DELETE_DRAFT: 'environment:deleteDraft',
  /** Create a session on a remote project (local uses agent:create-session). */
  ENVIRONMENT_CREATE_SESSION: 'environment:createSession',
  ENVIRONMENT_GET_SESSION: 'environment:getSession',
  ENVIRONMENT_SEND_SESSION_MESSAGE: 'environment:sendSessionMessage',
  /** Poll durable node session.events after a sequence (exclusive). */
  ENVIRONMENT_LIST_SESSION_EVENTS: 'environment:listSessionEvents',
  /** Paged denser message catalog (session.messages.list) for remote UI hydrate. */
  ENVIRONMENT_LIST_SESSION_MESSAGES: 'environment:listSessionMessages',
  ENVIRONMENT_INTERRUPT_SESSION: 'environment:interruptSession',
  ENVIRONMENT_RENAME_SESSION: 'environment:renameSession',
  ENVIRONMENT_REMOVE_SESSION: 'environment:removeSession',
  ENVIRONMENT_SET_SESSION_UI_FLAGS: 'environment:setSessionUiFlags',
  ENVIRONMENT_FORK_SESSION: 'environment:forkSession',
  ENVIRONMENT_RESPOND_SESSION_PERMISSION: 'environment:respondSessionPermission',
  ENVIRONMENT_RESPOND_SESSION_QUESTION: 'environment:respondSessionQuestion',
  ENVIRONMENT_RESPOND_SESSION_PLAN: 'environment:respondSessionPlan',
  ENVIRONMENT_RESUME_REMOTE_SESSION_EVENTS: 'environment:resumeRemoteSessionEvents',
  /** List directories at an absolute path for the add-project browser. */
  ENVIRONMENT_BROWSE_PATH: 'environment:browsePath',
  /** Clone a git repository onto a host and register it as a project. */
  ENVIRONMENT_CLONE_REPOSITORY: 'environment:cloneRepository',
  ENVIRONMENT_CONNECT: 'environment:connect',
  ENVIRONMENT_DISCONNECT: 'environment:disconnect',
  ENVIRONMENT_FORGET: 'environment:forget',
  /** Explicit transient retry (does not unblock auth). */
  ENVIRONMENT_RETRY_NOW: 'environment:retryNow',
  /** Re-pair existing connectionId with a new pairing token (identity-safe). */
  ENVIRONMENT_REPAIR_PAIRING: 'environment:repairPairing',
  /** Re-pair over the stored SSH endpoint; the desktop mints the token itself. */
  ENVIRONMENT_REPAIR_PAIRING_SSH: 'environment:repairPairingOverSsh',
  /** Main → renderer supervisor state push. */
  ENVIRONMENT_STATUS_EVENT: 'environment:statusEvent',
  /** Main → renderer SSH probe/install progress push. */
  ENVIRONMENT_INSTALL_PROGRESS: 'environment:installProgress',
  /** Node-local AI provider credentials (masked). */
  ENVIRONMENT_PROVIDER_LIST_CREDENTIALS: 'environment:providerListCredentials',
  ENVIRONMENT_PROVIDER_CREATE_CREDENTIAL: 'environment:providerCreateCredential',
  ENVIRONMENT_PROVIDER_UPDATE_CREDENTIAL: 'environment:providerUpdateCredential',
  ENVIRONMENT_PROVIDER_DELETE_CREDENTIAL: 'environment:providerDeleteCredential',
  ENVIRONMENT_PROVIDER_LIST_BINDINGS: 'environment:providerListBindings',
  ENVIRONMENT_PROVIDER_SET_BINDING: 'environment:providerSetBinding',
  ENVIRONMENT_PROVIDER_CLEAR_BINDING: 'environment:providerClearBinding',
  ENVIRONMENT_PROVIDER_LIST_CUSTOM_PLATFORMS: 'environment:providerListCustomPlatforms',
  ENVIRONMENT_PROVIDER_UPSERT_CUSTOM_PLATFORM: 'environment:providerUpsertCustomPlatform',
  ENVIRONMENT_PROVIDER_DELETE_CUSTOM_PLATFORM: 'environment:providerDeleteCustomPlatform',
  /** Push desktop credentials → node (Main builds plaintext bundle; renderer never sees secrets). */
  ENVIRONMENT_PROVIDER_PUSH_LOCAL: 'environment:providerPushLocal',
  /** Pull node credentials → desktop (admin). */
  ENVIRONMENT_PROVIDER_PULL_REMOTE: 'environment:providerPullRemote',
  ENVIRONMENT_PROVIDER_LIST_MODELS: 'environment:providerListModels',
  /** Remote node harness catalog (node:admin). */
  ENVIRONMENT_HARNESS_LIST: 'environment:harnessList',
  ENVIRONMENT_HARNESS_ENABLE: 'environment:harnessEnable',
  ENVIRONMENT_HARNESS_DISABLE: 'environment:harnessDisable',
  ENVIRONMENT_HARNESS_PROBE: 'environment:harnessProbe',

  // Local desktop harness installation catalog (Settings → Harnesses)
  HARNESS_LIST: 'harness:list',
  HARNESS_ENABLE: 'harness:enable',
  HARNESS_DISABLE: 'harness:disable',
  HARNESS_PROBE: 'harness:probe',
  HARNESS_ENSURE: 'harness:ensure',
  /** Main → renderer progress while downloading/extracting a managed runtime. */
  HARNESS_INSTALL_PROGRESS: 'harness:installProgress',
  /** Onboarding: scan PATH for first-party harness CLIs. */
  HARNESS_SCAN_CLI: 'harness:scanCli',
  /**
   * Startup fallback: ensure every enabled managed harness matches the app pin.
   * Progress via HARNESS_INSTALL_PROGRESS. Happy path pre-fetches during update.
   */
  HARNESS_ALIGN_ENABLED: 'harness:alignEnabled',
  /** True when any enabled managed harness is not pin-aligned (skip gate UI if false). */
  HARNESS_NEEDS_ALIGN: 'harness:needsAlign',
  /** Retry harness pre-fetch after a failed atomic update package. */
  UPDATER_RETRY_HARNESS: 'updater:retryHarness',
  /** Remote Skills / MCP via node `skills.*` / `mcp.*` (EnvironmentHost). */
  ENVIRONMENT_LIST_REMOTE_SKILLS: 'environment:listRemoteSkills',
  ENVIRONMENT_GET_REMOTE_SKILL: 'environment:getRemoteSkill',
  ENVIRONMENT_READ_REMOTE_SKILL_FILE: 'environment:readRemoteSkillFile',
  ENVIRONMENT_DELETE_REMOTE_SKILL: 'environment:deleteRemoteSkill',
  ENVIRONMENT_INSTALL_REMOTE_SKILL: 'environment:installRemoteSkill',
  ENVIRONMENT_LIST_REMOTE_MCP_CONFIGS: 'environment:listRemoteMcpConfigs',
  ENVIRONMENT_SAVE_REMOTE_MCP_CONFIG: 'environment:saveRemoteMcpConfig',
  ENVIRONMENT_TOGGLE_REMOTE_MCP_CONFIG: 'environment:toggleRemoteMcpConfig',
  ENVIRONMENT_DELETE_REMOTE_MCP_CONFIG: 'environment:deleteRemoteMcpConfig',
  /** Node harness.resources aggregate (models + skills/commands/agents/prompts). */
  ENVIRONMENT_HARNESS_RESOURCES: 'environment:harnessResources',
  /** Node session_providers CRUD. */
  ENVIRONMENT_SESSION_PROVIDERS_LIST: 'environment:sessionProvidersList',
  ENVIRONMENT_SESSION_PROVIDERS_GET: 'environment:sessionProvidersGet',
  ENVIRONMENT_SESSION_PROVIDERS_GET_BASE: 'environment:sessionProvidersGetBase',
  ENVIRONMENT_SESSION_PROVIDERS_CREATE: 'environment:sessionProvidersCreate',
  ENVIRONMENT_SESSION_PROVIDERS_UPDATE: 'environment:sessionProvidersUpdate',
  ENVIRONMENT_SESSION_PROVIDERS_DELETE: 'environment:sessionProvidersDelete',
} as const

export interface NativeContextMenuItemSpec {
  id?: string
  label?: string
  type?: 'normal' | 'separator' | 'submenu'
  enabled?: boolean
  iconDataUrl?: string
  submenu?: NativeContextMenuItemSpec[]
}

export interface FileSearchResult {
  path: string
  isDirectory: boolean
  matchIndices: number[]
  score: number
  rootPath?: string
}

export type MentionSearchItem =
  | { kind: 'file'; path: string; isDirectory: boolean; matchIndices: number[]; score: number; rootPath?: string }
  | { kind: 'agent'; name: string; model: string; matchIndices: number[]; score: number }

export type TerminalStatus = 'running' | 'exited' | 'error'

export interface TerminalSnapshot {
  terminalId: string
  cwd: string
  title: string
  status: TerminalStatus
  cols: number
  rows: number
  lastSeq: number
  ownerDeviceId: string | null
  writableByMe: boolean
  subscriberCount: number
}

export interface TerminalListItem {
  terminalId: string
  cwd: string
  title: string
  status: TerminalStatus
  ownerDeviceId: string | null
}

export type TerminalErrorCode = 'not_owner' | 'no_terminal' | 'spawn_failed' | 'cwd_invalid'
export type TerminalCommandResultCode = 'not_owner' | 'already_claimed' | 'no_terminal'

export type TerminalEvent =
  | { type: 'terminal_snapshot'; terminalId: string; snapshot: TerminalSnapshot; ansi: string }
  | { type: 'terminal_snapshot_chunk'; terminalId: string; snapshotId: string; index: number; total: number; ansi: string; snapshot?: TerminalSnapshot }
  | { type: 'terminal_output'; terminalId: string; data: string; fromSeq: number; toSeq: number; createdAt: number }
  | { type: 'terminal_owner_changed'; terminalId: string; ownerDeviceId: string | null; writableByMe: boolean }
  | { type: 'terminal_command_result'; requestId: string; ok: boolean; terminalId?: string; code?: TerminalCommandResultCode; message?: string }
  | { type: 'terminal_exited'; terminalId: string; exitCode: number | null; signal: number | null }
  | { type: 'terminal_error'; terminalId: string; code: TerminalErrorCode; message: string }

export type RemoteCommand =
  | { type: 'create_session'; requestId: string; sessionId: string; projectPath: string; provider?: HarnessId; permissionMode?: string; effort?: string; model?: string; gitBranch?: string; worktreePath?: string; worktreeBranch?: string; worktreeMode?: WorktreeMode; worktreeBranchName?: string; worktreeCarryLocalChanges?: boolean; additionalDirectories?: string[] }
  | { type: 'send_message'; sessionId: string; projectPath: string; content: string; provider?: HarnessId; model?: string; effort?: string; images?: ImageAttachment[]; permissionPreset?: string; collaborationMode?: string; threadId?: string; clientMessageId?: string; priority?: 'now' | 'next' | 'later' }
  | { type: 'dequeue_message'; clientMessageId: string; projectPath?: string; sessionId: string }
  | { type: 'interrupt'; projectPath?: string; sessionId: string }
  | { type: 'respond_permission'; requestId: string; decision: boolean; reason?: string; selectedSuggestions?: number[]; projectPath?: string; sessionId: string }
  | { type: 'answer_question'; requestId: string; answers: Record<string, string>; annotations?: QuestionAnnotations; projectPath?: string; sessionId: string }
  | { type: 'dismiss_question'; requestId: string; projectPath?: string; sessionId: string }
  | { type: 'respond_plan_approval'; requestId: string; approved: boolean; feedback?: string; projectPath?: string; sessionId: string }
  | { type: 'codex_plan_approval'; messageId: string; status: 'approved' | 'rejected'; feedback?: string; projectPath?: string; sessionId: string }
  | { type: 'subscribe_session'; projectPath: string; sessionId: string; requestId?: string }
  | { type: 'unsubscribe_session'; sessionId?: string }
  | { type: 'leave_session'; sessionId: string }
  | { type: 'load_session_messages'; requestId: string; projectPath: string; sessionId: string; limit?: number; cursor?: number }
  | { type: 'set_permission_mode'; mode: string; projectPath?: string; sessionId: string }
  | { type: 'list_directory'; requestId: string; path: string; showHidden?: boolean }
  | { type: 'create_directory'; requestId: string; path: string; name: string }
  | { type: 'add_project'; requestId: string; path: string }
  | { type: 'list_projects'; requestId: string }
  | { type: 'list_sessions'; requestId: string; projectPath: string; limit?: number; offset?: number }
  | { type: 'list_models'; requestId: string; projectPath: string }
  | { type: 'get_system_info'; requestId: string; projectPath: string; provider: HarnessId }
  | { type: 'get_project_resources'; requestId: string; projectPath: string; provider: HarnessId }
  | { type: 'get_git_info'; requestId: string; projectPath: string }
  | { type: 'get_git_branches'; requestId: string; projectPath: string }
  | { type: 'switch_git_branch'; requestId: string; projectPath: string; branch: string }
  | { type: 'create_git_branch'; requestId: string; projectPath: string; branch: string }
  | { type: 'get_worktree_info'; requestId: string; projectPath: string }
  | { type: 'get_checked_out_branches'; requestId: string; projectPath: string }
  | { type: 'activate_worktree'; requestId: string; projectPath: string; baseBranch: string | null; mode?: WorktreeMode; branchName?: string; carryLocalChanges?: boolean }
  | { type: 'search_mentions'; requestId: string; projectPath: string; query: string }
  | { type: 'get_session_state'; requestId: string; projectPath: string; sessionId: string }
  | { type: 'list_directory_for_add_dir'; requestId: string; projectPath: string; rawInput: string }
  | { type: 'validate_add_dir'; requestId: string; projectPath: string; candidate: string }
  | { type: 'add_project_additional_dir'; requestId: string; projectPath: string; dir: string }
  | { type: 'remove_project_additional_dir'; requestId: string; projectPath: string; dir: string }
  | { type: 'set_session_additional_dirs'; requestId: string; projectPath: string; sessionId: string; dirs: string[] }
  | { type: 'read_desktop_file'; requestId: string; projectPath?: string; sessionId?: string; path: string; maxBytes?: number; statOnly?: boolean }
  | { type: 'upload_file'; requestId: string; projectPath?: string; sessionId?: string; targetDir: string; name: string; mimeType: string; size: number; inlineBase64?: string }
  | { type: 'upload_file_complete'; requestId: string }
  | { type: 'list_providers'; requestId: string }
  | { type: 'set_session_api_provider_id'; projectPath: string; sessionId: string; apiProviderId: string | null }
  | { type: 'terminal_create'; requestId: string; projectPath: string; sessionId?: string }
  | { type: 'terminal_kill'; terminalId: string }
  | { type: 'terminal_subscribe'; requestId: string; terminalId: string }
  | { type: 'terminal_unsubscribe'; terminalId?: string }
  | { type: 'terminal_claim'; requestId: string; terminalId: string }
  | { type: 'terminal_release'; requestId: string; terminalId: string }
  | { type: 'terminal_input'; terminalId: string; data: string }
  | { type: 'terminal_resize'; terminalId: string; cols: number; rows: number }

export interface ReadDesktopFileResponse {
  ok: true
  url: string
  mimeType: string
  name: string
  size: number
  modifiedAt: number
  expiresAt: number
}

export interface ReadDesktopFileError {
  ok: false
  error: 'forbidden_path' | 'not_found' | 'too_large' | 'no_session' | 'no_transport' | 'upload_failed' | 'internal_error'
  message?: string
}

export type UploadFileError = {
  ok: false
  error: 'forbidden_path' | 'too_large' | 'no_session' | 'no_transport' | 'download_failed' | 'internal_error'
  message?: string
}

export type UploadFileResponse =
  | { ok: true; status: 'saved'; savedPath: string }
  | { ok: true; status: 'need_lan_put'; uploadUrl: string; savedPath: string }
  | { ok: true; status: 'need_r2_put'; uploadUrl: string; key: string; savedPath: string }
  | UploadFileError

export type UploadFileCompleteResponse =
  | { ok: true; savedPath: string }
  | UploadFileError

/** Who is allowed to remote-control this SuperOne host. */
export type PairedDeviceClientKind = 'mobile' | 'desktop'

export interface PairedDevice {
  id: string
  name: string
  pairedAt: string
  lastSeenAt: string | null
  online: boolean
  transport?: 'lan' | 'relay'
  /**
   * Defaults to `mobile` for legacy rows (QR phone pairing).
   * `desktop` = another SuperOne desktop allowed to control this host.
   */
  clientKind?: PairedDeviceClientKind
}

export interface RemoteDeviceStatus {
  id: string
  online: boolean
  name?: string
  transport?: 'lan' | 'relay'
  firstConnect?: boolean
}

export interface MobileUploadProgress {
  requestId: string
  deviceId: string
  deviceName?: string
  fileName: string
  targetDir: string
  savedPath?: string
  size: number
  receivedBytes: number
  status: 'receiving' | 'completed' | 'failed'
  transport: 'inline' | 'lan' | 'relay'
  error?: string
}

export interface RemoteDeviceConfig {
  enabled: boolean
  masterSecret: string
  deviceId: string
  preventSleep: boolean
  relayUrl: string
}

export type Locale = 'en' | 'zh'

export type UpdateChannel = 'alpha' | 'beta' | 'stable'

export type ThemeMode = 'system' | 'light' | 'dark'

export interface BrowserBookmark {
  id: string
  title: string
  url: string
  favicon: string | null
  groupId: string | null
  createdAt: number
}

export interface BrowserBookmarkGroup {
  id: string
  name: string
  createdAt: number
}

export interface BrowserHistoryEntry {
  url: string
  title: string
  visitCount: number
  lastVisit: number
}

export interface BrowserCertError {
  webContentsId: number
  url: string
  error: string
}

export interface BrowserOpenTabRequest {
  webContentsId: number
  url: string
  background: boolean
}

export interface AppSettings {
  analyticsEnabled: boolean
  /**
   * Legacy master switch for experimental agents (OpenCode + non-Grok ACP).
   * Still honored as an OR when set, but the Settings UI no longer exposes it —
   * prefer per-agent enable via Settings → Harnesses (`enabledExperimentalAgents`
   * and the harness installation catalog).
   */
  experimentalAgentsEnabled: boolean
  /**
   * Per-agent enable list for experimental ACP agents (agent ids, not including
   * Grok — Grok uses the `acp-grok` harness catalog entry). OpenCode uses the
   * `opencode` harness catalog entry.
   */
  enabledExperimentalAgents: string[]
  /** Allow Claude Code to use OpenAI Chat Completions through the local protocol proxy. */
  experimentalClaudeOpenAiChatEnabled: boolean
  /**
   * Opt-in remote execution environments (node / Other Devices + sidebar host
   * switcher). Default off — mobile remote-control of this host stays available.
   */
  experimentalRemoteNodesEnabled: boolean
  crispText: boolean
  /**
   * When true, Edit / Write / FileChange tool blocks auto-expand to show the
   * live diff while streaming (and stay expanded when complete). When false
   * (default), only the header with line counts is shown until the user expands.
   */
  autoExpandFileDiffs: boolean
  /**
   * When true (Detail Mode), completed assistant turns show the full process
   * (tools, reasoning, intermediate narration). When false (default / compact),
   * process is collapsed under a disclosure and only the trailing conclusion
   * is shown. Streaming turns always render fully.
   */
  detailChatMode: boolean
  locale: Locale | ''
  updateChannel: UpdateChannel | null
  themeMode: ThemeMode
  terminalLightPalette: string | null
  terminalDarkPalette: string | null
  terminalFontSize: number
  terminalFontFamily: string | null
  /**
   * Mermaid diagram theme for light app chrome. Null → mermaid `default`.
   * Built-in ids: default | forest | neutral | neo | redux | redux-color
   */
  mermaidLightTheme: string | null
  /**
   * Mermaid diagram theme for dark app chrome. Null → mermaid `dark`.
   * Built-in ids: dark | neutral | neo-dark | redux-dark | redux-dark-color
   */
  mermaidDarkTheme: string | null
  uiFontFamily: string | null
  liquidGlass: boolean
  cdpEnabled: boolean
  cdpCookiesEnabled: boolean
  cdpMockEnabled: boolean
  cdpEmulateEnabled: boolean
  /**
   * Which browser MCP surface to advertise.
   * `legacy` = 30 per-verb tools (default, including packaged builds);
   * `compact` = 8 phase tools (dev opt-in).
   * Env `SUPERONE_BROWSER_TOOLS` overrides this. Locked per session at first use.
   */
  browserToolSurface: 'legacy' | 'compact'
  /** Opt-in Computer Use (desktop GUI automation). Default off. */
  computerUseEnabled: boolean
  /** Skip the per-app session allowlist and permit capture of all apps. Default off. */
  computerUseAllowAllApps: boolean
  /**
   * Apps permanently allowed for Computer Use across sessions.
   * Session-scoped grants live only in memory (ComputerUsePolicy).
   */
  computerUseAlwaysAllowApps: ComputerUseAlwaysAllowApp[]
  miniAppOrder: Record<string, string[]>
  customAppIconPath: string | null
  browserBookmarks: BrowserBookmark[]
  browserBookmarkGroups: BrowserBookmarkGroup[]
  /**
   * Per-connection default parent directory for GitHub/URL clone in the
   * add-project dialog. Key is environment connectionId (`local` or a remote
   * node id); value is the path query refilled on the destination step.
   */
  defaultClonePaths: Record<string, string>
  /**
   * Explicit ChatSuggestions / picker harness order (suggestion keys:
   * `claude` | `codex` | `opencode` | `acp:<agentId>`).
   * Index 0 = default (fixed tab), 1 = secondary (menu default), then the rest.
   * Empty = no full manual order; fall back to `suggestionHarness` /
   * `secondaryHarness` pins + recent parent-session counts.
   */
  harnessOrder: string[]
  /**
   * Default ChatSuggestions harness (fixed tab / empty-session pick).
   * `null` means Auto: rank by recent parent-session count (only when
   * `harnessOrder` is empty). Kept in sync with `harnessOrder[0]` when order is set.
   */
  suggestionHarness: SuggestionHarnessPreference | null
  /**
   * Secondary ChatSuggestions harness (menu-tab default / rank #2).
   * `null` means Auto when `harnessOrder` is empty.
   * Kept in sync with `harnessOrder[1]` when order is set.
   * Ignored when equal to `suggestionHarness`.
   */
  secondaryHarness: SuggestionHarnessPreference | null
  /**
   * Last harness chosen from the ChatSuggestions dropdown slot. Survives
   * switching back to the fixed (top-ranked) slot so the menu tab label and
   * re-activation keep the user's pick instead of resetting to rank #2.
   */
  suggestionMenuHarness: SuggestionHarnessPreference | null
  /**
   * First-run harness onboarding completion timestamp.
   * `null` = not completed.
   */
  onboardingCompletedAt: number | null
  /**
   * Onboarding schema epoch. When below `CURRENT_ONBOARDING_EPOCH` (desktop),
   * the app forces Welcome → Discover again so older installs migrate harnesses.
   */
  onboardingEpoch: number
  agentPreference: {
    claude: {
      defaultModel: string
      defaultEffort: EffortLevel | ''
      defaultPermissionMode: PermissionMode | ''
      defaultSandboxMode: SandboxMode | ''
      brandHue: number | null
      tokenOverrides: TokenOverrides
      disabledSkills: string[]
      askUserQuestionPreviewFormat: QuestionPreviewFormat
    }
    codex: {
      defaultModel: string
      defaultReasoningEffort: CodexReasoningEffort | ''
      defaultPermissionPreset: CodexPermissionPreset | ''
      brandHue: number | null
      tokenOverrides: TokenOverrides
    }
    acp: {
      enabled: boolean
      brandHue: number | null
      tokenOverrides: TokenOverrides
      selectedAgentId: string | null
    }
  }
}

/** ChatSuggestions fixed/dropdown harness identity. */
export interface SuggestionHarnessPreference {
  provider: HarnessId
  /** Required when provider is `acp`; ignored otherwise. */
  acpAgentId?: string | null
}

/** Last-N-days session counts grouped for ChatSuggestions harness ranking. */
export interface HarnessSessionRank {
  /** Stable key: `claude` | `codex` | `opencode` | `acp:<agentId>`. */
  key: string
  provider: HarnessId
  acpAgentId: string | null
  sessionCount: number
}


export interface AppSettingsPatch {
  analyticsEnabled?: boolean
  experimentalAgentsEnabled?: boolean
  enabledExperimentalAgents?: string[]
  experimentalClaudeOpenAiChatEnabled?: boolean
  experimentalRemoteNodesEnabled?: boolean
  crispText?: boolean
  autoExpandFileDiffs?: boolean
  detailChatMode?: boolean
  locale?: Locale | ''
  updateChannel?: UpdateChannel | null
  themeMode?: ThemeMode
  terminalLightPalette?: string | null
  terminalDarkPalette?: string | null
  terminalFontSize?: number
  terminalFontFamily?: string | null
  mermaidLightTheme?: string | null
  mermaidDarkTheme?: string | null
  uiFontFamily?: string | null
  liquidGlass?: boolean
  cdpEnabled?: boolean
  cdpCookiesEnabled?: boolean
  cdpMockEnabled?: boolean
  cdpEmulateEnabled?: boolean
  browserToolSurface?: 'legacy' | 'compact'
  computerUseEnabled?: boolean
  computerUseAllowAllApps?: boolean
  computerUseAlwaysAllowApps?: ComputerUseAlwaysAllowApp[]
  miniAppOrder?: Record<string, string[]>
  customAppIconPath?: string | null
  browserBookmarks?: BrowserBookmark[]
  browserBookmarkGroups?: BrowserBookmarkGroup[]
  /**
   * Merge into `defaultClonePaths`. Empty-string values remove that
   * connection's entry.
   */
  defaultClonePaths?: Record<string, string>
  /**
   * Full manual harness order. When non-empty, also derives
   * `suggestionHarness` / `secondaryHarness` from indices 0 and 1.
   */
  harnessOrder?: string[]
  /** Pass `null` to clear and return to Auto (rank by parent-session count). */
  suggestionHarness?: SuggestionHarnessPreference | null
  /** Pass `null` to clear and return secondary to Auto. */
  secondaryHarness?: SuggestionHarnessPreference | null
  /** Pass `null` to clear the remembered dropdown-slot harness. */
  suggestionMenuHarness?: SuggestionHarnessPreference | null
  onboardingCompletedAt?: number | null
  onboardingEpoch?: number
  agentPreference?: {
    claude?: Partial<AppSettings['agentPreference']['claude']>
    codex?: Partial<AppSettings['agentPreference']['codex']>
    acp?: Partial<AppSettings['agentPreference']['acp']>
  }
}
