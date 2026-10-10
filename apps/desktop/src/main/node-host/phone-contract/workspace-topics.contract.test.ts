import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { TopicNoticeFrame } from '@superone/shared/environment/events'
import type { DesktopDomain } from '../desktop-domain'
import { topicKey } from '@superone/shared/environment/topics'

vi.mock('../../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
import { createDesktopTopicHub } from '../../stream/desktop-topics'
import { LocalTopicRecovery } from '../../stream/topic-recovery'
import { createDesktopTopicNotices } from '../desktop-topic-notices'
import { encryptedPhone } from '../encrypted-phone-test-fixtures'
import { phoneDomain } from '../phone-endpoint-test-fixtures'
import { DRAFT_SAVE_INTERVAL_MS } from '@superone/runtime/stream'

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })

describe('native encrypted workspace topic connection', () => {
  it.each(['lan', 'relay'] as const)('delivers a versioned initial snapshot, live invalidation and resumed changes over %s', async route => {
    const hub = createDesktopTopicHub()
    let domain!: DesktopDomain
    let recovery!: LocalTopicRecovery
    let notices!: ReturnType<typeof createDesktopTopicNotices>
    domain = phoneDomain(cleanup, { topicNotices: { open: input => {
      recovery ??= new LocalTopicRecovery(domain.identity.environmentId, () => null)
      notices ??= createDesktopTopicNotices(hub, recovery, domain.identity.environmentId)
      return notices.open(input)
    } } }).domain
    const snapshots: Array<{ kind: string; snapshot: unknown }> = []
    const arrived: unknown[][] = []
    const transcript: unknown[][] = []
    const recovered = vi.fn()
    const client = await encryptedPhone(cleanup, domain, route, 'workspace', transcript, {
      onWorkspaceSnapshot: (topic, snapshot) => snapshots.push({ kind: topic.kind, snapshot }),
      onArrived: events => arrived.push(events),
      onWorkspaceRecovery: recovered,
    })
    const topic = { kind: 'sessionList', environmentId: domain.identity.environmentId } as const
    const frames: TopicNoticeFrame[] = []
    const ended = vi.fn()
    const stream = await client.subscribeTopics({ afterSequence: '0', topics: [topic] }, { onFrame: () => {}, onTopic: frame => frames.push(frame), onEnd: ended })
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ topic, cursor: { version: 0 }, snapshot: { sessions: [expect.objectContaining({ sessionId: 'own' })], projects: [expect.objectContaining({ projectId: 'p1' })] }, events: [] })
    const cursor = frames[0].cursor!
    const publish = (path: string) => {
      const event: AgentEvent = { type: 'session_list_changed', projectPath: path }
      recovery.record(topic, event)
      hub.publish(topic, { kind: 'agent', event, source: 'list' })
    }
    publish('/p')
    expect(frames.at(-1)).toMatchObject({ cursor: { version: 1 }, events: [{ type: 'session_list_changed', projectPath: '/p' }] })
    await stream.close()
    publish('/missed')
    expect(frames).toHaveLength(2)
    const resumed: TopicNoticeFrame[] = []
    const next = await client.subscribeTopics({ afterSequence: '0', topics: [topic], topicCursors: { [topicKey(topic)]: cursor } }, { onFrame: () => {}, onTopic: frame => resumed.push(frame), onEnd: ended })
    expect(resumed).toEqual([{ topic, cursor: { epoch: cursor.epoch, version: 2 }, events: [{ type: 'session_list_changed', projectPath: '/p' }, { type: 'session_list_changed', projectPath: '/missed' }] }])
    await next.close()
    expect(hub.interest()).toEqual([])
    expect(ended).not.toHaveBeenCalled()

    client.startBuffering()
    await Promise.all([client.followWorkspace(), client.followWorkspace()])
    expect(snapshots.map(snapshot => snapshot.kind)).toEqual(['sessionList', 'projects', 'drafts', 'environment'])
    expect(snapshots[0].snapshot).toMatchObject({ sessions: [expect.objectContaining({ sessionId: 'own' })] })
    publish('/live workspace')
    expect(arrived.at(-1)).toEqual([{ type: 'session_list_changed', projectPath: '/live workspace', environmentId: topic.environmentId }])
    expect(transcript).toEqual([])
    expect(client.releaseBuffer().batches).toEqual([])
    vi.useFakeTimers()
    try {
      const draftTopic = { kind: 'drafts', environmentId: domain.identity.environmentId } as const
      const save = (text: string) => {
        const event = { type: 'draft_changed', draftId: 'd', reason: 'saved', draft: { id: 'd', text, attachments: [] } } as AgentEvent
        recovery.record(draftTopic, event)
        hub.publish(draftTopic, { kind: 'agent', event, source: 'draft' })
      }
      const before = arrived.length
      save('first'); save('latest')
      expect(arrived.length - before).toBe(route === 'relay' ? 0 : 2)
      await vi.advanceTimersByTimeAsync(DRAFT_SAVE_INTERVAL_MS)
      expect(arrived.length - before).toBe(route === 'relay' ? 1 : 2)
      expect(arrived.at(-1)).toEqual([expect.objectContaining({ type: 'draft_changed', draftId: 'd', draft: expect.objectContaining({ text: 'latest' }) })])
      expect(recovered).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
    await client.stopWorkspace(topic.environmentId)
    expect(hub.interest()).toEqual([])
  })
})
