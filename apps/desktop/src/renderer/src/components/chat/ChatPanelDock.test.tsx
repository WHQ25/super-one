/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useChatStore } from '@/stores/chat'
import { ChatPanel } from './ChatPanel'

vi.mock('./ChatContent', () => ({
  ChatContent: () => <div data-testid="chat-content" />,
}))

vi.mock('./HeaderSessionMenu', () => ({
  HeaderSessionMenu: () => null,
}))

vi.mock('@/hooks/useChatScroll', () => ({
  useChatScroll: () => ({
    showScrollButton: false,
    scrollToBottom: vi.fn(),
    stopAutoScroll: vi.fn(),
  }),
}))

vi.mock('@/hooks/useChatKeyboardShortcuts', () => ({
  useChatKeyboardShortcuts: vi.fn(),
}))

function createBoundaryRef() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return { current: el }
}

beforeEach(() => {
  vi.useFakeTimers()
  useActivityPanelStore.setState({ showPanel: true, chatFloating: true, maximized: false })
  useChatStore.setState({ isOpen: false })
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  document.body.replaceChildren()
})

describe('ChatPanel dock interactions', () => {
  it('docks chat on double-clicking the collapsed icon while single-click expands it', () => {
    const ref = createBoundaryRef()
    const { container } = render(<ChatPanel anchorBoundaryRef={ref} />)
    const botIcon = container.querySelector('.lucide-bot')!.parentElement!

    fireEvent.click(botIcon)
    expect(useChatStore.getState().isOpen).toBe(false)
    act(() => {
      vi.advanceTimersByTime(220)
    })
    expect(useChatStore.getState().isOpen).toBe(true)
    expect(useActivityPanelStore.getState().chatFloating).toBe(true)

    act(() => {
      useChatStore.setState({ isOpen: false })
    })
    const collapsed = container.querySelector('.lucide-bot')!.parentElement!
    fireEvent.click(collapsed)
    fireEvent.click(collapsed)
    fireEvent.doubleClick(collapsed)
    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(useActivityPanelStore.getState().chatFloating).toBe(false)
    expect(useChatStore.getState().isOpen).toBe(false)
  })

  it('replaces the new-session button with a side-aware dock button in the expanded header', () => {
    useActivityPanelStore.setState({ showPanel: true, chatFloating: true, maximized: false, side: 'left' })
    useChatStore.setState({ isOpen: true })
    const ref = createBoundaryRef()
    const { container } = render(<ChatPanel anchorBoundaryRef={ref} />)

    expect(container.querySelector('.lucide-plus')).toBeNull()
    const dockButton = screen.getByRole('button', { name: 'Dock Chat' })
    expect(dockButton.querySelector('.lucide-panel-right')).not.toBeNull()

    act(() => {
      useActivityPanelStore.setState({ side: 'right' })
    })
    expect(dockButton.querySelector('.lucide-panel-left')).not.toBeNull()

    fireEvent.click(dockButton)
    expect(useActivityPanelStore.getState().chatFloating).toBe(false)
  })
})
