import { create } from 'zustand'
import { useAppStore } from './app'
import { buildSlashCommands, extractModeFromSuggestions, findCheckpointTarget, getCommandOutputMode } from './chat-helpers'
import { checkAutoModeEligibility } from '@/lib/auto-mode-eligibility'
import { PERMISSION_MODES } from '@/components/chat/PermissionModeList'
import { extractPartialToolInput } from '@/components/chat/tool-display'
import type { AccountInfo, AgentEvent, AgentInfo, AgentPrewarmHint, AgentStatus, AskUserQuestionRequest, ChatMessage, ChatMessageContext, CodexAgentMessageItem, CodexAuthMode, CodexAuthStatus, CodexCollaborationMode, CodexPermissionPreset, CodexPlanApprovalState, CodexReasoningEffort, CodexReviewTarget, CodexThreadItem, CodexUsageInfo, ContentBlock, ContextUsageInfo, EffortLevel, ImageAttachment, ModelOption, PlanApprovalRequest, PermissionMode, PermissionRequest, QuestionAnnotations, RewindFilesResult, SandboxInfo, SandboxMode, SessionHistoryEntry, SessionInfo, SlashCommandInfo, TodoItem, UserQuestion } from '../../../shared/agent-types'
import { applySeqToMessage, compareMessageSeq, isReplayedEventForMessage } from '../../../shared/event-seq-utils'
import { perfEvent } from '@/lib/perf-trace'

type Corner = 'br' | 'bl' | 'tr' | 'tl'
export type ChatProvider = 'claude' | 'codex'
export const DEFAULT_PROVIDER: ChatProvider = 'claude'
const SESSIONS_PAGE_SIZE = 30
const CODEX_LAST_SELECTION_STORAGE_KEY = 'super-one.codex.last-selection.v1'
const CODEX_APPROVE_PLAN_PROMPT = 'Plan approved, start implementation.'
export const CODEX_REJECT_PLAN_PLACEHOLDER = 'Tell Codex what to do differently'

const STREAMING_INPUT_TOOLS = new Set(['Edit', 'Write', 'FileChange', 'NotebookEdit'])
const STREAMING_PREVIEW_THROTTLE_MS = 100
const streamingToolInputRaw = new Map<string, string>()
const streamingPreviewLastUpdate = new Map<string, number>()

function markMessageEventApplied(messages: ChatMessage[], messageId: string, event: AgentEvent): ChatMessage[] | null {
  if (event.seq === undefined) return null
  return messages.map((msg) => (
    msg.id === messageId ? { ...msg, ...applySeqToMessage(event) } : msg
  ))
}

function persistStreamingToolInput(messages: ChatMessage[], messageId: string, toolUseId: string, input: string | undefined): ChatMessage[] {
  if (input === undefined) return messages
  return messages.map((msg) => {
    if (msg.id !== messageId) return msg
    return {
      ...msg,
      content: msg.content.map((block) => (
        block.type === 'tool_use' && block.toolUseId === toolUseId && block.input !== input
          ? { ...block, input }
          : block
      )),
    }
  })
}

export type MentionKind = 'file' | 'directory' | 'agent'
export interface Mention {
  kind: MentionKind
  value: string
  displayName: string
}

export interface MiniAppContextSlot {
  appId: string
  appName: string
  summary: string
  content: string
  mode: 'inject' | 'suggest'
  color?: string
  checked: boolean
}

// --- Per-project session state (unified per-session architecture) ---

/**
 * Generate a fresh session id. Shared with the main process 1:1 as
 * `Session.id`; no draft/promotion dance — the id assigned here is the
 * stable identity used in DB, IPC, and the main-process SessionManager.
 */
export function createSessionId(): string {
  return crypto.randomUUID()
}

export interface PerSessionState {
  cwd: string
  messages: ChatMessage[]
  status: AgentStatus
  awaitingAssistantReply: boolean
  session: SessionInfo | null
  sessionProvider: ChatProvider | null
  totalCostUsd: number
  contextTokens: number
  contextWindow: number | null
  detailedUsage: ContextUsageInfo | null
  subagentTokens: Record<string, { input: number; output: number }>
  taskProgress: Record<string, { description: string; lastToolName?: string; summary?: string; totalTokens: number; toolUses: number; durationMs: number; completed?: boolean; outputFile?: string; toolHistory: Array<{ toolName: string; description: string }> }>
  streamingTokens: { input: number; output: number }
  codexUsageSnapshot: CodexUsageInfo | null
  codexTurnLastUsage: CodexUsageInfo | null
  selectedModel: string
  selectedEffort?: EffortLevel
  modelUserChosen: boolean
  effortUserChosen: boolean
  selectedCodexModel: string
  selectedCodexReasoningEffort?: CodexReasoningEffort
  codexModelUserChosen: boolean
  codexReasoningEffortUserChosen: boolean
  selectedCodexPermissionPreset: CodexPermissionPreset
  selectedCodexCollaborationMode: CodexCollaborationMode
  codexPlanRejectHintActive: boolean
  chatInputFocusNonce: number
  preferredProvider: ChatProvider
  draftText: string
  promptSuggestion: string | null
  attachments: ImageAttachment[]
  mentions: Mention[]
  pendingPermissions: PermissionRequest[]
  permissionMode: PermissionMode
  pendingQuestion: AskUserQuestionRequest | null
  pendingPlanApproval: PlanApprovalRequest | null
  planApprovalOutcome: { approved: boolean; feedback?: string } | null
  slashCommandOutput: { command: string; content: string; mode?: 'overlay' | 'popup' } | null
  _streamingToolInputPreviews: Record<string, Record<string, unknown>>
  _pendingSlashCommand: string
  todos: Record<string, TodoItem>
  showTodos: boolean
  _todosUserDismissed: boolean
  _nextTodoId: number
  isCompacting: boolean
  rateLimitInfo: { status: 'allowed_warning' | 'rejected'; resetsAt?: number; rateLimitType?: string; utilization?: number } | null
  _worktreeBaseBranch: string | null
  _worktreePath: string | null
  _worktreeRemoved: boolean
  additionalDirs: string[]
  apiRetry: { attempt: number; maxRetries: number; delayMs: number } | null
  lastEventAt: number
  queuedMessages: ChatMessage[]
  activeCodexMessageId: string | null
  lastAssistantMessageId: string | null
  miniAppContexts: Record<string, MiniAppContextSlot>
  userSelections: string[]
  _historyHydrated: boolean
}

export interface ProjectState {
  _activeSessionId: string | null
  _sessions: Record<string, PerSessionState>
  slashCommands: SlashCommandInfo[]
  _projectSkills: SlashCommandInfo[]
  _projectCommands: SlashCommandInfo[]
  agents: AgentInfo[]
  homedir: string
  sandboxInfo: SandboxInfo
  sessions: SessionHistoryEntry[]
  sessionsPage: number
  sessionsHasMore: boolean
  showHistory: boolean
  hasUnseenActivity: boolean
  hasPendingInteraction: boolean
  unseenCompletedSessions: Set<string>
  codexModels: ModelOption[]
  codexModelsLoading: boolean
  projectAdditionalDirs: string[]
  showDirManager: boolean
  showReviewPanel: boolean
}

export type ActiveSessionView = PerSessionState & ProjectState

export function createDefaultPerSessionState(): PerSessionState {
  return {
    cwd: '',
    messages: [],
    status: 'idle',
    awaitingAssistantReply: false,
    session: null,
    sessionProvider: null,
    totalCostUsd: 0,
    contextTokens: 0,
    contextWindow: null,
    detailedUsage: null,
    subagentTokens: {},
    taskProgress: {},
    streamingTokens: { input: 0, output: 0 },
    codexUsageSnapshot: null,
    codexTurnLastUsage: null,
    selectedModel: '',
    selectedEffort: undefined,
    modelUserChosen: false,
    effortUserChosen: false,
    selectedCodexModel: '',
    selectedCodexReasoningEffort: undefined,
    codexModelUserChosen: false,
    codexReasoningEffortUserChosen: false,
    selectedCodexPermissionPreset: 'default',
    selectedCodexCollaborationMode: 'default',
    codexPlanRejectHintActive: false,
    chatInputFocusNonce: 0,
    preferredProvider: 'claude',
    draftText: '',
    promptSuggestion: null,
    attachments: [],
    mentions: [],
    pendingPermissions: [],
    permissionMode: 'default',
    pendingQuestion: null,
    pendingPlanApproval: null,
    planApprovalOutcome: null,
    slashCommandOutput: null,
    _streamingToolInputPreviews: {},
    _pendingSlashCommand: '',
    todos: {},
    showTodos: false,
    _todosUserDismissed: false,
    _nextTodoId: 1,
    isCompacting: false,
    rateLimitInfo: null,
    _worktreeBaseBranch: null,
    _worktreePath: null,
    _worktreeRemoved: false,
    additionalDirs: [],
    apiRetry: null,
    lastEventAt: 0,
    queuedMessages: [],
    activeCodexMessageId: null,
    lastAssistantMessageId: null,
    miniAppContexts: {},
    userSelections: [],
    _historyHydrated: true,
  }
}

export function getDefaultEffortForModel(model?: ModelOption): EffortLevel | undefined {
  const levels = model?.supportedEffortLevels
  if (!levels?.length) return undefined
  if (levels.includes('xhigh')) return 'xhigh'
  if (levels.includes('medium')) return 'medium'
  return levels[0]
}

function resolveDefaultClaudeModel(models: ModelOption[]): ModelOption | undefined {
  const preferredId = _cachedDefaultClaudeSelection?.modelId
  if (preferredId) {
    const match = models.find((m) => m.id === preferredId)
    if (match) return match
  }
  return models[0]
}

function resolveDefaultClaudeEffort(model: ModelOption | undefined): EffortLevel | undefined {
  const preferredEffort = _cachedDefaultClaudeSelection?.effort
  const supported = model?.supportedEffortLevels
  if (preferredEffort && supported?.includes(preferredEffort)) {
    return preferredEffort
  }
  return getDefaultEffortForModel(model)
}

function applyDefaultModel(session: PerSessionState, models: ModelOption[]): void {
  const defaultModel = resolveDefaultClaudeModel(models)
  if (defaultModel) {
    session.selectedModel = defaultModel.id
    const effort = resolveDefaultClaudeEffort(defaultModel)
    if (effort) session.selectedEffort = effort
  }
}

export function createDefaultProjectState(): ProjectState {
  return {
    _activeSessionId: null,
    _sessions: {},
    slashCommands: [],
    _projectSkills: [],
    _projectCommands: [],
    agents: [],
    homedir: '',
    sandboxInfo: { enabled: true, autoAllowBash: false },
    sessions: [],
    sessionsPage: 0,
    sessionsHasMore: true,
    showHistory: false,
    hasUnseenActivity: false,
    hasPendingInteraction: false,
    unseenCompletedSessions: new Set(),
    codexModels: [],
    codexModelsLoading: false,
    projectAdditionalDirs: [],
    showDirManager: false,
    showReviewPanel: false,
  }
}

// --- Store interface ---

export interface ToolRendererState {
  callId: string
  appId: string
  toolSlug: string
  toolName: string
  toolUseId: string | null
  templateUrl: string
  agentInput: Record<string, unknown>
  status: 'awaiting' | 'submitted' | 'cancelled'
}

interface ChatStore {
  projectSessions: Record<string, ProjectState>
  activeProject: string | null
  remoteSessions: Record<string, string[]>

  // Bash output live content (not persisted)
  _bashOutputs: Record<string, { content: string; finished: boolean; outputPath?: string }>

  // Tool-intercept renderers keyed by MCP callId (global, not per-session)
  toolRenderers: Record<string, ToolRendererState>
  openToolIntercept: (state: ToolRendererState) => void
  submitToolIntercept: (callId: string, userInput: Record<string, unknown>) => void
  cancelToolIntercept: (callId: string, reason?: string) => void
  clearAllToolIntercepts: () => void

  // Global UI state (not per-session)
  isOpen: boolean
  corner: Corner
  availableModels: ModelOption[]
  cachedCodexModels: ModelOption[]
  account: AccountInfo
  globalSlashCommands: SlashCommandInfo[]
  userSkills: SlashCommandInfo[]
  userCommands: SlashCommandInfo[]
  userAgents: AgentInfo[]
  availableOutputStyles: string[]
  disabledSkills: string[]

  // Global resource setter
  setGlobalResources: (
    models: ModelOption[],
    account: AccountInfo,
    slashCommands: SlashCommandInfo[],
    userSkills: SlashCommandInfo[],
    userCommands: SlashCommandInfo[],
    userAgents: AgentInfo[],
    codexModels?: ModelOption[],
    availableOutputStyles?: string[],
  ) => void
  setDisabledSkills: (list: string[]) => void

  // Event handling
  handleAgentEvent: (event: AgentEvent) => void
  syncLiveSnapshots: () => Promise<void>

  // Project switching
  switchProject: (projectPath: string) => Promise<void>
  ensureSession: (projectPath: string) => void

  // Message actions (operate on activeProject)
  sendMessage: (content: string, segments?: Array<{ text: string; isPaste: boolean }>) => Promise<void>
  approveCodexPlan: () => Promise<void>
  rejectCodexPlan: (feedback?: string) => Promise<void>
  interrupt: () => Promise<void>
  disconnectRemoteSession: () => void

  // UI actions
  toggleOpen: () => void
  setCorner: (corner: Corner) => void
  clearMessages: () => void
  resetSession: () => Promise<void>
  resetSessionForWorktreeSwitch: (projectPath: string, opts?: { wtPath?: string; gitBranch?: string | null }) => void
  removeSessionFromMemory: (projectPath: string, sessionId: string) => void
  rewindFiles: (userMessageId: string) => Promise<RewindFilesResult>
  rewindCodeAndChat: (userMessageId: string) => Promise<RewindFilesResult>
  rewindConversation: (userMessageId: string) => Promise<RewindFilesResult>
  previewRewind: (checkpointId: string) => Promise<RewindFilesResult>

  // Queued message actions
  editQueuedMessage: (messageId: string) => void
  deleteQueuedMessage: (messageId: string) => void

  // Draft text
  setDraftText: (text: string) => void

  // Context usage detail (per-session, in-memory)
  setDetailedUsage: (projectPath: string, sessionId: string, usage: ContextUsageInfo | null) => void

  // Model actions
  setSelectedModel: (model: string) => void
  setSelectedEffort: (effort?: EffortLevel) => void
  setFastMode: (enabled: boolean) => void
  setSelectedCodexModel: (model: string) => void
  setSelectedCodexReasoningEffort: (effort?: CodexReasoningEffort) => void
  setSelectedCodexPermissionPreset: (preset: CodexPermissionPreset) => void
  setSelectedCodexCollaborationMode: (mode: CodexCollaborationMode) => void
  refreshCodexModels: (force?: boolean) => Promise<void>
  setPreferredProvider: (provider: ChatProvider) => void

  // Attachment actions
  addAttachment: (attachment: ImageAttachment) => void
  removeAttachment: (index: number) => void
  clearAttachments: () => void

  // Permission actions
  respondToPermission: (requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[], decision?: 'cancel') => Promise<boolean>
  setPermissionMode: (mode: PermissionMode) => Promise<void>
  cyclePermissionMode: () => void
  togglePlanModeShortcut: () => void
  setSandboxMode: (mode: SandboxMode) => Promise<void>

  // Question actions
  answerQuestion: (requestId: string, answers: Record<string, string>, annotations?: QuestionAnnotations) => void
  dismissQuestion: (requestId: string) => void

  // Plan approval
  respondToPlanApproval: (requestId: string, approved: boolean, feedback?: string, postApprovalMode?: PermissionMode) => void

  // Slash command actions
  dismissSlashCommandOutput: () => void

  // Todo
  toggleTodos: () => void

  // Mention chips
  addMention: (mention: Mention) => void
  removeMention: (value: string) => void

  // Session history
  fetchSessions: () => Promise<void>
  fetchSessionsPage: () => Promise<void>
  toggleHistory: () => void
  switchSession: (sessionId: string) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>

  // Mini-app context
  setMiniAppContext: (appId: string, data: { appName: string; summary: string; content: string; mode: 'inject' | 'suggest'; color?: string }) => void
  clearMiniAppContext: (appId: string) => void
  toggleMiniAppContext: (appId: string) => void

  // User selection chip (from right-click "添加到聊天")
  addUserSelection: (text: string) => void
  removeUserSelectionAt: (index: number) => void
  clearUserSelections: () => void

  // Additional directories
  addDir: (path: string, scope: 'session' | 'project') => void
  removeDir: (path: string, scope: 'session' | 'project') => void
  setShowDirManager: (show: boolean) => void
  setShowReviewPanel: (show: boolean) => void
  startCodexReview: (target: CodexReviewTarget) => void
}

// --- Helper: get or create session state for a project ---

function getProject(state: ChatStore, projectPath?: string | null): ProjectState {
  const key = projectPath ?? state.activeProject
  if (!key) return createDefaultProjectState()
  return state.projectSessions[key] ?? createDefaultProjectState()
}

function getActivePerSession(state: ChatStore, projectPath?: string | null): PerSessionState {
  const proj = getProject(state, projectPath)
  if (!proj._activeSessionId) return createDefaultPerSessionState()
  return proj._sessions[proj._activeSessionId] ?? createDefaultPerSessionState()
}

function mergeProjectAndSessionDirs(project: ProjectState, session: PerSessionState): string[] {
  return [...new Set([...project.projectAdditionalDirs, ...session.additionalDirs])]
}

function triggerPrewarm(state: ChatStore, projectPath?: string | null): void {
  const key = projectPath ?? state.activeProject
  if (!key) return
  const session = getActivePerSession(state, key)
  const provider = session.sessionProvider ?? session.preferredProvider
  if (typeof window.agent?.prewarm !== 'function') return
  const dirs = mergeProjectAndSessionDirs(getProject(state, key), session)
  const project = getProject(state, key)
  const hint: AgentPrewarmHint = {
    provider,
    model: provider === 'codex' ? session.selectedCodexModel || undefined : session.selectedModel || undefined,
    effort: provider === 'claude' ? session.selectedEffort : undefined,
    additionalDirs: dirs.length > 0 ? dirs : undefined,
    sessionId: project._activeSessionId ?? undefined,
  }
  void window.agent.prewarm(key, hint).catch(() => {})
}

function updateProjectState(
  state: ChatStore,
  projectPath: string,
  updater: (p: ProjectState) => Partial<ProjectState>,
): Partial<ChatStore> {
  const project = state.projectSessions[projectPath] ?? createDefaultProjectState()
  const updates = updater(project)
  return {
    projectSessions: {
      ...state.projectSessions,
      [projectPath]: { ...project, ...updates },
    },
  }
}

function updatePerSession(
  state: ChatStore,
  projectPath: string,
  sessionId: string,
  updater: (s: PerSessionState) => Partial<PerSessionState>,
): Partial<ChatStore> {
  const project = state.projectSessions[projectPath] ?? createDefaultProjectState()
  const session = project._sessions[sessionId] ?? createDefaultPerSessionState()
  const updates = updater(session)
  return {
    projectSessions: {
      ...state.projectSessions,
      [projectPath]: {
        ...project,
        _sessions: {
          ...project._sessions,
          [sessionId]: { ...session, ...updates },
        },
      },
    },
  }
}

function updateActivePerSession(
  state: ChatStore,
  updater: (s: PerSessionState) => Partial<PerSessionState>,
): Partial<ChatStore> {
  const key = state.activeProject
  if (!key) return {}
  const project = state.projectSessions[key] ?? createDefaultProjectState()
  const sid = project._activeSessionId
  if (!sid) return {}
  return updatePerSession(state, key, sid, updater)
}

function resolveActiveSessionId(project: ProjectState): string | null {
  return project._activeSessionId ?? null
}

export function upsertCodexItem(items: CodexThreadItem[], next: CodexThreadItem): CodexThreadItem[] {
  const idx = items.findIndex((item) => item.id === next.id)
  if (idx === -1) return [...items, next]
  const cloned = [...items]
  cloned[idx] = next
  return cloned
}

export function removeCodexItem(items: CodexThreadItem[], itemId: string): CodexThreadItem[] {
  return items.filter((item) => item.id !== itemId)
}

function pruneTransientCodexItems(items: CodexThreadItem[]): CodexThreadItem[] {
  return items
}

