import type { AgentEvent } from '@superone/shared/agent-types'
import { applySeqToMessage, isReplayedEventForMessage } from '@superone/shared/event-seq-utils'
import { upsertCodexItem } from '../helpers/codex-helpers'
import type { PerSessionState } from '../types'

type CodexEvent = Extract<AgentEvent, { type: 'codex_thread_started' | 'codex_item_delta' }>

export function reduceCodex(session: PerSessionState, event: CodexEvent): Partial<PerSessionState> {
  switch (event.type) {
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
      return {
        lastEventAt: Date.now(),
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
  }
}
