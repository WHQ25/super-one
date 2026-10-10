import { describe, expect, it } from 'vitest'
import { LocalTopicRecovery } from './topic-recovery'

const LOCAL = 'env-local'

describe('LocalTopicRecovery', () => {
  it('resumes each list from its own version and asks for a snapshot when too far behind', () => {
    const recovery = new LocalTopicRecovery(LOCAL, () => null, 2)
    const sessions = { kind: 'sessionList', environmentId: LOCAL } as const
    const drafts = { kind: 'drafts', environmentId: LOCAL } as const
    const start = recovery.cursor(sessions)
    recovery.record(sessions, { type: 'session_list_changed', projectPath: '/a' })
    recovery.record(drafts, { type: 'draft_changed', draftId: 'd', draft: null, reason: 'deleted' })
    expect(recovery.recover(sessions, start)).toMatchObject({ kind: 'replay', items: [{ type: 'session_list_changed', projectPath: '/a' }] })
    recovery.record(sessions, { type: 'session_list_changed', projectPath: '/b' })
    recovery.record(sessions, { type: 'session_list_changed', projectPath: '/c' })
    expect(recovery.recover(sessions, start)?.kind).toBe('resnapshot')
    expect(recovery.recover(drafts, null)?.kind).toBe('resnapshot')
  })

  it('records nothing for session topics or other machines', () => {
    const recovery = new LocalTopicRecovery(LOCAL, () => null)
    expect(recovery.record({ kind: 'session', environmentId: LOCAL, sessionId: 's1' }, { type: 'status_change', status: 'idle' })).toBeNull()
    expect(recovery.record({ kind: 'sessionList', environmentId: 'node-b' }, { type: 'session_list_changed', projectPath: '/a' })).toBeNull()
  })

  it('resumes a terminal at its sequence and resnapshots one that moved on', () => {
    let sequence = 7
    const recovery = new LocalTopicRecovery(LOCAL, (id) => id === 't1' ? sequence : null)
    expect(recovery.recoverTerminal('t1', { sequence: 7 })).toEqual({ kind: 'replay', sequence: 7 })
    sequence = 9
    expect(recovery.recoverTerminal('t1', { sequence: 7 })).toEqual({ kind: 'resnapshot', sequence: 9 })
    expect(recovery.recoverTerminal('gone', { sequence: 1 })).toBeNull()
  })
})
