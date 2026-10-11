import { afterEach, beforeEach, expect, it, jest } from '@jest/globals'
import { waitFor } from '@testing-library/react-native'
import { AppState, DeviceEventEmitter, PermissionsAndroid, Platform, type AppStateStatus } from 'react-native'
import { nativeVoiceMedia } from './native-voice-media'
import { MobileVoiceService } from './voice-service'
import { bindVoiceLifecycle } from './voice-lifecycle'
import { VOICE_READY_CUE_MIC_GUARD_MS } from '@superone/shared/voice-ready-cue'

const mockTracks = [{ enabled: true, stop: jest.fn() }, { enabled: true, stop: jest.fn() }]
const mockStream = { getTracks: () => mockTracks, getAudioTracks: () => mockTracks, release: jest.fn() }
const mockGetUserMedia = jest.fn(async (_constraints?: unknown) => mockStream)
const mockPermission = jest.fn(async (_options?: unknown) => true)
const mockPeerClose = jest.fn()
const mockInCallStart = jest.fn()
const mockInCallStop = jest.fn()
const mockSpeaker = jest.fn()
const mockCueStart = jest.fn(); const mockCueStop = jest.fn()
const mockStats = jest.fn(async () => new Map<string, unknown>([
  ['mic', { type: 'media-source', kind: 'audio', audioLevel: 0.1 }],
  ['speaker', { type: 'inbound-rtp', kind: 'audio', audioLevel: 0.2 }],
]))
const mockAudio = { start: jest.fn(async () => {}), stop: jest.fn(async () => {}), pause: jest.fn(async () => {}), resume: jest.fn(async () => {}), addListener: jest.fn(() => ({ remove: jest.fn() })) }
jest.mock('./native-voice-audio', () => ({ nativeVoiceAudio: () => mockAudio }))
jest.mock('react-native-webrtc', () => ({
  permissions: { request: (options: unknown) => mockPermission(options) },
  mediaDevices: { getUserMedia: (constraints: unknown) => mockGetUserMedia(constraints) },
  RTCPeerConnection: class {
    connectionState = 'new'; iceGatheringState = 'complete'; localDescription = { sdp: 'offer' }
    close = mockPeerClose; getStats = mockStats
    async createOffer() { return this.localDescription }; async setLocalDescription() {}
    addEventListener() {}; createDataChannel() {}; addTrack() {}
  },
}))
jest.mock('react-native-incall-manager', () => ({ __esModule: true, default: { start: (options: unknown) => mockInCallStart(options), stop: () => mockInCallStop(), startRingback: (source: string) => mockCueStart(source), stopRingback: () => mockCueStop(), setKeepScreenOn: jest.fn(), turnScreenOff: jest.fn(), turnScreenOn: jest.fn(), getIsWiredHeadsetPluggedIn: async () => ({ isWiredHeadsetPluggedIn: false }), setForceSpeakerphoneOn: (enabled: boolean | null) => mockSpeaker(enabled) } }))
beforeEach(() => { jest.clearAllMocks(); AppState.currentState = 'active'; for (const track of mockTracks) track.enabled = true; mockPermission.mockResolvedValue(true); mockGetUserMedia.mockResolvedValue(mockStream) })
afterEach(() => { jest.restoreAllMocks() })

function appStateFixture() {
  jest.replaceProperty(AppState, 'currentState', 'active')
  const listeners = new Set<(state: AppStateStatus) => void>()
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.add(listener)
    return { remove: () => { listeners.delete(listener) } }
  })
  const appState = (state: AppStateStatus) => {
    AppState.currentState = state
    for (const listener of [...listeners]) listener(state)
  }
  return { appState, listeners }
}

function androidFixture() {
  jest.replaceProperty(Platform, 'OS', 'android')
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(36)
  return appStateFixture()
}

it('continues one Android start through both permission activities and keeps the call on later background', async () => {
  const { appState } = androidFixture()
  const service = new MobileVoiceService({ ...nativeVoiceMedia, available: () => true }, () => 'attempt')
  const target = { projectPath: '/repo', sessionId: 'session' }
  const idle = { protocol: 1 as const, supported: true, call: null }
  const control = { status: jest.fn(async () => idle), stop: jest.fn(async () => idle), ready: jest.fn(async () => idle),
    start: jest.fn(async () => ({ ...idle, call: { ...target, attemptId: 'attempt', callId: 'call', hostEpoch: 'host', generation: 1, owned: true, state: 'starting' as const } })) }
  const dispose = bindVoiceLifecycle(AppState, () => service.background(), () => service.stop())
  const permissionActivity = () => {
    appState('background'); appState('active')
  }
  mockPermission.mockImplementationOnce(async () => { permissionActivity(); return true })
  const bluetooth = jest.spyOn(PermissionsAndroid, 'request').mockImplementation(async () => {
    permissionActivity(); return PermissionsAndroid.RESULTS.GRANTED
  })
  try {
    await service.start(target, control)
    expect(mockPermission).toHaveBeenCalledTimes(1)
    expect(control.start).toHaveBeenCalledTimes(1)
    expect(bluetooth).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT)
    expect(mockGetUserMedia).toHaveBeenCalledTimes(1)
    appState('background')
    expect(mockStream.release).not.toHaveBeenCalled()
    expect(control.stop).not.toHaveBeenCalled()
    expect(mockAudio.start).toHaveBeenCalledTimes(1)
  } finally {
    dispose()
  }
})

