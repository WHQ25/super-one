import type { AgentEvent, CodexItemPatch, CodexThreadItem } from '@superone/shared/agent-types'
import { applySeqToMessage, isReplayedEventForMessage } from '@superone/shared/event-seq-utils'
import { codexTodoListFromItem } from './helpers'
import { upsertCodexItem } from './codex-pure'
import { codexAsyncAnswerId, codexAsyncQuestionQueue, codexAsyncQuestionRequest } from '@superone/shared/codex-async-question'
import { collectCodexCollabMetadata, mergeCodexSubagentMetadata } from '@superone/shared/codex-metadata'
import type { ChatCoreSession } from './types'
import { defaultChatCorePorts, type ChatCorePorts } from './ports'

type CodexEvent = Extract<AgentEvent, {
  type:
    | 'codex_thread_started'
    | 'codex_item_delta'
    | 'codex_item_patch'
    | 'codex_mcp_startup'
    | 'codex_plan_approval'
}>

function applyCodexItemPatch(item: CodexThreadItem, patch: CodexItemPatch): CodexThreadItem | null {
  switch (item.type) {
    case 'agent_message':
    case 'plan':
    case 'review': {
      if (patch.type !== item.type) return null
      return { ...item, text: item.text + patch.textDelta }
    }
    case 'reasoning': {
      if (patch.type !== 'reasoning') return null
      return {
        ...item,
        text: item.text + patch.textDelta,
        startedAt: patch.startedAt,
        endedAt: patch.endedAt,
      }
    }
    case 'command_execution': {
      if (patch.type !== 'command_execution') return null
      return {
        ...item,
        aggregatedOutput: item.aggregatedOutput + patch.aggregatedOutputDelta,
      }
    }
    default:
      return null
  }
}

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

    case 'codex_item_delta': {
      const target = session.messages.find((m) => m.id === event.messageId)
      if (target && isReplayedEventForMessage(event, target)) {
        return { lastEventAt: ports.now() }
      }
      const todoUpdate = codexTodoListFromItem(event.item)
      const question = event.item.type === 'agent_message' && event.item.questions?.length
        && !session.messages.some(message => message.id === codexAsyncAnswerId(event.item.id))
        ? { messageId: event.messageId, item: event.item, request: codexAsyncQuestionRequest(event.item) } : null
      const pendingAsyncQuestions = question ? codexAsyncQuestionQueue(session) : []
      const index = question ? pendingAsyncQuestions.findIndex(q => q.item.id === question.item.id) : -1
      return {
        lastEventAt: ports.now(),
        ...(question ? { pendingAsyncQuestions: index < 0 ? [...pendingAsyncQuestions, question] : pendingAsyncQuestions.map((q, i) => i === index ? question : q) } : {}),
        ...(todoUpdate !== undefined ? { _latestCodexTodoList: todoUpdate } : {}),
        messages: session.messages.map((msg) => {
          if (msg.id !== event.messageId) return msg
          const prevCodex = msg.metadata?.codex ?? { threadId: null, usage: null, items: [] }
          const nextItems = upsertCodexItem(prevCodex.items, event.item)
          const subagents = collectCodexCollabMetadata([event.item], mergeCodexSubagentMetadata(prevCodex.subagents, event.subagents))
          return {
            ...msg,
            metadata: {
              ...msg.metadata,
              codex: {
                ...prevCodex,
                items: nextItems,
                ...(subagents ? { subagents } : {}),
              },
            },
            ...applySeqToMessage(event),
          }
        }),
      }
    }

    case 'codex_item_patch': {
      const target = session.messages.find((m) => m.id === event.messageId)
      if (!target || isReplayedEventForMessage(event, target)) {
        return { lastEventAt: ports.now() }
      }
      const prevCodex = target.metadata?.codex
      const itemIndex = prevCodex?.items.findIndex((item) => item.id === event.itemId) ?? -1
      if (!prevCodex || itemIndex < 0) return { lastEventAt: ports.now() }
      const nextItem = applyCodexItemPatch(prevCodex.items[itemIndex], event.patch)
      if (!nextItem) return { lastEventAt: ports.now() }
      const nextItems = [...prevCodex.items]
      nextItems[itemIndex] = nextItem
      return {
        lastEventAt: ports.now(),
        messages: session.messages.map((msg) => {
          if (msg !== target) return msg
          return {
            ...msg,
            metadata: {
              ...msg.metadata,
              codex: { ...prevCodex, items: nextItems },
            },
            ...applySeqToMessage(event),
          }
        }),
      }
    }
  }
}
