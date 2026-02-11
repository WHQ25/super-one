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
  | { type: 'tool_use'; toolName: string; toolUseId: string; input: string; status?: 'streaming' | 'complete'; elapsedSeconds?: number; parentToolUseId?: string | null }
  | { type: 'tool_result'; toolUseId: string; summary: string; parentToolUseId?: string | null }
  | { type: 'image'; name: string }

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
}

export interface MessageMetadata {
  model?: string
  costUsd?: number
  durationMs?: number
  numTurns?: number
  usage?: UsageInfo
  modelUsage?: Record<string, ModelUsageInfo>
  stopReason?: string | null
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
  createdAt: string
  providerId: string
  metadata?: MessageMetadata
}

// --- Permission request ---

export interface PermissionRequest {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  decisionReason?: string
  blockedPath?: string
  allowAlwaysAllow: boolean
}

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'

// --- AskUserQuestion ---

export interface UserQuestionOption {
  label: string
  description: string
}

export interface UserQuestion {
  question: string
  header: string
  options: UserQuestionOption[]
  multiSelect: boolean
}

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
  exitCode?: number
  outcome?: 'success' | 'error' | 'cancelled'
}

// --- Main → Renderer push events ---

export type AgentEventBase =
  | { type: 'message_start'; message: ChatMessage }
  | { type: 'content_delta'; messageId: string; delta: ContentBlock }
  | { type: 'tool_input_delta'; messageId: string; toolUseId: string; partialJson: string; parentToolUseId?: string | null }
  | { type: 'tool_progress'; messageId: string; toolUseId: string; toolName: string; elapsedSeconds: number; parentToolUseId?: string | null }
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
  | { type: 'status_indicator'; indicator: 'compacting' | null }
  | { type: 'task_notification'; taskId: string; taskStatus: 'completed' | 'failed' | 'stopped'; outputFile: string }
  | { type: 'auth_status'; isAuthenticating: boolean; output: string[]; error?: string }
  | { type: 'slash_command_output'; messageId: string; content: string }
  | { type: 'subagent_usage'; messageId: string; parentToolUseId: string; inputTokens: number; outputTokens: number }
  | { type: 'init_ready'; models: ModelOption[]; slashCommands: SlashCommandInfo[]; cwd: string; homedir: string }

export type AgentEvent = AgentEventBase & { projectPath?: string; sessionId?: string }

export type AgentStatus = 'idle' | 'streaming' | 'error'

// --- Renderer → Main requests ---

export interface SendMessageRequest {
  content: string
  model?: string
  images?: ImageAttachment[]
}

// --- Model selection ---

export interface ModelOption {
  id: string
  name: string
  description: string
}

// --- File rewind ---

export interface RewindFilesResult {
  canRewind: boolean
  error?: string
  filesChanged?: string[]
  insertions?: number
  deletions?: number
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
  lastOpened: string   // ISO timestamp — updated on every open
  addedAt: string      // ISO timestamp — set once on first add
}

// --- Resource scope ---

export type ResourceScope = 'user' | 'project'

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
  gitBranch?: string
  messageCount: number // Total user + assistant messages
}

export interface LoadSessionMessagesResult {
  messages: ChatMessage[]
  cursor: number | null  // Index of earliest loaded message, null if no more
  hasMore: boolean
}

// --- IPC channel constants ---

export const AgentIpcChannels = {
  // App-level channels
  SELECT_FOLDER: 'app:select-folder',
  GET_RECENT_FOLDERS: 'app:get-recent-folders',
  REMOVE_RECENT_FOLDER: 'app:remove-recent-folder',
  OPEN_FOLDER: 'app:open-folder',
  OPEN_TMP_FOLDER: 'app:open-tmp-folder',
  CLOSE_PROJECT: 'app:close-project',
  SETUP_CHECK_CLAUDE: 'app:setup-check-claude',
  SETUP_INSTALL_CLAUDE: 'app:setup-install-claude',
  SETUP_EVENT: 'app:setup-event',

  // Agent channels
  SEND_MESSAGE: 'agent:send-message',
  INTERRUPT: 'agent:interrupt',
  AVAILABLE_MODELS: 'agent:available-models',
  EVENT: 'agent:event',
  PERMISSION_RESPONSE: 'agent:permission-response',
  SET_PERMISSION_MODE: 'agent:set-permission-mode',
  ANSWER_QUESTION: 'agent:answer-question',
  DISMISS_QUESTION: 'agent:dismiss-question',
  RESPOND_PLAN_APPROVAL: 'agent:respond-plan-approval',
  RESET_SESSION: 'agent:reset-session',
  REWIND_FILES: 'agent:rewind-files',
  GET_SESSION_ID: 'agent:get-session-id',
  MCP_SERVER_STATUS: 'agent:mcp-server-status',
  ACCOUNT_INFO: 'agent:account-info',
  SLASH_COMMANDS: 'agent:slash-commands',
  LIST_DIRECTORY: 'agent:list-directory',
  LIST_AGENTS: 'agent:list-agents',
  FIND_LINE_NUMBER: 'agent:find-line-number',

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

  // MCP config
  MCP_LIST_CONFIG: 'mcp:list-config',
  MCP_SAVE_CONFIG: 'mcp:save-config',
  MCP_DELETE_CONFIG: 'mcp:delete-config',
  MCP_TOGGLE_CONFIG: 'mcp:toggle-config',
  MCP_PROBE_SERVERS: 'mcp:probe-servers',
  MCP_RECONNECT_SERVER: 'mcp:reconnect-server',
  MCP_OAUTH_AUTHORIZE: 'mcp:oauth-authorize',

  // MCP library
  MCP_LIST_LIBRARY: 'mcp:list-library',
  MCP_DELETE_LIBRARY_ENTRY: 'mcp:delete-library-entry',

  // Concurrent session management
  PARK_SESSION: 'agent:park-session',
  ACTIVATE_SESSION: 'agent:activate-session',

  // Session history
  SESSIONS_LIST: 'sessions:list',
  SESSIONS_LIST_FOR_FOLDER: 'sessions:list-for-folder',
  SESSIONS_RESUME: 'sessions:resume',
  SESSIONS_LOAD_MESSAGES: 'sessions:load-messages',
  SESSIONS_RENAME: 'sessions:rename',
  SESSIONS_CREATE: 'sessions:create',
  SESSIONS_SAVE_STATE: 'sessions:save-state',
  SESSIONS_LOAD_STATE: 'sessions:load-state',
} as const
