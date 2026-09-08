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
import type { AgentStatus, ChatMessage, Locale, TodoItem } from '@superone/shared/agent-types'
import { ChevronDown, ChevronUp, ListChecks, WifiOff } from 'lucide-react'
import {
  ApiRetryIndicator,
  CompactErrorIndicator,
  CompactIndicator,
  CompactingIndicator,
  findLastAssistantMessageId,
  RecappingIndicator,
  TurnMetaIndicator,
} from './presenters/ChatMessageIndicators'
import { transcriptRow } from './transcript-rows'
import { ZERO_TURN_TOKENS } from './presenters/turn-footer-model'
import { CHAT_WINDOW, initialChatWindow, loadPreviousChatWindow, loadNextChatWindow, normalizeChatWindow, type ChatWindowRange } from './chat-window'
import { installHostBridge, postHost } from './bridge'
import { setChatViewLocale } from './i18n'
import { PortableMessage } from './PortableMessage'
import { isRealtimeVoiceMessage } from '@superone/shared/realtime-transcript'
import { extractTurnOutline } from '@superone/shared/turn-outline'
import { ChatScrollIndicator } from './ChatScrollIndicator'
import { captureScrollAnchor, compactMessageIndices, compactVisibleStart, jumpChatWindow, visibleChatWindow, type ScrollAnchor } from './chat-navigation'
import { useSimulatedStream } from './use-simulated-stream'
import type { HostInbound, ReductionProjection, SessionProjection } from './protocol'

type PendingPermission = ReductionProjection['pendingPermission']

interface ViewState {
  messages: ChatMessage[]
  todos: TodoItem[]
  labels: Record<string, string>
  mentionArtwork: Record<string, string>
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
  todos: [],
  labels: {},
  mentionArtwork: {},
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

function normalizeTodos(value: ReductionProjection['todos'], fallback: TodoItem[]): TodoItem[] {
  if (!value) return fallback
  return Array.isArray(value) ? value : Object.values(value)
}

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
  return visibleChatWindow({ start, end: start + mounted }, messages.length, minimum)
}

function applyProjection(
  previous: ViewState,
  projection: ReductionProjection,
  atBottom: boolean,
): ViewState {
  const messages = projection.messages ?? previous.messages
  return {
    ...previous,
    messages,
    todos: normalizeTodos(projection.todos, previous.todos),
    labels: projection.labels ?? previous.labels,
    mentionArtwork: normalizeMentionArtwork(projection.mentionArtwork, previous.mentionArtwork),
    pendingPermission: projection.pendingPermission === undefined
      ? previous.pendingPermission
      : projection.pendingPermission,
    session: mergeSessionFacts(previous.session, projection),
    range: projection.messages
      ? rangeAfterPatch(previous, messages, atBottom)
      : previous.range,
  }
}

