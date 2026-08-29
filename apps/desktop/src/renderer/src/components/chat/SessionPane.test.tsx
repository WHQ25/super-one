/** @vitest-environment jsdom */

/**
 * `SessionPane` publishes its scope twice: through React context, and onto the
 * DOM for handlers that cannot read context (window-level keyboard shortcuts).
 *
 * The DOM half is easy to drop in a refactor and impossible to notice, because
 * everything keeps working until someone presses Shift+Tab in a side chat — so
 * it gets a test of its own rather than riding along in a shortcut test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'

vi.mock('@/components/chat/ChatContent', () => ({
  ChatContent: () => <div data-testid="chat-content">chat</div>,
}))
vi.mock('@/hooks/useChatScroll', () => ({
  useChatScroll: () => ({ showScrollButton: false, scrollToBottom: vi.fn(), stopAutoScroll: vi.fn() }),
}))
vi.mock('@/hooks/useHarnessTheme', () => ({ usePaneHarnessTheme: () => {} }))

const { SessionPane } = await import('./SessionPane')
const { lastTouchedPane, _resetLastTouchedPane } = await import('@/stores/chat-store/session-scope')

const SCOPE = { projectPath: '/repo', sessionId: 'side-sid' }

beforeEach(() => {
  _resetLastTouchedPane()
})

afterEach(() => {
  cleanup()
})

describe('SessionPane scope publication', () => {
  it('mirrors its scope onto the DOM so window-level handlers can find it', () => {
    const { getByTestId } = render(<SessionPane scope={SCOPE} />)

    const root = getByTestId('chat-content').closest('[data-scope-session]') as HTMLElement
    expect(root.dataset.scopeProject).toBe(SCOPE.projectPath)
    expect(root.dataset.scopeSession).toBe(SCOPE.sessionId)
  })

  it('records itself as the touched pane on pointer-down, before any popover portals out of it', () => {
    const { getByTestId } = render(<SessionPane scope={SCOPE} />)

    fireEvent.pointerDown(getByTestId('chat-content'))

    expect(lastTouchedPane()).toEqual(SCOPE)
  })

  it('records null for the unscoped main chat, so the shortcut falls back to the active session', () => {
    const { getByTestId } = render(<SessionPane />)

    fireEvent.pointerDown(getByTestId('chat-content'))

    expect(lastTouchedPane()).toBeNull()
  })
})
