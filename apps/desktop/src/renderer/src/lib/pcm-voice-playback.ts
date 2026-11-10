import workletUrl from './realtime-audio-worklet.js?worker&url'
import { VOICE_DOWNLINK_SAMPLE_RATE } from '@superone/shared/voice-delegation'
import { s16leToFloat } from './pcm-audio'
import { VoiceResampler } from './voice-resampler'

/** Mic RMS that counts as the user talking over playback. Matches the main-process barge. */
export const DOUBAO_PLAYBACK_BARGE_RMS = 0.08
/** Worklet output above this is still audible. */
export const DOUBAO_PLAYBACK_AUDIBLE_RMS = 0.02
/** Capture hands up ~100 ms at a time. Six loud batches match the 600 ms host window. */
export const DOUBAO_PLAYBACK_BARGE_BATCHES = 6

/**
 * The server can finish an utterance while the worklet is still playing it.
 * Loud mic audio during that tail should clear the queue without waiting for transcription.
 */
export function nextPlaybackBarge(hits: number, micRms: number, outputRms: number): { hits: number; drop: boolean } {
  if (micRms < DOUBAO_PLAYBACK_BARGE_RMS || outputRms < DOUBAO_PLAYBACK_AUDIBLE_RMS) return { hits: 0, drop: false }
  const next = hits + 1
  if (next < DOUBAO_PLAYBACK_BARGE_BATCHES) return { hits: next, drop: false }
  return { hits: 0, drop: true }
}

/** Plays Seeduplex 24 kHz PCM through the same voice worklet Codex uses. */
export class PcmVoicePlayback {
  private node?: AudioWorkletNode
  private closed = false
  private paused = false
  private pauseVersion = 0
  private resumeAttempt = 0
  private resampler = new VoiceResampler(VOICE_DOWNLINK_SAMPLE_RATE, 48_000)
  private readonly context = new AudioContext({ latencyHint: 'interactive', sampleRate: 48_000 })

  constructor(
    private readonly interrupted: () => void,
    private readonly failed: (error: Error) => void,
    private readonly onLevel: (rms: number) => void = () => {},
  ) {
    this.context.onstatechange = () => {
      if (this.closed || this.context.state === 'running') return
      const attempt = ++this.resumeAttempt
      void this.context.resume().then(() => {
        if (this.closed || attempt !== this.resumeAttempt) return
        if (this.context.state !== 'running') this.interrupted()
      }, () => {
        if (!this.closed && attempt === this.resumeAttempt) this.interrupted()
      })
    }
  }

  async start(): Promise<void> {
    if (this.closed) return
    this.resampler = new VoiceResampler(VOICE_DOWNLINK_SAMPLE_RATE, this.context.sampleRate)
    await this.context.audioWorklet.addModule(workletUrl)
    if (this.closed) return
    const node = new AudioWorkletNode(this.context, 'superone-voice-playback', { numberOfInputs: 0, outputChannelCount: [1] })
    this.node = node
    node.port.onmessage = ({ data }) => {
      if (data.type === 'error') this.failed(new Error(data.message))
      else if (data.type === 'consumed') this.onLevel(this.paused ? 0 : data.level)
    }
    node.onprocessorerror = () => this.failed(new Error('Voice audio playback failed.'))
    node.connect(this.context.destination)
    await this.context.resume()
  }

  pushPcm(pcm: Uint8Array): void {
    if (this.closed || pcm.byteLength < 2 || !this.node) return
    const samples = this.resampler.convert(s16leToFloat(pcm))
    if (samples.length === 0) return
    this.node.port.postMessage({ type: 'samples', samples })
  }

  /** Barge-in: drop audio that has not been played yet. */
  drop(): void {
    this.resampler = new VoiceResampler(VOICE_DOWNLINK_SAMPLE_RATE, this.context.sampleRate)
    this.node?.port.postMessage({ type: 'clear' })
    this.onLevel(0)
  }

  pause(): void {
    if (this.closed) return
    this.pauseVersion++
    this.paused = true
    this.onLevel(0)
    this.node?.port.postMessage({ type: 'pause', paused: true })
  }

  async resume(): Promise<void> {
    if (this.closed) return
    const version = this.pauseVersion
    await this.context.resume()
    if (this.closed) return
    if (this.context.state !== 'running') throw new Error('Audio playback is unavailable. Try again shortly.')
    if (version !== this.pauseVersion) return
    this.paused = false
    this.node?.port.postMessage({ type: 'pause', paused: false })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.onLevel(0)
    this.context.onstatechange = null
    if (this.node) {
      this.node.port.onmessage = null
      this.node.onprocessorerror = null
      this.node.port.close()
      this.node.disconnect()
    }
    void this.context.close()
  }
}
