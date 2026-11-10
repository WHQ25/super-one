import { monitorVoiceAudioLevels, SILENT_VOICE_LEVELS, VoiceAudioLevelStore } from '@superone/shared/voice-audio-levels'
import { redactVoiceText, type VoiceIdentity } from '@superone/shared/realtime-voice'
import { create } from 'zustand'
import { toast } from 'sonner'
import type { AgentEvent } from '@superone/shared/agent-types'
import { preferTcpIceCandidates, startWebRtcDiagnostics, waitForIceGathering } from '@/lib/realtime-webrtc'
import { VOICE_READY_CUE_MIC_GUARD_MS, playVoiceReadyCue } from '@/lib/audio-cue'
import { startDoubaoMicCapture } from '@/lib/doubao-mic-capture'
import { nextPlaybackBarge, PcmVoicePlayback } from '@/lib/pcm-voice-playback'
import { refreshCodexRealtimeTimeline, useCodexRealtimeViewStore } from './codex-realtime-view'
import { BufferedVoicePlayback } from '@/lib/realtime-audio'

export type RealtimeCallState = 'idle' | 'starting' | 'active' | 'stopping'
export type RealtimeCallActivity = 'listening' | 'user-speaking' | 'thinking' | 'assistant-speaking'

interface RealtimeCallStore {
  /** Session the live call belongs to; null while idle. */
  sessionId: string | null
  projectPath: string | null
  state: RealtimeCallState
  microphoneMuted: boolean
  paused: boolean
  pauseReason: 'manual' | 'interrupted' | null
  resuming: boolean
  /** Presentation state for the live call indicator. */
  activity: RealtimeCallActivity
}

/**
 * A voice call outlives the button that started it — the toolbar entry point and the
 * live indicator above the composer are different components, and either may unmount
 * while the call continues. So the call is owned here rather than by a component:
 * React reads this store, and the media objects below never enter React at all.
 *
 * Only one call runs at a time, which is why this is a singleton and not a map.
 */
export const realtimeVoiceAudioLevels = new VoiceAudioLevelStore()

export const useRealtimeCallStore = create<RealtimeCallStore>(() => ({
  sessionId: null,
  projectPath: null,
  state: 'idle',
  microphoneMuted: false,
  paused: false, pauseReason: null, resuming: false,
  activity: 'listening',
}))

interface CallMedia {
  attemptId: string
  identity: VoiceIdentity | null
  projectPath: string
  sessionId: string
  transport: 'codex' | 'doubao' | 'gemini'
  peer: RTCPeerConnection | null
  stream: MediaStream | null
  audio: BufferedVoicePlayback | PcmVoicePlayback | null
  stopDiagnostics: (() => void) | null
  unsubscribe: (() => void) | null
  playbackUnsub: (() => void) | null
  stopCapture: (() => void) | null
  negotiationTimer: number | null
  cueGuardTimer: number | null
  /** Armed while ICE reports `disconnected`; a recovery cancels it, expiry ends the call. */
  disconnectTimer: number | null
  stopInputLevelMonitor: (() => void) | null
  /** True while the ready cue is playing into a live channel. */
  cueGuarded: boolean
  readyCuePlayed: boolean
  pauseEpoch: number
  /** Last mute sent to Doubao, so pause and the ready cue do not repeat the event. */
  serverMuted: boolean | null
  /** Consecutive loud mic batches while the speakers are still audible. */
  playbackBargeHits: number
}

/** Doubao and Gemini share the PCM path. Codex Realtime keeps its own WebRTC call. */
function usesPcmVoice(transport: CallMedia['transport']): transport is 'doubao' | 'gemini' {
  return transport === 'doubao' || transport === 'gemini'
}

let media: CallMedia | null = null
/** `projectPath::sessionId` whose timeline this renderer already fetched. */
let timelineLoadedFor: string | null = null

const NEGOTIATION_TIMEOUT_MS = 15_000
// ICE `disconnected` is transient by spec: consecutive STUN checks failed, which a lossy
// link produces routinely, and the pair usually comes back on its own. Only `failed`
// is terminal. Tearing down on the first `disconnected` ended calls mid-sentence on
// networks with 20-30% packet loss, so give the link a chance to recover first.
const DISCONNECT_GRACE_MS = 15_000

export interface RealtimeCallMessages {
  offerFailed: string
  connectionTimedOut: string
}

