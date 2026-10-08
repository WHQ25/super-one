import { describe, expect, it } from 'vitest'
import { stampCompletedAt } from './message-completed-at'

const at = '2026-10-08T05:00:00.000Z'

describe('stampCompletedAt', () => {
  it('stamps every terminal message event', () => {
    expect(stampCompletedAt({ type: 'message_complete', messageId: 'a1', metadata: { costUsd: 1 } }, at))
      .toEqual({ type: 'message_complete', messageId: 'a1', metadata: { costUsd: 1, completedAt: at } })
    expect(stampCompletedAt({ type: 'message_interrupted', messageId: 'a1' }, at))
      .toEqual({ type: 'message_interrupted', messageId: 'a1', metadata: { completedAt: at } })
    expect(stampCompletedAt({ type: 'message_error', messageId: 'a1', error: 'boom' }, at))
      .toEqual({ type: 'message_error', messageId: 'a1', error: 'boom', metadata: { completedAt: at } })
  })

  it('keeps a time the event already carries', () => {
    const event = { type: 'message_complete' as const, messageId: 'a1', metadata: { completedAt: '2026-01-01T00:00:00.000Z' } }
    expect(stampCompletedAt(event, at)).toBe(event)
  })

  it('leaves other events alone', () => {
    const event = { type: 'status_change' as const, status: 'idle' as const }
    expect(stampCompletedAt(event, at)).toBe(event)
  })
})
