/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

interface FakeSessionState {
  messages: unknown[]
  isCompacting: boolean
  rateLimitInfo: null
  apiRetry: null
  pendingPlanApproval: null
  _activeSessionId: string | null
  session: unknown
  _worktreeRemoved: boolean
  status: string
  lastAssistantMessageId: string | null
  queuedMessages: unknown[]
  _historyHydrated: boolean
  awaitingAssistantReply: boolean
}

const hoisted = vi.hoisted(() => {
  const sessionState: FakeSessionState = {
    messages: [],
    isCompacting: false,
    rateLimitInfo: null,
    apiRetry: null,
    pendingPlanApproval: null,
    _activeSessionId: 'sid-1',
    session: { sessionId: 'sid-1' },
    _worktreeRemoved: false,
    status: 'idle',
    lastAssistantMessageId: null,
    queuedMessages: [],
    _historyHydrated: true,
    awaitingAssistantReply: false,
  }
  const scope: { value: { projectPath: string; sessionId: string } | null } = { value: null }
  // Counts distinct scroll-area DOM nodes ever mounted. A key change forces React
  // to unmount the old node and mount a new one, so a fresh node = a remount.
  const seenScrollNodes = new WeakSet<object>()
  const scrollMounts = { count: 0 }
  const onScrollMount = (el: HTMLElement | null): void => {
    if (el && !seenScrollNodes.has(el)) {
      seenScrollNodes.add(el)
      scrollMounts.count++
    }
  }
  return { sessionState, isRemoteLocked: { value: false }, scope, scrollMounts, onScrollMount }
})

vi.mock('@/stores/chat', () => ({
  useChatStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({
      editQueuedMessage: vi.fn(),
      deleteQueuedMessage: vi.fn(),
      disconnectRemoteSession: vi.fn(),
    }),
    { getState: () => ({}) },
  ),
  useActiveSession: (selector: (s: FakeSessionState) => unknown) => selector(hoisted.sessionState),
  useIsRemoteLocked: () => hoisted.isRemoteLocked.value,
  useSessionScope: () => hoisted.scope.value,
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(fn: T) => fn,
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy({}, {
    get: () => ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  }),
}))

vi.mock('@superone/ui/components/ui/scroll-area', () => ({
  ScrollArea: ({ children, viewportRef }: { children: React.ReactNode; viewportRef?: React.RefObject<HTMLDivElement | null> }) => (
    <div
      data-testid="scroll-area"
      ref={(el) => { hoisted.onScrollMount(el); if (viewportRef) viewportRef.current = el }}
    >
      {children}
    </div>
  ),
}))

vi.mock('./ChatInput', () => ({ ChatInput: () => <div data-testid="chat-input" /> }))
vi.mock('./ChatStatusBar', () => ({ ChatStatusBar: () => <div data-testid="chat-status-bar" /> }))
vi.mock('./ChatMessage', () => ({
  ChatMessage: () => <div data-testid="chat-message" />,
  CompactingIndicator: () => <div data-testid="compacting" />,
  CompactIndicator: () => <div data-testid="compact" />,
  RateLimitIndicator: () => <div data-testid="rate-limit" />,
  ApiRetryIndicator: () => <div data-testid="api-retry" />,
  ModelFallbackIndicator: () => <div data-testid="model-fallback" />,
  parseCompactMarker: () => null,
}))
vi.mock('./ChatSuggestions', () => ({ ChatSuggestions: () => <div data-testid="chat-suggestions" /> }))
vi.mock('./PermissionPrompt', () => ({ PermissionPrompt: () => <div data-testid="permission-prompt" /> }))
vi.mock('./AskUserQuestionPrompt', () => ({ AskUserQuestionPrompt: () => <div data-testid="ask-user-question" /> }))
vi.mock('./TodoPopup', () => ({ TodoPopup: () => <div data-testid="todo-popup" /> }))
vi.mock('./PlanApprovalPrompt', () => ({ PlanApprovalPrompt: () => <div data-testid="plan-approval" /> }))
vi.mock('./CodexPlanFullscreenView', () => ({ CodexPlanFullscreenView: () => <div data-testid="codex-plan-fullscreen" /> }))
vi.mock('./codex-item-renderer', () => ({
  PlanFullscreenContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
}))

class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
class MockIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] { return [] }
}
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver

window.app = {
  ...(window.app ?? {}),
  onContentZoom: vi.fn(() => () => {}),
  trace: vi.fn(),
} as never

import { ChatContent } from './ChatContent'
import { createRef } from 'react'

function renderContent() {
  const ref = createRef<HTMLDivElement>()
  return render(<ChatContent scrollViewportRef={ref} />)
}

describe('ChatContent worktree-removed banner', () => {
  it('renders READ ONLY notice and hides ChatInput when _worktreeRemoved=true', () => {
    hoisted.sessionState._worktreeRemoved = true
    hoisted.sessionState.session = null
    hoisted.sessionState.messages = []
    hoisted.isRemoteLocked.value = false

    renderContent()

    expect(screen.getByText(/worktree has been removed/i)).toBeInTheDocument()
    expect(screen.getByText(/READ ONLY/i)).toBeInTheDocument()
    expect(screen.queryByTestId('chat-input')).toBeNull()
    expect(screen.queryByTestId('permission-prompt')).toBeNull()
    expect(screen.queryByTestId('ask-user-question')).toBeNull()
    expect(screen.queryByTestId('todo-popup')).toBeNull()
  })

  it('renders ChatInput (and no READ ONLY notice) when _worktreeRemoved=false', () => {
    hoisted.sessionState._worktreeRemoved = false
    hoisted.sessionState.session = { sessionId: 'sid-1' }
    hoisted.sessionState.messages = []
    hoisted.isRemoteLocked.value = false

    renderContent()

    expect(screen.queryByText(/worktree has been removed/i)).toBeNull()
    expect(screen.queryByText(/READ ONLY/i)).toBeNull()
    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
    expect(screen.getByTestId('permission-prompt')).toBeInTheDocument()
  })
})

