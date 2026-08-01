import { describe, expect, it } from 'vitest'
import {
  isSessionDurableEventType,
  isSessionTurnEvent,
  projectSessionTurnEvent,
  SESSION_DURABLE_EVENT,
  type SessionTurnEvent,
} from './session-events'

describe('projectSessionTurnEvent', () => {
  it('projects text delta and final snapshot', () => {
    const deltaOnly: SessionTurnEvent = {
      kind: 'text',
      blockId: 'b1',
      delta: 'Hello',
    }
    expect(projectSessionTurnEvent(deltaOnly)).toEqual([
      {
        eventType: SESSION_DURABLE_EVENT.assistantDelta,
        payload: { blockId: 'b1', delta: 'Hello' },
      },
    ])

    const final: SessionTurnEvent = {
      kind: 'text',
      blockId: 'b1',
      final: true,
      text: 'Hello world',
    }
    expect(projectSessionTurnEvent(final)).toEqual([
      {
        eventType: SESSION_DURABLE_EVENT.assistantText,
        payload: { blockId: 'b1', text: 'Hello world' },
      },
    ])
  })

  it('projects tool lifecycle phases', () => {
    const started = projectSessionTurnEvent({
      kind: 'tool',
      phase: 'started',
      toolUseId: 't1',
      toolName: 'Bash',
      input: '{"command":"ls"}',
    })
    expect(started[0]?.eventType).toBe(SESSION_DURABLE_EVENT.toolStarted)

    const inputDelta = projectSessionTurnEvent({
      kind: 'tool',
      phase: 'input_delta',
      toolUseId: 't1',
      toolName: 'Bash',
      input: '{"command":"ls -la"}',
    })
    expect(inputDelta[0]?.eventType).toBe(SESSION_DURABLE_EVENT.toolInputDelta)

    const completed = projectSessionTurnEvent({
      kind: 'tool',
      phase: 'completed',
      toolUseId: 't1',
      toolName: 'Bash',
      output: 'ok',
    })
    expect(completed[0]?.eventType).toBe(SESSION_DURABLE_EVENT.toolCompleted)

    const failed = projectSessionTurnEvent({
      kind: 'tool',
      phase: 'failed',
      toolUseId: 't1',
      toolName: 'Bash',
      output: 'exit 1',
    })
    expect(failed[0]?.eventType).toBe(SESSION_DURABLE_EVENT.toolFailed)
  })

  it('skips empty tool input_delta', () => {
    expect(
      projectSessionTurnEvent({
        kind: 'tool',
        phase: 'input_delta',
        toolUseId: 't1',
        toolName: 'Bash',
      }),
    ).toEqual([])
  })

  it('projects permission and status', () => {
    const perm = projectSessionTurnEvent({
      kind: 'permission',
      phase: 'requested',
      interactionId: 'i1',
      toolName: 'shell',
    })
    expect(perm[0]?.eventType).toBe(SESSION_DURABLE_EVENT.permissionRequested)

    const status = projectSessionTurnEvent({
      kind: 'status',
      status: 'streaming',
      message: 'thinking',
    })
    expect(status).toEqual([
      {
        eventType: SESSION_DURABLE_EVENT.statusChanged,
        payload: { status: 'streaming', message: 'thinking' },
      },
    ])
  })
})

describe('session event guards', () => {
  it('isSessionTurnEvent', () => {
    expect(isSessionTurnEvent({ kind: 'text', blockId: 'b' })).toBe(true)
    expect(isSessionTurnEvent({ kind: 'nope' })).toBe(false)
    expect(isSessionTurnEvent(null)).toBe(false)
  })

  it('isSessionDurableEventType', () => {
    expect(isSessionDurableEventType(SESSION_DURABLE_EVENT.toolStarted)).toBe(true)
    expect(isSessionDurableEventType('session.unknown')).toBe(false)
  })
})
