import { useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback, lazy, Suspense, memo } from 'react'
import { useChatStore, useActiveSession, useIsRemoteLocked, useSessionScope } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useShallow } from 'zustand/react/shallow'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { useTranslation } from 'react-i18next'
import { ArrowDown, GitFork, PenLine, Play, ShipWheel, Smartphone, Trash2 } from 'lucide-react'
import {
  catalogIdForSessionProvider,
  isCatalogHarnessDisabled,
} from '@/lib/harness-visibility'
import { resolveSessionIcon, resolveSessionIconFromBrandKey } from '@/components/harness/resolve-session-icon'
import { resolveProvider } from '@/stores/chat-store/helpers/provider-routing'
import { AnimatePresence, motion } from 'motion/react'
import { ChatInput } from './ChatInput'
import { ChatStatusBar } from './ChatStatusBar'
import { ChatMessage, CompactingIndicator, CompactIndicator, CompactErrorIndicator, ApiRetryIndicator, parseCompactMarker, parseTurnMetaMarker, isRedundantTurnSummaryMarker, TurnMetaIndicator, RecappingIndicator } from './ChatMessage'
import {
  groupConsecutiveTaskNotifications,
  TaskNotificationGroup,
  TaskNotificationRow,
} from './TaskNotificationRow'
import { ModelFallbackRow } from './ModelFallbackRow'
import { selectClaudeModels } from '@/stores/chat-store/selectors'
import { ChatSuggestions } from './ChatSuggestions'
import { SideChatEmptyState } from './SideChatEmptyState'
import { DraftSessionSurface } from './DraftSessionSurface'
import { PermissionPrompt } from './PermissionPrompt'
import { AskUserQuestionPrompt } from './AskUserQuestionPrompt'
import { CursorApiKeyDialog } from './CursorApiKeyDialog'
import { TodoPopup } from './TodoPopup'
import { PlanApprovalPrompt } from './PlanApprovalPrompt'
import { PlanFullscreenContext } from './codex-item-renderer'
import { CodexPlanFullscreenView } from './CodexPlanFullscreenView'
import { ForkNavigationContext, type ForkViewState } from './fork-navigation-context'
import { ForkedThreadView } from './ForkedThreadView'
import { SubagentNavigationContext, type SubagentViewState } from './subagent-navigation-context'
import { SubagentFullView } from './SubagentFullView'
const WorkflowFullView = lazy(() => import('./WorkflowFullView').then((m) => ({ default: m.WorkflowFullView })))
import { WorkflowNavigationContext, type WorkflowViewState } from './workflow-navigation-context'
import { SelectionContextMenuZone } from './SelectionContextMenu'
import { ChatScrollIndicator } from './ChatScrollIndicator'
import { CodexRealtimeTranscript } from './CodexRealtimeTranscript'
import { extractTurnOutline } from './turn-outline'
import { ChatRootContext } from './is-focus-in-chat'
import type { CodexPlanApprovalState } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { hydrateCodexRealtimeTimeline, useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'

interface ChatContentProps {
  scrollViewportRef: React.RefObject<HTMLDivElement | null>
  showScrollButton?: boolean
  scrollToBottom?: () => void
  stopAutoScroll?: () => void
  foreground?: boolean
}

const INITIAL_RENDER_COUNT = 12
const LOAD_MORE_COUNT = 4

// Preserve the old responsive visual scale through native layout tokens. A
// zoomed or transformed transcript can force Chromium to repaint a giant layer.
const CHAT_SCALABLE_REM_TOKENS = {
  '--spacing': 0.25,
  '--text-2xs': 0.625,
  '--text-xs': 0.75,
  '--text-sm': 0.875,
  '--text-base': 1,
  '--container-3xl': 48,
} as const

function createChatDensityStyle(scale: number): React.CSSProperties {
  return Object.fromEntries(
    Object.entries(CHAT_SCALABLE_REM_TOKENS).map(([token, rem]) => [
      token,
      `${Math.round(rem * scale * 100000) / 100000}rem`,
    ]),
  ) as React.CSSProperties
}

/**
 * Composer stack — owns NO messages subscription. Stream ticks that only update
 * transcript text should not re-render TipTap / status chrome.
 */
const ChatComposerShell = memo(function ChatComposerShell() {
  const { t } = useTranslation()
  const worktreeRemoved = useActiveSession((s) => s._worktreeRemoved)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const acpAgentId = useActiveSession((s) => s.acpAgentId)
  const disconnectRemoteSessionAction = useChatStore((s) => s.disconnectRemoteSession)
  const isRemoteLocked = useIsRemoteLocked()
  const harnessCatalog = useAppStore((s) => s.harnessCatalog)
  const openHarnessSettings = useAppStore((s) => s.openHarnessSettings)

  const provider = resolveProvider({ sessionProvider, preferredProvider })
  const catalogId = catalogIdForSessionProvider(provider, acpAgentId)
  const harnessDisabled = catalogId != null && isCatalogHarnessDisabled(harnessCatalog, catalogId)
  const harnessLabel = catalogId
    ? t(`settings.harnesses.ids.${catalogId}` as 'settings.harnesses.ids.claude', {
        defaultValue: catalogId,
      })
    : ''
  const HarnessIcon =
    (catalogId ? resolveSessionIconFromBrandKey(catalogId) : null)
    ?? resolveSessionIcon(provider, acpAgentId)

  if (worktreeRemoved) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-4 py-3 text-sm text-muted-foreground">
        <GitFork className="size-3.5 shrink-0" />
        <span>Worktree has been removed.</span>
        <span>This session is now <em>READ ONLY</em>.</span>
      </div>
    )
  }
  // Disabled harness keeps its binary on disk (re-enable is instant) but must
  // not accept new turns — same composer withdrawal as worktree-removed. Main
  // process also refuses to resolve a disabled runtime, so mobile/automation
  // cannot bypass this banner.
  if (harnessDisabled && catalogId) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-4 py-3 text-sm text-muted-foreground">
        {HarnessIcon ? (
          <span className="inline-flex shrink-0">
            <HarnessIcon status="default" size={18} renderLevel="compact" />
          </span>
        ) : null}
        <span>
          <span className="font-medium text-foreground">{harnessLabel}</span>
          {' '}is disabled.
        </span>
        <span>This session is now <em>READ ONLY</em>.</span>
        <button
          type="button"
          onClick={() => openHarnessSettings(catalogId)}
          className="text-foreground underline underline-offset-2 hover:opacity-80"
        >
          Re-enable {harnessLabel}
        </button>
      </div>
    )
  }
  if (isRemoteLocked) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-4 py-3 text-sm text-muted-foreground">
        <Smartphone className="size-3.5 shrink-0" />
        <span>Remote session active — observation mode.</span>
        <button
          onClick={disconnectRemoteSessionAction}
          className="text-foreground underline underline-offset-2 hover:opacity-80"
        >
          Disconnect
        </button>
      </div>
    )
  }
  return (
    <>
      <PermissionPrompt />
      <AskUserQuestionPrompt />
      <CursorApiKeyDialog />
      <TodoPopup />
      <ChatInput />
      <ChatStatusBar />
    </>
  )
})

