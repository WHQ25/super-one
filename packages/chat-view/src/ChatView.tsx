import { NavigationFeedback } from './NavigationFeedback'
import { contiguousHistoryRange, needsHistoryPage, globalHistoryRange } from './history-navigation'
import { extendHistoryIndex, mergeIndexedHistory, type SessionHistoryIndex } from '@superone/shared/session-history-index'
import { HistoryPageButton } from './HistoryPageButton'
import { deliverDetail } from './detail-stream'
import { applyDocumentTheme, initialDocumentScheme } from './document-theme'
import { AsyncQuestionMessagesContext } from './PortableAsyncQuestion'
import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import type { AgentStatus, ChatMessage, Locale } from '@superone/shared/agent-types'
import { ChevronDown } from 'lucide-react'
import {
  ApiRetryIndicator,
  CompactErrorIndicator,
  CompactIndicator,
  CompactingIndicator,
  findLastAssistantMessageId,
  PendingTurnIndicator,
  RecappingIndicator,
  TurnMetaIndicator,
} from './presenters/ChatMessageIndicators'
import { transcriptRow } from './transcript-rows'
import { ZERO_TURN_TOKENS } from './presenters/turn-footer-model'
import { CHAT_WINDOW, initialChatWindow, loadPreviousChatWindow, loadNextChatWindow, normalizeChatWindow, type ChatWindowRange } from './chat-window'
import { installHostBridge, postHost, requestNativeAsync } from './bridge'
import { setChatViewLocale } from './i18n'
import { PortableMessage } from './PortableMessage'
import { isRealtimeVoiceMessage } from '@superone/shared/realtime-transcript'
import { extractTurnOutline } from '@superone/shared/turn-outline'
import { ChatScrollIndicator } from './ChatScrollIndicator'
import { captureScrollAnchor, compactMessageIndices, compactVisibleStart, jumpChatWindow, visibleChatWindow, type ScrollAnchor } from './chat-navigation'
import type { HostInbound, ReductionProjection, SessionProjection } from './protocol'

type PendingPermission = ReductionProjection['pendingPermission']

interface ViewState {
  messages: ChatMessage[]
  hasMoreHistory: boolean
  historyNavigation: boolean
  navigation: SessionHistoryIndex | null
  labels: Record<string, string>
  mentionArtwork: Record<string, string>
  mcpIcons: Record<string, string>
  pendingPermission: PendingPermission
  session: SessionFacts
  range: ChatWindowRange
  expandLevel: number
  transcriptEpoch: number
  scheme: 'light' | 'dark'
  hue: number
  locale: Locale
  connection: { state: string; epoch: number }
  scrollTarget?: { id: string; behavior: ScrollBehavior }
}

type SessionFacts = Required<Omit<SessionProjection, 'sessionStatus'>> & {
  sessionStatus: AgentStatus
}

const EMPTY_SESSION: SessionFacts = {
  sessionStatus: 'idle',
  streamingTokens: ZERO_TURN_TOKENS,
  isCompacting: false,
  compactingStartedAt: null,
  isRecapping: false,
  compactError: null,
  apiRetry: null,
  pendingTurn: null,
  projectPath: null,
}

/** Take only the session keys the host actually sent; a patch omits what did not change. */
function mergeSessionFacts(previous: SessionFacts, projection: SessionProjection): SessionFacts {
  let next = previous
  for (const key of Object.keys(EMPTY_SESSION) as (keyof SessionFacts)[]) {
    const value = projection[key]
    if (value === undefined) continue
    if (next === previous) next = { ...previous }
    ;(next as Record<string, unknown>)[key] = value
  }
  return next
}

const EMPTY_STATE: ViewState = {
  messages: [],
  hasMoreHistory: false,
  historyNavigation: false,
  navigation: null,
  labels: {},
  mentionArtwork: {},
  mcpIcons: {},
  pendingPermission: null,
  session: EMPTY_SESSION,
  range: { start: 0, end: 0 },
  expandLevel: 0,
  transcriptEpoch: 0,
  scheme: 'dark',
  hue: 250,
  locale: 'en',
  connection: { state: 'connected', epoch: 0 },
}

const page = globalThis as unknown as Window

