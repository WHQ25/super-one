import { publishComposerOverhang as publishOverhang } from '@/hooks/useChatScroll'
import { useEnvironmentServes } from '@/hooks/use-environment-serves'
import { pendingTurnMessage, sessionFooterTarget } from '@superone/chat-view/presenters/turn-footer-model'
import { resolveProvider } from '@/stores/chat-store/helpers/provider-routing'
import { useRef, useEffect, useMemo, useCallback } from 'react'
import { useChatStore, useActiveSession, useSessionScope } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { useShallow } from 'zustand/react/shallow'
import { findLastAssistantMessageId } from './ChatMessage'
import { selectClaudeModels } from '@/stores/chat-store/selectors'
import { mergeCodexThreadMessages } from './codex-realtime-messages'
import { CodexRealtimeTranscript } from './CodexRealtimeTranscript'
import { useCodexConversationActivation } from './use-codex-conversation-activation'
import { ComposerSwitch } from './ComposerSwitch'
import { useSessionContinuationOffer } from './session-continuation-offer'
import { resolveComposer } from './composer-slot/resolve-composer'
import { COMPOSER_CONTENT_MAX_HEIGHT, renderComposer } from './composer-slot/composer-registry'
import { topComposer, useComposerStacks } from './composer-slot/composer-stack'
import { groupPendingPermissions } from '@superone/shared/input-request-presentation'
import { withoutPendingRecapTurn } from '@superone/shared/recap-row'
import { buildDecisionQueue } from './composer-slot/decision-queue'
import { useDecisionComposerAvailability } from './composer-slot/useDecisionComposerAvailability'
import { useRestoreChatInputFocus } from '@/hooks/useRestoreChatInputFocus'
import { useTurnOutline } from '@superone/chat-view/use-turn-outline'
import { transcriptView } from '@superone/shared/transcript-segments'
import { ChatRootContext } from './is-focus-in-chat'
import { DesktopModUi } from '@/lib/mod-ui/DesktopModUi'
import { ModPaneDockSync } from './mod/ModSurfaces'
import { dateSeparators } from '@superone/chat-view/presenters/message-time'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { useCanSteerQueue } from './queued-steer'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { DetailScopeProvider } from '@superone/chat-view/detail-scope'
import { desktopDetailClient } from '@/lib/desktop-detail-client'
import {
  EMPTY_CODEX_REALTIME_SESSION_VIEW,
  hydrateCodexRealtimeTimeline,
  restoreLocalCodexRealtimeTimeline,
  useCodexRealtimeViewStore,
} from '@/stores/codex-realtime-view'
import { useRealtimeCallStore } from '@/stores/realtime-call'
import { useMcpAppConsents } from '@/components/mcp-apps/consent-store'
import { ChatOverlayProviders, renderActiveChatOverlay, useChatOverlays } from './chat-content/chat-overlays'
import { ChatTranscriptBody, useTranscriptJump } from './chat-content/chat-transcript-body'
import { useChatDensityScale } from './chat-content/use-chat-density-scale'
import { useTranscriptFrameKey } from './chat-content/use-transcript-frame-key'

