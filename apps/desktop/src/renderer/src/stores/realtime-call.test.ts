// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
const mocks = vi.hoisted(() => ({ cue: vi.fn(), refresh: vi.fn(async () => {}), view: { setRealtimeSession: vi.fn(), setView: vi.fn(), setRealtimeStarting: vi.fn() } }))
vi.mock('@/lib/audio-cue', () => ({ VOICE_READY_CUE_MIC_GUARD_MS: 10, playVoiceReadyCue: mocks.cue }))
vi.mock('@/lib/realtime-webrtc', () => ({ waitForIceGathering: vi.fn(async () => {}), startWebRtcDiagnostics: () => vi.fn(), preferTcpIceCandidates: (sdp: string) => ({ sdp }) }))
vi.mock('./codex-realtime-view', () => ({ refreshCodexRealtimeTimeline: mocks.refresh, useCodexRealtimeViewStore: { getState: () => mocks.view } }))
import { pauseRealtimeCall, realtimeVoiceAudioLevels, resetRealtimeCallForTests, startRealtimeCall, stopRealtimeCall, toggleRealtimeMicrophone, useRealtimeCallStore } from './realtime-call'

const tracks = [{ enabled: true, stop: vi.fn() }]
const stream = { getTracks: () => tracks, getAudioTracks: () => tracks } as unknown as MediaStream
let receive: (event: AgentEvent) => void
const peers: Peer[] = []
class Peer {
  connectionState = 'new'; signalingState = 'stable'; localDescription = { sdp: 'v=0\na=offer' }
  ontrack?: (event: unknown) => void; onconnectionstatechange?: () => void
  getStats = vi.fn(async () => new Map<string, unknown>())
  close = vi.fn(); addTrack = vi.fn(); createDataChannel = vi.fn()
  createOffer = vi.fn(async () => this.localDescription)
  setLocalDescription = vi.fn(async () => {}); setRemoteDescription = vi.fn(async () => {})
  constructor() { peers.push(this) }
}
const microphone = vi.fn(async () => stream)
const start = vi.fn(async (_path: string, sid: string, request: { attemptId: string }) => ({ protocol: 1, supported: true, call: { hostEpoch: 'host', generation: peers.length, callId: `call-${peers.length}`, attemptId: request.attemptId, sessionId: sid, projectPath: '/p', owned: true, state: 'starting' } }))
const stop = vi.fn(async () => {})
const ready = vi.fn(async () => {})
beforeEach(() => {
  vi.clearAllMocks(); peers.length = 0
  microphone.mockResolvedValue(stream); stop.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: microphone } })
  vi.stubGlobal('RTCPeerConnection', Peer)
  Object.assign(window, { agent: { startRealtimeVoice: start, stopRealtimeVoice: stop, readyRealtimeVoice: ready, onAgentEvent: (fn: typeof receive) => { receive = fn; return vi.fn() } } })
})
afterEach(() => { resetRealtimeCallForTests(); vi.unstubAllGlobals(); vi.useRealTimers() })
const options = { projectPath: '/p', sessionId: 'sid', messages: { offerFailed: 'offer failed', connectionTimedOut: 'timeout' } }

