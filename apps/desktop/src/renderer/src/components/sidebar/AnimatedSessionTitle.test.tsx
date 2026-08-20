/** @vitest-environment jsdom */

import { render, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { SessionTitleAnimated } from './AnimatedSessionTitle'

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: { agentTitles: Record<string, string> }) => unknown) =>
    selector({ agentTitles: {} }),
}))

const TITLE = 'a session title long enough to be truncated in the sidebar'

describe('sidebar session title — stall color repaint', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('recreates the truncating element when the stall color changes', () => {
    // Chromium keeps painting the old color on the `text-overflow: ellipsis`
    // glyph after a color-only change, so a recovered session showed white text
    // with a red "…" until the row was hovered. The keyed remount is the fix.
    const { container, rerender } = render(
      <SessionTitleAnimated sessionId="s1" fallback={TITLE} className="text-red-500" />,
    )
    const before = container.querySelector('.animated-title-inner')

    rerender(<SessionTitleAnimated sessionId="s1" fallback={TITLE} className="" />)

    expect(container.querySelector('.animated-title-inner')).not.toBe(before)
  })

  it('keeps the same element while the color is unchanged', () => {
    const { container, rerender } = render(
      <SessionTitleAnimated sessionId="s1" fallback={TITLE} className="text-red-500" />,
    )
    const before = container.querySelector('.animated-title-inner')

    rerender(<SessionTitleAnimated sessionId="s1" fallback={TITLE} className="text-red-500" />)

    act(() => { vi.advanceTimersByTime(1000) })

    expect(container.querySelector('.animated-title-inner')).toBe(before)
  })

  it('recreates it again once the color transition has settled', () => {
    // The color class carries `transition-colors duration-500`, so the remount
    // at the moment the class flips still paints the "…" with the *old* color —
    // the transition only reaches the new one 500ms later, and Chromium will not
    // repaint the glyph for that. A second remount after the transition settles
    // is what actually lands the recovered color.
    const { container, rerender } = render(
      <SessionTitleAnimated sessionId="s1" fallback={TITLE} className="text-red-500 transition-colors duration-500" />,
    )

    rerender(<SessionTitleAnimated sessionId="s1" fallback={TITLE} className="transition-colors duration-500" />)
    const duringTransition = container.querySelector('.animated-title-inner')

    act(() => { vi.advanceTimersByTime(600) })

    expect(container.querySelector('.animated-title-inner')).not.toBe(duringTransition)
  })
})