interface ChatContentProps {
  scrollViewportRef: React.RefObject<HTMLDivElement | null>
  showScrollButton?: boolean
  scrollToBottom?: () => void
  stopAutoScroll?: () => void
  foreground?: boolean
}

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
  const activeProject = useChatStore((s) => s.activeProject)
  // Model ids arrive raw on the wire; display names live in the harness catalogs.
  const claudeModels = useChatStore(selectClaudeModels)
  const {
    messages, isCompacting, compactingStartedAt, isRecapping, compactError, apiRetry,
    displayedSessionId, historyHydrated,
    sessionStatus, lastAssistantMessageId, queuedMessages, awaitingAssistantReply, acpModels,
    sessionProvider, preferredProvider, runtimeCapabilities,
    draftId, sideChatParentId, providerSessionId,
  } = useActiveSession(useShallow((s) => ({
    messages: s.messages,
    isCompacting: s.isCompacting,
    compactingStartedAt: s.compactingStartedAt,
    isRecapping: s.isRecapping,
    compactError: s.compactError,
    apiRetry: s.apiRetry,
    displayedSessionId: scope?.sessionId ?? s._activeSessionId,
    historyHydrated: s._historyHydrated,
    sessionStatus: s.status,
    lastAssistantMessageId: s.lastAssistantMessageId,
    queuedMessages: s.queuedMessages,
    runtimeCapabilities: s.runtimeCapabilities,
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
  const realtime = useCodexRealtimeViewStore(
    (state) => displayedSessionId
      ? state.sessions[displayedSessionId] ?? EMPTY_CODEX_REALTIME_SESSION_VIEW
      : EMPTY_CODEX_REALTIME_SESSION_VIEW,
  )
  const realtimeTimelineLoadStatus = useCodexRealtimeViewStore(
    (state) => displayedSessionId ? state.sessions[displayedSessionId]?.loadStatus ?? 'idle' : 'idle',
  )
  const queueTarget = scope ?? undefined
  const queueProvider = resolveProvider({ sessionProvider, preferredProvider })
  const awaitingRealtimeTimeline = queueProvider === 'codex'
    && !!providerSessionId
    && (realtimeTimelineLoadStatus === 'idle' || realtimeTimelineLoadStatus === 'loading')
  const canHostStartQueued = useEnvironmentServes(scope?.projectPath ?? activeProject, 'session.startQueued')
  const canSteerQueue = useCanSteerQueue(scope?.projectPath ?? activeProject, queueProvider, runtimeCapabilities, sessionStatus)
  const isLocalCodexQueue = canHostStartQueued && queueProvider === 'codex'
  const canStartCodexQueue = isLocalCodexQueue && sessionStatus !== 'streaming'
  // ChatTranscript doubles as the backing-thread view (see `showRealtime`). That view
  // exists to show exactly what Codex was asked to do, so it keeps the delegation
  // prompts the voice view hides.
  const showsBackingThread = hasRealtimeTimeline && realtime.view === 'thread'
  const displayMessages = useMemo(
    () => (queueProvider === 'codex' && hasRealtimeTimeline
      ? mergeCodexThreadMessages(messages, realtime, { keepDelegationPrompts: showsBackingThread })
      : withoutPendingRecapTurn(messages, isRecapping)),
    [hasRealtimeTimeline, isRecapping, messages, queueProvider, realtime, showsBackingThread],
  )
  const draftMode = !!draftId || (queueProvider === 'codex' && hasRealtimeTimeline)
  const displayLastAssistantMessageId = findLastAssistantMessageId(displayMessages)
    ?? lastAssistantMessageId
  const retryTarget = useMemo(() => apiRetry
    ? sessionFooterTarget(displayMessages, displayLastAssistantMessageId ?? undefined) : null,
    [apiRetry, displayMessages, displayLastAssistantMessageId])
  const pendingMessage = useMemo(() => {
    if (retryTarget) return retryTarget.placeholder ? retryTarget.message : null
    if (!parseRemoteProjectKey(scope?.projectPath ?? activeProject ?? '')
      || !awaitingAssistantReply || isCompacting || isRecapping) return null
    const user = displayMessages.findLast(message => message.role === 'user')
    return user ? pendingTurnMessage(user) : null
  }, [retryTarget, scope?.projectPath, activeProject, awaitingAssistantReply, isCompacting, isRecapping, displayMessages])
  const retry = useCallback(() => {
    const lastUser = displayMessages.findLast(message => message.role === 'user')
    const text = lastUser?.content.find(block => block.type === 'text')
    if (text?.type === 'text' && text.text.trim()) {
      void useChatStore.getState().sendMessage(text.text, undefined, undefined, undefined, scope ?? undefined)
    }
  }, [displayMessages, scope])

  const messagesLen = displayMessages.length
  const messagesTailId = displayMessages[messagesLen - 1]?.id
  const { segments, rows: messageRows } = useMemo(() => transcriptView(displayMessages), [displayMessages])
  // Use the same transcript row spacing before and after message_start.
  const rows = useMemo(() => pendingMessage
    ? [...messageRows, ...transcriptView([pendingMessage]).rows]
    : messageRows, [messageRows, pendingMessage])
  const messagesTailCreatedAt = displayMessages[messagesLen - 1]?.createdAt
  const dateSeparatorAt = useMemo(
    () => dateSeparators(displayMessages, Date.now()),
    // The tail's timestamp can still be corrected mid-turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messagesLen, messagesTailId, messagesTailCreatedAt]
  )
  // A fallback id can name a model from either catalog: model_fallback is emitted
  // by the Claude SDK and by the ACP backends.
  const modelCatalog = useMemo(() => [...claudeModels, ...acpModels], [claudeModels, acpModels])

  const outline = useTurnOutline(displayMessages, segments)
  const { transcriptRef, messageTop, jumpToMessage } = useTranscriptJump({
    displayedSessionId,
    displayMessages,
    pendingJump: realtime.pendingJump,
    stopAutoScroll,
  })

  return (
    <ChatTranscriptBody
      displayedSessionId={displayedSessionId}
      scrollViewportRef={scrollViewportRef}
      transcriptRef={transcriptRef}
      showScrollButton={showScrollButton}
      scrollToBottom={scrollToBottom}
      liquidGlass={liquidGlass}
      displayMessages={displayMessages}
      rows={rows}
      dateSeparatorAt={dateSeparatorAt}
      modelCatalog={modelCatalog}
      outline={outline}
      messageTop={messageTop}
      jumpToMessage={jumpToMessage}
      historyHydrated={historyHydrated}
      hasRealtimeTimeline={hasRealtimeTimeline}
      sessionStatus={sessionStatus}
      awaitingAssistantReply={awaitingAssistantReply}
      apiRetry={apiRetry}
      sideChatParentId={sideChatParentId}
      realtimeStarting={realtime.starting}
      awaitingRealtimeTimeline={awaitingRealtimeTimeline}
      draftMode={draftMode}
      pendingMessageId={pendingMessage?.id}
      displayLastAssistantMessageId={displayLastAssistantMessageId}
      retryTargetMessageId={retryTarget?.message.id}
      onRetry={retry}
      queuedMessages={queuedMessages}
      canStartCodexQueue={canStartCodexQueue}
      canSteerQueue={canSteerQueue}
      queueTarget={queueTarget}
      startQueuedMessages={startQueuedMessages}
      steerQueuedMessage={steerQueuedMessage}
      editQueuedMessage={editQueuedMessage}
      deleteQueuedMessage={deleteQueuedMessage}
      isCompacting={isCompacting}
      compactingStartedAt={compactingStartedAt}
      compactError={compactError}
      dismissCompactError={dismissCompactError}
      isRecapping={isRecapping}
    />
  )
}

export function ChatContent({ scrollViewportRef, showScrollButton = false, scrollToBottom, stopAutoScroll, foreground = true }: ChatContentProps) {
  const scope = useSessionScope()
  const activeProject = useChatStore((s) => s.activeProject)
  const {
    messages, sessionStatus, pendingPermissions, pendingQuestion, pendingAsyncQuestions, pendingPlanApproval,
    displayedSessionId, providerSessionId, sessionProvider, preferredProvider,
    historyHydrated, awaitingAssistantReply, apiRetry, sideChatParentId, isRecapping,
  } = useActiveSession(useShallow((s) => ({
    messages: s.messages,
    sessionStatus: s.status,
    pendingPermissions: s.pendingPermissions,
    pendingQuestion: s.pendingQuestion,
    pendingAsyncQuestions: s.pendingAsyncQuestions,
    pendingPlanApproval: s.pendingPlanApproval,
    displayedSessionId: scope?.sessionId ?? s._activeSessionId,
    providerSessionId: s._providerSessionId,
    sessionProvider: s.sessionProvider,
    preferredProvider: s.preferredProvider,
    historyHydrated: s._historyHydrated,
    awaitingAssistantReply: s.awaitingAssistantReply,
    apiRetry: s.apiRetry,
    sideChatParentId: s._sideChatParentId ?? null,
    isRecapping: s.isRecapping,
  })))
  const projectPath = scope?.projectPath ?? activeProject
  // Rows of a remote session may arrive summarized; their detail loads from that machine.
  const remoteConnectionId = parseRemoteProjectKey(projectPath ?? '')?.connectionId
  const detailScope = useMemo(() => remoteConnectionId && displayedSessionId
    ? { client: desktopDetailClient, environmentId: remoteConnectionId, sessionId: displayedSessionId }
    : null, [remoteConnectionId, displayedSessionId])
  const isCodexSession = resolveProvider({ sessionProvider, preferredProvider }) === 'codex'
  useCodexConversationActivation({ sessionId: displayedSessionId, projectPath, enabled: true, foreground })
  const drawsMods = HARNESS_CAPABILITIES[resolveProvider({ sessionProvider, preferredProvider })].modUi
  const realtime = useCodexRealtimeViewStore(
    (state) => displayedSessionId
      ? state.sessions[displayedSessionId] ?? EMPTY_CODEX_REALTIME_SESSION_VIEW
      : EMPTY_CODEX_REALTIME_SESSION_VIEW,
  )
  const realtimeTimelineLoadStatus = useCodexRealtimeViewStore(
    (state) => displayedSessionId ? state.sessions[displayedSessionId]?.loadStatus ?? 'idle' : 'idle',
  )
  const threadMessages = useMemo(
    () => isCodexSession && realtime.hasTimeline
      ? mergeCodexThreadMessages(messages, realtime)
      : messages,
    [isCodexSession, messages, realtime],
  )
  // Doubao uses the same voice pane. The Codex gate stays on timeline hydration,
  // not on whether the call composer is allowed to replace the text composer.
  const showRealtime = Boolean(
    displayedSessionId
    && projectPath
    && realtime.hasTimeline
    && realtime.view === 'realtime',
  )
  const awaitingRealtimeTimeline = isCodexSession
    && !!providerSessionId
    && (realtimeTimelineLoadStatus === 'idle' || realtimeTimelineLoadStatus === 'loading')
  const landingMessages = useMemo(
    () => (isCodexSession && realtime.hasTimeline ? threadMessages : withoutPendingRecapTurn(messages, isRecapping)),
    [isCodexSession, isRecapping, messages, realtime.hasTimeline, threadMessages],
  )
  const isEmptyLanding = !showRealtime
    && landingMessages.length === 0
    && historyHydrated
    && sessionStatus !== 'streaming'
    && sessionStatus !== 'background'
    && !awaitingAssistantReply
    && !apiRetry
    && !sideChatParentId
    && !realtime.starting
    && !awaitingRealtimeTimeline
  const transcriptFrameKey = useTranscriptFrameKey(displayedSessionId, isEmptyLanding)
  // The composer follows the call, not the view: voice has no text input while a
  // call runs, and once it ends the ordinary composer (with its start-call entry)
  // returns. The backing-thread view keeps the ordinary composer even mid-call so
  // typed input can still steer the delegated turn.
  const callEngaged = useRealtimeCallStore((store) => (
    store.sessionId !== null && store.sessionId === displayedSessionId && store.state !== 'idle'
  ))
  const showRealtimeComposer = showRealtime && callEngaged
  const decision = buildDecisionQueue(pendingPermissions ?? [], pendingQuestion ?? null, messages, pendingAsyncQuestions)[0] ?? null
  const appInput = groupPendingPermissions(pendingPermissions ?? []).appInputs[0] ?? null
  const needsDecision = decision != null || pendingPlanApproval != null
  const decisionAvailable = useDecisionComposerAvailability()
  // Consent stays queued behind decisions. If a read-only gate suppresses the
  // decision composer, keep consent hidden too, matching the old composer gates.
  const consentHead = useMcpAppConsents(state => state.pending.find(item => item.sessionId === displayedSessionId))
  const appConsent = Boolean(consentHead) && (!needsDecision || decisionAvailable)
  // Draft edits stay inside the opened composer; the transcript only follows identity changes.
  const openedComposer = useComposerStacks(useShallow(state => {
    const entry = projectPath && displayedSessionId ? topComposer({ projectPath, sessionId: displayedSessionId }, state) : null
    return entry ? { key: entry.key, id: entry.id, target: entry.target, lifetime: entry.lifetime } : null
  }))
  const containerRef = useRef<HTMLDivElement>(null)
  const continuation = useSessionContinuationOffer(containerRef)
  const composerKind = resolveComposer({ needsDecision, decisionAvailable, appConsent, appInput: !!appInput, voiceEngaged: showRealtimeComposer, openedComposerId: openedComposer?.id, continuationOffered: !!continuation })
  const composerKey = composerKind === 'decision' && decision
    ? `${decision.kind}:${decision.request.requestId}`
    : composerKind === 'app-consent' && consentHead ? `app-consent:${consentHead.id}`
    : composerKind === 'app-input' && appInput ? `app-input:${appInput.requestId}`
    : openedComposer?.id === composerKind ? openedComposer.key
    : composerKind === 'continuation' && continuation ? `continuation:${continuation.sessionId}:${continuation.expiresAt}`
    : composerKind
  // The local snapshot needs no backing thread, so every Codex session on screen
  // restores it; only the provider reconcile waits for the thread id, because
  // reaching Codex would otherwise start a backend just to read history.
  useEffect(() => {
    if (!displayedSessionId || !isCodexSession) return
    // Remote timelines arrive with session.load. The local snapshot is this machine's SQLite.
    if (parseRemoteProjectKey(projectPath ?? '')) return
    void restoreLocalCodexRealtimeTimeline(displayedSessionId)
  }, [displayedSessionId, isCodexSession, projectPath])
  useEffect(() => {
    if (
      !displayedSessionId
      || !projectPath
      || !isCodexSession
      || !providerSessionId
    ) return
    void hydrateCodexRealtimeTimeline(projectPath, displayedSessionId)
  }, [displayedSessionId, isCodexSession, projectPath, providerSessionId])

  // ChatContent is the single render root for a visible session — mounted once per
  // single-mode pane, per mosaic tile, and per mini window. Reporting foreground here
  // (rather than in mosaic/mini-window-specific code) covers all three for free.
  useEffect(() => {
    if (!displayedSessionId || !foreground) return
    void window.agent.setSessionForeground(displayedSessionId, true, projectPath ?? undefined)
    return () => {
      void window.agent.setSessionForeground(displayedSessionId, false, projectPath ?? undefined)
    }
  }, [displayedSessionId, foreground, projectPath])

  useEffect(() => {
    void useSettingsStore.getState().ensureMcpIconSources()
  }, [])

  const liquidGlass = useAppStore((s) => s.liquidGlass)
  const {
    fullscreenPlan,
    setFullscreenPlan,
    planFullscreenCtx,
    subagentView,
    subagentNav,
    workflowView,
    workflowNav,
  } = useChatOverlays(displayedSessionId)

  // The transcript uses overlap as scroll allowance, without changing its viewport.
  const publishComposerOverhang = useCallback((px: number) => {
    publishOverhang(containerRef.current, px)
  }, [])
  const composerFocus = useRestoreChatInputFocus((needsDecision || !!appInput || !!openedComposer) && decisionAvailable, containerRef,
    projectPath && displayedSessionId ? { projectPath, sessionId: displayedSessionId } : undefined)
  const densityStyle = useChatDensityScale(containerRef)
  const activeOverlay = renderActiveChatOverlay({
    workflowView,
    subagentView,
    fullscreenPlan,
    setFullscreenPlan,
    showPlanApprovalPrompt: Boolean(pendingPlanApproval && decisionAvailable && !decision),
    scrollToBottom,
  })

  return (
    <ChatOverlayProviders
      workflowNav={workflowNav}
      subagentNav={subagentNav}
      planFullscreenCtx={planFullscreenCtx}
    >
    {/* overflow-clip, never hidden: an incoming composer rises from below the
        slot, and the base composer restores the caret on mount. Focus and
        ProseMirror's scrollIntoView scroll every overflow-hidden ancestor to
        reveal it, so the pane shifted up with history in it, then crept back as
        the rise shrank the overflow. A clip is not scrollable and keeps the
        translated stage out of the pane's scrollable overflow. */}
    <div
      ref={containerRef}
      data-chat-root=""
      className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-clip"
      style={densityStyle}
    >
      <ChatRootContext.Provider value={containerRef}>
      <DetailScopeProvider scope={detailScope}>
      <DesktopModUi projectPath={projectPath} sessionId={displayedSessionId ?? null} enabled={drawsMods}>
      {foreground && drawsMods && projectPath && displayedSessionId ? <ModPaneDockSync projectPath={projectPath} sessionId={displayedSessionId} /> : null}
      {activeOverlay ?? (
        <>
          {/* The fade belongs to arriving at a different session. Switching between
              the voice timeline and the backing thread keeps the frame.
              -mb-3 tucks this frame under the composer's top gap so the bottom
              fade meets the input. The stage leaves that gap unpainted, and
              glass keeps it clear above the text composer. Glass clips the
              overhang, plus the part of the gap a question or permission card
              fills. */}
          <div
            key={transcriptFrameKey}
            data-transcript-frame=""
            className="flex min-h-0 min-w-0 flex-1 flex-col -mb-3 animate-[fade-in_150ms_ease-out]"
          >
            {showRealtime ? (
              <CodexRealtimeTranscript
                sessionId={displayedSessionId!}
                projectPath={projectPath}
                scrollViewportRef={scrollViewportRef}
                showScrollButton={showScrollButton}
                scrollToBottom={scrollToBottom}
                stopAutoScroll={stopAutoScroll}
                liquidGlass={liquidGlass}
                threadMessages={threadMessages}
                sessionStatus={sessionStatus}
                needsDecision={needsDecision}
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
          <ComposerSwitch
            key={`composer:${displayedSessionId ?? projectPath ?? 'draft'}`}
            className="mx-auto w-full min-w-0 max-w-3xl"
            kind={composerKind}
            transitionKey={composerKey}
            align={{ kind: 'voice', to: 'text' }}
            onOverhangChange={publishComposerOverhang}
            maxHeight={composerKind === 'text' || composerKind === 'voice' ? undefined : COMPOSER_CONTENT_MAX_HEIGHT}
            render={(kind) => renderComposer(kind, displayedSessionId ?? '', {
              showTodoPopup: true,
              autoFocusOnMount: composerFocus.autoFocusOnMount,
              onBaseComposerMounted: composerFocus.onBaseComposerMounted,
              microphoneShortcutEnabled: showRealtimeComposer && !appConsent,
              decision,
              appConsent: consentHead,
              appInput,
              openedComposer,
              continuation,
            })}
          />
        </>
      )}
      </DesktopModUi>
      </DetailScopeProvider>
      </ChatRootContext.Provider>
    </div>
    </ChatOverlayProviders>
  )
}
