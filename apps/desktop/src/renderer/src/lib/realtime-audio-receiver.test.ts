import { MessageChannel } from 'node:worker_threads'
import { afterEach, expect, it, vi } from 'vitest'
import { VoiceAudioReceiver, type VoiceAudioFrame } from './realtime-audio-receiver'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { await Promise.all(cleanups.splice(0).map(close => close())) })
function frame(values: number[], sampleRate = 48_000): VoiceAudioFrame {
  return { numberOfFrames: values.length, sampleRate, copyTo: output => output.set(values), close: vi.fn() }
}
function setup(sampleRate = 48_000, paused = false) {
  let source!: ReadableStreamDefaultController<VoiceAudioFrame>
  const cancel = vi.fn()
  const readable = new ReadableStream<VoiceAudioFrame>({ start(controller) { source = controller }, cancel })
  const { port1, port2 } = new MessageChannel()
  const messages: Array<{ type: string; samples?: Float32Array; paused?: boolean }> = []
  port2.on('message', message => messages.push(message))
  const report = vi.fn()
  const receiver = new VoiceAudioReceiver(readable, port1 as unknown as MessagePort, sampleRate, paused, report)
  const errors: Error[] = []
  const done = receiver.receive().catch(error => { errors.push(error) })
  cleanups.push(async () => { await receiver.close(); await done; port2.close() })
  return { receiver, source, cancel, readable, port: port2, messages, report, errors, done,
    samples: () => messages.filter(message => message.type === 'samples').flatMap(message => [...message.samples!]) }
}

it('preserves speech and silence in arrival order while paused without an audio render clock', async () => {
  const test = setup(48_000, true)
  const first = frame([1, 2]), silence = frame([0, 0]), last = frame([3, 4])
  test.source.enqueue(first); test.source.enqueue(silence); test.source.enqueue(last)
  await vi.waitFor(() => expect(test.samples()).toEqual([1, 2, 0, 0, 3, 4]))
  test.receiver.pause(false)
  await vi.waitFor(() => expect(test.messages.at(-1)).toEqual({ type: 'pause', paused: false }))
  for (const sample of [first, silence, last]) expect(sample.close).toHaveBeenCalledTimes(1)
})
it('accounts for worklet consumption directly even when UI does not handle progress', async () => {
  const test = setup(10)
  test.source.enqueue(frame(Array(3000).fill(1), 10)) // exactly five minutes
  await vi.waitFor(() => expect(test.samples()).toHaveLength(3000))
  test.port.postMessage({ type: 'consumed', frames: 3000, level: 0.25 })
  await vi.waitFor(() => expect(test.report).toHaveBeenLastCalledWith({ type: 'progress', bufferedFrames: 0, level: 0.25 }))
  test.source.enqueue(frame([2], 10)) // would overflow if the ACK needed UI
  await vi.waitFor(() => expect(test.samples()).toHaveLength(3001))
  expect(test.errors).toEqual([])
})
it('ends explicitly at the five minute bound and cancels/releases the native source', async () => {
  const test = setup(10, true)
  const overfull = frame(Array(3001).fill(1), 10)
  test.source.enqueue(overfull)
  await test.done
  expect(test.errors[0]?.message).toMatch(/buffer is full/)
  expect(overfull.close).toHaveBeenCalledTimes(1)
  expect(test.cancel).toHaveBeenCalledTimes(1)
  expect(test.readable.locked).toBe(false)
  expect(test.samples()).toEqual([])
})
it('skips only new live silence behind a backlog and retains paused silence', async () => {
  const test = setup()
  test.source.enqueue(frame([1, 2, 3, 4, 5, 6]))
  const discarded = frame([0]); test.source.enqueue(discarded)
  await vi.waitFor(() => expect(discarded.close).toHaveBeenCalled())
  test.receiver.pause(true)
  const kept = frame([0]); test.source.enqueue(kept)
  await vi.waitFor(() => expect(test.samples()).toEqual([1, 2, 3, 4, 5, 6, 0]))
})
it.each([[44_100, 48_000], [48_000, 44_100], [32_000, 48_000]])('resamples %i Hz input to the actual %i Hz context across frames', async (sourceRate, targetRate) => {
  const test = setup(targetRate)
  const count = sourceRate / 100
  test.source.enqueue(frame(Array(count).fill(0.25), sourceRate))
  test.source.enqueue(frame(Array(count).fill(0.25), sourceRate))
  await vi.waitFor(() => expect(test.samples().length).toBeGreaterThanOrEqual(targetRate / 50 - 1))
  expect(test.samples().length).toBeLessThanOrEqual(targetRate / 50)
  expect(test.samples().every(value => Math.abs(value - 0.25) < 0.00001)).toBe(true)
  // A changed native source format must reset the resampler's rate/boundary.
  const changed = frame([1, 2, 3], targetRate); test.source.enqueue(changed)
  await vi.waitFor(() => expect(test.samples().slice(-3)).toEqual([1, 2, 3]))
})
it('closes a frame delivered concurrently with teardown without sending it', async () => {
  const test = setup()
  const late = frame([1, 2]); test.source.enqueue(late)
  await test.receiver.close(); await test.done
  expect(late.close).toHaveBeenCalledTimes(1)
  expect(test.samples()).toEqual([])
  expect(test.cancel).toHaveBeenCalledTimes(1)
  expect(test.readable.locked).toBe(false)
  await test.receiver.close()
  expect(test.cancel).toHaveBeenCalledTimes(1)
})
it('releases native frames and the reader when copying fails', async () => {
  const test = setup()
  const broken = frame([1]); broken.copyTo = () => { throw new Error('native copy failed') }
  test.source.enqueue(broken); await test.done
  expect(test.errors[0]?.message).toBe('native copy failed')
  expect(broken.close).toHaveBeenCalledTimes(1)
  expect(test.cancel).toHaveBeenCalledTimes(1)
  expect(test.readable.locked).toBe(false)
})
it('propagates source read errors and still releases the reader', async () => {
  const test = setup()
  test.source.error(new Error('native read failed')); await test.done
  expect(test.errors[0]?.message).toBe('native read failed')
  expect(test.readable.locked).toBe(false)
})
it('waits for native cancellation on every concurrent close before acknowledging cleanup', async () => {
  const test = setup()
  let release!: () => void
  test.cancel.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  const first = test.receiver.close()
  let finished = false
  const second = test.receiver.close().then(() => { finished = true })
  await Promise.resolve()
  expect(finished).toBe(false)
  expect(test.readable.locked).toBe(true)
  release(); await Promise.all([first, second, test.done])
  expect(finished).toBe(true); expect(test.readable.locked).toBe(false)
  expect(test.cancel).toHaveBeenCalledTimes(1)
})
