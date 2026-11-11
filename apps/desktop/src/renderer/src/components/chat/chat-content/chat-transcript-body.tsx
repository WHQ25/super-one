import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDown, ChevronsUp, PenLine, Play, ShipWheel, Trash2 } from 'lucide-react'
import type { ChatMessage as ChatMessageModel, ModelOption } from '@superone/shared/agent-types'
import type { TranscriptRow } from '@superone/shared/transcript-segments'
import { SystemNoticeRow } from '@superone/chat-view/presenters/SystemNoticeRow'
import { MessageDateSeparator } from '@superone/chat-view/presenters/MessageTime'
import type { TurnOutlineEntry } from '@superone/shared/turn-outline'
import { TurnDetailStateProvider } from '../TurnDetailSection'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import type { ChatStore, PerSessionState, SessionWriteTarget } from '@/stores/chat-store/types'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import {
  ChatMessage,
  CompactingIndicator,
  CompactIndicator,
  CompactErrorIndicator,
  parseCompactMarker,
  parseTurnMetaMarker,
  isRedundantTurnSummaryMarker,
  TurnMetaIndicator,
  RecappingIndicator,
} from '../ChatMessage'
import { ModelFallbackRow } from '../ModelFallbackRow'
import { PluginNoticeRow } from '../PluginNotice'
import { ChatSuggestions } from '../ChatSuggestions'
import { SideChatEmptyState } from '../SideChatEmptyState'
import { SelectionContextMenuZone } from '../SelectionContextMenu'
import { ChatScrollIndicator } from '../ChatScrollIndicator'
import { VirtualTranscriptList, type VirtualTranscriptHandle } from '../VirtualTranscriptList'
import { RemoteTranscriptChrome, RemoteTranscriptEdges } from '../RemoteTranscriptChrome'
import { SessionProviderState } from '../SessionProviderState'

export function useTranscriptJump({
  displayedSessionId,
  displayMessages,
  pendingJump,
  stopAutoScroll,
}: {
  displayedSessionId: string | null | undefined
  displayMessages: readonly ChatMessageModel[]
  pendingJump: { view: string; turnId?: string; messageId?: string } | null | undefined
  stopAutoScroll?: () => void
}) {
  const transcriptRef = useRef<VirtualTranscriptHandle>(null)
  const messageTop = useCallback((id: string) => transcriptRef.current?.topOf(id) ?? null, [])
  const [jumpNonce, setJumpNonce] = useState(0)
  const pendingScrollIdRef = useRef<string | null>(null)
  const jumpToMessage = useCallback(
    (id: string) => {
      stopAutoScroll?.()
      pendingScrollIdRef.current = id
      setJumpNonce((n) => n + 1)
    },
    [stopAutoScroll],
  )

  const clearJump = useCodexRealtimeViewStore((state) => state.clearJump)
  useEffect(() => {
    if (!pendingJump || pendingJump.view !== 'thread' || !displayedSessionId) return
    const { turnId, messageId } = pendingJump
    const target =
      displayMessages.find(
        (message) =>
          turnId !== undefined
          && (message.metadata?.codexTimeline?.turnId ?? message.metadata?.codex?.turnId) === turnId,
      ) ?? displayMessages.find((message) => message.id === messageId)
    if (!target) return
    jumpToMessage(target.id)
    clearJump(displayedSessionId)
  }, [clearJump, displayMessages, displayedSessionId, jumpToMessage, pendingJump])

  useEffect(() => {
    const id = pendingScrollIdRef.current
    if (!id) return
    transcriptRef.current?.jumpTo(id)
    pendingScrollIdRef.current = null
  }, [jumpNonce])

  return { transcriptRef, messageTop, jumpToMessage }
}

export interface ChatTranscriptBodyProps {
  displayedSessionId: string | null | undefined
  scrollViewportRef: RefObject<HTMLDivElement | null>
  transcriptRef: RefObject<VirtualTranscriptHandle | null>
  showScrollButton: boolean
  scrollToBottom?: () => void
  liquidGlass: boolean
  displayMessages: readonly ChatMessageModel[]
  rows: TranscriptRow[]
  dateSeparatorAt: Map<string, number>
  modelCatalog: ModelOption[]
  outline: TurnOutlineEntry[]
  messageTop: (id: string) => number | null
  jumpToMessage: (id: string) => void
  historyHydrated: boolean
  hasRealtimeTimeline: boolean
  sessionStatus: PerSessionState['status']
  awaitingAssistantReply: boolean
  apiRetry: PerSessionState['apiRetry']
  sideChatParentId: string | null
  realtimeStarting: boolean
  awaitingRealtimeTimeline: boolean
  draftMode: boolean
  pendingMessageId?: string
  displayLastAssistantMessageId?: string | null
  retryTargetMessageId?: string
  onRetry: () => void
  queuedMessages: ChatMessageModel[]
  canStartCodexQueue: boolean
  canSteerQueueSoon: boolean
  canSteerQueue: boolean
  queueTarget: SessionWriteTarget | undefined
  startQueuedMessages: ChatStore['startQueuedMessages']
  steerQueuedMessage: ChatStore['steerQueuedMessage']
  editQueuedMessage: ChatStore['editQueuedMessage']
  deleteQueuedMessage: ChatStore['deleteQueuedMessage']
  isCompacting: boolean
  compactingStartedAt: number | null
  compactError: string | null
  dismissCompactError: () => void
  isRecapping: boolean
}

