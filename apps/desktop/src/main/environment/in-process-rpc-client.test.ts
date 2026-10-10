import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { ControlLease, SessionStreamFrame } from '@superone/shared/environment'
import { connectPhone, phoneDomain } from '../node-host/phone-endpoint-test-fixtures'
import { runWindowControl } from '../session/control-context'
import { InProcessRpcClient } from './in-process-rpc-client'
import { LocalEnvironmentGateway } from './local-environment-gateway'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })

describe('in-process domain protocol', () => {
  it('routes the local gateway through the same fenced session service as its phone', async () => {
    const { domain, own, userDataDir } = phoneDomain(cleanup)
    const client = new InProcessRpcClient(domain)
    const gateway = new LocalEnvironmentGateway({ dataDir: userDataDir })
    gateway.bindProtocol(client)
    const descriptor = await gateway.getDescriptor()
    expect(descriptor.environmentId).toBe(gateway.getEnvironmentId())
    const ref = { environmentId: descriptor.environmentId, sessionId: 'own' }
    const local = await runWindowControl(7, () => gateway.sessions.acquireControl({ resource: ref }))
    expect(local.delegate).toBe('window:7')
    await runWindowControl(7, () => gateway.sessions.send({ session: ref, text: 'local turn', leaseId: local.leaseId, generation: local.generation }))
    expect(own.sent.map((request) => request.content)).toEqual(['local turn'])
    const phone = await connectPhone(domain, { deviceId: 'a' })
    cleanup.push(phone.close)
    const remote = await phone.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    expect(remote.delegate).toBe('phone:a')
    await expect(runWindowControl(7, () => gateway.sessions.send({ session: ref, text: 'stale', leaseId: local.leaseId, generation: local.generation }))).rejects.toMatchObject({ code: 'lease_stale' })
    await expect(runWindowControl(8, () => gateway.sessions.acquireControl({ resource: ref }))).rejects.toMatchObject({ code: 'failed_precondition' })
    await expect(client.rpc('session.get', { sessionId: 'own' }, 'other-environment')).rejects.toMatchObject({ code: 'identity_conflict' })
  })

  it('subscribes to domain events and closes its streams and requests with the domain', async () => {
    const { domain, own } = phoneDomain(cleanup)
    const client = new InProcessRpcClient(domain)
    const frames: SessionStreamFrame[] = []
    const onEnd = vi.fn()
    const stream = await client.subscribeEvents({ afterSequence: domain.localSessions.snapshotSequence(), topics: [{ kind: 'session', environmentId: domain.identity.environmentId, sessionId: 'own' }] }, { onFrame: (frame) => frames.push(frame), onEnd })
    own.emitHostEvent({ type: 'status_change', status: 'streaming' } as AgentEvent)
    await vi.waitFor(() => expect(frames.some((frame) => frame.events.some((event) => event.aggregateId === 'own'))).toBe(true))
    cleanup.pop()!() // The domain closes before its database and temporary folders.
    expect(onEnd).toHaveBeenCalledOnce()
    stream.close()
    await expect(client.rpc('session.get', { sessionId: 'own' })).rejects.toMatchObject({ code: 'unavailable' })
  })
})
