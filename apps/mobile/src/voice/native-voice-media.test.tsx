import { beforeEach, expect, it, jest } from '@jest/globals'
import { DeviceEventEmitter } from 'react-native'
import { nativeVoiceMedia } from './native-voice-media'
import { VOICE_READY_CUE_MIC_GUARD_MS } from '@superone/shared/voice-ready-cue'

const mockTracks = [{ enabled: true, stop: jest.fn() }, { enabled: true, stop: jest.fn() }]
const mockStream = { getTracks: () => mockTracks, getAudioTracks: () => mockTracks, release: jest.fn() }
const mockGetUserMedia = jest.fn(async (_constraints?: unknown) => mockStream)
const mockPermission = jest.fn(async (_options?: unknown) => true)
const mockPeerClose = jest.fn()
const mockInCallStop = jest.fn()
const mockSpeaker = jest.fn()
const mockCueStart = jest.fn(); const mockCueStop = jest.fn()
const mockStats = jest.fn(async () => new Map<string, unknown>([
  ['mic', { type: 'media-source', kind: 'audio', audioLevel: 0.1 }],
  ['speaker', { type: 'inbound-rtp', kind: 'audio', audioLevel: 0.2 }],
]))
jest.mock('react-native-webrtc', () => ({
  permissions: { request: (options: unknown) => mockPermission(options) },
  mediaDevices: { getUserMedia: (constraints: unknown) => mockGetUserMedia(constraints) },
  RTCPeerConnection: class { connectionState = 'new'; close = mockPeerClose; getStats = mockStats; addEventListener() {}; createDataChannel() {}; addTrack() {} },
}))
jest.mock('react-native-incall-manager', () => ({ __esModule: true, default: { start: jest.fn(), stop: () => mockInCallStop(), startRingback: (source: string) => mockCueStart(source), stopRingback: () => mockCueStop(), setKeepScreenOn: jest.fn(), turnScreenOff: jest.fn(), turnScreenOn: jest.fn(), getIsWiredHeadsetPluggedIn: async () => ({ isWiredHeadsetPluggedIn: false }), setForceSpeakerphoneOn: (enabled: boolean | null) => mockSpeaker(enabled) } }))
beforeEach(() => { jest.clearAllMocks(); for (const track of mockTracks) track.enabled = true; mockPermission.mockResolvedValue(true); mockGetUserMedia.mockResolvedValue(mockStream) })

it('guards native capture for the cue, preserves user mute, and cancels playback on close', async () => {
  jest.useFakeTimers()
  try {
    const media = await nativeVoiceMedia.open(new AbortController().signal, () => {})
    media.readyCue!(); media.readyCue!()
    expect(mockCueStart).toHaveBeenCalledTimes(1)
    expect(mockTracks.every(track => !track.enabled)).toBe(true)
    media.inputMuted(true)
    await jest.advanceTimersByTimeAsync(VOICE_READY_CUE_MIC_GUARD_MS)
    expect(mockTracks.every(track => !track.enabled)).toBe(true)
    media.inputMuted(false)
    expect(mockTracks.every(track => track.enabled)).toBe(true)
    media.close()
    expect(mockCueStop).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  } finally { jest.useRealTimers() }
})

it('binds automatic phone routing for the call and removes it on hangup', async () => {
  const media = await nativeVoiceMedia.open(new AbortController().signal, () => {})
  expect(mockSpeaker).toHaveBeenCalledWith(true)
  DeviceEventEmitter.emit('Proximity', { isNear: true })
  expect(mockSpeaker).toHaveBeenLastCalledWith(false)
  DeviceEventEmitter.emit('Proximity', { isNear: false })
  expect(mockSpeaker).toHaveBeenLastCalledWith(true)
  media.close()
  const calls = mockSpeaker.mock.calls.length
  DeviceEventEmitter.emit('Proximity', { isNear: true })
  expect(mockSpeaker).toHaveBeenCalledTimes(calls)
})

it('meters capture and playback on the same native peer and removes the sampling timer on hangup', async () => {
  jest.useFakeTimers()
  try {
    const levels = jest.fn()
    const media = await nativeVoiceMedia.open(new AbortController().signal, () => {}, levels)
    await jest.advanceTimersByTimeAsync(0)
    expect(levels).toHaveBeenLastCalledWith({ input: 0.1, output: 0.2 })
    expect(mockGetUserMedia).toHaveBeenCalledTimes(1)
    media.close()
    await jest.advanceTimersByTimeAsync(1000)
    expect(mockStats).toHaveBeenCalledTimes(1)
    expect(levels).toHaveBeenLastCalledWith({ input: 0, output: 0 })
  } finally { jest.useRealTimers() }
})

it('releases every late capture track and the native stream after cancellation', async () => {
  let complete!: (value: typeof mockStream) => void
  let captureStarted!: () => void
  const started = new Promise<void>(resolve => { captureStarted = resolve })
  mockGetUserMedia.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; captureStarted() }))
  const abort = new AbortController()
  const pending = nativeVoiceMedia.open(abort.signal, () => {})
  await started
  abort.abort(); complete(mockStream)
  await expect(pending).rejects.toThrow(/cancelled/)
  for (const track of mockTracks) expect(track.stop).toHaveBeenCalledTimes(1)
  expect(mockStream.release).toHaveBeenCalledTimes(1)
})
it('stops native capture, peer, and audio route exactly once on abort', async () => {
  const abort = new AbortController()
  const media = await nativeVoiceMedia.open(abort.signal, () => {})
  abort.abort(); media.close()
  for (const track of mockTracks) expect(track.stop).toHaveBeenCalledTimes(1)
  expect(mockStream.release).toHaveBeenCalledTimes(1)
  expect(mockPeerClose).toHaveBeenCalledTimes(1)
  expect(mockInCallStop).toHaveBeenCalledTimes(1)
})

it('does not acquire capture when permission resolves after cancellation', async () => {
  let permitted!: (value: boolean) => void
  mockPermission.mockImplementationOnce(() => new Promise(resolve => { permitted = resolve }))
  const abort = new AbortController()
  const pending = nativeVoiceMedia.open(abort.signal, () => {})
  abort.abort(); permitted(true)
  await expect(pending).rejects.toThrow(/cancelled/)
  expect(mockGetUserMedia).not.toHaveBeenCalled()
})
it('continues releasing all capture tracks and audio focus even if peer teardown throws', async () => {
  const abort = new AbortController()
  const media = await nativeVoiceMedia.open(abort.signal, () => {})
  mockPeerClose.mockImplementationOnce(() => { throw new Error('already closed') })
  expect(() => media.close()).not.toThrow()
  for (const track of mockTracks) expect(track.stop).toHaveBeenCalledTimes(1)
  expect(mockStream.release).toHaveBeenCalledTimes(1)
  expect(mockInCallStop).toHaveBeenCalledTimes(1)
})
