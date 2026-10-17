import { expect, it, vi } from 'vitest'
import { VoiceSampleQueue } from './realtime-audio-worklet.js'
import { VoiceResampler } from './voice-resampler'

it('preserves the unread position across several paused arrivals and partial reads', () => {
  const queue = new VoiceSampleQueue(20)
  queue.push(new Float32Array([1, 2, 3]))
  const first = new Float32Array(2); queue.read(first)
  queue.push(new Float32Array([4, 5])); queue.push(new Float32Array([6]))
  const resumed = new Float32Array(4); queue.read(resumed)
  expect([...first]).toEqual([1, 2]); expect([...resumed]).toEqual([3, 4, 5, 6]); expect(queue.length).toBe(0)
})
it('keeps decoded samples arriving during pause and resumes the processor at its unread cursor', async () => {
  type Processor = { port: { onmessage?: (event: { data: { type: string; paused: boolean } }) => void }; process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean }
  let ProcessorClass!: new () => Processor
  vi.stubGlobal('sampleRate', 48_000)
  vi.stubGlobal('AudioWorkletProcessor', class { port = { onmessage: undefined, postMessage: vi.fn() } })
  vi.stubGlobal('registerProcessor', (_name: string, constructor: typeof ProcessorClass) => { ProcessorClass = constructor })
  try {
    vi.resetModules(); await import('./realtime-audio-worklet.js')
    const processor = new ProcessorClass()
    const render = (samples: number[]) => { const output = new Float32Array(2); processor.process([[new Float32Array(samples)]], [[output]]); return [...output] }
    expect(render([1, 2])).toEqual([1, 2])
    processor.port.onmessage?.({ data: { type: 'pause', paused: true } })
    expect(render([3, 4])).toEqual([0, 0]); expect(render([5, 6])).toEqual([0, 0])
    processor.port.onmessage?.({ data: { type: 'pause', paused: false } })
    expect(render([0, 0])).toEqual([3, 4]); expect(render([0, 0])).toEqual([5, 6])
  } finally { vi.unstubAllGlobals(); vi.resetModules() }
})
it('fails explicitly instead of overwriting unheard audio when full', () => {
  const queue = new VoiceSampleQueue(3)
  queue.push(new Float32Array([1, 2, 3]))
  expect(() => queue.push(new Float32Array([4]))).toThrow(/buffer is full/)
  const result = new Float32Array(3); queue.read(result); expect([...result]).toEqual([1, 2, 3])
})
it('resamples continuously across received frame boundaries without restarting the playback cursor', () => {
  const fragmented = new VoiceResampler(32_000, 48_000)
  const whole = new VoiceResampler(32_000, 48_000)
  const result = [...fragmented.convert(new Float32Array([1, 2])), ...fragmented.convert(new Float32Array([3, 4]))]
  const expected = [...whole.convert(new Float32Array([1, 2, 3, 4]))]
  expect(result.length).toBe(expected.length)
  result.forEach((sample, index) => expect(sample).toBeCloseTo(expected[index]!))
})


it('meters the audio actually played, including buffered replies and the silence after they drain', async () => {
  type Processor = { port: { onmessage?: (event: { data: { type: string; samples?: Float32Array; paused?: boolean } }) => void; postMessage: ReturnType<typeof vi.fn> }; process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean }
  let ProcessorClass!: new () => Processor
  vi.stubGlobal('sampleRate', 480)
  vi.stubGlobal('AudioWorkletProcessor', class { port = { onmessage: undefined, postMessage: vi.fn() } })
  vi.stubGlobal('registerProcessor', (_name: string, constructor: typeof ProcessorClass) => { ProcessorClass = constructor })
  try {
    vi.resetModules(); await import('./realtime-audio-worklet.js')
    const processor = new ProcessorClass()
    processor.port.onmessage?.({ data: { type: 'pause', paused: true } })
    processor.port.onmessage?.({ data: { type: 'samples', samples: new Float32Array(48).fill(0.1) } })
    const tick = () => processor.process([], [[new Float32Array(48)]])
    tick()
    expect(processor.port.postMessage).not.toHaveBeenCalled()
    processor.port.onmessage?.({ data: { type: 'pause', paused: false } })
    tick()
    expect(processor.port.postMessage).toHaveBeenLastCalledWith({ type: 'consumed', frames: 48, level: expect.closeTo(0.1) })
    tick()
    expect(processor.port.postMessage).toHaveBeenLastCalledWith({ type: 'consumed', frames: 0, level: 0 })
  } finally { vi.unstubAllGlobals(); vi.resetModules() }
})

it('sends playback ACKs directly to the receiver port while keeping fatal errors on the UI control port', async () => {
  const { MessageChannel } = await import('node:worker_threads')
  type Processor = {
    port: { onmessage?: (event: { data: unknown }) => void; postMessage: ReturnType<typeof vi.fn> }
    queue: { length: number }; paused: boolean
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
  }
  let ProcessorClass!: new () => Processor
  vi.stubGlobal('sampleRate', 10)
  vi.stubGlobal('AudioWorkletProcessor', class { port = { onmessage: undefined, postMessage: vi.fn() } })
  vi.stubGlobal('registerProcessor', (_name: string, constructor: typeof ProcessorClass) => { ProcessorClass = constructor })
  const { port1, port2 } = new MessageChannel()
  const consumed: unknown[] = []
  port2.on('message', data => consumed.push(data))
  try {
    vi.resetModules(); await import('./realtime-audio-worklet.js')
    const processor = new ProcessorClass()
    processor.port.onmessage?.({ data: { type: 'attach', port: port1 } })
    port2.postMessage({ type: 'pause', paused: true })
    port2.postMessage({ type: 'samples', samples: new Float32Array([0.25, 0.5]) })
    await vi.waitFor(() => expect(processor.queue.length).toBe(2))
    const pausedOutput = new Float32Array(2)
    processor.process([], [[pausedOutput]])
    expect([...pausedOutput]).toEqual([0, 0]); expect(consumed).toEqual([])
    port2.postMessage({ type: 'pause', paused: false })
    await vi.waitFor(() => expect(processor.paused).toBe(false))
    const output = new Float32Array(2); processor.process([], [[output]])
    expect([...output]).toEqual([0.25, 0.5])
    await vi.waitFor(() => expect(consumed).toEqual([{ type: 'consumed', frames: 2, level: expect.closeTo(Math.sqrt(0.15625)) }]))
    expect(processor.port.postMessage).not.toHaveBeenCalled()
    port2.postMessage({ type: 'samples', samples: new Float32Array(3001) })
    await vi.waitFor(() => expect(processor.port.postMessage).toHaveBeenCalledWith({ type: 'error', message: expect.stringMatching(/buffer is full/) }))
    expect(processor.process([], [[new Float32Array(2)]])).toBe(false)
  } finally { port1.close(); port2.close(); vi.unstubAllGlobals(); vi.resetModules() }
})
