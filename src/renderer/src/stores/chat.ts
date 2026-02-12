import { create } from 'zustand'
import type { AgentEvent, AgentInfo, AgentStatus, AskUserQuestionRequest, ChatMessage, ContentBlock, ImageAttachment, ModelOption, PlanApprovalRequest, PermissionMode, PermissionRequest, RewindFilesResult, SandboxInfo, SessionHistoryEntry, SessionInfo, SlashCommandInfo, TodoItem } from '../../../shared/agent-types'

type Corner = 'br' | 'bl' | 'tr' | 'tl'

export type MentionKind = 'file' | 'directory' | 'agent'
export interface Mention {
  kind: MentionKind
  value: string
  displayName: string
}

// --- Per-project session state ---

/** Snapshot of a session that is streaming in the background. */
interface BgSessionState {
  messages: ChatMessage[]
  status: AgentStatus
  session: SessionInfo | null
  totalCostUsd: number
  contextTokens: number
  subagentTokens: Record<string, { input: number; output: number }>
  todos: Record<string, TodoItem>
  _nextTodoId: number
  permissionMode: PermissionMode
  pendingPermission: PermissionRequest | null
  pendingQuestion: AskUserQuestionRequest | null
  pendingPlanApproval: PlanApprovalRequest | null
}

export interface SessionState {
  messages: ChatMessage[]
  status: AgentStatus
  session: SessionInfo | null
  totalCostUsd: number
  contextTokens: number

  selectedModel: string
  draftText: string
  attachments: ImageAttachment[]
  mentions: Mention[]

  pendingPermission: PermissionRequest | null
  permissionMode: PermissionMode
  pendingQuestion: AskUserQuestionRequest | null
  pendingPlanApproval: PlanApprovalRequest | null
  planApprovalOutcome: { approved: boolean; feedback?: string } | null

  slashCommands: SlashCommandInfo[]
  agents: AgentInfo[]
  subagentTokens: Record<string, { input: number; output: number }>

  cwd: string
  homedir: string
  sandboxInfo: SandboxInfo

  slashCommandOutput: { command: string; content: string } | null
  _pendingSlashCommand: string

  todos: Record<string, TodoItem>
  showTodos: boolean
  _todosUserDismissed: boolean
  _nextTodoId: number

  sessions: SessionHistoryEntry[]
  showHistory: boolean
  _historySessionId: string | null

  // Token usage for the current streaming message
  streamingTokens: { input: number; output: number }

  // Background activity indicators
  hasUnseenActivity: boolean
  hasPendingInteraction: boolean
  isCompacting: boolean

  // Background sessions (streaming in background while user views another session)
  _bgSessions: Record<string, BgSessionState>
}

export function createDefaultSessionState(): SessionState {
  return {
    messages: [],
    status: 'idle',
    session: null,
    totalCostUsd: 0,
    contextTokens: 0,
    selectedModel: '',
    draftText: '',
    attachments: [],
    mentions: [],
    pendingPermission: null,
    permissionMode: 'default',
    pendingQuestion: null,
    pendingPlanApproval: null,
    planApprovalOutcome: null,
    slashCommands: [],
    agents: [],
    subagentTokens: {},
    cwd: '',
    homedir: '',
    sandboxInfo: { enabled: false, autoAllowBash: false },
    slashCommandOutput: null,
    _pendingSlashCommand: '',
    todos: {},
    showTodos: false,
    _todosUserDismissed: false,
    _nextTodoId: 1,
    sessions: [],
    showHistory: false,
    _historySessionId: null,
    streamingTokens: { input: 0, output: 0 },
    hasUnseenActivity: false,
    hasPendingInteraction: false,
    isCompacting: false,
    _bgSessions: {},
  }
}

// --- Store interface ---

interface ChatStore {
  // Multi-session state
  projectSessions: Record<string, SessionState>
  activeProject: string | null

  // Global UI state (not per-session)
  isOpen: boolean
  corner: Corner
  availableModels: ModelOption[]

  // Event handling
  handleAgentEvent: (event: AgentEvent) => void

  // Project switching
  switchProject: (projectPath: string) => void
  ensureSession: (projectPath: string) => void

  // Message actions (operate on activeProject)
  sendMessage: (content: string) => Promise<void>
  interrupt: () => Promise<void>

  // UI actions
  toggleOpen: () => void
  setCorner: (corner: Corner) => void
  clearMessages: () => void
  resetSession: () => Promise<void>
  rewindFiles: (userMessageId: string) => Promise<RewindFilesResult>

