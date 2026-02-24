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

// --- Per-project session state ---

/** Snapshot of a session that is streaming in the background. */
interface BgSessionState {
  messages: ChatMessage[]
  status: AgentStatus
  session: SessionInfo | null
  sessionProvider: ChatProvider | null
  totalCostUsd: number
  contextTokens: number
  subagentTokens: Record<string, { input: number; output: number }>
  todos: Record<string, TodoItem>
  _nextTodoId: number
  permissionMode: PermissionMode
  pendingPermission: PermissionRequest | null
  pendingQuestion: AskUserQuestionRequest | null
  pendingPlanApproval: PlanApprovalRequest | null
  _worktreeBranch?: string | null
}

export interface SessionState {
  messages: ChatMessage[]
  status: AgentStatus
  session: SessionInfo | null
  sessionProvider: ChatProvider | null
  totalCostUsd: number
  contextTokens: number

  selectedModel: string
  selectedEffort?: EffortLevel
  selectedCodexModel: string
  selectedCodexReasoningEffort?: CodexReasoningEffort
  selectedCodexPermissionPreset: CodexPermissionPreset
  codexModels: ModelOption[]
  codexModelsLoading: boolean
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

  slashCommands: SlashCommandInfo[]
  _projectSkills: SlashCommandInfo[]
  _projectCommands: SlashCommandInfo[]
  agents: AgentInfo[]
  subagentTokens: Record<string, { input: number; output: number }>

  cwd: string
  homedir: string
  sandboxInfo: SandboxInfo

  slashCommandOutput: { command: string; content: string; mode?: 'overlay' | 'popup' } | null
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

  // Worktree branch name (non-null when session was created in a git worktree)
  _worktreeBranch: string | null

  // Background sessions (streaming in background while user views another session)
  _bgSessions: Record<string, BgSessionState>

  // Additional working directories
  additionalDirs: string[]          // Session-level extra directories
  projectAdditionalDirs: string[]   // Project-level directories (from .claude/settings.json)
  showDirManager: boolean           // Directory manager panel visibility
}

