import { AudioLines } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { realtimeVoiceAudioLevels, startRealtimeCall, useRealtimeCallStore } from '@/stores/realtime-call'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { useChatStore } from '@/stores/chat'
import { VoiceWaveform } from './VoiceWaveform'

export interface CodexRealtimeVoiceButtonProps {
  projectPath: string
  sessionId: string
  additionalDirs?: string[]
  disabled?: boolean
}

/** Start a call, or return from text to the current voice conversation. */
export function CodexRealtimeVoiceButton({
  projectPath,
  sessionId,
  additionalDirs,
  disabled = false,
}: CodexRealtimeVoiceButtonProps) {
  const { t } = useTranslation()
  const callState = useRealtimeCallStore(store => store.state)
  const callSessionId = useRealtimeCallStore(store => store.sessionId)
  const callProjectPath = useRealtimeCallStore(store => store.projectPath)
  const paused = useRealtimeCallStore(store => store.paused)

  if (callState !== 'idle' && callSessionId) {
    return <IconButton size="sm" variant="ghost" className="rounded-full"
      tooltip={t('chat.realtimeVoice.returnToVoice')}
      onClick={() => {
        if (callProjectPath && (callSessionId !== sessionId || callProjectPath !== projectPath)) {
          void useChatStore.getState().switchToSession(callProjectPath, callSessionId).then(() => {
            useCodexRealtimeViewStore.getState().setView(callSessionId, 'realtime')
          })
        } else useCodexRealtimeViewStore.getState().setView(callSessionId, 'realtime')
      }}>
      <VoiceWaveform levels={realtimeVoiceAudioLevels} compact paused={paused || callState !== 'active'} />
    </IconButton>
  }

  if (disabled) return null

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