function normalizeMentionArtwork(value: ReductionProjection['mentionArtwork'], fallback: Record<string, string>): Record<string, string> {
  if (value === undefined) return fallback
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value).filter(([key, png]) =>
    (key.startsWith('miniapp:') || key.startsWith('desktop-app:'))
    && key.length <= 512
    && typeof png === 'string'
    && png.length <= 256_000
    && /^[A-Za-z0-9+/]+={0,2}$/.test(png)))
}

function normalizeMcpIcons(value: ReductionProjection['mcpIcons'], fallback: Record<string, string>): Record<string, string> {
  if (value === undefined) return fallback
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value).filter(([key, src]) =>
    key.length > 0
    && key.length <= 128
    && typeof src === 'string'
    && src.length <= 512_000
    && (/^https:\/\//.test(src) || /^data:image\//.test(src))))
}

function mergeHistory(older: ChatMessage[], current: ChatMessage[]): { messages: ChatMessage[]; added: number } {
  const existing = new Set(current.map((message) => message.id))
  const uniqueOlder = older.filter((message) => !existing.has(message.id))
  return { messages: [...uniqueOlder, ...current], added: uniqueOlder.length }
}

function rangeAfterPatch(previous: ViewState, messages: ChatMessage[], atBottom: boolean): ChatWindowRange {
  const minimum = compactVisibleStart(compactMessageIndices(messages), previous.expandLevel)
  if (atBottom) return visibleChatWindow(initialChatWindow(messages.length), messages.length, minimum)
  const mounted = previous.range.end - previous.range.start
  const anchorId = previous.messages[previous.range.start]?.id
  const anchorIndex = anchorId ? messages.findIndex((message) => message.id === anchorId) : -1
  const start = anchorIndex >= 0 ? anchorIndex : previous.range.start
  return contiguousHistoryRange(messages, previous.navigation, visibleChatWindow({ start, end: start + mounted }, messages.length, minimum), start)
}

function applyProjection(
  previous: ViewState,
  projection: ReductionProjection,
  atBottom: boolean,
): ViewState {
  const mergedRows = projection.messagePatches?.length || projection.messageOrder
    ? new Map([...previous.messages, ...(projection.messagePatches ?? [])].map(message => [message.id, message])) : null
  const messages = projection.messages ?? (mergedRows
    ? (projection.messageOrder ?? previous.messages.map(message => message.id)).flatMap(id => mergedRows.has(id) ? [mergedRows.get(id)!] : []) : previous.messages)
  return {
    ...previous,
    messages,
    hasMoreHistory: projection.hasMoreHistory ?? previous.hasMoreHistory,
    historyNavigation: projection.historyNavigation ?? previous.historyNavigation,
    labels: projection.labels ?? previous.labels,
    mentionArtwork: normalizeMentionArtwork(projection.mentionArtwork, previous.mentionArtwork),
    mcpIcons: normalizeMcpIcons(projection.mcpIcons, previous.mcpIcons),
    pendingPermission: projection.pendingPermission === undefined
      ? previous.pendingPermission
      : projection.pendingPermission,
    session: mergeSessionFacts(previous.session, projection),
    range: messages !== previous.messages
      ? rangeAfterPatch(previous, messages, atBottom)
      : previous.range,
  }
}

export function ChatView() {
  const [state, setState] = useState<ViewState>(() => ({ ...EMPTY_STATE, scheme: initialDocumentScheme(document.documentElement) }))
  const stateRef = useRef(state)
  const atBottomRef = useRef(true)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prependSnapshotRef = useRef<ScrollAnchor | null>(null)
  const navigatingUntilRef = useRef(0)
  const loadingPreviousRef = useRef(false)
  const fetchingHistoryRef = useRef(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState(false)
  const scrollToBottomRef = useRef(false)
  const navigationRequest = useRef(0)
  const [navigationLoading, setNavigationLoading] = useState(false)
  const [navigationRetry, setNavigationRetry] = useState<(() => void) | null>(null)
  const [indexAttempt, setIndexAttempt] = useState(0)
  stateRef.current = state

  const emitViewState = useCallback(() => {
    const current = stateRef.current
    const anchorId = current.messages[current.range.start]?.id
    postHost({
      type: 'viewState',
      range: current.range,
      atBottom: atBottomRef.current,
      anchorId,
    })
  }, [])

  const scheduleViewState = useCallback(() => {
    if (scrollTimerRef.current != null) return
    scrollTimerRef.current = setTimeout(() => {
      scrollTimerRef.current = null
      emitViewState()
    }, CHAT_WINDOW.envelopeMs)
  }, [emitViewState])

  useEffect(() => {
    if (!state.historyNavigation) return
    let cancelled = false
    setNavigationLoading(true)
    setNavigationRetry(null)
    void requestNativeAsync('loadNavigationIndex').then((result) => {
      if (cancelled) return
      const index = result as SessionHistoryIndex
      if (!Array.isArray(index.messageIds) || !Array.isArray(index.entries) || !Array.isArray(index.compacts)) throw new Error('Invalid history index')
      setState(previous => ({ ...previous, navigation: index }))
    }).catch(() => {
      if (!cancelled) setNavigationRetry(() => () => setIndexAttempt(value => value + 1))
    }).finally(() => { if (!cancelled) setNavigationLoading(false) })
    return () => { cancelled = true }
  }, [state.transcriptEpoch, state.historyNavigation, indexAttempt])

  const requestHistoryWindow = useCallback(async (anchorId: string, direction: 'around' | 'before' | 'after') => {
    const epoch = stateRef.current.transcriptEpoch
    const request = ++navigationRequest.current
    atBottomRef.current = false
    scrollToBottomRef.current = false
    setNavigationLoading(true)
    setNavigationRetry(null)
    try {
      const result = await requestNativeAsync('loadHistoryWindow', { anchorId, direction }) as { messages: ChatMessage[] }
      if (epoch !== stateRef.current.transcriptEpoch || request !== navigationRequest.current) return
      if (direction !== 'around') prependSnapshotRef.current = captureScrollAnchor()
      else { prependSnapshotRef.current = null; navigatingUntilRef.current = performance.now() + 700 }
      setState(previous => {
        if (!previous.navigation) return previous
        const messages = mergeIndexedHistory(previous.navigation, result.messages, previous.messages)
        const anchor = messages.findIndex(message => message.id === anchorId)
        if (anchor < 0) return previous
        const oldStart = messages.findIndex(message => message.id === previous.messages[previous.range.start]?.id)
        const oldEnd = messages.findIndex(message => message.id === previous.messages[previous.range.end - 1]?.id) + 1
        const range = direction === 'around' ? jumpChatWindow(anchor, messages.length)
          : normalizeChatWindow(direction === 'before'
            ? { start: Math.max(0, anchor - CHAT_WINDOW.loadMoreTurns),
                end: Math.min(oldEnd, Math.max(0, anchor - CHAT_WINDOW.loadMoreTurns) + CHAT_WINDOW.maxMountedTurns) }
            : { start: Math.max(0, oldStart), end: Math.min(messages.length, anchor + 1 + CHAT_WINDOW.loadMoreTurns) }, messages.length)
        return { ...previous, messages,
          range: contiguousHistoryRange(messages, previous.navigation, range, anchor),
          expandLevel: compactMessageIndices(messages).length,
          scrollTarget: direction === 'around' ? { id: anchorId, behavior: 'auto' } : undefined }
      })
    } catch {
      if (epoch === stateRef.current.transcriptEpoch && request === navigationRequest.current)
        setNavigationRetry(() => () => { void requestHistoryWindow(anchorId, direction) })
    } finally {
      if (epoch === stateRef.current.transcriptEpoch && request === navigationRequest.current) setNavigationLoading(false)
    }
  }, [])

  const changeWindow = useCallback((direction: 'previous' | 'next') => {
    if (loadingPreviousRef.current || performance.now() < navigatingUntilRef.current) return
    const current = stateRef.current
    const minimum = compactVisibleStart(compactMessageIndices(current.messages), current.expandLevel)
    if (direction === 'previous' ? current.range.start <= minimum : current.range.end >= current.messages.length) return
    loadingPreviousRef.current = true
    atBottomRef.current = false
    scrollToBottomRef.current = false
    prependSnapshotRef.current = captureScrollAnchor()
    setState((previous) => ({
      ...previous,
      range: contiguousHistoryRange(previous.messages, previous.navigation, visibleChatWindow(
        (direction === 'previous' ? loadPreviousChatWindow : loadNextChatWindow)(previous.range, previous.messages.length),
        previous.messages.length, minimum,
      ), direction === 'previous' ? previous.range.start : previous.range.end - 1),
    }))
  }, [])
  const loadPrevious = useCallback(async () => {
    const current = stateRef.current
    if (current.navigation && needsHistoryPage(current.messages, current.navigation, current.range, 'before')) {
      if (!navigationLoading) await requestHistoryWindow(current.messages[current.range.start]!.id, 'before')
      return
    }
    if (current.navigation || current.range.start > 0 || !current.hasMoreHistory) {
      changeWindow('previous')
      return
    }
    if (fetchingHistoryRef.current) return
    fetchingHistoryRef.current = true
    setHistoryLoading(true)
    setHistoryError(false)
    const epoch = current.transcriptEpoch
    const navigationGeneration = navigationRequest.current
    try {
      const result = await requestNativeAsync('loadEarlier') as ReductionProjection
      if (stateRef.current.transcriptEpoch !== epoch || navigationRequest.current !== navigationGeneration) return
      atBottomRef.current = false
      scrollToBottomRef.current = false
      prependSnapshotRef.current = captureScrollAnchor()
      setState(previous => {
        if (previous.transcriptEpoch !== epoch) return previous
        const merged = mergeHistory(result.messages ?? [], previous.messages)
        return {
          ...previous, messages: merged.messages, hasMoreHistory: result.hasMoreHistory ?? false,
          range: normalizeChatWindow({
            start: Math.max(0, previous.range.start + merged.added - CHAT_WINDOW.loadMoreTurns),
            end: previous.range.end + merged.added,
          }, merged.messages.length),
        }
      })
    } catch {
      if (stateRef.current.transcriptEpoch === epoch) setHistoryError(true)
    } finally {
      if (stateRef.current.transcriptEpoch === epoch) {
        fetchingHistoryRef.current = false
        setHistoryLoading(false)
      }
    }
  }, [changeWindow, navigationLoading, requestHistoryWindow])
  const loadNext = useCallback(() => {
    const current = stateRef.current
    if (current.navigation && needsHistoryPage(current.messages, current.navigation, current.range, 'after')) {
      if (!navigationLoading) void requestHistoryWindow(current.messages[current.range.end - 1]!.id, 'after')
    } else changeWindow('next')
  }, [changeWindow, navigationLoading, requestHistoryWindow])

  const prepareNavigation = useCallback(() => {
    navigationRequest.current++
    setNavigationLoading(false)
    setNavigationRetry(null)
    atBottomRef.current = false
    scrollToBottomRef.current = false
    prependSnapshotRef.current = null
    loadingPreviousRef.current = false
    navigatingUntilRef.current = performance.now() + 700
  }, [])

  const jumpToMessage = useCallback((id: string, behavior: ScrollBehavior = 'smooth') => {
    if (!stateRef.current.messages.some((message) => message.id === id)) {
      if (stateRef.current.navigation?.messageIds.includes(id)) void requestHistoryWindow(id, 'around')
      return
    }
    prepareNavigation()
    setState((previous) => {
      const index = previous.messages.findIndex((message) => message.id === id)
      if (index < 0) return previous
      const compact = compactMessageIndices(previous.messages)
      const expandLevel = Math.max(previous.expandLevel, compact.filter((position) => position > index).length)
      const mounted = index >= previous.range.start && index < previous.range.end
      return {
        ...previous, expandLevel,
        range: mounted ? previous.range
          : contiguousHistoryRange(previous.messages, previous.navigation, jumpChatWindow(index, previous.messages.length, compactVisibleStart(compact, expandLevel)), index),
        // Replacing the DOM window invalidates the old scroll coordinates.
        // Animate only when both positions belong to the same mounted window.
        scrollTarget: { id, behavior: mounted ? behavior : 'auto' },
      }
    })
  }, [prepareNavigation, requestHistoryWindow])

  const setCompactExpansion = useCallback((level: number) => {
    const anchor = captureScrollAnchor()
    prepareNavigation()
    setState((previous) => {
      const compact = compactMessageIndices(previous.messages)
      const minimum = compactVisibleStart(compact, level)
      const anchorIndex = anchor ? previous.messages.findIndex((message) => message.id === anchor.id) : -1
      const keepAnchor = anchorIndex >= minimum && anchorIndex >= previous.range.start && anchorIndex < previous.range.end
      if (keepAnchor) prependSnapshotRef.current = anchor
      return {
        ...previous, expandLevel: level,
        range: keepAnchor ? visibleChatWindow(previous.range, previous.messages.length, minimum)
          : jumpChatWindow(minimum, previous.messages.length, minimum),
        scrollTarget: keepAnchor ? undefined : previous.messages[minimum] ? { id: previous.messages[minimum]!.id, behavior: 'auto' } : undefined,
      }
    })
  }, [prepareNavigation])

  const handleInbound = useCallback((message: HostInbound) => {
    switch (message.type) {
      case 'detailUpdate':
        deliverDetail(message)
        return
      case 'initialize':
      case 'hydrate':
        navigationRequest.current++
        setNavigationLoading(false)
        setNavigationRetry(null)
        fetchingHistoryRef.current = false
        setHistoryLoading(false)
        setHistoryError(false)
        prependSnapshotRef.current = null
        loadingPreviousRef.current = false
        navigatingUntilRef.current = 0
        scrollToBottomRef.current = true
        atBottomRef.current = true
        setState((previous) => {
          const next = applyProjection(previous, message, true)
          return {
            ...next, navigation: null, historyNavigation: message.historyNavigation ?? false,
            hasMoreHistory: message.hasMoreHistory ?? false, expandLevel: 0, transcriptEpoch: previous.transcriptEpoch + 1, scrollTarget: undefined,
            range: visibleChatWindow(initialChatWindow(next.messages.length), next.messages.length,
              compactVisibleStart(compactMessageIndices(next.messages), 0)),
          }
        })
        return
      case 'applyReductionPatch':
        if (atBottomRef.current && (message.messages || message.messagePatches)) scrollToBottomRef.current = true
        setState((previous) => applyProjection(previous, message, atBottomRef.current))
        return
      case 'prependHistory':
        if (!message.messages?.length) return
        setState((previous) => {
          const merged = mergeHistory(message.messages ?? [], previous.messages)
          return {
            ...applyProjection(previous, { ...message, messages: undefined }, atBottomRef.current),
            messages: merged.messages,
            range: normalizeChatWindow({
              start: previous.range.start + merged.added,
              end: previous.range.end + merged.added,
            }, merged.messages.length),
          }
        })
        return
      case 'reset':
        navigationRequest.current++
        setNavigationLoading(false)
        setNavigationRetry(null)
        fetchingHistoryRef.current = false
        setHistoryLoading(false)
        setHistoryError(false)
        atBottomRef.current = true
        prependSnapshotRef.current = null
        scrollToBottomRef.current = false
        loadingPreviousRef.current = false
        navigatingUntilRef.current = 0
        // Theme, locale and connection are host-owned and only re-sent when they
        // change, so a transcript reset must not roll them back to the defaults.
        setState((previous) => ({
          ...EMPTY_STATE,
          transcriptEpoch: previous.transcriptEpoch + 1,
          scheme: previous.scheme,
          hue: previous.hue,
          locale: previous.locale,
          connection: previous.connection,
        }))
        return
      case 'setConnection':
        setState((previous) => ({ ...previous, connection: { state: message.state, epoch: message.epoch } }))
        return
      case 'setTheme':
        setState((previous) => ({
          ...previous,
          hue: typeof message.hue === 'number' ? message.hue : previous.hue,
          scheme: message.scheme ?? previous.scheme,
        }))
        return
      case 'setViewport':
        if (message.safeArea) {
          const root = document.documentElement
          for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
            const value = message.safeArea[edge] ?? 0
            root.style.setProperty(`--safe-area-${edge}`, `${Math.max(0, value)}px`)
          }
        }
        if (typeof message.fontScale === 'number') {
          document.documentElement.style.fontSize = `${Math.max(0.8, Math.min(1.6, message.fontScale)) * 16}px`
        }
        if (message.locale) {
          document.documentElement.lang = message.locale
          void setChatViewLocale(message.locale)
          setState((previous) => ({ ...previous, locale: message.locale! }))
        }
        return
      case 'setWindow':
        prepareNavigation()
        setState((previous) => {
          const range = normalizeChatWindow(message.range, previous.messages.length)
          const compact = compactMessageIndices(previous.messages)
          return {
            ...previous, range,
            expandLevel: Math.max(previous.expandLevel, compact.filter((index) => index > range.start).length),
            scrollTarget: message.anchorId ? { id: message.anchorId, behavior: 'auto' } : undefined,
          }
        })
        return
      case 'scrollToTurn':
        jumpToMessage(message.turnId, message.behavior ?? 'smooth')
        return
      case 'nativeActionProgress':
      case 'nativeActionResult':
        return
    }
  }, [prepareNavigation, jumpToMessage])

  useEffect(() => {
    const removeBridge = installHostBridge(handleInbound)
    document.documentElement.dataset.chatViewReady = 'true'
    postHost({ type: 'ready' })
    return () => {
      removeBridge()
      if (scrollTimerRef.current != null) clearTimeout(scrollTimerRef.current)
    }
  }, [handleInbound])

  useEffect(() => {
    applyDocumentTheme(document.documentElement, document.body, { hue: state.hue, scheme: state.scheme })
  }, [state.hue, state.scheme])

  useLayoutEffect(() => {
    const snapshot = prependSnapshotRef.current
    if (snapshot) {
      const anchor = document.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(snapshot.id)}"]`)
      if (anchor) page.scrollBy({ top: anchor.getBoundingClientRect().top - snapshot.top, behavior: 'auto' })
      prependSnapshotRef.current = null
      setTimeout(() => { loadingPreviousRef.current = false }, 60)
      scheduleViewState()
      return
    }
    if (loadingPreviousRef.current) setTimeout(() => { loadingPreviousRef.current = false }, 60)
    if (!state.scrollTarget && (scrollToBottomRef.current || atBottomRef.current)) {
      page.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' })
      scrollToBottomRef.current = false
    }
  }, [state.messages, state.range, scheduleViewState])

  useLayoutEffect(() => {
    if (!state.scrollTarget) return
    const element = document.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(state.scrollTarget.id)}"]`)
    if (!element) return
    element.scrollIntoView({ behavior: state.scrollTarget.behavior, block: 'start' })
    setState((previous) => ({ ...previous, scrollTarget: undefined }))
  }, [state.scrollTarget, state.range])

  useEffect(() => {
    const handleScroll = () => {
      const root = document.documentElement
      if (performance.now() < navigatingUntilRef.current) { scheduleViewState(); return }
      const nearBottom = root.scrollHeight - page.scrollY - page.innerHeight < 28
      atBottomRef.current = nearBottom && stateRef.current.range.end >= stateRef.current.messages.length
      if (page.scrollY < 72 && root.scrollHeight > page.innerHeight + 80) loadPrevious()
      else if (nearBottom && !atBottomRef.current) loadNext()
      scheduleViewState()
    }
    // Programmatic jump suppression must not swallow the user's next swipe.
    // At a window edge the wheel/touch may produce no further scroll event.
    const resumeUserScroll = (event: Event) => {
      if ((event.target as Element | null)?.closest?.('.chat-scroll-indicator')) return
      navigatingUntilRef.current = 0
      handleScroll()
    }
    page.addEventListener('scroll', handleScroll, { passive: true })
    page.addEventListener('wheel', resumeUserScroll, { passive: true })
    page.addEventListener('touchmove', resumeUserScroll, { passive: true })
    return () => {
      page.removeEventListener('scroll', handleScroll)
      page.removeEventListener('wheel', resumeUserScroll)
      page.removeEventListener('touchmove', resumeUserScroll)
    }
  }, [loadPrevious, loadNext, scheduleViewState])

  useEffect(() => { scheduleViewState() }, [state.range, scheduleViewState])

  // Outline identity stays stable during text deltas, matching desktop's memo.
  const tailId = state.messages.at(-1)?.id
  const compactIndices = useMemo(() => compactMessageIndices(state.messages),
    [state.messages.length, tailId, state.transcriptEpoch])
  const visibleStart = compactVisibleStart(compactIndices, state.expandLevel)
  const localOutline = useMemo(() => extractTurnOutline(state.messages).filter((entry) => entry.index >= visibleStart),
    [state.messages.length, tailId, state.session.sessionStatus, state.transcriptEpoch, visibleStart])
  const navigation = useMemo(() => state.navigation ? extendHistoryIndex(state.navigation, state.messages) : null,
    [state.navigation, state.messages.length, tailId, state.session.sessionStatus, state.transcriptEpoch])
  const outline = navigation?.entries ?? localOutline
  const hasCompact = compactIndices.length > 0
  const compactExpanded = state.expandLevel >= compactIndices.length
  const compactSplit = outline.filter((entry) => entry.index < (compactIndices.at(-1) ?? 0)).length
  const visible = state.messages.slice(Math.max(visibleStart, state.range.start), state.range.end)
  // Compact / turn-meta markers persist as assistant rows but render as
  // indicators, so the live turn is the last assistant message that is neither.
  const lastAssistantId = findLastAssistantMessageId(state.messages)
  const sessionStreaming = state.session.sessionStatus === 'streaming'
    || state.session.sessionStatus === 'background'
  return (
    <main
      className="chat-view-shell"
      data-mounted-turns={visible.length}
      data-has-outline={outline.length > 1 || hasCompact}
      data-window-start={state.range.start}
      data-window-end={state.range.end}
      data-connection={state.connection.state}
    >
      <div className="chat-view-edge-fade" data-edge="top" aria-hidden="true" />
      <div className="chat-view-edge-fade" data-edge="bottom" aria-hidden="true" />
      <ChatScrollIndicator entries={outline} range={navigation ? globalHistoryRange(state.messages, navigation, state.range) : state.range} hasCompact={hasCompact}
        compactMarkers={navigation?.compacts}
        compactExpanded={compactExpanded} compactSplit={compactSplit} onJump={jumpToMessage}
        onToggleCompact={() => setCompactExpansion(compactExpanded ? 0 : compactIndices.length)} />
      <NavigationFeedback loading={navigationLoading} error={!!navigationRetry} onRetry={() => navigationRetry?.()} />
      <div className="chat-view-top-sentinel" data-testid="top-sentinel">
        {(state.range.start > visibleStart || (state.navigation ? needsHistoryPage(state.messages, state.navigation, state.range, 'before') : visibleStart === 0 && state.hasMoreHistory)) && (
          <HistoryPageButton loading={historyLoading} error={historyError} onLoad={loadPrevious} />
        )}
      </div>
      <AsyncQuestionMessagesContext.Provider value={state.messages}>
      {visible.length === 0
        ? <p className="py-12 text-center text-sm text-muted-foreground">Waiting for session…</p>
        : visible.map((message) => {
          const row = transcriptRow(message, state.messages)
          if (row.kind === 'hidden') return null
          if (row.kind === 'compact') {
            const rank = compactIndices.length - 1 - compactIndices.indexOf(state.messages.findIndex((item) => item.id === message.id))
            const expanded = rank < state.expandLevel
            return <div key={message.id} data-turn-id={message.id}>
              <CompactIndicator {...row.marker} expanded={expanded}
                onToggle={() => setCompactExpansion(expanded ? rank : rank + 1)} />
            </div>
          }
          if (row.kind === 'turn-meta') {
            return (
              <div key={message.id} data-turn-id={message.id}>
                <TurnMetaIndicator meta={row.meta} />
              </div>
            )
          }
          return (
            <PortableMessage
              key={message.id}
              message={message}
              scheme={state.scheme}
              pendingPermission={state.pendingPermission ?? null}
              mentionArtwork={state.mentionArtwork}
              mcpIcons={state.mcpIcons}
              isLastAssistant={message.id === lastAssistantId}
              sessionStreaming={sessionStreaming}
              streamingTokens={state.session.streamingTokens}
              projectPath={state.session.projectPath}
              hideCopyActions={isRealtimeVoiceMessage(message)}
            />
          )
        })}
      </AsyncQuestionMessagesContext.Provider>
      {state.range.end < state.messages.length && <button type="button" onClick={loadNext}
        className="mx-auto flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
        <ChevronDown className="size-3" /> Load later
      </button>}
      {state.session.pendingTurn && <PendingTurnIndicator phase={state.session.pendingTurn} />}
      {state.session.isCompacting && <CompactingIndicator startedAt={state.session.compactingStartedAt} />}
      {state.session.compactError && <CompactErrorIndicator error={state.session.compactError} />}
      {state.session.isRecapping && <RecappingIndicator />}
      {state.session.apiRetry && <ApiRetryIndicator info={state.session.apiRetry} />}
    </main>
  )
}

export class ChatViewErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    postHost({
      type: 'error',
      fatal: true,
      message: `${error.message}\n${info.componentStack ?? ''}`.trim(),
    })
  }

  render() {
    if (this.state.error) {
      return <pre className="chat-view-fatal">{this.state.error.message}</pre>
    }
    return this.props.children
  }
}
