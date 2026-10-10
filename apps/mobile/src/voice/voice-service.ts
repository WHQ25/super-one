import { sameVoice, redactVoiceText, VOICE_START_TIMEOUT_MS, VOICE_DISCONNECT_GRACE_MS, type VoiceCapability, type VoiceIdentity, type VoiceSession, type VoiceSignal, type VoiceStatus } from '@superone/shared/realtime-voice'
import { isCodexAccountProvider } from '@superone/shared/codex-accounts'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import type { HarnessId } from '@superone/shared/agent-types'
import { SILENT_VOICE_LEVELS, VoiceAudioLevelStore, type VoiceAudioLevels } from './voice-audio-levels'

export type VoiceMedia = {
  offer(): Promise<string>; answer(sdp: string): Promise<void>
  inputMuted(muted: boolean): void; outputMuted(muted: boolean): void
  readyCue?(): void
  close(): void
}
export type VoiceMediaPort = {
  available(): boolean
  open(signal: AbortSignal, onState: (state: 'ready' | 'disconnected' | 'failed') => void, onLevels?: (levels: VoiceAudioLevels) => void): Promise<VoiceMedia>
}
export type VoiceControlPort = {
  status(): Promise<VoiceStatus>
  start(attemptId: string, sdp: string): Promise<VoiceStatus>
  stop(attemptId: string, session?: VoiceSession): Promise<unknown>
  ready(identity: VoiceIdentity): Promise<unknown>
}
export type VoiceTarget = VoiceSession & { title?: string; harnessId?: string }
export type MobileVoiceState = {
  phase: 'idle' | 'starting' | 'active' | 'stopping' | 'denied' | 'error'
  target: VoiceTarget | null; inputMuted: boolean; outputMuted: boolean
  error: string | null
}
type Attempt = {
  id: string; control: VoiceControlPort; abort: AbortController; media?: VoiceMedia
  identity?: VoiceIdentity; ready: boolean; reportingReady: boolean
  timer?: ReturnType<typeof setTimeout>; mediaGrace?: ReturnType<typeof setTimeout>; controlGrace?: ReturnType<typeof setTimeout>
}
export class MicrophoneDeniedError extends Error {}
const initialState = (): MobileVoiceState => ({ phase: 'idle', target: null, inputMuted: false, outputMuted: false, error: null })

/** App-lifetime service. Chat navigation/reduction never owns native media. */
export class MobileVoiceService {
  readonly audioLevels = new VoiceAudioLevelStore()
  private state = initialState()
  private listeners = new Set<() => void>()
  private attempt: Attempt | null = null
  private preparing: AbortController | null = null
  private nextId = 0
  private lastStart?: { target: VoiceTarget; control: VoiceControlPort }
  private stoppedId?: string
  private pendingStopCleanup?: () => void
  constructor(private readonly mediaPort: VoiceMediaPort, private readonly makeId = () => `voice-${Date.now()}-${++this.nextId}`) {}
  snapshot = (): MobileVoiceState => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  available(): boolean { return this.mediaPort.available() }
  private update(patch: Partial<MobileVoiceState>): void {
    this.state = { ...this.state, ...patch }
    if (this.state.phase !== 'active') this.audioLevels.publish(SILENT_VOICE_LEVELS)
    for (const listener of this.listeners) listener()
  }
  private current(attempt: Attempt): boolean { return this.attempt === attempt && !attempt.abort.signal.aborted }

  /** Reserve the local start before creating an empty backing session. No media opens here. */
  async startNew(prepare: (signal: AbortSignal) => Promise<VoiceTarget>, control: (target: VoiceTarget) => VoiceControlPort): Promise<void> {
    if (this.preparing || this.attempt || this.state.phase === 'stopping') return
    if (!this.available()) { this.update({ phase: 'error', error: 'Rebuild the mobile app to enable voice.' }); return }
    const abort = new AbortController()
    this.preparing = abort
    this.lastStart = undefined
    this.update({ ...initialState(), phase: 'starting' })
    const fail = (error: unknown) => {
      if (this.preparing !== abort) return
      this.preparing = null
      abort.abort()
      this.update({ phase: 'error', error: error instanceof Error ? redactVoiceText(error.message) : 'Voice could not start.' })
    }
    const timer = setTimeout(() => fail(new Error('Voice connection timed out.')), VOICE_START_TIMEOUT_MS)
    try {
      const target = await prepare(abort.signal)
      if (this.preparing !== abort || abort.signal.aborted) return
      const ports = control(target)
      this.preparing = null
      clearTimeout(timer)
      await this.start(target, ports)
    } catch (error) { fail(error) }
    finally { clearTimeout(timer) }
  }

