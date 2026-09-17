import { AudioLines, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { startRealtimeCall, useRealtimeCallStore } from '@/stores/realtime-call'
import { RealtimeCallControls } from './RealtimeCallControls'

export interface CodexRealtimeVoiceButtonProps {
  projectPath: string
  sessionId: string
  additionalDirs?: string[]
  disabled?: boolean
}

/**
 * Realtime voice entry point for the composer toolbar.
 *
 * Idle it is a single button; connected it hands over to `RealtimeCallControls`, the
 * same set the voice composer shows, so a call is controllable from both views.
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

  // Connected, the button becomes the call's whole control set. It lives here rather
  // than on the indicator above the composer because this strip is where every other
  // action on a turn already is.
  if (callState === 'active' || callState === 'stopping') {
    return <RealtimeCallControls disabled={callState === 'stopping'} />
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
