import { useEffect } from 'react'
import { AudioLines, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { useBackingAgentName } from './backing-agent-name'

interface CodexConversationViewToggleProps {
  sessionId: string
  enabled: boolean
}

/** Header switch between the voice timeline and the backing agent thread of one session. */
export function CodexConversationViewToggle({ sessionId, enabled }: CodexConversationViewToggleProps) {
  const { t } = useTranslation()
  const agent = useBackingAgentName()
  const view = useCodexRealtimeViewStore((state) => state.sessions[sessionId]?.view ?? 'realtime')
  const hasTimeline = useCodexRealtimeViewStore((state) => state.sessions[sessionId]?.hasTimeline ?? false)
  const setView = useCodexRealtimeViewStore((state) => state.setView)
  useEffect(() => {
    if (!enabled || !sessionId) return
    window.app?.trace?.('realtime.view', 'toggle', { visible: hasTimeline, view }, sessionId)
  }, [enabled, hasTimeline, sessionId, view])
  if (!enabled || !sessionId || !hasTimeline) return null

  const showingRealtime = view === 'realtime'
  const label = showingRealtime
    ? t('chat.realtimeVoice.showThread', { agent })
    : t('chat.realtimeVoice.showTimeline')
  return (
    <IconButton
      size="sm"
      tooltip={label}
      aria-pressed={showingRealtime}
      onClick={() => setView(sessionId, showingRealtime ? 'thread' : 'realtime')}
    >
      {showingRealtime ? <MessageSquare className="size-[13px]" /> : <AudioLines />}
    </IconButton>
  )
}
