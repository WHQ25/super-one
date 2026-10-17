/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, RealtimeVoiceStartRequest } from '@superone/shared/agent-types'
import type { VoiceStatus } from '@superone/shared/realtime-voice'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { pauseRealtimeCall, resetRealtimeCallForTests, useRealtimeCallStore } from '@/stores/realtime-call'
import { VOICE_READY_CUE_MIC_GUARD_MS } from '@/lib/audio-cue'
import { prepareComposerSession } from '@/lib/prepare-composer-session'
import { ComposerVoiceEntry } from './ComposerVoiceEntry'
import { RealtimeCallControls } from './RealtimeCallControls'
import { RealtimeCallComposer } from './RealtimeCallComposer'
import { mergeCodexRealtimeMessages } from './codex-realtime-messages'

vi.mock('@/lib/prepare-composer-session', () => ({ prepareComposerSession: vi.fn(async (_project: string, target: { sessionId: string }) => target.sessionId) }))

const { playVoiceReadyCue } = vi.hoisted(() => ({ playVoiceReadyCue: vi.fn() }))
const playback = vi.hoisted(() => ({ connect: vi.fn(async () => {}), pause: vi.fn(), resume: vi.fn(async () => {}), close: vi.fn() }))
vi.mock('@/lib/realtime-audio', () => ({ BufferedVoicePlayback: class {
  connect = playback.connect; pause = playback.pause; resume = playback.resume; close = playback.close
} }))
vi.mock('@/lib/audio-cue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/audio-cue')>()),
  playVoiceReadyCue,
}))

const peerConnections: FakePeerConnection[] = []

class FakePeerConnection {
  iceGatheringState: RTCIceGatheringState = 'complete'
  signalingState: RTCSignalingState = 'stable'
  connectionState: RTCPeerConnectionState = 'new'
  localDescription: RTCSessionDescriptionInit | null = null
  ontrack: RTCPeerConnection['ontrack'] = null
  onconnectionstatechange: RTCPeerConnection['onconnectionstatechange'] = null
  createDataChannel = vi.fn()
  addTrack = vi.fn()
  createOffer = vi.fn(async () => ({ type: 'offer' as const, sdp: 'local-offer' }))
  setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.localDescription = description
  })
  setRemoteDescription = vi.fn(async () => {})
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  close = vi.fn(() => { this.signalingState = 'closed' })

  constructor() {
    peerConnections.push(this)
  }
}

function driveConnectionState(state: RTCPeerConnectionState): void {
  const peer = peerConnections[0]!
  peer.connectionState = state
  const onChange = peer.onconnectionstatechange as ((event: Event) => void) | null
  onChange?.(new Event('connectionstatechange'))
}

/**
 * Both voice surfaces at once: the composer entry point and the live indicator.
 * They are separate components driving one call, so a test that mounts only one
 * cannot see the handover between them.
 */
function VoiceSurfaces({ sessionId = 'session-1' }: { sessionId?: string }) {
  const engaged = useRealtimeCallStore(store => store.state !== 'idle')
  return (
    <>
      {engaged && <RealtimeCallComposer microphoneShortcutEnabled={false} />}
      <ComposerVoiceEntry harness="codex" projectPath="/repo" sessionId={sessionId} additionalDirs={['/extra']} />
    </>
  )
}

