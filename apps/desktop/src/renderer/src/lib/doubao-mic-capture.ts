import captureUrl from './doubao-capture-worklet.js?worker&url'
import { DOUBAO_UPLINK_SAMPLE_RATE } from '@superone/shared/doubao-realtime'
import { floatToS16le, pcmRms } from './pcm-audio'
import { VoiceResampler } from './voice-resampler'

/** Captures the microphone and hands the renderer ~100 ms of 16 kHz PCM. */
export async function startDoubaoMicCapture(
  stream: MediaStream,
  onPcm: (pcm: Uint8Array, rms: number) => void,
): Promise<() => void> {
  const context = new AudioContext({ latencyHint: 'interactive' })
  let closed = false
  context.onstatechange = () => {
    if (closed || context.state === 'running' || context.state === 'closed') return
    void context.resume()
  }
  await context.audioWorklet.addModule(captureUrl)
  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'superone-doubao-capture')
  const resampler = new VoiceResampler(context.sampleRate, DOUBAO_UPLINK_SAMPLE_RATE)
  const silent = context.createGain()
  silent.gain.value = 0
  node.port.onmessage = ({ data }) => {
    if (!(data.samples instanceof Float32Array) || data.samples.length === 0) return
    onPcm(floatToS16le(resampler.convert(data.samples)), pcmRms(data.samples))
  }
  source.connect(node)
  node.connect(silent)
  silent.connect(context.destination)
  await context.resume()
  return () => {
    closed = true
    context.onstatechange = null
    node.port.onmessage = null
    node.disconnect()
    source.disconnect()
    silent.disconnect()
    void context.close()
  }
}
