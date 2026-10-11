import workletUrl from './realtime-audio-worklet.js?worker&url'
import { VoiceResampler } from './voice-resampler'

type AudioFrame = { numberOfFrames: number; sampleRate: number; copyTo(output: Float32Array, options: { planeIndex: number; format: 'f32-planar' }): void; close(): void }
type AudioTrackProcessor = { readable: ReadableStream<AudioFrame> }
const MAX_BUFFER_SECONDS = 300

/** Decoded remote audio keeps arriving while local playback is paused. */
export class BufferedVoicePlayback {
  private reader?: ReadableStreamDefaultReader<AudioFrame>
  private pending: Float32Array[] = []
  private bufferedFrames = 0
  private resampler?: VoiceResampler
  private node?: AudioWorkletNode
  private closed = false
  private paused = false
  private readonly context = new AudioContext({ latencyHint: 'interactive', sampleRate: 48_000 })
  constructor(private readonly interrupted: () => void, private readonly failed: (error: Error) => void) {
    this.context.onstatechange = () => {
      // Browser/OS audio suspension is an interruption; window blur is not.
      if (!this.closed && this.context.state !== 'running') this.interrupted()
    }
  }
  async connect(stream: MediaStream): Promise<void> {
    // Reception must not depend on AudioContext's render clock: OS audio
    // interruptions suspend that clock while WebRTC keeps delivering speech.
    const Processor = (window as unknown as { MediaStreamTrackProcessor?: new (options: { track: MediaStreamTrack }) => AudioTrackProcessor }).MediaStreamTrackProcessor
    const track = stream.getAudioTracks()[0]
    if (!Processor || !track) throw new Error('Update the desktop app to enable buffered voice playback.')
    this.reader = new Processor({ track }).readable.getReader()
    void this.receive().catch(error => { if (!this.closed) this.failed(error instanceof Error ? error : new Error(String(error))) })
    await this.context.audioWorklet.addModule(workletUrl)
    if (this.closed) return
    const node = new AudioWorkletNode(this.context, 'superone-voice-playback', { numberOfInputs: 0, outputChannelCount: [1] })
    node.port.onmessage = ({ data }) => {
      if (data.type === 'error') this.failed(new Error(data.message))
      else if (data.type === 'consumed') this.bufferedFrames = Math.max(0, this.bufferedFrames - data.frames)
    }
    node.port.postMessage({ type: 'pause', paused: this.paused })
    this.node = node
    for (const samples of this.pending) this.send(samples)
    this.pending = []
    node.connect(this.context.destination)
    await this.context.resume()
  }
  private send(samples: Float32Array): void { this.node!.port.postMessage({ type: 'samples', samples }, [samples.buffer as ArrayBuffer]) }
  private async receive(): Promise<void> {
    while (!this.closed && this.reader) {
      const { value: frame, done } = await this.reader.read()
      if (done) return
      try {
        if (this.closed) return
        const input = new Float32Array(frame.numberOfFrames)
        frame.copyTo(input, { planeIndex: 0, format: 'f32-planar' })
        this.resampler ??= new VoiceResampler(frame.sampleRate, this.context.sampleRate)
        const samples = this.resampler.convert(input)
        // Preserve all paused samples. Ignore newly arriving silence while the
        // unread reply drains, so playback eventually returns to the live edge.
        if (!this.paused && this.bufferedFrames > input.length * 2 && !samples.some(value => Math.abs(value) > 0.00001)) continue
        this.bufferedFrames += samples.length
        if (this.bufferedFrames > this.context.sampleRate * MAX_BUFFER_SECONDS) throw new Error('Voice pause buffer is full. End this call and start a new one.')
        if (this.node) this.send(samples); else this.pending.push(samples)
      } finally { frame.close() }
    }
  }
  pause(): void { this.paused = true; this.node?.port.postMessage({ type: 'pause', paused: true }) }
  async resume(): Promise<void> {
    await this.context.resume()
    if (this.closed || this.context.state !== 'running') throw new Error('Audio playback is unavailable. Try again shortly.')
    this.paused = false; this.node?.port.postMessage({ type: 'pause', paused: false })
  }
  close(): void {
    this.closed = true
    this.context.onstatechange = null
    void this.reader?.cancel().catch(() => {})
    this.reader = undefined; this.pending = []; this.bufferedFrames = 0
    this.node?.disconnect()
    void this.context.close()
  }
}
