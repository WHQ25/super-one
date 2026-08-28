import { useEffect } from 'react'
import { AudioLines, MessagesSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'

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
  const setTimeline = useCodexRealtimeViewStore((state) => state.setTimeline)

  useEffect(() => {
    if (!enabled || !projectPath || !sessionId || !providerSessionId || view !== 'thread' || hasTimeline) return
    let cancelled = false
    void window.agent.getRealtimeTimeline(projectPath, sessionId).then((timeline) => {
      if (!cancelled) setTimeline(sessionId, timeline)
    }).catch(() => {
      // A timeline is optional; keep the control hidden when it cannot be loaded.
    })
    return () => { cancelled = true }
  }, [enabled, hasTimeline, projectPath, providerSessionId, sessionId, setTimeline, view])

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
    void window.agent.getRealtimeTimeline(projectPath, sessionId).then((timeline) => {
      setTimeline(sessionId, timeline)
    }).catch(() => {
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
      {showingRealtime ? <MessagesSquare /> : <AudioLines />}
    </IconButton>
  )
}
