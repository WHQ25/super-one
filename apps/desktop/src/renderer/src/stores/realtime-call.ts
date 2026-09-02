import { create } from 'zustand'
import { toast } from 'sonner'
import type { AgentEvent } from '@superone/shared/agent-types'
import { preferTcpIceCandidates, startWebRtcDiagnostics, waitForIceGathering } from '@/lib/realtime-webrtc'
import { VOICE_READY_CUE_MIC_GUARD_MS, playVoiceReadyCue } from '@/lib/audio-cue'
import { refreshCodexRealtimeTimeline, useCodexRealtimeViewStore } from './codex-realtime-view'

export type RealtimeCallState = 'idle' | 'starting' | 'active' | 'stopping'
export type RealtimeCallActivity = 'listening' | 'user-speaking' | 'thinking' | 'assistant-speaking'

interface RealtimeCallStore {
  /** Session the live call belongs to; null while idle. */
  sessionId: string | null
  state: RealtimeCallState
  microphoneMuted: boolean
  outputMuted: boolean
  /** Presentation state for the live call indicator. */
  activity: RealtimeCallActivity
  /** Smoothed microphone RMS, normalized to 0...1. */
  inputLevel: number
}

/**
 * A voice call outlives the button that started it — the toolbar entry point and the
 * live indicator above the composer are different components, and either may unmount
 * while the call continues. So the call is owned here rather than by a component:
 * React reads this store, and the media objects below never enter React at all.
 *
 * Only one call runs at a time, which is why this is a singleton and not a map.
 */
export const useRealtimeCallStore = create<RealtimeCallStore>(() => ({
  sessionId: null,
  state: 'idle',
  microphoneMuted: false,
  outputMuted: false,
  activity: 'listening',
  inputLevel: 0,
}))

interface CallMedia {
  projectPath: string
  sessionId: string
  peer: RTCPeerConnection | null
  stream: MediaStream | null
  audio: HTMLAudioElement | null
  stopDiagnostics: (() => void) | null
  unsubscribe: (() => void) | null
  negotiationTimer: number | null
  cueGuardTimer: number | null
  stopInputLevelMonitor: (() => void) | null
  /** True while the ready cue is playing into a live channel. */
  cueGuarded: boolean
  readyCuePlayed: boolean
}

let media: CallMedia | null = null
/** `projectPath::sessionId` whose timeline this renderer already fetched. */
let timelineLoadedFor: string | null = null

const NEGOTIATION_TIMEOUT_MS = 15_000

export interface RealtimeCallMessages {
  offerFailed: string
  connectionTimedOut: string
}

function view() {
  return useCodexRealtimeViewStore.getState()
}

function reportError(error: unknown): void {
  toast.error(error instanceof Error ? error.message : String(error))
}

// Capture can be suppressed for two unrelated reasons — the user muted it, or a cue
// is playing into a live channel. Both write the same track flag, so the flag is
// derived from both instead of either one overwriting the other.
function applyMicrophoneEnabled(): void {
  if (!media) return
  const enabled = !useRealtimeCallStore.getState().microphoneMuted && !media.cueGuarded
  for (const track of media.stream?.getAudioTracks() ?? []) track.enabled = enabled
}

/**
 * Sample the already-open microphone stream for the indicator. This does not add a
 * second capture request or route audio anywhere; the source only feeds an analyser.
 */
function startInputLevelMonitor(stream: MediaStream): () => void {
  if (typeof window.AudioContext !== 'function') return () => {}

  let context: AudioContext | null = null
  try {
    context = new window.AudioContext()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)

    const samples = new Float32Array(analyser.fftSize)
    let frame = 0
    let smoothed = 0
    let published = 0
    const sample = () => {
      analyser.getFloatTimeDomainData(samples)
      let energy = 0
      for (const value of samples) energy += value * value
      const rms = Math.sqrt(energy / samples.length)
      const normalized = Math.min(1, Math.max(0, (rms - 0.012) / 0.16))
      smoothed += (normalized - smoothed) * 0.28
      if (Math.abs(smoothed - published) >= 0.025) {
        published = smoothed
        useRealtimeCallStore.setState({ inputLevel: smoothed })
      }
      frame = window.requestAnimationFrame(sample)
    }
    frame = window.requestAnimationFrame(sample)

    return () => {
      window.cancelAnimationFrame(frame)
      source.disconnect()
      analyser.disconnect()
      void context?.close()
    }
  } catch {
    void context?.close()
    return () => {}
  }
}

function releaseMedia(): void {
  if (!media) return
  if (media.negotiationTimer !== null) window.clearTimeout(media.negotiationTimer)
  if (media.cueGuardTimer !== null) window.clearTimeout(media.cueGuardTimer)
  media.stopInputLevelMonitor?.()
  media.stopDiagnostics?.()
  media.unsubscribe?.()
  for (const track of media.stream?.getTracks() ?? []) track.stop()
  media.peer?.close()
  if (media.audio) media.audio.srcObject = null
  media = null
  useRealtimeCallStore.setState({ inputLevel: 0 })
}

