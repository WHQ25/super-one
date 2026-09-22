/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface FakeSessionState {
  draftRemoteDeviceId?: string | null
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
    suggestionMounts: { count: 0 },
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
    ChatMessage: ({ message, hideUserActions, hideCopyActions, collapseEntireCodexTurn }: {
      message?: { content?: Array<{ type: string; text?: string }> }
      hideUserActions?: boolean
      hideCopyActions?: boolean
      collapseEntireCodexTurn?: boolean
    }) => {
      const workflowNav = useWorkflowNavigation()
      const subagentNav = useSubagentNavigation()
      const forkNav = useForkNavigation()
      return (
        <div
          data-testid="chat-message"
          data-hide-user-actions={String(!!hideUserActions)}
          data-hide-copy-actions={String(!!hideCopyActions)}
          data-collapse-entire-codex-turn={String(!!collapseEntireCodexTurn)}
        >
          {message?.content
            ?.filter((block) => block.type === 'text')
            .map((block, i) => <span key={i}>{block.text}</span>)}
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
    // Mirrors the real helper under these stubbed parsers: nothing here is a marker.
    findLastAssistantMessageId: (messages: Array<{ id: string; role: string }>) =>
      messages.findLast((m) => m.role === 'assistant')?.id,
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
vi.mock('./ChatSuggestions', async () => {
  const { useEffect } = await import('react')
  return {
    ChatSuggestions: ({ draft }: { draft?: boolean }) => {
      useEffect(() => { hoisted.suggestionMounts.count++ }, [])
      return <div data-testid="chat-suggestions" data-draft={String(!!draft)} />
    },
  }
})
vi.mock('./PermissionPrompt', () => ({ PermissionPrompt: () => <div data-testid="permission-prompt" /> }))
vi.mock('./RealtimeCallIndicator', () => ({ RealtimeCallIndicator: () => <div data-testid="realtime-call-indicator" /> }))
vi.mock('./AskUserQuestionPrompt', () => ({ AskUserQuestionPrompt: () => <div data-testid="ask-user-question" /> }))
vi.mock('./CursorApiKeyDialog', () => ({ CursorApiKeyDialog: () => <div data-testid="cursor-api-key-dialog" /> }))
vi.mock('./TodoPopup', () => ({ TodoPopup: () => <div data-testid="todo-popup" /> }))
vi.mock('./PlanApprovalPrompt', () => ({ PlanApprovalPrompt: () => <div data-testid="plan-approval" /> }))
vi.mock('./CodexPlanFullscreenView', () => ({ CodexPlanFullscreenView: () => <div data-testid="codex-plan-fullscreen" /> }))
vi.mock('./codex-item-renderer', () => ({
  PlanFullscreenContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
  usePlanFullscreen: () => ({ open: () => {} }),
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
import { resetCodexRealtimeHydrationForTests, useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { resetRealtimeCallForTests, useRealtimeCallStore } from '@/stores/realtime-call'
import { createRef } from 'react'

function renderContent() {
  const ref = createRef<HTMLDivElement>()
  return render(<ChatContent scrollViewportRef={ref} />)
}

afterEach(() => {
  hoisted.sessionState.draftRemoteDeviceId = null
  hoisted.isRemoteLocked.value = false
  useCodexRealtimeViewStore.setState({ sessions: {} })
  resetCodexRealtimeHydrationForTests()
  resetRealtimeCallForTests()
  hoisted.sessionState.queuedMessages = []
  hoisted.sessionState.sessionProvider = 'claude'
  hoisted.sessionState.preferredProvider = 'claude'
  hoisted.sessionState.acpAgentId = null
  hoisted.sessionState._providerSessionId = null
  hoisted.sessionState.status = 'idle'
})

it('keeps the remote draft composer below its observation notice and disconnect action', async () => {
  hoisted.sessionState._worktreeRemoved = false
  hoisted.sessionState.draftId = 'draft-remote'
  hoisted.sessionState.draftRemoteDeviceId = 'phone'
  hoisted.isRemoteLocked.value = true
  useAppStore.setState({ harnessCatalog: null })
  const disconnect = vi.fn(async () => {})
  window.environment.disconnectDraft = disconnect
  renderContent()
  const editor = screen.getByTestId('chat-input')
  const notice = screen.getByText('Remote draft active — observation mode.')
  expect(notice.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
  await waitFor(() => expect(disconnect).toHaveBeenCalledWith('local', 'draft-remote'))
  hoisted.sessionState.draftId = null
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

  it('stacks the voice composer as decision prompts, then indicator with hover-revealed controls', () => {
    hoisted.sessionState._worktreeRemoved = false
    hoisted.sessionState.session = { sessionId: 'sid-1' }
    hoisted.sessionState.messages = []
    hoisted.sessionState.sessionProvider = 'codex'
    hoisted.sessionState.preferredProvider = 'codex'
    hoisted.isRemoteLocked.value = false
    useCodexRealtimeViewStore.getState().setRealtimeSession('sid-1', 'rt-1')
    useRealtimeCallStore.setState({ sessionId: 'sid-1', state: 'active' })

    renderContent()

    const composer = screen.getByTestId('realtime-call-composer')
    const siblings = [...composer.parentElement!.children]
    expect(siblings.indexOf(screen.getByTestId('permission-prompt')))
      .toBeLessThan(siblings.indexOf(composer))
    // The indicator shares the composer's hover group with the controls.
    expect(composer.contains(screen.getByTestId('realtime-call-indicator'))).toBe(true)
    expect(screen.queryByTestId('chat-input')).toBeNull()
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

  it('renders ChatSuggestions in draft mode for a restored draft', () => {
    reset()
    hoisted.sessionState.messages = []
    hoisted.sessionState.session = null
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.draftId = 'draft-1'

    renderContent()

    expect(screen.getByTestId('chat-suggestions')).toHaveAttribute('data-draft', 'true')
  })

  // Draft autosave stamps `draftId` on the session ~250ms after the first
  // keystroke. That must flip the landing into draft mode in place — swapping
  // the component would replay its fade-in / icon entrance under the cursor.
  it('keeps ChatSuggestions mounted when autosave stamps a draftId on the session being typed in', () => {
    reset()
    hoisted.sessionState.messages = []
    hoisted.sessionState.session = null
    hoisted.sessionState._historyHydrated = true
    hoisted.suggestionMounts.count = 0

    const ref = createRef<HTMLDivElement>()
    const { rerender } = render(<ChatContent scrollViewportRef={ref} />)
    expect(screen.getByTestId('chat-suggestions')).toHaveAttribute('data-draft', 'false')
    expect(hoisted.suggestionMounts.count).toBe(1)

    hoisted.sessionState.draftId = 'draft-1'
    rerender(<ChatContent scrollViewportRef={ref} />)

    expect(screen.getByTestId('chat-suggestions')).toHaveAttribute('data-draft', 'true')
    expect(hoisted.suggestionMounts.count).toBe(1)
  })

  it('ignores timeline thread copies for a Codex session without voice history', () => {
    reset()
    hoisted.sessionState.messages = [{
      id: 'canonical-turn',
      role: 'assistant',
      status: 'complete',
      content: [{ type: 'text', text: 'Canonical response' }],
      createdAt: '',
      providerId: 'codex',
    }]
    hoisted.sessionState.session = { sessionId: 'sid-1' }
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.sessionProvider = 'codex'
    hoisted.sessionState.preferredProvider = 'codex'
    useCodexRealtimeViewStore.getState().setTimeline('sid-1', {
      segments: [],
      threadMessages: [{
        id: 'timeline-copy',
        role: 'assistant',
        status: 'complete',
        content: [{ type: 'text', text: 'Timeline copy' }],
        createdAt: '',
        providerId: 'codex',
      }],
      activeRealtimeSessionId: null,
      hasTimeline: false,
    })

    renderContent()

    expect(screen.getByText('Canonical response')).toBeInTheDocument()
    expect(screen.queryByText('Timeline copy')).toBeNull()
    expect(screen.getAllByTestId('chat-message')).toHaveLength(1)
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
    expect(screen.getByText('No voice transcript in this thread yet.')).toBeInTheDocument()
  })

  it('renders delegated Codex work as a status row in the voice view and as turns in the thread view', async () => {
    reset()
    hoisted.sessionState.messages = []
    hoisted.sessionState.session = { sessionId: 'sid-1' }
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.sessionProvider = 'codex'
    hoisted.sessionState.preferredProvider = 'codex'
    const timeline = {
      segments: [
        { id: 'voice-1', realtimeSessionId: 'rt-1', role: 'user' as const, text: 'Voice request', localOrder: 10 },
        { id: 'voice-2', realtimeSessionId: 'rt-1', role: 'assistant' as const, text: 'Voice response', localOrder: 15 },
      ],
      threadMessages: [
        {
          id: 'delegation-1',
          role: 'user' as const,
          status: 'complete' as const,
          content: [{ type: 'text' as const, text: '<realtime_delegation>Check the diff</realtime_delegation>' }],
          createdAt: '',
          providerId: 'codex',
          metadata: { codexTimeline: { provenance: 'realtime-delegated' as const, turnId: 'turn-1', localOrder: 19 } },
        },
        {
          id: 'codex-timeline-turn-1',
          role: 'assistant' as const,
          status: 'complete' as const,
          content: [{ type: 'text' as const, text: 'Backing Codex response' }],
          createdAt: '',
          providerId: 'codex',
          metadata: {
            codex: { threadId: 'thread-1', turnId: 'turn-1', usage: null, items: [] },
            codexTimeline: { provenance: 'realtime-delegated' as const, turnId: 'turn-1', localOrder: 20 },
          },
        },
      ],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    }
    useCodexRealtimeViewStore.getState().setTimeline('sid-1', timeline)
    Object.assign(window.agent, { getRealtimeTimeline: vi.fn(async () => timeline) })

    const { rerender } = renderContent()

    // Speech renders through the ordinary ChatMessage, read-only; the delegated
    // turn is a status row rather than the turn body itself.
    const speech = await screen.findByText('Voice request')
    expect(speech.closest('[data-testid="chat-message"]')).toHaveAttribute('data-hide-copy-actions', 'true')
    expect(screen.getByText('Voice response').closest('[data-testid="chat-message"]'))
      .toHaveAttribute('data-hide-copy-actions', 'true')
    const card = screen.getByTestId('realtime-delegation-row')
    expect(card).toHaveAttribute('data-activity-status', 'completed')
    expect(screen.queryByText('Backing Codex response')).toBeNull()
    expect(document.querySelector('[data-message-id="codex-timeline-turn-1"]')).toBeNull()
    expect(screen.queryByText('Check the diff')).toBeNull()
    expect(screen.queryByTestId('chat-suggestions')).toBeNull()

    // The thread view carries the delegation prompt and the turn, nothing spoken.
    act(() => { useCodexRealtimeViewStore.getState().setView('sid-1', 'thread') })
    rerender(<ChatContent scrollViewportRef={createRef<HTMLDivElement>()} />)
    expect(screen.queryByTestId('realtime-delegation-row')).toBeNull()
    expect(screen.queryByText('Voice request')).toBeNull()
    expect(document.querySelector('[data-message-id="delegation-1"]')).not.toBeNull()
    expect(document.querySelector('[data-message-id="codex-timeline-turn-1"]')).not.toBeNull()
  })

  it('keeps typed turns in the thread view only', async () => {
    reset()
    hoisted.sessionState.messages = []
    hoisted.sessionState.session = { sessionId: 'sid-1' }
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.sessionProvider = 'codex'
    hoisted.sessionState.preferredProvider = 'codex'
    const normal = (id: string, role: 'user' | 'assistant', text: string, position: number) => ({
      id,
      role,
      status: 'complete' as const,
      content: [{ type: 'text' as const, text }],
      createdAt: '',
      providerId: 'codex' as const,
      metadata: { codexTimeline: { provenance: 'codex' as const, position } },
    })
    const timeline = {
      segments: [
        { id: 'voice-user', realtimeSessionId: 'rt-1', role: 'user' as const, text: 'Spoken request', position: 10 },
        { id: 'voice-assistant', realtimeSessionId: 'rt-1', role: 'assistant' as const, text: 'Spoken reply', position: 15 },
      ],
      threadMessages: [
        normal('typed-before-user', 'user', 'Typed before voice', 1),
        normal('typed-before-assistant', 'assistant', 'Reply before voice', 2),
        normal('typed-after-user', 'user', 'Typed after voice', 30),
        normal('typed-after-assistant', 'assistant', 'Reply after voice', 31),
      ],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    }
    useCodexRealtimeViewStore.getState().setTimeline('sid-1', timeline)
    Object.assign(window.agent, { getRealtimeTimeline: vi.fn(async () => timeline) })

    const { rerender } = renderContent()

    await screen.findByText('Spoken request')
    const visibleIds = () => [...document.querySelectorAll('[data-message-id]')]
      .map((element) => element.getAttribute('data-message-id'))
    expect(visibleIds()).toEqual(['codex-realtime-voice-user', 'codex-realtime-voice-assistant'])

    act(() => { useCodexRealtimeViewStore.getState().setView('sid-1', 'thread') })
    rerender(<ChatContent scrollViewportRef={createRef<HTMLDivElement>()} />)
    expect(visibleIds()).toEqual([
      'typed-before-user', 'typed-before-assistant', 'typed-after-user', 'typed-after-assistant',
    ])
    expect(screen.getByText('Typed after voice').closest('[data-testid="chat-message"]'))
      .toHaveAttribute('data-hide-copy-actions', 'false')
    expect(screen.getByTestId('todo-popup')).toBeInTheDocument()
  })

  it('keeps existing typed history visible while voice is connecting', () => {
    reset()
    hoisted.sessionState.messages = []
    hoisted.sessionState.session = { sessionId: 'sid-1' }
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.sessionProvider = 'codex'
    hoisted.sessionState.preferredProvider = 'codex'
    useCodexRealtimeViewStore.getState().setTimeline('sid-1', {
      segments: [],
      threadMessages: [{
        id: 'typed-before',
        role: 'assistant',
        status: 'complete',
        content: [{ type: 'text', text: 'Existing typed history' }],
        createdAt: '',
        providerId: 'codex',
        metadata: { codexTimeline: { provenance: 'codex', position: 1 } },
      }],
      activeRealtimeSessionId: null,
      hasTimeline: false,
    })
    useCodexRealtimeViewStore.getState().setRealtimeStarting('sid-1', true)

    const { rerender } = renderContent()

    // Connecting opens the voice view (its mark lives in the composer); the typed
    // history is one toggle away.
    expect(screen.getByText('Connecting voice…')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-suggestions')).toBeNull()
    act(() => { useCodexRealtimeViewStore.getState().setView('sid-1', 'thread') })
    rerender(<ChatContent scrollViewportRef={createRef<HTMLDivElement>()} />)
    expect(screen.getByText('Existing typed history')).toBeInTheDocument()
  })

  it('shows the delegation prompt in the dev backing-thread view, hides it in the voice view', async () => {
    reset()
    hoisted.sessionState.messages = []
    hoisted.sessionState.session = { sessionId: 'sid-1' }
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.sessionProvider = 'codex'
    hoisted.sessionState.preferredProvider = 'codex'
    const prompt = '<realtime_delegation><input>Inspect the project</input></realtime_delegation>'
    const timeline = {
      segments: [{
        id: 'voice-1', realtimeSessionId: 'rt-1', role: 'user' as const,
        text: 'Voice request', localOrder: 10,
      }],
      threadMessages: [{
        id: 'delegation-1',
        role: 'user' as const,
        status: 'complete' as const,
        content: [{ type: 'text' as const, text: prompt }],
        createdAt: '',
        providerId: 'codex',
        metadata: { codexTimeline: { provenance: 'realtime-delegated' as const, turnId: 'turn-1', position: 2 } },
      }],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    }
    useCodexRealtimeViewStore.getState().setTimeline('sid-1', timeline)
    Object.assign(window.agent, { getRealtimeTimeline: vi.fn(async () => timeline) })

    const { rerender } = renderContent()
    expect(await screen.findByText('Voice request')).toBeInTheDocument()
    expect(screen.queryByText(prompt)).toBeNull()

    act(() => { useCodexRealtimeViewStore.getState().setView('sid-1', 'thread') })
    rerender(<ChatContent scrollViewportRef={createRef<HTMLDivElement>()} />)

    expect(screen.getByText(prompt)).toBeInTheDocument()
    expect(screen.queryByText('Voice request')).toBeNull()
  })

  it('routes the composer by call state, not by view', () => {
    reset()
    hoisted.sessionState.messages = []
    hoisted.sessionState.session = { sessionId: 'sid-1' }
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.sessionProvider = 'codex'
    hoisted.sessionState.preferredProvider = 'codex'
    useCodexRealtimeViewStore.getState().setRealtimeSession('sid-1', 'rt-1')
    useRealtimeCallStore.setState({ sessionId: 'sid-1', state: 'active' })

    const { rerender } = renderContent()
    const rerenderContent = () => rerender(<ChatContent scrollViewportRef={createRef<HTMLDivElement>()} />)

    // Voice view + live call: the voice composer replaces the editor.
    expect(screen.getByTestId('realtime-call-composer')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-input')).toBeNull()

    // Backing thread mid-call keeps the editor so typed input can steer the turn.
    act(() => { useCodexRealtimeViewStore.getState().setView('sid-1', 'thread') })
    rerenderContent()
    expect(screen.queryByTestId('realtime-call-composer')).toBeNull()
    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
    expect(screen.getByTestId('todo-popup')).toBeInTheDocument()

    // Voice view after the call ends: the ordinary composer (with its start-call
    // entry) is the way to start the next call.
    act(() => {
      useCodexRealtimeViewStore.getState().setView('sid-1', 'realtime')
      resetRealtimeCallForTests()
    })
    rerenderContent()
    expect(screen.queryByTestId('realtime-call-composer')).toBeNull()
    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
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
      segments: [{
        id: 'voice-cold', realtimeSessionId: 'rt-1', role: 'user' as const,
        text: 'Restored voice request', localOrder: 10,
      }],
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

    expect(await screen.findByText('Restored voice request')).toBeInTheDocument()
    // An ordinary (non-delegated) Codex turn is thread-view material only.
    expect(screen.queryByText('Restored response')).toBeNull()
    expect(getRealtimeTimeline).toHaveBeenCalledWith('/tmp/project', 'sid-1')
    expect(screen.queryByTestId('chat-suggestions')).toBeNull()
  })

  it('restores a stored voice timeline for a Codex session even before its thread id is known', async () => {
    reset()
    hoisted.sessionState.messages = []
    hoisted.sessionState.session = { sessionId: 'sid-1' }
    hoisted.sessionState._providerSessionId = null
    hoisted.sessionState._historyHydrated = true
    hoisted.sessionState.sessionProvider = 'codex'
    hoisted.sessionState.preferredProvider = 'codex'
    const getRealtimeTimeline = vi.fn(async () => { throw new Error('unreachable') })
    Object.assign(window.agent, {
      loadRealtimeTimeline: vi.fn(async () => ({
        segments: [{ id: 'voice-local', realtimeSessionId: 'rt-1', role: 'user' as const, text: 'Stored voice request', localOrder: 10 }],
        threadMessages: [],
        activeRealtimeSessionId: null,
        hasTimeline: true,
      })),
      getRealtimeTimeline,
    })

    renderContent()

    expect(await screen.findByText('Stored voice request')).toBeInTheDocument()
    expect(useCodexRealtimeViewStore.getState().sessions['sid-1']?.hasTimeline).toBe(true)
    // No thread id: the provider is never asked, so no backend is spun up for history.
    expect(getRealtimeTimeline).not.toHaveBeenCalled()
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

    expect(hoisted.steerQueuedMessage).toHaveBeenCalledWith('u3', undefined, 'now')
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
  function claudeQueue() {
    hoisted.steerQueuedMessage.mockClear()
    hoisted.sessionState.messages = [{ id: 'm1' }]
    hoisted.sessionState.queuedMessages = [{
      id: 'u2', role: 'user', status: 'complete', content: [{ type: 'text', text: 'steer this' }], createdAt: '', providerId: 'claude',
    }]
    hoisted.sessionState.sessionProvider = 'claude'
    hoisted.sessionState.preferredProvider = 'claude'
    hoisted.sessionState.status = 'streaming'
  }

  it('offers steer for a queued message while a local Claude turn is active', () => {
    claudeQueue()

    renderContent()
    fireEvent.click(screen.getByRole('button', { name: 'Steer Now' }))

    expect(hoisted.steerQueuedMessage).toHaveBeenCalledWith('u2', undefined, 'now')
    expect(screen.queryByRole('button', { name: 'Start Queued Messages' })).toBeNull()
  })

  it('offers a non-interrupting steer beside it, sending priority next', () => {
    claudeQueue()

    renderContent()
    fireEvent.click(screen.getByRole('button', { name: 'Steer Soon (no interrupt)' }))

    expect(hoisted.steerQueuedMessage).toHaveBeenCalledWith('u2', undefined, 'next')
  })
})

describe('ChatContent Codex queue has no non-interrupting steer', () => {
  it('hides the steer-soon action for a streaming Codex turn', () => {
    hoisted.steerQueuedMessage.mockClear()
    hoisted.sessionState.messages = [{ id: 'm1' }]
    hoisted.sessionState.queuedMessages = [{
      id: 'u2', role: 'user', status: 'complete', content: [{ type: 'text', text: 'steer this' }], createdAt: '', providerId: 'codex',
    }]
    hoisted.sessionState.sessionProvider = 'codex'
    hoisted.sessionState.preferredProvider = 'codex'
    hoisted.sessionState.status = 'streaming'

    renderContent()

    expect(screen.getByRole('button', { name: 'Steer Now' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Steer Soon (no interrupt)' })).toBeNull()
  })
})

describe('ChatContent ACP queue', () => {
  it('offers steer now and steer soon for a streaming Grok turn', () => {
    hoisted.steerQueuedMessage.mockClear()
    hoisted.sessionState.messages = [{ id: 'm1' }]
    hoisted.sessionState.queuedMessages = [{
      id: 'u2', role: 'user', status: 'complete', content: [{ type: 'text', text: 'steer this' }], createdAt: '', providerId: 'acp',
    }]
    hoisted.sessionState.sessionProvider = 'acp'
    hoisted.sessionState.preferredProvider = 'acp'
    hoisted.sessionState.acpAgentId = 'grok-build'
    hoisted.sessionState.status = 'streaming'

    renderContent()

    fireEvent.click(screen.getByRole('button', { name: 'Steer Now' }))
    expect(hoisted.steerQueuedMessage).toHaveBeenCalledWith('u2', undefined, 'now')
    fireEvent.click(screen.getByRole('button', { name: 'Steer Soon (no interrupt)' }))
    expect(hoisted.steerQueuedMessage).toHaveBeenCalledWith('u2', undefined, 'next')
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
