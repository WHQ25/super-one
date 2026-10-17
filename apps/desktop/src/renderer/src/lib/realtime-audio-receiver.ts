import { VoiceResampler } from './voice-resampler'

export type VoiceAudioFrame = {
  numberOfFrames: number
  sampleRate: number
  copyTo(output: Float32Array, options: { planeIndex: number; format: 'f32-planar' }): void
  close(): void
}
export type VoiceAudioProgress = { type: 'progress'; bufferedFrames: number; level: number }

/** Runs in the receiver worker. Neither PCM nor consumption ACKs pass through UI. */
export class VoiceAudioReceiver {
  private readonly reader: ReadableStreamDefaultReader<VoiceAudioFrame>
  private bufferedFrames = 0
  private resampler?: VoiceResampler
  private sourceRate?: number
  private closed = false
  private closing?: Promise<void>
  private paused: boolean
  private reportedAt = 0

  constructor(readable: ReadableStream<VoiceAudioFrame>, private readonly port: MessagePort,
    private readonly sampleRate: number, paused: boolean,
    private readonly report: (progress: VoiceAudioProgress) => void) {
    this.reader = readable.getReader()
    this.paused = paused
    port.onmessage = ({ data }) => {
      if (this.closed || data.type !== 'consumed') return
      this.bufferedFrames = Math.max(0, this.bufferedFrames - data.frames)
      this.progress(this.paused ? 0 : data.level ?? 0)
    }
    port.start()
    this.pause(paused)
  }

  pause(paused: boolean): void {
    if (this.closed) return
    this.paused = paused
    // Controls and samples share one ordered channel into the render thread.
    this.port.postMessage({ type: 'pause', paused })
    this.progress(0)
  }

  async receive(): Promise<void> {
    try {
      while (!this.closed) {
        const { value: frame, done } = await this.reader.read()
        if (done) return
        try {
          if (this.closed) return
          const input = new Float32Array(frame.numberOfFrames)
          frame.copyTo(input, { planeIndex: 0, format: 'f32-planar' })
          if (this.sourceRate !== frame.sampleRate) {
            this.sourceRate = frame.sampleRate
            this.resampler = new VoiceResampler(frame.sampleRate, this.sampleRate)
          }
          const samples = this.resampler!.convert(input)
          // Keep paused silence too. During replay, discard new live silence so
          // the unread reply can eventually drain back to the live edge.
          if (!this.paused && this.bufferedFrames > samples.length * 2 && !samples.some(value => Math.abs(value) > 0.00001)) continue
          this.bufferedFrames += samples.length
          if (this.bufferedFrames > this.sampleRate * 300) throw new Error('Voice pause buffer is full. End this call and start a new one.')
          this.port.postMessage({ type: 'samples', samples }, [samples.buffer as ArrayBuffer])
          // Suspended output has no ACKs. Keep the UI's diagnostic count fresh;
          // it is a mirror, never the source of truth for buffer accounting.
          if (this.paused && performance.now() - this.reportedAt >= 100) this.progress(0)
        } finally { frame.close() }
      }
    } finally { await this.close() }
  }

  private progress(level: number): void {
    this.reportedAt = performance.now()
    this.report({ type: 'progress', bufferedFrames: this.bufferedFrames, level })
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    this.port.onmessage = null
    this.port.close()
    this.closing = this.reader.cancel().catch(() => {}).then(() => { this.reader.releaseLock() })
    return this.closing
  }
}
