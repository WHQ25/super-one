import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import type { ChatMessage as ChatMessageType, RealtimeTimelineSegment } from '@superone/shared/agent-types'
import {
  EMPTY_CODEX_REALTIME_SESSION_VIEW,
  type CodexConversationView,
  useCodexRealtimeViewStore,
} from '@/stores/codex-realtime-view'
import { ChatMessage } from './ChatMessage'
import { SelectionContextMenuZone } from './SelectionContextMenu'

interface CodexRealtimeTranscriptProps {
  projectPath: string
  sessionId: string
  scrollViewportRef: React.RefObject<HTMLDivElement | null>
  liquidGlass: boolean
  view?: CodexConversationView
}

export function realtimeSegmentToChatMessage(segment: RealtimeTimelineSegment): ChatMessageType {
  return {
    id: `realtime-${segment.realtimeSessionId}-${segment.id}`,
    role: segment.role,
    status: 'complete',
    content: [{ type: 'text', text: segment.text }],
    createdAt: '',
    providerId: 'codex',
  }
}

export function CodexRealtimeTranscript({
  projectPath,
  sessionId,
  scrollViewportRef,
  liquidGlass,
  view = 'realtime',
}: CodexRealtimeTranscriptProps) {
  const { t } = useTranslation()
  const realtime = useCodexRealtimeViewStore(
    (state) => state.sessions[sessionId] ?? EMPTY_CODEX_REALTIME_SESSION_VIEW,
  )
  const setTimeline = useCodexRealtimeViewStore((state) => state.setTimeline)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    void window.agent.getRealtimeTimeline(projectPath, sessionId).then((timeline) => {
      if (cancelled) return
      setTimeline(sessionId, timeline)
    }).catch(() => {
      if (!cancelled) setLoadError(true)
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [projectPath, sessionId, setTimeline])

  const transcript = useMemo<RealtimeTimelineSegment[]>(() => [
    ...realtime.segments,
    ...(realtime.liveText ? [{
      id: 'live',
      realtimeSessionId: realtime.realtimeSessionId ?? 'live',
      ...realtime.liveText,
    }] : []),
  ], [realtime.liveText, realtime.realtimeSessionId, realtime.segments])
  const realtimeMessages = useMemo(() => transcript.map(realtimeSegmentToChatMessage), [transcript])
  const messages = view === 'thread' ? realtime.threadMessages : realtimeMessages
  const lastAssistantIndex = messages.findLastIndex((message) => message.role === 'assistant')

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden">
      <ScrollArea
        key={sessionId}
        className="chat-scroll-area h-full min-w-0 animate-[fade-in_150ms_ease-out]"
        viewportRef={scrollViewportRef}
      >
        <SelectionContextMenuZone className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-1 p-3 @lg:gap-1.5 @lg:p-3.5 @2xl:gap-1.5 @2xl:p-4">
          {messages.map((message, index) => (
            <div key={message.id} data-message-id={message.id} className="chat-message-wrapper">
              <ChatMessage
                message={message}
                sessionStatus="idle"
                isLastAssistant={index === lastAssistantIndex}
                hideFooter={view === 'realtime'}
              />
            </div>
          ))}

          {!loading && messages.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {t(loadError
                ? 'chat.realtimeVoice.timelineLoadFailed'
                : view === 'realtime' && realtime.realtimeSessionId
                  ? 'chat.realtimeVoice.waiting'
                  : 'chat.realtimeVoice.emptyTimeline')}
            </p>
          )}
          {loading && messages.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
          )}
        </SelectionContextMenuZone>
      </ScrollArea>
      {!liquidGlass && <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-linear-to-t from-card to-transparent" />}
    </div>
  )
}