/** Tear the call down locally and return the UI to its resting state. */
function finishCall(sessionId: string, projectPath: string): void {
  releaseMedia()
  useRealtimeCallStore.setState({
    sessionId: null,
    state: 'idle',
    microphoneMuted: false,
    outputMuted: false,
    activity: 'listening',
    inputLevel: 0,
  })
  view().setRealtimeSession(sessionId, null)
  void refreshTimeline(projectPath, sessionId)
}

async function refreshTimeline(projectPath: string, sessionId: string): Promise<void> {
  try {
    await refreshCodexRealtimeTimeline(projectPath, sessionId)
    timelineLoadedFor = `${projectPath}::${sessionId}`
  } catch {
    // Timeline is supplementary; a live call can still proceed.
  }
}

function guardMicrophoneDuringCue(): void {
  if (!media) return
  media.cueGuarded = true
  applyMicrophoneEnabled()
  if (media.cueGuardTimer !== null) window.clearTimeout(media.cueGuardTimer)
  media.cueGuardTimer = window.setTimeout(() => {
    if (!media) return
    media.cueGuardTimer = null
    media.cueGuarded = false
    applyMicrophoneEnabled()
  }, VOICE_READY_CUE_MIC_GUARD_MS)
}

function handleAgentEvent(event: AgentEvent): void {
  const current = media
  if (!current || event.sessionId !== current.sessionId) return
  const { sessionId, projectPath } = current

  if (event.type === 'realtime_started') {
    view().setRealtimeSession(sessionId, event.realtimeSessionId ?? 'live')
    view().setView(sessionId, 'realtime')
    return
  }

  if (event.type === 'realtime_sdp') {
    const peer = current.peer
    if (!peer || peer.signalingState === 'closed') return
    const tcpPreference = preferTcpIceCandidates(event.sdp)
    window.app?.trace?.('realtime.webrtc', 'tcp_preference', {
      applied: tcpPreference.applied,
      tcpCandidateCount: tcpPreference.tcpCandidateCount,
      fallbackCandidateCount: tcpPreference.fallbackCandidateCount,
      reprioritizedCandidateCount: tcpPreference.reprioritizedCandidateCount,
    }, sessionId)
    void peer.setRemoteDescription({ type: 'answer', sdp: tcpPreference.sdp }).then(() => {
      useRealtimeCallStore.setState({ state: 'active', activity: 'listening' })
    }).catch((error) => {
      reportError(error)
      releaseMedia()
      useRealtimeCallStore.setState({ sessionId: null, state: 'idle' })
      view().setRealtimeStarting(sessionId, false)
    })
    return
  }

  if (event.type === 'realtime_transcript_item') {
    if (event.phase === 'delta') {
      view().appendTranscriptItemDelta(sessionId, event.itemId, event.text)
      return
    }
    // `started`/`completed` always carry the item's role and realtime session.
    if (!event.role || !event.realtimeSessionId) return
    const item = {
      itemId: event.itemId,
      realtimeSessionId: event.realtimeSessionId,
      role: event.role,
      text: event.text,
      ...(event.seq === undefined ? {} : { localOrder: event.seq }),
      ...(event.startedAtMs === undefined ? {} : { startedAtMs: event.startedAtMs }),
    }
    if (event.phase === 'started') view().startTranscriptItem(sessionId, item)
    else view().completeTranscriptItem(sessionId, item)

    // Transcript items can overlap briefly. Prefer an active assistant, then an
    // active user, before falling back to the transition implied by this event.
    const pending = view().sessions[sessionId]?.liveItems.filter((live) => !live.done) ?? []
    const activity: RealtimeCallActivity = pending.some((live) => live.role === 'assistant')
      ? 'assistant-speaking'
      : pending.some((live) => live.role === 'user')
        ? 'user-speaking'
        : event.phase === 'completed' && event.role === 'user'
          ? 'thinking'
          : 'listening'
    useRealtimeCallStore.setState({ activity })
    return
  }

  if (event.type === 'realtime_error') {
    toast.error(event.error)
    releaseMedia()
    useRealtimeCallStore.setState({ sessionId: null, state: 'idle' })
    view().setRealtimeStarting(sessionId, false)
    return
  }

  if (event.type === 'realtime_closed') finishCall(sessionId, projectPath)
}

export interface StartRealtimeCallOptions {
  projectPath: string
  sessionId: string
  additionalDirs?: string[]
  messages: RealtimeCallMessages
}