function Todos({ todos }: { todos: TodoItem[] }) {
  if (todos.length === 0) return null
  return (
    <section className="mb-3 rounded-lg border border-border/60 bg-muted/25 p-2 text-xs" data-testid="todo-list">
      <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
        <ListChecks className="size-3.5" /> Tasks
      </div>
      <ul className="space-y-1 text-muted-foreground">
        {todos.map((todo) => (
          <li key={todo.id} data-todo-status={todo.status}>
            {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '▶' : '○'} {todo.subject}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ChatView() {
  const [state, setState] = useState<ViewState>(EMPTY_STATE)
  const {
    messages: displayedMessages, revealingIds, revealingReasoningIds,
    reset: resetStream, update: updateStream, prepend: prependStream,
  } = useSimulatedStream()
  const stateRef = useRef(state)
  const atBottomRef = useRef(true)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prependSnapshotRef = useRef<ScrollAnchor | null>(null)
  const navigatingUntilRef = useRef(0)
  const loadingPreviousRef = useRef(false)
  const scrollToBottomRef = useRef(false)
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
      range: visibleChatWindow(
        (direction === 'previous' ? loadPreviousChatWindow : loadNextChatWindow)(previous.range, previous.messages.length),
        previous.messages.length, minimum,
      ),
    }))
  }, [])
  const loadPrevious = useCallback(() => changeWindow('previous'), [changeWindow])
  const loadNext = useCallback(() => changeWindow('next'), [changeWindow])

  const prepareNavigation = useCallback(() => {
    atBottomRef.current = false
    scrollToBottomRef.current = false
    prependSnapshotRef.current = null
    loadingPreviousRef.current = false
    navigatingUntilRef.current = performance.now() + 700
  }, [])

  const jumpToMessage = useCallback((id: string, behavior: ScrollBehavior = 'smooth') => {
    if (!stateRef.current.messages.some((message) => message.id === id)) return
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
          : jumpChatWindow(index, previous.messages.length, compactVisibleStart(compact, expandLevel)),
        // Replacing the DOM window invalidates the old scroll coordinates.
        // Animate only when both positions belong to the same mounted window.
        scrollTarget: { id, behavior: mounted ? behavior : 'auto' },
      }
    })
  }, [prepareNavigation])

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
      case 'initialize':
      case 'hydrate':
        prependSnapshotRef.current = null
        loadingPreviousRef.current = false
        navigatingUntilRef.current = 0
        if (message.messages) resetStream(message.messages)
        scrollToBottomRef.current = true
        atBottomRef.current = true
        setState((previous) => {
          const next = applyProjection(previous, message, true)
          return {
            ...next, expandLevel: 0, transcriptEpoch: previous.transcriptEpoch + 1, scrollTarget: undefined,
            range: visibleChatWindow(initialChatWindow(next.messages.length), next.messages.length,
              compactVisibleStart(compactMessageIndices(next.messages), 0)),
          }
        })
        return
      case 'applyReductionPatch':
        if (message.messages) updateStream(message.messages)
        if (atBottomRef.current && message.messages) scrollToBottomRef.current = true
        setState((previous) => applyProjection(previous, message, atBottomRef.current))
        return
      case 'prependHistory':
        if (!message.messages?.length) return
        prependStream(message.messages)
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
        resetStream()
        atBottomRef.current = true
        prependSnapshotRef.current = null
        scrollToBottomRef.current = false
        loadingPreviousRef.current = false
        navigatingUntilRef.current = 0
        setState((previous) => ({ ...EMPTY_STATE, transcriptEpoch: previous.transcriptEpoch + 1 }))
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
  }, [resetStream, updateStream, prependStream, prepareNavigation, jumpToMessage])

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
    const root = document.documentElement
    root.style.setProperty('--brand-hue', String(state.hue))
    root.classList.toggle('dark', state.scheme === 'dark')
    root.style.colorScheme = state.scheme
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
  }, [displayedMessages, state.range, scheduleViewState])

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
    page.addEventListener('scroll', handleScroll, { passive: true })
    return () => page.removeEventListener('scroll', handleScroll)
  }, [loadPrevious, loadNext, scheduleViewState])

  useEffect(() => { scheduleViewState() }, [state.range, scheduleViewState])

  // Outline identity stays stable during text deltas, matching desktop's memo.
  const tailId = state.messages.at(-1)?.id
  const compactIndices = useMemo(() => compactMessageIndices(state.messages),
    [state.messages.length, tailId, state.transcriptEpoch])
  const visibleStart = compactVisibleStart(compactIndices, state.expandLevel)
  const outline = useMemo(() => extractTurnOutline(state.messages).filter((entry) => entry.index >= visibleStart),
    [state.messages.length, tailId, state.session.sessionStatus, state.transcriptEpoch, visibleStart])
  const hasCompact = compactIndices.length > 0
  const compactExpanded = state.expandLevel >= compactIndices.length
  const compactSplit = outline.filter((entry) => entry.index < (compactIndices.at(-1) ?? 0)).length
  const visible = displayedMessages.slice(Math.max(visibleStart, state.range.start), state.range.end)
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
    >
      <ChatScrollIndicator entries={outline} range={state.range} hasCompact={hasCompact}
        compactExpanded={compactExpanded} compactSplit={compactSplit} onJump={jumpToMessage}
        onToggleCompact={() => setCompactExpansion(compactExpanded ? 0 : compactIndices.length)} />
      {state.connection.state !== 'connected' && (
        <div className="sticky top-2 z-20 mb-2 flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          <WifiOff className="size-3.5" /> {state.labels.disconnected ?? state.connection.state}
        </div>
      )}
      <Todos todos={state.todos} />
      <div className="chat-view-top-sentinel" data-testid="top-sentinel">
        {state.range.start > visibleStart && (
          <button
            type="button"
            className="mx-auto mb-2 flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
            onClick={loadPrevious}
          >
            <ChevronUp className="size-3" /> Load earlier
          </button>
        )}
      </div>
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
          if (row.kind === 'turn-meta') return <TurnMetaIndicator key={message.id} meta={row.meta} />
          return (
            <PortableMessage
              key={message.id}
              message={message}
              isRevealing={revealingIds.has(message.id)}
              isReasoningRevealing={revealingReasoningIds.has(message.id)}
              scheme={state.scheme}
              pendingPermission={state.pendingPermission ?? null}
              mentionArtwork={state.mentionArtwork}
              isLastAssistant={message.id === lastAssistantId}
              sessionStreaming={sessionStreaming}
              streamingTokens={state.session.streamingTokens}
              projectPath={state.session.projectPath}
              hideCopyActions={isRealtimeVoiceMessage(message)}
            />
          )
        })}
      {state.range.end < state.messages.length && <button type="button" onClick={loadNext}
        className="mx-auto flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
        <ChevronDown className="size-3" /> Load later
      </button>}
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
