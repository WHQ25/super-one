/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { CodexRealtimeVoiceButton } from './CodexRealtimeVoiceButton'

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
}

describe('CodexRealtimeVoiceButton', () => {
  let emit: ((event: AgentEvent) => void) | null
  const startRealtimeVoice = vi.fn(async () => {})
  const stopRealtimeVoice = vi.fn(async () => {})
  const stopTrack = vi.fn()

  beforeEach(() => {
    emit = null
    useCodexRealtimeViewStore.setState({ sessions: {} })
    startRealtimeVoice.mockClear()
    stopRealtimeVoice.mockClear()
    stopTrack.mockClear()
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getAudioTracks: () => [{ stop: stopTrack }],
          getTracks: () => [{ stop: stopTrack }],
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
  })

  it('enters the call view on the click instead of waiting for the SDP answer', async () => {
    render(<CodexRealtimeVoiceButton projectPath="/repo" sessionId="session-1" />)
    fireEvent.click(screen.getByRole('button'))

    // Negotiation takes seconds. Leaving the pane on the empty-session chrome for that
    // span walks it through three mutually exclusive branches, each of which remounts
    // the harness picker — the user sees the chat blank out and rebuild.
    await waitFor(() => {
      const view = useCodexRealtimeViewStore.getState().sessions['session-1']
      expect(view?.view).toBe('realtime')
      expect(view?.starting).toBe(true)
    })
    expect(useCodexRealtimeViewStore.getState().sessions['session-1']?.realtimeSessionId).toBeNull()
  })

  it('returns to the previous view when the call never connects', async () => {
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('microphone blocked'))
    useCodexRealtimeViewStore.getState().setView('session-1', 'thread')

    render(<CodexRealtimeVoiceButton projectPath="/repo" sessionId="session-1" />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      const view = useCodexRealtimeViewStore.getState().sessions['session-1']
      expect(view?.view).toBe('thread')
      expect(view?.starting).toBe(false)
    })
  })

  it('negotiates WebRTC through the session API and stops the microphone', async () => {
    render(<CodexRealtimeVoiceButton projectPath="/repo" sessionId="session-1" additionalDirs={['/extra']} />)
    const voiceButton = screen.getByRole('button')
    expect(voiceButton.querySelector('.lucide-audio-lines')).not.toBeNull()
    expect(voiceButton).toHaveClass('size-6', 'rounded-full', 'bg-foreground', 'text-background')
    fireEvent.click(voiceButton)

    await waitFor(() => expect(startRealtimeVoice).toHaveBeenCalledWith('/repo', 'session-1', {
      sdp: 'local-offer',
      additionalDirs: ['/extra'],
    }))

    // The view already entered the call on the click; `realtime_started` only names it.
    expect(useCodexRealtimeViewStore.getState().sessions['session-1']?.view).toBe('realtime')
    emit?.({
      type: 'realtime_started',
      sessionId: 'session-1',
      realtimeSessionId: 'realtime-1',
      version: 'v3',
    })
    const started = useCodexRealtimeViewStore.getState().sessions['session-1']
    expect(started?.view).toBe('realtime')
    expect(started?.realtimeSessionId).toBe('realtime-1')
    expect(started?.starting).toBe(false)

    emit?.({
      type: 'realtime_sdp',
      sessionId: 'session-1',
      sdp: 'v=0\r\na=candidate:tcp 1 tcp 1671430143 192.0.2.1 443 typ host tcptype passive\r\n',
    })
    await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled())
    expect(screen.getByRole('button').querySelector('.lucide-x')).not.toBeNull()
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(stopRealtimeVoice).toHaveBeenCalledWith('/repo', 'session-1'))
    expect(stopTrack).toHaveBeenCalled()
    expect(useCodexRealtimeViewStore.getState().sessions['session-1']?.realtimeSessionId).toBeNull()
  })
})
