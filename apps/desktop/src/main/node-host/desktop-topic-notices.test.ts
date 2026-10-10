import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { TopicNoticeFrame } from '@superone/shared/environment/events'
import { topicKey, type TopicRef, type TopicVersionCursor } from '@superone/shared/environment/topics'
import { createDesktopTopicHub, publishHubEvent } from '../stream/desktop-topics'
import { LocalTopicRecovery } from '../stream/topic-recovery'
import { createDesktopTopicNotices } from './desktop-topic-notices'
import { deliveryPolicy, DRAFT_SAVE_INTERVAL_MS } from '@superone/runtime/stream'

vi.mock('../logger', () => ({ default: { warn: vi.fn() } }))
const list: TopicRef = { kind: 'sessionList', environmentId: 'env' }
const projects: TopicRef = { kind: 'projects', environmentId: 'env' }
const drafts: TopicRef = { kind: 'drafts', environmentId: 'env' }
function setup(capacity = 256) {
  const hub = createDesktopTopicHub()
  const recovery = new LocalTopicRecovery('env', () => null, capacity)
  const notices = createDesktopTopicNotices(hub, recovery, 'env')
  const frames: TopicNoticeFrame[] = []
  const snapshot = vi.fn(() => ({ sessions: [] }))
  const open = (topics: TopicRef[], cursors: Record<string, TopicVersionCursor> = {}) => notices.open({ topics, cursors, snapshot, push: frame => frames.push(frame) })
  const publish = (event: AgentEvent, source: 'list' | 'draft' = 'list') => publishHubEvent(hub, { event, source }, { localEnvironmentId: 'env', recovery, getSession: () => null, spawnParentOf: () => null })
  return { hub, recovery, frames, snapshot, notices, open, publish }
}

