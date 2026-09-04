import type {
  AcpGoal,
  AgentStatus,
  AskUserQuestionRequest,
  ChatMessage,
  CodexCollaborationMode,
  CodexPermissionPreset,
  CodexReasoningEffort,
  CodexTodoListItem,
  CodexUsageInfo,
  EffortLevel,
  HarnessId,
  ModelOption,
  PermissionMode,
  PermissionRequest,
  PlanApprovalRequest,
  SessionInfo,
  SlashCommandInfo,
  SubagentRetryInfo,
  TodoItem,
} from '@superone/shared/agent-types'

export type ChatProvider = HarnessId

export interface ChatCoreTaskProgressEntry {
  description: string
  taskId?: string
  lastToolName?: string
  summary?: string
  totalTokens: number
  toolUses: number
  durationMs: number
  completed?: boolean
  status?: 'completed' | 'failed' | 'stopped'
  outputFile?: string
  resultText?: string
  diagnostic?: string
  retry?: SubagentRetryInfo
  toolHistory: Array<{ toolName: string; description: string }>
  workflowAgents?: Array<{
    agentId?: string
    label: string
    toolCount: number
    tokens?: number
    state?: string
    phase?: string
  }>
  workflowPhases?: Array<{ title: string; detail?: string; state?: string }>
  currentPhase?: string
}

/**
 * State read or written by the event reducer. Composer, navigation and other
 * desktop-only fields deliberately stay outside this contract.
 */
export interface ChatCoreSession {
  messages: ChatMessage[]
  queuedMessages: ChatMessage[]
  status: AgentStatus
  awaitingAssistantReply: boolean
  lastEventAt: number
  streamingTokens: { input: number; output: number }
  lastAssistantMessageId: string | null
  promptSuggestion: string | null
  pendingPermissions: PermissionRequest[]
  pendingQuestion: AskUserQuestionRequest | null
  pendingPlanApproval: PlanApprovalRequest | null
  planApprovalOutcome: { approved: boolean; feedback?: string } | null
  permissionMode: PermissionMode
  apiRetry: {
    attempt: number
    maxRetries?: number
    delayMs: number
    message?: string
  } | null
  session: SessionInfo | null
  _providerSessionId: string | null
  sessionProvider: ChatProvider | null
  preferredProvider: ChatProvider
  cwd: string
  _worktreeRemoved: boolean
  todos: Record<string, TodoItem>
  showTodos: boolean
  _todosUserDismissed: boolean
  _nextTodoId: number
  taskProgress: Record<string, ChatCoreTaskProgressEntry>
  subagentTokens: Record<string, { input: number; output: number }>
  _streamingToolInputPreviews: Record<string, Record<string, unknown>>
  browserDownloads: Record<string, {
    status: 'progressing' | 'completed' | 'failed'
    path?: string
    filename?: string
    bytes?: number
    totalBytes?: number
    mimeType?: string
    url?: string
    error?: string
  }>
  videoGenStatuses: Record<string, {
    status: string
    generationId: string
    prompt?: string
    provider?: string
    model?: string
    savedPaths?: string[]
    warnings?: string[]
    error?: string
  }>
  totalCostUsd: number
  contextTokens: number
  contextWindow: number | null
  codexUsageSnapshot: CodexUsageInfo | null
  codexTurnLastUsage: CodexUsageInfo | null
  isCompacting: boolean
  isRecapping: boolean
  compactError: string | null
  _pendingCompactUserId: string
  _pendingSlashCommand: string
  slashCommandOutput: { command: string; content: string } | null
  runningSlashCommand: { command: string; startedAt: number } | null
  rateLimitInfo: {
    status: 'allowed_warning' | 'rejected'
    resetsAt?: number
    rateLimitType?: string
    utilization?: number
    errorCode?: 'credits_required'
    canUserPurchaseCredits?: boolean
    hasChargeableSavedPaymentMethod?: boolean
  } | null
  selectedModel: string
  modelUserChosen: boolean
  selectedEffort?: EffortLevel
  effortUserChosen: boolean
  selectedCodexModel: string
  selectedCodexReasoningEffort?: CodexReasoningEffort
  selectedCodexServiceTier: string | null
  selectedCodexPermissionPreset: CodexPermissionPreset
  selectedCodexCollaborationMode: CodexCollaborationMode
  codexModelUserChosen: boolean
  codexReasoningEffortUserChosen: boolean
  codexPlanRejectHintActive: boolean
  openCodeAgentId: string | null
  apiProviderId: string | null
  acpAgentId: string | null
  acpModels: ModelOption[]
  acpModelConfigId: string | null
  acpModelsStatus: 'idle' | 'loading' | 'ready' | 'error'
  acpModelsError: string | null
  acpModes: ModelOption[]
  acpModeConfigId: string | null
  acpModesStatus: 'idle' | 'loading' | 'ready' | 'error'
  selectedAcpModeId: string | null
  acpSlashCommands: SlashCommandInfo[]
  acpSlashCommandsStatus: 'idle' | 'loading' | 'ready' | 'error'
  acpGoal: AcpGoal | null
  _latestCodexTodoList: CodexTodoListItem | null
}

/** Exhaustive reducer write surface. */
export type ChatCorePatch = Partial<ChatCoreSession>
