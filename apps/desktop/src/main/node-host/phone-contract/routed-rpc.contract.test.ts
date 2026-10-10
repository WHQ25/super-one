import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionLoadResult, SessionStreamFrame } from '@superone/shared/environment'
import type { ChatMessage } from '@superone/shared/agent-types'
import type { DetailUpdate } from '@superone/shared/environment/detail'
vi.mock('../../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
import { encryptedPhone } from '../encrypted-phone-test-fixtures'
import { phoneDomain } from '../phone-endpoint-test-fixtures'
import { routedNode } from '../routed-phone-test-fixtures'
import { createPhoneRpcRouter } from '../routed-phone-rpc'

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })

describe('native routed encrypted phone RPC', () => {
  it.each(['lan', 'relay'] as const)('keeps bodies on the source and streams independently expanded detail over %s', async tier => {
    const source = phoneDomain(cleanup)
    const message: ChatMessage = { id: 'body', role: 'assistant', status: 'streaming', providerId: 'claude', createdAt: '',
      content: [{ type: 'thinking', thinking: 'Private thinking body' }] }
    source.own.emitHostEvent({ type: 'message_start', message })
    const node = await routedNode(cleanup, source.domain, tier)
    const root = phoneDomain(cleanup, { rpcRouter: createPhoneRpcRouter(() => node) })
    const a = await encryptedPhone(cleanup, root.domain, tier, 'a')
    const loaded = await a.rpc<SessionLoadResult>('session.load', { sessionId: 'own' }, { environmentId: node.environmentId })
    expect(JSON.stringify(loaded)).not.toContain('Private thinking body')
    const detailRef = '["body","thinking",0]'
    expect(JSON.stringify(loaded)).toContain('remoteDetail')
    const frames: SessionStreamFrame[] = []
    const stream = await a.subscribeTopics({ afterSequence: loaded.cursor.sequence, epoch: loaded.cursor.epoch,
      versions: { own: loaded.cursor.version }, topics: [{ kind: 'session', environmentId: node.environmentId, sessionId: 'own' }] }, { onFrame: frame => frames.push(frame), onEnd: vi.fn() })
    const updates: DetailUpdate[] = []
    const detail = await a.subscribeDetail({ sessionId: 'own', detailRef, subscriptionId: 'expanded' }, update => updates.push(update), { environmentId: node.environmentId })
    expect(detail).toMatchObject({ text: 'Private thinking body', subscriptionId: 'expanded' })
    // A history read must retain the expanded row's revision and subscription.
    await a.rpc('session.load', { sessionId: 'own', limit: 1 }, { environmentId: node.environmentId })
    source.own.emitHostEvent({ type: 'content_delta', messageId: 'body', delta: { type: 'thinking', thinking: ' continuation' } })
    await vi.waitFor(() => expect(updates).toContainEqual(expect.objectContaining({ subscriptionId: 'expanded', text: ' continuation', revision: 1 })))
    expect(JSON.stringify(frames)).not.toContain(' continuation')
    await a.unsubscribeDetail({ sessionId: 'own', subscriptionId: 'expanded' }, { environmentId: node.environmentId })
    source.own.emitHostEvent({ type: 'content_delta', messageId: 'body', delta: { type: 'thinking', thinking: ' retired' } })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(updates).toHaveLength(1)
    await stream.close()
    expect(node.opened()).toBe(1)
  })
  it.each(['lan', 'relay'] as const)('shares the node feed, fences phone delegates and catches the load/subscribe gap over %s', async tier => {
    const lost = vi.fn()
    const source = phoneDomain(cleanup)
    const node = await routedNode(cleanup, source.domain, tier)
    const root = phoneDomain(cleanup, { rpcRouter: createPhoneRpcRouter(id => {
      if (id !== node.environmentId) throw Object.assign(new Error('unknown node'), { code: 'not_found' })
      return node
    }) })
    const a = await encryptedPhone(cleanup, root.domain, tier, 'a', [], { onControlLost: lost })
    const b = await encryptedPhone(cleanup, root.domain, tier, 'b')
    const resource = { environmentId: node.environmentId, sessionId: 'own' }
    const lease = await a.acquireControl(resource)
    expect(lease).toMatchObject({ delegate: 'phone:a', holderClientId: 'root-controller', resource })
    await expect(b.acquireControl(resource)).rejects.toMatchObject({ code: 'failed_precondition' })
    await expect(b.rpc('session.send', { sessionId: 'own', text: 'borrowed', leaseId: lease.leaseId, generation: lease.generation }, { environmentId: node.environmentId })).rejects.toMatchObject({ code: 'lease_required' })
    const desktop = { event: vi.fn(), end: vi.fn() }
    const unfollow = await node.feed.follow('own', desktop, async () => 0)
    const loaded = await a.rpc<SessionLoadResult>('session.load', { sessionId: 'own', projectId: 'p1' }, { environmentId: node.environmentId })
    await a.controlledRpc(resource, 'session.send', { text: 'between load and follow', clientMessageId: 'gap' })
    const frames: SessionStreamFrame[] = []
    const stream = await a.subscribeTopics({ afterSequence: loaded.cursor.sequence, epoch: loaded.cursor.epoch,
      versions: { own: loaded.cursor.version }, topics: [{ kind: 'session', ...resource }] }, { onFrame: frame => frames.push(frame), onEnd: vi.fn() })
    await a.controlledRpc(resource, 'session.send', { text: 'after following', clientMessageId: 'live' })
    await vi.waitFor(() => expect(frames.flatMap(frame => frame.events).filter(event => (event.payload as { event?: { type?: string } }).event?.type === 'user_message_appended')).toHaveLength(2))
    expect(node.opened()).toBe(1)
    expect(root.own.sent).toEqual([])
    expect(source.own.sent.map(item => item.content)).toEqual(['between load and follow', 'after following'])
    source.domain.leases.revoke(resource)
    await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1))
    await expect(a.controlledRpc(resource, 'session.send', { text: 'stale' })).rejects.toMatchObject({ code: 'lease_required' })
    expect(source.own.sent).toHaveLength(2)
    await stream.close(); unfollow()
    await expect(a.rpc('project.list', {}, { environmentId: 'unknown' })).rejects.toMatchObject({ code: 'not_found' })
  })
  it('refuses a held grant that changes while the target is resolving', async () => {
    const source = phoneDomain(cleanup)
    const node = await routedNode(cleanup, source.domain, 'lan')
    let gate: Promise<void> | undefined
    let resume!: () => void
    let entered!: () => void
    const resolving = new Promise<void>(resolve => { entered = resolve })
    const root = phoneDomain(cleanup, { rpcRouter: createPhoneRpcRouter(async () => { if (gate) { entered(); await gate }; return node }) })
    const a = await encryptedPhone(cleanup, root.domain, 'lan', 'a')
    const resource = { environmentId: node.environmentId, sessionId: 'own' }
    const lease = await a.acquireControl(resource)
    gate = new Promise<void>(resolve => { resume = resolve })
    const stale = a.rpc('session.send', { sessionId: 'own', text: 'queued', leaseId: lease.leaseId, generation: lease.generation }, { environmentId: node.environmentId })
    await resolving
    gate = undefined
    await a.releaseControl(resource)
    await a.acquireControl(resource)
    resume()
    await expect(stale).rejects.toMatchObject({ code: 'lease_stale' })
    expect(source.own.sent).toEqual([])
  })
  it.each(['lan', 'relay'] as const)('releases a disconnected delegate and immediately fences a window kick over %s', async tier => {
    const source = phoneDomain(cleanup)
    const node = await routedNode(cleanup, source.domain, tier)
    const router = createPhoneRpcRouter(() => node)
    const root = phoneDomain(cleanup, { rpcRouter: router })
    const a = await encryptedPhone(cleanup, root.domain, tier, 'a')
    const b = await encryptedPhone(cleanup, root.domain, tier, 'b')
    const resource = { environmentId: node.environmentId, sessionId: 'own' }
    await a.acquireControl(resource)
    a.disconnect()
    await b.acquireControl(resource)
    expect(source.domain.leases.get(resource)?.delegate).toBe('phone:b')
    await router.releaseSessions('own')
    await expect(b.controlledRpc(resource, 'session.send', { text: 'kicked' })).rejects.toMatchObject({ code: 'lease_required' })
    expect(source.domain.leases.get(resource)).toBeNull()
    expect(source.own.sent).toEqual([])
  })
  it('keeps a phone grant across overlapping LAN and Relay links and retires only the last link', async () => {
    const source = phoneDomain(cleanup)
    const node = await routedNode(cleanup, source.domain, 'lan')
    const root = phoneDomain(cleanup, { rpcRouter: createPhoneRpcRouter(() => node) })
    const a = await encryptedPhone(cleanup, root.domain, 'relay', 'a')
    const replacement = await encryptedPhone(cleanup, root.domain, 'lan', 'a')
    const resource = { environmentId: node.environmentId, sessionId: 'own' }
    const old = await a.acquireControl(resource)
    expect(await replacement.acquireControl(resource)).toMatchObject({ leaseId: old.leaseId, generation: old.generation })
    a.disconnect()
    await replacement.controlledRpc(resource, 'session.send', { text: 'still mine' })
    expect(source.own.sent.map(item => item.content)).toEqual(['still mine'])
    replacement.disconnect()
    await vi.waitFor(() => expect(source.domain.leases.get(resource)).toBeNull())
  })

})
