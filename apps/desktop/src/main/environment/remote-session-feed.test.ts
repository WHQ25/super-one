import { describe, expect, it, vi } from 'vitest'
import type { EnvironmentEventEnvelope } from '@superone/shared/environment'
import { RemoteSessionFeed } from './remote-session-feed'

const envelope = (sequence: number, aggregateId: string, aggregateType = 'session') =>
  ({ sequence: String(sequence), aggregateType, aggregateId, eventType: 'session.agent_event', payload: {} }) as unknown as EnvironmentEventEnvelope

/** A node stream the test pushes into; `fail` ends it with an error. */
function pushSource(head = '7') {
  const queue: EnvironmentEventEnvelope[] = []
  let wake: (() => void) | null = null
  let error: Error | null = null
  const subscribe = vi.fn(async function* (_after: string, signal: AbortSignal) {
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
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('RemoteSessionFeed', () => {
  it('opens one stream from the head and routes events to the followers of their session', async () => {
    const source = pushSource()
    const feed = new RemoteSessionFeed(source)
    const a = { event: vi.fn(), end: vi.fn() }
    const b = { event: vi.fn(), end: vi.fn() }
    await feed.follow('a', a)
    const unfollowB = await feed.follow('b', b)
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

  it('ends every follower when the stream fails, and refuses new follows', async () => {
    const source = pushSource()
    const feed = new RemoteSessionFeed(source)
    const a = { event: vi.fn(), end: vi.fn() }
    await feed.follow('a', a)
    source.fail(new Error('blocked'))
    await flush()
    expect(a.end).toHaveBeenCalledWith(expect.objectContaining({ message: 'blocked' }))
    await expect(feed.follow('a', a)).rejects.toThrow('blocked')
  })

  it('retries the head read on the next follow after it fails', async () => {
    const source = pushSource()
    source.head.mockRejectedValueOnce(new Error('offline'))
    const feed = new RemoteSessionFeed(source)
    await expect(feed.follow('a', { event: vi.fn(), end: vi.fn() })).rejects.toThrow('offline')
    await feed.follow('a', { event: vi.fn(), end: vi.fn() })
    expect(source.subscribe).toHaveBeenCalledTimes(1)
    feed.close()
  })
})
