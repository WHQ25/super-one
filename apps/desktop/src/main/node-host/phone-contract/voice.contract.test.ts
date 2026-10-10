import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { VoiceStatus } from '@superone/shared/realtime-voice'
import { RealtimeVoiceHost } from '../../session/realtime-voice-host'
import { createPhoneMethods } from '../../remote/phone-methods'
import type { Session } from '../../session/types'
import { connectPhone, phoneDomain } from '../phone-endpoint-test-fixtures'

vi.mock('../../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })

describe.each(['lan', 'relay'] as const)('native voice over %s', transport => {
  it('fences private signaling, survives chat navigation and stops on takeover', async () => {
    let session!: Session
    let signal: (event: AgentEvent) => void = () => {}
    const voice = new RealtimeVoiceHost()
    const methods = createPhoneMethods({ agent: {} as never, voice: {
      manager: { getSession: () => session, resumeSession: () => session, realtimeVoice: voice }, preferredVoice: () => '',
    } })
    const { domain, own } = phoneDomain(cleanup, { phoneMethods: methods })
    own.harnessId = 'codex'
    Object.assign(own, {
      retainRealtimeVoice: (deviceId: string) => own.lease.retainVoice(deviceId),
      onLifecycle: (fn: Parameters<Session['onLifecycle']>[0]) => own.lease.onLifecycle(fn),
      onRealtimeSignal: (fn: typeof signal) => { signal = fn; return () => { signal = () => {} } },
      startRealtimeVoice: vi.fn(async () => { own.lease.assertMutation(); signal({ type: 'realtime_sdp', sdp: 'private-answer' }) }),
      stopRealtimeVoice: vi.fn(async () => {}),
    })
    session = own as unknown as Session
    const a = await connectPhone(domain, { transport, deviceId: 'a' })
    const b = await connectPhone(domain, { transport, deviceId: 'b' })
    cleanup.push(a.close, b.close)
    const descriptor = await a.rpc<{ capabilities: { methods: string[] } }>('environment.descriptor')
    expect(descriptor.capabilities.methods).toContain('session.voiceStart')
    const grant = await a.rpc<{ leaseId: string; generation: string }>('session.acquireControl', { sessionId: 'own' })
    const request = { sessionId: 'own', leaseId: grant.leaseId, generation: grant.generation, attemptId: 'one', request: { sdp: 'v=0\na=ice-pwd:private-offer' } }
    await expect(b.rpc('session.voiceStart', request)).rejects.toMatchObject({ code: 'lease_stale' })
    const started = await a.rpc<VoiceStatus>('session.voiceStart', request)
    expect(started.call?.owned).toBe(true)
    expect(a.pushes).toContainEqual({ type: 'client', event: expect.objectContaining({ type: 'realtime_call_signal', sessionId: 'own', signal: expect.objectContaining({ kind: 'answer', sdp: 'private-answer' }) }) })
    expect(JSON.stringify(b.pushes)).not.toContain('private-answer')
    expect(JSON.stringify(await a.rpc('session.load', { sessionId: 'own' }))).not.toContain('private-answer')
    // A voice call owns no transcript topic: navigating away cannot dispose it.
    expect((await a.rpc<VoiceStatus>('session.voiceStatus', { sessionId: 'own' })).call?.callId).toBe(started.call?.callId)
    await a.rpc('session.voiceReady', { ...request, identity: started.call })
    domain.leases.revoke({ environmentId: domain.identity.environmentId, sessionId: 'own' })
    await Promise.resolve(); await Promise.resolve()
    expect(session.stopRealtimeVoice).toHaveBeenCalledTimes(1)
    expect((await b.rpc<VoiceStatus>('session.voiceStatus', { sessionId: 'own' })).call).toBeNull()
    await expect(a.rpc('session.voiceReady', { ...request, identity: started.call })).rejects.toMatchObject({ code: 'lease_stale' })
  })
})
