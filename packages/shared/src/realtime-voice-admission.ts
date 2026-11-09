import type { AgentEvent, RealtimeVoiceStartRequest } from './agent-types'
import { isCodexAccountProvider } from './codex-accounts'
import { HARNESS_CAPABILITIES } from './harness/harness-capabilities'
import {
  assertVoiceAccount,
  sameVoice,
  validateVoiceAttempt,
  validateVoiceStart,
  redactVoiceText,
  VoiceCleanupPendingError,
  VOICE_SESSION_BUSY_REASON,
  VOICE_START_TIMEOUT_MS,
  type VoiceCapability,
  type VoiceIdentity,
  type VoicePhase,
  type VoiceSignal,
  type VoiceStatus,
} from './realtime-voice'

export function voiceSupport(input: { harnessId?: string | null; apiProviderId?: string | null } | null | undefined): VoiceCapability {
  const harnessId = input?.harnessId
  const caps = harnessId ? HARNESS_CAPABILITIES[harnessId as keyof typeof HARNESS_CAPABILITIES] : undefined
  if (!caps?.supportsRealtimeVoice) return { protocol: 1, supported: false, reason: 'Voice is unavailable for this agent.' }
  if (input?.apiProviderId && !isCodexAccountProvider(input.apiProviderId)) {
    return { protocol: 1, supported: false, reason: 'Voice requires an official Codex account.' }
  }
  return { protocol: 1, supported: true }
}

/** Who is asking, and where the directed signal goes. */
export interface VoiceSeat {
  endpointId: string
  sessionId: string
  projectPath: string
  capability: VoiceCapability
  busy: boolean
  apiProviderId?: string | null
  send(signal: VoiceSignal): void
}

/** The Codex call behind one admitted attempt. */
export interface VoiceLink {
  start(request: RealtimeVoiceStartRequest): Promise<void>
  stop(): Promise<void>
  release?(): void
}

/** Hooks a link uses while its attempt is the admitted one. */
export interface VoiceCallControl {
  readonly current: boolean
  readonly cancelled: boolean
  receive(event: AgentEvent): void
  /** Keep the slot after `closed` until delegated app-server output finishes. */
  setDeferRelease(defer: boolean): void
}

type SignalBody =
  | { kind: 'answer'; sdp: string }
  | { kind: 'state'; state: VoicePhase }
  | { kind: 'closed'; reason?: string }
  | { kind: 'error'; error: string }

interface AdmittedCall {
  endpointId: string
  sessionId: string
  projectPath: string
  attemptId: string
  hostEpoch: string
  callId: string
  generation: number
  state: VoicePhase
  settled: boolean
  ended: boolean
  cancelled: boolean
  stopSent: boolean
  closedSent: boolean
  closing: boolean
  deferRelease: boolean
  seat: VoiceSeat
  link?: VoiceLink
  timer?: ReturnType<typeof setTimeout>
  drainTimer?: ReturnType<typeof setTimeout>
}

function refuse(message: string): Error {
  return Object.assign(new Error(message), { code: 'failed_precondition' })
}

/**
 * One voice call for a process. Desktop windows, phones, and a CLI node each
 * supply a {@link VoiceLink}; admission, directed signals, and teardown are shared.
 * The sentence about another call names "this desktop" because the phone translates that exact text.
 */
export class VoiceAdmissionHost {
  readonly epoch = crypto.randomUUID()
  private generation = 0
  private call: AdmittedCall | null = null
  private readonly retired = new Set<string>()

  private key(endpointId: string, attemptId: string): string {
    return JSON.stringify([endpointId, attemptId])
  }

  private retire(key: string): void {
    this.retired.add(key)
    if (this.retired.size > 128) this.retired.delete(this.retired.values().next().value!)
  }

  private identity(call: AdmittedCall): VoiceIdentity {
    return { hostEpoch: call.hostEpoch, callId: call.callId, generation: call.generation, attemptId: call.attemptId }
  }

  private emit(call: AdmittedCall, signal: SignalBody): void {
    if (this.call !== call) return
    try { call.seat.send({ ...this.identity(call), ...signal }) } catch { /* the endpoint owns delivery failure */ }
  }

