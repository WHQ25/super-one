import { Fragment, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import type { AgentStatus, ChatMessage } from '@superone/shared/agent-types'
import {
  EMPTY_CODEX_REALTIME_SESSION_VIEW,
  hydrateCodexRealtimeTimeline,
  useCodexRealtimeViewStore,
} from '@/stores/codex-realtime-view'
import { realtimeSegmentsToMessage, selectRealtimeTranscript } from './codex-realtime-messages'
import { buildRealtimeConversationTurns } from './realtime-conversation-turns'
import { buildRealtimeTranscriptLayout, mapRealtimeTurnActivities } from './realtime-turn-activities'
import { SelectionContextMenuZone } from './SelectionContextMenu'
import { ChatMessage as ChatMessageView, findLastAssistantMessageId } from './ChatMessage'
import { PlanApprovalPrompt } from './PlanApprovalPrompt'
import { RealtimeStartingSurface } from './RealtimeStartingSurface'

interface CodexRealtimeTranscriptProps {
  projectPath: string
  sessionId: string
  scrollViewportRef: React.RefObject<HTMLDivElement | null>
  liquidGlass: boolean
  threadMessages: readonly ChatMessage[]
  sessionStatus: AgentStatus
  needsDecision: boolean
}

/** Render voice transcript and delegated Codex work through the ordinary turn UI. */
function TranscriptMessage({
  message,
  sessionStatus,
  isLastAssistant = false,
  hideCopyActions = false,
  collapseEntireCodexTurn = false,
}: {
  message: ChatMessage
  sessionStatus: AgentStatus
  isLastAssistant?: boolean
  hideCopyActions?: boolean
  collapseEntireCodexTurn?: boolean
}) {
  return (
    <div data-message-id={message.id} className="chat-message-wrapper">
      {/* Voice transcript stays read-only; delegated Codex messages keep their normal
          compact process disclosure and actions. */}
      <ChatMessageView
        message={message}
        sessionStatus={sessionStatus}
        isLastAssistant={isLastAssistant}
        hideCopyActions={hideCopyActions}
        collapseEntireCodexTurn={collapseEntireCodexTurn}
      />
    </div>
  )
}

export function CodexRealtimeTranscript({
  projectPath,
  sessionId,
  scrollViewportRef,
  liquidGlass,
  threadMessages,
  sessionStatus,
  needsDecision,
}: CodexRealtimeTranscriptProps) {
  const { t } = useTranslation()
  const realtime = useCodexRealtimeViewStore(
    (state) => state.sessions[sessionId] ?? EMPTY_CODEX_REALTIME_SESSION_VIEW,
  )
  useEffect(() => {
    void hydrateCodexRealtimeTimeline(projectPath, sessionId)
  }, [projectPath, sessionId])

  const transcript = useMemo(() => selectRealtimeTranscript(realtime), [realtime])
  const turns = useMemo(() => buildRealtimeConversationTurns(transcript), [transcript])
  // Realtime splits one spoken reply across several items; a turn's whole assistant run
  // becomes a single markdown block.
  const spoken = useMemo(() => new Map(turns.map((turn) => [turn.id, {
    user: turn.user ? realtimeSegmentsToMessage([turn.user]) : null,
    assistant: turn.assistant.length > 0 ? realtimeSegmentsToMessage(turn.assistant) : null,
  }])), [turns])
  const activities = useMemo(() => mapRealtimeTurnActivities({
    turns,
    messages: threadMessages,
    sessionStatus,
    needsDecision,
  }), [needsDecision, sessionStatus, threadMessages, turns])
  const layout = useMemo(
    () => buildRealtimeTranscriptLayout(turns, activities),
    [activities, turns],
  )
  const lastAssistantMessageId = findLastAssistantMessageId(threadMessages)
  const loading = realtime.loadStatus === 'idle' || realtime.loadStatus === 'loading'
  const live = realtime.realtimeSessionId !== null || realtime.starting
  const emptyKey = live
    ? 'chat.realtimeVoice.waiting'
    : realtime.loadStatus === 'error'
      ? 'chat.realtimeVoice.timelineLoadFailed'
      : loading
        ? 'common.loading'
        : 'chat.realtimeVoice.emptyTimeline'
  // Vertical centring needs a parent with a definite height, which a ScrollArea's
  // auto-sized content column is not. With nothing to scroll there is nothing to
  // give up by replacing it outright.
  if (turns.length === 0 && realtime.starting) {
    return (
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <RealtimeStartingSurface />
      </div>
    )
  }
  return (
    <div className="relative min-w-0 flex-1 overflow-hidden">
      <ScrollArea key={sessionId} className="chat-scroll-area h-full min-w-0" viewportRef={scrollViewportRef}>
        <SelectionContextMenuZone className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-1 p-3 @lg:gap-1.5 @lg:p-3.5 @2xl:gap-1.5 @2xl:p-4">
          {layout.map((row) => {
            if (row.kind === 'activity') {
              const activity = activities.get(row.turnId)
              const activityMessages = activity
                ? threadMessages.filter((message) => activity.messageIds.includes(message.id))
                : []
              return (
                <Fragment key={`activity-${row.turnId}`}>
                  {activityMessages.map((message) => (
                    <TranscriptMessage
                      key={message.id}
                      message={message}
                      sessionStatus={sessionStatus}
                      isLastAssistant={message.id === lastAssistantMessageId}
                      collapseEntireCodexTurn
                    />
                  ))}
                  {activity?.status === 'needs-decision' && <PlanApprovalPrompt />}
                </Fragment>
              )
            }
            const { user, assistant } = spoken.get(row.turnId) ?? { user: null, assistant: null }
            return (
              <Fragment key={`voice-${row.turnId}`}>
                {user && (
                  <TranscriptMessage
                    message={user}
                    sessionStatus={sessionStatus}
                    hideCopyActions
                  />
                )}
                {assistant && (
                  <TranscriptMessage
                    message={assistant}
                    sessionStatus={sessionStatus}
                    hideCopyActions
                  />
                )}
              </Fragment>
            )
          })}

          {turns.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">{t(emptyKey)}</p>
          )}
        </SelectionContextMenuZone>
      </ScrollArea>
      {!liquidGlass && <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-linear-to-t from-card to-transparent" />}
    </div>
  )
}
