/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { resetRealtimeCallForTests, useRealtimeCallStore } from '@/stores/realtime-call'
import { VOICE_READY_CUE_MIC_GUARD_MS } from '@/lib/audio-cue'
import { CodexRealtimeVoiceButton } from './CodexRealtimeVoiceButton'
import { RealtimeCallIndicator } from './RealtimeCallIndicator'
import { mergeCodexRealtimeMessages } from './codex-realtime-messages'

const { playVoiceReadyCue } = vi.hoisted(() => ({ playVoiceReadyCue: vi.fn() }))
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
  return (
    <>
      <RealtimeCallIndicator />
      <CodexRealtimeVoiceButton projectPath="/repo" sessionId={sessionId} additionalDirs={['/extra']} />
    </>
  )
}

describe('realtime voice surfaces', () => {
  let emit: ((event: AgentEvent) => void) | null
  const startRealtimeVoice = vi.fn(async () => {})
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
    emit = null
    peerConnections.length = 0
    playVoiceReadyCue.mockClear()
    useCodexRealtimeViewStore.setState({ sessions: {} })
    resetRealtimeCallForTests()
    startRealtimeVoice.mockClear()
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
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function reachConnectedCall(): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: 'Start Voice Conversation' }))
    await waitFor(() => expect(startRealtimeVoice).toHaveBeenCalled())
    emit?.({ type: 'realtime_sdp', sessionId: 'session-1', sdp: 'v=0\r\n' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeEnabled())
  }

  it('marks the unified transcript as starting before the SDP answer', async () => {
    render(<VoiceSurfaces />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Voice Conversation' }))

    await waitFor(() => {
      const view = useCodexRealtimeViewStore.getState().sessions['session-1']
      expect(view?.starting).toBe(true)
    })
    expect(useCodexRealtimeViewStore.getState().sessions['session-1']?.realtimeSessionId).toBeNull()
    expect(screen.queryByTestId('realtime-call-indicator')).toBeNull()
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
      sdp: 'local-offer',
      additionalDirs: ['/extra'],
    }))

    emit?.({
      type: 'realtime_started',
      sessionId: 'session-1',
      realtimeSessionId: 'realtime-1',
      version: 'v3',
    })
    const started = useCodexRealtimeViewStore.getState().sessions['session-1']
    expect(started?.realtimeSessionId).toBe('realtime-1')
    expect(started?.starting).toBe(false)

    emit?.({
      type: 'realtime_sdp',
      sessionId: 'session-1',
      sdp: 'v=0\r\na=candidate:tcp 1 tcp 1671430143 192.0.2.1 443 typ host tcptype passive\r\n',
    })

    // The entry point gives its slot over to the call's own controls.
    await waitFor(() => expect(screen.getByTestId('realtime-call-indicator')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Start Voice Conversation' })).toBeNull()
    // Every control sits in the composer, not on the indicator.
    const indicator = screen.getByTestId('realtime-call-indicator')
    for (const name of ['Mute microphone', 'Mute speaker', 'Stop Voice Conversation']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
      expect(indicator.contains(screen.getByRole('button', { name }))).toBe(false)
    }

    const stopButton = screen.getByRole('button', { name: 'Stop Voice Conversation' })
    expect(stopButton.querySelector('.lucide-power')).not.toBeNull()
    expect(stopButton).toHaveClass(
      'rounded-full',
      'bg-muted-foreground',
      'text-background',
      'hover:bg-foreground',
    )
    expect(stopButton).not.toHaveClass('bg-destructive', 'text-destructive-foreground')

    fireEvent.click(stopButton)

    await waitFor(() => expect(stopRealtimeVoice).toHaveBeenCalledWith('/repo', 'session-1'))
    expect(stopTrack).toHaveBeenCalled()
    expect(useCodexRealtimeViewStore.getState().sessions['session-1']?.realtimeSessionId).toBeNull()
    await waitFor(() => expect(screen.queryByTestId('realtime-call-indicator')).toBeNull())
  })

  it('flanks the voice mark with the agent on the left and the user on the right', async () => {
    const { container } = render(<VoiceSurfaces />)
    await reachConnectedCall()

    const row = screen.getByTestId('realtime-call-indicator')
    expect(row).toHaveClass('justify-center')
    const mark = screen.getByTestId('realtime-voice-mark')
    expect(mark).toHaveAttribute('data-activity', 'listening')
    expect(mark.querySelector('.lucide-audio-lines')).not.toBeNull()
    expect(mark.querySelector('.realtime-voice-mark-shell')).not.toBeNull()
    expect(mark.querySelector('.realtime-voice-halo')).not.toBeNull()
    expect(mark.querySelectorAll('.realtime-voice-halo-outline')).toHaveLength(3)

    const sides = [...row.querySelectorAll('[data-testid^="realtime-caption-"]')]
    expect(sides.map((node) => node.getAttribute('data-testid')))
      .toEqual(['realtime-caption-assistant', 'realtime-caption-user'])
    // Each column's text hugs the cloud rather than the outer edge.
    expect(sides[0]!.querySelector('p')).toHaveClass('text-right')
    expect(sides[1]!.querySelector('p')).toHaveClass('text-left')
  })

  it('maps transcript lifecycle events onto the voice indicator activity', async () => {
    render(<VoiceSurfaces />)
    await reachConnectedCall()
    const mark = screen.getByTestId('realtime-voice-mark')

    emit?.({
      type: 'realtime_transcript_item', sessionId: 'session-1', phase: 'started',
      itemId: 'user-activity', realtimeSessionId: 'rt-1', role: 'user', text: '', seq: 1,
    })
    await waitFor(() => expect(mark).toHaveAttribute('data-activity', 'user-speaking'))

    emit?.({
      type: 'realtime_transcript_item', sessionId: 'session-1', phase: 'completed',
      itemId: 'user-activity', realtimeSessionId: 'rt-1', role: 'user', text: 'Plan it.', seq: 2,
    })
    await waitFor(() => expect(mark).toHaveAttribute('data-activity', 'thinking'))

    emit?.({
      type: 'realtime_transcript_item', sessionId: 'session-1', phase: 'started',
      itemId: 'assistant-activity', realtimeSessionId: 'rt-1', role: 'assistant', text: '', seq: 3,
    })
    await waitFor(() => expect(mark).toHaveAttribute('data-activity', 'assistant-speaking'))

    emit?.({
      type: 'realtime_transcript_item', sessionId: 'session-1', phase: 'completed',
      itemId: 'assistant-activity', realtimeSessionId: 'rt-1', role: 'assistant', text: 'Done.', seq: 4,
    })
    await waitFor(() => expect(mark).toHaveAttribute('data-activity', 'listening'))
  })

  it('gives each caption the cloud\'s height, centred until it needs to scroll', async () => {
    render(<VoiceSurfaces />)
    await reachConnectedCall()

    for (const testId of ['realtime-caption-assistant', 'realtime-caption-user']) {
      const column = screen.getByTestId(testId)
      expect(column).toHaveClass('overflow-y-auto')
      expect(column.style.height).toBe('64px')
      // Centring lives on an inner wrapper, never on the scroll container itself:
      // an overflowing item centred inside a scroller loses its first lines to a
      // scrollTop that cannot go negative.
      expect(column).not.toHaveClass('items-center')
      expect(column.firstElementChild).toHaveClass('min-h-full', 'items-center')
      // Long speech wraps instead of being cut off at one line.
      expect(column.querySelector('p')).toHaveClass('break-words')
      expect(column.querySelector('p')).not.toHaveClass('truncate')
    }
  })

  it('keeps a growing caption scrolled to its newest words', async () => {
    render(<VoiceSurfaces />)
    await reachConnectedCall()

    const column = screen.getByTestId('realtime-caption-user')
    Object.defineProperty(column, 'scrollHeight', { configurable: true, value: 240 })

    emit?.({
      type: 'realtime_transcript_item', sessionId: 'session-1', phase: 'started',
      itemId: 'user-long', realtimeSessionId: 'rt-1', role: 'user', text: '', seq: 30,
    })
    emit?.({
      type: 'realtime_transcript_item', sessionId: 'session-1', phase: 'delta',
      itemId: 'user-long', text: 'a very long spoken sentence that wraps well past the box',
      seq: 31,
    })

    await waitFor(() => expect(column.scrollTop).toBe(240))
  })

  it('toggles microphone capture and speaker playback without closing the voice stream', async () => {
    render(<VoiceSurfaces />)
    await reachConnectedCall()

    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }))
    expect(microphoneTrack.enabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Unmute microphone' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Unmute microphone' }))
    expect(microphoneTrack.enabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Mute speaker' }))
    expect(screen.getByRole('button', { name: 'Unmute speaker' })).toHaveAttribute('aria-pressed', 'true')

    const remoteStream = {} as MediaStream
    const onTrack = peerConnections[0]?.ontrack as ((event: RTCTrackEvent) => void) | null
    onTrack?.({ streams: [remoteStream] } as unknown as RTCTrackEvent)
    expect(remoteAudio.srcObject).toBe(remoteStream)
    expect(remoteAudio.play).toHaveBeenCalled()
    expect(remoteAudio.muted).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Unmute speaker' }))
    expect(remoteAudio.muted).toBe(false)
    expect(stopRealtimeVoice).not.toHaveBeenCalled()
  })

  it('plays the ready cue once the media path connects, not when the answer arrives', async () => {
    render(<VoiceSurfaces />)
    await reachConnectedCall()
    expect(playVoiceReadyCue).not.toHaveBeenCalled()

    driveConnectionState('connected')
    expect(playVoiceReadyCue).toHaveBeenCalledTimes(1)

    // An ICE restart re-enters `connected`; the call is still the same call.
    driveConnectionState('connecting')
    driveConnectionState('connected')
    expect(playVoiceReadyCue).toHaveBeenCalledTimes(1)
  })

  it('stays silent and leaves capture alone when the speaker is muted', async () => {
    render(<VoiceSurfaces />)
    await reachConnectedCall()
    fireEvent.click(screen.getByRole('button', { name: 'Mute speaker' }))

    driveConnectionState('connected')
    expect(playVoiceReadyCue).not.toHaveBeenCalled()
    expect(microphoneTrack.enabled).toBe(true)
  })

  it('closes capture while the voice-shaped cue plays, then reopens it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<VoiceSurfaces />)
    await reachConnectedCall()

    driveConnectionState('connected')
    expect(microphoneTrack.enabled).toBe(false)

    await vi.advanceTimersByTimeAsync(VOICE_READY_CUE_MIC_GUARD_MS - 1)
    expect(microphoneTrack.enabled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(microphoneTrack.enabled).toBe(true)
  })

  it('does not reopen a microphone the user muted during the cue', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<VoiceSurfaces />)
    await reachConnectedCall()

    driveConnectionState('connected')
    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }))

    await vi.advanceTimersByTimeAsync(VOICE_READY_CUE_MIC_GUARD_MS)
    expect(microphoneTrack.enabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Unmute microphone' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows user and assistant transcript deltas only in the ephemeral voice caption', async () => {
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

    await waitFor(() => expect(screen.getByTestId('realtime-caption-user')).toHaveTextContent('Inspecting'))
    expect(screen.getByTestId('realtime-caption-assistant')).toHaveTextContent('Checking now')
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
    await waitFor(() => expect(screen.getByTestId('realtime-caption-user')).toHaveTextContent('Please fix it'))

    emit?.({
      type: 'realtime_transcript_item', sessionId: 'session-1', phase: 'completed',
      itemId: 'user-1', realtimeSessionId: 'rt-1', role: 'user', text: 'Please fix it.', seq: 22,
    })

    await waitFor(() => expect(screen.getByTestId('realtime-caption-user')).toHaveTextContent(''))
    const view = useCodexRealtimeViewStore.getState().sessions['session-1']!
    expect(mergeCodexRealtimeMessages([], view)).toMatchObject([{
      role: 'user',
      status: 'complete',
      content: [{ type: 'text', text: 'Please fix it.' }],
    }])
    expect(mergeCodexRealtimeMessages([], view)).toHaveLength(1)
  })

  it('ends the call when the session leaves the screen', async () => {
    const { unmount } = render(<VoiceSurfaces />)
    await reachConnectedCall()

    unmount()

    await waitFor(() => expect(stopRealtimeVoice).toHaveBeenCalledWith('/repo', 'session-1'))
  })
})
