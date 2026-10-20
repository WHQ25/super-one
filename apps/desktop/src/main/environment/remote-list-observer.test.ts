import { describe, expect, it } from 'vitest'
import type { TopicNoticeFrame } from '@superone/shared/environment'
import type { SessionActivity } from '@superone/shared/session-activity'
import { remoteListObserver, type SessionActivityEvent } from './remote-list-observer'

const summary = (sessionId: string, status: string): SessionActivity =>
  ({ sessionId, projectPath: '/work/app', status, provider: 'claude', pendingCount: 0, pendingReason: { en: null, zh: null } })
const topic = { kind: 'sessionList', environmentId: 'env-b' } as const
const pushed = (activity: SessionActivity): TopicNoticeFrame => ({ topic, events: [{ type: 'session_activity', activity }] })
const snapshot = (activities: SessionActivity[]): TopicNoticeFrame => ({ topic, events: [], snapshot: { activities } })

function observe(summaries: Map<string, SessionActivity>) {
  const heard: SessionActivityEvent[] = []
  const observer = remoteListObserver('conn-b', summaries, { sessionListChanged: () => {}, projectsChanged: () => {}, activity: (event) => heard.push(event) })
  return { notice: observer.notice!, heard }
}

describe('remoteListObserver', () => {
  it('sets a row the node no longer holds live back to idle when a reconnect snapshot leaves it out', () => {
    const summaries = new Map<string, SessionActivity>()
    const before = observe(summaries)
    before.notice(pushed({ ...summary('ran', 'streaming'), pendingCount: 1 }))
    before.notice(pushed(summary('rested', 'idle')))
    before.notice(pushed(summary('kept', 'streaming')))

    // The link dropped; the next feed's observer reads the node's snapshot.
    const after = observe(summaries)
    after.notice(snapshot([summary('kept', 'streaming')]))
    expect(after.heard.map(({ activity }) => [activity.sessionId, activity.projectPath, activity.status, activity.pendingCount])).toEqual([
      ['ran', 'remote:conn-b:/work/app', 'idle', 0],
      ['kept', 'remote:conn-b:/work/app', 'streaming', 0],
    ])
    expect(after.heard.every((event) => !event.completed)).toBe(true)
    expect([...summaries.keys()]).toEqual(['kept'])
  })

  it('reports a provider change and does not treat an environment snapshot as a session list', () => {
    let catalogs = 0
    const observer = remoteListObserver('conn-b', new Map(), {
      sessionListChanged: () => { throw new Error('session list') },
      projectsChanged: () => { throw new Error('projects') },
      activity: () => { throw new Error('activity') },
      catalogChanged: () => { catalogs += 1 },
    })
    observer.notice!({
      topic: { kind: 'environment', environmentId: 'env-b' },
      events: [{ type: 'provider_changed', harnessId: 'claude', provider: null }],
    })
    observer.notice!({
      topic: { kind: 'environment', environmentId: 'env-b' },
      events: [],
      snapshot: {},
    })
    expect(catalogs).toBe(1)
  })
})