function getCodexTraceTextLength(item: CodexThreadItem): number | undefined {
  switch (item.type) {
    case 'agent_message':
    case 'reasoning':
    case 'plan':
    case 'review':
      return item.text.length
    default:
      return undefined
  }
}

function summarizeCodexTraceItem(item: CodexThreadItem): { id: string; type: CodexThreadItem['type']; textLen?: number } {
  const textLen = getCodexTraceTextLength(item)
  return textLen === undefined
    ? { id: item.id, type: item.type }
    : { id: item.id, type: item.type, textLen }
}

function getCodexTraceItems(message: ChatMessage | undefined | null): {
  length: number
  tail: Array<{ id: string; type: CodexThreadItem['type']; textLen?: number }>
} {
  const items = message?.metadata?.codex?.items ?? []
  return {
    length: items.length,
    tail: items.slice(-3).map(summarizeCodexTraceItem),
  }
}

function getCodexContextTokens(usage: CodexUsageInfo): number {
  return usage.lastInputTokens
}

function getCodexUsageStepTokens(usage: CodexUsageInfo): { input: number; output: number } {
  return {
    input: Math.max(0, usage.lastInputTokens - usage.lastCachedInputTokens),
    output: usage.lastOutputTokens,
  }
}

function hasValidCodexUsageSnapshot(usage: CodexUsageInfo | null): usage is CodexUsageInfo {
  return Boolean(
    usage
      && Number.isFinite(usage.totalInputTokens)
      && Number.isFinite(usage.totalCachedInputTokens)
      && Number.isFinite(usage.totalOutputTokens)
      && Number.isFinite(usage.lastInputTokens)
      && Number.isFinite(usage.lastCachedInputTokens)
      && Number.isFinite(usage.lastOutputTokens)
  )
}

function isSameCodexUsageSnapshot(a: CodexUsageInfo | null, b: CodexUsageInfo | null): boolean {
  return Boolean(
    hasValidCodexUsageSnapshot(a)
      && hasValidCodexUsageSnapshot(b)
      && a.totalInputTokens === b.totalInputTokens
      && a.totalCachedInputTokens === b.totalCachedInputTokens
      && a.totalOutputTokens === b.totalOutputTokens
      && a.lastInputTokens === b.lastInputTokens
      && a.lastCachedInputTokens === b.lastCachedInputTokens
      && a.lastOutputTokens === b.lastOutputTokens
  )
}

export function accumulateCodexFooterTokens(
  current: { input: number; output: number },
  usage: CodexUsageInfo,
  previous: CodexUsageInfo | null,
): { input: number; output: number } {
  if (!hasValidCodexUsageSnapshot(usage) || isSameCodexUsageSnapshot(usage, previous)) {
    return current
  }
  const step = getCodexUsageStepTokens(usage)
  return {
    input: current.input + step.input,
    output: current.output + step.output,
  }
}

export function findLatestCodexUsage(messages: ChatMessage[]): CodexUsageInfo | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = messages[i].metadata?.codex?.usage
    if (hasValidCodexUsageSnapshot(usage as CodexUsageInfo | null)) return usage as CodexUsageInfo
  }
  return null
}

function getCodexCompletionEventMeta(metadata: ChatMessage['metadata'] | undefined): {
  finalResponse?: string
  durationMs?: number
  threadId: string | null
  usage: CodexUsageInfo | null
  items: CodexThreadItem[]
} | null {
  const rawCodex = metadata?.codex
  if (!rawCodex || typeof rawCodex !== 'object') return null
  const codex = rawCodex as unknown as Record<string, unknown>
  return {
    finalResponse: typeof codex.finalResponse === 'string' ? codex.finalResponse : undefined,
    durationMs: typeof codex.durationMs === 'number' && Number.isFinite(codex.durationMs) ? codex.durationMs : undefined,
    threadId: typeof codex.threadId === 'string' || codex.threadId === null ? codex.threadId : null,
    usage: hasValidCodexUsageSnapshot(codex.usage as CodexUsageInfo | null) ? codex.usage as CodexUsageInfo : null,
    items: Array.isArray(codex.items) ? codex.items as CodexThreadItem[] : [],
  }
}

// --- Apply agent event to a session (pure function) ---

function _patchAgentBlock(messages: ChatMessage[], tid: string, patch: Record<string, unknown>): ChatMessage[] {
  return messages.map((msg) => ({
    ...msg,
    content: msg.content.map((block) =>
      block.type === 'tool_use' && block.toolName === 'Agent' && block.toolUseId === tid
        ? { ...block, ...patch }
        : block,
    ),
  }))
}

function applyEventToSession(session: PerSessionState, event: AgentEvent): Partial<PerSessionState> {
  switch (event.type) {
    case 'queued_message_consumed': {
      const idx = session.queuedMessages.findIndex((m) => m.id === event.clientMessageId)
      if (idx === -1) return {}
      const consumed = session.queuedMessages[idx]
      return {
        messages: [...session.messages, consumed],
        queuedMessages: session.queuedMessages.filter((_, i) => i !== idx),
        awaitingAssistantReply: true,
        lastEventAt: Date.now(),
      }
    }

    case 'message_start': {
      const existingIdx = session.messages.findIndex((m) => m.id === event.message.id)
      const nextMessages = existingIdx === -1
        ? [...session.messages, event.message]
        : session.messages.map((m, i) => (i === existingIdx ? { ...m, ...event.message } : m))
      return {
        messages: nextMessages,
        promptSuggestion: null,
        awaitingAssistantReply: false,
        lastEventAt: Date.now(),
        ...(event.message.role === 'assistant'
          ? { lastAssistantMessageId: event.message.id, streamingTokens: { input: 0, output: 0 } }
          : {}),
      }
    }

    case 'user_message_appended': {
      if (session.messages.some((m) => m.id === event.message.id)) return {}
      return {
        messages: [...session.messages, event.message],
        lastEventAt: Date.now(),
      }
    }

    case 'content_delta': {
      const targetMsg = session.messages.find((m) => m.id === event.messageId)
      if (targetMsg && isReplayedEventForMessage(event, targetMsg)) {
        return { lastEventAt: Date.now() }
      }
      let updatedMessages = session.messages.map((msg) => {
        if (msg.id !== event.messageId) return msg
        return {
          ...msg,
          content: applyDelta(msg.content, event.delta),
          ...applySeqToMessage(event),
        }
      })

      let extraUpdates: Partial<PerSessionState> = {}
      if (session.apiRetry) extraUpdates.apiRetry = null

      if (event.delta.type === 'tool_use' && event.delta.toolUseId && event.delta.input) {
        streamingToolInputRaw.delete(event.delta.toolUseId)
        streamingPreviewLastUpdate.delete(event.delta.toolUseId)
        if (session._streamingToolInputPreviews[event.delta.toolUseId]) {
          const { [event.delta.toolUseId]: _, ...rest } = session._streamingToolInputPreviews
          extraUpdates._streamingToolInputPreviews = rest
        }
      }

      if (event.delta.type === 'tool_result') {
        const resultDelta = event.delta
        const streamingInput = streamingToolInputRaw.get(resultDelta.toolUseId)
        updatedMessages = persistStreamingToolInput(updatedMessages, event.messageId, resultDelta.toolUseId, streamingInput)
        streamingToolInputRaw.delete(resultDelta.toolUseId)
        streamingPreviewLastUpdate.delete(resultDelta.toolUseId)
        if (session._streamingToolInputPreviews[resultDelta.toolUseId]) {
          const { [resultDelta.toolUseId]: _, ...rest } = session._streamingToolInputPreviews
          extraUpdates._streamingToolInputPreviews = rest
        }
        const msg = updatedMessages.find((m) => m.id === event.messageId)
        const toolBlock = msg?.content.find(
          (b) => b.type === 'tool_use' && b.toolUseId === resultDelta.toolUseId
        )
        if (toolBlock && toolBlock.type === 'tool_use') {
          const tn = toolBlock.toolName
          if (tn === 'TodoWrite' || tn === 'TaskCreate' || tn === 'TaskUpdate') {
            try {
              const input = JSON.parse(toolBlock.input)
              if (tn === 'TodoWrite' && Array.isArray(input.todos)) {
                const newTodos: Record<string, TodoItem> = {}
                for (let i = 0; i < input.todos.length; i++) {
                  const t = input.todos[i]
                  const id = String(i + 1)
                  newTodos[id] = {
                    id,
                    subject: t.content ?? t.subject ?? '',
                    description: t.description ?? '',
                    status: t.status ?? 'pending',
                    activeForm: t.activeForm,
                  }
                }
                extraUpdates = { todos: newTodos, _nextTodoId: input.todos.length + 1, ...(!session._todosUserDismissed && { showTodos: true }) }
              } else if (tn === 'TaskCreate') {
                const id = String(session._nextTodoId)
                extraUpdates = {
                  _nextTodoId: session._nextTodoId + 1,
                  showTodos: !session._todosUserDismissed,
                  todos: {
                    ...session.todos,
                    [id]: {
                      id,
                      subject: input.subject ?? '',
                      description: input.description ?? '',
                      status: 'pending',
                      activeForm: input.activeForm,
                    },
                  },
                }
              } else if (tn === 'TaskUpdate' && input.taskId) {
                const existing = session.todos[input.taskId]
                if (existing) {
                  if (input.status === 'deleted') {
                    const { [input.taskId]: _, ...rest } = session.todos
                    extraUpdates = { todos: rest }
                  } else {
                    extraUpdates = {
                      ...(!session._todosUserDismissed && { showTodos: true }),
                      todos: {
                        ...session.todos,
                        [input.taskId]: {
                          ...existing,
                          ...(input.status && { status: input.status }),
                          ...(input.subject && { subject: input.subject }),
                          ...(input.description && { description: input.description }),
                          ...(input.activeForm && { activeForm: input.activeForm }),
                        },
                      },
                    }
                  }
                }
              }
            } catch { /* ignore malformed JSON */ }
          }


          if (tn === 'EnterPlanMode') {
            extraUpdates = { ...extraUpdates, permissionMode: 'plan' }
          }
          if (tn === 'ExitPlanMode' && session.planApprovalOutcome && !session.planApprovalOutcome.approved) {
            const feedback = session.planApprovalOutcome.feedback?.trim()
            const base = feedback || resultDelta.summary || 'User rejected the plan'
            const summary = base.startsWith('[denied] ') ? base : `[denied] ${base}`
            updatedMessages = updatedMessages.map((m) => {
              if (m.id !== event.messageId) return m
              const nextContent = [...m.content]
              for (let i = nextContent.length - 1; i >= 0; i--) {
                const block = nextContent[i]
                if (block.type === 'tool_result' && block.toolUseId === resultDelta.toolUseId) {
                  nextContent[i] = { ...block, summary }
                  break
                }
              }
              return { ...m, content: nextContent }
            })
          }
        }
      }

      return { messages: updatedMessages, lastEventAt: Date.now(), ...extraUpdates }
    }

    case 'message_complete': {
      const newCost = event.metadata?.costUsd ?? session.totalCostUsd
      const lastAssistantId = session.messages.findLast((m) => m.role === 'assistant')?.id
      const isCurrentTurn = event.messageId === lastAssistantId
      const ft = session.streamingTokens
      const consumedTokens = isCurrentTurn && (ft.input > 0 || ft.output > 0)
        ? { input: ft.input, output: ft.output }
        : undefined
      const codexCompletionMeta = getCodexCompletionEventMeta(event.metadata)
      const completingMsg = session.messages.find((m) => m.id === event.messageId)
      const agentToolIds = new Set<string>()
      if (completingMsg) {
        for (const b of completingMsg.content) {
          if (b.type === 'tool_use' && b.toolName === 'Agent') agentToolIds.add(b.toolUseId)
        }
      }
      const codexUsage = codexCompletionMeta?.usage ?? event.metadata?.codex?.usage ?? null
      const hasUncompletedAgents = agentToolIds.size > 0 && [...agentToolIds].some((id) => !session.taskProgress[id]?.completed)
      return {
        messages: session.messages.map((msg) => {
          if (msg.id !== event.messageId) return msg
          const prevCodex = msg.metadata?.codex
          const nextMetadata = codexCompletionMeta
            ? {
                ...msg.metadata,
                ...event.metadata,
                ...(codexCompletionMeta.durationMs !== undefined ? { durationMs: codexCompletionMeta.durationMs } : {}),
                codex: {
                  threadId: codexCompletionMeta.threadId ?? prevCodex?.threadId ?? null,
                  usage: codexCompletionMeta.usage ?? prevCodex?.usage ?? null,
                  items: codexCompletionMeta.items.length > 0 ? codexCompletionMeta.items : (prevCodex?.items ?? []),
                  ...(prevCodex?.planApproval ? { planApproval: prevCodex.planApproval } : {}),
                },
                ...(consumedTokens ? { consumedTokens } : {}),
              }
            : { ...msg.metadata, ...event.metadata, ...(consumedTokens ? { consumedTokens } : {}) }
          return {
            ...msg,
            status: 'complete' as const,
            ...(codexCompletionMeta?.finalResponse ? { content: [{ type: 'text', text: codexCompletionMeta.finalResponse }] } : {}),
            metadata: nextMetadata,
          }
        }),
        totalCostUsd: newCost,
        contextTokens: (() => {
          if (codexUsage) {
            const total = getCodexContextTokens(codexUsage)
            return total > 0 ? total : session.contextTokens
          }
          const u = event.metadata?.usage
          if (!u) return session.contextTokens
          const total = u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens
          return total > 0 ? total : session.contextTokens
        })(),
        ...(codexUsage ? {
          contextWindow: codexUsage.contextWindow > 0 ? codexUsage.contextWindow : session.contextWindow,
          codexUsageSnapshot: codexUsage,
          codexTurnLastUsage: null,
        } : {
          contextWindow: (() => {
            const mu = event.metadata?.modelUsage
            if (!mu) return session.contextWindow
            const cw = Math.max(...Object.values(mu).map((u) => u.contextWindow ?? 0))
            return cw > 0 ? cw : session.contextWindow
          })(),
        }),
        awaitingAssistantReply: false,
        ...(isCurrentTurn ? { streamingTokens: { input: 0, output: 0 }, lastEventAt: 0 } : {}),
        ...(hasUncompletedAgents ? {
          taskProgress: {
            ...session.taskProgress,
            ...Object.fromEntries(
              [...agentToolIds]
                .filter(id => !session.taskProgress[id]?.completed)
                .map(id => [id, {
                  ...(session.taskProgress[id] ?? {
                    description: '',
                    totalTokens: 0,
                    toolUses: 0,
                    durationMs: 0,
                    toolHistory: [],
                  }),
                  completed: true,
                }])
            ),
          },
        } : {}),
      }
    }

    case 'message_interrupted': {
      const ft = session.streamingTokens
      const consumedTokens = ft.input > 0 || ft.output > 0
        ? { input: ft.input, output: ft.output }
        : undefined
      return {
        messages: session.messages.map((msg) => {
          if (msg.id !== event.messageId) return msg
          const nextMeta = {
            ...msg.metadata,
            ...(event.metadata ?? {}),
            ...(consumedTokens ? { consumedTokens } : {}),
          }
          return {
            ...msg,
            status: 'interrupted' as const,
            metadata: nextMeta,
          }
        }),
        pendingPermissions: [],
        pendingQuestion: null,
        pendingPlanApproval: null,
        awaitingAssistantReply: false,
        lastEventAt: 0,
        streamingTokens: { input: 0, output: 0 },
      }
    }

    case 'message_error':
      return {
        awaitingAssistantReply: false,
        lastEventAt: 0,
        streamingTokens: { input: 0, output: 0 },
        messages: session.messages.map((msg) => {
          if (msg.id !== event.messageId) return msg
          return {
            ...msg,
            status: 'error' as const,
            content: [...msg.content, { type: 'text' as const, text: `Error: ${event.error}` }],
          }
        }),
      }

    case 'status_change':
      if ((event.status === 'idle' || event.status === 'error') && session.queuedMessages.length > 0) {
        const lastAsstIdx = session.messages.findLastIndex((m) => m.role === 'assistant')
        const insertAt = lastAsstIdx >= 0 ? lastAsstIdx : session.messages.length
        return {
          status: event.status,
          apiRetry: null,
          messages: [
            ...session.messages.slice(0, insertAt),
            ...session.queuedMessages,
            ...session.messages.slice(insertAt),
          ],
          queuedMessages: [],
        }
      }
      return { status: event.status, ...(event.status === 'idle' ? { apiRetry: null } : {}) }

    case 'prompt_suggestion':
      return { promptSuggestion: event.suggestion }

    case 'permission_request':
      if (session.pendingPermissions.some((p) => p.requestId === event.request.requestId)) return {}
      return { pendingPermissions: [...session.pendingPermissions, event.request] }

    case 'permission_mode_change':
      return { permissionMode: event.mode }

    case 'interaction_resolved':
      switch (event.interactionType) {
        case 'permission':
          return { pendingPermissions: session.pendingPermissions.filter((p) => p.requestId !== event.requestId) }
        case 'question':
          if (session.pendingQuestion?.requestId === event.requestId) return { pendingQuestion: null }
          return {}
        case 'plan_approval':
          if (session.pendingPlanApproval?.requestId === event.requestId) return { pendingPlanApproval: null }
          return {}
      }
      return {}

    case 'session_init':
      console.log('[applyEvent] session_init', { sessionId: event.session?.sessionId, outputStyle: event.session?.outputStyle, availableOutputStyles: event.session?.availableOutputStyles })
      return { session: event.session, sessionProvider: session.sessionProvider ?? DEFAULT_PROVIDER }

    case 'ask_user_question':
      return { pendingQuestion: event.request }

    case 'plan_approval':
      return { pendingPlanApproval: event.request }

    case 'tool_input_delta': {
      const targetMsg = session.messages.find((m) => m.id === event.messageId)
      if (targetMsg && isReplayedEventForMessage(event, targetMsg)) {
        return { lastEventAt: Date.now() }
      }
      const targetBlock = targetMsg?.content.find(
        (b) => b.type === 'tool_use' && b.toolUseId === event.toolUseId
      )
      window.app?.trace?.('widget.store', 'tool_input_delta', {
        toolUseId: event.toolUseId,
        toolName: targetBlock?.type === 'tool_use' ? targetBlock.toolName : null,
        partialLen: event.partialJson.length,
        matchesWidget: targetBlock?.type === 'tool_use' && targetBlock.toolName.endsWith('__show_widget'),
      })
      const shouldAccumulate = targetBlock?.type === 'tool_use' && (
        targetBlock.toolName.endsWith('__show_widget') ||
        STREAMING_INPUT_TOOLS.has(targetBlock.toolName)
      )
      if (shouldAccumulate) {
        if (targetBlock?.type === 'tool_use' && STREAMING_INPUT_TOOLS.has(targetBlock.toolName)) {
          const nextRaw = (streamingToolInputRaw.get(event.toolUseId) ?? '') + event.partialJson
          streamingToolInputRaw.set(event.toolUseId, nextRaw)
          const now = Date.now()
          const hasPrev = !!session._streamingToolInputPreviews[event.toolUseId]
          const addsCommittedLine = event.partialJson.includes('\\n') || event.partialJson.includes('\n')
          const lastUpdate = streamingPreviewLastUpdate.get(event.toolUseId) ?? 0
          const shouldExtract = !hasPrev || addsCommittedLine || (now - lastUpdate) >= STREAMING_PREVIEW_THROTTLE_MS
          const appliedMessages = markMessageEventApplied(session.messages, event.messageId, event)
          if (!shouldExtract) {
            return { lastEventAt: now, ...(appliedMessages ? { messages: appliedMessages } : {}) }
          }
          streamingPreviewLastUpdate.set(event.toolUseId, now)
          const nextPreview = extractPartialToolInput(nextRaw, targetBlock.toolName)
          return {
            lastEventAt: now,
            ...(appliedMessages ? { messages: appliedMessages } : {}),
            _streamingToolInputPreviews: {
              ...session._streamingToolInputPreviews,
              [event.toolUseId]: nextPreview,
            },
          }
        }
        return {
          lastEventAt: Date.now(),
          messages: session.messages.map((msg) => {
            if (msg.id !== event.messageId) return msg
            return {
              ...msg,
              content: msg.content.map((b) =>
                b.type === 'tool_use' && b.toolUseId === event.toolUseId
                  ? { ...b, input: b.input + event.partialJson }
                  : b
              ),
              ...applySeqToMessage(event),
            }
          }),
        }
      }
      return { lastEventAt: Date.now() }
    }

    case 'tool_progress':
      return {
        lastEventAt: Date.now(),
        messages: session.messages.map((msg) => {
          if (msg.id !== event.messageId) return msg
          return {
            ...msg,
            content: msg.content.map((block) => {
              if (block.type === 'tool_use' && block.toolUseId === event.toolUseId) {
                return { ...block, elapsedSeconds: event.elapsedSeconds }
              }
              return block
            }),
          }
        }),
      }

    case 'init_ready':
      return { permissionMode: event.permissionMode }

    case 'worktree_missing':
      return { _worktreeRemoved: true, cwd: event.fallbackCwd }

    case 'compact_boundary': {
      const msgs = [...session.messages]
      let insertIdx = msgs.length
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') {
          insertIdx = i
          break
        }
      }
      msgs.splice(insertIdx, 0, {
        id: `compact_${Date.now()}`,
        role: 'assistant' as const,
        status: 'complete' as const,
        content: [{ type: 'text' as const, text: `__compact__:${event.trigger}:${event.preTokens}` }],
        createdAt: new Date().toISOString(),
        providerId: 'system',
      })
      return { isCompacting: false, messages: msgs }
    }

    case 'subagent_usage':
      return {
        subagentTokens: {
          ...session.subagentTokens,
          [event.parentToolUseId]: { input: event.inputTokens, output: event.outputTokens },
        },
      }

    case 'message_usage': {
      const usageTarget = session.messages.find((m) => m.id === event.messageId)
      if (usageTarget && isReplayedEventForMessage(event, usageTarget)) {
        return { lastEventAt: Date.now() }
      }
      const messagesWithSeq = usageTarget
        ? session.messages.map((m) => (m.id === event.messageId ? { ...m, ...applySeqToMessage(event) } : m))
        : session.messages
      if (event.codexUsage) {
        const nextStreamingTokens = accumulateCodexFooterTokens(session.streamingTokens, event.codexUsage, session.codexTurnLastUsage)
        return {
          lastEventAt: Date.now(),
          streamingTokens: nextStreamingTokens,
          contextTokens: (() => {
            const total = getCodexContextTokens(event.codexUsage)
            return total > 0 ? total : session.contextTokens
          })(),
          contextWindow: event.codexUsage.contextWindow > 0 ? event.codexUsage.contextWindow : session.contextWindow,
          codexUsageSnapshot: event.codexUsage,
          codexTurnLastUsage: event.codexUsage,
          messages: messagesWithSeq,
        }
      }
      return { lastEventAt: Date.now(), streamingTokens: { input: event.inputTokens, output: event.outputTokens }, messages: messagesWithSeq }
    }

    case 'codex_thread_started': {
      const target = session.messages.find((m) => m.id === event.messageId)
      if (target && isReplayedEventForMessage(event, target)) {
        return { lastEventAt: Date.now() }
      }
      return {
        lastEventAt: Date.now(),
        messages: session.messages.map((msg) => {
          if (msg.id !== event.messageId) return msg
          const prevCodex = msg.metadata?.codex ?? { threadId: null, usage: null, items: [] }
          return {
            ...msg,
            metadata: {
              ...msg.metadata,
              codex: {
                ...prevCodex,
                threadId: event.threadId,
              },
            },
            ...applySeqToMessage(event),
          }
        }),
      }
    }

    case 'codex_item_delta': {
      const target = session.messages.find((m) => m.id === event.messageId)
      if (target && isReplayedEventForMessage(event, target)) {
        return { lastEventAt: Date.now() }
      }
      return {
        lastEventAt: Date.now(),
        messages: session.messages.map((msg) => {
          if (msg.id !== event.messageId) return msg
          const prevCodex = msg.metadata?.codex ?? { threadId: null, usage: null, items: [] }
          const nextItems = upsertCodexItem(prevCodex.items, event.item)
          return {
            ...msg,
            metadata: {
              ...msg.metadata,
              codex: {
                ...prevCodex,
                items: nextItems,
              },
            },
            ...applySeqToMessage(event),
          }
        }),
      }
    }

    case 'slash_command_output': {
      const cmd = session._pendingSlashCommand
      const filtered = session.messages.filter((m) => m.id !== event.messageId)
      if (cmd === 'compact') {
        const lastUserIdx = filtered.findLastIndex((m) => m.role === 'user')
        if (lastUserIdx >= 0) filtered.splice(lastUserIdx, 1)
        return { _pendingSlashCommand: '', messages: filtered }
      }
      if (import.meta.env.DEV && import.meta.env.RENDERER_VITE_DEBUG_SLASH_OUTPUT === '1') {
        const debugText = `\`\`\`\n/${cmd}\n\n${event.content}\n\`\`\``
        const debugMsg: ChatMessage = {
          id: `slash-debug-${Date.now()}`,
          role: 'assistant',
          content: [{ type: 'text', text: debugText }],
          status: 'complete',
          createdAt: new Date().toISOString(),
          providerId: 'claude',
        }
        return { _pendingSlashCommand: '', messages: [...filtered, debugMsg] }
      }
      const hintMsg: ChatMessage = {
        id: `slash-hint-${Date.now()}`,
        role: 'assistant',
        content: [{ type: 'text', text: `Command /${cmd} executed.` }],
        status: 'complete',
        createdAt: new Date().toISOString(),
        providerId: 'claude',
      }
      return {
        slashCommandOutput: { command: cmd, content: event.content, mode: getCommandOutputMode(cmd) },
        _pendingSlashCommand: '',
        messages: [...filtered, hintMsg],
      }
    }

    case 'status_indicator':
      return { isCompacting: event.indicator === 'compacting' }

    case 'rate_limit':
      return {
        rateLimitInfo: event.status === 'allowed'
          ? null
          : { status: event.status, resetsAt: event.resetsAt, rateLimitType: event.rateLimitType, utilization: event.utilization },
      }

    case 'checkpoint_captured': {
      const msgs = [...session.messages]
      let targetIdx = findCheckpointTarget(msgs, event.messageId)
      if (targetIdx === -1) return {}
      if (msgs[targetIdx].checkpointId) {
        const laterIdx = msgs.findLastIndex((m, i) => i > targetIdx && m.role === 'user' && !m.checkpointId)
        if (laterIdx !== -1) targetIdx = laterIdx
      }
      msgs[targetIdx] = { ...msgs[targetIdx], checkpointId: event.checkpointId, resumePointId: event.resumePointId }
      return { messages: msgs }
    }

    case 'task_notification': {
      if (!event.toolUseId) return {}
      const tid = event.toolUseId
      const file = event.outputFile
      const prevProgress = session.taskProgress[tid]
      const usageUpdate = event.usage ? {
        totalTokens: event.usage.totalTokens,
        toolUses: event.usage.toolUses,
        durationMs: event.usage.durationMs,
      } : {}
      const finalSummary = event.summary || prevProgress?.summary
      const finalUsage = event.usage ?? { totalTokens: prevProgress?.totalTokens ?? 0, toolUses: prevProgress?.toolUses ?? 0, durationMs: prevProgress?.durationMs ?? 0 }
      const finalToolHistory = prevProgress?.toolHistory ?? []
      const agentPatch = {
        taskUsage: { totalTokens: finalUsage.totalTokens, toolUses: finalUsage.toolUses, durationMs: finalUsage.durationMs },
        taskToolHistory: finalToolHistory,
        taskSummary: finalSummary,
      }
      const msgs = session.messages.map((msg) => ({
        ...msg,
        content: msg.content.map((block) => {
          if (block.type === 'tool_use' && block.toolName === 'Agent' && block.toolUseId === tid) return { ...block, ...agentPatch }
          if (file && block.type === 'tool_result' && block.toolUseId === tid) return { ...block, outputPath: file }
          return block
        }),
      }))
      return {
        messages: msgs,
        taskProgress: {
          ...session.taskProgress,
          [tid]: {
            ...(prevProgress ?? { description: '', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] }),
            ...usageUpdate,
            completed: true,
            outputFile: file || prevProgress?.outputFile,
            summary: finalSummary,
          },
        },
      }
    }

    case 'task_started': {
      if (!event.toolUseId) return {}
      const prev = session.taskProgress[event.toolUseId]
      return {
        taskProgress: {
          ...session.taskProgress,
          [event.toolUseId]: {
            ...(prev ?? { description: '', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] }),
            description: event.description,
            completed: prev?.completed === true ? true : false,
          },
        },
      }
    }

    case 'task_progress': {
      if (!event.toolUseId) return {}
      const prev = session.taskProgress[event.toolUseId]
      const toolHistory = prev?.toolHistory ? [...prev.toolHistory] : []
      if (prev && prev.description && prev.description !== event.description) {
        toolHistory.push({ toolName: prev.lastToolName ?? '', description: prev.description })
      }
      const progressSummary = event.summary ?? prev?.summary
      return {
        messages: _patchAgentBlock(session.messages, event.toolUseId, {
          taskUsage: { totalTokens: event.usage.totalTokens, toolUses: event.usage.toolUses, durationMs: event.usage.durationMs },
          taskToolHistory: toolHistory,
          taskSummary: progressSummary,
        }),
        taskProgress: {
          ...session.taskProgress,
          [event.toolUseId]: {
            ...(prev ?? { description: '', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] }),
            description: event.description,
            lastToolName: event.lastToolName,
            summary: progressSummary,
            totalTokens: event.usage.totalTokens,
            toolUses: event.usage.toolUses,
            durationMs: event.usage.durationMs,
            toolHistory,
          },
        },
      }
    }

    case 'api_retry':
      return { apiRetry: { attempt: event.attempt, maxRetries: event.maxRetries, delayMs: event.delayMs } }

    case 'hook_started':
    case 'hook_complete':
    case 'hook_progress':
    case 'auth_status':
    case 'assistant_error':
    case 'files_persisted':
    case 'elicitation_complete':
    case 'stream_message_start':
    case 'stream_message_stop':
      return {}
  }
  return {}
}

