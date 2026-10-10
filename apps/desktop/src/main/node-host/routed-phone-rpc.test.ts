import { describe, expect, it, vi } from 'vitest'
import type { SessionLoadResult, SessionStreamFrame } from '@superone/shared/environment'
import type { RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import { ConnectionDelivery, deliveryPolicy } from '@superone/runtime/stream'
import type { AuthenticatedClient, RpcContext } from '@superone/runtime/server'
import { createPhoneRpcRouter } from './routed-phone-rpc'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture() {
  const handles = new Map<string, { close(): void }>()
  const push = vi.fn()
  const streams = { delivery: new ConnectionDelivery(deliveryPolicy('lan', 'phone')), push,
    open: (id: string, handle: { close(): void }) => { handles.get(id)?.close(); handles.set(id, handle) },
    close: (id: string) => { handles.get(id)?.close(); handles.delete(id) } }
  const client = { clientSessionId: 'phone:test' } as AuthenticatedClient
  const ctx = { client, streams } as unknown as RpcContext
  const target = { environmentId: 'node', client: { rpc: vi.fn(), subscribeDetail: vi.fn(), unsubscribeDetail: vi.fn() },
    follow: vi.fn(async (_input: unknown, _handlers: RpcStreamHandlers) => ({ close: vi.fn(), update: vi.fn(async () => {}) })) }
  const input = { subscriptionId: 'stream', afterSequence: '0', topics: [{ kind: 'sessionList', environmentId: 'node' }] }
  const frame: SessionStreamFrame = { sequence: '1', epoch: 'e', events: [] }
  return { ctx, client, target, input, frame, push }
}

describe('routed phone subscription cancellation', () => {
  it('retires an intent before target resolution and does not resolve the target to unsubscribe', async () => {
    const f = fixture()
    const gate = deferred<typeof f.target>()
    const resolve = vi.fn(() => gate.promise)
    const router = createPhoneRpcRouter(resolve)
    const route = router.open(f.client)
    const joining = route.dispatch('node', 'topic.subscribe', f.input, f.ctx)
    expect(await route.dispatch('node', 'topic.unsubscribe', { subscriptionId: 'stream' }, f.ctx)).toEqual({ result: { ok: true } })
    gate.resolve(f.target)
    expect((await joining).error?.code).toBe('unavailable')
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(f.target.follow).not.toHaveBeenCalled()
    router.close()
  })
  it('mutes held callbacks immediately and closes a stream that finishes opening after cancellation', async () => {
    const f = fixture()
    const gate = deferred<Awaited<ReturnType<typeof f.target.follow>>>()
    let callbacks!: RpcStreamHandlers
    f.target.follow.mockImplementation((_input, handlers) => { callbacks = handlers; return gate.promise })
    const router = createPhoneRpcRouter(() => f.target)
    const route = router.open(f.client)
    const joining = route.dispatch('node', 'topic.subscribe', f.input, f.ctx)
    await vi.waitFor(() => expect(f.target.follow).toHaveBeenCalledTimes(1))
    await route.dispatch('node', 'topic.unsubscribe', { subscriptionId: 'stream' }, f.ctx)
    callbacks.onFrame(f.frame)
    const stream = { close: vi.fn(), update: vi.fn(async () => {}) }
    gate.resolve(stream)
    expect((await joining).error?.code).toBe('unavailable')
    expect(stream.close).toHaveBeenCalledTimes(1)
    expect(f.push).not.toHaveBeenCalled()
    router.close()
  })
  it('mutes a rejected join and retires replaced streams before the replacement resolves', async () => {
    const f = fixture()
    const callbacks: RpcStreamHandlers[] = []
    const old = { close: vi.fn(), update: vi.fn(async () => {}) }
    f.target.follow.mockImplementation(async (_input, handlers) => { callbacks.push(handlers); return old })
    const gate = deferred<typeof f.target>()
    let hold = false
    const router = createPhoneRpcRouter(() => hold ? gate.promise : f.target)
    const route = router.open(f.client)
    await route.dispatch('node', 'topic.subscribe', f.input, f.ctx)
    hold = true
    const replacement = route.dispatch('node', 'topic.subscribe', f.input, f.ctx)
    expect(old.close).toHaveBeenCalledTimes(1)
    callbacks[0]!.onFrame(f.frame)
    expect(f.push).not.toHaveBeenCalled()
    f.target.follow.mockImplementation(async (_input, handlers) => { callbacks.push(handlers); throw new Error('denied') })
    gate.resolve(f.target)
    expect((await replacement).error?.message).toBe('denied')
    callbacks[1]!.onFrame(f.frame)
    expect(f.push).not.toHaveBeenCalled()
    hold = false
    f.target.follow.mockImplementation(async () => ({ close: vi.fn(), update: vi.fn(async () => {}) }))
    expect((await route.dispatch('other', 'topic.subscribe', { ...f.input, topics: [] }, f.ctx)).error?.code).toBe('identity_conflict')
    expect((await route.dispatch('node', 'topic.subscribe', f.input, f.ctx)).error).toBeUndefined()
    router.close()
  })
  it('does not cache a detail page or open a detail when its pending request was cancelled', async () => {
    const f = fixture()
    const loaded = { sessionId: 's', state: { sessionProvider: 'claude' }, messages: [],
      cursor: { sequence: '0', version: 0, epoch: 'e' }, summarized: false } as unknown as SessionLoadResult
    const page = { ...loaded, messages: [{ id: 'm', role: 'assistant', status: 'complete', providerId: 'claude', createdAt: '',
      content: [{ type: 'thinking', thinking: 'body' }] }] } as SessionLoadResult
    const gate = deferred<SessionLoadResult>()
    let pageReads = 0
    f.target.client.rpc.mockImplementation(async (_method: string, payload: { anchorId?: string }) => {
      if (!payload.anchorId) return loaded
      return ++pageReads === 1 ? gate.promise : page
    })
    const router = createPhoneRpcRouter(() => f.target)
    const route = router.open(f.client)
    await route.dispatch('node', 'session.load', { sessionId: 's' }, f.ctx)
    const input = { sessionId: 's', subscriptionId: 'detail', detailRef: '["m","thinking",0]' }
    const expanding = route.dispatch('node', 'session.subscribeDetail', input, f.ctx)
    await vi.waitFor(() => expect(pageReads).toBe(1))
    await route.dispatch('node', 'session.unsubscribeDetail', input, f.ctx)
    gate.resolve(page)
    expect((await expanding).error?.code).toBe('unavailable')
    expect((await route.dispatch('node', 'session.subscribeDetail', input, f.ctx)).error).toBeUndefined()
    expect(pageReads).toBe(2)
    router.close()
  })
})
