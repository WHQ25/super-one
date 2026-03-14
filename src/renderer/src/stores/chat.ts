import { create } from 'zustand'
import { useAppStore } from './app'
import { buildSlashCommands, extractModeFromSuggestions, findCheckpointTarget, getCommandOutputMode, remapMessagesForFork } from './chat-helpers'
import type { AccountInfo, AgentEvent, AgentInfo, AgentStatus, AskUserQuestionRequest, ChatMessage, CodexAgentMessageItem, CodexAuthMode, CodexAuthStatus, CodexCollaborationMode, CodexPermissionPreset, CodexReasoningEffort, CodexReviewTarget, CodexThreadItem, CodexUsageInfo, ContentBlock, EffortLevel, ImageAttachment, ModelOption, PlanApprovalRequest, PermissionMode, PermissionRequest, RewindFilesResult, SandboxInfo, SandboxMode, SessionHistoryEntry, SessionInfo, SlashCommandInfo, TodoItem, UserQuestion } from '../../../shared/agent-types'

type Corner = 'br' | 'bl' | 'tr' | 'tl'
export type ChatProvider = 'claude' | 'codex'
export const DEFAULT_PROVIDER: ChatProvider = 'claude'
const SESSIONS_PAGE_SIZE = 30
const CODEX_LAST_SELECTION_STORAGE_KEY = 'super-one.codex.last-selection.v1'

export type MentionKind = 'file' | 'directory' | 'agent'
export interface Mention {
  kind: MentionKind
  value: string
  displayName: string
}

// --- Per-project session state (unified per-session architecture) ---

export const DRAFT_SESSION_ID = '__draft__'

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
  subagentTokens: Record<string, { input: number; output: number }>
  taskProgress: Record<string, { description: string; lastToolName?: string; totalTokens: number; toolUses: number; durationMs: number; completed?: boolean; outputFile?: string; toolHistory: Array<{ toolName: string; description: string }> }>
  streamingTokens: { input: number; output: number }
  codexUsageSnapshot: CodexUsageInfo | null
  codexTurnLastUsage: CodexUsageInfo | null
  selectedModel: string
  selectedEffort?: EffortLevel
  selectedCodexModel: string
  selectedCodexReasoningEffort?: CodexReasoningEffort
  selectedCodexPermissionPreset: CodexPermissionPreset
  selectedCodexCollaborationMode: CodexCollaborationMode
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
  lastEventAt: number
  prefireMessage: { content: string; attachments: ImageAttachment[]; mentions: Mention[] } | null
  activeCodexMessageId: string | null
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
    subagentTokens: {},
    taskProgress: {},
    streamingTokens: { input: 0, output: 0 },
    codexUsageSnapshot: null,
    codexTurnLastUsage: null,
    selectedModel: '',
    selectedEffort: undefined,
    selectedCodexModel: '',
    selectedCodexReasoningEffort: undefined,
    selectedCodexPermissionPreset: 'default',
    selectedCodexCollaborationMode: 'default',
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
    lastEventAt: 0,
    prefireMessage: null,
    activeCodexMessageId: null,
  }
}

