import type { AgentEvent } from '@superone/shared/agent-types'
import { applyCodexSubagentActivity, mergeCodexTurnProvenance } from '@superone/shared/codex-metadata'
import { applySeqToMessage, isReplayedEventForMessage } from '@superone/shared/event-seq-utils'
import type { ChatCoreSession } from './types'

type MetadataEvent = Extract<AgentEvent, { type: 'codex_turn_metadata' | 'codex_subagent_activity' }>

/** Data only: these events do not append content or change card presentation. */
export function reduceCodexMetadata(session: ChatCoreSession, event: MetadataEvent): Partial<ChatCoreSession> {
  return { messages: session.messages.map(message => {
    if (message.id !== event.messageId || isReplayedEventForMessage(event, message)) return message
    const previous = message.metadata?.codex ?? { threadId: null, usage: null, items: [] }
    let codex = previous
    if (event.type === 'codex_subagent_activity') {
      codex = { ...previous, subagents: applyCodexSubagentActivity(previous.subagents, event.activity) }
    } else {
      const old = previous.threadId && previous.turnId ? { threadId: previous.threadId, turnId: previous.turnId, rootTurnId: previous.rootTurnId } : undefined
      const provenance = mergeCodexTurnProvenance(old, event.provenance)
      const { rootTurnId: _root, requestedProvenance: _requested, ...rest } = previous
      const sameTurn = old?.threadId === provenance.threadId && old.turnId === provenance.turnId
      codex = { ...rest, ...provenance,
        ...(event.requestedProvenance ? { requestedProvenance: event.requestedProvenance } : sameTurn && previous.requestedProvenance ? { requestedProvenance: previous.requestedProvenance } : {}) }
    }
    return { ...message, metadata: { ...message.metadata, codex }, ...applySeqToMessage(event) }
  }) }
}