// --- Auto-save helper ---

const CODEX_LOCAL_SESSION_PREFIX = 'codex_local_'

/** Resolve the effective sessionId for saving from a project state. */
function _getEffectiveSessionId(project: ProjectState): string | null {
  return resolveActiveSessionId(project)
}

function _createLocalCodexSessionId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `${CODEX_LOCAL_SESSION_PREFIX}${ts}_${rand}`
}

/** Extract a title from the first user message for DB storage. */
function _extractTitle(messages: ChatMessage[]): string | undefined {
  const firstUserMsg = messages.find((m) => m.role === 'user')
  return firstUserMsg?.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join(' ')
    .slice(0, 100) || undefined
}

function _getWorktreeBranch(_projectPath: string, session: PerSessionState): string | undefined {
  return session._worktreeBaseBranch ?? undefined
}

function _getSessionCwd(projectPath: string, session: Pick<PerSessionState, '_worktreePath' | '_worktreeRemoved'> | null | undefined): string {
  return session?._worktreePath && !session._worktreeRemoved ? session._worktreePath : projectPath
}

type PersistedSessionState = {
  messages: ChatMessage[]
  totalCostUsd: number
  contextTokens: number
  isWorktree: boolean
  gitBranch: string | null
  worktreePath: string | null
  provider: string
}

function _mergePersistedMessages(savedMessages: ChatMessage[], runtimeMessages: ChatMessage[]): ChatMessage[] {
  const runtimeById = new Map(runtimeMessages.map((message) => [message.id, message]))
  const merged = savedMessages.map((message) => runtimeById.get(message.id) ?? message)
  const seen = new Set(merged.map((message) => message.id))
  for (const message of runtimeMessages) {
    if (seen.has(message.id)) continue
    merged.push(message)
    seen.add(message.id)
  }
  return merged
}

function _mergePersistedSessionState(session: PerSessionState, saved: PersistedSessionState): PerSessionState {
  const mergedMessages = _mergePersistedMessages(saved.messages, session.messages)
  const persistedProvider = saved.provider === 'codex' ? 'codex' : 'claude'
  return {
    ...session,
    messages: mergedMessages,
    totalCostUsd: Math.max(session.totalCostUsd, saved.totalCostUsd),
    contextTokens: Math.max(session.contextTokens, saved.contextTokens),
    sessionProvider: session.sessionProvider ?? persistedProvider,
    preferredProvider: session.sessionProvider ? session.preferredProvider : persistedProvider,
    _worktreeBaseBranch: session._worktreeBaseBranch ?? saved.gitBranch,
    _worktreePath: session._worktreePath ?? saved.worktreePath,
    lastAssistantMessageId: mergedMessages.findLast((message) => message.role === 'assistant')?.id ?? session.lastAssistantMessageId,
    _historyHydrated: true,
  }
}

async function _prepareSessionSnapshot(sessionId: string, session: PerSessionState): Promise<PerSessionState | null> {
  if (session._historyHydrated) return session
  try {
    const saved = await window.app.loadSessionState(sessionId) as PersistedSessionState | null
    if (!saved) return { ...session, _historyHydrated: true }
    return _mergePersistedSessionState(session, saved)
  } catch (err) {
    console.warn('[saveSessionSnapshot] hydrate failed:', err)
    return null
  }
}

type ChatStoreSetter = (updater: (state: ChatStore) => Partial<ChatStore>) => void

function _hydrateSessionState(
  set: ChatStoreSetter,
  projectPath: string,
  sessionId: string,
): void {
  window.app.loadSessionState(sessionId)
    .then((saved) => {
      set((state) => {
        const project = state.projectSessions[projectPath]
        const session = project?._sessions[sessionId]
        if (!project || !session || session._historyHydrated) return {}
        const hydrated = saved
          ? _mergePersistedSessionState(session, saved as PersistedSessionState)
          : { ...session, _historyHydrated: true }
        return {
          projectSessions: {
            ...state.projectSessions,
            [projectPath]: {
              ...project,
              _sessions: { ...project._sessions, [sessionId]: hydrated },
            },
          },
        }
      })
    })
    .catch((err) => console.warn('[sessionHydrate] failed:', err))
}

let _cachedDefaultPermissionMode: PermissionMode | null = null
let _cachedDefaultSandboxMode: SandboxMode | null = null
let _cachedDefaultClaudeSelection: { modelId: string; effort?: EffortLevel } | null = null
let _cachedDefaultCodexSelection: { modelId: string; reasoningEffort?: CodexReasoningEffort } | null = null

function toCodexReasoningEffort(value: unknown): CodexReasoningEffort | undefined {
  switch (value) {
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return value
    default:
      return undefined
  }
}

function toEffortLevel(value: unknown): EffortLevel | undefined {
  switch (value) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return value
    default:
      return undefined
  }
}

async function _loadDefaultSessionPrefs(): Promise<void> {
  try {
    const appSettings = await window.app.getAppSettings()
    const claude = appSettings.agentPreference?.claude
    _cachedDefaultPermissionMode = (claude?.defaultPermissionMode as PermissionMode) || 'default'
    _cachedDefaultSandboxMode = (claude?.defaultSandboxMode as SandboxMode) || null
    _cachedDefaultClaudeSelection = {
      modelId: typeof claude?.defaultModel === 'string' ? claude.defaultModel : '',
      effort: toEffortLevel(claude?.defaultEffort),
    }
    _cachedDefaultCodexSelection = {
      modelId: typeof appSettings.agentPreference?.codex?.defaultModel === 'string' ? appSettings.agentPreference.codex.defaultModel : '',
      reasoningEffort: toCodexReasoningEffort(appSettings.agentPreference?.codex?.defaultReasoningEffort),
    }
  } catch {
    _cachedDefaultPermissionMode = 'default'
    _cachedDefaultSandboxMode = null
    _cachedDefaultClaudeSelection = { modelId: '', effort: undefined }
    _cachedDefaultCodexSelection = { modelId: '', reasoningEffort: undefined }
  }
}
async function _getDefaultPermissionMode(): Promise<PermissionMode> {
  if (_cachedDefaultPermissionMode === null) await _loadDefaultSessionPrefs()
  return _cachedDefaultPermissionMode ?? 'default'
}
function sandboxModeToInfo(mode: SandboxMode): SandboxInfo {
  return { enabled: mode !== 'off', autoAllowBash: mode === 'auto' }
}
_loadDefaultSessionPrefs()

function _clearDefaultPrefsCache(): void {
  _cachedDefaultPermissionMode = null
  _cachedDefaultSandboxMode = null
  _cachedDefaultClaudeSelection = null
  _cachedDefaultCodexSelection = null
}

export function invalidateDefaultPermissionModeCache(): void {
  _clearDefaultPrefsCache()
  _loadDefaultSessionPrefs()
}

export function invalidateDefaultClaudePreferencesCache(): void {
  _clearDefaultPrefsCache()
  void _loadDefaultSessionPrefs().then(() => _reapplyAgentDefaultsToSessions('claude'))
}

export function invalidateDefaultCodexPreferencesCache(): void {
  _clearDefaultPrefsCache()
  void _loadDefaultSessionPrefs().then(() => _reapplyAgentDefaultsToSessions('codex'))
}

function _reapplyAgentDefaultsToSessions(kind: 'claude' | 'codex'): void {
  const state = useChatStore.getState()
  const availableModels = state.availableModels
  const nextProjects: Record<string, ProjectState> = { ...state.projectSessions }
  let changed = false
  for (const [projectPath, project] of Object.entries(state.projectSessions)) {
    const codexModels = project.codexModels
    let projectChanged = false
    const nextSessions: Record<string, PerSessionState> = { ...project._sessions }
    for (const [sid, sess] of Object.entries(project._sessions)) {
      if (kind === 'claude') {
        const patch = _computeClaudeDefaultPatch(sess, availableModels)
        if (patch) {
          nextSessions[sid] = { ...sess, ...patch }
          projectChanged = true
        }
      } else {
        const patch = _computeCodexDefaultPatch(sess, codexModels)
        if (patch) {
          nextSessions[sid] = { ...sess, ...patch }
          projectChanged = true
        }
      }
    }
    if (projectChanged) {
      nextProjects[projectPath] = { ...project, _sessions: nextSessions }
      changed = true
    }
  }
  if (changed) useChatStore.setState({ projectSessions: nextProjects })
}

function _computeClaudeDefaultPatch(sess: PerSessionState, models: ModelOption[]): Partial<PerSessionState> | null {
  if (sess.modelUserChosen && sess.effortUserChosen) return null
  if (models.length === 0) return null
  const patch: Partial<PerSessionState> = {}
  if (!sess.modelUserChosen) {
    const nextModel = resolveDefaultClaudeModel(models)
    if (nextModel && nextModel.id !== sess.selectedModel) patch.selectedModel = nextModel.id
    if (!sess.effortUserChosen) {
      const nextEffort = resolveDefaultClaudeEffort(nextModel)
      if (nextEffort !== sess.selectedEffort) patch.selectedEffort = nextEffort
    }
  } else if (!sess.effortUserChosen) {
    const activeModel = models.find((m) => m.id === sess.selectedModel)
    const nextEffort = resolveDefaultClaudeEffort(activeModel)
    if (nextEffort !== sess.selectedEffort) patch.selectedEffort = nextEffort
  }
  return Object.keys(patch).length === 0 ? null : patch
}

function _computeCodexDefaultPatch(sess: PerSessionState, models: ModelOption[]): Partial<PerSessionState> | null {
  if (sess.codexModelUserChosen && sess.codexReasoningEffortUserChosen) return null
  if (models.length === 0) return null
  const selected = resolveDefaultCodexSelection(models)
  const patch: Partial<PerSessionState> = {}
  if (!sess.codexModelUserChosen && selected.modelId && selected.modelId !== sess.selectedCodexModel) {
    patch.selectedCodexModel = selected.modelId
  }
  if (!sess.codexReasoningEffortUserChosen && selected.reasoningEffort !== sess.selectedCodexReasoningEffort) {
    patch.selectedCodexReasoningEffort = selected.reasoningEffort
  }
  return Object.keys(patch).length === 0 ? null : patch
}

