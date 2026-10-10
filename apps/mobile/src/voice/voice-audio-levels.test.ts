import { afterEach, expect, it, vi } from 'vitest'
import { monitorVoiceAudioLevels, VoiceAudioLevelStore, VoiceAudioStatsReader } from './voice-audio-levels'

afterEach(() => vi.useRealTimers())
const report = (input: object, output: object) => new Map<string, unknown>([
  ['mic', { type: 'media-source', kind: 'audio', ...input }],
  ['speaker', { type: 'inbound-rtp', kind: 'audio', ...output }],
  ['video', { type: 'inbound-rtp', kind: 'video', audioLevel: 1 }],
  ['remote-feedback', { type: 'remote-inbound-rtp', kind: 'audio', audioLevel: 1 }],
])

it('reads microphone and decoded playback separately without video or remote feedback', () => {
  const reader = new VoiceAudioStatsReader()
  expect(reader.read(report({ audioLevel: 0.08 }, { audioLevel: 0.2 }))).toEqual({ input: 0.08, output: 0.2 })
  expect(reader.read(report({ audioLevel: NaN }, { audioLevel: Infinity }))).toEqual({ input: 0, output: 0 })
  expect(reader.read(report({ audioLevel: -1 }, { audioLevel: 2 }))).toEqual({ input: 0, output: 1 })
})

it('uses interval energy for fresh RMS and makes a stalled playback stream silent', () => {
  const reader = new VoiceAudioStatsReader()
  reader.read(report({ totalAudioEnergy: 1, totalSamplesDuration: 10 }, { totalAudioEnergy: 2, totalSamplesDuration: 10 }))
  const next = reader.read(report({ totalAudioEnergy: 1.004, totalSamplesDuration: 10.1 }, { totalAudioEnergy: 2.009, totalSamplesDuration: 10.1, audioLevel: 1 }))
  expect(next.input).toBeCloseTo(0.2)
  expect(next.output).toBeCloseTo(0.3)
  expect(reader.read(report({ totalAudioEnergy: 1.004, totalSamplesDuration: 10.1, audioLevel: 1 }, { totalAudioEnergy: 2.009, totalSamplesDuration: 10.1, audioLevel: 1 }))).toEqual({ input: 0, output: 0 })
})

it('does not animate from lifetime energy and handles a reset or removed track', () => {
  const reader = new VoiceAudioStatsReader()
  expect(reader.read(report({ totalAudioEnergy: 5, totalSamplesDuration: 10 }, {}))).toEqual({ input: 0, output: 0 })
  expect(reader.read(report({ totalAudioEnergy: 0, totalSamplesDuration: 0, audioLevel: 0.1 }, {}))).toEqual({ input: 0.1, output: 0 })
  reader.read(new Map())
  expect(reader.read(report({ totalAudioEnergy: 1, totalSamplesDuration: 1 }, {}))).toEqual({ input: 0, output: 0 })
})

it('never overlaps stats reads, silences a stalled read, and discards results after close', async () => {
  vi.useFakeTimers()
  let finish!: (value: ReadonlyMap<string, unknown>) => void
  const getStats = vi.fn(() => new Promise<ReadonlyMap<string, unknown>>(resolve => { finish = resolve }))
  const publish = vi.fn()
  const close = monitorVoiceAudioLevels({ getStats }, publish)
  await vi.advanceTimersByTimeAsync(500)
  expect(getStats).toHaveBeenCalledTimes(1)
  expect(publish).toHaveBeenLastCalledWith({ input: 0, output: 0 })
  close(); finish(report({ audioLevel: 0.5 }, { audioLevel: 0.5 }))
  await vi.advanceTimersByTimeAsync(500)
  expect(getStats).toHaveBeenCalledTimes(1)
  expect(publish.mock.calls.every(([levels]) => levels.input === 0 && levels.output === 0)).toBe(true)
})

it('samples an existing peer at 10 Hz, recovers from stats failure, and stops its timer', async () => {
  vi.useFakeTimers()
  const getStats = vi.fn(async () => report({ audioLevel: 0.1 }, { audioLevel: 0.2 }))
  getStats.mockRejectedValueOnce(new Error('Native stats unavailable'))
  const publish = vi.fn()
  const close = monitorVoiceAudioLevels({ getStats }, publish)
  await vi.advanceTimersByTimeAsync(0)
  expect(publish).toHaveBeenLastCalledWith({ input: 0, output: 0 })
  await vi.advanceTimersByTimeAsync(100)
  expect(publish).toHaveBeenLastCalledWith({ input: 0.1, output: 0.2 })
  close(); await vi.advanceTimersByTimeAsync(1000)
  expect(getStats).toHaveBeenCalledTimes(2)
})

it('publishes independent meter samples and removes a detached UI subscriber', () => {
  const store = new VoiceAudioLevelStore()
  const listener = vi.fn()
  const unsubscribe = store.subscribe(listener)
  store.publish({ input: 0.1, output: 0.3 })
  store.publish({ input: 0.1, output: 0.3 })
  expect(listener).toHaveBeenCalledTimes(1)
  unsubscribe(); store.publish({ input: 0, output: 0 })
  expect(listener).toHaveBeenCalledTimes(1)
  expect(store.snapshot()).toEqual({ input: 0, output: 0 })
})
