/** @vitest-environment jsdom */

/**
 * Shift+Tab is bound to `window`, so it lives outside every
 * `SessionScopeProvider` and has to work out which pane the user is in on its
 * own. Getting that wrong silently retargets a plan-mode toggle at the main
 * conversation while the user is working in a side chat.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'

const togglePlanModeShortcut = vi.fn()
const callSession = vi.fn(async () => true)
const appState = { view: 'main' as string }

/** Sessions the fake store knows about; a test can delete one to simulate a close. */
const liveSessions: Record<string, Record<string, unknown>> = {}

vi.mock('@/lib/session-client', () => ({
  callSession,
}))

vi.mock('@/stores/app', () => ({
  useAppStore: Object.assign((selector: (s: typeof appState) => unknown) => selector(appState), {
    getState: () => appState,
  }),
}))

vi.mock('@/stores/chat', async () => {
  const scope = await import('@/stores/chat-store/session-scope')
  const state = {
    togglePlanModeShortcut,
    toggleTodos: vi.fn(),
    resetSession: vi.fn(),
    fetchSessions: vi.fn(),
    activeProject: '/repo',
    projectSessions: { '/repo': { _activeSessionId: 'main-sid', _sessions: liveSessions } },
    _bashOutputs: {},
  }
  const useChatStore = (selector: (s: typeof state) => unknown) => selector(state)
  useChatStore.getState = () => state
  return { ...scope, useChatStore, useActiveSession: () => null }
})

const { useChatKeyboardShortcuts } = await import('./useChatKeyboardShortcuts')
const { markPaneTouched, _resetLastTouchedPane } = await import('@/stores/chat-store/session-scope')

const SCOPE = { projectPath: '/repo', sessionId: 'side-sid' }

/**
 * Mirrors `SessionPane`'s root: the same two data attributes and the same
 * capture handlers. Rendering the real pane would drag the whole chat surface in
 * for a test about one keyboard handler; `SessionPane.test.tsx` pins that this
 * shape is what the pane actually renders.
 */
function Harness({ children }: { children?: React.ReactNode }) {
  useChatKeyboardShortcuts()
  return (
    <div>
      <div
        data-scope-project={SCOPE.projectPath}
        data-scope-session={SCOPE.sessionId}
        onPointerDownCapture={() => markPaneTouched(SCOPE)}
        onFocusCapture={() => markPaneTouched(SCOPE)}
      >
        <button data-testid="in-pane">in pane</button>
      </div>
      {/* Stands in for a Radix portal: visually inside the pane, a DOM sibling of it. */}
      <div data-testid="portal-root">{children}</div>
    </div>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetLastTouchedPane()
  appState.view = 'main'
  for (const key of Object.keys(liveSessions)) delete liveSessions[key]
  liveSessions[SCOPE.sessionId] = {}
})

afterEach(() => {
  cleanup()
})

describe('Shift+Tab pane targeting', () => {
  it('targets the pane the key was pressed in', () => {
    const { getByTestId } = render(<Harness />)

    fireEvent.keyDown(getByTestId('in-pane'), { key: 'Tab', shiftKey: true })

    expect(togglePlanModeShortcut).toHaveBeenCalledWith(SCOPE)
  })

  // Regression: a popover opened from a side chat renders through a portal, so
  // walking up from the event target leaves the pane's subtree entirely and the
  // shortcut fell back to the project's active session — the main chat.
  it('still targets the pane when focus is inside a portalled popover it opened', () => {
    const { getByTestId } = render(
      <Harness><button data-testid="in-portal">in portal</button></Harness>,
    )
    // Opening the popover means pressing its trigger, which IS inside the pane.
    fireEvent.pointerDown(getByTestId('in-pane'))

    fireEvent.keyDown(getByTestId('in-portal'), { key: 'Tab', shiftKey: true })

    expect(togglePlanModeShortcut).toHaveBeenCalledWith(SCOPE)
  })

  it('falls back to the active session when no pane has been touched', () => {
    const { getByTestId } = render(
      <Harness><button data-testid="in-portal">in portal</button></Harness>,
    )

    fireEvent.keyDown(getByTestId('in-portal'), { key: 'Tab', shiftKey: true })

    expect(togglePlanModeShortcut).toHaveBeenCalledWith(undefined)
  })

  // Regression: closing a side chat disposes its runtime, but the last thing the
  // user touched is still that pane. Targeting it then addresses a session that
  // no longer exists — and the per-session writers create a row for an unknown
  // id instead of refusing it, so the closed chat comes back as a phantom.
  it('ignores the remembered pane once its session is gone', () => {
    const { getByTestId } = render(
      <Harness><button data-testid="in-portal">in portal</button></Harness>,
    )
    fireEvent.pointerDown(getByTestId('in-pane'))
    delete liveSessions[SCOPE.sessionId]

    fireEvent.keyDown(getByTestId('in-portal'), { key: 'Tab', shiftKey: true })

    expect(togglePlanModeShortcut).toHaveBeenCalledWith(undefined)
  })

  it('returns to the active session once the unscoped main chat is touched again', () => {
    const { getByTestId } = render(
      <Harness><button data-testid="in-portal">in portal</button></Harness>,
    )
    markPaneTouched(SCOPE)
    markPaneTouched(null)

    fireEvent.keyDown(getByTestId('in-portal'), { key: 'Tab', shiftKey: true })

    expect(togglePlanModeShortcut).toHaveBeenCalledWith(undefined)
  })
})

