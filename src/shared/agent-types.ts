// Unified message format used across IPC. Zero SDK imports.

// --- Image attachments ---

export interface ImageAttachment {
  mimeType: string
  base64: string
  name: string
}

// --- Content blocks ---

export type ContentBlock =
  | { type: 'text'; text: string; parentToolUseId?: string | null }
  | { type: 'thinking'; thinking: string; parentToolUseId?: string | null }
  | { type: 'tool_use'; toolName: string; toolUseId: string; input: string; status?: 'streaming' | 'complete'; elapsedSeconds?: number; startedAt?: number; parentToolUseId?: string | null; toolSummary?: string; toolFilePath?: string; toolLineDelta?: { added: number; removed: number }; toolDiff?: string; toolDiffTokens?: { added?: [string, string | null][][]; removed?: [string, string | null][][] } }
  | { type: 'tool_result'; toolUseId: string; summary: string; outputPath?: string; isTimedOut?: boolean; parentToolUseId?: string | null }
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

export type CodexCollabTool = 'spawnAgent' | 'sendInput' | 'wait' | 'closeAgent' | 'resumeAgent'
export type CodexCollabAgentStatus = 'pendingInit' | 'running' | 'completed' | 'errored' | 'shutdown' | 'notFound'

export interface CodexCollabAgentState {
  status: CodexCollabAgentStatus
  nickname?: string
  role?: string
  message?: string
}