function view() {
  return useCodexRealtimeViewStore.getState()
}

function reportError(error: unknown): void {
  toast.error(redactVoiceText(error instanceof Error ? error.message : String(error)))
}

// Capture can be suppressed for two unrelated reasons — the user muted it, or a cue
// is playing into a live channel. Both write the same track flag, so the flag is
// derived from both instead of either one overwriting the other.
function applyMicrophoneEnabled(): void {
  if (!media) return
  const state = useRealtimeCallStore.getState()
  const enabled = !state.microphoneMuted && !state.paused && !media.cueGuarded
  for (const track of media.stream?.getAudioTracks() ?? []) track.enabled = enabled
}

function releaseMedia(): void {
  if (!media) return
  if (media.negotiationTimer !== null) window.clearTimeout(media.negotiationTimer)
  if (media.cueGuardTimer !== null) window.clearTimeout(media.cueGuardTimer)
  if (media.disconnectTimer !== null) window.clearTimeout(media.disconnectTimer)
  media.stopInputLevelMonitor?.()
  media.stopDiagnostics?.()
  media.stopCapture?.()
  media.unsubscribe?.()
  media.playbackUnsub?.()
  for (const track of media.stream?.getTracks() ?? []) track.stop()
  media.peer?.close()
  media.audio?.close()
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('pause', null)
    navigator.mediaSession.setActionHandler('play', null)
  }
  media = null
  realtimeVoiceAudioLevels.publish(SILENT_VOICE_LEVELS)
}

