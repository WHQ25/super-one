// Unified message format used across IPC. Zero SDK imports.

import type { TokenOverrides } from './harness-brand'

// --- Image attachments ---

export interface ImageAttachment {
  mimeType: string
  base64: string
  name: string
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
}

interface WorkflowData {
  workflowName?: string
  workflowDescription?: string
  workflowPhases?: Array<{ title: string; detail?: string }>
  workflowAgents?: Array<{ label: string; toolCount: number; tokens?: number }>
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
  | { type: 'image'; name: string }
  | { type: 'document'; name: string }

// --- Session info (from system init) ---

export interface SessionInfo {
  sessionId: string
  model: string
  tools: string[]
  mcpServers: { name: string; status: string }[]
  permissionMode: PermissionMode
  slashCommands: string[]
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
  totalOutputTokens: number
  lastInputTokens: number
  lastCachedInputTokens: number
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

export interface CodexImageGenerationItem {
  id: string
  type: 'image_generation'
  status: 'in_progress' | 'completed' | 'failed' | string
  revisedPrompt?: string
  savedPath?: string
  generationMs?: number
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
  | CodexImageGenerationItem

export interface CodexMcpServerStartup {
  name: string
  status: 'starting' | 'ready' | 'failed' | 'cancelled'
}

export interface CodexTurnInfo {
  threadId: string | null
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

export interface MessageMetadata {
  model?: string
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
  errorSubtype?: string
  structuredOutput?: unknown
  isError?: boolean
  apiErrorStatus?: number | null
  /** SDK assistant message UUID of this turn — anchor for forking at this message. */
  forkAnchorId?: string
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
  requestKind?: 'mcp_elicitation'
  serverName?: string
  message?: string
  subtitle?: string
  riskLevel?: 'low' | 'medium' | 'high'
  supportsAlwaysPersist?: boolean
  elicitationForm?: ElicitationFormField[]
}

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'

export type AccountApiProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry' | 'anthropicAws' | 'mantle' | 'gateway'

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

export type GitFileStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | '!'

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

export type AgentEventBase =
  | { type: 'message_start'; message: ChatMessage }
  | { type: 'user_message_appended'; message: ChatMessage }
  | { type: 'content_delta'; messageId: string; delta: ContentBlock; isSynthetic?: boolean; isReplay?: boolean }
  | { type: 'tool_input_delta'; messageId: string; toolUseId: string; partialJson: string; parentToolUseId?: string | null }
  | { type: 'tool_progress'; messageId: string; toolUseId: string; toolName: string; elapsedSeconds: number; parentToolUseId?: string | null; taskId?: string }
  | { type: 'message_complete'; messageId: string; metadata?: MessageMetadata }
  | { type: 'message_interrupted'; messageId: string; metadata?: MessageMetadata }
  | { type: 'message_error'; messageId: string; error: string }
  | { type: 'status_change'; status: AgentStatus }
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'permission_mode_change'; mode: PermissionMode }
  | { type: 'agent_setting_change'; selectedModel?: string | null; selectedEffort?: EffortLevel | null; patch?: SessionSettingsPatch }
  | { type: 'provider_changed'; harnessId: 'claude' | 'codex'; provider: RemoteActiveProvider | null }
  | { type: 'session_init'; session: SessionInfo }
  | { type: 'ask_user_question'; request: AskUserQuestionRequest }
  | { type: 'plan_approval'; request: PlanApprovalRequest }
  | { type: 'hook_started'; hook: HookEvent }
  | { type: 'hook_complete'; hook: HookEvent }
  | { type: 'compact_boundary'; trigger: 'manual' | 'auto'; preTokens: number; postTokens?: number; durationMs?: number }
  | { type: 'status_indicator'; indicator: 'compacting' | null; permissionMode?: PermissionMode; compactResult?: 'success' | 'failed'; compactError?: string }
  | { type: 'task_started'; taskId: string; toolUseId?: string; description: string; taskType?: string }
  | { type: 'task_progress'; taskId: string; toolUseId?: string; description: string; lastToolName?: string; summary?: string; usage: { totalTokens: number; toolUses: number; durationMs: number }; activityText?: string; toolEntries?: Array<{ toolName: string; description: string }>; workflowAgents?: Array<{ label: string; toolCount: number; tokens?: number }> }
  | { type: 'task_notification'; taskId: string; toolUseId?: string; taskStatus: 'completed' | 'failed' | 'stopped'; outputFile: string; summary?: string; usage?: { totalTokens: number; toolUses: number; durationMs: number }; resultText?: string; toolEntries?: Array<{ toolName: string; description: string }>; workflowAgents?: Array<{ label: string; toolCount: number; tokens?: number }> }
  | { type: 'auth_status'; isAuthenticating: boolean; output: string[]; error?: string }
  | { type: 'slash_command_output'; messageId: string; content: string }
  | { type: 'subagent_usage'; messageId: string; parentToolUseId: string; inputTokens: number; outputTokens: number }
  | { type: 'message_usage'; messageId: string; inputTokens: number; outputTokens: number; codexUsage?: CodexUsageInfo }
  | { type: 'codex_thread_started'; messageId: string; threadId: string }
  | { type: 'codex_item_delta'; messageId: string; phase: 'started' | 'updated' | 'completed'; item: CodexThreadItem }
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
  | { type: 'api_retry'; attempt: number; maxRetries: number; delayMs: number }
  | { type: 'model_fallback'; trigger: string; fromModel?: string; toModel?: string }
  | { type: 'queued_message_consumed'; clientMessageId: string }
  | { type: 'worktree_missing'; worktreePath: string; fallbackCwd: string }
  | { type: 'session_title_changed'; sessionId: string; title: string; source: 'user' | 'agent' }
  | { type: 'shared_file'; shareId: string; file: ShareFilePayload; sentAt: number }
  | { type: 'shared_file_progress'; path: string; loaded: number; total: number }

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
  selectedCodexPermissionPreset?: CodexPermissionPreset | null
  selectedCodexCollaborationMode?: CodexCollaborationMode | null
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
}

export interface CodexSendExtras {
  mode?: 'run' | 'review' | 'compact'
  reviewTarget?: CodexReviewTarget
  permissionPreset?: CodexPermissionPreset
  reasoningEffort?: CodexReasoningEffort
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
  provider?: 'claude' | 'codex'
  worktreePath?: string
}

// --- Model selection ---

export interface ModelOption {
  id: string
  name: string
  description: string
  isDefault?: boolean
  supportsEffort?: boolean
  supportedEffortLevels?: ('low' | 'medium' | 'high' | 'xhigh' | 'max')[]
  supportsAdaptiveThinking?: boolean
  supportsFastMode?: boolean
  supportsAutoMode?: boolean
  supportedReasoningEfforts?: ReasoningEffortOption[]
  defaultReasoningEffort?: CodexReasoningEffort
}

export const DEFAULT_CONTEXT_WINDOW = 200_000

// --- File rewind ---

export interface RewindFilesResult {
  canRewind: boolean
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

export type SettingsProvider = 'claude' | 'codex'

// ─── Agent Run Config (unified abstraction for running any agent type) ───

export interface ClaudeRunConfig {
  type: 'claude'
  agentName?: string
  model?: string
  effort?: EffortLevel
  permissionMode?: PermissionMode
  sandboxMode?: SandboxMode
}

export interface CodexRunConfig {
  type: 'codex'
  model?: string
  reasoningEffort?: CodexReasoningEffort
  permissionPreset?: CodexPermissionPreset
}

export type AgentRunConfig = ClaudeRunConfig | CodexRunConfig

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

export type AgentType = 'claude' | 'codex'
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
  provider?: 'claude' | 'codex'
  providerSessionId?: string // Claude Code SDK session UUID / Codex thread id
  gitBranch?: string
  messageCount: number // Total user + assistant messages
  isWorktree?: boolean // true if session was created in a git worktree
  worktreePath?: string // filesystem path to the worktree directory
  isPinned?: boolean   // true if session is pinned by user
  isHidden?: boolean   // true if session is hidden by user
  isAutomation?: boolean
  automationId?: string
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

export interface HarnessResourcesMap {
  claude: ClaudeResources
  codex: CodexResources
}

export type HarnessId = keyof HarnessResourcesMap

// --- Startup data (cached per-harness resources) ---

export interface StartupData {
  cached: {
    claude: ClaudeResources | null
    codex: CodexResources | null
  }
  sandboxCapability: SandboxCapability
  appVersion: string
}

// --- Codex experimental integration ---

export type CodexAuthMode = 'auto' | 'chatgpt' | 'apiKey'
export type CodexApprovalMode = 'never' | 'on-request' | 'on-failure' | 'untrusted'
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export type CodexPermissionPreset = 'read-only' | 'default' | 'full-access'

export interface CodexPermissionProfile {
  approvalPolicy: CodexApprovalMode
  sandboxMode: CodexSandboxMode
  networkAccessEnabled: boolean
}

export const CODEX_PERMISSION_PRESETS: Record<CodexPermissionPreset, CodexPermissionProfile> = {
  'read-only': {
    approvalPolicy: 'on-request',
    sandboxMode: 'read-only',
    networkAccessEnabled: false,
  },
  default: {
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    networkAccessEnabled: false,
  },
  'full-access': {
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    networkAccessEnabled: true,
  },
}

export const CODEX_PERMISSION_PROFILE_IDS: Record<CodexPermissionPreset, string> = {
  'read-only': ':read-only',
  default: ':workspace',
  'full-access': ':danger-full-access',
}
export const DEFAULT_CODEX_PERMISSION_PRESET: CodexPermissionPreset = 'default'
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

export interface CodexRateLimits {
  primary: CodexRateLimitWindow | null
  secondary: CodexRateLimitWindow | null
  planType: string | null
  resetCredits: number | null
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
}

export type CodexHookEventName =
  | 'preToolUse'
  | 'postToolUse'
  | 'permissionRequest'
  | 'preCompact'
  | 'postCompact'
  | 'sessionStart'
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

export interface CodexProviderTestProgress {
  phase: 'model_list' | 'turn'
  status: 'start' | 'ok'
}

export interface CodexRunRequest {
  prompt: string
  model?: string
  reasoningEffort?: CodexReasoningEffort
  permissionPreset?: CodexPermissionPreset
  collaborationMode?: CodexCollaborationMode
  images?: ImageAttachment[]
  threadId?: string
  messageId?: string
  cwd?: string
}

export interface CodexRunResult {
  threadId: string | null
  finalResponse: string
  usage: CodexUsageInfo | null
  items: CodexThreadItem[]
}

export type CodexReviewTarget =
  | { type: 'uncommittedChanges' }
  | { type: 'baseBranch' }
  | { type: 'commit'; sha: string; title?: string }

export interface CodexReviewRequest {
  target: CodexReviewTarget
  model?: string
  reasoningEffort?: CodexReasoningEffort
  permissionPreset?: CodexPermissionPreset
  threadId?: string
  messageId?: string
  cwd?: string
}

export interface CodexCompactRequest {
  model?: string
  permissionPreset?: CodexPermissionPreset
  threadId?: string
  messageId?: string
  cwd?: string
}

// --- Update events ---

export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string; releaseNotes?: string }
  | { type: 'not-available' }
  | { type: 'download-progress'; percent: number }
  | { type: 'downloaded'; version: string }
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

export interface AgentProviderConfig {
  base_url: string
  model_env: string
  extra_env: string
  api_format: string
}

export interface ApiProvider {
  id: string
  name: string
  provider_type: string
  api_key: string
  category: string
  supported_agents: string
  agent_configs: string
  is_active_claude: number
  is_active_codex: number
  sort_order: number
  notes: string
  created_at: string
  updated_at: string
  // Legacy columns (kept in DB, not used in new code)
  base_url: string
  extra_env: string
  is_active: number
  agent_type: string
  api_format: string
}

export interface CreateProviderRequest {
  name: string
  provider_type?: string
  api_key?: string
  category?: string
  supported_agents?: string
  agent_configs?: string
  notes?: string
}

export interface UpdateProviderRequest {
  name?: string
  provider_type?: string
  api_key?: string
  category?: string
  supported_agents?: string
  agent_configs?: string
  notes?: string
  sort_order?: number
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

export const AgentIpcChannels = {
  // App-level channels
  CONNECT_CLAUDE: 'app:connect-claude',
  CONNECT_CODEX: 'app:connect-codex',
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

  // Claude channels
  CLAUDE_GET_RATE_LIMITS: 'claude:get-rate-limits',

  // Third-party provider usage channels
  PROVIDER_GET_RATE_LIMITS: 'provider:get-rate-limits',

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
  CREATE_SESSION: 'agent:create-session',
  TRUNCATE_AT_CHECKPOINT: 'agent:truncate-at-checkpoint',
  REWIND_FILES: 'agent:rewind-files',
  REWIND_FILES_PREVIEW: 'agent:rewind-files-preview',
  REWIND_CODE_AND_CHAT: 'agent:rewind-code-and-chat',
  REWIND_CONVERSATION: 'agent:rewind-conversation',
  GET_SESSION_ID: 'agent:get-session-id',
  MCP_SERVER_STATUS: 'agent:mcp-server-status',
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

  // Skills
  SKILLS_LIST: 'skills:list',
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

  // Codex hooks (read-only)
  CODEX_HOOKS_LIST: 'codex:hooks-list',

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
  CLOSE_TAB_SHORTCUT: 'app:close-tab-shortcut',
  CLOSE_WINDOW: 'app:close-window',
  GET_FULLSCREEN: 'app:get-fullscreen',
  FULLSCREEN_CHANGED: 'app:fullscreen-changed',
  SET_MIN_WINDOW_SIZE: 'app:set-min-window-size',
  OPEN_SESSION_WINDOW: 'app:open-session-window',
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
  REVEAL_FILE: 'app:reveal-file',

  // Concurrent session management
  PARK_SESSION: 'agent:park-session',
  ACTIVATE_SESSION: 'agent:activate-session',

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
  APP_SYSTEM_LOCALE: 'app:system-locale',
  APP_LOCALE_CHANGED: 'app:locale-changed',
  APP_ICON_PICK_FILE: 'app:icon-pick-file',
  APP_ICON_SET: 'app:icon-set',
  APP_ICON_RESET: 'app:icon-reset',

  // Usage statistics
  USAGE_QUERY: 'app:usage:query',
  USAGE_COUNTS_QUERY: 'app:usage:counts',
  USAGE_BACKFILL_STATUS: 'app:usage:backfill-status',
  USAGE_BACKFILL_DONE: 'app:usage:backfill-done',

  // Logging
  GET_LOG_PATH: 'app:get-log-path',
  TRACE: 'app:trace',

  // Updater
  UPDATER_EVENT: 'updater:event',
  UPDATER_INSTALL: 'updater:install',
  UPDATER_CHECK: 'updater:check',
  UPDATER_SIMULATE: 'updater:simulate',

  // File watcher
  FILE_WATCH_START: 'app:file-watch-start',
  FILE_WATCH_STOP: 'app:file-watch-stop',
  FILE_CHANGE_EVENT: 'app:file-change-event',
  GIT_HEAD_CHANGE: 'app:git-head-change',

  // Providers (legacy api_providers table)
  PROVIDERS_LIST: 'providers:list',
  PROVIDERS_CREATE: 'providers:create',
  PROVIDERS_UPDATE: 'providers:update',
  PROVIDERS_DELETE: 'providers:delete',
  PROVIDERS_ACTIVATE: 'providers:activate',
  PROVIDERS_DEACTIVATE_ALL: 'providers:deactivate-all',
  PROVIDERS_TEST: 'providers:test',
  PROVIDERS_TEST_CODEX: 'providers:test-codex',
  PROVIDERS_TEST_CODEX_PROGRESS: 'providers:test-codex-progress',

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

  // Remote control
  REMOTE_COMMAND: 'remote:command',
  REMOTE_CLIENT_REGISTERED: 'remote:client-registered',
  REMOTE_LIST_PAIRED: 'remote:list-paired',
  REMOTE_REMOVE_PAIRED: 'remote:remove-paired',
  REMOTE_DEVICE_STATUS_CHANGED: 'remote:device-status-changed',
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

  // Mini-App
  MINIAPP_LIST: 'miniapp:list',
  MINIAPP_OPEN: 'miniapp:open',
  MINIAPP_CLOSE: 'miniapp:close',
  MINIAPP_AUTHORIZE: 'miniapp:authorize',
  MINIAPP_UNAUTHORIZE: 'miniapp:unauthorize',
  MINIAPP_LAZY_OPEN_REQUEST: 'miniapp:lazy-open-request',
  MINIAPP_TOOL_CALL: 'miniapp:tool-call',
  MINIAPP_TOOL_RESULT: 'miniapp:tool-result',
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
  AUTOMATIONS_EVENT: 'automations:event',

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
  | { type: 'create_session'; requestId: string; sessionId: string; projectPath: string; provider?: 'claude' | 'codex'; permissionMode?: string; effort?: string; model?: string; gitBranch?: string; worktreePath?: string; worktreeBranch?: string; worktreeMode?: WorktreeMode; worktreeBranchName?: string; worktreeCarryLocalChanges?: boolean; additionalDirectories?: string[] }
  | { type: 'send_message'; sessionId: string; projectPath: string; content: string; provider?: 'claude' | 'codex'; model?: string; effort?: string; images?: ImageAttachment[]; permissionPreset?: string; collaborationMode?: string; threadId?: string; clientMessageId?: string; priority?: 'now' | 'next' | 'later' }
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
  | { type: 'get_system_info'; requestId: string; projectPath: string; provider: 'claude' | 'codex' }
  | { type: 'get_project_resources'; requestId: string; projectPath: string; provider: 'claude' | 'codex' }
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

export interface PairedDevice {
  id: string
  name: string
  pairedAt: string
  lastSeenAt: string | null
  online: boolean
  transport?: 'lan' | 'relay'
}

export interface RemoteDeviceStatus {
  id: string
  online: boolean
  name?: string
  transport?: 'lan' | 'relay'
  firstConnect?: boolean
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

export interface AppSettings {
  analyticsEnabled: boolean
  crispText: boolean
  locale: Locale | ''
  updateChannel: UpdateChannel | null
  terminalLightPalette: string | null
  terminalDarkPalette: string | null
  terminalFontSize: number
  terminalFontFamily: string | null
  uiFontFamily: string | null
  liquidGlass: boolean
  miniAppOrder: Record<string, string[]>
  customAppIconPath: string | null
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
      brandHue: number | null
      tokenOverrides: TokenOverrides
    }
  }
}

export interface AppSettingsPatch {
  analyticsEnabled?: boolean
  crispText?: boolean
  locale?: Locale | ''
  updateChannel?: UpdateChannel | null
  terminalLightPalette?: string | null
  terminalDarkPalette?: string | null
  terminalFontSize?: number
  terminalFontFamily?: string | null
  uiFontFamily?: string | null
  liquidGlass?: boolean
  miniAppOrder?: Record<string, string[]>
  customAppIconPath?: string | null
  agentPreference?: {
    claude?: Partial<AppSettings['agentPreference']['claude']>
    codex?: Partial<AppSettings['agentPreference']['codex']>
  }
}
