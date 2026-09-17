/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposerSwitch } from './ComposerSwitch'

const originalMatchMedia = window.matchMedia

function stubMotion(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: reduced })),
  })
}

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia })
})

// jsdom has no AnimationEvent, so React subscribes to the WebKit-prefixed name.
const endAnimation = (element: Element) => {
  fireEvent(element, new Event('webkitAnimationEnd', { bubbles: true }))
}

const render_ = (kind: 'voice' | 'text') => (
  <ComposerSwitch kind={kind} render={(k) => <div data-testid={`${k}-composer`} />} />
)

describe('ComposerSwitch', () => {
  it('drops the outgoing composer, then raises the incoming one', () => {
    stubMotion(false)
    const { rerender } = render(render_('voice'))
    expect(screen.getByTestId('voice-composer')).toBeInTheDocument()

    rerender(render_('text'))
    // The old composer is still on screen, on its way out.
    const stage = screen.getByTestId('composer-switch')
    expect(stage).toHaveAttribute('data-phase', 'leaving')
    expect(screen.getByTestId('voice-composer')).toBeInTheDocument()
    expect(screen.queryByTestId('text-composer')).toBeNull()
    // The slot holds its height so the transcript above cannot claim the space mid-swap.
    expect(screen.getByTestId('composer-slot').style.height).not.toBe('')

    endAnimation(stage)
    expect(stage).toHaveAttribute('data-phase', 'entering')
    expect(screen.getByTestId('text-composer')).toBeInTheDocument()
    expect(screen.queryByTestId('voice-composer')).toBeNull()
    // Still pinned at the outgoing height while the newcomer rises.
    expect(screen.getByTestId('composer-slot').style.height).not.toBe('')

    // jsdom measures every box as 0, so the settle is a no-op and completes at once.
    endAnimation(stage)
    expect(stage).toHaveAttribute('data-phase', 'steady')
    expect(screen.getByTestId('composer-slot').style.height).toBe('')
  })

  it('cancels the hand-off when the target flips back mid-exit', () => {
    stubMotion(false)
    const { rerender } = render(render_('text'))
    rerender(render_('voice'))
    expect(screen.getByTestId('composer-switch')).toHaveAttribute('data-phase', 'leaving')
    rerender(render_('text'))
    expect(screen.getByTestId('composer-switch')).toHaveAttribute('data-phase', 'steady')
    expect(screen.getByTestId('text-composer')).toBeInTheDocument()
  })

  it('switches at once under reduced motion or without animation support', () => {
    stubMotion(true)
    const { rerender } = render(render_('voice'))
    rerender(render_('text'))
    expect(screen.getByTestId('text-composer')).toBeInTheDocument()
    expect(screen.getByTestId('composer-switch')).toHaveAttribute('data-phase', 'steady')

    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined })
    rerender(render_('voice'))
    expect(screen.getByTestId('voice-composer')).toBeInTheDocument()
  })
})
