import { VoiceAdmissionHost, voiceSupport, type VoiceSeat } from '@superone/shared/realtime-voice-admission'
import { VOICE_DISCONNECT_GRACE_MS, type VoiceIdentity, type VoiceSignal, type VoiceStatus } from '@superone/shared/realtime-voice'
import type { RealtimeVoiceStartRequest } from '@superone/shared/agent-types'
import type { Session } from './types'
import { runHostReaction } from './control-context'

export type VoiceEndpoint = { id: string; deviceId?: string; onDisconnect?: (listener: () => void) => () => void; send(signal: VoiceSignal): void }

export function voiceCapability(session: { snapshot: Pick<Session['snapshot'], 'harnessId'>; getApiProviderId: Session['getApiProviderId'] } | null | undefined) {
  if (!session) return voiceSupport(null)
  return voiceSupport({ harnessId: session.snapshot.harnessId, apiProviderId: session.getApiProviderId(true) })
}

/**
 * Desktop admission over the shared host. Session remains the owner of the
 * Codex call, the lease, and phone disconnect grace.
 */
export class RealtimeVoiceHost {
  private readonly admission = new VoiceAdmissionHost()
  private bound: { session: Session; endpoint: VoiceEndpoint; attemptId: string } | null = null
  private disconnectTimer?: ReturnType<typeof setTimeout>

  get epoch(): string { return this.admission.epoch }

  private clearDisconnect(): void {
    clearTimeout(this.disconnectTimer)
    this.disconnectTimer = undefined
  }

  private seat(session: Session, endpoint: VoiceEndpoint): VoiceSeat {
    return {
      endpointId: endpoint.id,
      sessionId: session.id,
      projectPath: session.projectPath,
      capability: voiceCapability(session),
      busy: session.snapshot.status === 'streaming',
      apiProviderId: session.getApiProviderId(true),
      send: (signal) => endpoint.send(signal),
    }
  }

  status(session: Session, endpoint: VoiceEndpoint): VoiceStatus {
    return this.admission.status(this.seat(session, endpoint))
  }

  start(session: Session, endpoint: VoiceEndpoint, attemptId: string, request: RealtimeVoiceStartRequest): VoiceStatus {
    return this.admission.start(this.seat(session, endpoint), attemptId, request, (control) => {
      this.bound = { session, endpoint, attemptId }
      const release = session.retainRealtimeVoice(endpoint.deviceId)
      const proof = session.lease.current
      const unsubscribe = session.onRealtimeSignal((event) => control.receive(event))
      const lifecycle = session.onLifecycle((event) => {
        if (event.type === 'closed') this.admission.end('Session closed')
        else if (event.type === 'control_changed' && (!event.lease || event.lease.leaseId !== proof?.leaseId || event.lease.generation !== proof?.generation)) {
          void runHostReaction(() => this.stop(session, endpoint, attemptId))
        }
      })
      const windowCleanup = endpoint.onDisconnect?.(() => { void this.stop(session, endpoint, attemptId) })
      return {
        start: (next) => session.startRealtimeVoice(next),
        stop: () => runHostReaction(() => session.stopRealtimeVoice()),
        release: () => {
          this.clearDisconnect()
          this.bound = null
          unsubscribe()
          lifecycle()
          windowCleanup?.()
          release()
        },
      }
    })
  }

  ready(session: Session, endpoint: VoiceEndpoint, identity: VoiceIdentity): VoiceStatus {
    return this.admission.ready(this.seat(session, endpoint), identity)
  }

  stop(session: Session, endpoint: VoiceEndpoint, attemptId: string): Promise<VoiceStatus> {
    return this.admission.stop(this.seat(session, endpoint), attemptId)
  }

  disconnected(deviceId: string): void {
    const bound = this.bound
    if (!bound || bound.endpoint.deviceId !== deviceId || this.disconnectTimer || !this.admission.current()) return
    this.disconnectTimer = setTimeout(() => {
      const active = this.bound
      const current = this.admission.current()
      if (!active || !current) return
      void runHostReaction(() => this.stop(active.session, active.endpoint, current.attemptId))
      runHostReaction(() => active.session.lease.releaseDelegate(`phone:${deviceId}`))
    }, VOICE_DISCONNECT_GRACE_MS)
  }

  kicked(deviceId: string): void {
    const bound = this.bound
    if (!bound || bound.endpoint.deviceId !== deviceId) return
    void runHostReaction(() => this.stop(bound.session, bound.endpoint, bound.attemptId))
    runHostReaction(() => bound.session.lease.releaseDelegate(`phone:${deviceId}`))
  }

  reconnect(session: Session, endpoint: VoiceEndpoint): void {
    if (!this.admission.retarget(endpoint.id, session.id, (signal) => endpoint.send(signal))) return
    this.clearDisconnect()
    if (this.bound) this.bound = { ...this.bound, session, endpoint }
  }
}
