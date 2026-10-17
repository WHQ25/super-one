// @vitest-environment jsdom
import { MessageChannel } from 'node:worker_threads'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BufferedVoicePlayback } from './realtime-audio'
import { VoiceAudioReceiver, type VoiceAudioFrame } from './realtime-audio-receiver'

let source: ReadableStreamDefaultController<VoiceAudioFrame>
let playResult: Promise<void> | undefined
let moduleResult: Promise<void> | undefined
const cancelSource = vi.fn()
const nodes: Node[] = []
const contexts: Context[] = []
const receivers: ReceiverAudio[] = []
const workers: ReceiverWorker[] = []
class ReceiverAudio {
  muted = false
  srcObject: MediaStream | null = null
  play = vi.fn(() => playResult ?? Promise.resolve())
  pause = vi.fn()
  constructor() { receivers.push(this) }
}
class Context {
  sampleRate = 48_000; state = 'running'; destination = {}
  onstatechange: (() => void) | null = null
  audioWorklet = { addModule: vi.fn(() => moduleResult ?? Promise.resolve()) }
  close = vi.fn(async () => { this.state = 'closed' })
  resume = vi.fn(async () => { this.state = 'running' })
  constructor() { contexts.push(this) }
}
class Node {
  messages: Array<{ type: string; samples?: Float32Array; paused?: boolean }> = []
  audioPort?: MessagePort
  onprocessorerror?: () => void
  port = { postMessage: vi.fn((data: { type: string; port: MessagePort }) => {
    this.audioPort = structuredClone(data.port, { transfer: [data.port] })
    this.audioPort!.onmessage = ({ data }) => this.messages.push(data)
    this.audioPort!.start()
  }), onmessage: null as null | ((event: { data: unknown }) => void), close: vi.fn() }
  connect = vi.fn(); disconnect = vi.fn()
  constructor() { nodes.push(this) }
}
// Mock the Worker browser boundary, keeping the real receiver and actual ports.
class ReceiverWorker {
  onmessage?: (event: { data: unknown }) => void
  onerror?: (event: { message: string; preventDefault(): void }) => void
  onmessageerror?: () => void
  receiver?: VoiceAudioReceiver
  terminate = vi.fn()
  commands: Array<{ type: string; paused?: boolean }> = []
  constructor() { workers.push(this) }
  postMessage(data: { type: string; readable: ReadableStream<VoiceAudioFrame>; port: MessagePort; sampleRate: number; paused: boolean }) {
    this.commands.push(data)
    if (data.type === 'start') {
      const port = structuredClone(data.port, { transfer: [data.port] })
      this.receiver = new VoiceAudioReceiver(data.readable, port, data.sampleRate, data.paused, progress => this.onmessage?.({ data: progress }))
      void this.receiver.receive().catch(error => this.onmessage?.({ data: { type: 'error', message: error.message } }))
    } else if (data.type === 'pause') this.receiver?.pause(data.paused)
    else if (data.type === 'close') void this.receiver?.close().finally(() => this.onmessage?.({ data: { type: 'closed' } }))
  }
}
function frame(samples: number[]): VoiceAudioFrame {
  return { numberOfFrames: samples.length, sampleRate: 48_000, copyTo: output => output.set(samples), close: vi.fn() }
}
beforeEach(() => {
  nodes.length = 0; contexts.length = 0; receivers.length = 0; workers.length = 0
  playResult = undefined; moduleResult = undefined; cancelSource.mockClear()
  vi.stubGlobal('AudioContext', Context); vi.stubGlobal('AudioWorkletNode', Node)
  vi.stubGlobal('Audio', ReceiverAudio); vi.stubGlobal('Worker', ReceiverWorker); vi.stubGlobal('MessageChannel', MessageChannel)
  vi.stubGlobal('MediaStreamTrackProcessor', class { readable = new ReadableStream<VoiceAudioFrame>({ start(controller) { source = controller }, cancel: cancelSource }) })
})
afterEach(async () => {
  await Promise.all(workers.map(worker => worker.receiver?.close()))
  for (const node of nodes) node.audioPort?.close()
  vi.unstubAllGlobals()
})
const stream = { getAudioTracks: () => [{}] } as unknown as MediaStream

