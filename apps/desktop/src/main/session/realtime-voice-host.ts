import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { randomUUID } from 'node:crypto'
import { isCodexAccountProvider } from '@superone/shared/codex-accounts'
import { assertVoiceAccount, validateVoiceAttempt, validateVoiceStart, sameVoice, redactVoiceText, VoiceCleanupPendingError, VOICE_DISCONNECT_GRACE_MS, VOICE_START_TIMEOUT_MS, type VoiceCapability, type VoiceIdentity, type VoiceSignal, type VoiceStatus } from '@superone/shared/realtime-voice'
import type { AgentEvent, RealtimeVoiceStartRequest } from '@superone/shared/agent-types'
import type { Session } from './types'

export type VoiceEndpoint = { id: string; deviceId?: string; onDisconnect?: (listener: () => void) => () => void; send(signal: VoiceSignal): void }
type Call = VoiceIdentity & {
  session: Session; endpoint: VoiceEndpoint; state: 'starting' | 'active' | 'stopping'
  settled: boolean; ended: boolean; cancelled: boolean; stopSent: boolean
  release: () => void; unsubscribe: () => void; lifecycle: () => void
  windowCleanup?: () => void
  timer?: ReturnType<typeof setTimeout>; disconnect?: ReturnType<typeof setTimeout>
}

export function voiceCapability(session: Session | null | undefined): VoiceCapability {
  if (!session || !HARNESS_CAPABILITIES[session.snapshot.harnessId]?.supportsRealtimeVoice) return { protocol: 1, supported: false, reason: 'Voice is unavailable for this agent.' }
  const provider = session.getApiProviderId(true)
  if (provider && !isCodexAccountProvider(provider)) return { protocol: 1, supported: false, reason: 'Voice requires an official Codex account.' }
  return { protocol: 1, supported: true }
}

/** Host-wide admission. Session remains the owner of authorization and interests. */
export class RealtimeVoiceHost {
  readonly epoch = randomUUID()
  private generation = 0
  private call: Call | null = null
  private retired = new Set<string>()

  private key(endpoint: VoiceEndpoint, attemptId: string): string { return JSON.stringify([endpoint.id, attemptId]) }
  private retire(key: string): void {
    this.retired.add(key)
    if (this.retired.size > 128) this.retired.delete(this.retired.values().next().value!)
  }
  status(session: Session, endpoint: VoiceEndpoint): VoiceStatus {
    const call = this.call
    return { ...voiceCapability(session), call: call ? {
      ...this.identity(call), projectPath: call.session.projectPath, sessionId: call.session.id,
      state: call.state, owned: call.endpoint.id === endpoint.id,
    } : null }
  }
  private identity(call: Call): VoiceIdentity {
    return { hostEpoch: call.hostEpoch, callId: call.callId, generation: call.generation, attemptId: call.attemptId }
  }
  private emit(call: Call, signal: Omit<Extract<VoiceSignal, { kind: 'state' }>, keyof VoiceIdentity> | { kind: 'answer'; sdp: string } | { kind: 'closed'; reason?: string } | { kind: 'error'; error: string }): void {
    if (this.call !== call) return
    try { call.endpoint.send({ ...this.identity(call), ...signal }) } catch { /* disconnect cleanup owns delivery failure */ }
  }

