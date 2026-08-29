import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { cn } from '@superone/ui/lib/utils'
import type { ChatMessage as ChatMessageType, RealtimeTimelineSegment } from '@superone/shared/agent-types'
import {
  EMPTY_CODEX_REALTIME_SESSION_VIEW,
  hydrateCodexRealtimeTimeline,
  liveItemToSegment,
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
  const loading = realtime.loadStatus === 'idle' || realtime.loadStatus === 'loading'
  const loadError = realtime.loadStatus === 'error'

  useEffect(() => {
    void hydrateCodexRealtimeTimeline(projectPath, sessionId)
  }, [projectPath, sessionId])

  // Live items follow the snapshot: they are the tail of the conversation, ordered by
  // when each speaker started, and move into `segments` once a refresh publishes them.
  const transcript = useMemo<RealtimeTimelineSegment[]>(() => [
    ...realtime.segments,
    ...realtime.liveItems.filter((item) => item.text.length > 0).map(liveItemToSegment),
  ], [realtime.liveItems, realtime.segments])
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
        <SelectionContextMenuZone className={cn(
          'mx-auto flex w-full min-w-0 max-w-3xl flex-col p-3 @lg:p-3.5 @2xl:p-4',
          view === 'realtime' ? 'gap-0.5' : 'gap-1 @lg:gap-1.5 @2xl:gap-1.5',
        )}>
          {messages.map((message, index) => (
            <div key={message.id} data-message-id={message.id} className="chat-message-wrapper">
              <ChatMessage
                message={message}
                sessionStatus="idle"
                isLastAssistant={index === lastAssistantIndex}
                hideFooter={view === 'realtime'}
                compactSpacing={view === 'realtime'}
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