describe('ChatContent empty-state gate is harness-agnostic', () => {
  function reset() {
    hoisted.sessionState._worktreeRemoved = false
    hoisted.sessionState.pendingPlanApproval = null
    hoisted.sessionState.status = 'idle'
    hoisted.sessionState.awaitingAssistantReply = false
    hoisted.isRemoteLocked.value = false
  }

  it('shows ChatSuggestions for a brand-new empty session even when session is null (codex/no session_init)', () => {
    reset()
    hoisted.sessionState.messages = []
    hoisted.sessionState.session = null
    hoisted.sessionState._historyHydrated = true

    renderContent()

    expect(screen.getByTestId('chat-suggestions')).toBeInTheDocument()
  })

  it('does NOT show ChatSuggestions while an un-hydrated stub is still loading (no flash)', () => {
    reset()
    hoisted.sessionState.messages = []
    hoisted.sessionState.session = null
    hoisted.sessionState._historyHydrated = false

    renderContent()

    expect(screen.queryByTestId('chat-suggestions')).toBeNull()
  })

  it('does NOT show ChatSuggestions for an empty session that is busy/awaiting reply', () => {
    reset()
    hoisted.sessionState.messages = []
    hoisted.sessionState.session = null
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.status = 'streaming'

    renderContent()

    expect(screen.queryByTestId('chat-suggestions')).toBeNull()
  })

  it('renders transcript (not suggestions) for a hydrated codex session with messages and null session', () => {
    reset()
    hoisted.sessionState.messages = [{ id: 'm1' }]
    hoisted.sessionState.session = null
    hoisted.sessionState._historyHydrated = true

    renderContent()

    expect(screen.queryByTestId('chat-suggestions')).toBeNull()
    expect(screen.getByTestId('chat-message')).toBeInTheDocument()
  })
})

describe('ChatContent scroll-area key follows the pane-displayed session (mosaic focus flash)', () => {
  function baseState() {
    hoisted.sessionState._worktreeRemoved = false
    hoisted.sessionState.pendingPlanApproval = null
    hoisted.sessionState.status = 'idle'
    hoisted.sessionState.awaitingAssistantReply = false
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.messages = [{ id: 'm1' }]
    hoisted.sessionState.session = { sessionId: 'sid-1' }
    hoisted.isRemoteLocked.value = false
    hoisted.scrollMounts.count = 0
  }

  it('does NOT remount the scroll area when the project active session changes while the pane is scoped to a fixed session', () => {
    baseState()
    // Mosaic pane: content is pinned to sid-1 via scope, regardless of which session is project-active.
    hoisted.scope.value = { projectPath: '/p', sessionId: 'sid-1' }
    hoisted.sessionState._activeSessionId = 'sid-1'
    let projectActiveSessionId = 'sid-1'
    const readProjectActiveSessionId = vi.fn(() => projectActiveSessionId)
    Object.defineProperty(hoisted.sessionState, '_activeSessionId', {
      configurable: true,
      get: readProjectActiveSessionId,
      set: (value: string | null) => { projectActiveSessionId = value ?? '' },
    })

    try {
      const ref = createRef<HTMLDivElement>()
      const { rerender } = render(<ChatContent scrollViewportRef={ref} />)
      const mountsAfterFirst = hoisted.scrollMounts.count
      expect(mountsAfterFirst).toBe(1)

      // Focusing another pane flips the project-level _activeSessionId — this pane must stay put.
      hoisted.sessionState._activeSessionId = 'sid-2'
      rerender(<ChatContent scrollViewportRef={ref} />)

      expect(hoisted.scrollMounts.count).toBe(mountsAfterFirst)
      expect(readProjectActiveSessionId).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(hoisted.sessionState, '_activeSessionId', {
        configurable: true,
        writable: true,
        value: projectActiveSessionId,
      })
    }
  })

  it('DOES remount the scroll area when the displayed session changes in unscoped (single) mode', () => {
    baseState()
    hoisted.scope.value = null
    hoisted.sessionState._activeSessionId = 'sid-1'

    const ref = createRef<HTMLDivElement>()
    const { rerender } = render(<ChatContent scrollViewportRef={ref} />)
    const mountsAfterFirst = hoisted.scrollMounts.count
    expect(mountsAfterFirst).toBe(1)

    hoisted.sessionState._activeSessionId = 'sid-2'
    rerender(<ChatContent scrollViewportRef={ref} />)

    expect(hoisted.scrollMounts.count).toBe(mountsAfterFirst + 1)
  })
})

describe('ChatContent foreground visibility', () => {
  it('holds a foreground reference only while visible', () => {
    hoisted.scope.value = null
    hoisted.sessionState._activeSessionId = 'sid-1'
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.messages = []
    const setSessionForeground = vi.fn().mockResolvedValue(undefined)
    window.agent = { ...window.agent, setSessionForeground } as never

    const ref = createRef<HTMLDivElement>()
    const { rerender, unmount } = render(<ChatContent scrollViewportRef={ref} foreground />)
    rerender(<ChatContent scrollViewportRef={ref} foreground={false} />)
    unmount()

    expect(setSessionForeground).toHaveBeenCalledTimes(2)
    expect(setSessionForeground).toHaveBeenNthCalledWith(1, 'sid-1', true)
    expect(setSessionForeground).toHaveBeenNthCalledWith(2, 'sid-1', false)
  })
})