describe('native desktop workspace topic notices', () => {
  it('coalesces relay autosaves with an explicit version span while LAN receives every save', () => {
    vi.useFakeTimers()
    const f = setup()
    const lan = f.open([drafts])
    const relayFrames: TopicNoticeFrame[] = []
    const relay = f.notices.open({ topics: [drafts], cursors: {}, snapshot: f.snapshot,
      policy: deliveryPolicy('relay', 'phone'), push: frame => relayFrames.push(frame) })
    const saved = (draftId: string, text: string) => f.publish({ type: 'draft_changed', draftId, reason: 'saved', draft: { id: draftId, text, attachments: [] } } as AgentEvent, 'draft')
    try {
      saved('a', 'a1'); saved('b', 'b1'); saved('a', 'a2')
      expect(f.frames).toHaveLength(4)
      expect(relayFrames).toHaveLength(1)
      vi.advanceTimersByTime(DRAFT_SAVE_INTERVAL_MS)
      expect(relayFrames[1]).toMatchObject({ afterVersion: 0, cursor: { version: 3 },
        events: [{ draftId: 'a', draft: { text: 'a2' } }, { draftId: 'b', draft: { text: 'b1' } }] })
      saved('a', 'a3')
      f.publish({ type: 'draft_changed', draftId: 'a', reason: 'deleted' } as AgentEvent, 'draft')
      expect(relayFrames.slice(2)).toMatchObject([
        { afterVersion: 3, cursor: { version: 4 }, events: [] },
        { cursor: { version: 5 }, events: [{ draftId: 'a', reason: 'deleted' }] },
      ])
      vi.advanceTimersByTime(DRAFT_SAVE_INTERVAL_MS)
      expect(relayFrames).toHaveLength(4)
    } finally { lan.close(); relay.close(); vi.useRealTimers() }
  })

  it('cancels a pending relay save when its draft topic is removed or the connection closes', () => {
    vi.useFakeTimers()
    const f = setup()
    const stream = f.notices.open({ topics: [drafts], cursors: {}, snapshot: f.snapshot,
      policy: deliveryPolicy('relay', 'phone'), push: frame => f.frames.push(frame) })
    try {
      f.publish({ type: 'draft_changed', draftId: 'a', reason: 'saved' } as AgentEvent, 'draft')
      stream.setTopics([])
      vi.advanceTimersByTime(DRAFT_SAVE_INTERVAL_MS)
      expect(f.frames).toHaveLength(1)
      stream.setTopics([drafts])
      f.publish({ type: 'draft_changed', draftId: 'a', reason: 'saved' } as AgentEvent, 'draft')
      stream.close()
      vi.advanceTimersByTime(DRAFT_SAVE_INTERVAL_MS)
      expect(f.frames).toHaveLength(2)
    } finally { stream.close(); vi.useRealTimers() }
  })

  it('sends an initial versioned snapshot and then changes from the existing producer', () => {
    const f = setup()
    const stream = f.open([list])
    expect(f.frames).toEqual([{ topic: list, cursor: { epoch: expect.any(String), version: 0 }, events: [], snapshot: { sessions: [] } }])
    f.publish({ type: 'session_list_changed', projectPath: '/p' })
    expect(f.frames.at(-1)).toMatchObject({ topic: list, cursor: { version: 1 }, events: [{ type: 'session_list_changed', projectPath: '/p' }] })
    stream.close()
    f.publish({ type: 'session_list_changed', projectPath: '/p' })
    expect(f.frames).toHaveLength(2)
    expect(f.hub.interest()).toEqual([])
  })

  it('replays a retained cursor without replacing it with a snapshot', () => {
    const f = setup()
    const cursor = f.recovery.cursor(list)!
    f.publish({ type: 'session_list_changed', projectPath: '/p' })
    const stream = f.open([list], { [topicKey(list)]: cursor })
    expect(f.snapshot).not.toHaveBeenCalled()
    expect(f.frames).toEqual([{ topic: list, cursor: { epoch: cursor.epoch, version: 1 }, events: [{ type: 'session_list_changed', projectPath: '/p' }] }])
    stream.close()
  })

  it('resnapshots an old cursor after bounded change retention is exhausted', () => {
    const f = setup(1)
    const cursor = f.recovery.cursor(list)!
    f.publish({ type: 'session_list_changed', projectPath: '/a' })
    f.publish({ type: 'session_list_changed', projectPath: '/b' })
    const stream = f.open([list], { [topicKey(list)]: cursor })
    expect(f.frames[0]).toMatchObject({ cursor: { version: 2 }, snapshot: { sessions: [] }, events: [] })
    stream.close()
  })

  it('updates topic interest and ignores another environment and session content', () => {
    const f = setup()
    const stream = f.open([list, { kind: 'session', environmentId: 'env', sessionId: 'secret' }, { ...projects, environmentId: 'other' }])
    expect(f.hub.interest().map(({ topic }) => topic)).toEqual([list])
    stream.setTopics([projects])
    f.frames.length = 0
    f.publish({ type: 'session_list_changed', projectPath: '/p' })
    f.publish({ type: 'project_list_changed' })
    expect(f.frames).toHaveLength(1)
    expect(f.frames[0].topic).toEqual(projects)
    stream.close()
  })

  it('strips draft attachment bytes on both live changes and replay', () => {
    const f = setup()
    const cursor = f.recovery.cursor(drafts)!
    const live = f.open([drafts])
    f.publish({ type: 'draft_changed', draftId: 'd', reason: 'saved', draft: { id: 'd', attachments: [{ name: 'a', mimeType: 'text/plain', data: 'secret bytes', size: 12 }] } } as AgentEvent, 'draft')
    const event = f.frames.at(-1)!.events[0]
    expect(JSON.stringify(event)).not.toContain('secret bytes')
    live.close()
    f.frames.length = 0
    f.open([drafts], { [topicKey(drafts)]: cursor }).close()
    expect(JSON.stringify(f.frames)).not.toContain('secret bytes')
    expect(f.frames[0].events).toEqual([event])
  })

  it('closes its interest when the initial snapshot cannot be read', () => {
    const f = setup()
    f.snapshot.mockImplementationOnce(() => { throw new Error('snapshot unavailable') })
    expect(() => f.open([list])).toThrow('snapshot unavailable')
    expect(f.hub.interest()).toEqual([])
  })
})
