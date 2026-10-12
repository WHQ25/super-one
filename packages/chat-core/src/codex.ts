import type { AgentEvent, CodexAgentMessageItem } from '@superone/shared/agent-types'
import { applySeqToMessage, isReplayedEventForMessage } from '@superone/shared/event-seq-utils'
import { codexAsyncAnswerId, codexAsyncQuestionQueue, codexAsyncQuestionRequest, type PendingCodexAsyncQuestion } from '@superone/shared/codex-async-question'
import type { ChatCoreSession } from './types'
import { defaultChatCorePorts, type ChatCorePorts } from './ports'

type CodexEvent = Extract<AgentEvent, {
  type:
    | 'codex_thread_started'
    | 'codex_mcp_startup'
    | 'codex_plan_approval'
}>

export function reduceCodex(
  session: ChatCoreSession,
  event: CodexEvent,
  ports: ChatCorePorts = defaultChatCorePorts,
): Partial<ChatCoreSession> {
  switch (event.type) {
    case 'codex_plan_approval':
      return {
        lastEventAt: ports.now(),
        messages: session.messages.map((message) => {
          if (message.id !== event.messageId) return message
          const codex = message.metadata?.codex
          if (!codex) return message
          return {
            ...message,
            metadata: {
              ...message.metadata,
              codex: {
                ...codex,
                planApproval: {
                  status: event.status,
                  ...(event.feedback ? { feedback: event.feedback } : {}),
                },
              },
            },
          }
        }),
      }
    case 'codex_mcp_startup': {
      return {
        lastEventAt: ports.now(),
        messages: session.messages.map((msg) => {
          if (msg.id !== event.messageId) return msg
          const prevCodex = msg.metadata?.codex ?? { threadId: null, usage: null, items: [] }
          return {
            ...msg,
            metadata: { ...msg.metadata, codex: { ...prevCodex, mcpStartup: event.servers } },
          }
        }),
      }
    }

    case 'codex_thread_started': {
      const target = session.messages.find((m) => m.id === event.messageId)
      if (target && isReplayedEventForMessage(event, target)) {
        return { lastEventAt: ports.now() }
      }
      return {
        lastEventAt: ports.now(),
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
  }
}

/** The decision queue with a turn's async question added or refreshed, or null when it asks none still open. */
export function queuedAsyncQuestion(session: ChatCoreSession, messageId: string, item: CodexAgentMessageItem): PendingCodexAsyncQuestion[] | null {
  if (!item.questions?.length || session.messages.some(message => message.id === codexAsyncAnswerId(item.id))) return null
  const question = { messageId, item, request: codexAsyncQuestionRequest(item) }
  const queue = codexAsyncQuestionQueue(session)
  const index = queue.findIndex(q => q.item.id === item.id)
  return index < 0 ? [...queue, question] : queue.map((q, i) => i === index ? question : q)
}
