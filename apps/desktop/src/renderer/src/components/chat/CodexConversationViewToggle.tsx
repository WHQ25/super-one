import { useEffect } from 'react'
import { AudioLines, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { hydrateCodexRealtimeTimeline, refreshCodexRealtimeTimeline, useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'

interface CodexConversationViewToggleProps {
  projectPath: string
  sessionId: string
  providerSessionId: string | null
  enabled: boolean
}

export function CodexConversationViewToggle({
  projectPath,
  sessionId,
  providerSessionId,
  enabled,
}: CodexConversationViewToggleProps) {
  const { t } = useTranslation()
  const view = useCodexRealtimeViewStore((state) => state.sessions[sessionId]?.view ?? 'thread')
  const hasTimeline = useCodexRealtimeViewStore((state) => state.sessions[sessionId]?.hasTimeline ?? false)
  const setView = useCodexRealtimeViewStore((state) => state.setView)

  useEffect(() => {
    if (!enabled || !projectPath || !sessionId || !providerSessionId || view !== 'thread' || hasTimeline) return
    void hydrateCodexRealtimeTimeline(projectPath, sessionId)
  }, [enabled, hasTimeline, projectPath, providerSessionId, sessionId, view])

  if (!enabled || !sessionId) return null

  const showingRealtime = view === 'realtime'
  if (!showingRealtime && !hasTimeline) return null
  const label = t(showingRealtime
    ? 'chat.realtimeVoice.showConversation'
    : 'chat.realtimeVoice.showTimeline')
  const toggleView = () => {
    const nextView = showingRealtime ? 'thread' : 'realtime'
    setView(sessionId, nextView)
    if (nextView !== 'thread' || !projectPath) return
    void refreshCodexRealtimeTimeline(projectPath, sessionId).catch(() => {
      // Keep the last known snapshot when a refresh fails.
    })
  }

  return (
    <IconButton
      size="sm"
      tooltip={label}
      aria-pressed={showingRealtime}
      className={cn(showingRealtime ? 'text-foreground' : 'text-muted-foreground/60')}
      onClick={toggleView}
    >
      {showingRealtime ? <MessageSquare className="size-[13px]" /> : <AudioLines />}
    </IconButton>
  )
}
