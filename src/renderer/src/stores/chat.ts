import { create } from 'zustand'
import type { AgentEvent, AgentInfo, AgentStatus, AskUserQuestionRequest, ChatMessage, ContentBlock, ImageAttachment, LoadSessionMessagesResult, ModelOption, PermissionMode, PermissionRequest, RewindFilesResult, SessionHistoryEntry, SessionInfo, SlashCommandInfo, TodoItem } from '../../../shared/agent-types'

type Corner = 'br' | 'bl' | 'tr' | 'tl'

export type MentionKind = 'file' | 'directory' | 'agent'
export interface Mention {
  kind: MentionKind
  value: string
  displayName: string
}

interface ChatState {
  messages: ChatMessage[]
  isOpen: boolean
  status: AgentStatus
  corner: Corner

  // Session
  session: SessionInfo | null
  totalCostUsd: number
  contextTokens: number // latest turn's input tokens = current context window usage

  // Model selection
  selectedModel: string
  availableModels: ModelOption[]

  // Input draft (shared between compact and expanded ChatInput)
  draftText: string
  setDraftText: (text: string) => void

  // Image attachments
  attachments: ImageAttachment[]

  // Permission
  pendingPermission: PermissionRequest | null
  permissionMode: PermissionMode

  // AskUserQuestion
  pendingQuestion: AskUserQuestionRequest | null

  // Slash commands
  slashCommands: SlashCommandInfo[]

  // Agents (for @ mention)
  agents: AgentInfo[]

  // Mention chips
  mentions: Mention[]
  addMention: (mention: Mention) => void
  removeMention: (value: string) => void

  // Subagent token usage: parentToolUseId → total tokens
  subagentTokens: Record<string, number>

  // Paths (for display shortening)
  cwd: string
  homedir: string

  // Slash command overlay
  slashCommandOutput: { command: string; content: string } | null
  _pendingSlashCommand: string
  dismissSlashCommandOutput: () => void

  // Todo / task tracking
  todos: Record<string, TodoItem>
  showTodos: boolean
  _nextTodoId: number
  toggleTodos: () => void

  handleAgentEvent: (event: AgentEvent) => void
  sendMessage: (content: string) => Promise<void>
  interrupt: () => Promise<void>
  toggleOpen: () => void
  setCorner: (corner: Corner) => void
  clearMessages: () => void
  resetSession: () => Promise<void>
  rewindFiles: (userMessageId: string) => Promise<RewindFilesResult>

  // Model actions
  setSelectedModel: (model: string) => void
  fetchModels: () => Promise<void>

  // Attachment actions
  addAttachment: (attachment: ImageAttachment) => void
  removeAttachment: (index: number) => void
  clearAttachments: () => void

  // Permission actions
  respondToPermission: (requestId: string, allow: boolean, alwaysAllow?: boolean) => void
  setPermissionMode: (mode: PermissionMode) => Promise<void>
  cyclePermissionMode: () => void

  // Question actions
  answerQuestion: (requestId: string, answers: Record<string, string>) => void
  dismissQuestion: (requestId: string) => void

  // Slash command actions
  fetchSlashCommands: () => Promise<void>

  // Agent actions (for @ mention)
  fetchAgents: () => Promise<void>

  // Session history
  sessions: SessionHistoryEntry[]
  showHistory: boolean
  fetchSessions: () => Promise<void>
  toggleHistory: () => void
  resumeSession: (sessionId: string) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>

  // History pagination
  _historySessionId: string | null
  historyCursor: number | null
  hasMoreHistory: boolean
  isLoadingHistory: boolean
  loadMoreHistory: () => Promise<void>
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isOpen: false,
  status: 'idle',
  corner: 'br',

  session: null,
  totalCostUsd: 0,
  contextTokens: 0,

  draftText: '',
  setDraftText: (text) => set({ draftText: text }),

  selectedModel: '',
  availableModels: [],
  attachments: [],
  pendingPermission: null,
  permissionMode: 'default',
  pendingQuestion: null,
  slashCommands: [],
  agents: [],
  mentions: [],
  subagentTokens: {},
  cwd: '',
  homedir: '',
  slashCommandOutput: null,
  _pendingSlashCommand: '' as string,
  todos: {},
  showTodos: false,
  _nextTodoId: 1,
  sessions: [],
  showHistory: false,
  _historySessionId: null,
  historyCursor: null,
  hasMoreHistory: false,
  isLoadingHistory: false,