function applyDefaultModel(session: PerSessionState, models: ModelOption[]): void {
  const defaultModel = models[0]
  if (defaultModel) {
    session.selectedModel = defaultModel.id
    if (defaultModel.supportedEffortLevels?.length) {
      session.selectedEffort = 'medium'
    }
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

interface ChatStore {
  projectSessions: Record<string, ProjectState>
  activeProject: string | null

  // Bash output live content (not persisted)
  _bashOutputs: Record<string, { content: string; finished: boolean; outputPath?: string }>

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

  // Global resource setter
  setGlobalResources: (
    models: ModelOption[],
    account: AccountInfo,
    slashCommands: SlashCommandInfo[],
    userSkills: SlashCommandInfo[],
    userCommands: SlashCommandInfo[],
    userAgents: AgentInfo[],
    codexModels?: ModelOption[],
  ) => void

  // Event handling
  handleAgentEvent: (event: AgentEvent) => void

  // Project switching
  switchProject: (projectPath: string) => Promise<void>
  ensureSession: (projectPath: string) => void

  // Message actions (operate on activeProject)
  sendMessage: (content: string) => Promise<void>
  interrupt: () => Promise<void>

  // UI actions
  toggleOpen: () => void
  setCorner: (corner: Corner) => void
  clearMessages: () => void
  resetSession: () => Promise<void>
  resetSessionForWorktreeSwitch: (projectPath: string) => void
  removeSessionFromMemory: (projectPath: string, sessionId: string) => void
  rewindFiles: (userMessageId: string) => Promise<RewindFilesResult>
  rewindCodeAndChat: (userMessageId: string) => Promise<RewindFilesResult>
  rewindConversation: (userMessageId: string) => Promise<RewindFilesResult>
  previewRewind: (checkpointId: string) => Promise<RewindFilesResult>

  // Prefire (queue message during streaming)
  setPrefireMessage: (content: string) => void
  cancelPrefireMessage: () => void
  discardPrefireMessage: () => void

  // Draft text
  setDraftText: (text: string) => void

  // Model actions
  setSelectedModel: (model: string) => void
  setSelectedEffort: (effort?: EffortLevel) => void
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
  respondToPermission: (requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[], decision?: 'cancel') => void
  setPermissionMode: (mode: PermissionMode) => Promise<void>
  cyclePermissionMode: () => void
  togglePlanModeShortcut: () => void
  setSandboxMode: (mode: SandboxMode) => Promise<void>

  // Question actions
  answerQuestion: (requestId: string, answers: Record<string, string>) => void
  dismissQuestion: (requestId: string) => void

  // Plan approval
  respondToPlanApproval: (requestId: string, approved: boolean, feedback?: string) => void

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
  if (!project._activeSessionId) return null
  if (project._activeSessionId === DRAFT_SESSION_ID) return null
  return project._activeSessionId
}

function upsertCodexItem(items: CodexThreadItem[], next: CodexThreadItem): CodexThreadItem[] {
  const idx = items.findIndex((item) => item.id === next.id)
  if (idx === -1) return [...items, next]
  const cloned = [...items]
  cloned[idx] = next
  return cloned
}

function removeCodexItem(items: CodexThreadItem[], itemId: string): CodexThreadItem[] {
  return items.filter((item) => item.id !== itemId)
}

function pruneTransientCodexItems(items: CodexThreadItem[]): CodexThreadItem[] {
  return items.filter((item) => item.type !== 'reasoning')
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

function accumulateCodexFooterTokens(
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

function findLatestCodexUsage(messages: ChatMessage[]): CodexUsageInfo | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = messages[i].metadata?.codex?.usage
    if (hasValidCodexUsageSnapshot(usage as CodexUsageInfo | null)) return usage as CodexUsageInfo
  }
  return null
}

// --- Apply agent event to a session (pure function) ---

function applyEventToSession(session: PerSessionState, event: AgentEvent): Partial<PerSessionState> {
  switch (event.type) {
    case 'message_start':
      return { messages: [...session.messages, event.message], promptSuggestion: null, awaitingAssistantReply: false, lastEventAt: Date.now() }

    case 'content_delta': {
      let updatedMessages = session.messages.map((msg) => {
        if (msg.id !== event.messageId) return msg
        return { ...msg, content: applyDelta(msg.content, event.delta) }
      })

      let extraUpdates: Partial<PerSessionState> = {}

      if (event.delta.type === 'tool_result') {
        const resultDelta = event.delta
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
      const newCost = session.totalCostUsd + (event.metadata?.costUsd ?? 0)
      const lastAssistantId = session.messages.findLast((m) => m.role === 'assistant')?.id
      const isCurrentTurn = event.messageId === lastAssistantId
      const ft = session.streamingTokens
      const consumedTokens = isCurrentTurn && (ft.input > 0 || ft.output > 0)
        ? { input: ft.input, output: ft.output }
        : undefined
      const completingMsg = session.messages.find((m) => m.id === event.messageId)
      const agentToolIds = new Set<string>()
      if (completingMsg) {
        for (const b of completingMsg.content) {
          if (b.type === 'tool_use' && b.toolName === 'Agent') agentToolIds.add(b.toolUseId)
        }
      }
      const codexUsage = event.metadata?.codex?.usage ?? null
      const hasUncompletedAgents = agentToolIds.size > 0 && [...agentToolIds].some((id) => !session.taskProgress[id]?.completed)
      return {
        messages: session.messages.map((msg) => {
          if (msg.id !== event.messageId) return msg
          return {
            ...msg,
            status: 'complete' as const,
            metadata: { ...msg.metadata, ...event.metadata, ...(consumedTokens ? { consumedTokens } : {}) },
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
        } : {}),
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

    case 'message_interrupted':
      return {
        messages: session.messages.map((msg) => {
          if (msg.id !== event.messageId) return msg
          return {
            ...msg,
            status: 'interrupted' as const,
            metadata: event.metadata ? { ...msg.metadata, ...event.metadata } : msg.metadata,
          }
        }),
        pendingPermissions: [],
        pendingQuestion: null,
        pendingPlanApproval: null,
        awaitingAssistantReply: false,
        lastEventAt: 0,
      }

    case 'message_error':
      return {
        awaitingAssistantReply: false,
        lastEventAt: 0,
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
      return { status: event.status }

    case 'prompt_suggestion':
      return { promptSuggestion: event.suggestion }

    case 'permission_request':
      if (session.pendingPermissions.some((p) => p.requestId === event.request.requestId)) return {}
      return { pendingPermissions: [...session.pendingPermissions, event.request] }

    case 'permission_mode_change':
      return { permissionMode: event.mode }

    case 'session_init':
      console.log('[applyEvent] session_init', { sessionId: event.session?.sessionId })
      return { session: event.session, sessionProvider: session.sessionProvider ?? DEFAULT_PROVIDER }

    case 'ask_user_question':
      return { pendingQuestion: event.request }

    case 'plan_approval':
      return { pendingPlanApproval: event.request }

    case 'tool_input_delta':
      // Skip state updates for streaming input deltas — the complete input arrives
      // via the 'result' event (content_delta with full tool_use block) which replaces
      // the streaming block entirely via applyDelta dedup. Updating state on every
      // delta caused massive re-render overhead for large-input tools (Write/Edit).
      return { lastEventAt: Date.now() }

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
      return {}

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

    case 'message_usage':
      if (event.codexUsage) {
        const nextStreamingTokens = accumulateCodexFooterTokens(session.streamingTokens, event.codexUsage, session.codexTurnLastUsage)
        return {
          streamingTokens: nextStreamingTokens,
          contextTokens: (() => {
            const total = getCodexContextTokens(event.codexUsage)
            return total > 0 ? total : session.contextTokens
          })(),
          contextWindow: event.codexUsage.contextWindow > 0 ? event.codexUsage.contextWindow : session.contextWindow,
          codexUsageSnapshot: event.codexUsage,
          codexTurnLastUsage: event.codexUsage,
        }
      }
      return { streamingTokens: { input: event.inputTokens, output: event.outputTokens } }

    case 'codex_thread_started':
      return {
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
          }
        }),
      }

    case 'codex_item_delta':
      return {
        messages: session.messages.map((msg) => {
          if (msg.id !== event.messageId) return msg
          const prevCodex = msg.metadata?.codex ?? { threadId: null, usage: null, items: [] }
          const nextItems = event.item.type === 'reasoning' && event.phase === 'completed'
            ? removeCodexItem(prevCodex.items, event.item.id)
            : upsertCodexItem(prevCodex.items, event.item)
          return {
            ...msg,
            metadata: {
              ...msg.metadata,
              codex: {
                ...prevCodex,
                items: nextItems,
              },
            },
          }
        }),
      }

    case 'slash_command_output': {
      const cmd = session._pendingSlashCommand
      if (cmd === 'compact') {
        const filtered = session.messages.filter((m) => m.id !== event.messageId)
        const lastUserIdx = filtered.findLastIndex((m) => m.role === 'user')
        if (lastUserIdx >= 0) filtered.splice(lastUserIdx, 1)
        return { _pendingSlashCommand: '', messages: filtered }
      }
      const filtered = session.messages.filter((m) => m.id !== event.messageId)
      const lastUserIdx = filtered.findLastIndex((m) => m.role === 'user')
      if (lastUserIdx >= 0) filtered.splice(lastUserIdx, 1)
      return {
        slashCommandOutput: { command: cmd, content: event.content, mode: getCommandOutputMode(cmd) },
        _pendingSlashCommand: '',
        messages: filtered,
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
      const targetIdx = findCheckpointTarget(msgs, event.messageId)
      if (targetIdx === -1) return {}
      if (msgs[targetIdx].checkpointId) return {}
      msgs[targetIdx] = { ...msgs[targetIdx], checkpointId: event.checkpointId, resumePointId: event.resumePointId }
      return { messages: msgs }
    }

    case 'task_notification': {
      if (!event.toolUseId) return {}
      const tid = event.toolUseId
      const file = event.outputFile
      const messagesUpdate = file
        ? {
            messages: session.messages.map((msg) => ({
              ...msg,
              content: msg.content.map((block) =>
                block.type === 'tool_result' && block.toolUseId === tid ? { ...block, outputPath: file } : block,
              ),
            })),
          }
        : {}
      const prevProgress = session.taskProgress[tid]
      const usageUpdate = event.usage ? {
        totalTokens: event.usage.totalTokens,
        toolUses: event.usage.toolUses,
        durationMs: event.usage.durationMs,
      } : {}
      return {
        ...messagesUpdate,
        taskProgress: {
          ...session.taskProgress,
          [tid]: {
            ...(prevProgress ?? { description: '', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] }),
            ...usageUpdate,
            completed: true,
            outputFile: file || prevProgress?.outputFile,
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
      return {
        taskProgress: {
          ...session.taskProgress,
          [event.toolUseId]: {
            ...(prev ?? { description: '', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] }),
            description: event.description,
            lastToolName: event.lastToolName,
            totalTokens: event.usage.totalTokens,
            toolUses: event.usage.toolUses,
            durationMs: event.usage.durationMs,
            toolHistory,
          },
        },
      }
    }

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

function _saveSessionState(get: () => ChatStore, projectPath: string): void {
  const project = get().projectSessions[projectPath]
  if (!project) return
  const sessionId = _getEffectiveSessionId(project)
  if (!sessionId) return
  const session = project._sessions[sessionId]
  if (!session || session.messages.length === 0) return

  const branch = _getWorktreeBranch(projectPath, session)
  const wtPath = session._worktreePath ?? undefined
  const title = _extractTitle(session.messages)
  window.app.createSession(projectPath, sessionId, !!branch || undefined, branch, wtPath, title)
    .then(() => window.app.saveSessionState(sessionId, {
      messages: session.messages,
      totalCostUsd: session.totalCostUsd,
      contextTokens: session.contextTokens,
      title,
      provider: session.sessionProvider ?? undefined,
    }))
    .catch((err) => console.warn('[saveSessionState] failed:', err))
}

function _savePerSessionSnapshot(projectPath: string, sessionId: string, session: PerSessionState): Promise<void> {
  if (!sessionId || sessionId === DRAFT_SESSION_ID || session.messages.length === 0) return Promise.resolve()

  const branch = _getWorktreeBranch(projectPath, session)
  const wtPath = session._worktreePath ?? undefined
  const title = _extractTitle(session.messages)
  return window.app.createSession(projectPath, sessionId, !!branch || undefined, branch, wtPath, title)
    .then(() => window.app.saveSessionState(sessionId, {
      messages: session.messages,
      totalCostUsd: session.totalCostUsd,
      contextTokens: session.contextTokens,
      title,
      provider: session.sessionProvider ?? undefined,
    }))
    .then(() => {})
    .catch((err) => console.warn('[saveSessionSnapshot] failed:', err))
}

function _buildQuestionAnswerItem(
  questions: UserQuestion[],
  answers: Record<string, string>,
): CodexAgentMessageItem {
  const lines = questions.map((q) => {
    const key = q.id ?? q.question
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

function _isLiveSession(session: PerSessionState | undefined): boolean {
  return !!session && (
    session.status === 'streaming'
    || session.pendingPermissions.length > 0
    || !!session.pendingQuestion
    || !!session.pendingPlanApproval
    || !!session.awaitingAssistantReply
  )
}

function _needsForegroundActivation(session: PerSessionState): boolean {
  return session.status === 'streaming' || session.pendingPermissions.length > 0 || !!session.pendingQuestion || !!session.pendingPlanApproval
}

async function _ensureClaudeSessionReadyForSend(get: () => ChatStore, projectPath: string): Promise<void> {
  const project = get().projectSessions[projectPath]
  if (!project) return
  const sessionId = resolveActiveSessionId(project)
  if (!sessionId || sessionId === DRAFT_SESSION_ID) return
  const session = project._sessions[sessionId]
  if (!session || session.sessionProvider === 'codex') return
  await window.app.resumeSession(projectPath, sessionId, _getSessionCwd(projectPath, session))
}

// --- Helpers ---

type CodexCommand =
  | { kind: 'help' }
  | { kind: 'reset' }
  | { kind: 'auth-status' }
  | { kind: 'auth-set'; mode: CodexAuthMode; apiKey?: string }
  | { kind: 'run'; prompt: string }
  | { kind: 'review'; target: CodexReviewTarget }
  | { kind: 'compact' }

function parseCodexCommand(input: string): CodexCommand | null {
  if (!input.startsWith('/')) return null

  const body = input.slice(1).trim()
  if (!body) return null

  if (body === 'help') return { kind: 'help' }
  if (body === 'reset') return { kind: 'reset' }
  if (body === 'compact') return { kind: 'compact' }

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
    '',
    'Notes:',
    '- Type a message directly to send it as a prompt',
    '- During a running turn, new messages are sent as steered input (no need to wait)',
  ].join('\n')
}

function formatCodexAuthStatus(status: CodexAuthStatus): string {
  return [
    'Codex authentication status:',
    `- configured mode: ${status.mode}`,
    `- resolved mode: ${status.resolvedMode}`,
    `- env CODEX_API_KEY: ${status.hasEnvApiKey ? 'set' : 'not set'}`,
    `- session API key: ${status.hasSessionApiKey ? 'set' : 'not set'}`,
    `- runtime state: ${status.isRunning ? 'running' : 'idle'}`,
  ].join('\n')
}

function getLatestCodexThreadId(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.providerId !== 'codex' || msg.role !== 'assistant') continue
    const tid = msg.metadata?.codex?.threadId
    if (tid) return tid
  }
  return undefined
}

function resolveCodexReasoningEffort(
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

function resolveCodexModelSelection(
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

// --- Store implementation ---

export const useChatStore = create<ChatStore>((set, get) => ({
  projectSessions: {},
  activeProject: null,
  _bashOutputs: {},
  isOpen: false,
  corner: 'br',
  availableModels: [],
  cachedCodexModels: [],
  account: {},
  globalSlashCommands: [],
  userSkills: [],
  userCommands: [],
  userAgents: [],

  setGlobalResources: (models, account, slashCommands, userSkills, userCommands, userAgents, codexModels) => {
    set((s) => {
      const effectiveCodexModels = codexModels ?? s.cachedCodexModels
      const updates: Partial<ChatStore> = {
        availableModels: models,
        cachedCodexModels: effectiveCodexModels,
        account,
        globalSlashCommands: slashCommands,
        userSkills,
        userCommands,
        userAgents,
      }

      const projects = { ...s.projectSessions }
      let changed = false
      for (const [path, project] of Object.entries(projects)) {
        let projectChanged = false
        const patched = { ...project }

        if (patched._activeSessionId) {
          patched.slashCommands = buildSlashCommands(slashCommands, userSkills, userCommands, patched._projectSkills, patched._projectCommands)
          projectChanged = true
        }

        if (effectiveCodexModels.length > 0 && patched.codexModels.length === 0) {
          patched.codexModels = effectiveCodexModels
          projectChanged = true
        }

        const activeSid = patched._activeSessionId
        if (activeSid && patched._sessions[activeSid]) {
          const sess = patched._sessions[activeSid]
          if (!sess.selectedModel && models.length > 0) {
            const updated = { ...sess }
            applyDefaultModel(updated, models)
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

  handleAgentEvent: (event: AgentEvent) => {
    const projectPath = event.projectPath
    const eventSessionId = event.sessionId
    if (!projectPath) return

    set((s) => {
      let project = s.projectSessions[projectPath] ?? createDefaultProjectState()

      // Resolve target session: match by eventSessionId, or fall back to live DRAFT, then active
      let targetSid: string | null = (eventSessionId && project._sessions[eventSessionId])
        ? eventSessionId
        : (eventSessionId && _isLiveSession(project._sessions[DRAFT_SESSION_ID]))
          ? DRAFT_SESSION_ID
          : project._activeSessionId

      if (!targetSid || !project._sessions[targetSid]) {
        if (event.type === 'init_ready' || event.type === 'session_init' || event.type === 'status_change') {
          const draftSid = DRAFT_SESSION_ID
          if (!project._sessions[draftSid]) {
            project = {
              ...project,
              _activeSessionId: draftSid,
              _sessions: { ...project._sessions, [draftSid]: createDefaultPerSessionState() },
            }
          }
          targetSid = project._activeSessionId ?? draftSid
        } else {
          return {}
        }
      }

      const targetSession = project._sessions[targetSid]
      const delta = applyEventToSession(targetSession, event)
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
          deltaKeys: Object.keys(delta),
          ...('status' in delta ? { status: delta.status } : {}),
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
      }
      const updatedSession = { ...targetSession, ...delta }

      let updatedSessions = { ...project._sessions, [targetSid]: updatedSession }
      let updatedProject = { ...project, _sessions: updatedSessions }

      // Handle session_init: re-key from DRAFT to real session ID
      if (event.type === 'session_init' && event.session?.sessionId) {
        const realSid = event.session.sessionId
        if (targetSid === DRAFT_SESSION_ID && realSid !== DRAFT_SESSION_ID) {
          const { [DRAFT_SESSION_ID]: _, ...rest } = updatedSessions
          updatedSessions = { ...rest, [realSid]: updatedSession }
          if (updatedProject._activeSessionId === DRAFT_SESSION_ID) {
            updatedProject._activeSessionId = realSid
          }
          updatedProject._sessions = updatedSessions

          const title = _extractTitle(updatedSession.messages) || ''
          updatedProject.sessions = [
            {
              sessionId: realSid,
              title,
              lastActiveAt: new Date().toISOString(),
              provider: updatedSession.sessionProvider ?? undefined,
              messageCount: updatedSession.messages.length,
              isWorktree: !!updatedSession._worktreeBaseBranch,
              gitBranch: updatedSession._worktreeBaseBranch ?? undefined,
            },
            ...updatedProject.sessions.filter((e) => e.sessionId !== realSid),
          ]

          _savePerSessionSnapshot(projectPath, realSid, updatedSession)
        }
      }

      // Handle init_ready: update project-level fields
      if (event.type === 'init_ready') {
        updatedSession.cwd = event.cwd
        updatedProject.homedir = event.homedir
        updatedProject.sandboxInfo = event.sandboxInfo
        updatedProject._projectSkills = event.skills
        updatedProject._projectCommands = event.projectCommands
        updatedProject.slashCommands = buildSlashCommands(
          s.globalSlashCommands, s.userSkills, s.userCommands,
          event.skills, event.projectCommands,
        )
        updatedProject.agents = [...s.userAgents, ...event.projectAgents]

        const globalModels = s.availableModels
        if (!updatedSession.selectedModel && globalModels[0]) {
          updatedSession.selectedModel = globalModels[0].id
          if (globalModels[0].supportedEffortLevels?.length) {
            updatedSession.selectedEffort = 'medium'
          }
          // Write updated session back
          updatedProject._sessions = { ...updatedProject._sessions, [targetSid]: updatedSession }
        }

        window.agent.readProjectAdditionalDirs(projectPath)
          .then((dirs) => {
            set((st) => updateProjectState(st, projectPath, () => ({ projectAdditionalDirs: dirs })))
          })
          .catch(() => {})
      }

      // Incremental save on tool_result / final save on complete/interrupted/error
      const effectiveSid = targetSid === DRAFT_SESSION_ID ? null : targetSid
      if (effectiveSid) {
        if (
          (event.type === 'session_init' && event.session) ||
          (event.type === 'content_delta' && event.delta.type === 'tool_result') ||
          event.type === 'message_complete' || event.type === 'message_interrupted' || event.type === 'message_error'
        ) {
          const snapshot = updatedSession
          setTimeout(() => _savePerSessionSnapshot(projectPath, effectiveSid, snapshot), 0)
        }
      }

      // Active foreground session went idle with prefire → auto-send
      const isBackground = projectPath !== s.activeProject
      if (event.type === 'status_change' && event.status === 'idle'
        && targetSid === updatedProject._activeSessionId && !isBackground) {
        const prefire = updatedSession.prefireMessage
        if (prefire) {
          updatedProject._sessions = {
            ...updatedProject._sessions,
            [targetSid]: { ...updatedSession, prefireMessage: null },
          }
          setTimeout(() => {
            set((st) => updateActivePerSession(st, () => ({
              attachments: prefire.attachments,
              mentions: prefire.mentions,
            })))
            get().sendMessage(prefire.content)
          }, 0)
        }
      }

      // Non-active session went idle → save, mark unseen, and evict from _sessions after save completes
      if (event.type === 'status_change' && event.status === 'idle' && targetSid !== updatedProject._activeSessionId) {
        if (!_isLiveSession(updatedSession)) {
          if (effectiveSid) {
            updatedProject.unseenCompletedSessions = new Set([...updatedProject.unseenCompletedSessions, effectiveSid])
            const snapshot = updatedSession
            const evictSid = targetSid
            const evictProjectPath = projectPath
            setTimeout(() => {
              _savePerSessionSnapshot(evictProjectPath, effectiveSid, snapshot).then(() => {
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
        }
      }

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
  },

  switchProject: async (projectPath: string) => {
    const currentProject = get().activeProject
    if (currentProject && currentProject !== projectPath) {
      const project = get().projectSessions[currentProject]
      if (project) {
        const activeSession = project._activeSessionId ? project._sessions[project._activeSessionId] : null
        if (activeSession?.status === 'streaming') {
          await window.agent.parkSession(currentProject)
        } else {
          _saveSessionState(get, currentProject)
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
    if (targetSid && targetSid !== DRAFT_SESSION_ID) {
      const targetSession = targetProject?._sessions[targetSid]
      if (targetSession?.sessionProvider !== 'codex') {
        try {
          await window.app.resumeSession(projectPath, targetSid, _getSessionCwd(projectPath, targetSession))
        } catch (err) { console.warn('[chat] resumeSession failed:', err) }
      }
    }
  },

  ensureSession: (projectPath: string) => {
    set((s) => {
      if (s.projectSessions[projectPath]) return {}
      const project = createDefaultProjectState()
      project.agents = s.userAgents
      project.codexModels = s.cachedCodexModels
      project._activeSessionId = DRAFT_SESSION_ID
      const newSession = createDefaultPerSessionState()
      newSession.cwd = projectPath
      applyDefaultModel(newSession, s.availableModels)
      const rememberedCodexSelection = readLastCodexSelection()
      const codexSelection = resolveCodexModelSelection(
        project.codexModels,
        rememberedCodexSelection.modelId || newSession.selectedCodexModel,
        rememberedCodexSelection.reasoningEffort ?? newSession.selectedCodexReasoningEffort,
      )
      newSession.selectedCodexModel = codexSelection.modelId
      newSession.selectedCodexReasoningEffort = codexSelection.reasoningEffort
      project._sessions = { [DRAFT_SESSION_ID]: newSession }
      return {
        projectSessions: {
          ...s.projectSessions,
          [projectPath]: project,
        },
      }
    })
  },

  sendMessage: async (content: string) => {
    const { activeProject } = get()
    if (!activeProject) return

    const { useAppStore } = await import('./app')
    const wtState = useAppStore.getState().getWorktreeState(activeProject)
    if (wtState.pendingBaseBranch) {
      const baseBranch = wtState.pendingBaseBranch
      const result = await window.app.activateWorktree(activeProject, baseBranch, wtState.carryLocalChanges)
      if (!result.ok) {
        console.error('[sendMessage] Failed to activate worktree:', result.error)
        return
      }
      useAppStore.getState().setActiveWorktree(activeProject, result.path)
      set((s) => updateActivePerSession(s, () => ({
        cwd: result.path,
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
        session: null,
        sessionProvider: null,
        _worktreeBaseBranch: baseBranch,
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

    const finalContent = content.trim()
    const codexCommand = parseCodexCommand(finalContent)
    const requestedProvider: ChatProvider = preferredProvider === 'codex' ? 'codex' : 'claude'
    const effectiveProvider: ChatProvider = session.sessionProvider ?? requestedProvider
    const resolvedCodexCommand: CodexCommand | null = effectiveProvider === 'codex'
      ? (codexCommand ?? { kind: 'run', prompt: finalContent })
      : null
    const resolvedCodexSelection = resolveCodexModelSelection(
      project.codexModels,
      selectedCodexModel,
      selectedCodexReasoningEffort,
    )
    const resolvedCodexModel = resolvedCodexSelection.modelId || undefined
    const resolvedCodexReasoningEffort = resolvedCodexSelection.reasoningEffort

    if (!session.sessionProvider) {
      set((s) => updateActivePerSession(s, () => ({
        sessionProvider: effectiveProvider,
        preferredProvider: effectiveProvider,
      })))
    }

    if (effectiveProvider === 'codex' && !_getEffectiveSessionId(project)) {
      const localSid = _createLocalCodexSessionId()
      set((s) => {
        const proj = getProject(s, activeProject)
        const currentSid = proj._activeSessionId
        if (!currentSid) return {}
        const sess = proj._sessions[currentSid]
        if (!sess) return {}
        const { [currentSid]: _, ...rest } = proj._sessions
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: {
              ...proj,
              _activeSessionId: localSid,
              _sessions: { ...rest, [localSid]: sess },
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
      if (utilityKind === 'help' || utilityKind === 'reset' || utilityKind === 'auth-status' || utilityKind === 'auth-set') {
        set((s) => updateActivePerSession(s, () => ({ _pendingSlashCommand: '' })))
        let popupContent: string
        try {
          if (utilityKind === 'help') {
            popupContent = getCodexHelpText()
          } else if (utilityKind === 'reset') {
            if (codexSessionId) await window.app.codexReset(codexSessionId)
            popupContent = 'Codex thread has been reset.'
          } else if (utilityKind === 'auth-status') {
            const status = await window.app.codexGetAuthStatus(activeProject)
            popupContent = formatCodexAuthStatus(status)
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
      ...(finalContent ? [{ type: 'text' as const, text: finalContent }] : []),
    ]

    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      status: 'complete',
      content: userContent,
      attachments: attachments.length > 0 ? attachments : undefined,
      createdAt: new Date().toISOString(),
      providerId: 'local',
    }
    set((s) => ({
      ...updateActivePerSession(s, (sess) => ({
        messages: [...sess.messages, userMessage],
        attachments: [],
        mentions: [],
        ...(effectiveProvider === 'claude' ? { awaitingAssistantReply: true } : {}),
      })),
      isOpen: true,
    }))

    if (resolvedCodexCommand) {
      set((s) => updateActivePerSession(s,() => ({ _pendingSlashCommand: '' })))

      const codexProjectPath = activeProject
      const codexSid = codexSessionId!
      const assistantId = `codex_${Date.now()}`
      const previousCodexTurnLastUsage = session.codexTurnLastUsage
      const updateCodexSession = (updater: (s: PerSessionState) => Partial<PerSessionState>) => {
        set((s) => updatePerSession(s, codexProjectPath, codexSid, updater))
      }
      const getCodexSession = () => getProject(get(), codexProjectPath)._sessions[codexSid]
      const appendAssistant = (message: ChatMessage) => {
        updateCodexSession((sess) => ({
          messages: [...sess.messages, message],
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

      // Steer: if streaming and command is 'run', send as steer input instead of starting a new run
      if (session.status === 'streaming' && resolvedCodexCommand.kind === 'run') {
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
          await window.app.codexSteer(codexSessionId!, resolvedCodexCommand.prompt, steerAssistantId)
        } catch (error) {
          updateCodexSession((sess) => ({
            status: 'streaming',
            activeCodexMessageId: previousActiveCodexMessageId ?? null,
            codexTurnLastUsage: previousCodexTurnLastUsage,
            messages: sess.messages.filter((m) => m.id !== steerAssistantId),
          }))
          console.warn('[sendMessage] Codex steer failed:', error)
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
        let result: Awaited<ReturnType<typeof window.app.codexRun>>
        const codexCwd = _getSessionCwd(activeProject, session)

        if (resolvedCodexCommand.kind === 'review') {
          result = await window.app.codexReview(
            codexSessionId!,
            activeProject,
            resolvedCodexCommand.target,
            resolvedCodexModel,
            resolvedCodexReasoningEffort,
            selectedCodexPermissionPreset,
            codexThreadId,
            assistantId,
            codexCwd,
          )
        } else if (resolvedCodexCommand.kind === 'compact') {
          result = await window.app.codexCompact(
            codexSessionId!,
            activeProject,
            resolvedCodexModel,
            selectedCodexPermissionPreset,
            codexThreadId,
            assistantId,
            codexCwd,
          )
        } else {
          result = await window.app.codexRun(
            codexSessionId!,
            activeProject,
            resolvedCodexCommand.prompt,
            resolvedCodexModel,
            resolvedCodexReasoningEffort,
            selectedCodexPermissionPreset,
            selectedCodexCollaborationMode,
            codexThreadId,
            assistantId,
            attachments.length > 0 ? attachments : undefined,
            codexCwd,
          )
        }

        const text = result.finalResponse?.trim() || (
          resolvedCodexCommand.kind === 'compact'
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
        const currentProject = getProject(get(), codexProjectPath)
        if (currentProject._activeSessionId !== codexSid) {
          set((s) => {
            const proj = s.projectSessions[codexProjectPath]
            if (!proj) return {}
            return {
              projectSessions: {
                ...s.projectSessions,
                [codexProjectPath]: {
                  ...proj,
                  unseenCompletedSessions: new Set([...proj.unseenCompletedSessions, codexSid]),
                },
              },
            }
          })
        }
        void _savePerSessionSnapshot(codexProjectPath, codexSid, finalCodexSession)
      }
      return
    }

    _saveSessionState(get, activeProject)
    await _ensureClaudeSessionReadyForSend(get, activeProject)

    // Merge project + session additional directories (deduplicated)
    const mergedDirs = [...new Set([...project.projectAdditionalDirs, ...session.additionalDirs])]

    try {
      await window.agent.sendMessage(activeProject, {
        content: finalContent,
        model: selectedModel || undefined,
        effort: selectedEffort,
        images: attachments.length > 0 ? attachments : undefined,
        additionalDirs: mergedDirs.length > 0 ? mergedDirs : undefined,
      })
    } catch (err) {
      set((s) => updateActivePerSession(s, () => ({ awaitingAssistantReply: false })))
      throw err
    }
  },

  interrupt: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    const codexSid = _getEffectiveSessionId(getProject(get(), activeProject))
    set((s) => updateActivePerSession(s, () => ({ prefireMessage: null, awaitingAssistantReply: false })))
    const [claudeResult] = await Promise.allSettled([
      window.agent.interrupt(activeProject),
      codexSid ? window.app.codexInterrupt(codexSid) : Promise.resolve(false),
    ])
    const claudeFailed = claudeResult.status === 'rejected' || claudeResult.value === false
    if (claudeFailed) {
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
      prefireMessage: null,
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

  resetSessionForWorktreeSwitch: (projectPath: string) => {
    set((s) => {
      const proj = getProject(s, projectPath)
      const newSession = createDefaultPerSessionState()
      newSession.cwd = projectPath
      applyDefaultModel(newSession, s.availableModels)
      const rememberedCodexSelection = readLastCodexSelection()
      const codexSelection = resolveCodexModelSelection(
        proj.codexModels,
        rememberedCodexSelection.modelId || newSession.selectedCodexModel,
        rememberedCodexSelection.reasoningEffort ?? newSession.selectedCodexReasoningEffort,
      )
      newSession.selectedCodexModel = codexSelection.modelId
      newSession.selectedCodexReasoningEffort = codexSelection.reasoningEffort
      return {
        projectSessions: {
          ...s.projectSessions,
          [projectPath]: {
            ...proj,
            _activeSessionId: DRAFT_SESSION_ID,
            _sessions: { ...proj._sessions, [DRAFT_SESSION_ID]: newSession },
          },
        },
      }
    })
  },

  resetSession: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    const project = getProject(get())
    const activeSession = getActivePerSession(get())
    const currentSid = resolveActiveSessionId(project)

    if (activeSession.sessionProvider === 'codex') {
      if (activeSession.status !== 'streaming' && currentSid) {
        await window.app.codexReset(currentSid).catch(() => {})
      }
    } else if (activeSession.status === 'streaming' && currentSid) {
      await window.agent.parkSession(activeProject)
    } else {
      await window.agent.resetSession(activeProject)
    }

    await useAppStore.getState().clearWorktree(activeProject)

    set((s) => {
      const proj = getProject(s, activeProject)
      const newSession = createDefaultPerSessionState()
      newSession.cwd = activeProject
      applyDefaultModel(newSession, s.availableModels)
      const rememberedCodexSelection = readLastCodexSelection()
      const codexSelection = resolveCodexModelSelection(
        proj.codexModels,
        rememberedCodexSelection.modelId || newSession.selectedCodexModel,
        rememberedCodexSelection.reasoningEffort ?? newSession.selectedCodexReasoningEffort,
      )
      newSession.selectedCodexModel = codexSelection.modelId
      newSession.selectedCodexReasoningEffort = codexSelection.reasoningEffort
      return {
        projectSessions: {
          ...s.projectSessions,
          [activeProject]: {
            ...proj,
            _activeSessionId: DRAFT_SESSION_ID,
            _sessions: {
              ...proj._sessions,
              [DRAFT_SESSION_ID]: newSession,
            },
          },
        },
      }
    })
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
    const sess = getActivePerSession(get())
    const msg = sess.messages.find((m) => m.checkpointId === userMessageId)
    const resumePointId = msg?.resumePointId ?? ''
    const result = await window.agent.rewindCodeAndChat(activeProject, userMessageId, resumePointId)
    if (result.canRewind !== false) {
      set((s) => {
        const proj = getProject(s, activeProject)
        const activeSid = proj._activeSessionId
        if (!activeSid) return {}
        const currentSess = proj._sessions[activeSid]
        if (!currentSess) return {}
        const idx = currentSess.messages.findIndex((m) => m.checkpointId === userMessageId)
        const truncated = idx >= 0 ? currentSess.messages.slice(0, idx) : currentSess.messages
        const forkedMessages = result.forkedSessionId
          ? remapMessagesForFork(truncated, result.forkedSessionId)
          : truncated
        const newSid = result.forkedSessionId ?? activeSid
        const updatedSess = { ...currentSess, messages: forkedMessages, session: null, totalCostUsd: 0, contextTokens: 0 }
        const { [activeSid]: _, ...rest } = proj._sessions
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: {
              ...proj,
              _activeSessionId: newSid,
              _sessions: { ...rest, [newSid]: updatedSess },
            },
          },
        }
      })
      if (result.forkedSessionId) {
        _saveSessionState(get, activeProject)
      }
    }
    return result
  },

  rewindConversation: async (userMessageId: string) => {
    const { activeProject } = get()
    if (!activeProject) throw new Error('No active project')
    const sess = getActivePerSession(get())
    const msg = sess.messages.find((m) => m.checkpointId === userMessageId)
    const resumePointId = msg?.resumePointId ?? ''
    const result = await window.agent.rewindConversation(activeProject, userMessageId, resumePointId)
    if (result.canRewind !== false) {
      set((s) => {
        const proj = getProject(s, activeProject)
        const activeSid = proj._activeSessionId
        if (!activeSid) return {}
        const currentSess = proj._sessions[activeSid]
        if (!currentSess) return {}
        const idx = currentSess.messages.findIndex((m) => m.checkpointId === userMessageId)
        const truncated = idx >= 0 ? currentSess.messages.slice(0, idx) : currentSess.messages
        const forkedMessages = result.forkedSessionId
          ? remapMessagesForFork(truncated, result.forkedSessionId)
          : truncated
        const newSid = result.forkedSessionId ?? activeSid
        const updatedSess = { ...currentSess, messages: forkedMessages, session: null, totalCostUsd: 0, contextTokens: 0 }
        const { [activeSid]: _, ...rest } = proj._sessions
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: {
              ...proj,
              _activeSessionId: newSid,
              _sessions: { ...rest, [newSid]: updatedSess },
            },
          },
        }
      })
      if (result.forkedSessionId) {
        _saveSessionState(get, activeProject)
      }
    }
    return result
  },

  previewRewind: async (checkpointId: string) => {
    const { activeProject } = get()
    if (!activeProject) throw new Error('No active project')
    return window.agent.previewRewind(activeProject, checkpointId)
  },

  setPrefireMessage: (content) => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getActivePerSession(get())
    set((s) => updateActivePerSession(s, () => ({
      prefireMessage: { content, attachments: session.attachments, mentions: session.mentions },
      attachments: [],
      mentions: [],
      draftText: '',
    })))
  },

  cancelPrefireMessage: () => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getActivePerSession(get())
    if (!session.prefireMessage) return
    set((s) => updateActivePerSession(s, () => ({
      draftText: session.prefireMessage!.content,
      attachments: session.prefireMessage!.attachments,
      mentions: session.prefireMessage!.mentions,
      prefireMessage: null,
    })))
  },

  discardPrefireMessage: () => {
    set((s) => updateActivePerSession(s, () => ({ prefireMessage: null })))
  },

  setDraftText: (text) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s,() => ({ draftText: text })))
  },

  setSelectedModel: (model) => {
    const { activeProject, availableModels } = get()
    if (!activeProject) return
    const modelInfo = availableModels.find((m) => m.id === model)
    const defaultEffort = modelInfo?.supportedEffortLevels?.length ? 'medium' as EffortLevel : undefined
    set((s) => updateActivePerSession(s,() => ({ selectedModel: model, selectedEffort: defaultEffort })))
  },

  setSelectedEffort: (effort) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s,() => ({ selectedEffort: effort })))
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
    set((s) => updateActivePerSession(s, () => ({
      selectedCodexCollaborationMode: mode,
    })))
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
        const next = resolveCodexModelSelection(
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
        const selected = resolveCodexModelSelection(
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
    set((s) => updateActivePerSession(s, () => ({ preferredProvider: provider, slashCommandOutput: null })))
    if (provider === 'codex') {
      const project = getProject(get(), activeProject)
      const session = getActivePerSession(get())
      const selected = resolveCodexModelSelection(
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

  respondToPermission: (requestId, allow, alwaysAllow, reason, selectedSuggestions, decision) => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getActivePerSession(get(), activeProject)
    const respondedRequest = session.pendingPermissions.find((p) => p.requestId === requestId)
    if (!respondedRequest) return
    if (session.sessionProvider === 'codex') {
      const sid = _getEffectiveSessionId(getProject(get(), activeProject))
      if (sid) void window.app.codexRespondToPermission(sid, requestId, allow, alwaysAllow, reason, decision)
    } else {
      void window.agent.respondToPermission(activeProject, requestId, allow, alwaysAllow, reason, selectedSuggestions)
    }
    const updates: Partial<PerSessionState> = {
      pendingPermissions: session.pendingPermissions.filter((p) => p.requestId !== requestId),
    }
    if (allow && selectedSuggestions) {
      const mode = extractModeFromSuggestions(respondedRequest?.suggestions, selectedSuggestions)
      if (mode) updates.permissionMode = mode as PermissionMode
    }
    set((s) => {
      const perSessionUpdate = updateActivePerSession(s, () => updates)
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

  setPermissionMode: async (mode) => {
    const { activeProject } = get()
    if (!activeProject) return
    await window.agent.setPermissionMode(activeProject, mode)
    set((s) => updateActivePerSession(s, () => ({ permissionMode: mode })))
  },

  answerQuestion: (requestId, answers) => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getActivePerSession(get(), activeProject)
    if (session.sessionProvider === 'codex') {
      const sid = _getEffectiveSessionId(getProject(get(), activeProject))
      if (sid) void window.app.codexAnswerQuestion(sid, requestId, answers)
    } else {
      void window.agent.answerQuestion(activeProject, requestId, answers)
    }
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
    const session = getActivePerSession(get(), activeProject)
    if (session.sessionProvider === 'codex') {
      const sid = _getEffectiveSessionId(getProject(get(), activeProject))
      if (sid) void window.app.codexDismissQuestion(sid, requestId)
    } else {
      void window.agent.dismissQuestion(activeProject, requestId)
    }
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

  respondToPlanApproval: (requestId, approved, feedback) => {
    const { activeProject } = get()
    if (!activeProject) return
    window.agent.respondToPlanApproval(activeProject, requestId, approved, feedback)
    set((s) => {
      const perSessionUpdate = updateActivePerSession(s, () => ({
        pendingPlanApproval: null,
        planApprovalOutcome: { approved, feedback },
        ...(approved && { permissionMode: 'default' as PermissionMode }),
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
    const modes: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']
    const session = getActivePerSession(get())
    const next = modes[(modes.indexOf(session.permissionMode) + 1) % modes.length]
    get().setPermissionMode(next)
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
      if (activeSession.status !== 'streaming') {
        _saveSessionState(get, activeProject)
      } else {
        await window.agent.parkSession(activeProject)
      }

      set((s) => {
        const proj = getProject(s, activeProject)
        const targetSession = proj._sessions[sessionId]
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: {
              ...proj,
              _activeSessionId: sessionId,
              showHistory: false,
              _sessions: {
                ...proj._sessions,
                [sessionId]: { ...targetSession, cwd: _getSessionCwd(activeProject, targetSession) },
              },
            },
          },
        }
      })

      const targetSession = project._sessions[sessionId]
      if (sessionId === DRAFT_SESSION_ID) return
      let runtimeSession = targetSession

      window.app.trace?.('agent.store', 'switchSession:A', {
        sessionId,
        _worktreePath: targetSession._worktreePath,
        _worktreeBaseBranch: targetSession._worktreeBaseBranch,
        _worktreeRemoved: targetSession._worktreeRemoved,
      })
      if (targetSession._worktreePath) {
        const exists = await window.app.pathExists(targetSession._worktreePath)
        window.app.trace?.('agent.store', 'switchSession:A:pathExists', { path: targetSession._worktreePath, exists })
        if (exists) {
          useAppStore.getState().setActiveWorktree(activeProject, targetSession._worktreePath)
        } else {
          window.app.trace?.('agent.store', 'switchSession:A:worktreeRemoved', { sessionId })
          set((s) => updatePerSession(s, activeProject, sessionId, () => ({ _worktreeRemoved: true, cwd: activeProject })))
          useAppStore.getState().setActiveWorktree(activeProject, null)
          runtimeSession = { ...targetSession, _worktreeRemoved: true }
        }
      } else if (!targetSession._worktreeBaseBranch) {
        useAppStore.getState().setActiveWorktree(activeProject, null)
      }

      if (!targetSession.selectedModel) {
        const defaultModel = get().availableModels[0]
        if (defaultModel) {
          set((s) => updatePerSession(s, activeProject, sessionId, () => ({
            selectedModel: defaultModel.id,
            ...(defaultModel.supportedEffortLevels?.length ? { selectedEffort: 'medium' as EffortLevel } : {}),
          })))
        }
      }

      if (targetSession.sessionProvider !== 'codex') {
        try {
          await window.app.resumeSession(activeProject, sessionId, _getSessionCwd(activeProject, runtimeSession))
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
    if (freshActiveSession.status === 'streaming') {
      await window.agent.parkSession(activeProject)
    } else {
      _saveSessionState(get, activeProject)
    }

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
    }
    if (restoredProvider !== 'codex') {
      applyDefaultModel(restoredSession, get().availableModels)
    } else {
      const rememberedCodexSelection = readLastCodexSelection()
      const codexSelection = resolveCodexModelSelection(
        freshProject.codexModels,
        rememberedCodexSelection.modelId || restoredSession.selectedCodexModel,
        rememberedCodexSelection.reasoningEffort ?? restoredSession.selectedCodexReasoningEffort,
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
      const exists = await window.app.pathExists(savedWorktreePath)
      window.app.trace?.('agent.store', 'switchSession:B:pathExists', { path: savedWorktreePath, exists })
      if (exists) {
        useAppStore.getState().setActiveWorktree(activeProject, savedWorktreePath)
      } else {
        window.app.trace?.('agent.store', 'switchSession:B:worktreeRemoved', { sessionId })
        set((s) => updatePerSession(s, activeProject, sessionId, () => ({ _worktreeRemoved: true, cwd: activeProject })))
        useAppStore.getState().setActiveWorktree(activeProject, null)
      }
    } else {
      useAppStore.getState().setActiveWorktree(activeProject, null)
    }

    if (restoredSession.sessionProvider !== 'codex') {
      try {
        await window.app.resumeSession(activeProject, sessionId, _getSessionCwd(activeProject, getProject(get())._sessions[sessionId]))
      } catch (err) {
        console.warn('[chat] resumeSession failed:', err)
      }
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

export function useActiveSession<T>(selector: (s: ActiveSessionView) => T): T {
  return useChatStore((store) => {
    const project = store.activeProject
      ? store.projectSessions[store.activeProject]
      : null
    const p = project ?? DEFAULT_PROJECT
    const session = (p._activeSessionId ? p._sessions[p._activeSessionId] : null) ?? DEFAULT_PER_SESSION
    if (!project) return selector(DEFAULT_VIEW)
    return selector({ ...session, ...p })
  })
}

export function useBashOutput(toolUseId: string): { content: string; finished: boolean; outputPath?: string } | undefined {
  return useChatStore((s) => s._bashOutputs[toolUseId])
}

/** Apply a content delta to the content array, merging consecutive text blocks and deduplicating tool_use. */
function applyDelta(content: ContentBlock[], delta: ContentBlock): ContentBlock[] {
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
