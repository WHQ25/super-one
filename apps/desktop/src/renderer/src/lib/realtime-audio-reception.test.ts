// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BufferedVoicePlayback } from './realtime-audio'

type Frame = { numberOfFrames: number; sampleRate: number; copyTo(output: Float32Array): void; close(): void }
let receiver: ReadableStreamDefaultController<Frame>
const nodes: Node[] = []
const contexts: Context[] = []
class Context {
  sampleRate = 48_000; state = 'running'; destination = {}
  onstatechange: (() => void) | null = null
  audioWorklet = { addModule: vi.fn(async () => {}) }
  close = vi.fn(async () => { this.state = 'closed' })
  resume = vi.fn(async () => { this.state = 'running' })
  constructor() { contexts.push(this) }
}
class Node {
  port = { postMessage: vi.fn(), onmessage: null }
  connect = vi.fn(); disconnect = vi.fn()
  constructor() { nodes.push(this) }
}
function frame(samples: number[]): Frame {
  return { numberOfFrames: samples.length, sampleRate: 48_000, copyTo: output => output.set(samples), close: vi.fn() }
}
beforeEach(() => {
  nodes.length = 0; contexts.length = 0
  vi.stubGlobal('AudioContext', Context); vi.stubGlobal('AudioWorkletNode', Node)
  vi.stubGlobal('MediaStreamTrackProcessor', class { readable = new ReadableStream<Frame>({ start(controller) { receiver = controller } }) })
})
afterEach(() => vi.unstubAllGlobals())
const stream = { getAudioTracks: () => [{}] } as unknown as MediaStream

it('keeps receiving in order while the output audio graph is suspended and requires explicit resume', async () => {
  let playback!: BufferedVoicePlayback
  playback = new BufferedVoicePlayback(() => playback.pause(), error => { throw error })
  try {
    await playback.connect(stream)
    contexts[0]!.state = 'suspended'; contexts[0]!.onstatechange?.()
    const first = frame([1, 2]), second = frame([3, 4])
    receiver.enqueue(first); receiver.enqueue(second)
    await vi.waitFor(() => expect(second.close).toHaveBeenCalledTimes(1))
    const sent = nodes[0]!.port.postMessage.mock.calls.map(args => args[0]).filter(message => message.type === 'samples')
    expect(sent.map(message => [...message.samples])).toEqual([[1, 2], [3, 4]])
    expect(contexts[0]!.resume).toHaveBeenCalledTimes(1) // initial connection only
    contexts[0]!.state = 'running'; contexts[0]!.onstatechange?.()
    expect(nodes[0]!.port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'samples' }), expect.any(Array))
    await playback.resume()
    expect(nodes[0]!.port.postMessage).toHaveBeenLastCalledWith({ type: 'pause', paused: false })
  } finally { playback.close() }
})
it('releases a native audio frame arriving at the same time as teardown without enqueueing it', async () => {
  const playback = new BufferedVoicePlayback(() => {}, () => {})
  await playback.connect(stream)
  const late = frame([1, 2]); receiver.enqueue(late); playback.close()
  await vi.waitFor(() => expect(late.close).toHaveBeenCalledTimes(1))
  expect(nodes[0]!.port.postMessage.mock.calls.some(args => args[0].type === 'samples')).toBe(false)
  expect(contexts[0]!.close).toHaveBeenCalledTimes(1)
})
