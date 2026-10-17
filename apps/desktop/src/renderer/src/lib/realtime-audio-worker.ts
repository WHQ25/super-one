import { VoiceAudioReceiver, type VoiceAudioFrame } from './realtime-audio-receiver'

type ReceiverCommand =
  | { type: 'start'; readable: ReadableStream<VoiceAudioFrame>; port: MessagePort; sampleRate: number; paused: boolean }
  | { type: 'pause'; paused: boolean }
  | { type: 'close' }

let receiver: VoiceAudioReceiver | undefined
// Chromium exposes the audio TrackProcessor on Window. Its native readable must
// be transferred before getReader(), so reception runs here even when UI is busy.
self.onmessage = ({ data }: MessageEvent<ReceiverCommand>) => {
  if (data.type === 'start') {
    receiver = new VoiceAudioReceiver(data.readable, data.port, data.sampleRate, data.paused, progress => self.postMessage(progress))
    void receiver.receive().catch(error => self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }))
  } else if (data.type === 'pause') receiver?.pause(data.paused)
  else if (data.type === 'close') {
    void Promise.resolve(receiver?.close()).finally(() => self.postMessage({ type: 'closed' }))
  }
}