export function ChatTranscriptBody({
  displayedSessionId,
  scrollViewportRef,
  transcriptRef,
  showScrollButton,
  scrollToBottom,
  liquidGlass,
  displayMessages,
  rows,
  dateSeparatorAt,
  modelCatalog,
  outline,
  messageTop,
  jumpToMessage,
  historyHydrated,
  hasRealtimeTimeline,
  sessionStatus,
  awaitingAssistantReply,
  apiRetry,
  sideChatParentId,
  realtimeStarting,
  awaitingRealtimeTimeline,
  draftMode,
  pendingMessageId,
  displayLastAssistantMessageId,
  retryTargetMessageId,
  onRetry,
  queuedMessages,
  canStartCodexQueue,
  canSteerQueueSoon,
  canSteerQueue,
  queueTarget,
  startQueuedMessages,
  steerQueuedMessage,
  editQueuedMessage,
  deleteQueuedMessage,
  isCompacting,
  compactingStartedAt,
  compactError,
  dismissCompactError,
  isRecapping,
}: ChatTranscriptBodyProps) {
  const { t } = useTranslation()

  return (
    <TurnDetailStateProvider scope={displayedSessionId ?? 'default'}>
      <div className="chat-transcript-layout relative min-w-0 flex-1 overflow-hidden">
        {displayMessages.length === 0 && !historyHydrated && !hasRealtimeTimeline ? (
          <p className="py-16 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : displayMessages.length === 0 && historyHydrated && sessionStatus !== 'streaming' && sessionStatus !== 'background' && !awaitingAssistantReply && !apiRetry ? (
          sideChatParentId
            ? <SideChatEmptyState />
            : realtimeStarting
              ? <div data-testid="realtime-connecting-blank" className="flex-1" />
              : awaitingRealtimeTimeline
                ? <p className="py-16 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
                : <ChatSuggestions draft={draftMode} />
        ) : (
          <ScrollArea key={displayedSessionId ?? 'default'} className="chat-scroll-area h-full min-w-0" viewportRef={scrollViewportRef}>
            <RemoteTranscriptEdges>
              <SelectionContextMenuZone className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-1 p-3 @lg:gap-1.5 @lg:p-3.5 @2xl:gap-1.5 @2xl:p-4">
                <RemoteTranscriptChrome edge="top" />
                <VirtualTranscriptList
                  key={displayedSessionId ?? 'default'}
                  viewportRef={scrollViewportRef}
                  apiRef={transcriptRef}
                  items={rows.map((row) => {
                    const msg = row.message
                    if (msg.metadata?.systemNotice) {
                      return (
                        <div key={msg.id} data-message-id={row.id} className="chat-message-wrapper">
                          <SystemNoticeRow meta={msg.metadata.systemNotice} text={msg.content[0]?.type === 'text' ? msg.content[0].text : ''} />
                        </div>
                      )
                    }
                    const fallbackMeta = msg.metadata?.modelFallback
                    if (fallbackMeta) {
                      return (
                        <div key={msg.id} data-message-id={row.id} className="chat-message-wrapper">
                          <ModelFallbackRow meta={fallbackMeta} models={modelCatalog} />
                        </div>
                      )
                    }
                    const pluginNotice = msg.metadata?.pluginNotice
                    if (pluginNotice) {
                      const text = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
                      return (
                        <div key={msg.id} data-message-id={row.id} className="chat-message-wrapper">
                          <PluginNoticeRow meta={pluginNotice} text={text} />
                        </div>
                      )
                    }
                    const compactInfo = parseCompactMarker(msg)
                    if (compactInfo) {
                      return (
                        <div key={row.id} data-message-id={row.id}>
                          <CompactIndicator
                            trigger={compactInfo.trigger}
                            preTokens={compactInfo.preTokens}
                            postTokens={compactInfo.postTokens}
                            durationMs={compactInfo.durationMs}
                          />
                        </div>
                      )
                    }
                    const turnMeta = parseTurnMetaMarker(msg)
                    if (turnMeta) {
                      if (isRedundantTurnSummaryMarker(turnMeta, displayMessages)) return null
                      return (
                        <div key={msg.id} data-message-id={row.id} className="chat-message-wrapper">
                          <TurnMetaIndicator meta={turnMeta} />
                        </div>
                      )
                    }
                    const separatorAt = row.id === msg.id ? dateSeparatorAt.get(msg.id) : undefined
                    return (
                      <div key={msg.id} data-message-id={row.id} className="chat-message-wrapper">
                        {separatorAt !== undefined && <MessageDateSeparator at={separatorAt} />}
                        <ChatMessage
                          message={msg}
                          sessionStatus={sessionStatus}
                          isLastAssistant={row.final && (msg.id === pendingMessageId || msg.id === displayLastAssistantMessageId)}
                          pendingTurn={msg.id === pendingMessageId ? 'sending' : undefined}
                          apiRetry={row.final && row.source.id === retryTargetMessageId ? apiRetry : undefined}
                          onRetry={row.source.id === retryTargetMessageId ? onRetry : undefined}
                          showFooter={row.final}
                          sourceMessage={row.source}
                          followingMessage={row.following}
                          segmentId={row.id}
                          firstSlice={row.first}
                          anchors={row.anchors}
                        />
                      </div>
                    )
                  }).map((content, index) => ({
                    id: rows[index].id,
                    sourceId: rows[index].source.id,
                    anchors: rows[index].anchors,
                    content,
                  })).filter((item) => item.content !== null)}
                />
                <SessionProviderState />
                {queuedMessages.map((msg, index) => (
                  <div key={msg.id} className="group/queued chat-message-wrapper relative hover:z-30 focus-within:z-30">
                    <div className="opacity-50">
                      <ChatMessage message={msg} sessionStatus={sessionStatus} isLastAssistant={false} hideUserActions />
                    </div>
                    <div className="flex justify-end pr-1">
                      <div className="relative z-30 -mt-0.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/queued:opacity-50 group-focus-within/queued:opacity-50">
                        {index === 0 && canStartCodexQueue && (
                          <IconButton size="xs" variant="nested" tooltip={t('chat.queuedActions.start')} onClick={() => void startQueuedMessages(queueTarget)}>
                            <Play className="size-3" />
                          </IconButton>
                        )}
                        {canSteerQueueSoon && (
                          <IconButton size="xs" variant="nested" tooltip={t('chat.queuedActions.steerSoon')} onClick={() => void steerQueuedMessage(msg.id, queueTarget, 'next')}>
                            <ChevronsUp />
                          </IconButton>
                        )}
                        {canSteerQueue && (
                          <IconButton size="xs" variant="nested" tooltip={t('chat.queuedActions.steer')} onClick={() => void steerQueuedMessage(msg.id, queueTarget, 'now')}>
                            <ShipWheel />
                          </IconButton>
                        )}
                        <IconButton size="xs" variant="nested" tooltip={t('chat.queuedActions.edit')} onClick={() => editQueuedMessage(msg.id, queueTarget)}>
                          <PenLine className="size-3" />
                        </IconButton>
                        <IconButton size="xs" variant="nested" tooltip={t('chat.queuedActions.delete')} onClick={() => deleteQueuedMessage(msg.id, queueTarget)}>
                          <Trash2 className="size-3" />
                        </IconButton>
                      </div>
                    </div>
                  </div>
                ))}
                {isCompacting && <CompactingIndicator startedAt={compactingStartedAt} />}
                {!isCompacting && compactError && <CompactErrorIndicator error={compactError} onDismiss={dismissCompactError} />}
                {isRecapping && <RecappingIndicator />}
                <RemoteTranscriptChrome edge="bottom" />
              </SelectionContextMenuZone>
            </RemoteTranscriptEdges>
          </ScrollArea>
        )}
        {displayMessages.length > 0 && (
          <ChatScrollIndicator entries={outline} viewportRef={scrollViewportRef} getMessageTop={messageTop} onJump={jumpToMessage} />
        )}
        {!liquidGlass && <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-linear-to-t from-card to-transparent" />}
        <AnimatePresence>
          {showScrollButton && scrollToBottom && displayMessages.length > 0 && (
            <motion.button
              onClick={scrollToBottom}
              style={{ bottom: 'calc(var(--composer-overhang, 0px) + var(--spacing) * 3)' }}
              className="absolute bottom-3 left-1/2 z-10 flex size-7 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
            >
              <ArrowDown className="size-3.5" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </TurnDetailStateProvider>
  )
}
