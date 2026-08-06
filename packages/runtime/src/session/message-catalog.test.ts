import { describe, expect, it } from 'vitest'
import { SESSION_DURABLE_EVENT, type EnvironmentEventEnvelope } from '@superone/shared/environment'
import {
  buildSessionMessageCatalog,
  collectToolsByAssistantId,
  pageSessionMessageCatalog,
} from './message-catalog'
import type { NodeSessionRecord } from './types'

function envEvent(
  partial: Partial<EnvironmentEventEnvelope> & {
    eventType: string
    aggregateId: string
    payload: unknown
  },
): EnvironmentEventEnvelope {
  return {
    eventId: partial.eventId ?? 'e1',
    sequence: partial.sequence ?? '1',
    timestamp: partial.timestamp ?? 1,
    aggregateType: partial.aggregateType ?? 'session',
    aggregateId: partial.aggregateId,
    eventType: partial.eventType,
    eventVersion: 1,
    payload: partial.payload,
    environmentId: 'env',
  }
}

describe('message catalog', () => {
  it('pages with end-cursor and densifies tool summaries on assistants', () => {
    const sessionId = 's1'
    const session = {
      sessionId,
      transcript: [
        { id: 'u1', role: 'user' as const, text: 'read me', createdAt: 10 },
        { id: 'a1', role: 'assistant' as const, text: 'done', createdAt: 20 },
        { id: 'u2', role: 'user' as const, text: 'again', createdAt: 30 },
        { id: 'a2', role: 'assistant' as const, text: 'ok', createdAt: 40 },
      ],
      providerResume: 'resume-last',
    } as Pick<NodeSessionRecord, 'sessionId' | 'transcript' | 'providerResume'>

    const events: EnvironmentEventEnvelope[] = [
      envEvent({
        sequence: '1',
        aggregateId: sessionId,
        eventType: SESSION_DURABLE_EVENT.userMessage,
        payload: { blockId: 'u1', text: 'read me' },
      }),
      envEvent({
        sequence: '2',
        aggregateId: sessionId,
        eventType: SESSION_DURABLE_EVENT.turnStarted,
        payload: { status: 'streaming' },
      }),
      envEvent({
        sequence: '3',
        aggregateId: sessionId,
        eventType: SESSION_DURABLE_EVENT.toolStarted,
        payload: {
          toolUseId: 't1',
          toolName: 'Read',
          input: '{"path":"a.md"}',
        },
      }),
      envEvent({
        sequence: '4',
        aggregateId: sessionId,
        eventType: SESSION_DURABLE_EVENT.toolCompleted,
        payload: { toolUseId: 't1', toolName: 'Read', output: 'file contents' },
      }),
      envEvent({
        sequence: '5',
        aggregateId: sessionId,
        eventType: SESSION_DURABLE_EVENT.assistantMessage,
        payload: { blockId: 'a1', text: 'done' },
      }),
      envEvent({
        sequence: '6',
        aggregateId: sessionId,
        eventType: SESSION_DURABLE_EVENT.userMessage,
        payload: { blockId: 'u2', text: 'again' },
      }),
      envEvent({
        sequence: '7',
        aggregateId: sessionId,
        eventType: SESSION_DURABLE_EVENT.assistantMessage,
        payload: { blockId: 'a2', text: 'ok' },
      }),
    ]

    const catalog = buildSessionMessageCatalog(session, events)
    expect(catalog).toHaveLength(4)
    expect(catalog[1]!.tools?.[0]).toMatchObject({
      toolUseId: 't1',
      toolName: 'Read',
      inputSummary: '{"path":"a.md"}',
      outputSummary: 'file contents',
    })
    expect(catalog[3]!.resumePointId).toBe('resume-last')

    const page1 = pageSessionMessageCatalog(sessionId, catalog, { limit: 2 })
    expect(page1.messages.map((m) => m.id)).toEqual(['u2', 'a2'])
    expect(page1.hasMore).toBe(true)
    expect(page1.cursor).toBe('2')

    const page0 = pageSessionMessageCatalog(sessionId, catalog, {
      cursor: page1.cursor,
      limit: 2,
    })
    expect(page0.messages.map((m) => m.id)).toEqual(['u1', 'a1'])
    expect(page0.hasMore).toBe(false)
    expect(page0.cursor).toBeNull()
  })

  it('collectToolsByAssistantId rekeys provisional tools onto assistant block id', () => {
    const map = collectToolsByAssistantId(
      [
        envEvent({
          sequence: '1',
          aggregateId: 's',
          eventType: SESSION_DURABLE_EVENT.turnStarted,
          payload: {},
        }),
        envEvent({
          sequence: '2',
          aggregateId: 's',
          eventType: SESSION_DURABLE_EVENT.toolStarted,
          payload: { toolUseId: 't', toolName: 'Bash', input: 'ls' },
        }),
        envEvent({
          sequence: '3',
          aggregateId: 's',
          eventType: SESSION_DURABLE_EVENT.assistantDelta,
          payload: { blockId: 'asst-1', delta: 'x' },
        }),
        envEvent({
          sequence: '4',
          aggregateId: 's',
          eventType: SESSION_DURABLE_EVENT.toolCompleted,
          payload: { toolUseId: 't', toolName: 'Bash', output: 'ok' },
        }),
      ],
      's',
    )
    expect(map.get('asst-1')?.[0]).toMatchObject({
      toolUseId: 't',
      toolName: 'Bash',
      outputSummary: 'ok',
    })
  })
})