  // Draft text
  setDraftText: (text: string) => void

  // Model actions
  setSelectedModel: (model: string) => void
  fetchModels: () => Promise<void>

  // Attachment actions
  addAttachment: (attachment: ImageAttachment) => void
  removeAttachment: (index: number) => void
  clearAttachments: () => void

  // Permission actions
  respondToPermission: (requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string) => void
  setPermissionMode: (mode: PermissionMode) => Promise<void>
  cyclePermissionMode: () => void

  // Question actions
  answerQuestion: (requestId: string, answers: Record<string, string>) => void
  dismissQuestion: (requestId: string) => void

  // Plan approval
  respondToPlanApproval: (requestId: string, approved: boolean, feedback?: string) => void

  // Slash command actions
  fetchSlashCommands: () => Promise<void>
  dismissSlashCommandOutput: () => void

  // Todo
  toggleTodos: () => void

  // Agent actions (for @ mention)
  fetchAgents: () => Promise<void>

  // Mention chips
  addMention: (mention: Mention) => void
  removeMention: (value: string) => void

  // Session history
  fetchSessions: () => Promise<void>
  toggleHistory: () => void
  resumeSession: (sessionId: string) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
}

// --- Helper: get or create session state for a project ---

function getSession(state: ChatStore, projectPath?: string | null): SessionState {
  const key = projectPath ?? state.activeProject
  if (!key) return createDefaultSessionState()
  return state.projectSessions[key] ?? createDefaultSessionState()
}

function updateSession(
  state: ChatStore,
  projectPath: string,
  updater: (s: SessionState) => Partial<SessionState>,
): Partial<ChatStore> {
  const session = state.projectSessions[projectPath] ?? createDefaultSessionState()
  const updates = updater(session)
  return {
    projectSessions: {
      ...state.projectSessions,
      [projectPath]: { ...session, ...updates },
    },
  }
}

function updateActiveSession(
  state: ChatStore,
  updater: (s: SessionState) => Partial<SessionState>,
): Partial<ChatStore> {
  const key = state.activeProject
  if (!key) return {}
  return updateSession(state, key, updater)
}

// --- Apply agent event to a session (pure function) ---

function applyEventToSession(session: SessionState, event: AgentEvent): Partial<SessionState> {
  switch (event.type) {
    case 'message_start':
      return { messages: [...session.messages, event.message] }

    case 'content_delta': {
      const updatedMessages = session.messages.map((msg) => {
        if (msg.id !== event.messageId) return msg
        return { ...msg, content: applyDelta(msg.content, event.delta) }
      })

      let extraUpdates: Partial<SessionState> = {}

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
        }
      }

      return { messages: updatedMessages, ...extraUpdates }
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
      }

    case 'message_error':
      return {
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

    case 'permission_request':
      return { pendingPermission: event.request, hasPendingInteraction: true }

    case 'permission_mode_change':
      return { permissionMode: event.mode }

    case 'session_init':
      console.log('[applyEvent] session_init', { sessionId: event.session?.sessionId })
      return { session: event.session }

    case 'ask_user_question':
      return { pendingQuestion: event.request, hasPendingInteraction: true }

    case 'plan_approval':
      return { pendingPlanApproval: event.request, hasPendingInteraction: true }

    case 'tool_input_delta':
      // Skip state updates for streaming input deltas — the complete input arrives
      // via the 'result' event (content_delta with full tool_use block) which replaces
      // the streaming block entirely via applyDelta dedup. Updating state on every
      // delta caused massive re-render overhead for large-input tools (Write/Edit).
      return {}

    case 'tool_progress':
      return {
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
      return {
        slashCommands: event.slashCommands,
        cwd: event.cwd,
        homedir: event.homedir,
        sandboxInfo: event.sandboxInfo,
      }

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

    case 'slash_command_output': {
      const filtered = session.messages.filter((m) => m.id !== event.messageId)
      const lastUserIdx = filtered.findLastIndex((m) => m.role === 'user')
      if (lastUserIdx >= 0) filtered.splice(lastUserIdx, 1)
      return {
        slashCommandOutput: { command: session._pendingSlashCommand, content: event.content },
        _pendingSlashCommand: '',
        messages: filtered,
      }
    }

    case 'status_indicator':
      return { isCompacting: event.indicator === 'compacting' }

    case 'hook_started':
    case 'hook_complete':
    case 'task_notification':
    case 'auth_status':
      return {}
  }
}

