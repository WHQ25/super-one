/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import type { ChatMessage } from '@superone/shared/agent-types'

/**
 * The launch task a parent agent hands to a child session. The desktop renders
 * it as a right-aligned markdown bubble clamped to half a screen; the phone used
 * to fall through to the generic collaboration path (left-aligned, plain text,
 * never expandable). Both hosts now mount the same presenter.
 */
function collabTaskMessage(text: string): ChatMessage {
  return {
    id: 'task-1',
    role: 'user',
    status: 'complete',
    createdAt: '2026-01-01T00:00:00.000Z',
    providerId: 'claude',
    content: [{ type: 'text', text }],
    metadata: {
      source: 'collaboration',
      collaboration: { kind: 'initial_task', direction: 'inbound', fromSessionId: 'parent-1' },
    },
  } as ChatMessage
}

function renderTask(message: ChatMessage) {
  return render(<PortableMessage message={message} scheme="dark" pendingPermission={null} />)
}

const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')

function stubBodyHeight(px: number): void {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => px })
  // jsdom lays nothing out, so the viewport the clamp measures against is 0 unless stubbed.
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, get: () => 800 })
}

afterEach(() => {
  if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight)
  delete (document.documentElement as { clientHeight?: number }).clientHeight
})

describe('PortableMessage collaboration initial task', () => {
  it('renders the launch task as right-aligned markdown, not the left collaboration bubble', () => {
    const task = `## Review request\n\n${Array.from({ length: 40 }, (_, i) => `- step ${i}`).join('\n')}`
    const { container } = renderTask(collabTaskMessage(task))

    expect(screen.getByText('Agent task')).toBeInTheDocument()
    expect(screen.getByText('Review request').tagName).toBe('H2')
    expect(container.querySelector('.justify-end')).not.toBeNull()
    expect(container.querySelector('.justify-start')).toBeNull()
    // The generic collaboration chrome (primary border) must not wrap it.
    expect(container.querySelector('.border-primary\\/25')).toBeNull()
  })

  it('clamps a task taller than half the viewport until expanded', () => {
    stubBodyHeight(900)
    const { container } = renderTask(collabTaskMessage('# Long task\n\nbody'))

    const toggle = screen.getByRole('button', { name: 'Expand' })
    expect(container.querySelector('.max-h-\\[50vh\\]')).not.toBeNull()

    act(() => { toggle.click() })

    expect(container.querySelector('.max-h-\\[50vh\\]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument()
  })

  it('expands when the clipped body itself is tapped', () => {
    stubBodyHeight(900)
    const { container } = renderTask(collabTaskMessage('# Long task\n\nbody'))

    act(() => { screen.getByText('body').click() })

    expect(container.querySelector('.max-h-\\[50vh\\]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument()
  })

  it('leaves short tasks unclamped with no expand toggle', () => {
    stubBodyHeight(120)
    const { container } = renderTask(collabTaskMessage('Do the thing.'))

    expect(screen.queryByRole('button', { name: 'Expand' })).toBeNull()
    expect(container.querySelector('.max-h-\\[50vh\\]')).toBeNull()
  })

  it('opens the copy menu on long-press, hugging the right edge like user input', () => {
    vi.useFakeTimers()
    try {
      const { container } = renderTask(collabTaskMessage('Do the thing.'))
      const bubble = container.querySelector<HTMLElement>('.portable-user-message')!
      const press = { clientX: 10, clientY: 10, isPrimary: true, pointerType: 'touch', bubbles: true }

      act(() => {
        bubble.dispatchEvent(new PointerEvent('pointerdown', press))
        vi.advanceTimersByTime(500) // > LONG_PRESS_DELAY_MS (450)
        bubble.dispatchEvent(new PointerEvent('pointerup', press))
      })

      const item = screen.getByRole('menuitem', { name: 'Copy' })
      expect(item).toBeInTheDocument()
      // Right-anchored like user input; the generic collab bubble would use `left-0`.
      expect(item.closest('.right-0')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
