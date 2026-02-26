import { create } from 'zustand'
import { useAppStore } from './app'
import { buildSlashCommands, extractModeFromSuggestions, findCheckpointTarget, getCommandOutputMode, remapMessagesForFork } from './chat-helpers'
import type { AccountInfo, AgentEvent, AgentInfo, AgentStatus, AskUserQuestionRequest, ChatMessage, CodexAuthMode, CodexAuthStatus, CodexPermissionPreset, CodexReasoningEffort, CodexReviewTarget, CodexThreadItem, ContentBlock, EffortLevel, ImageAttachment, ModelOption, PlanApprovalRequest, PermissionMode, PermissionRequest, RewindFilesResult, SandboxInfo, SandboxMode, SessionHistoryEntry, SessionInfo, SlashCommandInfo, StartupData, TodoItem } from '../../../shared/agent-types'

type Corner = 'br' | 'bl' | 'tr' | 'tl'
export type ChatProvider = 'claude' | 'codex'
export const DEFAULT_PROVIDER: ChatProvider = 'claude'

export type MentionKind = 'file' | 'directory' | 'agent'
export interface Mention {
  kind: MentionKind
  value: string
  displayName: string
}

// --- Per-project session state (unified per-session architecture) ---

export const DRAFT_SESSION_ID = '__draft__'

export interface PerSessionState {
  messages: ChatMessage[]
  status: AgentStatus
  session: SessionInfo | null
  sessionProvider: ChatProvider | null
  totalCostUsd: number
  contextTokens: number
  subagentTokens: Record<string, { input: number; output: number }>
  streamingTokens: { input: number; output: number }
  selectedModel: string
  selectedEffort?: EffortLevel
  selectedCodexModel: string
  selectedCodexReasoningEffort?: CodexReasoningEffort
  selectedCodexPermissionPreset: CodexPermissionPreset
  preferredProvider: ChatProvider
  draftText: string
  promptSuggestion: string | null
  attachments: ImageAttachment[]
  mentions: Mention[]
  pendingPermission: PermissionRequest | null
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
  _worktreeBranch: string | null
  additionalDirs: string[]
  lastEventAt: number
}

export interface ProjectState {
  _activeSessionId: string | null
  _sessions: Record<string, PerSessionState>
  slashCommands: SlashCommandInfo[]
  _projectSkills: SlashCommandInfo[]
  _projectCommands: SlashCommandInfo[]
  agents: AgentInfo[]
  cwd: string
  homedir: string
  sandboxInfo: SandboxInfo
  sessions: SessionHistoryEntry[]
  showHistory: boolean
  hasUnseenActivity: boolean
  hasPendingInteraction: boolean
  unseenCompletedSessions: Set<string>
  codexModels: ModelOption[]
  codexModelsLoading: boolean
  projectAdditionalDirs: string[]
  showDirManager: boolean
}

export type ActiveSessionView = PerSessionState & ProjectState

export function createDefaultPerSessionState(): PerSessionState {
  return {
    messages: [],
    status: 'idle',
    session: null,
    sessionProvider: null,
    totalCostUsd: 0,
    contextTokens: 0,
    subagentTokens: {},
    streamingTokens: { input: 0, output: 0 },
    selectedModel: '',
    selectedEffort: undefined,
    selectedCodexModel: '',
    selectedCodexReasoningEffort: undefined,
    selectedCodexPermissionPreset: 'default',
    preferredProvider: 'claude',
    draftText: '',
    promptSuggestion: null,
    attachments: [],
    mentions: [],
    pendingPermission: null,
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
    _worktreeBranch: null,
    additionalDirs: [],
    lastEventAt: 0,
  }
}

