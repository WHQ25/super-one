import { Mic, MicOff, Power, Volume2, VolumeX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import {
  stopRealtimeCall,
  toggleRealtimeMicrophone,
  toggleRealtimeOutput,
  useRealtimeCallStore,
} from '@/stores/realtime-call'

interface RealtimeCallControlsProps {
  disabled?: boolean
  /**
   * `toolbar` sits in the composer strip beside the session's other actions;
   * `centered` is the voice composer's own row under the voice mark, hang-up in
   * the middle with microphone and speaker either side.
   */
  layout?: 'toolbar' | 'centered'
}

/**
 * The running call's whole control set — microphone, speaker, hang up.
 *
 * Shared by the composer toolbar (backing-thread view) and the voice composer, so
 * both surfaces expose the same three actions with the same affordances.
 */
export function RealtimeCallControls({ disabled = false, layout = 'toolbar' }: RealtimeCallControlsProps) {
  const { t } = useTranslation()
  const microphoneMuted = useRealtimeCallStore((store) => store.microphoneMuted)
  const outputMuted = useRealtimeCallStore((store) => store.outputMuted)
  const centered = layout === 'centered'
  // The centered row sits under an 84px mark; the buttons read as its footnote.
  const compact = centered ? 'size-5 rounded-full [&_svg:not([class*=size-])]:size-3' : undefined

  // A muted channel is a state the user should notice at a glance, so the icon
  // takes the error status color (not destructive: nothing is being deleted).
  const microphone = (
    <IconButton
      key="microphone"
      size="sm"
      variant="ghost"
      disabled={disabled}
      aria-pressed={microphoneMuted}
      tooltip={t(microphoneMuted
        ? 'chat.realtimeVoice.unmuteMicrophone'
        : 'chat.realtimeVoice.muteMicrophone')}
      className={cn(compact, microphoneMuted && 'text-error hover:text-error')}
      onClick={toggleRealtimeMicrophone}
    >
      {microphoneMuted ? <MicOff /> : <Mic />}
    </IconButton>
  )
  const speaker = (
    <IconButton
      key="speaker"
      size="sm"
      variant="ghost"
      disabled={disabled}
      aria-pressed={outputMuted}
      tooltip={t(outputMuted
        ? 'chat.realtimeVoice.unmuteOutput'
        : 'chat.realtimeVoice.muteOutput')}
      className={cn(compact, outputMuted && 'text-error hover:text-error')}
      onClick={toggleRealtimeOutput}
    >
      {outputMuted ? <VolumeX /> : <Volume2 />}
    </IconButton>
  )
  // Keep the hang-up visually consistent; the tooltip carries the destructive
  // meaning without turning the action into a red alert.
  const hangUp = (
    <IconButton
      key="hang-up"
      size="sm"
      variant="ghost"
      disabled={disabled}
      tooltip={t('chat.realtimeVoice.stop')}
      className={cn(
        'rounded-full bg-muted-foreground text-background hover:bg-foreground hover:text-background',
        centered && 'size-6 [&_svg:not([class*=size-])]:size-3.5',
      )}
      onClick={() => { void stopRealtimeCall() }}
    >
      <Power />
    </IconButton>
  )

  return centered ? <>{microphone}{hangUp}{speaker}</> : <>{microphone}{speaker}{hangUp}</>
}
