import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { SessionActivity } from '@superone/shared/session-activity'
import { createDefaultPerSessionState, createDefaultProjectState } from '../defaults'
import type { ChatStore, PerSessionState } from '../types'
import { applySessionActivity } from './session-activity'

const B = 'remote:conn-b:/work/app'

function store(sessions: Record<string, Partial<PerSessionState>> = {}, options: { active?: string; activeProject?: string } = {}) {
  return {
    activeProject: options.activeProject ?? '/local',
    projectSessions: {
      [B]: {
        ...createDefaultProjectState(),
        _activeSessionId: options.active ?? null,
        _sessions: Object.fromEntries(Object.entries(sessions).map(([id, patch]) => [id, { ...createDefaultPerSessionState(), ...patch }])),
      },
    },
  } as unknown as ChatStore
}

function activity(patch: Partial<SessionActivity>, completed?: boolean): Extract<AgentEvent, { type: 'session_activity' }> {
  return {
    type: 'session_activity',
    activity: { sessionId: 's1', projectPath: B, status: 'idle', provider: 'claude', pendingCount: 0, pendingReason: { en: null, zh: null }, ...patch },
    ...(completed ? { completed } : {}),
  }
}

const apply = (state: ChatStore, event: ReturnType<typeof activity>): ChatStore => ({ ...state, ...applySessionActivity(state, event) }) as ChatStore
const projectOf = (state: ChatStore) => state.projectSessions[B]

describe('session activity from a paired machine', () => {
  it("shows a session B's window runs as running, then unread once it finishes", () => {
    const running = apply(store(), activity({ status: 'streaming' }))
    expect(projectOf(running)._sessions.s1).toMatchObject({ status: 'streaming', _historyHydrated: false, messages: [] })

    const finished = apply(running, activity({ status: 'idle', completedMessageId: 'm1', seenCompletedMessageId: null }, true))
    expect(projectOf(finished)._sessions.s1.status).toBe('idle')
    expect(projectOf(finished).unseenCompletedSessions.has('s1')).toBe(true)

    // Read on B or a phone: the host echoes the receipt and the dot clears here too.
    const read = apply(finished, activity({ status: 'idle', completedMessageId: 'm1', seenCompletedMessageId: 'm1' }))
    expect(projectOf(read).unseenCompletedSessions.has('s1')).toBe(false)
  })

  it('creates no entry for an idle session it has not seen, and no change when nothing moved', () => {
    const state = store()
    expect(applySessionActivity(state, activity({ status: 'idle' }))).toEqual({})
    const running = apply(state, activity({ status: 'streaming' }))
    expect(applySessionActivity(running, activity({ status: 'streaming' }))).toEqual({})
  })

  it("leaves a followed session's status to its own events and marks no dot on the session being viewed", () => {
    const followed = store({ s1: { status: 'streaming', _historyHydrated: true } }, { active: 's1', activeProject: B })
    expect(applySessionActivity(followed, activity({ status: 'idle', completedMessageId: 'm1' }, true))).toEqual({})
  })

  it('brands an unhydrated placeholder with the host harness and ACP agent', () => {
    const running = apply(store(), activity({ status: 'streaming', provider: 'acp-grok', acpAgentId: 'grok-build' }))
    expect(projectOf(running)._sessions.s1).toMatchObject({
      status: 'streaming',
      sessionProvider: 'acp-grok',
      preferredProvider: 'acp-grok',
      acpAgentId: 'grok-build',
      _historyHydrated: false,
    })
    const cursor = apply(store(), activity({ status: 'streaming', provider: 'cursor' }))
    expect(projectOf(cursor)._sessions.s1).toMatchObject({ sessionProvider: 'cursor', preferredProvider: 'cursor' })
  })

  it('does not clear an ACP agent when the activity names none', () => {
    const state = store({ s1: { status: 'idle', _historyHydrated: false, sessionProvider: 'acp-grok', acpAgentId: 'grok-build' } })
    const next = apply(state, activity({ status: 'streaming', provider: 'acp-grok', acpAgentId: null }))
    expect(projectOf(next)._sessions.s1).toMatchObject({ status: 'streaming', sessionProvider: 'acp-grok', acpAgentId: 'grok-build' })
  })

  it('keeps the title and spawn parent without loading a remote transcript', () => {
    const next = apply(store(), activity({ status: 'streaming', title: 'Run checks', parentSessionId: 'parent' }))
    expect(projectOf(next)._sessions.s1).toMatchObject({
      status: 'streaming', _title: 'Run checks', _parentSessionId: 'parent',
      _historyHydrated: false, messages: [],
    })
  })

  it('accepts late title and parent metadata even when the status stays the same', () => {
    const running = apply(store(), activity({ status: 'streaming' }))
    const named = apply(running, activity({ status: 'streaming', title: 'Run checks', parentSessionId: 'parent' }))
    expect(projectOf(named)._sessions.s1).toMatchObject({ _title: 'Run checks', _parentSessionId: 'parent' })
    expect(applySessionActivity(named, activity({ status: 'streaming', title: 'Run checks', parentSessionId: 'parent' }))).toEqual({})

    // Older nodes omit these fields. An omitted value must not erase a relationship.
    const older = apply(named, activity({ status: 'background' }))
    expect(projectOf(older)._sessions.s1).toMatchObject({ _title: 'Run checks', _parentSessionId: 'parent' })
  })

  it('leaves hydrated metadata to the session events', () => {
    const followed = store({ s1: { status: 'streaming', _historyHydrated: true, _title: 'Current', _parentSessionId: 'current-parent' } })
    expect(applySessionActivity(followed, activity({ status: 'idle', title: 'Stale', parentSessionId: 'old-parent' }))).toEqual({})
  })
})
