import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Mic, Square, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import type { AgentEvent, RealtimeTimelineSegment } from '@superone/shared/agent-types'

type VoiceState = 'idle' | 'starting' | 'active' | 'stopping'

async function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === 'complete') return
  await new Promise<void>((resolve, reject) => {
    let timeout = 0
    const onChange = (): void => {
      if (peer.iceGatheringState !== 'complete') return
      peer.removeEventListener('icegatheringstatechange', onChange)
      window.clearTimeout(timeout)
      resolve()
    }
    timeout = window.setTimeout(() => {
      peer.removeEventListener('icegatheringstatechange', onChange)
      reject(new Error('WebRTC ICE gathering timed out.'))
    }, 10_000)
    peer.addEventListener('icegatheringstatechange', onChange)
  })
}

export interface CodexRealtimeVoiceButtonProps {
  projectPath: string
  sessionId: string
  disabled?: boolean
}

export function CodexRealtimeVoiceButton({ projectPath, sessionId, disabled = false }: CodexRealtimeVoiceButtonProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<VoiceState>('idle')
  const [panelOpen, setPanelOpen] = useState(false)
  const [segments, setSegments] = useState<RealtimeTimelineSegment[]>([])
  const [liveText, setLiveText] = useState<{ role: 'user' | 'assistant'; text: string } | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const stateRef = useRef<VoiceState>('idle')
  const timelineLoadedRef = useRef(false)
  const negotiationTimerRef = useRef<number | null>(null)

  const updateState = useCallback((next: VoiceState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const releaseMedia = useCallback(() => {
    if (negotiationTimerRef.current !== null) window.clearTimeout(negotiationTimerRef.current)
    negotiationTimerRef.current = null
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
    peerRef.current?.close()
    peerRef.current = null
    if (audioRef.current) audioRef.current.srcObject = null
    audioRef.current = null
  }, [])

  const refreshTimeline = useCallback(async () => {
    try {
      const timeline = await window.agent.getRealtimeTimeline(projectPath, sessionId)
      setSegments(timeline.segments)
      timelineLoadedRef.current = true
    } catch {
      // Timeline is supplementary; a live call can still proceed.
    }
  }, [projectPath, sessionId])

  useEffect(() => window.agent.onAgentEvent((event: AgentEvent) => {
    if (event.sessionId !== sessionId) return
    if (event.type === 'realtime_sdp') {
      const peer = peerRef.current
      if (!peer || peer.signalingState === 'closed') return
      void peer.setRemoteDescription({ type: 'answer', sdp: event.sdp }).then(() => {
        updateState('active')
      }).catch((error) => {
        toast.error(error instanceof Error ? error.message : String(error))
        releaseMedia()
        updateState('idle')
      })
      return
    }
    if (event.type === 'realtime_transcript') {
      setPanelOpen(true)
      if (event.final) {
        setSegments((current) => [...current, {
          id: `live-${Date.now()}-${current.length}`,
          realtimeSessionId: 'live',
          role: event.role,
          text: event.text,
        }])
        setLiveText(null)
      } else {
        setLiveText((current) => ({
          role: event.role,
          text: current?.role === event.role ? `${current.text}${event.text}` : event.text,
        }))
      }
      return
    }
    if (event.type === 'realtime_error') {
      toast.error(event.error)
      releaseMedia()
      updateState('idle')
      return
    }
    if (event.type === 'realtime_closed') {
      releaseMedia()
      updateState('idle')
      void refreshTimeline()
    }
  }), [refreshTimeline, releaseMedia, sessionId, updateState])

  useEffect(() => () => {
    releaseMedia()
    if (stateRef.current !== 'idle') void window.agent.stopRealtimeVoice(projectPath, sessionId)
  }, [projectPath, releaseMedia, sessionId])

  const start = useCallback(async () => {
    updateState('starting')
    setPanelOpen(true)
    if (!timelineLoadedRef.current) void refreshTimeline()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream
      const peer = new RTCPeerConnection()
      peerRef.current = peer
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
      await window.agent.startRealtimeVoice(projectPath, sessionId, { sdp, voice: 'cove' })
      if (stateRef.current === 'starting') {
        negotiationTimerRef.current = window.setTimeout(() => {
          if (stateRef.current !== 'starting') return
          void window.agent.stopRealtimeVoice(projectPath, sessionId)
          releaseMedia()
          updateState('idle')
          toast.error(t('chat.realtimeVoice.connectionTimedOut'))
        }, 15_000)
      }
    } catch (error) {
      releaseMedia()
      updateState('idle')
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [projectPath, refreshTimeline, releaseMedia, sessionId, t, updateState])

  const stop = useCallback(async () => {
    updateState('stopping')
    try {
      await window.agent.stopRealtimeVoice(projectPath, sessionId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      releaseMedia()
      updateState('idle')
      void refreshTimeline()
    }
  }, [projectPath, refreshTimeline, releaseMedia, sessionId, updateState])

  const active = state === 'active' || state === 'stopping'
  const busy = state === 'starting' || state === 'stopping'
  const transcript = [...segments, ...(liveText ? [{
    id: 'live',
    realtimeSessionId: 'live',
    ...liveText,
  }] : [])]

  return (
    <div className="relative">
      <IconButton
        size="sm"
        disabled={disabled || busy}
        tooltip={t(active ? 'chat.realtimeVoice.stop' : 'chat.realtimeVoice.start')}
        className={cn(active && 'bg-red-500/15 text-red-500 hover:bg-red-500/20 hover:text-red-500')}
        onClick={() => { void (active ? stop() : start()) }}
      >
        {busy ? <Loader2 className="animate-spin" /> : active ? <Square className="fill-current" /> : <Mic />}
      </IconButton>
      {panelOpen && (state !== 'idle' || transcript.length > 0) && (
        <div className="absolute bottom-full right-0 z-50 mb-2 flex max-h-64 w-80 flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium">
            <span className={cn('size-2 rounded-full', active ? 'animate-pulse bg-red-500' : 'bg-muted-foreground')} />
            <span className="flex-1">{t(active ? 'chat.realtimeVoice.listening' : 'chat.realtimeVoice.timeline')}</span>
            {!active && (
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setPanelOpen(false)}>
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="space-y-2 overflow-y-auto p-3 text-xs">
            {transcript.length === 0 ? (
              <p className="text-muted-foreground">{t('chat.realtimeVoice.waiting')}</p>
            ) : transcript.slice(-20).map((segment) => (
              <div key={segment.id} className={cn('flex', segment.role === 'assistant' ? 'justify-start' : 'justify-end')}>
                <p className={cn(
                  'max-w-[85%] rounded-lg px-2.5 py-1.5 leading-relaxed',
                  segment.role === 'assistant' ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground',
                )}>
                  {segment.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