async function _syncAndResumeSession(projectPath: string, sessionId: string, set: ChatStoreSet, cwd: string): Promise<void> {
  const result = await window.app.resumeSession(projectPath, sessionId, cwd)
  if (!result) return
  set((s) => {
    const proj = s.projectSessions[projectPath]
    if (!proj) return {}
    const sess = proj._sessions[sessionId]
    if (!sess) return {}
    return {
      projectSessions: {
        ...s.projectSessions,
        [projectPath]: {
          ...proj,
          sandboxInfo: result.sandboxInfo,
          _sessions: {
            ...proj._sessions,
            [sessionId]: { ...sess, permissionMode: result.permissionMode },
          },
        },
      },
    }
  })
}

function _truncateAtCheckpoint(
  set: (fn: (s: ChatStore) => Partial<ChatStore>) => void,
  _get: () => ChatStore,
  projectPath: string,
  checkpointId: string,
): void {
  set((s) => updateActivePerSession(s, (sess) => {
    const idx = sess.messages.findIndex((m) => m.checkpointId === checkpointId)
    const truncated = idx >= 0 ? sess.messages.slice(0, idx) : sess.messages
    return { messages: truncated, session: null, totalCostUsd: 0, contextTokens: 0 }
  }))
  window.agent.truncateAtCheckpoint(projectPath, checkpointId).catch((err) => {
    console.warn('[chat] truncateAtCheckpoint failed:', err)
  })
}

function _buildQuestionAnswerItem(
  questions: UserQuestion[],
  answers: Record<string, string>,
): CodexAgentMessageItem {
  const lines = questions.map((q) => {
    const key = q.question
    const answer = answers[key]?.trim()
    return `**${q.question}**\n${answer || '_(dismissed)_'}`
  })
  return {
    id: `qa-${Date.now()}`,
    type: 'agent_message',
    text: lines.join('\n\n'),
  }
}

function _computeHasPendingInteraction(project: ProjectState): boolean {
  return Object.values(project._sessions).some(
    (s) => s.pendingPermissions.length > 0 || !!s.pendingQuestion || !!s.pendingPlanApproval,
  )
}

function _isBusyStatus(status: PerSessionState['status']): boolean {
  return status === 'streaming' || status === 'background'
}

function _isLiveSession(session: PerSessionState | undefined): boolean {
  return !!session && (
    _isBusyStatus(session.status)
    || session.pendingPermissions.length > 0
    || !!session.pendingQuestion
    || !!session.pendingPlanApproval
    || !!session.awaitingAssistantReply
  )
}

function _needsForegroundActivation(session: PerSessionState): boolean {
  return _isBusyStatus(session.status) || session.pendingPermissions.length > 0 || !!session.pendingQuestion || !!session.pendingPlanApproval
}

let _resetSessionLock: Promise<void> | null = null

function _parkActiveSession(projectPath: string, _activeSessionId: string | null, _newSessionId?: string) {
  return window.agent.parkSession(projectPath)
}

async function _ensureClaudeSessionReadyForSend(get: () => ChatStore, projectPath: string): Promise<void> {
  const project = get().projectSessions[projectPath]
  if (!project) return
  const sessionId = resolveActiveSessionId(project)
  if (!sessionId) return
  const session = project._sessions[sessionId]
  if (!session || session.sessionProvider === 'codex') return
  await window.app.resumeSession(projectPath, sessionId, _getSessionCwd(projectPath, session))
}

// --- Helpers ---

export type CodexCommand =
  | { kind: 'help' }
  | { kind: 'reset' }
  | { kind: 'auth-status' }
  | { kind: 'auth-set'; mode: CodexAuthMode; apiKey?: string }
  | { kind: 'run'; prompt: string }
  | { kind: 'review'; target: CodexReviewTarget }
  | { kind: 'compact' }
  | { kind: 'plan' }

type ChatStoreSet = (
  partial: Partial<ChatStore> | ((state: ChatStore) => Partial<ChatStore>),
  replace?: false,
) => void

type CodexRunnableCommand = Extract<CodexCommand, { kind: 'run' | 'review' | 'compact' }>

export function parseCodexCommand(input: string): CodexCommand | null {
  if (!input.startsWith('/')) return null

  const body = input.slice(1).trim()
  if (!body) return null

  if (body === 'help') return { kind: 'help' }
  if (body === 'reset') return { kind: 'reset' }
  if (body === 'compact') return { kind: 'compact' }
  if (body === 'plan') return { kind: 'plan' }

  if (body === 'review' || body.startsWith('review ')) {
    const reviewBody = body.slice('review'.length).trim()
    if (reviewBody.startsWith('branch')) return { kind: 'review', target: { type: 'baseBranch' } }
    if (reviewBody.startsWith('commit')) {
      const sha = reviewBody.slice('commit'.length).trim()
      if (!sha) return { kind: 'help' }
      return { kind: 'review', target: { type: 'commit', sha } }
    }
    return { kind: 'review', target: { type: 'uncommittedChanges' } }
  }

  if (body === 'auth' || body.startsWith('auth ')) {
    const authBody = body.slice('auth'.length).trim()
    if (!authBody) return { kind: 'auth-status' }
    if (authBody === 'auto') return { kind: 'auth-set', mode: 'auto' }
    if (authBody === 'chatgpt') return { kind: 'auth-set', mode: 'chatgpt' }
    if (authBody.startsWith('apikey')) {
      const apiKey = authBody.slice('apikey'.length).trim()
      return { kind: 'auth-set', mode: 'apiKey', apiKey: apiKey || undefined }
    }
    return { kind: 'help' }
  }

  return null
}

function isRunnableCodexCommand(command: CodexCommand): command is CodexRunnableCommand {
  return command.kind === 'run' || command.kind === 'review' || command.kind === 'compact'
}

function getCodexHelpText(): string {
  return [
    'Codex commands:',
    '',
    '/reset — reset thread',
    '/auth — show auth status',
    '/auth auto — prefer API key, fallback to ChatGPT login',
    '/auth chatgpt — force ChatGPT login mode',
    '/auth apikey <KEY> — force API key mode',
    '/review — review uncommitted changes',
    '/review branch — review diff against base branch',
    '/review commit <sha> — review a specific commit',
    '/compact — compact thread context',
    '/plan — enter plan mode',
    '',
    'Notes:',
    '- Type a message directly to send it as a prompt',
    '- During a running turn, new messages are sent as steered input (no need to wait)',
  ].join('\n')
}

export function formatCodexAuthStatus(status: CodexAuthStatus): string {
  return [
    'Codex authentication status:',
    `- configured mode: ${status.mode}`,
    `- resolved mode: ${status.resolvedMode}`,
    `- env CODEX_API_KEY: ${status.hasEnvApiKey ? 'set' : 'not set'}`,
    `- session API key: ${status.hasSessionApiKey ? 'set' : 'not set'}`,
    `- runtime state: ${status.isRunning ? 'running' : 'idle'}`,
  ].join('\n')
}

export function getLatestCodexThreadId(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.providerId !== 'codex' || msg.role !== 'assistant') continue
    const tid = msg.metadata?.codex?.threadId
    if (tid) return tid
  }
  return undefined
}

export function resolveCodexReasoningEffort(
  model: ModelOption | undefined,
  preferred?: CodexReasoningEffort,
): CodexReasoningEffort | undefined {
  const options = model?.supportedReasoningEfforts ?? []
  if (options.length === 0) return undefined
  const supported = new Set(options.map((entry) => entry.value))
  if (preferred && supported.has(preferred)) return preferred
  if (model?.defaultReasoningEffort && supported.has(model.defaultReasoningEffort)) {
    return model.defaultReasoningEffort
  }
  return options[options.length - 1]?.value
}

export function resolveCodexModelSelection(
  models: ModelOption[],
  selectedCodexModel: string,
  selectedCodexReasoningEffort?: CodexReasoningEffort,
): { modelId: string; reasoningEffort?: CodexReasoningEffort } {
  const current = selectedCodexModel.length > 0 ? models.find((m) => m.id === selectedCodexModel) : undefined
  if (current) {
    return {
      modelId: current.id,
      reasoningEffort: resolveCodexReasoningEffort(current, selectedCodexReasoningEffort),
    }
  }

  const preferred = models.find((m) => m.isDefault)
    ?? models[0]

  if (!preferred) {
    return { modelId: '', reasoningEffort: undefined }
  }

  return {
    modelId: preferred.id,
    reasoningEffort: resolveCodexReasoningEffort(preferred, selectedCodexReasoningEffort),
  }
}

function resolveDefaultCodexSelection(models: ModelOption[]): { modelId: string; reasoningEffort?: CodexReasoningEffort } {
  const remembered = readLastCodexSelection()
  const defaults = _cachedDefaultCodexSelection ?? { modelId: '', reasoningEffort: undefined }
  return resolveCodexModelSelection(
    models,
    defaults.modelId || remembered.modelId,
    defaults.reasoningEffort ?? remembered.reasoningEffort,
  )
}

function resolveSessionCodexSelection(
  models: ModelOption[],
  selectedCodexModel: string,
  selectedCodexReasoningEffort?: CodexReasoningEffort,
): { modelId: string; reasoningEffort?: CodexReasoningEffort } {
  if (selectedCodexModel || selectedCodexReasoningEffort) {
    return resolveCodexModelSelection(models, selectedCodexModel, selectedCodexReasoningEffort)
  }
  return resolveDefaultCodexSelection(models)
}

function readLastCodexSelection(): { modelId: string; reasoningEffort?: CodexReasoningEffort } {
  try {
    const raw = globalThis.localStorage?.getItem(CODEX_LAST_SELECTION_STORAGE_KEY)
    if (!raw) return { modelId: '', reasoningEffort: undefined }
    const parsed = JSON.parse(raw) as { modelId?: unknown; reasoningEffort?: unknown }
    if (typeof parsed.modelId !== 'string') return { modelId: '', reasoningEffort: undefined }
    const effort = typeof parsed.reasoningEffort === 'string'
      ? parsed.reasoningEffort as CodexReasoningEffort
      : undefined
    return { modelId: parsed.modelId, reasoningEffort: effort }
  } catch {
    return { modelId: '', reasoningEffort: undefined }
  }
}

function saveLastCodexSelection(modelId: string, reasoningEffort?: CodexReasoningEffort): void {
  try {
    globalThis.localStorage?.setItem(
      CODEX_LAST_SELECTION_STORAGE_KEY,
      JSON.stringify({ modelId, reasoningEffort }),
    )
  } catch {}
}

function createLocalTextUserMessage(id: string, text: string): ChatMessage {
  return {
    id,
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: new Date().toISOString(),
    providerId: 'local',
  }
}

function getCodexPlanActionContext(
  get: () => ChatStore,
  activeProject: string,
): {
  project: ProjectState
  session: PerSessionState
  assistantMessageId: string
  codexSessionId: string
  resolvedCodexModel?: string
  resolvedCodexReasoningEffort?: CodexReasoningEffort
} | null {
  const project = getProject(get(), activeProject)
  const codexSessionId = _getEffectiveSessionId(project)
  if (!codexSessionId) return null

  const session = getActivePerSession(get(), activeProject)
  const provider = session.sessionProvider ?? session.preferredProvider
  if (provider !== 'codex' || session.selectedCodexCollaborationMode !== 'plan' || session.status !== 'idle' || project.hasPendingInteraction) {
    return null
  }

  const lastAssistantId = session.lastAssistantMessageId
  if (!lastAssistantId) return null
  const lastAssistantMessage = lastAssistantId
    ? session.messages.find((message) => message.id === lastAssistantId)
    : null
  const hasPlan = !!lastAssistantMessage?.metadata?.codex?.items.some((item) => item.type === 'plan')
  if (!hasPlan) return null

  const resolvedCodexSelection = resolveSessionCodexSelection(
    project.codexModels,
    session.selectedCodexModel,
    session.selectedCodexReasoningEffort,
  )

  return {
    project,
    session,
    assistantMessageId: lastAssistantId,
    codexSessionId,
    resolvedCodexModel: resolvedCodexSelection.modelId || undefined,
    resolvedCodexReasoningEffort: resolvedCodexSelection.reasoningEffort,
  }
}

function updateCodexPlanApproval(
  session: PerSessionState,
  assistantMessageId: string,
  planApproval: CodexPlanApprovalState,
): Partial<PerSessionState> {
  return {
    messages: session.messages.map((message) => {
      if (message.id !== assistantMessageId || message.role !== 'assistant' || !message.metadata?.codex) {
        return message
      }
      return {
        ...message,
        metadata: {
          ...message.metadata,
          codex: {
            ...message.metadata.codex,
            planApproval,
          },
        },
      }
    }),
  }
}

async function runCodexCommand(
  set: ChatStoreSet,
  get: () => ChatStore,
  {
    activeProject,
    codexSessionId,
    session,
    codexCommand,
    finalContent,
    userMessageId,
    attachments,
    selectedCodexPermissionPreset,
    collaborationMode,
    resolvedCodexModel,
    resolvedCodexReasoningEffort,
    userMessageContent,
    contexts,
    userSelections,
  }: {
    activeProject: string
    codexSessionId: string
    session: PerSessionState
    codexCommand: CodexRunnableCommand
    finalContent: string
    userMessageId: string
    attachments: ImageAttachment[]
    selectedCodexPermissionPreset: CodexPermissionPreset
    collaborationMode: CodexCollaborationMode
    resolvedCodexModel?: string
    resolvedCodexReasoningEffort?: CodexReasoningEffort
    userMessageContent?: ContentBlock[]
    contexts?: ChatMessageContext[]
    userSelections?: string[]
  },
): Promise<void> {
  const userMessageExtras = userMessageContent || contexts || (userSelections && userSelections.length > 0)
    ? { userMessageContent, contexts, userSelections }
    : undefined
  set((s) => updateActivePerSession(s, () => ({ _pendingSlashCommand: '' })))

  const assistantId = `codex_${Date.now()}`
  const previousCodexTurnLastUsage = session.codexTurnLastUsage
  const codexThreadId = getLatestCodexThreadId(session.messages)
  const updateCodexSession = (updater: (s: PerSessionState) => Partial<PerSessionState>) => {
    set((s) => updatePerSession(s, activeProject, codexSessionId, updater))
  }
  const getCodexSession = () => getProject(get(), activeProject)._sessions[codexSessionId]
  const appendAssistant = (message: ChatMessage) => {
    updateCodexSession((sess) => ({
      messages: [...sess.messages, message],
      ...(message.role === 'assistant' ? { lastAssistantMessageId: message.id } : {}),
    }))
  }
  const getTargetAssistantId = () => getCodexSession()?.activeCodexMessageId ?? assistantId
  const updateAssistant = (
    status: 'streaming' | 'complete' | 'interrupted' | 'error',
    text: string,
    metadata?: ChatMessage['metadata'],
    sessionUpdates?: Partial<PerSessionState>,
  ) => {
    const targetAssistantId = getTargetAssistantId()
    updateCodexSession((sess) => ({
      status: status === 'streaming' ? 'streaming' : 'idle',
      ...(status === 'streaming' ? { activeCodexMessageId: targetAssistantId } : { activeCodexMessageId: null }),
      ...(sessionUpdates ?? {}),
      messages: sess.messages.map((m) => (
        m.id !== targetAssistantId
          ? m
          : {
              ...m,
              status,
              content: [{ type: 'text', text }],
              ...(metadata ? { metadata } : {}),
            }
      )),
    }))
  }

  if (session.status === 'streaming' && codexCommand.kind === 'run') {
    const steerAssistantId = `codex_${Date.now()}`
    const previousActiveCodexMessageId = session.activeCodexMessageId
    appendAssistant({
      id: steerAssistantId,
      role: 'assistant',
      status: 'streaming',
      content: [],
      createdAt: new Date().toISOString(),
      providerId: 'codex',
    })
    updateCodexSession(() => ({
      status: 'streaming',
      activeCodexMessageId: steerAssistantId,
      codexTurnLastUsage: null,
      streamingTokens: { input: 0, output: 0 },
    }))
    try {
      await window.app.codexSteer(
        codexSessionId,
        codexCommand.prompt,
        steerAssistantId,
        userMessageId,
        finalContent,
        session._worktreeBaseBranch ?? undefined,
        session._worktreePath ?? undefined,
      )
    } catch (error) {
      updateCodexSession((sess) => ({
        status: 'streaming',
        activeCodexMessageId: previousActiveCodexMessageId ?? null,
        codexTurnLastUsage: previousCodexTurnLastUsage,
        messages: sess.messages.filter((m) => m.id !== steerAssistantId),
      }))
      console.warn('[runCodexCommand] Codex steer failed:', error)
    }
    return
  }

  appendAssistant({
    id: assistantId,
    role: 'assistant',
    status: 'streaming',
    content: [],
    createdAt: new Date().toISOString(),
    providerId: 'codex',
  })
  updateCodexSession(() => ({
    status: 'streaming',
    activeCodexMessageId: assistantId,
    codexTurnLastUsage: null,
    streamingTokens: { input: 0, output: 0 },
  }))

  try {
    const runStart = Date.now()
    const codexCwd = _getSessionCwd(activeProject, session)
    let result: Awaited<ReturnType<typeof window.app.codexRun>>

    if (codexCommand.kind === 'review') {
      result = await window.app.codexReview(
        codexSessionId,
        activeProject,
        codexCommand.target,
        resolvedCodexModel,
        resolvedCodexReasoningEffort,
        selectedCodexPermissionPreset,
        codexThreadId,
        assistantId,
        codexCwd,
        userMessageId,
        finalContent,
        session._worktreeBaseBranch ?? undefined,
        session._worktreePath ?? undefined,
        userMessageExtras,
      )
    } else if (codexCommand.kind === 'compact') {
      result = await window.app.codexCompact(
        codexSessionId,
        activeProject,
        resolvedCodexModel,
        selectedCodexPermissionPreset,
        codexThreadId,
        assistantId,
        codexCwd,
        userMessageId,
        finalContent,
        session._worktreeBaseBranch ?? undefined,
        session._worktreePath ?? undefined,
        userMessageExtras,
      )
    } else {
      result = await window.app.codexRun(
        codexSessionId,
        activeProject,
        codexCommand.prompt,
        resolvedCodexModel,
        resolvedCodexReasoningEffort,
        selectedCodexPermissionPreset,
        collaborationMode,
        codexThreadId,
        assistantId,
        attachments.length > 0 ? attachments : undefined,
        codexCwd,
        userMessageId,
        finalContent,
        session._worktreeBaseBranch ?? undefined,
        session._worktreePath ?? undefined,
        userMessageExtras,
      )
    }

    const text = result.finalResponse?.trim() || (
      codexCommand.kind === 'compact'
        ? 'Conversation compacted.'
        : 'Codex completed without returning text.'
    )
    const renderedItems = pruneTransientCodexItems(result.items)
    const codexSession = getCodexSession()
    const footerTokens = result.usage && codexSession
      ? accumulateCodexFooterTokens(codexSession.streamingTokens, result.usage, codexSession.codexTurnLastUsage)
      : codexSession?.streamingTokens ?? { input: 0, output: 0 }
    const consumedTokens = footerTokens.input > 0 || footerTokens.output > 0 ? footerTokens : undefined
    updateAssistant('complete', text, result.usage ? {
      durationMs: Date.now() - runStart,
      usage: {
        inputTokens: result.usage.lastInputTokens,
        outputTokens: result.usage.lastOutputTokens,
        cacheReadInputTokens: result.usage.lastCachedInputTokens,
        cacheCreationInputTokens: 0,
      },
      ...(consumedTokens ? { consumedTokens } : {}),
      codex: {
        threadId: result.threadId,
        usage: result.usage,
        items: renderedItems,
      },
    } : {
      durationMs: Date.now() - runStart,
      codex: {
        threadId: result.threadId,
        usage: null,
        items: renderedItems,
      },
    }, {
      contextTokens: result.usage
        ? (() => {
            const total = getCodexContextTokens(result.usage)
            return total > 0 ? total : (codexSession?.contextTokens ?? 0)
          })()
        : (codexSession?.contextTokens ?? 0),
      contextWindow: result.usage?.contextWindow && result.usage.contextWindow > 0
        ? result.usage.contextWindow
        : (codexSession?.contextWindow ?? null),
      codexUsageSnapshot: result.usage ?? codexSession?.codexUsageSnapshot ?? null,
      codexTurnLastUsage: null,
      streamingTokens: { input: 0, output: 0 },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const interrupted = /interrupt|abort/i.test(message)
    updateAssistant(
      interrupted ? 'interrupted' : 'error',
      interrupted ? 'Codex run interrupted.' : `Codex run failed: ${message}`,
      undefined,
      { codexTurnLastUsage: null, streamingTokens: { input: 0, output: 0 } },
    )
  }

  const finalCodexSession = getCodexSession()
  if (finalCodexSession) {
    const currentProject = getProject(get(), activeProject)
    if (currentProject._activeSessionId !== codexSessionId) {
      set((s) => {
        const proj = s.projectSessions[activeProject]
        if (!proj) return {}
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: {
              ...proj,
              unseenCompletedSessions: new Set([...proj.unseenCompletedSessions, codexSessionId]),
            },
          },
        }
      })
    }
  }
}