function applyDefaultModel(session: PerSessionState, models: ModelOption[]): void {
  const defaultModel = models[0]
  if (defaultModel) {
    session.selectedModel = defaultModel.id
    if (defaultModel.supportedEffortLevels?.length) {
      session.selectedEffort = 'high'
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
    cwd: '',
    homedir: '',
    sandboxInfo: { enabled: true, autoAllowBash: false },
    sessions: [],
    showHistory: false,
    hasUnseenActivity: false,
    hasPendingInteraction: false,
    unseenCompletedSessions: new Set(),
    codexModels: [],
    codexModelsLoading: false,
    projectAdditionalDirs: [],
    showDirManager: false,
  }
}

// --- Store interface ---

interface ChatStore {
  projectSessions: Record<string, ProjectState>
  activeProject: string | null

  // Global UI state (not per-session)
  isOpen: boolean
  corner: Corner
  availableModels: ModelOption[]
  account: AccountInfo
  globalSlashCommands: SlashCommandInfo[]
  userSkills: SlashCommandInfo[]
  userCommands: SlashCommandInfo[]
  userAgents: AgentInfo[]

  // Global resource setter
  setGlobalResources: (models: ModelOption[], account: AccountInfo, slashCommands: SlashCommandInfo[], userSkills: SlashCommandInfo[], userCommands: SlashCommandInfo[], userAgents: AgentInfo[]) => void

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
  rewindFiles: (userMessageId: string) => Promise<RewindFilesResult>
  rewindCodeAndChat: (userMessageId: string) => Promise<RewindFilesResult>
  rewindConversation: (userMessageId: string) => Promise<RewindFilesResult>
  previewRewind: (checkpointId: string) => Promise<RewindFilesResult>

  // Draft text
  setDraftText: (text: string) => void

  // Model actions
  setSelectedModel: (model: string) => void
  setSelectedEffort: (effort?: EffortLevel) => void
  setSelectedCodexModel: (model: string) => void
  setSelectedCodexReasoningEffort: (effort?: CodexReasoningEffort) => void
  setSelectedCodexPermissionPreset: (preset: CodexPermissionPreset) => void
  refreshCodexModels: (force?: boolean) => Promise<void>
  setPreferredProvider: (provider: ChatProvider) => void

  // Attachment actions
  addAttachment: (attachment: ImageAttachment) => void
  removeAttachment: (index: number) => void
  clearAttachments: () => void

  // Permission actions
  respondToPermission: (requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[]) => void
  setPermissionMode: (mode: PermissionMode) => Promise<void>
  cyclePermissionMode: () => void
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
  toggleHistory: () => void
  resumeSession: (sessionId: string) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>

  // Additional directories
  addDir: (path: string, scope: 'session' | 'project') => void
  removeDir: (path: string, scope: 'session' | 'project') => void
  setShowDirManager: (show: boolean) => void
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

// --- Apply agent event to a session (pure function) ---

function applyEventToSession(session: PerSessionState, event: AgentEvent): Partial<PerSessionState> {
  switch (event.type) {
    case 'message_start':
      return { messages: [...session.messages, event.message], promptSuggestion: null, lastEventAt: Date.now() }

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
      const ft = session.streamingTokens
      const consumedTokens = (ft.input > 0 || ft.output > 0) ? { input: ft.input, output: ft.output } : undefined
      return {
        messages: session.messages.map((msg) => {
          if (msg.id !== event.messageId) return msg
          return {
            ...msg,
            status: 'complete' as const,
            metadata: { ...msg.metadata, ...event.metadata, consumedTokens },
          }
        }),
        totalCostUsd: newCost,
        contextTokens: (() => {
          const u = event.metadata?.usage
          if (!u) return session.contextTokens
          const total = u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens
          return total > 0 ? total : session.contextTokens
        })(),
        streamingTokens: { input: 0, output: 0 },
        lastEventAt: 0,
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
        pendingPermission: null,
        pendingQuestion: null,
        pendingPlanApproval: null,
        lastEventAt: 0,
      }

    case 'message_error':
      return {
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
      return { pendingPermission: event.request }

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

    case 'compact_boundary':
      return {
        isCompacting: false,
        messages: [
          ...session.messages,
          {
            id: `compact_${Date.now()}`,
            role: 'assistant' as const,
            status: 'complete' as const,
            content: [{ type: 'text' as const, text: `__compact__:${event.trigger}:${event.preTokens}` }],
            createdAt: new Date().toISOString(),
            providerId: 'system',
          },
        ],
      }

    case 'subagent_usage':
      return {
        subagentTokens: {
          ...session.subagentTokens,
          [event.parentToolUseId]: { input: event.inputTokens, output: event.outputTokens },
        },
      }

    case 'message_usage':
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
      const filtered = session.messages.filter((m) => m.id !== event.messageId)
      const lastUserIdx = filtered.findLastIndex((m) => m.role === 'user')
      if (lastUserIdx >= 0) filtered.splice(lastUserIdx, 1)
      return {
        slashCommandOutput: { command: session._pendingSlashCommand, content: event.content, mode: getCommandOutputMode(session._pendingSlashCommand) },
        _pendingSlashCommand: '',
        messages: filtered,
      }
    }

    case 'status_indicator':
      return { isCompacting: event.indicator === 'compacting' }

    case 'checkpoint_captured': {
      const msgs = [...session.messages]
      const targetIdx = findCheckpointTarget(msgs, event.messageId)
      if (targetIdx === -1) return {}
      if (msgs[targetIdx].checkpointId) return {}
      msgs[targetIdx] = { ...msgs[targetIdx], checkpointId: event.checkpointId, resumePointId: event.resumePointId }
      return { messages: msgs }
    }

    case 'hook_started':
    case 'hook_complete':
    case 'task_started':
    case 'task_notification':
    case 'auth_status':
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

function _getWorktreeBranch(projectPath: string, session: PerSessionState): string | undefined {
  if (session._worktreeBranch) return session._worktreeBranch
  const wt = useAppStore.getState().getWorktreeState(projectPath)
  if (wt.pendingBaseBranch) return wt.pendingBaseBranch
  return undefined
}

function _getWorktreePath(projectPath: string): string | undefined {
  return useAppStore.getState().getWorktreeState(projectPath).activePath ?? undefined
}

function _saveSessionState(get: () => ChatStore, projectPath: string): void {
  const project = get().projectSessions[projectPath]
  if (!project) return
  const sessionId = _getEffectiveSessionId(project)
  if (!sessionId) return
  const session = project._sessions[sessionId]
  if (!session || session.messages.length === 0) return

  const branch = _getWorktreeBranch(projectPath, session)
  const wtPath = _getWorktreePath(projectPath)
  window.app.createSession(projectPath, sessionId, !!branch || undefined, branch, wtPath)
    .catch(() => {})
    .then(() => window.app.saveSessionState(sessionId, {
      messages: session.messages,
      totalCostUsd: session.totalCostUsd,
      contextTokens: session.contextTokens,
      title: _extractTitle(session.messages),
      provider: session.sessionProvider ?? undefined,
    }))
    .catch(() => {})
}

function _savePerSessionSnapshot(projectPath: string, sessionId: string, session: PerSessionState): void {
  if (!sessionId || sessionId === DRAFT_SESSION_ID || session.messages.length === 0) return

  const branch = _getWorktreeBranch(projectPath, session)
  const wtPath = _getWorktreePath(projectPath)
  window.app.createSession(projectPath, sessionId, !!branch || undefined, branch, wtPath)
    .catch(() => {})
    .then(() => window.app.saveSessionState(sessionId, {
      messages: session.messages,
      totalCostUsd: session.totalCostUsd,
      contextTokens: session.contextTokens,
      title: _extractTitle(session.messages),
      provider: session.sessionProvider ?? undefined,
    }))
    .catch(() => {})
}

function _computeHasPendingInteraction(project: ProjectState): boolean {
  return Object.values(project._sessions).some(
    (s) => !!s.pendingPermission || !!s.pendingQuestion || !!s.pendingPlanApproval,
  )
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
  return options[0].value
}

// --- Store implementation ---

export const useChatStore = create<ChatStore>((set, get) => ({
  projectSessions: {},
  activeProject: null,
  isOpen: false,
  corner: 'br',
  availableModels: [],
  account: {},
  globalSlashCommands: [],
  userSkills: [],
  userCommands: [],
  userAgents: [],

  setGlobalResources: (models, account, slashCommands, userSkills, userCommands, userAgents) => {
    set((s) => {
      const updates: Partial<ChatStore> = {
        availableModels: models,
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

        const activeSid = patched._activeSessionId
        if (activeSid && patched._sessions[activeSid]) {
          const sess = patched._sessions[activeSid]
          if (!sess.selectedModel && models.length > 0) {
            patched._sessions = {
              ...patched._sessions,
              [activeSid]: { ...sess, selectedModel: models[0].id },
            }
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

      // Resolve target session: match by eventSessionId, or fall back to active
      let targetSid: string | null = (eventSessionId && project._sessions[eventSessionId])
        ? eventSessionId
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

          const snapshot = updatedSession
          setTimeout(() => _savePerSessionSnapshot(projectPath, realSid, snapshot), 0)
        }
      }

      // Handle init_ready: update project-level fields
      if (event.type === 'init_ready') {
        updatedProject.cwd = event.cwd
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
            updatedSession.selectedEffort = 'high'
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

      // Non-active session went idle → save, mark unseen, and evict from _sessions
      if (event.type === 'status_change' && event.status === 'idle' && targetSid !== updatedProject._activeSessionId) {
        if (effectiveSid) {
          updatedProject.unseenCompletedSessions = new Set([...updatedProject.unseenCompletedSessions, effectiveSid])
          const snapshot = updatedSession
          setTimeout(() => _savePerSessionSnapshot(projectPath, effectiveSid, snapshot), 0)
        }
        const { [targetSid]: _, ...restSessions } = updatedProject._sessions
        updatedProject._sessions = restSessions
      }

      // Active session went idle in a background project → mark as unseen
      const isBackground = projectPath !== s.activeProject
      if (event.type === 'status_change' && event.status === 'idle' && targetSid === updatedProject._activeSessionId && isBackground && effectiveSid) {
        updatedProject.unseenCompletedSessions = new Set([...updatedProject.unseenCompletedSessions, effectiveSid])
      }

      // Background activity indicators
      if (isBackground) {
        updatedProject.hasUnseenActivity = true
      }
      updatedProject.hasPendingInteraction = _computeHasPendingInteraction(updatedProject)

      return {
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
    set((s) => {
      const project = s.projectSessions[projectPath]
      const updates: Partial<ChatStore> = { activeProject: projectPath }
      if (project) {
        let { unseenCompletedSessions } = project
        if (project._activeSessionId && unseenCompletedSessions.has(project._activeSessionId)) {
          unseenCompletedSessions = new Set(unseenCompletedSessions)
          unseenCompletedSessions.delete(project._activeSessionId)
        }
        updates.projectSessions = {
          ...s.projectSessions,
          [projectPath]: { ...project, hasUnseenActivity: false, unseenCompletedSessions },
        }
      }
      return updates
    })
    if (targetSid && targetSid !== DRAFT_SESSION_ID) {
      const targetSession = targetProject?._sessions[targetSid]
      if (targetSession?.sessionProvider !== 'codex') {
        try {
          await window.agent.activateSession(projectPath, targetSid)
        } catch {}
      }
    }
  },

  ensureSession: (projectPath: string) => {
    set((s) => {
      if (s.projectSessions[projectPath]) return {}
      const project = createDefaultProjectState()
      project.agents = s.userAgents
      project._activeSessionId = DRAFT_SESSION_ID
      const newSession = createDefaultPerSessionState()
      applyDefaultModel(newSession, s.availableModels)
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
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
        session: null,
        sessionProvider: null,
        _worktreeBranch: baseBranch,
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
            await window.app.codexReset(activeProject)
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
      })),
      isOpen: true,
    }))

    if (resolvedCodexCommand) {
      set((s) => updateActivePerSession(s,() => ({ _pendingSlashCommand: '' })))

      const assistantId = `codex_${Date.now()}`
      const appendAssistant = (message: ChatMessage) => {
        set((s) => updateActivePerSession(s,(sess) => ({
          messages: [...sess.messages, message],
        })))
      }
      const updateAssistant = (
        status: 'streaming' | 'complete' | 'interrupted' | 'error',
        text: string,
        metadata?: ChatMessage['metadata'],
      ) => {
        set((s) => updateActivePerSession(s,(sess) => ({
          status: status === 'streaming' ? 'streaming' : 'idle',
          messages: sess.messages.map((m) => (
            m.id !== assistantId
              ? m
              : {
                  ...m,
                  status,
                  content: [{ type: 'text', text }],
                  ...(metadata ? { metadata } : {}),
                }
          )),
        })))
      }

      // Steer: if streaming and command is 'run', send as steer input instead of starting a new run
      if (session.status === 'streaming' && resolvedCodexCommand.kind === 'run') {
        try {
          await window.app.codexSteer(activeProject, resolvedCodexCommand.prompt)
        } catch (error) {
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
      set((s) => updateActivePerSession(s,() => ({ status: 'streaming' })))

      try {
        const runStart = Date.now()
        let result: Awaited<ReturnType<typeof window.app.codexRun>>

        if (resolvedCodexCommand.kind === 'review') {
          result = await window.app.codexReview(
            activeProject,
            resolvedCodexCommand.target,
            selectedCodexModel || undefined,
            selectedCodexReasoningEffort,
            selectedCodexPermissionPreset,
            codexThreadId,
            assistantId,
          )
        } else if (resolvedCodexCommand.kind === 'compact') {
          result = await window.app.codexCompact(
            activeProject,
            selectedCodexModel || undefined,
            selectedCodexPermissionPreset,
            codexThreadId,
            assistantId,
          )
        } else {
          result = await window.app.codexRun(
            activeProject,
            resolvedCodexCommand.prompt,
            selectedCodexModel || undefined,
            selectedCodexReasoningEffort,
            selectedCodexPermissionPreset,
            codexThreadId,
            assistantId,
            attachments.length > 0 ? attachments : undefined,
          )
        }

        const text = result.finalResponse?.trim() || (
          resolvedCodexCommand.kind === 'compact'
            ? 'Conversation compacted.'
            : 'Codex completed without returning text.'
        )
        const renderedItems = pruneTransientCodexItems(result.items)
        updateAssistant('complete', text, result.usage ? {
          durationMs: Date.now() - runStart,
          usage: {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            cacheReadInputTokens: result.usage.cachedInputTokens,
            cacheCreationInputTokens: 0,
          },
          consumedTokens: {
            input: result.usage.inputTokens,
            output: result.usage.outputTokens,
          },
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
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const interrupted = /interrupt|abort/i.test(message)
        updateAssistant(
          interrupted ? 'interrupted' : 'error',
          interrupted ? 'Codex run interrupted.' : `Codex run failed: ${message}`,
        )
      }
      _saveSessionState(get, activeProject)
      return
    }

    _saveSessionState(get, activeProject)

    // Merge project + session additional directories (deduplicated)
    const mergedDirs = [...new Set([...project.projectAdditionalDirs, ...session.additionalDirs])]

    await window.agent.sendMessage(activeProject, {
      content: finalContent,
      model: selectedModel || undefined,
      effort: selectedEffort,
      images: attachments.length > 0 ? attachments : undefined,
      additionalDirs: mergedDirs.length > 0 ? mergedDirs : undefined,
    })
  },

  interrupt: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    const [claudeResult] = await Promise.allSettled([
      window.agent.interrupt(activeProject),
      window.app.codexInterrupt(activeProject),
    ])
    const claudeFailed = claudeResult.status === 'rejected' || claudeResult.value === false
    if (claudeFailed) {
      set((s) => updateActivePerSession(s, () => ({
        status: 'idle',
        pendingPermission: null,
        pendingQuestion: null,
        pendingPlanApproval: null,
      })))
    }
  },

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),

  setCorner: (corner) => set({ corner }),

  clearMessages: () => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s,() => ({
      messages: [], session: null, totalCostUsd: 0, contextTokens: 0,
      sessionProvider: null, slashCommandOutput: null,
      pendingPermission: null, pendingQuestion: null, pendingPlanApproval: null,
      planApprovalOutcome: null, mentions: [], subagentTokens: {},
      todos: {}, _nextTodoId: 1, showTodos: false, _todosUserDismissed: false,
    })))
  },

  resetSessionForWorktreeSwitch: (projectPath: string) => {
    set((s) => {
      const proj = getProject(s, projectPath)
      const newSession = createDefaultPerSessionState()
      applyDefaultModel(newSession, s.availableModels)
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

    if (activeSession.status === 'streaming' && currentSid) {
      await window.agent.parkSession(activeProject)
    } else {
      await window.agent.resetSession(activeProject)
    }

    await useAppStore.getState().clearWorktree(activeProject)

    set((s) => {
      const proj = getProject(s, activeProject)
      const newSession = createDefaultPerSessionState()
      applyDefaultModel(newSession, s.availableModels)
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

  setDraftText: (text) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s,() => ({ draftText: text })))
  },

  setSelectedModel: (model) => {
    const { activeProject, availableModels } = get()
    if (!activeProject) return
    const modelInfo = availableModels.find((m) => m.id === model)
    const defaultEffort = modelInfo?.supportedEffortLevels?.length ? 'high' as EffortLevel : undefined
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
    set((s) => updateActivePerSession(s, () => ({
      selectedCodexModel: model,
      selectedCodexReasoningEffort: resolveCodexReasoningEffort(selectedModel),
    })))
  },

  setSelectedCodexReasoningEffort: (effort) => {
    const { activeProject } = get()
    if (!activeProject) return
    const proj = getProject(get(), activeProject)
    const sess = getActivePerSession(get())
    const selectedModel = proj.codexModels.find((entry) => entry.id === sess.selectedCodexModel)
    set((s) => updateActivePerSession(s, () => ({
      selectedCodexReasoningEffort: resolveCodexReasoningEffort(selectedModel, effort),
    })))
  },

  setSelectedCodexPermissionPreset: (preset) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s,() => ({
      selectedCodexPermissionPreset: preset,
    })))
  },

  refreshCodexModels: async (force = false) => {
    const { activeProject } = get()
    if (!activeProject) return

    const current = getProject(get(), activeProject)
    if (!force && (current.codexModelsLoading || current.codexModels.length > 0)) return

    set((s) => updateProjectState(s, activeProject, () => ({ codexModelsLoading: true })))
    try {
      const models = await window.app.codexListModels(activeProject)
      set((s) => {
        const proj = getProject(s, activeProject)
        const activeSid = proj._activeSessionId
        const sess = activeSid ? (proj._sessions[activeSid] ?? createDefaultPerSessionState()) : createDefaultPerSessionState()
        const hasCurrent = sess.selectedCodexModel.length > 0 && models.some((m) => m.id === sess.selectedCodexModel)
        const selected = hasCurrent
          ? sess.selectedCodexModel
          : models.find((m) => m.isDefault)?.id ?? models[0]?.id ?? ''
        const selectedModel = models.find((m) => m.id === selected)
        const updatedSessions = activeSid
          ? { ...proj._sessions, [activeSid]: { ...sess, selectedCodexModel: selected, selectedCodexReasoningEffort: resolveCodexReasoningEffort(selectedModel, sess.selectedCodexReasoningEffort) } }
          : proj._sessions
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: { ...proj, codexModels: models, codexModelsLoading: false, _sessions: updatedSessions },
          },
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

  respondToPermission: (requestId, allow, alwaysAllow, reason, selectedSuggestions) => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getActivePerSession(get(), activeProject)
    if (session.sessionProvider === 'codex') {
      void window.app.codexRespondToPermission(activeProject, requestId, allow, alwaysAllow, reason)
    } else {
      void window.agent.respondToPermission(activeProject, requestId, allow, alwaysAllow, reason, selectedSuggestions)
    }
    const updates: Partial<PerSessionState> = { pendingPermission: null }
    if (allow && selectedSuggestions) {
      const mode = extractModeFromSuggestions(session.pendingPermission?.suggestions, selectedSuggestions)
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
    window.agent.answerQuestion(activeProject, requestId, answers)
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

  dismissQuestion: (requestId) => {
    const { activeProject } = get()
    if (!activeProject) return
    window.agent.dismissQuestion(activeProject, requestId)
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
      const sessions = await window.app.listSessionsForFolder(activeProject)
      set((s) => updateProjectState(s, activeProject, () => ({ sessions })))
    } catch {}
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

  resumeSession: async (sessionId) => {
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
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: { ...proj, _activeSessionId: sessionId, showHistory: false },
          },
        }
      })

      const targetSession = project._sessions[sessionId]
      if (targetSession.sessionProvider === 'codex') return

      try {
        await window.agent.activateSession(activeProject, sessionId)
        return
      } catch {
        set((s) => updatePerSession(s, activeProject, sessionId, () => ({ status: 'idle' })))
      }
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
    } catch {}

    const restoredProvider: ChatProvider = (savedProvider as ChatProvider) ?? DEFAULT_PROVIDER

    const freshProject = getProject(get())
    const freshActiveSession = getActivePerSession(get())
    if (freshActiveSession.status === 'streaming') {
      await window.agent.parkSession(activeProject)
    } else {
      _saveSessionState(get, activeProject)
    }

    const restoredSession: PerSessionState = {
      ...createDefaultPerSessionState(),
      messages: savedMessages,
      totalCostUsd: savedCost,
      contextTokens: savedTokens,
      _worktreeBranch: savedWorktreeBranch,
      preferredProvider: restoredProvider,
      sessionProvider: restoredProvider,
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

    if (restoredProvider !== 'codex') {
      await window.app.resumeSession(activeProject, sessionId, savedWorktreePath)
    }

    if (savedWorktreePath) {
      useAppStore.getState().setActiveWorktree(activeProject, savedWorktreePath)
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
        ? { startedAt: existing.startedAt, elapsedSeconds: existing.elapsedSeconds }
        : {}
      return content.map((b, i) => (i === idx ? { ...preserved, ...delta } : b))
    }
    return [...content, { ...delta, startedAt: Date.now() }]
  }
  return [...content, delta]
}
