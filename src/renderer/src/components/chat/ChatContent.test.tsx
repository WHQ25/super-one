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
  }
  return { sessionState, isRemoteLocked: { value: false } }
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

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div data-testid="scroll-area">{children}</div>,
}))

vi.mock('./ChatInput', () => ({ ChatInput: () => <div data-testid="chat-input" /> }))
vi.mock('./ChatStatusBar', () => ({ ChatStatusBar: () => <div data-testid="chat-status-bar" /> }))
vi.mock('./ChatMessage', () => ({
  ChatMessage: () => <div data-testid="chat-message" />,
  CompactingIndicator: () => <div data-testid="compacting" />,
  CompactIndicator: () => <div data-testid="compact" />,
  RateLimitIndicator: () => <div data-testid="rate-limit" />,
  ApiRetryIndicator: () => <div data-testid="api-retry" />,
  parseCompactMarker: () => null,
}))
vi.mock('./ChatSuggestions', () => ({ ChatSuggestions: () => <div data-testid="chat-suggestions" /> }))
vi.mock('./PermissionPrompt', () => ({ PermissionPrompt: () => <div data-testid="permission-prompt" /> }))
vi.mock('./AskUserQuestionPrompt', () => ({ AskUserQuestionPrompt: () => <div data-testid="ask-user-question" /> }))
vi.mock('./SlashCommandOverlay', () => ({ SlashCommandOverlay: () => <div data-testid="slash-overlay" /> }))
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
