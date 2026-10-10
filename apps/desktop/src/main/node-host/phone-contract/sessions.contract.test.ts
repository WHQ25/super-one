import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { EnvironmentEventEnvelope, ExecutionEnvironmentDescriptor } from '@superone/shared/environment'

vi.mock('../../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { connectPhone, phoneDomain } from '../phone-endpoint-test-fixtures'

const cleanup: Array<() => void> = []
afterEach(() => {
  while (cleanup.length) cleanup.pop()!()
})

describe('phone endpoint: sessions', () => {
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

  it('leaves out and refuses local session changes until sessions move onto leases', async () => {
    const { domain } = phoneDomain(cleanup)
    const phone = await connectPhone(domain)
    const { capabilities } = await phone.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
    expect(capabilities.methods).toEqual(expect.arrayContaining(['session.list', 'session.load', 'topic.subscribe']))
    for (const method of ['session.send', 'session.create', 'session.acquireControl']) expect(capabilities.methods).not.toContain(method)
    await expect(phone.rpc('session.send', { sessionId: 'own', text: 'hi' })).rejects.toMatchObject({ details: { unsupported: true } })
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
