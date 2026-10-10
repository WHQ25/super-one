import { describe, expect, it, vi } from 'vitest'
import type { EnvironmentEventEnvelope } from '@superone/shared/environment'
import { RemoteSessionFeed } from './remote-session-feed'

const envelope = (version: number, aggregateId: string, aggregateType = 'session') =>
  ({ sequence: String(version), sessionVersion: version, aggregateType, aggregateId, eventType: 'session.agent_event', payload: {} }) as unknown as EnvironmentEventEnvelope

/** A node stream the test pushes into; `fail` ends it with an error. */
function pushSource(head = '7') {
  const queue: EnvironmentEventEnvelope[] = []
  let wake: (() => void) | null = null
  let error: Error | null = null
  let resnapshot: ((ids: string[]) => void) | null = null
  const subscribe = vi.fn(async function* (_after: string, signal: AbortSignal, onResnapshot: (ids: string[]) => void) {
    resnapshot = onResnapshot
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
    resnapshot: (ids: string[]) => resnapshot?.(ids),
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('RemoteSessionFeed', () => {
  it('opens one stream from the head and routes events to the followers of their session', async () => {
    const source = pushSource()
    const feed = new RemoteSessionFeed(source)
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
    const feed = new RemoteSessionFeed(source)
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
    const feed = new RemoteSessionFeed(source)
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
    const feed = new RemoteSessionFeed(source)
    const a = { event: vi.fn(), end: vi.fn(), resync: vi.fn() }
    const b = { event: vi.fn(), end: vi.fn(), resync: vi.fn() }
    await feed.follow('a', a, async () => 7)
    await feed.follow('b', b, async () => 7)
    source.resnapshot(['a'])
    expect(a.resync).toHaveBeenCalledTimes(1)
    expect(b.resync).not.toHaveBeenCalled()
    feed.close()
  })

  it('hands every session event to observers', async () => {
    const source = pushSource()
    const feed = new RemoteSessionFeed(source)
    const seen: string[] = []
    const unobserve = await feed.observe((e) => seen.push(e.aggregateId))
    source.push(envelope(8, 'a'))
    source.push(envelope(9, 'p', 'project'))
    source.push(envelope(10, 'b'))
    await flush()
    expect(seen).toEqual(['a', 'b'])
    unobserve()
    source.push(envelope(11, 'c'))
    await flush()
    expect(seen).toEqual(['a', 'b'])
    feed.close()
  })

  it('ends every follower when the stream fails, and refuses new follows', async () => {
    const source = pushSource()
    const feed = new RemoteSessionFeed(source)
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
    const feed = new RemoteSessionFeed(source)
    await expect(feed.follow('a', { event: vi.fn(), end: vi.fn() }, async () => 7)).rejects.toThrow('offline')
    await feed.follow('a', { event: vi.fn(), end: vi.fn() }, async () => 7)
    expect(source.subscribe).toHaveBeenCalledTimes(1)
    feed.close()
  })
})