describe('Ctrl+B background tasks shortcut', () => {
  it('backgrounds foreground tasks in the targeted Claude session and prevents default', () => {
    liveSessions[SCOPE.sessionId] = {
      sessionProvider: 'claude',
      preferredProvider: 'claude',
      status: 'streaming',
      messages: [{
        id: 'm1',
        role: 'assistant',
        status: 'streaming',
        createdAt: '',
        content: [{ type: 'tool_use', toolName: 'Bash', toolUseId: 'tu-1', input: '{"command":"sleep 10"}', status: 'streaming' }],
      }],
    }
    const { getByTestId } = render(<Harness />)
    const prevented = !fireEvent.keyDown(getByTestId('in-pane'), { key: 'b', code: 'KeyB', ctrlKey: true })

    expect(prevented).toBe(true)
    expect(callSession).toHaveBeenCalledWith('/repo', SCOPE.sessionId, 'session.backgroundTasks', {})
  })

  it('ignores non-Claude sessions and does not call preventDefault', () => {
    liveSessions[SCOPE.sessionId] = {
      sessionProvider: 'codex',
      preferredProvider: 'codex',
      status: 'streaming',
      messages: [{
        id: 'm1',
        role: 'assistant',
        status: 'streaming',
        createdAt: '',
        content: [{ type: 'tool_use', toolName: 'Bash', toolUseId: 'tu-1', input: '{"command":"sleep 10"}', status: 'streaming' }],
      }],
    }
    const { getByTestId } = render(<Harness />)
    const prevented = !fireEvent.keyDown(getByTestId('in-pane'), { key: 'b', code: 'KeyB', ctrlKey: true })

    expect(prevented).toBe(false)
    expect(callSession).not.toHaveBeenCalled()
  })

  it('ignores xterm focus and idle sessions with no foreground task', () => {
    liveSessions[SCOPE.sessionId] = {
      sessionProvider: 'claude',
      preferredProvider: 'claude',
      status: 'streaming',
      messages: [{
        id: 'm1',
        role: 'assistant',
        status: 'streaming',
        createdAt: '',
        content: [{ type: 'tool_use', toolName: 'Bash', toolUseId: 'tu-1', input: '{"command":"sleep 10"}', status: 'streaming' }],
      }],
    }
    const { getByTestId } = render(
      <Harness>
        <div className="xterm"><textarea data-testid="xterm-input" /></div>
      </Harness>,
    )
    fireEvent.keyDown(getByTestId('xterm-input'), { key: 'b', code: 'KeyB', ctrlKey: true })
    expect(callSession).not.toHaveBeenCalled()

    liveSessions[SCOPE.sessionId] = { sessionProvider: 'claude', preferredProvider: 'claude', status: 'idle', messages: [] }
    const preventedWhenIdle = !fireEvent.keyDown(getByTestId('in-pane'), { key: 'b', code: 'KeyB', ctrlKey: true })
    expect(preventedWhenIdle).toBe(false)
    expect(callSession).not.toHaveBeenCalled()
  })
})