  dismissSlashCommandOutput: () => set({ slashCommandOutput: null }),
  toggleTodos: () => set((s) => ({ showTodos: !s.showTodos })),

  handleAgentEvent: (event: AgentEvent) => {
    switch (event.type) {
      case 'message_start':
        set((s) => ({ messages: [...s.messages, event.message] }))
        break

      case 'content_delta':
        set((s) => ({
          messages: s.messages.map((msg) => {
            if (msg.id !== event.messageId) return msg
            return { ...msg, content: applyDelta(msg.content, event.delta) }
          }),
        }))

        // When a tool_result arrives, check if its corresponding tool_use is a
        // todo/task tool and parse the accumulated input.  This is more reliable
        // than watching for tool_use status:'complete' because the input is built
        // incrementally via tool_input_delta and may not be present on the
        // complete-status delta itself.
        if (event.delta.type === 'tool_result') {
          const resultDelta = event.delta
          const msg = get().messages.find((m) => m.id === event.messageId)
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
                  set({ todos: newTodos, _nextTodoId: input.todos.length + 1, showTodos: true })
                } else if (tn === 'TaskCreate') {
                  const id = String(get()._nextTodoId)
                  set((s) => ({
                    _nextTodoId: s._nextTodoId + 1,
                    showTodos: true,
                    todos: {
                      ...s.todos,
                      [id]: {
                        id,
                        subject: input.subject ?? '',
                        description: input.description ?? '',
                        status: 'pending',
                        activeForm: input.activeForm,
                      },
                    },
                  }))
                } else if (tn === 'TaskUpdate' && input.taskId) {
                  set((s) => {
                    const existing = s.todos[input.taskId]
                    if (!existing) return s
                    if (input.status === 'deleted') {
                      const { [input.taskId]: _, ...rest } = s.todos
                      return { todos: rest }
                    }
                    return {
                      showTodos: true,
                      todos: {
                        ...s.todos,
                        [input.taskId]: {
                          ...existing,
                          ...(input.status && { status: input.status }),
                          ...(input.subject && { subject: input.subject }),
                          ...(input.description && { description: input.description }),
                          ...(input.activeForm && { activeForm: input.activeForm }),
                        },
                      },
                    }
                  })
                }
              } catch { /* ignore malformed JSON */ }
            }
          }
        }
        break

      case 'message_complete': {
        const prevState = get()
        const newCost = prevState.totalCostUsd + (event.metadata?.costUsd ?? 0)
        set((s) => ({
          messages: s.messages.map((msg) => {
            if (msg.id !== event.messageId) return msg
            return {
              ...msg,
              status: 'complete' as const,
              metadata: event.metadata ? { ...msg.metadata, ...event.metadata } : msg.metadata,
            }
          }),
          totalCostUsd: newCost,
          contextTokens: (() => {
            const u = event.metadata?.usage
            if (!u) return s.contextTokens
            const total = u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens
            return total > 0 ? total : s.contextTokens
          })(),
        }))
        break
      }

      case 'message_interrupted':
        set((s) => ({
          messages: s.messages.map((msg) => {
            if (msg.id !== event.messageId) return msg
            return {
              ...msg,
              status: 'interrupted' as const,
              metadata: event.metadata ? { ...msg.metadata, ...event.metadata } : msg.metadata,
            }
          }),
        }))
        break

      case 'message_error':
        set((s) => ({
          messages: s.messages.map((msg) => {
            if (msg.id !== event.messageId) return msg
            return {
              ...msg,
              status: 'error' as const,
              content: [...msg.content, { type: 'text' as const, text: `Error: ${event.error}` }],
            }
          }),
        }))
        break

      case 'status_change':
        set({ status: event.status })
        break

      case 'permission_request':
        set({ pendingPermission: event.request })
        break

      case 'permission_mode_change':
        set({ permissionMode: event.mode })
        break

      case 'session_init':
        set({ session: event.session })
        // Fetch resources now that session is active
        get().fetchModels()
        get().fetchSlashCommands()
        break

      case 'ask_user_question':
        set({ pendingQuestion: event.request })
        break

      case 'tool_input_delta':
        set((s) => ({
          messages: s.messages.map((msg) => {
            if (msg.id !== event.messageId) return msg
            return {
              ...msg,
              content: msg.content.map((block) => {
                if (block.type === 'tool_use' && block.toolUseId === event.toolUseId) {
                  return { ...block, input: block.input + event.partialJson }
                }
                return block
              }),
            }
          }),
        }))
        break

      case 'tool_progress':
        set((s) => ({
          messages: s.messages.map((msg) => {
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
        }))
        break

      case 'init_ready':
        set((s) => ({
          availableModels: event.models,
          selectedModel: s.selectedModel || event.models[0]?.id || '',
          slashCommands: event.slashCommands,
          cwd: event.cwd,
          homedir: event.homedir,
        }))
        get().fetchAgents()
        break

      case 'hook_started':
      case 'hook_complete':
      case 'task_notification':
      case 'auth_status':
        // These events are acknowledged but not displayed in current UI
        break

      case 'compact_boundary':
        // Insert a visual separator in the message stream
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: `compact_${Date.now()}`,
              role: 'assistant' as const,
              status: 'complete' as const,
              content: [{ type: 'text' as const, text: `--- Context compacted (${event.trigger}) ---` }],
              createdAt: new Date().toISOString(),
              providerId: 'system',
            },
          ],
        }))
        break

      case 'status_indicator':
        // Could show compacting indicator in UI
        break

      case 'subagent_usage':
        set((s) => ({
          subagentTokens: {
            ...s.subagentTokens,
            [event.parentToolUseId]: event.inputTokens + event.outputTokens,
          },
        }))
        break

      case 'slash_command_output':
        // Show in overlay and remove the slash command's chat messages
        set((s) => {
          const filtered = s.messages.filter((m) => m.id !== event.messageId)
          const lastUserIdx = filtered.findLastIndex((m) => m.role === 'user')
          if (lastUserIdx >= 0) filtered.splice(lastUserIdx, 1)
          return {
            slashCommandOutput: { command: s._pendingSlashCommand, content: event.content },
            _pendingSlashCommand: '',
            messages: filtered,
          }
        })
        break
    }
  },

  sendMessage: async (content: string) => {
    const { selectedModel, attachments, mentions } = get()

    // Prepend mention paths to the content (ensure exactly one space between mentions and text)
    const mentionPrefix = mentions.map((m) => `@${m.value}`).join(' ')
    const trimmed = content.trim()
    const finalContent = mentionPrefix
      ? trimmed ? `${mentionPrefix} ${trimmed}` : mentionPrefix
      : trimmed

    // Track slash command name for overlay routing
    const slashMatch = finalContent.match(/^\/(\S+)/)
    set({ _pendingSlashCommand: slashMatch ? slashMatch[1] : '' })

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
    set((s) => ({ messages: [...s.messages, userMessage], isOpen: true, attachments: [], mentions: [] }))
    await window.agent.sendMessage({
      content: finalContent,
      model: selectedModel || undefined,
      images: attachments.length > 0 ? attachments : undefined,
    })
  },

  interrupt: async () => {
    await window.agent.interrupt()
  },

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),

  setCorner: (corner) => set({ corner }),

  clearMessages: () => set({ messages: [], session: null, totalCostUsd: 0, contextTokens: 0, pendingPermission: null, pendingQuestion: null, mentions: [], subagentTokens: {}, todos: {}, _nextTodoId: 1, showTodos: false }),

  resetSession: async () => {
    await window.agent.resetSession()
    set({ messages: [], session: null, totalCostUsd: 0, contextTokens: 0, status: 'idle', pendingPermission: null, pendingQuestion: null, slashCommands: [], mentions: [], subagentTokens: {}, todos: {}, _nextTodoId: 1, showTodos: false, _historySessionId: null, historyCursor: null, hasMoreHistory: false })
  },

  rewindFiles: async (userMessageId: string) => {
    return window.agent.rewindFiles(userMessageId)
  },

  setSelectedModel: (model) => set({ selectedModel: model }),

  fetchModels: async () => {
    try {
      const models = await window.agent.getAvailableModels()
      if (models.length > 0) {
        set((s) => ({
          availableModels: models,
          selectedModel: s.selectedModel || models[0].id,
        }))
      } else {
        // Models not cached yet (session still initializing) — retry
        setTimeout(() => get().fetchModels(), 2000)
      }
    } catch {
      // Session may not be ready yet — retry
      setTimeout(() => get().fetchModels(), 2000)
    }
  },

  addAttachment: (attachment) =>
    set((s) => ({ attachments: [...s.attachments, attachment] })),

  removeAttachment: (index) =>
    set((s) => ({ attachments: s.attachments.filter((_, i) => i !== index) })),

  clearAttachments: () => set({ attachments: [] }),

  respondToPermission: (requestId, allow, alwaysAllow) => {
    window.agent.respondToPermission(requestId, allow, alwaysAllow)
    set({ pendingPermission: null })
  },

  setPermissionMode: async (mode) => {
    await window.agent.setPermissionMode(mode)
    set({ permissionMode: mode })
  },

  answerQuestion: (requestId, answers) => {
    window.agent.answerQuestion(requestId, answers)
    set({ pendingQuestion: null })
  },

  dismissQuestion: (requestId) => {
    window.agent.dismissQuestion(requestId)
    set({ pendingQuestion: null })
  },

  cyclePermissionMode: () => {
    const modes: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']
    const current = get().permissionMode
    const next = modes[(modes.indexOf(current) + 1) % modes.length]
    get().setPermissionMode(next)
  },

  fetchSlashCommands: async () => {
    try {
      const cmds = await window.agent.getSlashCommands()
      if (cmds.length > 0) {
        set({ slashCommands: cmds })
      } else {
        setTimeout(() => get().fetchSlashCommands(), 2000)
      }
    } catch {
      setTimeout(() => get().fetchSlashCommands(), 2000)
    }
  },

  fetchAgents: async () => {
    try {
      const agents = await window.agent.listAgents()
      set({ agents })
    } catch {
      setTimeout(() => get().fetchAgents(), 2000)
    }
  },

  addMention: (mention) =>
    set((s) => {
      if (s.mentions.some((m) => m.value === mention.value)) return s
      return { mentions: [...s.mentions, mention] }
    }),

  removeMention: (value) =>
    set((s) => ({ mentions: s.mentions.filter((m) => m.value !== value) })),

  fetchSessions: async () => {
    try {
      const sessions = await window.app.listSessions()
      set({ sessions })
    } catch {}
  },

  toggleHistory: () => {
    const willShow = !get().showHistory
    if (willShow) get().fetchSessions()
    set({ showHistory: willShow })
  },

  renameSession: async (sessionId, title) => {
    await window.app.renameSession(sessionId, title)
    set((s) => ({
      sessions: s.sessions.map((entry) =>
        entry.sessionId === sessionId ? { ...entry, title } : entry
      ),
    }))
  },

  resumeSession: async (sessionId) => {
    // Reset current UI state
    set({ messages: [], session: null, totalCostUsd: 0, contextTokens: 0, status: 'idle', pendingPermission: null, pendingQuestion: null, slashCommands: [], showHistory: false, _historySessionId: sessionId, historyCursor: null, hasMoreHistory: false, isLoadingHistory: false })

    // Load history messages before SDK resume
    try {
      const result: LoadSessionMessagesResult = await window.app.loadSessionMessages(sessionId, 10)
      set({
        messages: result.messages,
        historyCursor: result.cursor,
        hasMoreHistory: result.hasMore,
      })
    } catch {
      // History loading is best-effort
    }

    // Resume the SDK session (new messages will append)
    await window.app.resumeSession(sessionId)
  },
  loadMoreHistory: async () => {
    const { isLoadingHistory, hasMoreHistory, historyCursor, _historySessionId } = get()
    if (isLoadingHistory || !hasMoreHistory || historyCursor === null) return
    const sessionId = _historySessionId
    if (!sessionId) return

    set({ isLoadingHistory: true })
    try {
      const result: LoadSessionMessagesResult = await window.app.loadSessionMessages(sessionId, 20, historyCursor)
      set((s) => ({
        messages: [...result.messages, ...s.messages],
        historyCursor: result.cursor,
        hasMoreHistory: result.hasMore,
        isLoadingHistory: false,
      }))
    } catch {
      set({ isLoadingHistory: false })
    }
  },
}))

/** Apply a content delta to the content array, merging consecutive text blocks and deduplicating tool_use. */
function applyDelta(content: ContentBlock[], delta: ContentBlock): ContentBlock[] {
  if (delta.type === 'text') {
    const last = content[content.length - 1]
    if (last?.type === 'text') {
      return [...content.slice(0, -1), { type: 'text', text: last.text + delta.text }]
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
