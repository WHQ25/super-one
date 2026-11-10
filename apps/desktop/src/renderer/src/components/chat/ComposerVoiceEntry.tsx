import { useContext, useEffect } from 'react'
import { resolveDesktopVoiceRoute } from '@superone/shared/desktop-voice-route'
import type { HarnessId } from '@superone/shared/agent-types'
import { AudioLines } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { realtimeVoiceAudioLevels, startDoubaoCall, startGeminiCall, startRealtimeCall, useRealtimeCallStore } from '@/stores/realtime-call'
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
   * Codex account id for this session. Omitted means no API provider, so an
   * official Codex harness keeps Codex Realtime. A non-account provider id
   * follows the selected Doubao or Gemini model.
   */
  codexProviderId?: string | null
  /** Remote sessions cannot open a desktop speech socket (Doubao or Gemini). */
  allowDoubao?: boolean
}

/** Every harness can return to the global call; starting follows backend capabilities. */
export function ComposerVoiceEntry({
  harness,
  projectPath,
  sessionId,
  additionalDirs,
  disabled = false,
  codexProviderId,
  allowDoubao = true,
}: ComposerVoiceEntryProps) {
  const { t } = useTranslation()
  const preference = useDoubaoVoicePreference(state => state.preference)
  const doubaoConfigured = useDoubaoVoicePreference(state => state.configured)
  const geminiConfigured = useDoubaoVoicePreference(state => state.geminiConfigured)
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

  const route = resolveDesktopVoiceRoute({
    preference,
    harnessId: harness,
    apiProviderId: codexProviderId,
    canSend: !disabled,
    doubaoConfigured: allowDoubao && doubaoConfigured,
    geminiConfigured: allowDoubao && geminiConfigured,
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
        const start = route === 'doubao' ? startDoubaoCall : route === 'gemini' ? startGeminiCall : startRealtimeCall
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
