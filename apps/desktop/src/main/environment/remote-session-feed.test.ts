import { describe, expect, it, vi } from 'vitest'
import type { EnvironmentEventEnvelope } from '@superone/shared/environment'
import type { TerminalEvent } from '@superone/shared/agent-types'
import type { TopicRef } from '@superone/shared/environment/topics'
import { RemoteSessionFeed, type RemoteSessionFeedSource } from './remote-session-feed'
import type { SessionStreamFrame } from '@superone/shared/environment'

const envelope = (version: number, aggregateId: string, aggregateType = 'session', eventType = 'session.agent_event') =>
  ({ environmentId: 'env', sequence: String(version), sessionVersion: version, aggregateType, aggregateId, eventType, payload: {} }) as unknown as EnvironmentEventEnvelope

/** A node stream the test pushes into; `fail` ends it with an error. */
function pushSource(head = '7', apply?: (topics: TopicRef[]) => Promise<void>) {
  const queue: EnvironmentEventEnvelope[] = []
  let wake: (() => void) | null = null
  let error: Error | null = null
  let handlers: Parameters<RemoteSessionFeedSource['subscribe']>[2] | null = null
  /** The topics the node applied, in order. */
  const applied: TopicRef[][] = []
  const subscribe = vi.fn(async function* (_after: string, signal: AbortSignal, next: NonNullable<typeof handlers>) {
    handlers = next
    applied.push(next.interest.current())
    next.interest.watch(async (topics) => { await apply?.(topics); applied.push(topics) })
    while (!signal.aborted) {
      if (error) throw error
      const next = queue.shift()
      if (next) yield next
      else await new Promise<void>((resolve) => { wake = resolve })
    }
  })
  const poke = () => { wake?.(); wake = null }
  return {
    head: vi.fn(async () => head),
    subscribe,
    push: (e: EnvironmentEventEnvelope) => { queue.push(e); poke() },
    fail: (err: Error) => { error = err; poke() },
    resnapshot: (ids: string[]) => handlers?.onResnapshot(ids),
    realign: () => handlers?.onRealign(),
    frame: (frame: SessionStreamFrame) => { handlers?.onFrame?.(frame); for (const event of frame.events) queue.push(event); poke() },
    terminal: (event: TerminalEvent) => handlers?.onTerminal?.(event),
    applied,
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('RemoteSessionFeed', () => {
  it('rejects a native join without reading its cut when the upstream rejects its interest', async () => {
    const source = pushSource('7', async topics => { if (topics.length) throw new Error('subscription denied') })
    const feed = new RemoteSessionFeed(source, 'env')
    const catchUp = vi.fn(async () => ({ sequence: '7', epoch: 'e', events: [] }))
    await expect(feed.followTopics({ afterSequence: '7', topics: [{ kind: 'sessionList', environmentId: 'env' }] },
      { onFrame: vi.fn(), onEnd: vi.fn() }, catchUp)).rejects.toThrow('subscription denied')
    expect(catchUp).not.toHaveBeenCalled()
    await flush()
    expect(source.applied.at(-1)).toEqual([])
    feed.close()
  })
  it('restores the accepted interest after a failed update and keeps delivering its original topic', async () => {
    const original: TopicRef[] = [{ kind: 'session', environmentId: 'env', sessionId: 'a' }]
    const source = pushSource('7', async topics => { if (topics.some(topic => topic.kind === 'session' && topic.sessionId === 'b')) throw new Error('subscription denied') })
    const feed = new RemoteSessionFeed(source, 'env')
    const onFrame = vi.fn()
    const stream = await feed.followTopics({ afterSequence: '7', epoch: 'e', topics: original },
      { onFrame, onEnd: vi.fn() }, async () => ({ sequence: '7', epoch: 'e', events: [] }))
    await expect(stream.update([{ kind: 'session', environmentId: 'env', sessionId: 'b' }])).rejects.toThrow('subscription denied')
    await flush()
    expect(source.applied.at(-1)).toEqual(original)
    source.frame({ sequence: '9', epoch: 'e', events: [envelope(8, 'a'), envelope(9, 'b')] })
    expect(onFrame.mock.calls.flatMap(([frame]) => frame.events.map((event: EnvironmentEventEnvelope) => event.aggregateId))).toEqual(['a'])
    stream.close(); feed.close()
  })
  it.each(['epoch', 'utf8', 'realign'] as const)('requests a scoped recovery for %s changes during a native cut', async reason => {
    const source = pushSource()
    const feed = new RemoteSessionFeed(source, 'env')
    const topics: TopicRef[] = [{ kind: 'session', environmentId: 'env', sessionId: 'a' }]
    const onFrame = vi.fn()
    let complete!: (frame: SessionStreamFrame) => void
    const joining = feed.followTopics({ afterSequence: '7', epoch: 'e', topics }, { onFrame, onEnd: vi.fn() },
      () => new Promise(resolve => { complete = resolve }))
    await flush()
    source.frame({ sequence: '8', epoch: reason === 'epoch' ? 'old' : 'e', events: [
      { ...envelope(8, 'a'), payload: { text: reason === 'utf8' ? '汉'.repeat(1_500_000) : 'held' } },
    ] })
    if (reason === 'realign') source.realign()
    complete({ sequence: '7', epoch: 'e', events: [] })
    const stream = await joining
    expect(onFrame.mock.calls.flatMap(([frame]) => frame.events)).toEqual([])
    expect(onFrame).toHaveBeenCalledWith(expect.objectContaining({ epoch: 'e', recover: topics, resnapshot: ['a'] }))
    stream.close(); feed.close()
  })
  it('shares desktop/native interests and deduplicates a cursor cut against frames held during its read', async () => {
    const source = pushSource()
    const feed = new RemoteSessionFeed(source, 'env')
    const desktop = { event: vi.fn(), end: vi.fn() }
    await feed.follow('a', desktop, async () => 7)
    let complete!: (frame: SessionStreamFrame) => void
    const onFrame = vi.fn()
    const subscribing = feed.followTopics({ afterSequence: '7', epoch: 'e', versions: { a: 7 }, topics: [{ kind: 'session', environmentId: 'env', sessionId: 'a' }] },
      { onFrame, onEnd: vi.fn() }, () => new Promise(resolve => { complete = resolve }))
    await flush()
    const event = (version: number, id = 'a') => ({ ...envelope(version, id), environmentId: 'env' })
    source.frame({ sequence: '10', epoch: 'e', events: [event(8), event(9, 'b'), event(10)] })
    source.frame({ sequence: '11', epoch: 'e', events: [event(11)] })
    complete({ sequence: '10', epoch: 'e', events: [event(8), event(10)] })
    const stream = await subscribing
    expect(onFrame.mock.calls.flatMap(([frame]) => frame.events.map((event: { sessionVersion: number }) => event.sessionVersion))).toEqual([8, 10, 11])
    expect(source.subscribe).toHaveBeenCalledTimes(1)
    expect(source.applied.at(-1)).toEqual([{ kind: 'session', environmentId: 'env', sessionId: 'a' }])
    stream.close(); feed.close()
  })
  it('cancels a joining native reader on node close and excludes output from terminal-list readers', async () => {
    const source = pushSource()
    const feed = new RemoteSessionFeed(source, 'env')
    const onTerminal = vi.fn()
    const stream = await feed.followTopics({ afterSequence: '7', topics: [{ kind: 'terminalList', environmentId: 'env' }] },
      { onFrame: vi.fn(), onTerminal, onEnd: vi.fn() }, async () => ({ sequence: '7', epoch: 'e', events: [] }))
    source.terminal({ type: 'terminal_output', terminalId: 'private', data: 'private screen', fromSeq: 1, toSeq: 1 })
    source.terminal({ type: 'terminal_title_changed', terminalId: 'private', title: 'Shell' })
    expect(onTerminal).toHaveBeenCalledTimes(1)
    stream.close()
    let complete!: (frame: SessionStreamFrame) => void
    const opening = feed.followTopics({ afterSequence: '7', topics: [] }, { onFrame: vi.fn(), onEnd: vi.fn() }, () => new Promise(resolve => { complete = resolve }))
    const rejected = expect(opening).rejects.toThrow('topic stream closed')
    await flush(); feed.close(); complete({ sequence: '7', epoch: 'e', events: [] }); await rejected
  })
  it('opens one stream from the head and routes events to the followers of their session', async () => {
    const source = pushSource()
    const feed = new RemoteSessionFeed(source, 'env')
    const a = { event: vi.fn(), end: vi.fn() }
    const b = { event: vi.fn(), end: vi.fn() }
    await feed.follow('a', a, async () => 7)
    const unfollowB = await feed.follow('b', b, async () => 7)
    expect(source.subscribe).toHaveBeenCalledTimes(1)
    expect(source.subscribe.mock.calls[0][0]).toBe('7')

    source.push(envelope(8, 'a'))
    source.push(envelope(9, 'b'))
    source.push(envelope(10, 'p', 'project'))
    await flush()
    expect(a.event.mock.calls.map(([e]) => e.sequence)).toEqual(['8'])
    expect(b.event.mock.calls.map(([e]) => e.sequence)).toEqual(['9'])

    unfollowB()
    source.push(envelope(11, 'b'))
    await flush()
    expect(b.event).toHaveBeenCalledTimes(1)
    feed.close()
  })

  it('gives a follower only events above its barrier, though the stream lags behind', async () => {
    const source = pushSource('7')
    const feed = new RemoteSessionFeed(source, 'env')
    await feed.observe(() => {})
    // The session is at version 9 while the stream has not read 8 and 9 yet.
    const a = { event: vi.fn(), end: vi.fn() }
    await feed.follow('a', a, async () => 9)
    source.push(envelope(8, 'a'))
    source.push(envelope(9, 'a'))
    source.push(envelope(10, 'a'))
    await flush()
    expect(a.event.mock.calls.map(([e]) => e.sequence)).toEqual(['10'])
    feed.close()
  })

  it('holds events that arrive while the barrier is read and releases those above it', async () => {
    const source = pushSource('7')
    const feed = new RemoteSessionFeed(source, 'env')
    await feed.observe(() => {})
    let release!: (version: number) => void
    const a = { event: vi.fn(), end: vi.fn() }
    const following = feed.follow('a', a, () => new Promise((resolve) => { release = resolve }))
    await flush()
    source.push(envelope(8, 'a'))
    source.push(envelope(9, 'a'))
    await flush()
    expect(a.event).not.toHaveBeenCalled()
    release(8)
    await following
    expect(a.event.mock.calls.map(([e]) => e.sequence)).toEqual(['9'])
    feed.close()
  })

  it('asks the followers of a session the node names to resync', async () => {
    const source = pushSource()
    const feed = new RemoteSessionFeed(source, 'env')
    const a = { event: vi.fn(), end: vi.fn(), resync: vi.fn() }
    const b = { event: vi.fn(), end: vi.fn(), resync: vi.fn() }
    await feed.follow('a', a, async () => 7)
    await feed.follow('b', b, async () => 7)
    source.resnapshot(['a'])
    expect(a.resync).toHaveBeenCalledTimes(1)
    expect(b.resync).not.toHaveBeenCalled()
    feed.close()
  })

  it('hands session-list events to observers', async () => {
    const source = pushSource()
    const feed = new RemoteSessionFeed(source, 'env')
    const seen: string[] = []
    const unobserve = await feed.observe((e) => seen.push(e.aggregateId))
    source.push(envelope(8, 'a', 'session', 'session.created'))
    source.push(envelope(9, 'b', 'session', 'session.agent_event'))
    source.push(envelope(10, 'c', 'session', 'session.renamed'))
    await flush()
    expect(seen).toEqual(['a', 'c'])
    unobserve()
    source.push(envelope(11, 'd', 'session', 'session.created'))
    await flush()
    expect(seen).toEqual(['a', 'c'])
    feed.close()
  })

  it('subscribes to the union of what it is asked for, and reads a barrier only once the node has the topic', async () => {
    const source = pushSource()
    const feed = new RemoteSessionFeed(source, 'env')
    const unobserve = await feed.observe(() => {})
    const order: string[] = []
    const unfollowA = await feed.follow('a', { event: vi.fn(), end: vi.fn() }, async () => {
      order.push(`barrier with ${JSON.stringify(source.applied.at(-1))}`)
      return 7
    })
    const unfollowA2 = await feed.follow('a', { event: vi.fn(), end: vi.fn() }, async () => 7)
    expect(order).toEqual([`barrier with ${JSON.stringify([{ kind: 'sessionList', environmentId: 'env' }, { kind: 'session', environmentId: 'env', sessionId: 'a' }])}`])
    const applies = source.applied.length
    unfollowA()
    expect(source.applied).toHaveLength(applies)
    unfollowA2()
    unobserve()
    await flush()
    expect(source.applied.at(-1)).toEqual([])
    feed.close()
  })

  it('asks every follower to read its session again when the link changes tier', async () => {
    const source = pushSource()
    const feed = new RemoteSessionFeed(source, 'env')
    const a = { event: vi.fn(), end: vi.fn(), resync: vi.fn() }
    const b = { event: vi.fn(), end: vi.fn(), resync: vi.fn() }
    await feed.follow('a', a, async () => 7)
    await feed.follow('b', b, async () => 7)
    source.realign()
    expect(a.resync).toHaveBeenCalledTimes(1)
    expect(b.resync).toHaveBeenCalledTimes(1)
    feed.close()
  })

  it('ends every follower when the stream fails, and refuses new follows', async () => {
    const source = pushSource()
    const feed = new RemoteSessionFeed(source, 'env')
    const a = { event: vi.fn(), end: vi.fn() }
    await feed.follow('a', a, async () => 7)
    source.fail(new Error('blocked'))
    await flush()
    expect(a.end).toHaveBeenCalledWith(expect.objectContaining({ message: 'blocked' }))
    await expect(feed.follow('a', a, async () => 7)).rejects.toThrow('blocked')
  })

  it('retries the head read on the next follow after it fails', async () => {
    const source = pushSource()
    source.head.mockRejectedValueOnce(new Error('offline'))
    const feed = new RemoteSessionFeed(source, 'env')
    await expect(feed.follow('a', { event: vi.fn(), end: vi.fn() }, async () => 7)).rejects.toThrow('offline')
    await feed.follow('a', { event: vi.fn(), end: vi.fn() }, async () => 7)
    expect(source.subscribe).toHaveBeenCalledTimes(1)
    feed.close()
  })
})
