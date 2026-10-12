import { AudioLines } from 'lucide-react'
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
  const otherCallEngaged = useRealtimeCallStore((store) => (
    store.state !== 'idle' && store.sessionId !== sessionId
  ))
  const callState = useRealtimeCallStore((store) => (
    store.sessionId === sessionId ? store.state : 'idle'
  ))

  if (otherCallEngaged) return null

  // Connected, the button becomes the call's whole control set. It lives here rather
  // than on the indicator above the composer because this strip is where every other
  // action on a turn already is.
  if (callState === 'active' || callState === 'stopping') {
    return <RealtimeCallControls disabled={callState === 'stopping'} />
  }

  if (disabled || callState === 'starting') return null

  return (
    <IconButton
      size="sm"
      variant="ghost"
      tooltip={t('chat.realtimeVoice.start')}
      aria-label={t('chat.realtimeVoice.start')}
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
      <AudioLines />
    </IconButton>
  )
}