  async start(target: VoiceTarget, control: VoiceControlPort): Promise<void> {
    if (this.preparing || this.attempt || this.state.phase === 'stopping') return
    if (!this.available()) { this.update({ phase: 'error', target, error: 'Rebuild the mobile app to enable voice.' }); return }
    const attempt: Attempt = { id: this.makeId(), control, abort: new AbortController(), ready: false, reportingReady: false }
    this.lastStart = { target, control }
    this.stoppedId = undefined
    this.attempt = attempt
    this.state = { ...initialState(), phase: 'starting', target }
    this.update({})
    attempt.timer = setTimeout(() => this.fail(attempt, new Error('Voice connection timed out.')), VOICE_START_TIMEOUT_MS)
    try {
      const status = await control.status()
      if (!this.current(attempt)) return
      if (!status.supported) throw new Error(status.reason ?? 'Voice is unavailable on this desktop.')
      if (status.call) {
        // Reconcile an old phone process/uncertain cancellation before acquiring capture.
        if (!status.call.owned) throw new Error('Another voice call is active on this desktop.')
        await control.stop(status.call.attemptId, status.call)
        if (!this.current(attempt)) return
        if ((await control.status()).call) throw new Error('Voice cleanup pending. Try again after reconnecting.')
      }
      if (!this.current(attempt)) return
      const media = await this.mediaPort.open(attempt.abort.signal, state => this.mediaState(attempt, state), levels => {
        if (!this.current(attempt) || this.state.phase !== 'active') return
        this.audioLevels.publish({ input: this.state.inputMuted ? 0 : levels.input, output: this.state.outputMuted ? 0 : levels.output })
      })
      if (!this.current(attempt)) { media.close(); return }
      attempt.media = media
      const sdp = await media.offer()
      if (!this.current(attempt)) return
      const started = await control.start(attempt.id, sdp)
      if (!this.current(attempt)) return
      if (!started.call || !started.call.owned || started.call.attemptId !== attempt.id) throw new Error('Voice start was not accepted.')
      if (attempt.identity && !sameVoice(attempt.identity, started.call)) throw new Error('Voice start identity changed.')
      attempt.identity = started.call
      this.reportReady(attempt)
    } catch (error) { this.fail(attempt, error) }
  }
  signal(signal: VoiceSignal, session: VoiceSession): void {
    const attempt = this.attempt
    const target = this.state.target
    if (!attempt || !target || target.sessionId !== session.sessionId || target.projectPath !== session.projectPath || signal.attemptId !== attempt.id) return
    if (attempt.identity && !sameVoice(attempt.identity, signal)) return
    attempt.identity = signal
    if (signal.kind === 'answer') {
      if (this.state.phase !== 'starting' || !attempt.media) return
      void attempt.media.answer(signal.sdp).catch(error => this.fail(attempt, error))
    } else if (signal.kind === 'closed') this.end(attempt)
    else if (signal.kind === 'error') this.fail(attempt, new Error(signal.error))
    else if (signal.state === 'stopping') this.update({ phase: 'stopping' })
  }
  private mediaState(attempt: Attempt, state: 'ready' | 'disconnected' | 'failed'): void {
    if (!this.current(attempt)) return
    if (state === 'ready') {
      clearTimeout(attempt.mediaGrace); attempt.mediaGrace = undefined
      attempt.ready = true; this.reportReady(attempt)
    } else if (state === 'failed') this.fail(attempt, new Error('Voice media connection failed.'))
    else if (!attempt.mediaGrace) {
      attempt.mediaGrace = setTimeout(() => this.fail(attempt, new Error('Voice media disconnected.')), VOICE_DISCONNECT_GRACE_MS)
    }
  }
  private reportReady(attempt: Attempt): void {
    if (!this.current(attempt) || !attempt.identity || !attempt.ready || attempt.reportingReady) return
    attempt.reportingReady = true
    void attempt.control.ready(attempt.identity).then(() => {
      if (!this.current(attempt)) return
      clearTimeout(attempt.timer)
      this.update({ phase: 'active' })
      try { attempt.media?.readyCue?.() } catch { /* a UI cue cannot end a ready call */ }
    }).catch(error => this.fail(attempt, error))
  }
  connection(connected: boolean): void {
    if (!connected && this.preparing) this.stop()
    const attempt = this.attempt
    if (!attempt) return
    if (!connected) {
      if (!attempt.controlGrace) attempt.controlGrace = setTimeout(() => this.fail(attempt, new Error('Desktop disconnected. Voice ended.')), VOICE_DISCONNECT_GRACE_MS)
      return
    }
    void attempt.control.status().then(status => {
      if (!this.current(attempt)) return
      if (!attempt.identity && this.state.phase === 'starting' && !status.call) return
      if (!status.call?.owned || status.call.attemptId !== attempt.id || (attempt.identity && !sameVoice(attempt.identity, status.call))) {
        this.fail(attempt, new Error('Desktop voice session ended.'))
      } else { clearTimeout(attempt.controlGrace); attempt.controlGrace = undefined }
    }).catch(() => { /* the existing grace timer bounds control recovery */ })
  }
  muteInput(): void {
    if (!this.attempt) return
    const muted = !this.state.inputMuted
    this.attempt.media?.inputMuted(muted); this.update({ inputMuted: muted })
    if (muted) this.audioLevels.publish({ ...this.audioLevels.snapshot(), input: 0 })
  }
  muteOutput(): void {
    if (!this.attempt) return
    const muted = !this.state.outputMuted
    this.attempt.media?.outputMuted(muted); this.update({ outputMuted: muted })
    if (muted) this.audioLevels.publish({ ...this.audioLevels.snapshot(), output: 0 })
  }
  background(): void { this.stop() }
  retry(): void { if (this.lastStart) void this.start(this.lastStart.target, this.lastStart.control) }
  stop(afterPaint?: (cleanup: () => void) => void): void {
    this.preparing?.abort()
    this.preparing = null
    const attempt = this.attempt
    if (!attempt) {
      if (this.state.phase === 'stopping') { if (!afterPaint) this.pendingStopCleanup?.(); return }
      this.lastStart = undefined; this.update(initialState()); return
    }
    this.update({ phase: 'stopping' })
    this.attempt = null
    this.stoppedId = attempt.id
    this.lastStart = undefined
    // Silence immediately. UI hangup may yield a frame before synchronous native teardown;
    // background/disconnect still release capture immediately through the default path.
    try { attempt.media?.inputMuted(true) } catch { /* teardown still releases a failed track */ }
    try { attempt.media?.outputMuted(true) } catch { /* teardown still releases failed playback */ }
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      this.pendingStopCleanup = undefined
      this.disposeMedia(attempt)
      void attempt.control.stop(attempt.id).catch(() => {}).finally(() => {
        if (!this.attempt && this.stoppedId === attempt.id) this.update(initialState())
      })
    }
    if (afterPaint) { this.pendingStopCleanup = cleanup; afterPaint(cleanup) }
    else cleanup()
  }
  private fail(attempt: Attempt, error: unknown): void {
    if (!this.current(attempt)) return
    this.disposeMedia(attempt)
    void attempt.control.stop(attempt.id).catch(() => {})
    this.attempt = null
    this.update({ phase: error instanceof MicrophoneDeniedError ? 'denied' : 'error', error: error instanceof Error ? redactVoiceText(error.message) : 'Voice could not start.' })
  }
  private end(attempt: Attempt): void {
    if (this.attempt !== attempt) return
    this.disposeMedia(attempt); this.attempt = null
    this.update({ phase: 'idle', target: null, error: null })
  }
  private disposeMedia(attempt: Attempt): void {
    this.audioLevels.publish(SILENT_VOICE_LEVELS)
    attempt.abort.abort()
    clearTimeout(attempt.timer); clearTimeout(attempt.mediaGrace); clearTimeout(attempt.controlGrace)
    attempt.media?.close(); attempt.media = undefined
  }
}

export function supportedVoice(capability?: VoiceCapability, harnessId?: HarnessId, providerId?: string | null): boolean {
  return capability?.protocol === 1 && capability.supported === true
    && (!harnessId || HARNESS_CAPABILITIES[harnessId]?.supportsRealtimeVoice === true)
    && (!providerId || isCodexAccountProvider(providerId))
}
