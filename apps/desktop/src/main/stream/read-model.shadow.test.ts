/**
 * Shadow comparison: the node read model (log → streaming ring → event mapper
 * → chat reducer) must show what a client reducing every event directly shows,
 * on the recorded desktop sessions.
 */
import { describe, expect, it } from 'vitest'
import { openNodeDatabase } from '@superone/runtime/db'
import { EventLog, SessionReadModel, type NodeSessionRecord } from '@superone/runtime/session'
import { applyEventToSession, createDefaultChatCoreSession, createStreamingToolInputStore, type ChatCorePorts } from '@superone/chat-core'
import type { AgentEvent, ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { SESSION_DURABLE_EVENT } from '@superone/shared/environment'
import recordings from './fixtures/emitted.generated.json'

const ports = (): ChatCorePorts => ({ now: () => 0, id: (prefix) => `${prefix}id`, streaming: createStreamingToolInputStore() })

/** What a reader compares: ids, roles, ordered blocks, completion metadata. */
function project(messages: ChatMessage[]) {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    blocks: message.content.map((block: ContentBlock) => {
      const b = block as Record<string, unknown>
      return { type: b.type, text: b.text ?? b.thinking, toolName: b.toolName, input: b.input, summary: b.summary, status: b.status }
    }),
    usage: message.metadata?.usage,
    cost: message.metadata?.costUsd,
  }))
}

describe('read model shadow comparison', () => {
  for (const recording of recordings as Array<{ recording: string; events: AgentEvent[] }>) {
    it(`matches direct reduction on ${recording.recording}`, () => {
      // A recording is one session's backend events; it also holds the odd non-event row.
      const sessionId = 'recorded'
      const events = recording.events.filter((event) => typeof event.type === 'string')

      let direct = createDefaultChatCoreSession()
      const directPorts = ports()
      for (const event of events) direct = { ...direct, ...applyEventToSession(direct, event, directPorts) }

      const db = openNodeDatabase(':memory:')
      const log = new EventLog(db, 'env')
      const record = { sessionId, harnessId: 'claude', transcript: [], status: 'idle', pendingInteraction: null } as unknown as NodeSessionRecord
      const model = new SessionReadModel(db, log, { get: () => record })
      log.setApplier((envelope) => model.apply(envelope))
      for (const event of events) {
        const { sessionId: _sid, projectPath: _pp, seq: _seq, epoch: _epoch, ...rest } = event as AgentEvent & { seq?: number; epoch?: number }
        log.appendSession({ sessionId, eventType: SESSION_DURABLE_EVENT.agentEvent, payload: { event: rest } })
      }

      expect(direct.messages.some((message) => message.role === 'assistant' && message.content.length > 0)).toBe(true)
      expect(project(model.messages(sessionId))).toEqual(project(direct.messages))
      expect(log.streaming().length).toBeLessThanOrEqual(events.length)
      db.close()
    })
  }
})
