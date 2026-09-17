import { Fragment, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import type { AgentStatus, ChatMessage } from '@superone/shared/agent-types'
import { suppressRealtimeStartupEcho } from '@superone/shared/realtime-transcript'
import {
  EMPTY_CODEX_REALTIME_SESSION_VIEW,
  restoreLocalCodexRealtimeTimeline,
  useCodexRealtimeViewStore,
} from '@/stores/codex-realtime-view'
import { realtimeSegmentsToMessage, selectRealtimeTranscript } from './codex-realtime-messages'
import { buildRealtimeConversationTurns } from './realtime-conversation-turns'
import { buildRealtimeTranscriptLayout, mapRealtimeTurnActivities } from './realtime-turn-activities'
import { SelectionContextMenuZone } from './SelectionContextMenu'
import { ChatMessage as ChatMessageView } from './ChatMessage'
import { RealtimeDelegationRow } from './RealtimeDelegationRow'

interface CodexRealtimeTranscriptProps {
  sessionId: string
  scrollViewportRef: React.RefObject<HTMLDivElement | null>
  liquidGlass: boolean
  /** The backing thread; only its delegated ranges surface here, as cards. */
  threadMessages: readonly ChatMessage[]
  sessionStatus: AgentStatus
  needsDecision: boolean
}

/** Spoken rows go through the ordinary bubble so voice reads like the rest of the app. */
function SpokenMessage({
  message,
  sessionStatus,
  voiceTurnId,
}: {
  message: ChatMessage
  sessionStatus: AgentStatus
  /** Set on a turn's first row; the anchor cross-view jumps scroll to. */
  voiceTurnId?: string
}) {
  return (
    <div data-message-id={message.id} data-voice-turn-id={voiceTurnId} className="chat-message-wrapper">
      <ChatMessageView message={message} sessionStatus={sessionStatus} isLastAssistant={false} hideCopyActions />
    </div>
  )
}

/**
 * The voice view: spoken turns in the order speech began, each followed by a status
 * line for the Codex work it delegated. Nothing from the backing thread renders
 * inline — typed turns, tool output and the delegation prompts all belong to the
 * thread view, and the status line is the way there.
 */
export function CodexRealtimeTranscript({
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
  const jumpTo = useCodexRealtimeViewStore((state) => state.jumpTo)
  const clearJump = useCodexRealtimeViewStore((state) => state.clearJump)
  // The provider reconcile is ChatContent's, gated on the thread id; this view only
  // makes sure the local snapshot is in even when mounted on its own.
  useEffect(() => {
    void restoreLocalCodexRealtimeTimeline(sessionId)
  }, [sessionId])

  const transcript = useMemo(
    () => suppressRealtimeStartupEcho(threadMessages, selectRealtimeTranscript(realtime)),
    [realtime, threadMessages],
  )
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
  const layout = useMemo(() => buildRealtimeTranscriptLayout(turns, activities), [activities, turns])

  // A jump from the thread view lands on the spoken turn whose delegation range
  // contains the Codex turn. Wait for the row to exist: the timeline may still be
  // hydrating when the view switches.
  const pendingJump = realtime.pendingJump
  useEffect(() => {
    if (!pendingJump || pendingJump.view !== 'realtime') return
    const { turnId, messageId } = pendingJump
    const voiceTurnId = [...activities.entries()].find(([, activity]) => (
      (turnId !== undefined && activity.turnIds.includes(turnId))
      || (messageId !== undefined && activity.messageIds.includes(messageId))
    ))?.[0]
    if (!voiceTurnId) return
    const viewport = scrollViewportRef.current
    const target = viewport?.querySelector(`[data-voice-turn-id="${CSS.escape(voiceTurnId)}"]`)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    clearJump(sessionId)
  }, [activities, clearJump, pendingJump, scrollViewportRef, sessionId])

  const loading = realtime.loadStatus === 'idle' || realtime.loadStatus === 'loading'
  // The composer's voice mark carries the connecting state; the transcript only
  // needs a line that does not promise speech before the channel is up.
  const emptyKey = realtime.starting
    ? 'chat.realtimeVoice.connecting'
    : realtime.realtimeSessionId !== null
      ? 'chat.realtimeVoice.waiting'
      : realtime.loadStatus === 'error'
        ? 'chat.realtimeVoice.timelineLoadFailed'
        : loading
          ? 'common.loading'
          : 'chat.realtimeVoice.emptyTimeline'
  return (
    <div className="relative min-w-0 flex-1 overflow-hidden">
      <ScrollArea key={sessionId} className="chat-scroll-area h-full min-w-0" viewportRef={scrollViewportRef}>
        <SelectionContextMenuZone className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-1 p-3 @lg:gap-1.5 @lg:p-3.5 @2xl:gap-1.5 @2xl:p-4">
          {layout.map((row) => {
            if (row.kind === 'activity') {
              const activity = activities.get(row.turnId)
              if (!activity) return null
              return (
                <div key={`activity-${row.turnId}`} className="my-0.5">
                  <RealtimeDelegationRow
                    activity={activity}
                    onOpen={() => jumpTo(sessionId, {
                      view: 'thread',
                      ...(activity.turnIds[0] !== undefined ? { turnId: activity.turnIds[0] } : {}),
                      ...(activity.messageIds[0] !== undefined ? { messageId: activity.messageIds[0] } : {}),
                    })}
                  />
                </div>
              )
            }
            const { user, assistant } = spoken.get(row.turnId) ?? { user: null, assistant: null }
            return (
              <Fragment key={`voice-${row.turnId}`}>
                {user && <SpokenMessage message={user} sessionStatus={sessionStatus} voiceTurnId={row.turnId} />}
                {assistant && (
                  <SpokenMessage
                    message={assistant}
                    sessionStatus={sessionStatus}
                    voiceTurnId={user ? undefined : row.turnId}
                  />
                )}
              </Fragment>
            )
          })}

          {layout.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">{t(emptyKey)}</p>
          )}
        </SelectionContextMenuZone>
      </ScrollArea>
      {!liquidGlass && <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-linear-to-t from-card to-transparent" />}
    </div>
  )
}