// --- Store implementation ---

function isRemoteSession(state: ChatStore, projectPath: string, sessionId: string | null | undefined): boolean {
  if (!sessionId) return false
  const ids = state.remoteSessions[projectPath]
  return !!ids && ids.includes(sessionId)
}

function addRemoteSession(map: Record<string, string[]>, projectPath: string, sessionId: string): Record<string, string[]> {
  const existing = map[projectPath] ?? []
  if (existing.includes(sessionId)) return map
  return { ...map, [projectPath]: [...existing, sessionId] }
}

function removeRemoteSession(map: Record<string, string[]>, projectPath: string, sessionId: string): Record<string, string[]> {
  const existing = map[projectPath]
  if (!existing || !existing.includes(sessionId)) return map
  const next = existing.filter((id) => id !== sessionId)
  if (next.length === 0) {
    const { [projectPath]: _omit, ...rest } = map
    return rest
  }
  return { ...map, [projectPath]: next }
}

export const useChatStore = create<ChatStore>((set, get) => ({
  projectSessions: {},
  activeProject: null,
  remoteSessions: {},
  _bashOutputs: {},
  toolRenderers: {},

  openToolIntercept: (state) =>
    set((s) => ({ toolRenderers: { ...s.toolRenderers, [state.callId]: state } })),

  submitToolIntercept: (callId, userInput) => {
    const current = get().toolRenderers[callId]
    if (!current || current.status !== 'awaiting') return
    set((s) => {
      const next = { ...s.toolRenderers }
      delete next[callId]
      return { toolRenderers: next }
    })
    window.app.submitToolIntercept?.(callId, userInput)
  },

  cancelToolIntercept: (callId, reason) => {
    const current = get().toolRenderers[callId]
    if (!current || current.status !== 'awaiting') return
    set((s) => {
      const next = { ...s.toolRenderers }
      delete next[callId]
      return { toolRenderers: next }
    })
    window.app.cancelToolIntercept?.(callId, reason)
  },

  clearAllToolIntercepts: () => set({ toolRenderers: {} }),

  isOpen: false,
  corner: 'br',
  availableModels: [],
  cachedCodexModels: [],
  account: {},
  globalSlashCommands: [],
  userSkills: [],
  userCommands: [],
  userAgents: [],
  availableOutputStyles: [],
  disabledSkills: [],

  setGlobalResources: (models, account, slashCommands, userSkills, userCommands, userAgents, codexModels, availableOutputStyles) => {
    set((s) => {
      const effectiveCodexModels = codexModels ?? s.cachedCodexModels
      const disabledSet = new Set(s.disabledSkills)
      const updates: Partial<ChatStore> = {
        availableModels: models,
        cachedCodexModels: effectiveCodexModels,
        account,
        globalSlashCommands: slashCommands,
        userSkills,
        userCommands,
        userAgents,
        availableOutputStyles: availableOutputStyles ?? s.availableOutputStyles,
      }

      const projects = { ...s.projectSessions }
      let changed = false
      for (const [path, project] of Object.entries(projects)) {
        let projectChanged = false
        const patched = { ...project }

        if (patched._activeSessionId) {
          patched.slashCommands = buildSlashCommands(slashCommands, userSkills, userCommands, patched._projectSkills, patched._projectCommands, disabledSet)
          projectChanged = true
        }

        if (effectiveCodexModels.length > 0 && patched.codexModels.length === 0) {
          patched.codexModels = effectiveCodexModels
          projectChanged = true
        }

        const activeSid = patched._activeSessionId
        if (activeSid && patched._sessions[activeSid]) {
          const sess = patched._sessions[activeSid]
          let updated = sess
          if (!sess.selectedModel && models.length > 0) {
            updated = updated === sess ? { ...sess } : updated
            applyDefaultModel(updated, models)
          }
          if (effectiveCodexModels.length > 0 && (!updated.selectedCodexModel || !updated.selectedCodexReasoningEffort)) {
            const selected = resolveSessionCodexSelection(
              effectiveCodexModels,
              updated.selectedCodexModel,
              updated.selectedCodexReasoningEffort,
            )
            if (
              selected.modelId !== updated.selectedCodexModel
              || selected.reasoningEffort !== updated.selectedCodexReasoningEffort
            ) {
              updated = updated === sess ? { ...sess } : updated
              updated.selectedCodexModel = selected.modelId
              updated.selectedCodexReasoningEffort = selected.reasoningEffort
            }
          }
          if (updated !== sess) {
            patched._sessions = { ...patched._sessions, [activeSid]: updated }
            projectChanged = true
          }
        }

        if (projectChanged) {
          projects[path] = patched
          changed = true
        }
      }
      if (changed) updates.projectSessions = projects
      return updates
    })
  },

  setDisabledSkills: (list: string[]) => {
    set((s) => {
      const disabledSet = new Set(list)
      const projects = { ...s.projectSessions }
      let changed = false
      for (const [path, project] of Object.entries(projects)) {
        if (!project._activeSessionId) continue
        projects[path] = {
          ...project,
          slashCommands: buildSlashCommands(
            s.globalSlashCommands, s.userSkills, s.userCommands,
            project._projectSkills, project._projectCommands,
            disabledSet,
          ),
        }
        changed = true
      }
      return changed
        ? { disabledSkills: list, projectSessions: projects }
        : { disabledSkills: list }
    })
  },

  handleAgentEvent: (event: AgentEvent) => {
    if (event.type === 'remote_session_start') {
      const projectPath = event.remoteProjectPath
      const sessionId = event.remoteSessionId
      set((s) => {
        const project = s.projectSessions[projectPath] ?? createDefaultProjectState()
        const existingSession = project._sessions[sessionId]
        const nextSession = existingSession ?? {
          ...createDefaultPerSessionState(),
          _historyHydrated: !event.isSubscribe,
        }
        return {
          remoteSessions: event.isSubscribe
            ? addRemoteSession(s.remoteSessions, projectPath, sessionId)
            : s.remoteSessions,
          projectSessions: {
            ...s.projectSessions,
            [projectPath]: {
              ...project,
              _sessions: { ...project._sessions, [sessionId]: nextSession },
            },
          },
        }
      })
      if (event.isSubscribe) {
        _hydrateSessionState(set, projectPath, sessionId)
      }
      return
    }
    if (event.type === 'remote_session_end') {
      if (!event.isSubscribe) return
      set((s) => ({
        remoteSessions: removeRemoteSession(s.remoteSessions, event.remoteProjectPath, event.remoteSessionId),
      }))
      return
    }

    const projectPath = event.projectPath
    const eventSessionId = event.sessionId
    if (!projectPath) return
    let hydrateSessionId: string | null = null

    set((s) => {
      let project = s.projectSessions[projectPath] ?? createDefaultProjectState()

      let matchType: 'exact' | 'lazy_session' | 'fallback_active'
      let targetSid: string | null

      if (eventSessionId && project._sessions[eventSessionId]) {
        targetSid = eventSessionId
        matchType = 'exact'
      } else if (eventSessionId) {
        project = {
          ...project,
          _sessions: {
            ...project._sessions,
            [eventSessionId]: {
              ...createDefaultPerSessionState(),
              _historyHydrated: false,
            },
          },
        }
        hydrateSessionId = eventSessionId
        targetSid = eventSessionId
        matchType = 'lazy_session'
      } else if (project._activeSessionId) {
        targetSid = project._activeSessionId
        matchType = 'fallback_active'
      } else {
        window.app.trace?.('session.route.dropped', event.type, {
          reason: 'no_route',
          eventSessionId,
          activeSid: project._activeSessionId,
          knownSids: Object.keys(project._sessions),
        })
        return {}
      }

      window.app.trace?.('session.route', event.type, {
        matchType,
        targetSid,
        eventSessionId,
        activeSid: project._activeSessionId,
        knownSids: Object.keys(project._sessions),
      })

      if (event.type === 'permission_request') {
        window.app.trace?.('permission.flow', 'renderer_route', {
          matchType,
          targetSid,
          eventSessionId,
          activeSid: project._activeSessionId,
          isTargetActive: targetSid === project._activeSessionId,
          toolName: event.request.toolName,
        }, event.request.requestId)
        if (targetSid !== project._activeSessionId) {
          console.warn('[permission-drift] permission_request landed on non-active session', {
            requestId: event.request.requestId,
            toolName: event.request.toolName,
            eventSessionId,
            targetSid,
            activeSid: project._activeSessionId,
            matchType,
            knownSids: Object.keys(project._sessions),
          })
        }
      }

      if (matchType === 'lazy_session') {
        console.warn('[session-drift] lazy_session created from incoming event', {
          eventType: event.type,
          eventSessionId,
          activeSid: project._activeSessionId,
          knownSids: Object.keys(project._sessions).filter((k) => k !== eventSessionId),
        })
      }

      if (!project._sessions[targetSid]) {
        return {}
      }

      const targetSession = project._sessions[targetSid]
      const delta = applyEventToSession(targetSession, event)
      const updatedSession = { ...targetSession, ...delta }

      if (import.meta.env.DEV) {
        const codexItemTrace = event.type === 'codex_item_delta'
          ? {
              codexPhase: event.phase,
              codexItemId: event.item.id,
              codexItemType: event.item.type,
              codexTextLength: event.item.type === 'reasoning' || event.item.type === 'plan' || event.item.type === 'agent_message' || event.item.type === 'review'
                ? event.item.text.length
                : undefined,
              codexTextPreview: event.item.type === 'reasoning' || event.item.type === 'plan' || event.item.type === 'agent_message' || event.item.type === 'review'
                ? event.item.text.slice(0, 160)
                : undefined,
              ...(event.item.type === 'collab_tool_call' ? {
                collabTool: event.item.tool,
                collabStatus: event.item.status,
                agentIds: Object.keys(event.item.agentsStates),
                agentStatuses: Object.fromEntries(Object.entries(event.item.agentsStates).map(([k, v]) => [k, v.status])),
                childThreadCount: event.item.childItems ? Object.keys(event.item.childItems).length : 0,
                childItemCounts: event.item.childItems
                  ? Object.fromEntries(Object.entries(event.item.childItems).map(([k, v]) => [k, v.length]))
                  : undefined,
              } : {}),
            }
          : {}
        window.app.trace?.('agent.store', event.type, {
          targetSid,
          eventSessionId,
          deltaKeys: Object.keys(delta),
          ...('status' in delta ? { status: delta.status } : {}),
          ...(event.type === 'message_start' ? { role: event.message.role, messageId: event.message.id } : {}),
          ...('taskProgress' in delta ? { taskProgressKeys: Object.keys(delta.taskProgress ?? {}) } : {}),
          ...codexItemTrace,
        }, (event as any).messageId)
        if (event.type === 'message_usage' && event.codexUsage) {
          const stepTokens = getCodexUsageStepTokens(event.codexUsage)
          const footerTokens = accumulateCodexFooterTokens(targetSession.streamingTokens, event.codexUsage, targetSession.codexTurnLastUsage)
          window.app.trace?.('codex.usage.computed', event.type, {
            raw: {
              total: {
                inputTokens: event.codexUsage.totalInputTokens,
                cachedInputTokens: event.codexUsage.totalCachedInputTokens,
                outputTokens: event.codexUsage.totalOutputTokens,
              },
              last: {
                inputTokens: event.codexUsage.lastInputTokens,
                cachedInputTokens: event.codexUsage.lastCachedInputTokens,
                outputTokens: event.codexUsage.lastOutputTokens,
              },
              reasoningOutputTokens: event.codexUsage.reasoningOutputTokens,
              contextWindow: event.codexUsage.contextWindow,
            },
            computedStepTokens: stepTokens,
            computedContextTokens: getCodexContextTokens(event.codexUsage),
            computedTurnDeltaTokens: footerTokens,
            displayFooterInput: footerTokens.input,
            displayFooterOutput: footerTokens.output,
          }, event.messageId)
        }
        if (updatedSession.sessionProvider === 'codex' && (event.type === 'codex_item_delta' || event.type === 'message_complete')) {
          const beforeMessage = targetSession.messages.find((msg) => msg.id === event.messageId)
          const afterMessage = updatedSession.messages.find((msg) => msg.id === event.messageId)
          const prevItems = getCodexTraceItems(beforeMessage)
          const nextItems = getCodexTraceItems(afterMessage)
          const completionItems = event.type === 'message_complete'
            ? getCodexCompletionEventMeta(event.metadata)?.items ?? []
            : []
          window.app.trace?.('codex.live', event.type, {
            targetSid,
            eventSessionId,
            activeSid: project._activeSessionId,
            messageId: event.messageId,
            lastAssistantMessageIdBefore: targetSession.lastAssistantMessageId,
            lastAssistantMessageIdAfter: updatedSession.lastAssistantMessageId,
            activeCodexMessageIdBefore: targetSession.activeCodexMessageId,
            activeCodexMessageIdAfter: updatedSession.activeCodexMessageId,
            prevItemsLength: prevItems.length,
            nextItemsLength: nextItems.length,
            prevItemsTail: prevItems.tail,
            nextItemsTail: nextItems.tail,
            ...(event.type === 'codex_item_delta'
              ? {
                  phase: event.phase,
                  incomingItem: summarizeCodexTraceItem(event.item),
                }
              : {
                  completionItemsLength: completionItems.length,
                  completionItemsTail: completionItems.slice(-3).map(summarizeCodexTraceItem),
                  finalResponseLength: getCodexCompletionEventMeta(event.metadata)?.finalResponse?.length ?? 0,
                }),
          }, event.messageId)
        }
      }

      const updatedSessions = { ...project._sessions, [targetSid]: updatedSession }
      const updatedProject = { ...project, _sessions: updatedSessions }

      // Handle init_ready: update project-level fields
      if (event.type === 'init_ready') {
        updatedSession.cwd = event.cwd
        updatedProject.homedir = event.homedir
        updatedProject.sandboxInfo = event.sandboxInfo
        updatedProject._projectSkills = event.skills
        updatedProject._projectCommands = event.projectCommands
        updatedProject.projectAdditionalDirs = event.additionalDirectories
        updatedProject.slashCommands = buildSlashCommands(
          s.globalSlashCommands, s.userSkills, s.userCommands,
          event.skills, event.projectCommands,
          new Set(s.disabledSkills),
        )
        updatedProject.agents = [...s.userAgents, ...event.projectAgents]

        const globalModels = s.availableModels
        if (!updatedSession.selectedModel && globalModels[0]) {
          updatedSession.selectedModel = globalModels[0].id
          const effort = getDefaultEffortForModel(globalModels[0])
          if (effort) updatedSession.selectedEffort = effort
          updatedProject._sessions = { ...updatedProject._sessions, [targetSid]: updatedSession }
        }
      }

      // Incremental save on tool_result / final save on complete/interrupted/error
      const effectiveSid = targetSid
      if (effectiveSid) {
        if (
          updatedSession.sessionProvider === 'codex'
          && (
          (event.type === 'session_init' && event.session) ||
          (event.type === 'content_delta' && event.delta.type === 'tool_result') ||
          event.type === 'message_complete' || event.type === 'message_interrupted' || event.type === 'message_error'
          )
        ) {
          const snapshot = updatedSession
          setTimeout(() => _prepareSessionSnapshot(effectiveSid, snapshot), 0)
        }
      }

      // Non-active session went idle → save, mark unseen, and evict from _sessions after save completes
      if (event.type === 'status_change' && event.status === 'idle' && targetSid !== updatedProject._activeSessionId) {
        if (!_isLiveSession(updatedSession)) {
          const isRemoteSubscribed = isRemoteSession(s, projectPath, targetSid)
          if (!isRemoteSubscribed && effectiveSid) {
            updatedProject.unseenCompletedSessions = new Set([...updatedProject.unseenCompletedSessions, effectiveSid])
            if (updatedSession.sessionProvider === 'codex') {
              const snapshot = updatedSession
              const evictSid = targetSid
              const evictProjectPath = projectPath
              setTimeout(() => {
                _prepareSessionSnapshot(effectiveSid, snapshot).then(() => {
                  set((s) => {
                    const proj = s.projectSessions[evictProjectPath]
                    if (!proj?._sessions[evictSid]) return {}
                    if (proj._activeSessionId === evictSid) return {}
                    if (_isLiveSession(proj._sessions[evictSid])) return {}
                    const { [evictSid]: _, ...rest } = proj._sessions
                    return { projectSessions: { ...s.projectSessions, [evictProjectPath]: { ...proj, _sessions: rest } } }
                  })
                })
              }, 0)
            } else {
              const { [targetSid]: _, ...restSessions } = updatedProject._sessions
              updatedProject._sessions = restSessions
            }
          } else if (!isRemoteSubscribed) {
            const { [targetSid]: _, ...restSessions } = updatedProject._sessions
            updatedProject._sessions = restSessions
          }
        }
      }

      const isBackground = projectPath !== s.activeProject

      // Active session went idle in a background project → mark as unseen
      if (event.type === 'status_change' && event.status === 'idle' && targetSid === updatedProject._activeSessionId && isBackground && effectiveSid) {
        updatedProject.unseenCompletedSessions = new Set([...updatedProject.unseenCompletedSessions, effectiveSid])
      }

      // Background activity indicators
      if (isBackground) {
        updatedProject.hasUnseenActivity = true
      }
      updatedProject.hasPendingInteraction = _computeHasPendingInteraction(updatedProject)

      let bashOutputUpdate: Partial<ChatStore> | undefined
      if (event.type === 'content_delta' && event.delta.type === 'tool_result' && event.delta.outputPath) {
        const tid = event.delta.toolUseId
        const op = event.delta.outputPath
        bashOutputUpdate = {
          _bashOutputs: { ...s._bashOutputs, [tid]: { content: s._bashOutputs[tid]?.content ?? '', finished: false, outputPath: op } },
        }
        setTimeout(() => window.app.watchBashOutput(tid, op), 0)
      }

      return {
        ...bashOutputUpdate,
        projectSessions: {
          ...s.projectSessions,
          [projectPath]: updatedProject,
        },
      }
    })
    if (hydrateSessionId) {
      _hydrateSessionState(set, projectPath, hydrateSessionId)
    }
    if (event.type === 'worktree_missing' && projectPath === get().activeProject) {
      useAppStore.getState().setActiveWorktree(projectPath, null)
    }
  },

  syncLiveSnapshots: async () => {
    const getSnap = window.agent.getLiveSnapshots
    if (!getSnap) return
    let entries
    try {
      entries = await getSnap()
    } catch (err) {
      console.warn('[chat] getLiveSnapshots failed:', err)
      return
    }
    if (!entries || entries.length === 0) return

    const activeByProject = new Map<string, string>()
    for (const entry of entries) {
      if (entry.isActive) activeByProject.set(entry.projectPath, entry.sid)
    }

    set((s) => {
      const nextProjects = { ...s.projectSessions }
      const touchedProjects = new Map<string, string>()
      for (const entry of entries) {
        const prevProject = nextProjects[entry.projectPath] ?? createDefaultProjectState()
        const prevSession = prevProject._sessions[entry.sid] ?? createDefaultPerSessionState()
        const mergedMessages = mergeMessagesByMaxSeq(entry.snapshot.messages as ChatMessage[], prevSession.messages)
        const provider: ChatProvider = entry.snapshot.harnessId === 'codex' ? 'codex' : 'claude'
        const inferredStatus: AgentStatus = entry.isStreaming ? 'streaming' : prevSession.status === 'error' ? 'error' : 'idle'
        const mergedSession: PerSessionState = {
          ...prevSession,
          cwd: entry.snapshot.cwd,
          messages: mergedMessages,
          totalCostUsd: Math.max(prevSession.totalCostUsd, entry.snapshot.totalCostUsd),
          contextTokens: Math.max(prevSession.contextTokens, entry.snapshot.contextTokens),
          status: inferredStatus,
          awaitingAssistantReply: entry.isStreaming && !entry.snapshot.currentMessageId
            ? prevSession.awaitingAssistantReply
            : false,
          sessionProvider: provider,
          permissionMode: entry.permissionMode,
          lastAssistantMessageId: entry.snapshot.currentMessageId ?? prevSession.lastAssistantMessageId,
          _worktreePath: entry.snapshot.worktreePath ?? prevSession._worktreePath,
          _worktreeBaseBranch: entry.snapshot.gitBranch ?? prevSession._worktreeBaseBranch,
          _worktreeRemoved: entry.snapshot.worktreeMissing,
          _historyHydrated: true,
        }
        const nextSessions = { ...prevProject._sessions, [entry.sid]: mergedSession }
        touchedProjects.set(entry.projectPath, entry.sid)
        const nextActiveSid = activeByProject.get(entry.projectPath) ?? prevProject._activeSessionId ?? entry.sid
        nextProjects[entry.projectPath] = {
          ...prevProject,
          _sessions: nextSessions,
          _activeSessionId: nextActiveSid,
          sandboxInfo: entry.sandboxInfo,
        }
      }
      return { projectSessions: nextProjects }
    })

    for (const entry of entries) {
      for (const ev of entry.replayEvents) {
        try { get().handleAgentEvent(ev as AgentEvent) } catch (err) { console.warn('[chat] replay event error:', err) }
      }
      for (const ev of entry.pendingInteractions) {
        try { get().handleAgentEvent(ev as AgentEvent) } catch (err) { console.warn('[chat] pending interaction error:', err) }
      }
    }
  },

  switchProject: async (projectPath: string) => {
    const currentProject = get().activeProject
    perfEvent('project_switch', { from: currentProject, to: projectPath })
    if (currentProject && currentProject !== projectPath) {
      const project = get().projectSessions[currentProject]
      if (project) {
        const activeSession = project._activeSessionId ? project._sessions[project._activeSessionId] : null
        const isRemote = isRemoteSession(get(), currentProject, project._activeSessionId)
        if ((activeSession && (_isBusyStatus(activeSession.status) || activeSession.awaitingAssistantReply)) && !isRemote) {
          await _parkActiveSession(currentProject, project._activeSessionId)
        }
      }
    }
    const targetProject = get().projectSessions[projectPath]
    const targetSid = targetProject?._activeSessionId
    const targetSession = targetSid ? targetProject?._sessions[targetSid] : undefined
    set((s) => {
      const project = s.projectSessions[projectPath]
      const updates: Partial<ChatStore> = { activeProject: projectPath }
      if (project) {
        let { unseenCompletedSessions } = project
        const nextSession = targetSid ? project._sessions[targetSid] : undefined
        const nextSessions = targetSid && nextSession
          ? {
              ...project._sessions,
              [targetSid]: { ...nextSession, cwd: _getSessionCwd(projectPath, nextSession) },
            }
          : project._sessions
        if (project._activeSessionId && unseenCompletedSessions.has(project._activeSessionId)) {
          unseenCompletedSessions = new Set(unseenCompletedSessions)
          unseenCompletedSessions.delete(project._activeSessionId)
        }
        updates.projectSessions = {
          ...s.projectSessions,
          [projectPath]: { ...project, _sessions: nextSessions, hasUnseenActivity: false, unseenCompletedSessions },
        }
      }
      return updates
    })
    if (targetSid) {
      const targetSession = targetProject?._sessions[targetSid]
      if (targetSession?.sessionProvider !== 'codex') {
        try {
          await window.app.resumeSession(projectPath, targetSid, _getSessionCwd(projectPath, targetSession))
        } catch (err) { console.warn('[chat] resumeSession failed:', err) }
      }
    }
  },

  ensureSession: (projectPath: string) => {
    let created = false
    set((s) => {
      if (s.projectSessions[projectPath]) return {}
      const project = createDefaultProjectState()
      project.agents = s.userAgents
      project.codexModels = s.cachedCodexModels
      if (_cachedDefaultSandboxMode) project.sandboxInfo = sandboxModeToInfo(_cachedDefaultSandboxMode)
      const draftId = createSessionId()
      project._activeSessionId = draftId
      const newSession = createDefaultPerSessionState()
      newSession.cwd = projectPath
      if (_cachedDefaultPermissionMode) newSession.permissionMode = _cachedDefaultPermissionMode
      applyDefaultModel(newSession, s.availableModels)
      const codexSelection = resolveDefaultCodexSelection(project.codexModels)
      newSession.selectedCodexModel = codexSelection.modelId
      newSession.selectedCodexReasoningEffort = codexSelection.reasoningEffort
      project._sessions = { [draftId]: newSession }
      created = true
      return {
        projectSessions: {
          ...s.projectSessions,
          [projectPath]: project,
        },
      }
    })
    if (created) triggerPrewarm(get(), projectPath)
  },

  sendMessage: async (content: string, segments?: Array<{ text: string; isPaste: boolean }>) => {
    const { activeProject } = get()
    if (!activeProject) return
    perfEvent('message_send', { project: activeProject, len: content.length })
    if (isRemoteSession(get(), activeProject, get().projectSessions[activeProject]?._activeSessionId)) return

    {
      const project = getProject(get())
      const session = getActivePerSession(get())
      window.app.trace?.('session.lifecycle', 'sendMessage', {
        activeSid: project._activeSessionId,
        status: session.status,
        provider: session.sessionProvider,
        msgCount: session.messages.length,
        knownSids: Object.keys(project._sessions),
      })
    }

    const { useAppStore } = await import('./app')
    const wtState = useAppStore.getState().getWorktreeState(activeProject)
    if (wtState.pendingBaseBranch) {
      const baseBranch = wtState.pendingBaseBranch
      const mode = wtState.pendingMode
      const branchName = wtState.pendingBranchName.trim()
      if (mode === 'branch' && !branchName) {
        console.error('[sendMessage] Branch mode requires a branch name')
        return
      }
      const result = await window.app.activateWorktree(activeProject, {
        baseBranch,
        mode,
        branchName: mode === 'branch' ? branchName : undefined,
        carryLocalChanges: wtState.pendingCarryLocalChanges,
      })
      if (!result.ok) {
        console.error('[sendMessage] Failed to activate worktree:', result.error)
        return
      }
      useAppStore.getState().setActiveWorktree(activeProject, result.path)
      const recordedBranch = mode === 'branch' ? branchName : baseBranch
      set((s) => updateActivePerSession(s, () => ({
        cwd: result.path,
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
        session: null,
        sessionProvider: null,
        _worktreeBaseBranch: recordedBranch,
        _worktreePath: result.path,
        todos: {},
        _nextTodoId: 1,
        showTodos: false,
        _todosUserDismissed: false,
        subagentTokens: {},
      })))
    }

    const session = getActivePerSession(get())
    const project = getProject(get())
    const {
      preferredProvider,
      selectedModel,
      selectedEffort,
      selectedCodexModel,
      selectedCodexReasoningEffort,
      selectedCodexPermissionPreset,
      selectedCodexCollaborationMode,
      attachments,
      mentions,
    } = session
    const codexThreadId = getLatestCodexThreadId(session.messages)

    const rawContent = content.trim()
    const activeContexts = Object.values(session.miniAppContexts).filter(
      (slot) => slot.mode === 'inject' || slot.checked,
    )
    const contextSuffix = activeContexts.length > 0
      ? '\n\n' + activeContexts.map((ctx) => `<app-context app="${ctx.appName}" summary="${ctx.summary}">\n${ctx.content}\n</app-context>`).join('\n\n')
      : ''
    const userSelections = session.userSelections
    let quoteSuffix = ''
    if (userSelections.length === 1) {
      quoteSuffix = `\n\n<quote>\n${userSelections[0]}\n</quote>`
    } else if (userSelections.length > 1) {
      const inner = userSelections
        .map((s, i) => `<quote${i + 1}>\n${s}\n</quote${i + 1}>`)
        .join('\n')
      quoteSuffix = `\n\n<quote>\n${inner}\n</quote>`
    }
    const finalContent = rawContent + contextSuffix + quoteSuffix
    const codexCommand = parseCodexCommand(rawContent)
    const requestedProvider: ChatProvider = preferredProvider === 'codex' ? 'codex' : 'claude'
    const effectiveProvider: ChatProvider = session.sessionProvider ?? requestedProvider
    const resolvedCodexCommand: CodexCommand | null = effectiveProvider === 'codex'
      ? (codexCommand ?? { kind: 'run', prompt: finalContent })
      : null
    const resolvedCodexSelection = resolveSessionCodexSelection(
      project.codexModels,
      selectedCodexModel,
      selectedCodexReasoningEffort,
    )
    const resolvedCodexModel = resolvedCodexSelection.modelId || undefined
    const resolvedCodexReasoningEffort = resolvedCodexSelection.reasoningEffort
    const isQueuedSend = effectiveProvider === 'claude' && session.status === 'streaming'

    if (!session.sessionProvider) {
      set((s) => updateActivePerSession(s, () => ({
        sessionProvider: effectiveProvider,
        preferredProvider: effectiveProvider,
      })))
    }

    if (effectiveProvider === 'codex' && session.sessionProvider !== 'codex') {
      const localSid = _createLocalCodexSessionId()
      set((s) => {
        const proj = getProject(s, activeProject)
        const currentSid = proj._activeSessionId
        const currentSess = currentSid ? proj._sessions[currentSid] : null
        const shouldCarryState = currentSess != null && currentSess.messages.length === 0
        const nextSessions = { ...proj._sessions }
        if (shouldCarryState && currentSid) {
          delete nextSessions[currentSid]
          nextSessions[localSid] = { ...currentSess, sessionProvider: 'codex', preferredProvider: 'codex' }
        } else {
          nextSessions[localSid] = {
            ...createDefaultPerSessionState(),
            cwd: currentSess?.cwd ?? '',
            sessionProvider: 'codex',
            preferredProvider: 'codex',
          }
        }
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: {
              ...proj,
              _activeSessionId: localSid,
              _sessions: nextSessions,
            },
          },
        }
      })
    }

    const slashMatch = finalContent.match(/^\/(\S+)/)
    set((s) => updateActivePerSession(s, () => ({ _pendingSlashCommand: slashMatch ? slashMatch[1] : '' })))

    const codexSessionId = resolvedCodexCommand ? _getEffectiveSessionId(getProject(get(), activeProject)) : null

    // Utility codex commands → popup overlay (no chat messages)
    if (resolvedCodexCommand) {
      const utilityKind = resolvedCodexCommand.kind
      if (utilityKind === 'help' || utilityKind === 'reset' || utilityKind === 'auth-status' || utilityKind === 'auth-set' || utilityKind === 'plan') {
        set((s) => updateActivePerSession(s, () => ({ _pendingSlashCommand: '' })))
        let popupContent: string
        try {
          if (utilityKind === 'help') {
            popupContent = getCodexHelpText()
          } else if (utilityKind === 'reset') {
            if (codexSessionId) await window.agent.resetSession(codexSessionId)
            popupContent = 'Codex thread has been reset.'
          } else if (utilityKind === 'auth-status') {
            const status = await window.app.codexGetAuthStatus(activeProject)
            popupContent = formatCodexAuthStatus(status)
          } else if (utilityKind === 'plan') {
            get().setSelectedCodexCollaborationMode('plan')
            return
          } else {
            const status = await window.app.codexSetAuth(activeProject, {
              mode: resolvedCodexCommand.mode,
              apiKey: resolvedCodexCommand.apiKey,
            })
            popupContent = `Auth mode updated.\n\n${formatCodexAuthStatus(status)}`
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          popupContent = `Error: ${msg}`
        }
        set((s) => updateActivePerSession(s, () => ({
          slashCommandOutput: { command: utilityKind, content: popupContent, mode: getCommandOutputMode(utilityKind) },
        })))
        return
      }
    }

    const userContent: ContentBlock[] = [
      ...attachments.map((att) =>
        att.mimeType === 'application/pdf'
          ? { type: 'document' as const, name: att.name }
          : { type: 'image' as const, name: att.name }
      ),
      ...(segments && segments.length > 0
        ? segments.map((s) => ({ type: 'text' as const, text: s.text, isPaste: s.isPaste }))
        : rawContent ? [{ type: 'text' as const, text: rawContent }] : []),
    ]

    const userMessageId = `user_${Date.now()}`
    const messageContexts = activeContexts.length > 0
      ? activeContexts.map((ctx) => ({ appId: ctx.appId, appName: ctx.appName, summary: ctx.summary, content: ctx.content, color: ctx.color }))
      : undefined
    const userMessage: ChatMessage = {
      ...createLocalTextUserMessage(userMessageId, rawContent),
      content: userContent,
      attachments: attachments.length > 0 ? attachments : undefined,
      contexts: messageContexts,
      userSelections: userSelections.length > 0 ? [...userSelections] : undefined,
    }
    set((s) => ({
      ...updateActivePerSession(s, (sess) => ({
        ...(!isQueuedSend ? { messages: [...sess.messages, userMessage] } : {}),
        ...(isQueuedSend ? { queuedMessages: [...sess.queuedMessages, userMessage] } : {}),
        attachments: [],
        mentions: [],
        miniAppContexts: {},
        userSelections: [],
        codexPlanRejectHintActive: false,
        ...(effectiveProvider === 'claude' && !isQueuedSend ? { awaitingAssistantReply: true } : {}),
      })),
      isOpen: true,
    }))

    if (activeContexts.length > 0) {
      const consumedAppIds = activeContexts.map((c) => c.appId)
      window.dispatchEvent(new CustomEvent('miniapp-context-consumed', { detail: { appIds: consumedAppIds } }))
    }

    if (resolvedCodexCommand) {
      if (!isRunnableCodexCommand(resolvedCodexCommand) || !codexSessionId) return
      await runCodexCommand(set, get, {
        activeProject,
        codexSessionId,
        session,
        codexCommand: resolvedCodexCommand,
        finalContent,
        userMessageId,
        attachments,
        selectedCodexPermissionPreset,
        collaborationMode: selectedCodexCollaborationMode,
        resolvedCodexModel,
        resolvedCodexReasoningEffort,
        userMessageContent: userContent,
        contexts: messageContexts,
        userSelections: userSelections.length > 0 ? [...userSelections] : undefined,
      })
      return
    }

    if (_resetSessionLock) await _resetSessionLock
    await _ensureClaudeSessionReadyForSend(get, activeProject)

    const mergedDirs = mergeProjectAndSessionDirs(project, session)

    try {
      await window.agent.sendMessage(activeProject, {
        content: finalContent,
        model: selectedModel || undefined,
        effort: selectedEffort,
        images: attachments.length > 0 ? attachments : undefined,
        additionalDirs: mergedDirs.length > 0 ? mergedDirs : undefined,
        clientMessageId: userMessageId,
        sessionId: project._activeSessionId ?? undefined,
        gitBranch: session._worktreeBaseBranch ?? undefined,
        worktreePath: session._worktreePath ?? undefined,
        userMessageContent: userContent,
        contexts: messageContexts,
        userSelections: userSelections.length > 0 ? [...userSelections] : undefined,
        ...(isQueuedSend ? { priority: 'next' as const } : {}),
      })
    } catch (err) {
      if (!isQueuedSend) {
        set((s) => updateActivePerSession(s, () => ({ awaitingAssistantReply: false })))
      }
      throw err
    }
  },

  approveCodexPlan: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    if (isRemoteSession(get(), activeProject, get().projectSessions[activeProject]?._activeSessionId)) return

    const context = getCodexPlanActionContext(get, activeProject)
    if (!context) return

    const userMessageId = `user_${Date.now()}`
    const userMessage = createLocalTextUserMessage(userMessageId, CODEX_APPROVE_PLAN_PROMPT)

    set((s) => ({
      ...updateActivePerSession(s, (sess) => {
        const approvedSession = updateCodexPlanApproval(sess, context.assistantMessageId, { status: 'approved' })
        return {
          ...approvedSession,
          selectedCodexCollaborationMode: 'default',
          codexPlanRejectHintActive: false,
          messages: [...(approvedSession.messages ?? sess.messages), userMessage],
        }
      }),
      isOpen: true,
    }))

    window.app.codexPlanApproval(activeProject, context.codexSessionId, context.assistantMessageId, 'approved')
    window.app.codexCollaborationModeChange(activeProject, context.codexSessionId, 'default')

    await runCodexCommand(set, get, {
      activeProject,
      codexSessionId: context.codexSessionId,
      session: context.session,
      codexCommand: { kind: 'run', prompt: CODEX_APPROVE_PLAN_PROMPT },
      finalContent: CODEX_APPROVE_PLAN_PROMPT,
      userMessageId,
      attachments: [],
      selectedCodexPermissionPreset: context.session.selectedCodexPermissionPreset,
      collaborationMode: 'default',
      resolvedCodexModel: context.resolvedCodexModel,
      resolvedCodexReasoningEffort: context.resolvedCodexReasoningEffort,
    })
  },

  rejectCodexPlan: async (feedback) => {
    const { activeProject } = get()
    if (!activeProject) return
    if (isRemoteSession(get(), activeProject, get().projectSessions[activeProject]?._activeSessionId)) return

    const context = getCodexPlanActionContext(get, activeProject)
    if (!context) return

    const trimmedFeedback = feedback?.trim()
    if (!trimmedFeedback) {
      set((s) => ({
        ...updateActivePerSession(s, (sess) => ({
          ...updateCodexPlanApproval(sess, context.assistantMessageId, { status: 'rejected' }),
          codexPlanRejectHintActive: true,
          chatInputFocusNonce: sess.chatInputFocusNonce + 1,
        })),
        isOpen: true,
      }))
      window.app.codexPlanApproval(activeProject, context.codexSessionId, context.assistantMessageId, 'rejected')
      return
    }

    const userMessageId = `user_${Date.now()}`
    const userMessage = createLocalTextUserMessage(userMessageId, trimmedFeedback)

    set((s) => ({
      ...updateActivePerSession(s, (sess) => {
        const rejectedSession = updateCodexPlanApproval(
          sess,
          context.assistantMessageId,
          { status: 'rejected', feedback: trimmedFeedback },
        )
        return {
          ...rejectedSession,
          codexPlanRejectHintActive: false,
          messages: [...(rejectedSession.messages ?? sess.messages), userMessage],
        }
      }),
      isOpen: true,
    }))

    window.app.codexPlanApproval(activeProject, context.codexSessionId, context.assistantMessageId, 'rejected', trimmedFeedback)

    await runCodexCommand(set, get, {
      activeProject,
      codexSessionId: context.codexSessionId,
      session: context.session,
      codexCommand: { kind: 'run', prompt: trimmedFeedback },
      finalContent: trimmedFeedback,
      userMessageId,
      attachments: [],
      selectedCodexPermissionPreset: context.session.selectedCodexPermissionPreset,
      collaborationMode: 'plan',
      resolvedCodexModel: context.resolvedCodexModel,
      resolvedCodexReasoningEffort: context.resolvedCodexReasoningEffort,
    })
  },

  disconnectRemoteSession: () => {
    const state = get()
    const projectPath = state.activeProject
    const sid = projectPath ? state.projectSessions[projectPath]?._activeSessionId ?? undefined : undefined
    void window.agent.disconnectRemoteSession(sid)
    if (sid && projectPath) {
      set((s) => ({ remoteSessions: removeRemoteSession(s.remoteSessions, projectPath, sid) }))
    } else {
      set({ remoteSessions: {} })
    }
  },

  interrupt: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    const project = getProject(get(), activeProject)
    const sid = _getEffectiveSessionId(project)
    set((s) => updateActivePerSession(s, () => ({ awaitingAssistantReply: false })))
    let interrupted = false
    try {
      interrupted = sid ? await window.agent.interrupt(sid) : false
    } catch {
      interrupted = false
    }
    if (!interrupted) {
      set((s) => updateActivePerSession(s, () => ({
        status: 'idle',
        pendingPermissions: [],
        pendingQuestion: null,
        pendingPlanApproval: null,
      })))
    }
  },

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),

  setCorner: (corner) => set({ corner }),

  clearMessages: () => {
    const { activeProject, _bashOutputs } = get()
    if (!activeProject) return
    const session = getActivePerSession(get())
    const sessionToolUseIds = new Set<string>()
    if (session) {
      for (const msg of session.messages) {
        for (const b of msg.content) {
          if (b.type === 'tool_use') sessionToolUseIds.add(b.toolUseId)
        }
      }
    }
    for (const id of sessionToolUseIds) {
      if (_bashOutputs[id]) window.app.unwatchBashOutput(id)
    }
    const remainingOutputs: typeof _bashOutputs = {}
    for (const [id, val] of Object.entries(_bashOutputs)) {
      if (!sessionToolUseIds.has(id)) remainingOutputs[id] = val
    }
    set((s) => ({ ...updateActivePerSession(s,() => ({
      messages: [], session: null, totalCostUsd: 0, contextTokens: 0,
      sessionProvider: null, slashCommandOutput: null,
      pendingPermissions: [], pendingQuestion: null, pendingPlanApproval: null,
      planApprovalOutcome: null, mentions: [], subagentTokens: {},
      todos: {}, _nextTodoId: 1, showTodos: false, _todosUserDismissed: false,
      awaitingAssistantReply: false,
      codexPlanRejectHintActive: false,
      chatInputFocusNonce: 0,
      queuedMessages: [],
    })), _bashOutputs: remainingOutputs }))
  },

  removeSessionFromMemory: (projectPath: string, sessionId: string) => {
    set((s) => {
      const proj = getProject(s, projectPath)
      if (!proj._sessions[sessionId]) return s
      const { [sessionId]: _, ...rest } = proj._sessions
      return {
        projectSessions: {
          ...s.projectSessions,
          [projectPath]: { ...proj, _sessions: rest },
        },
      }
    })
  },

  resetSessionForWorktreeSwitch: (projectPath: string, opts?: { wtPath?: string; gitBranch?: string | null }) => {
    set((s) => {
      const proj = getProject(s, projectPath)
      const newSession = createDefaultPerSessionState()
      newSession.cwd = opts?.wtPath ?? projectPath
      newSession._worktreePath = opts?.wtPath ?? null
      newSession._worktreeBaseBranch = opts?.gitBranch ?? null
      if (_cachedDefaultPermissionMode) newSession.permissionMode = _cachedDefaultPermissionMode
      applyDefaultModel(newSession, s.availableModels)
      const codexSelection = resolveDefaultCodexSelection(proj.codexModels)
      newSession.selectedCodexModel = codexSelection.modelId
      newSession.selectedCodexReasoningEffort = codexSelection.reasoningEffort
      return {
        projectSessions: {
          ...s.projectSessions,
          [projectPath]: (() => {
            const draftId = createSessionId()
            return {
              ...proj,
              _activeSessionId: draftId,
              _sessions: { ...proj._sessions, [draftId]: newSession },
            }
          })(),
        },
      }
    })
    triggerPrewarm(get(), projectPath)
  },

  resetSession: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    const project = getProject(get())
    const activeSession = getActivePerSession(get())
    const currentSid = resolveActiveSessionId(project)
    const nextProvider = activeSession.sessionProvider ?? activeSession.preferredProvider

    const newSessionId = nextProvider === 'codex' ? _createLocalCodexSessionId() : createSessionId()
    window.app.trace?.('session.lifecycle', 'resetSession', {
      activeProject,
      oldSid: currentSid,
      newSessionId,
      oldStatus: activeSession.status,
      oldAwaitingReply: activeSession.awaitingAssistantReply,
      oldProvider: activeSession.sessionProvider,
      knownSids: Object.keys(project._sessions),
    })

    set((s) => {
      const proj = getProject(s, activeProject)
      const newSession = createDefaultPerSessionState()
      newSession.cwd = activeProject
      newSession.preferredProvider = nextProvider
      newSession.sessionProvider = nextProvider
      applyDefaultModel(newSession, s.availableModels)
      const codexSelection = resolveDefaultCodexSelection(proj.codexModels)
      newSession.selectedCodexModel = codexSelection.modelId
      newSession.selectedCodexReasoningEffort = codexSelection.reasoningEffort
      return {
        projectSessions: {
          ...s.projectSessions,
          [activeProject]: {
            ...proj,
            _activeSessionId: newSessionId,
            _sessions: {
              ...proj._sessions,
              [newSessionId]: newSession,
            },
          },
        },
      }
    })

    let unlock!: () => void
    _resetSessionLock = new Promise<void>((r) => { unlock = r })

    let agentConfig: { permissionMode: PermissionMode; sandboxInfo: SandboxInfo } | undefined
    try {
      if (activeSession.sessionProvider === 'codex') {
        if (activeSession.status !== 'streaming' && currentSid) {
          await window.agent.resetSession(currentSid).catch(() => {})
        }
      } else if (
        isRemoteSession(get(), activeProject, currentSid) ||
        _isBusyStatus(activeSession.status) ||
        activeSession.awaitingAssistantReply
      ) {
        agentConfig = await _parkActiveSession(activeProject, project._activeSessionId, newSessionId)
      } else if (currentSid) {
        agentConfig = (await window.agent.resetSession(currentSid, newSessionId)) ?? undefined
      }

      await useAppStore.getState().clearWorktree(activeProject)
    } finally {
      _resetSessionLock = null
      unlock()
    }

    if (agentConfig) {
      set((s) => {
        const proj = s.projectSessions[activeProject]
        if (!proj) return {}
        const sess = proj._sessions[newSessionId]
        if (!sess) return {}
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: {
              ...proj,
              sandboxInfo: agentConfig!.sandboxInfo,
              _sessions: {
                ...proj._sessions,
                [newSessionId]: { ...sess, permissionMode: agentConfig!.permissionMode },
              },
            },
          },
        }
      })
    }

    triggerPrewarm(get(), activeProject)
  },

  rewindFiles: async (userMessageId: string) => {
    const { activeProject } = get()
    if (!activeProject) throw new Error('No active project')
    const result = await window.agent.rewindFiles(activeProject, userMessageId)
    if (result.canRewind !== false) {
      // Mark the user message as rewound
      set((s) => updateActivePerSession(s,(sess) => ({
        messages: sess.messages.map((m) =>
          m.checkpointId === userMessageId ? { ...m, rewound: 'code' as const } : m
        ),
      })))
    }
    return result
  },

  rewindCodeAndChat: async (userMessageId: string) => {
    const { activeProject } = get()
    if (!activeProject) throw new Error('No active project')
    const result = await window.agent.rewindCodeAndChat(activeProject, userMessageId)
    if (result.canRewind !== false) {
      _truncateAtCheckpoint(set, get, activeProject, userMessageId)
    }
    return result
  },

  rewindConversation: async (userMessageId: string) => {
    const { activeProject } = get()
    if (!activeProject) throw new Error('No active project')
    const result = await window.agent.rewindConversation(activeProject)
    if (result.canRewind !== false) {
      _truncateAtCheckpoint(set, get, activeProject, userMessageId)
    }
    return result
  },

  previewRewind: async (checkpointId: string) => {
    const { activeProject } = get()
    if (!activeProject) throw new Error('No active project')
    return window.agent.previewRewind(activeProject, checkpointId)
  },

  editQueuedMessage: (messageId) => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getActivePerSession(get())
    const msg = session.queuedMessages.find((m) => m.id === messageId)
    if (!msg) return
    const text = msg.content.find((b) => b.type === 'text')
    const attachments = msg.attachments ?? []
    window.agent.dequeueMessage(activeProject, messageId)
    set((s) => updateActivePerSession(s, (sess) => ({
      queuedMessages: sess.queuedMessages.filter((m) => m.id !== messageId),
      draftText: text && 'text' in text ? text.text : '',
      attachments,
      codexPlanRejectHintActive: false,
    })))
  },

  deleteQueuedMessage: (messageId) => {
    const { activeProject } = get()
    if (!activeProject) return
    window.agent.dequeueMessage(activeProject, messageId)
    set((s) => updateActivePerSession(s, (sess) => ({
      queuedMessages: sess.queuedMessages.filter((m) => m.id !== messageId),
    })))
  },

  setDraftText: (text) => {
    const { activeProject } = get()
    if (!activeProject) return
    const prevText = getActivePerSession(get(), activeProject).draftText
    set((s) => updateActivePerSession(s,() => ({
      draftText: text,
      ...(text.length > 0 ? { codexPlanRejectHintActive: false } : {}),
    })))
    if (prevText.length === 0 && text.length > 0) {
      triggerPrewarm(get(), activeProject)
    }
  },

  setDetailedUsage: (projectPath, sessionId, usage) => {
    set((s) => {
      const project = s.projectSessions[projectPath]
      if (!project?._sessions[sessionId]) return {}
      return updatePerSession(s, projectPath, sessionId, () => ({ detailedUsage: usage }))
    })
  },

  setSelectedModel: (model) => {
    const { activeProject, availableModels, account } = get()
    if (!activeProject) return
    const modelInfo = availableModels.find((m) => m.id === model)
    const defaultEffort = getDefaultEffortForModel(modelInfo)
    const session = getActivePerSession(get(), activeProject)
    const shouldDowngrade =
      session.permissionMode === 'auto' &&
      !checkAutoModeEligibility({
        subscriptionType: account?.subscriptionType,
        apiProvider: account?.apiProvider,
        modelSupportsAutoMode: modelInfo?.supportsAutoMode,
      }).ok
    const patch: Partial<PerSessionState> = {
      selectedModel: model,
      selectedEffort: defaultEffort,
      modelUserChosen: true,
      effortUserChosen: false,
      contextWindow: null,
    }
    if (shouldDowngrade) patch.permissionMode = 'default'
    set((s) => updateActivePerSession(s, () => patch))
    if (shouldDowngrade) void window.agent.setPermissionMode(activeProject, 'default')
    void window.agent.setSessionSettings(activeProject, { model, effort: defaultEffort ?? null })
    if (getActivePerSession(get(), activeProject).draftText.length > 0) {
      triggerPrewarm(get(), activeProject)
    }
  },

  setSelectedEffort: (effort) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s,() => ({ selectedEffort: effort, effortUserChosen: true })))
    void window.agent.setSessionSettings(activeProject, { effort: effort ?? null })
    if (getActivePerSession(get(), activeProject).draftText.length > 0) {
      triggerPrewarm(get(), activeProject)
    }
  },

  setFastMode: (enabled) => {
    void window.app.setFastMode(enabled)
  },

  setSelectedCodexModel: (model) => {
    const { activeProject } = get()
    if (!activeProject) return
    const proj = getProject(get(), activeProject)
    const selectedModel = proj.codexModels.find((entry) => entry.id === model)
    const selectedEffort = resolveCodexReasoningEffort(selectedModel)
    saveLastCodexSelection(model, selectedEffort)
    set((s) => updateActivePerSession(s, () => ({
      selectedCodexModel: model,
      selectedCodexReasoningEffort: selectedEffort,
      codexModelUserChosen: true,
      codexReasoningEffortUserChosen: false,
    })))
  },

  setSelectedCodexReasoningEffort: (effort) => {
    const { activeProject } = get()
    if (!activeProject) return
    const proj = getProject(get(), activeProject)
    const sess = getActivePerSession(get())
    const selectedModel = proj.codexModels.find((entry) => entry.id === sess.selectedCodexModel)
    const selectedEffort = resolveCodexReasoningEffort(selectedModel, effort)
    saveLastCodexSelection(sess.selectedCodexModel, selectedEffort)
    set((s) => updateActivePerSession(s, () => ({
      selectedCodexReasoningEffort: selectedEffort,
      codexReasoningEffortUserChosen: true,
    })))
  },

  setSelectedCodexPermissionPreset: (preset) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s,() => ({
      selectedCodexPermissionPreset: preset,
    })))
  },

  setSelectedCodexCollaborationMode: (mode) => {
    const { activeProject } = get()
    if (!activeProject) return
    const project = getProject(get(), activeProject)
    const sessionId = _getEffectiveSessionId(project)
    set((s) => updateActivePerSession(s, () => ({
      selectedCodexCollaborationMode: mode,
      codexPlanRejectHintActive: false,
    })))
    if (sessionId) window.app.codexCollaborationModeChange(activeProject, sessionId, mode)
  },

  refreshCodexModels: async (force = false) => {
    const { activeProject } = get()
    if (!activeProject) return

    const current = getProject(get(), activeProject)
    if (!force && current.codexModelsLoading) return
    if (!force && current.codexModels.length > 0) {
      set((s) => {
        const proj = getProject(s, activeProject)
        const activeSid = proj._activeSessionId
        if (!activeSid) return {}
        const sess = proj._sessions[activeSid] ?? createDefaultPerSessionState()
        const next = resolveSessionCodexSelection(
          proj.codexModels,
          sess.selectedCodexModel,
          sess.selectedCodexReasoningEffort,
        )
        if (
          next.modelId === sess.selectedCodexModel
          && next.reasoningEffort === sess.selectedCodexReasoningEffort
        ) {
          return {}
        }
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: {
              ...proj,
              _sessions: {
                ...proj._sessions,
                [activeSid]: {
                  ...sess,
                  selectedCodexModel: next.modelId,
                  selectedCodexReasoningEffort: next.reasoningEffort,
                },
              },
            },
          },
        }
      })
      return
    }

    set((s) => updateProjectState(s, activeProject, () => ({ codexModelsLoading: true })))
    try {
      const models = await window.app.codexListModels(activeProject)
      set((s) => {
        const proj = getProject(s, activeProject)
        const activeSid = proj._activeSessionId
        const sess = activeSid ? (proj._sessions[activeSid] ?? createDefaultPerSessionState()) : createDefaultPerSessionState()
        const selected = resolveSessionCodexSelection(
          models,
          sess.selectedCodexModel,
          sess.selectedCodexReasoningEffort,
        )
        const updatedSessions = activeSid
          ? {
              ...proj._sessions,
              [activeSid]: {
                ...sess,
                selectedCodexModel: selected.modelId,
                selectedCodexReasoningEffort: selected.reasoningEffort,
              },
            }
          : proj._sessions
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: { ...proj, codexModels: models, codexModelsLoading: false, _sessions: updatedSessions },
          },
          cachedCodexModels: models,
        }
      })
    } catch (error) {
      console.warn('[refreshCodexModels] Failed:', error)
      set((s) => updateProjectState(s, activeProject, () => ({ codexModelsLoading: false })))
    }
  },

  setPreferredProvider: (provider) => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getActivePerSession(get())
    if (session.sessionProvider && session.messages.length > 0) return
    if (session.sessionProvider === provider || (provider === 'claude' && !session.sessionProvider && session.preferredProvider === 'claude')) {
      triggerPrewarm(get(), activeProject)
      return
    }
    set((s) => {
      const proj = getProject(s, activeProject)
      const currentSid = proj._activeSessionId
      const currentSess = currentSid ? proj._sessions[currentSid] : null
      if (currentSess && currentSess.messages.length === 0) {
        const nextSid = provider === 'codex' ? _createLocalCodexSessionId() : createSessionId()
        const nextSessions = { ...proj._sessions }
        if (currentSid) delete nextSessions[currentSid]
        nextSessions[nextSid] = {
          ...currentSess,
          preferredProvider: provider,
          sessionProvider: provider,
          slashCommandOutput: null,
        }
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: {
              ...proj,
              _activeSessionId: nextSid,
              _sessions: nextSessions,
            },
          },
        }
      }
      return updateActivePerSession(s, () => ({ preferredProvider: provider, sessionProvider: provider, slashCommandOutput: null }))
    })
    if (provider === 'codex') {
      const project = getProject(get(), activeProject)
      const session = getActivePerSession(get())
      const selected = resolveSessionCodexSelection(
        project.codexModels,
        session.selectedCodexModel,
        session.selectedCodexReasoningEffort,
      )
      if (
        selected.modelId !== session.selectedCodexModel
        || selected.reasoningEffort !== session.selectedCodexReasoningEffort
      ) {
        set((s) => updateActivePerSession(s, () => ({
          selectedCodexModel: selected.modelId,
          selectedCodexReasoningEffort: selected.reasoningEffort,
        })))
      }
      void get().refreshCodexModels()
    }
    triggerPrewarm(get(), activeProject)
  },


  addAttachment: (attachment) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s,(sess) => ({
      attachments: [...sess.attachments, attachment],
    })))
  },

  removeAttachment: (index) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s,(sess) => ({
      attachments: sess.attachments.filter((_, i) => i !== index),
    })))
  },

  clearAttachments: () => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s,() => ({ attachments: [] })))
  },

  respondToPermission: async (requestId, allow, alwaysAllow, reason, selectedSuggestions, decision) => {
    const { activeProject } = get()
    if (!activeProject) return false
    const session = getActivePerSession(get(), activeProject)
    const respondedRequest = session.pendingPermissions.find((p) => p.requestId === requestId)
    if (!respondedRequest) {
      window.app.trace?.('permission.flow', 'click_miss', { reason: 'not_in_active_session_pending', activeProject }, requestId)
      return false
    }
    const activeSid = getProject(get(), activeProject)._activeSessionId ?? undefined
    window.app.trace?.('permission.flow', 'user_click', { allow, activeSid, provider: session.sessionProvider }, requestId)
    let handled = false
    try {
      const targetSid = _getEffectiveSessionId(getProject(get(), activeProject)) ?? activeSid
      if (targetSid) handled = await window.agent.respondToPermission(targetSid, requestId, allow, alwaysAllow, reason, selectedSuggestions, decision)
    } catch (err) {
      console.warn('[chat] respondToPermission failed:', err)
      return false
    }
    if (!handled) {
      window.app.trace?.('permission.flow', 'ack_miss', { activeProject, activeSid, provider: session.sessionProvider }, requestId)
      return false
    }
    set((s) => {
      const perSessionUpdate = updateActivePerSession(s, (sess) => {
        const updates: Partial<PerSessionState> = {
          pendingPermissions: sess.pendingPermissions.filter((p) => p.requestId !== requestId),
        }
        if (allow && selectedSuggestions) {
          const mode = extractModeFromSuggestions(respondedRequest?.suggestions, selectedSuggestions)
          if (mode) updates.permissionMode = mode as PermissionMode
        }
        return updates
      })
      const proj = (perSessionUpdate.projectSessions ?? s.projectSessions)[activeProject]
      if (proj) {
        return {
          projectSessions: {
            ...(perSessionUpdate.projectSessions ?? s.projectSessions),
            [activeProject]: { ...proj, hasPendingInteraction: _computeHasPendingInteraction(proj) },
          },
        }
      }
      return perSessionUpdate
    })
    return true
  },

  setPermissionMode: async (mode) => {
    const { activeProject } = get()
    if (!activeProject) return
    await window.agent.setPermissionMode(activeProject, mode)
    set((s) => updateActivePerSession(s, () => ({ permissionMode: mode })))
  },

  answerQuestion: (requestId, answers, annotations) => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getActivePerSession(get(), activeProject)
    const activeSid = getProject(get(), activeProject)._activeSessionId ?? undefined
    const targetSid = _getEffectiveSessionId(getProject(get(), activeProject)) ?? activeSid
    if (targetSid) void window.agent.answerQuestion(targetSid, requestId, answers, annotations)
    const codexQaItem = session.sessionProvider === 'codex' && session.pendingQuestion
      ? _buildQuestionAnswerItem(session.pendingQuestion.questions, answers)
      : null
    set((s) => {
      const perSessionUpdate = updateActivePerSession(s, (prev) => {
        if (!codexQaItem) return { pendingQuestion: null }
        const lastMsg = prev.messages[prev.messages.length - 1]
        if (!lastMsg?.metadata?.codex) return { pendingQuestion: null }
        const prevCodex = lastMsg.metadata.codex
        return {
          pendingQuestion: null,
          messages: prev.messages.map((msg, i) =>
            i !== prev.messages.length - 1 ? msg : {
              ...msg,
              metadata: { ...msg.metadata, codex: { ...prevCodex, items: [...prevCodex.items, codexQaItem] } },
            },
          ),
        }
      })
      const proj = (perSessionUpdate.projectSessions ?? s.projectSessions)[activeProject]
      if (proj) {
        return {
          projectSessions: {
            ...(perSessionUpdate.projectSessions ?? s.projectSessions),
            [activeProject]: { ...proj, hasPendingInteraction: _computeHasPendingInteraction(proj) },
          },
        }
      }
      return perSessionUpdate
    })
  },

  dismissQuestion: (requestId) => {
    const { activeProject } = get()
    if (!activeProject) return
    const activeSid = getProject(get(), activeProject)._activeSessionId ?? undefined
    const targetSid = _getEffectiveSessionId(getProject(get(), activeProject)) ?? activeSid
    if (targetSid) void window.agent.dismissQuestion(targetSid, requestId)
    set((s) => {
      const perSessionUpdate = updateActivePerSession(s, () => ({ pendingQuestion: null }))
      const proj = (perSessionUpdate.projectSessions ?? s.projectSessions)[activeProject]
      if (proj) {
        return {
          projectSessions: {
            ...(perSessionUpdate.projectSessions ?? s.projectSessions),
            [activeProject]: { ...proj, hasPendingInteraction: _computeHasPendingInteraction(proj) },
          },
        }
      }
      return perSessionUpdate
    })
  },

  respondToPlanApproval: (requestId, approved, feedback, postApprovalMode) => {
    const { activeProject } = get()
    if (!activeProject) return
    const activeSid = getProject(get(), activeProject)._activeSessionId ?? undefined
    const targetSid = _getEffectiveSessionId(getProject(get(), activeProject)) ?? activeSid
    if (targetSid) window.agent.respondToPlanApproval(targetSid, requestId, approved, feedback)
    if (approved) {
      const nextMode: PermissionMode = postApprovalMode ?? 'default'
      void window.agent.setPermissionMode(activeProject, nextMode)
    }
    set((s) => {
      const perSessionUpdate = updateActivePerSession(s, () => ({
        pendingPlanApproval: null,
        planApprovalOutcome: { approved, feedback },
        ...(approved && { permissionMode: (postApprovalMode ?? 'default') as PermissionMode }),
      }))
      const proj = (perSessionUpdate.projectSessions ?? s.projectSessions)[activeProject]
      if (proj) {
        return {
          projectSessions: {
            ...(perSessionUpdate.projectSessions ?? s.projectSessions),
            [activeProject]: { ...proj, hasPendingInteraction: _computeHasPendingInteraction(proj) },
          },
        }
      }
      return perSessionUpdate
    })
  },

  setSandboxMode: async (mode) => {
    const { activeProject } = get()
    if (!activeProject) return
    const updated = await window.agent.setSandboxMode(activeProject, mode)
    set((s) => updateProjectState(s, activeProject, () => ({ sandboxInfo: updated })))
  },

  cyclePermissionMode: () => {
    const session = getActivePerSession(get())
    const { account, availableModels } = get()
    const modelInfo = availableModels.find((m) => m.id === session.selectedModel)
    const startIdx = PERMISSION_MODES.indexOf(session.permissionMode)
    const anchor = startIdx === -1 ? 0 : startIdx
    for (let step = 1; step <= PERMISSION_MODES.length; step++) {
      const candidate = PERMISSION_MODES[(anchor + step) % PERMISSION_MODES.length]
      if (candidate === 'auto') {
        const elig = checkAutoModeEligibility({
          subscriptionType: account?.subscriptionType,
          apiProvider: account?.apiProvider,
          modelSupportsAutoMode: modelInfo?.supportsAutoMode,
        })
        if (!elig.ok) continue
      }
      get().setPermissionMode(candidate)
      return
    }
  },

  togglePlanModeShortcut: () => {
    const session = getActivePerSession(get())
    const provider = session.sessionProvider ?? session.preferredProvider
    if (provider === 'codex') {
      const next: CodexCollaborationMode = session.selectedCodexCollaborationMode === 'plan' ? 'default' : 'plan'
      get().setSelectedCodexCollaborationMode(next)
      return
    }
    get().cyclePermissionMode()
  },


  dismissSlashCommandOutput: () => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s,() => ({ slashCommandOutput: null })))
  },

  toggleTodos: () => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s,(sess) => {
      const willShow = !sess.showTodos
      return { showTodos: willShow, _todosUserDismissed: willShow ? false : true }
    }))
  },


  addMention: (mention) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s,(sess) => {
      if (sess.mentions.some((m) => m.value === mention.value)) return {}
      return { mentions: [...sess.mentions, mention] }
    }))
  },

  removeMention: (value) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s,(sess) => ({
      mentions: sess.mentions.filter((m) => m.value !== value),
    })))
  },

  setMiniAppContext: (appId, data) => {
    if (!get().activeProject) return
    set((s) => updateActivePerSession(s, (sess) => ({
      miniAppContexts: {
        ...sess.miniAppContexts,
        [appId]: {
          appId,
          appName: data.appName,
          summary: data.summary,
          content: data.content,
          mode: data.mode,
          color: data.color,
          checked: data.mode === 'inject',
        },
      },
    })))
  },

  clearMiniAppContext: (appId) => {
    if (!get().activeProject) return
    set((s) => updateActivePerSession(s, (sess) => {
      const { [appId]: _, ...rest } = sess.miniAppContexts
      return { miniAppContexts: rest }
    }))
  },

  toggleMiniAppContext: (appId) => {
    if (!get().activeProject) return
    set((s) => updateActivePerSession(s, (sess) => {
      const slot = sess.miniAppContexts[appId]
      if (!slot) return {}
      return {
        miniAppContexts: {
          ...sess.miniAppContexts,
          [appId]: { ...slot, checked: !slot.checked },
        },
      }
    }))
  },

  addUserSelection: (text) => {
    if (!get().activeProject) return
    const trimmed = text.trim()
    if (!trimmed) return
    set((s) => updateActivePerSession(s, (sess) => ({
      userSelections: [...sess.userSelections, trimmed],
    })))
  },

  removeUserSelectionAt: (index) => {
    if (!get().activeProject) return
    set((s) => updateActivePerSession(s, (sess) => ({
      userSelections: sess.userSelections.filter((_, i) => i !== index),
    })))
  },

  clearUserSelections: () => {
    if (!get().activeProject) return
    set((s) => updateActivePerSession(s, () => ({ userSelections: [] })))
  },

  fetchSessions: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    try {
      const sessions = await window.app.listSessionsForFolderPage(activeProject, SESSIONS_PAGE_SIZE, 0)
      set((s) => updateProjectState(s, activeProject, () => ({
        sessions,
        sessionsPage: 1,
        sessionsHasMore: sessions.length >= SESSIONS_PAGE_SIZE,
      })))
    } catch (err) { console.warn('[chat] fetchSessions failed:', err) }
  },

  fetchSessionsPage: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    const project = getProject(get())
    if (!project.sessionsHasMore) return
    const pageToFetch = project.sessionsPage
    const offset = pageToFetch * SESSIONS_PAGE_SIZE
    try {
      const page = await window.app.listSessionsForFolderPage(activeProject, SESSIONS_PAGE_SIZE, offset)
      set((s) => updateProjectState(s, activeProject, (proj) => {
        if (proj.sessionsPage !== pageToFetch) return {}
        return {
          sessions: [...proj.sessions, ...page],
          sessionsPage: pageToFetch + 1,
          sessionsHasMore: page.length >= SESSIONS_PAGE_SIZE,
        }
      }))
    } catch (err) { console.warn('[chat] fetchSessionsPage failed:', err) }
  },

  toggleHistory: () => {
    const { activeProject } = get()
    if (!activeProject) return
    const project = getProject(get())
    const willShow = !project.showHistory
    if (willShow) get().fetchSessions()
    set((s) => updateProjectState(s, activeProject, () => ({ showHistory: willShow })))
  },

  renameSession: async (sessionId, title) => {
    const { activeProject } = get()
    if (!activeProject) return
    await window.app.renameSession(sessionId, title)
    set((s) => updateProjectState(s, activeProject, (proj) => ({
      sessions: proj.sessions.map((entry) =>
        entry.sessionId === sessionId ? { ...entry, title } : entry
      ),
    })))
  },

  switchSession: async (sessionId) => {
    const { activeProject } = get()
    if (!activeProject) return
    const project = getProject(get())
    {
      const activeSession = getActivePerSession(get())
      window.app.trace?.('session.lifecycle', 'switchSession', {
        from: project._activeSessionId,
        to: sessionId,
        fromStatus: activeSession.status,
        fromAwaitingReply: activeSession.awaitingAssistantReply,
        fromProvider: activeSession.sessionProvider,
        toInSessions: !!project._sessions[sessionId],
        knownSids: Object.keys(project._sessions),
      })
    }

    if (project.unseenCompletedSessions.has(sessionId)) {
      set((s) => {
        const proj = s.projectSessions[activeProject]
        if (!proj) return {}
        const next = new Set(proj.unseenCompletedSessions)
        next.delete(sessionId)
        return { projectSessions: { ...s.projectSessions, [activeProject]: { ...proj, unseenCompletedSessions: next } } }
      })
    }

    // Case A: Session already in _sessions (background streaming or parked)
    if (project._sessions[sessionId]) {
      const activeSession = getActivePerSession(get())
      if (_isBusyStatus(activeSession.status) || activeSession.awaitingAssistantReply) {
        await _parkActiveSession(activeProject, project._activeSessionId)
      }

      const cachedTarget = project._sessions[sessionId]
      const worktreeMissing =
        !!cachedTarget._worktreePath &&
        !cachedTarget._worktreeRemoved &&
        !(await window.app.pathExists(cachedTarget._worktreePath))

      set((s) => {
        const proj = getProject(s, activeProject)
        const targetSession = proj._sessions[sessionId]
        const patched: PerSessionState = worktreeMissing
          ? { ...targetSession, _worktreeRemoved: true, cwd: activeProject }
          : { ...targetSession, cwd: _getSessionCwd(activeProject, targetSession) }
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: {
              ...proj,
              _activeSessionId: sessionId,
              showHistory: false,
              _sessions: {
                ...proj._sessions,
                [sessionId]: patched,
              },
            },
          },
        }
      })

      const targetSession = get().projectSessions[activeProject]!._sessions[sessionId]
      const runtimeSession = targetSession

      window.app.trace?.('agent.store', 'switchSession:A', {
        sessionId,
        _worktreePath: targetSession._worktreePath,
        _worktreeBaseBranch: targetSession._worktreeBaseBranch,
        _worktreeRemoved: targetSession._worktreeRemoved,
      })
      if (targetSession._worktreePath && !targetSession._worktreeRemoved) {
        useAppStore.getState().setActiveWorktree(activeProject, targetSession._worktreePath)
      } else if (!targetSession._worktreeBaseBranch || targetSession._worktreeRemoved) {
        useAppStore.getState().setActiveWorktree(activeProject, null)
      }

      if (!targetSession.selectedModel) {
        const defaultModel = get().availableModels[0]
        if (defaultModel) {
          const effort = getDefaultEffortForModel(defaultModel)
          set((s) => updatePerSession(s, activeProject, sessionId, () => ({
            selectedModel: defaultModel.id,
            ...(effort ? { selectedEffort: effort } : {}),
          })))
        }
      }

      if (targetSession.sessionProvider !== 'codex') {
        try {
          await _syncAndResumeSession(activeProject, sessionId, set, _getSessionCwd(activeProject, runtimeSession))
        } catch (err) {
          console.warn('[chat] resumeSession failed:', err)
        }
      }
      return
    }

    // Case B: Load from DB
    let savedMessages: ChatMessage[] = []
    let savedCost = 0
    let savedTokens = 0
    let savedWorktreeBranch: string | null = null
    let savedWorktreePath: string | undefined
    let savedProvider: string | null = null
    try {
      const saved = await window.app.loadSessionState(sessionId)
      if (saved) {
        savedMessages = saved.messages
        savedCost = saved.totalCostUsd
        savedTokens = saved.contextTokens
        savedWorktreeBranch = saved.gitBranch
        savedProvider = saved.provider
        savedWorktreePath = saved.worktreePath ?? undefined
      }
    } catch (err) { console.warn('[chat] loadSessionState failed:', err) }

    const restoredProvider: ChatProvider = (savedProvider as ChatProvider) ?? DEFAULT_PROVIDER
    const restoredCodexUsage = findLatestCodexUsage(savedMessages)

    const freshProject = getProject(get())
    const freshActiveSession = getActivePerSession(get())
    if (_isBusyStatus(freshActiveSession.status)) {
      await _parkActiveSession(activeProject, freshProject._activeSessionId)
    }

    const defaultPermissionMode = await _getDefaultPermissionMode()
    const restoredSession: PerSessionState = {
      ...createDefaultPerSessionState(),
      cwd: _getSessionCwd(activeProject, { _worktreePath: savedWorktreePath ?? null, _worktreeRemoved: false }),
      messages: savedMessages,
      totalCostUsd: savedCost,
      contextTokens: savedTokens,
      contextWindow: restoredCodexUsage?.contextWindow && restoredCodexUsage.contextWindow > 0
        ? restoredCodexUsage.contextWindow
        : null,
      codexUsageSnapshot: restoredCodexUsage,
      _worktreeBaseBranch: savedWorktreeBranch,
      _worktreePath: savedWorktreePath ?? null,
      preferredProvider: restoredProvider,
      sessionProvider: restoredProvider,
      lastAssistantMessageId: savedMessages.findLast((m) => m.role === 'assistant')?.id ?? null,
      _historyHydrated: true,
      permissionMode: defaultPermissionMode,
    }
    if (restoredProvider !== 'codex') {
      applyDefaultModel(restoredSession, get().availableModels)
    } else {
      const codexSelection = resolveSessionCodexSelection(
        freshProject.codexModels,
        restoredSession.selectedCodexModel,
        restoredSession.selectedCodexReasoningEffort,
      )
      restoredSession.selectedCodexModel = codexSelection.modelId
      restoredSession.selectedCodexReasoningEffort = codexSelection.reasoningEffort
    }

    set((s) => {
      const proj = getProject(s, activeProject)
      return {
        projectSessions: {
          ...s.projectSessions,
          [activeProject]: {
            ...proj,
            _activeSessionId: sessionId,
            _sessions: { ...proj._sessions, [sessionId]: restoredSession },
            showHistory: false,
          },
        },
      }
    })

    window.app.trace?.('agent.store', 'switchSession:B', {
      sessionId,
      savedWorktreePath,
      savedWorktreeBranch,
    })
    if (savedWorktreePath) {
      useAppStore.getState().setActiveWorktree(activeProject, savedWorktreePath)
    } else {
      useAppStore.getState().setActiveWorktree(activeProject, null)
    }

    if (restoredSession.sessionProvider !== 'codex') {
      try {
        await _syncAndResumeSession(activeProject, sessionId, set, _getSessionCwd(activeProject, getProject(get())._sessions[sessionId]))
      } catch (err) {
        console.warn('[chat] resumeSession failed:', err)
      }
    } else {
      triggerPrewarm(get(), activeProject)
    }
  },

  addDir: (path, scope) => {
    const { activeProject } = get()
    if (!activeProject) return
    if (scope === 'session') {
      set((s) => {
        const sess = getActivePerSession(s)
        const proj = getProject(s, activeProject)
        if (sess.additionalDirs.includes(path) || proj.projectAdditionalDirs.includes(path)) return {}
        return updateActivePerSession(s, () => ({ additionalDirs: [...sess.additionalDirs, path] }))
      })
    } else {
      set((s) => {
        const sess = getActivePerSession(s)
        const proj = getProject(s, activeProject)
        if (sess.additionalDirs.includes(path) || proj.projectAdditionalDirs.includes(path)) return {}
        const updated = [...proj.projectAdditionalDirs, path]
        window.agent.writeProjectAdditionalDirs(activeProject, updated).catch(() => {})
        return updateProjectState(s, activeProject, () => ({ projectAdditionalDirs: updated }))
      })
    }
  },

  removeDir: (path, scope) => {
    const { activeProject } = get()
    if (!activeProject) return
    if (scope === 'session') {
      set((s) => updateActivePerSession(s, (sess) => ({
        additionalDirs: sess.additionalDirs.filter((d) => d !== path),
      })))
    } else {
      set((s) => {
        const proj = getProject(s, activeProject)
        const updated = proj.projectAdditionalDirs.filter((d) => d !== path)
        window.agent.writeProjectAdditionalDirs(activeProject, updated).catch(() => {})
        return updateProjectState(s, activeProject, () => ({ projectAdditionalDirs: updated }))
      })
    }
  },

  setShowDirManager: (show) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateProjectState(s, activeProject, () => ({ showDirManager: show })))
  },

  setShowReviewPanel: (show) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateProjectState(s, activeProject, () => ({ showReviewPanel: show })))
  },

  startCodexReview: (target) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateProjectState(s, activeProject, () => ({ showReviewPanel: false })))
    let command: string
    if (target.type === 'uncommittedChanges') command = '/review'
    else if (target.type === 'baseBranch') command = '/review branch'
    else command = `/review commit ${target.sha}`
    get().sendMessage(command)
  },
}))

