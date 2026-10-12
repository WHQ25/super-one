import { expect, it, vi } from 'vitest'
import type { TopicNoticeFrame } from '@superone/shared/environment/events'
import { SessionEventHub } from '../stream/session-event-hub'
import { createDesktopTopicHub, publishHubEvent } from '../stream/desktop-topics'
import { LocalTopicRecovery } from '../stream/topic-recovery'
import { createDesktopTopicNotices } from '../node-host/desktop-topic-notices'
import { publishScheduledSendNotice } from './scheduled-send-notice'

vi.mock('../logger', () => ({ default: { warn: vi.fn() } }))

it('delivers quota offers, acceptance and confirmed delivery through native phone workspace notices', () => {
  const hub = new SessionEventHub()
  const topics = createDesktopTopicHub()
  const recovery = new LocalTopicRecovery('desktop', () => null)
  hub.subscribe({ name: 'phone-topics', sources: ['list'], replay: false, deliver: event => publishHubEvent(topics, event, {
    localEnvironmentId: 'desktop', recovery, getSession: () => null, spawnParentOf: () => null,
  }) })
  const frames: TopicNoticeFrame[] = []
  const phone = createDesktopTopicNotices(topics, recovery, 'desktop').open({
    topics: [{ kind: 'sessionList', environmentId: 'desktop' }], cursors: {}, snapshot: () => ({ sessions: [] }), push: frame => frames.push(frame),
  })
  const offer = { sessionId: 's', sendAt: Date.now() + 3600000, armed: false, source: 'rate_limit' as const, message: null }
  publishScheduledSendNotice(hub, 's', offer, false)
  publishScheduledSendNotice(hub, 's', { ...offer, armed: true }, false)
  publishScheduledSendNotice(hub, 's', null, true)
  expect(frames.flatMap(frame => frame.events)).toMatchObject([
    { type: 'scheduled_send_changed', scheduled: { armed: false }, delivered: false },
    { type: 'scheduled_send_changed', scheduled: { armed: true }, delivered: false },
    { type: 'scheduled_send_changed', scheduled: null, delivered: true },
  ])
  expect(frames.slice(1).map(frame => frame.cursor?.version)).toEqual([1, 2, 3])
  phone.close()
})