export async function startRealtimeCall({
  projectPath,
  sessionId,
  additionalDirs,
  messages,
}: StartRealtimeCallOptions): Promise<void> {
  if (useRealtimeCallStore.getState().state !== 'idle') return
  useRealtimeCallStore.setState({
    sessionId,
    state: 'starting',
    microphoneMuted: false,
    outputMuted: false,
    activity: 'listening',
    inputLevel: 0,
  })
  view().setRealtimeStarting(sessionId, true)
  view().setView(sessionId, 'realtime')
  if (timelineLoadedFor !== `${projectPath}::${sessionId}`) void refreshTimeline(projectPath, sessionId)

  media = {
    projectPath,
    sessionId,
    peer: null,
    stream: null,
    audio: null,
    stopDiagnostics: null,
    unsubscribe: null,
    negotiationTimer: null,
    cueGuardTimer: null,
    stopInputLevelMonitor: null,
    cueGuarded: false,
    readyCuePlayed: false,
  }
  // The subscription's lifetime is the call's, so it is set up here rather than by a
  // component that may unmount mid-call.
  media.unsubscribe = window.agent.onAgentEvent(handleAgentEvent)

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    if (!media) return
    media.stream = stream
    media.stopInputLevelMonitor = startInputLevelMonitor(stream)
    const peer = new RTCPeerConnection()
    media.peer = peer
    if (import.meta.env.DEV) {
      media.stopDiagnostics = startWebRtcDiagnostics(peer, (type, data) => {
        window.app?.trace?.('realtime.webrtc', type, data, sessionId)
      })
    }
    peer.createDataChannel('oai-events')
    for (const track of stream.getAudioTracks()) peer.addTrack(track, stream)
    peer.ontrack = (event) => {
      if (!media) return
      const audio = media.audio ?? new Audio()
      audio.autoplay = true
      audio.muted = useRealtimeCallStore.getState().outputMuted
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track])
      media.audio = audio
      void audio.play().catch(() => {})
    }
    peer.onconnectionstatechange = () => {
      if (!media) return
      if (peer.connectionState === 'connected') {
        // The SDP answer lands earlier than this, but media only flows once ICE and
        // DTLS finish — cueing on the answer would invite the user to speak into a
        // dead channel. An ICE restart re-enters `connected`, so the cue is latched
        // to fire once per call.
        if (media.readyCuePlayed) return
        media.readyCuePlayed = true
        if (useRealtimeCallStore.getState().outputMuted) return
        // Close capture first: the cue is voice-shaped, and the far end would
        // otherwise hear it as the user starting to talk.
        guardMicrophoneDuringCue()
        playVoiceReadyCue()
        return
      }
      if (peer.connectionState !== 'failed' && peer.connectionState !== 'disconnected') return
      releaseMedia()
      useRealtimeCallStore.setState({ sessionId: null, state: 'idle' })
    }
    const offer = await peer.createOffer({ offerToReceiveAudio: true })
    await peer.setLocalDescription(offer)
    await waitForIceGathering(peer)
    const sdp = peer.localDescription?.sdp
    if (!sdp) throw new Error(messages.offerFailed)
    await window.agent.startRealtimeVoice(projectPath, sessionId, {
      sdp,
      ...(additionalDirs !== undefined ? { additionalDirs } : {}),
    })
    if (useRealtimeCallStore.getState().state === 'starting' && media) {
      media.negotiationTimer = window.setTimeout(() => {
        if (useRealtimeCallStore.getState().state !== 'starting') return
        void window.agent.stopRealtimeVoice(projectPath, sessionId)
        releaseMedia()
        useRealtimeCallStore.setState({ sessionId: null, state: 'idle' })
        view().setRealtimeStarting(sessionId, false)
        toast.error(messages.connectionTimedOut)
      }, NEGOTIATION_TIMEOUT_MS)
    }
  } catch (error) {
    releaseMedia()
    useRealtimeCallStore.setState({ sessionId: null, state: 'idle' })
    view().setRealtimeStarting(sessionId, false)
    reportError(error)
  }
}

export async function stopRealtimeCall(): Promise<void> {
  const current = media
  if (!current) return
  const { projectPath, sessionId } = current
  useRealtimeCallStore.setState({ state: 'stopping' })
  try {
    await window.agent.stopRealtimeVoice(projectPath, sessionId)
  } catch (error) {
    reportError(error)
  } finally {
    finishCall(sessionId, projectPath)
  }
}

export function toggleRealtimeMicrophone(): void {
  const next = !useRealtimeCallStore.getState().microphoneMuted
  useRealtimeCallStore.setState({ microphoneMuted: next, ...(next ? { inputLevel: 0 } : {}) })
  applyMicrophoneEnabled()
}

export function toggleRealtimeOutput(): void {
  const next = !useRealtimeCallStore.getState().outputMuted
  useRealtimeCallStore.setState({ outputMuted: next })
  if (media?.audio) media.audio.muted = next
}

/** Test seam: drop any live call without going through the agent IPC. */
export function resetRealtimeCallForTests(): void {
  releaseMedia()
  timelineLoadedFor = null
  useRealtimeCallStore.setState({
    sessionId: null,
    state: 'idle',
    microphoneMuted: false,
    outputMuted: false,
    activity: 'listening',
    inputLevel: 0,
  })
}