// --- Selector hook: read from the active project's session state ---

const DEFAULT_PER_SESSION = createDefaultPerSessionState()
const DEFAULT_PROJECT = createDefaultProjectState()
const DEFAULT_VIEW: ActiveSessionView = { ...DEFAULT_PER_SESSION, ...DEFAULT_PROJECT }

let _cachedProject: ProjectState | null = null
let _cachedSession: PerSessionState | null = null
let _cachedView: ActiveSessionView | null = null

export function useActiveSession<T>(selector: (s: ActiveSessionView) => T): T {
  return useChatStore((store) => {
    const project = store.activeProject
      ? store.projectSessions[store.activeProject]
      : null
    const p = project ?? DEFAULT_PROJECT
    const session = (p._activeSessionId ? p._sessions[p._activeSessionId] : null) ?? DEFAULT_PER_SESSION
    if (!project) return selector(DEFAULT_VIEW)
    if (p !== _cachedProject || session !== _cachedSession) {
      _cachedProject = p
      _cachedSession = session
      _cachedView = { ...session, ...p }
    }
    return selector(_cachedView!)
  })
}

export function useIsRemoteLocked(): boolean {
  return useChatStore((store) => {
    if (!store.activeProject) return false
    const project = store.projectSessions[store.activeProject]
    return isRemoteSession(store, store.activeProject, project?._activeSessionId)
  })
}