export interface CodexCollabToolCallItem {
  id: string
  type: 'collab_tool_call'
  tool: CodexCollabTool
  status: 'in_progress' | 'completed'
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

export interface CodexTurnInfo {
  threadId: string | null
  usage: CodexUsageInfo | null
  items: CodexThreadItem[]
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
  consumedTokens?: { input: number; output: number }
  codex?: CodexTurnInfo
  resultText?: string
  permissionDenials?: PermissionDenialInfo[]
  fastModeState?: 'off' | 'cooldown' | 'on'
  errorSubtype?: string
  structuredOutput?: unknown
  isError?: boolean
}

// --- Todo items (derived from TaskCreate/TaskUpdate tool calls) ---

export interface TodoItem {
  id: string
  subject: string
  description: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

// --- Chat message ---

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'complete' | 'interrupted' | 'error'
  content: ContentBlock[]
  attachments?: ImageAttachment[]
  createdAt: string
  providerId: string
  metadata?: MessageMetadata
  checkpointId?: string
  resumePointId?: string
  rewound?: 'code' | 'conversation' | 'code_and_chat'
}

// --- Permission request ---

export interface PermissionRequest {
  requestId: string
  toolName: string
  toolUseId?: string
  input: Record<string, unknown>
  decisionReason?: string
  blockedPath?: string
  allowAlwaysAllow: boolean
  suggestions?: Array<Record<string, unknown>>
}

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'

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

export interface QuestionAnnotation {
  preview?: string
  notes?: string
}

export type QuestionAnnotations = Record<string, QuestionAnnotation>

export interface AskUserQuestionRequest {
  requestId: string
  questions: UserQuestion[]
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

// --- Account info ---

export interface AccountInfo {
  email?: string
  organization?: string
  subscriptionType?: string
  apiKeySource?: string
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

// --- Sandbox info ---

export type SandboxMode = 'off' | 'on' | 'auto'

export interface SandboxInfo {
  enabled: boolean
  autoAllowBash: boolean
}

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
  gitStatus?: GitFileStatus | null
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

// --- Main → Renderer push events ---

export type AgentEventBase =
  | { type: 'message_start'; message: ChatMessage }
  | { type: 'content_delta'; messageId: string; delta: ContentBlock; isSynthetic?: boolean; isReplay?: boolean }
  | { type: 'tool_input_delta'; messageId: string; toolUseId: string; partialJson: string; parentToolUseId?: string | null }
  | { type: 'tool_progress'; messageId: string; toolUseId: string; toolName: string; elapsedSeconds: number; parentToolUseId?: string | null; taskId?: string }
  | { type: 'message_complete'; messageId: string; metadata?: MessageMetadata }
  | { type: 'message_interrupted'; messageId: string; metadata?: MessageMetadata }
  | { type: 'message_error'; messageId: string; error: string }
  | { type: 'status_change'; status: AgentStatus }
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'permission_mode_change'; mode: PermissionMode }
  | { type: 'session_init'; session: SessionInfo }
  | { type: 'ask_user_question'; request: AskUserQuestionRequest }
  | { type: 'plan_approval'; request: PlanApprovalRequest }
  | { type: 'hook_started'; hook: HookEvent }
  | { type: 'hook_complete'; hook: HookEvent }
  | { type: 'compact_boundary'; trigger: 'manual' | 'auto'; preTokens: number }
  | { type: 'status_indicator'; indicator: 'compacting' | null; permissionMode?: PermissionMode }
  | { type: 'task_started'; taskId: string; toolUseId?: string; description: string; taskType?: string }
  | { type: 'task_progress'; taskId: string; toolUseId?: string; description: string; lastToolName?: string; summary?: string; usage: { totalTokens: number; toolUses: number; durationMs: number } }
  | { type: 'task_notification'; taskId: string; toolUseId?: string; taskStatus: 'completed' | 'failed' | 'stopped'; outputFile: string; summary?: string; usage?: { totalTokens: number; toolUses: number; durationMs: number } }
  | { type: 'auth_status'; isAuthenticating: boolean; output: string[]; error?: string }
  | { type: 'slash_command_output'; messageId: string; content: string }
  | { type: 'subagent_usage'; messageId: string; parentToolUseId: string; inputTokens: number; outputTokens: number }
  | { type: 'message_usage'; messageId: string; inputTokens: number; outputTokens: number; codexUsage?: CodexUsageInfo }
  | { type: 'codex_thread_started'; messageId: string; threadId: string }
  | { type: 'codex_item_delta'; messageId: string; phase: 'started' | 'updated' | 'completed'; item: CodexThreadItem }
  | { type: 'checkpoint_captured'; messageId: string; checkpointId: string; resumePointId: string }
  | { type: 'init_ready'; skills: SlashCommandInfo[]; projectCommands: SlashCommandInfo[]; projectAgents: AgentInfo[]; cwd: string; homedir: string; sandboxInfo: SandboxInfo }
  | { type: 'prompt_suggestion'; suggestion: string }
  | { type: 'rate_limit'; status: 'allowed' | 'allowed_warning' | 'rejected'; resetsAt?: number; rateLimitType?: string; utilization?: number; overageStatus?: string; overageResetsAt?: number; overageDisabledReason?: string; isUsingOverage?: boolean; surpassedThreshold?: number }
  | { type: 'assistant_error'; messageId: string; error: string }
  | { type: 'hook_progress'; hook: HookEvent }
  | { type: 'files_persisted'; files: Array<{ filename: string; fileId: string }>; failed: Array<{ filename: string; error: string }>; processedAt: string }
  | { type: 'elicitation_complete'; mcpServerName: string; elicitationId: string }
  | { type: 'stream_message_start'; messageId: string; apiMessageId: string; model: string; parentToolUseId?: string | null }
  | { type: 'stream_message_stop'; messageId: string; parentToolUseId?: string | null }

export type AgentEvent = AgentEventBase & { projectPath?: string; sessionId?: string }

export type AgentStatus = 'idle' | 'streaming' | 'error'

// --- Renderer → Main requests ---

export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

export interface SendMessageRequest {
  content: string
  model?: string
  effort?: EffortLevel
  images?: ImageAttachment[]
  additionalDirs?: string[]
}

// --- Model selection ---

export interface ModelOption {
  id: string
  name: string
  description: string
  isDefault?: boolean
  supportsEffort?: boolean
  supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[]
  supportsAdaptiveThinking?: boolean
  supportsFastMode?: boolean
  supportedReasoningEfforts?: ReasoningEffortOption[]
  defaultReasoningEffort?: CodexReasoningEffort
}

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

export type ResourceScope = 'user' | 'project'

// --- Settings provider ---

export type SettingsProvider = 'claude' | 'codex'

export type AgentType = 'claude' | 'codex'
export type ApiFormat = 'anthropic' | 'openai_chat' | 'openai_responses'

// --- Plugins ---

export interface PluginManifest {
  name: string
  version?: string
  description: string
  author?: { name: string; email?: string }
}

export interface PluginInfo {
  name: string            // e.g., "code-review"
  marketplace: string     // e.g., "claude-plugins-official"
  key: string             // e.g., "code-review@claude-plugins-official"
  scope: ResourceScope
  description: string
  author?: string
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
  files: SkillFileEntry[]
}

export interface MarketplacePlugin {
  name: string
  marketplace: string
  key: string              // "name@marketplace"
  description: string
  author?: string
  installCount?: number
  installed: boolean
  installedScope?: ResourceScope
  marketplaceLastUpdated?: string
  marketplaceSource?: string   // e.g. "github:anthropics/claude-plugins-official" or "directory:/path"
}

// --- Skills ---

export interface SkillInfo {
  name: string
  displayName: string
  scope: ResourceScope
  description: string
  hasConfig: boolean
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
}

// --- Session history ---

export interface SessionHistoryEntry {
  sessionId: string
  title: string        // First user message, truncated
  lastActiveAt: string // File modification time
  provider?: 'claude' | 'codex'
  gitBranch?: string
  messageCount: number // Total user + assistant messages
  isWorktree?: boolean // true if session was created in a git worktree
  isPinned?: boolean   // true if session is pinned by user
  isHidden?: boolean   // true if session is hidden by user
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

// --- Connect result (global init at app startup) ---

export interface ConnectResult {
  models: ModelOption[]
  account: AccountInfo
  slashCommands: SlashCommandInfo[]
  userSkills: SlashCommandInfo[]
  userCommands: SlashCommandInfo[]
  userAgents: AgentInfo[]
  availableOutputStyles: string[]
}

// --- Startup data (cached resources + user resources) ---

export interface StartupData {
  cached: { models: ModelOption[]; codexModels: ModelOption[]; account: AccountInfo; slashCommands: SlashCommandInfo[] } | null
  userSkills: SlashCommandInfo[]
  userCommands: SlashCommandInfo[]
  userAgents: AgentInfo[]
}

// --- Codex experimental integration ---

export type CodexAuthMode = 'auto' | 'chatgpt' | 'apiKey'
export type CodexApprovalMode = 'never' | 'on-request' | 'on-failure' | 'untrusted'
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export type CodexPermissionPreset = 'default' | 'full-access'

export interface CodexPermissionProfile {
  approvalPolicy: CodexApprovalMode
  sandboxMode: CodexSandboxMode
  networkAccessEnabled: boolean
}

export const CODEX_PERMISSION_PRESETS: Record<CodexPermissionPreset, CodexPermissionProfile> = {
  // Matches Codex CLI "Default" preset (approval-presets id: auto).
  default: {
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    networkAccessEnabled: false,
  },
  // Matches Codex CLI "Full Access" preset (approval-presets id: full-access).
  'full-access': {
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    networkAccessEnabled: true,
  },
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

export interface CodexSetAuthRequest {
  mode: CodexAuthMode
  apiKey?: string
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

// --- IPC channel constants ---

export const AgentIpcChannels = {
  // App-level channels
  CONNECT_CLAUDE: 'app:connect-claude',
  GET_STARTUP_DATA: 'app:get-startup-data',
  SELECT_FOLDER: 'app:select-folder',
  GET_RECENT_FOLDERS: 'app:get-recent-folders',
  ADD_RECENT_FOLDER: 'app:add-recent-folder',
  REMOVE_RECENT_FOLDER: 'app:remove-recent-folder',
  OPEN_FOLDER: 'app:open-folder',
  OPEN_TMP_FOLDER: 'app:open-tmp-folder',
  CLOSE_PROJECT: 'app:close-project',
  SETUP_CHECK_CLAUDE: 'app:setup-check-claude',
  SETUP_INSTALL_CLAUDE: 'app:setup-install-claude',
  SETUP_EVENT: 'app:setup-event',
  CODEX_RUN: 'codex:run',
  CODEX_LIST_MODELS: 'codex:list-models',
  CODEX_RESET: 'codex:reset',
  CODEX_INTERRUPT: 'codex:interrupt',
  CODEX_PERMISSION_RESPONSE: 'codex:permission-response',
  CODEX_ANSWER_QUESTION: 'codex:answer-question',
  CODEX_DISMISS_QUESTION: 'codex:dismiss-question',
  CODEX_STEER: 'codex:steer',
  CODEX_REVIEW: 'codex:review',
  CODEX_COMPACT: 'codex:compact',
  CODEX_GET_AUTH_STATUS: 'codex:get-auth-status',
  CODEX_SET_AUTH: 'codex:set-auth',

  // Agent channels
  SEND_MESSAGE: 'agent:send-message',
  INTERRUPT: 'agent:interrupt',
  EVENT: 'agent:event',
  PERMISSION_RESPONSE: 'agent:permission-response',
  SET_PERMISSION_MODE: 'agent:set-permission-mode',
  SET_SANDBOX_MODE: 'agent:set-sandbox-mode',
  ANSWER_QUESTION: 'agent:answer-question',
  DISMISS_QUESTION: 'agent:dismiss-question',
  RESPOND_PLAN_APPROVAL: 'agent:respond-plan-approval',
  RESET_SESSION: 'agent:reset-session',
  REWIND_FILES: 'agent:rewind-files',
  REWIND_FILES_PREVIEW: 'agent:rewind-files-preview',
  REWIND_CODE_AND_CHAT: 'agent:rewind-code-and-chat',
  REWIND_CONVERSATION: 'agent:rewind-conversation',
  GET_SESSION_ID: 'agent:get-session-id',
  MCP_SERVER_STATUS: 'agent:mcp-server-status',
  LIST_DIRECTORY: 'agent:list-directory',
  FIND_LINE_NUMBER: 'agent:find-line-number',
  SEARCH_FILES: 'agent:search-files',
  SEARCH_MENTIONS: 'agent:search-mentions',

  // Plugins
  PLUGINS_LIST: 'plugins:list',
  PLUGINS_READ: 'plugins:read',
  PLUGINS_READ_FILE: 'plugins:read-file',
  PLUGINS_DELETE: 'plugins:delete',
  PLUGINS_LIST_MARKETPLACE: 'plugins:list-marketplace',
  PLUGINS_INSTALL: 'plugins:install',
  PLUGINS_UPDATE: 'plugins:update',
  PLUGINS_UPDATE_MARKETPLACE: 'plugins:update-marketplace',

  // Skills
  SKILLS_LIST: 'skills:list',
  SKILLS_READ: 'skills:read',
  SKILLS_READ_FILE: 'skills:read-file',
  SKILLS_INSTALL: 'skills:install',
  SKILLS_DELETE: 'skills:delete',

  // Codex skills
  CODEX_SKILLS_LIST: 'codex:skills-list',
  CODEX_SKILLS_READ: 'codex:skills-read',
  CODEX_SKILLS_READ_FILE: 'codex:skills-read-file',
  CODEX_SKILLS_DELETE: 'codex:skills-delete',

  // Codex MCP config
  CODEX_MCP_LIST_CONFIG: 'codex:mcp-list-config',

  // MCP config
  MCP_LIST_CONFIG: 'mcp:list-config',
  MCP_SAVE_CONFIG: 'mcp:save-config',
  MCP_DELETE_CONFIG: 'mcp:delete-config',
  MCP_TOGGLE_CONFIG: 'mcp:toggle-config',
  MCP_CHECK_SERVERS: 'mcp:check-servers',
  MCP_OAUTH_AUTHORIZE: 'mcp:oauth-authorize',

  // MCP library
  MCP_LIST_LIBRARY: 'mcp:list-library',
  MCP_DELETE_LIBRARY_ENTRY: 'mcp:delete-library-entry',

  CLAUDE_USER_PREFERENCES_GET: 'claude:user-preferences-get',
  CLAUDE_USER_PREFERENCES_SAVE: 'claude:user-preferences-save',
  CLAUDE_PROJECT_PREFERENCES_GET: 'claude:project-preferences-get',
  CLAUDE_PROJECT_PREFERENCES_SAVE: 'claude:project-preferences-save',

  // Agents
  AGENTS_LIST: 'agents:list',
  AGENTS_READ_FILE: 'agents:read-file',

  // Git
  GIT_INFO: 'app:git-info',
  GIT_LIST_BRANCHES: 'app:git-list-branches',
  GIT_SWITCH_BRANCH: 'app:git-switch-branch',
  GIT_CREATE_BRANCH: 'app:git-create-branch',
  PATH_EXISTS: 'app:path-exists',
  GIT_WORKTREE_INFO: 'app:git-worktree-info',
  GIT_ACTIVATE_WORKTREE: 'app:git-activate-worktree',
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
  GIT_DIFF_FILE: 'app:git-diff-file',
  GIT_READ_FILE: 'app:git-read-file',

  // Concurrent session management
  PARK_SESSION: 'agent:park-session',
  ACTIVATE_SESSION: 'agent:activate-session',

  // Session history
  SESSIONS_LIST: 'sessions:list',
  SESSIONS_LIST_FOR_FOLDER: 'sessions:list-for-folder',
  SESSIONS_LIST_FOR_FOLDER_PAGE: 'sessions:list-for-folder-page',
  SESSIONS_RESUME: 'sessions:resume',
  SESSIONS_LOAD_MESSAGES: 'sessions:load-messages',
  SESSIONS_RENAME: 'sessions:rename',
  SESSIONS_CREATE: 'sessions:create',
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
  WRITE_PROJECT_ADDITIONAL_DIRS: 'agent:write-project-additional-dirs',

  // Settings
  SET_FAST_MODE: 'app:set-fast-mode',

  // Logging
  GET_LOG_PATH: 'app:get-log-path',

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

  // Providers
  PROVIDERS_LIST: 'providers:list',
  PROVIDERS_CREATE: 'providers:create',
  PROVIDERS_UPDATE: 'providers:update',
  PROVIDERS_DELETE: 'providers:delete',
  PROVIDERS_ACTIVATE: 'providers:activate',
  PROVIDERS_DEACTIVATE_ALL: 'providers:deactivate-all',
  PROVIDERS_TEST: 'providers:test',

  // Bash output watcher
  BASH_OUTPUT_WATCH: 'app:bash-output-watch',
  BASH_OUTPUT_UNWATCH: 'app:bash-output-unwatch',
  BASH_OUTPUT_EVENT: 'app:bash-output-event',
  BASH_OUTPUT_READ_MORE: 'app:bash-output-read-more',
  BASH_OUTPUT_READ_FILE: 'app:bash-output-read-file',

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

  WIDGET_IFRAME_READY: 'widget:iframe-ready',
} as const

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

export type RemoteCommand =
  | { type: 'send_message'; content: string; projectPath?: string; sessionId?: string; model?: string; effort?: string; images?: ImageAttachment[] }
  | { type: 'interrupt'; projectPath?: string }
  | { type: 'respond_permission'; requestId: string; decision: boolean; projectPath?: string }
  | { type: 'subscribe_session'; projectPath: string; sessionId: string }
  | { type: 'unsubscribe_session' }
  | { type: 'load_session_messages'; requestId: string; projectPath: string; sessionId: string; limit?: number; cursor?: number }
  | { type: 'list_directory'; requestId: string; path: string }
  | { type: 'create_directory'; requestId: string; path: string; name: string }
  | { type: 'add_project'; requestId: string; path: string }
  | { type: 'list_projects'; requestId: string }
  | { type: 'list_sessions'; requestId: string; projectPath: string; limit?: number; offset?: number }
  | { type: 'list_models'; requestId: string; projectPath: string }
  | { type: 'get_system_info'; requestId: string; projectPath: string; provider: 'claude' | 'codex' }
  | { type: 'get_git_info'; requestId: string; projectPath: string }
  | { type: 'get_git_branches'; requestId: string; projectPath: string }
  | { type: 'switch_git_branch'; requestId: string; projectPath: string; branch: string }
  | { type: 'create_git_branch'; requestId: string; projectPath: string; branch: string }
  | { type: 'get_worktree_info'; requestId: string; projectPath: string }

export interface PairedDevice {
  id: string
  name: string
  pairedAt: string
  lastSeenAt: string | null
  online: boolean
}
