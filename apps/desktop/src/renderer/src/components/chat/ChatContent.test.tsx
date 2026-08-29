/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface FakeSessionState {
  messages: unknown[]
  isCompacting: boolean
  isRecapping: boolean
  rateLimitInfo: null
  apiRetry: null
  pendingPlanApproval: null
  _activeSessionId: string | null
  _providerSessionId: string | null
  session: unknown
  _worktreeRemoved: boolean
  status: string
  lastAssistantMessageId: string | null
  queuedMessages: unknown[]
  acpModels: unknown[]
  _historyHydrated: boolean
  awaitingAssistantReply: boolean
  draftId: string | null
  sessionProvider: string | null
  preferredProvider: string
  acpAgentId: string | null
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
    _providerSessionId: null,
    session: { sessionId: 'sid-1' },
    _worktreeRemoved: false,
    status: 'idle',
    lastAssistantMessageId: null,
    queuedMessages: [],
    acpModels: [],
    _historyHydrated: true,
    awaitingAssistantReply: false,
    draftId: null,
    sessionProvider: 'claude',
    preferredProvider: 'claude',
    acpAgentId: null,
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
  return {
    sessionState,
    isRemoteLocked: { value: false },
    scope,
    scrollMounts,
    contentZoom,
    onScrollMount,
    steerQueuedMessage: vi.fn(),
    startQueuedMessages: vi.fn(),
  }
})