// --- Auto-save helper ---

/** Resolve the effective sessionId for saving (prefer _historySessionId). */
function _getEffectiveSessionId(session: SessionState): string | null {
  return session._historySessionId ?? session.session?.sessionId ?? null
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

/** Save session state to DB. Reads current store state — safe for synchronous call sites. */
function _saveSessionState(get: () => ChatStore, projectPath: string): void {
  const session = get().projectSessions[projectPath]
  if (!session || session.messages.length === 0) return

  const sessionId = _getEffectiveSessionId(session)
  if (!sessionId) return

  window.app.createSession(projectPath, sessionId)
    .catch(() => { /* ignore duplicate */ })
    .then(() => window.app.saveSessionState(sessionId, {
      messages: session.messages,
      totalCostUsd: session.totalCostUsd,
      contextTokens: session.contextTokens,
      title: _extractTitle(session.messages),
    }))
    .catch(() => { /* best-effort */ })
}

/** Save a captured session snapshot. Use this from within set() to avoid timer race conditions. */
function _saveSessionSnapshot(projectPath: string, session: SessionState): void {
  const sessionId = _getEffectiveSessionId(session)
  if (!sessionId || session.messages.length === 0) return

  window.app.createSession(projectPath, sessionId)
    .catch(() => { /* ignore duplicate */ })
    .then(() => window.app.saveSessionState(sessionId, {
      messages: session.messages,
      totalCostUsd: session.totalCostUsd,
      contextTokens: session.contextTokens,
      title: _extractTitle(session.messages),
    }))
    .catch(() => { /* best-effort */ })
}

// --- Store implementation ---

export const useChatStore = create<ChatStore>((set, get) => ({
  projectSessions: {},
  activeProject: null,
  isOpen: false,
  corner: 'br',
  availableModels: [],

  handleAgentEvent: (event: AgentEvent) => {
    const projectPath = event.projectPath
    const eventSessionId = event.sessionId
    if (!projectPath) return // Safety: ignore events without projectPath

    set((s) => {
      const session = s.projectSessions[projectPath] ?? createDefaultSessionState()

      // --- Route events for background sessions ---
      if (eventSessionId && session._bgSessions[eventSessionId]) {
        const bg = session._bgSessions[eventSessionId]
        // Build a temporary SessionState to reuse applyEventToSession
        const tmpSession = { ...createDefaultSessionState(), ...bg }
        const delta = applyEventToSession(tmpSession, event)
        const updatedBg: BgSessionState = {
          messages: (delta.messages ?? bg.messages),
          status: (delta.status ?? bg.status),
          session: (delta.session !== undefined ? delta.session : bg.session),
          totalCostUsd: (delta.totalCostUsd ?? bg.totalCostUsd),
          contextTokens: (delta.contextTokens ?? bg.contextTokens),
          subagentTokens: (delta.subagentTokens ?? bg.subagentTokens),
          todos: (delta.todos ?? bg.todos),
          _nextTodoId: (delta._nextTodoId ?? bg._nextTodoId),
          permissionMode: (delta.permissionMode ?? bg.permissionMode),
          pendingPermission: delta.pendingPermission !== undefined ? delta.pendingPermission : bg.pendingPermission,
          pendingQuestion: delta.pendingQuestion !== undefined ? delta.pendingQuestion : bg.pendingQuestion,
          pendingPlanApproval: delta.pendingPlanApproval !== undefined ? delta.pendingPlanApproval : bg.pendingPlanApproval,
        }

        // Auto-save when bg session message finishes
        if (event.type === 'message_complete' || event.type === 'message_interrupted' || event.type === 'message_error') {
          setTimeout(() => {
            window.app.saveSessionState(eventSessionId, {
              messages: updatedBg.messages,
              totalCostUsd: updatedBg.totalCostUsd,
              contextTokens: updatedBg.contextTokens,
            }).catch(() => {})
          }, 0)
        }

        // Background session went idle → remove from bg
        if (event.type === 'status_change' && event.status === 'idle') {
          const { [eventSessionId]: _, ...restBg } = session._bgSessions
          // Recompute hasPendingInteraction from remaining bg sessions
          const anyBgPending = Object.values(restBg).some(
            (b) => b.pendingPermission || b.pendingQuestion || b.pendingPlanApproval,
          )
          return {
            projectSessions: {
              ...s.projectSessions,
              [projectPath]: {
                ...session,
                _bgSessions: restBg,
                hasPendingInteraction: anyBgPending || !!session.pendingPermission || !!session.pendingQuestion || !!session.pendingPlanApproval,
              },
            },
          }
        }

        // Recompute hasPendingInteraction from updated bg sessions + foreground
        const updatedBgMap = { ...session._bgSessions, [eventSessionId]: updatedBg }
        const anyBgPending = Object.values(updatedBgMap).some(
          (b) => b.pendingPermission || b.pendingQuestion || b.pendingPlanApproval,
        )

        return {
          projectSessions: {
            ...s.projectSessions,
            [projectPath]: {
              ...session,
              _bgSessions: updatedBgMap,
              hasUnseenActivity: projectPath !== s.activeProject ? true : session.hasUnseenActivity,
              hasPendingInteraction: anyBgPending || !!session.pendingPermission || !!session.pendingQuestion || !!session.pendingPlanApproval,
            },
          },
        }
      }

      // --- Normal event handling (foreground session) ---
      const updates = applyEventToSession(session, event)
      const updatedSession = { ...session, ...updates }

      // If event is not for the active project, mark background activity
      const isBackground = projectPath !== s.activeProject
      if (isBackground) {
        updatedSession.hasUnseenActivity = true
        // Permission/question/plan events mark pending interaction
        if (event.type === 'permission_request' || event.type === 'ask_user_question' || event.type === 'plan_approval') {
          updatedSession.hasPendingInteraction = true
        }
      }

      const result: Partial<ChatStore> = {
        projectSessions: {
          ...s.projectSessions,
          [projectPath]: updatedSession,
        },
      }

      // Handle init_ready: update global availableModels + selectedModel
      if (event.type === 'init_ready') {
        result.availableModels = event.models
        if (!updatedSession.selectedModel && event.models[0]) {
          updatedSession.selectedModel = event.models[0].id
        }
      }

      // On session_init, create session in DB, save any pending messages, and trigger resource fetches
      if (event.type === 'session_init' && event.session) {
        const snapshot = updatedSession
        setTimeout(() => _saveSessionSnapshot(projectPath, snapshot), 0)
        if (projectPath === s.activeProject) {
          setTimeout(() => {
            get().fetchModels()
            get().fetchSlashCommands()
          }, 0)
        }
      }

      // On init_ready, fetch agents
      if (event.type === 'init_ready' && projectPath === s.activeProject) {
        setTimeout(() => get().fetchAgents(), 0)
      }

      // Auto-save on every message complete/interrupted/error — capture snapshot immediately
      if (event.type === 'message_complete' || event.type === 'message_interrupted' || event.type === 'message_error') {
        const snapshot = updatedSession
        setTimeout(() => _saveSessionSnapshot(projectPath, snapshot), 0)
      }

      return result
    })
  },

  switchProject: (projectPath: string) => {
    // Save current session before switching
    const currentProject = get().activeProject
    if (currentProject) {
      _saveSessionState(get, currentProject)
    }
    set((s) => {
      const session = s.projectSessions[projectPath]
      const updates: Partial<ChatStore> = { activeProject: projectPath }
      if (session) {
        // Clear unseen activity flags when switching to this project
        updates.projectSessions = {
          ...s.projectSessions,
          [projectPath]: { ...session, hasUnseenActivity: false, hasPendingInteraction: false },
        }
      }
      return updates
    })
  },

  ensureSession: (projectPath: string) => {
    set((s) => {
      if (s.projectSessions[projectPath]) return {}
      return {
        projectSessions: {
          ...s.projectSessions,
          [projectPath]: createDefaultSessionState(),
        },
      }
    })
  },

  sendMessage: async (content: string) => {
    const { activeProject } = get()
    if (!activeProject) return

    const session = getSession(get())
    const { selectedModel, attachments, mentions } = session

    const mentionPrefix = mentions.map((m) => `@${m.value}`).join(' ')
    const trimmed = content.trim()
    const finalContent = mentionPrefix
      ? trimmed ? `${mentionPrefix} ${trimmed}` : mentionPrefix
      : trimmed

    const slashMatch = finalContent.match(/^\/(\S+)/)
    set((s) => updateSession(s, activeProject, () => ({ _pendingSlashCommand: slashMatch ? slashMatch[1] : '' })))

    const userContent: ContentBlock[] = [
      ...attachments.map((img) => ({ type: 'image' as const, name: img.name })),
      { type: 'text' as const, text: finalContent },
    ]

    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      status: 'complete',
      content: userContent,
      createdAt: new Date().toISOString(),
      providerId: 'local',
    }
    set((s) => ({
      ...updateSession(s, activeProject, (sess) => ({
        messages: [...sess.messages, userMessage],
        attachments: [],
        mentions: [],
      })),
      isOpen: true,
    }))
    _saveSessionState(get, activeProject)
    await window.agent.sendMessage(activeProject, {
      content: finalContent,
      model: selectedModel || undefined,
      images: attachments.length > 0 ? attachments : undefined,
    })
  },

  interrupt: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    await window.agent.interrupt(activeProject)
  },

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),

  setCorner: (corner) => set({ corner }),

  clearMessages: () => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateSession(s, activeProject, () => ({
      messages: [], session: null, totalCostUsd: 0, contextTokens: 0,
      pendingPermission: null, pendingQuestion: null, pendingPlanApproval: null,
      planApprovalOutcome: null, mentions: [], subagentTokens: {},
      todos: {}, _nextTodoId: 1, showTodos: false, _todosUserDismissed: false,
    })))
  },

  resetSession: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getSession(get())
    const currentSid = session._historySessionId ?? session.session?.sessionId

    if (session.status === 'streaming' && currentSid) {
      // Park current streaming session to background
      set((s) => updateSession(s, activeProject, (sess) => ({
        _bgSessions: {
          ...sess._bgSessions,
          [currentSid]: {
            messages: sess.messages, status: sess.status, session: sess.session,
            totalCostUsd: sess.totalCostUsd, contextTokens: sess.contextTokens,
            subagentTokens: sess.subagentTokens, todos: sess.todos, _nextTodoId: sess._nextTodoId,
            permissionMode: sess.permissionMode,
            pendingPermission: sess.pendingPermission, pendingQuestion: sess.pendingQuestion,
            pendingPlanApproval: sess.pendingPlanApproval,
          },
        },
      })))
      await window.agent.parkSession(activeProject)
    } else {
      await window.agent.resetSession(activeProject)
    }

    set((s) => updateSession(s, activeProject, () => ({
      messages: [], session: null, totalCostUsd: 0, contextTokens: 0,
      status: 'idle', pendingPermission: null, pendingQuestion: null,
      pendingPlanApproval: null, planApprovalOutcome: null,
      slashCommands: [], mentions: [], subagentTokens: {},
      todos: {}, _nextTodoId: 1, showTodos: false, _todosUserDismissed: false,
      _historySessionId: null,
    })))
  },

  rewindFiles: async (userMessageId: string) => {
    const { activeProject } = get()
    if (!activeProject) throw new Error('No active project')
    return window.agent.rewindFiles(activeProject, userMessageId)
  },

  setDraftText: (text) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateSession(s, activeProject, () => ({ draftText: text })))
  },

  setSelectedModel: (model) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateSession(s, activeProject, () => ({ selectedModel: model })))
  },

  fetchModels: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    try {
      const models = await window.agent.getAvailableModels(activeProject)
      if (models.length > 0) {
        set((s) => ({
          availableModels: models,
          ...updateSession(s, activeProject, (sess) => ({
            selectedModel: sess.selectedModel || models[0].id,
          })),
        }))
      } else {
        setTimeout(() => get().fetchModels(), 2000)
      }
    } catch {
      setTimeout(() => get().fetchModels(), 2000)
    }
  },

  addAttachment: (attachment) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateSession(s, activeProject, (sess) => ({
      attachments: [...sess.attachments, attachment],
    })))
  },

  removeAttachment: (index) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateSession(s, activeProject, (sess) => ({
      attachments: sess.attachments.filter((_, i) => i !== index),
    })))
  },

  clearAttachments: () => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateSession(s, activeProject, () => ({ attachments: [] })))
  },

  respondToPermission: (requestId, allow, alwaysAllow, reason) => {
    const { activeProject } = get()
    if (!activeProject) return
    window.agent.respondToPermission(activeProject, requestId, allow, alwaysAllow, reason)
    set((s) => updateSession(s, activeProject, () => ({ pendingPermission: null, hasPendingInteraction: false })))
  },

  setPermissionMode: async (mode) => {
    const { activeProject } = get()
    if (!activeProject) return
    await window.agent.setPermissionMode(activeProject, mode)
    set((s) => updateSession(s, activeProject, () => ({ permissionMode: mode })))
  },

  answerQuestion: (requestId, answers) => {
    const { activeProject } = get()
    if (!activeProject) return
    window.agent.answerQuestion(activeProject, requestId, answers)
    set((s) => updateSession(s, activeProject, () => ({ pendingQuestion: null, hasPendingInteraction: false })))
  },

  dismissQuestion: (requestId) => {
    const { activeProject } = get()
    if (!activeProject) return
    window.agent.dismissQuestion(activeProject, requestId)
    set((s) => updateSession(s, activeProject, () => ({ pendingQuestion: null, hasPendingInteraction: false })))
  },

  respondToPlanApproval: (requestId, approved, feedback) => {
    const { activeProject } = get()
    if (!activeProject) return
    window.agent.respondToPlanApproval(activeProject, requestId, approved, feedback)
    set((s) => updateSession(s, activeProject, () => ({
      pendingPlanApproval: null,
      planApprovalOutcome: { approved, feedback },
      hasPendingInteraction: false,
      ...(approved && { permissionMode: 'default' as PermissionMode }),
    })))
  },

  cyclePermissionMode: () => {
    const modes: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']
    const session = getSession(get())
    const next = modes[(modes.indexOf(session.permissionMode) + 1) % modes.length]
    get().setPermissionMode(next)
  },

  fetchSlashCommands: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    try {
      const cmds = await window.agent.getSlashCommands(activeProject)
      if (cmds.length > 0) {
        set((s) => updateSession(s, activeProject, () => ({ slashCommands: cmds })))
      } else {
        setTimeout(() => get().fetchSlashCommands(), 2000)
      }
    } catch {
      setTimeout(() => get().fetchSlashCommands(), 2000)
    }
  },

  dismissSlashCommandOutput: () => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateSession(s, activeProject, () => ({ slashCommandOutput: null })))
  },

  toggleTodos: () => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateSession(s, activeProject, (sess) => {
      const willShow = !sess.showTodos
      return { showTodos: willShow, _todosUserDismissed: willShow ? false : true }
    }))
  },

  fetchAgents: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    try {
      const agents = await window.agent.listAgents(activeProject)
      set((s) => updateSession(s, activeProject, () => ({ agents })))
    } catch {
      setTimeout(() => get().fetchAgents(), 2000)
    }
  },

  addMention: (mention) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateSession(s, activeProject, (sess) => {
      if (sess.mentions.some((m) => m.value === mention.value)) return {}
      return { mentions: [...sess.mentions, mention] }
    }))
  },

  removeMention: (value) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateSession(s, activeProject, (sess) => ({
      mentions: sess.mentions.filter((m) => m.value !== value),
    })))
  },

  fetchSessions: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    try {
      const sessions = await window.app.listSessionsForFolder(activeProject)
      set((s) => updateSession(s, activeProject, () => ({ sessions })))
    } catch {}
  },

  toggleHistory: () => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getSession(get())
    const willShow = !session.showHistory
    if (willShow) get().fetchSessions()
    set((s) => updateSession(s, activeProject, () => ({ showHistory: willShow })))
  },

  renameSession: async (sessionId, title) => {
    const { activeProject } = get()
    if (!activeProject) return
    await window.app.renameSession(sessionId, title)
    set((s) => updateSession(s, activeProject, (sess) => ({
      sessions: sess.sessions.map((entry) =>
        entry.sessionId === sessionId ? { ...entry, title } : entry
      ),
    })))
  },

  resumeSession: async (sessionId) => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getSession(get())

    // Case A: Switch back to a session running in background
    if (session._bgSessions[sessionId]) {
      const bg = session._bgSessions[sessionId]
      const currentSid = session._historySessionId ?? session.session?.sessionId

      const newBg = { ...session._bgSessions }
      delete newBg[sessionId]

      // If current session is streaming, park it to background
      if (session.status === 'streaming' && currentSid) {
        newBg[currentSid] = {
          messages: session.messages, status: session.status, session: session.session,
          totalCostUsd: session.totalCostUsd, contextTokens: session.contextTokens,
          subagentTokens: session.subagentTokens, todos: session.todos, _nextTodoId: session._nextTodoId,
          permissionMode: session.permissionMode,
          pendingPermission: session.pendingPermission, pendingQuestion: session.pendingQuestion,
          pendingPlanApproval: session.pendingPlanApproval,
        }
      } else {
        _saveSessionState(get, activeProject)
      }

      set((s) => updateSession(s, activeProject, () => ({
        messages: bg.messages, status: bg.status, session: bg.session,
        totalCostUsd: bg.totalCostUsd, contextTokens: bg.contextTokens,
        subagentTokens: bg.subagentTokens, todos: bg.todos, _nextTodoId: bg._nextTodoId,
        permissionMode: bg.permissionMode,
        pendingPermission: bg.pendingPermission, pendingQuestion: bg.pendingQuestion,
        pendingPlanApproval: bg.pendingPlanApproval,
        draftText: '', attachments: [], mentions: [],
        _historySessionId: sessionId, _bgSessions: newBg, showHistory: false,
      })))

      // Swap agents in main process; if bg agent was already disposed (race),
      // fall back to cleaning up stale state and resuming from DB.
      try {
        await window.agent.activateSession(activeProject, sessionId)
        return
      } catch {
        // Main process doesn't have this bg agent — reset UI to idle so
        // Case B won't try to park a phantom "streaming" session.
        set((s) => updateSession(s, activeProject, (sess) => {
          const { [sessionId]: _, ...cleanBg } = sess._bgSessions
          return { status: 'idle', _bgSessions: cleanBg }
        }))
        // Fall through to Case B (DB resume)
      }
    }

    // Case B: Load a historical session from DB
    let savedMessages: ChatMessage[] = []
    let savedCost = 0
    let savedTokens = 0
    try {
      const saved = await window.app.loadSessionState(sessionId)
      if (saved) {
        savedMessages = saved.messages
        savedCost = saved.totalCostUsd
        savedTokens = saved.contextTokens
      }
    } catch {
      // History loading is best-effort
    }

    // Re-read latest session state (may have changed during async operations above)
    const freshSession = getSession(get())
    const currentSid = freshSession._historySessionId ?? freshSession.session?.sessionId
    const isStreaming = freshSession.status === 'streaming'

    // If current session is streaming → save to background
    if (isStreaming && currentSid) {
      set((s) => updateSession(s, activeProject, (sess) => ({
        _bgSessions: {
          ...sess._bgSessions,
          [currentSid]: {
            messages: sess.messages, status: sess.status, session: sess.session,
            totalCostUsd: sess.totalCostUsd, contextTokens: sess.contextTokens,
            subagentTokens: sess.subagentTokens, todos: sess.todos, _nextTodoId: sess._nextTodoId,
            permissionMode: sess.permissionMode,
            pendingPermission: sess.pendingPermission, pendingQuestion: sess.pendingQuestion,
            pendingPlanApproval: sess.pendingPlanApproval,
          },
        },
        messages: savedMessages, session: null,
        totalCostUsd: savedCost, contextTokens: savedTokens,
        status: 'idle', pendingPermission: null, pendingQuestion: null,
        draftText: '', attachments: [], mentions: [],
        slashCommands: [], showHistory: false, _historySessionId: sessionId,
      })))
    } else {
      // Idle → direct swap
      set((s) => updateSession(s, activeProject, () => ({
        messages: savedMessages, session: null,
        totalCostUsd: savedCost, contextTokens: savedTokens,
        status: 'idle', pendingPermission: null, pendingQuestion: null,
        draftText: '', attachments: [], mentions: [],
        slashCommands: [], showHistory: false, _historySessionId: sessionId,
      })))
    }

    // Main process handles park + resume
    await window.app.resumeSession(activeProject, sessionId)
  },
}))

// --- Selector hook: read from the active project's session state ---

/** Stable reference for when no session exists — avoids infinite re-render from new object each call */
const DEFAULT_SESSION = createDefaultSessionState()

export function useActiveSession<T>(selector: (s: SessionState) => T): T {
  return useChatStore((store) => {
    const session = store.activeProject
      ? store.projectSessions[store.activeProject]
      : null
    return selector(session ?? DEFAULT_SESSION)
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
  // Deduplicate tool_use blocks by toolUseId (streaming → complete transition)
  if (delta.type === 'tool_use') {
    const idx = content.findIndex((b) => b.type === 'tool_use' && b.toolUseId === delta.toolUseId)
    if (idx !== -1) {
      return content.map((b, i) => (i === idx ? delta : b))
    }
  }
  return [...content, delta]
}
