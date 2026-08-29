import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { cn } from '@superone/ui/lib/utils'
import type { RealtimeTimelineSegment } from '@superone/shared/agent-types'
import {
  EMPTY_CODEX_REALTIME_SESSION_VIEW,
  hydrateCodexRealtimeTimeline,
  liveItemToSegment,
  type CodexConversationView,
  useCodexRealtimeViewStore,
} from '@/stores/codex-realtime-view'
import { ChatMessage } from './ChatMessage'
import { CodexRealtimeTimeline } from './CodexRealtimeTimeline'
import { SelectionContextMenuZone } from './SelectionContextMenu'

interface CodexRealtimeTranscriptProps {
  projectPath: string
  sessionId: string
  scrollViewportRef: React.RefObject<HTMLDivElement | null>
  liquidGlass: boolean
  view?: CodexConversationView
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
  // An item still streaming its transcript is the one being spoken right now.
  const speakingSegmentIds = useMemo(() => new Set(
    realtime.liveItems.filter((item) => !item.done && item.text.length > 0).map((item) => liveItemToSegment(item).id),
  ), [realtime.liveItems])
  const messages = view === 'thread' ? realtime.threadMessages : []
  const lastAssistantIndex = messages.findLastIndex((message) => message.role === 'assistant')
  const isEmpty = view === 'thread' ? messages.length === 0 : transcript.length === 0
  // A running call already knows what it is waiting for, so it never says "loading" —
  // the fetch it kicked off on mount would otherwise blank the view for a beat right as
  // the user starts speaking. Only a session with no live call falls back to the
  // load-status wording.
  const live = view === 'realtime' && (realtime.realtimeSessionId !== null || realtime.starting)
  const emptyStateKey = live
    ? 'chat.realtimeVoice.waiting'
    : loadError
      ? 'chat.realtimeVoice.timelineLoadFailed'
      : loading
        ? 'common.loading'
        : 'chat.realtimeVoice.emptyTimeline'

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden">
      <ScrollArea
        key={sessionId}
        className="chat-scroll-area h-full min-w-0"
        viewportRef={scrollViewportRef}
      >
        <SelectionContextMenuZone className={cn(
          'mx-auto flex w-full min-w-0 max-w-3xl flex-col p-3 @lg:p-3.5 @2xl:p-4',
          view === 'realtime' ? 'gap-0.5' : 'gap-1 @lg:gap-1.5 @2xl:gap-1.5',
        )}>
          {view === 'realtime'
            ? <CodexRealtimeTimeline segments={transcript} speakingSegmentIds={speakingSegmentIds} />
            : messages.map((message, index) => (
              <div key={message.id} data-message-id={message.id} className="chat-message-wrapper">
                <ChatMessage
                  message={message}
                  sessionStatus="idle"
                  isLastAssistant={index === lastAssistantIndex}
                />
              </div>
            ))}

          {isEmpty && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {t(emptyStateKey)}
            </p>
          )}
        </SelectionContextMenuZone>
      </ScrollArea>
      {!liquidGlass && <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-linear-to-t from-card to-transparent" />}
    </div>
  )
}
