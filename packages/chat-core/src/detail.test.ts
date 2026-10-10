import { describe, expect, it, vi } from 'vitest'
import { applyDetailUpdate, createDetailClient, type DetailTarget, type DetailTransport, type DetailUpdate } from './detail'

const target = (detailRef: string, sessionId = 's'): DetailTarget => ({ environmentId: 'env', sessionId, detailRef })

/** A host that answers subscribes after `release()`, so tests control ordering. */
function mockTransport(snapshots: Record<string, string>) {
  const pending: Array<() => void> = []
  const subscribed: Array<{ target: DetailTarget; subscriptionId: string }> = []
  const unsubscribed: string[] = []
  const transport: DetailTransport = {
    subscribe: (t, subscriptionId) => new Promise<DetailUpdate>((resolve, reject) => {
      subscribed.push({ target: t, subscriptionId })
      pending.push(() => t.detailRef in snapshots
        ? resolve({ subscriptionId, revision: 0, offset: 0, text: snapshots[t.detailRef]! })
        : reject(new Error('Detail not found')))
    }),
    unsubscribe: (_t, subscriptionId) => { unsubscribed.push(subscriptionId) },
  }
  return { transport, subscribed, unsubscribed, release: async () => { for (const answer of pending.splice(0)) answer(); await new Promise((r) => setTimeout(r, 0)) } }
}

function opened(client: ReturnType<typeof createDetailClient>, targets: DetailTarget[], complete = false) {
  const state = { text: '', error: '', settled: false }
  const close = client.open(targets, { complete, onText: (text) => { state.text = text }, onError: (error) => { state.error = error }, onSettled: () => { state.settled = true } })
  return { state, close }
}

let ids = 0
const newId = () => `sub-${++ids}`

describe('detail client', () => {
  it('applies packets that arrive before the snapshot in revision order and skips stale ones', async () => {
    const host = mockTransport({ r: 'Read' })
    const client = createDetailClient(host.transport, { newId })
    const { state } = opened(client, [target('r')])
    const id = host.subscribed[0]!.subscriptionId
    client.deliver({ subscriptionId: id, revision: 2, offset: 10, text: ' twice' })
    client.deliver({ subscriptionId: id, revision: 1, offset: 4, text: 'ing on' })
    await host.release()
    expect(state.text).toBe('Reading on twice')
    client.deliver({ subscriptionId: id, revision: 1, offset: 0, text: 'stale' })
    expect(state.text).toBe('Reading on twice')
    expect(state.settled).toBe(true)
  })

  it('surfaces a gap as an error and closes every stream of the row', async () => {
    const host = mockTransport({ a: 'one' })
    const client = createDetailClient(host.transport, { newId })
    const { state, close } = opened(client, [target('a')])
    await host.release()
    client.deliver({ subscriptionId: host.subscribed[0]!.subscriptionId, revision: 1, offset: 10, text: 'x' })
    expect(state.error).toMatch('interrupted')
    close()
    expect(host.unsubscribed).toEqual([host.subscribed[0]!.subscriptionId])
    expect(() => applyDetailUpdate('ab', { offset: 3, text: '' })).toThrow()
  })

  it('reports a failed subscribe and lets a retry open again', async () => {
    const host = mockTransport({})
    const client = createDetailClient(host.transport, { newId })
    const first = opened(client, [target('gone')])
    await host.release()
    expect(first.state.error).toBe('Detail not found')
    const retry = opened(client, [target('gone')])
    expect(host.subscribed).toHaveLength(2)
    retry.close()
  })

  it('reuses completed text per environment and session, and closes a completed stream after its snapshot', async () => {
    const host = mockTransport({ done: 'final' })
    const client = createDetailClient(host.transport, { newId })
    const first = opened(client, [target('done')], true)
    await host.release()
    expect(first.state.text).toBe('final')
    expect(host.unsubscribed).toHaveLength(1)
    const again = opened(client, [target('done')], true)
    expect(again.state.text).toBe('final')
    expect(host.subscribed).toHaveLength(1)
    // The same reference in another session is another row.
    opened(client, [target('done', 'other')], true)
    expect(host.subscribed).toHaveLength(2)
  })

  it('bounds the cache and joins several references in order', async () => {
    const host = mockTransport({ a: 'x'.repeat(6), b: 'y'.repeat(6) })
    const client = createDetailClient(host.transport, { newId, maxCachedChars: 10 })
    const { state } = opened(client, [target('a'), target('b')], true)
    await host.release()
    expect(state.text).toBe(`${'x'.repeat(6)}\n\n${'y'.repeat(6)}`)
    expect(client.cached(target('a'))).toBeUndefined()
    expect(client.cached(target('b'))?.text).toBe('y'.repeat(6))
  })

  it('ignores packets after the row closed', async () => {
    const host = mockTransport({ a: 'one' })
    const client = createDetailClient(host.transport, { newId })
    const onText = vi.fn()
    const close = client.open([target('a')], { complete: false, onText, onError: vi.fn(), onSettled: vi.fn() })
    await host.release()
    close()
    client.deliver({ subscriptionId: host.subscribed[0]!.subscriptionId, revision: 1, offset: 3, text: ' two' })
    expect(onText).toHaveBeenLastCalledWith('one')
  })
})
