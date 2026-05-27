import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import { findCheckpointTarget } from '../helpers/chat-helpers'
import type { PerSessionState } from '../types'

type SlashEvent = Extract<AgentEvent, {
  type:
    | 'prompt_suggestion'
    | 'slash_command_output'
    | 'compact_boundary'
    | 'checkpoint_captured'
}>

export function reduceSlash(session: PerSessionState, event: SlashEvent): Partial<PerSessionState> {
  switch (event.type) {
    case 'prompt_suggestion':
      return { promptSuggestion: event.suggestion }

    case 'compact_boundary': {
      const compactUserId = session._pendingCompactUserId
      const msgs = compactUserId
        ? session.messages.filter((m) => m.id !== compactUserId)
        : [...session.messages]
      let insertIdx = msgs.length
      if (!compactUserId) {
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'user') {
            insertIdx = i
            break
          }
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
      return {
        isCompacting: false,
        messages: msgs,
        _pendingCompactUserId: '',
        ...(compactUserId ? { _pendingSlashCommand: '' } : {}),
      }
    }

    case 'slash_command_output': {
      const cmd = session._pendingSlashCommand
      const compactUserId = session._pendingCompactUserId
      const filtered = session.messages.filter(
        (m) => m.id !== event.messageId && (!compactUserId || m.id !== compactUserId),
      )
      if (cmd === 'compact') {
        if (!compactUserId) {
          const lastUserIdx = filtered.findLastIndex((m) => m.role === 'user')
          if (lastUserIdx >= 0) filtered.splice(lastUserIdx, 1)
        }
        return { _pendingSlashCommand: '', _pendingCompactUserId: '', messages: filtered }
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
        slashCommandOutput: { command: cmd, content: event.content },
        _pendingSlashCommand: '',
        messages: [...filtered, hintMsg],
      }
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
  }
}