  start(session: Session, endpoint: VoiceEndpoint, attemptId: string, request: RealtimeVoiceStartRequest): VoiceStatus {
    validateVoiceAttempt(attemptId)
    validateVoiceStart(request)
    const key = this.key(endpoint, attemptId)
    if (this.retired.has(key)) throw new Error('Voice attempt already ended. Start a new call.')
    if (this.call) {
      if (this.call.endpoint.id === endpoint.id && this.call.attemptId === attemptId && this.call.session === session) return this.status(session, endpoint)
      throw new Error('Another voice call is already starting or active on this desktop.')
    }
    const capability = voiceCapability(session)
    if (!capability.supported) throw new Error(capability.reason)
    assertVoiceAccount(session.getApiProviderId(true), request.selection?.apiProviderId)
    const release = session.retainRealtimeVoice(endpoint.deviceId)
    const call: Call = {
      hostEpoch: this.epoch, callId: randomUUID(), generation: ++this.generation, attemptId,
      session, endpoint, state: 'starting', settled: false, ended: false, cancelled: false, stopSent: false,
      release, unsubscribe: () => {}, lifecycle: () => {},
    }
    this.call = call
    call.windowCleanup = endpoint.onDisconnect?.(() => { void this.stop(session, endpoint, attemptId) })
    call.unsubscribe = session.onRealtimeSignal(event => this.event(call, event))
    call.lifecycle = session.onLifecycle(event => {
      if (event.type === 'closed') { call.ended = true; call.settled = true; this.finish(call, 'Session closed') }
      else if (event.type === 'subscriber_removed' && event.deviceId === endpoint.deviceId && event.reason === 'desktop_kick') void this.stop(session, endpoint, attemptId)
    })
    call.timer = setTimeout(() => {
      this.emit(call, { kind: 'error', error: 'Voice connection timed out.' })
      void this.stop(session, endpoint, attemptId)
    }, VOICE_START_TIMEOUT_MS)
    void this.begin(call, request)
    return this.status(session, endpoint)
  }
  private async begin(call: Call, request: RealtimeVoiceStartRequest): Promise<void> {
    try {
      await call.session.startRealtimeVoice(request)
    } catch (error) {
      this.emit(call, { kind: 'error', error: error instanceof Error ? redactVoiceText(error.message) : 'Voice could not start.' })
      // An explicit start failure is cleaned up by the backend before rejection.
      call.ended ||= !(error instanceof VoiceCleanupPendingError)
      if (!call.ended) {
        call.cancelled = true; call.state = 'stopping'; clearTimeout(call.timer)
      }
    } finally {
      call.settled = true
      if (call.ended) this.finish(call)
      else if (call.cancelled) await this.stopUpstream(call)
    }
  }
  private event(call: Call, event: AgentEvent): void {
    if (this.call !== call) return
    if (event.type === 'realtime_sdp' && !call.cancelled) this.emit(call, { kind: 'answer', sdp: event.sdp })
    else if (event.type === 'realtime_closed') { call.ended = true; if (call.settled) this.finish(call, event.reason ? redactVoiceText(event.reason) : undefined) }
    else if (event.type === 'realtime_error') {
      this.emit(call, { kind: 'error', error: redactVoiceText(event.error) })
      void this.stop(call.session, call.endpoint, call.attemptId)
    }
  }
  ready(session: Session, endpoint: VoiceEndpoint, identity: VoiceIdentity): VoiceStatus {
    const call = this.call
    if (!call || call.session !== session || call.endpoint.id !== endpoint.id || !sameVoice(call, identity) || call.cancelled) throw new Error('Voice call is no longer current.')
    call.state = 'active'
    clearTimeout(call.timer)
    this.emit(call, { kind: 'state', state: 'active' })
    return this.status(session, endpoint)
  }
  async stop(session: Session, endpoint: VoiceEndpoint, attemptId: string): Promise<VoiceStatus> {
    validateVoiceAttempt(attemptId)
    const call = this.call
    if (call?.attemptId === attemptId && (call.endpoint.id !== endpoint.id || call.session !== session)) throw new Error('Voice call belongs to another endpoint or session.')
    if (!call || call.attemptId !== attemptId || call.endpoint.id !== endpoint.id || call.session !== session) {
      this.retire(this.key(endpoint, attemptId))
      return this.status(session, endpoint)
    }
    call.cancelled = true
    call.state = 'stopping'
    clearTimeout(call.timer)
    this.emit(call, { kind: 'state', state: 'stopping' })
    if (call.settled) await this.stopUpstream(call)
    return this.status(session, endpoint)
  }
  private async stopUpstream(call: Call): Promise<void> {
    if (this.call !== call || call.stopSent) return
    call.stopSent = true
    try {
      await call.session.stopRealtimeVoice()
      // The stop receipt is a teardown barrier; the backend drains closed before returning.
      call.ended = true
      this.finish(call)
    } catch {
      call.stopSent = false
      this.emit(call, { kind: 'error', error: 'Voice cleanup pending. Reconnect before starting another call.' })
    }
  }
  private finish(call: Call, reason?: string): void {
    if (this.call !== call) return
    this.emit(call, { kind: 'closed', ...(reason ? { reason } : {}) })
    clearTimeout(call.timer); clearTimeout(call.disconnect)
    call.unsubscribe(); call.lifecycle(); call.windowCleanup?.(); call.release()
    this.retire(this.key(call.endpoint, call.attemptId))
    this.call = null
  }
  disconnected(deviceId: string): void {
    const call = this.call
    if (!call || call.endpoint.deviceId !== deviceId || call.disconnect) return
    call.disconnect = setTimeout(() => { void this.stop(call.session, call.endpoint, call.attemptId) }, VOICE_DISCONNECT_GRACE_MS)
  }
  reconnect(session: Session, endpoint: VoiceEndpoint): void {
    const call = this.call
    if (call?.session !== session || call.endpoint.id !== endpoint.id) return
    // Transport recovery must not release the durable call interest: navigation
    // may have left the chat while this call still owns its Session subscription.
    if (!session.subscribers.has(endpoint.deviceId ?? '')) {
      call.release()
      try { call.release = session.retainRealtimeVoice(endpoint.deviceId) } catch (error) {
        void this.stop(session, call.endpoint, call.attemptId)
        throw error
      }
    }
    clearTimeout(call.disconnect); call.disconnect = undefined
    call.endpoint = endpoint
  }
}
