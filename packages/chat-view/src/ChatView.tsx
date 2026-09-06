import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import type { ChatMessage, Locale, TodoItem } from '@superone/shared/agent-types'
import { ChevronUp, ListChecks, WifiOff } from 'lucide-react'
import { CHAT_WINDOW, initialChatWindow, loadPreviousChatWindow, normalizeChatWindow, type ChatWindowRange } from './chat-window'
import { installHostBridge, postHost } from './bridge'
import { setChatViewLocale } from './i18n'
import { PortableMessage } from './PortableMessage'
import type { HostInbound, ReductionProjection } from './protocol'

type PendingPermission = ReductionProjection['pendingPermission']

interface ViewState {
  messages: ChatMessage[]
  todos: TodoItem[]
  labels: Record<string, string>
  mentionArtwork: Record<string, string>
  pendingPermission: PendingPermission
  range: ChatWindowRange
  scheme: 'light' | 'dark'
  hue: number
  locale: Locale
  connection: { state: string; epoch: number }
  scrollTarget?: { id: string; behavior: ScrollBehavior }
}

const EMPTY_STATE: ViewState = {
  messages: [],
  todos: [],
  labels: {},
  mentionArtwork: {},
  pendingPermission: null,
  range: { start: 0, end: 0 },
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
  if (atBottom) return initialChatWindow(messages.length)
  const mounted = previous.range.end - previous.range.start
  const anchorId = previous.messages[previous.range.start]?.id
  const anchorIndex = anchorId ? messages.findIndex((message) => message.id === anchorId) : -1
  const start = anchorIndex >= 0 ? anchorIndex : previous.range.start
  return normalizeChatWindow({ start, end: start + mounted }, messages.length)
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
  const stateRef = useRef(state)
  const atBottomRef = useRef(true)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prependSnapshotRef = useRef<{ height: number; top: number } | null>(null)
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

  const loadPrevious = useCallback(() => {
    if (loadingPreviousRef.current) return
    const current = stateRef.current
    if (current.range.start <= 0) return
    loadingPreviousRef.current = true
    prependSnapshotRef.current = {
      height: document.documentElement.scrollHeight,
      top: page.scrollY,
    }
    setState((previous) => ({
      ...previous,
      range: loadPreviousChatWindow(previous.range, previous.messages.length),
    }))
  }, [])

  const handleInbound = useCallback((message: HostInbound) => {
    switch (message.type) {
      case 'initialize':
      case 'hydrate':
        scrollToBottomRef.current = true
        atBottomRef.current = true
        setState((previous) => {
          const next = applyProjection(previous, message, true)
          return { ...next, range: initialChatWindow(next.messages.length) }
        })
        return
      case 'applyReductionPatch':
        if (atBottomRef.current && message.messages) scrollToBottomRef.current = true
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
        atBottomRef.current = true
        setState(EMPTY_STATE)
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
        setState((previous) => ({
          ...previous,
          range: normalizeChatWindow(message.range, previous.messages.length),
          scrollTarget: message.anchorId
            ? { id: message.anchorId, behavior: 'auto' }
            : previous.scrollTarget,
        }))
        return
      case 'scrollToTurn':
        setState((previous) => {
          const index = previous.messages.findIndex((item) => item.id === message.turnId)
          if (index < 0) return previous
          const end = Math.min(previous.messages.length, Math.max(index + 1, index + CHAT_WINDOW.initialTurns - 4))
          return {
            ...previous,
            range: normalizeChatWindow({ start: Math.max(0, end - CHAT_WINDOW.initialTurns), end }, previous.messages.length),
            scrollTarget: { id: message.turnId, behavior: message.behavior ?? 'smooth' },
          }
        })
        return
      case 'nativeActionProgress':
      case 'nativeActionResult':
        return
    }
  }, [])

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
      const delta = document.documentElement.scrollHeight - snapshot.height
      page.scrollTo({ top: snapshot.top + delta, behavior: 'auto' })
      prependSnapshotRef.current = null
      setTimeout(() => { loadingPreviousRef.current = false }, 60)
      scheduleViewState()
      return
    }
    if (scrollToBottomRef.current) {
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
      atBottomRef.current = root.scrollHeight - page.scrollY - page.innerHeight < 28
      if (page.scrollY < 72 && root.scrollHeight > page.innerHeight + 80) loadPrevious()
      scheduleViewState()
    }
    page.addEventListener('scroll', handleScroll, { passive: true })
    return () => page.removeEventListener('scroll', handleScroll)
  }, [loadPrevious, scheduleViewState])

  useEffect(() => { scheduleViewState() }, [state.range, scheduleViewState])

  const visible = state.messages.slice(state.range.start, state.range.end)
  const lastAssistantId = state.messages.findLast((message) => message.role === 'assistant')?.id
  return (
    <main
      className="chat-view-shell"
      data-mounted-turns={visible.length}
      data-window-start={state.range.start}
      data-window-end={state.range.end}
    >
      {state.connection.state !== 'connected' && (
        <div className="sticky top-2 z-20 mb-2 flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          <WifiOff className="size-3.5" /> {state.labels.disconnected ?? state.connection.state}
        </div>
      )}
      <Todos todos={state.todos} />
      <div className="chat-view-top-sentinel" data-testid="top-sentinel">
        {state.range.start > 0 && (
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
        : visible.map((message) => (
          <PortableMessage
            key={message.id}
            message={message}
            scheme={state.scheme}
            pendingPermission={state.pendingPermission ?? null}
            mentionArtwork={state.mentionArtwork}
            isLastAssistant={message.id === lastAssistantId}
          />
        ))}
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
