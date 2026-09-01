import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioLines, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import type { AgentEvent } from '@superone/shared/agent-types'
import {
  refreshCodexRealtimeTimeline,
  useCodexRealtimeViewStore,
} from '@/stores/codex-realtime-view'
import { preferTcpIceCandidates, startWebRtcDiagnostics, waitForIceGathering } from '@/lib/realtime-webrtc'

type VoiceState = 'idle' | 'starting' | 'active' | 'stopping'

export interface CodexRealtimeVoiceButtonProps {
  projectPath: string
  sessionId: string
  additionalDirs?: string[]
  disabled?: boolean
}

export function CodexRealtimeVoiceButton({ projectPath, sessionId, additionalDirs, disabled = false }: CodexRealtimeVoiceButtonProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<VoiceState>('idle')
  const setRealtimeSession = useCodexRealtimeViewStore((store) => store.setRealtimeSession)
  const setRealtimeStarting = useCodexRealtimeViewStore((store) => store.setRealtimeStarting)
  const startTranscriptItem = useCodexRealtimeViewStore((store) => store.startTranscriptItem)
  const appendTranscriptItemDelta = useCodexRealtimeViewStore((store) => store.appendTranscriptItemDelta)
  const completeTranscriptItem = useCodexRealtimeViewStore((store) => store.completeTranscriptItem)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const stopDiagnosticsRef = useRef<(() => void) | null>(null)
  const stateRef = useRef<VoiceState>('idle')
  const timelineLoadedRef = useRef(false)
  const negotiationTimerRef = useRef<number | null>(null)

  useEffect(() => {
    timelineLoadedRef.current = false
  }, [projectPath, sessionId])

  const updateState = useCallback((next: VoiceState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const abandonStart = useCallback(() => {
    setRealtimeStarting(sessionId, false)
  }, [sessionId, setRealtimeStarting])

  const releaseMedia = useCallback(() => {
    if (negotiationTimerRef.current !== null) window.clearTimeout(negotiationTimerRef.current)
    negotiationTimerRef.current = null
    stopDiagnosticsRef.current?.()
    stopDiagnosticsRef.current = null
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
    peerRef.current?.close()
    peerRef.current = null
    if (audioRef.current) audioRef.current.srcObject = null
    audioRef.current = null
  }, [])

  const refreshTimeline = useCallback(async () => {
    try {
      await refreshCodexRealtimeTimeline(projectPath, sessionId)
      timelineLoadedRef.current = true
    } catch {
      // Timeline is supplementary; a live call can still proceed.
    }
  }, [projectPath, sessionId])

  useEffect(() => window.agent.onAgentEvent((event: AgentEvent) => {
    if (event.sessionId !== sessionId) return
    if (event.type === 'realtime_started') {
      setRealtimeSession(sessionId, event.realtimeSessionId ?? 'live')
      return
    }
    if (event.type === 'realtime_sdp') {
      const peer = peerRef.current
      if (!peer || peer.signalingState === 'closed') return
      const tcpPreference = preferTcpIceCandidates(event.sdp)
      window.app?.trace?.('realtime.webrtc', 'tcp_preference', {
        applied: tcpPreference.applied,
        tcpCandidateCount: tcpPreference.tcpCandidateCount,
        fallbackCandidateCount: tcpPreference.fallbackCandidateCount,
        reprioritizedCandidateCount: tcpPreference.reprioritizedCandidateCount,
      }, sessionId)
      void peer.setRemoteDescription({ type: 'answer', sdp: tcpPreference.sdp }).then(() => {
        updateState('active')
      }).catch((error) => {
        toast.error(error instanceof Error ? error.message : String(error))
        releaseMedia()
        updateState('idle')
        abandonStart()
      })
      return
    }
    if (event.type === 'realtime_transcript_item') {
      if (event.phase === 'delta') {
        appendTranscriptItemDelta(sessionId, event.itemId, event.text)
        return
      }
      // `started`/`completed` always carry the item's role and realtime session.
      if (!event.role || !event.realtimeSessionId) return
      const item = {
        itemId: event.itemId,
        realtimeSessionId: event.realtimeSessionId,
        role: event.role,
        text: event.text,
        ...(event.startedAtMs === undefined ? {} : { startedAtMs: event.startedAtMs }),
      }
      if (event.phase === 'started') startTranscriptItem(sessionId, item)
      else completeTranscriptItem(sessionId, item)
      return
    }
    if (event.type === 'realtime_error') {
      toast.error(event.error)
      releaseMedia()
      updateState('idle')
      abandonStart()
      return
    }
    if (event.type === 'realtime_closed') {
      releaseMedia()
      updateState('idle')
      setRealtimeSession(sessionId, null)
      void refreshTimeline()
    }
  }), [abandonStart, appendTranscriptItemDelta, completeTranscriptItem, refreshTimeline, releaseMedia, sessionId, setRealtimeSession, startTranscriptItem, updateState])

  useEffect(() => () => {
    releaseMedia()
    setRealtimeSession(sessionId, null)
    if (stateRef.current !== 'idle') void window.agent.stopRealtimeVoice(projectPath, sessionId)
  }, [projectPath, releaseMedia, sessionId, setRealtimeSession])

  const start = useCallback(async () => {
    updateState('starting')
    setRealtimeStarting(sessionId, true)
    if (!timelineLoadedRef.current) void refreshTimeline()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream
      const peer = new RTCPeerConnection()
      peerRef.current = peer
      if (import.meta.env.DEV) {
        stopDiagnosticsRef.current = startWebRtcDiagnostics(peer, (type, data) => {
          window.app?.trace?.('realtime.webrtc', type, data, sessionId)
        })
      }
      peer.createDataChannel('oai-events')
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream)
      peer.ontrack = (event) => {
        const audio = audioRef.current ?? new Audio()
        audio.autoplay = true
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track])
        audioRef.current = audio
        void audio.play().catch(() => {})
      }
      peer.onconnectionstatechange = () => {
        if (peer.connectionState !== 'failed' && peer.connectionState !== 'disconnected') return
        releaseMedia()
        updateState('idle')
      }
      const offer = await peer.createOffer({ offerToReceiveAudio: true })
      await peer.setLocalDescription(offer)
      await waitForIceGathering(peer)
      const sdp = peer.localDescription?.sdp
      if (!sdp) throw new Error(t('chat.realtimeVoice.offerFailed'))
      await window.agent.startRealtimeVoice(projectPath, sessionId, {
        sdp,
        ...(additionalDirs !== undefined ? { additionalDirs } : {}),
      })
      if (stateRef.current === 'starting') {
        negotiationTimerRef.current = window.setTimeout(() => {
          if (stateRef.current !== 'starting') return
          void window.agent.stopRealtimeVoice(projectPath, sessionId)
          releaseMedia()
          updateState('idle')
          abandonStart()
          toast.error(t('chat.realtimeVoice.connectionTimedOut'))
        }, 15_000)
      }
    } catch (error) {
      releaseMedia()
      updateState('idle')
      abandonStart()
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [
    abandonStart, additionalDirs, projectPath, refreshTimeline, releaseMedia, sessionId,
    setRealtimeStarting, t, updateState,
  ])

  const stop = useCallback(async () => {
    updateState('stopping')
    try {
      await window.agent.stopRealtimeVoice(projectPath, sessionId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      releaseMedia()
      updateState('idle')
      setRealtimeSession(sessionId, null)
      void refreshTimeline()
    }
  }, [projectPath, refreshTimeline, releaseMedia, sessionId, setRealtimeSession, updateState])

  const active = state === 'active' || state === 'stopping'
  const busy = state === 'starting' || state === 'stopping'

  return (
    <IconButton
      size="sm"
      variant="ghost"
      disabled={disabled || busy}
      tooltip={t(active ? 'chat.realtimeVoice.stop' : 'chat.realtimeVoice.start')}
      className={cn(
        'rounded-full border',
        active
          ? 'border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground'
          : 'border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background',
      )}
      onClick={() => { void (active ? stop() : start()) }}
    >
      {busy ? <Loader2 className="animate-spin" /> : active ? <X /> : <AudioLines />}
    </IconButton>
  )
}
