import { describe, expect, it } from 'vitest'
import type { SessionActivity } from '@superone/shared/session-activity'
import { completionSeen, countAttentionSessions, mergeSessionActivity, projectHasAttention, sessionActivityIconStatus } from './session-activity-state'

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
  it('on a cold start, trusts the host receipt to tell an unread completion from history', () => {
    // Nothing read anywhere yet: a run finished while the phone was away.
    expect(mergeSessionActivity(undefined, { ...idle, seenCompletedMessageId: null }, null).isUnseen).toBe(true)
    expect(mergeSessionActivity(undefined, { ...idle, seenCompletedMessageId: 'reply-0' }, null).isUnseen).toBe(true)
    // Read on desktop, or restored history the host counts as read.
    expect(mergeSessionActivity(undefined, { ...idle, seenCompletedMessageId: 'reply-1' }, null).isUnseen).toBe(false)
    // Still running, never finished, or on screen here.
    expect(mergeSessionActivity(undefined, { ...idle, status: 'streaming', seenCompletedMessageId: null }, null).isUnseen).toBe(false)
    expect(mergeSessionActivity(undefined, { ...idle, completedMessageId: null, seenCompletedMessageId: null }, null).isUnseen).toBe(false)
    expect(mergeSessionActivity(undefined, { ...idle, seenCompletedMessageId: null }, 'other').isUnseen).toBe(false)
  })
  it('does not re-mark a read completion on duplicate terminal delivery', () => {
    expect(mergeSessionActivity(idle, idle, null, true).isUnseen).toBe(false)
    expect(mergeSessionActivity({ ...idle, status: 'ended' }, idle, null, true).isUnseen).toBe(false)
  })
  it('marks an unopened background session from the terminal push', () => {
    expect(mergeSessionActivity(undefined, idle, null, true).isUnseen).toBe(true)
  })
  it('clears a completion the host recorded as read elsewhere, and keeps one read before the latest reply', () => {
    const unread = mergeSessionActivity({ ...idle, status: 'streaming' }, idle, 'current', true)
    expect(mergeSessionActivity(unread, { ...idle, seenCompletedMessageId: 'reply-1' }, 'current').isUnseen).toBe(false)
    expect(mergeSessionActivity(unread, { ...idle, completedMessageId: 'reply-2', seenCompletedMessageId: 'reply-1' }, 'current').isUnseen).toBe(true)
    expect(completionSeen({ completedMessageId: 'reply-1', seenCompletedMessageId: 'reply-1' })).toBe(true)
    expect(completionSeen({ completedMessageId: 'reply-1' })).toBe(false)
  })
  it('keeps the local unread flag on a host without seen tracking', () => {
    expect(mergeSessionActivity({ ...idle, status: 'streaming' }, idle, 'current', true).isUnseen).toBe(true)
  })
})

describe('projectHasAttention', () => {
  it('is true when a session in that project is live, pending or unseen', () => {
    const pending = { ...idle, sessionId: 'ask', projectPath: '/repo', pendingCount: 1 }
    expect(projectHasAttention({ ask: pending }, '/repo')).toBe(true)
    expect(projectHasAttention({ ask: pending }, '/other')).toBe(false)
    expect(projectHasAttention({ other: { ...idle, isUnseen: true } }, '/project')).toBe(true)
    expect(projectHasAttention({ other: { ...idle, status: 'streaming' } }, '/project')).toBe(true)
    expect(projectHasAttention({ other: { ...idle, realtimeActive: true } }, '/project')).toBe(true)
    expect(projectHasAttention({ other: idle }, '/project')).toBe(false)
  })
})

describe('countAttentionSessions', () => {
  it('counts pending and unseen, not a running turn the user is not needed for', () => {
    expect(countAttentionSessions({
      ask: { ...idle, sessionId: 'ask', pendingCount: 1 },
      unread: { ...idle, sessionId: 'unread', isUnseen: true },
      running: { ...idle, sessionId: 'running', status: 'streaming' },
    })).toBe(2)
  })
})
