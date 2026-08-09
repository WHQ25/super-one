/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

interface FakeSessionState {
  messages: unknown[]
  isCompacting: boolean
  isRecapping: boolean
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
    isRecapping: false,
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
  const contentZoom: { callback: ((action: 'in' | 'out' | 'reset') => void) | null } = { callback: null }
  const onScrollMount = (el: HTMLElement | null): void => {
    if (el && !seenScrollNodes.has(el)) {
      seenScrollNodes.add(el)
      scrollMounts.count++
    }
  }
  return { sessionState, isRemoteLocked: { value: false }, scope, scrollMounts, contentZoom, onScrollMount }
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
vi.mock('./ChatMessage', async () => {
  const { useWorkflowNavigation } = await import('./workflow-navigation-context')
  const { useSubagentNavigation } = await import('./subagent-navigation-context')
  const { useForkNavigation } = await import('./fork-navigation-context')
  return {
    ChatMessage: () => {
      const workflowNav = useWorkflowNavigation()
      const subagentNav = useSubagentNavigation()
      const forkNav = useForkNavigation()
      return (
        <div data-testid="chat-message">
          <button
            type="button"
            data-testid="open-workflow"
            onClick={() => workflowNav.open({ toolUseId: 'wf-1', name: 'demo-workflow' })}
          >
            open workflow
          </button>
          <button
            type="button"
            data-testid="open-subagent"
            onClick={() => subagentNav.open({ toolUseId: 'sa-1' })}
          >
            open subagent
          </button>
          <button
            type="button"
            data-testid="open-fork"
            onClick={() => forkNav.open({ collabId: 'c1', threadId: 't1' })}
          >
            open fork
          </button>
        </div>
      )
    },
    CompactingIndicator: () => <div data-testid="compacting" />,
    CompactIndicator: () => <div data-testid="compact" />,
    ApiRetryIndicator: () => <div data-testid="api-retry" />,
    ModelFallbackIndicator: () => <div data-testid="model-fallback" />,
    parseCompactMarker: () => null,
    parseTurnMetaMarker: () => null,
    TurnMetaIndicator: () => <div data-testid="turn-meta" />,
  }
})
vi.mock('./WorkflowFullView', () => ({
  WorkflowFullView: ({ view }: { view: { name: string } }) => (
    <div data-testid="workflow-full-view">{view.name}</div>
  ),
}))
vi.mock('./SubagentFullView', () => ({
  SubagentFullView: () => <div data-testid="subagent-full-view" />,
}))
vi.mock('./ForkedThreadView', () => ({
  ForkedThreadView: () => <div data-testid="forked-thread-view" />,
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
  onContentZoom: vi.fn((callback) => {
    hoisted.contentZoom.callback = callback
    return () => {
      if (hoisted.contentZoom.callback === callback) hoisted.contentZoom.callback = null
    }
  }),
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

describe('ChatContent closes full-screen overlays on session switch', () => {
  function prepareSession(id: string) {
    hoisted.scope.value = null
    hoisted.sessionState._activeSessionId = id
    hoisted.sessionState.session = { sessionId: id }
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.messages = [{ id: 'm1' }]
    hoisted.sessionState.pendingPlanApproval = null
    hoisted.sessionState._worktreeRemoved = false
    hoisted.isRemoteLocked.value = false
  }

  it('dismisses workflow full view when the displayed session changes', async () => {
    prepareSession('sid-1')

    const ref = createRef<HTMLDivElement>()
    const { rerender } = render(<ChatContent scrollViewportRef={ref} />)

    await act(async () => {
      screen.getByTestId('open-workflow').click()
    })
    // lazy() + Suspense — wait for the mocked WorkflowFullView to appear
    expect(await screen.findByTestId('workflow-full-view')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-message')).toBeNull()

    hoisted.sessionState._activeSessionId = 'sid-2'
    hoisted.sessionState.session = { sessionId: 'sid-2' }
    rerender(<ChatContent scrollViewportRef={ref} />)

    expect(screen.queryByTestId('workflow-full-view')).toBeNull()
    expect(screen.getByTestId('chat-message')).toBeInTheDocument()
  })

  it('dismisses subagent and fork full views when the displayed session changes', async () => {
    prepareSession('sid-1')
    const ref = createRef<HTMLDivElement>()
    const { rerender } = render(<ChatContent scrollViewportRef={ref} />)

    await act(async () => {
      screen.getByTestId('open-subagent').click()
    })
    expect(screen.getByTestId('subagent-full-view')).toBeInTheDocument()

    hoisted.sessionState._activeSessionId = 'sid-2'
    hoisted.sessionState.session = { sessionId: 'sid-2' }
    rerender(<ChatContent scrollViewportRef={ref} />)
    expect(screen.queryByTestId('subagent-full-view')).toBeNull()
    expect(screen.getByTestId('chat-message')).toBeInTheDocument()

    await act(async () => {
      screen.getByTestId('open-fork').click()
    })
    expect(screen.getByTestId('forked-thread-view')).toBeInTheDocument()

    hoisted.sessionState._activeSessionId = 'sid-3'
    hoisted.sessionState.session = { sessionId: 'sid-3' }
    rerender(<ChatContent scrollViewportRef={ref} />)
    expect(screen.queryByTestId('forked-thread-view')).toBeNull()
    expect(screen.getByTestId('chat-message')).toBeInTheDocument()
  })

  it('does not clear overlays when only the project-active session changes under mosaic scope', async () => {
    prepareSession('sid-1')
    hoisted.scope.value = { projectPath: '/p', sessionId: 'sid-1' }

    const ref = createRef<HTMLDivElement>()
    const { rerender } = render(<ChatContent scrollViewportRef={ref} />)

    await act(async () => {
      screen.getByTestId('open-workflow').click()
    })
    expect(await screen.findByTestId('workflow-full-view')).toBeInTheDocument()

    // Focusing another pane flips project-level active session; this pane stays on sid-1.
    hoisted.sessionState._activeSessionId = 'sid-2'
    rerender(<ChatContent scrollViewportRef={ref} />)

    expect(screen.getByTestId('workflow-full-view')).toBeInTheDocument()
  })

  it('allows reopening workflow after a session-switch dismiss', async () => {
    prepareSession('sid-1')
    const ref = createRef<HTMLDivElement>()
    const { rerender } = render(<ChatContent scrollViewportRef={ref} />)

    await act(async () => {
      screen.getByTestId('open-workflow').click()
    })
    expect(await screen.findByTestId('workflow-full-view')).toBeInTheDocument()

    hoisted.sessionState._activeSessionId = 'sid-2'
    hoisted.sessionState.session = { sessionId: 'sid-2' }
    rerender(<ChatContent scrollViewportRef={ref} />)
    expect(screen.queryByTestId('workflow-full-view')).toBeNull()

    await act(async () => {
      screen.getByTestId('open-workflow').click()
    })
    expect(await screen.findByTestId('workflow-full-view')).toBeInTheDocument()
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

describe('ChatContent transcript density', () => {
  it('uses native layout tokens for wide transcripts without CSS scaling', () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 600,
      top: 0,
      right: 800,
      bottom: 600,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    try {
      hoisted.scope.value = null
      hoisted.sessionState._activeSessionId = 'sid-1'
      hoisted.sessionState.messages = []

      const { container } = renderContent()
      const contentRoot = container.firstElementChild as HTMLElement

      expect(contentRoot.style.transform).toBe('')
      expect(contentRoot.style.zoom).toBe('')
      expect(contentRoot.style.getPropertyValue('--spacing')).toBe('0.2875rem')
      expect(contentRoot.style.getPropertyValue('--text-sm')).toBe('1.00625rem')
      expect(contentRoot.style.getPropertyValue('--container-3xl')).toBe('55.2rem')
    } finally {
      rectSpy.mockRestore()
    }
  })

  it('keeps content zoom shortcuts by adjusting native layout tokens', () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 600,
      top: 0,
      right: 800,
      bottom: 600,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    try {
      hoisted.scope.value = null
      hoisted.sessionState._activeSessionId = 'sid-1'
      hoisted.sessionState.messages = []

      const { container } = renderContent()
      const contentRoot = container.firstElementChild as HTMLElement
      const matchesSpy = vi.spyOn(contentRoot, 'matches').mockReturnValue(true)
      expect(contentRoot.style.getPropertyValue('--spacing')).toBe('0.2875rem')

      try {
        act(() => hoisted.contentZoom.callback?.('out'))
        expect(contentRoot.style.getPropertyValue('--spacing')).toBe('0.275rem')
        expect(contentRoot.style.transform).toBe('')
        expect(contentRoot.style.zoom).toBe('')

        act(() => hoisted.contentZoom.callback?.('reset'))
        expect(contentRoot.style.getPropertyValue('--spacing')).toBe('0.2875rem')
      } finally {
        matchesSpy.mockRestore()
      }
    } finally {
      rectSpy.mockRestore()
    }
  })
})