it.each(['microphone', 'bluetooth'] as const)('waits for foreground after a %s result before capturing', async permission => {
  const { appState, listeners } = androidFixture()
  const bluetooth = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED)
  if (permission === 'microphone') mockPermission.mockImplementationOnce(async () => { appState('background'); return true })
  else bluetooth.mockImplementationOnce(async () => { appState('background'); return PermissionsAndroid.RESULTS.GRANTED })
  const guard = jest.fn()
  const mediaPending = nativeVoiceMedia.open(new AbortController().signal, () => {}, undefined, guard)
  await waitFor(() => expect(listeners.size).toBe(1))
  expect(guard).toHaveBeenLastCalledWith(true)
  expect(mockGetUserMedia).not.toHaveBeenCalled()
  if (permission === 'microphone') expect(bluetooth).not.toHaveBeenCalled()
  appState('active')
  const media = await mediaPending
  expect(guard).toHaveBeenLastCalledWith(false)
  expect(mockGetUserMedia).toHaveBeenCalledTimes(1)
  expect(listeners.size).toBe(0)
  media.close()
})

it('cancels the foreground wait without acquiring capture or retaining a lifecycle listener', async () => {
  const { appState, listeners } = androidFixture()
  mockPermission.mockImplementationOnce(async () => { appState('background'); return true })
  const abort = new AbortController(); const guard = jest.fn()
  const pending = nativeVoiceMedia.open(abort.signal, () => {}, undefined, guard)
  await waitFor(() => expect(listeners.size).toBe(1))
  abort.abort()
  await expect(pending).rejects.toThrow(/cancelled/)
  expect(guard).toHaveBeenLastCalledWith(false)
  expect(mockGetUserMedia).not.toHaveBeenCalled()
  expect(listeners.size).toBe(0)
})

it('clears the permission guard on microphone denial and allows phone audio after Bluetooth denial', async () => {
  androidFixture()
  const guard = jest.fn()
  mockPermission.mockResolvedValueOnce(false)
  await expect(nativeVoiceMedia.open(new AbortController().signal, () => {}, undefined, guard)).rejects.toThrow(/Microphone access denied/)
  expect(guard).toHaveBeenLastCalledWith(false)
  expect(mockGetUserMedia).not.toHaveBeenCalled()
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValueOnce(PermissionsAndroid.RESULTS.DENIED)
  const media = await nativeVoiceMedia.open(new AbortController().signal, () => {}, undefined, guard)
  expect(guard).toHaveBeenLastCalledWith(false)
  expect(mockGetUserMedia).toHaveBeenCalledTimes(1)
  media.close()
})

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

const androidDevices = (...available: string[]) => DeviceEventEmitter.emit('onAudioDeviceChanged', { availableAudioDeviceList: JSON.stringify(available) })
const routeListeners = () => ['onAudioDeviceChanged', 'Proximity'].map(event => DeviceEventEmitter.listenerCount(event))

it.each<{ name: string, devices: string[], speaker: boolean | null }>([
  { name: 'phone', devices: ['SPEAKER_PHONE', 'EARPIECE'], speaker: true },
  { name: 'Bluetooth', devices: ['SPEAKER_PHONE', 'EARPIECE', 'BLUETOOTH'], speaker: null },
])('routes Android $name audio from the device list native start emits before capture resolves', async ({ devices, speaker }) => {
  androidFixture()
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED)
  // Native start emits its only initial device list while JS still awaits capture.
  mockInCallStart.mockImplementationOnce(() => androidDevices(...devices))
  const media = await nativeVoiceMedia.open(new AbortController().signal, () => {})
  try {
    expect(mockSpeaker).toHaveBeenLastCalledWith(speaker)
    DeviceEventEmitter.emit('Proximity', { isNear: true })
    expect(mockSpeaker).toHaveBeenLastCalledWith(speaker === null ? null : false)
  } finally { media.close() }
})

it.each(['microphone denial', 'capture failure', 'cancelled capture', 'hangup'] as const)('removes Android route listeners after %s', async outcome => {
  androidFixture()
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED)
  const baseline = routeListeners()
  const abort = new AbortController()
  if (outcome === 'microphone denial') mockPermission.mockResolvedValueOnce(false)
  if (outcome === 'capture failure') mockGetUserMedia.mockRejectedValueOnce(new Error('capture failed'))
  if (outcome === 'cancelled capture') mockGetUserMedia.mockImplementationOnce(async () => { abort.abort(); return mockStream })
  const pending = nativeVoiceMedia.open(abort.signal, () => {})
  if (outcome === 'hangup') (await pending).close()
  else await expect(pending).rejects.toThrow()
  expect(routeListeners()).toEqual(baseline)
  androidDevices('SPEAKER_PHONE', 'EARPIECE'); DeviceEventEmitter.emit('Proximity', { isNear: true })
  expect(mockSpeaker).not.toHaveBeenCalledWith(false)
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
  expect(mockAudio.stop).toHaveBeenCalledTimes(1)
})

it('releases background audio immediately on cancellation while capture is still pending', async () => {
  let captured!: (value: typeof mockStream) => void
  mockGetUserMedia.mockImplementationOnce(() => new Promise(resolve => { captured = resolve }))
  const abort = new AbortController()
  const pending = nativeVoiceMedia.open(abort.signal, () => {})
  await waitFor(() => expect(mockGetUserMedia).toHaveBeenCalledTimes(1))
  abort.abort()
  expect(mockAudio.stop).toHaveBeenCalledTimes(1); expect(mockInCallStop).toHaveBeenCalledTimes(1)
  captured(mockStream); await expect(pending).rejects.toThrow(/cancelled/)
  expect(mockStream.release).toHaveBeenCalledTimes(1); expect(mockAudio.stop).toHaveBeenCalledTimes(1)
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
