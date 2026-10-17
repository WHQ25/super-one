import workletUrl from './realtime-audio-worklet.js?worker&url'
import type { VoiceAudioFrame } from './realtime-audio-receiver'

type AudioTrackProcessor = { readable: ReadableStream<VoiceAudioFrame> }

/** Global call playback: the UI owns lifetime, the worker owns PCM reception. */
export class BufferedVoicePlayback {
  private worker?: Worker
  private pendingPort?: MessagePort
  private bufferedFrames = 0
  private node?: AudioWorkletNode
  private closed = false
  private failedOnce = false
  private paused = false
  private pauseVersion = 0
  private readonly receiverAudio = new Audio()
  private readonly context = new AudioContext({ latencyHint: 'interactive', sampleRate: 48_000 })
  constructor(private readonly interrupted: () => void, private readonly failed: (error: Error) => void, private readonly onLevel: (rms: number) => void = () => {}) {
    this.context.onstatechange = () => {
      // Browser/OS audio suspension is an interruption; window blur is not.
      if (!this.closed && this.context.state !== 'running') this.interrupted()
    }
  }
  async connect(stream: MediaStream): Promise<void> {
    if (this.closed) return
    const Processor = (window as unknown as { MediaStreamTrackProcessor?: new (options: { track: MediaStreamTrack }) => AudioTrackProcessor }).MediaStreamTrackProcessor
    const track = stream.getAudioTracks()[0]
    if (!Processor || !track) throw new Error('Update the desktop app to enable buffered voice playback.')
    const readable = new Processor({ track }).readable
    const channel = new MessageChannel()
    this.pendingPort = channel.port1
    try {
      const worker = new Worker(new URL('./realtime-audio-worker.ts', import.meta.url), { type: 'module' })
      this.worker = worker
      worker.onmessage = ({ data }) => {
        if (this.closed) return
        if (data.type === 'error') this.fail(new Error(data.message))
        else if (data.type === 'progress') {
          this.bufferedFrames = data.bufferedFrames
          this.onLevel(this.paused ? 0 : data.level)
        }
      }
      worker.onerror = event => { event.preventDefault(); this.fail(new Error(event.message || 'Voice audio receiver failed.')) }
      worker.onmessageerror = () => this.fail(new Error('Voice audio receiver could not read audio.'))
      // Transfer the untouched native readable, not a reader/proxy created on UI.
      // PCM and consumed ACKs use this dedicated worker <-> worklet channel.
      worker.postMessage({ type: 'start', readable, port: channel.port2, sampleRate: this.context.sampleRate, paused: this.paused }, [readable, channel.port2])
      // Chromium only decodes remote WebRTC while a media sink plays. This sink
      // stays muted/running through output suspension; the worklet is audible.
      this.receiverAudio.muted = true
      this.receiverAudio.srcObject = stream
      await this.receiverAudio.play()
      if (this.closed) return
      await this.context.audioWorklet.addModule(workletUrl)
      if (this.closed) return
      const node = new AudioWorkletNode(this.context, 'superone-voice-playback', { numberOfInputs: 0, outputChannelCount: [1] })
      this.node = node
      node.port.onmessage = ({ data }) => { if (data.type === 'error') this.fail(new Error(data.message)) }
      node.onprocessorerror = () => this.fail(new Error('Voice audio playback failed.'))
      node.port.postMessage({ type: 'attach', port: channel.port1 }, [channel.port1])
      this.pendingPort = undefined
      node.connect(this.context.destination)
      await this.context.resume()
    } finally {
      // Transferred endpoints are detached here; an early close releases the
      // untransferred endpoint and the queued audio it might still own.
      channel.port1.close()
      channel.port2.close()
      this.pendingPort = undefined
      if (!readable.locked) void readable.cancel().catch(() => {})
    }
  }
  private fail(error: Error): void {
    if (this.closed || this.failedOnce) return
    this.failedOnce = true
    this.failed(error)
  }
  pause(): void {
    if (this.closed) return
    this.pauseVersion++
    this.paused = true
    this.onLevel(0)
    this.worker?.postMessage({ type: 'pause', paused: true })
  }
  async resume(): Promise<void> {
    if (this.closed) return
    const version = this.pauseVersion
    await this.context.resume()
    if (this.closed) return
    if (this.context.state !== 'running') throw new Error('Audio playback is unavailable. Try again shortly.')
    if (version !== this.pauseVersion) return
    this.paused = false
    this.worker?.postMessage({ type: 'pause', paused: false })
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    this.onLevel(0)
    this.context.onstatechange = null
    this.receiverAudio.pause()
    this.receiverAudio.srcObject = null
    this.bufferedFrames = 0
    this.pendingPort?.close()
    this.pendingPort = undefined
    const worker = this.worker
    if (worker) {
      this.worker = undefined
      const terminate = () => { clearTimeout(timeout); worker.terminate() }
      const timeout = setTimeout(terminate, 1000)
      worker.onerror = null
      worker.onmessageerror = null
      worker.onmessage = ({ data }) => { if (data.type === 'closed') terminate() }
      worker.postMessage({ type: 'close' })
    }
    if (this.node) { this.node.port.onmessage = null; this.node.onprocessorerror = null; this.node.port.close(); this.node.disconnect() }
    void this.context.close()
  }
}
