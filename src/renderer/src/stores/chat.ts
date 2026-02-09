import { create } from 'zustand'
import type { AgentEvent, AgentStatus, AskUserQuestionRequest, ChatMessage, ContentBlock, ImageAttachment, ModelOption, PermissionMode, PermissionRequest, RewindFilesResult, SessionInfo, SlashCommandInfo } from '../../../shared/agent-types'

type Corner = 'br' | 'bl' | 'tr' | 'tl'

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

  // Image attachments
  attachments: ImageAttachment[]

  // Permission
  pendingPermission: PermissionRequest | null
  permissionMode: PermissionMode

  // AskUserQuestion
  pendingQuestion: AskUserQuestionRequest | null

  // Slash commands
  slashCommands: SlashCommandInfo[]

  // Slash command overlay
  slashCommandOutput: { command: string; content: string } | null
  _pendingSlashCommand: string
  dismissSlashCommandOutput: () => void

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

  // Slash command actions
  fetchSlashCommands: () => Promise<void>
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isOpen: false,
  status: 'idle',
  corner: 'br',

  session: null,
  totalCostUsd: 0,
  contextTokens: 0,

  selectedModel: '',
  availableModels: [],
  attachments: [],
  pendingPermission: null,
  permissionMode: 'default',
  pendingQuestion: null,
  slashCommands: [],
  slashCommandOutput: null,
  _pendingSlashCommand: '' as string,

  dismissSlashCommandOutput: () => set({ slashCommandOutput: null }),

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
        break

      case 'message_complete':
        set((s) => ({
          messages: s.messages.map((msg) => {
            if (msg.id !== event.messageId) return msg
            return {
              ...msg,
              status: 'complete' as const,
              metadata: event.metadata ? { ...msg.metadata, ...event.metadata } : msg.metadata,
            }
          }),
          totalCostUsd: s.totalCostUsd + (event.metadata?.costUsd ?? 0),
          contextTokens: event.metadata?.usage?.inputTokens ?? s.contextTokens,
        }))
        break

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
        }))
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
    const { selectedModel, attachments } = get()

    // Track slash command name for overlay routing
    const slashMatch = content.match(/^\/(\S+)/)
    set({ _pendingSlashCommand: slashMatch ? slashMatch[1] : '' })

    const userContent: ContentBlock[] = [
      ...attachments.map((img) => ({ type: 'image' as const, name: img.name })),
      { type: 'text' as const, text: content },
    ]

    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      status: 'complete',
      content: userContent,
      createdAt: new Date().toISOString(),
      providerId: 'local',
    }
    set((s) => ({ messages: [...s.messages, userMessage], isOpen: true, attachments: [] }))
    await window.agent.sendMessage({
      content,
      model: selectedModel || undefined,
      images: attachments.length > 0 ? attachments : undefined,
    })
  },

  interrupt: async () => {
    await window.agent.interrupt()
  },

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),

  setCorner: (corner) => set({ corner }),

  clearMessages: () => set({ messages: [], session: null, totalCostUsd: 0, contextTokens: 0, pendingPermission: null, pendingQuestion: null }),

  resetSession: async () => {
    await window.agent.resetSession()
    set({ messages: [], session: null, totalCostUsd: 0, contextTokens: 0, status: 'idle', pendingPermission: null, pendingQuestion: null, slashCommands: [] })
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
}))

// Eagerly fetch resources — retries until session is ready
useChatStore.getState().fetchModels()
useChatStore.getState().fetchSlashCommands()

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
