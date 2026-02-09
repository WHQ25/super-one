// Unified message format used across IPC. Zero SDK imports.

// --- Image attachments ---

export interface ImageAttachment {
  mimeType: string
  base64: string
  name: string
}

// --- Content blocks ---

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; toolName: string; toolUseId: string; input: string; status?: 'streaming' | 'complete'; elapsedSeconds?: number }
  | { type: 'tool_result'; toolUseId: string; summary: string }
  | { type: 'image'; name: string }

// --- Session info (from system init) ---

export interface SessionInfo {
  sessionId: string
  model: string
  tools: string[]
  mcpServers: { name: string; status: string }[]
  permissionMode: PermissionMode
  slashCommands: string[]
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

// --- MCP server status ---

export interface McpServerInfo {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  error?: string
  scope?: string
  toolCount?: number
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

export type AgentEvent =
  | { type: 'message_start'; message: ChatMessage }
  | { type: 'content_delta'; messageId: string; delta: ContentBlock }
  | { type: 'tool_input_delta'; messageId: string; toolUseId: string; partialJson: string }
  | { type: 'tool_progress'; messageId: string; toolUseId: string; toolName: string; elapsedSeconds: number }
  | { type: 'message_complete'; messageId: string; metadata?: MessageMetadata }
  | { type: 'message_interrupted'; messageId: string; metadata?: MessageMetadata }
  | { type: 'message_error'; messageId: string; error: string }
  | { type: 'status_change'; status: AgentStatus }
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'permission_mode_change'; mode: PermissionMode }
  | { type: 'session_init'; session: SessionInfo }
  | { type: 'ask_user_question'; request: AskUserQuestionRequest }
  | { type: 'hook_started'; hook: HookEvent }
  | { type: 'hook_complete'; hook: HookEvent }
  | { type: 'compact_boundary'; trigger: 'manual' | 'auto'; preTokens: number }
  | { type: 'status_indicator'; indicator: 'compacting' | null }
  | { type: 'task_notification'; taskId: string; taskStatus: 'completed' | 'failed' | 'stopped'; outputFile: string }
  | { type: 'auth_status'; isAuthenticating: boolean; output: string[]; error?: string }
  | { type: 'slash_command_output'; messageId: string; content: string }

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

// --- IPC channel constants ---

export const AgentIpcChannels = {
  SEND_MESSAGE: 'agent:send-message',
  INTERRUPT: 'agent:interrupt',
  AVAILABLE_MODELS: 'agent:available-models',
  EVENT: 'agent:event',
  PERMISSION_RESPONSE: 'agent:permission-response',
  SET_PERMISSION_MODE: 'agent:set-permission-mode',
  ANSWER_QUESTION: 'agent:answer-question',
  RESET_SESSION: 'agent:reset-session',
  REWIND_FILES: 'agent:rewind-files',
  GET_SESSION_ID: 'agent:get-session-id',
  MCP_SERVER_STATUS: 'agent:mcp-server-status',
  ACCOUNT_INFO: 'agent:account-info',
  SLASH_COMMANDS: 'agent:slash-commands',
} as const
