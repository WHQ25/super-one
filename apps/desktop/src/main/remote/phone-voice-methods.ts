import type { RpcContext } from '@superone/runtime/server'
import type { RealtimeVoiceStartRequest } from '@superone/shared/agent-types'
import { redactVoiceText, type VoiceIdentity } from '@superone/shared/realtime-voice'
import { preferredVoiceRequest } from '../agent/realtime-voice-control'
import { runFencedSessionControl } from '../session/control-context'
import type { SessionManagerImpl } from '../session/session-manager'
import type { VoiceEndpoint } from '../session/realtime-voice-host'
import { phoneMethodText as text, invalidPhoneArgument as invalid } from './phone-method-input'

export interface PhoneVoiceHost {
  manager: Pick<SessionManagerImpl, 'getSession' | 'resumeSession' | 'realtimeVoice'>
  preferredVoice(): string
}
type Handler = (p: Record<string, unknown>, ctx: RpcContext) => unknown | Promise<unknown>

/** Signaling is private to this authenticated connection, never a transcript topic. */
export function createPhoneVoiceMethods(host: PhoneVoiceHost): Record<string, Handler> {
  const method = (operation: 'status' | 'start' | 'stop' | 'ready'): Handler => async (p, ctx) => {
    const clientId = ctx.client.clientSessionId
    if (!clientId.startsWith('phone:') || !ctx.streams) throw Object.assign(new Error('Voice requires a paired phone connection'), { code: 'unsupported' })
    const sessionId = text(p, 'sessionId')
    if (!ctx.sessions?.get(sessionId)) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    const session = host.manager.getSession(sessionId) ?? host.manager.resumeSession(sessionId, { passive: true })
    const endpoint: VoiceEndpoint = {
      id: clientId, deviceId: clientId.slice(6),
      send: signal => ctx.streams!.push({ type: 'client', event: {
        type: 'realtime_call_signal', environmentId: ctx.identity.environmentId,
        sessionId, projectPath: session.projectPath, signal,
      } }),
    }
    const voice = host.manager.realtimeVoice
    if (operation === 'status') {
      voice.reconnect(session, endpoint)
      return voice.status(session, endpoint)
    }
    const proof = { leaseId: text(p, 'leaseId'), generation: text(p, 'generation') }
    ctx.leases.assertValid({ resource: { environmentId: ctx.identity.environmentId, sessionId }, ...proof, holderClientId: clientId })
    try {
      return await runFencedSessionControl(sessionId, clientId, proof, () => {
        session.lease.assertMutation()
        const attemptId = text(p, 'attemptId')
        if (operation === 'stop') return voice.stop(session, endpoint, attemptId)
        if (operation === 'ready') {
          const identity = p.identity as VoiceIdentity | undefined
          if (!identity || identity.attemptId !== attemptId || typeof identity.hostEpoch !== 'string'
            || typeof identity.callId !== 'string' || !Number.isSafeInteger(identity.generation)) throw invalid('invalid voice identity')
          return voice.ready(session, endpoint, identity)
        }
        if (!p.request || typeof p.request !== 'object' || Array.isArray(p.request)) throw invalid('request is required')
        return voice.start(session, endpoint, attemptId, preferredVoiceRequest(p.request as RealtimeVoiceStartRequest, host.preferredVoice()))
      })
    } catch (error) {
      if (error instanceof Error) error.message = redactVoiceText(error.message)
      throw error
    }
  }
  return {
    'session.voiceStatus': method('status'), 'session.voiceStart': method('start'),
    'session.voiceStop': method('stop'), 'session.voiceReady': method('ready'),
  }
}