interface ChatTranscriptProps {
  scrollViewportRef: React.RefObject<HTMLDivElement | null>
  showScrollButton?: boolean
  scrollToBottom?: () => void
  stopAutoScroll?: () => void
  liquidGlass: boolean
}

/**
 * Transcript list — sole owner of the messages subscription for the chat pane.
 */
function ChatTranscript({
  scrollViewportRef,
  showScrollButton = false,
  scrollToBottom,
  stopAutoScroll,
  liquidGlass,
}: ChatTranscriptProps) {
  const scope = useSessionScope()
  const { t } = useTranslation()
  const activeProject = useChatStore((s) => s.activeProject)
  // Model ids arrive raw on the wire; display names live in the harness catalogs.
  const claudeModels = useChatStore(selectClaudeModels)
  const {
    messages, isCompacting, isRecapping, compactError, apiRetry,
    displayedSessionId, historyHydrated,
    sessionStatus, lastAssistantMessageId, queuedMessages, awaitingAssistantReply, acpModels,
    sessionProvider, preferredProvider,
    draftId, sideChatParentId, providerSessionId,
  } = useActiveSession(useShallow((s) => ({
    messages: s.messages,
    isCompacting: s.isCompacting,
    isRecapping: s.isRecapping,
    compactError: s.compactError,
    apiRetry: s.apiRetry,
    displayedSessionId: scope?.sessionId ?? s._activeSessionId,
    historyHydrated: s._historyHydrated,
    sessionStatus: s.status,
    lastAssistantMessageId: s.lastAssistantMessageId,
    queuedMessages: s.queuedMessages,
    awaitingAssistantReply: s.awaitingAssistantReply,
    acpModels: s.acpModels,
    draftId: s.draftId,
    sideChatParentId: s._sideChatParentId ?? null,
    providerSessionId: s._providerSessionId,
    sessionProvider: s.sessionProvider,
    preferredProvider: s.preferredProvider,
  })))

  const { editQueuedMessage, deleteQueuedMessage, steerQueuedMessage, startQueuedMessages, dismissCompactError } = useChatStore(useShallow((s) => ({
    editQueuedMessage: s.editQueuedMessage,
    deleteQueuedMessage: s.deleteQueuedMessage,
    steerQueuedMessage: s.steerQueuedMessage,
    startQueuedMessages: s.startQueuedMessages,
    dismissCompactError: s.dismissCompactError,
  })))
  const hasRealtimeTimeline = useCodexRealtimeViewStore(
    (state) => displayedSessionId ? state.sessions[displayedSessionId]?.hasTimeline ?? false : false,
  )
  const realtimeTimelineLoadStatus = useCodexRealtimeViewStore(
    (state) => displayedSessionId ? state.sessions[displayedSessionId]?.loadStatus ?? 'idle' : 'idle',
  )
  const queueTarget = scope ?? undefined
  const queueProvider = resolveProvider({ sessionProvider, preferredProvider })
  const awaitingRealtimeTimeline = queueProvider === 'codex'
    && !!providerSessionId
    && (realtimeTimelineLoadStatus === 'idle' || realtimeTimelineLoadStatus === 'loading')
  const isLocalQueue = !parseRemoteProjectKey(scope?.projectPath ?? activeProject ?? '')
  const canSteerQueue = isLocalQueue
    && HARNESS_CAPABILITIES[queueProvider].supportsQueuedSteer
    && sessionStatus === 'streaming'
  const isLocalCodexQueue = isLocalQueue && queueProvider === 'codex'
  const canStartCodexQueue = isLocalCodexQueue && sessionStatus !== 'streaming'

  const prevScrollHeightRef = useRef(0)
  const [expandLevel, setExpandLevel] = useState(0)
  const messagesLen = messages.length
  const messagesTailId = messages[messagesLen - 1]?.id
  const compactIndices = useMemo(
    () => messages.flatMap((msg, i) => (parseCompactMarker(msg) ? [i] : [])),
    // messages identity churns on every streaming delta; compact markers only change
    // when messages are added/removed, captured by length + tail id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messagesLen, messagesTailId]
  )
  const visibleStart =
    compactIndices.length > 0 && expandLevel < compactIndices.length
      ? compactIndices[compactIndices.length - 1 - expandLevel]
      : 0
  const visibleMessages = visibleStart > 0 ? messages.slice(visibleStart) : messages

  const [renderCount, setRenderCount] = useState(INITIAL_RENDER_COUNT)
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setRenderCount(INITIAL_RENDER_COUNT) }, [displayedSessionId])
  const hasMore = renderCount < visibleMessages.length
  const renderedMessages = hasMore ? visibleMessages.slice(-renderCount) : visibleMessages
  // A fallback id can name a model from either catalog: model_fallback is emitted
  // by the Claude SDK and by the ACP backends.
  const modelCatalog = useMemo(() => [...claudeModels, ...acpModels], [claudeModels, acpModels])
  const renderEntries = groupConsecutiveTaskNotifications(renderedMessages)

  useEffect(() => {
    const sentinel = sentinelRef.current
    const viewport = scrollViewportRef.current
    if (!sentinel || !viewport || !hasMore) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRenderCount((c) => Math.min(c + LOAD_MORE_COUNT, visibleMessages.length))
        }
      },
      { root: viewport, rootMargin: '800px 0px 0px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, visibleMessages.length, scrollViewportRef])

  // Memory: when user returns to bottom after scroll-up load-more, shrink the
  // reverse window so off-screen history unmounts (not full virtualization).
  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    let raf = 0
    const onScroll = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (sessionStatus === 'streaming') return
        const nearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 96
        if (!nearBottom) return
        setRenderCount((c) => (c > INITIAL_RENDER_COUNT ? INITIAL_RENDER_COUNT : c))
      })
    }
    viewport.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      viewport.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [scrollViewportRef, sessionStatus, displayedSessionId])

  const outline = useMemo(
    () => extractTurnOutline(visibleMessages),
    // Recompute only when the visible set changes (add/remove/compact expand) or the turn
    // finishes — not on every streaming text delta (visibleMessages identity churns each delta).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleMessages.length, messagesTailId, sessionStatus]
  )
  const hasCompact = compactIndices.length > 0
  const recentTurnCount = useMemo(() => {
    if (!hasCompact) return outline.length
    const lastCompactIdx = compactIndices[compactIndices.length - 1]
    return outline.filter((e) => e.index >= lastCompactIdx - visibleStart).length
  }, [hasCompact, outline, compactIndices, visibleStart])
  const compactSplit = Math.max(0, outline.length - recentTurnCount)
  const compactExpanded = expandLevel >= compactIndices.length
  const toggleCompact = useCallback(() => {
    prevScrollHeightRef.current = scrollViewportRef.current?.scrollHeight ?? 0
    setExpandLevel((lvl) => (lvl >= compactIndices.length ? 0 : compactIndices.length))
  }, [compactIndices.length, scrollViewportRef])
  const [jumpNonce, setJumpNonce] = useState(0)
  const pendingScrollIdRef = useRef<string | null>(null)
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const compactIndicesRef = useRef(compactIndices)
  compactIndicesRef.current = compactIndices
  const jumpToMessage = useCallback((id: string) => {
    const msgs = messagesRef.current
    const targetIdx = msgs.findIndex((m) => m.id === id)
    if (targetIdx < 0) return
    stopAutoScroll?.()
    const needed = compactIndicesRef.current.filter((ci) => ci > targetIdx).length
    setExpandLevel((prev) => Math.max(prev, needed))
    setRenderCount((prev) => Math.max(prev, msgs.length - targetIdx + LOAD_MORE_COUNT))
    pendingScrollIdRef.current = id
    setJumpNonce((n) => n + 1)
  }, [stopAutoScroll])

  useEffect(() => {
    const id = pendingScrollIdRef.current
    if (!id) return
    const viewport = scrollViewportRef.current
    if (!viewport) return
    const raf = requestAnimationFrame(() => {
      const el = viewport.querySelector(`[data-message-id="${CSS.escape(id)}"]`)
      if (!el) return
      pendingScrollIdRef.current = null
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => cancelAnimationFrame(raf)
  }, [jumpNonce, scrollViewportRef])

  useLayoutEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport || prevScrollHeightRef.current === 0) return
    const delta = viewport.scrollHeight - prevScrollHeightRef.current
    viewport.scrollTop += delta
    prevScrollHeightRef.current = 0
  }, [expandLevel, scrollViewportRef])

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden">
      {messages.length === 0 && historyHydrated && sessionStatus !== 'streaming' && sessionStatus !== 'background' && !awaitingAssistantReply ? (
        sideChatParentId
          // A side chat is empty on purpose and must never reach ChatSuggestions:
          // picking a harness there switches the project's active session, which
          // would yank the parent chat out from under the panel.
          ? <SideChatEmptyState />
          : awaitingRealtimeTimeline
            ? <p className="py-16 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
            : draftId || (queueProvider === 'codex' && hasRealtimeTimeline)
                ? <DraftSessionSurface />
                : <ChatSuggestions />
      ) : (
        <ScrollArea key={displayedSessionId ?? 'default'} className="chat-scroll-area h-full min-w-0" viewportRef={scrollViewportRef}>
          <SelectionContextMenuZone className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-1 p-3 @lg:gap-1.5 @lg:p-3.5 @2xl:gap-1.5 @2xl:p-4">
            {hasMore && <div ref={sentinelRef} className="h-px" style={{ overflowAnchor: 'none' }} />}
            {renderEntries.map((entry) => {
              if (entry.type === 'task-notification-group') {
                const first = entry.items[0]
                return (
                  <div key={first.id} data-message-id={first.id} className="chat-message-wrapper">
                    {entry.items.length === 1 ? (
                      <TaskNotificationRow meta={first.meta} />
                    ) : (
                      <TaskNotificationGroup items={entry.items} />
                    )}
                  </div>
                )
              }
              const msg = entry.message
              const fallbackMeta = msg.metadata?.modelFallback
              if (fallbackMeta) {
                return (
                  <div key={msg.id} data-message-id={msg.id} className="chat-message-wrapper">
                    <ModelFallbackRow meta={fallbackMeta} models={modelCatalog} />
                  </div>
                )
              }
              const compactInfo = parseCompactMarker(msg)
              if (compactInfo) {
                const origIdx = messages.indexOf(msg)
                const rank = compactIndices.length - 1 - compactIndices.indexOf(origIdx)
                const isExpanded = rank < expandLevel
                return (
                  <CompactIndicator
                    key={msg.id}
                    trigger={compactInfo.trigger}
                    preTokens={compactInfo.preTokens}
                    postTokens={compactInfo.postTokens}
                    durationMs={compactInfo.durationMs}
                    expanded={isExpanded}
                    onToggle={() => {
                      prevScrollHeightRef.current = scrollViewportRef.current?.scrollHeight ?? 0
                      setExpandLevel(isExpanded ? rank : rank + 1)
                    }}
                  />
                )
              }
              const turnMeta = parseTurnMetaMarker(msg)
              if (turnMeta) {
                // Metadata path already shows this summary above the footer.
                if (isRedundantTurnSummaryMarker(turnMeta, messages)) return null
                return (
                  <div key={msg.id} data-message-id={msg.id} className="chat-message-wrapper">
                    <TurnMetaIndicator meta={turnMeta} />
                  </div>
                )
              }
              return (
                <div key={msg.id} data-message-id={msg.id} className="chat-message-wrapper">
                  <ChatMessage message={msg} sessionStatus={sessionStatus} isLastAssistant={msg.id === lastAssistantMessageId} />
                </div>
              )
            })}
            {queuedMessages.map((msg, index) => (
              <div key={msg.id} className="group/queued chat-message-wrapper opacity-50">
                <ChatMessage message={msg} sessionStatus={sessionStatus} isLastAssistant={false} hideUserActions />
                <div className="flex justify-end pr-1">
                  <div className="-mt-0.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/queued:opacity-100">
                    {index === 0 && canStartCodexQueue && (
                      <IconButton size="xs" variant="nested" tooltip={t('chat.queuedActions.start')} onClick={() => void startQueuedMessages(queueTarget)}>
                        <Play className="size-3" />
                      </IconButton>
                    )}
                    {canSteerQueue && (
                      <IconButton size="xs" variant="nested" tooltip={t('chat.queuedActions.steer')} onClick={() => void steerQueuedMessage(msg.id, queueTarget)}>
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
            {isCompacting && <CompactingIndicator />}
            {!isCompacting && compactError && <CompactErrorIndicator error={compactError} onDismiss={dismissCompactError} />}
            {isRecapping && <RecappingIndicator />}
            {apiRetry && <ApiRetryIndicator info={apiRetry} />}
          </SelectionContextMenuZone>
        </ScrollArea>
      )}
      {messages.length > 0 && (
        <ChatScrollIndicator entries={outline} hasCompact={hasCompact} compactExpanded={compactExpanded} compactSplit={compactSplit} viewportRef={scrollViewportRef} onJump={jumpToMessage} onToggleCompact={toggleCompact} />
      )}
      {!liquidGlass && <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-linear-to-t from-card to-transparent" />}
      <AnimatePresence>
        {showScrollButton && scrollToBottom && messages.length > 0 && (
          <motion.button
            onClick={scrollToBottom}
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
  )
}

export function ChatContent({ scrollViewportRef, showScrollButton = false, scrollToBottom, stopAutoScroll, foreground = true }: ChatContentProps) {
  const scope = useSessionScope()
  const activeProject = useChatStore((s) => s.activeProject)
  const { pendingPlanApproval, displayedSessionId, providerSessionId, sessionProvider, preferredProvider, messagesLength } = useActiveSession(useShallow((s) => ({
    pendingPlanApproval: s.pendingPlanApproval,
    displayedSessionId: scope?.sessionId ?? s._activeSessionId,
    providerSessionId: s._providerSessionId,
    sessionProvider: s.sessionProvider,
    preferredProvider: s.preferredProvider,
    messagesLength: s.messages.length,
  })))
  const conversationView = useCodexRealtimeViewStore(
    (state) => displayedSessionId ? state.sessions[displayedSessionId]?.view ?? 'thread' : 'thread',
  )
  const realtimeThreadMessagesLength = useCodexRealtimeViewStore(
    (state) => displayedSessionId ? state.sessions[displayedSessionId]?.threadMessages.length ?? 0 : 0,
  )
  const projectPath = scope?.projectPath ?? activeProject
  const isCodexSession = resolveProvider({ sessionProvider, preferredProvider }) === 'codex'
  useEffect(() => {
    if (
      !displayedSessionId
      || !projectPath
      || !isCodexSession
      || !providerSessionId
      || messagesLength > 0
    ) return
    void hydrateCodexRealtimeTimeline(projectPath, displayedSessionId)
  }, [displayedSessionId, isCodexSession, messagesLength, projectPath, providerSessionId])
  const showRealtime = Boolean(
    displayedSessionId
    && projectPath
    && isCodexSession
    && conversationView === 'realtime',
  )
  const showRealtimeThread = Boolean(
    displayedSessionId
    && projectPath
    && isCodexSession
    && conversationView === 'thread'
    && messagesLength === 0
    && realtimeThreadMessagesLength > 0,
  )

  // ChatContent is the single render root for a visible session — mounted once per
  // single-mode pane, per mosaic tile, and per mini window. Reporting foreground here
  // (rather than in mosaic/mini-window-specific code) covers all three for free.
  useEffect(() => {
    if (!displayedSessionId || !foreground) return
    void window.agent.setSessionForeground(displayedSessionId, true)
    return () => {
      void window.agent.setSessionForeground(displayedSessionId, false)
    }
  }, [displayedSessionId, foreground])

  const liquidGlass = useAppStore((s) => s.liquidGlass)
  const [fullscreenPlan, setFullscreenPlan] = useState<{
    text: string
    onApprovePlan?: () => void
    onRejectPlan?: (feedback?: string) => void
    planApproval?: CodexPlanApprovalState
  } | null>(null)
  const planFullscreenCtx = useMemo(() => ({
    open: (
      text: string,
      actions?: { onApprove?: () => void; onReject?: (feedback?: string) => void; planApproval?: CodexPlanApprovalState },
    ) => setFullscreenPlan({
      text,
      onApprovePlan: actions?.onApprove,
      onRejectPlan: actions?.onReject,
      planApproval: actions?.planApproval,
    }),
  }), [])

  const containerRef = useRef<HTMLDivElement>(null)
  const computeAutoScale = useCallback((w: number) => w >= 672 ? 1.15 : w >= 512 ? 1.1 : 1, [])
  const [autoScale, setAutoScale] = useState(1)
  const [manualScaleOffset, setManualScaleOffset] = useState(0)
  const uiScale = autoScale + manualScaleOffset
  const densityStyle = useMemo(() => createChatDensityStyle(uiScale), [uiScale])
  useLayoutEffect(() => {
    const parent = containerRef.current?.parentElement
    if (!parent) return
    setAutoScale(computeAutoScale(parent.getBoundingClientRect().width))
    let rafId = 0
    const observer = new ResizeObserver((entries) => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const next = computeAutoScale(entries[0]?.contentRect.width ?? 0)
        setAutoScale((prev) => prev === next ? prev : next)
      })
    })
    observer.observe(parent)
    return () => { cancelAnimationFrame(rafId); observer.disconnect() }
  }, [computeAutoScale])

  useEffect(() => {
    return window.app.onContentZoom((action) => {
      if (!containerRef.current?.matches(':hover')) return
      if (action === 'reset') setManualScaleOffset(0)
      else if (action === 'in') setManualScaleOffset((v) => Math.min(v + 0.05, 0.5))
      else setManualScaleOffset((v) => Math.max(v - 0.05, -0.5))
    })
  }, [])

  const [fork, setFork] = useState<ForkViewState | null>(null)
  const forkNav = useMemo(() => ({
    current: fork,
    open: (state: ForkViewState) => setFork(state),
    close: () => setFork(null),
  }), [fork])

  const [subagentView, setSubagentView] = useState<SubagentViewState | null>(null)
  const subagentNav = useMemo(() => ({
    current: subagentView,
    open: (state: SubagentViewState) => setSubagentView(state),
    close: () => setSubagentView(null),
  }), [subagentView])

  const [workflowView, setWorkflowView] = useState<WorkflowViewState | null>(null)
  const workflowNav = useMemo(() => ({
    current: workflowView,
    open: (state: WorkflowViewState) => setWorkflowView(state),
    close: () => setWorkflowView(null),
  }), [workflowView])

  // Full-screen overlays are local UI state; ChatContent stays mounted across
  // session switches. Adjust during render (React "store info from previous
  // renders" pattern) so the old overlay never paints over the new session.
  const [overlaySessionId, setOverlaySessionId] = useState(displayedSessionId)
  if (displayedSessionId !== overlaySessionId) {
    setOverlaySessionId(displayedSessionId)
    setWorkflowView(null)
    setSubagentView(null)
    setFork(null)
    setFullscreenPlan(null)
  }

  return (
    <WorkflowNavigationContext.Provider value={workflowNav}>
    <SubagentNavigationContext.Provider value={subagentNav}>
    <ForkNavigationContext.Provider value={forkNav}>
    <PlanFullscreenContext.Provider value={planFullscreenCtx}>
    <div
      ref={containerRef}
      data-chat-root=""
      className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col"
      style={densityStyle}
    >
      <ChatRootContext.Provider value={containerRef}>
      {workflowView ? (
        <Suspense fallback={null}>
          <WorkflowFullView view={workflowView} />
        </Suspense>
      ) : subagentView ? (
        <SubagentFullView view={subagentView} />
      ) : fork ? (
        <ForkedThreadView fork={fork} />
      ) : fullscreenPlan ? (
        <CodexPlanFullscreenView
          text={fullscreenPlan.text}
          onApprovePlan={fullscreenPlan.onApprovePlan}
          onRejectPlan={fullscreenPlan.onRejectPlan}
          planApproval={fullscreenPlan.planApproval}
          onClose={(reason) => {
            setFullscreenPlan(null)
            if (reason === 'reject') {
              requestAnimationFrame(() => scrollToBottom?.())
            }
          }}
        />
      ) : pendingPlanApproval ? (
        <PlanApprovalPrompt />
      ) : (
        <>
          {/* The fade belongs to arriving at a different session. Both transcripts are
              views of the SAME session, so keying the fade here — rather than on each
              of them — keeps starting a call from replaying it as a blank flash. */}
          <div
            key={displayedSessionId ?? 'default'}
            data-transcript-frame=""
            className="flex min-h-0 min-w-0 flex-1 flex-col animate-[fade-in_150ms_ease-out]"
          >
            {(showRealtime || showRealtimeThread) && displayedSessionId && projectPath ? (
              <CodexRealtimeTranscript
                projectPath={projectPath}
                sessionId={displayedSessionId}
                scrollViewportRef={scrollViewportRef}
                liquidGlass={liquidGlass}
                view={showRealtime ? 'realtime' : 'thread'}
              />
            ) : (
              <ChatTranscript
                scrollViewportRef={scrollViewportRef}
                showScrollButton={showScrollButton}
                scrollToBottom={scrollToBottom}
                stopAutoScroll={stopAutoScroll}
                liquidGlass={liquidGlass}
              />
            )}
          </div>
          <div className="mx-auto w-full min-w-0 max-w-3xl">
            <ChatComposerShell />
          </div>
        </>
      )}
      </ChatRootContext.Provider>
    </div>
    </PlanFullscreenContext.Provider>
    </ForkNavigationContext.Provider>
    </SubagentNavigationContext.Provider>
    </WorkflowNavigationContext.Provider>
  )
}
