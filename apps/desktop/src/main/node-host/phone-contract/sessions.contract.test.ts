import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { ControlLease, EnvironmentEventEnvelope, ExecutionEnvironmentDescriptor } from '@superone/shared/environment'

vi.mock('../../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { runWindowControl } from '../../session/control-context'
import { connectPhone, phoneDomain } from '../phone-endpoint-test-fixtures'

const cleanup: Array<() => void> = []
afterEach(() => {
  while (cleanup.length) cleanup.pop()!()
})

describe('phone endpoint: sessions', () => {
  it.each(['lan', 'relay'] as const)('uses the native cold fork under the source session grant over %s', async (transport) => {
    const { domain, store, sessionEdits, projectDir } = phoneDomain(cleanup)
    const fork = vi.fn(async (input, assertControl: () => void) => {
      assertControl()
      store.createRow({ sessionId: 'forked', projectPath: projectDir, cwd: projectDir, title: 'Mine (fork)' })
      return { ok: true as const, sessionId: 'forked' }
    })
    sessionEdits.fork = fork
    const a = await connectPhone(domain, { deviceId: 'a', transport })
    const b = await connectPhone(domain, { deviceId: 'b', transport })
    cleanup.push(a.close, b.close)
    const descriptor = await a.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
    expect(descriptor.capabilities.methods).toContain('session.fork')
    const lease = await a.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    const payload = { sessionId: 'own', leaseId: lease.leaseId, generation: lease.generation, mode: 'local', carryLocalChanges: false, forkFromMessageId: 'a1' }
    await expect(b.rpc('session.fork', payload)).rejects.toMatchObject({ code: 'lease_stale' })
    expect(fork).not.toHaveBeenCalled()
    expect(await a.rpc('session.fork', payload, 'fork-request')).toMatchObject({ ok: true, sessionId: 'forked', session: { sessionId: 'forked', title: 'Mine (fork)' } })
    await a.rpc('session.fork', payload, 'fork-request')
    expect(fork).toHaveBeenCalledTimes(1)
    expect(fork).toHaveBeenCalledWith({ sessionId: 'own', mode: 'local', carryLocalChanges: false, forkFromMessageId: 'a1' }, expect.any(Function))
  })

  it('fences native fork persistence after an asynchronous clone', async () => {
    const { domain, sessionEdits, store } = phoneDomain(cleanup)
    let finish!: () => void
    sessionEdits.fork = async (_input, assertControl) => {
      assertControl()
      await new Promise<void>(resolve => { finish = resolve })
      assertControl()
      throw new Error('must not persist under revoked control')
    }
    const phone = await connectPhone(domain)
    cleanup.push(phone.close)
    const lease = await phone.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    const forking = phone.rpc('session.fork', { sessionId: 'own', leaseId: lease.leaseId, generation: lease.generation, mode: 'local' })
    const rejected = expect(forking).rejects.toMatchObject({ code: 'lease_stale' })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    domain.leases.revoke({ environmentId: domain.identity.environmentId, sessionId: 'own' })
    finish()
    await rejected
    expect(store.rows.size).toBe(1)
  })

  it('serves every session of the desktop to read, with its recorded events', async () => {
    const { domain, own } = phoneDomain(cleanup)
    const phone = await connectPhone(domain)
    own.emitHostEvent({ type: 'status_change', status: 'streaming' } as AgentEvent)

    expect((await phone.rpc<Array<{ sessionId: string }>>('session.list', { projectId: 'p1', limit: 10, offset: 0 })).map((s) => s.sessionId)).toEqual(['own'])
    expect(await phone.rpc('session.get', { sessionId: 'own' })).toMatchObject({ sessionId: 'own', title: 'Mine', controllerClientSessionId: null })
    expect(await phone.rpc('session.load', { sessionId: 'own' })).toMatchObject({ sessionId: 'own', cursor: { version: 1 } })
    const { events } = await phone.rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', { afterSequence: '0' })
    expect(events.map((e) => e.aggregateId)).toEqual(['own'])
  })

  it.each(['lan', 'relay'] as const)('fences session writes for two phones and a desktop window over %s', async (transport) => {
    const { domain, own } = phoneDomain(cleanup)
    const a = await connectPhone(domain, { deviceId: 'a', transport })
    const b = await connectPhone(domain, { deviceId: 'b', transport })
    cleanup.push(a.close, b.close)
    const { capabilities } = await a.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
    expect(capabilities.methods).toEqual(expect.arrayContaining(['session.send', 'session.create', 'session.acquireControl']))
    runWindowControl(7, () => own.lease.assertMutation())
    const resource = { environmentId: domain.identity.environmentId, sessionId: 'own' }
    const window = domain.leases.get(resource)!
    const lease = await a.rpc<ControlLease>('session.acquireControl', { sessionId: 'own', delegate: 'phone:b', yields: true })
    expect(lease.delegate).toBe('phone:a')
    expect(() => domain.leases.assertValid(window)).toThrow('stale lease')
    await expect(b.rpc('session.acquireControl', { sessionId: 'own' })).rejects.toMatchObject({ code: 'failed_precondition' })
    expect(() => runWindowControl(7, () => own.lease.assertMutation())).toThrow('held by another device')
    const proof = { sessionId: 'own', leaseId: lease.leaseId, generation: lease.generation }
    await expect(b.rpc('session.send', { ...proof, text: 'stolen' })).rejects.toMatchObject({ code: 'lease_stale' })
    await expect(b.rpc('session.patchSettings', { ...proof, settings: { model: 'stolen' } })).rejects.toMatchObject({ code: 'lease_stale' })
    await a.rpc('session.patchSettings', { ...proof, settings: { model: 'claude-opus', effort: 'high' } })
    expect(await a.rpc('session.get', { sessionId: 'own' })).toMatchObject({ model: 'claude-opus', effort: 'high' })
    await a.rpc('session.send', { ...proof, text: 'phone turn', clientMessageId: 'u1' })
    expect(own.sent.map((request) => request.content)).toEqual(['phone turn'])
    await a.rpc('session.setTags', { ...proof, set: ['mobile'] })
    await a.rpc('session.setUiFlags', { ...proof, isPinned: true })
    const renewed = await a.rpc<ControlLease>('session.renewControl', proof)
    expect(renewed.delegate).toBe('phone:a')
    domain.leases.revoke(resource)
    runWindowControl(7, () => own.lease.assertMutation())
    await expect(a.rpc('session.send', { ...proof, text: 'stale' })).rejects.toMatchObject({ code: 'lease_stale' })
    const second = await b.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    expect(second.generation).not.toBe(lease.generation)
    await b.rpc('session.releaseControl', { sessionId: 'own', leaseId: second.leaseId, generation: second.generation })
    await expect(a.rpc('session.acquireControl', { sessionId: 'missing' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('creates a phone session and applies its initial settings with the newly granted control', async () => {
    const { domain } = phoneDomain(cleanup)
    const phone = await connectPhone(domain)
    cleanup.push(phone.close)
    const created = await phone.rpc<{ sessionId: string }>('session.create', { projectId: 'p1', harnessId: 'claude', title: 'New', options: { model: 'claude-opus', effort: 'high' } })
    expect(await phone.rpc('session.get', { sessionId: created.sessionId })).toMatchObject({ title: 'New', model: 'claude-opus', effort: 'high', controllerClientSessionId: null })
  })

  it('pushes a subscribed session to the asking phone and nothing else', async () => {
    const { domain, own } = phoneDomain(cleanup)
    const phone = await connectPhone(domain)
    const other = await connectPhone(domain, { deviceId: 'phone-2' })
    const { snapshotSequence } = await phone.rpc<{ snapshotSequence: string }>('session.snapshot')
    const topic = { kind: 'session', environmentId: domain.identity.environmentId, sessionId: 'own' }
    await phone.rpc('topic.subscribe', { subscriptionId: 's1', afterSequence: snapshotSequence, topics: [topic] })
    own.emitHostEvent({ type: 'status_change', status: 'streaming' } as AgentEvent)
    await vi.waitFor(() => expect(phone.pushes.some((m) => m.type === 'stream')).toBe(true))
    expect(other.pushes).toEqual([])
  })
})
