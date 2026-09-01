import { useEffect } from 'react'
import { AudioLines, Loader2, Mic, MicOff, Power, Volume2, VolumeX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import {
  startRealtimeCall,
  stopRealtimeCall,
  toggleRealtimeMicrophone,
  toggleRealtimeOutput,
  useRealtimeCallStore,
} from '@/stores/realtime-call'

export interface CodexRealtimeVoiceButtonProps {
  projectPath: string
  sessionId: string
  additionalDirs?: string[]
  disabled?: boolean
}

/**
 * Realtime voice controls for the composer toolbar.
 *
 * Idle it is a single entry point; connected it becomes the call's whole control set
 * — microphone, speaker, hang up. They live here rather than on the indicator above
 * the composer because this strip is where every other action on a turn already is,
 * and a control that only exists on hover is a control most people never find.
 * The indicator stays a pure status surface.
 */
export function CodexRealtimeVoiceButton({
  projectPath,
  sessionId,
  additionalDirs,
  disabled = false,
}: CodexRealtimeVoiceButtonProps) {
  const { t } = useTranslation()
  const callState = useRealtimeCallStore((store) => (
    store.sessionId === sessionId ? store.state : 'idle'
  ))
  const microphoneMuted = useRealtimeCallStore((store) => store.microphoneMuted)
  const outputMuted = useRealtimeCallStore((store) => store.outputMuted)

  // A call belongs to the session on screen. Navigating away unmounts this button,
  // and a call the user can neither hear about nor hang up is worse than a dropped
  // one — so leaving the session ends it, as it did before the call was lifted out
  // of this component.
  useEffect(() => () => {
    if (useRealtimeCallStore.getState().sessionId === sessionId) void stopRealtimeCall()
  }, [sessionId])

  if (callState === 'active' || callState === 'stopping') {
    // Keep the call controls visually consistent; the tooltip carries the destructive
    // meaning without turning the hang-up action into a red alert.
    const busy = callState === 'stopping'
    return (
      <>
        <IconButton
          size="sm"
          variant="ghost"
          disabled={busy}
          aria-pressed={microphoneMuted}
          tooltip={t(microphoneMuted
            ? 'chat.realtimeVoice.unmuteMicrophone'
            : 'chat.realtimeVoice.muteMicrophone')}
          onClick={toggleRealtimeMicrophone}
        >
          {microphoneMuted ? <MicOff /> : <Mic />}
        </IconButton>
        <IconButton
          size="sm"
          variant="ghost"
          disabled={busy}
          aria-pressed={outputMuted}
          tooltip={t(outputMuted
            ? 'chat.realtimeVoice.unmuteOutput'
            : 'chat.realtimeVoice.muteOutput')}
          onClick={toggleRealtimeOutput}
        >
          {outputMuted ? <VolumeX /> : <Volume2 />}
        </IconButton>
        <IconButton
          size="sm"
          variant="ghost"
          disabled={busy}
          tooltip={t('chat.realtimeVoice.stop')}
          className="rounded-full bg-muted-foreground text-background hover:bg-foreground hover:text-background"
          onClick={() => { void stopRealtimeCall() }}
        >
          <Power />
        </IconButton>
      </>
    )
  }

  const busy = callState === 'starting'
  return (
    <IconButton
      size="sm"
      variant="ghost"
      disabled={disabled || busy}
      tooltip={t('chat.realtimeVoice.start')}
      className="rounded-full border border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background"
      onClick={() => {
        void startRealtimeCall({
          projectPath,
          sessionId,
          ...(additionalDirs !== undefined ? { additionalDirs } : {}),
          messages: {
            offerFailed: t('chat.realtimeVoice.offerFailed'),
            connectionTimedOut: t('chat.realtimeVoice.connectionTimedOut'),
          },
        })
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <AudioLines />}
    </IconButton>
  )
}