it('keeps receiving in order while the output audio graph is suspended and requires explicit resume', async () => {
  let playback!: BufferedVoicePlayback
  playback = new BufferedVoicePlayback(() => playback.pause(), error => { throw error })
  try {
    await playback.connect(stream)
    contexts[0]!.state = 'suspended'; contexts[0]!.onstatechange?.()
    const first = frame([1, 2]), second = frame([3, 4])
    source.enqueue(first); source.enqueue(second)
    await vi.waitFor(() => expect(nodes[0]!.messages.filter(message => message.type === 'samples').map(message => [...message.samples!])).toEqual([[1, 2], [3, 4]]))
    expect(first.close).toHaveBeenCalledTimes(1); expect(second.close).toHaveBeenCalledTimes(1)
    expect(contexts[0]!.resume).toHaveBeenCalledTimes(1)
    expect(receivers[0]!.muted).toBe(true); expect(receivers[0]!.pause).not.toHaveBeenCalled()
    contexts[0]!.state = 'running'; contexts[0]!.onstatechange?.()
    expect(workers[0]!.commands.at(-1)).toEqual({ type: 'pause', paused: true })
    await playback.resume()
    await vi.waitFor(() => expect(nodes[0]!.messages.at(-1)).toEqual({ type: 'pause', paused: false }))
  } finally { playback.close() }
})
it('releases a native frame racing teardown and cleans up once', async () => {
  const playback = new BufferedVoicePlayback(() => {}, () => {})
  await playback.connect(stream)
  const late = frame([1, 2]); source.enqueue(late); playback.close(); playback.close()
  await vi.waitFor(() => expect(workers[0]!.terminate).toHaveBeenCalledTimes(1))
  expect(late.close).toHaveBeenCalledTimes(1)
  expect(nodes[0]!.messages.some(message => message.type === 'samples')).toBe(false)
  expect(contexts[0]!.close).toHaveBeenCalledTimes(1)
  expect(receivers[0]!.pause).toHaveBeenCalledTimes(1); expect(receivers[0]!.srcObject).toBeNull()
  expect(cancelSource).toHaveBeenCalledTimes(1)
})
it.each(['sink', 'worklet'])('does not create late playback when closed during %s startup', async stage => {
  let resolve!: () => void
  const gate = new Promise<void>(done => { resolve = done })
  if (stage === 'sink') playResult = gate; else moduleResult = gate
  const playback = new BufferedVoicePlayback(() => {}, () => {})
  const connected = playback.connect(stream)
  await vi.waitFor(() => expect(stage === 'sink' ? receivers[0]!.play : contexts[0]!.audioWorklet.addModule).toHaveBeenCalled())
  playback.close(); resolve(); await connected
  await vi.waitFor(() => expect(workers[0]!.terminate).toHaveBeenCalledTimes(1))
  expect(nodes).toHaveLength(0); expect(contexts[0]!.resume).not.toHaveBeenCalled()
  expect(cancelSource).toHaveBeenCalledTimes(1)
})
it('keeps a newer pause when an earlier resume is still acquiring output', async () => {
  const playback = new BufferedVoicePlayback(() => {}, () => {})
  try {
    await playback.connect(stream); playback.pause()
    let resolve!: () => void
    contexts[0]!.resume.mockImplementationOnce(() => new Promise<void>(done => { resolve = done }))
    const resumed = playback.resume(); playback.pause(); resolve(); await resumed
    expect(workers[0]!.commands.at(-1)).toEqual({ type: 'pause', paused: true })
  } finally { playback.close() }
})
it('reports receiver and processor failures once and ignores stale failures after closing', async () => {
  const failed = vi.fn()
  const playback = new BufferedVoicePlayback(() => {}, failed)
  await playback.connect(stream)
  workers[0]!.onerror?.({ message: 'worker crashed', preventDefault: vi.fn() })
  nodes[0]!.onprocessorerror?.()
  expect(failed).toHaveBeenCalledTimes(1)
  expect(failed.mock.calls[0]![0].message).toBe('worker crashed')
  playback.close()
  expect(workers[0]!.onerror).toBeNull()
  expect(nodes[0]!.onprocessorerror).toBeNull()
})

it('fences a pending resume and late progress when the call closes', async () => {
  const level = vi.fn()
  const playback = new BufferedVoicePlayback(() => {}, () => {}, level)
  await playback.connect(stream); playback.pause()
  let resolve!: () => void
  contexts[0]!.resume.mockImplementationOnce(() => new Promise<void>(done => { resolve = done }))
  const resumed = playback.resume(); playback.close(); resolve(); await resumed
  workers[0]!.onmessage?.({ data: { type: 'progress', bufferedFrames: 100, level: 0.5 } })
  expect(level).toHaveBeenLastCalledWith(0)
  expect(workers[0]!.commands.some(command => command.type === 'pause' && command.paused === false)).toBe(false)
  expect(contexts[0]!.resume).toHaveBeenCalledTimes(2)
  await playback.resume()
  expect(contexts[0]!.resume).toHaveBeenCalledTimes(2)
})

it('cancels the unlocked native stream if the worker cannot be constructed', async () => {
  vi.stubGlobal('Worker', class { constructor() { throw new Error('worker unavailable') } })
  const playback = new BufferedVoicePlayback(() => {}, () => {})
  try {
    await expect(playback.connect(stream)).rejects.toThrow('worker unavailable')
    expect(cancelSource).toHaveBeenCalledTimes(1)
    expect(nodes).toHaveLength(0)
  } finally { playback.close() }
})
it('keeps the receiver paused when reacquiring the output device fails', async () => {
  const playback = new BufferedVoicePlayback(() => {}, () => {})
  try {
    await playback.connect(stream); playback.pause()
    contexts[0]!.resume.mockRejectedValueOnce(new Error('device unavailable'))
    await expect(playback.resume()).rejects.toThrow('device unavailable')
    expect(workers[0]!.commands.at(-1)).toEqual({ type: 'pause', paused: true })
  } finally { playback.close() }
})
