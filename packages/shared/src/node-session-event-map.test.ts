import { describe, expect, it } from 'vitest'
import type { EnvironmentEventEnvelope } from './environment/events'
import {
  createNodeSessionEventMapper,
  mapNodeSessionEvents,
} from './node-session-event-map'

function envelope(
  partial: Partial<EnvironmentEventEnvelope> & { eventType: string; payload?: unknown },
): EnvironmentEventEnvelope {
  return {
    eventId: partial.eventId ?? 'e1',
    sequence: partial.sequence ?? '1',
    timestamp: partial.timestamp ?? 1,
    aggregateType: partial.aggregateType ?? 'session',
    aggregateId: partial.aggregateId ?? 'sid-1',
    eventType: partial.eventType,
    eventVersion: partial.eventVersion ?? 1,
    payload: partial.payload ?? {},
    environmentId: partial.environmentId ?? 'env-1',
  }
}

const ctx = {
  projectPath: 'remote:env-1:/work/app',
  sessionId: 'sid-1',
  providerId: 'codex',
  nowIso: () => '2020-01-01T00:00:00.000Z',
}

describe('mapNodeSessionEvents (text-only)', () => {
  it('passes lossless AgentEvents through and suppresses legacy completion duplicates', () => {
    const events = mapNodeSessionEvents(
      [
        envelope({ eventType: 'session.turn_started', payload: { status: 'streaming' } }),
        envelope({
          eventType: 'session.agent_event',
          payload: {
            event: {
              type: 'content_delta',
              messageId: 'a1',
              delta: { type: 'thinking', thinking: 'reasoning' },
              sessionId: 'untrusted',
              seq: 999,
            },
          },
        }),
        envelope({
          eventType: 'session.agent_event',
          payload: { event: { type: 'prompt_suggestion', suggestion: 'continue' } },
        }),
        envelope({
          eventType: 'session.agent_event',
          payload: { event: { type: 'message_complete', messageId: 'a1', metadata: { costUsd: 0.2 } } },
        }),
        envelope({
          eventType: 'session.agent_event',
          payload: { event: { type: 'status_change', status: 'idle' } },
        }),
        envelope({
          eventType: 'session.assistant_message',
          payload: { blockId: 'a1', text: 'done' },
        }),
        envelope({ eventType: 'session.turn_completed', payload: { status: 'idle' } }),
      ],
      ctx,
    )

    expect(events.map((event) => event.type)).toEqual([
      'status_change',
      'message_start',
      'content_delta',
      'prompt_suggestion',
      'message_complete',
      'status_change',
    ])
    expect(events.filter((event) => event.type === 'message_complete')).toHaveLength(1)
    expect(events[2]).toMatchObject({ sessionId: 'sid-1', seq: 1 })
  })

  it('maps a full text turn into user / stream / complete / idle events', () => {
    const events = mapNodeSessionEvents(
      [
        envelope({
          sequence: '1',
          eventType: 'session.user_message',
          payload: { blockId: 'u1', text: 'hello' },
        }),
        envelope({
          sequence: '2',
          eventType: 'session.turn_started',
          payload: { status: 'streaming' },
        }),
        envelope({
          sequence: '3',
          eventType: 'session.assistant_delta',
          payload: { blockId: 'a1', delta: 'Hi' },
        }),
        envelope({
          sequence: '4',
          eventType: 'session.assistant_delta',
          payload: { blockId: 'a1', delta: ' there' },
        }),
        envelope({
          sequence: '5',
          eventType: 'session.assistant_message',
          payload: { blockId: 'a1', text: 'Hi there' },
        }),
        envelope({
          sequence: '6',
          eventType: 'session.turn_completed',
          payload: { status: 'idle' },
        }),
      ],
      ctx,
    )

    expect(events.map((e) => e.type)).toEqual([
      'user_message_appended',
      'status_change',
      'message_start',
      'content_delta',
      'content_delta',
      'message_complete',
      'status_change',
    ])
    expect(events.every((e) => e.sessionId === 'sid-1')).toBe(true)
    expect(events.every((e) => e.projectPath === ctx.projectPath)).toBe(true)

    const start = events.find((e) => e.type === 'message_start')
    expect(start).toMatchObject({
      type: 'message_start',
      message: { id: 'a1', role: 'assistant', status: 'streaming' },
    })
    const deltas = events.filter((e) => e.type === 'content_delta')
    expect(deltas).toEqual([
      expect.objectContaining({
        messageId: 'a1',
        delta: { type: 'text', text: 'Hi' },
      }),
      expect.objectContaining({
        messageId: 'a1',
        delta: { type: 'text', text: ' there' },
      }),
    ])
  })

  it('emits message_start only once per assistant blockId', () => {
    const mapper = createNodeSessionEventMapper(ctx)
    const first = mapper.map(
      envelope({ eventType: 'session.assistant_delta', payload: { blockId: 'a1', delta: 'a' } }),
    )
    const second = mapper.map(
      envelope({ eventType: 'session.assistant_delta', payload: { blockId: 'a1', delta: 'b' } }),
    )
    expect(first.map((e) => e.type)).toEqual(['message_start', 'content_delta'])
    expect(second.map((e) => e.type)).toEqual(['content_delta'])
    expect(mapper.currentAssistantMessageId()).toBe('a1')
  })

  it('tolerates empty delta and missing payload fields without throwing', () => {
    const events = mapNodeSessionEvents(
      [
        envelope({ eventType: 'session.assistant_delta', payload: { blockId: 'a1' } }),
        envelope({ eventType: 'session.assistant_delta', payload: null }),
        envelope({ eventType: 'session.user_message', payload: {} }),
        envelope({ eventType: 'session.turn_error', payload: {} }),
      ],
      ctx,
    )
    expect(events.some((e) => e.type === 'message_start')).toBe(true)
    expect(events.some((e) => e.type === 'content_delta')).toBe(false)
    expect(events.some((e) => e.type === 'user_message_appended')).toBe(true)
    expect(events.some((e) => e.type === 'status_change' && e.status === 'error')).toBe(true)
  })

  it('ignores other sessions and non-session aggregates', () => {
    const events = mapNodeSessionEvents(
      [
        envelope({
          aggregateId: 'other-sid',
          eventType: 'session.assistant_delta',
          payload: { blockId: 'a1', delta: 'x' },
        }),
        envelope({
          aggregateType: 'terminal',
          aggregateId: 'sid-1',
          eventType: 'session.assistant_delta',
          payload: { blockId: 'a1', delta: 'x' },
        }),
      ],
      ctx,
    )
    expect(events).toEqual([])
  })

  it('maps permission request/response and renames', () => {
    const events = mapNodeSessionEvents(
      [
        envelope({
          eventType: 'session.permission_requested',
          payload: { interactionId: 'p1', toolName: 'Bash', input: { command: 'ls' } },
        }),
        envelope({
          eventType: 'session.permission_responded',
          payload: { interactionId: 'p1', decision: 'allow' },
        }),
        envelope({
          eventType: 'session.renamed',
          payload: { title: 'New title' },
        }),
      ],
      ctx,
    )
    expect(events).toEqual([
      expect.objectContaining({
        type: 'permission_request',
        request: expect.objectContaining({
          requestId: 'p1',
          toolName: 'Bash',
        }),
      }),
      expect.objectContaining({
        type: 'interaction_resolved',
        interactionType: 'permission',
        requestId: 'p1',
        approved: true,
      }),
      expect.objectContaining({
        type: 'session_title_changed',
        title: 'New title',
        sessionId: 'sid-1',
      }),
    ])
  })

  it('maps question and plan durable events into ask_user_question / plan_approval', () => {
    const events = mapNodeSessionEvents(
      [
        envelope({
          eventType: 'session.question_requested',
          payload: {
            interactionId: 'q1',
            kind: 'question',
            input: {
              questions: [{ question: 'Ship it?', header: 'Confirm', options: [{ label: 'Yes' }] }],
            },
          },
        }),
        envelope({
          eventType: 'session.question_responded',
          payload: { interactionId: 'q1', answers: { 'Ship it?': 'Yes' } },
        }),
        envelope({
          eventType: 'session.plan_requested',
          payload: {
            interactionId: 'pl1',
            kind: 'plan',
            input: { plan: 'Do the work' },
          },
        }),
        envelope({
          eventType: 'session.plan_responded',
          payload: { interactionId: 'pl1', decision: 'approve' },
        }),
      ],
      ctx,
    )
    expect(events).toEqual([
      expect.objectContaining({
        type: 'ask_user_question',
        request: expect.objectContaining({
          requestId: 'q1',
          questions: expect.arrayContaining([
            expect.objectContaining({ question: 'Ship it?' }),
          ]),
        }),
      }),
      expect.objectContaining({
        type: 'interaction_resolved',
        interactionType: 'question',
        requestId: 'q1',
      }),
      expect.objectContaining({
        type: 'plan_approval',
        request: expect.objectContaining({
          requestId: 'pl1',
          planContent: 'Do the work',
        }),
      }),
      expect.objectContaining({
        type: 'interaction_resolved',
        interactionType: 'plan_approval',
        requestId: 'pl1',
        approved: true,
      }),
    ])
  })

  it('maps SESSION_DURABLE_EVENT tool lifecycle into tool_use / tool_result', () => {
    const events = mapNodeSessionEvents(
      [
        envelope({
          sequence: '1',
          eventType: 'session.assistant_delta',
          payload: { blockId: 'a1', delta: 'working' },
        }),
        envelope({
          sequence: '2',
          eventType: 'session.tool_started',
          payload: { toolUseId: 't1', toolName: 'Read', input: '{"path":"/x"}' },
        }),
        envelope({
          sequence: '3',
          eventType: 'session.tool_input_delta',
          payload: { toolUseId: 't1', toolName: 'Read', inputDelta: '{"path":' },
        }),
        envelope({
          sequence: '4',
          eventType: 'session.tool_completed',
          payload: { toolUseId: 't1', toolName: 'Read', output: 'ok' },
        }),
      ],
      ctx,
    )
    expect(events.map((e) => e.type)).toEqual([
      'message_start',
      'content_delta',
      'content_delta',
      'tool_input_delta',
      'content_delta',
      'content_delta',
    ])
    expect(events[2]).toMatchObject({
      type: 'content_delta',
      messageId: 'a1',
      delta: { type: 'tool_use', toolUseId: 't1', toolName: 'Read', status: 'streaming' },
    })
    expect(events[4]).toMatchObject({
      delta: { type: 'tool_use', toolUseId: 't1', status: 'complete' },
    })
    expect(events[5]).toMatchObject({
      type: 'content_delta',
      messageId: 'a1',
      delta: { type: 'tool_result', toolUseId: 't1', summary: 'ok' },
    })
  })

  it('keeps tool-before-text Claude stream on one sticky assistant message', () => {
    const events = mapNodeSessionEvents(
      [
        envelope({
          sequence: '1',
          eventType: 'session.tool_started',
          payload: { toolUseId: 't1', toolName: 'Bash', input: {} },
        }),
        envelope({
          sequence: '2',
          eventType: 'session.tool_input_delta',
          payload: { toolUseId: 't1', toolName: 'Bash', inputDelta: '{"cmd":"ls"}' },
        }),
        envelope({
          sequence: '3',
          eventType: 'session.assistant_delta',
          payload: { blockId: 'print-block-0', delta: 'done' },
        }),
        envelope({
          sequence: '4',
          eventType: 'session.tool_completed',
          payload: { toolUseId: 't1', toolName: 'Bash', output: 'file.txt' },
        }),
      ],
      ctx,
    )
    const messageIds = events
      .filter((e) => 'messageId' in e || e.type === 'message_start')
      .map((e) =>
        e.type === 'message_start' ? e.message.id : (e as { messageId: string }).messageId,
      )
    // All turn content shares the first opened assistant message id.
    expect(new Set(messageIds).size).toBe(1)
    expect(events.some((e) => e.type === 'content_delta' && e.delta.type === 'tool_use')).toBe(true)
    expect(events.some((e) => e.type === 'tool_input_delta')).toBe(true)
    expect(
      events.some((e) => e.type === 'content_delta' && e.delta.type === 'text' && e.delta.text === 'done'),
    ).toBe(true)
  })

  it('maps status_changed and assistant_text snapshot without doubling deltas', () => {
    const events = mapNodeSessionEvents(
      [
        envelope({
          eventType: 'session.status_changed',
          payload: { status: 'streaming' },
        }),
        envelope({
          eventType: 'session.assistant_text',
          payload: { blockId: 'a1', text: 'snapshot only' },
        }),
        envelope({
          eventType: 'session.assistant_delta',
          payload: { blockId: 'a1', delta: ' more' },
        }),
        envelope({
          eventType: 'session.assistant_text',
          payload: { blockId: 'a1', text: 'snapshot only more' },
        }),
      ],
      ctx,
    )
    expect(events.map((e) => e.type)).toEqual([
      'status_change',
      'message_start',
      'content_delta',
      'content_delta',
    ])
    expect(events[2]).toMatchObject({ delta: { type: 'text', text: 'snapshot only' } })
    expect(events[3]).toMatchObject({ delta: { type: 'text', text: ' more' } })
  })

  it('tolerates unknown event types as no-ops', () => {
    const events = mapNodeSessionEvents(
      [
        envelope({
          eventType: 'session.tool_use',
          payload: { toolName: 'Read', input: { path: '/x' } },
        }),
        envelope({ eventType: 'session.created', payload: {} }),
      ],
      ctx,
    )
    expect(events).toEqual([])
  })

  it('maps interrupt and error against the current assistant message', () => {
    const mapper = createNodeSessionEventMapper(ctx)
    mapper.map(
      envelope({ eventType: 'session.assistant_delta', payload: { blockId: 'a9', delta: 'partial' } }),
    )
    const interrupted = mapper.map(
      envelope({ eventType: 'session.turn_interrupted', payload: { reason: 'client_interrupt' } }),
    )
    expect(interrupted.map((e) => e.type)).toEqual(['message_interrupted', 'status_change'])
    expect(interrupted[0]).toMatchObject({ type: 'message_interrupted', messageId: 'a9' })

    const mapper2 = createNodeSessionEventMapper(ctx)
    mapper2.map(
      envelope({ eventType: 'session.assistant_delta', payload: { blockId: 'a2', delta: 'x' } }),
    )
    const errored = mapper2.map(
      envelope({ eventType: 'session.turn_error', payload: { message: 'boom' } }),
    )
    expect(errored).toEqual([
      expect.objectContaining({ type: 'message_error', messageId: 'a2', error: 'boom' }),
      expect.objectContaining({ type: 'status_change', status: 'error' }),
    ])
  })

  it('surfaces a turn error that arrives before any assistant content', () => {
    // Node runner failures at process start (e.g. the harness binary exits
    // during spawn) emit turn_started → turn_error with nothing in between.
    // Without an assistant block the error text must still reach the UI.
    const events = mapNodeSessionEvents(
      [
        envelope({ eventType: 'session.user_message', payload: { blockId: 'u1', text: 'hi' } }),
        envelope({ eventType: 'session.turn_started', payload: { status: 'streaming' } }),
        envelope({
          eventType: 'session.turn_error',
          payload: { message: 'Claude Code process exited with code 1' },
        }),
      ],
      ctx,
    )
    expect(events.map((e) => e.type)).toEqual([
      'user_message_appended',
      'status_change',
      'message_start',
      'message_error',
      'status_change',
    ])
    expect(events[3]).toMatchObject({
      type: 'message_error',
      error: 'Claude Code process exited with code 1',
    })
    expect(events.at(-1)).toMatchObject({ type: 'status_change', status: 'error' })
  })

  it('falls back to a generic message when a bare turn error has no assistant block', () => {
    const events = mapNodeSessionEvents(
      [envelope({ eventType: 'session.turn_error', payload: {} })],
      ctx,
    )
    expect(events.map((e) => e.type)).toEqual(['message_start', 'message_error', 'status_change'])
    expect(events[1]).toMatchObject({ type: 'message_error', error: 'remote turn failed' })
  })
})