describe('realtime voice surfaces', () => {
  let emit: ((event: AgentEvent) => void) | null
  const startRealtimeVoice = vi.fn(async (projectPath: string, sessionId: string, request: RealtimeVoiceStartRequest): Promise<VoiceStatus> => ({
    protocol: 1, supported: true,
    call: { projectPath, sessionId, attemptId: request.attemptId!, hostEpoch: 'host-1', callId: 'call-1', generation: 1, state: 'starting', owned: true },
  }))
  const readyRealtimeVoice = vi.fn(async () => {})
  const stopRealtimeVoice = vi.fn(async () => {})
  const stopTrack = vi.fn()
  const microphoneTrack = { enabled: true, stop: stopTrack }
  const remoteAudio = {
    autoplay: false,
    muted: false,
    srcObject: null as MediaStream | null,
    play: vi.fn(async () => {}),
  }

  beforeEach(() => {
    Object.values(playback).forEach(mock => mock.mockClear())
    emit = null
    peerConnections.length = 0
    playVoiceReadyCue.mockClear()
    useCodexRealtimeViewStore.setState({ sessions: {} })
    resetRealtimeCallForTests()
    startRealtimeVoice.mockClear()
    readyRealtimeVoice.mockClear()
    stopRealtimeVoice.mockClear()
    stopTrack.mockClear()
    microphoneTrack.enabled = true
    remoteAudio.autoplay = false
    remoteAudio.muted = false
    remoteAudio.srcObject = null
    remoteAudio.play.mockClear()
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
    function AudioMock(): typeof remoteAudio {
      return remoteAudio
    }
    vi.stubGlobal('Audio', AudioMock)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getAudioTracks: () => [microphoneTrack],
          getTracks: () => [microphoneTrack],
        })),
      },
    })
    Object.defineProperty(window, 'agent', {
      configurable: true,
      value: {
        startRealtimeVoice,
        readyRealtimeVoice,
        stopRealtimeVoice,
        getRealtimeTimeline: vi.fn(async () => ({ segments: [], threadMessages: [], activeRealtimeSessionId: null, hasTimeline: false })),
        onAgentEvent: (callback: (event: AgentEvent) => void) => {
          emit = callback
          return () => { emit = null }
        },
      },
    })
  })

  afterEach(() => {
    resetRealtimeCallForTests()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function answerCall(sdp = 'v=0\r\n'): void {
    emit?.({ type: 'realtime_call_signal', sessionId: 'session-1', signal: {
      kind: 'answer', sdp, attemptId: startRealtimeVoice.mock.calls.at(-1)![2].attemptId!,
      hostEpoch: 'host-1', callId: 'call-1', generation: 1,
    } })
  }

  async function reachAnsweredCall(): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: 'Start Voice Conversation' }))
    await waitFor(() => expect(startRealtimeVoice).toHaveBeenCalled())
    act(() => answerCall())
    await waitFor(() => expect(peerConnections[0]?.setRemoteDescription).toHaveBeenCalled())
  }

  async function reachConnectedCall(): Promise<void> {
    await reachAnsweredCall()
    await act(async () => driveConnectionState('connected'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeEnabled())
    await waitFor(() => expect(microphoneTrack.enabled).toBe(true))
  }

  it('keeps a return entry reachable from other sessions while a call runs', () => {
    useRealtimeCallStore.setState({ sessionId: 'session-1', state: 'starting' })
    render(<ComposerVoiceEntry harness="codex" projectPath="/repo" sessionId="session-2" />)
    expect(screen.getByRole('button', { name: 'Return to Voice Conversation' })).toBeEnabled()
    for (const state of ['active', 'stopping', 'idle'] as const) {
      act(() => useRealtimeCallStore.setState({ state }))
      expect(screen.queryByRole('button', { name: 'Start Voice Conversation' }) !== null).toBe(state === 'idle')
    }
  })

  it('hides the unavailable voice entry and restores it when the task finishes', () => {
    const { container, rerender } = render(<ComposerVoiceEntry harness="codex" projectPath="/repo" sessionId="session-1" disabled />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ComposerVoiceEntry harness="codex" projectPath="/repo" sessionId="session-1" />)
    expect(screen.getByRole('button', { name: 'Start Voice Conversation' })).toBeEnabled()
  })

  it('returns to the call from the text composer, even while a task is running', () => {
    useRealtimeCallStore.setState({ sessionId: 'session-1', state: 'starting' })
    const { rerender } = render(<ComposerVoiceEntry harness="codex" projectPath="/repo" sessionId="session-1" />)
    expect(screen.getByRole('button', { name: 'Return to Voice Conversation' })).toBeEnabled()
    rerender(<ComposerVoiceEntry harness="codex" projectPath="/repo" sessionId="session-1" disabled />)
    act(() => useRealtimeCallStore.setState({ state: 'active' }))
    useCodexRealtimeViewStore.getState().setView('session-1', 'thread')
    fireEvent.click(screen.getByRole('button', { name: 'Return to Voice Conversation' }))
    expect(useCodexRealtimeViewStore.getState().sessions['session-1']?.view).toBe('realtime')
  })

  it('uses M only in the voice view and ignores typing and modified or repeated keys', async () => {
    render(<VoiceSurfaces />)
    await reachConnectedCall()
    const controls = render(<RealtimeCallControls layout="composer" microphoneShortcutEnabled />)
    fireEvent.keyDown(window, { key: 'm' })
    expect(microphoneTrack.enabled).toBe(false)
    fireEvent.keyDown(window, { key: 'm', repeat: true })
    fireEvent.keyDown(window, { key: 'm', metaKey: true })
    fireEvent.keyDown(window, { key: 'm', isComposing: true })
    const input = document.createElement('input')
    document.body.append(input)
    fireEvent.keyDown(input, { key: 'm' })
    input.remove()
    expect(microphoneTrack.enabled).toBe(false)
    fireEvent.keyDown(window, { key: 'm' })
    expect(microphoneTrack.enabled).toBe(true)
    controls.rerender(<RealtimeCallControls layout="composer" microphoneShortcutEnabled={false} />)
    fireEvent.keyDown(window, { key: 'm' })
    expect(microphoneTrack.enabled).toBe(true)
  })

  it('marks the unified transcript as starting before the SDP answer', async () => {
    render(<VoiceSurfaces />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Voice Conversation' }))

    await waitFor(() => {
      const view = useCodexRealtimeViewStore.getState().sessions['session-1']
      expect(view?.starting).toBe(true)
    })
    expect(useCodexRealtimeViewStore.getState().sessions['session-1']?.realtimeSessionId).toBeNull()
    expect(screen.getByText('Starting voice session…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop Voice Conversation' })).toBeEnabled()
  })

  it('clears the starting state when the call never connects', async () => {
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('microphone blocked'))
    render(<VoiceSurfaces />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Voice Conversation' }))

    await waitFor(() => {
      const view = useCodexRealtimeViewStore.getState().sessions['session-1']
      expect(view?.starting).toBe(false)
    })
    expect(useRealtimeCallStore.getState().state).toBe('idle')
  })

  it('negotiates WebRTC through the session API and hangs up from the composer', async () => {
    render(<VoiceSurfaces />)
    const voiceButton = screen.getByRole('button', { name: 'Start Voice Conversation' })
    expect(voiceButton.querySelector('.lucide-audio-lines')).not.toBeNull()
    expect(voiceButton).toHaveClass('rounded-full', 'bg-foreground', 'text-background')
    fireEvent.click(voiceButton)

    await waitFor(() => expect(startRealtimeVoice).toHaveBeenCalledWith('/repo', 'session-1', {
      attemptId: expect.any(String),
      sdp: 'local-offer',
      additionalDirs: ['/extra'],
    }))

    expect(prepareComposerSession).toHaveBeenCalledWith('/repo', { projectPath: '/repo', sessionId: 'session-1' })

    emit?.({
      type: 'realtime_started',
      sessionId: 'session-1',
      realtimeSessionId: 'realtime-1',
      version: 'v3',
    })
    const started = useCodexRealtimeViewStore.getState().sessions['session-1']
    expect(started?.realtimeSessionId).toBe('realtime-1')
    expect(started?.starting).toBe(false)

    act(() => answerCall('v=0\r\na=candidate:tcp 1 tcp 1671430143 192.0.2.1 443 typ host tcptype passive\r\n'))
    await act(async () => driveConnectionState('connected'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeEnabled())

    // The entry point gives its slot over to the call's own controls.
    await waitFor(() => expect(screen.getByTestId('realtime-call-indicator')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Start Voice Conversation' })).toBeNull()
    // Every control sits in the composer, not on the indicator.
    const indicator = screen.getByTestId('realtime-call-indicator')
    for (const name of ['Mute microphone', 'Pause Voice', 'Stop Voice Conversation']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
      expect(indicator.contains(screen.getByRole('button', { name }))).toBe(false)
    }

    const stopButton = screen.getByRole('button', { name: 'Stop Voice Conversation' })
    expect(stopButton.querySelector('.lucide-power')).not.toBeNull()
    expect(stopButton).toHaveClass(
      'rounded-full',
      'bg-error',
      'text-white',
      'hover:bg-error/90',
    )
    expect(stopButton).not.toHaveClass('bg-destructive', 'text-destructive-foreground')

    fireEvent.click(stopButton)

    await waitFor(() => expect(stopRealtimeVoice).toHaveBeenCalledWith('/repo', 'session-1', startRealtimeVoice.mock.calls[0]![2].attemptId))
    expect(stopTrack).toHaveBeenCalled()
    expect(useCodexRealtimeViewStore.getState().sessions['session-1']?.realtimeSessionId).toBeNull()
    await waitFor(() => expect(screen.queryByTestId('realtime-call-indicator')).toBeNull())
  })

  it('places the waveform between microphone and playback, with hangup last', async () => {
    render(<VoiceSurfaces />)
    await reachConnectedCall()
    const bar = screen.getByTestId('realtime-call-composer')
    expect(bar.querySelector('[data-testid="voice-waveform"]')).not.toBeNull()
    expect([...bar.children].map(node => node.getAttribute('aria-label') ?? node.getAttribute('data-testid')))
      .toEqual(['Mute microphone', 'Listening…', 'Pause Voice', 'Stop Voice Conversation'])
  })

  it('maps transcript lifecycle events onto the voice indicator activity', async () => {
    render(<VoiceSurfaces />)
    await reachConnectedCall()


    emit?.({
      type: 'realtime_transcript_item', sessionId: 'session-1', phase: 'started',
      itemId: 'user-activity', realtimeSessionId: 'rt-1', role: 'user', text: '', seq: 1,
    })
    await waitFor(() => expect(useRealtimeCallStore.getState().activity).toBe('user-speaking'))

    emit?.({
      type: 'realtime_transcript_item', sessionId: 'session-1', phase: 'completed',
      itemId: 'user-activity', realtimeSessionId: 'rt-1', role: 'user', text: 'Plan it.', seq: 2,
    })
    await waitFor(() => expect(useRealtimeCallStore.getState().activity).toBe('thinking'))

    emit?.({
      type: 'realtime_transcript_item', sessionId: 'session-1', phase: 'started',
      itemId: 'assistant-activity', realtimeSessionId: 'rt-1', role: 'assistant', text: '', seq: 3,
    })
    await waitFor(() => expect(useRealtimeCallStore.getState().activity).toBe('assistant-speaking'))

    emit?.({
      type: 'realtime_transcript_item', sessionId: 'session-1', phase: 'completed',
      itemId: 'assistant-activity', realtimeSessionId: 'rt-1', role: 'assistant', text: 'Done.', seq: 4,
    })
    await waitFor(() => expect(useRealtimeCallStore.getState().activity).toBe('listening'))
  })

  it('pauses output and capture, attaches a late remote track paused, and manually resumes without closing the stream', async () => {
    render(<VoiceSurfaces />)
    await reachConnectedCall()

    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }))
    expect(microphoneTrack.enabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Unmute microphone' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Unmute microphone' }))
    expect(microphoneTrack.enabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Pause Voice' }))
    expect(screen.getByRole('button', { name: 'Resume Voice' })).toHaveAttribute('aria-pressed', 'true')
    expect(microphoneTrack.enabled).toBe(false)

    const remoteStream = {} as MediaStream
    const onTrack = peerConnections[0]?.ontrack as ((event: RTCTrackEvent) => void) | null
    onTrack?.({ streams: [remoteStream], track: { kind: 'audio' } } as unknown as RTCTrackEvent)
    expect(playback.connect).toHaveBeenCalledWith(remoteStream)
    expect(playback.pause).toHaveBeenCalledTimes(1)

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Resume Voice' })))
    expect(playback.resume).toHaveBeenCalledTimes(1)
    expect(microphoneTrack.enabled).toBe(true)
    expect(stopRealtimeVoice).not.toHaveBeenCalled()
  })

  it('plays the ready cue once the media path connects, not when the answer arrives', async () => {
    render(<VoiceSurfaces />)
    await reachAnsweredCall()
    expect(playVoiceReadyCue).not.toHaveBeenCalled()

    await act(async () => driveConnectionState('connected'))
    expect(playVoiceReadyCue).toHaveBeenCalledTimes(1)

    // An ICE restart re-enters `connected`; the call is still the same call.
    driveConnectionState('connecting')
    driveConnectionState('connected')
    expect(playVoiceReadyCue).toHaveBeenCalledTimes(1)
  })

  it('skips the ready cue and preserves an interruption that occurred while connecting', async () => {
    render(<VoiceSurfaces />)
    await reachAnsweredCall()
    act(() => pauseRealtimeCall('interrupted'))

    await act(async () => driveConnectionState('connected'))
    expect(playVoiceReadyCue).not.toHaveBeenCalled()
    expect(microphoneTrack.enabled).toBe(false)
    expect(useRealtimeCallStore.getState().paused).toBe(true)
  })
  it('keeps the same control order in the voice panel and compact toolbar', () => {
    const controls = render(<RealtimeCallControls layout="composer" />)
    expect([...controls.container.querySelectorAll('button')].map(button => button.getAttribute('aria-label')))
      .toEqual(['Mute microphone', 'Pause Voice', 'Stop Voice Conversation'])
    controls.rerender(<RealtimeCallControls layout="toolbar" />)
    expect([...controls.container.querySelectorAll('button')].map(button => button.getAttribute('aria-label')))
      .toEqual(['Mute microphone', 'Pause Voice', 'Stop Voice Conversation'])
  })

  it('closes capture while the voice-shaped cue plays, then reopens it', async () => {
    render(<VoiceSurfaces />)
    await reachAnsweredCall()
    vi.useFakeTimers()

    await act(async () => driveConnectionState('connected'))
    expect(microphoneTrack.enabled).toBe(false)

    await vi.advanceTimersByTimeAsync(VOICE_READY_CUE_MIC_GUARD_MS - 1)
    expect(microphoneTrack.enabled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(microphoneTrack.enabled).toBe(true)
  })

  it('does not reopen a microphone the user muted during the cue', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<VoiceSurfaces />)
    await reachAnsweredCall()

    await act(async () => driveConnectionState('connected'))
    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }))

    await vi.advanceTimersByTimeAsync(VOICE_READY_CUE_MIC_GUARD_MS)
    expect(microphoneTrack.enabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Unmute microphone' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps user and assistant deltas ephemeral until committed', async () => {
    render(<VoiceSurfaces />)
    await reachConnectedCall()

    emit?.({
      type: 'realtime_transcript_item', sessionId: 'session-1', phase: 'started',
      itemId: 'user-1', realtimeSessionId: 'rt-1', role: 'user', text: '', seq: 10,
    })
    emit?.({
      type: 'realtime_transcript_item', sessionId: 'session-1', phase: 'delta',
      itemId: 'user-1', text: 'Inspecting', seq: 11,
    })
    emit?.({
      type: 'realtime_transcript_item', sessionId: 'session-1', phase: 'started',
      itemId: 'assistant-1', realtimeSessionId: 'rt-1', role: 'assistant', text: '', seq: 12,
    })
    emit?.({
      type: 'realtime_transcript_item', sessionId: 'session-1', phase: 'delta',
      itemId: 'assistant-1', text: 'Checking now', seq: 13,
    })

    expect(useCodexRealtimeViewStore.getState().sessions['session-1']?.liveItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', text: 'Inspecting', done: false }),
      expect.objectContaining({ role: 'assistant', text: 'Checking now', done: false }),
    ]))
    const view = useCodexRealtimeViewStore.getState().sessions['session-1']!
    expect(mergeCodexRealtimeMessages([], view)).toEqual([])
  })

  it('removes the caption and commits one message when a transcript completes', async () => {
    render(<VoiceSurfaces />)
    await reachConnectedCall()

    emit?.({
      type: 'realtime_transcript_item', sessionId: 'session-1', phase: 'started',
      itemId: 'user-1', realtimeSessionId: 'rt-1', role: 'user', text: '', seq: 20,
    })
    emit?.({
      type: 'realtime_transcript_item', sessionId: 'session-1', phase: 'delta',
      itemId: 'user-1', text: 'Please fix it', seq: 21,
    })
    expect(useCodexRealtimeViewStore.getState().sessions['session-1']?.liveItems[0]).toMatchObject({ text: 'Please fix it', done: false })

    emit?.({
      type: 'realtime_transcript_item', sessionId: 'session-1', phase: 'completed',
      itemId: 'user-1', realtimeSessionId: 'rt-1', role: 'user', text: 'Please fix it.', seq: 22,
    })

    expect(useCodexRealtimeViewStore.getState().sessions['session-1']?.liveItems[0]).toMatchObject({ done: true })
    const view = useCodexRealtimeViewStore.getState().sessions['session-1']!
    expect(mergeCodexRealtimeMessages([], view)).toMatchObject([{
      role: 'user',
      status: 'complete',
      content: [{ type: 'text', text: 'Please fix it.' }],
    }])
    expect(mergeCodexRealtimeMessages([], view)).toHaveLength(1)
  })

  it('keeps the call alive when the session leaves the screen', async () => {
    const { unmount } = render(<VoiceSurfaces />)
    await reachConnectedCall()

    unmount()

    expect(stopRealtimeVoice).not.toHaveBeenCalled()
    expect(useRealtimeCallStore.getState()).toMatchObject({
      sessionId: 'session-1',
      state: 'active',
    })
    expect(microphoneTrack.stop).not.toHaveBeenCalled()
  })
})