vi.mock('@/stores/chat', () => ({
  useChatStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({
      editQueuedMessage: vi.fn(),
      deleteQueuedMessage: vi.fn(),
      steerQueuedMessage: hoisted.steerQueuedMessage,
      startQueuedMessages: hoisted.startQueuedMessages,
      disconnectRemoteSession: vi.fn(),
      // Read by selectClaudeModels for model-fallback display names.
      activeProject: '/tmp/project',
      projectSessions: {},
      harnessResources: {},
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

vi.mock('@superone/ui/components/ui/icon-button', () => ({
  IconButton: ({ children, tooltip, size: _size, variant: _variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tooltip?: string; size?: string; variant?: string }) => (
    <button type="button" aria-label={tooltip} {...props}>{children}</button>
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
vi.mock('./DraftSessionSurface', () => ({ DraftSessionSurface: () => <div data-testid="draft-session-surface" /> }))
vi.mock('./PermissionPrompt', () => ({ PermissionPrompt: () => <div data-testid="permission-prompt" /> }))
vi.mock('./AskUserQuestionPrompt', () => ({ AskUserQuestionPrompt: () => <div data-testid="ask-user-question" /> }))
vi.mock('./CursorApiKeyDialog', () => ({ CursorApiKeyDialog: () => <div data-testid="cursor-api-key-dialog" /> }))
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

// Assign onto the shared stub rather than replacing it — the setup-file proxy
// answers every other `window.app` call this tree makes, and a spread would
// drop all of them.
Object.assign(window.app, {
  onContentZoom: vi.fn((callback) => {
    hoisted.contentZoom.callback = callback
    return () => {
      if (hoisted.contentZoom.callback === callback) hoisted.contentZoom.callback = null
    }
  }),
  trace: vi.fn(),
})

import { ChatContent } from './ChatContent'
import { useAppStore } from '@/stores/app'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { createRef } from 'react'

function renderContent() {
  const ref = createRef<HTMLDivElement>()
  return render(<ChatContent scrollViewportRef={ref} />)
}

afterEach(() => {
  useCodexRealtimeViewStore.setState({ sessions: {} })
  hoisted.sessionState.queuedMessages = []
  hoisted.sessionState.sessionProvider = 'claude'
  hoisted.sessionState.preferredProvider = 'claude'
  hoisted.sessionState._providerSessionId = null
  hoisted.sessionState.status = 'idle'
})

// Disabling a harness keeps its binary on disk, so sessions on it stay openable.
// They must be read-only until the user re-enables it — same shape as the
// worktree-removed banner, since the composer is the thing being withdrawn.
describe('ChatContent harness-disabled banner', () => {
  it('names the disabled harness and deep-links Re-enable to its settings row', () => {
    hoisted.sessionState._worktreeRemoved = false
    hoisted.sessionState.session = { sessionId: 'sid-1' }
    hoisted.sessionState.sessionProvider = 'claude'
    hoisted.isRemoteLocked.value = false
    useAppStore.setState({
      view: 'main',
      harnessCatalog: [{ id: 'claude', enabled: false, state: 'disabled' }],
      harnessListFocusKey: null,
    })

    renderContent()

    expect(screen.getByText(/is disabled/i)).toBeInTheDocument()
    expect(screen.getByText(/READ ONLY/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Re-enable Claude Code/i })).toBeInTheDocument()
    expect(screen.queryByTestId('chat-input')).toBeNull()

    screen.getByRole('button', { name: /Re-enable Claude Code/i }).click()

    const app = useAppStore.getState()
    expect(app.view).toBe('settings')
    expect(app.settingsTab).toBe('harnesses')
    expect(app.harnessListFocusKey).toBe('claude')
    expect(app.settingsProvider).toBe('claude')
  })

  it('keeps the composer when the session harness is still enabled', () => {
    hoisted.sessionState._worktreeRemoved = false
    hoisted.sessionState.session = { sessionId: 'sid-1' }
    hoisted.sessionState.sessionProvider = 'claude'
    hoisted.isRemoteLocked.value = false
    useAppStore.setState({ harnessCatalog: [{ id: 'claude', enabled: true, state: 'ready' }] })

    renderContent()

    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
  })

  // Catalog arrives over IPC after first paint. Treating "unknown" as disabled
  // would flash a read-only banner on every launch.
  it('keeps the composer while the catalog is still unknown', () => {
    hoisted.sessionState._worktreeRemoved = false
    hoisted.sessionState.session = { sessionId: 'sid-1' }
    hoisted.sessionState.sessionProvider = 'claude'
    hoisted.isRemoteLocked.value = false
    useAppStore.setState({ harnessCatalog: null })

    renderContent()

    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
  })
})

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
    hoisted.sessionState.draftId = null
    hoisted.isRemoteLocked.value = false
  }

  it('shows ChatSuggestions for a brand-new empty session even when session is null (codex/no session_init)', () => {
    reset()
    hoisted.sessionState.messages = []
    hoisted.sessionState.session = null
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.draftId = null

    renderContent()

    expect(screen.getByTestId('chat-suggestions')).toBeInTheDocument()
  })

  it('shows the draft surface instead of ChatSuggestions for a restored draft', () => {
    reset()
    hoisted.sessionState.messages = []
    hoisted.sessionState.session = null
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.draftId = 'draft-1'

    renderContent()

    expect(screen.queryByTestId('chat-suggestions')).toBeNull()
    expect(screen.getByTestId('draft-session-surface')).toBeInTheDocument()
  })

  it('does not apply the default harness to a Codex thread with only realtime history', () => {
    reset()
    hoisted.sessionState.messages = []
    hoisted.sessionState.session = { sessionId: 'sid-1' }
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.sessionProvider = 'codex'
    hoisted.sessionState.preferredProvider = 'codex'
    useCodexRealtimeViewStore.getState().setTimeline('sid-1', {
      segments: [],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    })

    renderContent()

    expect(screen.queryByTestId('chat-suggestions')).toBeNull()
    expect(screen.getByTestId('draft-session-surface')).toBeInTheDocument()
  })

  it('renders canonical Codex turns behind a voice-only session', async () => {
    reset()
    hoisted.sessionState.messages = []
    hoisted.sessionState.session = { sessionId: 'sid-1' }
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.sessionProvider = 'codex'
    hoisted.sessionState.preferredProvider = 'codex'
    const timeline = {
      segments: [],
      threadMessages: [{
        id: 'codex-timeline-turn-1',
        role: 'assistant' as const,
        status: 'complete' as const,
        content: [{ type: 'text' as const, text: 'Backing Codex response' }],
        createdAt: '',
        providerId: 'codex',
      }],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    }
    useCodexRealtimeViewStore.getState().setTimeline('sid-1', timeline)
    Object.assign(window.agent, { getRealtimeTimeline: vi.fn(async () => timeline) })

    renderContent()

    await waitFor(() => {
      expect(document.querySelector('[data-message-id="codex-timeline-turn-1"]')).not.toBeNull()
    })
    expect(screen.queryByTestId('chat-suggestions')).toBeNull()
  })

  it('discovers and renders voice-only history after a cold restore', async () => {
    reset()
    hoisted.sessionState.messages = []
    hoisted.sessionState.session = null
    hoisted.sessionState._providerSessionId = 'thread-realtime'
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.sessionProvider = 'codex'
    hoisted.sessionState.preferredProvider = 'codex'
    const timeline = {
      segments: [],
      threadMessages: [{
        id: 'codex-timeline-turn-cold',
        role: 'assistant' as const,
        status: 'complete' as const,
        content: [{ type: 'text' as const, text: 'Restored response' }],
        createdAt: '',
        providerId: 'codex',
      }],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    }
    const getRealtimeTimeline = vi.fn(async () => timeline)
    Object.assign(window.agent, {
      loadRealtimeTimeline: vi.fn(async () => null),
      getRealtimeTimeline,
    })

    renderContent()

    await waitFor(() => {
      expect(document.querySelector('[data-message-id="codex-timeline-turn-cold"]')).not.toBeNull()
    })
    expect(getRealtimeTimeline).toHaveBeenCalledWith('/tmp/project', 'sid-1')
    expect(screen.queryByTestId('chat-suggestions')).toBeNull()
  })

  it('shows a loading state instead of ChatSuggestions while voice history is hydrating', async () => {
    reset()
    hoisted.sessionState.messages = []
    hoisted.sessionState.session = null
    hoisted.sessionState._providerSessionId = 'thread-realtime'
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.sessionProvider = 'codex'
    hoisted.sessionState.preferredProvider = 'codex'
    let resolveTimeline!: (timeline: {
      segments: never[]
      threadMessages: never[]
      activeRealtimeSessionId: null
      hasTimeline: boolean
    }) => void
    const remote = new Promise<{
      segments: never[]
      threadMessages: never[]
      activeRealtimeSessionId: null
      hasTimeline: boolean
    }>((resolve) => { resolveTimeline = resolve })
    Object.assign(window.agent, {
      loadRealtimeTimeline: vi.fn(async () => null),
      getRealtimeTimeline: vi.fn(() => remote),
    })

    renderContent()

    expect(screen.queryByTestId('chat-suggestions')).toBeNull()
    resolveTimeline({ segments: [], threadMessages: [], activeRealtimeSessionId: null, hasTimeline: false })
    await waitFor(() => expect(screen.getByTestId('chat-suggestions')).toBeInTheDocument())
  })

  it('returns a new Codex session to Start Listening when no voice timeline exists', async () => {
    reset()
    hoisted.sessionState.messages = []
    hoisted.sessionState.session = null
    hoisted.sessionState._providerSessionId = 'thread-new'
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.sessionProvider = 'codex'
    hoisted.sessionState.preferredProvider = 'codex'
    Object.assign(window.agent, {
      loadRealtimeTimeline: vi.fn(async () => null),
      getRealtimeTimeline: vi.fn(async () => { throw new Error('timeline not found') }),
    })

    renderContent()

    await waitFor(() => expect(screen.getByTestId('chat-suggestions')).toBeInTheDocument())
    expect(screen.queryByText('chat.realtimeVoice.timelineLoadFailed')).toBeNull()
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

describe('ChatContent Codex durable queue', () => {
  it('offers steer for every queued message while a local Codex turn is active', () => {
    hoisted.steerQueuedMessage.mockClear()
    hoisted.sessionState.messages = [{ id: 'm1' }]
    hoisted.sessionState.queuedMessages = [
      { id: 'u2', role: 'user', status: 'complete', content: [{ type: 'text', text: 'first' }], createdAt: '', providerId: 'codex' },
      { id: 'u3', role: 'user', status: 'complete', content: [{ type: 'text', text: 'second' }], createdAt: '', providerId: 'codex' },
    ]
    hoisted.sessionState.sessionProvider = 'codex'
    hoisted.sessionState.preferredProvider = 'codex'
    hoisted.sessionState.status = 'streaming'

    renderContent()
    const steerButtons = screen.getAllByRole('button', { name: 'Steer Now' })
    expect(steerButtons).toHaveLength(2)
    fireEvent.click(steerButtons[1]!)

    expect(hoisted.steerQueuedMessage).toHaveBeenCalledWith('u3', undefined)
  })

  it('offers manual resume after an interrupted queued turn', () => {
    hoisted.startQueuedMessages.mockClear()
    hoisted.sessionState.messages = [{ id: 'm1' }]
    hoisted.sessionState.queuedMessages = [{
      id: 'u2', role: 'user', status: 'complete', content: [{ type: 'text', text: 'queued' }], createdAt: '', providerId: 'codex',
    }]
    hoisted.sessionState.sessionProvider = 'codex'
    hoisted.sessionState.preferredProvider = 'codex'
    hoisted.sessionState.status = 'idle'

    renderContent()
    fireEvent.click(screen.getByRole('button', { name: 'Start Queued Messages' }))

    expect(hoisted.startQueuedMessages).toHaveBeenCalledWith(undefined)
    expect(screen.queryByRole('button', { name: 'Steer Now' })).toBeNull()
  })
})

describe('ChatContent Claude host queue', () => {
  it('offers steer for a queued message while a local Claude turn is active', () => {
    hoisted.steerQueuedMessage.mockClear()
    hoisted.sessionState.messages = [{ id: 'm1' }]
    hoisted.sessionState.queuedMessages = [{
      id: 'u2', role: 'user', status: 'complete', content: [{ type: 'text', text: 'steer this' }], createdAt: '', providerId: 'claude',
    }]
    hoisted.sessionState.sessionProvider = 'claude'
    hoisted.sessionState.preferredProvider = 'claude'
    hoisted.sessionState.status = 'streaming'

    renderContent()
    fireEvent.click(screen.getByRole('button', { name: 'Steer Now' }))

    expect(hoisted.steerQueuedMessage).toHaveBeenCalledWith('u2', undefined)
    expect(screen.queryByRole('button', { name: 'Start Queued Messages' })).toBeNull()
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
