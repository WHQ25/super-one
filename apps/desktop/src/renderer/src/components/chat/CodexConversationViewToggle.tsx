import { AudioLines, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'

interface CodexConversationViewToggleProps {
  sessionId: string
  enabled: boolean
}

/** Header-level escape hatch between the primary voice line and its backing thread. */
export function CodexConversationViewToggle({ sessionId, enabled }: CodexConversationViewToggleProps) {
  const { t } = useTranslation()
  const view = useCodexRealtimeViewStore((state) => state.sessions[sessionId]?.view ?? 'realtime')
  const hasTimeline = useCodexRealtimeViewStore((state) => state.sessions[sessionId]?.hasTimeline ?? false)
  const setView = useCodexRealtimeViewStore((state) => state.setView)
  if (!enabled || !sessionId || !hasTimeline) return null

  const showingRealtime = view === 'realtime'
  const label = t(showingRealtime
    ? 'chat.realtimeVoice.showDebugThread'
    : 'chat.realtimeVoice.showTimeline')
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