export function useBashOutput(toolUseId: string): { content: string; finished: boolean; outputPath?: string } | undefined {
  return useChatStore((s) => s._bashOutputs[toolUseId])
}

/** Apply a content delta to the content array, merging consecutive text blocks and deduplicating tool_use. */
export function mergeMessagesByMaxSeq(snap: ChatMessage[], existing: ChatMessage[]): ChatMessage[] {
  const existingById = new Map(existing.map((m) => [m.id, m]))
  const result: ChatMessage[] = []
  const seen = new Set<string>()
  for (const sm of snap) {
    const em = existingById.get(sm.id)
    if (!em) {
      result.push(sm)
    } else {
      result.push(compareMessageSeq(em, sm) > 0 ? em : sm)
    }
    seen.add(sm.id)
  }
  for (const em of existing) {
    if (!seen.has(em.id)) result.push(em)
  }
  return result
}

export function applyDelta(content: ContentBlock[], delta: ContentBlock): ContentBlock[] {
  if (delta.type === 'text') {
    const last = content[content.length - 1]
    if (last?.type === 'text') {
      return [...content.slice(0, -1), { type: 'text', text: last.text + delta.text }]
    }
  }
  if (delta.type === 'thinking') {
    const last = content[content.length - 1]
    if (last?.type === 'thinking') {
      return [...content.slice(0, -1), { type: 'thinking', thinking: last.thinking + delta.thinking }]
    }
  }
  if (delta.type === 'tool_use') {
    const idx = content.findIndex((b) => b.type === 'tool_use' && b.toolUseId === delta.toolUseId)
    if (idx !== -1) {
      const existing = content[idx]
      const preserved = existing.type === 'tool_use'
        ? { startedAt: existing.startedAt, elapsedSeconds: existing.elapsedSeconds, ...(!delta.status && existing.status ? { status: existing.status } : {}) }
        : {}
      return content.map((b, i) => (i === idx ? { ...preserved, ...delta } : b))
    }
    return [...content, { ...delta, startedAt: Date.now() }]
  }
  if (delta.type === 'tool_result') {
    const updated = content.map((b) =>
      b.type === 'tool_use' && b.toolUseId === delta.toolUseId ? { ...b, status: 'complete' as const } : b,
    )
    return [...updated, delta]
  }
  return [...content, delta]
}