  status(seat: VoiceSeat): VoiceStatus {
    const call = this.call
    return {
      ...seat.capability,
      ...(seat.busy ? { startBlockedReason: VOICE_SESSION_BUSY_REASON } : {}),
      call: call ? {
        ...this.identity(call),
        projectPath: call.projectPath,
        sessionId: call.sessionId,
        state: call.state,
        owned: call.endpointId === seat.endpointId,
      } : null,
    }
  }

  current(): { endpointId: string; sessionId: string; attemptId: string } | null {
    const call = this.call
    if (!call) return null
    return { endpointId: call.endpointId, sessionId: call.sessionId, attemptId: call.attemptId }
  }

  /** Point later signals at a reconnected socket for the same endpoint. */
  retarget(endpointId: string, sessionId: string, send: VoiceSeat['send']): boolean {
    const call = this.call
    if (!call || call.endpointId !== endpointId || call.sessionId !== sessionId) return false
    call.seat = { ...call.seat, send }
    return true
  }

  start(seat: VoiceSeat, attemptId: string, request: RealtimeVoiceStartRequest, prepare: (control: VoiceCallControl) => VoiceLink): VoiceStatus {
    validateVoiceAttempt(attemptId)
    validateVoiceStart(request)
    const existing = this.claim(seat, attemptId)
    if (existing) return existing
    if (!seat.capability.supported) throw refuse(seat.capability.reason ?? 'Voice is unavailable for this agent.')
    if (seat.busy) throw refuse(VOICE_SESSION_BUSY_REASON)
    try { assertVoiceAccount(seat.apiProviderId, request.selection?.apiProviderId) }
    catch (error) { throw refuse(error instanceof Error ? error.message : 'Voice requires an official Codex account.') }
    return this.open(seat, attemptId, request, prepare)
  }

  /**
   * Same single call slot as Codex, without an SDP offer or a Codex account.
   * Desktop Doubao uses this. Phones keep using {@link start}.
   */
  startShell(seat: VoiceSeat, attemptId: string, prepare: (control: VoiceCallControl) => VoiceLink): VoiceStatus {
    validateVoiceAttempt(attemptId)
    const existing = this.claim(seat, attemptId)
    if (existing) return existing
    return this.open(seat, attemptId, { sdp: 'v=0\r\n' }, prepare)
  }

  private claim(seat: VoiceSeat, attemptId: string): VoiceStatus | undefined {
    const key = this.key(seat.endpointId, attemptId)
    if (this.retired.has(key)) throw refuse('Voice attempt already ended. Start a new call.')
    if (!this.call) return undefined
    if (this.call.endpointId === seat.endpointId && this.call.attemptId === attemptId && this.call.sessionId === seat.sessionId) {
      return this.status(seat)
    }
    throw refuse('Another voice call is already starting or active on this desktop.')
  }

  private open(seat: VoiceSeat, attemptId: string, request: RealtimeVoiceStartRequest, prepare: (control: VoiceCallControl) => VoiceLink): VoiceStatus {
    const call: AdmittedCall = {
      endpointId: seat.endpointId,
      sessionId: seat.sessionId,
      projectPath: seat.projectPath,
      attemptId,
      hostEpoch: this.epoch,
      callId: crypto.randomUUID(),
      generation: ++this.generation,
      state: 'starting',
      settled: false,
      ended: false,
      cancelled: false,
      stopSent: false,
      closedSent: false,
      closing: false,
      deferRelease: false,
      seat,
    }
    this.call = call
    const thisHost = this
    const control: VoiceCallControl = {
      get current() { return thisHost.call === call },
      get cancelled() { return call.cancelled },
      receive: (event) => { if (thisHost.call === call) thisHost.receive(call, event) },
      setDeferRelease: (defer) => {
        if (thisHost.call !== call) return
        call.deferRelease = defer
        if (!defer && call.closing) thisHost.forceRelease(call)
      },
    }
    let link: VoiceLink
    try { link = prepare(control) }
    catch (error) {
      this.call = null
      throw error
    }
    call.link = link
    call.timer = setTimeout(() => {
      if (this.call !== call || call.state !== 'starting') return
      this.emit(call, { kind: 'error', error: 'Voice connection timed out.' })
      void this.stop(call.seat, attemptId)
    }, VOICE_START_TIMEOUT_MS)
    call.timer.unref?.()
    void this.begin(call, request)
    return this.status(seat)
  }