export function createDefaultSessionState(): SessionState {
  return {
    messages: [],
    status: 'idle',
    session: null,
    sessionProvider: null,
    totalCostUsd: 0,
    contextTokens: 0,
    selectedModel: '',
    selectedEffort: undefined,
    selectedCodexModel: '',
    selectedCodexReasoningEffort: undefined,
    selectedCodexPermissionPreset: 'default',
    codexModels: [],
    codexModelsLoading: false,
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
    slashCommands: [],
    _projectSkills: [],
    _projectCommands: [],
    agents: [],
    subagentTokens: {},
    cwd: '',
    homedir: '',
    sandboxInfo: { enabled: true, autoAllowBash: false },
    slashCommandOutput: null,
    _pendingSlashCommand: '',
    todos: {},
    showTodos: false,
    _todosUserDismissed: false,
    _nextTodoId: 1,
    sessions: [],
    showHistory: false,
    _historySessionId: null,
    _worktreeBranch: null,
    streamingTokens: { input: 0, output: 0 },
    hasUnseenActivity: false,
    hasPendingInteraction: false,
    isCompacting: false,
    _bgSessions: {},
    additionalDirs: [],
    projectAdditionalDirs: [],
    showDirManager: false,
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

function applyEventToSession(session: SessionState, event: AgentEvent): Partial<SessionState> {
  switch (event.type) {
    case 'message_start':
      return { messages: [...session.messages, event.message], promptSuggestion: null }

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

    case 'prompt_suggestion':
      return { promptSuggestion: event.suggestion }

    case 'permission_request':
      return { pendingPermission: event.request, hasPendingInteraction: true }

    case 'permission_mode_change':
      return { permissionMode: event.mode }

    case 'session_init':
      console.log('[applyEvent] session_init', { sessionId: event.session?.sessionId })
      return { session: event.session, sessionProvider: session.sessionProvider ?? DEFAULT_PROVIDER }

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

    case 'init_ready': {
      return {
        cwd: event.cwd,
        homedir: event.homedir,
        sandboxInfo: event.sandboxInfo,
      }
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

/** Resolve the effective sessionId for saving (prefer _historySessionId). */
function _getEffectiveSessionId(session: SessionState): string | null {
  return session._historySessionId ?? session.session?.sessionId ?? null
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

function _getWorktreeBranch(projectPath: string, session: SessionState): string | undefined {
  if (session._worktreeBranch) return session._worktreeBranch
  const wt = useAppStore.getState().getWorktreeState(projectPath)
  if (wt.pendingBaseBranch) return wt.pendingBaseBranch
  return undefined
}

function _getWorktreePath(projectPath: string): string | undefined {
  return useAppStore.getState().getWorktreeState(projectPath).activePath ?? undefined
}

/** Save session state to DB. Reads current store state — safe for synchronous call sites. */
function _saveSessionState(get: () => ChatStore, projectPath: string): void {
  const session = get().projectSessions[projectPath]
  if (!session || session.messages.length === 0) return

  const sessionId = _getEffectiveSessionId(session)
  if (!sessionId) return

  const branch = _getWorktreeBranch(projectPath, session)
  const wtPath = _getWorktreePath(projectPath)
  window.app.createSession(projectPath, sessionId, !!branch || undefined, branch, wtPath)
    .catch(() => { /* ignore duplicate */ })
    .then(() => window.app.saveSessionState(sessionId, {
      messages: session.messages,
      totalCostUsd: session.totalCostUsd,
      contextTokens: session.contextTokens,
      title: _extractTitle(session.messages),
      provider: session.sessionProvider ?? undefined,
    }))
    .catch(() => { /* best-effort */ })
}

/** Save a captured session snapshot. Use this from within set() to avoid timer race conditions. */
function _saveSessionSnapshot(projectPath: string, session: SessionState): void {
  const sessionId = _getEffectiveSessionId(session)
  if (!sessionId || session.messages.length === 0) return

  const branch = _getWorktreeBranch(projectPath, session)
  const wtPath = _getWorktreePath(projectPath)
  window.app.createSession(projectPath, sessionId, !!branch || undefined, branch, wtPath)
    .catch(() => { /* ignore duplicate */ })
    .then(() => window.app.saveSessionState(sessionId, {
      messages: session.messages,
      totalCostUsd: session.totalCostUsd,
      contextTokens: session.contextTokens,
      title: _extractTitle(session.messages),
      provider: session.sessionProvider ?? undefined,
    }))
    .catch(() => { /* best-effort */ })
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

      // Rebuild per-session derived data (selectedModel + slashCommands)
      const sessions = { ...s.projectSessions }
      let changed = false
      for (const [path, session] of Object.entries(sessions)) {
        let sessionChanged = false
        const patched = { ...session }

        // Auto-select first model if unset
        if (!patched.selectedModel && models.length > 0) {
          patched.selectedModel = models[0].id
          sessionChanged = true
        }

        // Rebuild slashCommands if session has received init_ready
        if (patched._projectSkills.length > 0 || patched._projectCommands.length > 0 || patched.session) {
          patched.slashCommands = buildSlashCommands(slashCommands, userSkills, userCommands, patched._projectSkills, patched._projectCommands)
          sessionChanged = true
        }

        if (sessionChanged) {
          sessions[path] = patched
          changed = true
        }
      }
      if (changed) updates.projectSessions = sessions
      return updates
    })
  },

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
          sessionProvider: bg.sessionProvider,
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

        // Incremental save on tool_result + final save on complete/interrupted/error
        if (
          (event.type === 'content_delta' && event.delta.type === 'tool_result') ||
          event.type === 'message_complete' || event.type === 'message_interrupted' || event.type === 'message_error'
        ) {
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

      // Handle init_ready: store project-level data, rebuild slashCommands, set agents + selectedModel
      if (event.type === 'init_ready') {
        updatedSession._projectSkills = event.skills
        updatedSession._projectCommands = event.projectCommands
        updatedSession.slashCommands = buildSlashCommands(
          s.globalSlashCommands, s.userSkills, s.userCommands,
          event.skills, event.projectCommands,
        )
        updatedSession.agents = [...s.userAgents, ...event.projectAgents]

        const globalModels = s.availableModels
        if (!updatedSession.selectedModel && globalModels[0]) {
          updatedSession.selectedModel = globalModels[0].id
          if (globalModels[0].supportedEffortLevels?.length) {
            updatedSession.selectedEffort = 'high'
          }
        }

        // Load project-level additional directories
        window.agent.readProjectAdditionalDirs(projectPath)
          .then((dirs) => {
            set((st) => updateSession(st, projectPath, () => ({ projectAdditionalDirs: dirs })))
          })
          .catch(() => { /* best-effort */ })
      }

      // On session_init, create session in DB
      if (event.type === 'session_init' && event.session) {
        const snapshot = updatedSession
        setTimeout(() => _saveSessionSnapshot(projectPath, snapshot), 0)
      }

      // Incremental save when a tool_result arrives (block boundary)
      if (event.type === 'content_delta' && event.delta.type === 'tool_result') {
        const snapshot = updatedSession
        setTimeout(() => _saveSessionSnapshot(projectPath, snapshot), 0)
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
          [projectPath]: { ...createDefaultSessionState(), agents: s.userAgents },
        },
      }
    })
  },

  sendMessage: async (content: string) => {
    const { activeProject } = get()
    if (!activeProject) return

    // Activate pending worktree before sending (lazy creation)
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
      // Reset session state — new worktree session starts fresh
      set((s) => updateSession(s, activeProject, () => ({
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
        session: null,
        sessionProvider: null,
        _historySessionId: null,
        _worktreeBranch: baseBranch,
        todos: {},
        _nextTodoId: 1,
        showTodos: false,
        _todosUserDismissed: false,
        subagentTokens: {},
      })))
    }

    const session = getSession(get())
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
      set((s) => updateSession(s, activeProject, () => ({
        sessionProvider: effectiveProvider,
        preferredProvider: effectiveProvider,
      })))
    }

    if (effectiveProvider === 'codex' && !_getEffectiveSessionId(session)) {
      set((s) => updateSession(s, activeProject, () => ({
        _historySessionId: _createLocalCodexSessionId(),
      })))
    }

    const slashMatch = finalContent.match(/^\/(\S+)/)
    set((s) => updateSession(s, activeProject, () => ({ _pendingSlashCommand: slashMatch ? slashMatch[1] : '' })))

    // Utility codex commands → popup overlay (no chat messages)
    if (resolvedCodexCommand) {
      const utilityKind = resolvedCodexCommand.kind
      if (utilityKind === 'help' || utilityKind === 'reset' || utilityKind === 'auth-status' || utilityKind === 'auth-set') {
        set((s) => updateSession(s, activeProject, () => ({ _pendingSlashCommand: '' })))
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
        set((s) => updateSession(s, activeProject, () => ({
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
      { type: 'text' as const, text: finalContent },
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
      ...updateSession(s, activeProject, (sess) => ({
        messages: [...sess.messages, userMessage],
        attachments: [],
        mentions: [],
      })),
      isOpen: true,
    }))

    if (resolvedCodexCommand) {
      set((s) => updateSession(s, activeProject, () => ({ _pendingSlashCommand: '' })))

      const assistantId = `codex_${Date.now()}`
      const appendAssistant = (message: ChatMessage) => {
        set((s) => updateSession(s, activeProject, (sess) => ({
          messages: [...sess.messages, message],
        })))
      }
      const updateAssistant = (
        status: 'streaming' | 'complete' | 'interrupted' | 'error',
        text: string,
        metadata?: ChatMessage['metadata'],
      ) => {
        set((s) => updateSession(s, activeProject, (sess) => ({
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
      set((s) => updateSession(s, activeProject, () => ({ status: 'streaming' })))

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
    const mergedDirs = [...new Set([...session.projectAdditionalDirs, ...session.additionalDirs])]

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
    await Promise.allSettled([
      window.agent.interrupt(activeProject),
      window.app.codexInterrupt(activeProject),
    ])
  },

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),

  setCorner: (corner) => set({ corner }),

  clearMessages: () => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateSession(s, activeProject, () => ({
      messages: [], session: null, totalCostUsd: 0, contextTokens: 0,
      sessionProvider: null, slashCommandOutput: null,
      pendingPermission: null, pendingQuestion: null, pendingPlanApproval: null,
      planApprovalOutcome: null, mentions: [], subagentTokens: {},
      todos: {}, _nextTodoId: 1, showTodos: false, _todosUserDismissed: false,
    })))
  },

  resetSessionForWorktreeSwitch: (projectPath: string) => {
    set((s) => updateSession(s, projectPath, () => ({
      messages: [],
      session: null,
      sessionProvider: null,
      _historySessionId: null,
      totalCostUsd: 0,
      contextTokens: 0,
      todos: {},
      _nextTodoId: 1,
      showTodos: false,
      _todosUserDismissed: false,
      subagentTokens: {},
    })))
  },

  resetSession: async () => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getSession(get())
    const currentSid = _getEffectiveSessionId(session)

    if (session.status === 'streaming' && currentSid) {
      // Park current streaming session to background
      set((s) => updateSession(s, activeProject, (sess) => ({
        _bgSessions: {
          ...sess._bgSessions,
          [currentSid]: {
            messages: sess.messages, status: sess.status, session: sess.session,
            sessionProvider: sess.sessionProvider,
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

    // If currently in a worktree, switch agent cwd back to main project
    await useAppStore.getState().clearWorktree(activeProject)

    set((s) => updateSession(s, activeProject, () => ({
      messages: [], session: null, totalCostUsd: 0, contextTokens: 0,
      sessionProvider: null,
      status: 'idle', pendingPermission: null, pendingQuestion: null,
      pendingPlanApproval: null, planApprovalOutcome: null,
      mentions: [], subagentTokens: {},
      todos: {}, _nextTodoId: 1, showTodos: false, _todosUserDismissed: false,
      _historySessionId: null, _worktreeBranch: null,
    })))
  },

  rewindFiles: async (userMessageId: string) => {
    const { activeProject } = get()
    if (!activeProject) throw new Error('No active project')
    const result = await window.agent.rewindFiles(activeProject, userMessageId)
    if (result.canRewind !== false) {
      // Mark the user message as rewound
      set((s) => updateSession(s, activeProject, (sess) => ({
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
    const sess = getSession(get())
    const msg = sess.messages.find((m) => m.checkpointId === userMessageId)
    const resumePointId = msg?.resumePointId ?? ''
    const result = await window.agent.rewindCodeAndChat(activeProject, userMessageId, resumePointId)
    if (result.canRewind !== false) {
      set((s) => updateSession(s, activeProject, (sess) => {
        const idx = sess.messages.findIndex((m) => m.checkpointId === userMessageId)
        const truncated = idx >= 0 ? sess.messages.slice(0, idx) : sess.messages
        return {
          messages: result.forkedSessionId
            ? remapMessagesForFork(truncated, result.forkedSessionId)
            : truncated,
          session: null,
          totalCostUsd: 0,
          contextTokens: 0,
          _historySessionId: result.forkedSessionId ?? null,
        }
      }))
      if (result.forkedSessionId) {
        _saveSessionState(get, activeProject)
      }
    }
    return result
  },

  rewindConversation: async (userMessageId: string) => {
    const { activeProject } = get()
    if (!activeProject) throw new Error('No active project')
    const sess = getSession(get())
    const msg = sess.messages.find((m) => m.checkpointId === userMessageId)
    const resumePointId = msg?.resumePointId ?? ''
    const result = await window.agent.rewindConversation(activeProject, userMessageId, resumePointId)
    if (result.canRewind !== false) {
      set((s) => updateSession(s, activeProject, (sess) => {
        const idx = sess.messages.findIndex((m) => m.checkpointId === userMessageId)
        const truncated = idx >= 0 ? sess.messages.slice(0, idx) : sess.messages
        return {
          messages: result.forkedSessionId
            ? remapMessagesForFork(truncated, result.forkedSessionId)
            : truncated,
          session: null,
          totalCostUsd: 0,
          contextTokens: 0,
          _historySessionId: result.forkedSessionId ?? null,
        }
      }))
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
    set((s) => updateSession(s, activeProject, () => ({ draftText: text })))
  },

  setSelectedModel: (model) => {
    const { activeProject, availableModels } = get()
    if (!activeProject) return
    const modelInfo = availableModels.find((m) => m.id === model)
    const defaultEffort = modelInfo?.supportedEffortLevels?.length ? 'high' as EffortLevel : undefined
    set((s) => updateSession(s, activeProject, () => ({ selectedModel: model, selectedEffort: defaultEffort })))
  },

  setSelectedEffort: (effort) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateSession(s, activeProject, () => ({ selectedEffort: effort })))
  },

  setSelectedCodexModel: (model) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateSession(s, activeProject, (sess) => {
      const selectedModel = sess.codexModels.find((entry) => entry.id === model)
      return {
        selectedCodexModel: model,
        selectedCodexReasoningEffort: resolveCodexReasoningEffort(selectedModel),
      }
    }))
  },

  setSelectedCodexReasoningEffort: (effort) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateSession(s, activeProject, (sess) => {
      const selectedModel = sess.codexModels.find((entry) => entry.id === sess.selectedCodexModel)
      return {
        selectedCodexReasoningEffort: resolveCodexReasoningEffort(selectedModel, effort),
      }
    }))
  },

  setSelectedCodexPermissionPreset: (preset) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateSession(s, activeProject, () => ({
      selectedCodexPermissionPreset: preset,
    })))
  },

  refreshCodexModels: async (force = false) => {
    const { activeProject } = get()
    if (!activeProject) return

    const current = getSession(get(), activeProject)
    if (!force && (current.codexModelsLoading || current.codexModels.length > 0)) return

    set((s) => updateSession(s, activeProject, () => ({ codexModelsLoading: true })))
    try {
      const models = await window.app.codexListModels(activeProject)
      set((s) => updateSession(s, activeProject, (sess) => {
        const hasCurrent = sess.selectedCodexModel.length > 0 && models.some((m) => m.id === sess.selectedCodexModel)
        const selected = hasCurrent
          ? sess.selectedCodexModel
          : models.find((m) => m.isDefault)?.id ?? models[0]?.id ?? ''
        const selectedModel = models.find((m) => m.id === selected)
        return {
          codexModels: models,
          selectedCodexModel: selected,
          selectedCodexReasoningEffort: resolveCodexReasoningEffort(
            selectedModel,
            sess.selectedCodexReasoningEffort,
          ),
          codexModelsLoading: false,
        }
      }))
    } catch (error) {
      console.warn('[refreshCodexModels] Failed:', error)
      set((s) => updateSession(s, activeProject, () => ({ codexModelsLoading: false })))
    }
  },

  setPreferredProvider: (provider) => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getSession(get())
    if (session.sessionProvider && session.messages.length > 0) return
    set((s) => updateSession(s, activeProject, () => ({ preferredProvider: provider, slashCommandOutput: null })))
    if (provider === 'codex') {
      void get().refreshCodexModels()
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

  respondToPermission: (requestId, allow, alwaysAllow, reason, selectedSuggestions) => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getSession(get(), activeProject)
    if (session.sessionProvider === 'codex') {
      void window.app.codexRespondToPermission(activeProject, requestId, allow, alwaysAllow, reason)
    } else {
      void window.agent.respondToPermission(activeProject, requestId, allow, alwaysAllow, reason, selectedSuggestions)
    }
    const updates: Partial<SessionState> = { pendingPermission: null, hasPendingInteraction: false }
    if (allow && selectedSuggestions) {
      const mode = extractModeFromSuggestions(session.pendingPermission?.suggestions, selectedSuggestions)
      if (mode) updates.permissionMode = mode as PermissionMode
    }
    set((s) => updateSession(s, activeProject, () => updates))
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

  setSandboxMode: async (mode) => {
    const { activeProject } = get()
    if (!activeProject) return
    const updated = await window.agent.setSandboxMode(activeProject, mode)
    set((s) => updateSession(s, activeProject, () => ({ sandboxInfo: updated })))
  },

  cyclePermissionMode: () => {
    const modes: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']
    const session = getSession(get())
    const next = modes[(modes.indexOf(session.permissionMode) + 1) % modes.length]
    get().setPermissionMode(next)
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
      const currentSid = _getEffectiveSessionId(session)

      const newBg = { ...session._bgSessions }
      delete newBg[sessionId]

      // If current session is streaming, park it to background
      if (session.status === 'streaming' && currentSid) {
        newBg[currentSid] = {
          messages: session.messages, status: session.status, session: session.session,
          sessionProvider: session.sessionProvider,
          totalCostUsd: session.totalCostUsd, contextTokens: session.contextTokens,
          subagentTokens: session.subagentTokens, todos: session.todos, _nextTodoId: session._nextTodoId,
          permissionMode: session.permissionMode,
          pendingPermission: session.pendingPermission, pendingQuestion: session.pendingQuestion,
          pendingPlanApproval: session.pendingPlanApproval,
          _worktreeBranch: session._worktreeBranch || undefined,
        }
      } else {
        _saveSessionState(get, activeProject)
      }

      const restoredProvider: ChatProvider = bg.sessionProvider ?? DEFAULT_PROVIDER

      set((s) => updateSession(s, activeProject, () => ({
        messages: bg.messages, status: bg.status, session: bg.session,
        totalCostUsd: bg.totalCostUsd, contextTokens: bg.contextTokens,
        subagentTokens: bg.subagentTokens, todos: bg.todos, _nextTodoId: bg._nextTodoId,
        permissionMode: bg.permissionMode,
        pendingPermission: bg.pendingPermission, pendingQuestion: bg.pendingQuestion,
        pendingPlanApproval: bg.pendingPlanApproval,
        preferredProvider: restoredProvider,
        sessionProvider: restoredProvider,
        _worktreeBranch: bg._worktreeBranch ?? null,
        draftText: '', attachments: [], mentions: [],
        _historySessionId: sessionId, _bgSessions: newBg, showHistory: false,
      })))

      if (restoredProvider === 'codex') {
        return
      }

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
    } catch {
      // History loading is best-effort
    }

    const restoredProvider: ChatProvider = (savedProvider as ChatProvider) ?? DEFAULT_PROVIDER

    // Re-read latest session state (may have changed during async operations above)
    const freshSession = getSession(get())
    const currentSid = _getEffectiveSessionId(freshSession)
    const isStreaming = freshSession.status === 'streaming'

    // If current session is streaming → save to background
    if (isStreaming && currentSid) {
      set((s) => updateSession(s, activeProject, (sess) => ({
        _bgSessions: {
          ...sess._bgSessions,
          [currentSid]: {
            messages: sess.messages, status: sess.status, session: sess.session,
            sessionProvider: sess.sessionProvider,
            totalCostUsd: sess.totalCostUsd, contextTokens: sess.contextTokens,
            subagentTokens: sess.subagentTokens, todos: sess.todos, _nextTodoId: sess._nextTodoId,
            permissionMode: sess.permissionMode,
            pendingPermission: sess.pendingPermission, pendingQuestion: sess.pendingQuestion,
            pendingPlanApproval: sess.pendingPlanApproval,
            _worktreeBranch: sess._worktreeBranch || undefined,
          },
        },
        messages: savedMessages, session: null,
        totalCostUsd: savedCost, contextTokens: savedTokens,
        _worktreeBranch: savedWorktreeBranch,
        preferredProvider: restoredProvider,
        sessionProvider: restoredProvider,
        status: 'idle', pendingPermission: null, pendingQuestion: null,
        draftText: '', attachments: [], mentions: [],
        showHistory: false, _historySessionId: sessionId,
      })))
    } else {
      // Idle → direct swap
      set((s) => updateSession(s, activeProject, () => ({
        messages: savedMessages, session: null,
        totalCostUsd: savedCost, contextTokens: savedTokens,
        _worktreeBranch: savedWorktreeBranch,
        preferredProvider: restoredProvider,
        sessionProvider: restoredProvider,
        status: 'idle', pendingPermission: null, pendingQuestion: null,
        draftText: '', attachments: [], mentions: [],
        showHistory: false, _historySessionId: sessionId,
      })))
    }

    if (restoredProvider !== 'codex') {
      await window.app.resumeSession(activeProject, sessionId, savedWorktreePath)
    }

    // Restore app store worktree state so the UI shows "Worktree:" prefix
    if (savedWorktreePath) {
      useAppStore.getState().setActiveWorktree(activeProject, savedWorktreePath)
    }
  },

  addDir: (path, scope) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateSession(s, activeProject, (sess) => {
      // Check for duplicates across both lists
      if (sess.additionalDirs.includes(path) || sess.projectAdditionalDirs.includes(path)) return {}
      if (scope === 'session') {
        return { additionalDirs: [...sess.additionalDirs, path] }
      }
      const updated = [...sess.projectAdditionalDirs, path]
      window.agent.writeProjectAdditionalDirs(activeProject, updated).catch(() => {})
      return { projectAdditionalDirs: updated }
    }))
  },

  removeDir: (path, scope) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateSession(s, activeProject, (sess) => {
      if (scope === 'session') {
        return { additionalDirs: sess.additionalDirs.filter((d) => d !== path) }
      }
      const updated = sess.projectAdditionalDirs.filter((d) => d !== path)
      window.agent.writeProjectAdditionalDirs(activeProject, updated).catch(() => {})
      return { projectAdditionalDirs: updated }
    }))
  },

  setShowDirManager: (show) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateSession(s, activeProject, () => ({ showDirManager: show })))
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