it('waits for connected media and host ready acknowledgement, then releases capture immediately on hangup', async () => {
  await startRealtimeCall(options)
  const peer = peers[0]!
  const identity = start.mock.results[0]!.value
  const call = (await identity).call
  receive({ type: 'realtime_call_signal', sessionId: 'sid', signal: { ...call, kind: 'answer', sdp: 'answer' } })
  await Promise.resolve(); expect(useRealtimeCallStore.getState().state).toBe('starting')
  peer.connectionState = 'connected'; peer.onconnectionstatechange?.(); await Promise.resolve()
  expect(useRealtimeCallStore.getState().state).toBe('active')
  expect(ready).toHaveBeenCalledWith('/p', 'sid', expect.objectContaining({ attemptId: call.attemptId }))
  let stopped!: () => void
  stop.mockImplementationOnce(() => new Promise(resolve => { stopped = resolve }))
  const pending = stopRealtimeCall()
  expect(tracks[0]!.stop).toHaveBeenCalledTimes(1); expect(peer.close).toHaveBeenCalledTimes(1)
  stopped(); await pending
  expect(useRealtimeCallStore.getState().state).toBe('idle')
})
it('frees a microphone result arriving after cancellation without submitting an offer', async () => {
  let captured!: (value: MediaStream) => void
  microphone.mockImplementationOnce(() => new Promise(resolve => { captured = resolve }))
  const pending = startRealtimeCall(options)
  await stopRealtimeCall(); captured(stream); await pending
  expect(tracks[0]!.stop).toHaveBeenCalledTimes(1)
  expect(start).not.toHaveBeenCalled()
})
it('ignores a previous peer and generic or stale directed signals after a new attempt starts', async () => {
  await startRealtimeCall(options)
  const oldPeer = peers[0]!, oldCall = (await start.mock.results[0]!.value).call
  await stopRealtimeCall(); await startRealtimeCall(options)
  receive({ type: 'realtime_closed', sessionId: 'sid' })
  receive({ type: 'realtime_sdp', sessionId: 'sid', sdp: 'wrong-answer' })
  receive({ type: 'realtime_call_signal', sessionId: 'sid', signal: { ...oldCall, kind: 'answer', sdp: 'old-answer' } })
  oldPeer.connectionState = 'failed'; oldPeer.onconnectionstatechange?.()
  expect(useRealtimeCallStore.getState().state).toBe('starting')
  expect(peers[1]!.setRemoteDescription).not.toHaveBeenCalled()
  expect(stop).toHaveBeenCalledTimes(1)
  await stopRealtimeCall()
})


it('meters the existing microphone peer without React updates and silences mute, pause and hangup', async () => {
  vi.useFakeTimers()
  await startRealtimeCall(options)
  const peer = peers[0]!
  peer.getStats.mockResolvedValue(new Map([['mic', { type: 'media-source', kind: 'audio', audioLevel: 0.08 }]]))
  peer.connectionState = 'connected'; peer.onconnectionstatechange?.()
  await vi.advanceTimersByTimeAsync(200)
  expect(realtimeVoiceAudioLevels.snapshot().input).toBe(0.08)
  toggleRealtimeMicrophone()
  expect(realtimeVoiceAudioLevels.snapshot().input).toBe(0)
  await vi.advanceTimersByTimeAsync(200)
  expect(realtimeVoiceAudioLevels.snapshot().input).toBe(0)
  realtimeVoiceAudioLevels.publish({ input: 0, output: 0.12 })
  pauseRealtimeCall()
  expect(realtimeVoiceAudioLevels.snapshot()).toEqual({ input: 0, output: 0 })
  await stopRealtimeCall()
  const reads = peer.getStats.mock.calls.length
  await vi.advanceTimersByTimeAsync(1000)
  expect(peer.getStats).toHaveBeenCalledTimes(reads)
  expect(realtimeVoiceAudioLevels.snapshot()).toEqual({ input: 0, output: 0 })
})

it('prepares the selected worktree before requesting microphone access or starting voice', async () => {
  let prepared!: (id: string) => void
  const prepareSession = vi.fn(() => new Promise<string>(resolve => { prepared = resolve }))
  const pending = startRealtimeCall({ ...options, prepareSession })
  await Promise.resolve()
  expect(prepareSession).toHaveBeenCalledTimes(1)
  expect(microphone).not.toHaveBeenCalled()
  expect(start).not.toHaveBeenCalled()
  prepared('prepared-session')
  await pending
  expect(start).toHaveBeenCalledWith('/p', 'prepared-session', expect.any(Object))
  expect(useRealtimeCallStore.getState().sessionId).toBe('prepared-session')
})

it('does not start voice when worktree preparation fails or is cancelled', async () => {
  await startRealtimeCall({ ...options, prepareSession: async () => null })
  expect(microphone).not.toHaveBeenCalled()
  expect(start).not.toHaveBeenCalled()
  expect(useRealtimeCallStore.getState().state).toBe('idle')
})

it('does not start voice after hanging up during worktree preparation', async () => {
  let prepared!: (id: string) => void
  const pending = startRealtimeCall({ ...options, prepareSession: () => new Promise<string>(resolve => { prepared = resolve }) })
  await stopRealtimeCall()
  prepared('sid')
  await pending
  expect(microphone).not.toHaveBeenCalled()
  expect(start).not.toHaveBeenCalled()
})
