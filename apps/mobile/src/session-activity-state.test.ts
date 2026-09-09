import { describe, expect, it } from 'vitest'
import type { SessionActivity } from '@superone/shared/session-activity'
import { mergeSessionActivity, sessionActivityIconStatus } from './session-activity-state'

const idle: SessionActivity = { sessionId: 'other', projectPath: '/project', provider: 'codex', status: 'idle', completedMessageId: 'reply-1', pendingCount: 0, pendingReason: { en: null, zh: null } }

describe('unseen session completion', () => {
  it('marks a background run on completion and prioritizes running on the next turn', () => {
    const result = mergeSessionActivity({ ...idle, status: 'streaming' }, idle, 'current', true)
    expect(result.isUnseen).toBe(true)
    expect(sessionActivityIconStatus(result)).toBe('unseen')
    expect(sessionActivityIconStatus({ ...result, status: 'streaming' })).toBe('streaming')
    expect(sessionActivityIconStatus({ ...result, status: 'background' })).toBe('background')
  })
  it('does not mark a completion that the user is viewing', () => {
    expect(mergeSessionActivity({ ...idle, status: 'streaming' }, idle, 'other', true).isUnseen).toBe(false)
  })
  it('does not mark historical sessions on first connect but detects a missed completion on reconnect', () => {
    expect(mergeSessionActivity(undefined, idle, null).isUnseen).toBe(false)
    expect(mergeSessionActivity(idle, { ...idle, completedMessageId: 'reply-2' }, null).isUnseen).toBe(true)
  })
  it('does not re-mark a read completion on duplicate terminal delivery', () => {
    expect(mergeSessionActivity(idle, idle, null, true).isUnseen).toBe(false)
    expect(mergeSessionActivity({ ...idle, status: 'ended' }, idle, null, true).isUnseen).toBe(false)
  })
  it('marks an unopened background session from the terminal push', () => {
    expect(mergeSessionActivity(undefined, idle, null, true).isUnseen).toBe(true)
  })
})
