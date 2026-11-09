import { useContext, useEffect } from 'react'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { resolveDesktopVoiceRoute } from '@superone/shared/doubao-call'
import type { HarnessId } from '@superone/shared/agent-types'
import { AudioLines } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { realtimeVoiceAudioLevels, startDoubaoCall, startRealtimeCall, useRealtimeCallStore } from '@/stores/realtime-call'
import { refreshDoubaoVoicePreference, useDoubaoVoicePreference } from '@/stores/doubao-voice-preference'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { useChatStore } from '@/stores/chat'
import { useMosaicStore } from '../mosaic/mosaic-store'
import { VisibleSessionSplitContext } from '../mosaic/visible-session-split'
import { collectLeaves } from '../mosaic/mosaic-tree'
import { prepareComposerSession } from '@/lib/prepare-composer-session'
import { VoiceWaveform } from './VoiceWaveform'

export interface ComposerVoiceEntryProps {
  harness: HarnessId
  projectPath: string
  sessionId: string
  additionalDirs?: string[]
  disabled?: boolean
  /**
   * Official Codex keeps WebRTC. Omitted means the harness capability flag is official,
   * so existing composer tests keep the Codex button without passing an account id.
   */
  officialCodex?: boolean
  /** Remote sessions cannot open the desktop Doubao socket. */
  allowDoubao?: boolean
}

/** Every harness can return to the global call; starting follows backend capabilities. */
export function ComposerVoiceEntry({
  harness,
  projectPath,
  sessionId,
  additionalDirs,
  disabled = false,
  officialCodex,
  allowDoubao = true,
}: ComposerVoiceEntryProps) {
  const { t } = useTranslation()
  const preference = useDoubaoVoicePreference(state => state.preference)
  const doubaoConfigured = useDoubaoVoicePreference(state => state.configured)
  const visibleSplit = useContext(VisibleSessionSplitContext)
  useEffect(() => { refreshDoubaoVoicePreference() }, [])
  const callState = useRealtimeCallStore(store => store.state)
  const callSessionId = useRealtimeCallStore(store => store.sessionId)
  const callProjectPath = useRealtimeCallStore(store => store.projectPath)
  const paused = useRealtimeCallStore(store => store.paused)

  if (callState !== 'idle' && callSessionId) {
    const ownCall = callProjectPath === projectPath && callSessionId === sessionId
    if (!ownCall && collectLeaves(visibleSplit).some(leaf => leaf.projectPath === callProjectPath && leaf.sessionId === callSessionId)) return null
    return <IconButton size="sm" variant="ghost" className="rounded-full"
      tooltip={t('chat.realtimeVoice.returnToVoice')}
      onClick={() => {
        const showVoice = () => useCodexRealtimeViewStore.getState().setView(callSessionId, 'realtime')
        if (callProjectPath && !ownCall) {
          // In a split, navigation must reveal the call in the focused pane too.
          if (useMosaicStore.getState().focusOrReplaceFocused(callProjectPath, callSessionId)) showVoice()
          else void useChatStore.getState().switchToSession(callProjectPath, callSessionId).then(showVoice)
        } else showVoice()
      }}>
      <VoiceWaveform levels={realtimeVoiceAudioLevels} compact paused={paused || callState !== 'active'} />
    </IconButton>
  }

  const official = officialCodex ?? HARNESS_CAPABILITIES[harness].supportsRealtimeVoice === true
  const route = resolveDesktopVoiceRoute({
    preference,
    harnessId: harness,
    apiProviderId: official ? null : 'custom',
    canSend: !disabled,
    doubaoConfigured: allowDoubao && doubaoConfigured,
  })
  if (disabled || !route) return null

  return (
    <IconButton
      size="sm"
      variant="ghost"
      tooltip={t('chat.realtimeVoice.start')}
      aria-label={t('chat.realtimeVoice.start')}
      className="rounded-full border border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background"
      onClick={() => {
        const start = route === 'doubao' ? startDoubaoCall : startRealtimeCall
        void start({
          projectPath,
          sessionId,
          prepareSession: () => prepareComposerSession(projectPath, { projectPath, sessionId }),
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
