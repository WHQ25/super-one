import { useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback, lazy, Suspense, memo } from 'react'
import { useChatStore, useActiveSession, useIsRemoteLocked, useSessionScope } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useShallow } from 'zustand/react/shallow'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { ArrowDown, GitFork, PenLine, Smartphone, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { ChatInput } from './ChatInput'
import { ChatStatusBar } from './ChatStatusBar'
import { ChatMessage, CompactingIndicator, CompactIndicator, CompactErrorIndicator, ApiRetryIndicator, ModelFallbackIndicator, parseCompactMarker, parseTurnMetaMarker, TurnMetaIndicator, RecappingIndicator } from './ChatMessage'
import { ChatSuggestions } from './ChatSuggestions'
import { PermissionPrompt } from './PermissionPrompt'
import { AskUserQuestionPrompt } from './AskUserQuestionPrompt'
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
import { extractTurnOutline } from './turn-outline'
import { ChatRootContext } from './is-focus-in-chat'
import type { CodexPlanApprovalState } from '@superone/shared/agent-types'

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
  const worktreeRemoved = useActiveSession((s) => s._worktreeRemoved)
  const disconnectRemoteSessionAction = useChatStore((s) => s.disconnectRemoteSession)
  const isRemoteLocked = useIsRemoteLocked()

  if (worktreeRemoved) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-4 py-3 text-sm text-muted-foreground">
        <GitFork className="size-3.5 shrink-0" />
        <span>Worktree has been removed.</span>
        <span>This session is now <em>READ ONLY</em>.</span>
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
  const {
    messages, isCompacting, isRecapping, compactError, apiRetry, modelFallback,
    displayedSessionId, historyHydrated,
    sessionStatus, lastAssistantMessageId, queuedMessages, awaitingAssistantReply,
  } = useActiveSession(useShallow((s) => ({
    messages: s.messages,
    isCompacting: s.isCompacting,
    isRecapping: s.isRecapping,
    compactError: s.compactError,
    apiRetry: s.apiRetry,
    modelFallback: s.modelFallback,
    displayedSessionId: scope?.sessionId ?? s._activeSessionId,
    historyHydrated: s._historyHydrated,
    sessionStatus: s.status,
    lastAssistantMessageId: s.lastAssistantMessageId,
    queuedMessages: s.queuedMessages,
    awaitingAssistantReply: s.awaitingAssistantReply,
  })))

  const { editQueuedMessage, deleteQueuedMessage, dismissCompactError } = useChatStore(useShallow((s) => ({
    editQueuedMessage: s.editQueuedMessage,
    deleteQueuedMessage: s.deleteQueuedMessage,
    dismissCompactError: s.dismissCompactError,
  })))

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
        <ChatSuggestions />
      ) : (
        <ScrollArea key={displayedSessionId ?? 'default'} className="chat-scroll-area h-full min-w-0 animate-[fade-in_150ms_ease-out]" viewportRef={scrollViewportRef}>
          <SelectionContextMenuZone className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-1 p-3 @lg:gap-1.5 @lg:p-3.5 @2xl:gap-1.5 @2xl:p-4">
            {hasMore && <div ref={sentinelRef} className="h-px" style={{ overflowAnchor: 'none' }} />}
            {renderedMessages.map((msg) => {
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
            {queuedMessages.map((msg) => (
              <div key={msg.id} className="group/queued chat-message-wrapper opacity-50">
                <ChatMessage message={msg} sessionStatus={sessionStatus} isLastAssistant={false} hideUserActions />
                <div className="flex justify-end pr-1">
                  <div className="-mt-0.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/queued:opacity-100">
                    <button onClick={() => editQueuedMessage(msg.id)} className="cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground">
                      <PenLine className="size-3" />
                    </button>
                    <button onClick={() => deleteQueuedMessage(msg.id)} className="cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground">
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {isCompacting && <CompactingIndicator />}
            {!isCompacting && compactError && <CompactErrorIndicator error={compactError} onDismiss={dismissCompactError} />}
            {isRecapping && <RecappingIndicator />}
            {apiRetry && <ApiRetryIndicator info={apiRetry} />}
            {modelFallback && <ModelFallbackIndicator info={modelFallback} />}
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
  const { pendingPlanApproval, displayedSessionId } = useActiveSession(useShallow((s) => ({
    pendingPlanApproval: s.pendingPlanApproval,
    displayedSessionId: scope?.sessionId ?? s._activeSessionId,
  })))

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
          <ChatTranscript
            scrollViewportRef={scrollViewportRef}
            showScrollButton={showScrollButton}
            scrollToBottom={scrollToBottom}
            stopAutoScroll={stopAutoScroll}
            liquidGlass={liquidGlass}
          />
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