/** Tear the call down locally and return the UI to its resting state. */
function finishCall(sessionId: string, projectPath: string): void {
  releaseMedia()
  useRealtimeCallStore.setState({
    sessionId: null,
    projectPath: null,
    state: 'idle',
    microphoneMuted: false,
    paused: false, pauseReason: null, resuming: false,
    activity: 'listening',
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
  const current = media
  syncDoubaoServerMute()
  media.cueGuardTimer = window.setTimeout(() => {
    if (media !== current) return
    media.cueGuardTimer = null
    media.cueGuarded = false
    applyMicrophoneEnabled()
    syncDoubaoServerMute()
  }, VOICE_READY_CUE_MIC_GUARD_MS)
}

function syncDoubaoServerMute(): void {
  const current = media
  if (!current || current.transport !== 'doubao' || !current.identity) return
  const state = useRealtimeCallStore.getState()
  const muted = state.microphoneMuted || state.paused || current.cueGuarded || state.state !== 'active'
  if (current.serverMuted === muted) return
  current.serverMuted = muted
  void window.agent.setDoubaoVoiceMuted(current.sessionId, muted).catch(() => {})
}

function handleAgentEvent(event: AgentEvent, directed = false): void {
  const current = media
  if (!current || event.sessionId !== current.sessionId) return
  const { sessionId, projectPath } = current

  if (event.type === 'realtime_call_signal') {
    const signal = event.signal
    if (signal.attemptId !== current.attemptId) return
    if (current.identity && (current.identity.callId !== signal.callId || current.identity.hostEpoch !== signal.hostEpoch || current.identity.generation !== signal.generation)) return
    current.identity = signal
    if (signal.kind === 'answer') handleAgentEvent({ ...event, type: 'realtime_sdp', sdp: signal.sdp }, true)
    else if (signal.kind === 'state' && signal.state === 'active' && usesPcmVoice(current.transport)) void markDoubaoReady(current)
    else if (signal.kind === 'closed') finishCall(sessionId, projectPath)
    else if (signal.kind === 'error') { reportError(new Error(signal.error)); void stopRealtimeCall() }
    return
  }

  if (event.type === 'realtime_started') {
    view().setRealtimeSession(sessionId, event.realtimeSessionId ?? 'live')
    view().setView(sessionId, 'realtime')
    return
  }

  if (event.type === 'realtime_sdp') {
    if (!directed) return
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
      // Media connection, not SDP application, owns readiness.
      if (media !== current) return
    }).catch((error) => {
      if (media !== current) return
      reportError(error)
      void stopRealtimeCall()
    })
    return
  }

  if (event.type === 'realtime_transcript_item') {
    if (event.phase === 'delta') {
      if (event.replace) view().replaceTranscriptItemText(sessionId, event.itemId, event.text)
      else view().appendTranscriptItemDelta(sessionId, event.itemId, event.text)
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
    // Codex errors arrive again as a directed signal. A PCM voice has no second copy,
    // so a failed delegation is reported here without hanging up the call.
    if (usesPcmVoice(current.transport)) reportError(new Error(event.error))
    return
  }
}

function markDoubaoReady(current: CallMedia): void {
  if (media !== current || !usesPcmVoice(current.transport)) return
  if (current.negotiationTimer !== null) {
    window.clearTimeout(current.negotiationTimer)
    current.negotiationTimer = null
  }
  useRealtimeCallStore.setState({ state: 'active', activity: 'listening' })
  if (current.readyCuePlayed) {
    syncDoubaoServerMute()
    return
  }
  current.readyCuePlayed = true
  if (useRealtimeCallStore.getState().paused) {
    syncDoubaoServerMute()
    return
  }
  guardMicrophoneDuringCue()
  playVoiceReadyCue()
}

export interface StartRealtimeCallOptions {
  projectPath: string
  sessionId: string
  additionalDirs?: string[]
  /** Apply composer selections and create the backing session before opening the microphone. */
  prepareSession?: () => Promise<string | null>
  messages: RealtimeCallMessages
}

export async function startRealtimeCall({
  projectPath,
  sessionId,
  additionalDirs,
  prepareSession,
  messages,
}: StartRealtimeCallOptions): Promise<void> {
  if (useRealtimeCallStore.getState().state !== 'idle') return
  useRealtimeCallStore.setState({
    sessionId,
    projectPath,
    state: 'starting',
    microphoneMuted: false,
    paused: false, pauseReason: null, resuming: false,
    activity: 'listening',
  })
  view().setRealtimeStarting(sessionId, true)
  view().setView(sessionId, 'realtime')
  if (timelineLoadedFor !== `${projectPath}::${sessionId}`) void refreshTimeline(projectPath, sessionId)

  media = {
    attemptId: crypto.randomUUID(), identity: null,
    projectPath,
    sessionId,
    transport: 'codex',
    peer: null,
    stream: null,
    audio: null,
    stopDiagnostics: null,
    unsubscribe: null,
    playbackUnsub: null,
    stopCapture: null,
    negotiationTimer: null,
    cueGuardTimer: null,
    disconnectTimer: null,
    stopInputLevelMonitor: null,
    cueGuarded: false,
    readyCuePlayed: false,
    pauseEpoch: 0,
    serverMuted: null,
    playbackBargeHits: 0,
  }
  const callMedia = media
  // The subscription's lifetime is the call's, so it is set up here rather than by a
  // component that may unmount mid-call.
  media.unsubscribe = window.agent.onAgentEvent(handleAgentEvent)
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('pause', () => pauseRealtimeCall('interrupted'))
    // Regaining focus never resumes speech. Play is an explicit user action.
    navigator.mediaSession.setActionHandler('play', () => { if (useRealtimeCallStore.getState().paused) void toggleRealtimePlayback() })
  }

  try {
    if (prepareSession) {
      const preparedSessionId = await prepareSession()
      if (media !== callMedia) return
      if (!preparedSessionId) {
        await stopRealtimeCall()
        return
      }
      if (preparedSessionId !== sessionId) {
        view().setRealtimeStarting(sessionId, false)
        sessionId = preparedSessionId
        callMedia.sessionId = sessionId
        useRealtimeCallStore.setState({ sessionId })
        view().setRealtimeStarting(sessionId, true)
        view().setView(sessionId, 'realtime')
        void refreshTimeline(projectPath, sessionId)
      }
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    if (media !== callMedia) { for (const track of stream.getTracks()) track.stop(); return }
    media.stream = stream
    const peer = new RTCPeerConnection()
    media.peer = peer
    media.stopInputLevelMonitor = monitorVoiceAudioLevels(peer, levels => {
      if (media !== callMedia) return
      const state = useRealtimeCallStore.getState()
      realtimeVoiceAudioLevels.publish({
        input: state.microphoneMuted || state.paused || callMedia.cueGuarded ? 0 : levels.input,
        output: realtimeVoiceAudioLevels.snapshot().output,
      })
    })
    if (import.meta.env.DEV) {
      media.stopDiagnostics = startWebRtcDiagnostics(peer, (type, data) => {
        window.app?.trace?.('realtime.webrtc', type, data, sessionId)
      })
    }
    peer.createDataChannel('oai-events')
    for (const track of stream.getAudioTracks()) peer.addTrack(track, stream)
    peer.ontrack = (event) => {
      if (media !== callMedia) return
      if (media.audio || event.track.kind !== 'audio') return
      const audio = new BufferedVoicePlayback(() => {
        if (media === callMedia) pauseRealtimeCall('interrupted')
      }, error => {
        if (media !== callMedia) return
        reportError(error); void stopRealtimeCall()
      }, output => {
        if (media === callMedia) realtimeVoiceAudioLevels.publish({ ...realtimeVoiceAudioLevels.snapshot(), output })
      })
      media.audio = audio
      if (useRealtimeCallStore.getState().paused) audio.pause()
      void audio.connect(event.streams[0] ?? new MediaStream([event.track])).catch(error => {
        if (media !== callMedia) return
        reportError(error); void stopRealtimeCall()
      })
    }
    peer.onconnectionstatechange = () => {
      if (media !== callMedia) return
      if (peer.connectionState === 'connected') {
        if (media !== callMedia) return
        if (callMedia.identity) void window.agent.readyRealtimeVoice(projectPath, sessionId, callMedia.identity).then(() => {
          if (media === callMedia) useRealtimeCallStore.setState({ state: 'active', activity: 'listening' })
        }).catch(error => {
          if (media !== callMedia) return
          reportError(error); void stopRealtimeCall()
        })
        if (media.disconnectTimer !== null) {
          window.clearTimeout(media.disconnectTimer)
          media.disconnectTimer = null
        }
        // The SDP answer lands earlier than this, but media only flows once ICE and
        // DTLS finish — cueing on the answer would invite the user to speak into a
        // dead channel. An ICE restart re-enters `connected`, so the cue is latched
        // to fire once per call.
        if (media.readyCuePlayed) return
        media.readyCuePlayed = true
        if (useRealtimeCallStore.getState().paused) return
        // Close capture first: the cue is voice-shaped, and the far end would
        // otherwise hear it as the user starting to talk.
        guardMicrophoneDuringCue()
        playVoiceReadyCue()
        return
      }
      const endCall = () => {
        void stopRealtimeCall()
      }
      if (peer.connectionState === 'failed') {
        endCall()
        return
      }
      if (peer.connectionState !== 'disconnected' || media.disconnectTimer !== null) return
      media.disconnectTimer = window.setTimeout(() => {
        if (!media || media.peer !== peer) return
        media.disconnectTimer = null
        if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') endCall()
      }, DISCONNECT_GRACE_MS)
    }
    const offer = await peer.createOffer({ offerToReceiveAudio: true })
    if (media !== callMedia) return
    await peer.setLocalDescription(offer)
    await waitForIceGathering(peer)
    const sdp = peer.localDescription?.sdp
    if (!sdp) throw new Error(messages.offerFailed)
    if (media !== callMedia) return
    const receipt = await window.agent.startRealtimeVoice(projectPath, sessionId, {
      attemptId: callMedia.attemptId, sdp,
      ...(additionalDirs !== undefined ? { additionalDirs } : {}),
    })
    if (media !== callMedia) return
    if (!receipt.call?.owned || receipt.call.attemptId !== callMedia.attemptId) throw new Error('Voice start was not accepted.')
    callMedia.identity = receipt.call
    if (useRealtimeCallStore.getState().state === 'starting' && media === callMedia) {
      media.negotiationTimer = window.setTimeout(() => {
        if (media !== callMedia || useRealtimeCallStore.getState().state !== 'starting') return
        void stopAdmitted(callMedia).catch(() => {})
        releaseMedia()
        useRealtimeCallStore.setState({ sessionId: null, projectPath: null, state: 'idle' })
        view().setRealtimeStarting(sessionId, false)
        toast.error(messages.connectionTimedOut)
      }, NEGOTIATION_TIMEOUT_MS)
    }
  } catch (error) {
    if (media !== callMedia) return
    void stopAdmitted(callMedia).catch(() => {})
    releaseMedia()
    useRealtimeCallStore.setState({ sessionId: null, projectPath: null, state: 'idle' })
    view().setRealtimeStarting(sessionId, false)
    reportError(error)
  }
}

async function stopAdmitted(current: CallMedia): Promise<void> {
  const stop = current.transport === 'doubao'
    ? window.agent.stopDoubaoVoice
    : current.transport === 'gemini'
      ? window.agent.stopGeminiVoice
      : window.agent.stopRealtimeVoice
  await stop(current.projectPath, current.sessionId, current.attemptId)
}

export function startDoubaoCall(options: StartRealtimeCallOptions): Promise<void> {
  return startPcmCall('doubao', options)
}

export function startGeminiCall(options: StartRealtimeCallOptions): Promise<void> {
  return startPcmCall('gemini', options)
}

async function startPcmCall(transport: 'doubao' | 'gemini', {
  projectPath,
  sessionId,
  prepareSession,
  messages,
}: StartRealtimeCallOptions): Promise<void> {
  if (useRealtimeCallStore.getState().state !== 'idle') return
  useRealtimeCallStore.setState({
    sessionId,
    projectPath,
    state: 'starting',
    microphoneMuted: false,
    paused: false, pauseReason: null, resuming: false,
    activity: 'listening',
  })
  view().setRealtimeStarting(sessionId, true)
  view().setView(sessionId, 'realtime')
  if (timelineLoadedFor !== `${projectPath}::${sessionId}`) void refreshTimeline(projectPath, sessionId)

  media = {
    attemptId: crypto.randomUUID(), identity: null,
    projectPath,
    sessionId,
    transport,
    peer: null,
    stream: null,
    audio: null,
    stopDiagnostics: null,
    unsubscribe: null,
    playbackUnsub: null,
    stopCapture: null,
    negotiationTimer: null,
    cueGuardTimer: null,
    disconnectTimer: null,
    stopInputLevelMonitor: null,
    cueGuarded: false,
    readyCuePlayed: false,
    pauseEpoch: 0,
    serverMuted: null,
    playbackBargeHits: 0,
  }
  const callMedia = media
  media.unsubscribe = window.agent.onAgentEvent(handleAgentEvent)
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('pause', () => pauseRealtimeCall('interrupted'))
    navigator.mediaSession.setActionHandler('play', () => { if (useRealtimeCallStore.getState().paused) void toggleRealtimePlayback() })
  }

  try {
    if (prepareSession) {
      const preparedSessionId = await prepareSession()
      if (media !== callMedia) return
      if (!preparedSessionId) {
        await stopRealtimeCall()
        return
      }
      if (preparedSessionId !== sessionId) {
        view().setRealtimeStarting(sessionId, false)
        sessionId = preparedSessionId
        callMedia.sessionId = sessionId
        useRealtimeCallStore.setState({ sessionId })
        view().setRealtimeStarting(sessionId, true)
        view().setView(sessionId, 'realtime')
        void refreshTimeline(projectPath, sessionId)
      }
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    if (media !== callMedia) { for (const track of stream.getTracks()) track.stop(); return }
    media.stream = stream
    const audio = new PcmVoicePlayback(() => {
      if (media === callMedia) pauseRealtimeCall('interrupted')
    }, error => {
      if (media !== callMedia) return
      reportError(error); void stopRealtimeCall()
    }, output => {
      if (media === callMedia) realtimeVoiceAudioLevels.publish({ ...realtimeVoiceAudioLevels.snapshot(), output })
    })
    media.audio = audio
    await audio.start()
    if (media !== callMedia) return
    if (useRealtimeCallStore.getState().paused) audio.pause()
    const onPlayback = transport === 'gemini' ? window.agent.onGeminiVoicePlayback : window.agent.onDoubaoVoicePlayback
    media.playbackUnsub = onPlayback((frame) => {
      if (media !== callMedia || !(media.audio instanceof PcmVoicePlayback)) return
      if (frame.type === 'drop') media.audio.drop()
      else media.audio.pushPcm(frame.pcm)
    })
    media.stopCapture = await startDoubaoMicCapture(stream, (pcm, rms) => {
      if (media !== callMedia) return
      const state = useRealtimeCallStore.getState()
      const silent = state.microphoneMuted || state.paused || callMedia.cueGuarded || state.state !== 'active'
      const output = realtimeVoiceAudioLevels.snapshot().output
      realtimeVoiceAudioLevels.publish({ input: silent ? 0 : rms, output })
      if (silent || pcm.byteLength === 0) {
        callMedia.playbackBargeHits = 0
        return
      }
      const barge = nextPlaybackBarge(callMedia.playbackBargeHits, rms, output)
      callMedia.playbackBargeHits = barge.hits
      if (barge.drop && callMedia.audio instanceof PcmVoicePlayback) callMedia.audio.drop()
      const sendAudio = transport === 'gemini' ? window.agent.sendGeminiVoiceAudio : window.agent.sendDoubaoVoiceAudio
      sendAudio(callMedia.sessionId, pcm)
    })
    if (media !== callMedia) return
    const startVoice = transport === 'gemini' ? window.agent.startGeminiVoice : window.agent.startDoubaoVoice
    const receipt = await startVoice(projectPath, sessionId, callMedia.attemptId)
    if (media !== callMedia) return
    if (!receipt.call?.owned || receipt.call.attemptId !== callMedia.attemptId) throw new Error('Voice start was not accepted.')
    callMedia.identity = receipt.call
    media.negotiationTimer = window.setTimeout(() => {
      if (media !== callMedia || useRealtimeCallStore.getState().state !== 'starting') return
      void stopAdmitted(callMedia).catch(() => {})
      releaseMedia()
      useRealtimeCallStore.setState({ sessionId: null, projectPath: null, state: 'idle' })
      view().setRealtimeStarting(sessionId, false)
      toast.error(messages.connectionTimedOut)
    }, NEGOTIATION_TIMEOUT_MS)
  } catch (error) {
    if (media !== callMedia) return
    void stopAdmitted(callMedia).catch(() => {})
    releaseMedia()
    useRealtimeCallStore.setState({ sessionId: null, projectPath: null, state: 'idle' })
    view().setRealtimeStarting(sessionId, false)
    reportError(error)
  }
}

export async function stopRealtimeCall(): Promise<void> {
  const current = media
  if (!current) return
  const { projectPath, sessionId } = current
  useRealtimeCallStore.setState({ state: 'stopping' })
  releaseMedia()
  try {
    await stopAdmitted(current)
  } catch (error) {
    reportError(error)
  } finally {
    const state = useRealtimeCallStore.getState()
    if (!media && state.sessionId === sessionId && state.state === 'stopping') finishCall(sessionId, projectPath)
  }
}

export function toggleRealtimeMicrophone(): void {
  const next = !useRealtimeCallStore.getState().microphoneMuted
  useRealtimeCallStore.setState({ microphoneMuted: next })
  if (next) realtimeVoiceAudioLevels.publish({ ...realtimeVoiceAudioLevels.snapshot(), input: 0 })
  applyMicrophoneEnabled()
  syncDoubaoServerMute()
}

export function pauseRealtimeCall(reason: 'manual' | 'interrupted' = 'manual'): void {
  if (!media || !['active', 'starting'].includes(useRealtimeCallStore.getState().state)) return
  media.audio?.pause()
  media.pauseEpoch++
  useRealtimeCallStore.setState({ paused: true, pauseReason: reason })
  realtimeVoiceAudioLevels.publish(SILENT_VOICE_LEVELS)
  applyMicrophoneEnabled()
  syncDoubaoServerMute()
}

export async function toggleRealtimePlayback(): Promise<void> {
  const current = media
  const state = useRealtimeCallStore.getState()
  if (!current || state.state !== 'active' || state.resuming) return
  if (!state.paused) { pauseRealtimeCall(); return }
  const epoch = current.pauseEpoch
  useRealtimeCallStore.setState({ resuming: true })
  try {
    await current.audio?.resume()
    if (media !== current) return
    if (current.pauseEpoch !== epoch) { current.audio?.pause(); return }
    useRealtimeCallStore.setState({ paused: false, pauseReason: null })
    applyMicrophoneEnabled()
    syncDoubaoServerMute()
  } catch (error) { if (media === current) reportError(error) }
  finally { if (media === current) useRealtimeCallStore.setState({ resuming: false }) }
}

/** Test seam: drop any live call without going through the agent IPC. */
export function resetRealtimeCallForTests(): void {
  releaseMedia()
  realtimeVoiceAudioLevels.publish(SILENT_VOICE_LEVELS)
  timelineLoadedFor = null
  useRealtimeCallStore.setState({
    sessionId: null,
    projectPath: null,
    state: 'idle',
    microphoneMuted: false,
    paused: false, pauseReason: null, resuming: false,
    activity: 'listening',
  })
}