  private async begin(call: AdmittedCall, request: RealtimeVoiceStartRequest): Promise<void> {
    try {
      await call.link?.start(request)
    } catch (error) {
      if (this.call !== call) return
      this.emit(call, { kind: 'error', error: error instanceof Error ? redactVoiceText(error.message) : 'Voice could not start.' })
      if (error instanceof VoiceCleanupPendingError) {
        call.cancelled = true
        call.state = 'stopping'
        clearTimeout(call.timer)
      } else {
        call.ended = true
      }
    } finally {
      call.settled = true
      if (this.call !== call) return
      if (call.ended) this.finish(call)
      else if (call.cancelled) await this.stopUpstream(call)
    }
  }

  private receive(call: AdmittedCall, event: AgentEvent): void {
    if (this.call !== call) return
    if (event.type === 'realtime_sdp' && !call.cancelled) this.emit(call, { kind: 'answer', sdp: event.sdp })
    else if (event.type === 'realtime_closed') {
      call.ended = true
      if (call.settled) this.finish(call, event.reason ? redactVoiceText(event.reason) : undefined)
    } else if (event.type === 'realtime_error') {
      this.emit(call, { kind: 'error', error: redactVoiceText(event.error) })
      void this.stop(call.seat, call.attemptId)
    }
  }

  /** The backing session went away. Emits `closed` and frees the slot. */
  end(reason: string): void {
    const call = this.call
    if (!call) return
    call.ended = true
    call.settled = true
    this.finish(call, reason)
  }

  ready(seat: VoiceSeat, identity: VoiceIdentity): VoiceStatus {
    const call = this.call
    if (!call || call.sessionId !== seat.sessionId || call.endpointId !== seat.endpointId || !sameVoice(call, identity) || call.cancelled) {
      throw refuse('Voice call is no longer current.')
    }
    call.state = 'active'
    clearTimeout(call.timer)
    this.emit(call, { kind: 'state', state: 'active' })
    return this.status(seat)
  }

  async stop(seat: VoiceSeat, attemptId: string): Promise<VoiceStatus> {
    validateVoiceAttempt(attemptId)
    const call = this.call
    if (call?.attemptId === attemptId && (call.endpointId !== seat.endpointId || call.sessionId !== seat.sessionId)) {
      throw refuse('Voice call belongs to another endpoint or session.')
    }
    if (!call || call.attemptId !== attemptId || call.endpointId !== seat.endpointId || call.sessionId !== seat.sessionId) {
      this.retire(this.key(seat.endpointId, attemptId))
      return this.status(seat)
    }
    call.cancelled = true
    call.state = 'stopping'
    clearTimeout(call.timer)
    this.emit(call, { kind: 'state', state: 'stopping' })
    if (call.settled) await this.stopUpstream(call)
    return this.status(seat)
  }

  private async stopUpstream(call: AdmittedCall): Promise<void> {
    if (this.call !== call || call.stopSent) return
    call.stopSent = true
    try {
      await call.link?.stop()
      call.ended = true
      this.finish(call)
    } catch {
      call.stopSent = false
      this.emit(call, { kind: 'error', error: 'Voice cleanup pending. Reconnect before starting another call.' })
    }
  }

  private finish(call: AdmittedCall, reason?: string): void {
    if (this.call !== call) return
    if (!call.closedSent) {
      call.closedSent = true
      this.emit(call, { kind: 'closed', ...(reason ? { reason } : {}) })
    }
    if (call.deferRelease) {
      call.closing = true
      if (!call.drainTimer) {
        call.drainTimer = setTimeout(() => this.forceRelease(call), 10_000)
        call.drainTimer.unref?.()
      }
      return
    }
    this.forceRelease(call)
  }

  private forceRelease(call: AdmittedCall): void {
    if (this.call !== call) return
    clearTimeout(call.timer)
    clearTimeout(call.drainTimer)
    try { call.link?.release?.() } catch { /* unsubscribe is best-effort */ }
    this.retire(this.key(call.endpointId, call.attemptId))
    this.call = null
  }

  /** Drop the in-process call without a signal. Tests use this so the start timer cannot leak. */
  reset(): void {
    const call = this.call
    if (!call) return
    clearTimeout(call.timer)
    clearTimeout(call.drainTimer)
    try { call.link?.release?.() } catch { /* unsubscribe is best-effort */ }
    this.call = null
  }
}
