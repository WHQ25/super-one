import { describe, expect, it } from 'vitest'
import { SESSION_DURABLE_EVENT, type EnvironmentEventEnvelope, type TopicNoticeFrame } from '@superone/shared/environment'
import type { TopicRef } from '@superone/shared/environment/topics'
import type { NodeSessionRecord } from '@superone/runtime/session'
import { createNodeSessionListNotices } from './session-list-notices'

function session(over: Partial<NodeSessionRecord> = {}): NodeSessionRecord {
  return {
    sessionId: 'child',
    projectId: 'project-1',
    harnessId: 'codex',
    providerId: 'codex',
    title: 'Worker',
    status: 'idle',
    transcript: [],
    pendingInteraction: null,
    providerResume: null,
    cwd: '/work',
    createdAt: 1,
    updatedAt: 2,
    isPinned: false,
    isHidden: false,
    isUserRenamed: false,
    controllerClientSessionId: null,
    hostActionCapabilityVersion: 0,
    hostActionToolGroups: [],
    alwaysAllowedTools: [],
    parentSessionId: 'parent',
    ...over,
  }
}

function envelope(eventType: string, sessionId = 'child'): EnvironmentEventEnvelope {
  return {
    eventId: 'e1',
    sequence: '1',
    timestamp: 1,
    aggregateType: 'session',
    aggregateId: sessionId,
    eventType,
    eventVersion: 1,
    payload: {},
    environmentId: 'env-1',
  }
}

function harness() {
  const sessions = new Map<string, NodeSessionRecord>([['child', session({ status: 'streaming' })]])
  const notices = createNodeSessionListNotices({
    environmentId: 'env-1',
    listSessions: () => [...sessions.values()],
    getSession: (sessionId) => sessions.get(sessionId) ?? null,
    projectPath: (projectId) => projectId === 'project-1' ? '/work/app' : null,
  })
  const frames: TopicNoticeFrame[] = []
  const topic: TopicRef = { kind: 'sessionList', environmentId: 'env-1' }
  const open = (topics: TopicRef[] = [topic]) => notices.topicNotices.open({
    topics,
    cursors: {},
    snapshot: () => ({ sessions: [] }),
    push: (frame) => frames.push(frame),
  })
  return { sessions, notices, frames, topic, open }
}

describe('CLI session list notices', () => {
  it('covers the session list only, so composer drafts stay on the draft stream', () => {
    const { notices } = harness()
    expect(notices.topicNotices.covers).toEqual(['sessionList'])
  })

  it('snapshots a running child under its spawn parent', () => {
    const { frames, open } = harness()
    open()
    expect(frames).toHaveLength(1)
    expect(frames[0]?.snapshot).toMatchObject({
      sessions: [],
      activities: [{
        sessionId: 'child',
        projectPath: '/work/app',
        status: 'streaming',
        provider: 'codex',
        title: 'Worker',
        parentSessionId: 'parent',
        pendingCount: 0,
      }],
    })
  })

  it('does not snapshot again when the same stream still follows the list', () => {
    const { frames, topic, open } = harness()
    const handle = open()
    handle.setTopics([topic])
    expect(frames).toHaveLength(1)
    handle.setTopics([])
    handle.setTopics([topic])
    expect(frames).toHaveLength(2)
  })

  it('publishes a list change and the live status, then the idle completion', () => {
    const { sessions, notices, frames, open } = harness()
    open()
    frames.length = 0
    notices.onSessionEvent(envelope(SESSION_DURABLE_EVENT.created))
    notices.onSessionEvent(envelope(SESSION_DURABLE_EVENT.turnStarted))
    expect(frames.map((frame) => frame.events[0]?.type)).toEqual(['session_list_changed', 'session_activity'])
    expect(frames[1]?.events[0]).toMatchObject({
      type: 'session_activity',
      activity: { sessionId: 'child', status: 'streaming', parentSessionId: 'parent', projectPath: '/work/app' },
    })

    sessions.set('child', session({ status: 'idle' }))
    notices.onSessionEvent(envelope(SESSION_DURABLE_EVENT.turnCompleted))
    expect(frames.at(-1)?.events[0]).toMatchObject({
      type: 'session_activity',
      completed: true,
      activity: { status: 'idle' },
    })
  })

  it('names the project of a removed session from the path it last published', () => {
    const { sessions, notices, frames, open } = harness()
    open()
    frames.length = 0
    sessions.delete('child')
    notices.onSessionEvent(envelope(SESSION_DURABLE_EVENT.removed))
    expect(frames[0]?.events[0]).toEqual({ type: 'session_list_changed', projectPath: '/work/app' })
    frames.length = 0
    notices.onSessionEvent(envelope(SESSION_DURABLE_EVENT.removed))
    expect(frames).toEqual([])
  })

  it('puts a pending question on the activity chip', () => {
    const { sessions, notices, frames, open } = harness()
    sessions.set('child', session({
      status: 'streaming',
      pendingInteraction: {
        interactionId: 'q1',
        kind: 'question',
        createdAt: 1,
        input: { questions: [{ question: 'Continue?', header: 'Confirm', options: [{ label: 'Yes' }] }] },
      },
    }))
    open()
    frames.length = 0
    notices.onSessionEvent(envelope(SESSION_DURABLE_EVENT.questionRequested))
    expect(frames[0]?.events[0]).toMatchObject({
      type: 'session_activity',
      activity: { pendingCount: 1, pendingReason: { en: 'Continue?' } },
    })
  })
})
