import type { AgentEvent, CodexItemPatch, CodexThreadItem } from '@superone/shared/agent-types'
import { applySeqToMessage, isReplayedEventForMessage } from '@superone/shared/event-seq-utils'
import { codexTodoListFromItem } from '../helpers/codex-todo'
import { upsertCodexItem } from '../helpers/codex-helpers'
import type { PerSessionState } from '../types'

type CodexEvent = Extract<AgentEvent, { type: 'codex_thread_started' | 'codex_item_delta' | 'codex_item_patch' | 'codex_mcp_startup' }>

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

export function reduceCodex(session: PerSessionState, event: CodexEvent): Partial<PerSessionState> {
  switch (event.type) {
    case 'codex_mcp_startup': {
      return {
        lastEventAt: Date.now(),
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
      const todoUpdate = codexTodoListFromItem(event.item)
      return {
        lastEventAt: Date.now(),
        ...(todoUpdate !== undefined ? { _latestCodexTodoList: todoUpdate } : {}),
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

    case 'codex_item_patch': {
      const target = session.messages.find((m) => m.id === event.messageId)
      if (!target || isReplayedEventForMessage(event, target)) {
        return { lastEventAt: Date.now() }
      }
      const prevCodex = target.metadata?.codex
      const itemIndex = prevCodex?.items.findIndex((item) => item.id === event.itemId) ?? -1
      if (!prevCodex || itemIndex < 0) return { lastEventAt: Date.now() }
      const nextItem = applyCodexItemPatch(prevCodex.items[itemIndex], event.patch)
      if (!nextItem) return { lastEventAt: Date.now() }
      const nextItems = [...prevCodex.items]
      nextItems[itemIndex] = nextItem
      return {
        lastEventAt: Date.now(),
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
